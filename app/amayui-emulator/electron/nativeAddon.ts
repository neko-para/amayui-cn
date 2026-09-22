/**
 * **主进程侧的原生能力桥**（`native/host-input`）：把引擎 `0x10A` 的宿主侧动作做到位 ——
 * 真的把系统光标挪过去，而不是只改引擎侧坐标。
 *
 * ## 为什么在主进程
 *
 * 渲染进程**没有 Node 集成**（`src/renderer/**` 跑在沙箱里，连 `Buffer` 都不能用 —— 见
 * `tickets/T-0054` 的"渲染器安全"棘轮），所以 `.node` 只能在主进程 `require`；
 * 渲染进程通过 `set-system-cursor` 这条 IPC 把**客户区坐标**交过来。
 *
 * ## 模块形态：一个 addon、两个平台实现（`tickets/T-0119`）
 *
 * 这里不再按平台挑模块 —— `native/host-input` 自己就是**跨平台**的：`Init` 报 `platform`/`supported`，
 * 平台实现住在各自的 TU 里（`src/win32_input.cc` / `src/macos_input.cc`，见模块 README）。
 * 于是本文件只剩"加载 + 注册 IPC + 每平台换算"三件事：
 *
 * | 平台 | 宿主原语 | 坐标语义 | 主进程那一跳 |
 * |---|---|---|---|
 * | `win32` | `SetCursorPos` | **物理像素** | `screen.dipToScreenPoint()`（★Windows 专用） |
 * | `darwin` | `CGWarpMouseCursorPosition` | **点**（= DIP） | **没有**这一跳 |
 *
 * ## 坐标换算（Windows **三跳**，macOS **两跳** —— 少一跳不是省事，是那边本来就只有两跳）
 *
 * ```
 * 引擎虚拟坐标 (1280×720)        ← 0x10A 的操作数（宿主缝 setSystemCursor(x, y) 收到的就是它）
 *   ↓ 渲染进程：canvas.getBoundingClientRect()（`pixi/inputAttach.ts` 的 toVirtual 的逆）
 * 客户区 CSS 像素 (clientX, clientY)  ← IPC 传的就是这个
 *   ↓ 主进程：BrowserWindow.getContentBounds()（**DIP** 屏幕坐标）
 * 屏幕 DIP 坐标
 *   ↓ 主进程：screen.dipToScreenPoint()（★**只有 Windows 有**；按显示器缩放算）
 * 屏幕**物理**像素                    ← win32 实现要的就是这个
 * ```
 *
 * ★为什么 Windows 的最后一跳不能省：`SetCursorPos` 是 Win32 原语，吃**物理像素**；Electron 的
 * `screen`/`getContentBounds()` 一律给 **DIP**。缩放 ≡ 100% 时两者相等 ⇒ 省掉它在本机看不出问题，
 * 换台 125%/150% 的机器光标就会挪到偏左上角的地方（`tickets/T-0053` 的验收里专门写了这条）。
 * ★macOS 则**没有**这一跳可做：CoreGraphics 与 Electron 的屏幕坐标**都是点**（Retina 的缩放不在
 * 这个坐标系里）⇒ 直接把手上的 DIP 交出去就是对的（`native/host-input/README.md` 也写了这条）。
 *
 * ## 降级
 *
 * 原生模块**可能不存在**（没构建 / 打包漏了），或**本平台没有实现**（Linux ⇒ `supported === false`）
 * ⇒ 这里只记一行诊断、`setSystemCursor` 退化成空操作：**引擎侧坐标照旧生效**（脚本逻辑正确），
 * 只是玩家看不见光标被挪过去 —— 也就是这条能力接入之前的旧行为。降级不用调用方写任何分支。
 */
import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import { REPO_ROOT } from './paths.js';
import { logMainLine } from './logging.js';

/** 原生模块的公共门面（`native/host-input/index.js` 导出的对象；不可用时全函数安全空实现）。 */
interface HostInput {
  available: boolean;
  supported: boolean;
  reason: string;
  addonPath: string | null;
  setCursorPos(x: number, y: number): boolean;
  getCursorPos(): { x: number; y: number } | null;
}

