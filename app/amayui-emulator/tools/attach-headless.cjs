'use strict';
/**
 * **宿主自持的无头渲染页**（`tickets/T-0140` 的 `--attach-headless`）。
 *
 * 宿主（`src/web/host.ts`）在 `listen()` 成功后 spawn 本脚本，本脚本开一个
 * **隐藏的 Electron 窗口**（`show: false`）去加载实例的渲染页 ⇒ 那个页面里的 VM 就跑起来了，
 * 于是 **agent 不需要人打开面板**也能 `debug-query`（`move` / `click` / `capture` …）。
 *
 * ```text
 * node src/web/host.ts --instance dbg-a --attach-headless
 *   └─ spawn(electron, tools/attach-headless.cjs --url http://127.0.0.1:<port>/ --instance dbg-a)
 *        └─ BrowserWindow({show:false}) → loadURL(<url>) → 页面里 bridge.js + renderer.js → VM
 * ```
 *
 * ## 为什么不是"真 headless"（没有窗口）
 *
 * `capture` 要的是**像素**（`FrameHost.capture` → Pixi 的 stage canvas）。离屏/无窗口的渲染进程
 * 拿不到真实的合成结果 —— 这是 `T-0133` 的"形态 C vs B 撇"之分，也是 `e2e-shot.cjs`（哑窗探针）
 * 当初就选隐藏窗口的原因。所以这里用**隐藏窗口**：不抢焦点、不打扰人，但画面是真的。
 *
 * ## 硬约束（继承自既有实测记录）
 *
 * * `--no-sandbox`：本机沙箱初始化会失败（`tools/debugsrv.cjs:67-75`、`e2e-shot.cjs` 都有同一条）。
 * * 三个 `disable-*-throttling/backgrounding` 开关：窗口是隐藏的，不加这些 Chromium 会把
 *   `requestAnimationFrame` 节流 ⇒ VM 几乎不前进（`frames` 停滞），看起来"没跑起来"。
 * * 退出即关窗：宿主收掉我们（SIGTERM）或窗口没了（`window-all-closed`）都要 `app.quit()`，
 *   否则会留下一个连着死宿主的渲染进程。
 *
 * 用法：`electron tools/attach-headless.cjs --url <实例根 URL> [--instance <id>]`
 */
const { app, BrowserWindow } = require('electron');

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const URL_TO_LOAD = argOf('--url');
const INSTANCE = argOf('--instance', 'default');

if (!URL_TO_LOAD) {
  console.error('[headless] 缺少 --url（宿主会传实例根 URL）');
  process.exit(2);
}

// ★必须在 app ready 之前挂：这些开关影响整个渲染进程的调度策略。
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let win = null;

function bye(code) {
  try {
    if (win && !win.isDestroyed()) win.destroy();
  } catch {
    /* 已经没了 */
  }
  app.exit(code);
}

app.on('window-all-closed', () => bye(0));
// 宿主 SIGTERM 我们（`host.close()` / `detachHeadless()`）⇒ 立刻收工，别留孤儿。
process.on('SIGTERM', () => bye(0));
process.on('SIGINT', () => bye(0));

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false, // ★不打扰人：无头自持页的全部意义
    width: 1280,
    height: 720,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: { backgroundThrottling: false },
  });
  win.on('unresponsive', () => console.log('[headless] 页面无响应（VM 可能卡住）'));
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log(`[headless] 渲染进程没了：${JSON.stringify(d)}`);
    bye(1);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[headless] 加载失败 ${code} ${desc} ${url}`);
  });
  await win.loadURL(URL_TO_LOAD);
  console.log(`[headless] 已附着实例 ${INSTANCE}：${URL_TO_LOAD}（隐藏窗口；Ctrl-C 或宿主退出即收工）`);
});
