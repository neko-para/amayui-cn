'use strict';
/**
 * **常驻浮窗的三态实拍**（`tickets/T-0137` acceptance 9）。
 *
 * `lib/client.js` 是 DSH 的 **client half**：它只会在 DSH GUI 里被 `window.__ModuleLoader__.load(...)`
 * 加载。这个探针把它**单独**放进一个真浏览器（Electron 哑窗，`show:false`）里跑：
 *
 * ```text
 * Electron 哑窗（file:///…/.tmp/float-harness/index.html）
 *   ├─ React / ReactDOM 18 UMD（仓库本地安装，零下载）
 *   ├─ window.__ModuleLoader__ 桩：跑 factory，require('react') → 全局 React
 *   │    apply(ctx) → ctx.slots.inject/register → window.__comps[slotName]
 *   ├─ window.fetch 桩：GET /dsh-emulator/api/__instances → 两个假实例
 *   ├─ <script src="client.js">：**真** plugins/amayui-emulator/lib/client.js（生成时拷贝）
 *   └─ 两个 slot 组件分别挂进 #root-header / #root-overlay
 * ```
 *
 * 然后截三张图（默认胶囊 / 展开浮窗 / 「放大」模态），落 `.tmp/float-harness/`。
 * `file:///dsh-emulator/<id>/` 的 iframe 请求由 `protocol.handle('file', …)` 用一张假"模拟器画面"
 * 顶上——**这只是在驱动侧造同源假响应**，`lib/client.js` 一个字节都不改。
 *
 * 用法（cwd 必须在 `app/amayui-emulator`，好让 `electron` 能解析到）：
 * ```bash
 * cd app/amayui-emulator && npx electron ../../plugins/amayui-emulator/float-shot.cjs
 * ```
 */
const fs = require('node:fs');
const path = require('node:path');

// Electron 必须在 require 之前挂开关（理由见 tools/debugsrv.cjs:67-75：本机沙箱初始化失败）
const { app, BrowserWindow, protocol } = require('electron');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('no-sandbox');

const APP = process.cwd();                                   // app/amayui-emulator
const REPO = path.resolve(APP, '..', '..');
const PLUGIN = path.resolve(REPO, 'plugins', 'amayui-emulator');
const OUT = path.join(REPO, '.tmp', 'float-harness');
const PORT_A = 53819;
const PORT_B = 41111;
const MIN_PNG = 20 * 1024;                                   // "非平凡"下限
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 生成的 harness（不手维护；每次运行重写）
// ---------------------------------------------------------------------------

/** 假"模拟器画面"：给 iframe 的 `/dsh-emulator/<id>/` 当同源响应，1278×718 深色屏。 */
function fakeScreenHtml(id) {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>' + id + '</title><style>',
    'html,body{margin:0;height:100%;background:#0b0f14;color:#9fd6a0;',
    'font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;overflow:hidden}',
    '.bar{height:26px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#161c24;border-bottom:1px solid #24303c;color:#cfe8cf}',
    '.dot{width:8px;height:8px;border-radius:4px;background:#3ddc84}',
    '.body{position:absolute;inset:26px 0 0 0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px}',
    '.big{font-size:26px;letter-spacing:3px;color:#e6d9a8}',
    '.sub{color:#7d8b99}',
    '</style></head><body>',
    '<div class="bar"><span class="dot"></span><b>' + id + '</b><span>· 天結いキャッスルマイスター</span>',
    '<span style="margin-left:auto">1280×720</span></div>',
    '<div class="body"><div class="big">FAKE EMULATOR SCREEN</div>',
    '<div class="sub">instance ' + id + ' · viewport 1280×720 (scaled by CSS transform)</div>',
    '<div class="sub">this iframe stands in for GET /dsh-emulator/' + id + '/</div></div>',
    '</body></html>',
  ].join('');
}

