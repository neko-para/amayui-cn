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
const { pathToFileURL } = require('node:url');

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

/**
 * 每个 bin 名出现次数（原始 status 行数）。 */
function countBins(seq) {
  const counts = {};
  for (const b of seq) counts[b] = (counts[b] || 0) + 1;
  return counts;
}

/**
 * 从宿主日志里按**观察者序号**拆出各自的 `frames` 序列（`tickets/T-0140` 的 `obs=#N` 字段）。
 *
 * ★为什么必须按来源拆：注册表心跳里的 `frames` 是"最后一个上报者"的值 ⇒ 两个页面附着时
 *   **两套计数器交错**，单看那一条曲线会以为"一个 VM 的 frames 掉回去了"（`T-0138` 实跑踩过：
 *   `… 402, 35, …` 其实是两个页面各报各的）。拆开之后每个页面自己的计数器是否单调一目了然。
 */
function framesByObserver(text) {
  const re = /\[web\] status obs=#(\d+|\?) frames=(\d+|\?)/g;
  const out = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = m[1];
    if (m[2] === '?') continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(Number(m[2]));
  }
  return out;
}

/**
 * `needle` 是否作为**连续子序列**出现在 `hay` 里（`needle` 为空 ⇒ `true`）。
 *
 * ★为什么"连续"是关键：本驱动要区分的是「同一次启动里重复进入了某支 BIN」与
 *   「页面被卸载后又从头走了一遍启动链」。只有**连续**重现那段**首尾相接的**启动链
 *   （`WDINIT → IMINIT → EBINIT …` 一个接一个）才证明页面重载了；单独某个 BIN 名字
 *   再次出现完全可能只是引擎自己的流程（实测：正常启动就会进两次 `WDINIT`/`EBINIT`）。
 */
function containsRun(hay, needle) {
  if (!needle.length) return true;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let all = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { all = false; break; }
    if (all) return true;
  }
  return false;
}

/**
 * **最长**的"真的又连续出现了一遍"的启动链前缀长度（`0` = 没有重现）。
 *
 * 前提：`prefix` = 基线时刻就已经记下的「启动链」段序列（`TITLE.BIN` 之前的那些），
 * `tail` = 基线**之后**新出现的段序列。重载会让 `prefix` 的一段从头接一遍 ⇒ 取最长的那个。
 * 取"最长"而不是"第一个"是为了把同一处证据说满，不是为了放宽。
 */
function longestRepeatedChain(prefix, tail) {
  let n = 0;
  for (let len = 1; len <= prefix.length; len++) if (containsRun(tail, prefix.slice(0, len))) n = len;
  return n;
}

// ---------------------------------------------------------------------------
// harness（生成到 .tmp/float-e2e/，不提交）
// ---------------------------------------------------------------------------

const { writeHarness } = require('./harness-html.cjs');

