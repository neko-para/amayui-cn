/**
 * `host_input` 的类型声明（给 TS 调用方；运行时实现在 `index.js` + 编译出的 `.node`）。
 *
 * ★口径：**任何函数都可能在"没加载上 / 本平台没有实现"时返回 `null`/`false`**，调用方不得假定成功。
 * ★坐标系（跨平台同名 API 的**唯一**差别）：Win32 = **物理像素**（主进程还要做 DIP→物理）；
 *   macOS = **点**（= Electron 的 DIP，主进程不做那一跳）。见 `electron/nativeAddon.ts`。
 * ★平台专有函数只在自己平台注册，别的平台上不存在 —— 门面统一退化成 `null`/`false`，调用方不必分平台。
 */

/** 屏幕坐标点。 */
export interface Point {
  x: number;
  y: number;
}

export interface VirtualScreenRect extends Point {
  width: number;
  height: number;
}

export interface HostInputAddon {
  /** `'win32' | 'darwin' | 'linux' | 'unknown'`。 */
  readonly platform: string;
  /** 本平台是否真有实现（不支持的平台的 .node 能加载，但函数一律返回 null/false）。 */
  readonly supported: boolean;

  // ---- 跨平台（两平台同名同义） ----
  /** `GetCursorPos` / `CGEventGetLocation`。 */
  getCursorPos(): Point | null;
  /**
   * 把真实系统光标挪过去。= 引擎 `0x10A`（`sub_421EA0` 的 `SetCursorPos`）的宿主侧动作。
   *
   * | 平台 | 实现 | 参数单位 | 授权 |
   * |---|---|---|---|
   * | win32 | `SetCursorPos` | 物理像素 | — |
   * | darwin | `CGWarpMouseCursorPosition` + 复位 mouse/cursor 关联 | 点 | 不需要辅助功能 |
   */
  setCursorPos(x: number, y: number): boolean;
  /** 多显示器**并集**矩形（`SM_*VIRTUALSCREEN` / `CGGetActiveDisplayList` + `CGDisplayBounds`）。 */
  getVirtualScreenRect(): VirtualScreenRect | null;

  // ---- win32 专有（darwin 上不存在） ----
  /** `GetSystemMetrics(index)`（`SM_*` 常量，物理像素）。 */
  getSystemMetrics(index: number): number | null;
  /** `GetAsyncKeyState(vk)` 的 **SHORT**（bit15 = 当前按下）。 */
  getAsyncKeyState(vk: number): number | null;
  /** `ShowCursor(show)` → 调用后的显示计数。 */
  showCursor(show: boolean): number | null;

  // ---- darwin 专有（win32 上不存在） ----
  /**
   * cliclick 的 `m:` 口径：合成 `kCGEventMouseMoved` 投到 HID 事件流。
   * **返回值 = 有没有辅助功能授权**（`CGEventPost` 未授权时事件被静默丢弃）。
   */
  postMouseMove(x: number, y: number): boolean;
  /** `AXIsProcessTrusted()`：只有 `postMouseMove` 那条路需要它为真。 */
  isAccessibilityTrusted(): boolean;
}

export interface HostInput extends HostInputAddon {
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
    api: HostInputAddon | null;
    tried: string[];
  };
  /** @internal 候选路径（顺序即优先级）。 */
  _candidatePaths(opts?: { root?: string; env?: Record<string, string | undefined>; platform?: string; arch?: string }): string[];
  /** @internal 用给定的原生层对象造门面（守卫用它断言"不可用时全 null/false 且不抛"）。 */
  _makeFacade(api: HostInputAddon | null): Omit<
    HostInput,
    'available' | 'supported' | 'reason' | 'addonPath' | 'platform' | 'arch' | '_loadAddon' | '_candidatePaths' | '_makeFacade'
  >;
}

declare const hostInput: HostInput;
export default hostInput;
