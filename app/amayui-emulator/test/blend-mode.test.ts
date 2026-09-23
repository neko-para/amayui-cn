/** @tier T0 @kind core @subsystem render */

/**
 * **混合模式模型**（`src/renderer/scene/blend.ts`）—— `tickets/T-0017` 的守卫。
 *
 * 引擎真源（逐条 raw）：`DrawItem+0x30`（`0x203` op2）与 `MeshEntry[9]`（`0x322` op2）是**同一套
 * 4 值枚举**，由 `sub_4A2D50`（draw-item，raw 123089-123121）/ `sub_49E390`（mesh，raw 119369-119399）/
 * `sub_49E700`（DrawModel，raw 119512-119578）消费；场景默认 = `sub_4535F0`（raw 65855-65889）。
 *
 * 本文件钉三件最容易做错的事：
 *  1. **值 2 是门控的**（只有"当前渲染目标槽的纹理创建模式 == 1"才覆盖，否则**什么都不设**）；
 *  2. **状态会泄漏**（draw-item 的 `0` 不重置 ⇒ 继承前一个 `1/2/3` 的档）；
 *  3. **mesh 画完之后引擎把状态留在 `(ONE,ZERO)`**（raw 119474-119476；`.lst:0049E681`-`0049E6AF`）
 *     ⇒ 其后所有 draw-item 的 `0` 项都继承"覆盖"。这三条都是引擎的**行为**，不是笔误。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blendForSelector,
  blendGateOpen,
  meshBlendForSelector,
  sceneDefaultBlend,
  walkBlendSequence,
  type BlendEnv,
} from '../src/renderer/scene/blend.js';

/** 造一个环境：`rt` = 当前渲染目标槽；`modes` = 槽 → 创建模式。 */
const env = (rt = -1, modes: Record<number, number> = {}): BlendEnv => ({
  renderTargetSlot: rt,
  slotMode: (slot) => modes[slot],
});

test('T-0017 选择子表（draw-item）：1=加算 / 3=减算 / 0 与 ≥4=不改 / 2=门控', () => {
  const closed = env(); // 后台缓冲 ⇒ 门关
  assert.equal(blendForSelector(1, closed), 'add');
  assert.equal(blendForSelector(3, closed), 'subtract');
  assert.equal(blendForSelector(0, closed), null, '0 = 默认 ⇒ **不改状态**（继承）');
  assert.equal(blendForSelector(4, closed), null, '≥4 与 0 同档');
  assert.equal(blendForSelector(2, closed), null, '★门关时"什么都不设"，不是设成普通 alpha');
  assert.equal(blendForSelector(2, env(3, { 3: 1 })), 'none', '★门开（mode-1 离屏表面）⇒ 覆盖');
});

test('T-0017 门控：`Scene+46456` 槽存在 且 该槽纹理创建模式 **== 1**（mode 2 不算）', () => {
  assert.equal(blendGateOpen(env()), false, '后台缓冲（-1）⇒ 关');
  assert.equal(blendGateOpen(env(3, {})), false, '该槽没有纹理/模式未知 ⇒ 关');
  assert.equal(blendGateOpen(env(3, { 3: 0 })), false, 'mode 0 = 普通纹理 ⇒ 关');
  assert.equal(blendGateOpen(env(3, { 3: 2 })), false, '★mode 2 也是离屏，但引擎的门只认 `== 1`（raw 123111）⇒ 关');
  assert.equal(blendGateOpen(env(3, { 3: 1 })), true);
  assert.equal(blendGateOpen(env(0, { 0: 1 })), true, '槽 0 也可以是渲染目标');
});

test('T-0017 选择子表（mesh/DrawModel）：与 draw-item 只差 `0` 这一档（显式设普通 alpha）', () => {
  const closed = env();
  assert.equal(meshBlendForSelector(0, closed), 'normal', '★mesh 的 0 是**显式** (SRCALPHA, INVSRCALPHA)');
  assert.equal(meshBlendForSelector(9, closed), 'normal', '≥4 同 0 档');
  assert.equal(meshBlendForSelector(1, closed), 'add');
  assert.equal(meshBlendForSelector(3, closed), 'subtract');
  assert.equal(meshBlendForSelector(2, closed), null, '门关 ⇒ 什么都不设');
  assert.equal(meshBlendForSelector(2, env(1, { 1: 1 })), 'none');
});

test('T-0017 场景默认混合（`Scene+1260` / `0x33F`）：2 这一档**没有门控**', () => {
  assert.equal(sceneDefaultBlend(0), 'normal');
  assert.equal(sceneDefaultBlend(1), 'add');
  assert.equal(sceneDefaultBlend(2), 'none', '★`sub_4535F0` raw 65861-65869 无条件 (ONE,ZERO)（与逐项路径不同）');
  assert.equal(sceneDefaultBlend(3), 'subtract');
  assert.equal(sceneDefaultBlend(7), 'normal');
});

