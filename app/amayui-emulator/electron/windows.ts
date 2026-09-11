/**
 * 窗口创建与"向窗口发消息"的薄封装。
 *
 * 两个窗口共用同一份 `preload.cjs`（`contextIsolation: true` / `nodeIntegration: false`），
 * 因此 API 面是**同一个** `window.api`；`sendToRenderer`/`sendToControl` 只是按窗口对象转发，
 * 不代表权限隔离（要做最小权限需要拆出两份 preload，见 README 的待办）。
 */
import { BrowserWindow } from 'electron';
import { CONTROL_HTML, PRELOAD_PATH, RENDERER_HTML } from './paths.js';

/** 两个窗口共用的安全设置。 */
function baseWebPreferences(): Electron.WebPreferences {
  return {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
  };
}

export class Windows {
  game: BrowserWindow | null = null;
  control: BrowserWindow | null = null;

  /**
   * 主窗口：内容区 1280×720（= 渲染视口，与 Pixi 画布同尺寸）。
   * `useContentSize` 在 Windows DPI 缩放下可能不准（electron#10659），故显式 `setContentSize`。
   */
  createGame(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1280,
      height: 720,
      useContentSize: true,
      title: '天結いキャッスルマイスター',
      backgroundColor: '#000000',
      resizable: false,
      webPreferences: baseWebPreferences(),
    });
    win.loadFile(RENDERER_HTML);
    win.setContentSize(1280, 720);
    win.on('closed', () => {
      this.game = null;
    });
    this.game = win;
    return win;
  }

  /** 控制窗：启动即打开的小窗，提供重启/日志开关/状态展示。 */
  createControl(): BrowserWindow {
    const win = new BrowserWindow({
      width: 500,
      height: 720, // 容纳「未知指令 → 作为桩函数跳过」块 + 已跳过/已忽略两个清单
      title: 'amayui-emulator 控制',
      backgroundColor: '#1e1e1e',
      resizable: true,
      webPreferences: baseWebPreferences(),
    });
    win.loadFile(CONTROL_HTML);
    win.on('closed', () => {
      this.control = null;
    });
    this.control = win;
    return win;
  }

  /** 向渲染窗发消息（窗口不存在/已销毁则静默忽略）。 */
  sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.game && !this.game.isDestroyed()) this.game.webContents.send(channel, ...args);
  }

  /** 向控制窗发消息（窗口不存在/已销毁则静默忽略）。 */
  sendToControl(channel: string, ...args: unknown[]): void {
    if (this.control && !this.control.isDestroyed()) this.control.webContents.send(channel, ...args);
  }

  /** 主窗口是否可用（用于"重启"分支判断）。 */
  hasGame(): boolean {
    return this.game !== null && !this.game.isDestroyed();
  }
}

/** 进程内单例（IPC 处理器与 main.ts 共享同一份窗口引用）。 */
export const windows = new Windows();
