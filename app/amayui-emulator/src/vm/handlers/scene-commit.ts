/**
 * **`0x222` 3D 层区间提交 —— 引擎体说明与登记理由**（`sub_423EC0` raw 31924-31934 →
 * `sub_4B4460` raw 136968-137285；审计 §4.2 #19 `render-3d-layer-dual-commit`，P1）。
 *
 * ★本文件**不含 handler**：`0x222` 今天登记在 `ENGINE_INTERNAL_OPS`（有据 no-op，见 `stubs.ts`
 * 该条目的块注释）。本文件是那份登记的**说明真源**（引擎体 + 落地清单 + 重开条件），
 * 模型侧实现在 `src/renderer/scene/commit.ts`。
 *
 * ## 引擎体（逐行读过；raw 锚点 = `engine/天结_unpacked.exe_utf8.c` 行号）
 *
 * ```
 * // ---- handler `sub_423EC0`（argc 2；`sub_41BF50` 两次 = 两个 int 操作数）----
 * if ((Scene+46460 & 2) != 0) sub_498B60(Scene+1860);      // 31926-31929：进渲染目标前的设备清
 * if (sub_497F50(Scene+1860)) {                            // 31930-31931：D3D BeginScene（无设备 ⇒ 假）
 *   if (!Scene+46676 && Scene+46456 < 0 && holder1164 == 1) sub_4A50C0(Scene, 0x26);
 *   Scene+46508 = 0;  Scene+46516 = 0;                     // 137035-137036 ★清脏位/池挂起
 *   sub_49DFD0(Scene);                                     // 137037
 *   sub_4A1E90(Scene);                                     // 137038 ★Scene 世界矩阵复位
 *   sub_4B06D0(Scene);                                     // 137039 ★2D 绘制循环（转场两趟 36/37 + 天气推进）
 *   … 三表归并（Scene+1036 / +1068 / +1100）…              // 137040-137942
 *   sub_4535F0(Scene+50704, key); sub_453540(Scene+50704); // 137169-137170 ★3D 天气逐节点 + 每帧推进
 *   (flags & 0x10001) == 1 ⇒ sub_4B4020 / sub_4AF1C0 / sub_4B0360   // 136905/136915/136926/136936
 *   sub_49E170(Scene);                                     // 137180
 *   if (!Scene+46516) sub_4A9BE0(Scene+1048);              // 137181-137182 ★帧尾清转场表
 *   Scene+46512 = 0;                                       // 137183
 * }
 * ```
 *
 * ★操作数语义（读体 + `.lst` 双向核）：`v4 = sub_41BF50(_this, 2); v2 = sub_41BF50(_this, 1);`
 * ⇒ `op1` = 起始 handle、`op2` = 跨度（区间 `[op1, op1 + op2)`，体里 `v15 = a2 + a3`）。
 * 语料 10 处（最典型 = `src/SETPOLYGON.txt:58` 的 `i222 30d40 1`：把刚 `create-mesh` 的
 * 两条 0x30d40/0x30d41 立刻提交一遍）。
 *
 * ## 本轮落地了什么（模型侧；全部可断言）
 *
 * | # | 引擎 | emulator |
 * |---|---|---|
 * | 1 | `46508 = 0; 46516 = 0;` | `scBeginRenderPass`（`renderer/scene/ops.ts`） |
 * | 2 | `sub_4A1E90` 世界矩阵复位 | `scResetSceneWorldMatrix`（清 `SceneXform` + `sceneRotRad`） |
 * | 3 | `sub_4535F0(管理器, key)` | `scWeatherNodeKey`（销毁判据，raw 65890-65909） |
 * | 4 | `sub_453540(管理器)` | `scWeatherAdvance`（**墙钟 / 上限 100 / 三路各推进一次**） |
 * | 5 | `(flags & 0x10001) == 1` 三路分派 | `scPrimDispatch` |
 *
 * 全部由 `renderer/scene/commit.ts` 的 `scSceneCommitRange` 串起来，**每帧**由两个宿主的
 * `advanceModel` 调用（`HeadlessScene` / `PixiBackend`）⇒ 不是"登记了却没人跑"。
 *
 * ## 「操作数 → 模型」这一根线：2026-09-24 已接通
 *
 * `SceneState` 在宿主里，handler 拿不到（`Engine` 上没有场景模型：全仓 `c.e.scene` 零命中；
 * 所有场景写入都经 `NativeBridge` 缝）⇒ 必须走宿主缝。**本轮已加**：
 * `NativeBridge.sceneCommitRange(start, count)`（`src/vm/native.ts`）+
 * `BRIDGE_METHODS` 条目（`nativeTap.ts`）；两个宿主各一句
 * `enqueueSceneCommitNodes(scene, start, count)`（`renderer/scene/commit.ts` 导出）。
 *
 * ★**与引擎的唯一差别（登记）**：引擎在 `i222` 那一刻**当帧**跑完整趟 `sub_4B4460`；
 * emulator 把区间压进 `SceneState.commitQueue`，由**帧末**的 `scSceneCommitRange` 消费
 * ⇒ 最多晚一帧（`i222` 与后面的 `0x71`/present 同帧时无差别）。
 * **重开条件**：实测发现"`i222` 当帧画面必须立刻变"（例如某脚本 `i222` 之后立刻截图）
 * ⇒ 把 `op_scene_commit_range` 改成直接调宿主的同步提交口（模型侧已就绪，一行）。
 */
import type { OpHandler } from '../step.js';
import type { OpTable } from './shared.js';
import { operandsFor } from '../operandPlan.js';

/**
 * **`0x222` 3D 层区间提交**（`sub_423EC0` raw 31924-31934）：
 * `op1` = 起始 handle、`op2` = 跨度 ⇒ 区间 `[op1, op1 + op2)`。
 * 引擎把整段提交做成"当帧跑完整趟 `sub_4B4460`"，emulator 把区间**排进队列**，
 * 由帧级提交在帧末消费（模型侧 `renderer/scene/commit.ts`）。
 */
const op_scene_commit_range: OpHandler = (c) => {
  const p = operandsFor(c);
  // ★两个操作数**无条件先读出来**再交宿主：`c.native.sceneCommitRange?.(p?.int(1), …)` 那种写法在
  //   宿主没实现该缝（合成夹具的 StubNative / 未来的无场景宿主）时，**可选调用会连实参一起跳过**
  //   ⇒ 操作数一格都不被碰，`test/opcode-operands.test.ts` 的"1..argc 全被碰"会记成漏读。
  const start = p?.int(1) ?? 0;
  const count = p?.int(2) ?? 0;
  c.native.sceneCommitRange?.(start, count);
};

/** `0x222` 的实现表（与 `stubs.ts` 互斥：同一 opcode 只能在一张表里）。 */
export const SCENE_COMMIT_OPS: OpTable = [[0x222, op_scene_commit_range]];

/** `0x222` 的登记信息（供报告/守卫查询；不是 handler 表）。 */
export const SCENE_COMMIT_OPCODE = {
  opcode: 0x222,
  /** 引擎 handler / 体。 */
  engine: 'sub_423EC0 → sub_4B4460',
  /** 操作数：op1 = 起始 handle、op2 = 跨度（区间 `[op1, op1+op2)`）。 */
  operands: 'int,int (start,count)',
  /** 今天在哪张表（与 `handlers/index.ts` 的拼装一致）。 */
  registered: 'OPS',
  /** 模型侧实现所在模块。 */
  model: 'src/renderer/scene/commit.ts',
  /** 语料用量（`grep -c 'i222 ' src/*.txt`）。 */
  corpus: 10,
} as const;
