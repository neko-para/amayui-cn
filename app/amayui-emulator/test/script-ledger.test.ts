/**
 * **脚本台账的守卫测试**（数据层第三层：`analysis/scripts.json`）。
 *
 * 台账 = `src/*.txt` 里每个**被分析过的游戏脚本**是什么：由谁调起、内部结构（label + 行区间 + 职责）、
 * 关键槽/局部量、不变量、坑与缺口，以及它对应的引擎结论（能力 id / 函数地址 / 主题文档）。
 * 它存在的理由：脚本层的知识（"设置界面的可见项表是 36df/179f/273f 三数组、靠 i12f 排序、
 * 切分类 = 退出重入"）既不是函数语义（第一层）也不是引擎常态行为（第二层），
 * 以前只散在代码注释与主题文档里 ⇒ 每次都要重读几千行反汇编。
 *
 * 本测试防的是台账腐化，五条规则：
 *  1. schema 合法（id 唯一 / status 在枚举内 / role·entry·evidence·bin 非空 / layout·slots 成形 / counts 自洽）；
 *  2. ★**锚点棘轮**：每条 `layout[].anchor` 必须**真的出现在它声明的行区间内** ——
 *     既防"凭印象编造结构"，也让 `src/*.txt` 反汇编一旦重排（翻译 reflow）就**必然变红**，逼人刷新行号；
 *  3. `guards[]` 指向的测试文件真的存在（防止"声称有守卫"落空）；
 *  4. `links` 不许悬空：`capabilities` 必须是第二层里存在的 id，`functions` 必须是 `functions.json` 里存在的 addr；
 *  5. 人可读 md（`docs-new/05-scripts/`）与数据层**同步**：README 的覆盖率分母 = 磁盘上 `src/*.txt` 的真实数量，
 *     每个条目有自己的页面且页内含其全部锚点与槽 ⇒ 忘了重跑生成器会被抓住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const APP_ROOT = path.resolve(HERE, '..');
const JSON_PATH = path.join(REPO, 'analysis', 'scripts.json');
const CAPS_PATH = path.join(REPO, 'analysis', 'engine-capabilities.json');
const FUNCS_PATH = path.join(REPO, 'analysis', 'functions.json');
const SRC_DIR = path.join(REPO, 'src');
const MD_DIR = path.join(REPO, 'docs-new', '05-scripts');

interface LayoutSeg {
  anchor: string;
  lines: string;
  what: string;
}
interface Slot {
  key: string;
  what: string;
}
interface Entry {
  id: string;
  file: string;
  bin: string;
  role: string;
  entry: string;
  layout: LayoutSeg[];
  slots: Slot[];
  invariants: string[];
  gotchas: string[];
  gaps: string[];
  links: { capabilities: string[]; functions: string[]; docs: string[] };
  guards: string[];
  status: string;
  evidence: string;
  notes: string;
}
interface Ledger {
  statusEnum: Record<string, string>;
  counts: Record<string, number>;
  entries: Entry[];
}

function load(): Ledger {
  assert.ok(fs.existsSync(JSON_PATH), `台账应存在：${JSON_PATH}`);
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) as Ledger;
}
/** 行区间 "a-b" → [a,b]；不合法返回 null。 */
function parseRange(s: string): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(String(s ?? ''));
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= b ? [a, b] : null;
}
/** 磁盘上的 src/*.txt（覆盖率分母；生成器与守卫必须用同一个口径）。 */
function srcFiles(): string[] {
  if (!fs.existsSync(SRC_DIR)) return [];
  return fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.txt'));
}

