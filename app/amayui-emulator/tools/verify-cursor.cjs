/**
 * **在真实 Electron 宿主里验证「0x10A → 真实光标」整条链**（`tickets/T-0053` / `T-0058`）。
 *
 * 为什么要单独一支工具：`test/native-win32.test.ts` 只能证到「宿主缝收到同一对坐标」+
 * 「源码里三跳换算都在」；而**三跳算出来的物理点对不对**必须在 Electron 里量 —— DPI 感知级别、
 * `screen.dipToScreenPoint`、`getContentBounds` 三者只有真实宿主才有真值。
 *
 * ```
 * AMAYUI_CURSOR_VERIFY=1 npx electron tools/verify-cursor.cjs
 * ```
 *
 * ★默认**不动鼠标**（避免被自动化误触发）：只有显式给环境变量才真的挪。挪完一定复位。
 * 输出：内容区原点（DIP）→ 目标 DIP → 目标物理 → 实际读回，并断言"读回 == 物理目标"。
 */
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ADDON = path.join(ROOT, 'native', 'win32-input');

function main() {
  const w32 = require(ADDON);
  console.log(`[verify] addon available=${w32.available} supported=${w32.supported} path=${w32.addonPath}`);
  if (!w32.available || !w32.supported) {
    console.log(`[verify] 原生能力不可用（${w32.reason || '非 Windows'}）⇒ 跳过`);
    app.exit(2);
    return;
  }
  if (process.env.AMAYUI_CURSOR_VERIFY !== '1') {
    console.log('[verify] 只读模式：设 AMAYUI_CURSOR_VERIFY=1 才会真的挪动光标（会立刻复位）');
    const p = w32.getCursorPos();
    console.log(`[verify] getCursorPos=${JSON.stringify(p)} virtualScreen=${JSON.stringify(w32.getVirtualScreenRect())}`);
    app.exit(0);
    return;
  }

  const win = new BrowserWindow({ width: 640, height: 480, x: 120, y: 120, show: false, frame: true });
  const before = w32.getCursorPos();
  const b = win.getContentBounds(); // DIP（内容区左上角）
  const targetDip = { x: Math.round(b.x + 320), y: Math.round(b.y + 240) }; // 内容区中心
  const targetPhys = screen.dipToScreenPoint(targetDip); // Windows：DIP → 物理
  const ok = w32.setCursorPos(targetPhys.x, targetPhys.y);
  const after = w32.getCursorPos();
  const restored = w32.setCursorPos(before.x, before.y);
  const back = w32.getCursorPos();

  console.log(`[verify] 内容区 bounds(DIP)=${JSON.stringify(b)}`);
  console.log(`[verify] 目标 DIP=${JSON.stringify(targetDip)} → 物理=${JSON.stringify(targetPhys)}`);
  console.log(`[verify] setCursorPos ok=${ok} 读回=${JSON.stringify(after)}`);
  console.log(`[verify] 复位 ok=${restored} 读回=${JSON.stringify(back)}（原位置 ${JSON.stringify(before)}）`);

  const hit = !!after && after.x === targetPhys.x && after.y === targetPhys.y;
  const backOk = !!back && back.x === before.x && back.y === before.y;
  console.log(`[verify] 结论：搬迁${hit ? '✅一致' : '❌不一致'}；复位${backOk ? '✅' : '❌'}`);
  app.exit(hit && backOk ? 0 : 1);
}

app.whenReady().then(main);
app.on('window-all-closed', () => app.quit());
