/**
 * Renderer 入口：宿主画布 + VM（与 run.ts 同流程，但 native 换成 Pixi 后端、FileSource 换成 IPC）。
 * Plan A：渲染帧循环（Pixi ticker）独立跑 present（推进时钟、合成场景图），VM 在其间按"门控"推进——
 *         无门控时每帧跑一批指令（引擎在无门控时快速跑到门控）；遇 0x400 动画等待则停住，由渲染循环放行。
 */
import { Engine, SLEEP_GATE } from '../vm/engine.js';
import { loadScriptData, stepOnce } from '../vm/interpreter.js';
import { ScriptReset } from '../vm/ops.js';
import { InputManager } from '../vm/input.js';
import { IpcFileSource } from './ipcFileSource.js';
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
    native.startFrameLoop(); // 渲染帧循环：每帧 present + HUD（推进时钟、合成场景图）

    let steps = 0;
    let reachedTitle = false; // 打过一个「>> 到达 <TITLE 脚本名>」标记（一次性）
    let interactive = false; // 已注册用户输入(mouse-callback 0xCC) → 交互态：逐条 step 降为节流
    let lastStepLog = 0; // 节流：交互态下 step trace 的最小间隔(ms)
    let waiting = false;
    let sleeping = false;
    let err: unknown = null;
    let lastInputLog = 0; // 节流：[input-state] 诊断打印

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
      } else {
        for (let k = 0; k < SAFETY_PER_FRAME; k++) {
          const f = e.curScript();
          const name = f.name || status.scriptName;
          status.scriptName = name;
          status.ip = f.ip;
          status.steps = ++steps;
          if (/^TITLE/i.test(name)) {
            if (!reachedTitle) {
              reachedTitle = true;
              native.log(`>> 到达 ${name}`);
            }
          }
          if (!f.script || f.ip >= f.script.instructions.length) break;
          try {
            const t = await stepOnce(e);
            // step trace 策略：boot/非交互态逐条记；一旦注册用户输入(mouse-callback 0xCC)进入交互态，
            // 交互循环每帧刷步 → 改为节流打印（≥100ms 一条）避免日志爆炸。
            // 之前用 /^TITLE/i.test(name) 硬编码「到达 TITLE 后杀步」，现改为通用的「已注册用户输入」判定。
            if (t.opcode === 0xcc) interactive = true;
            const stepNow = performance.now();
            if (!interactive || stepNow - lastStepLog >= 100) {
              lastStepLog = stepNow;
              trace(
                `step ${steps} ${t.name} op=0x${t.opcode.toString(16)} ip=${t.ip} kind=${t.handlerKind} script=${status.scriptName}`,
              );
            }
          } catch (caught) {
            if (caught instanceof ScriptReset) {
              // native.log 已同时进 HUD+文件；不再另加一条 trace（避免同事件双行）。
              native.log('=== exit-script teardown (reset) ===');
              break outer;
            }
            err = caught;
            native.log(`[error] ${(caught as Error).message}`);
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
            `mouseJump=0x${im.mouseJump.toString(16)} mouseSlot=0x${im.mouseSlot.toString(16)}`,
        );
      }
      flushBatch(); // 每帧末落盘一次（批量，避免逐行 IPC）
      await nextFrame(); // 让渲染帧循环跑（present/时钟），再继续
    }
    trace(`[boot] done script=${status.scriptName} ip=${status.ip} steps=${status.steps} reachedTitle=${reachedTitle}`);
    flushBatch();
    native.drawHud();
    console.log(`[boot] done script=${status.scriptName} ip=${status.ip} steps=${status.steps} reachedTitle=${reachedTitle}`);
    if (err) console.error(`[boot] ${(err as Error).message}`);
  } catch (caught) {
    const msg = `boot error: ${(caught as Error).message}`;
    native.log(msg);
    native.drawHud();
    console.error(`[boot] ${msg}`);
  }
}

main().catch((err) => {
  console.error(err);
  const body = document.body;
  if (body) body.textContent = `启动失败: ${(err as Error).message}`;
});
