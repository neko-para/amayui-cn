/**
 * **VM 会话（B4：装配 + 观察者 + 让帧）** —— 产品路径的帧驱动**不再在这里**。
 *
 * 修前本类就是"第 5 份帧循环"（`tickets/T-0001` 的盘点）：它自己写了一遍门控状态机
 * （`0x400` / sleep / 逐字显现 / 等待推进 / ADV / 批派发），与 headless 的四处实现**各不相同** ——
 * 于是"Electron 与 headless 是否在做同一件事"无法机械判定（用户 2026-09 定的最优先需求）。
 *
 * 现在（`tickets/T-0004` 的 B4）本类只剩三件事：
 *  1. **装配**：把 `PixiBackend` 接成 `FrameHost`（时钟/让帧/屏障/合成/门判据/音频泵/digest 输入）；
 *  2. **观察者**：把控制窗指令、trace、遥测、jsonl、状态上报接成 `FrameObserver`；
 *  3. **让帧**：`FrameHost.yield` 就是 `requestAnimationFrame`（`nextFrame`）。
 *
 * ★**"暂停在未知指令"不是驱动语义**（设计文档 §7）：驱动在 `stopReason='unknown'` 停下，
 * 本类接着跑"互动面"（每帧 `present` + 让帧，等控制窗点「作为桩函数跳过」），登记桩后**重新进入驱动**
 * ——`stepOnce` 抛 `NotImplementedOp` 时未消费操作数、未推进 ip，所以从同一条指令重试即可
 * （与修前的"暂停态分支"等价）。
 *
 * ★**每一处差异都必须是驱动配置或宿主编排**，不许在这里重新长出帧序（那正是本票要消灭的东西）。
 */
import { SLEEP_GATE, type DebugEventKind, type Engine, type Frame } from '../../vm/engine.js';
import { NotImplementedOp, type StepTrace } from '../../vm/interpreter.js';
import { runQuery } from '../../vm/debugQuery.js';
import {
  DEBUG_COMMAND_HELP,
  parseDebugCommand,
  type DebugAction,
} from '../../vm/debugCommand.js';
import {
  compileBreak,
  matchEvent,
  matchInstruction,
  type BreakHit,
  type BreakSpec,
} from '../../vm/debugBreak.js';
import type { NativeBridge } from '../../vm/native.js';
import type { DropRecorder } from '../../vm/nativeTap.js';
import type { ControlStatus } from '../ipcFileSource.js';
import type { RenderStatus } from '../renderStatus.js';
import type { PixiBackend } from '../pixiBackend.js';
import { runFrameLoop, type FrameLoopGates, type FrameLoopOptions } from '../../frame/loop.js';
import { capturePng, type FrameHost } from '../../frame/host.js';
// ★`tickets/T-0135`：输入注入走共享层的声明式执行器（宿主无关）——`applyScenarioEvent`。
import { applyScenarioEvent, type ScenarioEvent } from '../../frame/scenario.js';
import type { FrameObservation, FrameObserver } from '../../frame/observer.js';
import type { BinInstruction } from '../../script/bin.js';
import { JsonlWriter } from './jsonlWriter.js';
import { Telemetry } from './telemetry.js';
import type { TraceLog } from './traceLog.js';
import type { BootedApp } from './boot.js';
import { observeTextureBarrier, shouldAwaitTextureBarrier } from './textureBarrier.js';
import {
  captureEngineSnapshot,
  restoreEngineSnapshot,
  snapshotFromJson,
  snapshotToJson,
} from '../../vm/engineSnapshot.js';

/**
 * 一帧内最多推进的指令数 —— **仅作病态死循环兜底**，不是引擎语义。
 *
 * 引擎没有"每帧 N 条"的概念：它的每帧要么派发**恰好 1 条**（普通路径 / ADV 分支），要么
 * 完全不派发（等待门，见 `Engine.awaitingAdvance`）。正常脚本每条消息/每个帧边界都会踩到门
 * （`0x1F4`/`0x20C`/`0x23C`、`sleep`、`wait-for-input`），所以这个上限通常远吃不满；
 * 一旦吃满，说明存在**没有门的轮询循环**，此时应当查门而不是靠这个数字兜。
 */
const SAFETY_PER_FRAME = 10000;
/** 交互运行上限：进入 TITLE 后不再按步数截止，靠"脚本退出/重置/错误/关窗"收尾；此处仅作病态死循环兜底。 */
const MAX_STEPS = 100_000_000;

/**
 * **产品的帧策略**（门档 + 批上限）—— `#loopOptions` 与 `--record` 的轨迹头**共用这一份**。
 * ★为什么导出：回放的判据是"同一份帧纪律"，而批上限决定帧边界（批跑满就换帧）⇒ 两边各写一遍极可能漂移
 * （`T-0002` 的教训：批上限是宿主策略、不是引擎语义，但它**影响**可比性）。录制时把它写进轨迹头，
 * 回放侧照用（见 `frame/trace.ts` 的 `TraceHeader.policy`）。
 */
