/**
 * **渲染进程启动装配**：把 Engine / 渲染后端 / 文件代理 / 日志通道 / 配置 / 首个脚本 拼起来。
 *
 * 与 `renderer.ts` 的分工：本模块只负责"装好并返回可运行的对象图"，
 * `session.ts` 负责"跑起来"。这样启动链（易变：预载清单、配置来源）与主循环（门控状态机）
 * 可以各自演化，也让 `renderer.ts` 回到"入口 = 两行"的形态。
 */
import { Engine } from '../../vm/engine.js';
import { loadScriptData } from '../../vm/interpreter.js';
import { DropRecorder, withNativeTap } from '../../vm/nativeTap.js';
import { audioBootIntents } from '../../vm/handlers/audio.js';
import { InputManager } from '../../vm/input.js';
import type { FileSource } from '../../arch/fileSource.js';
import { IpcFileSource } from '../ipcFileSource.js';
import { PixiBackend } from '../pixiBackend.js';
import type { RenderStatus } from '../renderStatus.js';
import { TraceLog } from './traceLog.js';
import { loadEngineConfig } from './configBoot.js';

/** 启动时固定预载的图像（引擎启动流程里会立刻用到的那几张）。 */
const PRELOAD_IMAGES = [0x5245, 0x5246, 0x5272, 0x5273];

export interface BootedApp {
  status: RenderStatus;
  traceLog: TraceLog;
  input: InputManager;
  /** 未被 Proxy 包装的渲染后端（`preloadImage`/`present` 等后端专有方法走它）。 */
  pixi: PixiBackend;
  /** 经「闸门 A」包装后的 native：未被宿主实现的方法会留痕而不是静默 no-op。 */
  native: PixiBackend;
  drops: DropRecorder;
  src: FileSource;
  e: Engine;
}

/**
 * 装配并启动应用。返回 `null` 表示"首个脚本装载失败"——此时窗口已经起来了、
 * 失败原因也进了日志通道，入口只需安静收场（与原实现一致）。
 */
export async function bootApp(): Promise<BootedApp | null> {
  const status: RenderStatus = { scriptName: '…', ip: 0, steps: 0, log: [], trace: [] };
  const traceLog = new TraceLog(status);
  traceLog.attachUnloadHooks();

  const input = new InputManager(); // 共享输入状态（渲染器写 / VM 读）
  const pixi = await PixiBackend.create(status, input); // WebGL 渲染后端（PixiJS v8）
  const src = new IpcFileSource();
  // ★闸门 A：把"宿主没实现的 native 调用"从静默 no-op 变成可数事件（归因到当前 opcode）。
  // 这里用可变引用而不是直接闭包捕获 `e`：`e` 需要 native 才能构造，构造顺序上晚一步。
  const engineRef: { e?: Engine } = {};
  const drops = new DropRecorder(() => engineRef.e?.currentOpcode ?? 0);
  const native = withNativeTap(pixi as object, drops) as PixiBackend;
  const e = new Engine(native, input);
  engineRef.e = e;
  e.fileSource = src;

  traceLog.line('=== amayui emulator boot ===');

  await loadEngineConfig(e, (l) => traceLog.line(l));

  // ★启动时把 SYS4REG.INI 里的声音设置灌进音频引擎（引擎 raw 23696-23721 的等价物）：
  //   音量/开关是玩家配置的一部分，脚本只在**改设置**时才发 0xC6 —— 漏掉这一步 ⇒ "每次启动都巨响"。
  for (const intent of audioBootIntents(e.config)) pixi.audio(intent);

  for (const imgid of PRELOAD_IMAGES) {
    // preloadImage 内部已 pushLog `image <imgid> -> <file> (WxH)`，无需再 trace 一条重复的 [preload]
    await native.preloadImage(imgid);
  }

  const boot = await src.readScript(0);
  if (!boot) {
    native.log('无法装载 index 0 (SYSTEM4.BIN)');
    native.unhandled(0, 'boot-fail: no script 0');
    return null;
  }
  status.scriptName = boot.name;
  loadScriptData(e, boot.data, boot.name);
  native.startFrameLoop(); // 渲染帧循环：每帧 present（推进时钟、合成场景图）。HUD 已移除，诊断信息在控制窗。

  return { status, traceLog, input, pixi, native, drops, src, e };
}
