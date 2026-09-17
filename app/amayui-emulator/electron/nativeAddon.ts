/**
 * **主进程侧的原生能力桥**（`native/win32-input`）：把引擎 `0x10A` 的宿主侧动作做到位 ——
 * 真的把系统光标挪过去（`SetCursorPos`），而不是只改引擎侧坐标。
 *
 * ## 为什么在主进程
 *
 * 渲染进程**没有 Node 集成**（`src/renderer/**` 跑在沙箱里，连 `Buffer` 都不能用 —— 见
 * `tickets/T-0054` 的"渲染器安全"棘轮），所以 `.node` 只能在主进程 `require`；
 * 渲染进程通过 `set-system-cursor` 这条 IPC 把**客户区坐标**交过来。
 *
 * ## 坐标换算（三跳，缺一不可）
 *
 * ```
 * 引擎虚拟坐标 (1280×720)        ← 0x10A 的操作数（宿主缝 setSystemCursor(x, y) 收到的就是它）
 *   ↓ 渲染进程：canvas.getBoundingClientRect()（`pixi/inputAttach.ts` 的 toVirtual 的逆）
 * 客户区 CSS 像素 (clientX, clientY)  ← IPC 传的就是这个
 *   ↓ 主进程：BrowserWindow.getContentBounds()（**DIP** 屏幕坐标）
 * 屏幕 DIP 坐标
 *   ↓ 主进程：screen.dipToScreenPoint()（Windows 专用；按显示器缩放算）
 * 屏幕**物理**像素                    ← 原生模块 setCursorPos 要的就是这个
 * ```
 *
 * ★为什么最后一跳不能省：`SetCursorPos` 是 Win32 原语，吃**物理像素**；Electron 的
 * `screen`/`getContentBounds()` 一律给 **DIP**。缩放 ≡ 100% 时两者相等 ⇒ 省掉它在本机看不出问题，
 * 换台 125%/150% 的机器光标就会挪到偏左上角的地方（`tickets/T-0053` 的验收里专门写了这条）。
 *
 * ## 降级
 *
 * 原生模块**可能不存在**（没构建 / 非 Windows / 将来打包漏了）⇒ 这里只记一行诊断、`setSystemCursor`
 * 退化成空操作：**引擎侧坐标照旧生效**（脚本逻辑正确），只是玩家看不见光标被挪过去 —— 也就是
 * 这条能力接入之前的旧行为。降级不用调用方写任何分支。
 */
import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import { REPO_ROOT } from './paths.js';
import { logMainLine } from './logging.js';

/** 原生模块的公共门面（`native/win32-input/index.js` 导出的对象；`available === false` 时全函数空实现）。 */
interface Win32Input {
  available: boolean;
  supported: boolean;
  reason: string;
  addonPath: string | null;
  setCursorPos(x: number, y: number): boolean;
  getCursorPos(): { x: number; y: number } | null;
}

/** `native/win32-input` 的加载结果（进程内只加载一次）。 */
let w32: Win32Input | null = null;
/** 已经记过降级诊断 ⇒ 不刷屏（`i10a` 全库 1678 处）。 */
let warned = false;
/** `[native] warp` 诊断的节流（同一条相邻 warp 不重复记；`0x10A` 可能被脚本密集调用）。 */
let lastWarpLog = 0;
let lastWarp: { x: number; y: number } | null = null;

/**
 * 载入原生模块（**唯一**加载点；失败不抛）。
 *
 * 路径：`<repo>/native/win32-input`（`REPO_ROOT` 见 `paths.ts`）。加载器本身还会按
 * `AMAYUI_WIN32_INPUT_NODE` → `build/Release` → `build/<Config>` → `prebuilds/` 找 `.node`
 * （将来打包成 asar 时用环境变量指到 `app.asar.unpacked` 即可）。
 */
function loadWin32Input(): Win32Input | null {
  const entry = path.join(REPO_ROOT, 'native', 'win32-input', 'index.js');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(entry) as Win32Input;
    return mod;
  } catch (err) {
    logMainLine(`[native] 载入 ${entry} 失败：${(err as Error).message}`);
    return null;
  }
}

/** 启动时调用一次：加载 + 打印一行状态（这是排"光标怎么不动"的第一现场）。 */
export function initNativeAddon(): void {
  w32 = loadWin32Input();
  if (!w32) {
    logMainLine('[native] 未接入 win32-input（模块缺失）⇒ 0x10A 只改引擎侧光标');
    return;
  }
  logMainLine(
    `[native] win32-input available=${w32.available} supported=${w32.supported}` +
      `${w32.addonPath ? ` path=${w32.addonPath}` : ''}${w32.reason ? ` reason=${w32.reason}` : ''}`,
  );
}

/**
 * 注册 `set-system-cursor` 通道（渲染进程 `window.api.setSystemCursor(clientX, clientY)`）。
 *
 * 参数是**客户区 CSS 像素**（渲染侧已把虚拟坐标换算过来）；这里补上窗口内容区原点再做 DIP→物理。
 */
export function registerNativeIpc(): void {
  ipcMain.on('set-system-cursor', (e, clientX: number, clientY: number) => {
    if (!w32 || !w32.supported) {
      if (!warned) {
        warned = true;
        logMainLine(
          `[native] 收到 0x10A 的真实光标移动请求，但原生能力不可用（${w32 ? w32.reason : '模块未加载'}）` +
            `⇒ 只改引擎侧光标（观感缺失，脚本逻辑不受影响）`,
        );
      }
      return;
    }
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;
    const b = win.getContentBounds(); // DIP 屏幕坐标（内容区左上角）
    const dip = { x: Math.round(b.x + clientX), y: Math.round(b.y + clientY) };
    // `dipToScreenPoint` 只有 Windows 有（其它平台 screen 坐标本来就是 DIP ⇒ 直接用）。
    const phys =
      typeof screen.dipToScreenPoint === 'function' ? screen.dipToScreenPoint(dip) : dip;
    const ok = w32.setCursorPos(phys.x, phys.y);
    // 诊断（节流 + 去重）：这是"光标到底动没动"的唯一主进程侧证据 —— 用户报障时先看它。
    const now = Date.now();
    if (now - lastWarpLog > 200 || !lastWarp || lastWarp.x !== phys.x || lastWarp.y !== phys.y) {
      lastWarpLog = now;
      lastWarp = { x: phys.x, y: phys.y };
      logMainLine(
        `[native] warp client=(${Math.round(clientX)},${Math.round(clientY)}) dip=(${dip.x},${dip.y}) ` +
          `phys=(${phys.x},${phys.y}) ok=${ok ? 1 : 0}`,
      );
    }
  });
}

/** 诊断用（控制窗/测试可读）：当前原生光标位置（物理像素）。 */
export function nativeCursorPos(): { x: number; y: number } | null {
  return w32?.getCursorPos() ?? null;
}
