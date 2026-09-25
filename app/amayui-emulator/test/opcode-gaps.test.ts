/** @tier T0 @kind ratchet @subsystem vm */

/**
 * opcode 缺口台账守卫（`tickets/T-0081`，B0；审计 `docs-new/99-records/2026-09-audit/audit-2026-09.md` §1「不静默跳过」）。
 *
 * 守三件事：
 *  ① **覆盖**：语料（`src/*.txt` 941 个脚本）用到、而运行时三张表（`OPS`/`NATIVE_OPS`/`ENGINE_INTERNAL_OPS`）
 *     都没有的 opcode，必须全部登记进 `analysis/opcode-gaps.json` ⇒ 新增缺口无法"静默"；
 *  ② **处置纪律**：`ENGINE_INTERNAL_OPS` 的每一条都必须在台账里有说明（"体内真实效果是什么 / 为什么不可观测"），
 *     标 `engine-internal-unjustified` 的必须带票（本次审计翻出 4 条：0x244/0x325/0x10C/0x324 体里有真实效果；
 *     ★2026-09 已处置 3 条 —— `0x10c`/`0x324`/`0x325` 都转 `engine-internal`（各有 raw 依据 + 扩展点），只剩 `0x244` 仍 unjustified）；
 *     标 `implemented` 的必须真的在 `OPS`/`NATIVE_OPS` 里且不在 no-op 表里（防止"台账写已完成、代码没做"）。
 *  ③ **生成物最新**：`docs-new/03-engine/opcode-gaps.md` 必须与 `scripts/build-opcode-gaps.mjs` 的输出逐字一致
 *     （否则跑 `node scripts/build-opcode-gaps.mjs`）。
 *
 * 为什么不用静态正则判断注册状态：运行时表才是权威（例如表项可能由数组拼装），所以这里 import 真表。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');

interface GapEntry {
  opcode: number;
  mnemonic: string;
  disposition: string;
  note: string;
  ticket: string;
  missing?: { what?: unknown; ticket?: unknown; raw?: unknown }[];
}
interface GapReport {
  entries: GapEntry[];
  unimpl: GapEntry[];
  unjust: GapEntry[];
  missing: { op: number; count: number; files: number }[];
  corpusKinds: number;
  registeredCount: number;
  internalCount: number;
}

/** 台账生成器是 `scripts/` 下的 ESM 脚本（跨包），用动态 import + 显式类型拿接口。 */
const mod = (await import(pathToFileURL(path.join(ROOT, 'scripts/build-opcode-gaps.mjs')).href)) as {
  buildGapReport: (root: string) => { report: GapReport; problems: string[] };
  renderGapMd: (report: GapReport) => string;
};

test('★opcode 缺口台账：生成器校验通过（覆盖 + 处置纪律），且 md 是最新的', () => {
  const { report, problems } = mod.buildGapReport(ROOT);
  assert.deepEqual(problems, [], `opcode-gaps 校验失败：\n  - ${problems.join('\n  - ')}`);

  const mdPath = path.join(ROOT, 'docs-new/03-engine/opcode-gaps.md');
  assert.ok(fs.existsSync(mdPath), 'opcode-gaps.md 必须存在（node scripts/build-opcode-gaps.mjs）');
  assert.equal(
    fs.readFileSync(mdPath, 'utf8'),
    mod.renderGapMd(report),
    'opcode-gaps.md 不是最新的 ⇒ 跑 node scripts/build-opcode-gaps.mjs',
  );
});

test('★缺口台账与运行时注册表一致：语料用到而未实现的每一条都有登记', () => {
  const { report } = mod.buildGapReport(ROOT);
  const registered = new Set<number>([...OPS.keys(), ...NATIVE_OPS.keys(), ...ENGINE_INTERNAL_OPS.keys()]);
  const logged = new Set(report.entries.map((e) => e.opcode));

  // 生成器用的是"扫 handlers/*.ts"的静态口径；这里用运行时表再核一遍，防两边漂移
  for (const e of report.entries) {
    if (e.disposition === 'implemented') {
      assert.ok(registered.has(e.opcode), `0x${e.opcode.toString(16)} 台账标 implemented，但运行时表里没有`);
      assert.ok(!ENGINE_INTERNAL_OPS.has(e.opcode), `0x${e.opcode.toString(16)} 台账标 implemented，但仍在 no-op 表里`);
    }
    if (e.disposition === 'unimplemented') {
      assert.ok(!registered.has(e.opcode), `0x${e.opcode.toString(16)} 台账标 unimplemented，但运行时已注册（请改 disposition）`);
    }
  }
  // 反向：no-op 表里的每一条都必须在台账里（"体内真实效果说明"不许缺）
  for (const op of ENGINE_INTERNAL_OPS.keys()) {
    assert.ok(logged.has(op), `0x${op.toString(16)} 在 ENGINE_INTERNAL_OPS 里但没登记进 opcode-gaps.json`);
  }
  // 语料用到但未注册的（生成器算出来的）必须全部在台账里 —— 这是"新增缺口即红"的棘轮
  for (const m of report.missing) {
    assert.fail(`0x${m.op.toString(16)}（语料 ${m.count} 次 / ${m.files} 文件）既未注册也未登记`);
  }
});