/** 本仓唯一的宿主原生模块（一个 addon、两个平台实现；见模块 README 与 `tickets/T-0119`）。 */
const HOST_MODULE = 'host-input';

/**
 * 加载摘要的日志前缀。
 *
 * ★这串字面量是**跨 agent 的契约**（票据的 evidence 锚在它上面，也是排"光标怎么不动"的第一现场）：
 * 改格式要同步 retarget 票据里的锚点，别悄悄改。
 */
const LOAD_SUMMARY_PREFIX = '[native] host-input available=';

/** 原生模块的加载结果（进程内只加载一次）。 */
let host: HostInput | null = null;
/** 已经记过降级诊断 ⇒ 不刷屏（`i10a` 全库 1678 处）。 */
let warned = false;
/** `[native] warp` 诊断的节流（同一条相邻 warp 不重复记；`0x10A` 可能被脚本密集调用）。 */
let lastWarpLog = 0;
let lastWarp: { x: number; y: number } | null = null;

/**
 * 载入宿主原生模块（**唯一**加载点；失败不抛）。
 *
 * 路径：`<repo>/native/host-input`（`REPO_ROOT` 见 `paths.ts`）。加载器本身还会按
 * `AMAYUI_HOST_INPUT_NODE` → `build/Release` → `build/<Config>` → `prebuilds/<platform>-{arch,universal}/`
 * 找 `.node`（将来打包成 asar 时用环境变量指到 `app.asar.unpacked` 即可；macOS 的通用二进制预置在
 * `prebuilds/darwin-universal/`，见 `tickets/T-0117`）。
 */
function loadHostInput(): HostInput | null {
  const entry = path.join(REPO_ROOT, 'native', HOST_MODULE, 'index.js');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(entry) as HostInput;
    return mod;
  } catch (err) {
    logMainLine(`[native] 载入 ${entry} 失败：${(err as Error).message}`);
    return null;
  }
}

/** 启动时调用一次：加载 + 打印一行状态（这是排"光标怎么不动"的第一现场）。 */
export function initNativeAddon(): void {
  host = loadHostInput();
  if (!host) {
    logMainLine(`[native] 未接入 ${HOST_MODULE}（模块缺失）⇒ 0x10A 只改引擎侧光标`);
    return;
  }
  logMainLine(
    `${LOAD_SUMMARY_PREFIX}${host.available} supported=${host.supported}` +
      `${host.addonPath ? ` path=${host.addonPath}` : ''}${host.reason ? ` reason=${host.reason}` : ''}`,
  );
}

/**
 * 注册 `set-system-cursor` 通道（渲染进程 `window.api.setSystemCursor(clientX, clientY)`）。
 *
 * 参数是**客户区 CSS 像素**（渲染侧已把虚拟坐标换算过来）；这里补上窗口内容区原点再做平台换算。
 */
export function registerNativeIpc(): void {
  ipcMain.on('set-system-cursor', (e, clientX: number, clientY: number) => {
    if (!host || !host.supported) {
      if (!warned) {
        warned = true;
        logMainLine(
          `[native] 收到 0x10A 的真实光标移动请求，但原生能力不可用（${host ? host.reason || '本平台没有实现' : '模块未加载'}）` +
            `⇒ 只改引擎侧光标（观感缺失，脚本逻辑不受影响）`,
        );
      }
      return;
    }
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;
    const b = win.getContentBounds(); // DIP 屏幕坐标（内容区左上角）
    const dip = { x: Math.round(b.x + clientX), y: Math.round(b.y + clientY) };
    // `dipToScreenPoint` 只有 Windows 有（macOS/Linux 的屏幕坐标本来就是 DIP ⇒ 直接用）。
    const phys =
      typeof screen.dipToScreenPoint === 'function' ? screen.dipToScreenPoint(dip) : dip;
    const ok = host.setCursorPos(phys.x, phys.y);
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

/** 诊断用（控制窗/测试可读）：当前原生光标位置（Windows = 物理像素；macOS = 点）。 */
export function nativeCursorPos(): { x: number; y: number } | null {
  return host?.getCursorPos() ?? null;
}
