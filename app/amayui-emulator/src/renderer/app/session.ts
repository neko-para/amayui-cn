/**
 * **VM 会话**：引擎式门控主循环 + 控制窗桥接 + 遥测上报。
 *
 * 这是原先 `renderer.ts` 里那个 388 行 `main()` 的主体，按职责拆成三块后归到本类：
 *  1. **门控状态机**（`run`）——每轮要么服务一个等待门（`0x400` 动画等待 / `SLEEP_GATE` sleep）、
 *     要么停在未知指令等控制窗、要么推进一批指令；
 *  2. **控制窗桥接**（`registerControlHandlers`）——全量指令日志开关、定向 trace 白名单、桩跳过；
 *  3. **状态上报**（`notifyStatus`）——节流推送 `ControlStatus`（BIN 名 / 四张清单 / 遥测 / 暂停点 / 错误）。
 *
 * 与渲染后端的边界：本类只调 `native.present()/needsRender()/sceneAnimationsDone()/log()`，
 * 不触碰 Pixi 内部；渲染循环（`startFrameLoop`）由 `boot.ts` 启动，两边靠 `nowMs` 与门旗标协作。
 */
import { SLEEP_GATE, type Engine } from '../../vm/engine.js';
import { NotImplementedOp, stepOnce } from '../../vm/interpreter.js';
import { ExitScript, ScriptReset } from '../../vm/ops.js';
import type { DropRecorder } from '../../vm/nativeTap.js';
import type { ControlStatus } from '../ipcFileSource.js';
import type { PixiBackend } from '../pixiBackend.js';
import type { RenderStatus } from '../renderStatus.js';
import { JsonlWriter } from './jsonlWriter.js';
import { Telemetry } from './telemetry.js';
import type { TraceLog } from './traceLog.js';
import type { BootedApp } from './boot.js';

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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export class RendererSession {
  readonly #status: RenderStatus;
  readonly #traceLog: TraceLog;
  readonly #native: PixiBackend;
  readonly #drops: DropRecorder;
  readonly #e: Engine;

  readonly #telemetry = new Telemetry();
  readonly #jsonl = new JsonlWriter();

  /** 指令日志开关（控制窗可切）：false = 只记「已忽略/未知」指令；true = 记全量指令。 */
  #traceAll = false;
  /** ★定向 trace 白名单（空 = 不记 JSONL）。 */
  #traceFilter = new Set<number>();

  /**
   * 暂停点：解释器停在一条「未实现 opcode」上等用户在控制窗点「作为桩函数跳过」。
   * 注意 stepOnce 抛 NotImplementedOp 时**尚未消费任何操作数、也未推进 ip**，因此登记桩函数后
   * 直接对同一条指令重试即可继续（无需回滚 VM 状态）。
   */
  #pausedOp: ControlStatus['pendingUnknown'] | null = null;

  #steps = 0;
  #lastStepLog = 0; // 节流：traceAll 全量打印时 step trace 的最小间隔(ms)
  #waiting = false;
  #sleeping = false;
  #err: unknown = null;
  #lastInputLog = 0; // 节流：[input-state] 诊断打印
  #lastStatusSend = 0; // 节流：向控制窗上报状态的间隔(ms)

  /** ★遥测：当前卡在哪个门 + 它从何时开始 + present 次数 + 步进速率。 */
  #gate = '';
  #gateSince = performance.now();
  #frames = 0;
  #perfSteps = 0;
  #perfMs = performance.now();
  #stepsPerSec = 0;

  constructor(app: BootedApp) {
    this.#status = app.status;
    this.#traceLog = app.traceLog;
    this.#native = app.native;
    this.#drops = app.drops;
    this.#e = app.e;
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
    // 暂停中且没有更具体的错误文本时，用一句可读提示（控制窗的按钮/清单同时给出精确位置）。
    const autoError = paused
      ? `停在未知指令 0x${paused.opcode.toString(16)} (${paused.name}) @ ${paused.script}`
      : undefined;
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
      error: errorOverride ?? autoError,
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
    this.#pausedOp = null;
    this.#err = null;
    this.#status.ip = this.#e.curScript().ip;
    this.notifyStatus();
    this.#traceLog.flush();
  }

  /** 跑到脚本退出/重置/硬错误/关窗为止。 */
  async run(): Promise<void> {
    const e = this.#e;
    const native = this.#native;
    const status = this.#status;

    outer: while (this.#steps < MAX_STEPS) {
      // 引擎 timeGetTime()（墙钟 ms）：0xCD(get-input-type) 节流 / mesh/文字动画用
      e.nowMs = performance.now();
      if (e.waitFlags & 0x400) {
        // 门控：0x400（版权页动画等待）由渲染循环的时钟驱动放行
        this.#serviceAnimGate();
      } else if (e.waitFlags & SLEEP_GATE) {
        this.#serviceSleepGate();
      } else if (e.awaitingAdvance) {
        // ★**等待推进门**（引擎 effect_flags bit31 → 主循环 `sub_411BC0` + `Sleep(2)`）：
        // 一页消息已显示完，脚本**挂起**等玩家推进；此期间**不派发任何脚本指令**。
        // 这正是「等待输入态」在引擎里的真实行为（此前 emulator 会在这里空转 10000 条/帧）。
        this.#setGate('wait-input');
        if (e.serviceAdvanceWait()) {
          this.#traceLog.line(
            `=== advance-wait cleared → ip=${e.curScript().ip} (page ${e.msgwin.pages}, 热点 ${e.routes.count} 项) steps=${this.#steps} ===`,
          );
        }
        native.present();
        this.#frames++;
      } else if (this.#pausedOp) {
        this.#setGate('paused');
        // 暂停态：VM 停在未知指令，等控制窗点「作为桩函数跳过」（或「重启」）。
        // 这里仍然 present（画面/时钟继续），只是不再推进 VM——保持窗口有响应。
        native.present();
        this.#frames++;
      } else if (e.advActive) {
        // ★**ADV 分支**（引擎 `sub_411900`）：消息逐字显示中每帧**恰好派发 1 条**指令，
        // 并跑输入泵 + 「取消消息键」三态机 + 「未显示完」判定（后者负责清掉 ADV 位）。
        this.#setGate('adv');
        const stillAdv = e.serviceAdv();
        this.#stepOnceTraced();
        if (!stillAdv) this.#traceLog.line('=== ADV cleared (reveal done) ===');
        if (native.needsRender()) native.present();
        this.#frames++;
      } else {
        this.#setGate('');
        if (await this.#runInstructionBatch()) break outer;
        // 引擎式 present：场景脏/动画待播/刚命中门控时合成。若此批停在门控，由下轮门控分支持续 present。
        if (native.needsRender()) native.present();
      }

      this.#reportDiagnostics();
      this.#traceLog.flush(); // 每帧末落盘一次（批量，避免逐行 IPC）
      this.#jsonl.flush(); // 定向 trace 也按帧末批量发送
      // 让渲染帧循环跑（present/时钟），再继续；暂停态下同样在此让出（不空转），等待控制窗的 skip 请求。
      await nextFrame();
    }

    this.#traceLog.line(`[boot] done script=${status.scriptName} ip=${status.ip} steps=${status.steps}`);
    this.#traceLog.flush();
    this.notifyStatus(); // 收尾上报：把最终态（含仍暂停的未知指令）给控制窗
    console.log(`[boot] done script=${status.scriptName} ip=${status.ip} steps=${status.steps}`);
    if (this.#err) console.error(`[boot] ${(this.#err as Error).message}`);
  }

  /** 0x400 动画等待门：场景动画跑完即放行。 */
  #serviceAnimGate(): void {
    this.#setGate('0x400');
    if (this.#native.sceneAnimationsDone()) {
      this.#e.waitFlags &= ~0x400;
      this.#waiting = false;
      this.#traceLog.line('=== gate 0x400 cleared (scene anims done) ===');
    } else {
      if (!this.#waiting) this.#traceLog.line(`=== gate 0x400 WAIT (scene anims pending) steps=${this.#steps} ===`);
      this.#waiting = true;
    }
    this.#native.present(); // 动画播放（每帧）
    this.#frames++;
  }

  /** sleep(0xC8) 门：持续 present 直到 nowMs >= sleepUntil 才放行（引擎帧让步 Sleep(n)ms / 帧率节流 n ms）。 */
  #serviceSleepGate(): void {
    const e = this.#e;
    this.#setGate('sleep');
    if (e.nowMs >= e.sleepUntil) {
      e.waitFlags &= ~SLEEP_GATE;
      this.#sleeping = false;
      this.#traceLog.line(`=== gate sleep cleared (t=${Math.round(e.nowMs)}ms) ===`);
    } else {
      if (!this.#sleeping) {
        this.#traceLog.line(`=== gate sleep WAIT (until ${Math.round(e.sleepUntil)}ms) steps=${this.#steps} ===`);
      }
      this.#sleeping = true;
    }
    this.#native.present();
    this.#frames++;
  }

  /** 推进一条指令并记账（`sub_411900` 的 ADV 分支用）。 */
  async #stepOnceTraced(): Promise<void> {
    const e = this.#e;
    const status = this.#status;
    const f = e.curScript();
    status.scriptName = f.name || status.scriptName;
    status.ip = f.ip;
    status.steps = ++this.#steps;
    if (!f.script || f.ip >= f.script.instructions.length) return;
    try {
      const t = await stepOnce(e);
      for (const line of this.#telemetry.note(t)) this.#traceLog.line(line);
      this.#writeJsonlIfFiltered(t);
      this.#traceStepIfEnabled(t);
    } catch (caught) {
      this.#handleStepError(caught);
    }
  }

  /** 推进一批指令；返回 true = 需要终止整个会话（重置/退出/硬错误）。 */
  async #runInstructionBatch(): Promise<boolean> {
    const e = this.#e;
    const status = this.#status;
    for (let k = 0; k < SAFETY_PER_FRAME; k++) {
      const f = e.curScript();
      const name = f.name || status.scriptName;
      status.scriptName = name;
      status.ip = f.ip;
      status.steps = ++this.#steps;
      if (!f.script || f.ip >= f.script.instructions.length) break;
      try {
        const t = await stepOnce(e);
        for (const line of this.#telemetry.note(t)) this.#traceLog.line(line);
        this.#writeJsonlIfFiltered(t);
        this.#traceStepIfEnabled(t);
      } catch (caught) {
        const stop = this.#handleStepError(caught);
        if (stop !== null) return stop;
      }
      // 遇到门控就停这批：0x400 动画等待 / sleep / **等待推进门**（0x72 wait-for-input 置的 bit31）
      if (e.waitFlags & (0x400 | SLEEP_GATE) || e.awaitingAdvance) break;
    }
    return false;
  }

  /**
   * ★定向 trace → JSONL：**默认关闭**。逐条写 JSONL 每条都要一次 IPC + 主进程写盘，代价极高
   * （实测曾把主进程的同步写盘打满：一次会话写出 109MB、连窗口都关不掉）。
   * 因此只在控制窗**显式设置了 opcode 白名单**时才记，且由 `JsonlWriter` 分批发送。
   */
  #writeJsonlIfFiltered(t: Awaited<ReturnType<typeof stepOnce>>): void {
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
  #traceStepIfEnabled(t: Awaited<ReturnType<typeof stepOnce>>): void {
    if (!this.#traceAll) return;
    const now = performance.now();
    if (now - this.#lastStepLog < 100) return;
    this.#lastStepLog = now;
    this.#traceLog.line(
      `step ${this.#steps} ${t.name} op=0x${t.opcode.toString(16)} ip=${t.ip} kind=${t.handlerKind} script=${this.#status.scriptName}`,
    );
  }

  /**
   * 处理一条指令抛出的异常。
   * 返回 `true` = 终止会话；`false` = 只结束本批指令、保留状态继续外层循环；`null` = 已就地消化（继续本批）。
   */
  #handleStepError(caught: unknown): boolean | null {
    const native = this.#native;
    if (caught instanceof ScriptReset) {
      // native.log 已同时进 HUD+文件；不再另加一条 trace（避免同事件双行）。
      native.log('=== exit-script teardown (reset) ===');
      return true;
    }
    if (caught instanceof ExitScript) {
      // abort(0x1)/程序退出：关闭主窗口（0x2 顶层 program-exit 亦走此）。
      native.log('=== abort/program exit -> close window ===');
      this.#traceLog.line('=== abort/program exit ===');
      this.#traceLog.flush();
      window.api?.closeWindow?.();
      return true;
    }
    if (caught instanceof NotImplementedOp) {
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
      native.log(`[pause] ${caught.message} —— 等待控制窗「作为桩函数跳过」`);
      this.#traceLog.line(
        `=== PAUSE unknown opcode 0x${caught.opcode.toString(16)} (${caught.name}) ${caught.scriptName}@ip=${caught.instrIndex} ===`,
      );
      this.notifyStatus(caught.message);
      this.#traceLog.flush();
      return false; // 退出本批指令，保留暂停态（外层循环继续 present / 收 skip 请求）
    }
    this.#err = caught;
    const emsg = (caught as Error).message;
    native.log(`[error] ${emsg}`);
    // 其它硬错误（非「未知指令」）：立即上报控制窗展示，然后停
    this.notifyStatus(emsg);
    this.#traceLog.flush();
    return true;
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