/** harness 页面：React UMD + ModuleLoader 桩 + fetch 桩 + 真 client.js + 挂载。 */
function harnessHtml() {
  // 相对路径：.tmp/float-harness/ → 仓库根
  const react = '../../app/amayui-toolkit/node_modules/react/umd/react.development.js';
  const reactDom = '../../app/amayui-toolkit/node_modules/react-dom/umd/react-dom.development.js';
  return [
    '<!doctype html>',
    '<html lang="zh"><head><meta charset="utf-8"><title>amayui-emulator-view · float harness</title>',
    '<style>',
    'html,body{margin:0;padding:0;height:100%;background:#101010;color:#ddd;',
    'font:13px/1.6 -apple-system,"Helvetica Neue","PingFang SC",sans-serif;overflow:hidden}',
    '#headerbar{position:relative;z-index:2;display:flex;align-items:center;gap:10px;',
    'padding:8px 14px;background:#181818;border-bottom:1px solid #2a2a2a}',
    '#headerbar .title{color:#888;font-size:12px}',
    '#conversation{padding:16px 22px;overflow:hidden}',
    '#conversation h1{font-size:14px;margin:0 0 10px;color:#cfcfcf;font-weight:600}',
    '.msg{max-width:720px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;',
    'padding:8px 10px;margin-bottom:8px;color:#bbb}',
    '.who{color:#7fb3ff}',
    '#root-overlay{position:fixed;inset:0;pointer-events:none;z-index:1}',
    '</style></head><body>',
    '<div id="headerbar"><span class="title">session header actions →</span><span id="root-header"></span></div>',
    '<div id="conversation">',
    '<h1>对话（假内容：用来证明浮窗悬在内容之上、且不推挤布局）</h1>',
    '<div class="msg"><span class="who">user ·</span> 帮我把 TITLE.BIN 跑到主菜单，然后把画面截给我。</div>',
    '<div class="msg"><span class="who">agent ·</span> 起了一个实例 dbg-a，端口 53819，frames=1234。</div>',
    '<div class="msg"><span class="who">user ·</span> 再看看 gate 那一步为什么卡住。</div>',
    '<div class="msg"><span class="who">agent ·</span> dbg-b 心跳 4s 前还在，但没人附渲染页，命令会 503。</div>',
    '<div class="msg"><span class="who">user ·</span> 好，调试画面浮窗收在右下角就行，别挡住正文。</div>',
    '<div class="msg"><span class="who">agent ·</span> 收到——它是 shell.overlay 上的常驻浮窗，pointer-events 只加在自己容器上。</div>',
    '<div class="msg"><span class="who">user ·</span> 展开、放大两个状态也都截一张。</div>',
    '<div class="msg"><span class="who">agent ·</span> 三态：胶囊（默认）/ 浮窗（列表 + 640×360 画面）/ 模态（放大）。</div>',
    '</div>',
    '<div id="root-overlay"></div>',
    '<script src="' + react + '"></script>',
    '<script src="' + reactDom + '"></script>',
    '<script>',
    '// ---- 共享诊断 ----',
    'window.__ready = false;',
    'window.__errors = [];',
    'window.__slots = [];',
    'window.__comps = {};',
    'window.__fetchLog = [];',
    'window.onerror = function (m, s, l) { window.__errors.push(String(m) + " @" + s + ":" + l); };',
    'window.addEventListener("unhandledrejection", function (e) { window.__errors.push("unhandledrejection: " + String(e.reason && e.reason.message ? e.reason.message : e.reason)); });',
    'try { localStorage.clear(); } catch (e) { window.__lsError = String(e && e.message); }',
    '',
    '// ---- 1) ModuleLoader 桩：真跑 factory，require("react") → 全局 React ----',
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
    '          window.__slots.push({ kind: "register", name: meta.name, id: meta.id, order: meta.order });',
    '          window.__comps[meta.name] = comp;',
    '          return { dispose: function () {} };',
    '        },',
    '      },',
    '    };',
    '    exports.apply(ctx);',
    '  },',
    '};',
    '',
    '// ---- 2) fetch 桩：只答 GET /dsh-emulator/api/__instances ----',
    'var NOW = Date.now();',
    'window.__instancesPayload = {',
    '  instances: [',
    '    { id: "dbg-a", port: ' + PORT_A + ', startedAt: NOW - 95000, heartbeatAt: NOW, bin: "TITLE.BIN", frames: 1234, gate: "" },',
    '    { id: "dbg-b", port: ' + PORT_B + ', startedAt: NOW - 200000, heartbeatAt: NOW - 4000 },',
    '  ],',
    '};',
    'window.fetch = function (url, opts) {',
    '  var u = String(url);',
    '  window.__fetchLog.push(u);',
    '  if (u.indexOf("/dsh-emulator/api/__instances") >= 0) {',
    '    return Promise.resolve({ ok: true, status: 200, url: u,',
    '      json: function () { return Promise.resolve(window.__instancesPayload); },',
    '      text: function () { return Promise.resolve(JSON.stringify(window.__instancesPayload)); } });',
    '  }',
    '  return Promise.resolve({ ok: false, status: 404, url: u,',
    '    json: function () { return Promise.resolve(null); }, text: function () { return Promise.resolve(""); } });',
    '};',
    '',
    '// ---- 3) 驱动 API ----',
    'window.__all = function () { return Array.prototype.slice.call(document.querySelectorAll("*")); };',
    'window.__textOf = function (el) { return (el.textContent || "").replace(/\\s+/g, " ").trim(); };',
    'window.__resolveByText = function (t) {',
    '  var els = window.__all().filter(function (e) {',
    '    var tag = e.tagName;',
    '    return (tag === "BUTTON" || tag === "A" || tag === "DIV") && window.__textOf(e).indexOf(t) >= 0;',
    '  });',
    '  if (!els.length) return { ok: false, error: "no element containing " + JSON.stringify(t) };',
    '  var exact = els.filter(function (e) { return window.__textOf(e) === t; });',
    '  var pool = exact.length ? exact : els;',
    '  var depth = function (e) { var d = 0, p = e; while (p && p.parentElement) { d++; p = p.parentElement; } return d; };',
    '  // 点最"里"的那个可点元素：优先 BUTTON/A，其次最深（避免点到包住按钮的布局 div）',
    '  pool.sort(function (a, b) {',
    '    var ac = (a.tagName === "BUTTON" || a.tagName === "A") ? 1 : 0;',
    '    var bc = (b.tagName === "BUTTON" || b.tagName === "A") ? 1 : 0;',
    '    if (ac !== bc) return bc - ac;',
    '    return depth(b) - depth(a);',
    '  });',
    '  var target = pool[0];',
    '  window.__resolveTarget = target;',
    '  return { ok: true, matches: els.length, tag: target.tagName, id: target.id || "", text: window.__textOf(target).slice(0, 40) };',
    '};',
    'window.__clickByText = function (t) {',
    '  var r = window.__resolveByText(t);',
    '  if (!r.ok) return r;',
    '  window.__resolveTarget.click();',
    '  return r;',
    '};',
    'window.__clickById = function (id) {',
    '  var el = document.getElementById(id);',
    '  if (!el) return { ok: false, error: "no #" + id };',
    '  el.click();',
    '  return { ok: true };',
    '};',
    'window.__state = function () {',
    '  var q = function (sel) { return !!document.querySelector(sel); };',
    // ★id 是 `amayui-emulator-viewport`（`T-0138` 把承载唯一 iframe 的容器从旧名 `-viewbox`
    //   改成了承担定位/可见性的 `-viewport`）—— 这里**必须**跟着改，否则 `viewbox` 恒为 null、
    //   而依赖它的断言（画面框 640×360）会**静默空转**（`!!null === false` 直接红，或者被
    //   `s2.viewbox &&` 短路成假过）。本文件在 2026-09-23 就是带着这个 stale id 的。
    '  var box = document.getElementById("amayui-emulator-viewport");',
    '  var r = box ? box.getBoundingClientRect() : null;',
    '  var pill = document.getElementById("amayui-emulator-pill");',
    '  var pr = pill ? pill.getBoundingClientRect() : null;',
    '  var panel = document.getElementById("amayui-emulator-panel");',
    '  var wr = panel ? panel.getBoundingClientRect() : null;',
    '  return {',
    '    loadedId: window.__loadedId || null,',
    '    moduleExports: window.__moduleExports || null,',
    '    slots: window.__slots,',
    '    comps: Object.keys(window.__comps),',
    '    fetchCount: window.__fetchLog.length,',
    '    fetchLast: window.__fetchLog[window.__fetchLog.length - 1] || null,',
    '    errors: window.__errors,',
    '    lsError: window.__lsError || null,',
    '    pill: q("#amayui-emulator-pill"),',
    '    panel: q("#amayui-emulator-panel"),',
    '    modal: q("#amayui-emulator-modal"),',
    '    iframe: q("#amayui-emulator-viewport iframe"),',
    '    viewbox: r ? { w: Math.round(r.width), h: Math.round(r.height), cw: box.clientWidth, ch: box.clientHeight, x: Math.round(r.left), y: Math.round(r.top) } : null,',
    '    pillRect: pr ? { x: Math.round(pr.left), y: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) } : null,',
    '    panelRect: wr ? { x: Math.round(wr.left), y: Math.round(wr.top), w: Math.round(wr.width), h: Math.round(wr.height) } : null,',
    '    viewport: { w: window.innerWidth, h: window.innerHeight },',
    '  };',
    '};',
    '</' + 'script>',
    '<script src="client.js"></' + 'script>',
    '<script>',
    '// ---- 4) 挂载两个 slot ----',
    '(function () {',
    '  var hdrName = "conversation.session.header.actions";',
    '  var ovlName = "shell.overlay";',
    '  var hdr = window.__comps[hdrName];',
    '  var ovl = window.__comps[ovlName];',
    '  if (!hdr) window.__errors.push("missing comp for " + hdrName);',
    '  if (!ovl) window.__errors.push("missing comp for " + ovlName);',
    '  if (hdr) ReactDOM.createRoot(document.getElementById("root-header")).render(React.createElement(hdr));',
    '  if (ovl) ReactDOM.createRoot(document.getElementById("root-overlay")).render(React.createElement(ovl));',
    '})();',
    'var __ticks = 0;',
    'var __iv = setInterval(function () {',
    '  __ticks++;',
    '  var has = !!document.getElementById("amayui-emulator-pill") || !!document.getElementById("amayui-emulator-panel");',
    '  if ((has && __ticks > 4) || __ticks > 120) { clearInterval(__iv); window.__ready = true; }',
    '}, 50);',
    '</' + 'script>',
    '</body></html>',
  ].join('\n');
}

