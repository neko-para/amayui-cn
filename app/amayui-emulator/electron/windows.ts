/**
 * 窗口创建与"向窗口发消息"的薄封装。
 *
 * 两个窗口共用同一份 `preload.cjs`（`contextIsolation: true` / `nodeIntegration: false`），
 * 因此 API 面是**同一个** `window.api`；`sendToRenderer`/`sendToControl` 只是按窗口对象转发，
 * 不代表权限隔离（要做最小权限需要拆出两份 preload，见 README 的待办）。
 */
import { BrowserWindow, screen } from 'electron';
import { CONTROL_HTML, PRELOAD_PATH, RENDERER_HTML } from './paths.js';
import { computeEdgePosition, edgeFromEnv, type WindowEdge } from '../src/arch/windowPlacement.js';

/**
 * **测试期"贴边开窗"档**（`tickets/T-0040`，用户要求）：跑 E4 截图/录制时窗口别每次都弹到屏幕正中
 * 抢焦点、反复打断手头的事。`AMAYUI_WINDOW_EDGE=1`（或 `bottom`/`top`/`left`/`right`）打开；
 * 空/`0`/`off` ⇒ 保持原来的"居中弹出"。测试脚本（`tools/shot.cjs` / `tools/record.cjs`）默认打开它，
 * 加 `--centered` 可单次关掉。
 *
 * 打开时的行为：位置 = `computeEdgePosition(workArea, size, edge)`（只留 `TITLEBAR_PX` 可见）、
 * `skipTaskbar`（不占任务栏）、`showInactive()`（显示但**不抢焦点**）。
 */
const WINDOW_EDGE: WindowEdge | null = edgeFromEnv(process.env);

/** 创建窗口时的附加选项（贴边档才加；避免"先在中间闪一下再挪走"）。 */
function edgeOptions(): Electron.BrowserWindowConstructorOptions {
  return WINDOW_EDGE === null ? {} : { show: false, skipTaskbar: true };
}

/** 贴边档的收尾：摆到边缘 + 不抢焦点地显示。非贴边档不做任何事（用构造函数默认的显示行为）。 */
function applyEdge(win: BrowserWindow, size: { width: number; height: number }): void {
  if (WINDOW_EDGE === null) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = computeEdgePosition(wa, size, WINDOW_EDGE);
  win.setPosition(pos.x, pos.y);
  win.showInactive(); // ★不抢焦点：测试不该打断用户
  console.log(
    `[window] 贴边档=${WINDOW_EDGE} 位置=(${pos.x},${pos.y}) 可用区=${wa.width}x${wa.height}@(${wa.x},${wa.y}) ` +
      `窗口=${size.width}x${size.height}（只留 ${Math.min(32, size.height)}px 可见；showInactive 不抢焦点）`,
  );
}

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
      ...edgeOptions(),
    });
    win.loadFile(RENDERER_HTML);
    win.setContentSize(1280, 720);
    applyEdge(win, { width: 1280, height: 720 });
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
      ...edgeOptions(),
    });
    win.loadFile(CONTROL_HTML);
    applyEdge(win, { width: 500, height: 720 });
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
