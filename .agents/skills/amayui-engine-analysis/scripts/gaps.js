#!/usr/bin/env node
/**
 * **opcode 缺口台账**（`analysis/opcode-gaps.json`）的查询工具。
 *
 *   node .agents/skills/amayui-engine-analysis/scripts/gaps.js                # 统计 + 处置分布
 *   node .agents/skills/amayui-engine-analysis/scripts/gaps.js --list         # 全部条目一行一条
 *   node .agents/skills/amayui-engine-analysis/scripts/gaps.js --show 0x140   # 某条的**全文**（体证 + 沿革 + 扩展点）
 *   node .agents/skills/amayui-engine-analysis/scripts/gaps.js --ticket T-0093
 *   node .agents/skills/amayui-engine-analysis/scripts/gaps.js --disposition deferred
 *   node .agents/skills/amayui-engine-analysis/scripts/gaps.js --search 转场
 *
 * 为什么要有它：生成物 `docs-new/03-engine/opcode-gaps.md` 的每格只给**一句话**
 * （从 `note` 裁到 120 字）—— 完整的体证叙事与逐轮沿革（71 条 ≈ 80 KB）留在真源 JSON 里。
 * 本工具就是"一句话 → 全文"的那条命令。**它只读；写入走 `scripts/build-opcode-gaps.mjs` 的纪律。**
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FILE = path.join(ROOT, 'analysis', 'opcode-gaps.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const all = doc.entries;
const hex = (n) => `0x${n.toString(16)}`;

let list = all;
if (has('--disposition')) list = list.filter((e) => e.disposition === val('--disposition'));
if (has('--ticket')) list = list.filter((e) => (e.ticket ?? '') === val('--ticket'));
if (has('--search')) list = list.filter((e) => JSON.stringify(e).includes(val('--search')));

if (has('--show')) {
  const q = val('--show').toLowerCase();
  const want = q.startsWith('0x') ? parseInt(q, 16) : Number(q);
  const e = all.find((x) => x.opcode === want || x.mnemonic === val('--show'));
  if (!e) { console.error(`✗ 找不到 ${val('--show')}`); process.exit(1); }
  console.log(`### ${hex(e.opcode)}  ${e.mnemonic}${e.name ? ' ' + e.name : ''}`);
  console.log(`处置 **${e.disposition}**${e.ticket ? ` · 票 ${e.ticket}` : ''} · argc ${e.argc ?? '?'} · 文档状态 ${e.docStatus || '?'}`);
  console.log(`handler \`${e.handler || '?'}\`（体起始 raw ${e.handlerBodyLine ?? '?'}）\n`);
  console.log(e.note);
  process.exit(0);
}

if (has('--list')) {
  for (const e of list) {
    const s = String(e.note ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ');
    console.log(`${hex(e.opcode).padEnd(6)} ${(e.mnemonic || '').padEnd(9)} ${e.disposition.padEnd(16)} ${(e.ticket || '—').padEnd(7)} ${s.slice(0, 90)}`);
  }
  process.exit(0);
}

const by = {};
for (const e of all) by[e.disposition] = (by[e.disposition] ?? 0) + 1;
console.log(`opcode 缺口台账：${all.length} 条 / ${(fs.statSync(FILE).size / 1024).toFixed(1)} KB`);
console.log('处置：' + Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' / '));
console.log(`note 合计：${all.reduce((a, e) => a + (e.note ?? '').length, 0)} 字（★只在 JSON 里；md 只渲染裁到 120 字的一句话）`);
console.log('\n（--list / --show <opcode|mnemonic> / --disposition <d> / --ticket T-xxxx / --search <串>）');
