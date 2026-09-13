/**
 * **`--record`：Electron 跑手**（`tickets/T-0005` 的 B5 / G3 的录制端）。
 *
 * 用法（先 `npm run build:electron`）：
 * ```bash
 * npm run record -- --scenario tools/scenarios/gamestart.json --out .tmp/gamestart-electron.jsonl
 * ```
 * 做三件事：
 *  1. 起真 Electron（`dist/electron/main.cjs`），按 `Scenario` 的 `events` 用
 *     `webContents.sendInputEvent` 注入**真实 DOM 输入**（走 `attachMouseInput` → `InputManager`，
 *     与真人操作同一条链；**不**直接写 VM）；
 *  2. 录制**从启动第一帧**开始（`AMAYUI_RECORD=1` ⇒ 渲染进程在 boot 时挂上 `TraceRecorder`）：
 *     每帧录 **时钟 + 帧首输入快照 + digest**，经 `append-replay-line` 落到 `--out`（gzip）；
 *  3. 跑够时长后退出。产物交给 `npm run replay <trace>` 在 headless 里复现（G3）。
 *
 * ★时序一律"等日志标记"而不是"睡固定秒数"（同 `shot.cjs` 的教训：机器忙时启动链慢一倍以上）。
 * ★`AMAYUI_REPLAY_PATH` 必须在 `require('../dist/electron/main.cjs')` **之前**设好 ——
 *   `electron/paths.ts` 在模块加载时就把它读成常量。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};

const SCENARIO_PATH = path.resolve(argOf('scenario', path.join(__dirname, 'scenarios', 'gamestart.json')));
const OUT = path.resolve(ROOT, argOf('out', '.tmp/replay-electron.jsonl.gz'));
const LOG = path.join(ROOT, '.tmp', 'amayui-emulator.log');

const spec = JSON.parse(fs.readFileSync(SCENARIO_PATH, 'utf8'));
const READY_MARKER = spec.readyMarker ?? '-> TITLE.BIN';
const READY_SETTLE_MS = spec.readySettleMs ?? 4000;
const TAIL_MS = spec.tailMs ?? 6000;

// ★这三个环境变量必须在 require main.cjs **之前**设：
//   - `AMAYUI_REPLAY_PATH`：主进程的 gzip 轨迹路径（模块加载期常量）；
//   - `AMAYUI_RECORD` / `AMAYUI_SCENARIO_*`：渲染进程（preload）据此**从第一帧**开始录制。
fs.mkdirSync(path.dirname(OUT), { recursive: true });
process.env.AMAYUI_REPLAY_PATH = OUT;
process.env.AMAYUI_RECORD = '1';
process.env.AMAYUI_SCENARIO_NAME = spec.name ?? 'scenario';
process.env.AMAYUI_SCENARIO_SCRIPT = String(spec.boot?.script ?? 0);

// 关掉后台节流（与 shot.cjs 同因：窗口不在前台时 rAF 会被降到极低频）。
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

require('../dist/electron/main.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitLog(marker, timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (fs.readFileSync(LOG, 'utf8').includes(marker)) return true;
    } catch {
      /* 日志还没建 */
    }
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(300);
  }
}

function gameWin() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getContentSize()[0] === 1280) ?? null;
}

/** 一条 Scenario 事件 → 真实 DOM 输入。 */
async function inject(win, ev) {
  const wc = win.webContents;
  const x = ev.x ?? 0;
  const y = ev.y ?? 0;
  switch (ev.kind) {
    case 'cursor':
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      break;
    case 'press':
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      await sleep(80);
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: ev.button === 1 ? 'right' : 'left', clickCount: 1 });
      break;
    case 'release':
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: ev.button === 1 ? 'right' : 'left', clickCount: 1 });
      break;
    case 'wheel':
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      await sleep(60);
      // DOM 侧 deltaY 下滚为正；spec 的 delta 用**引擎单位**（上滚正）⇒ 取负（见 inputAttach.ts）。
      wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -(ev.delta ?? 120), canZoom: false });
      break;
    case 'note':
      console.log(`[record] 注记：${ev.note ?? ''}`);
      break;
    default:
      console.log(`[record] 未知事件 kind=${ev.kind}（跳过）`);
  }
  if (ev.holdMs) await sleep(ev.holdMs);
}

(async () => {
  await app.whenReady();
  await sleep(1500);
  const win = gameWin();
  if (!win) {
    console.error('[record] 未找到游戏窗口');
    app.quit();
    return;
  }
  win.focus?.();
  console.log(`[record] 录制已从启动第一帧开始（AMAYUI_RECORD=1）→ ${OUT}`);
  const ok = await waitLog(READY_MARKER);
  console.log(`[record] 就绪标记 ${READY_MARKER} = ${ok}`);
  await sleep(READY_SETTLE_MS);
  const t0 = Date.now();

  for (const ev of spec.events ?? []) {
    if (ev.afterMarker) {
      const hit = await waitLog(ev.afterMarker, 120000);
      if (!hit) console.log(`[record] ⚠ 等标记超时：${ev.afterMarker}`);
      if (ev.settleMs) await sleep(ev.settleMs);
    } else if (typeof ev.atMs === 'number') {
      const wait = t0 + ev.atMs - Date.now();
      if (wait > 0) await sleep(wait);
    }
    await inject(win, ev);
    console.log(`[record] ${ev.kind}${ev.note ? `（${ev.note}）` : ''} @${Date.now() - t0}ms`);
  }

  await sleep(TAIL_MS);
  console.log('[record] 完成；回放：npm run replay -- ' + path.relative(ROOT, OUT));
  app.quit();
})().catch((e) => {
  console.error('[record] 失败:', e);
  app.quit();
});
