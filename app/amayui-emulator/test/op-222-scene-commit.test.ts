/** @tier T0 @kind core @subsystem render */

/**
 * ★★**3D 层提交**（引擎 `sub_423EC0` → `sub_4B4460`，`0x222`；审计 §4.2 #19
 * `render-3d-layer-dual-commit`，P1）在 emulator 侧的模型侧行为。
 *
 * ## 本条 finding 的处置（如实登记，见 `handlers/scene-commit.ts`）
 *
 * `0x222` **不是**"整条链一次都不跑"了：模型侧（`renderer/scene/commit.ts` 的
 * `scSceneCommitRange`）每帧被两个宿主的 `advanceModel` 调用，做的正是引擎体那几件：
 *  1. `Scene+46508 = 0; Scene+46516 = 0;`（raw 137035-137036）；
 *  2. `sub_4A1E90`：Scene 世界矩阵复位（raw 137038）；
 *  3. `sub_4535F0(管理器, key)` 的销毁判据（raw 137169）；
 *  4. `sub_453540`：按墙钟推进 + **上限 100**（raw 137170）；
 *  5. `(node[0] & 0x10001) == 1` 的 bit0 分派（raw 136905/136915/136926/136936）。
 *
 * **仍缺的一根线**：`0x222` 的两个 int 操作数（`op1` 起始 handle / `op2` 跨度）送不到模型 ——
 * handler 拿不到 `SceneState`，而 `NativeBridge`（`native.ts`）与 `nativeTap.ts` 的
 * `BRIDGE_METHODS` 在别的并行执行者的所有权里。⇒ 按纪律登记成 `ENGINE_INTERNAL_OPS` 的
 * **有据 no-op**（不读操作数，避免死读），模型侧照跑（不是静默丢弃整条链）。
 *
 * 本文件钉：模型侧的五件真的发生；`0x222` 的任务书区间一旦入队就逐 key 生效。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSceneState } from '../src/renderer/scene/state.js';
import { makeItem } from '../src/renderer/drawItem.js';
import {
  scPrimDispatch,
  scSceneCommitRange,
  scSetSceneAxisScale,
  scSetSceneScale,
  enqueueSceneCommitNodes,
  WEATHER_RAIN,
  scWeatherCreate,
  weatherParticles,
} from '../src/renderer/sceneModel.js';

test('★★`scSceneCommitRange`：清脏位/池挂起位 + Scene 世界矩阵复位（raw 137035-137038）', () => {
  const s = newSceneState();
  scSetSceneScale(s, 2, 2, 1); // 写 SceneXform（`0x22A`）
  scSetSceneAxisScale(s, 1, 2, 1, 1, 1);
  s.dirty = true;
  s.pending = true;
  assert.notEqual(s.sceneXform, null, '基线：世界矩阵有内容');

  const r = scSceneCommitRange(s, 1000);
  assert.equal(s.dirty, false, '★`46508 = 0`（本遍从"干净"开始）');
  assert.equal(s.pending, false, '★`46516 = 0`');
  assert.equal(s.sceneXform, null, '★`sub_4A1E90`：Scene 世界矩阵复位');
  assert.equal(s.sceneRotRad, 0, '复位时连同 `Scene+1856` 的角一起回零');
  assert.equal(r.worldReset, true, '报告里能看出这一次真的复位了（不是恒真）');

  // ② 复位**不置脏**（否则每帧都亮，脏位失去意义）—— 第二次调用返回 worldReset=false
  const r2 = scSceneCommitRange(s, 1016);
  assert.equal(r2.worldReset, false, '没有内容可复位时不算 applied');
  assert.equal(s.dirty, false, '没有变更 ⇒ 不置脏');
});

test('★★`0x222` 点名的区间入队 ⇒ 逐 key 走 `sub_4535F0` 的销毁判据（raw 137169）', () => {
  const s = newSceneState();
  scWeatherCreate(s, WEATHER_RAIN, [0, 4, 0]);
  s.weather.destroyRainAt = 0x30d41; // `0x325` 写的阈值（`[+0x4D8]`）
  assert.equal(s.weather.slots[WEATHER_RAIN]!.active, true, '基线：Rain 在');

  // 区间 `[0x30d40, 0x30d41)`：只含 0x30d40 ⇒ 未达阈值 ⇒ 不销毁
  enqueueSceneCommitNodes(s, 0x30d40, 1);
  const r1 = scSceneCommitRange(s, 1000);
  assert.equal(r1.nodes, 0, '键 0x30d40 < 阈值 ⇒ 不销毁');
  assert.equal(s.weather.slots[WEATHER_RAIN]!.active, true);

  // 区间 `[0x30d40, 0x30d42)`：含 0x30d41 ⇒ 达阈值 ⇒ 销毁
  enqueueSceneCommitNodes(s, 0x30d40, 2);
  const r2 = scSceneCommitRange(s, 1016);
  assert.equal(r2.nodes, 1, '★键 0x30d41 ≥ 阈值 ⇒ Rain 被销毁（逐节点判据真的在跑）');
  assert.equal(s.weather.slots[WEATHER_RAIN]!.active, false);
  assert.equal(s.commitQueue.length, 0, '队列被消费掉（不留残渣）');
});

test('★`scPrimDispatch`：区间内可绘制项的 work 变换复位（bit0 分派那一半）', () => {
  const s = newSceneState();
  const it = makeItem({ handle: 0x30d40, layer: 0x30d40, tex: 0, srcX: 0, srcY: 0, srcW: 1, srcH: 1, dstX: 0, dstY: 0 });
  it.flags |= 1; // draw-texture 置的可绘制位
  it.useWorld = true;
  it.scaleWork = { x: 3, y: 3, z: 1 };
  it.scaleTarget = { x: 3, y: 3, z: 1 };
  it.transWork = { x: 7, y: 8, z: 0 };
  it.transTarget = { x: 7, y: 8, z: 0 };
  s.drawItems.set(0x30d40, it);

  assert.equal(scPrimDispatch(s, 0x30d40), true, '命中已存在且可绘制的项 ⇒ true');
  assert.deepEqual(it.transWork, { x: 0, y: 0, z: 0 }, '★work 平移被复位');
  assert.deepEqual(it.scaleWork, { x: 1, y: 1, z: 1 }, '★work 缩放被复位成单位');
  assert.equal(it.useWorld, true, '复位**不**把项退出世界矩阵路径（`sub_4AC470` 也不碰 `+0x68`）');
  assert.equal(scPrimDispatch(s, 0xdeadbe), false, '不存在的 handle ⇒ false（不静默置脏）');
});

test('★`0x222` 之后天气仍在按墙钟推进（帧级提交与推进同一次；raw 137170）', () => {
  const s = newSceneState();
  scWeatherCreate(s, WEATHER_RAIN, [0, 0, 0]);
  scSceneCommitRange(s, 0);
  assert.equal(s.weather.lastAdvanceMs, 0, '基线：起点 0');
  s.weather.lastSampleMs = 0;
  scSceneCommitRange(s, 1000); // 1000ms ⇒ 60 步（< 上限）
  assert.equal(s.weather.slots[WEATHER_RAIN]!.phase, 60, '★每帧提交顺带按墙钟推进（60 步 @1000ms）');
  assert.ok(weatherParticles(s.weather).length > 0, '推进后确实有可画粒子（不是空转）');
});
