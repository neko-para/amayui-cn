/** @tier T0 @kind ratchet @subsystem ledger */

/**
 * **文档模型守卫**（`docs-new/**` 的 `kind` / `state` 状态机）。
 *
 * 为什么要有它：`docs-new/` 里有 100 份 md，分七类（真源 / 生成物 / 叙述 / 流程 / 索引 / 会话 / 历史记录）。
 * 此前这个分类**只写在正文的散文里**（"勿手改"、"一次性"），没有任何机器可读的标记 ——
 * 实测代价：`docs-new/README.md` 长期把一份**过期快照**（`stub-reaudit §4`）当卖点；
 * 11 份一次性审计/规格（366 KB）在对应票 done 之后仍与"现行结论"混在同一目录。
 *
 * 本守卫强制的不变量（对应 `docs-new/00-overview/authority.md` 附录 A5/A3/A4/A5 的不变量）：
 *   I1 每份 md 都有合法的 `kind`/`state`；`state ≠ live` ⇒ 必有 `superseded_by`
 *   I2 `kind=generated` ⇒ 必写 `home` + `generated_by`，且生成器文件真实存在
 *   I3 **沿革不进生成物**：生成物里不得出现 `analysis/journal.jsonl` 任何条目的正文
 *   I8 `kind=record` ⇔ 位于 `docs-new/99-records/`（历史区），且只增不改
 *   I9 **沿革不进叙述文档**（A4①）：`03-engine/*.md` 的 `kind=narrative` 里不得写「订正/旧句/历史判据」
 *      —— 旧的直接删、订正落 `journal`。为什么要有它：A4① 此前只有 `--validate` 的人眼纪律，
 *      实测 13 份机制叙述里积了 28 处「★2026-09 订正（原文写…）」，读者分不清哪句是现行结论。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const DOCS = path.join(ROOT, 'docs-new');
const KINDS = ['source', 'generated', 'narrative', 'procedure', 'index', 'session', 'record'];
const STATES = ['live', 'consumed', 'superseded'];

const tableMod = (await import(pathToFileURL(path.join(ROOT, 'scripts/build-opcode-table.mjs')).href)) as {
  renderOpcodeTable: (doc: unknown) => string;
};
const indexMod = (await import(pathToFileURL(path.join(ROOT, 'scripts/build-doc-index.mjs')).href)) as {
  scanDocs: (dir?: string) => { rel: string; fm: Record<string, string> | null; title: string; bytes: number }[];
  renderIndex: (docs: { rel: string; fm: Record<string, string> | null; title: string; bytes: number }[]) => string;
};

const docs = indexMod.scanDocs();
const isPath = (s: string) => s.includes('/');

test('★文档模型：每份 docs-new md 都有合法的 kind / state', () => {
  const problems: string[] = [];
  for (const d of docs) {
    if (!d.fm) { problems.push(`${d.rel}：缺 front-matter（kind/state）`); continue; }
    if (!d.fm.kind || !KINDS.includes(d.fm.kind)) problems.push(`${d.rel}：kind 非法（${d.fm.kind}）`);
    if (!d.fm.state || !STATES.includes(d.fm.state)) problems.push(`${d.rel}：state 非法（${d.fm.state}）`);
  }
  assert.deepEqual(problems, [], `front-matter 不合规：\n  - ${problems.join('\n  - ')}`);
  assert.ok(docs.length >= 90, `文档数异常（${docs.length}）—— 扫描可能失效`);
});

test('★文档模型：state ≠ live ⇒ 必有 superseded_by，且路径存在', () => {
  const problems: string[] = [];
  for (const d of docs) {
    const fm = d.fm ?? {};
    if (fm.state === 'live') {
      if (fm.superseded_by) problems.push(`${d.rel}：state=live 不该有 superseded_by`);
      continue;
    }
    if (!fm.superseded_by) { problems.push(`${d.rel}：state=${fm.state} 必须写 superseded_by（结论落在哪）`); continue; }
    if (isPath(fm.superseded_by) && !fs.existsSync(path.join(ROOT, fm.superseded_by))) {
      problems.push(`${d.rel}：superseded_by 指向不存在的路径 ${fm.superseded_by}`);
    }
  }
  assert.deepEqual(problems, [], `state 机不合规：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：kind=generated ⇒ home + generated_by 存在', () => {
  const problems: string[] = [];
  const gen = docs.filter((d) => d.fm?.kind === 'generated');
  assert.ok(gen.length >= 30, `生成物样本太少（${gen.length}）`);
  for (const d of gen) {
    const fm = d.fm ?? {};
    if (!fm.home) problems.push(`${d.rel}：缺 home（真源在哪）`);
    if (!fm.generated_by) { problems.push(`${d.rel}：缺 generated_by`); continue; }
    if (!fs.existsSync(path.join(ROOT, fm.generated_by))) problems.push(`${d.rel}：generated_by 文件不存在（${fm.generated_by}）`);
  }
  assert.deepEqual(problems, [], `生成物标注不合规：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：kind=record ⇔ 位于 99-records/（历史区）', () => {
  const bad = docs.filter((d) => {
    const inRecords = d.rel.startsWith('99-records/');
    return inRecords !== (d.fm?.kind === 'record');
  }).map((d) => `${d.rel}（kind=${d.fm?.kind}）`);
  assert.deepEqual(bad, [], `历史区与 kind=record 必须一致：${bad.join(' / ')}`);
  const records = docs.filter((d) => d.rel.startsWith('99-records/'));
  assert.ok(records.length >= 10, `历史区样本太少（${records.length}）`);
  for (const r of records) {
    assert.equal(r.fm?.state, 'consumed', `${r.rel}：历史记录必须是 consumed（已被台账取代）`);
  }
});

test('★文档模型：沿革不进生成物（journal 正文不得出现在任何 generated md 里）', () => {
  const journal = fs.readFileSync(path.join(ROOT, 'analysis/journal.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as { title: string; body: string });
  assert.ok(journal.length >= 20, `沿革样本太少（${journal.length}）`);
  const problems: string[] = [];
  for (const d of docs.filter((x) => x.fm?.kind === 'generated')) {
    const text = fs.readFileSync(path.join(DOCS, d.rel), 'utf8');
    for (const e of journal) {
      // 只查"整段搬运"：正文前 160 字（去掉空白差异）出现即视为沿革漏进了生成物
      const probe = e.body.replace(/\s+/g, ' ').trim().slice(0, 160);
      if (probe.length < 120) continue;
      if (text.replace(/\s+/g, ' ').includes(probe)) problems.push(`${d.rel} ← 「${e.title.slice(0, 40)}」`);
    }
  }
  assert.deepEqual(problems, [], `沿革漏进生成物：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：沿革不进叙述文档（A4① —— `03-engine` 机制叙述里不得复述「订正」）', () => {
  const BANNED = ['订正', '旧句', '历史判据'];
  const target = docs.filter((d) => d.rel.startsWith('03-engine/') && d.fm?.kind === 'narrative');
  assert.ok(target.length >= 20, `机制叙述样本太少（${target.length}）—— 扫描可能失效`);
  const problems: string[] = [];
  for (const d of target) {
    const lines = fs.readFileSync(path.join(DOCS, d.rel), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const hit = BANNED.find((w) => l.includes(w));
      if (hit) problems.push(`${d.rel}:${i + 1} 「${hit}」`);
    });
  }
  /**
   * ★**I9 扩到生成物**（`tickets/T-0108`）：同一族沿革话术此前积在**数据层**（`analysis/*.json`
   * 的 `semantics`/`note`），渲染进下面这三份生成物里，读者同样分不清哪句是现行结论 ——
   * 实测改前：`opcode-table.md` **49** 行、`engine-capabilities.md` **8** 行、`opcode-gaps.md` **1** 行带「订正」。
   * 现在数据层已把沿革移进各实体的 `journal[]`（**永不渲染**，A2），所以生成物里必须**一处都没有** ——
   * 这条棘轮让"沿革再漏回被渲染字段"立刻变红，而不是靠人眼抽查。
   */
  const GENERATED = ['03-engine/opcode-table.md', '03-engine/engine-capabilities.md', '03-engine/opcode-gaps.md'];
  for (const rel of GENERATED) {
    const lines = fs.readFileSync(path.join(DOCS, rel), 'utf8').split('\n');
    assert.ok(lines.length > 40, `${rel}：行数异常（${lines.length}）—— 扫描可能失效`);
    lines.forEach((l, i) => {
      if (l.includes('订正')) problems.push(`${rel}:${i + 1} 「订正」（数据层沿革漏进生成物）`);
    });
  }
  assert.deepEqual(problems, [], `叙述/生成物里出现沿革话术（A4①：旧的直接删、订正落 journal；数据层的沿革见 tickets/T-0108）：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：docs-new/00-overview/index.md 是最新的', () => {
  const md = indexMod.renderIndex(docs);
  const cur = fs.readFileSync(path.join(DOCS, '00-overview/index.md'), 'utf8');
  assert.equal(cur, md, '索引不是最新的 ⇒ 跑 node scripts/build-doc-index.mjs');
});

test('★文档模型：opcode-table.md 是 analysis/opcodes.json 的生成物（不是真源）', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/opcodes.json'), 'utf8'));
  const md = fs.readFileSync(path.join(DOCS, '03-engine/opcode-table.md'), 'utf8');
  assert.equal(md, tableMod.renderOpcodeTable(doc), 'opcode-table.md 不是最新的 ⇒ 跑 node scripts/build-opcode-table.mjs');
  assert.ok(doc.entries.length >= 500, `opcode 映射表样本太少（${doc.entries.length}）`);
  assert.ok(doc.fallbackDefault.entries.length >= 20, `回退默认表样本太少（${doc.fallbackDefault.entries.length}）`);
});

/**
 * ★**raw 行号棘轮**（`tickets/T-0112`，B7-B 残余）：机制叙述里引用的 `raw N` 必须真的落在反编译真源的对应语句上。
 *
 * 为什么要有它：`03-engine/*.md` 的字段表与索引表**大量以 raw 行号锚定结论**，但行号是手抄的 ——
 * 实测两份文档（`adv-text-rendering.md` 的 `FontVWindow`/`Font` 表、`copyright-effect.md` 的 §2/§3a/§3b/§5/§6）
 * 有 20+ 处行号与当前 `engine/天结_unpacked.exe_utf8.c` 不符（其中一处把 draw-item 的逐帧颜色求值器写成
 * `sub_49A300`，体里其实是 `sub_49AA30`）。本棘轮把**已逐格核过**的锚点钉成两向契约：
 *   ① 文档那一行必须仍写着该行号（防"改回旧行号"）；
 *   ② 该行号处必须真的含那段代码串（防"换了反编译版本还留着旧行号"）。
 * 只登记核过的锚点，不追求覆盖全表；加新锚点前先在 raw 里读体确证。
 */
// 反编译真源的文件名里"天结"用的是简体字形（与文档散文里的"天結"不同码位）⇒ 按后缀在 engine/ 里找，别硬编码码位。
const RAW_C_NAME = fs.readdirSync(path.join(ROOT, 'engine')).find((f) => f.endsWith('_unpacked.exe_utf8.c'));
assert.ok(RAW_C_NAME, '找不到反编译真源 engine/*_unpacked.exe_utf8.c');
const rawC = fs.readFileSync(path.join(ROOT, 'engine', RAW_C_NAME as string), 'utf8').split('\n');

type RawAnchor = { doc: string; row: string; cites: string[]; raw: { line: number; has: string }[] };

const T0112_ANCHORS: RawAnchor[] = [
  // ---- adv-text-rendering.md：FontVWindow / Font 字段表（ticket 判据 ①）----
  { doc: '03-engine/adv-text-rendering.md', row: '| `+4` |', cites: ['90446'], raw: [{ line: 90446, has: '_this + 4) = 0' }] },
  {
    doc: '03-engine/adv-text-rendering.md',
    row: '| `+8` |',
    cites: ['90447', '86385-86396', '89135-89146'],
    raw: [{ line: 90447, has: '_this + 8) = 2' }, { line: 86385, has: 'v8[a2 + 241]' }, { line: 89135, has: 'v9[a2 + 241]' }],
  },
  { doc: '03-engine/adv-text-rendering.md', row: '| `+116/+120` |', cites: ['90463-90464'], raw: [{ line: 90463, has: '_this + 116) = 1.0' }, { line: 90464, has: '_this + 120) = 1.0' }] },
  {
    doc: '03-engine/adv-text-rendering.md',
    row: '| `+1252` |',
    cites: ['78861', '68744/68782/69786'],
    raw: [{ line: 78861, has: '_this + 1252) = 0x1000000' }, { line: 68744, has: 'lfItalic = 0x1000000' }, { line: 69786, has: 'lfItalic = 0x1000000' }],
  },
  // ---- adv-text-rendering.md：Font+1404 = set:AutoLineFeed（判据 ③）----
  {
    doc: '03-engine/adv-text-rendering.md',
    row: '| `+1404` |',
    cites: ['23660-23662', '83001', '83609', '111548-111549'],
    raw: [
      { line: 23660, has: 'a1 + 86700' },
      { line: 83001, has: '_this + 1404) == 1' },
      { line: 83609, has: '_this + 1404) == 1' },
      { line: 111549, has: 'aSetAutolinefee' },
    ],
  },
  { doc: '03-engine/adv-text-rendering.md', row: '| `set:AutoLineFeed` |', cites: ['23660-23662', '111548-111549', '83001', '83609'], raw: [{ line: 72113, has: 'sub_45BCD0' }] },
  // ---- adv-text-rendering.md §3.5：0x204 draw-string 的落笔路径（判据 ②）----
  {
    doc: '03-engine/adv-text-rendering.md',
    row: '`0x204 draw-string`',
    cites: ['31454-31467', '68470-68495', '86044-86339'],
    raw: [
      { line: 31466, has: 'sub_456710' },
      { line: 68470, has: 'sub_456710' },
      { line: 68491, has: 'sub_471180' },
      { line: 68493, has: 'sub_46F2D0' },
      { line: 86047, has: '(unsigned __int8)*v63' },
      { line: 86146, has: 'GetGlyphOutline' },
    ],
  },
  // ---- copyright-effect.md §6 关键代码索引表（判据 ④）----
  {
    doc: '03-engine/copyright-effect.md',
    row: '| 时钟每帧写 |',
    cites: ['20620', '20640-20643', '20746', '20750-20751', '20758'],
    raw: [
      { line: 20620, has: 'timeGetTime' },
      { line: 20642, has: 'v94 = v5' },
      { line: 20643, has: '429752' },
      { line: 20746, has: '667860' },
      { line: 20750, has: '369336' },
      { line: 20751, has: '369332' },
      { line: 20758, has: 'sub_4B4040' },
    ],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| mesh 渲染 + CalcDiffuse |',
    cites: ['133458', '133505-133541', '122248'],
    raw: [{ line: 133458, has: '4AF1C0' }, { line: 133505, has: 'v40[0] & 2' }, { line: 133526, has: 'sub_4A2050' }, { line: 122248, has: '4A2050' }, { line: 122281, has: 'CalcDiffuse' }],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| draw-item 颜色动画求值 |',
    cites: ['117239', '117430', '117434-117483'],
    raw: [{ line: 117239, has: '49AA30' }, { line: 117430, has: '& 2) == 0' }, { line: 117434, has: 'if ( !v11 )' }],
  },
  { doc: '03-engine/copyright-effect.md', row: '| set-vertex-color(-alpha) |', cites: ['132809', '132826'], raw: [{ line: 132809, has: '4AE2C0' }, { line: 132826, has: '4AE330' }] },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| set-draw-color-alpha |',
    cites: ['131870'],
    raw: [{ line: 131870, has: '4ACF60' }, { line: 131878, has: 'v5 + 48) = a3' }, { line: 131880, has: 'result + 96) = a4' }],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| set-draw-color |',
    cites: ['131956'],
    raw: [
      { line: 131956, has: '4AD0C0' },
      { line: 131969, has: '|= 2u' },
      { line: 131972, has: 'v8 + 56) = a3' },
      { line: 131974, has: 'v9 + 76) = a4' },
      { line: 131976, has: 'result + 100) = a5' },
    ],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| draw-item 渲染 |',
    cites: ['133326', '133389', '133390', '133443'],
    raw: [{ line: 133326, has: '4AEEA0' }, { line: 133389, has: 'sub_49AA30' }, { line: 133390, has: '& 4) == 0' }, { line: 133443, has: 'sub_4A2D50' }],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| draw-texture 处理器 |',
    cites: ['31270', '31293', '131816'],
    raw: [{ line: 31270, has: '422E70' }, { line: 31293, has: 'SetRect' }, { line: 31299, has: 'sub_4ACE50' }, { line: 131816, has: '4ACE50' }],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| image 绘制器 |',
    cites: ['122890', '123146', '123208'],
    raw: [{ line: 122890, has: '4A2D50' }, { line: 123146, has: 'v42 + 20' }, { line: 123208, has: '42456) + 20' }],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| 0x400 等待门 |',
    cites: ['12762-12786', '32303-32312'],
    raw: [{ line: 12762, has: 'sub_407E20' }, { line: 32303, has: 'sub_4248C0' }, { line: 32309, has: '_this[92338] = 0' }, { line: 32310, has: '_this[92339] = result' }],
  },
  {
    doc: '03-engine/copyright-effect.md',
    row: '| 淡出后的硬切 |',
    cites: ['31245', '31604'],
    raw: [{ line: 31245, has: '422E00' }, { line: 31604, has: '4237B0' }],
  },
  // ---- engine-reset-mainloop.md §A.2 ④：队列/栈构造点计数（判据 ⑤）----
  {
    doc: '03-engine/engine-reset-mainloop.md',
    row: '构造点各 1 处',
    cites: ['10 个 Queue_int + 10 个 Stack_int 对象'],
    raw: [{ line: 18081, has: 'v15 = 10' }, { line: 18111, has: 'v16 = 10' }],
  },
  {
    doc: '03-engine/engine-reset-mainloop.md',
    row: 'v18 = _this+388252; v15 = 10;',
    cites: ['18080-18081'],
    raw: [{ line: 18080, has: '388252' }, { line: 18086, has: 'operator new(0x1Cu)' }],
  },
  {
    doc: '03-engine/engine-reset-mainloop.md',
    row: 'v18 = _this+388292; v16 = 10;',
    cites: ['18110-18111'],
    raw: [{ line: 18110, has: '388292' }, { line: 18116, has: 'operator new(0x14u)' }],
  },
];

