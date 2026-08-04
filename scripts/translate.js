import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT_DIR, INSTALL_DIR } from './config.js';
import { mapToSjis, validateSjis } from './lib/sjis-encode.js';

// Decompiler 对含日文/中文的绝对路径参数支持不佳（ANSI 936），统一走 ASCII junction
const ASCII_JUNCTION = 'E:\\Games\\Eushully\\wk';
const DECOMPILER = path.join(ASCII_JUNCTION, 'tools', 'eushully-decompiler', 'Decompiler', 'Decompiler.exe');

const DATA_DIR = path.join(ROOT_DIR, 'data');
const LOCALE_DIR = path.join(ROOT_DIR, 'locale');

const LINE_RE = /^set-string \(global-string ([0-9a-f]+)\) "(.+)"$/;

function usage() {
  console.log('用法: node translate.js <extract|extract-all|apply|assemble> [脚本名，如 OPINIT1]');
  console.log('  extract-all  为 data 下所有尚无基线的脚本生成 locale/<脚本>.json（读 data txt，不依赖 git）');
  console.log('  extract      为单个脚本生成 locale/<脚本>.json（已存在则跳过，--force 重建）');
  console.log('  apply    读取 locale/<脚本>.json 译文，编码后写回 data/<脚本>.txt');
  console.log('  assemble 校验 SJIS 可编码 → Decompiler 汇编 → 安装到 install → 回读校验');
}

function parseSetStrings(content) {
  const obj = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(LINE_RE);
    if (m) obj[m[1]] = { orig: m[2], trans: '' };
  }
  return obj;
}

// 读取 locale/<脚本>.json（单文件单大对象：{id: {orig, trans}}；兼容旧的纯字符串值）
function loadEntries(script) {
  const localePath = path.join(LOCALE_DIR, `${script}.json`);
  if (!fs.existsSync(localePath)) {
    console.error('[FAIL] 先运行 extract:', localePath);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(localePath, 'utf8'));
  const entries = [];
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v === 'string') entries.push({ id, orig: '', trans: v });
    else entries.push({ id, orig: v?.orig ?? '', trans: v?.trans ?? '' });
  }
  return entries;
}

function writeLocale(script, obj) {
  fs.mkdirSync(LOCALE_DIR, { recursive: true });
  const out = path.join(LOCALE_DIR, `${script}.json`);
  fs.writeFileSync(out, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`[extract] ${Object.keys(obj).length} 条文案 → ${out}`);
}

function extract(script) {
  const out = path.join(LOCALE_DIR, `${script}.json`);
  if (fs.existsSync(out) && !process.argv.includes('--force')) {
    console.log(`[skip ] ${out} 已存在（基线已入库；--force 可从 data txt 重建）`);
    return;
  }
  // 读 data txt 生成基线。注意：已 apply 过的脚本（txt 被编码改写）不应 --force 重建
  const content = fs.readFileSync(path.join(DATA_DIR, `${script}.txt`), 'utf8');
  writeLocale(script, parseSetStrings(content));
}

function extractAll() {
  fs.mkdirSync(LOCALE_DIR, { recursive: true });
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.txt'));
  let created = 0;
  let skipped = 0;
  for (const f of files) {
    const script = f.slice(0, -4);
    const out = path.join(LOCALE_DIR, `${script}.json`);
    if (fs.existsSync(out)) {
      skipped++;
      continue;
    }
    const content = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
    fs.writeFileSync(out, JSON.stringify(parseSetStrings(content), null, 2) + '\n', 'utf8');
    created++;
  }
  console.log(`[extract-all] 新建 ${created} 个基线，跳过已有 ${skipped} 个（共 ${files.length} 个 txt）`);
}

function apply(script) {
  const entries = loadEntries(script);
  const byId = new Map(entries.map((e) => [e.id, e]));

  const txtPath = path.join(DATA_DIR, `${script}.txt`);
  const raw = fs.readFileSync(txtPath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r\n|\r|\n/);

  let applied = 0;
  const problems = [];
  const missing = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_RE);
    if (!m) continue;
    const entry = byId.get(m[1]);
    if (!entry || !entry.trans) continue;
    seen.add(entry.id);
    const { text, problems: p } = mapToSjis(entry.trans);
    if (p.length) problems.push(`[${entry.id}] ${entry.orig} → ${entry.trans}: ${p.join('; ')}`);
    if (text !== m[2]) {
      lines[i] = `set-string (global-string ${entry.id}) "${text}"`;
      applied++;
    }
  }
  for (const e of entries) {
    if (e.trans && !seen.has(e.id)) missing.push(e.id);
  }

  if (problems.length) {
    console.error('[FAIL] 存在无法映射的字符，未写回：');
    for (const p of problems) console.error('  ', p);
    process.exit(1);
  }
  fs.writeFileSync(txtPath, lines.join(eol), 'utf8');
  console.log(`[apply ] ${script}.txt：更新 ${applied} 条（共 ${entries.filter((e) => e.trans).length} 条已翻译）`);
  if (missing.length) console.log(`[warn ] 未在 txt 中找到的 id: ${missing.join(', ')}`);
}

function assemble(script) {
  // 1) 兜底校验：txt 必须整体可 cp932 编码
  const txtPath = path.join(DATA_DIR, `${script}.txt`);
  const txt = fs.readFileSync(txtPath, 'utf8');
  const bad = validateSjis(txt);
  if (bad.length) {
    console.error('[FAIL] txt 含不可 SJIS 编码字符：', bad.slice(0, 20).join(', '));
    process.exit(1);
  }

  // 2) 汇编（ASCII junction 路径）
  const asciiTxt = path.join(ASCII_JUNCTION, 'data', `${script}.txt`);
  const asciiOut = path.join(ASCII_JUNCTION, '.tmp', `${script}.BIN`);
  fs.mkdirSync(path.join(ASCII_JUNCTION, '.tmp'), { recursive: true });
  execFileSync(DECOMPILER, ['-e', 'sjis', '-a', asciiTxt, asciiOut]);

  // 3) 安装到 install
  const dst = path.join(INSTALL_DIR, `${script}.BIN`);
  fs.copyFileSync(asciiOut, dst);
  const size = fs.statSync(dst).size;

  // 4) 回读校验
  const asciiCheck = path.join(ASCII_JUNCTION, '.tmp', `${script}.check.txt`);
  execFileSync(DECOMPILER, ['-e', 'sjis', '-d', asciiOut, asciiCheck]);
  const check = fs.readFileSync(asciiCheck, 'utf8');
  const entries = loadEntries(script);
  const translated = entries.filter((e) => e.trans);
  let verified = 0;
  for (const e of translated) {
    if (check.includes(mapToSjis(e.trans).text)) verified++;
  }
  console.log(`[assemble] ${script}.BIN -> install (${size} bytes)，回读验证 ${verified}/${translated.length} 条译文`);
  if (verified !== translated.length) {
    console.error('[warn] 部分译文未在回读文件中找到，请检查');
    process.exit(1);
  }
}

const cmd = process.argv[2];
if (!cmd) {
  usage();
  process.exit(1);
}
if (cmd === 'extract-all') extractAll();
else if (cmd === 'extract') extract(process.argv[3]);
else if (cmd === 'apply') apply(process.argv[3]);
else if (cmd === 'assemble') assemble(process.argv[3]);
else usage();
