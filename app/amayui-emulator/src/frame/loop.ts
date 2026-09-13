/**
 * **共享帧驱动**（唯一一份）—— emulator 的"帧"应该在这里被定义，而不是在每个入口各写一遍。
 *
 * ## 它到底管什么
 * 引擎主循环每帧的顺序（`docs-new/03-engine/engine-reset-mainloop.md`、raw 20887-20895、`sub_411900`）：
 * ```
 * ① 取时钟（wall / 虚拟）            → host.now() → e.nowMs
 * ② 每窗「逐行贴出」闸门  0x300       → serviceWinReveal()
 * ③ 字格图标动画          0x73        → serviceCharGrid()
 * ④ 门：0x400 动画等待 / sleep        → 等条件成立才清位（或按 policy 清/忽略）
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
 * | `0x400` 门 | `'wait'`（等动画） | `'ignore'`（无分支） | `'clear'`（无条件清） | `'ignore'` |
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
import { NotImplementedOp, stepOnce, type StepTrace } from '../vm/interpreter.js';
import { ExitScript, ScriptReset } from '../vm/ops.js';
import type { BinInstruction } from '../script/bin.js';
import type { FrameHost } from './host.js';

/** 门的处理方式。**三种都要保留**（B1 不改行为，B2 才收敛）。 */
export interface FrameLoopGates {
  /**
   * `0x400` 动画等待门（`0x21C wait` 置位；引擎由图形池计时器放行）：
   *  - `'wait'`（产品）：宿主报 `animationsDone()` 才清位；
   *  - `'clear'`：每帧无条件清（两份 chain 的现状 —— 等于"动画瞬间完成"）；
   *  - `'ignore'`：完全不看这一位（`report.ts`/`run.ts` 的现状）。
   */
  anim?: 'wait' | 'clear' | 'ignore';
  /** `sleep(0xC8)` / `0x6E` 后的节流门：`'wait'` 等 `nowMs >= sleepUntil`；`'clear'` 直接清；`'ignore'` 不看。 */
  sleep?: 'wait' | 'clear' | 'ignore';
  /**
   * 等待推进门（`0x72 wait-for-input` 的 bit31）：
   *  - `'pump'`（产品）：`serviceAdvanceWait()`（键命中/点击/悬停三条出口都在引擎内部）；
   *  - `'force'`：`forceAdvance()`（headless 现状；**与真泵刻意不同**，见 `Engine.forceAdvance`）；
   *  - `'ignore'`：不看这一位，直接往下走。
   */
  advance?: 'pump' | 'force' | 'ignore';
}

/** 本帧走了哪条分支（引擎主循环的不同段；观察者与调用方记账用）。 */
export type FrameBranch = 'anim' | 'sleep' | 'text-reveal' | 'advance' | 'adv' | 'batch';

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
  /** 每条指令**之前**（`instr` 可能是 `undefined` = ip 越界）。 */
  onStepStart?(frame: Frame, instr: BinInstruction | undefined, e: Engine): void;
  /** 每条指令**之后**（成功执行完）。 */
  onStep?(t: StepTrace, e: Engine): void;
  /** 未实现指令的策略；默认 `'throw'`。 */
  onUnknown?(err: NotImplementedOp, frame: Frame, instr: BinInstruction | undefined): 'continue' | 'stop' | 'throw';
  /** 其它异常的策略（`ExitScript`/`ScriptReset` 不经过这里，它们由驱动直接停）。默认 `'throw'`。 */
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
}

