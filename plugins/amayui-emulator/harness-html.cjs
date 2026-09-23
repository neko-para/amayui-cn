'use strict';
/**
 * **浮窗客户端的浏览器 harness 生成器**（`tickets/T-0137`/`T-0138` 的抓帧与端到端驱动共用）。
 *
 * 为什么需要它：`plugins/amayui-emulator/lib/client.js` 是 DSH 的 **client half** —— 它只会在 DSH GUI 里
 * 被 `window.__ModuleLoader__.load(...)` 调起来，`inject` 到 `shell.overlay` 槽。要在**仓库内、零网络**
 * 地把它单独跑起来（截图 / 端到端验证），就必须自己造一个最小宿主页：
 *
 * ```text
 * harness 页面
 *   ├─ React / ReactDOM UMD（仓库本地 node_modules，零下载）
 *   ├─ window.__ModuleLoader__ 桩：跑 factory，require('react') → 全局 React
 *   │    └─ apply(ctx) → 注册 **真** lib/client.js 的 shell.overlay 组件
 *   └─ ★fetch **不桩**：面板真的去请求 /dsh-emulator/api/__instances（要假数据就由调用方自己桩）
 * ```
 *
 * ## 两种取法（由调用方决定；本模块只造 HTML）
 *
 * * `float-shot.cjs`：`file://` 直开 ⇒ `client.js` 里那个绝对的 iframe `src` 会变成
 *   `file:///dsh-emulator/…`，所以它**另外**用 `protocol.handle` 造假响应（只拍面板三态，不需要真实例）。
 * * `float-e2e.cjs`：经 **HTTP** 从自己起的 server 取（`/harness/`）⇒ iframe `src` 落在**真正的插件路由**上，
 *   于是模拟器**真启动**、真跑启动链。两条路的差别只在"页面怎么送到浏览器"，harness 本体是同一份。
 *
 * 用法（调用方）：
 * ```js
 * const { writeHarness } = require('./harness-html.cjs');
 * writeHarness({ outDir, clientJs, title, headline, messages: ['…'] });
 * ```
 * 生成的页面里 React 那两个 UMD 是 `file://` 相对路径（给 `float-shot` 用）；`float-e2e` 走 HTTP 时
 * 由它自己的静态路由把 `/vendor/react.js` 喂给页面（见那边的 `staticMap`），两不冲突。
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * 造 harness 页面的 HTML（**纯函数**，方便将来直接对字符串做断言）。
 *
 * @param {{
 *   title?: string,
 *   headline?: string,
 *   messages?: string[],
 *   reactSrc?: string,
 *   reactDomSrc?: string,
 * }} [opts] `reactSrc`/`reactDomSrc`：React 两个 UMD 的 `<script src>`。**两条取法不同**：
 *   * `file://` 取法（`float-shot.cjs`）：给**相对路径**（`.tmp/float-<name>/` → 仓库根）；
 *   * HTTP 取法（`float-e2e.cjs`）：给**绝对路径** `/vendor/react.js`，由驱动自己的静态路由喂。
 *   ★这正是把 harness 抽出来时踩到的坑：契约不同却共用一个默认值 ⇒ 页面里 `ReactDOM is not defined`。
 */
function harnessHtml(opts = {}) {
  const title = opts.title ?? 'amayui-emulator-view · harness';
  const headline = opts.headline ?? '对话（假内容：浮窗悬在其上、且不推挤布局）';
  const messages = opts.messages ?? [
    'user · 帮我把 TITLE.BIN 跑到主菜单，然后把画面截给我。',
    'agent · 起了一个实例 dbg-a，端口 53819，frames=1234。',
    'user · 再看看 gate 那一步为什么卡住。',
  ];
  // 缺省是 `file://` 取法（相对路径：`.tmp/float-*/` → 仓库根）。
  const react = opts.reactSrc ?? '../../app/amayui-toolkit/node_modules/react/umd/react.development.js';
  const reactDom = opts.reactDomSrc ?? '../../app/amayui-toolkit/node_modules/react-dom/umd/react-dom.development.js';
  return [
    '<!doctype html>',
    `<html lang="zh"><head><meta charset="utf-8"><title>${title}</title>`,
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
    `<div id="conversation"><h1>${headline}</h1>`,
    ...messages.map((m) => `<div class="msg">${m}</div>`),
    '</div>',
    '<div id="root-overlay"></div>',
    `<script src="${react}"></script>`,
    `<script src="${reactDom}"></script>`,
    '<script>',
    '// ---- 共享诊断 ----',
    'window.__ready = false;',
    'window.__errors = [];',
    'window.__slots = [];',
    'window.__comps = {};',
    'window.__fetchLog = [];',
    'window.__markSeq = 0;',
    'window.onerror = function (m, s, l) { window.__errors.push(String(m) + " @" + s + ":" + l); };',
    'window.addEventListener("unhandledrejection", function (e) { window.__errors.push("unhandledrejection: " + String(e.reason && e.reason.message ? e.reason.message : e.reason)); });',
    '// localStorage 必须在 client.js 读之前清掉（默认态 = 收起胶囊）',
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
    '// ---- 2) ★fetch **不桩**：面板真的去请求 /dsh-emulator/api/__instances ----',
    '//    （要假实例列表的驱动请自己在 harness 之外桩掉 fetch；这里只记调用次数供诊断。）',
    'window.__fetchCount = 0;',
    'var __origFetch = window.fetch.bind(window);',
    'window.fetch = function (u, o) {',
    '  window.__fetchCount++;',
    '  window.__fetchLog.push(String(u));',
    '  return __origFetch(u, o);',
    '};',
    '',
    '// ---- 3) 驱动 API（id 点击 / iframe 节点身份 / 一次快照）----',
    'window.__clickById = function (id) {',
    '  var el = document.getElementById(id);',
    '  if (!el) return { ok: false, error: "no #" + id };',
    '  el.click();',
    '  return { ok: true, tag: el.tagName };',
    '};',
    '// iframe DOM 节点身份：首次见到时打一个标记，之后必须一直是同一个（`T-0138` 的核心不变量）',
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

/**
 * 把 harness 落到 `outDir`：拷**真** `lib/client.js` + 写 `index.html`，返回 index.html 的路径。
 *
 * @param {{
 *   outDir: string, clientJs: string, title?: string, headline?: string, messages?: string[],
 *   reactSrc?: string, reactDomSrc?: string,
 * }} o
 */
function writeHarness(o) {
  fs.mkdirSync(o.outDir, { recursive: true });
  fs.copyFileSync(o.clientJs, path.join(o.outDir, 'client.js'));
  const file = path.join(o.outDir, 'index.html');
  fs.writeFileSync(
    file,
    harnessHtml({
      title: o.title,
      headline: o.headline,
      messages: o.messages,
      reactSrc: o.reactSrc,
      reactDomSrc: o.reactDomSrc,
    }),
  );
  return file;
}

module.exports = { harnessHtml, writeHarness };
