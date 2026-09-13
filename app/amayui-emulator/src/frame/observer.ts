/**
 * **FrameObserver（帧观察者）** —— "这一帧发生了什么"的统一出口（设计文档 §2 的 L3 / §3）。
 *
 * 为什么需要它：修前"对外表现"是**编在各入口里的日志**——Electron 写 trace/jsonl/HUD，
 * headless 写报告数组，两者既不共享格式也不共享字段。于是"两宿主是否表现一致"无法机械判定。
 * 把观察面显式化成接口后：
 *  - **Electron** 的观察者 = 控制窗（traceAll / 定向 trace / 未知指令跳过）+ 遥测 + 状态上报；
 *  - **headless** 的观察者 = `DigestCollector`（收 `FrameDigest`）+ 各链路自己的记账。
 *  - 两者是**同一种数据**（`onStep`/`onGate`/`onPresent` 的入参），只是消费者不同。
 *
 * ★它与 `FrameLoopOptions` 的 hooks 的关系：hooks 是**接线点**（B1 为了让既有入口零改动而引入的
 * 回调），`FrameObserver` 是**语义接口**。驱动内部把 observer 适配到同一批 hooks（见 `loop.ts` 的
 * `mkObserverHooks`）⇒ 两套不会漂移，且既有调用点不需要改签名。
 *
 * ★**`onStep` 可以是异步的**（`tickets/T-0004` 的 B4）：Electron 的纹理帧屏障
 * （`#awaitTextureBound`：`0x1F9` 之后等 IPC 载入完成）必须在"这一条指令之后、下一条之前"发生。
 * 驱动 `await` 它 ⇒ 屏障语义原样保留（修前它就在批内逐条 await）。
 */
import type { Engine, Frame } from '../vm/engine.js';
import type { StepTrace } from '../vm/interpreter.js';
import type { BinInstruction } from '../script/bin.js';
import type { FrameBranch, FrameLoopResult } from './loop.js';
import { digestToLine, type FrameDigest } from './digest.js';

/** 观察者能看到的一帧的坐标（帧号 / 时钟 / 累计计数）。 */
export interface FrameObservation {
  /** 本帧帧号（0 起）。 */
  frameIndex: number;
  /** 本帧时钟（ms，驱动每帧开头写进 `e.nowMs` 的同一个值）。 */
  nowMs: number;
  /** 累计完成帧数（含本帧，帧末钩子里可用）。 */
  frames: number;
  /** 累计派发指令数。 */
  steps: number;
  e: Engine;
}

export interface FrameObserver {
  /**
   * **本观察者要不要 `FrameDigest`**（★显式声明，理由：构建一份 digest 要跑一次全场景求值
   * `scSnapshot`，产品路径每帧都做是白花钱）。
   *
   * 驱动只在 `wantsDigest === true` 且宿主交得出场景模型时才构建并调 `onPresent`。
   * ★它必须是**可以后变的**（getter 或普通属性）：`--record` 是**运行中**挂上来的（`T-0005`），
   * 驱动每帧重新读这一项（见 `loop.ts` 的帧末）。
   */
  wantsDigest?: boolean;
  /** 帧初（时钟已写进 `e.nowMs`，每帧服务尚未开始）。 */
  onFrameStart?(o: FrameObservation): void;
  /** 本帧选了哪条分支（在分支体之前）。`branch` 是引擎主循环的不同段。 */
  onGate?(o: FrameObservation & { branch: FrameBranch }): void;
  /** **等待推进泵的结果**（紧接 `serviceAdvanceWait()` 之后；`advance: 'pump'` 档才有）。见 `loop.ts`。 */
  onAdvanceWait?(o: FrameObservation & { handled: boolean }): void;
  /** 每条指令**之前**（`instr` 可能是 `undefined` = ip 越界）。 */
  onStepStart?(o: FrameObservation & { frame: Frame; instr: BinInstruction | undefined }): void;
  /** 每条指令**之后**（可异步：Electron 的纹理帧屏障挂在这里）。 */
  onStep?(o: FrameObservation & { t: StepTrace }): void | Promise<void>;
  /** 脚本切换（只在"派发批"里检查）。 */
  onScriptChange?(o: FrameObservation & { name: string }): void;
  /**
   * **本帧的对外表现**（`FrameDigest`）—— 帧末、模型已推进之后调用一次。
   * ★只有宿主提供了 `FrameHost.digestState()` 时才会被调用（否则驱动无从构建）。
   */
  onPresent?(o: FrameObservation & { digest: FrameDigest }): void;
  /** 帧末（时钟推进/采样之后，`present` 之后）。 */
  onFrameEnd?(o: FrameObservation): void;
  /** 驱动停下来时调用一次（`stopReason` 见 `FrameLoopResult`）。 */
  onStop?(o: FrameObservation & { result: FrameLoopResult }): void;
  /**
   * 未实现指令（`NotImplementedOp`）：`'continue'` 记桩后继续、`'stop'` 结束本轮、`'throw'` 上抛。
   * ★返回 `undefined` = 交给 `FrameLoopOptions.onUnknown`（两者都给了 observer 优先）。
   */
  onUnknown?(err: unknown, phase: 'unknown'): 'continue' | 'stop' | 'throw' | undefined;
  /** 其它异常：`'continue'` 吞掉继续、`'stop'` 结束本轮、`'throw'` 上抛。 */
  onError?(err: unknown, phase: 'error'): 'continue' | 'stop' | 'throw' | undefined;
}

