/**
 * 窗口创建与"向窗口发消息"的薄封装。
 *
 * 两个窗口共用同一份 `preload.cjs`（`contextIsolation: true` / `nodeIntegration: false`），
 * 因此 API 面是**同一个** `window.api`；`sendToRenderer`/`sendToControl` 只是按窗口对象转发，
 * 不代表权限隔离（要做最小权限需要拆出两份 preload，见 README 的待办）。
 */
import { BrowserWindow, screen } from 'electron';
import { CONTROL_HTML, PRELOAD_PATH, RENDERER_HTML } from './paths.js';
import {
  computeEdgePosition,
  edgeFromEnv,
  TITLEBAR_PX,
  type WindowEdge,
} from '../src/arch/windowPlacement.js';

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

/**
 * 算当前位置（每次现算 —— `workArea` 会随 Dock/显示器变化）。
 */
function edgeTarget(win: BrowserWindow, size: { width: number; height: number }): { x: number; y: number; wa: Electron.Rectangle } {
  const wa = screen.getPrimaryDisplay().workArea;
  const b = win.getBounds();
  return { ...computeEdgePosition(wa, { width: b.width || size.width, height: b.height || size.height }, WINDOW_EDGE!), wa };
}

/**
 * 贴边档的收尾：摆到边缘 + 不抢焦点地显示。非贴边档不做任何事（用构造函数默认的显示行为）。
 *
 * ★★**必须"先显示、再摆位"，并在显示后再摆一次**（`tickets/T-0040` 的 macOS 订正）：
 * 实测（macOS 26，workArea `1728x1084@(0,33)`，窗口 1280x752）：
 * ```
 * 期望 pos = (224, 1085)                     ← 只留 32px 可见
 * 隐藏时 setPosition + showInactive ⇒ 实际 (224, 365)   ← ★没生效（用的是居中 y）
 * 显示后再 setPosition(224,1085)   ⇒ 实际 (224, 1085)   ← 立刻生效，且 1.2s 后仍是
 * ```
 * ⇒ 不是坐标系算错，而是**时序**：macOS 会**丢弃隐藏窗口上的 `setPosition`**。
 * 旧实现只做了"隐藏时摆位 + showInactive" ⇒ Windows 上碰巧生效、**macOS 上贴边完全失效**
 * （用户实测："只在 Windows 可用，Mac 上依然在屏幕内"）。
 */
function applyEdge(win: BrowserWindow, size: { width: number; height: number }): void {
  if (WINDOW_EDGE === null) return;
  const first = edgeTarget(win, size);
  // ① 先摆一次：Windows 上这一步就够，且能避免"先在中间闪一下"
  win.setPosition(first.x, first.y);
  win.showInactive(); // ★不抢焦点：测试不该打断用户
  // ② 显示之后再摆一次（macOS 必需；见上）。下一 tick 再确认一次，防平台异步纠正位置。
  const reapply = (): { x: number; y: number; wa: Electron.Rectangle } => {
    const t = edgeTarget(win, size);
    win.setPosition(t.x, t.y);
    return t;
  };
  reapply();
  setImmediate(reapply);
  // 只在首次给一点延迟兜底（不订阅 'move' —— 那会把用户手动挪窗也拽回来）。
  // ★日志只打**最终那次**：早先每摆一次打一条，实测刷了三遍同样的行（噪音）。
  setTimeout(() => {
    if (win.isDestroyed()) return;
    const t = reapply();
    console.log(
      `[window] 贴边档=${WINDOW_EDGE} 位置=(${t.x},${t.y}) 可用区=${t.wa.width}x${t.wa.height}@(${t.wa.x},${t.wa.y}) ` +
        `窗口实际=${JSON.stringify(win.getBounds())}（只留 ${Math.min(TITLEBAR_PX, size.height)}px 可见；showInactive 不抢焦点）`,
    );
  }, 300);
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
