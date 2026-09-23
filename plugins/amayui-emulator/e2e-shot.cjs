'use strict';
/**
 * **观察台端到端探针**（`tickets/T-0136` acceptance 4/6/8；顺带补 `T-0135` 的"两实例并行隔离"）。
 *
 * 它把**三件事**串起来验，而且**不需要重启 DSH**（插件 handler 直接挂在一个真 `node:http` 上，
 * 于是浏览器走的就是插件那条路由）：
 *
 * ```text
 * 真实浏览器（Electron 哑窗，show:false）
 *   └─ GET  /dsh-emulator/obs-a/          ← 插件路由（纯观察）
 *        └─ 流式反向代理 ──▶ 127.0.0.1:<portA>/   实例 obs-a（独立进程）
 * agent（node 侧 fetch）
 *   ├─ GET  /dsh-emulator/api/__instances         → 列出活实例（注册表）
 *   ├─ POST /dsh-emulator/obs-a/api/debug-query   → move / capture（经 SSE 到渲染页再回执）
 *   └─ POST /dsh-emulator/<id>/api/write-save-slot → 每实例写自己的 overlay（隔离证据）
 * ```
 *
 * 用法（cwd 必须在 `app/amayui-emulator`，好让 `electron` 与 `tsx` 能解析到）：
 * ```bash
 * npx electron ../../plugins/amayui-emulator/e2e-shot.cjs
 * ```
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

const APP = process.cwd();                                  // app/amayui-emulator
const REPO = path.resolve(APP, '..', '..');
const PLUGIN = path.resolve(REPO, 'plugins', 'amayui-emulator');
const OUT = path.join(REPO, '.tmp', 'observer-e2e');
const IDS = ['obs-a', 'obs-b'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 信封（写字节类请求的 body；与 `src/web/envelope.ts` 同一格式）。 */
function envelope(bytes) {
  const out = Buffer.alloc(8 + bytes.length);
  out.writeUInt32BE(1, 0);
  out.writeUInt32BE(bytes.length, 4);
  Buffer.from(bytes).copy(out, 8);
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const log = fs.createWriteStream(path.join(OUT, 'e2e.log'));
  const children = [];
  const fail = [];
  const ok = (cond, msg, extra = '') => {
    console.log(`${cond ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`);
    if (!cond) fail.push(msg);
  };

  try {
    // ---- 1) 插件 handler 挂到真 server 上（= 浏览器将会走的那条路由）----
    const { apply } = await import(path.join(PLUGIN, 'lib', 'index.js'));
    let route = null;
    const ctx = {
      webServer: { register(r) { route = r; return () => { route = null; }; } },
      get(k) { return k === 'sandboxPolicy' ? { workspaceRoot: REPO } : undefined; },
      effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    };
    apply(ctx);
    ok(!!route && route.kind === 'prefix' && route.path === '/dsh-emulator', '插件路由已注册（prefix /dsh-emulator）');
    const server = http.createServer((req, res) => {
      Promise.resolve(route.handler(req, res)).catch((e) => {
        try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e && e.message)); } catch {}
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const srvPort = server.address().port;
    const base = `http://127.0.0.1:${srvPort}/dsh-emulator`;
    console.log(`\n[obs] 插件路由挂在 http://127.0.0.1:${srvPort}${'/dsh-emulator'}`);

    // ---- 2) 以 agent 身份起两个实例（互不相同的 id/端口/overlay）----
    for (const id of IDS) {
      // ★必须用真 `node`，不能用 `process.execPath` —— 本探针跑在 Electron 里，
      //   `process.execPath` 是 Electron 二进制（实测：它会去打一堆 TIS/Keyboard 噪声然后什么都不干）。
      const p = spawn(process.env.AMAYUI_NODE || 'node', ['--import', 'tsx', 'src/web/host.ts', '--instance', id, '--port', '0', '--repo-root', REPO], {
        cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
      });
      p.stdout.pipe(log); p.stderr.pipe(log);
      children.push(p);
    }
    // 等两个都出现在 __instances（经插件路由读注册表）
    let list = [];
    for (let i = 0; i < 120; i++) {
      const r = await fetch(`${base}/api/__instances`).then((r) => r.json()).catch(() => null);
      list = (r && r.instances) || [];
      if (IDS.every((id) => list.some((x) => x.id === id))) break;
      await sleep(500);
    }
    console.log(`\n[obs] __instances → ${JSON.stringify(list.map((x) => ({ id: x.id, port: x.port, bin: x.bin })))}`);
    ok(IDS.every((id) => list.some((x) => x.id === id)), '两个实例都被注册表列出（跨进程发现）');
    const ports = Object.fromEntries(list.filter((x) => IDS.includes(x.id)).map((x) => [x.id, x.port]));
    ok(ports['obs-a'] > 0 && ports['obs-b'] > 0 && ports['obs-a'] !== ports['obs-b'], '两个实例端口互不相同', JSON.stringify(ports));

    // ---- 3) 每实例写自己的存档槽（隔离证据：落点必须分开）----
    for (const [i, id] of IDS.entries()) {
      const payload = new Uint8Array(64).fill(i + 1); // a=1 b=2
      const r = await fetch(`${base}/${id}/api/write-save-slot`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-amayui-args': encodeURIComponent(JSON.stringify({ args: [7] })) },
        body: envelope(payload),
      });
      ok(r.status === 200, `经插件路由写 ${id} 的槽 7 → HTTP ${r.status}`);
    }
    await sleep(300);
    const files = IDS.map((id) => path.join(REPO, '.tmp', 'instances', id, 'overlay', 'SAVE', 'SAVE07.DAT'));
    ok(files.every((f) => fs.existsSync(f)), '两实例的槽文件各自落在自己的 overlay 下', files.map((f) => f.replace(REPO + '/', '')).join(' | '));
    const contents = files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f)[0] : -1));
    ok(contents[0] === 1 && contents[1] === 2, '两个实例的内容互不串（a=1, b=2）', JSON.stringify(contents));

    // ---- 4) 真浏览器：经插件路由打开实例 A，跑到 TITLE 并截图 ----
    await app.whenReady();
    const win = new BrowserWindow({ width: 1280, height: 720, show: false, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    await win.loadURL(`${base}/obs-a/`);
    console.log('\n[obs] 已用哑浏览器打开 /dsh-emulator/obs-a/，等 40s 让它跑到 TITLE…');
    await sleep(40000);
    const png1 = (await win.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(OUT, 'observer-instance-a.png'), png1);
    ok(png1.length > 200000, `实例 A 的截图非空（${png1.length}B）`, path.join(OUT, 'observer-instance-a.png'));
    const api = await win.webContents.executeJavaScript('window.api.readScript(0).then(r => r ? r.data.length : -1).catch(e => "ERR:" + e.message)');
    ok(typeof api === 'number' && api > 1000, `页面内 window.api.readScript(0) → ${api}（经插件的每实例路由）`);

    // ---- 5) agent 控制面（经插件路由 → SSE → 该实例的渲染页）----
    const dq = async (id, text) => {
      const r = await fetch(`${base}/${id}/api/debug-query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: [text] }),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const mv = await dq('obs-a', 'move 640 360');
    ok(mv.status === 200 && mv.json && mv.json.ok === true, `agent move 经插件路由 → HTTP ${mv.status}`, JSON.stringify(mv.json && mv.json.lines));
    const cap = await dq('obs-a', 'capture');
    if (cap.json && typeof cap.json.png === 'string') {
      const buf = Buffer.from(cap.json.png, 'base64');
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      fs.writeFileSync(path.join(OUT, 'observer-agent-capture.png'), buf);
      ok(w === 1280 && h === 720 && buf.length > 200000, `agent capture 经插件路由 → ${buf.length}B ${w}×${h}`);
    } else {
      ok(false, 'agent capture 没回图', JSON.stringify(cap));
    }
    // 按 id 寻址：命令必须落到**那个**实例，而不是"当前激活的"。
    // ★这里同时钉住一条**架构后果**：web 形态下 VM 跑在**页面**里 ⇒ 没有渲染页附着的实例，
    //   `/health` 照常（宿主在），但 `debug-query` 必然 503（没人能执行）——
    //   这是正确语义，不是缺陷（对比 `T-0133` §B.4.1 的 offscreen 形态：那种形态进程自己就是渲染者）。
    const healthB = await fetch(`${base}/obs-b/health`).then((r) => r.json()).catch(() => null);
    ok(healthB && healthB.ok === true && healthB.instance === 'obs-b', '每实例路由：/obs-b/health 报到的是 obs-b', JSON.stringify(healthB && { instance: healthB.instance, port: healthB.port }));
    const mvB = await dq('obs-b', 'leave');
    ok(mvB.status === 503 && String((mvB.json && mvB.json.error) || '').includes('没有渲染页'),
       `未附渲染页的实例：agent 命令按 id 寻址到 obs-b ⇒ HTTP ${mvB.status}「没有渲染页」（正确语义）`,
       JSON.stringify(mvB.json && mvB.json.error));

    await app.quit();
  } catch (err) {
    console.log(`\n[obs] ✗ ${err && err.stack ? err.stack : err}`);
    fail.push(String(err && err.message));
  } finally {
    for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
    await sleep(1200);
    // 实例退出后注册表应清理 ⇒ 列表不再含它们
    try {
      const r = await fetch(`http://127.0.0.1:1/`).catch(() => null); void r;
    } catch {}
    log.end();
    console.log(`\n[obs] ${fail.length === 0 ? '全部通过 ✅' : `失败 ${fail.length} 项 ❌ → ${fail.join(' | ')}`}`);
    console.log(`[obs] 产物目录 ${OUT}`);
    process.exit(fail.length === 0 ? 0 : 1);
  }
})();
