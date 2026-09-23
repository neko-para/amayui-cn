'use strict';
/**
 * **常驻浮窗「不重启实例」端到端验证**（`tickets/T-0138` acceptance 7 —— ★端到端证据）。
 *
 * 与 `float-shot.cjs`（假画面 + 假实例列表，只拍三态）不同，本驱动的**每一层都是真的**：
 *
 * ```text
 * Electron 哑窗（show:false）
 *   └─ GET http://127.0.0.1:<srvPort>/harness/            ← 本驱动生成的 harness 页面
 *        ├─ React / ReactDOM 18 UMD（仓库本地安装，零下载）
 *        ├─ window.__ModuleLoader__ 桩：跑 factory，require('react') → 全局 React
 *        │    apply(ctx) → 挂 **真** plugins/amayui-emulator/lib/client.js 的 shell.overlay
 *        ├─ **不桩 fetch** ⇒ 面板真的去 GET /dsh-emulator/api/__instances
 *        └─ <iframe src="/dsh-emulator/e2e/">   ← 真·同源；经插件路由反向代理到实例宿主
 *                                                  ⇒ 模拟器**真启动**（VM 跑在 iframe 页面里）
 * ```
 *
 * 然后**经面板自己的按钮**（`收起` → `展开` → `放大` → `关闭`）来回切两轮，并在每次切换前后采样：
 *
 *  * **宿主进程自己的 stdout/stderr**（落 `.tmp/float-e2e/host.log`）里的启动链标记
 *    `[web] status {"bin":"…"}` —— 断言 TITLE 之后**没有第二条**启动链；
 *  * **注册表心跳**（`.tmp/instances/e2e/instance.json`）里的 `lastStatus.frames` —— 断言不回零、单调不减；
 *  * **页面 DOM** —— 断言任意采样时刻全树**恰好一个** `<iframe>`，且是**同一个 DOM 节点**、`src` 不变。
 *
 * 用法（cwd 必须在 `app/amayui-emulator`，好让 `electron` 与 `tsx` 能解析到）：
 * ```bash
 * npx electron ../../plugins/amayui-emulator/float-e2e.cjs
 * ```
 *
 * ★必须用真 `node`（不能用 `process.execPath`）起实例宿主 —— 本驱动跑在 Electron 里，
 *   `process.execPath` 是 Electron 二进制（见 `e2e-shot.cjs:84-85` 的实测记录）。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Electron 必须在 require 之前挂开关（理由见 tools/debugsrv.cjs:67-75：本机沙箱初始化失败）
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('no-sandbox');

const APP = process.cwd();                                   // app/amayui-emulator
const REPO = path.resolve(APP, '..', '..');
const PLUGIN = path.resolve(REPO, 'plugins', 'amayui-emulator');
const OUT = path.join(REPO, '.tmp', 'float-e2e');
const INSTANCE = 'e2e';
const REG = path.join(REPO, '.tmp', 'instances', INSTANCE, 'instance.json');
const HOST_LOG = path.join(OUT, 'host.log');
const REACT_UMD = path.join(APP, '..', 'amayui-toolkit', 'node_modules', 'react', 'umd', 'react.development.js');
const REACT_DOM_UMD = path.join(APP, '..', 'amayui-toolkit', 'node_modules', 'react-dom', 'umd', 'react-dom.development.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXACT_CMD = 'cd app/amayui-emulator && npx electron ../../plugins/amayui-emulator/float-e2e.cjs';

// ---------------------------------------------------------------------------
// 注册表 / 宿主日志 读取
// ---------------------------------------------------------------------------

/** 读注册表记录（原子写 ⇒ 要么旧要么新；坏文件当没有）。 */
function readReg() {
  try { return JSON.parse(fs.readFileSync(REG, 'utf8')); } catch { return null; }
}
/** 注册表里的 frames（渲染页上报、心跳每 5s 刷新）。 */
function regFrames() {
  const r = readReg();
  return r && r.lastStatus && typeof r.lastStatus.frames === 'number' ? r.lastStatus.frames : null;
}
/** 注册表里的 bin。 */
function regBin() {
  const r = readReg();
  return r && r.lastStatus && typeof r.lastStatus.bin === 'string' ? r.lastStatus.bin : null;
}

/**
 * 从宿主日志里抽 `"bin":"…"` 序列，并折叠连续重复 ⇒ `runs`（一次「进入某支 BIN」算一段）。
 *
 * ★`[web] status` 那行是 `JSON.stringify(...).slice(0, 200)`，`bin` 永远在开头 200 字符内 ⇒ 可靠。
 *   `frames` 在 `perf` 里、被截断 ⇒ frames 一律走注册表心跳，不从日志抠。
 */