test('★缺口台账给出的量级与审计结论一致（防"修着修着清单缩水"）', () => {
  const { report } = mod.buildGapReport(ROOT);
  // 审计（2026-09）定下的 P0/P1 缺口必须在册
  for (const op of [0x2e9, 0x228, 0x243, 0x23a, 0x307, 0x23f, 0x1d1, 0x32c, 0x25, 0x191, 0x20b, 0x7c, 0x222]) {
    assert.ok(
      report.entries.some((e) => e.opcode === op),
      `0x${op.toString(16)}（审计 P0/P1 缺口）必须出现在 opcode-gaps.json 里`,
    );
  }
  // 4 条"体里有真实效果的 no-op"（审计 T-0077）★不许从台账里消失、也不许变成"没理由的处置"。
  // 2026-09 首次处置：`0x10c`=deferred（等 T-0052 的键盘→掩码链路）、`0x324`/`0x325`=engine-internal
  // （Scene 模型侧自 T-0167 起已有 Effect3D 半边，缺的是 opcode→模型那一半 ⇒ 有据跳过）、`0x244` 另一路在办 ⇒ 这里不再钉死 disposition，
  // 改钉"必须在册 + note 必须把体内真实效果与为什么不实现写清楚 + 仍标 unjustified 就必须带票"。
  const byOp = new Map(report.entries.map((e) => [e.opcode, e]));
  for (const op of [0x244, 0x325, 0x10c, 0x324]) {
    const e = byOp.get(op);
    assert.ok(e, `0x${op.toString(16)}（体内有真实效果的 no-op）不许从 opcode-gaps.json 里消失`);
    assert.ok(
      (e.note ?? '').length >= 40,
      `0x${op.toString(16)} 的 note 必须写清体内真实效果 / 为什么不实现（当前 ${(e.note ?? '').length} 字）`,
    );
    if (e.disposition === 'engine-internal-unjustified') {
      assert.ok(e.ticket, `0x${op.toString(16)} 仍标 unjustified ⇒ 必须带票（不许静默搁置）`);
    }
  }
  assert.ok(report.entries.length > 0 && report.corpusKinds > 200, `语料口径异常：kinds=${report.corpusKinds}`);
});

/**
 * ★**文档模型（2026-09）**：生成物只渲染真源 `note` 的**一句话**，不是全文。
 *
 * 背景：`note` 是审计轨（71 条 ≈ 80 KB，含体证叙事 + 逐轮沿革）。此前 `renderGapMd` 把 `e.note`
 * 逐字塞进 §§2–6 的表格单元 ⇒ 生成物 **92.8% 的字节**都是它，而其中大部分是"当初怎么想错了"的沿革，
 * 对"现在该怎么处置"没有导航价值。现在改成裁到 120 字 + 指回 JSON（`gaps.js --show <opcode>`）。
 *
 * 本守卫是**反回归**：只要有人把全文渲染回来，就红。
 */
test('★生成物只渲染 note 的一句话（全文留在 JSON）', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs-new/03-engine/opcode-gaps.md'), 'utf8');
  const reg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'analysis/opcode-gaps.json'), 'utf8'),
  ) as { entries: { opcode: number; note: string }[] };
  const norm = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  const big = reg.entries.filter((e) => norm(e.note).length > 400);
  assert.ok(big.length >= 20, `样本太少（${big.length} 条 >400 字），守卫失去辨别力`);
  const leaked = big.filter((e) => md.includes(norm(e.note).slice(0, 240))).map((e) => `0x${e.opcode.toString(16)}`);
  assert.deepEqual(leaked, [], `这些条目的 note 全文漏进 md 了（应由 summarize() 裁剪）：${leaked.join(' ')}`);
});

