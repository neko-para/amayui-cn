#!/usr/bin/env node
/**
 * 由数据层渲染「脚本台账」的人可读文档（第三层）。
 *
 *   node scripts/build-scripts.mjs
 *
 * - 数据源（唯一增长处）：`analysis/scripts.json`
 * - 输出：
 *     `docs-new/05-scripts/README.md`   —— 说明 + 覆盖率 + 索引（已登记的脚本）
 *     `docs-new/05-scripts/<ID>.md`     —— 每个脚本一页（结构 / 槽 / 不变量 / 坑 / 缺口 / 相关）
 *
 * 为什么要有这一层：`src/*.txt` 是**游戏自己的脚本**（界面流程、演出、消息）。
 * 「这个脚本长什么样、谁调它、切分类为什么是退出重入、可见项表是哪三个数组」
 * 这类知识既不是函数语义（第一层）也不是引擎常态行为（第二层），
 * 以前只散在代码注释与主题文档里 ⇒ 下次为了同一个界面又得重读 3000 行反汇编。
 *
 * ★**不要手改本目录下的 md**：它们由本脚本生成；守卫 `test/script-ledger.test.ts` 会核对
 *   「md 与数据层同步」+「layout 的 anchor 真的出现在声明的行区间内」。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = path.join(ROOT, 'analysis', 'scripts.json');
const OUT_DIR = path.join(ROOT, 'docs-new', '05-scripts');
const SRC_DIR = path.join(ROOT, 'src');

const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const entries = [...doc.entries].sort((a, b) => a.id.localeCompare(b.id));
const srcTotal = fs.existsSync(SRC_DIR) ? fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.txt')).length : 0;
const by = (s) => entries.filter((e) => e.status === s).length;
const MARK = { analyzed: '✅ 已分析', partial: '🟠 部分', stub: '⚪ 仅登记' };
/** 表格单元格转义：值里出现 `|` 会把列数冲掉。 */
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
/** 截断时带省略号（免得索引里的话断得没头没尾）。 */
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 每个脚本一页。 */
function pageFor(e) {
  const L = [];
  L.push(`# 脚本台账 · \`${e.id}\``);
  L.push('');
  L.push(`> 由 \`analysis/scripts.json\` 生成（\`node scripts/build-scripts.mjs\`）—— **勿手改本文件**。`);
  L.push('');
  L.push(`| 项 | 值 |`);
  L.push(`|---|---|`);
  L.push(`| 脚本 | \`${e.bin}\`（真源 \`${e.file}\`） |`);
  L.push(`| 状态 | ${MARK[e.status] ?? e.status} |`);
  L.push(`| 是什么 | ${e.role} |`);
  L.push(`| 怎么进/出 | ${e.entry} |`);
  L.push('');
  if (e.layout?.length) {
    L.push('## 结构（读了哪些段）');
    L.push('');
    L.push('| 行区间 | 锚点（必须出现在该区间内） | 职责 |');
    L.push('|---|---|---|');
    for (const l of e.layout) L.push(`| \`${esc(l.lines)}\` | \`${esc(l.anchor)}\` | ${esc(l.what)} |`);
    L.push('');
  }
  if (e.slots?.length) {
    L.push('## 关键槽 / 局部量');
    L.push('');
    L.push('| 名字 | 含义 |');
    L.push('|---|---|');
    for (const s of e.slots) L.push(`| \`${esc(s.key)}\` | ${esc(s.what)} |`);
    L.push('');
  }
  if (e.invariants?.length) {
    L.push('## 不变量（拿它做回归断言）');
    L.push('');
    for (const x of e.invariants) L.push(`- ${x}`);
    L.push('');
  }
  if (e.gotchas?.length) {
    L.push('## 坑（踩过一次，别再踩）');
    L.push('');
    for (const x of e.gotchas) L.push(`- ${x}`);
    L.push('');
  }
  if (e.gaps?.length) {
    L.push('## 缺口');
    L.push('');
    for (const x of e.gaps) L.push(`- ${x}`);
    L.push('');
  }
  const links = [];
  for (const c of e.links?.capabilities ?? []) links.push(`- 引擎常态能力：\`${c}\`（见 \`docs-new/03-engine/engine-capabilities.md\`）`);
  for (const f of e.links?.functions ?? []) links.push(`- 函数结论：\`${f}\`（见 \`analysis/functions.json\`）`);
  for (const d of e.links?.docs ?? []) links.push(`- 主题文档：\`${d}\``);
  for (const g of e.guards ?? []) links.push(`- 守卫测试：\`app/amayui-emulator/${g}\``);
  if (links.length) {
    L.push('## 相关');
    L.push('');
    L.push(...links);
    L.push('');
  }
  L.push('## 证据与备注');
  L.push('');
  L.push(`- 证据：${e.evidence}`);
  if (e.notes) L.push(`- 备注：${e.notes}`);
  L.push('');
  return L.join('\n');
}

