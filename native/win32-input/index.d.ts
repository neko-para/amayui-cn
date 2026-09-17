/**
 * `win32_input` 的类型声明（给 TS 调用方；运行时实现在 `index.js` + 编译出的 `.node`）。
 *
 * ★口径：**任何函数都可能在"没加载上/非 Windows"时返回 `null`/`false`**，调用方不得假定成功。
 */

/** 屏幕坐标点（**物理像素**，Win32 语义）。 */
export interface Point {
  x: number;
  y: number;
}

export interface VirtualScreenRect extends Point {
  width: number;
  height: number;
}

export interface Win32InputAddon {
  /** `'win32' | 'darwin' | 'linux' | 'unknown'`。 */
  readonly platform: string;
  /** 本平台是否真有实现（非 Windows 的 .node 能加载，但函数一律返回 null/false）。 */
  readonly supported: boolean;
  /** `GetCursorPos`。 */
  getCursorPos(): Point | null;
  /**
   * `SetCursorPos`（**物理屏幕像素**）。= 引擎 `0x10A`（`sub_421EA0`）的宿主侧动作。
   *
   * DIP ↔ 物理的换算**不在这里**：Electron 的 `screen.dipToScreenPoint()` 按显示器缩放算好了再传进来。
   */
  setCursorPos(x: number, y: number): boolean;
  /** 多显示器**并集**矩形（`SM_*VIRTUALSCREEN`）。 */
  getVirtualScreenRect(): VirtualScreenRect | null;
  /** `GetSystemMetrics(index)`（`SM_*` 常量）。 */
  getSystemMetrics(index: number): number | null;
  /** `GetAsyncKeyState(vk)` 的 **SHORT**（bit15 = 当前按下）。 */
  getAsyncKeyState(vk: number): number | null;
  /** `ShowCursor(show)` → 调用后的显示计数。 */
  showCursor(show: boolean): number | null;
}

export interface Win32Input extends Win32InputAddon {
  /** `.node` 是否加载成功（false ⇒ 上面这些函数都是安全空实现）。 */
  readonly available: boolean;
  /** 没加载上的原因（一行诊断）；可用时为空串。 */
  readonly reason: string;
  /** 实际加载到的 `.node` 绝对路径。 */
  readonly addonPath: string | null;
  readonly arch: string;
  /** @internal 守卫测试用的加载器（不属于对外契约）。 */
  _loadAddon(opts?: { root?: string; env?: Record<string, string | undefined> }): {
    available: boolean;
    reason: string;
    addonPath: string | null;
    api: Win32InputAddon | null;
    tried: string[];
  };
  /** @internal 候选路径（顺序即优先级）。 */
  _candidatePaths(opts?: { root?: string; env?: Record<string, string | undefined>; platform?: string; arch?: string }): string[];
}

declare const win32Input: Win32Input;
export default win32Input;