test('★文档模型：机制叙述的 raw 行号锚点与反编译真源一致（B7-B 棘轮，T-0112）', () => {
  assert.ok(T0112_ANCHORS.length >= 18, `锚点样本太少（${T0112_ANCHORS.length}）`);
  const problems: string[] = [];
  for (const a of T0112_ANCHORS) {
    const rows = fs.readFileSync(path.join(DOCS, a.doc), 'utf8').split('\n').filter((l) => l.includes(a.row));
    if (rows.length === 0) { problems.push(`${a.doc}：找不到锚定行「${a.row}」`); continue; }
    for (const c of a.cites) {
      if (!rows.some((l) => l.includes(c))) problems.push(`${a.doc}「${a.row}」：行号 ${c} 不在该行（被改回旧行号？）`);
    }
    for (const r of a.raw) {
      const got = rawC[r.line - 1] ?? '';
      if (!got.includes(r.has)) problems.push(`raw ${r.line} 不含「${r.has}」（实际：${got.trim().slice(0, 90)}）`);
    }
  }
  assert.deepEqual(problems, [], `行号锚点与真源不符（改文档行号前先在 raw 里读体确证）：\n  - ${problems.join('\n  - ')}`);
});

/**
 * ★**raw 行号棘轮（T-0172）**：`03-engine/rendering.md`（绘制模型与淡入淡出）与
 * `04-app/emulator-copyright-effect.md`（版权页实现）里**逐格核过**的 raw 行号锚点。
 *
 * 为什么要有它：这两份文档同样以 raw 行号锚定结论，而 T-0112 的 B7-B 棘轮只覆盖了
 * `adv-text-rendering.md` / `copyright-effect.md` / `engine-reset-mainloop.md` 三份 ⇒ 同一批旧行号
 * 在 `rendering.md` 长期留存（实测 60 处与体现状不符，改前取证见
 * `tickets/T-0172/evidence/t0172-red-check.mjs`，60/60 ❌）。本棘轮把已核过的锚点钉成两向契约：
 *   ① 文档那一行（`line`）必须仍含锚点文字 `row`、且必须仍写着 `cites[]` 里的每个行号（防"改回旧行号"）；
 *   ② 该行号处必须真的含 `raw[].has` 那段代码串（防"换了反编译版本还留着旧行号"）；
 *   ③ `raw[].line` 必须被 `cites[]` 覆盖（不许"文档没写这个行号，却拿它当断言"）。
 *
 * 表 = `tickets/T-0172/evidence/anchors.json`（唯一真源；`tickets/T-0172/evidence/check-anchors.mjs`
 * 的命令行核对读同一张表）⇒ 换反编译版本时只改表。
 */
