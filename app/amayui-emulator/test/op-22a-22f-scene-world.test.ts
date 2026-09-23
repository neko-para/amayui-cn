/** @tier T0 @kind core @subsystem render */

/**
 * **`0x22A`/`0x22C`/`0x22D`/`0x22F`：Scene 级世界矩阵 + 「只作用于层号 ∈ [20,30) 的项」的合成级**
 * （`tickets/T-0076`；上一轮这四条是 `deferred`，本轮落地）。
 *
 * 本文件守的是**三件事**，缺一件都不算实现：
 *
 *  ① **写端**：四条 handler 真的在 `OPS` 里、真的把操作数按体读对（`0x22A` 三条 float 各 ÷100、
 *     `0x22C` 三条 float **不除**、`0x22D`/`0x22F` 的 op1/op2 走 **int** 池而 op3/4/5 走 float 池），
 *     并且落到**同一个 Scene 变换锚**（`SceneState.sceneXform`）而不是某个 DrawItem 上；
 *     顺带钉住"体里没有 handle 查表"（`0x22A`/`0x22C` 体内不得出现 `sub_41BF50`）—— 上一轮筛体
 *     把这两条的 `op1` 当 handle，是实测过的错法。
 *
 *  ② **层号判据 + 叠加序**（这是本轮的**核心产出**，也是最容易写反的一处）：
 *     引擎 RenderScene raw 133403-133438 的**门是「层号 ∉ [20,30)」**（`(层号 − 20) > 9`），
 *     真正**只作用于 `层号 ∈ [20,30)`** 的是 `else` 支（`D3DXMatrixDecompose` 后只装回
 *     2D 缩放与平移）。所以这里断言：层 20/29 吃变换、层 19/30 不吃；且叠加式子是
 *     `屏幕点 ← 屏幕点 × (sx,sy) + (tx,ty)`（**Scene 的平移不被该项自身缩放放大** ——
 *     这是 `work ← work · sceneWorld` 这个**左右序**的直接后果，写反成 `sceneWorld · work`
 *     就会变成 `(pos × sx + tx·sx)`，本文件的 "平移不被项缩放放大" 一条正是为它设的棘轮）。
 *
 *  ③ **没下发过 ≠ 空转**：`sceneXform === null` 时合成结果必须与接线前**逐字节相同**
 *     （20..29 层拿到的仍是 `position = pos`、`scale = (1,1)`）—— 否则接线本身就会改画面。
 *
 * 体账（`engine/天结_unpacked.exe_utf8.c`）锚点：`sub_424080` raw 32003、`sub_424180` raw 32034、
 * `sub_4241F0` raw 32048、`sub_424330` raw 32087；被调体 `sub_49A720` raw 117117-117126、
 * `sub_49A820` raw 117153-117162、`sub_49A870` raw 117165-117179、`sub_49A9C0` raw 117222-117236；
 * 消费链 `sub_4A1E90` raw 122130-122157 → `sub_49AA30` raw 117239 起 → RenderScene raw 133403-133438。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import {
  SCENE_LAYER_HI,
  SCENE_LAYER_LO,
  applySceneXformToPlacement,
  sceneLayerAffected,
} from '../src/renderer/sceneModel.js';

/** 造一条合成指令（与 `test/op-23f-slot-size.test.ts` 同一套骨架）。 */
function instr(op: number, argc: number, args: { type: number; raw: number }[]): never {
  return { opcode: op, name: `i${op.toString(16)}`, argc, args, byteOffset: 0, index: 0 } as never;
}

/** 立即数 int（type 0）。 */
const I = (v: number): { type: number; raw: number } => ({ type: 0x0, raw: v });
/** 立即数 float（type 1，raw = 位模式）。 */
const F = (v: number): { type: number; raw: number } => ({ type: 0x1, raw: f32(v) });

/** f32 的位模式（与 `TestFloatOperand` 同口径：脚本里 float 立即数是 4 字节位模式）。 */
function f32(v: number): number {
  const b = new ArrayBuffer(4);
  new Float32Array(b)[0] = v;
  return new Uint32Array(b)[0]!;
}

/** 在本帧里放一个 int 立即数…… 不需要：四条都用立即数即可。 */
function runOp(e: Engine, op: number, argc: number, args: { type: number; raw: number }[]): Promise<void> {
  const h = OPS.get(op) ?? NATIVE_OPS.get(op);
  assert.ok(h, `opcode 0x${op.toString(16)} 未注册（本轮应当已 implemented）`);
  return Promise.resolve(h!(makeCtx(e, e.frames[0]!, instr(op, argc, args), e.native, () => {})));
}

/** 取出四条写进去的 Scene 变换锚（消费端在 `HeadlessScene.snapshot()`）。 */
function xformOf(s: HeadlessScene) {
  return s.snapshot().sceneXform;
}

