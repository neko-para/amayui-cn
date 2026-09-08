#!/usr/bin/env node
// 字段排序器：读 analysis/fields.json → 按 (scope, 字节偏移) 排序 → 写回。
// 纯数据操作；不解析/改写反编译文本（与 report.js 同属数据层工具）。
// 用法：node sort-fields.js [root]   （root 缺省 '.' 即工程根）
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
const FILE = path.join(root, 'analysis', 'fields.json');

// scope 分组顺序（决定跨作用域的先后）；组内按字节偏移升序。
const SCOPE_ORDER = ['Engine', 'ScriptContext', 'global'];

function parseOffset(o) {
  // offset 为 16 进制字节偏移（"0x5D880" / "0x34"）；个别缺省值按 0 处理。
  const n = parseInt(o, 16);
  return Number.isFinite(n) ? n : 0;
}

function sortKey(f) {
  const s = SCOPE_ORDER.indexOf(f.scope);
  return { scope: s === -1 ? 99 : s, offset: parseOffset(f.offset) };
}

function formatEntries(entries) {
  // 每字段一行（与现有风格一致），作用域切换时插入空行分组。
  const lines = [];
  let prevScope = null;
  entries.forEach((f, i) => {
    if (prevScope !== null && f.scope !== prevScope) lines.push('');
    lines.push('  ' + JSON.stringify(f) + (i === entries.length - 1 ? '' : ','));
    prevScope = f.scope;
  });
  return lines.join('\n');
}

let fields;
try {
  fields = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`[error] 读取 ${FILE} 失败: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(fields)) {
  console.error(`[error] ${FILE} 期望为数组`);
  process.exit(1);
}

const sorted = fields.slice().sort((a, b) => {
  const ka = sortKey(a);
  const kb = sortKey(b);
  return ka.scope - kb.scope || ka.offset - kb.offset;
});

const out = '[\n' + formatEntries(sorted) + '\n]\n';
fs.writeFileSync(FILE, out);

// 汇总
const byScope = {};
for (const f of sorted) byScope[f.scope] = (byScope[f.scope] || 0) + 1;
console.log(`fields.json 已排序：${sorted.length} 条字段`);
console.log('  按作用域: ' + Object.entries(byScope).map(([k, v]) => `${k}=${v}`).join(', '));
console.log('  首条: ' + sorted[0].scope + ' ' + sorted[0].offset + ' ' + sorted[0].name);
console.log('  末条: ' + sorted[sorted.length - 1].scope + ' ' + sorted[sorted.length - 1].offset + ' ' + sorted[sorted.length - 1].name);
