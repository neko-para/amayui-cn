/**
 * Electron 主进程（渲染壳）—— 只负责**生命周期与装配**。
 *
 * 职责分工：
 *  - `paths.ts`  安装布局知识（仓库根 / raw / 日志 / INI 候选）；
 *  - `logging.ts` 诊断落盘（异步流 + 关窗同步兜底）；
 *  - `windows.ts` 两个窗口的创建与消息转发；
 *  - `ipc/files.ts`   资源读取（脚本 / 文件 / 配置 / 图像 AGF 解码）；
 *  - `ipc/control.ts` 控制面（重启 / 关窗 / 强制关闭 / trace / 桩跳过 / 状态转发）。
 *
 * 本文件不再直接写文件、不解析路径、不内联 IPC 处理器。
 */
import { app, BrowserWindow } from 'electron';
import { initLogFile, registerLogIpc } from './logging.js';
import { registerFileIpc } from './ipc/files.js';
import { registerControlIpc } from './ipc/control.js';
import { windows } from './windows.js';

app.whenReady().then(() => {
  initLogFile();
  registerFileIpc();
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
