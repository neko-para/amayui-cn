/**
 * **`BlendEnv` 的生产侧装配**（票 `T-0167`，审计 §4.2 #65 `scene-render-freeze-46676` 的 `missing-consumer`）。
 *
 * ## 为什么单独一个文件
 * 这个结构体有**三个**字段，修前由 `pixi/presenter.ts` 两个调用点各自手写一份：
 * ```ts
 * const env: BlendEnv = { renderTargetSlot: …, slotMode: …, };   // ← 没有 sceneFrozen
 * ```
 * ⇒ `blend.ts` 里那条判据（raw 123117-123121 的追加覆盖 `!Scene+46676 && Scene+46456 < 0 && holder+1164 == 1`）
 * 在**生产路径里恒走** `!undefined === true` 那一支 —— 判据静默退化，且**没有任何测试看得见**
 * （`test/blend-mode.test.ts` 自己手搓 `BlendEnv`）。审计的原话：「只有『声明 + 一个纯函数里的判据 +
 * 一条单测』，生产侧从不置位」。
 *
 * 现在装配只此一处，两个调用点（`present()` 与 `renderItemSubset()`）都调它；
 * 守卫 `test/t0167-blend-env-frozen.test.ts` 同时钉「字段真的来自 `scene.frozen`」与
 * 「`presenter.ts` 里不再有手写 `BlendEnv`」两件事。
 *
 * ## 字段来源（都是共享模型 `SceneState`）
 *  - `renderTargetSlot` ← `Scene+46456`（`0x20D` 写）；
 *  - `slotMode` ← `CTexture+1048`（`0x1F8` 的 op4 写；`scene.render4.slotModes`）；
 *  - `sceneFrozen` ← `Scene+46676`（冻结总闸；`scSetSceneFrozen` 写、`SceneState.frozen` 存）。
 *  ★`BlendEnv.holder1164Is1` 仍是未定位字段（`tickets/T-0017` 的 notes），本函数**不**代填它。
 */
import type { SceneState } from './state.js';
import type { BlendEnv } from './blend.js';

/**
 * 从共享场景模型装配混合判据环境。
 *
 * ★**不许**在这一层补默认值：每个字段都必须来自模型（`scene.frozen` 缺失过一次就是这个原因）。
 */
export function blendEnvForScene(scene: SceneState): BlendEnv {
  return {
    renderTargetSlot: scene.render4.renderTargetSlot,
    slotMode: (slot) => scene.render4.slotModes.get(slot),
    sceneFrozen: scene.frozen,
  };
}
