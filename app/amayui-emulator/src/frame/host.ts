/**
 * **帧宿主接口** —— 一帧里"引擎之外"需要的全部能力。
 *
 * 为什么要这个接口（2026-09，用户要求"让 headless 与 UI 的核心驱动完全一致"）：
 * 现在每个入口各自写了一遍帧循环（`session.ts` / `report.ts` / 两份 chain / `run.ts`），
 * 而它们对宿主的诉求其实只有很少几项。把这几项显式化成接口后，**驱动只需要一份**
 * （`frameLoop.ts`），Electron 与 headless 只在"实现了哪些能力"上分叉。
 *
 * ★**可选性是刻意的**：`present`/`needsRender`/`animationsDone`/`texturesIdle`/`audio` 目前只有
 * Electron 宿主有（`PixiBackend`）。B1 阶段（零行为变更）驱动对"宿主没有该能力"必须降级而不是报错，
 * 否则 headless 进不来；B3 会把 `audio`/`needsRender` 语义补到 headless 侧（那样两条路径才真的等价）。
 * 缺哪些能力 → 见 `tickets/T-0013`（宿主能力面入桥）。
 */
import type { AudioIntent } from '../audio/audioEngine.js';

export interface FrameHost {
  /**
   * 单调毫秒。Electron = 真实墙钟（`performance.now()`）；headless = 虚拟时钟（由调用方推进）。
   * 驱动每帧开头读它并写进 `e.nowMs` —— **这是"同一脚本同一时刻"可比的前提**（见 D1）。
   */
  now(): number;
  /** 让出一帧：Electron = `requestAnimationFrame`；headless = 立即 resolve（或不实现）。 */
  yield?(): Promise<void>;
  /**
   * **推进模型到本帧时钟**（引擎：合成时按 `CalcDiffuse`/窗状态求值 ⇒ 窗的相位与收尾在"这一帧的时间"上推进）。
   * 驱动在**每帧末**调一次，参数是本帧时钟。headless 实现（`scAdvance`）；pixi 目前把推进放在 presenter 里
   * （`tickets/T-0008` 的 D3 要在 B4 把它拆出来，与这里对齐）。
   */
  advanceModel?(nowMs: number): void;
  /** 合成一帧（渲染）。headless 无（它只推进模型 + 出快照）。 */
  present?(): void;
  /** "这一帧该不该合成"。headless 无。 */
  needsRender?(): boolean;
  /**
   * 场景动画是否跑完 —— `0x400` 动画等待门的放行判据（引擎 `sub_407E20` 的图形池计时）。
   * ★参数是本帧时钟：headless 直接拿它算（避免"读上一帧时钟"那个偏差）；pixi 暂时忽略它用自己的
   * `clockMs`（`tickets/T-0008` 要修的正是这一处）。
   */
  animationsDone?(nowMs: number): boolean;
  /** 纹理帧屏障（引擎 `0x1F9` 是同步读文件，renderer 走异步 IPC ⇒ 需要补偿）。headless 无纹理，跳过。 */
  texturesIdle?(): Promise<void>;
  /** 音频帧泵（`Engine+430600` 那一族的等价物）。目前只有 Electron 有（见 T-0006）。 */
  audio?(intent: AudioIntent): void;
}