test('★T-0017 状态泄漏：draw-item 的 0 继承前一个 1/2/3 的档', () => {
  // ★这一条必须**显式开档**：默认档是"每项从场景默认开始"（真机可见行为，见 `BlendWalkOptions` 的说明）
  const seq = walkBlendSequence(
    [
      { kind: 'item', blend: 0 },
      { kind: 'item', blend: 1 }, // 加算
      { kind: 'item', blend: 0 }, // ★继承加算（引擎 raw 123100-123117 不重置）
      { kind: 'item', blend: 3 }, // 减算
      { kind: 'item', blend: 0 }, // ★继承减算
    ],
    env(),
    0,
    { leakStateAcrossEntries: true },
  );
  assert.deepEqual(seq, ['normal', 'add', 'add', 'subtract', 'subtract']);
});

test('★T-0017 mesh 之后留 (ONE,ZERO)：其后 draw-item 的 0 项继承"覆盖"', () => {
  const seq = walkBlendSequence(
    [
      { kind: 'item', blend: 0 }, // normal
      { kind: 'mesh', blend: 0 }, // mesh 的 0 = 显式 normal
      { kind: 'item', blend: 0 }, // ★mesh 画完留下 (ONE,ZERO) ⇒ none（raw 119474-119476）
      { kind: 'mesh', blend: 1 }, // 加算
      { kind: 'item', blend: 0 }, // ★又留 (ONE,ZERO) ⇒ none
    ],
    env(),
    0,
    { leakStateAcrossEntries: true },
  );
  assert.deepEqual(seq, ['normal', 'normal', 'none', 'add', 'none']);
});

test('★T-0017 门控在真实序列里生效：mode-1 渲染目标里画高亮（值 2）才覆盖', () => {
  const entries = [
    { kind: 'item' as const, blend: 2 }, // 门关 ⇒ 继承（normal）
    { kind: 'item' as const, blend: 0 },
  ];
  assert.deepEqual(walkBlendSequence(entries, env(), 0), ['normal', 'normal']);
  // 同一个序列，只是"正在往槽 2（mode 1）画"⇒ 第一项变成覆盖，且其后继承
  assert.deepEqual(walkBlendSequence(entries, env(2, { 2: 1 }), 0), ['none', 'normal'],
    '★默认档：每项从场景默认开始 ⇒ 第二个 0 项回到 normal（不继承前项的覆盖）');
  assert.deepEqual(walkBlendSequence(entries, env(2, { 2: 1 }), 0, { leakStateAcrossEntries: true }), ['none', 'none'],
    '泄漏档：第二个 0 项继承覆盖');
});

test('★T-0041：2D draw-item 每项都从默认开始 —— `0` 不继承前一项、也不继承 mesh 的 (ONE,ZERO)', () => {
  // 引擎机制：每项一次 `ID3DXSprite::Begin(16)`（raw 123087-123088）按 sprite 默认重设 blend，
  // 引擎的选择子覆盖发生在那之后（raw 123090-123120）⇒ 缺省档 = 引擎事实。
  const seq = walkBlendSequence(
    [
      { kind: 'item', blend: 1 }, // 加算（自成一档）
      { kind: 'item', blend: 0 }, // ⇒ 必须是 normal（不是 add）
      { kind: 'mesh', blend: 0 }, // mesh 画完引擎把状态留在 (ONE,ZERO)
      { kind: 'item', blend: 0 }, // ⇒ 仍必须是 normal（不是 none）
    ],
    env(),
    0,
  );
  // mesh 那一项自己**显式**设默认（`sub_49E390` raw 119397-119400：选择子 0 ⇒ (19,5)+(20,6)）⇒ 'normal'
  assert.deepEqual(seq, ['add', 'normal', 'normal', 'normal'], '每项从默认开始（sprite 的 Begin 重设）');
  // 实验开关（复刻"字面读法"的泄漏）仍然可用，但它**不是**真机行为
  const leaked = walkBlendSequence(
    [
      { kind: 'item', blend: 1 },
      { kind: 'item', blend: 0 },
      { kind: 'mesh', blend: 0 },
      { kind: 'item', blend: 0 },
    ],
    env(),
    0,
    { leakStateAcrossEntries: true },
  );
  assert.deepEqual(leaked, ['add', 'add', 'normal', 'none'], '泄漏档（默认关闭；仅用于对照实验）');
});

test('T-0017 入口档 = 场景默认（`0x33F` 未下发时 = normal，与 emulator 既有行为一致）', () => {
  assert.deepEqual(walkBlendSequence([{ kind: 'item', blend: 0 }], env(), 0), ['normal']);
  assert.deepEqual(walkBlendSequence([{ kind: 'item', blend: 0 }], env(), 1), ['add'], '场景默认加算 ⇒ 首个 0 项就加算');
  assert.deepEqual(walkBlendSequence([{ kind: 'item', blend: 0 }], env(), 2), ['none']);
});

