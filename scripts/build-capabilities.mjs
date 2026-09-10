#!/usr/bin/env node
/**
 * 由数据层渲染「引擎常态能力台账」的人可读 Markdown。
 *
 *   node scripts/build-capabilities.mjs
 *
 * - 数据源（唯一增长处）：`analysis/engine-capabilities.json`
 * - 输出：`docs-new/03-engine/engine-capabilities.md`
 *
 * 为什么要有这份台账：引擎里有一层能力**无法靠枚举 opcode 发现** —— 逐帧流程、门控标志、惰性创建、
 * 转场、资源生命周期。它们缺失时**不会报错、只会表现不对**（典型：版权页文字不淡入，查了很久才发现
 * 缺的是逐帧颜色插值）。台账把这类能力变成可核对清单，症状出现时先查它，避免每次从零研究。
 *
 * 条目来源：四组机械枚举（帧入口 / 时钟读者 / 门与标志读者 / 惰性创建），每条带 raw 行号；
 * `emulator` 块是对本重写工程现状的判定（`test/capability-ledger.test.ts` 会校验 schema 与 guard 有效性）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = path.join(ROOT, 'analysis', 'engine-capabilities.json');
const MD_PATH = path.join(ROOT, 'docs-new', '03-engine', 'engine-capabilities.md');

const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const entries = doc.entries;
const by = (s) => entries.filter((e) => e.emulator.status === s).length;

const MARK = {
  'modeled-verified': '✅ 已核验',
  'modeled-unverified': '🟡 已建模未核验',
  partial: '🟠 部分',
  absent: '❌ 缺失',
  'n/a-known': '➖ n/a',
};

const L = [];
L.push('# 引擎「常态能力」台账（第二层）');
L.push('');
L.push('> 由 `analysis/engine-capabilities.json` 生成：`node scripts/build-capabilities.mjs`。');
L.push('> 这些能力**无法靠枚举 opcode 发现**：它们是引擎自己的逐帧流程与各子系统的持续行为，');
L.push('> 缺失时**不会报错、只会表现不对**（例如版权页文字不淡入 ⇒ 才发现缺了逐帧颜色插值）。');
L.push('> 因此单列一张可核对清单 —— **出现症状时先查这里**，避免每次从零研究。');
L.push('>');
L.push('> `emulator` 列的判定口径见下；`E0–E4` 是证据等级（E0 未读体 / E1 已读体 / E2 合成单测 / E3 场景断言 / E4 真机对照）。');
L.push('');
L.push('## 统计');
L.push('');
L.push('| 状态 | 条数 | 含义 |');
L.push('|---|---|---|');
for (const [k, v] of Object.entries(doc.statusEnum)) L.push(`| \`${k}\` | ${by(k)} | ${v} |`);
L.push(`| **合计** | **${entries.length}** | 需要关注（非 n/a 且非已核验）= **${doc.counts.needsAttention}** |`);
L.push('');
L.push('## 按子系统');
L.push('');
L.push('| 子系统 | 条数 | 其中 缺失/部分 |');
L.push('|---|---|---|');
for (const s of [...new Set(entries.map((e) => e.subsystem))].sort()) {
  const list = entries.filter((e) => e.subsystem === s);
  const bad = list.filter((e) => e.emulator.status === 'absent' || e.emulator.status === 'partial').length;
  L.push(`| ${s} | ${list.length} | ${bad} |`);
}
L.push('');
L.push('## 全部条目');
L.push('');
L.push('| id | 子系统 | 能力 | emulator | 依据 / 守卫 |');
L.push('|---|---|---|---|---|');
for (const e of entries) {
  const ev = e.emulator.guard ? `${e.emulator.evidence} · \`${e.emulator.guard}\`` : e.emulator.evidence;
  L.push(`| \`${e.id}\` | ${e.subsystem} | ${e.name} | ${MARK[e.emulator.status]} | ${ev} |`);
}
L.push('');
L.push('## 缺口明细（`absent` / `partial`）');
L.push('');
for (const e of entries.filter((x) => x.emulator.status === 'absent' || x.emulator.status === 'partial')) {
  L.push(`### \`${e.id}\`（${e.emulator.status}）`);
  L.push('');
  L.push(`- **能力**：${e.name}`);
  L.push(`- **触发**：${e.trigger}`);
  L.push(`- **缺失时为什么静默**：${e.whySilent}`);
  L.push(`- **引擎**：${e.engine.fns.join(', ')} @ raw ${e.engine.raw}`);
  if (e.reads.length) L.push(`- **读的字段**：${e.reads.join(', ')}`);
  L.push(`- **emulator 现状**：${e.emulator.note}`);
  L.push('');
}

fs.mkdirSync(path.dirname(MD_PATH), { recursive: true });
fs.writeFileSync(MD_PATH, L.join('\n'));
console.log(`[ok] ${path.relative(ROOT, MD_PATH)} ← ${path.relative(ROOT, JSON_PATH)}（${entries.length} 条）`);
console.log(
  `     已核验 ${by('modeled-verified')} / 已建模未核验 ${by('modeled-unverified')} / 部分 ${by('partial')} / 缺失 ${by('absent')} / n/a ${by('n/a-known')}`,
);