export const PRODUCT_FRAME_POLICY: { maxStepsPerFrame: number; gates: FrameLoopGates } = {
  maxStepsPerFrame: SAFETY_PER_FRAME,
  gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * **控制窗 ⚠️ 横幅的文本**（纯函数，便于守卫；`tickets/T-0056`）。
 *
 * 优先级：本次上报的显式文本 > 「停在未知指令」的暂停提示 > **粘住的错误文本**。
 *
 * ★为什么要有"粘住"这一档：`notifyStatus()` 不带 override 时会上报 `undefined`，而错误之后
 * 至少还有一次不带 override 的上报（`run()` 收尾）⇒ 横幅会被立刻擦掉，用户只能去翻日志。
 * 状态上报是**幂等的快照**（每次都发全量字段），所以这里必须由调用方把"当前仍然成立的错误"传进来。
 */
export function controlErrorText(
  override: string | undefined,
  sticky: string | undefined,
  paused: { opcode: number; name: string; script: string } | null | undefined,
): string | undefined {
  if (override) return override;
  if (paused) return `停在未知指令 0x${paused.opcode.toString(16)} (${paused.name}) @ ${paused.script}`;
  return sticky;
}

export class RendererSession {
  readonly #status: RenderStatus;
  readonly #traceLog: TraceLog;
  /**
   * ★类型是**桥接口**（`tickets/T-0013`），不是 `PixiBackend`：
   * 会话只允许用"桥声明过的能力"（`log`/`present`/`needsRender`/`poolPending`/`texturesIdle`/`audio`），
   * "会话偷偷用了某个宿主私有方法"会**编译期**暴露。
   */
  readonly #native: NativeBridge;
  /** 帧宿主的**具体**后端（`advanceModel`/`digestState` 等 `FrameHost` 侧能力在这里）。 */
  readonly #pixi: PixiBackend;
  readonly #drops: DropRecorder;
  readonly #e: Engine;
  /** 额外观察者（`--record` 等工具挂上来的记录器；见 `attachObserver`）。 */

  readonly #telemetry = new Telemetry();
  readonly #jsonl = new JsonlWriter();
  /** 额外观察者（`--record` 等工具**运行中**挂上来的记录器；见 `attachObserver`）。 */
  #extra: FrameObserver | undefined;

  /** 指令日志开关（控制窗可切）：false = 只记「已忽略/未知」指令；true = 记全量指令。 */
  #traceAll = false;
  /** ★定向 trace 白名单（空 = 不记 JSONL）。 */
  #traceFilter = new Set<number>();
  /**
   * **纹理帧屏障②的观测账**（`tickets/T-0175` 的 ⑦，出处 `tickets/T-0166` §4-③）。
   *
   * 修前这一面完全不可观测：`DebugQuery` 问不到、trace 里没有逐次证据，唯一的守卫
   * （`test/no-boot-preload.test.ts`）只是在 `pixiBackend.ts` 的**源文本**里找 `texturesIdle`
   * 与 `present(` 的先后 —— 证明不了"派发一次 `0x1F9` ⇒ 屏障被 await 一次"。
   * 现在每次过门都在这里记账，并经 `runQuery` 的 `barrier` 命令与 trace 行对外可见
   * （判据与文案的唯一来源 = `app/textureBarrier.ts`）。
   */
  #texBarrier = { calls: 0, awaits: 0 };
  /** 已经记过 trace 的"没有宿主缝可等"（去重；宿主不实现 `texturesIdle` 时是正常态，不该刷屏）。 */
  #texBarrierNoSeamLogged = false;

  /**
   * 暂停点：解释器停在一条「未实现 opcode」上等用户在控制窗点「作为桩函数跳过」。
   * 注意 stepOnce 抛 NotImplementedOp 时**尚未消费任何操作数、也未推进 ip**，因此登记桩函数后
   * 直接对同一条指令重试即可继续（无需回滚 VM 状态）。
   */
  #pausedOp: ControlStatus['pendingUnknown'] | null = null;

  // -------------------------------------------------------------------------
  // 调试断点（`tickets/T-0114` 第 2 步）
  // -------------------------------------------------------------------------

  /** 断点表（由控制面板下发；`control-break-set` / `-clear` 维护）。 */
  #breaks: BreakSpec[] = [];
  /** 下一个断点 id（面板只负责显示它）。 */
  #breakSeq = 1;
  /**
   * **断点暂停闸门**：命中时挂起的 Promise + 它的 resolve。
   *
   * ★为什么是 Promise 而不是轮询/同步等待：见 `FrameLoopOptions.onBeforeStep` 的说明 ——
   * 同步阻塞会把渲染进程处理"继续"的那条 IPC 也冻住。
   */
  #breakResume: (() => void) | null = null;
  /** 当前暂停的断点命中信息（未暂停 = null）。面板据此显示"为什么停的"。 */
  #breakHit: BreakHit | null = null;
  /** 命中后"同一条指令"的防重入：继续时要能真的走过去，而不是立刻又命中。 */
  #breakSkipOnce: string | null = null;
  /**
   * **最近一次语义事件**（VM 在 `stepOnce` 内同步写入；主循环随后 `await` 落地暂停）。
   *
   * 为什么用"记录 + 稍后 await"而不是在 VM 里直接暂停：`stepOnce` 是同步的（见 `Engine.debugEvent`）。
   */
  #pendingEventHit: BreakHit | null = null;

  /** 累计指令数 / 帧数（**跨多次进入驱动**累加：`#stepBase`/`#frameBase` + 驱动本轮的计数）。 */
  #steps = 0;
  #frames = 0;
  #stepBase = 0;
  #frameBase = 0;
  /**
   * **等一帧边界**的等待者（`tickets/T-0122`）—— 引擎态快照/恢复**只在帧边界**做。
   *
   * 为什么需要这道门：调试命令到达时落在**指令**边界（`stepOnce` 是原子的、handler 内无 await 点），
   * 而不在**帧**边界 ⇒ 那一瞬可能正处在"本帧画了一半 / 池在 memflip 双缓冲交换中 / 纹理屏障在途"的中间态。
   * 引擎自己的存档/重放也只在帧边界发生（`0x1F5` 计到 0 那一刻）。⇒ 本类把快照/恢复**推迟到下一个
   * `#onFrameEnd`**，并在超时（帧循环没在跑）时**响亮失败**而不是静默地就地做。
   */
  #boundaryWaiters: (() => void)[] = [];
  #lastStepLog = 0; // 节流：traceAll 全量打印时 step trace 的最小间隔(ms)
  #waiting = false;
  #sleeping = false;
  #err: unknown = null;
  /**
   * **粘住的错误文本**（`tickets/T-0056`）—— 控制窗那条 ⚠️ 横幅的内容。
   *
   * 为什么必须粘住：`notifyStatus()` 不带 override 时会上报 `error: undefined`，而**错误之后**
   * 至少还有一次不带 override 的上报（`run()` 收尾的"最终态"），于是横幅会被**立刻擦掉** ——
   * 实测症状：「一执行加载就命中 `Depth が不正です`，但控制面版上什么都没有，我是看日志才发现的」。
   * ⇒ 硬错误一旦发生就记在这里，直到有更明确的文本（override / 暂停态）或显式清除（跳过未知指令、
   * 重启会话）为止。
   */
  #errorText: string | undefined;
  #lastInputLog = 0; // 节流：[input-state] 诊断打印
  #lastStatusSend = 0; // 节流：向控制窗上报状态的间隔(ms)

  /** 上一帧末的"逐字显现中"/"ADV 激活"（用于在**状态结束**的那一帧补一条日志，与修前同源）。 */
  #wasRevealing = false;
  #wasAdv = false;
  /** 上一次已记录的派发（`e.lastDispatch` 是"最近一次"，见 `#sampleDispatch`）。 */
  #lastDispatch: { label: number; kind: string } | null = null;

  /** ★遥测：当前卡在哪个门 + 它从何时开始 + present 次数 + 步进速率。 */
  #gate = '';
  #gateSince = performance.now();
  #perfSteps = 0;
  #perfMs = performance.now();
  #stepsPerSec = 0;

  constructor(app: BootedApp, extra?: FrameObserver) {
    this.#status = app.status;
    this.#traceLog = app.traceLog;
    this.#native = app.native;
    this.#pixi = app.pixi;
    this.#drops = app.drops;
    this.#e = app.e;
    this.#extra = extra;
  }

  /**
   * **运行中挂上额外观察者**（`tickets/T-0005` 的 `--record`）：主进程在"界面就绪"后才发录制指令，
   * 而会话早已在跑 ⇒ 观察者必须能**后挂**。实现要点：本类交出去的观察者对象里的 `wantsDigest` 是
   * **getter**（驱动每帧重读），所以挂上后从下一帧起就有 digest，不需要重建驱动配置。
   */
  attachObserver(obs: FrameObserver): void {
    this.#extra = obs;
  }

  #setGate(g: string): void {
    if (g !== this.#gate) {
      this.#gate = g;
      this.#gateSince = performance.now();
    }
  }

  /**
   * 统一上报状态给控制窗（节流轮询与「遇到错误立即上报」都走这里，
   * 保证 `pendingUnknown` 与 `error` 同源、字段集不随路径而变）。
   */
  notifyStatus(errorOverride?: string): void {
    const paused = this.#pausedOp;
    window.api?.sendRendererStatus?.({
      bin: this.#status.scriptName,
      ignored: this.#telemetry.ignoredList(),
      skipped: this.#telemetry.skippedList(),
      gaps: this.#telemetry.gapsList(),
      dropped: this.#drops.list(),
      traceAll: this.#traceAll,
      traceFilter: [...this.#traceFilter].map((o) => `0x${o.toString(16)}`),
      perf: {
        stepsPerSec: Math.round(this.#stepsPerSec),
        gate: this.#gate,
        gateMs: this.#gate ? Math.round(performance.now() - this.#gateSince) : 0,
        jsonlLines: this.#jsonl.lines,
        frames: this.#frames,
      },
      error: controlErrorText(errorOverride, this.#errorText, paused),
      pendingUnknown: paused ?? undefined,
    });
  }

  /** 注册控制窗驱动的开关与指令。 */
  registerControlHandlers(): void {
    // 「启用指令日志」开关 → 设 traceAll（true=打印全量指令，false=只打印「已忽略」指令）。
    window.api?.onTraceAll?.((enabled) => {
      this.#traceAll = enabled;
    });
    window.api?.onTraceFilter?.((ops) => {
      this.#traceFilter = new Set(ops);
      this.#traceLog.line(
        `[trace] 定向 trace 白名单=${ops.length ? ops.map((o) => '0x' + o.toString(16)).join(',') : '（空=全部）'}`,
      );
    });
    // 点了「作为桩函数跳过」→ 把该 opcode 登记为用户桩（no-op）并从暂停点继续跑。
    window.api?.onControlSkipOp?.((opcode) => this.#skipOpcode(opcode));
    // 调试查询（`tickets/T-0114` 第 1 步）：**只读**地回答"某个量现在是多少"。
    //   ★为什么在这里答：引擎状态在渲染窗；控制窗只能问（见 `electron/ipc/control.ts` 的中转）。
    //   ★`runQuery` 是纯函数（不改状态、不 eval）⇒ 能上 E2 守卫，见 `test/debug-query.test.ts`。
    // 语义事件（`tickets/T-0114` 第 2 步）：VM 在写全局/绑槽时**同步**回调（只记录，不暂停）。
    this.#e.debugEvent = (ev) => this.#onDebugEvent(ev);
    // 断点（`tickets/T-0114` 第 2 步）：面板下发断点表 + 「继续」。
    window.api?.onBreakCommand?.((cmd) => {
      if (cmd.kind === 'set') {
        const r = this.#addBreak(cmd.breakKind, cmd.where, cmd.condition ?? '');
        if (r.error) this.#traceLog.line(`[break] ✗ ${r.error}`);
        this.#reportBreakList(r.error ? { error: r.error } : {});
      } else if (cmd.kind === 'clear') {
        this.#breaks = cmd.id === undefined ? [] : this.#breaks.filter((b) => b.id !== cmd.id);
        this.#traceLog.line(`[break] 清空${cmd.id === undefined ? '全部' : ` #${cmd.id}`}（剩 ${this.#breaks.length} 条）`);
        this.#reportBreakList({});
      } else if (cmd.kind === 'list') {
        this.#reportBreakList({});
      } else if (cmd.kind === 'continue') {
        this.#resumeFromBreak();
      }
    });
    window.api?.onDebugQuery?.(async ({ id, text }) => {
      let result: unknown;
      const raw = String(text ?? '');
      try {
        // ★`tickets/T-0127`：这条通道现在是**唯一的"命令行收口点"** —— 调试守护进程（CLI）不再自己
        //   分类命令，它把整行原样发过来，由这里的 `parseDebugCommand`（零依赖纯词汇表，与面板同一份）
        //   解析后派发。于是"命令表"从 3 份拷贝收敛成 1 份，CLI 也能拿到 `?` 的**同一份**帮助文本。
        const act = parseDebugCommand(raw);
        if (act && act.a === 'capture') {
          // ★`tickets/T-0134`：抓一帧走**帧宿主缝**（`FrameHost.capture` = 页面内 extract 读回），
          //   不是 Electron 的 capturePage（两者是不同管线，见 `T-0133` §B.4.4 的 B′ vs 形态 C）。
          //   人类看的帧流与 agent 的取证因此是同一条路径。
          //   ★命令名是 `capture` 而不是 `shot`：后者被 `tools/debugsrv.cjs` 在主进程截获。
          const png = await capturePng(this.#frameHost());
          result = png
            ? {
                query: raw,
                ok: true,
                lines: [`capture: ${png.length}B PNG（base64 在 png 字段）`],
                png: bytesToBase64(png),
              }
            : { query: raw, ok: false, lines: ['capture：当前宿主没有 capture 能力（headless 没有像素）'] };
        } else if (act && (act.a === 'snapshot' || act.a === 'restore')) {
          // ★`tickets/T-0122`：**只在帧边界做**。命令到达时落在指令边界（不是帧边界）⇒ 先等一帧末，
          //   再走同步的 `#applyDebugAction`（这样"取/灌"两个动作都在确定的帧边界上发生）。
          //   超时 ⇒ `ok:false` + 原因（不静默地就地做：那会读到"画了一半"的中间态）。
          try {
            await this.#atFrameBoundary();
            result = { query: raw, ok: true, lines: this.#applyDebugAction(act) };
          } catch (err) {
            result = { query: raw, ok: false, lines: [`✗ ${(err as Error).message}`] };
          }
        } else if (act && act.a !== 'query') {
          result = { query: raw, ok: true, lines: this.#applyDebugAction(act) };
        } else {
          result = runQuery(this.#e, act && act.a === 'query' ? act.text : raw, {
            // ★`tickets/T-0127`：把**宿主侧**可观测面注入查询（VM 看不到"纹理是否真的就位"与 Live2D 运行态）。
            slot: (slot) => {
              const px = this.#pixi.getSlotPixels(slot);
              return px ? `已就位 ${px.w}×${px.h}` : null;
            },
            l2d: (slot) => {
              // ★ 挂在宿主（`l2dHost`）上，不在 SceneState 自己身上
              const inst = this.#pixi.digestState().l2dHost?.l2dSlots.get(slot);
              if (!inst) return null;
              return `模型 id=${inst.modelId}、纹理 ${inst.textures.size} 组、动作 ${inst.current?.motion.name ?? '（无）'}`;
            },
            // ★`tickets/T-0175` 的 ⑦（出处 `tickets/T-0166` §4-③）：**纹理帧屏障②**的运行账。
            //   两个数必须分开报：`calls`/`awaits` = 会话侧过了门并真的 await 了几次，
            //   `hostWaits` = 宿主**确实等到图**的次数（`PixiBackend.texturesIdle` 里
            //   `pendingCount > 0` 才 +1，经已登记的 `digestHostCounters` 读出来 ——
            //   **不新开宿主方法**：`PixiBackend` 的公开面每加一个都要登记进 native-tap 的非桥清单）。
            //   ⇒ "0x1F9 派发了但那一帧没有图在途"与"宿主没实现该缝"都能一眼区分。
            barrier: () =>
              `屏障② calls=${this.#texBarrier.calls} awaits=${this.#texBarrier.awaits} ` +
              `hostWaits=${this.#pixi.digestHostCounters().barriers} 宿主缝=${this.#native.texturesIdle ? '有' : '**无**（0x1F9 后不 await，与原行为一致）'}`,
          });
        }
      } catch (err) {
        result = { query: raw, ok: false, lines: [`查询/命令抛错：${(err as Error).message}`] };
      }
      window.api?.sendDebugQueryResult?.({ id: Number(id), result });
    });
  }

  #skipOpcode(opcode: number): void {
    const paused = this.#pausedOp;
    if (!paused || paused.opcode !== opcode) {
      this.#traceLog.line(`[skip] 忽略无效请求 opcode=0x${opcode.toString(16)}（当前未停在未知指令）`);
      return;
    }
    // 登记用户桩：stepOnce 会在静态表都查不到时兜底用它（kind=user-stub），ip 正常 +1 → 从同一条指令恢复。
    this.#e.unknownOpStubs.set(opcode, 1);
    this.#telemetry.registerStub(opcode, paused.name);
    this.#traceLog.line(
      `=== skip-as-stub 0x${opcode.toString(16)} (${paused.name}) in ${paused.script} @ ip=${paused.instrIndex} -> resume ===`,
    );
    this.#native.log(`[skip] 0x${opcode.toString(16)} (${paused.name}) 已作为桩函数跳过，继续执行`);
    // ★清暂停点 ⇒ `#waitForResume` 的等待循环结束 ⇒ 外层重新进入驱动（同一条指令重试）。
    this.#pausedOp = null;
    this.#err = null;
    this.#errorText = undefined; // 暂停已解除 ⇒ 粘住的文本也作废（避免横幅留着一句过期的话）
    this.#status.ip = this.#e.curScript().ip;
    this.notifyStatus();
    this.#traceLog.flush();
  }

  // -------------------------------------------------------------------------
  // 装配：宿主能力 → FrameHost（**唯一允许分叉处**，且只允许是宿主能力）
  // -------------------------------------------------------------------------

  #frameHost(): FrameHost {
    const e = this.#e;
    return {
      /**
       * 时钟：产品用**真实墙钟**（`performance.now()`，引擎 `timeGetTime()` 的等价物）。
       * ★单一时间域（`tickets/T-0008` 的 D1）：驱动每帧把它写进 `e.nowMs`，宿主不再自己算一份。
       */
      now: () => performance.now(),
      /** 让出一帧（设计文档 §2 的 L4：Electron 的 yield = `requestAnimationFrame`）。 */
      yield: () => nextFrame(),
      /**
       * 模型推进：只把本帧时钟注入宿主（窗的求值发生在 `present` 里）。
       * ★`opts` 必须转发（`tickets/T-0091` 的 G1）：驱动每帧末传 `{ freeze: e.sceneFreeze }`
       *   （引擎 `Scene+46512`），漏掉这一跳冻结就永远到不了窗模型。
       */
      advanceModel: (nowMs, opts) => this.#pixi.advanceModel(nowMs, opts),
      /**
       * 合成一帧。★设计 D5 的三拆：**音频 tick 归驱动**（`FrameLoopOptions.audio`）、
       * 屏障是宿主义务（这里 await）、`present` 只渲染。
       */
      present: async () => {
        if (this.#native.texturesIdle) await this.#native.texturesIdle();
        this.#native.present?.(e.nowMs, e.waitFlags);
      },
      /** 该不该合成（判据在共享层 `sceneNeedsRender`；见 `Tickets/T-0003` 的 B3）。 */
      needsRender: () => this.#native.needsRender?.() ?? true,
      /** `0x400` 门的"挂起"半边：本遍推进后池是否还挂着（`Scene+46516`；`tickets/T-0024`）。 */
      poolPending: () => this.#native.poolPending?.() ?? false,
      /** 音频帧泵（引擎 raw 20645-20646）：驱动每完整帧调一次，参数带本帧 `advActive`。 */
      audio: (intent) => this.#native.audio?.(intent),
      /**
       * **抓一帧当前画面**（`FrameHost.capture`；`tickets/T-0134` 决定 ②）。
       *
       * 接的是 `PixiBackend.captureFrame()`（内部复用既有的私有 `#captureStageCanvas()`）——
       * 于是 `shot` 命令与"人类看的帧流"是**同一条路径**，且三者（Electron 可见窗 / offscreen /
       * 浏览器宿主）共用这一处接线。headless 宿主不实现它（没有像素是它的定义）。
       */
      capture: () => this.#pixi.captureFrame(),
      /** `FrameDigest` 的输入（engine 段由 `frame/digest.ts` 的纯函数组装 ⇒ 两宿主同一份判据）。 */
      digestState: () => this.#pixi.digestState(),
      digestHostCounters: () => this.#pixi.digestHostCounters(),
    };
  }

  /** 驱动配置：**产品的帧**就是这一份（与 headless 的差异只允许出现在宿主能力上）。 */
  #loopOptions(observer: FrameObserver): FrameLoopOptions {
    return {
      // 门：产品档 —— `0x400` 按引擎语义放行（池挂起位 + `0x238` 等待计时器）、sleep 等时钟、
      //      等待推进走**真泵**（含命中测试/悬停两段式）。
      gates: PRODUCT_FRAME_POLICY.gates,
      advFrame: true,
      advErrors: 'stop',
      maxStepsPerFrame: PRODUCT_FRAME_POLICY.maxStepsPerFrame,
      // ★断点闸门（`tickets/T-0114`）：条件断点在**执行之前**查（见 `#beforeStep`）；
      //   语义事件在**执行之后**落地（事件发生在 stepOnce 内部，见 `#afterStepEvent`）。
      onBeforeStep: (frame, instr) => this.#beforeStep(frame, instr),
      onAfterStepEvent: () => this.#afterStepEvent(),
      // 引擎式合成：脏/窗未跑完才画（判据在共享层），模型推进与音频 tick 不跳过。
      present: 'needsRender',
      audio: 'host',
      observer,
    };
  }

  /**
   * **语义事件钩子**（VM 同步调用）：只负责"记下来"，暂停由 `#afterStepEvent` 落地。
   *
   * ★条件在**这里**求值（用事件参数 `idx`/`val`/`slot`/`imgid`），而不是在 `#afterStepEvent` ——
   * 因为事件值只在这一刻可见。
   */
  #onDebugEvent(ev: { kind: DebugEventKind; values: Record<string, number> }): void {
    if (this.#breaks.length === 0) return;
    const describe =
      ev.kind === 'slot-bind'
        ? `绑定纹理槽 slot=0x${(ev.values.slot ?? 0).toString(16)} imgid=0x${(ev.values.imgid ?? 0).toString(16)}`
        : `写全局 ${ev.kind} idx=0x${(ev.values.idx ?? 0).toString(16)} val=${ev.values.val ?? 0}`;
    const hit = matchEvent(this.#breaks, ev.kind, this.#e, ev.values, describe);
    if (hit && !this.#pendingEventHit) this.#pendingEventHit = hit;
  }

  /** 主循环在 `stepOnce` 之后调用：上一次派发里若记录了事件命中，就在这里停住。 */
  async #afterStepEvent(): Promise<void> {
    const hit = this.#pendingEventHit;
    if (!hit) return;
    this.#pendingEventHit = null;
    await this.#pauseAtBreak(hit);
  }

  /**
   * **断点闸门**：每条指令执行之前查一次；命中则挂起，等控制面板点「继续」。
   *
   * 返回 Promise ⇒ 主循环 `await` 它 ⇒ 渲染进程仍在转（能收 IPC、能合成、能跑 `#waitForResume` 那套服务），
   * 但**不再派发下一条指令** —— 这就是"停住"。
   */
  async #beforeStep(frame: Frame, instr: BinInstruction | undefined): Promise<void> {
    if (this.#breaks.length === 0) return;
    // 指令步断点（事件断点不在这里，它们在写/绑的那一刻触发 —— 见 `#onGlobalWrite` / `#onSlotBind`）
    const here = `${frame.name}@${frame.ip}`;
    if (this.#breakSkipOnce === here) {
      // 「继续」后放行同一条：断点语义与调试器一致 —— 继续 = 从这条**走**过去，
      // 而不是原地反复命中（否则用户点继续也不动，看起来像死锁）。
      this.#breakSkipOnce = null;
      return;
    }
    const hit = matchInstruction(this.#breaks, this.#e, frame.name);
    if (!hit) return;
    await this.#pauseAtBreak(hit);
  }

  /** 挂起并上报命中；等 `#resumeFromBreak()`（面板「继续」）。 */
  async #pauseAtBreak(hit: BreakHit): Promise<void> {
    this.#breakHit = hit;
    hit.spec.hits = (hit.spec.hits ?? 0) + 1;
    const text = `⏸ 断点命中 #${hit.spec.id}（第 ${hit.spec.hits} 次）：${hit.where}`;
    this.#native.log(`[break] ${text}${hit.detail ? ` ${hit.detail}` : ''}`);
    this.#traceLog.line(`=== BREAK #${hit.spec.id} ${hit.where}${hit.detail ? ` ${hit.detail}` : ''} ===`);
    this.#traceLog.flush();
    // 推送而不是 invoke：暂停是**持续态**，面板只是被告知；用户点「继续」再走另一条通道回来。
    this.notifyStatus();
    window.api?.sendBreakPaused?.({
      id: hit.spec.id,
      where: hit.where,
      ...(hit.detail ? { detail: hit.detail } : {}),
      // 不带 ast（闭包/函数不可跨 IPC 结构化克隆）
      spec: { id: hit.spec.id, kind: hit.spec.kind, where: hit.spec.where, condition: hit.spec.condition },
    });
    await new Promise<void>((resolve) => {
      this.#breakResume = resolve;
    });
    this.#breakHit = null;
    this.#breakResume = null;
  }

  /** 面板点「继续」：放行同一条指令。 */
  #resumeFromBreak(): void {
    if (!this.#breakResume) {
      this.#traceLog.line('[break] 忽略「继续」：当前没有断点暂停');
      return;
    }
    const fr = this.#e.curScript();
    this.#breakSkipOnce = `${fr.name}@${fr.ip}`;
    const r = this.#breakResume;
    this.#breakResume = null;
    r();
  }

  /** 面板下发的「设置断点」。解析失败**不入表**并回报原因（面向用户）。 */
  #addBreak(kind: 'step' | 'event', where: string | undefined, condition: string): { id?: number; error?: string } {
    try {
      const spec = compileBreak({
        id: this.#breakSeq,
        kind,
        ...(where ? { where: where as NonNullable<BreakSpec['where']> } : {}),
        condition,
      });
      this.#breakSeq++;
      this.#breaks.push(spec);
      this.#traceLog.line(
        `[break] + #${spec.id} ${kind}${where ? `/${where}` : ''} ${condition ? `when ${condition}` : '(无条件)'}`,
      );
      return { id: spec.id };
    } catch (err) {
      return { error: `断点条件无法解析：${(err as Error).message}` };
    }
  }

  /**
   * **执行一条已解析的调试命令**（`tickets/T-0127`）—— 面板的命令台与 CLI 的 `eval` 通道都走这里，
   * 保证"同一条命令在两个入口下的效果与回执一致"。
   *
   * 返回给人看的回执行（CLI 直接把这几行打出来；面板另有自己的转录区）。
   */
  #applyDebugAction(act: DebugAction): string[] {
    switch (act.a) {
      case 'help':
        return [...DEBUG_COMMAND_HELP];
      case 'continue':
        this.#resumeFromBreak();
        return ['（已请求继续）'];
      case 'break-list':
        this.#reportBreakList({});
        return [`断点 ${this.#breaks.length} 条（明细见 event=break-list 推送）`];
      case 'break-del':
        this.#breaks = act.id === undefined ? [] : this.#breaks.filter((b) => b.id !== act.id);
        this.#reportBreakList({});
        return [`（已请求删除${act.id === undefined ? '全部' : ` #${act.id}`}）`];
      case 'break-add': {
        const r = this.#addBreak(act.breakKind, act.where, act.condition);
        if (r.error) {
          this.#reportBreakList({ error: r.error });
          return [`✗ ${r.error}`];
        }
        this.#reportBreakList({});
        return [`（断点 #${r.id} 已下发；命中会以 event=paused 推送）`];
      }
      case 'focus':
        // ★`tickets/T-0134`：宿主焦点模式由调试器显式下发（`focus auto|on|off`）。
        //   `off` 会立刻执行与 DOM blur 完全相同的释放（`releaseAllMouse` + `releaseAllKeys`），
        //   之后 `inputAttach` 的焦点处理器在此模式下忽略宿主噪声（DSH 抢焦点 / iframe 失焦 / offscreen）。
        this.#e.input.setHostFocus(act.mode);
        this.#traceLog.line(
          `[focus] hostFocus=${act.mode}${act.mode === 'off' ? '（已释放全部鼠标/键盘按住态）' : ''}`,
        );
        return [`hostFocus=${act.mode}`];
      case 'input': {
        // ★`tickets/T-0135` Phase 2（`T-0133` §B.4.3）：agent 的输入命令 → `ScenarioEvent` →
        //   `applyScenarioEvent`。**不经 DOM**（所以浏览器宿主与 Electron 宿主同一条路），
        //   坐标本来就是引擎虚拟 1280×720 ⇒ 不需要"客户区/图像/虚拟"三套换算。
        //   命中测试/悬停由 `setCursor` → `onCursorMove` → `routes.hitTest` 触发（`T-0133` §0.11）。
        for (const ev of act.events) applyScenarioEvent(this.#e.input, ev as ScenarioEvent);
        const kinds = act.events.map((e) => (e.kind === 'cursor' && e.valid === false ? 'leave' : e.kind)).join(', ');
        this.#traceLog.line(`[input] 注入 ${act.events.length} 个事件：${kinds}`);
        return [`已注入 ${act.events.length} 个输入事件（${kinds}）`];
      }
      case 'snapshot': {
        // ★`tickets/T-0122`：引擎态快照。**只读**（`captureEngineSnapshot` 不改任何状态）。
        //   场景态经 `sceneForSnapshot`（只读引用）传入 —— 快照要覆盖 `render4` 那两格。
        const snap = captureEngineSnapshot(this.#e, Date.now(), this.#pixi.sceneForSnapshot);
        this.#traceLog.line(`[snapshot] 导出引擎态：cur=${snap.cur} frames=${snap.frames.length}`);
        return [snapshotToJson(snap)];
      }
      case 'restore': {
        // ★恢复的 `warnings` **必须**打出去（`SNAPSHOT_EXCLUDED` 的口径：不许静默地"恢复了个不全的快照"）。
        const snap = snapshotFromJson(act.json);
        const rep = restoreEngineSnapshot(this.#e, snap, this.#pixi.sceneForSnapshot);
        for (const w of rep.warnings) this.#traceLog.line(`[restore] ${w}`);
        this.#traceLog.line(`[restore] 已恢复分区：${rep.restored.join(', ')}`);
        return [
          `已恢复：${rep.restored.join(', ')}`,
          ...rep.warnings.map((w) => `⚠ ${w}`),
          ...rep.skipped.map((s) => `· 跳过：${s}`),
        ];
      }
      case 'snapshot':
        // ★`tickets/T-0122`：`snapshot`/`restore` 必须**在帧边界**做 ⇒ 走 `onDebugQuery` 的异步分支
        //   （那里先 `await #atFrameBoundary()` 再回到这里）。走到这一行只可能是有人把它接到了同步派发上。
        return ['（内部错误：snapshot 必须走 onDebugQuery 的异步分支 —— 它要等帧边界）'];
      case 'restore':
        return ['（内部错误：restore 必须走 onDebugQuery 的异步分支 —— 它要等帧边界）'];
      case 'capture':
        // ★`capture` 是**异步**的（要 await 抓帧）⇒ 不走这条同步路径：真正的处理在 `onDebugQuery` 的
        //   `act.a === 'capture'` 分支（那里能 await 并把 base64 放进结果的 `png` 字段）。
        //   走到这一行只可能是有人把它接到了同步派发上 —— 明确报错，不要静默返回空。
        return ['（内部错误：capture 必须走 onDebugQuery 的异步分支）'];
      case 'query':
        return [`（内部错误：query 不该走这里）${act.text}`];
    }
  }

  /** 把断点表 + 当前暂停态回给面板（面板据此渲染列表与「继续」按钮）。 */
  #reportBreakList(extra: { error?: string }): void {
    window.api?.sendBreakList?.({
      list: this.#breaks.map((b) => ({
        id: b.id,
        kind: b.kind,
        where: b.where,
        condition: b.condition,
        hits: b.hits ?? 0,
      })),
      paused: this.#breakHit ? { id: this.#breakHit.spec.id, where: this.#breakHit.where, detail: this.#breakHit.detail } : null,
      ...(extra.error ? { error: extra.error } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // 观察者：控制窗 / trace / 遥测 / jsonl / 状态上报
  // -------------------------------------------------------------------------

  #makeObserver(): FrameObserver {
    const mine: FrameObserver = {
      onGate: (o) => this.#onGate(o),
      onAdvanceWait: (o) => this.#onAdvanceWait(o.handled),
      onStepStart: (o) => this.#onStepStart(o.frame),
      onStep: async (o) => this.#onStep(o.t, o.steps),
      onFrameEnd: (o) => this.#onFrameEnd(o),
      onUnknown: (err) => this.#onUnknown(err),
      onError: (err) => this.#onError(err),
    };
    // ★本类交出去的是**动态合成**（而不是 `mergeObservers(mine, this.#extra)` 的一次性快照）：
    //   `--record` 的记录器是**运行中**挂上来的（界面就绪后主进程才发指令）。
    const extra = (): FrameObserver | undefined => this.#extra;
    return {
      get wantsDigest(): boolean {
        return extra()?.wantsDigest === true;
      },
      onFrameStart: (o) => extra()?.onFrameStart?.(o),
      onGate: (o) => mine.onGate?.(o),
      onAdvanceWait: (o) => {
        mine.onAdvanceWait?.(o);
        extra()?.onAdvanceWait?.(o);
      },
      onStepStart: (o) => mine.onStepStart?.(o),
      onStep: async (o) => {
        await mine.onStep?.(o);
        await extra()?.onStep?.(o);
      },
      onScriptChange: (o) => extra()?.onScriptChange?.(o),
      onPresent: (o) => extra()?.onPresent?.(o),
      onFrameEnd: (o) => mine.onFrameEnd?.(o),
      onStop: (o) => extra()?.onStop?.(o),
      // 策略类由本类负责（记录器不改产品行为）。
      onUnknown: (err, phase) => mine.onUnknown?.(err, phase),
      onError: (err, phase) => mine.onError?.(err, phase),
    };
  }

  /** 分支观测：还原修前那几条门日志（内容一字不变），并设置遥测的"当前门"。 */
  #onGate(o: FrameObservation & { branch: string }): void {
    const e = this.#e;
    switch (o.branch) {
      case 'anim': {
        // `0x400` 动画等待门：引擎主循环 raw 21109-21152 —— 放行 = `!sub_407E20(pool)`。
        // 观察者与驱动**问同一个引擎函数**（`Engine.serviceWaitGate`，同帧内幂等；不是第二份判据）。
        this.#setGate('0x400');
        if (this.#e.serviceWaitGate(o.nowMs)) {
          this.#waiting = false;
          this.#traceLog.line('=== gate 0x400 cleared (scene anims done) ===');
        } else {
          if (!this.#waiting) this.#traceLog.line(`=== gate 0x400 WAIT (scene anims pending) steps=${this.#steps} ===`);
          this.#waiting = true;
        }
        break;
      }
      case 'sleep': {
        // sleep(0xC8) 门：持续让帧直到 nowMs >= sleepUntil 才放行（引擎帧让步 Sleep(n)ms / 帧率节流 n ms）。
        this.#setGate('sleep');
        if (e.nowMs >= e.sleepUntil) {
          // ★不改状态：清位是**驱动**的事（这里只观察）—— 观察者一旦也改门旗标，就又出现
          //   "同一件事两处实现"（`T-0008` 的 `waitFlags` 镜像事故正是这么来的）。
          this.#sleeping = false;
          this.#traceLog.line(`=== gate sleep cleared (t=${Math.round(e.nowMs)}ms) ===`);
        } else {
          if (!this.#sleeping) {
            this.#traceLog.line(`=== gate sleep WAIT (until ${Math.round(e.sleepUntil)}ms) steps=${this.#steps} ===`);
          }
          this.#sleeping = true;
        }
        break;
      }
      case 'text-reveal':
        // ★**逐字显现中**（引擎 `sub_409400`：每帧按 `message:MessageSpeed` 推进一步，期间不派发脚本指令）。
        this.#setGate('text-reveal');
        break;
      case 'advance':
        // ★**等待推进门**（引擎 effect_flags bit31 → 主循环 `sub_411BC0` + `Sleep(2)`）：
        //   一页消息已显示完，脚本**挂起**等玩家推进；此期间**不派发任何脚本指令**。
        //   泵的三条出口（键命中 → 点击 → 悬停）都在 `serviceAdvanceWait` 内部；派发证据在帧末采样。
        this.#setGate('wait-input');
        break;
      case 'adv':
        // ★**ADV 分支**（引擎 `sub_411900`）：消息逐字显示中每帧**恰好派发 1 条**指令。
        this.#setGate('adv');
        break;
      default:
        this.#setGate('');
        break;
    }
  }

  #onStepStart(frame: Frame): void {
    this.#status.scriptName = frame.name || this.#status.scriptName;
    this.#status.ip = frame.ip;
  }

  /** 每条指令之后：遥测 / 定向 JSONL / 全量 trace / **纹理帧屏障**（`0x1F9` 之后等 IPC 到位）。 */
  async #onStep(t: StepTrace, driverSteps: number): Promise<void> {
    this.#steps = this.#stepBase + driverSteps;
    this.#status.steps = this.#steps;
    for (const line of this.#telemetry.note(t)) this.#traceLog.line(line);
    this.#writeJsonlIfFiltered(t);
    this.#traceStepIfEnabled(t);
    // ★每次派发之后尽早采样：`lastDispatch` 是"最近一次"，同一帧里可能被后续派发覆盖 ⇒
    //   只在帧边界采样会漏掉点击/悬停（实测：pump 模式下的 `click` 就漏了）。
    this.#sampleDispatch();
    // ★门必须走 `shouldAwaitTextureBarrier`，**不许**在调用点再内联写 opcode（`T-0179` 第 70 轮修）：
    //   修前这里只判**单条** opcode（`0x1F9`），把 `app/textureBarrier.ts` 判据集合里的 `0x249` 又滤掉了
    //   —— 于是「同族门 0x249 也过」只在那份纯函数单测里成立，会话接线处**永远等不到它**。
    //   语料证据（`T-0179` C 波）：全库「`i249`/`i1f9` 紧邻 `i208`」的现场只有 2 处、**都是 `i249`**
    //   （`src/BTL.txt:4174-4175`、`src/DRAWCHP.txt:56-59`），紧接着的 `draw-texture` 直接把 `i208` 的
    //   宽高当**源矩形**用 ⇒ 0×0 就是"贴图不可见"。守卫 = `test/texture-barrier-observable.test.ts` 的源棘轮。
    if (shouldAwaitTextureBarrier(t.opcode)) await this.#awaitTextureBound(t);
  }

  #onFrameEnd(o: FrameObservation): void {
    this.#frames = this.#frameBase + o.frames;
    this.#sampleDispatch();
    this.#reflectStateEnds();
    this.#reportDiagnostics();
    this.#traceLog.flush(); // 每帧末落盘一次（批量，避免逐行 IPC）
    this.#jsonl.flush(); // 定向 trace 也按帧末批量发送
    // ★`tickets/T-0122`：帧边界到了 —— 放行所有等边界的快照/恢复（见 `#boundaryWaiters`）。
    if (this.#boundaryWaiters.length > 0) {
      const ws = this.#boundaryWaiters;
      this.#boundaryWaiters = [];
      for (const w of ws) w();
    }
  }

  /**
   * 等**下一个帧边界**（`tickets/T-0122` 的「优先只在帧边界做」）。
   *
   * 超时（默认 5s）⇒ 抛：帧循环没在跑时"就地做"会读到中断态，那比失败更糟 ⇒ **响亮失败**。
   */
  #atFrameBoundary(timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        const i = this.#boundaryWaiters.indexOf(hit);
        if (i >= 0) this.#boundaryWaiters.splice(i, 1);
        reject(new Error(`${timeoutMs}ms 内没等到帧边界（帧循环没在跑？）—— 快照/恢复只在帧边界做，拒绝在中断态就地做`));
      }, timeoutMs);
      const hit = (): void => {
        clearTimeout(t);
        resolve();
      };
      this.#boundaryWaiters.push(hit);
    });
  }

  /**
   * **等待推进泵的结果**（驱动在 `serviceAdvanceWait()` 之后回调）—— 与修前那两行日志逐字一致：
   *  - 泵派发的是悬停 label ⇒ `[hover-label] hover-enter/leave …`；
   *  - 其余（命中键/点击，或"页内文本推完"= 没有新派发）⇒ `=== advance-wait handled → … ===`
   *    （★修前 `d` 可能是 undefined，那时打的是 `-`；`handled` 为真但没有派发是**正常**的一种出口）。
   */
  #onAdvanceWait(handled: boolean): void {
    if (!handled) return;
    const d = this.#e.lastDispatch;
    if (d) this.#lastDispatch = d; // 已记过 ⇒ `#sampleDispatch` 不再重复
    const hex = (v: number): string => `0x${(v >>> 0).toString(16)}`;
    if (d && d.kind.startsWith('hover')) {
      this.#traceLog.line(
        `[hover-label] ${d.kind} ${hex(d.label)} cursor=${this.#e.routes.cursor}/${this.#e.routes.count} ip=${this.#e.curScript().ip} ret=${this.#e.curScript().retStack[this.#e.curScript().retStack.length - 1]}`,
      );
    } else {
      this.#traceLog.line(
        `=== advance-wait handled → ${d ? d.kind : '-'} ${d ? hex(d.label) : ''} ip=${this.#e.curScript().ip} (page ${this.#e.msgwin.pages}, 热点 ${this.#e.routes.count} 项) steps=${this.#steps} ===`,
      );
    }
  }

  /**
   * **悬停派发的证据行**（引擎 `sub_403E70` 的两段式：先"离开"旧项、下一帧"进入"新项）。
   *
   * ★只补**泵之外**发生的悬停派发（泵内的那一条由 `#onAdvanceWait` 打，两者靠 `#lastDispatch` 去重）。
   * 为什么还要补：`e.lastDispatch` 是"最近一次"，同一帧里可能被后续派发覆盖 ⇒ 只在泵出口采样会漏。
   */
  #sampleDispatch(): void {
    const d = this.#e.lastDispatch;
    if (!d || d === this.#lastDispatch) return;
    if (!d.kind.startsWith('hover')) return; // 非悬停的由泵出口负责（修前也是那样）
    this.#lastDispatch = d;
    const hex = (v: number): string => `0x${(v >>> 0).toString(16)}`;
    this.#traceLog.line(
      `[hover-label] ${d.kind} ${hex(d.label)} cursor=${this.#e.routes.cursor}/${this.#e.routes.count} ip=${this.#e.curScript().ip} ret=${this.#e.curScript().retStack[this.#e.curScript().retStack.length - 1]}`,
    );
  }

  /**
   * 两个"态结束"的日志（修前它们写在分支体里）。
   * ★驱动不搬运"上一帧状态"这类记账（那是观察面）⇒ 这里用**状态沿**判断：
   * 逐字显现结束 / ADV 位被清 ⇒ 各一条日志，行文本与修前逐字一致。
   */
  #reflectStateEnds(): void {
    const revealing = this.#e.textRevealing;
    if (this.#wasRevealing && !revealing) this.#traceLog.line('=== text reveal done ===');
    this.#wasRevealing = revealing;
    const adv = this.#e.advActive;
    if (this.#wasAdv && !adv) this.#traceLog.line('=== ADV cleared (reveal done) ===');
    this.#wasAdv = adv;
  }

  #onUnknown(err: unknown): 'stop' {
    const caught = err as NotImplementedOp;
    // 可恢复的硬停：stepOnce 未消费操作数、未推进 ip ⇒ 记下暂停点，
    // 等控制窗点「作为桩函数跳过」（→ onControlSkipOp 登记 e.unknownOpStubs）后从**同一条指令**重试。
    this.#err = caught;
    this.#pausedOp = {
      opcode: caught.opcode,
      name: caught.name,
      script: caught.scriptName,
      byteOffset: caught.byteOffset,
      instrIndex: caught.instrIndex,
    };
    this.#native.log(`[pause] ${caught.message} —— 等待控制窗「作为桩函数跳过」`);
    this.#traceLog.line(
      `=== PAUSE unknown opcode 0x${caught.opcode.toString(16)} (${caught.name}) ${caught.scriptName}@ip=${caught.instrIndex} ===`,
    );
    this.notifyStatus(caught.message);
    this.#traceLog.flush();
    return 'stop';
  }

  #onError(err: unknown): 'stop' {
    this.#err = err;
    const emsg = (err as Error).message;
    this.#native.log(`[error] ${emsg}`);
    // 其它硬错误（非「未知指令」）：立即上报控制窗展示，然后停。
    // ★同时**粘住**文本（见 `#errorText`）：收尾那次不带 override 的上报会把横幅擦掉。
    this.#errorText = emsg;
    this.notifyStatus(emsg);
    this.#traceLog.flush();
    return 'stop';
  }

  // -------------------------------------------------------------------------
  // 主循环：进入驱动 → 处理停止原因
  // -------------------------------------------------------------------------

  /** 跑到脚本退出/重置/硬错误/关窗为止。 */
  async run(): Promise<void> {
    const e = this.#e;
    const observer = this.#makeObserver();
    const host = this.#frameHost();
    const opt = this.#loopOptions(observer);

    while (this.#steps < MAX_STEPS) {
      this.#stepBase = this.#steps;
      this.#frameBase = this.#frames;
      const r = await runFrameLoop(e, host, opt);
      this.#steps = this.#stepBase + r.steps;
      this.#frames = this.#frameBase + r.frames;

      if (r.stopReason === 'unknown') {
        // ★暂停态（互动面，不是驱动语义）：继续让帧 + 合成，等控制窗登记桩后**重新进入驱动**。
        await this.#waitForResume();
        continue;
      }
      if (r.stopReason === 'exit') {
        // abort(0x1)/程序退出：关闭主窗口（0x2 顶层 program-exit 亦走此）。
        this.#native.log('=== abort/program exit -> close window ===');
        this.#traceLog.line('=== abort/program exit ===');
        this.#traceLog.flush();
        window.api?.closeWindow?.();
        break;
      }
      // error / script-end / until / cap / step-stop：收尾。
      break;
    }

    this.#traceLog.line(`[boot] done script=${this.#status.scriptName} ip=${this.#status.ip} steps=${this.#status.steps}`);
    this.#traceLog.flush();
    this.notifyStatus(); // 收尾上报：把最终态（含仍暂停的未知指令）给控制窗
    console.log(`[boot] done script=${this.#status.scriptName} ip=${this.#status.ip} steps=${this.#status.steps}`);
    if (this.#err) console.error(`[boot] ${(this.#err as Error).message}`);
  }

  /**
   * **暂停态的"互动面"帧**：驱动已停下（VM 不再推进），但窗口要保持响应 ——
   * 每帧仍做"服务 + 音频 tick + 推进模型 + 屏障 + 合成"，再让帧等控制窗的 skip 请求。
   *
   * ★为什么它不进驱动：`paused` 是**控制窗交互**，不是引擎主循环的分支（设计文档 §7 明确不做）。
   */
  async #waitForResume(): Promise<void> {
    while (this.#pausedOp) {
      const nowMs = performance.now();
      this.#e.nowMs = nowMs;
      this.#e.serviceWinReveal(nowMs);
      this.#e.serviceCharGrid(nowMs);
      this.#native.audio?.({ kind: 'tick', nowMs, advActive: this.#e.advActive });
      this.#pixi.advanceModel(nowMs);
      if (this.#native.texturesIdle) await this.#native.texturesIdle();
      this.#native.present?.(nowMs, this.#e.waitFlags);
      this.#reportDiagnostics();
      this.#traceLog.flush();
      this.#jsonl.flush();
      await nextFrame();
    }
  }

  /**
   * **`set-texture`(0x1F9) 之后的同步屏障**（2026-09 新增；修「进 `SN0000` 序章整屏全黑」）。
   *
   * 引擎的 `0x1F9`（`sub_422CB0` → `sub_4559C0`）是**同步**读文件 + 解码 ⇒ 在同一条不可分割的
   * 指令序列里 `set-texture` → `0x208`（纹理尺寸 getter）→ `0x1FB`（draw-texture）**必然一致**：
   * 脚本拿到的宽高就是刚绑上那张图的宽高。
   *
   * renderer 侧走 `window.api.image()` 的**异步 IPC**，只在帧末合成前补屏障（见 `#frameHost().present`）
   * 是**不够**的 —— VM 早已带着 0×0 跑过去了：`TextureCache.size()` 在"尚未载入"分支返回 0×0，
   * 于是 `0x1FB` 把 `0×0` 写进绘制项的**源矩形** ⇒ 该图元永远画不出来。
   * 实测（`.tmp/gs-7-sn0000-first-text.png` 全黑）：
   * ```
   * bindTexture imgid=0xb37 slot=4
   * getTextureSize slot=4 → 0x0（纹理尚未载入，imgid=0xb37）
   * configureDrawItem h=0x18a88 layer=101000 (0,0,0x0)      ← 源矩形 0×0 = 不可见
   * image b37 -> BG050ABL.AGF (2048x1152)                   ← 图其实载入了，只是晚了一步
   * ```
   * 只在 `0x1F9` 这一条之后等待（绑定是稀有事件），不影响常规帧率；
   * headless 宿主不实现 `texturesIdle` ⇒ 自动跳过（`test/game-start-chain.test.ts` 的 E3 不受影响）。
   */
  async #awaitTextureBound(t: StepTrace): Promise<void> {
    // ★`0x249` 也要等（`tickets/T-0102` 轮 9）：它与 `0x1F9` 是同一族的"按统一 id 把纹理载入槽"
    //   （`sub_425310` raw 32717-32768；两者共用 `normalizeTextureColor`，见 `handlers/gfx-texture.ts`），
    //   同样走 `native.bindTexture` 的异步路径 ⇒ 只认 `0x1F9` 会漏掉它（语料 20 处 / 8 脚本）。
    // ★判据与"没缝时怎么办"都在 `app/textureBarrier.ts`（纯函数，可单测）——这里只做接线 + 记账，
    //   不再自己写一遍 opcode 集合（修前这里是一行内联的 `!==` 判断，**没有任何守卫盯着它**）。
    // ★槽号这里**取不到**（`StepTrace` 不带操作数值，只有格式化好的 `operands` 串）⇒ 传 `-1`；
    //   要槽号就去看同一帧的 `bindTexture imgid=… slot=…` 日志行（`0x1F9` handler 打的）。
    const obs = observeTextureBarrier(t.opcode, -1, this.#native.texturesIdle?.bind(this.#native));
    if (!obs.triggered) return;
    this.#texBarrier.calls++;
    if (obs.trace && (obs.hostSeam || !this.#texBarrierNoSeamLogged)) {
      if (!obs.hostSeam) this.#texBarrierNoSeamLogged = true;
      this.#traceLog.line(obs.trace);
    }
    if (obs.awaited) {
      this.#texBarrier.awaits++;
      await obs.awaited;
    }
  }

  /**
   * ★定向 trace → JSONL：**默认关闭**。逐条写 JSONL 每条都要一次 IPC + 主进程写盘，代价极高
   * （实测曾把主进程的同步写盘打满：一次会话写出 109MB、连窗口都关不掉）。
   * 因此只在控制窗**显式设置了 opcode 白名单**时才记，且由 `JsonlWriter` 分批发送。
   */
  #writeJsonlIfFiltered(t: StepTrace): void {
    if (this.#traceFilter.size === 0 || !window.api?.appendTraceLine || !this.#traceFilter.has(t.opcode)) return;
    this.#jsonl.push(
      JSON.stringify({
        step: this.#steps,
        script: t.script,
        ip: t.ip,
        op: `0x${t.opcode.toString(16)}`,
        name: t.name,
        kind: t.handlerKind,
        operands: t.operands,
        ...(t.gap ? { gap: true } : {}),
      }),
    );
  }

  /** 指令日志：traceAll=全量打印（节流 ≥100ms 防爆炸）；否则默认只打印遥测里的「已忽略」信息。 */
  #traceStepIfEnabled(t: StepTrace): void {
    if (!this.#traceAll) return;
    const now = performance.now();
    if (now - this.#lastStepLog < 100) return;
    this.#lastStepLog = now;
    this.#traceLog.line(
      `step ${this.#steps} ${t.name} op=0x${t.opcode.toString(16)} ip=${t.ip} kind=${t.handlerKind} script=${this.#status.scriptName}`,
    );
  }

  /** 节流打印输入实况 + 上报遥测。 */
  #reportDiagnostics(): void {
    const nowMs = performance.now();
    // 诊断：节流打印 InputManager 实况（只报输入态，不再叠加 draw-item 概览——
    //   `[present ...] items={...}` 已每 500ms 报场景 item 摘要，避免同列表重复刷）。
    if (nowMs - this.#lastInputLog > 500) {
      this.#lastInputLog = nowMs;
      const im = this.#e.input;
      this.#traceLog.line(
        `[input-state] hasCursor=${im.hasCursor ? 1 : 0} pos=(${im.readX()},${im.readY()}) ` +
          `moved=${im.mouseMoved ? 1 : 0} edge=0x${im.mouseEdge.toString(16)} btn=${im.readButtons()} ` +
          `wheel=${im.wheelDelta} ` +
          `mouseJump=0x${im.mouseJump.toString(16)} mouseSlot=0x${im.mouseSlot.toString(16)}`,
      );
    }
    // 节流向控制窗上报状态（当前 BIN + 已忽略/已跳过指令 + traceAll + 暂停点 + 遥测）
    if (nowMs - this.#lastStatusSend > 500) {
      this.#stepsPerSec = ((this.#steps - this.#perfSteps) * 1000) / Math.max(1, nowMs - this.#perfMs);
      this.#perfSteps = this.#steps;
      this.#perfMs = nowMs;
      this.#lastStatusSend = nowMs;
      this.notifyStatus();
    }
  }
}

/**
 * `Uint8Array` → base64（**浏览器与 Node 都能跑**；`tickets/T-0134` 的 `capture` 命令用）。
 *
 * ★为什么不用 `Buffer`：这段代码跑在**渲染进程**（浏览器 bundle，`T-0054` 的"渲染器安全"棘轮：
 *   连 `Buffer` 都不能用）；`btoa` 是两边都有的全局。
 * ★为什么要分块：一帧 PNG 有 MB 量级，`String.fromCharCode(...bytes)` 会**撑爆调用栈**
 *   （spread 的实参个数上限）⇒ 按 32KB 一段累积。
 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
