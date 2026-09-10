/**
 * Renderer 入口：宿主画布 + VM（与 run.ts 同流程，但 native 换成 Pixi 后端、FileSource 换成 IPC）。
 * Plan A：渲染帧循环（Pixi ticker）独立跑 present（推进时钟、合成场景图），VM 在其间按"门控"推进——
 *         无门控时每帧跑一批指令（引擎在无门控时快速跑到门控）；遇 0x400 动画等待则停住，由渲染循环放行。
 */
import { Engine, SLEEP_GATE } from '../vm/engine.js';
import { loadScriptData, stepOnce, NotImplementedOp } from '../vm/interpreter.js';
import { ScriptReset, ExitScript } from '../vm/ops.js';
import { InputManager } from '../vm/input.js';
import { IpcFileSource, type ControlStatus } from './ipcFileSource.js';
import { PixiBackend, type RenderStatus } from './pixiBackend.js';

/**
 * 一帧内最多推进的指令数（安全上限）：引擎是"一条一条跑到门控止"，无每帧指令上限。
 * 这里 SAFETY 只作防"无门控死循环"（如 TITLE 轮询）的兜底，不是 present 的触发条件。
 */
const SAFETY_PER_FRAME = 10000;
/** 交互运行上限：进入 TITLE 后不再按步数截止，靠"脚本退出/重置/错误/关窗"收尾；此处仅作病态死循环兜底。 */
const MAX_STEPS = 100_000_000;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function main(): Promise<void> {
  const status: RenderStatus = { scriptName: '…', ip: 0, steps: 0, log: [], trace: [] };
  const input = new InputManager(); // 共享输入状态（渲染器写 / VM 读）
  const native = await PixiBackend.create(status, input); // WebGL 渲染后端（PixiJS v8）
  const src = new IpcFileSource();
  const e = new Engine(native, input);
  e.fileSource = src;

  // 诊断落盘：统一走 status.trace（renderer 的 trace + PixiBackend #pushLog 都进这里），
  // 按"已落盘下标"增量批量写 .tmp/amayui-emulator.log（大小/时间节流避免逐行 IPC 卡顿）；
  // 关窗/卸载时同步 flush，命中错误或关闭也不丢尾。
  let traceFlushed = 0;
  let lastFlushTs = 0;
  const flushBatch = (): void => {
    const lines = status.trace.slice(traceFlushed);
    if (lines.length === 0) return;
    traceFlushed = status.trace.length;
    const batch = lines.join('\n');
    if (window?.api?.logLine) window.api.logLine(batch);
    else console.log('[emu]', batch);
  };
  const trace = (line: string): void => {
    status.trace.push(line);
    if (status.trace.length - traceFlushed >= 40 || performance.now() - lastFlushTs > 120) {
      lastFlushTs = performance.now();
      flushBatch();
    }
  };
  // 关窗/卸载/刷新：同步把剩余日志写盘（保证不丢尾）
  const flushFinal = (): void => {
    const lines = status.trace.slice(traceFlushed);
    if (lines.length === 0) return;
    traceFlushed = status.trace.length;
    const batch = lines.join('\n');
    if (window?.api?.logLineSync) window.api.logLineSync(batch);
    else if (window?.api?.logLine) window.api.logLine(batch);
  };
  window.addEventListener('pagehide', flushFinal);
  window.addEventListener('beforeunload', flushFinal);
  // 启动标记：确认日志通道/起点。
  trace('=== amayui emulator boot ===');

  for (const imgid of [0x5245, 0x5246, 0x5272, 0x5273]) {
    // preloadImage 内部已 pushLog `image <imgid> -> <file> (WxH)`，无需再 trace 一条重复的 [preload]
    await native.preloadImage(imgid);
  }

  try {
    const boot = await src.readScript(0);
    if (!boot) {
      native.log('无法装载 index 0 (SYSTEM4.BIN)');
      native.unhandled(0, 'boot-fail: no script 0');
      native.drawHud();
      return;
    }
    status.scriptName = boot.name;
    loadScriptData(e, boot.data, boot.name);
    native.startFrameLoop(); // 渲染帧循环：每帧 present（推进时钟、合成场景图）。HUD 已移除，诊断信息在控制窗。

    // 指令日志开关（控制窗可切）：false=只记「已忽略/未知」指令；true=记全量指令。
    let traceAll = false;
    // 控制窗：「启用指令日志」开关 → 设 traceAll（true=打印全量指令，false=只打印「已忽略」指令）。
    window.api?.onTraceAll?.((enabled) => {
      traceAll = enabled;
    });

    let steps = 0;
    // 已忽略(engine-internal/插桩跳过)指令：按 opcode 去重，name + 出现次数（供控制窗展示 + 首个打印一次）。
    let ignored = new Map<number, { name: string; count: number }>();
    const ignoredList = () => [...ignored].map(([opcode, v]) => ({ opcode, name: v.name }));
    // 已被用户「作为桩函数跳过」的未知指令：opcode -> {name,count}（登记后每次执行计数）。
    let skipped = new Map<number, { name: string; count: number }>();
    const skippedList = () => [...skipped].map(([opcode, v]) => ({ opcode, name: v.name, count: v.count }));
    /**
     * 暂停点：解释器停在一条「未实现 opcode」上等用户在控制窗点「作为桩函数跳过」。
     * 注意 stepOnce 抛 NotImplementedOp 时**尚未消费任何操作数、也未推进 ip**，因此登记桩函数后
     * 直接对同一条指令重试即可继续（无需回滚 VM 状态）。
     */
    let pausedOp: ControlStatus['pendingUnknown'] | null = null;
    let lastStepLog = 0; // 节流：traceAll 全量打印时 step trace 的最小间隔(ms)
    let waiting = false;
    let sleeping = false;
    let err: unknown = null;
    let lastInputLog = 0; // 节流：[input-state] 诊断打印
    let lastStatusSend = 0; // 节流：向控制窗上报状态的间隔(ms)

    /** 统一上报状态给控制窗（节流轮询与「遇到错误立即上报」都走这里，保证 pendingUnknown 与 error 同源）。 */
    const notifyStatus = (errorOverride?: string): void => {
      // 暂停中且没有更具体的错误文本时，用一句可读提示（控制窗的按钮/清单同时给出精确位置）。
      const autoError = pausedOp
        ? `停在未知指令 0x${pausedOp.opcode.toString(16)} (${pausedOp.name}) @ ${pausedOp.script}`
        : undefined;
      window.api?.sendRendererStatus?.({
        bin: status.scriptName,
        ignored: ignoredList(),
        skipped: skippedList(),
        traceAll,
        error: errorOverride ?? autoError,
        pendingUnknown: pausedOp ?? undefined,
      });
    };

    // 控制窗：点了「作为桩函数跳过」→ 把该 opcode 登记为用户桩（no-op）并从暂停点继续跑。
    window.api?.onControlSkipOp?.((opcode) => {
      if (pausedOp && pausedOp.opcode === opcode) {
        // 登记用户桩：stepOnce 会在静态表都查不到时兜底用它（kind=user-stub），ip 正常 +1 → 从同一条指令恢复。
        e.unknownOpStubs.set(opcode, 1);
        skipped.set(opcode, { name: pausedOp.name, count: 0 });
        trace(`=== skip-as-stub 0x${opcode.toString(16)} (${pausedOp.name}) in ${pausedOp.script} @ ip=${pausedOp.instrIndex} -> resume ===`);
        native.log(`[skip] 0x${opcode.toString(16)} (${pausedOp.name}) 已作为桩函数跳过，继续执行`);
        pausedOp = null;
        err = null;
        status.ip = e.curScript().ip;
        notifyStatus();
        flushBatch();
      } else {
        trace(`[skip] 忽略无效请求 opcode=0x${opcode.toString(16)}（当前未停在未知指令）`);
      }
    });

    outer: while (steps < MAX_STEPS) {
      // 引擎 timeGetTime()（墙钟 ms）：0xCD(get-input-type) 节流 / mesh/文字动画用
      e.nowMs = performance.now();
      // 门控：0x400（版权页动画等待）由渲染循环的时钟驱动放行
      if (e.waitFlags & 0x400) {
        if (native.sceneAnimationsDone()) {
          e.waitFlags &= ~0x400;
          waiting = false;
          trace('=== gate 0x400 cleared (scene anims done) ===');
        } else {
          if (!waiting) trace(`=== gate 0x400 WAIT (scene anims pending) steps=${steps} ===`);
          waiting = true;
        }
        native.present(); // 动画播放（每帧）
      } else if (e.waitFlags & SLEEP_GATE) {
        // sleep(0xC8) 门：持续 present 直到 nowMs >= sleepUntil 才放行（引擎帧让步 Sleep(n)ms / 帧率节流 n ms）。
        if (e.nowMs >= e.sleepUntil) {
          e.waitFlags &= ~SLEEP_GATE;
          sleeping = false;
          trace(`=== gate sleep cleared (t=${Math.round(e.nowMs)}ms) ===`);
        } else {
          if (!sleeping) trace(`=== gate sleep WAIT (until ${Math.round(e.sleepUntil)}ms) steps=${steps} ===`);
          sleeping = true;
        }
        native.present();
      } else if (pausedOp) {
        // 暂停态：VM 停在未知指令，等控制窗点「作为桩函数跳过」（或「重启」）。
        // 这里仍然 present（画面/时钟继续），只是不再推进 VM——保持窗口有响应。
        native.present();
      } else {
        for (let k = 0; k < SAFETY_PER_FRAME; k++) {
          const f = e.curScript();
          const name = f.name || status.scriptName;
          status.scriptName = name;
          status.ip = f.ip;
          status.steps = ++steps;
          if (!f.script || f.ip >= f.script.instructions.length) break;
          try {
            const t = await stepOnce(e);
            // 记录「已忽略/插桩跳过」(engine-internal) 与「用户跳过的未知指令」(user-stub) 指令：打印首个 + 计数。
            if (t.handlerKind === 'engine-internal') {
              const g = ignored.get(t.opcode);
              if (g) g.count++;
              else {
                ignored.set(t.opcode, { name: t.name, count: 1 });
                trace(`[ignored] ${t.name}`); // name 已是助记符（语义名或 iXXX），无需再补 opcode 数字
              }
            } else if (t.handlerKind === 'user-stub') {
              const g = skipped.get(t.opcode);
              if (g) g.count++;
            }
            // 指令日志：traceAll=全量打印（节流 ≥100ms 防爆炸）；否则默认只打印上面的「已忽略」信息。
            if (traceAll) {
              const stepNow = performance.now();
              if (stepNow - lastStepLog >= 100) {
                lastStepLog = stepNow;
                trace(
                  `step ${steps} ${t.name} op=0x${t.opcode.toString(16)} ip=${t.ip} kind=${t.handlerKind} script=${status.scriptName}`,
                );
              }
            }
          } catch (caught) {
            if (caught instanceof ScriptReset) {
              // native.log 已同时进 HUD+文件；不再另加一条 trace（避免同事件双行）。
              native.log('=== exit-script teardown (reset) ===');
              break outer;
            }
            if (caught instanceof ExitScript) {
              // abort(0x1)/程序退出：关闭主窗口（0x2 顶层 program-exit 亦走此）。
              native.log('=== abort/program exit -> close window ===');
              trace('=== abort/program exit ===');
              flushBatch();
              window.api?.closeWindow?.();
              break outer;
            }
            if (caught instanceof NotImplementedOp) {
              // 可恢复的硬停：stepOnce 未消费操作数、未推进 ip ⇒ 记下暂停点，
              // 等控制窗点「作为桩函数跳过」（→ onControlSkipOp 登记 e.unknownOpStubs）后从**同一条指令**重试。
              err = caught;
              pausedOp = {
                opcode: caught.opcode,
                name: caught.name,
                script: caught.scriptName,
                byteOffset: caught.byteOffset,
                instrIndex: caught.instrIndex,
              };
              native.log(`[pause] ${caught.message} —— 等待控制窗「作为桩函数跳过」`);
              trace(`=== PAUSE unknown opcode 0x${caught.opcode.toString(16)} (${caught.name}) ${caught.scriptName}@ip=${caught.instrIndex} ===`);
              notifyStatus(caught.message);
              flushBatch();
              break; // 退出本批指令，保留暂停态（外层循环继续 present / 收 skip 请求）
            }
            err = caught;
            const emsg = (caught as Error).message;
            native.log(`[error] ${emsg}`);
            // 其它硬错误（非「未知指令」）：立即上报控制窗展示，然后停
            notifyStatus(emsg);
            flushBatch();
            break outer;
          }
          if (e.waitFlags & (0x400 | SLEEP_GATE)) break; // 遇到门控（0x21C 置 0x400 / 0xC8 sleep 置 SLEEP_GATE），停这批
        }
        // 引擎式 present：场景脏/动画待播/刚命中门控时合成。若此批停在门控，由下轮门控分支持续 present。
        if (native.needsRender()) native.present();
      }

      // 诊断：节流打印 InputManager 实况（只报输入态，不再叠加 draw-item 概览——
      //   `[present ...] items={...}` 已每 500ms 报场景 item 摘要，避免同列表重复刷）。
      // 若要按 handle/坐标细看 hover 叠层，可临时调 native.debugDrawItems() 在此拼入。
      const nowMs = performance.now();
      if (nowMs - lastInputLog > 500) {
        lastInputLog = nowMs;
        const im = e.input;
        trace(
          `[input-state] hasCursor=${im.hasCursor ? 1 : 0} pos=(${im.readX()},${im.readY()}) ` +
            `moved=${im.mouseMoved ? 1 : 0} edge=0x${im.mouseEdge.toString(16)} btn=${im.readButtons()} ` +
            `wheel=${im.wheelDelta} ` +
            `mouseJump=0x${im.mouseJump.toString(16)} mouseSlot=0x${im.mouseSlot.toString(16)}`,
        );
      }
      // 节流向控制窗上报状态（当前 BIN + 已忽略/已跳过指令 + traceAll + 暂停点）
      if (nowMs - lastStatusSend > 500) {
        lastStatusSend = nowMs;
        notifyStatus();
      }
      flushBatch(); // 每帧末落盘一次（批量，避免逐行 IPC）
      // 让渲染帧循环跑（present/时钟），再继续；暂停态下同样在此让出（不空转），等待控制窗的 skip 请求。
      await nextFrame();
    }
    trace(`[boot] done script=${status.scriptName} ip=${status.ip} steps=${status.steps}`);
    flushBatch();
    native.drawHud();
    notifyStatus(); // 收尾上报：把最终态（含仍暂停的未知指令）给控制窗
    console.log(`[boot] done script=${status.scriptName} ip=${status.ip} steps=${status.steps}`);
    if (err) console.error(`[boot] ${(err as Error).message}`);
  } catch (caught) {
    const msg = `boot error: ${(caught as Error).message}`;
    native.log(msg);
    console.error(`[boot] ${msg}`);
    window.api?.sendRendererStatus?.({
      bin: status.scriptName,
      ignored: [],
      skipped: [],
      traceAll: false,
      error: msg,
    });
  }
}

main().catch((err) => {
  console.error(err);
  const body = document.body;
  if (body) body.textContent = `启动失败: ${(err as Error).message}`;
});