test('T-0017 未建模的追加覆盖（raw 123117-123121）在 holder1164 未定时不生效', () => {
  const base = env();
  assert.equal(blendForSelector(0, base), null, 'holder1164Is1 未给 ⇒ 该条不生效');
  const on: BlendEnv = { ...base, holder1164Is1: true };
  assert.equal(blendForSelector(0, on), 'none', '★条件成立时**无条件**覆盖（连 0 也覆盖）');
  assert.equal(blendForSelector(1, on), 'none', '覆盖压过选择子的结果（raw 123117 在分支之后）');
  assert.equal(blendForSelector(0, { ...on, renderTargetSlot: 2, slotMode: () => 1 }), null, '画到离屏目标时不走这条');
  assert.equal(blendForSelector(0, { ...on, sceneFrozen: true }), null, '冻结总闸非零时不走这条');
});

/**
 * ★**指令 → 场景模型 → 混合状态机**的端到端（E2）：`0x1F8`/`0x20D`/`0x33F`/`0x203`/`0x322`
 * 真的走一遍 handler（`makeCtx` → `OPS` → `HeadlessScene`），断言:
 *  - 渲染目标槽与槽创建模式真的落进模型（值 2 门控的两个输入）；
 *  - `Item.blend` / `MeshObj.blend` 真的被写进模型（闸门 C 那条"接线"从指令侧再钉一次）；
 *  - 用 `walkBlendSequence` 走一遍真实模型 ⇒ 门控与状态泄漏都生效。
 */
test('★T-0017 端到端：create-texture(mode 1) + i20d + i33f + 选择子 → 混合档正确', async () => {
  const { HeadlessScene } = await import('../src/renderer/headlessScene.js');
  const { Engine } = await import('../src/vm/engine.js');
  const { InputManager } = await import('../src/vm/input.js');
  const { Frame } = await import('../src/vm/engine.js');
  const { makeCtx } = await import('../src/vm/step.js');
  const { OPS, NATIVE_OPS } = await import('../src/vm/ops.js');
  const { im, instr } = await import('./harness.js');

  const scene = new HeadlessScene({});
  const e = new Engine(scene as never, new InputManager());
  const f = new Frame();
  const run = (op: number, args: ReturnType<typeof im>[]): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应已实现`);
    h!(makeCtx(e, f, instr(op, args), scene as never, () => {}));
  };

  run(0x1f8, [im(3), im(320), im(240), im(1)]); // create-texture slot=3 320x240 **mode=1**（离屏渲染目标）
  run(0x20d, [im(3)]); // set-render-target slot=3
  run(0x33f, [im(1), im(0xff), im(0xffffff)]); // 场景默认混合 = 1（加算）
  run(0x203, [im(0x1000), im(2), im(0xff), im(0xffffff)]); // draw-item：blend=2（门控覆盖）
  run(0x322, [im(0x2000), im(1), im(0xff), im(0xffffff)]); // mesh：entry[9]=1（加算）

  assert.equal(scene.scene.render4.renderTargetSlot, 3, '0x20D 的 op1 必须落进渲染目标槽');
  assert.equal(scene.scene.render4.slotModes.get(3), 1, '0x1F8 的 op4 必须落进槽创建模式（混合门控的输入）');
  assert.equal(scene.scene.render4.sceneBlend, 1, '0x33F 的 op1 必须落进场景默认混合');
  assert.equal(scene.scene.drawItems.get(0x1000)?.blend, 2, '0x203 的 op2 必须落进 Item.blend（闸门 C 的接线）');
  assert.equal(scene.scene.meshes.get(0x2000)?.blend, 1, '0x322 的 op2 必须落进 MeshObj.blend（闸门 C 的接线）');

  const env2: BlendEnv = { renderTargetSlot: scene.scene.render4.renderTargetSlot, slotMode: (s) => scene.scene.render4.slotModes.get(s) };
  // 顺序 = 绘制顺序：item(2，门开⇒覆盖) → mesh(1，加算，画完留覆盖)
  assert.deepEqual(
    walkBlendSequence(
      [
        { kind: 'item', blend: scene.scene.drawItems.get(0x1000)!.blend },
        { kind: 'mesh', blend: scene.scene.meshes.get(0x2000)!.blend },
      ],
      env2,
      scene.scene.render4.sceneBlend,
    ),
    ['none', 'add'],
    '★门控成立（mode-1 渲染目标）⇒ 值 2 覆盖；mesh 的值 1 加算',
  );
  // 同一批条目，但把渲染目标切回后台缓冲 ⇒ 值 2 不再覆盖（继承场景默认 = 加算）
  assert.deepEqual(
    walkBlendSequence(
      [
        { kind: 'item', blend: 2 },
        { kind: 'mesh', blend: 1 },
      ],
      { ...env2, renderTargetSlot: -1 },
      scene.scene.render4.sceneBlend,
    ),
    ['add', 'add'],
    '★门关 ⇒ 值 2 什么都不设（继承场景默认的加算）',
  );
});
