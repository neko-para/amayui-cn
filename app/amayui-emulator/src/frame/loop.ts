/**
 * **共享帧驱动**（唯一一份）—— emulator 的"帧"应该在这里被定义，而不是在每个入口各写一遍。
 *
 * ## 它到底管什么
 * 引擎主循环每帧的顺序（`docs-new/03-engine/engine-reset-mainloop.md`、raw 20887-20895、`sub_411900`）：
 * ```
 * ① 取时钟（wall / 虚拟）            → host.now() → e.nowMs
 * ② 每窗「逐行贴出」闸门  0x300       → serviceWinReveal()
 * ③ 字格图标动画          0x73        → serviceCharGrid()
 * ④ 门：0x400 动画等待 / sleep        → 等条件成立才清位（`0x400` = 池挂起位 + `0x238` 计时器，`T-0024`）
 * ⑤ 逐字显现泵            sub_45BE20  → serviceTextReveal()
 * ⑥ 等待推进门（bit31）               → 泵（产品）/ forceAdvance（headless 现状）/ 忽略
 * ⑦ ADV 分支（sub_411900）            → serviceAdv() + **恰好 1 条**指令
 * ⑧ 常规：派发一批指令，遇门即停
 * ⑨ 帧末：present / 推进虚拟时钟 / 让帧
 * ```
 * 上面 ①–⑨ 就是本文件；各入口的差异**只能**通过 `FrameLoopOptions` 显式表达（B1 的纪律：
 * 不许"顺手统一"，任何行为变化都要留给 B2 并写成 before/after 对照）。
 *
 * ## 哪些差异是显式的（B1 现状）
 * | 维度 | 产品（Electron） | report.ts | 两份 chain | run.ts |
 * |---|---|---|---|---|
 * | 批上限 | 10000 | 4096 | 5000 / 20000 | 1（每轮一条） |
 * | `0x400` 门 | `'wait'`（等动画） | `'ignore'`（无分支） | `'wait'` | `'clear'` |
 * | `sleep` 门 | `'wait'` | `'ignore'` | `'wait'` | `'ignore'` |
 * | 等待推进 | `'pump'`（真泵+悬停） | `'force'` | `'force'` | `'force'` |
 * | ADV 分支 | 开 | 开 | 开 | **关** |
 * | 时钟 | 墙钟 | 虚拟：**帧边界由 `onStep` 判** | 虚拟：每帧末 +16.67 | 虚拟：只在逐字分支 +16 |
 * | present | `'needsRender'` | 无 | 无 | 无 |
 * | present（B3 加的档） | — | — | — | `'needsRender'` 已可用：只跳过"画"，`advanceModel`/音频 tick 照旧 |
 * | 音频帧泵（B3 加） | `'host'`（`session.#present()` 现在也发一次 ⇒ B4 删） | `'never'`（C2：tracer 不假装每帧） | `'host'`（宿主暂无 `audio` ⇒ 空转） | `'host'`（同上） |
 *
 * ★`run.ts` 的"逐字分支排在 `serviceWinReveal` 之前 + 时钟只在那一支前进"是**缺陷**（`tickets/T-0012`），
 * 不在 B1 范围内 —— 把那套顺序编码进共享驱动等于把缺陷固化。它随 B2 一起改。
 */
import { SLEEP_GATE, type Engine, type Frame } from '../vm/engine.js';
import { ENGINE_FIELD } from '../vm/engineFieldIds.js';
import { CFG } from '../configRegistry.js';
import { cfgInt } from '../engineConfig.js';
import { STAGE_GATE } from '../vm/stageLoop.js';
import { NotImplementedOp, stepOnce, type StepTrace } from '../vm/interpreter.js';
import { profiler } from '../vm/profile.js';
import { ExitScript } from '../vm/ops.js';
import type { BinInstruction } from '../script/bin.js';
import type { FrameHost } from './host.js';
import { buildFrameDigest } from './digest.js';
import type { FrameObservation, FrameObserver } from './observer.js';

/** 门的处理方式。**三种都要保留**（B1 不改行为，B2 才收敛）。 */
export interface FrameLoopGates {
  /**
   * `0x400` 动画等待门（`0x21C wait` 置位；引擎由 `sub_407E20` = 池挂起位 + `0x238` 计时器放行）：
   *  - `'wait'`（产品）：按引擎语义放行 —— `Engine.serviceWaitGate(nowMs)`（`tickets/T-0024`）；
   *  - `'clear'`：每帧无条件清（`run.ts` 的 `StubNative` 宿主**没有场景模型** ⇒ 没有任何挂起可言）；
   *  - `'ignore'`：完全不看这一位（`report.ts` 的现状）。
   */
  anim?: 'wait' | 'clear' | 'ignore';
  /** `sleep(0xC8)` / `0x6E` 后的节流门：`'wait'` 等 `nowMs >= sleepUntil`；`'clear'` 直接清；`'ignore'` 不看。 */
  sleep?: 'wait' | 'clear' | 'ignore';
  /**
   * **阶梯动画门**（`0x40`；`0xD5 i0d5` 置位，引擎主循环 raw 21154-21156 由 `sub_408F10` 放行）：
   *  - `'wait'`（默认，与引擎同源）：按时间表判定 —— 到点 ⇒ 清门 + 把 `ip` 指到条目 label 后照常派发；
   *    未到点 ⇒ **本帧不派发任何指令**（引擎那里是 `Sleep(1)` 后 return）；
   *  - `'ignore'`：不看时间（恒"到点"）⇒ 每帧推进一步。供时钟粒度/虚拟时钟可能与
   *    `0xD4` 的 step 同量级的入口用（否则时间表可能永远不推进）。
   */
  stage?: 'wait' | 'ignore';
  /**
   * 等待推进门（`0x72 wait-for-input` 的 bit31）：
   *  - `'pump'`（产品）：`serviceAdvanceWait()`（键命中/点击/悬停三条出口都在引擎内部）；
   *  - `'force'`：`forceAdvance()`（headless 现状；**与真泵刻意不同**，见 `Engine.forceAdvance`）；
   *  - `'ignore'`：不看这一位，直接往下走。
   */
  advance?: 'pump' | 'force' | 'ignore';
}