/** 索引页。 */
function indexPage() {
  const L = [];
  L.push('# 脚本台账（`src/*.txt` 逐个记）');
  L.push('');
  L.push('> 由 `analysis/scripts.json` 生成：`node scripts/build-scripts.mjs`。**勿手改。**');
  L.push('');
  L.push('这一层回答的是：**游戏自己的脚本长什么样、怎么跑通**（界面流程 / 演出 / 消息 / 配置读写）。');
  L.push('三层数据层分工：');
  L.push('');
  L.push('| 层 | 文件 | 回答 |');
  L.push('|---|---|---|');
  L.push('| 一 | `analysis/functions.json` + `fields.json` | 某个 `sub_XXXXXX` / 偏移**是什么** |');
  L.push('| 二 | `analysis/engine-capabilities.json` | 引擎有哪些**持续行为**（枚举 opcode 看不出来） |');
  L.push(`| 三 | \`analysis/scripts.json\`（本层） | **这个脚本**是什么、内部结构、关键槽、不变量、坑与缺口 |`);
  L.push('');
  L.push('## 覆盖率');
  L.push('');
  L.push(`\`src/*.txt\` 共 **${srcTotal}** 个，其中**已登记 ${entries.length}** 个（不是"已全部读过"，是"读过并落库"）：`);
  L.push('');
  L.push('| 状态 | 条数 | 含义 |');
  L.push('|---|---|---|');
  for (const [k, v] of Object.entries(doc.statusEnum)) L.push(`| \`${k}\` | ${by(k)} | ${esc(v)} |`);
  L.push(`| **合计** | **${entries.length}** | 分母 ${srcTotal}（\`node .agents/skills/amayui-engine-analysis/scripts/scripts.js --coverage\` 列出未登记项） |`);
  L.push('');
  L.push('> **不要求凑数登记**：没读过的脚本不要建条目（宁可空着）；读了一部分就写 `partial`，');
  L.push('> 并在 `layout` 里只列**真正读过的行区间** —— 守卫会核对每个锚点确实出现在它声明的区间内。');
  L.push('');
  L.push('## 索引');
  L.push('');
  L.push('| id | 脚本 | 是什么（摘要） | 段 | 槽 | 状态 | 守卫 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const e of entries) {
    const guards = (e.guards ?? []).length ? e.guards.map((g) => `\`${g}\``).join(' ') : '—';
    L.push(`| [\`${e.id}\`](./${e.id}.md) | \`${esc(e.bin)}\` | ${clip(esc(e.role), 78)} | ${(e.layout ?? []).length} | ${(e.slots ?? []).length} | ${MARK[e.status] ?? e.status} | ${guards} |`);
  }
  L.push('');
  L.push('## 怎么用（流程）');
  L.push('');
  L.push('分析某个 `src/*.txt` 时的动作顺序（详见 `amayui-engine-analysis` 技能 §3.2）：');
  L.push('');
  L.push('1. `scripts.js --id <ID>` 先看有没有现成条目；没有就 `--add` 一个 `partial` 骨架（`role`/`entry` 先写一句话）；');
  L.push('2. 读脚本时**顺手记** `layout`（行区间 + 锚点 + 职责）与 `slots`（槽号 + 含义）——锚点用脚本里真实存在的字符串（label / opcode 行）；');
  L.push('3. 引擎层面的结论照旧进第一/第二层，并在 `links` 里回链（`capabilities` 填 id、`functions` 填 addr）；');
  L.push('4. `node scripts/build-scripts.mjs` 重生成 md ⇒ `scripts.js --validate` ⇒ `npx tsx --test test/script-ledger.test.ts`；');
  L.push('5. 反汇编重排（翻译/reflow）后行号会变 ⇒ 守卫会红，按失败信息更新 `lines`（这是**刻意**的棘轮）。');
  L.push('');
  return L.join('\n');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const wanted = new Set();
for (const e of entries) {
  const p = path.join(OUT_DIR, `${e.id}.md`);
  fs.writeFileSync(p, pageFor(e), 'utf8');
  wanted.add(path.basename(p));
}
fs.writeFileSync(path.join(OUT_DIR, 'README.md'), indexPage(), 'utf8');
wanted.add('README.md');
// 删掉已经不在数据层里的旧页面（避免 md 目录留下"幽灵脚本"）
for (const f of fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.md'))) {
  if (!wanted.has(f)) {
    fs.unlinkSync(path.join(OUT_DIR, f));
    console.log(`[clean] 删除已不在数据层的页面 ${f}`);
  }
}
console.log(
  `[ok] docs-new/05-scripts/ ← analysis/scripts.json（${entries.length} 条；` +
    `已分析 ${by('analyzed')} / 部分 ${by('partial')} / 仅登记 ${by('stub')}；src 分母 ${srcTotal}）`,
);