/** 把 harness 与 `lib/client.js` 落到 `.tmp/float-e2e/`（宿主经 HTTP 从这里取，见 `harnessHtml`）。 */
function writeHarnessFiles() {
  return writeHarness({
    outDir: OUT,
    clientJs: path.join(PLUGIN, 'lib', 'client.js'),
    title: 'amayui-emulator-view · float e2e harness',
    headline: '对话（假内容：浮窗悬在其上）',
    messages: ['端到端：真实例 e2e、真启动链、真 iframe。'],
    // ★HTTP 取法：React 走本站的 `/vendor/*`（由下面的 `staticMap` 喂），**不能**用相对路径 ——
    //   本页面的 URL 是 `http://127.0.0.1:<port>/harness/`，相对的 `../../app/…` 会 404，
    //   症状是页面里 `ReactDOM is not defined`（把 harness 抽成共用模块时实测踩到）。
    reactSrc: '/vendor/react.js',
    reactDomSrc: '/vendor/react-dom.js',
  });
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
  let bootPrefix = null;   // 基线启动链（`TITLE.BIN` 之前的段序列）；重载检测的 needle
  let binCounts = {};
  const notes = [];

  try {
    fs.mkdirSync(OUT, { recursive: true });
    writeHarnessFiles();
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
    // ★Windows 上 `import()` 不认 `E:\…` 这种盘符路径（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）⇒ 必须先转 file:// URL。
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

    // 记录**切换前**的启动链（这是"初始那一条"）。
    //
    // ★订正（2026-09-23 第二次实跑）：原先在这里只 `sleep(600)` 就取基线，结果**基线取早了** ——
    //   `bin === 'TITLE.BIN'` 只说明"已经到过标题"，而本次实测启动的**尾部** `… INIT2 → TITLE`
    //   是在那之后才发生的（第二次跑里它正好落在基线之后 ⇒ 「切换前后段序列完全一致」假红；
    //   段序列唯一的变化就是这条正常启动尾，且 `pid`/`startedAt`/`frames` 全部证明没有重启）。
    //   ⇒ 改成**等日志稳定**：连续 `SETTLE_MS` 没有新段才取基线，并放宽"完全一致"为
    //   「基线序列逐字保留 + 之后只允许无启动链重现的稳态新段」（见 7.6）。
    const settle = async (maxWaitMs = 20000, quietMs = 2500) => {
      const t0 = Date.now();
      let last = -1;
      let lastChange = Date.now();
      while (Date.now() - t0 < maxWaitMs) {
        const cur = parseBinRuns(fs.readFileSync(HOST_LOG, 'utf8')).runs.length;
        if (cur !== last) { last = cur; lastChange = Date.now(); }
        else if (Date.now() - lastChange >= quietMs) return cur;
        await sleep(250);
      }
      return last;
    };
    const settledRuns = await settle();
    console.log(`[e2e] 日志已稳定（连续 ${2500}ms 无新段，共 ${settledRuns} 段）`);
    const mark0 = await js('window.__markIframe()');
    const logTxt0 = fs.readFileSync(HOST_LOG, 'utf8');
    const parsed0 = parseBinRuns(logTxt0);
    runsBefore = parsed0.runs.slice();
    const iframeSrc0 = bootSnap.iframeSrc[0];
    console.log(`[e2e] 切换前的 bin 段序列 = ${JSON.stringify(runsBefore)}`);

    // ---- 4b) 基线：把**这一刻已经发生**的启动链钉下来 ----------------------------
    // ★启动链 = `TITLE.BIN` 之前的那些段（`SYS4REG → WDINIT → … → INIT → TITLE`，见
    //   `docs-new/03-engine/resource-loading.md:36`）。之后任何"把这段又连续走一遍"＝页面重载。
    //   基线取第一次 `TITLE.BIN` 的下标；此后 `TITLE`/`INIT2` 自己的重复**不算**重载
    //   （实测正常启动的尾部就是 `… INIT2 → TITLE → INIT2 → TITLE`，引擎自己会再回一次标题）。
    const firstTitleIdx = runsBefore.indexOf('TITLE.BIN');
    bootPrefix = firstTitleIdx > 0 ? runsBefore.slice(0, firstTitleIdx) : runsBefore.slice();
    console.log(`[e2e] 基线启动链（${bootPrefix.length} 段，重载检测取它的连续重现）= ${JSON.stringify(bootPrefix)}`);

    // ---- 5) 状态序列：收起 → 展开 → 放大 → 关闭 × 2，每步前后采样 ----
    const snap = async (tag) => {
      await sleep(700);
      const s = await js('window.__snap()');
      const r = readReg();
      const st = r && r.lastStatus ? r.lastStatus : {};
      // ★观察者数（`/health.viewers`，`T-0140` 加的）：**>1 ⇒ 有第二个页面在跑同一个实例的第二份 VM**。
      //   实测（T-0138 第四跑）：两套 `frames` 计数器会交错写进同一份宿主日志，看起来就像
      //   "frames 自己从 402 掉到 35"。所以每次采样都把它记下来，末尾据此判断"这份证据干不干净"。
      const health = r && r.port
        ? await fetch(`http://127.0.0.1:${r.port}/health`).then((x) => x.json()).catch(() => null)
        : null;
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
        viewers: health && typeof health.viewers === 'number' ? health.viewers : null,
        registryStartedAt: r ? r.startedAt : null,
        registryPid: r ? r.pid : null,
        errors: s.errors.slice(),
      };
      samples.push(sample);
      console.log(`  · ${tag.padEnd(22)} pill=${sample.pill ? 1 : 0} panel=${sample.panel ? 1 : 0} modal=${sample.modal ? 1 : 0} ` +
        `iframe=${sample.iframeCount} mark=${sample.iframeMark} vis=${sample.viewportVisibility} bin=${sample.bin} ` +
        `frames=${sample.frames} viewers=${sample.viewers}`);
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
    //
    // ★判据口径（`T-0138` 第 2 次修订，先出证据再改）：**按观察者拆开**看，不看注册表那条混合曲线。
    //   * 注册表心跳的 `frames` = "最后一个上报者"的值 ⇒ 两个页面附着时两套计数器交错，
    //     那条曲线**天然**可能出现"回落"（实测 `… 402, 35, …`），它不代表任何 VM 回零；
    //   * 宿主日志现在每条都带来源（`obs=#N frames=M`，`T-0140` 加的）⇒ 拆开之后每个页面
    //     自己的计数器是否**单调不减**才是真判据；同时它还能顺便证明"页面从头到尾只有一个 VM"
    //     （同一个 `obs` 的序列若中间从大跳回 1，那才是真的重启）。
    const fr = samples.map((s) => s.frames).filter((n) => typeof n === 'number');
    const byObs = framesByObserver(fs.readFileSync(HOST_LOG, 'utf8'));
    const obsSeqs = [...byObs.entries()].filter(([, v]) => v.length >= 3);
    const obsDrops = obsSeqs
      .map(([id, v]) => {
        const d = [];
        for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) d.push(`${v[i - 1]}→${v[i]}`);
        return { id, n: v.length, first: v[0], last: v[v.length - 1], drops: d };
      })
      .filter((x) => x.drops.length > 0);
    const obsSummary = obsSeqs.map(([id, v]) => `#${id}:${v.length}条 ${v[0]}→${v[v.length - 1]}`).join('；');
    if (obsSeqs.length > 0) {
      // 有归因数据 ⇒ 这是**可判读**的判据（不管有几个观众）。
      need('★每个观察者自己的 frames 计数器单调不减（无归零/回落）', obsDrops.length === 0,
        obsDrops.length
          ? JSON.stringify(obsDrops)
          : `按来源拆开：${obsSummary}（每一路都单调）`);
      // ★"还在增长"也按观察者看：采样值（`fr`）来自注册表心跳 = "最后一个上报者"的值，
      //   两个页面交错时它**天然**可能回落（实测：`… 277, 30` 是另一路计数器刚起步的值）。
      //   可判读的写法：**每一路**自己的末值 ≥ 首值，且至少有一路真的前进。
      const obsGrowth = obsSeqs.map(([id, v]) => ({ id, first: v[0], last: v[v.length - 1], grew: v[v.length - 1] > v[0] }));
      const obsRegressed = obsGrowth.filter((x) => x.last < x.first);
      need('★至少一路观察者的 frames 仍在增长（VM 未死；按来源看，不看混合曲线）',
        obsRegressed.length === 0 && obsGrowth.some((x) => x.grew),
        obsGrowth.map((x) => `#${x.id} ${x.first}→${x.last}${x.grew ? '(增长)' : ''}`).join('；'));
    } else {
      // 老宿主没有 `obs=` 字段 ⇒ 退回"单观众"前提；不干净就明说不可判读（不伪装通过）。
      const viewersMax = Math.max(...samples.map((s) => (typeof s.viewers === 'number' ? s.viewers : 1)));
      need('★采样期间只有一个观察者（老宿主没有按来源拆分的日志，frames 曲线才可读）', viewersMax <= 1,
        viewersMax <= 1 ? `viewers 全程 = ${viewersMax}` : `viewers 峰值 = ${viewersMax} ⇒ 不可判读`);
      let mono = true;
      for (let i = 1; i < fr.length; i++) if (fr[i] < fr[i - 1]) mono = false;
      if (viewersMax <= 1) {
        need('frames 采样全程单调不减（不回零）', mono && fr.length >= 3, `samples=[${fr.join(', ')}]`);
        need('frames 在切换后仍在增长（VM 未死）', fr.length >= 2 && fr[fr.length - 1] > fr[0], `first=${fr[0]} last=${fr[fr.length - 1]}`);
      } else {
        need('frames 单调性（本跑因 viewers>1 **不可判读**，需在干净环境重跑）', false,
          `viewers 峰值=${viewersMax}；frames 采样=[${fr.join(', ')}]`);
      }
    }

    // 7.6 宿主日志：启动链**没有被再走一遍**（页面没有被卸载/重载）
    //
    // ★订正（2026-09-23，首次实跑发现两条假红，**不是**放宽而是修检测口径）：
    //   旧口径是「每个启动链标记只出现一段」+「第一条 TITLE 之后不得有任何启动链标记」，
    //   但这两条在**正常启动**下就不成立 —— 实测（`.tmp/float-e2e/host.log`）：
    //     ① 数据表 INIT 段本来就重复进入：`… WDINIT, IMINIT, EBINIT, WDINIT, SKINIT, EBINIT, CGINIT, SKINIT, …`
    //        ⇒ WDINIT/EBINIT/SKINIT/CGINIT 各出现 **2 次**；
    //     ② 正常启动的尾部就是 `… INIT2, TITLE, INIT2, TITLE`（引擎自己会再回一次标题）
    //        ⇒ `INIT2.BIN` 出现在第一条 TITLE 之后。
    //   两条旧断言因此对**修好的实现**也报红（假红），而它们本来要抓的是「重新走一遍完整启动链」。
    //   新口径直接抓那个性质：把**基线时刻已发生的**启动链（`TITLE` 之前的段序列）当 needle，
    //   在**基线之后**新产生的段序列里找**连续重现**；任何一段连续重现 ⇒ 页面重载 ⇒ 重引导。
    //   它比旧口径更贴性质，且对上面两种正常重复**不会**误报。
    await sleep(800);
    const logTxt = fs.readFileSync(HOST_LOG, 'utf8');
    const parsed = parseBinRuns(logTxt);
    runsAfter = parsed.runs.slice();
    binCounts = countBins(parsed.seq);
    const firstTitle = parsed.runs.indexOf('TITLE.BIN');
    // 基线之后**新产生**的段（基线尾与当前尾都算 TITLE 的重复 ⇒ 去掉）：
    // 用"基线是否仍是当前的严格前缀"来定位新段，避免把基线段本身当重现。
    const baseLen = runsBefore.length;
    const stillPrefix = runsAfter.length >= baseLen && runsBefore.every((b, i) => runsAfter[i] === b);
    const tail = stillPrefix ? runsAfter.slice(baseLen) : runsAfter;
    const repeated = bootPrefix ? longestRepeatedChain(bootPrefix, tail) : 0;

    need('宿主日志里出现过 TITLE.BIN（确实启动过）', firstTitle >= 0, `bin 计数=${JSON.stringify(binCounts)}`);
    need('★无重引导：基线启动链没有被连续重现（页面没有被卸载/重载）', repeated === 0,
      repeated
        ? `重现长度=${repeated} ⇒ ${JSON.stringify(bootPrefix.slice(0, repeated))}（tail=${JSON.stringify(tail)}）`
        : `启动链 ${bootPrefix.length} 段全部只在启动时各走一遍；基线之后新段=${JSON.stringify(tail)}`);
    // ★订正：原先是"切换前后段序列**完全一致**"，但引擎启动的尾部（`… INIT2 → TITLE`）可能在
    //   基线之后才落进日志（见上面 settle 的注释）⇒ 对**修好的**实现也报红。真正要钉的是
    //   「基线那一整段**逐字保留**」+「之后的新段里没有启动链重现」——后者已由上面那条 0 重现覆盖。
    need('基线段序列被逐字保留（切换没有改动既有 BIN 序列）', stillPrefix,
      stillPrefix ? `基线 ${baseLen} 段逐字保留；新增 ${tail.length} 段` : `after=${JSON.stringify(runsAfter)}`);

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
    // ★**这一段的顺序是契约**（2026-09-23 实测踩了三次，症状都是"日志全绿、票据里却没有证据文件"）：
    //
    //   1. `win.destroy()` **不能早于写证据**：本驱动跑在 Electron 里，窗口是最后一个 ⇒ 销毁它会
    //      触发 `window-all-closed` ⇒ Electron 默认**立刻 `app.quit()`/退出进程** ⇒ 后面的
    //      `writeFileSync` 根本没有机会跑，而退出码还是 0（看起来完全正常）。
    //   2. 也不能把 `sleep` 放在写证据之前：调用方常用管道接住 stdout（`npx electron … | Select-String`），
    //      pwsh 在管道结束时**tree-kill** ⇒ 睡眠期间就被 SIGTERM。
    //   3. 所以：先停子进程（并等它真的退出，日志才完整）→ **立刻写证据** → 最后才销毁窗口。
    for (const c of children) {
      try {
        c.kill('SIGTERM');
      } catch {
        /* 已经没了 */
      }
      // 等它真的走（最多 2s）：不等就可能读到半截日志（少最后几条 status）⇒ 段序列判据会假红。
      await new Promise((r) => {
        if (c.exitCode !== null || c.signalCode !== null) return r();
        const t = setTimeout(r, 2000);
        c.once('exit', () => {
          clearTimeout(t);
          r();
        });
      });
    }

    // ---- 证据文件（必须在销毁窗口之前写；见上面的顺序说明）----
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
    L.push(`基线段（日志稳定后、切换前）：${JSON.stringify(runsBefore)}`);
    L.push(`切换后：${JSON.stringify(runsAfter || parsed.runs)}`);
    L.push('```');
    L.push('');
    const ft = parsed.runs.indexOf('TITLE.BIN');
    // ★这两个必须在**用到它们之前**声明（`T-0138` 实测踩过：`baseLen2` 曾经在使用它的那行之后
    //   才 `const` ⇒ `ReferenceError: Cannot access 'baseLen2' before initialization`，而它发生在
    //   `finally` 里 ⇒ 证据文件再次空白，且只以 `UnhandledPromiseRejectionWarning` 的形式出现）。
    const baseLen2 = runsBefore.length;
    const tail2 = (runsAfter.length >= baseLen2 && runsBefore.every((b, i) => runsAfter[i] === b))
      ? runsAfter.slice(baseLen2) : runsAfter;
    const repeated2 = bootPrefix ? longestRepeatedChain(bootPrefix, tail2) : 0;
    L.push(`⇒ 基线逐字保留 = ${baseLen2 > 0 && runsAfter.length >= baseLen2 && runsBefore.every((b, i) => runsAfter[i] === b)}`);
    L.push(`基线启动链（\`TITLE.BIN\` 之前的段，共 ${bootPrefix ? bootPrefix.length : 0} 段）＝重载检测用的 needle：`);
    L.push('');
    L.push('```text');
    L.push(JSON.stringify(bootPrefix));
    L.push('```');
    L.push('');
    L.push(`基线**之后**新产生的段：\`${JSON.stringify(tail2)}\``);
    L.push('');
    L.push('（窗口 = 日志稳定后取的基线段 + 其后的新段；`INIT2`/`TITLE` 这类**稳态段**自身重复是正常的，');
    L.push('只有当**基线启动链**被连续重现才判页面重载。）');
    L.push('');
    L.push(`⇒ **基线启动链的连续重现长度 = ${repeated2}**（0 = 没有被再走一遍 ⇒ 页面没有被卸载/重载）。`);
    L.push('');
    if (ft >= 0 && repeated2 === 0) {
      L.push('为什么旧口径「第一条 `TITLE.BIN` 之后不得有任何启动链标记」是**假红**（本驱动首跑实测，已订正）：');
      L.push('');
      L.push('* 数据表 INIT 段本来就重复进入一次：`… WDINIT, IMINIT, EBINIT, WDINIT, SKINIT, EBINIT, CGINIT, SKINIT, …`（见上面段序列）')
      L.push('  ⇒ `WDINIT`/`EBINIT`/`SKINIT`/`CGINIT` 各出现 2 段；');
      L.push('* 正常启动的尾部就是 `… INIT2, TITLE, INIT2, TITLE`（引擎自己会再回一次标题）⇒ `INIT2.BIN` 落在第一条 `TITLE.BIN` 之后。');
      L.push('* 这两条对**修好的**实现也报红；而它们要抓的性质是「重新走一遍完整启动链」，由上面的"连续重现长度=0"直接钉住。');
      L.push('');
    }
    L.push('');
    L.push('## frames 采样（注册表心跳 `lastStatus.frames`）');
    L.push('');
    L.push('| # | 采样点 | 状态 | iframe 数 | iframe 节点 | 容器 visibility | bin | frames | viewers |');
    L.push('|---|--------|------|-----------|-------------|-----------------|-----|--------|---------|');
    samples.forEach((s, i) => {
      const st = s.pill ? '收起' : (s.modal ? '模态' : '展开');
      L.push(`| ${i + 1} | ${s.tag} | ${st} | ${s.iframeCount} | ${s.iframeMark} | ${s.viewportVisibility} | ${s.bin} | ${s.frames} | ${s.viewers} |`);
    });
    L.push('');
    const fr = samples.map((s) => s.frames).filter((n) => typeof n === 'number');
    const viewersMax2 = Math.max(...samples.map((s) => (typeof s.viewers === 'number' ? s.viewers : 1)));
    L.push(`frames 序列：\`[${fr.join(', ')}]\`（first=${fr[0]}，last=${fr[fr.length - 1]}，单调不减=${fr.every((n, i) => i === 0 || n >= fr[i - 1])}）`);
    L.push('');
    L.push(`观察者数（\`/health.viewers\`，1 = 只有本驱动的 harness 在跑这个实例）：**峰值 ${viewersMax2}**`);
    L.push('');
    // ★按来源拆开（`obs=#N`）：这才是"哪个 VM 在前进、有没有回零"的可判读证据。
    const byObs2 = framesByObserver(logTxt);
    L.push('### frames 按**观察者**拆开（注册表那条混合曲线不可判读，这张表可判读）');
    L.push('');
    L.push('| 观察者 | 上报条数 | frames 首→末 | 是否单调不减 |');
    L.push('|---|---|---|---|');
    for (const [id, v] of byObs2) {
      let mono = true;
      const drops = [];
      for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) { mono = false; drops.push(`${v[i - 1]}→${v[i]}`); }
      L.push(`| #${id} | ${v.length} | ${v[0]} → ${v[v.length - 1]} | ${mono ? '✅ 是' : `❌ 否（${drops.join(', ')}）`} |`);
    }
    L.push('');
    L.push('（每个观察者 = 一个渲染页 = 一个 VM。`#0` 通常是本驱动的 harness；其余是别的页面，');
    L.push('例如人在 DSH 面板里开着的那个画面。**只有按来源拆开**才能看出"是不是某一个 VM 回零了"。）');
    if (viewersMax2 > 1) {
      L.push('');
      L.push('★本跑有**多个观察者**（上表可见几路）。注册表心跳里的 `frames` 是"最后一个上报者"的值 ⇒');
      L.push('两套计数器交错，那条曲线**不能**当作单个 VM 的进度曲线；判据落在上表「是否单调不减」列。');
      L.push('（这正是上一版把 `402 → 35` 误判成"重启"的原因；`idle-probe.cjs`（无操作 60s）与');
      L.push('`collapse-probe.cjs`（只收起 25s）两个对照实验也各自证明过 `frames` 单调上升。）');
    }
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
      const byObsV = framesByObserver(logTxt);
      const obsLine = [...byObsV.entries()]
        .map(([id, v]) => {
          let mono = true;
          for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) mono = false;
          return `#${id}（${v.length} 条，${v[0]}→${v[v.length - 1]}，单调=${mono ? '是' : '否'}）`;
        })
        .join('、');
      L.push(`**通过。** 收起 → 展开 → 放大 → 关闭来回切了两轮（${samples.length} 次采样），期间：`);
      L.push(`① 基线启动链（${bootPrefix ? bootPrefix.length : 0} 段）在\`TITLE.BIN\`之后**连续重现长度 = 0**（没有被再走一遍）⇒ 页面没有被卸载/重载；`);
      L.push(`   基线之后**新产生的段**一共 ${tail2.length} 条：\`${JSON.stringify(tail2)}\`（只允许 \`TITLE.BIN\` 这类稳态段）；`);
      L.push(`② 按**观察者**拆开的 \`frames\` 计数器全部单调不减 ⇒ VM 一直在跑，没死也没重来：${obsLine}`);
      L.push(`③ 每次采样全树都**恰好一个** \`<iframe>\`，且是**同一个 DOM 节点**（\`${samples[0] && samples[0].iframeMark}\`）、\`src\` 恒为 \`/dsh-emulator/${INSTANCE}/\`；`);
      L.push(`④ 宿主进程 pid / \`startedAt\` 不变，基线段序列被**逐字保留**（新增段里没有启动链重现）。`);
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

    // ★证据已经落盘，**现在**才收窗口（销毁窗口会让 Electron 直接退出；必须排在写文件之后）。
    try { if (win) win.destroy(); } catch { /* 已经没了 */ }
    try { if (server) server.close(); } catch { /* 已经没了 */ }

    console.log(`\n[e2e] SUMMARY ${fail.length === 0 ? 'PASS' : 'FAIL'} ${results.filter((r) => r.ok).length}/${results.length} assertions, ` +
      `bootChainRuns=${(runsAfter || parsed.runs).length}, titleCount=${counts['TITLE.BIN'] || 0}, ` +
      `frames=${fr.length ? `${fr[0]}->${fr[fr.length - 1]}` : 'n/a'}, samples=${samples.length}, png=${pngBytes}B` +
      `${fail.length ? `, failures=${JSON.stringify(fail)}` : ''}`);

    process.exit(fail.length === 0 ? 0 : 1);
  }
})();
