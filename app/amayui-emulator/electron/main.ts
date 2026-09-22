/**
 * Electron 主进程（渲染壳）—— 只负责**生命周期与装配**。
 *
 * 职责分工：
 *  - `paths.ts`  安装布局知识（仓库根 / 资源目录 / 玩家数据的 base+overlay / 日志）；
 *  - `logging.ts` 诊断落盘（异步流 + 关窗同步兜底）；
 *  - `windows.ts` 两个窗口的创建与消息转发；
 *  - `ipc/files.ts`   资源读取（脚本 / 文件 / 配置 / 图像 AGF 解码 / SAVE.DAT）；
 *  - `ipc/control.ts` 控制面（重启 / 关窗 / 强制关闭 / trace / 桩跳过 / 状态转发）；
 *  - `nativeAddon.ts` **宿主侧原生能力**（`native/host-input`：真移动系统光标，引擎 `0x10A`）。
 *
 * 本文件不再直接写文件、不解析路径、不内联 IPC 处理器。
 */
import { app, BrowserWindow } from 'electron';
import { initLogFile, registerLogIpc } from './logging.js';
import { logSystemPaths, registerAudioProtocol, registerAudioScheme, registerFileIpc } from './ipc/files.js';
import { registerControlIpc } from './ipc/control.js';
import { initNativeAddon, registerNativeIpc } from './nativeAddon.js';
import { windows } from './windows.js';

// ★音频：必须在 app ready **之前**做两件事
//  1) 关闭"必须先有用户手势"的自动播放策略（否则 AudioContext 永远 suspended ⇒ 全程静音）；
//  2) 注册 `amayui-audio://` 特权 scheme（BGM 流式播放 + Range；见 docs/13-audio-plan.md §3.3）。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
registerAudioScheme();

app.whenReady().then(() => {
  initLogFile();
  logSystemPaths();
  registerFileIpc();
  registerAudioProtocol();
  registerLogIpc();
  registerControlIpc();
  // ★原生能力（`native/host-input`）：必须在 `registerLogIpc()` **之后** —— 它的一行状态诊断要写进
  //   同一个日志文件（在那之前 logAppender 是空实现）。缺模块时它自己降级，不影响启动。
  initNativeAddon();
  registerNativeIpc();

  windows.createGame();
  windows.createControl();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createGame();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * ★**供外部脚本复用主进程产物**（`tickets/T-0114` 的 adb 式调试服务器 `tools/debugsrv.cjs`）：
 * 那些脚本 `require('../dist/electron/main.cjs')` 后要拿到**同一个** `windows` 单例与调试发送函数。
 *
 * 为什么必须从这里导出、而不是另打一个 `windows.cjs`：
 * `windows` 是**单例**（持有 game/control 两个 BrowserWindow）。若再打一份 bundle，
 * 那份会拿到**另一个** `windows` 实例 ⇒ `windows.game` 为 null、`sendToRenderer` 发到空处。
 * 从同一个 bundle 导出就没有这个问题。
 */
export { windows } from './windows.js';
export { sendBreakCommand, sendDebugQuery } from './ipc/control.js';
export { app as _electronApp } from 'electron';