/** 驱动为什么停下来（调用方据此还原各自的返回语义）。 */
export type StopReason = 'until' | 'step-stop' | 'cap' | 'script-end' | 'exit' | 'reset' | 'unknown' | 'error';

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
  };
  const services = { winReveal: opt.services?.winReveal ?? true, charGrid: opt.services?.charGrid ?? true };
  const maxSteps = opt.maxStepsPerFrame ?? Number.POSITIVE_INFINITY;
  const cap = opt.maxFrames ?? Number.POSITIVE_INFINITY;
  const audioPolicy = opt.audio ?? 'host';

  let frames = 0;
  let steps = 0;
  let lastScript = opt.initialScript ?? e.curScript().name;

  /** 派发一条指令的结果（`'ok'` 之外都表示"整轮结束"，由调用方还原语义）。 */
  type DispatchResult = 'ok' | 'exit' | 'reset' | 'unknown' | 'error' | 'step-stop';

  /** 派发一条指令。 */
  const dispatch = async (): Promise<DispatchResult> => {
    const frame = e.curScript();
    const instr = frame.script?.instructions[frame.ip];
    opt.onStepStart?.(frame, instr, e);
    let t: StepTrace;
    try {
      t = await stepOnce(e);
    } catch (err) {
      if (err instanceof ExitScript) return 'exit';
      if (err instanceof ScriptReset) return 'reset';
      if (err instanceof NotImplementedOp) {
        const what = opt.onUnknown?.(err, frame, instr) ?? 'throw';
        if (what === 'throw') throw err;
        return what === 'stop' ? 'unknown' : 'ok';
      }
      const what = opt.onError?.(err) ?? 'throw';
      if (what === 'throw') throw err;
      return what === 'stop' ? 'error' : 'ok';
    }
    steps++;
    opt.onStep?.(t, e);
    if (opt.stopAfterStep?.(t, e) === true) return 'step-stop';
    return 'ok';
  };

  for (;;) {
    if (frames >= cap) return { frames, steps, stopReason: 'cap' };
    if (opt.until?.()) return { frames, steps, stopReason: 'until' };

    const nowMs = host.now();
    e.nowMs = nowMs;
    opt.onFrameStart?.(nowMs, frames, e);

    if (services.winReveal) e.serviceWinReveal(nowMs);
    if (services.charGrid) e.serviceCharGrid(nowMs);

    let stop: StopReason | null = null;
    if (gates.anim !== 'ignore' && (e.waitFlags & 0x400) !== 0) {
      opt.onGate?.('anim', e);
      if (gates.anim === 'clear' || host.animationsDone?.(nowMs) === true) e.waitFlags &= ~0x400;
    } else if (gates.sleep !== 'ignore' && (e.waitFlags & SLEEP_GATE) !== 0) {
      opt.onGate?.('sleep', e);
      if (gates.sleep === 'clear' || nowMs >= e.sleepUntil) e.waitFlags &= ~SLEEP_GATE;
    } else if (e.textRevealing) {
      opt.onGate?.('text-reveal', e);
      e.serviceTextReveal(nowMs);
    } else if (gates.advance !== 'ignore' && e.awaitingAdvance) {
      opt.onGate?.('advance', e);
      if (gates.advance === 'pump') e.serviceAdvanceWait();
      else e.forceAdvance();
    } else if (opt.advFrame === true && e.advActive) {
      opt.onGate?.('adv', e);
      e.serviceAdv();
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
    } else {
      opt.onGate?.('batch', e);
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
        }
        const r = await dispatch();
        if (r !== 'ok') {
          stop = r;
          break;
        }
        if ((e.waitFlags & (0x400 | SLEEP_GATE)) !== 0 || e.awaitingAdvance) break;
      }
    }

    if (stop !== null) return { frames, steps, stopReason: stop };
    frames++;
    // ★音频帧泵（D5）：**每完整帧恰好一次**，且**先于**合成 —— 引擎 raw 20645-20646 就在 present 段里，
    //   产品路径的 `session.#present()`（texturesIdle → audio tick → present）也是这个次序。
    //   撞脚本尾/退出/重置的那一帧**不算完整帧** ⇒ 不发（与 session 的 `break outer` 一致）。
    if (audioPolicy !== 'never') host.audio?.({ kind: 'tick', nowMs, advActive: e.advActive });
    if (opt.present !== 'never') {
      // 帧末两件事分开做（B2；设计 D5）：先推进模型到本帧时钟，再让宿主合成
      host.advanceModel?.(nowMs);
      // `'needsRender'`：引擎式"没变就不重画"。★`advanceModel` **不跳过**（窗末收尾在它里面），
      //   跳过的只是"画"这一步（`tickets/T-0003`）。
      const wantPresent = opt.present === 'needsRender' ? (host.needsRender?.() ?? true) : true;
      if (wantPresent) host.present?.();
    }
    opt.onFrameEnd?.(nowMs, frames - 1, e);
    await host.yield?.();
  }
}
