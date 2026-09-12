/**
 * Electron 主进程（渲染壳）—— 只负责**生命周期与装配**。
 *
 * 职责分工：
 *  - `paths.ts`  安装布局知识（仓库根 / 资源目录 / 玩家数据的 base+overlay / 日志）；
 *  - `logging.ts` 诊断落盘（异步流 + 关窗同步兜底）；
 *  - `windows.ts` 两个窗口的创建与消息转发；
 *  - `ipc/files.ts`   资源读取（脚本 / 文件 / 配置 / 图像 AGF 解码 / SAVE.DAT）；
 *  - `ipc/control.ts` 控制面（重启 / 关窗 / 强制关闭 / trace / 桩跳过 / 状态转发）。
 *
 * 本文件不再直接写文件、不解析路径、不内联 IPC 处理器。
 */
import { app, BrowserWindow } from 'electron';
import { initLogFile, registerLogIpc } from './logging.js';
import { logSystemPaths, registerAudioProtocol, registerAudioScheme, registerFileIpc } from './ipc/files.js';
import { registerControlIpc } from './ipc/control.js';
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

  windows.createGame();
  windows.createControl();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createGame();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