/** 本帧走了哪条分支（引擎主循环的不同段；观察者与调用方记账用）。 */
export type FrameBranch = 'anim' | 'sleep' | 'stage' | 'text-reveal' | 'advance' | 'adv' | 'batch';

/**
 * **帧提交门**（引擎主循环 raw 20740-20761；`tickets/T-0167` 的 §4.2 #3/#6/#7）。
 *
 * 引擎那一段逐字是：
 * ```c
 * if ( *(_DWORD *)(_this + 667856) == 1 )                        // ① DrawMode == 1（set:DrawMode）
 * {
 *   if ( *(_DWORD *)(_this + 675968) ) { v92 = 0; }              // ② 外部挂起 ⇒ 整块跳过
 *   else if ( *(_DWORD *)(_this + 667860)                        // ③ 通用布尔位（0x21B 写）
 *          || (*(_DWORD *)(_this + 699204) & 0x2400) != 0 )      //    或 effect_flags 的 0x2400 位
 *   {
 *     v92 = 1;
 *     *(_DWORD *)(_this + 369336) = *(_DWORD *)(_this + 369332); // ④ 帧时钟：clockPrev ← clock
 *     *(_DWORD *)(_this + 369332) = v94;                         //            clock     ← 本帧时刻
 *     v16 = *(_DWORD *)(_this + 699204);
 *     if ( (v16 & 0x1000000) == 0 && !v93                        // ⑤ 提交内层门（见下）
 *       && (!*(_DWORD *)(_this + 429752) || (v16 & 0x400) != 0)
 *       && (sub_40BE10((_DWORD *)(_this + 322832)) == 1 || v90 == 1) )
 *     {
 *       sub_4B4040(_this + 322832);                              // ⑥ 2D 绘制循环 / 帧提交
 *       *(_DWORD *)(_this + 675992) = 0;
 *     }
 *   }
 *   else { v92 = 0; }
 *   if ( sub_404C20((_DWORD *)(_this + 321572)) )                // ⑦ LostDevice 回调（与门无关，恒执行）
 *     sub_411560((_DWORD *)_this, aCallbackLostBi);
 * }
 * ```
 *
 * ★**为什么 emulator 的 `present` 不按这个门开关**：本块的 `sub_4B4040` 是 **DrawMode==1 的 D3D 提交**，
 *   而随包 INI 实测 `DrawMode=0` ⇒ 真机默认配置**根本不进这一块**（它在另一条 GDI 路径上出帧）。
 *   emulator 的 `host.present()` 同时代表两条路径的"出帧"，所以按 `drawMode==1` 去门它会让默认配置
 *   **一帧都不画**（实测回归）。⇒ 这里把门**建模成可观察量**（`clockWrite` / `d3dCommit`）+ 把门内
 *   **唯一会改变 VM 状态的副作用**（④ 帧时钟写）真正接上；`d3dCommit` 是"引擎在该帧会走 D3D 提交"的
 *   等价信号，交给 `onFrameRenderGate` 的消费者（headless 记账 / 以后接真 D3D 路径）。
 *
 * ★⑤ 里 `v93`、`v90` 与 `sub_40BE10`（池查询）三者在反编译里是主循环局部量，未定位到脚本可见来源
 *   ⇒ 本模型只落**能判定的两条**（`effect_flags & 0x1000000` 与停靠锁/`0x400`），并在 `unknown`
 *   字段里显式标出这半条与 raw 锚点（不许假装完整）。
 */
export interface FrameRenderGate {
  /** ① `Engine+667856 == 1`（`set:DrawMode`）。为假 ⇒ 引擎整块不进。 */
  drawMode: boolean;
  /** ② 宿主报告"外部挂起渲染"（`Engine+675968`）。 */
  suspended: boolean;
  /** ③ 门是否开（`engineBool` 或 `effect_flags & 0x2400`）。 */
  gateOpen: boolean;
  /** ④ 本帧**是否写了**帧时钟（`engineValues` 的 `clockPrev`/`clock`）。 */
  clockWrite: boolean;
  /** ⑤/⑥ 在**可判定条件**下引擎本帧会不会走 `sub_4B4040` 提交。 */
  d3dCommit: boolean;
  /** 未落地的条件（`raw 20753-20756` 的 `!v93`、`sub_40BE10(...) == 1 || v90 == 1`）。 */
  unknown: string[];
}

/**
 * 判定一帧的帧提交门（纯函数；**不改任何状态**——写时钟由调用方做）。
 * `suspended` 缺省 false（宿主没实现该缝 = 未挂起）。
 */
export function frameRenderGate(e: Engine, suspended = false): FrameRenderGate {
  const drawMode = e.config != null && cfgInt(e.config, CFG.setDrawMode, 0) === 1;
  if (!drawMode) {
    return { drawMode, suspended, gateOpen: false, clockWrite: false, d3dCommit: false, unknown: [] };
  }
  if (suspended) {
    return { drawMode, suspended, gateOpen: false, clockWrite: false, d3dCommit: false, unknown: [] };
  }
  const engineBool = e.engineValues.get(ENGINE_FIELD.engineBool) ?? 0;
  const gateOpen = engineBool !== 0 || (e.effectFlags & 0x2400) !== 0;
  if (!gateOpen) {
    return { drawMode, suspended, gateOpen: false, clockWrite: false, d3dCommit: false, unknown: [] };
  }
  // ⑤ 内层门：能判定的两条 + 显式登记的未知两条。
  const lock = e.engineValues.get(ENGINE_FIELD.frameTickLock) ?? 0;
  const known = (e.effectFlags & 0x1000000) === 0 && (lock === 0 || (e.effectFlags & 0x400) !== 0);
  const unknown = [
    'raw 20754 `!v93`：主循环局部量，未定位来源',
    'raw 20756 `sub_40BE10(pool) == 1 || v90 == 1`：池查询/局部量',
  ];
  return { drawMode, suspended, gateOpen: true, clockWrite: true, d3dCommit: known, unknown };
}


