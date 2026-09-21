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
import { loadEmulatorOptionsFile, loadEngineConfig } from './configBoot.js';

/**
 * ★**启动期预载清单已删**（`tickets/T-0029`）：这里曾有
 * `const PRELOAD_IMAGES = [0x5245, 0x5246, 0x5272, 0x5273]`（SO006/SO005/SO004/SO004A）。
 * 删除理由（逐条）：
 *  - **没有引擎依据**：引擎启动流程里没有这份清单；图像的正统路径是脚本 `0x1F9 set-texture` →
 *    `PixiBackend.bindTexture` → `TextureCache.bind`（未命中即异步装载）→ 帧末 `texturesIdle` 屏障；
 *  - **两宿主漂移**：headless（`bootHeadless`/两份 chain/scenario）从不预载，只有 Electron 预载
 *    ⇒ 同一份脚本在两边的"图文就绪时机"不同（`T-0002` 那类宿主漂移的温床）；
 *  - **掩盖缺陷**：预载会把"异步装载 ⇒ 紧随的 `0x208` 读到 0×0"（`texture-bind-synchronous-then-query`）
 *    盖住 —— 去掉它才看得见哪一处没走屏障。
 *  若将来发现某张图确实"绑定前就要用"，**登记进 `analysis/engine-capabilities.json`**，
 *  而不是把硬编码清单加回这里。
 */

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
  // ★Live2D 运行态（T-0054）：槽/节点/动作三张表在 Engine 上，挂给场景宿主以便
  //   ① 帧末推进动作（scL2dTick，两宿主同一份）；② 快照能导出节点与出画判据。
  pixi.attachL2dHost(e);

  traceLog.line('=== amayui emulator boot ===');

  await loadEngineConfig(e, (l) => traceLog.line(l));
  // ★外置选项（`emulator.config.json`）：目前只有 `boot.showLogo`。必须在 `loadScriptData`（下面 :87）之前
  //   —— SYSTEM4 的 `load-show-logo` 在脚本开头就据 `_this[96983]` 决定是否 `call-script LOGO`。
  await loadEmulatorOptionsFile(e, (l) => traceLog.line(l));

  // ★音乐表（SYS4INI 尾部）：`play-bgm` 的曲号解析 + 扩展包用 0x1D7/0x1D8 登记自己的曲子都靠它。
  //   引擎侧由 SYS4INI 装载流程 `sub_48A0D0` 填进 PCM 对象；取不到就留空表（0x1D8 会返回 -1）。
  try {
    const music = await window.api?.musicTable?.();
    if (music) e.musicTable = { other: music.other, base: music.base, groups: [] };
    traceLog.line(`[music] 曲号表 ${e.musicTable.base.length} 条（other ${e.musicTable.other.length} 条）`);
  } catch (err) {
    traceLog.line(`[music] 曲号表取得失败：${(err as Error).message}`);
  }

  // ★启动时把 SYS4REG.INI 里的声音设置灌进音频引擎（引擎 raw 23696-23721 的等价物）：
  //   音量/开关是玩家配置的一部分，脚本只在**改设置**时才发 0xC6 —— 漏掉这一步 ⇒ "每次启动都巨响"。
  for (const intent of audioBootIntents(e.config)) pixi.audio(intent);

  // ★★**启动期预载清单已删**（`tickets/T-0029`）：这里原先硬编码
  //   `const PRELOAD_IMAGES = [0x5245, 0x5246, 0x5272, 0x5273]` 并逐张 `await native.preloadImage(...)`。
  //   它没有任何引擎依据（引擎启动流程里没有这份清单；图本来就是脚本 `0x1F9 set-texture` 绑定时按需装的），
  //   而且制造三处漂移：
  //     ① 第二套加载入口 —— 与 `TextureCache.bind` 的按需路径各写一遍"谁在什么时候加载"；
  //     ② 两宿主不一致 —— headless（bootHeadless / 两份 chain / scenario）从来不预载，只有 Electron 预载；
  //     ③ 白付启动成本 + **掩盖真实缺陷** —— 预载在时看不出"异步装载 ⇒ 紧随的 `0x208` 读到 0×0"，
  //        去掉它才会暴露"哪一处没走纹理帧屏障"（`TextureCache.waitIdle` / `PixiBackend.texturesIdle`）。
  //   ⇒ 现在这 4 张图和其它图一样在 `0x1F9` 绑定时装载；首帧不缺图**由帧屏障保证**，不靠预载掩盖。

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