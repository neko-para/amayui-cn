/**
 * **3D 层提交**（引擎 `sub_4B06D0` 的 2D 提交 + `sub_4B4460`（`0x222`）的三表归并）在 emulator 侧的
 * 共同落点 —— 审计 §4.2 #19 `render-3d-layer-dual-commit`。
 *
 * ## 为什么单独一个模块
 *
 * `0x222` 的操作数（`op1` 起始 handle / `op2` 跨度）要进模型，但**今天进不来**：
 * `NativeBridge`（`src/vm/native.ts`）与 `nativeTap.ts` 的 `BRIDGE_METHODS` 都在别的并行执行者的
 * 文件所有权里，而 handler 拿不到 `SceneState`（`Engine` 上没有场景模型）。⇒ 本模块把**能做的
 * 全部**做成"每帧跑一次"的提交（两个宿主的 `advanceModel` 都调），并把"脚本点名的那段区间"
 * 做成一个**待办队列**（`enqueueSceneCommitNodes`）—— 等 `0x222` 的缝接上时，handler 只需
 * `enqueueSceneCommitNodes(scene, start, count)`（一行），本文件一行都不用改。
 *
 * ## 与引擎的对应（raw 锚点 = `engine/天结_unpacked.exe_utf8.c`）
 *
 * | 引擎 | 本模块 |
 * |---|---|
 * | `Scene+46508 = 0; Scene+46516 = 0;`（raw 137035-137036） | `scBeginRenderPass` |
 * | `sub_4A1E90(Scene)`（raw 137038 / 136795） | `scResetSceneWorldMatrix` |
 * | `sub_4535F0(Scene+50704, key)`（raw 137169） | `scWeatherNodeKey`（逐 key） |
 * | `sub_453540(Scene+50704)`（raw 137170 / 136829） | `scWeatherAdvance` |
 * | `(node[0] & 0x10001) == 1 ⇒ sub_4B4020/4AF1C0/4B0360`（raw 136905-136936） | `scPrimDispatch` |
 * | `sub_4B06D0` 的转场两趟 36/37（raw 136014-136176） | 宿主每帧的 `scTransitionTick` + `present`（`tickets/T-0091` 的 D2/D3） |
 */
import type { SceneState } from './state.js';
import {
  scBeginRenderPass,
  scEnsureEffect3DSlots,
  scPrimDispatch,
  scResetSceneWorldMatrix,
  scWeatherAdvance,
  scWeatherNodeKey,
  scWeatherSetClock,
} from './ops.js';

/**
 * **脚本点名的提交区间**（`0x222` 的 `[op1, op1+op2)`）—— 待办队列。
 *
 * 为什么是队列而不是"直接做"：`0x222` 在**脚本时序**上出现，而引擎的提交发生在**渲染时序**
 * （`sub_4B4460` 里连三表归并一起做）。emulator 的渲染时序入口 = 宿主 `advanceModel` ⇒ 脚本
 * 入队、帧末出队，正好复刻这个次序（且天然把"同一帧里多条 `i222`"合并成一次提交，与引擎
 * 每帧一次归并同形）。
 */
export interface SceneCommitRequest {
  /** 起始 handle（`0x222` 的 op1）。 */
  start: number;
  /** 跨度（`0x222` 的 op2）。 */
  count: number;
}

/** 入队一次区间提交（`0x222`）。返回队列长度（诊断用）。 */
export function enqueueSceneCommitNodes(s: SceneState, start: number, count: number): number {
  s.commitQueue.push({ start, count });
  return s.commitQueue.length;
}

/**
 * **跑一遍帧级提交**（两个宿主的 `advanceModel` 每帧调一次；等价引擎每帧那次 `sub_4B06D0` +
 * `0x222` 的归并）。
 *
 * 顺序**照体**：清 → 世界矩阵复位 → 逐 key 天气节点判据 → 天气推进 → bit0 分派。
 * `clockMs` 是本帧时钟（引擎 `Scene+46500`；天气推进的墙钟口径见 `weather.ts`）。
 *
 * @returns 诊断计数（快照/守卫可用；不参与渲染决策）。
 */
export function scSceneCommitRange(
  s: SceneState,
  clockMs: number,
): {
  cleared: boolean;
  worldReset: boolean;
  nodes: number;
  advanced: number;
  dispatched: number;
  /** 本遍期间是否产生过"还要再画"的脏（诊断；`true` ⇒ 下一帧仍会合成）。 */
  dirtyDuringPass: boolean;
} {
  // ① `Scene+46508 = 0; Scene+46516 = 0;`（每遍绘制开头）
  scBeginRenderPass(s);
  // ② `sub_4A1E90`：Scene 世界矩阵复位
  const worldReset = scResetSceneWorldMatrix(s) === 'applied';
  // ③ 出队：脚本点名的区间（`0x222`）—— 每条区间走一遍逐 key 天气节点销毁判据
  let nodes = 0;
  const keys: number[] = [];
  for (const req of s.commitQueue.splice(0)) {
    const n = Math.max(0, req.count);
    for (let h = req.start; h < req.start + n; h++) keys.push(h);
  }
  for (const key of keys) nodes += scWeatherNodeKey(s, key).length;
  // ④ `sub_453540`：3D 天气/粒子按墙钟推进（上限 100；raw 136829）
  scWeatherSetClock(s, clockMs);
  const advanced = scWeatherAdvance(s);
  // ④b 等级化的 3D 效果槽**惰性建**（`sub_4B06D0` raw 134820-134855；审计 §4.2 #20）——
  //     引擎在 2D 绘制循环开头每帧判空后建，emulator 放在同一次提交里（`scEnsureEffect3DSlots`）。
  scEnsureEffect3DSlots(s);
  // ⑤ 逐 key 的 bit0 分派（`(node[0] & 0x10001) == 1` ⇒ `sub_4B4020`/`sub_4AF1C0`/`sub_4B0360`）。
  //    ★**只对脚本点名过的 key 做**：引擎的三表归并带 `a2`/`a3` 的范围（`v15 = a2 + a3`），
  //    未点名时那两处 `sub_4535F0`/分派根本不在循环体里（raw 137162-137185 的 `if (v45 == v43 …)`
  //    是"归并到底"的出口）⇒ 队列为空时**什么都不做**，免得每帧把所有 mesh 的颜色窗都收尾
  //    （那是一个"模型层看不见但画面看得见"的静默改动）。
  let dispatched = 0;
  for (const key of keys) if (scPrimDispatch(s, key)) dispatched++;
  // ⑥ **收尾**：本遍的脏位/池挂起位在**这一遍结束时**清 0（引擎里 `46508`/`46516` 的清点在
  //   每遍绘制**开头**（raw 137035-137036 / 130427-130428）；emulator 的"一遍"= 本函数，
  //   所以清在末尾 —— 期间被 ②-⑤ 置起的脏位说明"这一遍改了东西，下一帧还要再画一次"，
  //   而 `pending` 由宿主在帧末按 `scPoolPending` 重新锁存（`scSetScenePending`）⇒ 不丢。
  const dirtyDuringPass = s.dirty;
  scBeginRenderPass(s);
  return { cleared: true, worldReset, nodes, advanced, dispatched, dirtyDuringPass };
}
