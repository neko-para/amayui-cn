#!/usr/bin/env node
/** 扫描"精修副本"里的函数状态标记，按状态统计并列出，回答"哪些分析过/哪些未知"。
 *  标记约定（见 SKILL.md）：函数头部注释块含 `状态: ANALYZED|PARTIAL|STUB|UNKNOWN`。
 *  用法：node scan-status.js <refined_file>
 */
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node scan-status.js <refined_file>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const counts = { ANALYZED: 0, PARTIAL: 0, STUB: 0, UNKNOWN: 0 };
const rows = [];

lines.forEach((l, i) => {
  const m = /状态:\s*(ANALYZED|PARTIAL|STUB|UNKNOWN)/.exec(l);
  if (!m) return;
  counts[m[1]]++;
  // 尽量找到该标记下方的函数名（下一行或下下行常见 `__thiscall NAME(` 或注释里的 →）
  let name = '?';
  for (let k = i + 1; k < Math.min(i + 6, lines.length); k++) {
    const nm = /→\s*([A-Za-z_][A-Za-z0-9_]*)|__\w+ ([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(lines[k]);
    if (nm) { name = nm[1] || nm[2]; break; }
  }
  rows.push({ line: i + 1, status: m[1], name });
});

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`# 状态统计（共 ${total} 个已标记函数）`);
for (const [s, c] of Object.entries(counts)) console.log(`  ${s}\t${c}`);
console.log('\n# 已标记函数明细（行号 状态 函数名）');
for (const r of [...rows].sort((a, b) => b.status === 'ANALYZED' ? -1 : 0)) {
  console.log(`  ${String(r.line).padStart(6)}\t${r.status.padEnd(8)}\t${r.name}`);
}
