/**
 * **共享场景模型（sceneModel）** —— 两个宿主共用的唯一一份"场景语义"。
 *
 * 为什么需要它：`pixiBackend`（画面）与 `headlessScene`（报告）如果各写一遍 opcode→模型，
 * 就会出现"报告说画了、画面没画"这类**无声漂移**。因此规则是：
 * **任何 opcode 对场景的改动都必须经 `src/renderer/scene/ops.ts`**，
 * 后端只负责"把模型画出来 / 把模型导出成报告"。
 *
 * 实现已拆分：
 *
 * | 模块 | 职责 |
 * |---|---|
 * | `scene/state.ts` | `SceneState`：drawItems / meshes / 诊断用 blendWritten |
 * | `scene/ops.ts` | 所有 `sc*` 场景操作（建项、删区间、清场、setter、逐帧推进） |
 * | `scene/snapshot.ts` | 确定性快照 + 人可读文本（快照回归的 diff 对象） |
 *
 * 本文件只做再导出，`import { scXxx } from './sceneModel.js'` 的既有调用点不受影响。
 */

export * from './scene/state.js';
export * from './scene/ops.js';
export * from './scene/snapshot.js';
