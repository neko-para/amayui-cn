/**
 * **票据看板渲染器** —— `tickets/<ID>/ticket.json`（真源）→ `tickets/README.md`（生成物）。
 *
 * 为什么只生成一个文件（而不是每张票一个 md）：**票据文件夹里已经全是手写文档**
 * （`notes.md`/`changes.md`/…）。若再往同一个文件夹里塞生成物，迟早有人手改它。
 * 所以：真源 = 每票一个 `ticket.json`；人可读的**索引**集中在一个 `README.md`；
 * 单票的可读视图用 `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --show <ID>`
 * （它会把 `ticket.json` + 该票所有过程文档列出来）。
 *
 * 用法（仓库根）：`node scripts/build-tickets.mjs`
 * 守卫：`app/amayui-emulator/test/ticket-ledger.test.ts`（核对本文件与真源同步）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const DIR = path.join(REPO, 'tickets');
const OUT = path.join(DIR, 'README.md');

const STATUS_MARK = { open: '⬜', doing: '🔜', blocked: '⛔', done: '✅', dropped: '🚫' };
const STATUS_ORDER = ['doing', 'blocked', 'open', 'done', 'dropped'];
const PRIO_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const KNOWN_DOCS = ['notes.md', 'changes.md', 'repro.md', 'design.md', 'evidence.md'];

/** 该票文件夹里的过程文档（排序：约定名在前）。 */
function docsOf(id) {
  const d = path.join(DIR, id);
  if (!fs.existsSync(d)) return { docs: [], evidence: 0 };
  const entries = fs.readdirSync(d, { withFileTypes: true });
  const docs = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort((a, b) => (KNOWN_DOCS.indexOf(a) + 1 || 99) - (KNOWN_DOCS.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const ev = entries.find((e) => e.isDirectory() && e.name === 'evidence');
  return { docs, evidence: ev ? fs.readdirSync(path.join(d, 'evidence')).length : 0 };
}

const tickets = [];
if (fs.existsSync(DIR)) {
  for (const e of fs.readdirSync(DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !/^T-\d{4}$/.test(e.name)) continue;
    const f = path.join(DIR, e.name, 'ticket.json');
    if (!fs.existsSync(f)) continue;
    try {
      tickets.push(JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch {
      /* 坏 JSON 由 tickets.js --validate 报；这里跳过，避免看板生成失败 */
    }
  }
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const clip = (s, n) => {
  const t = esc(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const L = [];
L.push('# 需求 / 缺陷单看板');
L.push('');
L.push('> **生成物**：由 `tickets/<ID>/ticket.json`（真源）渲染，`node scripts/build-tickets.mjs`。**勿手改本文件。**');
L.push('> 单票的可读视图：`node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --show <ID>`');
L.push('> （它会把 `ticket.json` 与该票**所有过程文档**一起列出来；过程文档在 `tickets/<ID>/` 里手写。）');
L.push('> 纪律与 schema：`docs-new/00-overview/tickets.md`；维护流程见 `amayui-ticket-ledger` 技能。');
L.push('');

const byStatus = new Map(STATUS_ORDER.map((s) => [s, []]));
for (const t of tickets) {
  if (!byStatus.has(t.status)) byStatus.set(t.status, []);
  byStatus.get(t.status).push(t);
}
for (const list of byStatus.values()) {
  list.sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9) || a.id.localeCompare(b.id));
}

const count = (s) => (byStatus.get(s) ?? []).length;
L.push('## 概览');
L.push('');
L.push(
  `共 **${tickets.length}** 张：` +
    STATUS_ORDER.map((s) => `${STATUS_MARK[s]} ${s} **${count(s)}**`).join(' · ') +
    `（P0 ${tickets.filter((t) => t.priority === 'P0').length} / P1 ${tickets.filter((t) => t.priority === 'P1').length}）`,
);
L.push('');
const areas = new Map();
for (const t of tickets) areas.set(t.area, (areas.get(t.area) ?? 0) + 1);
L.push(`按域：${[...areas.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `\`${esc(k)}\` ${v}`).join(' · ')}`);
L.push('');

for (const status of STATUS_ORDER) {
  const list = byStatus.get(status) ?? [];
  if (list.length === 0) continue;
  L.push(`## ${STATUS_MARK[status]} ${status}（${list.length}）`);
  L.push('');
  L.push('| id | P | 类型 | 域 | 标题 | 判据 | 守卫 | 过程文档 | 阻塞于 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const t of list) {
    const d = docsOf(t.id);
    const acc = Array.isArray(t.acceptance) ? t.acceptance.length : 0;
    const tests = Array.isArray(t.tests) && t.tests.length ? t.tests.map((s) => `\`${esc(s)}\``).join(' ') : '—';
    const docCell = d.docs.length || d.evidence
      ? [d.docs.map((s) => `\`${s}\``).join(' '), d.evidence ? `evidence/(${d.evidence})` : ''].filter(Boolean).join(' ')
      : '—';
    const blocked = Array.isArray(t.blockedBy) && t.blockedBy.length ? t.blockedBy.join(' ') : '—';
    L.push(
      `| [\`${t.id}\`](./${t.id}/ticket.json) | ${t.priority} | ${t.type} | \`${esc(t.area)}\` | ${clip(t.title, 80)} | ${acc} | ${tests} | ${docCell} | ${blocked} |`,
    );
  }
  L.push('');
}

L.push('## 怎么用（30 秒）');
L.push('');
L.push('```bash');
L.push('node .agents/skills/amayui-ticket-ledger/scripts/tickets.js                 # 统计 + 待办清单');
L.push('node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --list --open   # 只看未完成');
L.push('node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --show T-0001   # 单票（含过程文档清单）');
L.push('node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --add \'{"title":"…","type":"bug","area":"…","why":"…","acceptance":["…"]}\'');
L.push('node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --set-status T-0001 doing --note "开工"');
L.push('node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --note T-0001 --file changes.md --text "第 1 次变更：…"');
L.push('node scripts/build-tickets.mjs                                              # 刷新本页');
L.push('node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate      # 自检（锚点棘轮 / done 必须带守卫）');
L.push('```');
L.push('');
L.push('> 改完票据要重跑 `build-tickets.mjs`，否则 `test/ticket-ledger.test.ts` 会红（与 `analysis/*.json` 的台账同一纪律）。');
L.push('');

fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`[ok] tickets/README.md ← ${tickets.length} 张票（${STATUS_ORDER.map((s) => `${s} ${count(s)}`).join(' / ')}）`);
