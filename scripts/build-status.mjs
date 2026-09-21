#!/usr/bin/env node
/**
 * **当前状态页**（生成物）—— `docs-new/00-overview/status.md`。
 *
 *   node scripts/build-status.mjs
 *
 * 输入（全部是**真源**，本页不缓存任何可算的数）：
 *   - `analysis/opcode-gaps.json` + `src/` 语料 + `app/amayui-emulator/src/vm/handlers/`（缺口口径，实时算）
 *   - `analysis/engine-capabilities.json`（能力台账）
 *   - `analysis/scripts.json`（脚本台账）
 *   - `tickets/T-00NN/ticket.json`（工作项）
 *   - `analysis/journal.jsonl`（沿革：只取最后一条轮次标题，不展开）
 *
 * 为什么要有它：状态以前手写在 `handoff` 的暂停点里，**每次交接都要重抄一遍数字**，
 * 而手抄的数必然漂移（实测：测试条数在 4 份文档里各写一遍，4 处全是错的）。
 * 现在状态是**算出来的**；"测试条数"这类只能跑出来的数**故意不写**（去 `npm run verify` 看）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs-new', '00-overview', 'status.md');
const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };
const STA = { doing: 0, blocked: 1, open: 2 };

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

export async function buildStatus(root = ROOT) {
  const { buildGapReport } = await import(pathToFileURL(path.join(root, 'scripts/build-opcode-gaps.mjs')).href);
  const gap = buildGapReport(root).report;
  const caps = readJson('analysis/engine-capabilities.json');
  const scripts = readJson('analysis/scripts.json');
  const journal = fs.readFileSync(path.join(root, 'analysis/journal.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tickets = fs.readdirSync(path.join(root, 'tickets'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^T-\d{4}$/.test(e.name))
    .map((e) => JSON.parse(fs.readFileSync(path.join(root, 'tickets', e.name, 'ticket.json'), 'utf8')));
  return { gap, caps, scripts, journal, tickets };
}

const count = (arr, f) => arr.reduce((m, x) => (m[f(x)] = (m[f(x)] ?? 0) + 1, m), {});

export function renderStatus(s) {
  const L = [];
  L.push('---', 'kind: generated', 'state: live', 'home: analysis/*.json + tickets/*/ticket.json',
    'generated_by: scripts/build-status.mjs', '---', '');
  L.push('# 当前状态（生成物）');
  L.push('');
  L.push('> 由四份台账 + 票据 + 沿革实时算出：`node scripts/build-status.mjs`。**勿手改。**');
  L.push('> ★**本页故意不写"测试条数"这类只能跑出来的数** —— 跑 `cd app/amayui-emulator && npm run verify` 看。');
  L.push('> 手抄的数必然漂移（实测：同一个测试条数曾在 4 份文档里各写一遍，4 处全错）。');
  L.push('');

  // ① 台账
  const g = count(s.gap.entries, (e) => e.disposition);
  const c = count(s.caps.entries, (e) => e.emulator.status);
  const sc = count(s.scripts.entries, (e) => e.status);
  L.push('## 1. 四份台账');
  L.push('');
  L.push('| 台账 | 口径 | 复核命令 |');
  L.push('|---|---|---|');
  L.push(`| opcode 缺口 | 未实现 **${g.unimplemented ?? 0}**（语料 ${s.gap.corpusUnimplCalls} 次）· unjustified no-op **${g['engine-internal-unjustified'] ?? 0}** · 有据 no-op **${g['engine-internal'] ?? 0}** · 已实现 **${g.implemented ?? 0}** · deferred **${g.deferred ?? 0}** | \`node scripts/build-opcode-gaps.mjs --check\` |`);
  L.push(`| 引擎常态能力 | **${s.caps.entries.length}** 条：已核验 **${c['modeled-verified'] ?? 0}** / 已建模未核验 ${c['modeled-unverified'] ?? 0} / 部分 ${c.partial ?? 0} / 缺失 ${c.absent ?? 0} / n/a ${c['n/a-known'] ?? 0} | \`capabilities.js --root . --validate\` |`);
  L.push(`| 脚本台账 | **${s.scripts.entries.length}** 条：已分析 ${sc.analyzed ?? 0} / 部分 ${sc.partial ?? 0} / 仅登记 ${sc.stub ?? 0} | \`scripts.js --root . --validate\` |`);
  L.push(`| 票据 | **${s.tickets.length}** 张 | \`tickets.js --root . --validate\` |`);
  L.push('');
  L.push('**能力缺口（需要关注 = 非 n/a 且非已核验）**：');
  L.push('');
  const attention = s.caps.entries.filter((e) => e.emulator.status !== 'n/a-known' && e.emulator.status !== 'modeled-verified');
  const bySub = count(attention, (e) => e.subsystem);
  L.push(Object.entries(bySub).sort((a, b) => b[1] - a[1]).map(([k, v]) => `\`${k}\` ${v}`).join(' · ') + `（共 ${attention.length} 条）`);
  L.push('');
  L.push('> 详细条目：`capabilities.js --root .` / 单条全文 `capabilities.js --root . --show <id>`。');
  L.push('');

  // ② 票据
  const ts = count(s.tickets, (t) => t.status);
  L.push('## 2. 工作项');
  L.push('');
  L.push('状态：' + Object.entries(ts).sort().map(([k, v]) => `\`${k}\` **${v}**`).join(' · '));
  const open = s.tickets.filter((t) => t.status === 'doing' || t.status === 'blocked' || t.status === 'open');
  const prio = count(open, (t) => t.priority);
  L.push('');
  L.push('未完成按优先级：' + ['P0', 'P1', 'P2', 'P3'].map((p) => `\`${p}\` ${prio[p] ?? 0}`).join(' · '));
  L.push('');
  L.push('| P | 状态 | id | 域 | 标题 | 阻塞于 |');
  L.push('|---|---|---|---|---|---|');
  for (const t of open.sort((a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9)
    || (STA[a.status] ?? 9) - (STA[b.status] ?? 9) || a.id.localeCompare(b.id))) {
    const blocked = (t.blockedBy ?? []).join(' ') || '—';
    L.push(`| ${t.priority} | ${t.status} | [\`${t.id}\`](../../tickets/${t.id}/ticket.json) | \`${t.area}\` | ${String(t.title).replace(/\|/g, '\\|').slice(0, 70)} | ${blocked} |`);
  }
  L.push('');
  L.push('> 单票：`tickets.js --root . --show <ID>`；看板：`tickets/README.md`。');
  L.push('');

  // ③ 沿革
  const rounds = [...new Set(s.journal.filter((e) => e.round !== null).map((e) => e.round))].sort((a, b) => a - b);
  L.push('## 3. 沿革');
  L.push('');
  L.push(`\`analysis/journal.jsonl\`：**${s.journal.length}** 条 / 轮次 ${rounds.join(' ')}。`);
  L.push('');
  const last = s.journal[s.journal.length - 1];
  L.push(`最近一条：**${last.title}**（\`${last.source}\`，票 ${last.tickets.join(' ') || '—'}）`);
  L.push('');
  L.push('> `node scripts/journal.js --tail 5` / `--round N` / `--ticket T-xxxx` / `--lessons`。');
  L.push('> **沿革不在任何生成物里**（本页只引用最后一条的标题，不展开正文）。');
  L.push('');

  // ④ 下一步
  L.push('## 4. 下一步（从票据派生，不是手写）');
  L.push('');
  const next = open.filter((t) => t.status === 'doing').concat(open.filter((t) => t.status === 'open' && t.priority === 'P0'))
    .concat(open.filter((t) => t.status === 'open' && t.priority === 'P1'));
  if (!next.length) L.push('（无 doing / P0 / P1 未完成项）');
  for (const t of next) L.push(`- **\`${t.id}\`**（${t.priority}/${t.status}）${t.title}`);
  L.push('');
  L.push('> 开门前的会话级前置与纪律：\`docs-new/03-engine/handoff.md\` §1.0 / §2。');
  L.push('');
  return L.join('\n');
}

async function main() {
  const md = renderStatus(await buildStatus());
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== md) { console.error('✗ docs-new/00-overview/status.md 不是最新的（跑 node scripts/build-status.mjs）'); process.exit(1); }
    console.log('✓ status.md 是最新的');
    return;
  }
  fs.writeFileSync(OUT, md, 'utf8');
  console.log('[ok] docs-new/00-overview/status.md');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
