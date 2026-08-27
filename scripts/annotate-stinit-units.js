#!/usr/bin/env node
/**
 * annotate-stinit-units.js
 * 识别 STINIT 每个单位槽的单位 id，并在单位 id 行尾追加 `// <单位名>`。
 *
 * 方法（用户确认）：
 *   - **每个关卡的单位都从 `mov (global-int 14dd41)` 开始放置**；单位 id 寄存器落在
 *     **闭区间 `0x41..0x5d`**。部分遭遇的寄存器可能**不连续**（跳号），故**直接按区间标注**：
 *     所有 `mov (global-int 14ddXX)`（XX ∈ [0x41,0x5d]）且 `0x17ab6+unitId` 可解析者，即单位。
 *   - 上界 `0x5d` 恰好排除**伴随/率/等级字段**（单位 0x41 的 +0x1E 伴随在 0x5f，落入 `0x5e..0x7b`，
 *     其小值也可能命中名字，是误标源）。因此区间外（<0x41 计数器，或 >0x5d 伴随）一律不标。
 *   - 单位名：`src/*EBINIT.txt` 的 `set-string (global-string <addr>) "日文|中文"`，
 *     addr = 0x17ab6 + unitId。
 *
 * 用法: node scripts/annotate-stinit-units.js [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './config.js';

const UNIT_BASE = 0x17ab6;
const LO = 0x41, HI = 0x5d; // 单位 id 寄存器闭区间
const MOV_RE = /^\s*mov \(global-int (14dd[0-9a-f]{2})\) ([0-9a-f]+)/;
const NAME_RE = /set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/;

// 1) EBINIT 名表：addr → "日文|中文"
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
function resolve(idHex) { return nameByAddr.has(UNIT_BASE + parseInt(idHex, 16)); }
function nameFor(idHex) {
  const raw = nameByAddr.get(UNIT_BASE + parseInt(idHex, 16));
  if (raw == null) return null;
  const i = raw.indexOf('|');
  const jp = i < 0 ? raw : raw.slice(0, i);
  const zh = i < 0 ? '' : raw.slice(i + 1);
  return zh && zh !== jp ? `${jp} ${zh}` : jp;
}

const dryRun = process.argv.includes('--dry-run');
const targets = fs.readdirSync(SRC_DIR).filter((x) => /stinit\.txt$/i.test(x)).sort();

let found = 0;
let cleaned = 0;

for (const file of targets) {
  const p = path.join(SRC_DIR, file);
  const text = fs.readFileSync(p, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\r|\n/);
  const patch = new Map();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MOV_RE);
    if (!m) continue;
    const r = parseInt(m[1].slice(4), 16);
    if (r >= LO && r <= HI) {
      const name = nameFor(m[2]);
      if (!name) continue;
      const stripped = lines[i].replace(/\s*\/\/.*$/, '').trimEnd();
      const annotated = `${stripped}  // ${name}`;
      if (annotated !== lines[i]) { patch.set(i, annotated); found++; }
    } else if (/\/\/\s/.test(lines[i])) {
      // 区间外却带单位注释 → 清理（计数器 <0x41、伴随 >0x5d 等误标源）
      patch.set(i, lines[i].replace(/\s*\/\/.*$/, '').trimEnd());
      cleaned++;
    }
  }

  if (patch.size === 0) { if (dryRun) console.log(`[dry] ${file}: 无`); continue; }
  if (dryRun) console.log(`[dry] ${file}: 补标/清理 ${patch.size} 行`);
  else { fs.writeFileSync(p, lines.map((l, i) => patch.get(i) ?? l).join(eol), 'utf8'); console.log(`[updated] ${file}`); }
}

console.log(`\n${dryRun ? '[dry-run]' : '已标注'} 单位总数 ${found}；清理区间外误标 ${cleaned} 行；涉及 ${targets.length} 个文件`);
