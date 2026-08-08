// 扫描 src/*.txt，过滤未翻译的文本内容。
//
// 用法:
//   node find-untranslated.js [文件...] [--list] [--json]
//   - 文件...  只检查指定脚本（不含 .txt 后缀亦可，支持 $N$ 前缀）；省略 = 全部 src/*.txt
//   - --list   额外输出每个文件的已翻译文案明细（set-string 对 / @"译文" 行 / 页块注释）
//   - --json   输出 JSON（便于程序处理）
//
// 判定规则（与 conventions.md 一致）:
//   - 文本指令行 = set-string / show-text / display-furigana / draw-string / concat；
//   - 已翻译: set-string/draw-string 字面量含 `|` 对语法；show-text/display-furigana/draw-string/
//     concat 字面量为 @"译文"；操作数为寄存器/全局字符串引用；字面量为空串；
//   - 未翻译行按内容分类:
//       untranslated = 含假名（必为未译日文，真实残留）；
//       same         = 纯汉字/数字（中日同文，通常无需翻译，人工确认）；
//       symbol       = 纯符号（/ ％ -- 等，无需翻译）；
//       placeholder  = 纯 ？ 占位（如 「？？？？」，保持原样）；
//   - `/* 原文存档 */ … */` 块注释与 `// 输入原文：` / `// 页面结束` 注释内的原文行不计；
//   - 文件分类: 无任何译文标记（| 对 / @" / 输入原文）→ 完全未翻译；否则 → 部分翻译
//     （untranslated 类行即残留，需要处理）。

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './config.js';

const TEXT_RE = /^(set-string|show-text|display-furigana|draw-string|concat)\b/;
const PAIR_RE = /^((?:set-string|draw-string)\b.*)"((?:[^"\\]|\\.)*)\|((?:[^"\\]|\\.)*)"\s*$/;
const AT_RE = /"@([^"]*)"/;

function usage() {
  console.log('用法: node find-untranslated.js [文件...] [--list] [--json]');
  console.log('  文件... 只检查指定脚本（可带 $N$ 前缀）；省略 = 全部 src/*.txt');
}

function literalParts(line) {
  // 返回行内所有字符串字面量（不含操作数），引用类（global-string/local-string/寄存器）不返回
  const parts = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(line))) {
    const s = m[1];
    if (s.trim().startsWith('(') || s.length === 0) continue; // 引用类 / 空串
    parts.push(s);
  }
  return parts;
}

function isTranslatedLine(line) {
  if (PAIR_RE.test(line)) return true; // 原文|译文 对
  if (AT_RE.test(line)) return true; // @"译文"
  return false;
}

function isPlaceholder(s) {
  return /^[？?　\s]+$/.test(s);
}

const KANA_RE = /[\u3040-\u30FF]/;
const CJK_RE = /[\u4E00-\u9FFF]/;

function classifyParts(parts) {
  if (parts.length === 0) return null;
  if (parts.every(isPlaceholder)) return { kind: 'placeholder' };
  if (parts.some((p) => KANA_RE.test(p))) return { kind: 'untranslated' };
  if (parts.some((p) => CJK_RE.test(p))) return { kind: 'same' };
  return { kind: 'symbol' };
}

function scanFile(name) {
  const p = path.join(SRC_DIR, `${name}.txt`);
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] 文件不存在: ${p}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(p, 'utf8').split(/\r\n|\r|\n/);
  const result = {
    file: name,
    untranslated: [], // { line, text, placeholder }
    translated: { pairs: 0, at: 0, pages: 0 },
    hasMarkers: false,
  };
  let inArchive = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.startsWith('/* 原文存档')) {
      inArchive = true;
      continue;
    }
    if (inArchive) {
      if (t === '*/') inArchive = false;
      continue;
    }
    if (t.startsWith('// 输入原文：')) {
      result.translated.pages++;
      result.hasMarkers = true;
      continue;
    }
    if (t === '// 页面结束' || t.startsWith('//')) continue;
    if (!TEXT_RE.test(t)) continue;

    if (t.includes('|') && /^(set-string|draw-string)\b/.test(t)) {
      result.translated.pairs++;
      result.hasMarkers = true;
      continue;
    }
    if (t.includes('@"')) {
      result.translated.at++;
      result.hasMarkers = true;
      continue;
    }
    const cls = classifyParts(literalParts(t));
    if (cls) {
      result.untranslated.push({ line: i + 1, text: t, kind: cls.kind });
    }
  }
  return result;
}

