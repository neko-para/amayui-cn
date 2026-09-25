/** @tier T0 @kind core @subsystem render */

/**
 * **T-0154 的场景状态批**（P2）：`0x1F6` 第三张表 / `0x244` 节点窗起点 / `0x229` 三段体 /
 * `0x20D` 两条前置 / `Scene+46512` 无条件置脏 / `Scene+1056` 条数门。
 *
 * 每条断言都对着 `engine/天结_unpacked.exe_utf8.c` 的行区间逐字核过（raw 号写在用例里）；
 * 修前的行为写在每个用例的注释里 —— 这些断言在修前**必红**（红→绿证据见
 * `tickets/T-0154/changes-c154.md` 的命令段）。
 *
 * 为什么不用 `HeadlessScene` 的宿主缝跑：本文件守的是**共享模型函数**（`scene/ops.ts`
 * 与 `scene/transition.ts`）的语义，两个宿主（pixi/headless）都只是转发它们 ⇒ 直接调
 * 共享函数才不会被宿主的接线细节掩盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import {
  SCENE_SCRATCH_SLOT_A,
  SCENE_SCRATCH_SLOT_B,
} from '../src/renderer/scene/effectLevel.js';
import {
  applySceneXformToPlacement,
  scAdvance,
  scClearDrawContainer,
  scClearDrawItemAnimStarts,
  scEnsureItem,
  scSetDrawEntryParam,
  scSetDrawModeBlock,
  scSetRenderTarget,
  scSetSceneScale,
  scSetSceneTranslation,
  scSetSlotMode,
  sceneAffine2DOf,
  sceneLayerAffected,
  sceneLayerInGate,
} from '../src/renderer/sceneModel.js';
import { scTransitionRecordCount, scTransitionTick } from '../src/renderer/scene/transition.js';
import { l2dCreateNode } from '../src/live2d/runtime.js';

/** 造一个接了 L2D 宿主的场景（与三个跑手同口径：`scene.l2dHost = Engine`）。 */
function l2dScene(): { hs: HeadlessScene; e: Engine } {
  const hs = new HeadlessScene({});
  const e = new Engine(hs);
  hs.scene.l2dHost = e;
  return { hs, e };
}

// ---------------------------------------------------------------------------
// ① P2 `0x1f6`：清整张 572B-A 表时，它的 `+504` 镜像（`render4.entryParams`）必须一起没
// ---------------------------------------------------------------------------

test('★0x1f6：`clearDrawContainer` 连 572B-A 的 `+504` 台账一起释放；`nodesA` 把"第三张表"显式化（raw 130765）', () => {
  const { hs } = l2dScene();
  const s = hs.scene;
  // `0x242` 写的是**两个**东西：DrawItem 的 `+720`（真模型）与相邻对象（572B-A 项）的 `+504`（台账）。
  scSetDrawEntryParam(s, 0x14, 1);
  assert.equal(s.render4.entryParams.get(0x14), 1, '前置：台账里有该格');

  const r = scClearDrawContainer(s);
  // ★修前：`entryParams` 不清 ⇒ `i1f6` 之后账里留着"对象已经被整表 delete 掉"的陈旧值（raw 130765）。
  assert.equal(s.render4.entryParams.size, 0, '★572B-A 整表释放 ⇒ 它的 `+504` 镜像不许残留');
  // ★如实登记：emulator 没有 572B-A 的容器 ⇒ "清了 0 项"是唯一正确的值（不是"假装清了"）。
  assert.equal(r.nodesA, 0, 'emulator 无 572B-A 容器 ⇒ 清 0 项（该格让缺口可断言而不是沉默）');
  assert.equal(r.drawItems, 1, '绘制项照旧被数出来（0x242 建的那个项）');
});

// ---------------------------------------------------------------------------
// ② P2 `0x244`：第二/三趟 —— 572B-B 节点的 `+24`（窗起点）也要清 0
// ---------------------------------------------------------------------------

test('★0x244：`flags & 2` 的 572B-B 节点，窗起点 `+24` 被清 0（raw 132476-132478）', () => {
  const { hs, e } = l2dScene();
  l2dCreateNode(e, 0x14, 0);
  const node = e.l2dNodes.get(0x14)!;
  node.flags |= 2; // 窗已配置位（引擎那一趟的门是 `(a2 & flags) != 0`，mask = 2）
  node.wins.startedAtMs = 1234;
  node.wins.latched = true;

  const n = scClearDrawItemAnimStarts(hs.scene, 2);
  // ★修前：函数只遍历 `s.drawItems` ⇒ 节点那一趟根本没跑（`+24` 原样留着）。
  assert.equal(node.wins.startedAtMs, 0, '★raw 132478：`*(node + 24) = 0`');
  assert.equal(node.wins.latched, false, '`+24 == 0` ⇒ 未锁存（下一帧重新锁存 now）');
  assert.equal(n, 0, '返回值仍是"绘制项命中数"（宿主缝 `(mask) => number` 的形状不变）');
});

