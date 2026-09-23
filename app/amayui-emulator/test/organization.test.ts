/** @tier T0 @kind ratchet @subsystem ledger */
/**
 * **测试分类法的守卫** —— 把"分类"从"一份会腐烂的说明"变成"一条会红的断言"。
 *
 * 规则实现只有一份：`test/orgRules.ts`（执行入口 `test/run.ts` 用的是同一份），
 * 所以"守卫说没问题"与"`npm run test:fast` 选出来的集合"永远一致。
 *
 * 三条硬规则（见 `docs-new/04-app/test-organization.md`）：
 *   - **R1 声明齐全**：每个 `*.test.ts` 首行必须有合法 `@tier/@kind/@subsystem`；
 *   - **R2 档位诚实**：声明 `T0` 的文件**不得**依赖未入库的真游戏资源
 *     （import 语料装载器 / 出现资源目录字面量）—— 这是"干净 clone 上跑得起来吗"的机械判据；
 *   - **R3 不许零断言空跑**：`console.warn('[skip]…')` 后裸 `return`（不调 `t.skip()`）会被
 *     node:test 记为 **pass** ⇒ 谎报绿灯。这正是 T-0124 审计查出的最严重一类假绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KINDS, SUBSYSTEMS, TIERS,
  checkOrganization, corpusEvidence, groupByAxis, readPragma, scanTests, silentSkipReturns,
} from './orgRules.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const files = scanTests(TEST_DIR);
const problems = checkOrganization(files);

test('R1 声明齐全：每个测试文件首行都有合法 @tier/@kind/@subsystem', () => {
  const bad = problems.filter((p) => p.rule === 'R1-pragma');
  assert.deepEqual(bad, [], `缺分类头的文件：\n${bad.map((b) => `${b.file} — ${b.detail}`).join('\n')}`);
  // 声明必须紧贴文件首（不许漂到文件中段 —— 否则"这个文件属于哪档"要靠翻）
  const drifted = files.filter((f) => (f.pragma?.line ?? 999) > 4);
  assert.deepEqual(drifted.map((f) => `${f.name}:${f.pragma?.line}`), [], '分类头必须在前 4 行内');
});

test('R2 档位诚实：T0 不得依赖未入库的真游戏资源', () => {
  const bad = problems.filter((p) => p.rule === 'R2-tier');
  assert.deepEqual(bad, [], `误标 T0 的文件：\n${bad.map((b) => `${b.file} — ${b.detail}`).join('\n')}`);
  // 反向自检（防"规则把一切都判成有证据"导致 R2 恒过）：已声明 T1 的必须真有证据
  const t1WithoutEvidence = files.filter((f) => f.pragma?.tier === 'T1' && corpusEvidence(f.src).length === 0);
  assert.deepEqual(
    t1WithoutEvidence.map((f) => f.name), [],
    '声明 T1 但机械判据看不出资产依赖 —— 要么改回 T0，要么说明为什么（避免 T1 变成"杂物抽屉"）',
  );
});

test('R3 不许零断言空跑：禁止 console.warn([skip]) + 裸 return', () => {
  const bad = problems.filter((p) => p.rule === 'R3-silent-skip');
  assert.deepEqual(bad, [], `零断言空跑的文件：\n${bad.map((b) => `${b.file} — ${b.detail}`).join('\n')}`);
  // 自检：这条规则必须真的能红（否则等于没有）—— 用一段合成源码验证判别力
  const positive = "test('x', () => {\n  console.warn('[skip] 没有资产');\n  return;\n});\n";
  assert.deepEqual(silentSkipReturns(positive), [2], 'silentSkipReturns 应能识别出第 2 行');
  const negative = "test('x', (t) => {\n  if (!ok) { t.skip('没有资产'); return; }\n});\n";
  assert.deepEqual(silentSkipReturns(negative), [], '合法的 t.skip 不得被误报');
});

test('轴的取值都在白名单内，且每个子系统/档位/性质都真的被用到', () => {
  for (const f of files) {
    assert.ok(f.pragma, `${f.name} 无分类头`);
    assert.ok(TIERS.includes(f.pragma!.tier), `${f.name} 非法 tier ${f.pragma!.tier}`);
    assert.ok(KINDS.includes(f.pragma!.kind), `${f.name} 非法 kind ${f.pragma!.kind}`);
    assert.ok(SUBSYSTEMS.includes(f.pragma!.subsystem), `${f.name} 非法 subsystem ${f.pragma!.subsystem}`);
  }
  const { byTier, byKind, bySubsystem } = groupByAxis(files);
  for (const s of SUBSYSTEMS) {
    assert.ok(bySubsystem[s]?.length, `子系统 ${s} 一个文件都没有 —— 要么删掉它，要么归错类了`);
  }
  for (const k of KINDS) assert.ok(byKind[k]?.length, `kind ${k} 一个文件都没有`);
  // T2 允许为空：真机档（Electron）目前由工具链承担（`npm run shot` / `dbg:srv`），见 tickets/T-0128。
  for (const t of ['T0', 'T1'] as const) assert.ok(byTier[t]?.length, `tier ${t} 一个文件都没有`);
});

test('默认档有实质覆盖：T0 必须占多数，且 T1 档有明确边界', () => {
  const { byTier } = groupByAxis(files);
  const t0 = byTier['T0']?.length ?? 0;
  const t1 = byTier['T1']?.length ?? 0;
  assert.ok(t0 > t1, `T0(${t0}) 应远多于 T1(${t1})，否则分档没意义`);
  assert.ok(t1 > 0, 'T1 档不应为空（真语料 E3 是判据最硬的一档，见 T-0124 §4.4）');
  assert.ok(t0 + t1 === files.length, '每个文件必须恰好属于一个档位');
});

test('分类结果与审计结论一致（防止有人顺手把档位改松）', () => {
  // T-0124 实测：最贵的 12 个文件占串行成本 73%，它们**必须**都在 T1（否则默认档不可能快）。
  // ★注意 `mesh-vertex-quad` 虽然单跑 9.7 s，但它**不依赖任何未入库资源**（只 import
  //   `headlessScene`/`drawItem`，正文里的 `raw 33865` 是反编译行号引用）⇒ 它按规则留在 T0。
  //   这正是"档位按依赖判、不按耗时判"的一个反例：慢 ≠ 需要资产。
  const mustBeT1 = [
    'config1-chain.test.ts', 'keyboard-scenario-menu.test.ts', 'adv-name-color-chain.test.ts',
    'scene-report.test.ts', 'text-style-snapshot.test.ts', 'game-start-chain.test.ts',
    'live2d-enabled-flag.test.ts', 'gallery-bgm-list.test.ts',
  ];
  const wrong = mustBeT1.filter((n) => {
    const f = files.find((x) => x.name === n);
    return !f || f.pragma?.tier !== 'T1';
  });
  assert.deepEqual(wrong, [], '这些实测最贵的文件必须留在 T1 档');
});

test('readPragma 能识别合法声明、拒绝缺声明与非法取值', () => {
  assert.deepEqual(readPragma('/** @tier T1 @kind core @subsystem save */\n'), {
    tier: 'T1', kind: 'core', subsystem: 'save', line: 1,
  });
  assert.equal(readPragma('// 没有声明\n'), null);
  assert.equal(readPragma('/** @tier T9 @kind core @subsystem save */'), null, '非法 tier 必须判 null');
  assert.equal(readPragma('/** @tier T0 @kind wat @subsystem save */'), null, '非法 kind 必须判 null');
  assert.equal(readPragma('/** @tier T0 @kind core @subsystem nope */'), null, '非法 subsystem 必须判 null');
});