function writeHarness() {
  fs.mkdirSync(OUT, { recursive: true });
  const src = path.join(PLUGIN, 'lib', 'client.js');
  const dst = path.join(OUT, 'client.js');
  fs.copyFileSync(src, dst);
  fs.writeFileSync(path.join(OUT, 'index.html'), harnessHtml());
  return { src, dst, html: path.join(OUT, 'index.html') };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
(async () => {
  const fail = [];
  const logs = [];
  const ok = (cond, msg, extra = '') => {
    console.log(`${cond ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`);
    if (!cond) fail.push(msg);
  };
  const shots = {};

  const files = writeHarness();
  console.log(`[float] harness → ${files.html}`);
  console.log(`[float] client.js 拷贝自 ${files.src.replace(REPO + '/', '')}`);

  try {
    await app.whenReady();

    // `/dsh-emulator/<id>/` 的 iframe 请求：驱动侧造同源假响应（client.js 不改）
    protocol.handle('file', async (req) => {
      const u = new URL(req.url);
      if (u.pathname.startsWith('/dsh-emulator/')) {
        const id = decodeURIComponent(u.pathname.split('/')[2] || 'instance');
        return new Response(fakeScreenHtml(id), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      const abs = decodeURIComponent(u.pathname);
      const ext = path.extname(abs).toLowerCase();
      const mime = ext === '.html' ? 'text/html; charset=utf-8'
        : ext === '.js' ? 'text/javascript; charset=utf-8'
          : ext === '.json' ? 'application/json; charset=utf-8'
            : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
      try {
        const buf = fs.readFileSync(abs);
        return new Response(buf, { headers: { 'content-type': mime } });
      } catch (e) {
        return new Response('not found: ' + abs, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    });

    const win = new BrowserWindow({
      width: 1280, height: 800, show: false, useContentSize: true,
      backgroundColor: '#101010',
      webPreferences: { backgroundThrottling: false },
    });
    win.webContents.on('console-message', (...args) => {
      const e = args[0];
      if (e && typeof e === 'object' && typeof e.message === 'string' && typeof args[1] !== 'string') {
        logs.push(`[${e.level}] ${e.message} @${e.sourceId || ''}:${e.lineNumber || 0}`);
      } else {
        logs.push(`[${args[1]}] ${args[2]} @${args[4] || ''}:${args[3] || 0}`);
      }
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      logs.push(`[render-process-gone] ${JSON.stringify(d)}`);
      fail.push('render-process-gone');
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      logs.push(`[did-fail-load] ${code} ${desc} ${url}`);
    });
    win.webContents.on('preload-error', (_e, p, err) => logs.push(`[preload-error] ${p} ${err && err.message}`));

    await win.loadURL('file://' + files.html);
    console.log('[float] 已打开 file://' + files.html);

    // ---- 等挂载 ----
    const js = (code) => win.webContents.executeJavaScript(code, true);
    // ★临时诊断：这一页到底有没有跑内联脚本、有没有 JS 异常（`T-0138` 之后本文件曾整页失败过）。
    const boot = await js('({ url: location.href, hasState: typeof window.__state, hasAll: typeof window.__all, errs: window.__errors || null, keys: Object.keys(window).filter(function (k) { return k.indexOf("__") === 0; }).sort() })').catch((e) => ({ probeError: String(e && e.message) }));
    console.log('[float] 载入后探针 = ' + JSON.stringify(boot));
    let state = null;
    for (let i = 0; i < 160; i++) {
      state = await js('window.__state ? window.__state() : null').catch(() => null);
      if (state && state.pill) break;
      await sleep(100);
    }
    state = await js('window.__state()');
    console.log('\n[float] window.__state() = ' + JSON.stringify(state, null, 2));

    const regs = (state.slots || []).filter((s) => s.kind === 'register').map((s) => s.name);
    ok(state.loadedId === '@amayui/emulator-view', `ModuleLoader.load 收到 id=${state.loadedId}`);
    ok(!!state.moduleExports && state.moduleExports.name === 'amayui-emulator-view' && Array.isArray(state.moduleExports.inject) && state.moduleExports.inject.indexOf('slots') >= 0,
      `factory 返回 { name, inject, apply }（name=${state.moduleExports && state.moduleExports.name}, inject=${JSON.stringify(state.moduleExports && state.moduleExports.inject)}）`);
    ok(regs.indexOf('conversation.session.header.actions') >= 0, 'slot 注册：conversation.session.header.actions');
    ok(regs.indexOf('shell.overlay') >= 0, 'slot 注册：shell.overlay');
    ok(state.fetchCount > 0 && String(state.fetchLast).indexOf('/dsh-emulator/api/__instances') >= 0,
      `面板轮询了 ${state.fetchLast}（共 ${state.fetchCount} 次）`);
    ok(state.errors.length === 0, '页面无 JS 异常', JSON.stringify(state.errors));
    ok(!!state.pill && !state.panel && !state.modal, '默认态 = 收起胶囊（无 panel/无 modal）', JSON.stringify(state.pillRect));
    ok(!!state.pillRect && state.pillRect.x > 1100 && state.pillRect.y > 700,
      `胶囊在右下角 fixed 定位`, JSON.stringify(state.pillRect));

    const grab = async (name, file) => {
      const png = (await win.webContents.capturePage()).toPNG();
      const p = path.join(OUT, file);
      fs.writeFileSync(p, png);
      shots[name] = { path: p, bytes: png.length };
      ok(png.length > MIN_PNG, `${name} 截图非平凡（${png.length}B > ${MIN_PNG}B）`, 'file=' + file);
      return png;
    };

    // ---- 态 1：收起胶囊 ----
    console.log('\n[float] ===== 态 1：收起胶囊 =====');
    await sleep(700);
    await grab('collapsed', 'panel-1-collapsed.png');
    const s1 = await js('window.__state()');
    console.log('[float] state1 = ' + JSON.stringify({ pill: s1.pill, panel: s1.panel, modal: s1.modal, pillRect: s1.pillRect, viewport: s1.viewport }));

    // ---- 态 2：点胶囊展开 ----
    console.log('\n[float] ===== 态 2：展开浮窗 =====');
    const probePill = await js('window.__resolveByText("🖥")');
    console.log('[float] __resolveByText("🖥") 会点到 → ' + JSON.stringify(probePill));
    const clickPill = await js('window.__clickById("amayui-emulator-pill")');
    console.log('[float] click #amayui-emulator-pill → ' + JSON.stringify(clickPill));
    for (let i = 0; i < 60; i++) {
      const s = await js('window.__state()');
      if (s.panel) break;
      await sleep(100);
    }
    await sleep(1200);                       // 给 iframe 一点加载时间
    const s2 = await js('window.__state()');
    ok(s2.panel && !s2.pill, '点胶囊 → 展开浮窗（panel 在，pill 不在）');
    ok(s2.iframe, '浮窗里挂上了 iframe');
    await grab('expanded', 'panel-2-expanded.png');
    console.log('[float] state2 = ' + JSON.stringify({ panel: s2.panel, pill: s2.pill, modal: s2.modal, iframe: s2.iframe, panelRect: s2.panelRect, viewbox: s2.viewbox }, null, 2));
    ok(!!s2.viewbox && s2.viewbox.cw === 640 && s2.viewbox.ch === 360,
      `画面框内容区 640×360（scale 0.5；getBoundingClientRect 含 1px 边框 → ${s2.viewbox && s2.viewbox.w}×${s2.viewbox && s2.viewbox.h}）`,
      JSON.stringify(s2.viewbox));

    // ---- 态 3：「放大」→ 模态 ----
    console.log('\n[float] ===== 态 3：模态 =====');
    const clickMax = await js('window.__clickByText("放大")');
    console.log('[float] __clickByText("放大") → ' + JSON.stringify(clickMax));
    for (let i = 0; i < 60; i++) {
      const s = await js('window.__state()');
      if (s.modal) break;
      await sleep(100);
    }
    await sleep(900);
    const s3 = await js('window.__state()');
    ok(s3.modal, '点「放大」→ 模态出现');
    ok(s3.iframe, '模态里也有画面 iframe');
    await grab('modal', 'panel-3-modal.png');
    console.log('[float] state3 = ' + JSON.stringify({ modal: s3.modal, panel: s3.panel, iframe: s3.iframe, viewbox: s3.viewbox }, null, 2));

    // ---- 关闭模态 → 回到浮窗（T-0137 的关键回归）----
    const close = await js('window.__clickByText("关闭")');
    console.log('\n[float] __clickByText("关闭") → ' + JSON.stringify(close));
    await sleep(500);
    const s4 = await js('window.__state()');
    ok(s4.panel && !s4.modal && !s4.pill, '关模态 → 回到浮窗（不是什么都不剩）', JSON.stringify({ panel: s4.panel, modal: s4.modal, pill: s4.pill }));

    const finalErr = await js('window.__state()');
    console.log('\n[float] 结束时 page errors = ' + JSON.stringify(finalErr.errors));

    await win.destroy();
  } catch (err) {
    console.log(`\n[float] ✗ ${err && err.stack ? err.stack : err}`);
    fail.push(String(err && err.message ? err.message : err));
  } finally {
    console.log('\n[float] ---- console-message / 进程事件 ----');
    if (!logs.length) console.log('  (无)');
    for (const l of logs) console.log('  ' + l);
    const bad = logs.filter((l) => /\[(error|3)\]/i.test(l) || /render-process-gone/.test(l));
    console.log(`[float] console 错误 ${bad.length} 条`);

    console.log('\n[float] ---- 三张 PNG ----');
    for (const k of ['collapsed', 'expanded', 'modal']) {
      const s = shots[k];
      if (!s) { console.log(`  ✗ ${k}: 缺失`); fail.push(`missing shot ${k}`); continue; }
      console.log(`  ${s.bytes > MIN_PNG ? '✓' : '✗'} ${k}: ${s.path}  ${s.bytes}B  (${(s.bytes / 1024).toFixed(1)} KB)`);
    }

    console.log(`\n[float] ${fail.length === 0 ? '全部通过 ✅' : `失败 ${fail.length} 项 ❌ → ${fail.join(' | ')}`}`);
    console.log(`[float] 产物目录 ${OUT}`);
    app.exit(fail.length === 0 ? 0 : 1);
  }
})();