type T0172Anchor = { id: string; doc: string; line: number; row: string; cites: string[]; raw: { line: number; has: string }[] };
const T0172_ANCHORS: T0172Anchor[] = (
  JSON.parse(fs.readFileSync(path.join(ROOT, 'tickets/T-0172/evidence/anchors.json'), 'utf8')) as { anchors: T0172Anchor[] }
).anchors;

/** `cites[]` 里的一项是否覆盖行号 n（精确匹配，或落在 `A-B` 区间内）。 */
function t0172CiteCovers(cites: string[], n: number): boolean {
  for (const c of cites) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(c);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (n >= a && n <= b) return true;
  }
  return false;
}

test('★文档模型：rendering.md / 04-app 的行号锚点与反编译真源一致（B7-B 棘轮，T-0172）', () => {
  assert.ok(T0172_ANCHORS.length >= 30, `锚点样本太少（${T0172_ANCHORS.length}）`);
  const problems: string[] = [];
  for (const a of T0172_ANCHORS) {
    const docLines = fs.readFileSync(path.join(DOCS, a.doc), 'utf8').split('\n');
    const at = docLines[a.line - 1];
    if (at === undefined) { problems.push(`${a.id}：${a.doc} 只有 ${docLines.length} 行，找不到第 ${a.line} 行`); continue; }
    if (!at.includes(a.row)) problems.push(`${a.id}：${a.doc}:${a.line} 不再含锚点文字「${a.row}」`);
    for (const c of a.cites) if (!at.includes(c)) problems.push(`${a.id}：${a.doc}:${a.line} 不再写着行号 ${c}（被改回旧行号？）`);
    for (const r of a.raw) {
      const got = rawC[r.line - 1];
      if (got === undefined) { problems.push(`${a.id}：真源只有 ${rawC.length} 行，找不到 raw ${r.line}`); continue; }
      if (!got.includes(r.has)) problems.push(`${a.id}：raw ${r.line} 不含「${r.has}」（实际：${got.trim().slice(0, 90) || '(空行)'}）`);
      if (!t0172CiteCovers(a.cites, r.line)) problems.push(`${a.id}：raw ${r.line} 未被 cites[] 覆盖（文档没写该行号，却在拿它断言）`);
    }
  }
  assert.deepEqual(problems, [], `行号锚点与真源不符（改文档行号前先在 raw 里读体确证；表 = tickets/T-0172/evidence/anchors.json）：\n  - ${problems.join('\n  - ')}`);
});