function parseBinRuns(text) {
  const re = /"bin":"((?:[^"\\]|\\.)*)"/g;
  const seq = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    try { seq.push(JSON.parse('"' + m[1] + '"')); } catch { seq.push(m[1]); }
  }
  const runs = [];
  for (const b of seq) if (!runs.length || runs[runs.length - 1] !== b) runs.push(b);
  return { seq, runs };
}

/** 每个 bin 名出现次数（原始 status 行数）。 */
function countBins(seq) {
  const counts = {};
  for (const b of seq) counts[b] = (counts[b] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// harness（生成到 .tmp/float-e2e/，不提交）
// ---------------------------------------------------------------------------

/**
 * harness 页面。**经 HTTP 从同一个 server 取**（不是 `file://`）：这样 `client.js` 里那个绝对的
 * `/dsh-emulator/<id>/` iframe `src` 才会落在**真正的插件路由**上（`file://` 下会变成
 * `file:///dsh-emulator/…`，只能靠 `protocol.handle` 造假响应 —— 那正是 `float-shot.cjs` 干的事，
 * 而本驱动要的是**真实例真启动**）。
 */
function harnessHtml() {
  return [
    '<!doctype html>',
    '<html lang="zh"><head><meta charset="utf-8"><title>amayui-emulator-view · float e2e harness</title>',
    '<style>',
    'html,body{margin:0;padding:0;height:100%;background:#101010;color:#ddd;',
    'font:13px/1.6 -apple-system,"Helvetica Neue","PingFang SC",sans-serif;overflow:hidden}',
    '#headerbar{position:relative;z-index:2;display:flex;align-items:center;gap:10px;',
    'padding:8px 14px;background:#181818;border-bottom:1px solid #2a2a2a}',
    '#headerbar .title{color:#888;font-size:12px}',
    '#conversation{padding:16px 22px;overflow:hidden}',
    '#root-overlay{position:fixed;inset:0;pointer-events:none;z-index:1}',
    '</style></head><body>',
    '<div id="headerbar"><span class="title">session header actions →</span><span id="root-header"></span></div>',
    '<div id="conversation"><h1>对话（假内容：浮窗悬在其上）</h1>',
    '<div class="msg">端到端：真实例 e2e、真启动链、真 iframe。</div></div>',
    '<div id="root-overlay"></div>',
    '<script src="/vendor/react.js"></script>',
    '<script src="/vendor/react-dom.js"></script>',
    '<script>',
    'window.__ready = false;',
    'window.__errors = [];',
    'window.__slots = [];',
    'window.__comps = {};',
    'window.__markSeq = 0;',
    'window.onerror = function (m, s, l) { window.__errors.push(String(m) + " @" + s + ":" + l); };',
    'window.addEventListener("unhandledrejection", function (e) { window.__errors.push("unhandledrejection: " + String(e.reason && e.reason.message ? e.reason.message : e.reason)); });',
    '// localStorage 必须在 client.js 读之前清掉（默认态 = 收起胶囊）',
    'try { localStorage.clear(); } catch (e) { window.__lsError = String(e && e.message); }',
    '',
    '// ---- ModuleLoader 桩：真跑 factory，require("react") → 全局 React ----',
    'window.__ModuleLoader__ = {',
    '  load: function (mod) {',
    '    window.__loadedId = mod.id;',
    '    var req = function (name) {',
    '      if (name === "react") return window.React;',
    '      throw new Error("harness: unexpected require(" + name + ")");',
    '    };',
    '    var exports = mod.factory(req);',
    '    window.__moduleExports = { name: exports.name, inject: exports.inject };',
    '    var ctx = {',
    '      slots: {',
    '        inject: function (name, cb) {',
    '          window.__slots.push({ kind: "inject", name: name });',
    '          try { return cb(); } catch (e) { window.__errors.push("inject(" + name + "): " + e.message); return null; }',
    '        },',
    '        register: function (meta, comp) {',
    '          window.__slots.push({ kind: "register", name: meta.name, id: meta.id });',
    '          window.__comps[meta.name] = comp;',
    '          return { dispose: function () {} };',
    '        },',
    '      },',
    '    };',
    '    exports.apply(ctx);',
    '  },',
    '};',
    '',
    '// ---- ★不桩 fetch：面板真的去请求 /dsh-emulator/api/__instances ----',
    'window.__fetchCount = 0;',
    'window.__fetchLog = [];',
    'var __origFetch = window.fetch.bind(window);',
    'window.fetch = function (u, o) {',
    '  window.__fetchCount++;',
    '  window.__fetchLog.push(String(u));',
    '  return __origFetch(u, o);',
    '};',
    '',
    '// ---- 驱动 API ----',
    'window.__clickById = function (id) {',
    '  var el = document.getElementById(id);',
    '  if (!el) return { ok: false, error: "no #" + id };',
    '  el.click();',
    '  return { ok: true, tag: el.tagName };',
    '};',
    '// iframe DOM 节点身份：首次见到时打一个标记，之后必须一直是同一个',
    'window.__markIframe = function () {',
    '  var f = document.querySelector("iframe");',
    '  if (!f) return null;',
    '  if (!f.__e2eMark) f.__e2eMark = "iframe-node-" + (++window.__markSeq);',
    '  return f.__e2eMark;',
    '};',
    'window.__snap = function () {',
    '  var q = function (sel) { return !!document.querySelector(sel); };',
    '  var iframes = Array.prototype.slice.call(document.querySelectorAll("iframe"));',
    '  var vp = document.getElementById("amayui-emulator-viewport");',
    '  var vis = null, pe = null;',
    '  if (vp) { try { vis = getComputedStyle(vp).visibility; pe = getComputedStyle(vp).pointerEvents; } catch (e) {} }',
    '  var rows = Array.prototype.slice.call(document.querySelectorAll("[id^=\\"amayui-emulator-inst-\\"]"));',
    '  return {',
    '    loadedId: window.__loadedId || null,',
    '    moduleExports: window.__moduleExports || null,',
    '    comps: Object.keys(window.__comps),',
    '    fetchCount: window.__fetchCount,',
    '    errors: window.__errors,',
    '    pill: q("#amayui-emulator-pill"),',
    '    panel: q("#amayui-emulator-panel"),',
    '    modal: q("#amayui-emulator-modal"),',
    '    backdrop: q("#amayui-emulator-backdrop"),',
    '    viewport: q("#amayui-emulator-viewport"),',
    '    viewportVisibility: vis,',
    '    viewportPointerEvents: pe,',
    '    iframeCount: iframes.length,',
    '    iframeSrc: iframes.map(function (f) { return f.getAttribute("src"); }),',
    '    iframeMark: window.__markIframe(),',
    '    rowIds: rows.map(function (e) { return e.id; }),',
    '    inner: { w: window.innerWidth, h: window.innerHeight },',
    '  };',
    '};',
    '</' + 'script>',
    '<script src="/harness/client.js"></' + 'script>',
    '<script>',
    '(function () {',
    '  var ovlName = "shell.overlay";',
    '  var ovl = window.__comps[ovlName];',
    '  if (!ovl) window.__errors.push("missing comp for " + ovlName);',
    '  if (ovl) ReactDOM.createRoot(document.getElementById("root-overlay")).render(React.createElement(ovl));',
    '})();',
    'setTimeout(function () { window.__ready = true; }, 300);',
    '</' + 'script>',
    '</body></html>',
  ].join('\n');
}

function writeHarness() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, 'lib', 'client.js'), path.join(OUT, 'client.js'));
  fs.writeFileSync(path.join(OUT, 'index.html'), harnessHtml());
  return path.join(OUT, 'index.html');
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
(async () => {
  const fail = [];
  const results = [];   // { ok, msg, extra } —— 证据文件逐条落
  const samples = [];   // 每次采样：状态 + DOM + 注册表 frames
  const ok = (cond, msg, extra = '') => {
    const c = !!cond;
    results.push({ ok: c, msg, extra: String(extra == null ? '' : extra) });
    console.log(`${c ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`);
    if (!c) fail.push(msg);
    return c;
  };
  let children = [];
  let win = null;
  let hostExited = null;
  let server = null;
  let png = null;
  let runsBefore = null;
  let runsAfter = null;
  let binCounts = {};
  const notes = [];

  try {
    fs.mkdirSync(OUT, { recursive: true });
    writeHarness();
    try { fs.rmSync(HOST_LOG, { force: true }); } catch { /* 首次 */ }

    // ---- 1) 起真实例（必须是真 node；Electron 的 process.execPath 会跑成空转）----
    const logStream = fs.createWriteStream(HOST_LOG, { flags: 'a' });
    const host = spawn(process.env.AMAYUI_NODE || 'node', [
      '--import', 'tsx', 'src/web/host.ts',
      '--instance', INSTANCE, '--port', '0', '--repo-root', REPO,
    ], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(host);
    host.stdout.pipe(logStream);
    host.stderr.pipe(logStream);
    host.on('exit', (code, sig) => { hostExited = { code, sig }; });
    console.log(`[e2e] 实例宿主 pid=${host.pid} → 日志 ${HOST_LOG.replace(REPO + '/', '')}`);

    // 等注册表出现 + `/health` 应答（端口从 instance.json 取）
    let rec = null;
    let health = null;
    for (let i = 0; i < 480; i++) {
      rec = readReg();
      if (rec && rec.port > 0) {
        health = await fetch(`http://127.0.0.1:${rec.port}/health`).then((r) => r.json()).catch(() => null);
        if (health && health.ok === true) break;
      }
      await sleep(250);
    }
    const port = rec && rec.port;
    ok(!!(rec && port > 0), `注册表写出实例记录 ${REG.replace(REPO + '/', '')}`, JSON.stringify(rec && { id: rec.id, pid: rec.pid, port: rec.port }));
    ok(!!(health && health.ok === true && health.instance === INSTANCE), `/health 应答（http://127.0.0.1:${port}/health）`, JSON.stringify(health));
    const startedAt0 = rec && rec.startedAt;
    const pid0 = rec && rec.pid;

    // ---- 2) 插件 host 半挂在真 node:http 上；harness 与 react 也从同一个 server 出 ----
    const { apply } = await import(path.join(PLUGIN, 'lib', 'index.js'));
    let route = null;
    const ctx = {
      webServer: { register(r) { route = r; return () => { route = null; }; } },
      get(k) { return k === 'sandboxPolicy' ? { workspaceRoot: REPO } : undefined; },
      effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    };
    apply(ctx);
    const PREFIX = '/dsh-emulator';
    const staticMap = {
      '/harness/': { file: path.join(OUT, 'index.html'), mime: 'text/html; charset=utf-8' },
      '/harness/index.html': { file: path.join(OUT, 'index.html'), mime: 'text/html; charset=utf-8' },
      '/harness/client.js': { file: path.join(OUT, 'client.js'), mime: 'text/javascript; charset=utf-8' },
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
        const buf = fs.readFileSync(hit.file);
        res.writeHead(200, { 'content-type': hit.mime, 'cache-control': 'no-store' });
        res.end(buf);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e && e.message));
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const srvPort = server.address().port;
    const origin = `http://127.0.0.1:${srvPort}`;
    console.log(`[e2e] 插件路由 + harness 挂在 ${origin}（路由前缀 ${PREFIX}）`);

    // 顺带经插件路由确认 /health 也通（iframe 走的就是这条路）
    const viaPlugin = await fetch(`${origin}${PREFIX}/${INSTANCE}/health`).then((r) => r.json()).catch(() => null);
    ok(!!(viaPlugin && viaPlugin.ok === true && viaPlugin.instance === INSTANCE), `经插件路由 ${PREFIX}/${INSTANCE}/health 也通`, JSON.stringify(viaPlugin && { instance: viaPlugin.instance, port: viaPlugin.port }));

    // ---- 3) 真浏览器打开 harness ----
    await app.whenReady();
    win = new BrowserWindow({
      width: 1280, height: 800, show: false, useContentSize: true,
      backgroundColor: '#101010', webPreferences: { backgroundThrottling: false },
    });
    const consoleErrors = [];
    win.webContents.on('console-message', (...args) => {
      const e = args[0];
      let line = '';
      if (e && typeof e === 'object' && typeof e.message === 'string' && typeof args[1] !== 'string') {
        line = `[${e.level}] ${e.message} @${e.sourceId || ''}:${e.lineNumber || 0}`;
      } else {
        line = `[${args[1]}] ${args[2]} @${args[4] || ''}:${args[3] || 0}`;
      }
      console.log('  [console] ' + line);
      if (/\[(error|3)\]/i.test(line)) consoleErrors.push(line);
    });
    win.webContents.on('render-process-gone', (_e, d) => { consoleErrors.push('render-process-gone ' + JSON.stringify(d)); });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => { consoleErrors.push(`did-fail-load ${code} ${desc} ${url}`); });
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const waitFor = async (pred, tries = 100, gap = 120) => {
      for (let i = 0; i < tries; i++) { const v = await pred(); if (v) return v; await sleep(gap); }
      return null;
    };

    await win.loadURL(`${origin}/harness/`);
    console.log(`[e2e] 已打开 ${origin}/harness/`);

    // 等挂载（默认态 = 收起胶囊）
    const mounted = await waitFor(async () => {
      const s = await js('window.__snap ? window.__snap() : null').catch(() => null);
      return s && (s.pill || s.panel) ? s : null;
    }, 120, 100);
    const boot0 = await js('window.__snap()');
    ok(!!(boot0 && boot0.loadedId === '@amayui/emulator-view'), `ModuleLoader.load 收到 id=${boot0 && boot0.loadedId}`);
    ok(!!(boot0 && boot0.comps && boot0.comps.indexOf('shell.overlay') >= 0), 'shell.overlay 组件已挂载');
    ok(!!(boot0 && boot0.pill), '初始态 = 收起胶囊（pill 在）', JSON.stringify({ pill: boot0 && boot0.pill, panel: boot0 && boot0.panel }));
    ok(!!(mounted && boot0.errors && boot0.errors.length === 0), '页面无 JS 异常', JSON.stringify(boot0 && boot0.errors));

    // 展开：让面板列出实例
    await js('window.__clickById("amayui-emulator-pill")');
    await waitFor(async () => { const s = await js('window.__snap()'); return !s.pill && !s.modal; }, 80, 100);

    // 等实例行出现（面板每 3s 轮询一次真注册表），并显式选中它
    const rowId = 'amayui-emulator-inst-' + INSTANCE;
    const listed = await waitFor(async () => {
      const s = await js('window.__snap()');
      return s.rowIds.indexOf(rowId) >= 0 ? s : null;
    }, 80, 500);
    ok(!!listed, `面板列出活实例 ${INSTANCE}（真 /api/__instances）`, JSON.stringify(listed && listed.rowIds));
    await js(`window.__clickById(${JSON.stringify(rowId)})`);
    await sleep(800);
    const afterSelect = await js('window.__snap()');
    ok(afterSelect.iframeCount === 1, `选中后页面里恰好 1 个 iframe`, `count=${afterSelect.iframeCount} src=${JSON.stringify(afterSelect.iframeSrc)}`);
    ok(afterSelect.iframeSrc[0] === `${PREFIX}/${INSTANCE}/`, `iframe.src 指向真实例`, JSON.stringify(afterSelect.iframeSrc));

    // ---- 4) 等模拟器真的跑到 TITLE（注册表心跳；同时看宿主日志）----
    console.log('\n[e2e] 等实例跑到 TITLE.BIN（注册表心跳 / 宿主日志）…');
    let bootedAt = null;
    for (let i = 0; i < 360; i++) {
      const bin = regBin();
      const fr = regFrames();
      if (bin === 'TITLE.BIN' && typeof fr === 'number' && fr > 0) { bootedAt = { bin, frames: fr, waitedMs: i * 500 }; break; }
      await sleep(500);
    }
    const bootSnap = await js('window.__snap()');
    ok(!!bootedAt, `模拟器跑到 TITLE.BIN（注册表 lastStatus）`, JSON.stringify(bootedAt));
    ok(bootSnap.iframeCount === 1, `跑到 TITLE 时页面里仍恰好 1 个 iframe`, `count=${bootSnap.iframeCount} mark=${bootSnap.iframeMark}`);

    // 记录**切换前**的启动链（这是"初始那一条"）
    await sleep(600);
    const mark0 = await js('window.__markIframe()');
    const logTxt0 = fs.readFileSync(HOST_LOG, 'utf8');
    const parsed0 = parseBinRuns(logTxt0);
    runsBefore = parsed0.runs.slice();
    const iframeSrc0 = bootSnap.iframeSrc[0];
    console.log(`[e2e] 切换前的 bin 段序列 = ${JSON.stringify(runsBefore)}`);

    // ---- 5) 状态序列：收起 → 展开 → 放大 → 关闭 × 2，每步前后采样 ----
    const snap = async (tag) => {
      await sleep(700);
      const s = await js('window.__snap()');
      const r = readReg();
      const st = r && r.lastStatus ? r.lastStatus : {};
      const sample = {
        tag, at: Date.now(),
        pill: s.pill, panel: s.panel, modal: s.modal,
        iframeCount: s.iframeCount,
        iframeSrc: s.iframeSrc,
        iframeMark: s.iframeMark,
        viewportVisibility: s.viewportVisibility,
        viewportPointerEvents: s.viewportPointerEvents,
        frames: typeof st.frames === 'number' ? st.frames : null,
        bin: st.bin || null,
        registryStartedAt: r ? r.startedAt : null,
        registryPid: r ? r.pid : null,
        errors: s.errors.slice(),
      };
      samples.push(sample);
      console.log(`  · ${tag.padEnd(22)} pill=${sample.pill ? 1 : 0} panel=${sample.panel ? 1 : 0} modal=${sample.modal ? 1 : 0} ` +
        `iframe=${sample.iframeCount} mark=${sample.iframeMark} vis=${sample.viewportVisibility} bin=${sample.bin} frames=${sample.frames}`);
      return sample;
    };

    console.log('\n[e2e] ===== 开始状态序列（收起 → 展开 → 放大 → 关闭）×2 =====');
    await snap('baseline-expanded');
    for (let round = 1; round <= 2; round++) {
      // 收起
      const c1 = await js('window.__clickById("amayui-emulator-collapse")');
      if (!c1.ok) notes.push(`round${round} 收起点击失败：${c1.error}`);
      await waitFor(async () => (await js('window.__snap()')).pill, 80, 100);
      await snap(`r${round}-collapsed`);
      // 展开
      const c2 = await js('window.__clickById("amayui-emulator-pill")');
      if (!c2.ok) notes.push(`round${round} 展开点击失败：${c2.error}`);
      await waitFor(async () => { const s = await js('window.__snap()'); return !s.pill && !s.modal; }, 80, 100);
      await snap(`r${round}-expanded`);
      // 放大
      const c3 = await js('window.__clickById("amayui-emulator-maximize")');
      if (!c3.ok) notes.push(`round${round} 放大点击失败：${c3.error}`);
      await waitFor(async () => (await js('window.__snap()')).modal, 80, 100);
      await snap(`r${round}-modal`);
      // 关闭
      const c4 = await js('window.__clickById("amayui-emulator-close")');
      if (!c4.ok) notes.push(`round${round} 关闭点击失败：${c4.error}`);
      await waitFor(async () => { const s = await js('window.__snap()'); return !s.modal && s.panel && !s.pill; }, 80, 100);
      await snap(`r${round}-after-close`);
    }
    // 收尾：停一会儿再采一次，让 frames 明确地往前走
    await sleep(6000);
    const finalSample = await snap('final-settle');

    // ---- 6) 截图 ----
    png = (await win.webContents.capturePage()).toPNG();
    const pngPath = path.join(OUT, 'after-toggles.png');
    fs.writeFileSync(pngPath, png);
    ok(png.length > 20 * 1024, `切换后截图非平凡（${png.length}B）`, pngPath.replace(REPO + '/', ''));

    // ---- 7) 断言 ----
    console.log('\n[e2e] ===== 断言 =====');
    const need = (name, cond, extra = '') => ok(cond, name, extra);

    // 7.1 真的走完了四个状态各两次
    const visits = { collapsed: 0, modal: 0, expanded: 0 };
    for (const s of samples) {
      if (s.pill) visits.collapsed++;
      else if (s.modal) visits.modal++;
      else if (s.panel) visits.expanded++;
    }
    need('状态序列真的走完：收起 / 展开 / 模态各至少 2 次', visits.collapsed >= 2 && visits.expanded >= 2 && visits.modal >= 2, JSON.stringify(visits));

    // 7.2 每一个采样时刻：恰好一个 iframe
    const badCount = samples.filter((s) => s.iframeCount !== 1);
    need('任意采样时刻全树恰好 1 个 <iframe>', badCount.length === 0,
      badCount.length ? JSON.stringify(badCount.map((s) => ({ tag: s.tag, n: s.iframeCount }))) : `${samples.length} 次采样全部 =1`);

    // 7.3 同一个 DOM 节点（节点身份标记不变）
    const marks = Array.from(new Set(samples.map((s) => s.iframeMark)));
    need('iframe 始终是同一个 DOM 节点（节点身份标记不变）', marks.length === 1 && marks[0] != null, JSON.stringify(marks));

    // 7.4 src 不变，且始终指向该实例
    const srcs = Array.from(new Set(samples.map((s) => JSON.stringify(s.iframeSrc))));
    need('iframe.src 全程不变且指向 /dsh-emulator/e2e/', srcs.length === 1 && srcs[0] === JSON.stringify([`${PREFIX}/${INSTANCE}/`]), srcs.join(' | '));
    need('src 与切换前一致', iframeSrc0 === `${PREFIX}/${INSTANCE}/`, `before=${iframeSrc0}`);

    // 7.5 frames 单调不减 + 收尾明确增长（VM 还活着）
    const fr = samples.map((s) => s.frames).filter((n) => typeof n === 'number');
    let mono = true;
    for (let i = 1; i < fr.length; i++) if (fr[i] < fr[i - 1]) mono = false;
    need('frames 采样全程单调不减（不回零）', mono && fr.length >= 3, `samples=[${fr.join(', ')}]`);
    need('frames 在切换后仍在增长（VM 未死）', fr.length >= 2 && fr[fr.length - 1] > fr[0], `first=${fr[0]} last=${fr[fr.length - 1]}`);

    // 7.6 宿主日志：启动链只出现一次；TITLE 之后不得再有启动链
    await sleep(800);
    const logTxt = fs.readFileSync(HOST_LOG, 'utf8');
    const parsed = parseBinRuns(logTxt);
    runsAfter = parsed.runs.slice();
    binCounts = countBins(parsed.seq);
    const nonTitleRuns = parsed.runs.filter((b) => b !== 'TITLE.BIN');
    const firstTitle = parsed.runs.indexOf('TITLE.BIN');
    const afterTitle = firstTitle >= 0 ? parsed.runs.slice(firstTitle + 1).filter((b) => b !== 'TITLE.BIN') : [];
    // 每个非 TITLE 标记的"段数"（连续重复折叠后）
    const markerRuns = {};
    for (const b of nonTitleRuns) markerRuns[b] = (markerRuns[b] || 0) + 1;

    need('宿主日志里出现过 TITLE.BIN（确实启动过）', firstTitle >= 0, `bin 计数=${JSON.stringify(binCounts)}`);
    need('每个启动链标记只出现一段（没有第二次启动）',
      Object.values(markerRuns).every((n) => n === 1),
      JSON.stringify(markerRuns));
    need('第一条 TITLE.BIN 之后没有任何启动链标记（无重引导）', afterTitle.length === 0,
      afterTitle.length ? JSON.stringify(afterTitle) : `TITLE 后只有 TITLE（${parsed.runs.length - 1 - firstTitle} 段重复）`);
    need('切换前后 bin 段序列完全一致（切换没有产生任何新 BIN）',
      JSON.stringify(runsBefore) === JSON.stringify(runsAfter),
      `before=${JSON.stringify(runsBefore)} after=${JSON.stringify(runsAfter)}`);

    // 7.7 实例进程没有重启（pid / startedAt 不变）
    const recEnd = readReg();
    need('宿主进程没有重启（pid/startedAt 不变）',
      !!recEnd && recEnd.pid === pid0 && recEnd.startedAt === startedAt0,
      `pid ${pid0}→${recEnd && recEnd.pid} startedAt ${startedAt0}→${recEnd && recEnd.startedAt}`);
    need('宿主进程全程没有退出', hostExited === null, JSON.stringify(hostExited));

    // 7.8 页面无异常
    need('页面 JS 异常为 0', finalSample.errors.length === 0, JSON.stringify(finalSample.errors));
    need('无 renderer/console 错误', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));

    void finalSample;
  } catch (err) {
    console.log(`\n[e2e] ✗ ${err && err.stack ? err.stack : err}`);
    fail.push(String(err && err.message ? err.message : err));
    results.push({ ok: false, msg: '驱动异常：' + String(err && err.message ? err.message : err), extra: String(err && err.stack || '') });
  } finally {
    try { if (win) win.destroy(); } catch { /* 已经没了 */ }
    try { if (server) server.close(); } catch { /* 已经没了 */ }
    for (const c of children) { try { c.kill('SIGTERM'); } catch { /* 已经没了 */ } }
    await sleep(1500);
    // 等日志流落盘
    await sleep(300);

    // ---- 证据文件 ----
    let logTxt = '';
    try { logTxt = fs.readFileSync(HOST_LOG, 'utf8'); } catch { /* 没有 */ }
    const parsed = parseBinRuns(logTxt);
    const counts = countBins(parsed.seq);
    const uniq = Array.from(new Set(parsed.seq));
    const pngPath = path.join(OUT, 'after-toggles.png');
    const pngBytes = png ? png.length : (fs.existsSync(pngPath) ? fs.statSync(pngPath).size : 0);

    const L = [];
    L.push('# 端到端验证：状态切换不重启实例（T-0138 acceptance 7）');
    L.push('');
    L.push(`日期：${new Date().toISOString().slice(0, 10)}`);
    L.push('');
    L.push('## 命令');
    L.push('');
    L.push('```bash');
    L.push(EXACT_CMD);
    L.push('```');
    L.push('');
    L.push('驱动：`plugins/amayui-emulator/float-e2e.cjs`（Electron 哑窗，`show:false`）。');
    L.push('链路：harness 页面（React UMD + `window.__ModuleLoader__` 桩 + **真** `lib/client.js` 的 `shell.overlay`）');
    L.push('→ **不桩 fetch** 的面板 → 插件路由（`lib/index.js` 的 handler 挂在真 `node:http` 上）');
    L.push(`→ 反向代理 → 真实例 \`${INSTANCE}\`（\`node --import tsx src/web/host.ts --instance ${INSTANCE} --port 0\`）。`);
    L.push('');
    L.push('## 逐条断言');
    L.push('');
    for (const r of results) L.push(`- ${r.ok ? '✓ PASS' : '✗ FAIL'}  ${r.msg}${r.extra ? `  \`${r.extra}\`` : ''}`);
    L.push('');
    L.push(`**合计：${results.filter((r) => r.ok).length}/${results.length} 通过${fail.length ? `，失败 ${fail.length} 项` : ''}。**`);
    L.push('');
    L.push('## 宿主日志里的启动链计数');
    L.push('');
    L.push(`宿主进程 stdout/stderr：\`${HOST_LOG.replace(REPO + '/', '')}\`（真实例自己的日志）。`);
    L.push('');
    L.push('`[web] status {"bin":…}` 里各 BIN 的**原始出现次数**：');
    L.push('');
    L.push('```text');
    for (const b of Object.keys(counts)) L.push(`${String(counts[b]).padStart(5)} "bin":"${b}"`);
    L.push('```');
    L.push('');
    L.push(`观察到的**不同** BIN：${uniq.map((b) => `\`${b}\``).join(', ')}`);
    L.push('');
    L.push('折叠连续重复后的**段序列**（一次「进入某支 BIN」= 一段）：');
    L.push('');
    L.push('```text');
    L.push(`切换前：${JSON.stringify(runsBefore)}`);
    L.push(`切换后：${JSON.stringify(runsAfter || parsed.runs)}`);
    L.push('```');
    L.push('');
    const ft = parsed.runs.indexOf('TITLE.BIN');
    const afterTitle = ft >= 0 ? parsed.runs.slice(ft + 1).filter((b) => b !== 'TITLE.BIN') : [];
    L.push(`第一条 \`TITLE.BIN\` 之后的**启动链标记**：${afterTitle.length === 0 ? '**0 条**（只有 TITLE 自身在重复）' : JSON.stringify(afterTitle)}`);
    L.push('');
    L.push('## frames 采样（注册表心跳 `lastStatus.frames`）');
    L.push('');
    L.push('| # | 采样点 | 状态 | iframe 数 | iframe 节点 | 容器 visibility | bin | frames |');
    L.push('|---|--------|------|-----------|-------------|-----------------|-----|--------|');
    samples.forEach((s, i) => {
      const st = s.pill ? '收起' : (s.modal ? '模态' : '展开');
      L.push(`| ${i + 1} | ${s.tag} | ${st} | ${s.iframeCount} | ${s.iframeMark} | ${s.viewportVisibility} | ${s.bin} | ${s.frames} |`);
    });
    L.push('');
    const fr = samples.map((s) => s.frames).filter((n) => typeof n === 'number');
    L.push(`frames 序列：\`[${fr.join(', ')}]\`（first=${fr[0]}，last=${fr[fr.length - 1]}，单调不减=${fr.every((n, i) => i === 0 || n >= fr[i - 1])}）`);
    L.push('');
    L.push('## 截图');
    L.push('');
    L.push(`\`${pngPath}\`（${pngBytes}B；必须在 \`.tmp/\` 下，**不提交**）`);
    L.push('');
    if (notes.length) {
      L.push('## 驱动备注');
      L.push('');
      for (const n of notes) L.push(`- ${n}`);
      L.push('');
    }
    L.push('## 判读');
    L.push('');
    if (fail.length === 0) {
      L.push(`**通过。** 收起 → 展开 → 放大 → 关闭来回切了两轮（${samples.length} 次采样），期间：`);
      L.push(`① 宿主 stdout 里那条启动链（${JSON.stringify(runsAfter || parsed.runs)}）**只出现一次**，`);
      L.push(`第一条 \`TITLE.BIN\` 之后再无任何 \`LOADCONFIG/SKINIT/ALINIT/EBINIT/CONFIG1\` 形态的重引导标记；`);
      L.push(`② 注册表心跳里的 \`frames\` 全程单调不减（\`${fr[0]}\` → \`${fr[fr.length - 1]}\`）⇒ VM 一直在跑，没死也没重来；`);
      L.push(`③ 每次采样全树都**恰好一个** \`<iframe>\`，且是**同一个 DOM 节点**（\`${samples[0] && samples[0].iframeMark}\`）、\`src\` 恒为 \`/dsh-emulator/${INSTANCE}/\`；`);
      L.push(`④ 宿主进程 pid / \`startedAt\` 不变，切换前后 bin 段序列逐字相同。`);
      L.push('三态共用同一个 iframe 的不变量在**真实例、真 VM、真启动链**上成立 ⇒ 「放大 / 收起 会重启实例」这个 P0 缺陷已修复。');
    } else {
      L.push(`**失败 ${fail.length} 项。** 未通过：`);
      for (const f of fail) L.push(`- ${f}`);
      L.push('');
      L.push('⇒ 不能声称 no-reboot 性质成立；详见上面逐条断言与宿主日志。');
    }
    L.push('');

    const evDir = path.join(REPO, 'tickets', 'T-0138', 'evidence');
    fs.mkdirSync(evDir, { recursive: true });
    const evPath = path.join(evDir, 'no-reboot-e2e.txt');
    fs.writeFileSync(evPath, L.join('\n'), 'utf8');

    console.log('\n[e2e] ---- 宿主日志里的 bin 计数 ----');
    for (const b of Object.keys(counts)) console.log(`  ${String(counts[b]).padStart(5)} "bin":"${b}"`);
    console.log(`[e2e] 段序列：${JSON.stringify(runsAfter || parsed.runs)}`);
    console.log(`[e2e] frames： [${fr.join(', ')}]`);
    console.log(`[e2e] 截图：${pngPath.replace(REPO + '/', '')}  ${pngBytes}B`);
    console.log(`[e2e] 证据：${evPath.replace(REPO + '/', '')}`);
    if (notes.length) for (const n of notes) console.log(`[e2e] 备注：${n}`);

    console.log(`\n[e2e] SUMMARY ${fail.length === 0 ? 'PASS' : 'FAIL'} ${results.filter((r) => r.ok).length}/${results.length} assertions, ` +
      `bootChainRuns=${(runsAfter || parsed.runs).length}, titleCount=${counts['TITLE.BIN'] || 0}, ` +
      `frames=${fr.length ? `${fr[0]}->${fr[fr.length - 1]}` : 'n/a'}, samples=${samples.length}, png=${pngBytes}B` +
      `${fail.length ? `, failures=${JSON.stringify(fail)}` : ''}`);

    process.exit(fail.length === 0 ? 0 : 1);
  }
})();