export interface FrameLoopOptions {
  gates?: FrameLoopGates;
  /** 每帧服务开关（产品全开；`run.ts` 目前关着 charGrid）。 */
  services?: { winReveal?: boolean; charGrid?: boolean };
  /** 一帧内最多派发多少条指令（默认 `Infinity` = 一直派发到遇门/脚本尾）。 */
  maxStepsPerFrame?: number;
  /** ADV 分支（`sub_411900`）：每帧**恰好派发 1 条**。`false` = 不区分（`run.ts` 现状）。 */
  advFrame?: boolean;
  /**
   * ADV 分支里指令抛异常时：`'stop'`（产品：`session.#stepOnceTraced` 的错误策略会终止会话）
   * 或 `'swallow'`（两份 chain 的现状："ADV 分支的异常按本帧无进展处理"—— 连 `NotImplementedOp`
   * 带 `throw` 策略时也会被吞掉）。**这是现存的真实差异，B1 原样保留，B2 再决策。**
   */
  advErrors?: 'stop' | 'swallow';
  /** 首次进入时的"上一个脚本名"（调用方跨多次 `runFrameLoop` 自己记着它，否则 ADV 分支里的脚本切换会漏报）。 */
  initialScript?: string;
  /** 帧初（时钟已写进 `e.nowMs`）。 */
  onFrameStart?(nowMs: number, frameIndex: number, e: Engine): void;
  /** 本帧选了哪条分支（在分支体**之前**调用）。`tickets/T-0001` 的 `report.ts` 接线靠它做逐分支记账。 */
  onGate?(branch: FrameBranch, e: Engine): void;
  /**
   * **等待推进泵的结果**（`gates.advance: 'pump'` 时，紧接 `serviceAdvanceWait()` 之后）。
   *
   * ★为什么需要它：泵的返回值是"这一帧**处理掉了**一次推进"（命中热点/键/点击，或把页内文本推完），
   * 而 `'force'` 档没有这个语义。观察者要还原"advance-wait handled / hover-label"这两条证据行，
   * 就必须知道这个布尔值 —— 驱动把它显式交出来，而不是让观察者去猜（`tickets/T-0004` 的 G4 实测：
   * 少了它，日志里那一条 `=== advance-wait handled → - ===` 会消失）。
   */
  onAdvanceWait?(handled: boolean, e: Engine): void;
  /** 每条指令**之前**（`instr` 可能是 `undefined` = ip 越界）。 */
  onStepStart?(frame: Frame, instr: BinInstruction | undefined, e: Engine): void;
  /**
   * **每条指令派发前**的异步闸门（`tickets/T-0114` 第 2 步的断点用它）。
   *
   * ★为什么必须是**异步**（而不是在 `onStepStart` 里同步处理）：
   * 断点命中后要"停住等用户点继续"，而**只能**通过 `await` 一个 Promise 来实现 ——
   * 若在渲染进程里**同步阻塞**等控制窗指令，会把这个进程自己处理"继续"的那条 IPC 通道也冻住（死锁）。
   * 本工程已有同一 idiom：`onStep` 就是异步的（Electron 纹理帧屏障挂在它上面）。
   *
   * ★为什么用 `onBeforeStep` 而不是复用 `onStep`：
   * `stepOnce` 查表/抛错阶段**不修改任何 VM 状态**，所以"命中即停"必须发生在**执行之前** ——
   * 停在 `onStep`（执行之后）时那条指令已经跑掉了，断点就"看得见却停不住"。
   * 且 `onStep` 在 `stepOnce` **抛错**时不会触发（提前 return），而断点要能停在"即将抛错的那一条"上。
   */
  onBeforeStep?(frame: Frame, instr: BinInstruction | undefined, e: Engine): void | Promise<void>;
  /**
   * **每条指令执行之后的"语义事件"闸门**（`tickets/T-0114` 第 2 步）。
   *
   * 为什么事件暂停要放在**执行之后**（而条件断点在执行之前）：
   * 事件是 `stepOnce` **内部**发生的（写全局 / 绑槽），同步函数里没有 await 点 ⇒
   * VM 只能**同步记录**"刚刚发生了什么"（`Engine.debugEvent`），由这里 `await` 落地暂停。
   * ★因此事件断点的暂停点**略过**那条指令（帧已前进），但**状态已经是写完之后**的 ——
   * 对"谁把它改成了 1"这类问题这恰恰是我们想要的。
   */
  onAfterStepEvent?(frame: Frame, e: Engine): void | Promise<void>;
  /** 每条指令**之后**（成功执行完）。★可以是异步的：Electron 的纹理帧屏障挂在这里（见 `observer.ts`）。 */
  onStep?(t: StepTrace, e: Engine): void | Promise<void>;
  /** 未实现指令的策略；默认 `'throw'`。 */
  onUnknown?(err: NotImplementedOp, frame: Frame, instr: BinInstruction | undefined): 'continue' | 'stop' | 'throw';
  /** 其它异常的策略（`ExitScript` 不经过这里，它由驱动直接停）。默认 `'throw'`。 */
  onError?(err: unknown): 'stop' | 'continue' | 'throw';
  /** 脚本切换（只在"派发批"里检查，与现有各家的做法一致）。 */
  onScriptChange?(name: string, e: Engine): void;
  /** 帧末（推进虚拟时钟 / 采样；驱动随后按 `present` 决定要不要让宿主合成）。 */
  onFrameEnd?(nowMs: number, frameIndex: number, e: Engine): void;
  /**
   * 帧末是否让宿主**合成**（= **推进模型**的唯一时机）：
   *  - `'host'`（默认）：调 `host.present?.(nowMs)` —— 产品与两份 chain 都走这条（一帧推进一次模型）；
   *  - `'needsRender'`：**先推进模型**（`advanceModel` 从不跳过：窗末收尾就在那里），
   *    再仅当 `host.needsRender?.() ?? true` 为真时 `present` —— 引擎式"没变就不重画"（`tickets/T-0003`）。
   *    两个宿主都必须能回答 `needsRender`（差异表里已不含它，见 `test/native-tap.test.ts`）；
   *  - `'never'`：调用方自己在钩子里推进（`report.ts` 现状：它是**指令驱动**的 tracer，帧边界由
   *    `FRAME_OPS`/批上限决定 ⇒ 见 `tickets/T-0002/notes.md` 的 C2 决策）。
   */
  present?: 'host' | 'never' | 'needsRender';
  /**
   * **每帧的音频帧泵**（引擎 raw 20645-20646：`sub_4B5230`(SE 通道老化/延迟到期) + `sub_4BBAB0`(语音队列)；
   * 语义见 `docs-new/03-engine/sound-system.md`）：
   *  - `'host'`（默认）：每帧调一次 `host.audio({ kind:'tick', nowMs, advActive })`；
   *  - `'never'`：一次都不发（`report.ts`：它是指令驱动的 tracer ⇒ 连"每帧"都不假装，也保证 G2 逐字节不变）。
   *
   * ★**所有权**（`tickets/T-0003` 的 D5）：帧泵归**驱动**，不归宿主的合成函数。
   * 现状：产品路径（`session.ts`）还没迁到驱动，它自己在 `#present()` 里发一次（`T-0004` 会删掉那一处）；
   * 而 headless 侧（两份 chain / run.ts）的宿主目前没有 `audio` ⇒ `?.` 空转，等 `T-0006` 补上就自然生效。
   */
  audio?: 'host' | 'never';
  /** 每帧开头检查：为真则立即结束（返回值同"提前结束"）。 */
  until?(): boolean;
  /**
   * **每条指令之后**检查：为真则立即结束（`stopReason = 'step-stop'`）。
   *
   * 为什么必需（`tickets/T-0002` 第 2 批实测）：`until` 只在**帧开头**判，而一帧可以派发一整批
   * （上限可达 20000）⇒ "到达目标"其实会**越过目标最多一整批**。E3 链路因此出现
   * "停在 SN0000 之后的 CHARMEDIT"、以及"幕布已经淡完"这类**停止点伪影**（实测 283100 步 vs 250913 步）。
   * 有了它，`until` 与 `stopAfterStep` 传同一个条件就能"**恰好停在目标**"。
   */
  stopAfterStep?(t: StepTrace, e: Engine): boolean;
  /** 本次调用最多跑多少帧。 */
  maxFrames?: number;
  /**
   * **帧提交门的观察点**（`tickets/T-0167`；`frameRenderGate()` 的返回值）。
   * 门内唯一改 VM 状态的副作用（帧时钟写）由驱动自己落地，本钩子只把"这一帧引擎会怎么走"交出去
   * （headless 记账 / 以后接真 D3D 路径）。`present: 'never'` 的入口（report.ts 的 tracer）不触发。
   */
  onFrameRenderGate?(gate: FrameRenderGate, e: Engine): void;
  /**
   * **帧观察者**（设计文档 §2 的 L3；`tickets/T-0004` 的 B4 靠它把 Electron 的
   * 控制窗/trace/遥测/jsonl 从会话里搬出来）。
   *
   * ★它与上面那批 `onXxx` 回调是**同一批接线点**：驱动内部把 observer 适配成 hooks
   * （`mkObserverNest`），两者都给时**同时**调用（hooks 优先在场，observer 只做观察）——
   * 这样既有调用点（`report.ts`/两份 chain）一行都不用改，而新入口可以只写一个 observer。
   * 唯一的例外是 `onUnknown`/`onError` 的**策略**：observer 的返回值优先（它更靠近产品语义）。
   */
  observer?: FrameObserver;
}

