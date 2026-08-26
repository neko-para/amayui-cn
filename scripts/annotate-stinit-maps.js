#!/usr/bin/env node
/**
 * annotate-stinit-maps.js
 * 识别 STINIT 中所有 `eq (local-int 0) (global-int b222) <mapNo>` 行，
 * 在该行尾追加 `// <关卡名>` 注释，便于分析每个关卡的单位构成。
 *
 * 关卡名：`src/*STINIT2.txt` 中 `set-string (global-string <addr>) "日文|中文"`，
 *         其中 addr = 0x121e3 + mapNo（mapNo 为 eq 第三个参数，hex）。
 *
 * 用法: node scripts/annotate-stinit-maps.js [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './config.js';

const NAME_BASE = 0x121e2; // 关卡名表基址：addr = NAME_BASE + mapNo（mapNo 为 eq 第三个参数，hex）
// 匹配 `eq (local-int 0) (global-int b222) <mapNo>`（允许行首空白；mapNo 为 hex，独立 token）
const EQ_RE = /^\s*eq \(local-int 0\) \(global-int b222\) ([0-9a-f]+)(\s|$)/;
const NAME_RE = /set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/;

// 1) 收集所有 STINIT2 的关卡名表：addr(数字) → "日文|中文"
const nameByAddr = new Map();
for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
  const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = line.match(NAME_RE);
    if (!m) continue;
    const addr = parseInt(m[1], 16);
    if (!nameByAddr.has(addr)) nameByAddr.set(addr, m[2]); // 保留首次
  }
}

// 2) 反查 mapNo → 关卡名（返回 "日文 中文" 或仅 "日文"）
function nameFor(mapNoHex) {
  const addr = NAME_BASE + parseInt(mapNoHex, 16);
  const raw = nameByAddr.get(addr);
  if (raw == null) return null;
  const i = raw.indexOf('|');
  const jp = i < 0 ? raw : raw.slice(0, i);
  const zh = i < 0 ? '' : raw.slice(i + 1);
  return zh && zh !== jp ? `${jp} ${zh}` : jp;
}

const dryRun = process.argv.includes('--dry-run');
const targets = fs.readdirSync(SRC_DIR).filter((x) => /stinit\.txt$/i.test(x)).sort();

let total = 0;
let missing = 0;
let fileCount = 0;
let shown = 0;

for (const file of targets) {
  const p = path.join(SRC_DIR, file);
  const text = fs.readFileSync(p, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\r|\n/);
  let changed = false;
  const fn = file.replace(/^.*[\\/]/, '');

  const out = lines.map((line, idx) => {
    const m = line.match(EQ_RE);
    if (!m) return line;
    const name = nameFor(m[1]);
    // 去除旧的行尾注释再追加（保证基址更正后可重做、幂等）
    const stripped = line.replace(/\s*\/\/.*$/, '').trimEnd();
    if (name == null) { missing++; return stripped; } // 不再命中 → 退回无注释
    total++;
    const annotated = `${stripped}  // ${name}`;
    if (annotated !== line) changed = true;
    if (dryRun && annotated !== line && shown < 40) { console.log(`  [${fn}:${idx + 1}] ${stripped}  →  ${annotated}`); shown++; }
    return annotated;
  });

  if (lines.some((l) => EQ_RE.test(l))) fileCount++;

  if (dryRun) {
    console.log(`[dry] ${fn}: ${lines.filter((l) => EQ_RE.test(l)).length} 处 b222 行`);
  } else if (changed) {
    fs.writeFileSync(p, out.join(eol), 'utf8');
    console.log(`[updated] ${fn}`);
  }
}

console.log(`\n${dryRun ? '[dry-run] 将标注' : '已标注'} ${total} 处；缺关名名 ${missing} 处；涉及 ${fileCount} 个 STINIT 文件`);