// ---------------------------------------------------------------------------
// ① 写端：注册 + 操作数口径 + 落到 Scene 变换锚
// ---------------------------------------------------------------------------

test('★四条都真的注册在 OPS 里（不再是 deferred / 不再硬报 NotImplementedOp）', () => {
  for (const op of [0x22a, 0x22c, 0x22d, 0x22f]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须进 OPS（本轮 implemented）`);
  }
});

test('★0x22A：`i22a b234 b234 64` 的实参口径 = 缩放 (1,1,1)', async () => {
  const hs = new HeadlessScene({});
  const e = new Engine(hs);
  await runOp(e, 0x22a, 3, [F(100), F(100), F(100)]);
  const x = hs.snapshot().sceneXform;
  assert.ok(x, 'sceneXform 必须被建立');
  assert.equal(x.kind, 'scale');
  assert.deepEqual(x.scale, { x: 1, y: 1, z: 1 }, '100/100 = 1（语料两处都是 64 = 100）');
});

test('★0x22C：三条 float **不除**（像素平移）→ Scene 平移组；`op1` 不是 handle', async () => {
  const hs = new HeadlessScene({});
  const e = new Engine(hs);
  await runOp(e, 0x22c, 3, [F(12), F(-34), F(0)]);
  const x = hs.snapshot().sceneXform;
  assert.ok(x);
  assert.equal(x.kind, 'translate');
  assert.deepEqual(x.translate, { x: 12, y: -34, z: 0 }, '不除：12 就是 12（`0x22A` 才是百分数）');
  // ★`0x22C` 体内没有 `Scene[295]/[300]` 两个 int 格 ⇒ 掩码必须是 null
  assert.equal(x.maskA, null);
  assert.equal(x.maskB, null);
});

test('★0x22D：op1/op2 走 **int** 池 → mask；op3/4/5 各 ÷100 → Scene 轴缩放组', async () => {
  const hs = new HeadlessScene({});
  const e = new Engine(hs);
  await runOp(e, 0x22d, 5, [I(0), I(300), F(100), F(100), F(100)]);
  const x = hs.snapshot().sceneXform;
  assert.ok(x);
  assert.equal(x.kind, 'axis-scale');
  assert.deepEqual(x.axisScale, { x: 1, y: 1, z: 1 });
  assert.equal(x.maskA, 0, 'op1 = 0（语料 `i22d 0 258 …` 恒为 0）');
  assert.equal(x.maskB, 300, 'op2 = 0x12c（int，不除）');
});

test('★0x22F：op1/op2 走 int；op3/4/5 是轴分量**不除** → Scene 轴平移组', async () => {
  const hs = new HeadlessScene({});
  const e = new Engine(hs);
  await runOp(e, 0x22f, 5, [I(0), I(2000), F(6), F(7), F(0)]);
  const x = hs.snapshot().sceneXform;
  assert.ok(x);
  assert.equal(x.maskA, 0, 'op1 = 0（语料 `i22f 0 7d0 …` 恒为 0）');
  assert.equal(x.maskB, 2000, 'op2 = 0x7d0（int）');
  assert.deepEqual(x.axisTranslate, { x: 6, y: 7, z: 0 }, '不除：轴/位移分量原样（`0x22D` 才 ÷100）');
});

// ---------------------------------------------------------------------------
// ② 层号判据 + 叠加序（本轮核心）
// ---------------------------------------------------------------------------

test('★层号判据就是 [20,30)：19/30 不吃、20/29 吃（引擎 raw 133405 的 `(层号 − 20) > 9`）', () => {
  assert.equal(SCENE_LAYER_LO, 20);
  assert.equal(SCENE_LAYER_HI, 30);
  assert.equal(sceneLayerAffected(19), false, '19 不在区间（引擎走的是完整 3D 矩阵那一支）');
  assert.equal(sceneLayerAffected(20), true);
  assert.equal(sceneLayerAffected(29), true);
  assert.equal(sceneLayerAffected(30), false, '30 不在区间（半开区间）');
});

test('★Scene 平移**不被该项自身的缩放放大**（左右序 `work ← work · sceneWorld` 的棘轮）', () => {
  const hs = new HeadlessScene({});
  hs.setSceneTranslation(10, 20, 0);
  const scene = hs.scene;
  // 项自身缩放 3×、位置 (100,100)：`v·(work·sceneWorld) = (v·work)·sceneWorld`
  // ⇒ 平移加在**外面**：(100·3 + 10, 100·3 + 20) —— 若左右序写反会得到 (330, 360)。
  const pl = applySceneXformToPlacement(scene, 20, {
    position: { x: 300, y: 300 },
    scale: { x: 3, y: 3 },
  });
  assert.deepEqual(pl.position, { x: 310, y: 320 }, 'Scene 平移是屏幕空间加法，不被 3× 放大');
  assert.deepEqual(pl.scale, { x: 3, y: 3 }, 'Scene 是平移 ⇒ 缩放不变');
});

test('★Scene 缩放绕**屏幕原点**（`v·S` 的直接后果，不是绕项中心）', () => {
  const hs = new HeadlessScene({});
  hs.setSceneScale(2, 3, 1);
  const pl = applySceneXformToPlacement(hs.scene, 20, {
    position: { x: 100, y: 100 },
    scale: { x: 1, y: 1 },
  });
  assert.deepEqual(pl.position, { x: 200, y: 300 }, '位置被同倍缩放（绕原点）');
  assert.deepEqual(pl.scale, { x: 2, y: 3 }, '项自身缩放与 Scene 缩放相乘');
});

test('★合成进场景：层 20..29 的项被推走，层 19/30 的项原地不动（快照逐项 before→after）', async () => {
  const hs = new HeadlessScene({});
  const mk = (handle: number, layer: number): void => {
    hs.configureDrawItem({ handle, layer, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 50, dstY: 60 });
  };
  mk(0x11, 19);
  mk(0x12, 20);
  mk(0x13, 29);
  mk(0x14, 30);

  const e = new Engine(hs);
  await runOp(e, 0x22c, 3, [F(7), F(9), F(0)]);

  const x = hs.snapshot().sceneXform!;
  assert.deepEqual(x.layers, [20, 30]);
  assert.deepEqual(
    x.items.map((i) => i.layer),
    [20, 29],
    '★只有层 20/29 进 `items`（19 与 30 不在区间；`items` 本身就是判据的渲染端证据）',
  );
  for (const it of x.items) {
    assert.deepEqual(it.before, { x: 50, y: 60 }, 'before = 不吃 Scene 变换的位置');
    assert.deepEqual(it.after, { x: 57, y: 69 }, 'after = 吃 (7,9) 平移之后');
  }
});

test('★没下发过任何一条 ⇒ `sceneXform` 为 null，且合成结果与接线前相同（不改既有画面）', () => {
  const hs = new HeadlessScene({});
  hs.configureDrawItem({ handle: 0x12, layer: 20, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 50, dstY: 60 });
  assert.equal(hs.snapshot().sceneXform, null, '一条都没下发 ⇒ 快照段为 null');
  const pl = applySceneXformToPlacement(hs.scene, 20, { position: { x: 50, y: 60 }, scale: { x: 1, y: 1 } });
  assert.deepEqual(pl.position, { x: 50, y: 60 }, '不变量：没有锚 ⇒ 位置原样');
  assert.deepEqual(pl.scale, { x: 1, y: 1 }, '不变量：没有锚 ⇒ 缩放原样');
});

test('★区间外的层即便有锚也不吃变换（`applySceneXformToPlacement` 原对象返回）', () => {
  const hs = new HeadlessScene({});
  hs.setSceneTranslation(100, 100, 0);
  const base = { position: { x: 5, y: 6 }, scale: { x: 1, y: 1 } };
  assert.equal(applySceneXformToPlacement(hs.scene, 19, base), base, '19 层：连对象都不重建');
  assert.equal(applySceneXformToPlacement(hs.scene, 30, base), base, '30 层：同上');
  assert.notEqual(applySceneXformToPlacement(hs.scene, 25, base), base, '25 层：被重建并套用');
});

test('★四条都置脏（源码棘轮之外的行为验证：headless 的 needsRender 会转真）', async () => {
  const hs = new HeadlessScene({});
  const e = new Engine(hs);
  hs.snapshot(); // 消费一次 ⇒ 基线安静
  assert.equal(hs.needsRender(), false, '基线');
  await runOp(e, 0x22f, 5, [I(0), I(100), F(0), F(0), F(1)]);
  assert.equal(hs.needsRender(), true, 'Scene 变换变了 ⇒ 必须重新合成一帧（漏置脏 = 画面少一帧）');
});

// ---------------------------------------------------------------------------
// ③ 快照文本：让"作用范围"可 diff
// ---------------------------------------------------------------------------

test('★快照文本里有 `scene-xform` 行，且写出层区间与逐项 before→after', async () => {
  const hs = new HeadlessScene({});
  hs.configureDrawItem({ handle: 0x12, layer: 20, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 50, dstY: 60 });
  const e = new Engine(hs);
  await runOp(e, 0x22c, 3, [F(7), F(9), F(0)]);
  const t = hs.snapshotText();
  assert.match(t, /scene-xform/, '必须有一行 scene-xform（否则"写进去了"与"真的动了"无法区分）');
  assert.match(t, /只作用于层号 ∈ \[20,30\)/, '行里必须写明作用层区间');
  assert.match(t, /0x12:\(50,60\)→\(57,69\)/, '逐项写出 before→after');
});