/**
 * **digest 收集器**（headless 侧最常用的观察者）：把每帧的 `FrameDigest` 收进数组。
 *
 * 用途：① G1 确定性（同一 Scenario 两次跑的 `lines()` 必须逐字节相等）；
 * ② G3 回放等价（与 Electron `--record` 落下的 digest 序列逐帧比对）；
 * ③ 失败定位（`diffEngineDigest` 直接说"第 N 帧的哪一项不同"）。
 */
export class DigestCollector implements FrameObserver {
  /** 要 digest（驱动据此每帧构建一份）。 */
  readonly wantsDigest = true;
  readonly digests: FrameDigest[] = [];

  onPresent(o: FrameObservation & { digest: FrameDigest }): void {
    this.digests.push(o.digest);
  }

  /** 逐行 JSONL（与 `--record` 落盘格式同源 ⇒ 可直接 diff）。 */
  lines(): string[] {
    return this.digests.map(digestToLine);
  }

  /** `engine` 段的短哈希序列（快速比对/断言用）。 */
  hashes(): string[] {
    return this.digests.map((d) => d.hash);
  }
}

/**
 * **合并多个观察者**为一个（按给定顺序逐个调用）。
 *
 * 用途（`tickets/T-0004`/`T-0005`）：Electron 的会话自带一个观察者（控制窗/trace/遥测），
 * 而 `--record` 需要在同一条链路上**再挂一个**记录器（收 `FrameDigest`）。让会话支持"额外观察者"
 * 比"把记录逻辑编进会话"干净：录制是**工具**的事，不是产品的事。
 *
 * ★策略类返回值（`onUnknown`/`onError`）取**第一个非 `undefined`** 的结果 —— 与"观察者按序负责"一致。
 */
export function mergeObservers(...list: (FrameObserver | undefined)[]): FrameObserver {
  const active = list.filter((o): o is FrameObserver => o !== undefined);
  /** 取出观察者里"是函数"的那些键（`wantsDigest` 是数据，不参与逐个转发）。 */
  type FnKey = {
    [K in keyof FrameObserver]-?: NonNullable<FrameObserver[K]> extends (...a: never[]) => unknown ? K : never;
  }[keyof FrameObserver];
  const each = <K extends FnKey>(k: K, ...args: Parameters<NonNullable<FrameObserver[K]>>): unknown => {
    for (const o of active) {
      const fn = o[k] as ((...a: unknown[]) => unknown) | undefined;
      if (fn) {
        const r = fn.apply(o, args);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };
  return {
    // 只有"至少一个来源要 digest"才算要（否则产品路径会白跑一次全场景求值）。
    wantsDigest: active.some((o) => o.wantsDigest === true),
    onFrameStart: (o) => void each('onFrameStart', o),
    onGate: (o) => void each('onGate', o),
    onAdvanceWait: (o) => void each('onAdvanceWait', o),
    onStepStart: (o) => void each('onStepStart', o),
    onStep: async (o) => {
      for (const ob of active) await ob.onStep?.(o);
    },
    onScriptChange: (o) => void each('onScriptChange', o),
    onPresent: (o) => void each('onPresent', o),
    onFrameEnd: (o) => void each('onFrameEnd', o),
    onStop: (o) => void each('onStop', o),
    onUnknown: (err, phase) => each('onUnknown', err, phase) as 'continue' | 'stop' | 'throw' | undefined,
    onError: (err, phase) => each('onError', err, phase) as 'continue' | 'stop' | 'throw' | undefined,
  };
}
