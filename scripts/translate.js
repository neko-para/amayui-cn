import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, INSTALL_DIR, SRC_DIR } from './config.js';
import { mapToSjis, validateSjis } from './lib/sjis-encode.js';
import { assemble as assembleScript } from './asm/reassembler.mjs';
import { disassemble as disassembleScript } from './asm/disassembler.mjs';

// Node 版 age-asm（scripts/asm，跨平台，指令集数据驱动）。与原 age-asm.exe 等价，
// 且不再受 ANSI 936 路径限制，无需 E:\Games\Eushully\wk ASCII junction。
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
  console.log('用法: node translate.js assemble [脚本名，如 OPINIT1]');
  console.log('  assemble <脚本>   src/<脚本>.txt（含翻译语法）→ 预处理展开 → 骨架校验 → 汇编 → 安装到 install/ 根 → 回读验证');
  console.log('  assemble          **全量构建**：对 src/*.txt 逐个做上面这套，末尾汇总成功/失败清单');
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

/** 骨架校验：**返回**错误文本（不再 process.exit，便于全量构建逐脚本汇总）。 */
function checkSkeleton(script, curLines, baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    console.log(`[warn ] 无基线 ${baselinePath}，跳过骨架校验`);
    return null;
  }
  const base = skeleton(fs.readFileSync(baselinePath, 'utf8').split(/\r\n|\r|\n/));
  const cur = skeleton(curLines);
  if (base.length !== cur.length) {
    let detail = '';
    for (let i = 0; i < Math.min(base.length, cur.length); i++) {
      if (base[i] !== cur[i]) {
        detail = `\n  首个差异 #${i}\n    基线: ${base[i]}\n    当前: ${cur[i]}`;
        break;
      }
    }
    return `[FAIL] ${script} 骨架行数变化：基线 ${base.length} → 当前 ${cur.length}${detail}`;
  }
  for (let i = 0; i < base.length; i++) {
    if (base[i] !== cur[i]) {
      return `[FAIL] ${script} 控制行被改动 #${i}\n  基线: ${base[i]}\n  当前: ${cur[i]}`;
    }
  }
  return null;
}

// ---------- 命令 ----------
/**
 * 汇编**一个**脚本并安装（`src/<ID>.txt` → `install/<ID>.BIN`）。
 *
 * ★不再 `process.exit`：返回 `{ ok, error? }`，让单脚本模式与**全量构建**共用同一段逻辑
 * （全量要逐脚本汇总失败清单，不能被第一个失败打断）。
 */
function assembleOne(script, opts = {}) {
  const srcPath = path.join(SRC_DIR, `${script}.txt`);
  if (!fs.existsSync(srcPath)) return { ok: false, error: `[FAIL] src 文件不存在: ${srcPath}` };
  const src = fs.readFileSync(srcPath, 'utf8');
  const { lines, eol, problems } = preprocess(src);
  if (problems.length) {
    return { ok: false, error: `[FAIL] 存在无法映射的字符：\n  ${problems.join('\n  ')}` };
  }

  const skelErr = checkSkeleton(script, lines, path.join(DATA_DIR, `${script}.txt`));
  if (skelErr) return { ok: false, error: skelErr };

  const plain = lines.join(eol);
  const bad = validateSjis(plain);
  if (bad.length) {
    return { ok: false, error: `[FAIL] 展开后仍含不可 SJIS 编码字符：${bad.slice(0, 20).join(', ')}` };
  }

  fs.mkdirSync(path.join(ROOT_DIR, '.tmp'), { recursive: true });
  const asciiPlain = path.join(ROOT_DIR, '.tmp', `${script}.plain.txt`);
  const asciiOut = path.join(ROOT_DIR, '.tmp', `${script}.BIN`);
  // Node 版汇编：直接读 preprocess 展开的文本 → BIN（无 junction / Windows 路径限制）
  const bin = assembleScript(plain, null, 932);
  fs.writeFileSync(asciiPlain, plain, 'utf8');
  fs.writeFileSync(asciiOut, bin);

  // 安装：**只写 install 根**（松散 overlay；引擎/模拟器的文件查找都是"松散优先于 ALF"）。
  // ★不写 install/DATA1/：那是 ALF 的**原始解包树**（AGF 注入底图、patch-menu 的 AGERC.DLL 来源、
  //   以及"还原原图"的来源），是**只读基**，从来不是汇编产物的安装目标。
  const dst = path.join(INSTALL_DIR, `${script}.BIN`);
  fs.copyFileSync(asciiOut, dst);
  const installed = [dst];

  // 回读验证：反汇编后应包含所有展开的译文
  const check = disassembleScript(bin, null, 932);
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
  if (opts.quiet) {
    console.log(`[ok  ] ${script}.BIN (${size} bytes) 回读 ${verified}/${uniq.length}`);
  } else {
    console.log(`[assemble] ${script}.BIN -> ${installed.join(', ')} (${size} bytes)，骨架校验通过，回读验证 ${verified}/${uniq.length} 处译文`);
  }
  if (verified !== uniq.length) {
    return { ok: false, error: `[warn] ${script}: 部分译文未在回读文件中找到（${verified}/${uniq.length}），请检查` };
  }
  return { ok: true, size, verified, uniq: uniq.length, installed };
}

/** **全量构建**：把 `src/*.txt` 逐个汇编进 `install/` 根（松散 overlay，引擎优先于 ALF）。 */
function assembleAll() {
  const ids = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.slice(0, -4))
    .sort();
  console.log(`[build] 全量构建：${ids.length} 个脚本 → ${INSTALL_DIR}`);
  const t0 = Date.now();
  const failed = [];
  for (let i = 0; i < ids.length; i++) {
    const r = assembleOne(ids[i], { quiet: true });
    if (!r.ok) {
      failed.push({ id: ids[i], error: r.error });
      console.error(`[FAIL] ${ids[i]}`);
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[build] 完成：成功 ${ids.length - failed.length}/${ids.length}，失败 ${failed.length}，用时 ${secs}s`);
  for (const f of failed) console.error(`${f.id}: ${f.error}`);
  if (failed.length) process.exit(1);
}

const cmd = process.argv[2];
if (!cmd) {
  usage();
  process.exit(1);
}
if (cmd === 'assemble') {
  const target = process.argv[3];
  if (target) {
    const r = assembleOne(target);
    if (!r.ok) {
      console.error(r.error);
      process.exit(1);
    }
  } else {
    assembleAll();
  }
} else usage();
