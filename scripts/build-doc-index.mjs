#!/usr/bin/env node
/**
 * **文档索引**（生成物）—— `docs-new/**\/*.md` 的 front-matter 投影。
 *
 *   node scripts/build-doc-index.mjs
 *
 * 输出：`docs-new/00-overview/index.md`
 *
 * 为什么要有它：`docs-new/` 里有 96 份 md，分五类（真源 / 生成物 / 机制叙述 / 流程 / 历史记录）。
 * 没有索引时"这份文档现在还算数吗"只能靠正文里的散文（"勿手改"、"一次性"）判断 ——
 * 实测代价：`README.md` 长期把一份**过期快照**（`stub-reaudit-2026-09.md` §4）当卖点。
 * 现在 `kind`/`state` 是机器可读的，本索引把它们渲染成人能扫的一屏。
 *
 * 守卫：`app/amayui-emulator/test/doc-model.test.ts`（本文件必须是最新的）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs-new');
const OUT = path.join(DOCS, '00-overview', 'index.md');

const KIND_MARK = {
  source: '📌 真源',
  generated: '⚙️ 生成物',
  narrative: '📖 叙述',
  procedure: '📋 流程',
  index: '🧭 索引',
  session: '🔁 会话',
  record: '🗄 历史记录',
};
const STATE_MARK = { live: '✅', consumed: '📤 已消费', superseded: '⤵ 已取代' };
export const KINDS = Object.keys(KIND_MARK);
export const STATES = Object.keys(STATE_MARK);

/** 解析 front-matter（极简 YAML：`key: value`，值不做类型推断）。 */
export function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return { fm: null, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { fm: null, body: text };
  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body: text.slice(end + 5) };
}

/** 扫全部 md 并解析头部。 */
export function scanDocs(dir = DOCS) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.md')) {
        const rel = path.relative(DOCS, q).split(path.sep).join('/');
        const { fm, body } = parseFrontMatter(fs.readFileSync(q, 'utf8'));
        const title = (/^#\s+(.+)$/m.exec(body) ?? [, ''])[1].replace(/`/g, '');
        out.push({ rel, fm, title, bytes: fs.statSync(q).size });
      }
    }
  })(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** 渲染索引。 */
export function renderIndex(docs) {
  const L = [];
  L.push('---', 'kind: generated', 'state: live', 'home: docs-new/**/*.md 的 front-matter',
    'generated_by: scripts/build-doc-index.mjs', '---', '');
  L.push('# 文档索引（生成物）');
  L.push('');
  L.push('> 由 `docs-new/**/*.md` 的 front-matter 投影而来：`node scripts/build-doc-index.mjs`。**勿手改。**');
  L.push('');
  L.push('**`kind`**：' + Object.entries(KIND_MARK).map(([k, v]) => `\`${k}\`=${v}`).join(' · '));
  L.push('**`state`**：' + Object.entries(STATE_MARK).map(([k, v]) => `\`${k}\`=${v}`).join(' · '));
  L.push('');
  L.push('> ★**读文档前先看 `state`**：`live` 才是现行结论；`record` 是**一次性取证的历史快照**（结论已落台账，');
  L.push('> 只作票据证据锚点用）；`generated` 一律勿手改，改真源后重跑生成器。');
  L.push('');

  const byState = {};
  for (const d of docs) byState[d.fm?.state ?? '?'] = (byState[d.fm?.state ?? '?'] ?? 0) + 1;
  const byKind = {};
  for (const d of docs) byKind[d.fm?.kind ?? '?'] = (byKind[d.fm?.kind ?? '?'] ?? 0) + 1;
  L.push(`共 **${docs.length}** 份：` + Object.entries(byKind).map(([k, v]) => `${KIND_MARK[k] ?? k} ${v}`).join(' · ')
    + '；按 state：' + Object.entries(byState).map(([k, v]) => `${k} ${v}`).join(' · '));
  L.push('');

  // 按目录分区
  const dirs = [...new Set(docs.map((d) => d.rel.split('/')[0]))].sort();
  for (const dir of dirs) {
    const list = docs.filter((d) => d.rel.split('/')[0] === dir);
    L.push(`## \`${dir}/\`（${list.length}）`);
    L.push('');
    L.push('| 文档 | kind | state | 真源 / 生成器 | 标题 |');
    L.push('|---|---|---|---|---|');
    for (const d of list) {
      const fm = d.fm ?? {};
      const home = fm.generated_by ? `\`${fm.generated_by}\`` : fm.home ? `\`${fm.home}\`` : '—';
      const sup = fm.superseded_by ? `（结论已落 \`${fm.superseded_by}\`）` : '';
      L.push(`| [\`${d.rel}\`](./${d.rel.startsWith('00-overview/') ? d.rel.replace('00-overview/', '') : '../' + d.rel}) | ${KIND_MARK[fm.kind] ?? fm.kind ?? '—'} | ${STATE_MARK[fm.state] ?? fm.state ?? '—'} | ${home} | ${d.title.slice(0, 60)}${sup} |`);
    }
    L.push('');
  }
  L.push('## 不在本索引里的文档');
  L.push('');
  L.push('- `analysis/*.json`、`analysis/journal.jsonl` —— **机器真源**（不是文档；用 `.agents/skills/amayui-engine-analysis/scripts/*.js` 查）。');
  L.push('- `tickets/**` —— 工作项台账（看板 `tickets/README.md`，单票 `tickets.js --show <ID>`）。');
  L.push('- `tools|plugins|native/*/README.md` —— 子工程自述，就地维护。');
  L.push('- `.agents/skills/*/SKILL.md` —— 流程契约（技能目录）。');
  L.push('');
  return L.join('\n');
}

function main() {
  const docs = scanDocs();
  const md = renderIndex(docs);
  const out = process.argv.includes('--check')
    ? (fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === md)
    : (fs.writeFileSync(OUT, md, 'utf8'), true);
  if (process.argv.includes('--check') && !out) {
    console.error('✗ docs-new/00-overview/index.md 不是最新的（跑 node scripts/build-doc-index.mjs）');
    process.exit(1);
  }
  console.log(`[ok] docs-new/00-overview/index.md ← ${docs.length} 份文档`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
