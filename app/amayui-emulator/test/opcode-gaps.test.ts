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
  // （emulator 无 Effect3D 子系统 ⇒ 有据跳过）、`0x244` 另一路在办 ⇒ 这里不再钉死 disposition，
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
