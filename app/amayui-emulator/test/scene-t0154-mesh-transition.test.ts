/** @tier T0 @kind core @subsystem render */

/**
 * **T-0154 的网格项 / 转场建层批**（P3 `0x320` 三条 + P3 `0x321` + P2 `0x223`）。
 *
 * 引擎依据全部逐字核过（raw 号写在用例里）；修前行为写在注释里 ⇒ 这些断言在修前**必红**
 * （红→绿证据见 `tickets/T-0154/changes-c154.md` 的命令段）。
 *
 * ★为什么这里守的是"**项是否存在**"而不只是"画不画"：`0x320`/`0x321` 都走
 * `sub_4AAB80`（缺失即建）到**同一个容器** `Scene+1064`（`_this + 266`），而
 * `scEnsureMesh` 的 `created`、快照的网格清单、`0x32A` 的逐槽释放都按"项存在与否"分支
 * ⇒ 只改 `render4.meshAttrs` 会让这些路径与引擎分叉（画面看不出来，台账/测试看得出来）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newSceneState } from '../src/renderer/scene/state.js';
import {
  SCENE_SCRATCH_SLOT_A,
  SCENE_SCRATCH_SLOT_B,
  sceneScratchMode,
} from '../src/renderer/scene/effectLevel.js';
import {
  scCreateMesh,
  scEnsureMesh,
  scEnsureTransitionLayer,
  scSetMeshEntryAttr,
  scSetRenderTarget,
  scSetTransition,
  scTransitionDefaultRecord,
} from '../src/renderer/sceneModel.js';

/** 一个 n 顶点的 spec（与语料 `0x320` 站点同形：x/y 数组 + 顶点色）。 */
function specFor(handle: number, vcount: number): {
  handle: number;
  layer: number;
  vcount: number;
  verts: { x: number; y: number; z: number; u: number; v: number }[];
  baseColors: number[];
} {
  const verts = [];
  for (let i = 0; i < Math.max(0, vcount); i++) {
    verts.push({ x: i * 10, y: i * 10, z: 0, u: 0, v: 0 });
  }
  return { handle, layer: handle, vcount, verts, baseColors: new Array(Math.max(0, vcount)).fill(0xffffffff) };
}

// ---------------------------------------------------------------------------
// ① P3 `0x320`：顶点数下限是 **1**；`vcount <= 0` 连项都不建、也不碰已有项
// ---------------------------------------------------------------------------

test('★0x320：`vcount = 1`/`2` 也要建几何并置 bit0（引擎门是 `vcount > 0`，raw 41037）', () => {
  const s = newSceneState();
  const m1 = scCreateMesh(s, specFor(0x11, 1));
  // ★修前：判据写成 `vcount > 0 && verts.length >= 3` ⇒ `vcount = 1` 时既不写 verts 也不置 bit0。
  assert.equal(m1.flags & 1, 1, '★`sub_4A2280` 成功 ⇒ `*v21 |= 1u`（raw 132758）；`a11 >= 4` 只是循环门');
  assert.equal(m1.verts.length, 1, '1 个顶点的几何照样建出来');
  assert.equal(s.meshes.has(0x11), true);

  const m2 = scCreateMesh(s, specFor(0x12, 2));
  assert.equal(m2.flags & 1, 1, '`vcount = 2` 也有几何（语料 `SETPOLYGON.txt:52` 的线段就是 2 点）');
  assert.equal(m2.verts.length, 2);
});

test('★0x320：`vcount <= 0` ⇒ **不建任何 MeshEntry**（raw 41073-41077：`sub_4ADFE0` 一次都不调）', () => {
  const s = newSceneState();
  scCreateMesh(s, specFor(0x11, 0));
  // ★修前：无条件 `s.meshes.set(...)` ⇒ 留下一个 `flags = 0` 的幽灵记录（快照/`created` 都看得见）。
  assert.equal(s.meshes.has(0x11), false, '★引擎在那条分支上连项都不建');
});

test('★0x320：`vcount <= 0` 时**已存在的项不动**（析构在 `sub_4ADFE0` 体内，根本走不到）', () => {
  const s = newSceneState();
  const built = scCreateMesh(s, specFor(0x11, 4));
  assert.equal(built.flags & 1, 1);
  const again = scCreateMesh(s, specFor(0x11, 0));
  // ★前提被推翻（审计行原判"引擎会先析构旧几何 ⇒ bit0 归 0"）：raw 41037 的门在析构之前，
  //   `vcount = 0` 走的是 41073 的错误分支 ⇒ 旧几何与 bit0 **原样保留**。
  assert.equal(s.meshes.get(0x11)!.flags & 1, 1, '★bit0 仍在（raw 41073-41077 不打 `sub_4ADFE0`）');
  assert.equal(s.meshes.get(0x11)!.verts.length, 4, '★旧几何仍在');
  assert.equal(again.flags & 1, 1, '返回值 = 已存在的那一项');
});

test('★0x320：`vcount > 0` 的重建是**替换**几何（raw 132727-132752 先析构 + 三个数组各置 0）', () => {
  const s = newSceneState();
  scCreateMesh(s, specFor(0x11, 4));
  const m = scCreateMesh(s, specFor(0x11, 2));
  assert.equal(m.verts.length, 2, '★不是追加：旧顶点缓冲被析构后重建');
  assert.equal(m.baseColors.length, 2);
  assert.equal(s.meshes.size, 1, '同一个 handle 只有一项');
});