test('台账 schema：必需字段齐、status 在枚举内、id 不重复、counts 自洽', () => {
  const L = load();
  assert.ok(L.entries.length >= 4, `条目应足够多（实际 ${L.entries.length}）`);
  const ids = new Set<string>();
  for (const e of L.entries) {
    assert.ok(e.id, '缺 id');
    assert.ok(!ids.has(e.id), `id 必须唯一：${e.id}`);
    ids.add(e.id);
    for (const k of ['file', 'bin', 'role', 'entry', 'evidence', 'status'] as const) {
      assert.ok(typeof e[k] === 'string' && e[k].length > 0, `${e.id} 缺 ${k}`);
    }
    assert.ok(L.statusEnum[e.status], `${e.id} 的 status 非法：${e.status}`);
    assert.ok(Array.isArray(e.layout) && e.layout.length > 0, `${e.id} 应有 layout（读过哪些段）`);
    for (const [i, l] of e.layout.entries()) {
      assert.ok(typeof l.what === 'string' && l.what.length > 0, `${e.id}.layout[${i}] 缺 what`);
      assert.ok(parseRange(l.lines), `${e.id}.layout[${i}].lines 应形如 "1136-1228"（实际 ${l.lines}）`);
      // 锚点至少 6 字符：防用 "a"/"0" 这种到处都有的串把棘轮糊过去
      assert.ok(
        typeof l.anchor === 'string' && l.anchor.length >= 6,
        `${e.id}.layout[${i}].anchor 应是有辨识度的串（≥6 字符，实际 ${JSON.stringify(l.anchor)}）`,
      );
    }
    for (const k of ['slots', 'invariants', 'gotchas', 'gaps', 'guards'] as const) {
      assert.ok(Array.isArray(e[k]), `${e.id} 的 ${k} 应是数组（没有就写 []）`);
    }
    for (const [i, s] of e.slots.entries()) {
      assert.ok(s.key && s.what, `${e.id}.slots[${i}] 缺 key/what`);
    }
    assert.ok(Array.isArray(e.links?.capabilities), `${e.id} 缺 links.capabilities`);
    assert.ok(Array.isArray(e.links?.functions), `${e.id} 缺 links.functions`);
    assert.ok(Array.isArray(e.links?.docs), `${e.id} 缺 links.docs`);
    // 缺口的另一个出口：gaps 或 notes 至少要有一个说话（不许既不说缺口也不说还没读什么）
    assert.ok(
      e.gaps.length > 0 || (typeof e.notes === 'string' && e.notes.length > 0),
      `${e.id} 既没有 gaps 也没有 notes —— 未读到的部分必须写出来`,
    );
  }
  const by = (s: string) => L.entries.filter((e) => e.status === s).length;
  for (const k of Object.keys(L.statusEnum)) {
    assert.equal(L.counts[k], by(k), `counts.${k} 应为 ${by(k)}`);
  }
  assert.equal(L.counts['total'], L.entries.length);
});

