import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT_DIR, INSTALL_DIR, SRC_DIR } from './config.js';
import { mapToSjis, validateSjis } from './lib/sjis-encode.js';

// age-asm（cmake 构建）对含日文/中文的绝对路径参数支持不佳（ANSI 936），统一走 ASCII junction
const ASCII_JUNCTION = 'E:\\Games\\Eushully\\wk';
const DECOMPILER = path.join(ASCII_JUNCTION, 'tools', 'eushully-decompiler', 'build', 'Release', 'age-asm.exe');

const DATA_DIR = path.join(ROOT_DIR, 'data');   // 只读比较基线（原始日文）

// 翻译语法（src 源文件内）：
//   "原文|译文"   —— #1 对语法：简单单行替换（set-string 等）
//   @"译文"      —— #3 中文标记：新写/重写的文本行
//   /* ... */    —— #2 块注释：原句存档（标记行独立，原文行保持与基线逐字一致），
//                   预处理时整块丢弃（// 行注释仍兼容支持）
const PAIR_SEP = '|';
// 允许增删改的文本内容行；end-text-line 为视觉行结束标记，可按排版需要自由插入/移除；
// draw-string 为参数化控件文本（draw-string <纹理> <x> <y> <文本>），尾参字面量可译
const TEXT_INSTR = /^(set-string|show-text|display-furigana|concat|end-text-line|draw-string)\b/;
const LITERAL_RE = /(@?)"([^"]*)"/g;
const SET_STRING_RE = /^set-string \(global-string ([0-9a-f]+)\) (@?)"(.+)"$/;

function usage() {
  console.log('用法: node translate.js <assemble> [脚本名，如 OPINIT1]');
  console.log('  assemble   src/<脚本>.txt（含翻译语法）→ 预处理展开 → 骨架校验 → 汇编 → 安装 → 回读验证');
}

// ---------- 语法解析 ----------
function parseLiteral(at, content) {
  if (at === '@') return { orig: '', trans: content };
  const idx = content.indexOf(PAIR_SEP);
  if (idx >= 0) return { orig: content.slice(0, idx), trans: content.slice(idx + 1) };
  return { orig: content, trans: null };
}

// 预处理：丢弃 // 行注释与 /* */ 块注释；展开 | 对与 @"..." 标记为可 SJIS 编码文本
function preprocess(srcText) {
  const eol = srcText.includes('\r\n') ? '\r\n' : '\n';
  const problems = [];
  const lines = [];
  let inBlock = false;
  for (const line of srcText.split(/\r\n|\r|\n/)) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*/')) {
      if (t.startsWith('/*') && !t.includes('*/')) inBlock = true;
      continue;
    }
    const out = line.replace(LITERAL_RE, (m, at, content) => {
      const { trans } = parseLiteral(at, content);
      if (trans === null) return m;
      const { text, problems: p } = mapToSjis(trans);
      if (p.length) problems.push(`${line.trim()} : ${p.join('; ')}`);
      return `"${text}"`;
    });
    // 控制行可能带 annotate-call-script 追加的行尾注释（如 `call-script 2d  // CHARMEDIT`），
    // 写盘给 age-asm 前须剥离开头/行尾 `//` 注释；文本指令行(可含字符串)不做此处理，保护字符串内 `//`。
    lines.push(TEXT_INSTR.test(out) ? out : out.replace(/\s*\/\/.*$/, ''));
  }
  return { lines, eol, problems };
}

// 骨架：去掉注释与文本内容行后的控制流序列（label/u/指令/end-text-line 等）
// 注：call-script 等控制行可能带 annotate-call-script 追加的行尾注释（如 `// CHARMEDIT`），
//     比较前须剥离行尾 `//` 注释，否则会与无注释的 data 基线误判为「控制行被改动」。
function skeleton(lines) {
  return lines
    .map((l) => l.trim().replace(/\s*\/\/.*$/, ''))
    .filter((l) => l && !l.startsWith('//') && !TEXT_INSTR.test(l));
}

