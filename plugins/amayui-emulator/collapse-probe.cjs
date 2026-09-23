'use strict';
/**
 * **单变量实验**（`tickets/T-0138`）：把「收起」单独拎出来，看它是不是 `frames` 回落的原因。
 *
 * 已有两份证据：
 *   * `idle-probe.cjs`：**完全不动**面板 60s ⇒ `frames` 单调上升（53→2711，0 次回落）；
 *   * `float-e2e.cjs` 第三跑：来回切了两轮，`frames` 出现 `402 → 35` 的回落。
 * 差在哪一步？两轮切换里唯一"长时间"的状态是**收起**（iframe `visibility:hidden` 一段十几秒）。
 * 本驱动就做这一步：到 TITLE → **收起** → 盯 25s → 展开 → 再盯 15s，全程逐秒记录
 * `frames` + 页面 `performance.now()` + iframe 节点身份 + 宿主日志段序列。
 *
 * 只想回答一个问题：**收起这段时间里 `frames` 会不会回落？**（会 ⇒ 收起确实动了 VM，P0 未清）
 *
 * 用法（cwd = `app/amayui-emulator`）：`npx electron ../../plugins/amayui-emulator/collapse-probe.cjs`
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
const OUT = path.join(REPO, '.tmp', 'collapse-probe');
const INSTANCE = 'coll';
const REG = path.join(REPO, '.tmp', 'instances', INSTANCE, 'instance.json');
const HOST_LOG = path.join(OUT, 'host.log');
const HARNESS = path.join(REPO, '.tmp', 'float-e2e');
const REACT_UMD = path.join(APP, '..', 'amayui-toolkit', 'node_modules', 'react', 'umd', 'react.development.js');
const REACT_DOM_UMD = path.join(APP, '..', 'amayui-toolkit', 'node_modules', 'react-dom', 'umd', 'react-dom.development.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readReg() { try { return JSON.parse(fs.readFileSync(REG, 'utf8')); } catch { return null; } }
function st() { const r = readReg(); return r && r.lastStatus ? r.lastStatus : {}; }
function binRuns() {
  let txt = '';
  try { txt = fs.readFileSync(HOST_LOG, 'utf8'); } catch { return []; }
  const re = /"bin":"((?:[^"\\]|\\.)*)"/g;
  const seq = [];
  let m;
  while ((m = re.exec(txt)) !== null) seq.push(m[1]);
  const runs = [];
  for (const b of seq) if (!runs.length || runs[runs.length - 1] !== b) runs.push(b);
  return runs;
}

(async () => {
  const trace = [];
  let win = null;
  let server = null;
  const children = [];
  let verdict = 'INCONCLUSIVE';

  try {
    fs.mkdirSync(OUT, { recursive: true });
    try { fs.rmSync(HOST_LOG, { force: true }); } catch { /* 首次 */ }

    const logStream = fs.createWriteStream(HOST_LOG, { flags: 'a' });
    const host = spawn(process.env.AMAYUI_NODE || 'node', [
      '--import', 'tsx', 'src/web/host.ts', '--instance', INSTANCE, '--port', '0', '--repo-root', REPO,
    ], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(host);
    host.stdout.pipe(logStream);
    host.stderr.pipe(logStream);

    let rec = null;
    for (let i = 0; i < 480; i++) {
      rec = readReg();
      if (rec && rec.port > 0) {
        const h = await fetch(`http://127.0.0.1:${rec.port}/health`).then((r) => r.json()).catch(() => null);
        if (h && h.ok) break;
      }
      await sleep(250);
    }
    if (!rec || !(rec.port > 0)) throw new Error('实例宿主没有起来');

    const { apply } = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'index.js')).href);
    let route = null;
    apply({
      webServer: { register(r) { route = r; return () => { route = null; }; } },
      get(k) { return k === 'sandboxPolicy' ? { workspaceRoot: REPO } : undefined; },
      effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    });
    const PREFIX = '/dsh-emulator';
    const staticMap = {
      '/harness/': path.join(HARNESS, 'index.html'),
      '/harness/index.html': path.join(HARNESS, 'index.html'),
      '/harness/client.js': path.join(HARNESS, 'client.js'),
      '/vendor/react.js': REACT_UMD,
      '/vendor/react-dom.js': REACT_DOM_UMD,
    };
    server = http.createServer((req, res) => {
      const pathname = String(req.url || '/').split('?')[0];
      if (pathname === PREFIX || pathname.startsWith(PREFIX + '/')) {
        Promise.resolve(route.handler(req, res)).catch((e) => {
          try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e && e.message)); } catch { /* 已发 */ }
        });
        return;
      }
      const file = staticMap[pathname];
      if (!file) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + pathname); return; }
      res.writeHead(200, {
        'content-type': pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(fs.readFileSync(file));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;

    await app.whenReady();
    win = new BrowserWindow({
      width: 1280, height: 800, show: false, useContentSize: true,
      backgroundColor: '#101010', webPreferences: { backgroundThrottling: false },
    });
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await win.loadURL(`${origin}/harness/`);
    for (let i = 0; i < 100; i++) { if (await js('!!(window.__snap && (window.__snap().pill || window.__snap().panel))')) break; await sleep(100); }
    await js('window.__clickById("amayui-emulator-pill")');
    const rowId = 'amayui-emulator-inst-' + INSTANCE;
    for (let i = 0; i < 80; i++) { if (await js(`window.__snap().rowIds.indexOf(${JSON.stringify(rowId)}) >= 0`)) break; await sleep(500); }
    await js(`window.__clickById(${JSON.stringify(rowId)})`);
    for (let i = 0; i < 360; i++) { const s = st(); if (s.bin === 'TITLE.BIN' && typeof s.frames === 'number' && s.frames > 0) break; await sleep(500); }
    // 让启动尾（`… INIT2 → TITLE`）落完，再开始
    await sleep(4000);
    const pageProbe = `(function () {
      var f = document.querySelector('iframe');
      if (f && !f.__cMark) f.__cMark = 'node-' + Math.random().toString(36).slice(2, 8);
      var vp = document.getElementById('amayui-emulator-viewport');
      return { now: performance.now(), iframeMark: f ? f.__cMark : null, vis: vp ? getComputedStyle(vp).visibility : null };
    })()`;

    const sample = async (phase, tSec) => {
      const s = st();
      const pg = await js(pageProbe).catch((e) => ({ error: String(e && e.message) }));
      const row = { phase, t: tSec, bin: s.bin, gate: s.gate, frames: s.frames, pageNow: pg && pg.now, mark: pg && pg.iframeMark, vis: pg && pg.vis };
      trace.push(row);
      console.log(`  [${phase}] t=${tSec}s vis=${row.vis} frames=${row.frames} pageNow=${Math.round(row.pageNow)} mark=${row.mark}`);
      return row;
    };

    console.log('\n[coll] 阶段 A：**保持展开** 12s（对照）');
    for (let i = 0; i < 12; i++) { await sample('A-expanded', i); await sleep(1000); }

    console.log('\n[coll] 点「收起」→ 阶段 B：收起状态 **25s**');
    await js('window.__clickById("amayui-emulator-collapse")');
    for (let i = 0; i < 25; i++) { await sample('B-collapsed', i); await sleep(1000); }

    console.log('\n[coll] 点「展开」→ 阶段 C：展开后再盯 15s');
    await js('window.__clickById("amayui-emulator-pill")');
    for (let i = 0; i < 15; i++) { await sample('C-expanded', i); await sleep(1000); }

    const runs = binRuns();
    const byPhase = (p) => trace.filter((x) => x.phase.startsWith(p)).map((x) => x.frames).filter((n) => typeof n === 'number');
    const dropsIn = (arr) => { const d = []; for (let i = 1; i < arr.length; i++) if (arr[i] < arr[i - 1]) d.push(`${arr[i - 1]}→${arr[i]}`); return d; };
    const A = byPhase('A'), B = byPhase('B'), C = byPhase('C');
    const dA = dropsIn(A), dB = dropsIn(B), dC = dropsIn(C);
    const marks = Array.from(new Set(trace.map((x) => x.mark).filter(Boolean)));
    verdict = (dB.length > 0 || dC.length > 0) ? 'DROP_IN_COLLAPSE_OR_AFTER' : 'NO_DROP';
    console.log(`\n[coll] A(展开) frames=${A.join(',')} 回落=${dA.join('|') || '无'}`);
    console.log(`[coll] B(收起) frames=${B.join(',')} 回落=${dB.join('|') || '无'}`);
    console.log(`[coll] C(展开) frames=${C.join(',')} 回落=${dC.join('|') || '无'}`);
    console.log(`[coll] iframe 节点：${JSON.stringify(marks)}；bin 段序列=${JSON.stringify(runs)}`);
    console.log(`[coll] 判读：${verdict}`);
    fs.writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify({ verdict, trace, runs, drops: { A: dA, B: dB, C: dC } }, null, 2), 'utf8');
  } catch (err) {
    console.log(`[coll] ✗ ${err && err.stack ? err.stack : err}`);
    verdict = 'ERROR: ' + String(err && err.message);
  } finally {
    try { if (win) win.destroy(); } catch { /* 已经没了 */ }
    try { if (server) server.close(); } catch { /* 已经没了 */ }
    for (const c of children) { try { c.kill('SIGTERM'); } catch { /* 已经没了 */ } }
    await sleep(1000);
    console.log(`[coll] 证据：${path.join(OUT, 'raw.json').replace(REPO + path.sep, '')}`);
    process.exit(0);
  }
})();
