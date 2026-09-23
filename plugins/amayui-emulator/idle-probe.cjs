'use strict';
/**
 * **对照实验**（`tickets/T-0138`）：在**完全不动面板**（不做任何收起/展开/放大/关闭）的情况下，
 * 长时间盯着注册表心跳里的 `frames`，看它到底会不会自己掉下来。
 *
 * 起因：`float-e2e.cjs` 的「frames 单调不减」断言在第三跑里报红（`402 → 35`）。当时有两种解释：
 *   a) 状态切换把实例搞坏了（⇒ 本票的修复不成立，P0 仍在）；
 *   b) `frames` 这个**上报量**本身在某些门（`gate:"sleep"`）下会回落，与切换无关（⇒ 断言口径不对）。
 * 本驱动不猜，直接做对照：**一次都不碰面板**，只采样。若 frames 照样掉 ⇒ 解释 (b)；
 * 若只有"切换过"的实例才掉 ⇒ 解释 (a)。
 *
 * 用法（cwd = `app/amayui-emulator`）：
 * ```bash
 * npx electron ../../plugins/amayui-emulator/idle-probe.cjs
 * ```
 * 产出：`.tmp/idle-probe/trace.txt`（逐秒：注册表 bin/gate/frames + 页面 performance.now() + iframe 节点身份）。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('no-sandbox');

const APP = process.cwd();
const REPO = path.resolve(APP, '..', '..');
const PLUGIN = path.resolve(REPO, 'plugins', 'amayui-emulator');
const OUT = path.join(REPO, '.tmp', 'idle-probe');
const INSTANCE = 'idle';
const REG = path.join(REPO, '.tmp', 'instances', INSTANCE, 'instance.json');
const HOST_LOG = path.join(OUT, 'host.log');
const HARNESS = path.join(REPO, '.tmp', 'float-e2e'); // 复用 float-e2e 写好的 harness（同源、含真 client.js）
const REACT_UMD = path.join(APP, '..', 'amayui-toolkit', 'node_modules', 'react', 'umd', 'react.development.js');
const REACT_DOM_UMD = path.join(APP, '..', 'amayui-toolkit', 'node_modules', 'react-dom', 'umd', 'react-dom.development.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readReg() { try { return JSON.parse(fs.readFileSync(REG, 'utf8')); } catch { return null; } }
function regStatus() {
  const r = readReg();
  return r && r.lastStatus ? r.lastStatus : {};
}

(async () => {
  const trace = [];
  let win = null;
  let server = null;
  const children = [];
  let hostExited = null;
  let verdict = 'INCONCLUSIVE';

  try {
    fs.mkdirSync(OUT, { recursive: true });
    try { fs.rmSync(HOST_LOG, { force: true }); } catch { /* 首次 */ }

    // ---- 1) 真实例（与 float-e2e 同一条命令口径）----
    const logStream = fs.createWriteStream(HOST_LOG, { flags: 'a' });
    const host = spawn(process.env.AMAYUI_NODE || 'node', [
      '--import', 'tsx', 'src/web/host.ts',
      '--instance', INSTANCE, '--port', '0', '--repo-root', REPO,
    ], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(host);
    host.stdout.pipe(logStream);
    host.stderr.pipe(logStream);
    host.on('exit', (code, sig) => { hostExited = { code, sig }; });

    let rec = null;
    for (let i = 0; i < 480; i++) {
      rec = readReg();
      if (rec && rec.port > 0) {
        const h = await fetch(`http://127.0.0.1:${rec.port}/health`).then((r) => r.json()).catch(() => null);
        if (h && h.ok) break;
      }
      await sleep(250);
    }
    if (!rec || !(rec.port > 0)) throw new Error('实例宿主没有起来（注册表无记录）');

    // ---- 2) 插件路由 + harness（复用 float-e2e 的产物）----
    const { apply } = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'index.js')).href);
    let route = null;
    const ctx = {
      webServer: { register(r) { route = r; return () => { route = null; }; } },
      get(k) { return k === 'sandboxPolicy' ? { workspaceRoot: REPO } : undefined; },
      effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    };
    apply(ctx);
    const PREFIX = '/dsh-emulator';
    const staticMap = {
      '/harness/': { file: path.join(HARNESS, 'index.html'), mime: 'text/html; charset=utf-8' },
      '/harness/index.html': { file: path.join(HARNESS, 'index.html'), mime: 'text/html; charset=utf-8' },
      '/harness/client.js': { file: path.join(HARNESS, 'client.js'), mime: 'text/javascript; charset=utf-8' },
      '/vendor/react.js': { file: REACT_UMD, mime: 'text/javascript; charset=utf-8' },
      '/vendor/react-dom.js': { file: REACT_DOM_UMD, mime: 'text/javascript; charset=utf-8' },
    };
    server = http.createServer((req, res) => {
      const pathname = String(req.url || '/').split('?')[0];
      if (pathname === PREFIX || pathname.startsWith(PREFIX + '/')) {
        Promise.resolve(route.handler(req, res)).catch((e) => {
          try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e && e.message)); } catch { /* 已发 */ }
        });
        return;
      }
      const hit = staticMap[pathname];
      if (!hit) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + pathname); return; }
      try {
        res.writeHead(200, { 'content-type': hit.mime, 'cache-control': 'no-store' });
        res.end(fs.readFileSync(hit.file));
      } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e && e.message)); }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;

    // ---- 3) 开面板、选中实例、跑到 TITLE（此后**一次都不碰控制**）----
    await app.whenReady();
    win = new BrowserWindow({
      width: 1280, height: 800, show: false, useContentSize: true,
      backgroundColor: '#101010', webPreferences: { backgroundThrottling: false },
    });
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`${origin}/harness/`);
    // 展开 → 选中实例（让 iframe 真的挂上 = VM 真的跑起来）
    for (let i = 0; i < 100; i++) { if (await js('!!(window.__snap && (window.__snap().pill || window.__snap().panel))')) break; await sleep(100); }
    await js('window.__clickById("amayui-emulator-pill")');
    const rowId = 'amayui-emulator-inst-' + INSTANCE;
    for (let i = 0; i < 80; i++) { if (await js(`window.__snap().rowIds.indexOf(${JSON.stringify(rowId)}) >= 0`)) break; await sleep(500); }
    await js(`window.__clickById(${JSON.stringify(rowId)})`);
    await sleep(1000);
    // 等 TITLE
    let booted = null;
    for (let i = 0; i < 360; i++) {
      const st = regStatus();
      if (st.bin === 'TITLE.BIN' && typeof st.frames === 'number' && st.frames > 0) { booted = { ...st }; break; }
      await sleep(500);
    }
    if (!booted) throw new Error('实例没有跑到 TITLE.BIN');
    // 页内观测：performance.now() 单调性 + iframe 节点是否被换掉（换掉 ⇒ 页面重载过）
    const pageProbe = `(function () {
      var f = document.querySelector('iframe');
      if (f && !f.__idleMark) f.__idleMark = 'node-' + Math.random().toString(36).slice(2, 8);
      return {
        now: performance.now(),
        startTime: (performance.getEntriesByType('navigation')[0] || {}).startTime,
        iframeMark: f ? f.__idleMark : null,
        iframeSrc: f ? f.getAttribute('src') : null,
      };
    })()`;

    console.log(`[idle] 已到 TITLE（frames=${booted.frames}），**此后不做任何操作**，开始逐秒采样…`);
    const T0 = Date.now();
    const DURATION_MS = 60000;
    let last = null;
    while (Date.now() - T0 < DURATION_MS) {
      const st = regStatus();
      const pg = await js(pageProbe).catch((e) => ({ error: String(e && e.message) }));
      const r = readReg();
      const line = {
        t: ((Date.now() - T0) / 1000).toFixed(1),
        bin: st.bin, gate: st.gate, frames: st.frames,
        pid: r && r.pid, startedAt: r && r.startedAt,
        pageNow: pg && pg.now, navStart: pg && pg.startTime,
        iframeMark: pg && pg.iframeMark, iframeSrc: pg && pg.iframeSrc,
      };
      trace.push(line);
      const mark = pg && pg.iframeMark;
      if (last && mark !== last.mark) trace.push({ t: line.t, EVENT: `iframe 节点被换掉：${last.mark} → ${mark}` });
      last = { mark, frames: st.frames };
      console.log(`  t=${line.t.padStart(5)}s bin=${line.bin} gate=${line.gate} frames=${line.frames} pageNow=${Math.round(line.pageNow)} mark=${line.iframeMark}`);
      await sleep(1000);
    }

    // ---- 4) 判读 ----
    const fr = trace.map((x) => x.frames).filter((n) => typeof n === 'number');
    const drops = [];
    for (let i = 1; i < fr.length; i++) if (fr[i] < fr[i - 1]) drops.push(`${fr[i - 1]}→${fr[i]}`);
    const marks = Array.from(new Set(trace.map((x) => x.iframeMark).filter(Boolean)));
    const gates = Array.from(new Set(trace.map((x) => x.gate)));
    const bins = Array.from(new Set(trace.map((x) => x.bin)));
    verdict = drops.length === 0 ? 'NO_DROP' : 'DROP_WITHOUT_ANY_TOGGLE';
    console.log(`\n[idle] frames 序列：${fr.join(', ')}`);
    console.log(`[idle] 掉过的次数：${drops.length}（${drops.join(' | ') || '无'}）`);
    console.log(`[idle] iframe 节点身份：${JSON.stringify(marks)}（多个 ⇒ 页面被换过）`);
    console.log(`[idle] 期间出现过的 gate：${JSON.stringify(gates)}；bin：${JSON.stringify(bins)}`);
    console.log(`[idle] 判读：${verdict}`);
  } catch (err) {
    console.log(`[idle] ✗ ${err && err.stack ? err.stack : err}`);
    verdict = 'ERROR: ' + String(err && err.message);
  } finally {
    try { if (win) win.destroy(); } catch { /* 已经没了 */ }
    try { if (server) server.close(); } catch { /* 已经没了 */ }
    for (const c of children) { try { c.kill('SIGTERM'); } catch { /* 已经没了 */ } }
    await sleep(1200);
    const lines = [`# 对照实验：不做任何操作时 frames 会不会掉`, '', `日期：${new Date().toISOString().slice(0, 10)}`, '',
      `命令：\`cd app/amayui-emulator && npx electron ../../plugins/amayui-emulator/idle-probe.cjs\``, '',
      '## 逐秒采样', '', '| t(s) | bin | gate | frames | 页面 performance.now() | iframe 节点 |', '|---|---|---|---|---|---|'];
    for (const x of trace) {
      if (x.EVENT) { lines.push(`| ${x.t} | **${x.EVENT}** | | | | |`); continue; }
      lines.push(`| ${x.t} | ${x.bin} | ${x.gate} | ${x.frames} | ${x.pageNow == null ? '' : Math.round(x.pageNow)} | ${x.iframeMark} |`);
    }
    lines.push('', `## 判读：**${verdict}**`, '');
    if (verdict === 'NO_DROP') {
      lines.push('60 秒内一次都没碰面板，`frames` 也没有掉过 ⇒ 「切换导致 frames 掉」这个因果不成立；');
      lines.push('`float-e2e.cjs` 里那条「frames 单调不减」若仍报红，说明掉帧另有触发条件（需再定位），');
      lines.push('但**不能用它来指控状态切换**（本次对照证明它在无操作时也可能不发生 ⇒ 不是充分证据）。');
    } else if (verdict === 'DROP_WITHOUT_ANY_TOGGLE') {
      lines.push('★**在完全没有任何面板操作的情况下，`frames` 自己掉了** ⇒ `frames` 这个上报量不是单调量，');
      lines.push('它**不能**当作「实例有没有被重启」的判据（重启判据请用：宿主日志里的启动链重现 + `pid`/`startedAt` + 页面 iframe 节点身份）。');
    }
    lines.push('');
    fs.writeFileSync(path.join(OUT, 'trace.txt'), lines.join('\n'), 'utf8');
    fs.writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify({ verdict, trace, hostExited }, null, 2), 'utf8');
    console.log(`[idle] 证据：${path.join(OUT, 'trace.txt').replace(REPO + path.sep, '')}`);
    process.exit(0);
  }
})();