// ---------------------------------------------------------------------------
// ② P3 `0x321`：写属性前会**自动创建**缺失的网格项（raw 132802 的 `sub_4AAB80`）
// ---------------------------------------------------------------------------

test('★0x321：对未出现过的 mesh 写属性 ⇒ 建出零值网格项（引擎同一容器 find-or-create）', () => {
  const s = newSceneState();
  assert.equal(s.meshes.has(0x30d40), false, '前置：没有这一项');
  scSetMeshEntryAttr(s, 0x30d40, 0, 0x2a);
  // ★修前：只写 `render4.meshAttrs` 的 Map 键 ⇒ `s.meshes` 里没有项（快照/`created` 与引擎分叉）。
  assert.equal(s.meshes.has(0x30d40), true, '★`sub_4AAB80` 建出空条目（raw 132802）');
  const m = s.meshes.get(0x30d40)!;
  assert.equal(m.flags & 1, 0, '建出来的项 bit0 未置 ⇒ 不可画（与"缺失即建项"同一口径）');
  assert.equal(m.verts.length, 0, '零值初始化：没有几何');
  assert.equal(s.render4.meshAttrs.get(0x30d40)!.get(0), 0x2a, '属性照写（消费者 = presenter 的 meshAttrsTint）');
  // 第二次写不再"新建"（`scEnsureMesh` 的 created 会转假）
  assert.equal(scEnsureMesh(s, 0x30d40).created, false);
});

// ---------------------------------------------------------------------------
// ③ P2 `0x223`：写记录前按需建/重建记录 `[4]` 那个渲染层（raw 132603-132615）
// ---------------------------------------------------------------------------

test('★0x223：`[4]` 的槽不存在 ⇒ 用槽 36 的规格现建（raw 132607-132610）', () => {
  const s = newSceneState();
  const scratchMode = sceneScratchMode(s.effect3DLevel);
  assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_A), scratchMode, '前置：槽 36 已建（`sub_4A6EE0`）');
  assert.equal(s.render4.slotModes.has(3), false, '前置：槽 3 还没建');

  assert.equal(scEnsureTransitionLayer(s, 3), 'created');
  // ★修前：emulator 只写记录 ⇒ 没有任何"把这一层建出来"的等价物（引擎 raw 132610 会 `sub_4A2C10`）。
  assert.equal(s.render4.slotModes.get(3), scratchMode, '★新层的 mode = 槽 36 的 mode（= `_this[10650]`）');
  assert.equal(scEnsureTransitionLayer(s, 3), 'noop', '已存在且模式一致 ⇒ 不重复建');
});

test('★0x223：模式与槽 36 不一致 ⇒ **重建**（raw 132613-132615 的 `v11[262] != v12`）', () => {
  const s = newSceneState();
  const other = sceneScratchMode(s.effect3DLevel) === 1 ? 2 : 1;
  s.render4.slotModes.set(3, other); // 该层此前按另一种模式建过
  assert.equal(scEnsureTransitionLayer(s, 3), 'recreated');
  assert.equal(s.render4.slotModes.get(3), sceneScratchMode(s.effect3DLevel));
});

test('★0x223：`scSetTransition` 的第 4 格就是那条路径的入口（写端 op2 = a3）', () => {
  const s = newSceneState();
  assert.equal(s.render4.slotModes.has(5), false);
  scSetTransition(s, 7, [[0, 0], [1, 0], [2, 10], [3, 200], [4, 5]]);
  assert.equal(s.render4.slotModes.has(5), true, '★`[4] = 5` ⇒ 该层被建出来');
  assert.equal(scSetRenderTarget(s, 5), 'applied', '建出来的层可以被 `0x20D` 切过去（引擎同一条表）');
});

test('★0x223：`[4] = -1`（默认记录）⇒ 不建任何层（后台缓冲那条路）', () => {
  const s = newSceneState();
  const before = s.render4.slotModes.size;
  scSetTransition(s, 8, [[0, 0], [3, 100]]); // 不写 [4] ⇒ 默认记录给 -1
  assert.equal(scTransitionDefaultRecord()[4], -1, '默认 `[4] = -1`（raw 117068）');
  assert.equal(s.render4.slotModes.size, before, '不建层');
  assert.equal(scEnsureTransitionLayer(s, -1), 'noop');
  assert.equal(scEnsureTransitionLayer(s, 1000), 'noop', '越界槽（>0x3E7）走后台缓冲那一条');
});

test('★0x223 的消费端确实还在：建出来的 mode-1 层能让混合门打开', () => {
  const s = newSceneState();
  assert.equal(sceneScratchMode(s.effect3DLevel), 1, '前置：满档（等级 2）⇒ scratch 层 mode 1');
  scEnsureTransitionLayer(s, 4);
  scSetRenderTarget(s, 4);
  // 门的判据 = `blendGateOpen`（`renderTargetSlot` 的 mode == 1）—— 见 `scene/blend.ts`。
  assert.equal(s.render4.slotModes.get(s.render4.renderTargetSlot), 1, '★这一层是 mode-1 ⇒ 门开');
  assert.notEqual(s.render4.renderTargetSlot, SCENE_SCRATCH_SLOT_A, '（不是槽 36 本身）');
  assert.notEqual(s.render4.renderTargetSlot, SCENE_SCRATCH_SLOT_B);
});