const argv = process.argv.slice(2);
const names = [];
let list = false;
let json = false;
for (const a of argv) {
  if (a === '--list') list = true;
  else if (a === '--json') json = true;
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else names.push(a.replace(/\.txt$/i, ''));
}

const targets = names.length
  ? names
  : fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();

const results = targets.map(scanFile);
const untranslatedFiles = results.filter((r) => !r.hasMarkers);
const translatedFiles = results.filter((r) => r.hasMarkers);

const output = {
  generated: new Date().toISOString(),
  total: results.length,
  files: results,
};

if (json) {
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

console.log(`=== 整体未翻译文件（${untranslatedFiles.length}，逐文件原文待译）===`);
console.log(untranslatedFiles.map((r) => r.file).join('、') || '（无）');

console.log(`\n=== 部分翻译文件（${translatedFiles.length} 个）===`);
const withLeftover = translatedFiles.filter((r) => r.untranslated.some((u) => u.kind === 'untranslated'));
if (withLeftover.length === 0) {
  console.log('（无含假名的未翻译残留）');
} else {
  for (const r of withLeftover) {
    const real = r.untranslated.filter((u) => u.kind === 'untranslated');
    console.log(`\n[${r.file}] 真实未翻译 ${real.length} 处`);
    for (const u of real) console.log(`  ${u.line}: ${u.text}`);
  }
}

const sameTotal = translatedFiles.reduce(
  (n, r) => n + r.untranslated.filter((u) => u.kind === 'same').length,
  0
);
const symbolTotal = translatedFiles.reduce(
  (n, r) => n + r.untranslated.filter((u) => u.kind === 'symbol').length,
  0
);
const placeholderTotal = translatedFiles.reduce(
  (n, r) => n + r.untranslated.filter((u) => u.kind === 'placeholder').length,
  0
);
console.log(`\n=== 同文/符号/占位候选（无需处理，${sameTotal + symbolTotal + placeholderTotal} 条）===`);
for (const r of translatedFiles) {
  const others = r.untranslated.filter((u) => u.kind !== 'untranslated');
  if (others.length) {
    console.log(`[${r.file}] ${others.length} 条`);
    for (const u of others) console.log(`  ${u.line}（${u.kind}）: ${u.text}`);
  }
}

console.log(`\n=== 已翻译文案统计（${translatedFiles.length} 个文件）===`);
let pSum = 0, aSum = 0, pgSum = 0;
for (const r of translatedFiles) {
  pSum += r.translated.pairs;
  aSum += r.translated.at;
  pgSum += r.translated.pages;
  console.log(
    `${r.file}: set-string 对 ${r.translated.pairs}、@"译文" 行 ${r.translated.at}、页块 ${r.translated.pages}`
  );
}
console.log(`合计: 对 ${pSum}、@"译文" 行 ${aSum}、页块 ${pgSum}`);

if (list) {
  console.log(`\n=== 已翻译文案明细（${translatedFiles.length} 个文件）===`);
  for (const r of translatedFiles) {
    console.log(`\n## ${r.file}`);
    const lines = fs.readFileSync(path.join(SRC_DIR, `${r.file}.txt`), 'utf8').split(/\r\n|\r|\n/);
    for (const l of lines) {
      const t = l.trim();
      if (/^(set-string|draw-string)\b.*"([^"]*\|[^"]*)"/.test(t)) console.log(`  ${t}`);
      else if (t.includes('@"')) console.log(`  ${t}`);
      else if (t.startsWith('// 输入原文：')) console.log(`  ${t}`);
    }
  }
}

if (withLeftover.length > 0) {
  console.log(`\n[结论] ${withLeftover.length} 个部分翻译文件存在含假名的未翻译残留，需处理`);
  process.exit(2);
} else {
  console.log('\n[OK] 部分翻译文件无含假名的未翻译残留');
}