test('★0x244：没有 bit1 的节点不受影响（引擎的门是 `a2 & flags`）', () => {
  const { hs, e } = l2dScene();
  l2dCreateNode(e, 0x14, 0); // flags = 1（bit0），没有 bit1
  const node = e.l2dNodes.get(0x14)!;
  node.wins.startedAtMs = 1234;
  node.wins.latched = true;
  scClearDrawItemAnimStarts(hs.scene, 2);
  assert.equal(node.wins.startedAtMs, 1234, '未命中 ⇒ 不许动');
  assert.equal(node.wins.latched, true, '未命中 ⇒ 不许动');
});

// ---------------------------------------------------------------------------
// ③ P2 `0x229`：复位模板（740 B）/ 区间门 / pivot
// ---------------------------------------------------------------------------

test('★0x229 ①：复位模板 ⇒ 上一轮 `i22a` 的缩放不再留着（raw 117084-117087 + 116899-117054）', () => {
  const s = newSceneState();
  scSetSceneScale(s, 3, 3, 1); // `0x22A`
  assert.ok(sceneAffine2DOf(s, 20), '前置：有锚');

  scSetDrawModeBlock(s, 0, 0, 0, 0, 0); // `i229 0 0 0 0 0`（语料 716 处）
  // ★修前：`scSetDrawModeBlock` 只记 5 元组 ⇒ 锚与缩放原样留着（`sceneAffine2DOf` 仍非 null）。
  assert.equal(s.sceneXform, null, '★模板整块复位 ⇒ 四组矩阵/轴角的锚被丢掉');
  assert.equal(sceneAffine2DOf(s, 20), null, '复位后没有变换（= 引擎复位成单位阵的净效果）');
});

test('★0x229 ②：区间门 `[op1, op1+op2)` 决定"谁吃 Scene 世界矩阵"（raw 133397-133401）', () => {
  const s = newSceneState();
  assert.equal(s.sceneLayerStart, 0, 'exe 初值 = 0（raw 115834）');
  assert.equal(s.sceneLayerCount, 0, 'exe 初值 = 0（raw 115835）⇒ 没下发过 i229 时谁都不吃');
  // ★语料次序就是"先 i229 开区间、再 i22c/i22a"（`ALLMAP.txt:1378 i229 1 7cf 0 0 0` → `i22c …`）
  //   —— `i229` 会复位模板，所以变换必须写**在它之后**（写前面会被这次复位清掉）。
  scSetDrawModeBlock(s, 5, 95, 0, 0, 0); // 区间 [5, 100)
  scSetSceneTranslation(s, 7, 9, 0);
  assert.equal(sceneLayerInGate(s, 5), true);
  assert.equal(sceneLayerAffected(5), false, '★`[20,30)` 只是**内层**分支，不是"吃不吃"那道门');
  const base = { position: { x: 50, y: 60 }, scale: { x: 1, y: 1 } };
  const inGate = applySceneXformToPlacement(s, 5, base);
  // ★修前：`sceneAffine2DOf` 只认 `[20,30)` ⇒ 层 5 原对象返回（引擎在区间内会乘完整世界矩阵）。
  assert.notEqual(inGate, base, '★区间内的层必须吃（引擎那一支是 `work · Scene+46600`）');
  assert.deepEqual(inGate.position, { x: 57, y: 69 }, '平移 (7,9) 生效');

  // 区间外的层：两支都不走（连乘都不乘）
  scSetDrawModeBlock(s, 100, 50, 0, 0, 0); // [100,150)
  scSetSceneTranslation(s, 7, 9, 0); // i229 复位过模板 ⇒ 变换重新下发（语料同序）
  assert.equal(sceneLayerInGate(s, 5), false);
  assert.equal(applySceneXformToPlacement(s, 5, base), base, '区间外 ⇒ 原对象返回');
});

test('★0x229 ③：pivot 是 `T(−p)·M·T(+p)` 共轭（raw 117425-117429 + 117932）', () => {
  const s = newSceneState();
  scSetDrawModeBlock(s, 0, 100, 10, 20, 0); // pivot = (10,20)
  scSetSceneScale(s, 2, 2, 1); // 缩放 2×（这一格进的是收尾的第一块，raw 117929）
  const pl = applySceneXformToPlacement(s, 20, { position: { x: 100, y: 100 }, scale: { x: 1, y: 1 } });
  // ★修前：没有 pivot 这一级 ⇒ 绕屏幕原点缩放 = (200,200)。
  assert.deepEqual(pl.position, { x: 190, y: 180 }, '★绕 pivot (10,20) 缩放 2×：((100−10)·2+10, (100−20)·2+20)');
  assert.equal(s.scenePivot.x, 10);
  assert.equal(s.scenePivot.y, 20);
});