test('★锚点棘轮：每条 layout 的 anchor 真的出现在它声明的行区间内（防编造 / 防重排漂移）', () => {
  const L = load();
  const problems: string[] = [];
  for (const e of L.entries) {
    const p = path.join(REPO, e.file);
    if (!fs.existsSync(p)) {
      problems.push(`${e.id}: file 不存在 ${e.file}`);
      continue;
    }
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const [i, l] of e.layout.entries()) {
      const r = parseRange(l.lines);
      if (!r) continue; // schema 测试已报
      if (r[1] > lines.length) {
        problems.push(`${e.id}.layout[${i}]: 行区间 ${l.lines} 超出文件行数 ${lines.length}`);
        continue;
      }
      const slice = lines.slice(r[0] - 1, r[1]).join('\n');
      if (!slice.includes(l.anchor)) {
        problems.push(`${e.id}.layout[${i}]: anchor 未出现在 ${l.lines} 行内 → ${JSON.stringify(l.anchor)}`);
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    `下面的条目与 src/*.txt 对不上了（若是反汇编重排，请更新对应 lines/anchor）：\n  - ${problems.join('\n  - ')}`,
  );
});

test('台账守卫：guards 指向的测试存在、links 不悬空（capabilities id / functions addr）', () => {
  const L = load();
  const caps = fs.existsSync(CAPS_PATH)
    ? (JSON.parse(fs.readFileSync(CAPS_PATH, 'utf8')).entries as { id: string }[]).map((c) => c.id)
    : [];
  const funcs = fs.existsSync(FUNCS_PATH)
    ? (JSON.parse(fs.readFileSync(FUNCS_PATH, 'utf8')) as { addr: string }[]).map((f) => f.addr)
    : [];
  assert.ok(caps.length > 0, '第二层能力台账应存在（links.capabilities 靠它校验）');
  assert.ok(funcs.length > 0, 'functions.json 应存在（links.functions 靠它校验）');
  const missingGuards: string[] = [];
  const badCaps: string[] = [];
  const badFuncs: string[] = [];
  for (const e of L.entries) {
    for (const g of e.guards) {
      if (!fs.existsSync(path.join(APP_ROOT, g))) missingGuards.push(`${e.id} → ${g}`);
    }
    for (const c of e.links.capabilities) if (!caps.includes(c)) badCaps.push(`${e.id} → ${c}`);
    for (const f of e.links.functions) if (!funcs.includes(f)) badFuncs.push(`${e.id} → ${f}`);
  }
  assert.deepEqual(missingGuards, [], `guard 指向的测试不存在：\n${missingGuards.join('\n')}`);
  assert.deepEqual(badCaps, [], `links.capabilities 里的 id 不在第二层台账里：\n${badCaps.join('\n')}`);
  assert.deepEqual(badFuncs, [], `links.functions 里的 addr 不在 functions.json 里：\n${badFuncs.join('\n')}`);
});

test('覆盖率口径：登记的 file 都真实存在，且不重复登记同一个脚本', () => {
  const L = load();
  const files = new Set<string>();
  const problems: string[] = [];
  for (const e of L.entries) {
    if (!fs.existsSync(path.join(REPO, e.file))) problems.push(`${e.id}: ${e.file} 不存在`);
    const norm = e.file.replace(/^src[\\/]/, '');
    if (files.has(norm)) problems.push(`${e.id}: ${e.file} 被重复登记（一个脚本一条）`);
    files.add(norm);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
  assert.ok(srcFiles().length >= L.entries.length, '分母不该小于已登记数');
});

test('人可读 md 与数据层同步（覆盖率分母 = 磁盘真实数、每页含其锚点与槽）', () => {
  const L = load();
  const readme = path.join(MD_DIR, 'README.md');
  assert.ok(fs.existsSync(readme), `索引页应存在（跑 node scripts/build-scripts.mjs）：${readme}`);
  const md = fs.readFileSync(readme, 'utf8');
  const total = srcFiles().length;
  // 覆盖率分母：磁盘上真的有多少个 src/*.txt（加脚本后忘了重生成 ⇒ 这里红）
  assert.ok(
    md.includes(`\`src/*.txt\` 共 **${total}** 个`),
    `索引页的覆盖率分母与磁盘不一致（应为 ${total}）—— 需重跑 node scripts/build-scripts.mjs`,
  );
  assert.ok(md.includes(`**已登记 ${L.entries.length}**`), '索引页应含已登记条数');
  // 统计行与数据层一致
  for (const k of Object.keys(L.statusEnum)) {
    assert.ok(md.includes(`| \`${k}\` | ${L.counts[k]} |`), `索引页统计行与数据层不一致：${k}`);
  }
  // 每个条目：索引里有链接 + 有自己的页面，且页面含其全部锚点/槽（防止"数据层加了段、md 没重生成"）
  const missing: string[] = [];
  for (const e of L.entries) {
    if (!md.includes(`[\`${e.id}\`](./${e.id}.md)`)) {
      missing.push(`${e.id}: 索引页缺链接`);
      continue;
    }
    const page = path.join(MD_DIR, `${e.id}.md`);
    if (!fs.existsSync(page)) {
      missing.push(`${e.id}: 缺页面 ${path.basename(page)}`);
      continue;
    }
    const body = fs.readFileSync(page, 'utf8');
    for (const l of e.layout) if (!body.includes(l.anchor)) missing.push(`${e.id}: 页面缺锚点 ${JSON.stringify(l.anchor)}`);
    for (const s of e.slots) if (!body.includes(s.key)) missing.push(`${e.id}: 页面缺槽 ${JSON.stringify(s.key)}`);
    for (const g of e.guards) if (!body.includes(g)) missing.push(`${e.id}: 页面缺守卫 ${g}`);
  }
  assert.deepEqual(missing, [], `md 与数据层不同步：\n  - ${missing.join('\n  - ')}`);
});

test('缺口可见：体检报告（把还没读到的脚本规模打出来）', () => {
  const L = load();
  const total = srcFiles().length;
  const registered = new Set(L.entries.map((e) => e.file.replace(/^src[\\/]/, '')));
  const unregistered = srcFiles().filter((f) => !registered.has(f));
  assert.equal(unregistered.length, total - L.entries.length);
  // 不设覆盖率阈值（会随进展变化，且刻意不凑数登记）——只在需要看时把数字打出来
  assert.ok(
    L.entries.length >= 1,
    `已登记 ${L.entries.length} / ${total}；未登记 ${unregistered.length} 个` +
      `（提醒：连\"只看过一眼\"的都算，但没读过的别登记）`,
  );
  const partial = L.entries.filter((e) => e.status !== 'analyzed');
  const lines = partial.map((e) => `  ${e.status.padEnd(8)} ${e.id}`);
  assert.ok(
    L.entries.some((e) => e.status === 'analyzed'),
    `至少应有一条读透的脚本（当前 analyzed=0）\n未读透的：\n${lines.join('\n')}`,
  );
});