/**
 * ★**`partial` 处置位的棘轮**（`tickets/T-0149`）。
 *
 * 为什么需要它：disposition 此前只回答「**注册了没有**」（`unimplemented` / `engine-internal` / `implemented` / `deferred`），
 * 而本次审计（`docs-new/99-records/2026-09-impl-audit/`，436 条）里绝大多数缺口落在「**已注册、但缺分支 / 缺消费端 / 只是近似**」——
 * 一旦写成 `implemented` 就再没人回来核对。`partial` 就是给这一类的一等处置位：**必须**逐条带 `missing[]`
 * （`{what, ticket, raw}`：缺哪条分支/能力、承接它的票、引擎行号或单一段行区间）。
 *
 * 本测试**直接读真源 JSON**（不依赖生成器的 `problems`），所以哪怕有人绕过生成器手改也拦得住：
 *  ① 处置值必须在允许集合内（复查 `unimplemented`/`engine-internal(-unjustified)`/`implemented`/`deferred`/`partial`）；
 *  ② `partial` 的 `missing[]` 不许空/缺字段；
 *  ③ `missing[].ticket` 必须形如 `T-\d{4}` 且在 `tickets/<id>/ticket.json` 真实存在（票被删 ⇒ 红）；
 *  ④ `missing[].raw` 必须匹配 `^\d+(-\d+)?$`（只允许单一行号或单一段行区间）；
 *  ⑤ `missing[]` 只能挂在 `partial` 上（"还缺东西"不许藏在 `implemented` 里）。
 *
 * ★这是**棘轮**：它只要求"标了 partial 就得说清缺什么"，不要求条数增长；反过来也不许用
 * "删 missing 条目 / 改 disposition=implemented" 消红（那要先真的把缺口修掉）。
 */
test('★缺口台账 `partial` 棘轮：missing[] 必须齐备、票号真实存在、raw 合法', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/opcode-gaps.json'), 'utf8')) as {
    entries: GapEntry[];
    dispositions?: Record<string, string>;
  };
  const ALLOWED = new Set(['unimplemented', 'engine-internal', 'engine-internal-unjustified', 'implemented', 'deferred', 'partial']);

  const ticketOk = (id: string) => fs.existsSync(path.join(ROOT, 'tickets', id, 'ticket.json'));
  const problems: string[] = [];
  let partialOps = 0;
  let missingItems = 0;

  for (const e of reg.entries) {
    const hex = `0x${e.opcode.toString(16)}`;
    if (!ALLOWED.has(e.disposition)) problems.push(`${hex}：disposition 不在允许集合内（${e.disposition}）`);
    const miss = e.missing;
    if (e.disposition !== 'partial') {
      if (Array.isArray(miss) && miss.length) {
        problems.push(`${hex}：disposition=${e.disposition} 却带 ${miss.length} 条 missing[] ⇒ 要么改 partial，要么删掉`);
      }
      continue;
    }
    partialOps++;
    if (!Array.isArray(miss) || miss.length === 0) {
      problems.push(`${hex}：标为 partial 但 missing[] 为空/缺失`);
      continue;
    }
    miss.forEach((m, i) => {
      missingItems++;
      if (typeof m?.what !== 'string' || m.what.trim().length < 8) problems.push(`${hex}：missing[${i}].what 缺/太短`);
      if (typeof m?.ticket !== 'string' || !/^T-\d{4}$/.test(m.ticket)) {
        problems.push(`${hex}：missing[${i}].ticket 格式错（${JSON.stringify(m?.ticket)}）`);
      } else if (!ticketOk(m.ticket)) {
        problems.push(`${hex}：missing[${i}].ticket=${m.ticket} 在 tickets/ 下不存在`);
      }
      if (typeof m?.raw !== 'string' || !/^\d+(-\d+)?$/.test(m.raw)) {
        problems.push(`${hex}：missing[${i}].raw 不匹配 ^\\d+(-\\d+)?$（${JSON.stringify(m?.raw)}）`);
      }
    });
  }

  assert.deepEqual(problems, [], `partial 棘轮失败：\n  - ${problems.join('\n  - ')}`);

  // 台账必须**真的**用上这个处置位（否则棘轮失去辨别力 —— 与"md 只渲染一句话"那条哨兵同一思路）
  assert.ok(partialOps >= 20, `partial 条目太少（${partialOps} 条），棘轮失去辨别力（T-0149 首批应 ≥20）`);
  assert.ok(missingItems >= partialOps, `missing 条目数（${missingItems}）应 ≥ partial opcode 数（${partialOps}）`);
  // 处置枚举的**文档侧**也要有：真源 `dispositions` 里必须解释 partial
  assert.ok(reg.dispositions?.partial, 'analysis/opcode-gaps.json 的 dispositions 必须解释 partial（口径写在真源里）');
});

test('★缺口台账 `partial`：md §7 的每条 missing 都进了生成物（谁都不许只活在心里）', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/opcode-gaps.json'), 'utf8')) as { entries: GapEntry[] };
  const md = fs.readFileSync(path.join(ROOT, 'docs-new/03-engine/opcode-gaps.md'), 'utf8').replace(/\\\|/g, '|');
  assert.ok(md.includes('## 7. 部分实现'), 'md 必须有「部分实现」段（否则 partial 在生成物里不可见）');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const missed: string[] = [];
  for (const e of reg.entries) {
    if (e.disposition !== 'partial') continue;
    for (const m of e.missing ?? []) {
      const what = norm(String(m.what)).slice(0, 60);
      if (!md.includes(what)) missed.push(`0x${e.opcode.toString(16)} → ${what}`);
    }
  }
  assert.deepEqual(missed, [], `这些 partial 缺口没进生成物：\n  - ${missed.join('\n  - ')}`);
});
