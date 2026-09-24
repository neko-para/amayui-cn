/** @tier T0 @kind core @subsystem render */

/**
 * ★★**3D 效果等级 `Scene+46668`**（审计 §4.2 #20 `scene-3d-effect-level-writer`，P1）。
 *
 * 修前 emulator **既无等级字段、也无 36/37 的等级化 mode**（`presenter.ts` 只把 scratch 层
 * 当固定机制）⇒ 恒等于"等级 0 的无效果支"，不报错、也没有任何断言会红。
 *
 * 引擎逐字（raw 锚点 = `engine/天结_unpacked.exe_utf8.c`）：
 *  - **写端** `sub_4A6EE0` raw 126548-126562：没显式给档位时按 D3D 版本能力落
 *    `v13 < 0xFFFF0200 ? (v13 >= 0xFFFF0100) : 2`，否则 `= a3`；
 *  - **scratch 槽** raw 126563-126572：`>= 2 ⇒ sub_4A2C10(…, 1)`、否则 `…, 2`（36 与 37 各一次）；
 *  - **效果惰性建** raw 134820-134855：`Scene+46480` 在等级 ≥2 用资源 **201**、≥1 用 **200**；
 *    `Scene+46492` 只在等级 **>1** 用资源 **203**；
 *  - **`0x326` 的共享效果** raw 23917-23932：门 `Scene+46668 >= 1`，资源 **202**。
 *
 * 本文件钉三档（等级 0 / 1 / 2）的 mode 与效果档位，以及三处门。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSceneState } from '../src/renderer/scene/state.js';
import {
  EFFECT3D_LEVELS,
  EFFECT3D_SHARED_RESOURCE,
  SCENE_SCRATCH_SLOT_A,
  SCENE_SCRATCH_SLOT_B,
  effect3DResourceFor,
  sceneScratchMode,
} from '../src/renderer/scene/effectLevel.js';
import {
  scEnsureEffect3DSlots,
  scSet3DEffectSnow,
  scSetEffect3DLevel,
  scSetSlotMode,
  WEATHER_SNOW,
} from '../src/renderer/sceneModel.js';

test('★等级 ⇒ 两个 scratch 槽（36/37）的创建模式：`>=2 ⇒ 1`、否则 `2`（raw 126563-126572）', () => {
  assert.deepEqual(EFFECT3D_LEVELS, [0, 1, 2], '引擎只有三档（`a3 ∈ {0,1,2}`，raw 126552）');
  assert.equal(sceneScratchMode(0), 2);
  assert.equal(sceneScratchMode(1), 2);
  assert.equal(sceneScratchMode(2), 1);

  const s = newSceneState();
  // ★初值 = 2（呈现后端 WebGL 无 D3D9 版本上限 ⇒ 能力满档；见 `SceneState.effect3DLevel`）
  assert.equal(s.effect3DLevel, 2);
  assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_A), 1, '等级 2 ⇒ 36 是 mode-1 离屏表面');
  assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_B), 1, '等级 2 ⇒ 37 同上');

  for (const lv of [0, 1, 2] as const) {
    scSetEffect3DLevel(s, lv);
    const want = sceneScratchMode(lv);
    assert.equal(s.effect3DLevel, lv);
    assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_A), want, `★等级 ${lv} ⇒ 槽 36 mode=${want}`);
    assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_B), want, `★等级 ${lv} ⇒ 槽 37 mode=${want}`);
  }
  // 越界档位夹到 [0,2]（引擎的 `a3` 也只在 0..2 上有定义）
  assert.equal(scSetEffect3DLevel(s, 9), 2);
  assert.equal(scSetEffect3DLevel(s, -3), 0);
});

test('★等级 ⇒ `ID3DXEffect` 资源档位：≥2→201、≥1→200、>1→203（raw 134820-134855）', () => {
  assert.deepEqual(effect3DResourceFor(0), { main: null, alt: null });
  assert.deepEqual(effect3DResourceFor(1), { main: 200, alt: null });
  assert.deepEqual(effect3DResourceFor(2), { main: 201, alt: 203 });
});

test('★效果槽是**惰性**建（每帧判空后补齐；raw 134820「if (!Scene+46480)」）', () => {
  // 等级 1：只有主槽，资源 200
  const s1 = newSceneState();
  scSetEffect3DLevel(s1, 1);
  s1.effect3DSlots.main = { built: false, resourceId: null };
  s1.effect3DSlots.alt = { built: false, resourceId: null };
  assert.deepEqual(scEnsureEffect3DSlots(s1), ['main'], '等级 1 ⇒ 只建主槽');
  assert.equal(s1.effect3DSlots.main.resourceId, 200);
  assert.equal(s1.effect3DSlots.alt.built, false, '★等级 1 时副槽（资源 203）**不许**建');
  assert.deepEqual(scEnsureEffect3DSlots(s1), [], '第二次调用 ⇒ 已建 ⇒ 惰性不再建');

  // 等级 2：主槽换 201、副槽 203
  const s2 = newSceneState();
  scSetEffect3DLevel(s2, 2);
  s2.effect3DSlots.main = { built: false, resourceId: null };
  s2.effect3DSlots.alt = { built: false, resourceId: null };
  assert.deepEqual(scEnsureEffect3DSlots(s2), ['main', 'alt']);
  assert.equal(s2.effect3DSlots.main.resourceId, 201);
  assert.equal(s2.effect3DSlots.alt.resourceId, 203);

  // 等级 0：两槽都不建
  const s0 = newSceneState();
  scSetEffect3DLevel(s0, 0);
  s0.effect3DSlots.main = { built: false, resourceId: null };
  assert.deepEqual(scEnsureEffect3DSlots(s0), [], '等级 0 ⇒ 一个都不建');
});

test('★`0x326` 的两半：`Scene+46668 >= 1` 门 + 共享效果（资源 202）懒建 + 重建 Snow', () => {
  // ① 等级 0 ⇒ 门不过，什么都不做（引擎 raw 23917）
  const s0 = newSceneState();
  scSetEffect3DLevel(s0, 0);
  assert.equal(scSet3DEffectSnow(s0, 1, 0.5, 2, true), false, '等级 0 ⇒ 门不过');
  assert.equal(s0.effect3DSlots.shared.built, false);
  assert.equal(s0.weather.slots[WEATHER_SNOW]!.active, false, 'Snow 不建');

  // ② 等级 1 但纹理槽空 ⇒ 也只报错不建（引擎 raw 23919-23945）
  const s1 = newSceneState();
  scSetEffect3DLevel(s1, 1);
  assert.equal(scSet3DEffectSnow(s1, 1, 0.5, 2, false), false, '纹理缺失 ⇒ 不建（引擎打 Set3DEffectSnow エラー）');
  assert.equal(s1.effect3DSlots.shared.built, false);

  // ③ 等级 1 + 纹理在 ⇒ 建共享效果（资源 202）并重建 Snow
  assert.equal(scSet3DEffectSnow(s1, 7, 0.5, 3, true), true);
  assert.equal(s1.effect3DSlots.shared.built, true);
  assert.equal(s1.effect3DSlots.shared.resourceId, EFFECT3D_SHARED_RESOURCE);
  assert.equal(s1.effect3DSlots.shared.resourceId, 202);
  assert.equal(s1.weather.slots[WEATHER_SNOW]!.active, true, '★Snow 对象被重建（审计 §4.2 #21 的 0x326 那一半）');
  assert.deepEqual(s1.weather.slots[WEATHER_SNOW]!.params.slice(0, 3), [7, 0.5, 3], '前三格 = op1/f2/op3');

  // ④ 第二次 ⇒ 共享效果**不重复建**（惰性，raw 23922）
  const before = s1.effect3DSlots.shared;
  assert.equal(scSet3DEffectSnow(s1, 7, 0.5, 3, true), true);
  assert.equal(s1.effect3DSlots.shared, before, '同一份槽对象（没有重建）');
});

test('★`0x1F8` 的槽 mode 与等级写的是**同一张表**（混合门控的成立条件；`scene/blend.ts`）', () => {
  const s = newSceneState();
  scSetEffect3DLevel(s, 0);
  assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_A), 2);
  scSetSlotMode(s, SCENE_SCRATCH_SLOT_A, 1); // 脚本 `create-texture … 1` 也能把它改成 1
  assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_A), 1, '两处写同一张表（不是两份镜像）');
  scSetEffect3DLevel(s, 0);
  assert.equal(s.render4.slotModes.get(SCENE_SCRATCH_SLOT_A), 2, '再写等级 ⇒ 按等级覆盖');
});
