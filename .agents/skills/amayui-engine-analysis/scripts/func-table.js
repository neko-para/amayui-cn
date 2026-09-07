#!/usr/bin/env node
/** 把"函数列表"（func-list.js 结构）× "分析台账"(analysis-registry.json) 合成汇总表。
 *  用法：node func-table.js <engine_file> <registry.json>
 *  输出：函数总数、台账已登记数、已改名数、按状态分布、缺证据提示。
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const engine = process.argv[2];
const registryPath = process.argv[3];
if (!engine || !registryPath) {
  console.error('usage: node func-table.js <engine_file> <registry.json>');
  process.exit(1);
}

// 用 func-list.js 解析函数列表
const dir = path.dirname(__filename);
const listOut = execFileSync(process.execPath, [path.join(dir, 'func-list.js'), engine], { encoding: 'utf8' });
const funcs = listOut.trim().split(/\r?\n/).filter(Boolean).map((l) => {
  const [start, end, name] = l.split(/\t/);
  return { start: +start, end: +end, name };
});

let registry = { funcs: [] };
try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch (e) { registry = { funcs: [] }; }
const byOld = new Map(registry.funcs.map((f) => [f.old, f]));

const total = funcs.length;
let registered = 0, renamed = 0, withEvidence = 0;
const statusCount = { ANALYZED: 0, PARTIAL: 0, STUB: 0, UNKNOWN: 0 };

for (const f of funcs) {
  const r = byOld.get(f.name);
  if (!r) continue;
  registered++;
  if (r.new && r.new !== f.name) renamed++;
  if (r.evidence) withEvidence++;
  statusCount[r.status] = (statusCount[r.status] || 0) + 1;
}

console.log(`# 引擎函数：${total}`);
console.log(`# 台账已登记：${registered}（${((registered / total) * 100).toFixed(1)}%）`);
console.log(`# 已改名（sub_*→语义名）：${renamed}`);
console.log(`# 带证据：${withEvidence}`);
console.log('\n# 台账状态分布');
for (const [s, c] of Object.entries(statusCount)) if (c) console.log(`  ${s}\t${c}`);

// 缺证据的已登记条目提示
const noEv = registry.funcs.filter((f) => !f.evidence);
if (noEv.length) {
  console.log(`\n# ⚠️ 已登记但缺证据的条目（${noEv.length}）`);
  for (const f of noEv) console.log(`  ${f.old} -> ${f.new || ''} (${f.status})`);
}