function checkSkeleton(script, curLines, baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    console.log(`[warn ] 无基线 ${baselinePath}，跳过骨架校验`);
    return;
  }
  const base = skeleton(fs.readFileSync(baselinePath, 'utf8').split(/\r\n|\r|\n/));
  const cur = skeleton(curLines);
  if (base.length !== cur.length) {
    console.error(`[FAIL] ${script} 骨架行数变化：基线 ${base.length} → 当前 ${cur.length}`);
    for (let i = 0; i < Math.min(base.length, cur.length); i++) {
      if (base[i] !== cur[i]) {
        console.error(`  首个差异 #${i}\n    基线: ${base[i]}\n    当前: ${cur[i]}`);
        break;
      }
    }
    process.exit(1);
  }
  for (let i = 0; i < base.length; i++) {
    if (base[i] !== cur[i]) {
      console.error(`[FAIL] ${script} 控制行被改动 #${i}\n  基线: ${base[i]}\n  当前: ${cur[i]}`);
      process.exit(1);
    }
  }
}

// ---------- 命令 ----------
function assemble(script) {
  const srcPath = path.join(SRC_DIR, `${script}.txt`);
  if (!fs.existsSync(srcPath)) {
    console.error('[FAIL] src 文件不存在:', srcPath);
    process.exit(1);
  }
  const src = fs.readFileSync(srcPath, 'utf8');
  const { lines, eol, problems } = preprocess(src);
  if (problems.length) {
    console.error('[FAIL] 存在无法映射的字符：');
    for (const p of problems) console.error('  ', p);
    process.exit(1);
  }

  checkSkeleton(script, lines, path.join(DATA_DIR, `${script}.txt`));

  const plain = lines.join(eol);
  const bad = validateSjis(plain);
  if (bad.length) {
    console.error('[FAIL] 展开后仍含不可 SJIS 编码字符：', bad.slice(0, 20).join(', '));
    process.exit(1);
  }

  fs.mkdirSync(path.join(ASCII_JUNCTION, '.tmp'), { recursive: true });
  const asciiPlain = path.join(ASCII_JUNCTION, '.tmp', `${script}.plain.txt`);
  const asciiOut = path.join(ASCII_JUNCTION, '.tmp', `${script}.BIN`);
  fs.writeFileSync(asciiPlain, plain, 'utf8');
  execFileSync(DECOMPILER, ['-e', 'sjis', '-a', asciiPlain, asciiOut]);

  // 安装：install 根 + install/DATA1（松散覆盖）
  const installed = [];
  for (const dir of [INSTALL_DIR, path.join(INSTALL_DIR, 'DATA1')]) {
    const dst = path.join(dir, `${script}.BIN`);
    fs.copyFileSync(asciiOut, dst);
    installed.push(dst);
  }

  // 回读验证：反汇编后应包含所有展开的译文
  const asciiCheck = path.join(ASCII_JUNCTION, '.tmp', `${script}.check.txt`);
  execFileSync(DECOMPILER, ['-e', 'sjis', '-d', asciiOut, asciiCheck]);
  const check = fs.readFileSync(asciiCheck, 'utf8');
  const expected = [];
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (line.trim().startsWith('//')) continue;
    for (const m of line.matchAll(LITERAL_RE)) {
      const { trans } = parseLiteral(m[1], m[2]);
      if (trans !== null) expected.push(mapToSjis(trans).text);
    }
  }
  const uniq = [...new Set(expected)];
  let verified = 0;
  for (const t of uniq) if (check.includes(t)) verified++;
  const size = fs.statSync(asciiOut).size;
  console.log(`[assemble] ${script}.BIN -> ${installed.join(', ')} (${size} bytes)，骨架校验通过，回读验证 ${verified}/${uniq.length} 处译文`);
  if (verified !== uniq.length) {
    console.error('[warn] 部分译文未在回读文件中找到，请检查');
    process.exit(1);
  }
}

const cmd = process.argv[2];
if (!cmd) {
  usage();
  process.exit(1);
}
if (cmd === 'assemble') assemble(process.argv[3]);
else usage();
