'use strict';
/**
 * **web 宿主的端到端取证**（`tickets/T-0135` Phase 2 的"跑到 TITLE 并截图"）。
 *
 * 它证明的是**浏览器侧**真的能用：页面由 web 宿主（HTTP + SSE）提供、`window.api` 由 `bridge.js`
 * 装成 HTTP 实现、资源/配置/存档通道全走我们自己的协议 —— 而截这张图的 Electron 只是个
 * **哑浏览器**（`capturePage` 只是取证手段，页面本身与 Electron 无关）。
 *
 * ```bash
 * npm run build:electron
 * node tools/webhost-shot.cjs                 # 默认 --port 8899 --instance shot --wait-ms 45000
 * node tools/webhost-shot.cjs --keep          # 保留 web 宿主（自己接着 curl/看）
 * ```
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ★Electron 必须在 require 之前把开关挂上（与 `tools/debugsrv.cjs:67-75` 同一组，理由见那里）：
//   本机/容器环境里 Chromium 沙箱会初始化失败（`Failed to initialize sandbox. Operation not permitted`
//   → GPU 子进程连环崩 → 整个 app 被 SIGTRAP 打死）⇒ 显式关沙箱 + 关节流。
//   可以关的理由同 `debugsrv.cjs`：这个哑浏览器只访问**回环**上的我们自己的页面。
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('no-sandbox');

const APP = path.resolve(__dirname, '..');
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const PORT = Number(argOf('--port', '8899'));
const INSTANCE = argOf('--instance', 'shot');
const WAIT_MS = Number(argOf('--wait-ms', '45000'));
const KEEP = process.argv.includes('--keep');
const OUT = path.resolve(APP, argOf('--out', '../../.tmp/webshot'));
const URL = `http://127.0.0.1:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const logPath = path.join(OUT, 'webhost.log');
  const log = fs.createWriteStream(logPath);

  // ① 起 web 宿主（独立进程；不涉及 Electron）
  console.log(`[webshot] 起 web 宿主：instance=${INSTANCE} port=${PORT}`);
  const host = spawn('node', ['--import', 'tsx', 'src/web/host.ts', '--instance', INSTANCE, '--port', String(PORT)], {
    cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  host.stdout.pipe(log);
  host.stderr.pipe(log);

  const cleanup = async () => {
    if (KEEP) return;
    try { process.kill(-host.pid, 'SIGTERM'); } catch { try { host.kill('SIGTERM'); } catch {} }
  };

  try {
    // 等 HTTP 就绪
    let up = false;
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${URL}health`).catch(() => null);
      if (r && r.ok) { up = true; break; }
      await sleep(500);
    }
    if (!up) throw new Error(`web 宿主没起来（看 ${logPath}）`);
    const health = await (await fetch(`${URL}health`)).json();
    console.log(`[webshot] 宿主就绪：${JSON.stringify(health.layout.logPath)}`);

    // ② 用 Electron 当哑浏览器打开它（窗口**不可见**）
    await app.whenReady();
    const win = new BrowserWindow({
      width: 1280, height: 720, show: false, useContentSize: true,
      webPreferences: { backgroundThrottling: false, offscreen: false },
    });
    await win.loadURL(URL);
    console.log(`[webshot] 页面已加载，等 ${WAIT_MS}ms 让它跑到 TITLE…`);

    // 轮询：canvas 出现 + 渲染窗自己报的 boot 进度（页面里只有我们的桥，看不到内部状态，
    // 所以用"canvas 存在 + 足够时长"作为到 TITLE 的近似判据，再人工目视核对截图）。
    const t0 = Date.now();
    let canvasAt = null;
    while (Date.now() - t0 < WAIT_MS) {
      const has = await win.webContents.executeJavaScript('!!document.querySelector("canvas")').catch(() => false);
      if (has && canvasAt === null) { canvasAt = Date.now() - t0; console.log(`[webshot] canvas 出现（+${canvasAt}ms）`); }
      await sleep(1000);
    }
    const img = await win.webContents.capturePage();
    const png = img.toPNG();
    const file = path.join(OUT, 'web-titleshot.png');
    fs.writeFileSync(file, png);
    console.log(`[webshot] 截图 ${png.length}B → ${file}`);
    // 顺带核对：页面里的 API 通道真的通（拿一份真资源）
    const scriptLen = await win.webContents.executeJavaScript(
      'window.api.readScript(0).then(r => r ? r.data.length : -1).catch(e => "ERR:" + e.message)',
    );
    console.log(`[webshot] 页面内 window.api.readScript(0) → ${scriptLen}（应为正数；证明 HTTP 桥通了）`);
    // ③ ★agent 侧控制面实测（T-0135 acceptance 6）：经宿主把命令下发给**这个真渲染页**。
    const dq = async (text) => {
      const r = await fetch(`${URL}api/debug-query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: [text] }),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const mv = await dq('move 640 360');
    console.log(`[webshot] agent 'move 640 360' → HTTP ${mv.status} ${JSON.stringify(mv.json && mv.json.lines)}`);
    if (!mv.json || mv.json.ok !== true) console.log('[webshot] ✗ move 没成功（agent 控制面不通）');
    const cap = await dq('capture');
    if (cap.json && typeof cap.json.png === 'string') {
      const buf = Buffer.from(cap.json.png, 'base64');
      const f2 = path.join(OUT, 'web-agent-capture.png');
      fs.writeFileSync(f2, buf);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      console.log(`[webshot] agent 'capture' → ${buf.length}B ${w}×${h} → ${f2}（经 FrameHost.capture，不是 capturePage）`);
    } else {
      console.log(`[webshot] ✗ capture 没回图：HTTP ${cap.status} ${JSON.stringify(cap.json && cap.json.lines)}`);
    }
    await app.quit();
  } catch (err) {
    console.log(`[webshot] ✗ ${err.message}`);
  } finally {
    await cleanup();
    log.end();
    console.log(`[webshot] 收工（宿主日志 ${logPath}）${KEEP ? '；宿主按 --keep 保留' : ''}`);
  }
})();
