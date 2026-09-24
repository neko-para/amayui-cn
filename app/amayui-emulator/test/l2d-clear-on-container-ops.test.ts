/** @tier T0 @kind core @subsystem render */

/**
 * **拆场指令必须擦 572B 立绘节点表** —— `tickets/T-0144`（D1；由 `T-0103` 的交接链审计定位）。
 *
 * 症状（用户实测）：**新游戏路径**（TITLE → Game Start → … → 序章末）本该是黑的那一段画面上出现
 * **TITLE 的 Live2D 立绘残留**；读档路径没有（它靠装载点的 `l2dResetHost` 遮住了）。
 *
 * 引擎依据（`engine/天结_unpacked.exe_utf8.c`）：`0x1F6`/`0x1F7`/`0x21D` 都动**四张表** ——
 * `Scene+1032` DrawItem / `Scene+1064` MeshEntry / `Scene+1080` 572B-A / **`Scene+1096` 572B-B = 立绘节点表**：
 *  - `0x1F6`（`sub_4AB7A0`）：raw 130699 / 130764 / **130765** / **130766**（`result = sub_4A9D10(v1 + 274);`）；
 *  - `0x1F7` 单条（`sub_4AB950`）：raw 130825-130837（1080 用 `sub_4A9D70`+`sub_4A9270`，1096 同型）；
 *  - `0x1F7` 区间（`sub_4ABB60`）：raw 130909 / 131002 / **131044** / **131077**（`sub_4AA3D0(v33 + 274, …)`）；
 *  - `0x21D`（`sub_4AC0D0`）：raw 131241-131248 把源 key 的 1096 节点 `qmemcpy(dst, src+4, 0x23C)`。
 * 出画门 `sub_4B0360`（raw 134316-134320）只遍历**表里已有的**节点 ⇒ 节点被擦即不再出画；
 * **10 个实例槽不受影响**（清槽只发生在 `0x342` 与读档装载段 raw 19387-19388）。
 *
 * 为什么这四条断言有辨别力：接线前 `scClearDrawContainer`/`scDetachTexture` 只清 `drawItems`+`meshes`
 * （`scene/ops.ts`），立绘节点会**原样留下**（用户实测 513 条 `[present …] l2d={槽1 节点1 可画1 …}`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { l2dBindTexture, l2dCreateNode } from '../src/live2d/runtime.js';
import { scClearDrawContainer, scCopyItem, scDetachTexture } from '../src/renderer/scene/ops.js';

/** 造一个"TITLE 那一屏"：立绘节点 key `0x14` 绑实例槽 0，槽里有模型。 */
function fixture(): { scene: HeadlessScene; e: Engine } {
  const scene = new HeadlessScene({});
  const e = new Engine(scene);
  scene.scene.l2dHost = e; // 与三个跑手同口径（renderer 侧经 scene.l2dHost 访问运行态）
  l2dCreateNode(e, 0x14, 0);
  l2dBindTexture(e, 0, 0x4f9f, 0);
  return { scene, e };
}

test('★T-0144：`0x1F6` clearDrawContainer 必须连 572B 立绘节点一起清（引擎 raw 130766）', () => {
  const { scene, e } = fixture();
  assert.equal(e.l2dNodes.size, 1, '前置：装载后应有 1 个立绘节点');

  const r = scClearDrawContainer(scene.scene);
  assert.equal(r.nodes, 1, 'clearDrawContainer 应报告清掉了 1 个立绘节点');
  assert.equal(e.l2dNodes.size, 0, '★节点表必须为空（引擎 sub_4A9D10(v1+274)）');
  // ★不许顺手清实例槽：引擎的 0x1F6 只清两张 map（槽是 0x342 / 读档装载段的事）
  assert.equal(e.l2dSlots.size, 1, '★实例槽必须保留（清槽不是 0x1F6 的职责）');
});

test('★T-0144：`0x1F7` 单条（count≤1）擦掉该 key 的立绘节点（引擎 raw 130831-130837）', () => {
  const { scene, e } = fixture();
  l2dCreateNode(e, 0x20, 0); // 区间外的另一个节点，必须保住

  const r = scDetachTexture(scene.scene, 0x14, 1);
  assert.equal(r.nodes, 1);
  assert.equal(e.l2dNodes.has(0x14), false, '★命中的 key 必须没了');
  assert.equal(e.l2dNodes.has(0x20), true, '★区间外的节点必须还在');
  assert.equal(e.l2dSlots.size, 1, '实例槽不动');
});

test('★T-0144：`0x1F7` 区间（count>1）只擦区间内的立绘节点（引擎 raw 131077）', () => {
  const { scene, e } = fixture();
  l2dCreateNode(e, 0x30, 0);
  l2dCreateNode(e, 0x31, 0);
  l2dCreateNode(e, 0x40, 0); // 区间外

  const r = scDetachTexture(scene.scene, 0x30, 2); // [0x30, 0x32)
  assert.equal(r.nodes, 2, '区间内两个节点都该被擦');
  assert.deepEqual([...e.l2dNodes.keys()].sort((a, b) => a - b), [0x14, 0x40], '区间外的必须保留');
  assert.equal(e.l2dSlots.size, 1, '实例槽不动');
});

test('★T-0144：`0x21D` CopyScene 连 572B 立绘节点一起拷（引擎 raw 131241-131248）', () => {
  const { scene, e } = fixture();
  // 给源节点一点非默认状态，确认拷的是"记录内容"而不是空壳
  e.l2dNodes.get(0x14)!.slot = 0;
  e.l2dNodes.get(0x14)!.scale = [1.5, 1.5, 1];

  const r = scCopyItem(scene.scene, 0x14, 0x50);
  assert.equal(r.node, true, '拷贝结果应含 l2dNode=true');
  const copy = e.l2dNodes.get(0x50);
  assert.ok(copy, '★目标 key 必须有节点');
  assert.equal(copy!.slot, 0, '槽号要一起拷过去（引擎整块 0x23C）');
  assert.deepEqual(copy!.scale, [1.5, 1.5, 1], '变换字段要一起拷过去');
  // 独立副本：改副本不影响源（引擎是 memcpy，不是共享指针）
  copy!.scale = [1, 1, 1];
  assert.deepEqual(e.l2dNodes.get(0x14)!.scale, [1.5, 1.5, 1], '两份记录必须互不影响');
});

test('★T-0144：没有任何立绘节点时，清/删/拷都不该假装做了事', () => {
  const scene = new HeadlessScene({});
  const e = new Engine(scene);
  scene.scene.l2dHost = e;
  assert.equal(scClearDrawContainer(scene.scene).nodes, 0);
  assert.equal(scDetachTexture(scene.scene, 0x14, 1).nodes, 0);
  assert.equal(scCopyItem(scene.scene, 0x14, 0x50).copied, false, '三张表全空 ⇒ 源不存在（引擎同判据）');
});
