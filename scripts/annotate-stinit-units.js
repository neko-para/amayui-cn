#!/usr/bin/env node
/**
 * annotate-stinit-units.js
 * 识别 STINIT 每个单位槽的单位 id，并在单位 id 行尾追加 `// <单位名>`。
 *
 * 结构（逆向确认）：
 *   - 每个“单位槽”由 4 条连续指令组成：单位 id（register 14dd<0x40+i>）、
 *     率（+0x1E）、率2（+0x3C）、数量（+0x5A）。单位 id 寄存器随 i 递增（连续）。
 *   - `copy-local-array (global-int 14dXXX)` 是稀疏锚点；其“向前第 4 行”是某个单位 id。
 *   - 单位名：`src/*EBINIT.txt` 中 `set-string (global-string <addr>) "日文|中文"`，
 *     其中 addr = 0x17ab6 + unitId。
 *   - ⚠️ 仅凭“值解析成功”不可靠（率/数量字段值也会命中名字）；须以 copy-local-array
 *     为种子，在同一块内按“连续单位 id 寄存器(偏差 1) + 解析成功”上下扩展。
 *
 * 用法: node scripts/annotate-stinit-units.js [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './config.js';

const UNIT_BASE = 0x17ab6;                                 // 单位名表基址：addr = UNIT_BASE + unitId
const COPY_RE = /copy-local-array \(global-int 14d[0-9a-f]{3}\)/; // 锚点：匹配所有 14dXXX
const MOV_RE = /^\s*mov \(global-int (14dd[0-9a-f]{2})\) ([0-9a-f]+)/; // 单位 id 候选行
const WINDOW = 140;                                        // 上下扩展的最大行数（覆盖一个遭遇块）
const NAME_RE = /set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/;

// 1) 收集所有 EBINIT 的单位名表：addr(数字) → "日文|中文"
const nameByAddr = new Map();
for (const f of fs.readdirSync(SRC_DIR).filter((x) => /ebinit\.txt$/i.test(x)).sort()) {
  const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = line.match(NAME_RE);
    if (!m) continue;
    const addr = parseInt(m[1], 16);
    if (!nameByAddr.has(addr)) nameByAddr.set(addr, m[2]);
  }
}

function nameFor(unitIdHex) {
  const addr = UNIT_BASE + parseInt(unitIdHex, 16);
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
let shown = 0;

for (const file of targets) {
  const p = path.join(SRC_DIR, file);
  const text = fs.readFileSync(p, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\r|\n/);

  // 候选单位 id 行：loc[i] = { regLo, value, resolve, line }
  const cand = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MOV_RE);
    if (!m) continue;
    const regLo = parseInt(m[1].slice(2), 16);
    cand.set(i, { regLo, value: m[2], resolve: !!nameFor(m[2]), line: lines[i] });
  }

  // 种子：copy-local-array 的“向前第 4 行”且解析成功
  const seeds = [];
  for (let i = 0; i < lines.length; i++) {
    if (!COPY_RE.test(lines[i])) continue;
    if (i < 4) continue;
    const c = cand.get(i - 4);
    if (c && c.resolve) seeds.push({ idx: i - 4, regLo: c.regLo });
  }
  if (seeds.length === 0) { if (dryRun) console.log(`[dry] ${file}: 无单位`); continue; }

  // 扩展：同一块内“连续单位 id 寄存器(±1) + 解析成功”，上下各扩 WINDOW 行
  const annotateIdx = new Set();
  for (const s of seeds) {
    annotateIdx.add(s.idx);
    // 向下（register 递增）
    let exp = s.regLo;
    for (let j = s.idx + 1; j < lines.length && j <= s.idx + WINDOW; j++) {
      const c = cand.get(j);
      if (!c) continue;
      if (c.regLo === exp + 1 && c.resolve) { annotateIdx.add(j); exp = c.regLo; }
    }
    // 向上（register 递减）
    exp = s.regLo;
    for (let j = s.idx - 1; j >= 0 && j >= s.idx - WINDOW; j--) {
      const c = cand.get(j);
      if (!c) continue;
      if (c.regLo === exp - 1 && c.resolve) { annotateIdx.add(j); exp = c.regLo; }
    }
  }

  if (annotateIdx.size === 0) { if (dryRun) console.log(`[dry] ${file}: 0 处`); continue; }

  const patch = new Map();
  for (const i of annotateIdx) {
    if (lines[i].includes('//')) continue; // 已标注
    const name = nameFor(cand.get(i).value);
    if (!name) continue;
    patch.set(i, `${lines[i]}  // ${name}`);
    total++;
    if (dryRun && shown < 40) { console.log(`  [${file}:${i + 1}] ${lines[i]}  →  ${patch.get(i)}`); shown++; }
  }

  if (dryRun) console.log(`[dry] ${file}: 将标注 ${patch.size} 处单位`);
  else if (patch.size) { fs.writeFileSync(p, lines.map((l, i) => patch.get(i) ?? l).join(eol), 'utf8'); console.log(`[updated] ${file}`); }
}

console.log(`\n${dryRun ? '[dry-run] 将标注' : '已标注'} ${total} 处单位；涉及 ${targets.length} 个 STINIT 文件`);
