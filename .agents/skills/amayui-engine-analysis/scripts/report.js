#!/usr/bin/env node
// 报表生成器：读 analysis/fields.json + analysis/functions.json → 打印分析进度/字段清单。
// 纯数据读取，不解析/改写反编译文本（规避 libclang 类脆弱方案）。
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
const FIELDS = path.join(root, 'analysis', 'fields.json');
const FUNCS = path.join(root, 'analysis', 'functions.json');

function load(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.warn(`[warn] 读取 ${p} 失败: ${e.message}`); return fallback; }
}

const fields = load(FIELDS, []);
const funcs = load(FUNCS, []);

// 字段统计
const byScope = {};
const byStatus = {};
for (const f of fields) {
  byScope[f.scope] = (byScope[f.scope] || 0) + 1;
  byStatus[f.status] = (byStatus[f.status] || 0) + 1;
}
console.log('# 字段/偏移模型');
console.log(`  共 ${fields.length} 条字段`);
console.log('  按作用域: ' + Object.entries(byScope).map(([k, v]) => `${k}=${v}`).join(', '));
console.log('  按状态:   ' + Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', '));

// 函数状态
const fStat = {};
const byOp = {};
for (const fn of funcs) {
  fStat[fn.status] = (fStat[fn.status] || 0) + 1;
  if (fn.op) byOp[fn.op] = (byOp[fn.op] || 0) + 1;
}
console.log('\n# 函数结论');
console.log(`  共 ${funcs.length} 个函数已建档`);
console.log('  按状态: ' + Object.entries(fStat).map(([k, v]) => `${k}=${v}`).join(', '));
if (Object.keys(byOp).length) console.log('  按 opcode: ' + Object.entries(byOp).map(([k, v]) => `${k}=${v}`).join(', '));

console.log('\n# 函数清单');
for (const fn of funcs) {
  const un = (fn.unmodeled && fn.unmodeled.length) ? `  [未建模 ${fn.unmodeled.length} 项]` : '';
  console.log(`  ${fn.addr}  ${fn.raw_name || '?'}  → ${fn.semantic_name || '?'}  (${fn.status})${un}`);
  if (fn.purpose) console.log(`        ${fn.purpose}`);
}

console.log('\n# 字段清单（offset → name）');
for (const f of fields) {
  const t = f.status === 'confirmed' ? '' : '  (待确认)';
  console.log(`  ${f.scope.padEnd(14)} ${f.offset.padEnd(9)} ${f.name.padEnd(22)} ${f.type}${t}`);
}

console.log('\n[HINT] 分析函数：先查 fields.json 解码偏移 → 读 raw → 更新 fields.json/functions.json（只在一处增长）。');