/** 驱动为什么停下来（调用方据此还原各自的返回语义）。 */
export type StopReason = 'until' | 'step-stop' | 'cap' | 'script-end' | 'exit' | 'unknown' | 'error';

export interface FrameLoopResult {
  /** 已完整跑完的帧数。 */
  frames: number;
  /** 已派发的指令数。 */
  steps: number;
  stopReason: StopReason;
  /** `unknown`/`error` 时的原始异常（供调用方决定 throw 还是记录）。 */
  error?: unknown;
}

/**
 * 跑帧循环。**行为完全由 `gates`/`services`/`maxStepsPerFrame`/`advFrame`/钩子决定**，
 * 驱动本身不含任何入口专有的判断。
 */
export async function runFrameLoop(e: Engine, host: FrameHost, opt: FrameLoopOptions = {}): Promise<FrameLoopResult> {
  const gates: Required<FrameLoopGates> = {
    anim: opt.gates?.anim ?? 'wait',
    sleep: opt.gates?.sleep ?? 'wait',
    advance: opt.gates?.advance ?? 'pump',
    stage: opt.gates?.stage ?? 'wait',
  };
  const services = { winReveal: opt.services?.winReveal ?? true, charGrid: opt.services?.charGrid ?? true };
  const maxSteps = opt.maxStepsPerFrame ?? Number.POSITIVE_INFINITY;
  const cap = opt.maxFrames ?? Number.POSITIVE_INFINITY;
  const audioPolicy = opt.audio ?? 'host';
  const obs = opt.observer;

  let frames = 0;
  let steps = 0;
  /** 上一帧的时钟（累加游玩时长用；见 `Engine.playSeconds`）。 */
  let prevNowMs: number | null = null;
  let lastScript = opt.initialScript ?? e.curScript().name;

  /** 帧内观察（`frameIndex` = 正在处理的帧号）。 */
  const obsMid = (): FrameObservation => ({ frameIndex: frames, nowMs: e.nowMs, frames, steps, e });
  /** 帧末观察（`frames` 已自增 ⇒ 刚完成的那一帧是 `frames - 1`）。 */
  const obsEnd = (nowMs: number): FrameObservation => ({ frameIndex: frames - 1, nowMs, frames, steps, e });

  /** 派发一条指令的结果（`'ok'` 之外都表示"整轮结束"，由调用方还原语义）。 */
  type DispatchResult = 'ok' | 'exit' | 'unknown' | 'error' | 'step-stop';

  /** 派发一条指令。 */
  const dispatch = async (): Promise<DispatchResult> => {
    const frame = e.curScript();
    const instr = frame.script?.instructions[frame.ip];
    opt.onStepStart?.(frame, instr, e);
    obs?.onStepStart?.({ ...obsMid(), frame, instr });
    // ★断点闸门：**执行之前**、且在 `stepOnce` 的"查表/抛错"之前（见 `onBeforeStep` 的说明）。
    //   命中就 await（停在同一条指令上，用户点继续后从这条继续执行）。
    await opt.onBeforeStep?.(frame, instr, e);
    let t: StepTrace;
    try {
      t = await stepOnce(e);
    } catch (err) {
      if (err instanceof ExitScript) return 'exit';
      if (err instanceof NotImplementedOp) {
        const what = obs?.onUnknown?.(err, 'unknown') ?? opt.onUnknown?.(err, frame, instr) ?? 'throw';
        if (what === 'throw') throw err;
        return what === 'stop' ? 'unknown' : 'ok';
      }
      const what = obs?.onError?.(err, 'error') ?? opt.onError?.(err) ?? 'throw';
      if (what === 'throw') throw err;
      return what === 'stop' ? 'error' : 'ok';
    }
    steps++;
    // ★`await`：Electron 的纹理帧屏障（`0x1F9` 之后等 IPC）必须在"这条之后、下一条之前"。
    await opt.onStep?.(t, e);
    await obs?.onStep?.({ ...obsMid(), t });
    if (opt.stopAfterStep?.(t, e) === true) return 'step-stop';
    // 语义事件闸门：VM 在 `stepOnce` 内记下的"刚发生了事件"在这里落地成暂停。
    await opt.onAfterStepEvent?.(frame, e);
    return 'ok';
  };

  /** 收尾：通知观察者 + 返回（所有出口都经它，避免漏报 `onStop`）。 */
  const finish = (result: FrameLoopResult): FrameLoopResult => {
    obs?.onStop?.({ ...obsMid(), result });
    return result;
  };

  for (;;) {
    if (frames >= cap) return finish({ frames, steps, stopReason: 'cap' });
    if (opt.until?.()) return finish({ frames, steps, stopReason: 'until' });

    // ★帧看门狗（`tickets/T-0180`）：帧首取一次时钟。默认开着 —— "界面卡了 4 秒"这类问题
    //   不靠它就只能靠推理，而推理在本工程已经被证伪过好几次（实测：读槽头在文件层只要 2ms）。
    profiler.attachLog(e.native.log);
    profiler.beginFrame(steps);

    const nowMs = host.now();
    e.nowMs = nowMs;
    opt.onFrameStart?.(nowMs, frames, e);
    obs?.onFrameStart?.(obsMid());

    // ★**主循环 `0x4000000` 臂**（引擎 raw 20859-20881；`tickets/T-0175` ⑬ / `T-0169`）：
    //   「重显示（回看）模式下玩家一有输入 ⇒ 退出重显示 + 回到备用游标 + 写
    //   `redisplayMode`/`redisplayReturn`/`redisplayScriptId` 三格」。它在引擎里**早于**字格泵
    //   （raw 20887）与闸门/显示态各泵，且**不受** ADV/等待位门控 ⇒ 放在帧首、无条件。
    e.serviceRedisplayExit();
    if (services.winReveal) e.serviceWinReveal(nowMs);
    if (services.charGrid) e.serviceCharGrid(nowMs);

    let stop: StopReason | null = null;
    /** 本帧是否按常规派发一批。`stage` 门到点时也走同一条派发路径（只是分支记账不同）。 */
    let batch = false;
    if (gates.anim !== 'ignore' && (e.waitFlags & 0x400) !== 0) {
      opt.onGate?.('anim', e);
      obs?.onGate?.({ ...obsMid(), branch: 'anim' });
      // 引擎主循环 raw 21109-21152：`!sub_407E20(pool)` ⇒ 清门放行；否则本帧什么都不派发
      // （玩家可跳过那条路在 raw 21113-21135，本驱动的 `skipWaitGate()` 出口见下）。
      if (gates.anim === 'clear' || e.serviceWaitGate(nowMs)) e.waitFlags &= ~0x400;
    } else if ((e.waitFlags & STAGE_GATE) !== 0) {
      opt.onGate?.('stage', e);
      obs?.onGate?.({ ...obsMid(), branch: 'stage' });
      // ★**阶梯动画门**（引擎主循环 raw 21154-21156：`if ((flags & 0x40) == 0) break; sub_408F10(_this);`）：
      //   到点 ⇒ `serviceStageLoop` 清 `0x40` 并把 `pc` 指到时间表里的 label ⇒ 本帧按常规派发那一段
      //   （脚本体 `ret` 回到 `i0d5`，还有条目就再置门 ⇒ 下面这批的 break 条件会在这里收住）；
      //   未到点 ⇒ 本帧**什么都不派发**（引擎那里 `Sleep(1)` 后 return，门保持置位）。
      //   `gates.stage === 'ignore'` = 不做时间判定（恒到点，每帧一步）——给时钟粒度与
      //   `0xD4` 的 step 同量级的 headless 入口用，否则时间表可能永远不推进。
      batch = e.serviceStageLoop(nowMs, gates.stage === 'ignore');
      // ★**ADV 分支必须排在 `sleep` 门之前**（订正审计 `op-10-002`）。引擎主循环的次序是：
      //   raw 21109/21154 的 `0x400`/`0x40` 门 → raw 21158 `if ((v35 & 0x8000000) == 0) break;`
      //   的 **ADV 循环**（`sub_411900` + 池冻结 + `Sleep(0)`）→ 只有 ADV 位**清掉**才 break 到
      //   raw 21176 `if ((v35 & 0x20000000) != 0) { sub_409400(_this); … }`（MessageSpeed 节流 / 逐字泵）。
      //   修前 `sleep` 门排在 ADV 之前 ⇒ ADV 位与 `SLEEP_GATE`（同为 `0x20000000`）同时置位时，
      //   帧循环先空等 MessageSpeed ms 而不服务 ADV（跳读/自动模式每段文本多等一拍）。
    } else if (opt.advFrame === true && e.advActive) {
      opt.onGate?.('adv', e);
      obs?.onGate?.({ ...obsMid(), branch: 'adv' });
      e.serviceAdv();
      // 引擎 raw 21158-21161：ADV 分支每帧 `sub_411900(...)` 之后紧跟 `sub_407EA0(pool)` ——
      // 置强制冻结并清等待计时器（`tickets/T-0024`）。★放在 `serviceAdv()` 之后与引擎同序。
      e.skipWaitGate();
      // ★★**本帧「恰好一条指令」的唯一例外**（引擎 raw 20133-20136）：`set:CancelMesSkipOnClick`
      //   取值 **2** 且取消消息键走完 2→0 那一帧时，`sub_411900` **整帧 return** —— 3 槽交付
      //   （raw 20144-20160）与那条指令（raw 20161-20165）都不做。`serviceAdv()` 用
      //   `advFrameAborted` 把这件事交出来（`tickets/T-0169` 判据②的「按体补齐」）。
      if (!e.advFrameAborted) {
        if (opt.advErrors === 'swallow') {
          // 两份 chain 的现状：ADV 分支的任何异常都按"本帧无进展"处理（含 NotImplementedOp 的 throw 策略）
          try {
            await dispatch();
          } catch {
            /* 吞掉：与 `gameStartChain`/`config1Chain` 的 `catch {}` 一致 */
          }
        } else {
          const r = await dispatch();
          if (r !== 'ok') stop = r;
        }
      }
    } else if (gates.sleep !== 'ignore' && (e.waitFlags & SLEEP_GATE) !== 0) {
      opt.onGate?.('sleep', e);
      obs?.onGate?.({ ...obsMid(), branch: 'sleep' });
      // ★★**节流位置位时，引擎是「调文本泵」而不是「空等」**（2026-09 用户实测修正）：
      //   主循环 raw 21176-21181 `if ((v35 & 0x20000000) != 0) { sub_409400(_this); if (Engine[489860]) goto LABEL_215; }`
      //   —— `0x20000000` = 本驱动的 `SLEEP_GATE`（由 `0x6E` 与 `0x196` 的第①②路置位，见 `tickets/T-0094`）；
      //   `sub_409400` 内部就是「等节拍（`sub_453B60`）→ 推进一个字（`sub_45BE20`）→ 无窗在节流时清 `0x20000000`」（raw 13857-13893）。
      //   ⇒ **节流期间必须继续跑逐字泵**；只有 0x300 闸门槽活跃（`Engine[489860]`）时才不派发脚本。
      //   ★修前这里什么都不做 ⇒ 逐字既不推进也不重绘，等门清掉才一次性出现
      //   （用户实测：E4 日志里 ADV 的 `[reveal]` 只有 `0/N` 与最终 `N/N`、中间全是 `gate sleep WAIT`；
      //   而 `0x196` 把节流位带进了 6341 处 `display-furigana` ⇒ 症状在 `T-0094` 之后大幅变明显）。
      e.serviceTextReveal(nowMs);
      // ★★`tickets/T-0099`：**到点当帧就派发**（对齐引擎的"下一轮"）。
      //   引擎 raw 21176-21181：`if ((v35 & 0x20000000) != 0) { sub_409400(_this); if (Engine[489860]) goto LABEL_215; }`
      //   —— `sub_409400` 返回（= 节拍到点、且把 `0x20000000` 清掉）之后：`Engine[489860]`（`0x300` 闸门槽）
      //   活跃就**当轮直接派发**（`LABEL_215` = raw 21217 的 handler 调用）；不活跃则本轮结束、
      //   **下一轮**派发 —— 而引擎的"下一轮"只是一次 `Sleep(0)` 级的廉价循环迭代，不是一帧。
      //   emulator 的循环迭代 = 一帧（`requestAnimationFrame` / 虚拟时钟 +16.7ms）⇒ 旧写法"本帧只清门、
      //   下一帧才派发"每处**多等一帧**（实测 40ms 档：66.7ms = 4 帧，引擎约 50ms = 3 帧）。
      //   ⇒ 到点就当帧走常规派发（`batch = true`）；**未到点仍一帧都不派发**（这就是"不许放宽门"）。
      //   ★范围限定在门判定这一处：动画窗/转场窗/阶梯时间表的到点语义都不动。
      if (gates.sleep === 'clear' || nowMs >= e.sleepUntil) {
        e.waitFlags &= ~SLEEP_GATE;
        // ★当帧派发的**前提是"文本泵也已经跑完"**（`!e.textRevealing`）。为什么：引擎里 `0x20000000`
        //   是**逐字泵**在置/清（`sub_409400` 只在"没有窗在节流"时才清它）—— 还在逐字时引擎**不会**
        //   掉进派发路径，而是继续泵下一字。emulator 把"节流到期"与"泵还活着"两件事折在一个门上
        //   （`sleepUntil`），所以这里必须显式排除"泵还在跑"这一态，否则门一到点就派发后面的指令
        //   ⇒ 页面提前收尾、逐字停在半句（实测：`test/adv-reveal-under-throttle.test.ts` 的坑 B
        //   从"显完 8 字"退化成"停在 5 字"）。这一条就是本改动**不许搬家**的地方。
        if (gates.sleep !== 'clear' && !e.textRevealing) batch = true;
      }
    } else if (e.textRevealing) {
      opt.onGate?.('text-reveal', e);
      obs?.onGate?.({ ...obsMid(), branch: 'text-reveal' });
      // ★★**T-0169 判据②的结论：这条分支与等待泵的互斥是**忠实的**，不拆**（2026-09 读体复核；
      //   该结论同时落在 `analysis/engine-capabilities.json` 的 `text-reveal-pump-409400` /
      //   `adv-perframe-dispatch` 与 `tickets/T-0169/changes-reveal.md` §1-①）。
      //
      // 1) **起点是归属错**：本分支（`serviceRevealAdvanceInput` + `serviceTextReveal`）对应的
      //    **不是** `sub_411900`，而是 `sub_409400`（引擎主循环 raw 21176-21181 的
      //    `if ((v35 & 0x20000000) != 0) { sub_409400(_this); … }` 那一臂）；`sub_411900` 的对口
      //    是上面的 **adv 分支**（`serviceAdv()` + 恰好 `dispatch()` 一条，raw 20161-20165）；
      //    `sub_411BC0`（等待泵）的对口是下面的 **advance 分支**（`serviceAdvanceWait()`）。
      //    三者不是一件事，所以"逐字帧没跑等待泵"这个框架本身错位。
      // 2) **为什么互斥是等价的**：引擎主循环尾部（raw 21176-21228）是 if/else-if/else 链，
      //    每轮**只**走一臂：`0x20000000`（逐字泵）→ `v35 >= 0` 的 `1`/`0x20`/`0x10000000`/`0x800000`
      //    各臂 → `LABEL_215`（派发 1 条）→ 最后 `else`（`v35 < 0` = bit31 ⇒ `sub_411BC0` + `Sleep(2)`）。
      //    ⇒ **逐字位为 1 时等待泵那一臂根本到不了**（不是"先后"而是"互斥"）。
      // 3) **而且逐字位在整段显现期间一直为 1**：`sub_409400` 只在四种收尾路径上清 `0x20000000`
      //    —— ① 0x300 闸门路径且无按节拍泵的窗（raw 13892）；② 输入出口清（raw 13919/13940，随后
      //    自旋贴完）；③ 贴完当前窗（raw 13964）；④ 上面 serviceTextReveal 补的 `Engine[388212]` 闩锁支。
      //    ⇒ 引擎在"逐字还没显完"的每一轮都走逐字臂，**不派发脚本指令、也不跑等待泵**。
      //    emulator 的这条分支正好只做引擎在那一臂里做的事（输入出口 + 推一个字）⇒ 外观等价。
      // 4) **键命中/悬停/滚轮回看不在这一臂里**：它们在 `sub_411BC0`（raw 20242 键命中 / 20324 悬停 /
      //    20341 滚轮回看）——引擎逐字期间同样**不处理**它们（`sub_409400` 只认左键 / AdvanceMesOnWheel
      //    的滚轮下键 / 滚轮累加器 < 0，见 `serviceRevealAdvanceInput`）⇒ 推迟到显现结束是忠实的，
      //    不是缺陷。
      // 5) **怎么证伪**（三条任一成立则本条结论错）：① 若 raw 21176-21228 不是 if/else-if 链而是
      //    顺序段（逐字臂之后仍会落到 `sub_411BC0`）；② 若 `0x20000000` 在显现未完成时会被清掉
      //    （除上面四条外的第五个清零点）；③ 若 `serviceTextReveal`/`serviceRevealAdvanceInput` 少了
      //    `sub_409400` 里某一支会改状态的东西（现登记的两条已补齐：`Engine[388212]` 闩锁支 +
      //    `set:DrawMode` 的 `skipWaitGate`）。
      // 6) **"显示态每轮一条指令"这一半是覆盖的**：adv 分支（`advFrame: true`）每帧恰好派发一条
      //    （raw 21158-21165）——唯一例外是 `set:CancelMesSkipOnClick == 2` 的整帧早退
      //    （raw 20133-20136，见上面 `advFrameAborted`）。
      // ★引擎 `sub_409400` 的**输入出口**（raw 13931-13946）：逐字还没显完时点击 ⇒ 立刻把整页贴完
      //   （**不推进页面**）。★必须在 `serviceTextReveal` **之前**：引擎在同一函数里先看输入、再贴一个字。
      //   修前这条路径整个缺失 ⇒ 逐字期间的点击既不贴完、也不被消费，等文字自然显完后被等待泵当成"推进"
      //   ⇒ 用户实测「快速多次点击 ⇒ 要等第一句逐字完成才播第二句」（`tickets/T-0033`）。
      e.serviceRevealAdvanceInput();
      e.serviceTextReveal(nowMs);
    } else if (gates.advance !== 'ignore' && e.awaitingAdvance) {
      opt.onGate?.('advance', e);
      obs?.onGate?.({ ...obsMid(), branch: 'advance' });
      if (gates.advance === 'pump') {
        const handled = e.serviceAdvanceWait();
        opt.onAdvanceWait?.(handled, e);
        obs?.onAdvanceWait?.({ ...obsMid(), handled });
      } else e.forceAdvance();
    } else {
      opt.onGate?.('batch', e);
      obs?.onGate?.({ ...obsMid(), branch: 'batch' });
      batch = true;
    }

    if (batch) {
      // 常规：派发一批，遇门/等待/脚本尾即停
      for (let k = 0; k < maxSteps; k++) {
        const f = e.curScript();
        if (!f.script || f.ip >= f.script.instructions.length) {
          stop = 'script-end';
          break;
        }
        if (f.name !== lastScript) {
          lastScript = f.name;
          opt.onScriptChange?.(f.name, e);
          obs?.onScriptChange?.({ ...obsMid(), name: f.name });
        }
        const r = await dispatch();
        if (r !== 'ok') {
          stop = r;
          break;
        }
        // ★`STAGE_GATE` 也在这里收住：`i0d5` 是时间表的回边（脚本体 `ret` 回到它，它再置门）
        //   ⇒ 本帧这一批到此为止，下一帧由上面的 stage 分支继续问时间表（引擎同序）。
        if ((e.waitFlags & (0x400 | SLEEP_GATE | STAGE_GATE)) !== 0 || e.awaitingAdvance) break;
      }
    }

    if (stop !== null) return finish({ frames, steps, stopReason: stop });
    frames++;
    // ★**游玩时长**（引擎存档头 +280 的 i32；`tickets/T-0018`）：按帧增量累加。
    //   单帧增量 > 1 s 的部分不计 —— 调试暂停/长 `sleep` 不是"游玩时间"（引擎那份是累计量，见 `Engine.playSeconds`）。
    if (prevNowMs !== null) {
      const delta = nowMs - prevNowMs;
      if (delta > 0 && delta <= 1000) e.playSeconds += delta / 1000;
    }
    prevNowMs = nowMs;
    // ★音频帧泵（D5）：**每完整帧恰好一次**，且**先于**合成 —— 引擎 raw 20645-20646 就在 present 段里，
    //   产品路径的 `session.#present()`（texturesIdle → audio tick → present）也是这个次序。
    //   撞脚本尾/退出/重置的那一帧**不算完整帧** ⇒ 不发（与 session 的 `break outer` 一致）。
    if (audioPolicy !== 'never') {
      // ★`tickets/T-0180` §10：音频帧泵也是"宿主阶段"（一帧一次，但它内部要老化通道/跑队列）。
      await profiler.stage('audio/tick', () => host.audio?.({ kind: 'tick', nowMs, advActive: e.advActive }));
    }
    if (opt.present !== 'never') {
      // ★★**帧提交门**（引擎主循环 raw 20740-20761；`tickets/T-0167` 的 §4.2 #3/#6/#7）：
      //   门内 ④ 的帧时钟写在这里落地 —— 修前 `engineValues` 的 `clock`/`clockPrev` **只**由
      //   `0x1F4`/`0x20C`/`0x23C` 三条脚本指令维护，主循环那条写没有等价物（默认配置 DrawMode=0
      //   时门不进 ⇒ 与旧行为一致；`DrawMode=1` 的配置下才是可观测差异）。
      //   ★次序：引擎在同一块里"先写时钟（20750-20751）再提交（20758）"，本驱动保持同序。
      const renderGate = frameRenderGate(e, host.renderSuspended?.() ?? false);
      if (renderGate.clockWrite) {
        const prevClock = e.engineValues.get(ENGINE_FIELD.clock) ?? 0;
        e.engineValues.set(ENGINE_FIELD.clockPrev, prevClock);
        e.engineValues.set(ENGINE_FIELD.clock, nowMs);
      }
      opt.onFrameRenderGate?.(renderGate, e);
      // 帧末两件事分开做（B2；设计 D5）：先推进模型到本帧时钟，再让宿主合成
      // ★`{ freeze: e.sceneFreeze }`（`tickets/T-0091` 的 G1）：引擎 `Scene+46512` 在**本帧绘制期**
      //   就把所有窗算结束（raw 117449 / 133517 / 134941）⇒ 冻结必须随"推进模型"一起传进宿主，
      //   否则窗按墙钟跑完（画面差异 + `needsRender` 多亮若干帧）。清冻结在下面（引擎帧末 136842/137183）。
      //   ★`tickets/T-0180` §10：这一句与下面的 `present` 是**实测那 300~650ms 的嫌疑犯**
      //   （指令计时显示 0ms ⇒ 花在宿主阶段）⇒ 各自单独记账。
      await profiler.stage('advanceModel', () => host.advanceModel?.(nowMs, { freeze: e.sceneFreeze }));
      // ★**池挂起位**（`Scene+46516`，`tickets/T-0024`）：引擎每遍绘制开头清零（raw 130427-130428）、
      //   绘制期"还有元素在动"时置位（raw 117843-117844 / 133528 / 134944）⇒ 帧**开头**的门读到的是
      //   **上一遍绘制**的结果。宿主交出的是"本遍是否还有窗在跑"（`scPoolPending`），
      //   强制冻结（46512）让所有窗立刻算结束（raw 134941）⇒ 折进这里的锁存，随后按"每遍清零"复位。
      e.scenePending = !e.sceneFreeze && (host.poolPending?.() ?? false);
      e.sceneFreeze = false;
      // `'needsRender'`：引擎式"没变就不重画"。★`advanceModel` **不跳过**（窗末收尾在它里面），
      //   跳过的只是"画"这一步（`tickets/T-0003`）。
      const wantPresent = opt.present === 'needsRender' ? (host.needsRender?.() ?? true) : true;
      // ★`await`：Electron 的合成前屏障（等本帧新绑定的纹理 IPC 到位）必须在 `present` 之前完成。
      if (wantPresent) await profiler.stage('present', () => host.present?.());
    }
    // ★逐帧对外表现（`tickets/T-0003` 验收 4）：模型已推进之后取一份冻结的 digest。
    //   只有"观察者明确要 digest"（`wantsDigest`）且宿主交得出场景模型时才构建 —— 构建一次要跑
    //   一次全场景求值（`scSnapshot`），产品路径没挂记录器时不该付这个代价（`T-0005` 的 `--record`）。
    const digestState = obs?.wantsDigest === true ? host.digestState?.() : undefined;
    if (obs?.onPresent && digestState) {
      const digest = buildFrameDigest({
        e,
        scene: digestState,
        frame: frames - 1,
        nowMs,
        host: host.digestHostCounters?.(),
      });
      obs.onPresent({ ...obsEnd(nowMs), digest });
    }
    opt.onFrameEnd?.(nowMs, frames - 1, e);
    obs?.onFrameEnd?.(obsEnd(nowMs));
    // ★帧看门狗收尾：**必须在 `yield()` 之前** —— 之后那段是"等下一帧"，不是"占住主线程"，
    //   两者混在一起就分不出"我们算得慢"与"宿主不给帧"（`profile.ts` 的 `endFrame`）。
    profiler.endFrame(frames - 1, steps);
    await host.yield?.();
  }
}