// ---------------------------------------------------------------------------
// ④ P3 `0x20d`：两条前置（槽必须已建；-1/越界 = 回后台缓冲）
// ---------------------------------------------------------------------------

test('★0x20d：未 create-texture 的槽 ⇒ **当前渲染目标不变**（raw 124872-124883）', () => {
  const s = newSceneState();
  assert.equal(scSetRenderTarget(s, 9), 'missing-texture');
  // ★修前：无条件 `render4.renderTargetSlot = 9` ⇒ 混合门控（`scene/blend.ts`）会按错误的槽算。
  assert.equal(s.render4.renderTargetSlot, -1, '★槽没建 ⇒ 保持原值（引擎 `return 0` 不改 `Scene+46456`）');

  scSetSlotMode(s, 9, 1); // `0x1F8 create-texture` 的等价物
  assert.equal(scSetRenderTarget(s, 9), 'applied');
  assert.equal(s.render4.renderTargetSlot, 9);
});

test('★0x20d：`-1` 或 `>999` ⇒ 回后台缓冲（raw 124839-124860）', () => {
  const s = newSceneState();
  scSetSlotMode(s, 9, 1);
  scSetRenderTarget(s, 9);
  assert.equal(scSetRenderTarget(s, -1), 'backbuffer');
  assert.equal(s.render4.renderTargetSlot, -1);
  scSetRenderTarget(s, 9);
  assert.equal(scSetRenderTarget(s, 0x400), 'backbuffer', '1000 > 0x3E7 ⇒ 后台缓冲那一条');
  assert.equal(s.render4.renderTargetSlot, -1);
});

test('★0x20d：场景初始的 36/37 两个 scratch 槽可以被切过去（`sub_4A6EE0` 建过它们）', () => {
  const s = newSceneState();
  assert.equal(scSetRenderTarget(s, SCENE_SCRATCH_SLOT_A), 'applied');
  assert.equal(scSetRenderTarget(s, SCENE_SCRATCH_SLOT_B), 'applied');
  assert.equal(s.render4.renderTargetSlot, SCENE_SCRATCH_SLOT_B);
});

// ---------------------------------------------------------------------------
// ⑤ P2 `bullet-dirty-from-freeze-or-pending`：`46512` 非零 ⇒ 无条件置脏
// ---------------------------------------------------------------------------

test('★freeze：场景里**没有**可冻结窗时也要置脏（raw 136718-136719 是收尾的无条件一句）', () => {
  const s = newSceneState();
  s.dirty = false; // 消费掉初值（`newSceneState` 的 dirty 起手是 true）
  scAdvance(s, 1000, true);
  // ★修前：freeze 分支只在"真的收尾了某个项/mesh"时置脏 ⇒ 空场景这一帧不重画。
  assert.equal(s.dirty, true, '★`if (46512) 46508 = 1` —— 引擎没有 per-item 条件');
});

test('★freeze 对照：非冻结的空场景推进不置脏（不许把脏位变成恒真）', () => {
  const s = newSceneState();
  s.dirty = false;
  scAdvance(s, 1000, false);
  assert.equal(s.dirty, false, '没有窗在跑 ⇒ 不置脏（`T-0003` 的脏位纪律）');
});

// ---------------------------------------------------------------------------
// ⑥ P3 `scene-draw-total-gate-1056`：条数门显式化
// ---------------------------------------------------------------------------

test('★Scene+1056 的等价物 = 记录条数；条数 0 ⇒ 整趟转场窗不执行', () => {
  const s = newSceneState();
  assert.equal(scTransitionRecordCount(s), 0, '空表 ⇒ 条数 0（引擎 `Scene+1056` 的等价物）');
  const r = scTransitionTick(s, 1000);
  assert.deepEqual(r, { active: [], finishedAny: false, cleared: false, render: [] }, '条数 0 ⇒ 整趟空转');
});

// ---------------------------------------------------------------------------
// ⑦ 保住既有口径：`sceneLayerAffected` 仍是 `[20,30)`（P1 守卫的同一判据）
// ---------------------------------------------------------------------------

test('★`sceneLayerAffected` 仍是 `[20,30)`（本次改动没有放宽它）', () => {
  assert.equal(sceneLayerAffected(19), false);
  assert.equal(sceneLayerAffected(20), true);
  assert.equal(sceneLayerAffected(29), true);
  assert.equal(sceneLayerAffected(30), false);
});

test('★区间门开着时，未 draw-texture 的 handle 也能被 `scEnsureItem` 建出来（与 0x242 同族口径）', () => {
  const s = newSceneState();
  const { item, created } = scEnsureItem(s, 0x777);
  assert.equal(created, true);
  assert.equal(item.flags & 1, 0, '缺失即建 ⇒ bit0 未置（不画）');
});
