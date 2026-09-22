/**
 * **在真实 Electron 宿主里验证「0x10A → 真实光标」整条链**（`tickets/T-0053` / `T-0058` / `T-0116`）。
 *
 * 为什么要单独一支工具：`test/native-host.test.ts` 只能证到「宿主缝收到同一对坐标」+「源码里换算都在」；
 * 而**换算出来的屏幕点对不对**必须在 Electron 里量 —— DPI 感知级别、`screen.dipToScreenPoint`、
 * `getContentBounds` 三者只有真实宿主才有真值。
 *
 * ```
 * AMAYUI_CURSOR_VERIFY=1 npx electron tools/verify-cursor.cjs
 * ```
 *
 * ★默认**不动鼠标**（避免被自动化误触发）：只有显式给环境变量才真的挪。挪完一定复位。
 *
 * ## 两个平台的差别（就在下面这几行里）
 *
 * | 平台 | `setCursorPos` 的实现 | 最后一跳 |
 * |---|---|---|
 * | win32 | `SetCursorPos`（吃**物理像素**） | `screen.dipToScreenPoint(dip)` |
 * | darwin | `CGWarpMouseCursorPosition`（吃**点**） | **没有**这一跳（屏幕坐标本来就是点） |
 *
 * ★macOS 的读回位置可能是**小数**（触控板按亚像素累积），而 warp 落**整数点**
 * （`native/host-input/src/macos_input.cc` 口径 5：小数四舍五入）⇒ 比较前先取整，否则会假红。
 */
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ADDON = path.join(ROOT, 'native', 'host-input');

function main() {
  const native = require(ADDON);
  console.log(`[verify] host-input available=${native.available} supported=${native.supported} path=${native.addonPath}`);
  if (!native.available || !native.supported) {
    console.log(`[verify] 原生能力不可用（${native.reason || `非 ${process.platform}`}）⇒ 跳过`);
    app.exit(2);
    return;
  }
  if (process.env.AMAYUI_CURSOR_VERIFY !== '1') {
    console.log('[verify] 只读模式：设 AMAYUI_CURSOR_VERIFY=1 才会真的挪动光标（会立刻复位）');
    const p = native.getCursorPos();
    console.log(`[verify] getCursorPos=${JSON.stringify(p)} virtualScreen=${JSON.stringify(native.getVirtualScreenRect())}`);
    app.exit(0);
    return;
  }

  const win = new BrowserWindow({ width: 640, height: 480, x: 120, y: 120, show: false, frame: true });
  const before = native.getCursorPos();
  // warp 落整数点 ⇒ 复位目标与比较口径都按取整后的原点算（只有 macOS 会读到小数）。
  const origin = { x: Math.round(before.x), y: Math.round(before.y) };
  const b = win.getContentBounds(); // DIP（内容区左上角）
  const targetDip = { x: Math.round(b.x + 320), y: Math.round(b.y + 240) }; // 内容区中心
  // `dipToScreenPoint` 只有 Windows 有；macOS/Linux 的屏幕坐标本来就是 DIP（= CGEvent 的点）。
  const targetScreen =
    typeof screen.dipToScreenPoint === 'function' ? screen.dipToScreenPoint(targetDip) : targetDip;
  const ok = native.setCursorPos(targetScreen.x, targetScreen.y);
  const after = native.getCursorPos();
  const restored = native.setCursorPos(origin.x, origin.y);
  const back = native.getCursorPos();

  console.log(`[verify] 内容区 bounds(DIP)=${JSON.stringify(b)}`);
  console.log(`[verify] 目标 DIP=${JSON.stringify(targetDip)} → ${process.platform === 'darwin' ? '屏幕(点)' : '物理'}=${JSON.stringify(targetScreen)}`);
  console.log(`[verify] setCursorPos ok=${ok} 读回=${JSON.stringify(after)}`);
  console.log(`[verify] 复位 ok=${restored} 读回=${JSON.stringify(back)}（原位置 ${JSON.stringify(before)}）`);

  const hit = !!after && Math.round(after.x) === targetScreen.x && Math.round(after.y) === targetScreen.y;
  const backOk = !!back && Math.round(back.x) === origin.x && Math.round(back.y) === origin.y;
  console.log(`[verify] 结论：搬迁${hit ? '✅一致' : '❌不一致'}；复位${backOk ? '✅' : '❌'}`);
  app.exit(hit && backOk ? 0 : 1);
}

app.whenReady().then(main);
app.on('window-all-closed', () => app.quit());
