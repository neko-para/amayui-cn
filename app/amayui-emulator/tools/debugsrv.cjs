/**
 * **调试服务器（adb 式后台进程）** —— `tickets/T-0114`
 *
 * ## 为什么要有它（用户的处境）
 * 排查一个现象要「改源码加诊断 → 重编 → 让人手动重现 4 分钟」。调试台（控制面板的 REPL）已经
 * 让命令能生效，但**交互仍要人点**；而"我来点"受两件事挡住：
 *  ① 我的每次工具调用有超时，而推进到目标帧本身要几分钟；
 *  ② 一次调用结束后，上一次启动的窗口就处于"无人接管"状态。
 * ⇒ 解法是**长期存在的后台进程 + 短连接客户端**（adb 的形）：
 *   本脚本把 electron 当成守护进程跑着（它本来就有一个长期存在的控制窗），
 *   外部 CLI（`tools/dbg.cjs`）每次连上、发命令、收结果、断开。
 *
 * ## 用法
 * ```
 * npm run dbg:srv                    # 起守护（默认监听 127.0.0.1:39427；**默认静音**，见下）
 * node tools/dbg.cjs global 0        # 另一个终端里发一条查询
 * node tools/dbg.cjs 'b event global-int-write idx == 3318'
 * node tools/dbg.cjs c               # 继续
 * node tools/dbg.cjs --quit          # 收工（关 app）
 * ```
 *
 * ## 声音
 * 默认**静音**：本脚本在 require 主进程之前把 `AMAYUI_AUDIO_ENABLED` 兜底成 `'0'`
 * （引擎侧的正式开关，宿主不出声、引擎语义照跑）。显式传 `AMAYUI_AUDIO_ENABLED=1` 或
 * `AMAYUI_DEBUG_AUDIO=1` 可恢复出声。理由：调试会话是"无人值守跑几分钟"，出声只会引入
 * 与被测逻辑无关的噪声（设备/自动播放策略/时间抖动）。
 *
 * ## 协议（行分隔 JSON；TCP，仅绑 127.0.0.1）
 * 客户端 → 服务端：`{ "id": <n>, "text": "<一条命令台命令>" }` 或 `{ "op": "quit" }` / `{ "op": "ping" }`
 * 服务端 → 客户端：`{ "id": <n>, "ok": <bool>, "lines": [...] }`（命令的转录）
 *                  `{ "event": "paused"|"break-list"|"status"|"log", ... }`（异步推送）
 *
 * ## 输入驱动（**主进程侧新增**，`tickets/T-0114` 第 8 次变更）
 *
 * 命令台只能**看**（只读查询 + 断点）；而要查的现象（如 `tickets/T-0102` 的白底）在
 * "点进去某一步之后"才出现 ⇒ 需要能**远程驱动输入**，否则仍要人坐在窗口前点。
 * 这三条命令**不经过渲染窗**：主进程直接 `webContents.sendInputEvent`（与 `tools/shot.cjs`
 * 的 `click`/`hover` 同一手法、同一套坐标口径），因此**不需要重新打包渲染窗**。
 *
 * ```
 * click <x> <y>        在游戏窗口里点一下（输入坐标 = `shot.cjs` 里 CONFIG_XY 那一套）
 * clickn <x> <y> [次数] [间隔ms]   连点 N 下（默认 1 下、300ms 间隔）—— ADV 一页一次点击时用
 * clickimg <x> <y>     同上，但坐标是**截图图像坐标**（按当前窗口几何现算，见 `imgToSendLive`）
 * move <x> <y>         只移动光标（复核悬停门控）
 * shot [名字]          远程截图 → `<仓库根>/.tmp/dbg-<名字>.png`（并报出内容区尺寸）
 * ```
 *
 * ⚠ **输入坐标 ≠ 图像坐标**：`sendInputEvent` 收**内容区 CSS 像素**，`capturePage()` 给**图像像素**，
 * 两者比例随窗口尺寸/缩放变。菜单类常量（`CONFIG_XY` 等）是**输入坐标**（`shot.cjs` 一直这么用），
 * 存档列表的行是**图像坐标** ⇒ 前者用 `click`、后者用 `clickimg`。
 * ★别照抄 `shot.cjs` 的 `toSend` 常数（`(x+28.4)/0.955`）：那是另一台机器/另一个窗口尺寸标出来的，
 * 2026-09-23 本机实测对不上。
 *
 * ★**安全**：只在**显式开启**时监听（本脚本本身就是显式入口），且**只绑回环地址**；
 *   命令集与调试台**同一套**（`parseDebugCommand` 的白名单 + 只读查询），没有任意代码执行。
 *
 * ★**必须照抄 `shot.cjs` 的三个前台/节流开关**：主进程是脚本自己时窗口不在前台，
 *   Chromium 会把 rAF 降到极低频 ⇒ 渲染循环几乎不推进 ⇒ 启动链永远走不完（看起来像挂死）。
 */
const { app } = require('electron');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

/** 仓库根（与 `shot.cjs` 同一口径：`app/amayui-emulator/tools` 上溯三级）—— 截图产物落 `<root>/.tmp/`。 */
const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---- 与 shot.cjs 同一组开关（理由见文件头）----
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// ★本机/容器环境里 Chromium 的沙箱会初始化失败（实测 `sandbox initialization failed: Operation not permitted`
//   之后 GPU/网络子进程连环崩、整个 app 被打死）⇒ 调试服务器显式关沙箱。
//   为什么可以关：本进程只绑**回环**、命令集是**只读查询 + 白名单断点**，不执行任意代码。
app.commandLine.appendSwitch('no-sandbox');

const HOST = '127.0.0.1';
const PORT = Number(process.env.AMAYUI_DEBUG_PORT || 39427);

// ★**默认静音**（`tickets/T-0102` 的实测要求）：调试守护进程是"无人值守地跑几分钟"的形态，
//   出声只会带来设备/自动播放策略/时间抖动这些**与被测逻辑无关**的噪声（而且会吵到人）。
//   `AMAYUI_AUDIO_ENABLED` 是引擎侧的正式开关（`src/emulatorOptions.ts`，宿主不出声、引擎语义照跑）
//   ⇒ 这里只**兜底设一个默认值**：显式传了 `AMAYUI_AUDIO_ENABLED` 就尊重它；
//   要临时出声用 `AMAYUI_DEBUG_AUDIO=1`（它只是本脚本的"别兜底"开关，防止以后有人以为改不了）。
if (process.env.AMAYUI_DEBUG_AUDIO === undefined) process.env.AMAYUI_AUDIO_ENABLED ??= '0';

// 复用主进程产物（与 shot.cjs 同口径：先 `npm run build:electron`）。
// ★必须走 `main.cjs` 的导出，**不能**去 require `windows.cjs` —— 那会拿到**另一个** `windows` 单例
//   （`windows.game` 为 null ⇒ `sendToRenderer` 发到空处）。理由见 `electron/main.ts` 末尾的注释。
const { windows, sendDebugQuery, sendBreakCommand } = require('../dist/electron/main.cjs');

/** 已连接的客户端（广播用：断点命中/状态这类**推送**）。 */
const clients = new Set();

function send(sock, obj) {
  try {
    sock.write(JSON.stringify(obj) + '\n');
  } catch {
    /* 对端已断；由 close 事件清理 */
  }
}
function broadcast(obj) {
  for (const s of clients) send(s, obj);
}

/**
 * 把主进程**已有的推送**（控制窗那几条）转成广播 —— 这样 CLI 也能看到「断点命中/断点表」。
 * ★接的是 `windows.sendToControl` 的载荷：不去改渲染窗，只在主进程侧多转一路。
 */
function mirrorControlPush(channel, payload) {
  if (channel === 'control-break-paused') broadcast({ event: 'paused', ...payload });
  else if (channel === 'control-break-list') broadcast({ event: 'break-list', ...payload });
  else if (channel === 'control-status') broadcast({ event: 'status', ...payload });
}

/** 等游戏窗口就绪（`windows.game` 存在）；返回该窗口。 */
async function waitGameWin(timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    if (windows.game && !windows.game.isDestroyed()) return windows.game;
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * **按当前窗口几何现算**图像坐标 → 输入坐标。
 *
 * 为什么不写死常数：`capturePage()` 给的是图像像素，而 `sendInputEvent` 收的是**窗口内容区的 CSS 像素**
 * ⇒ 两者的比例随窗口尺寸/缩放变（本机实测内容区 ≠ 截图尺寸）。每次点击现取一次几何，
 * 比"在另一台机器上标出来的常数"可靠。
 *
 * ★`tools/shot.cjs` 里那份 `toSend`（`(x+28.4)/0.955`）是**当时那台机器、那个窗口尺寸**标出来的
 * （DPR + 标题栏偏移揉在一起）；2026-09-23 本机实测它对不上（点存档列表的行没有反应）⇒
 * 这里**不沿用常数**，改成按需换算。
 */
async function imgToSendLive(ix, iy) {
  const w = windows.game;
  if (!w || w.isDestroyed()) return null;
  const [cw, ch] = w.getContentSize();
  const img = await w.webContents.capturePage();
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  return [Math.round((ix * cw) / width), Math.round((iy * ch) / height)];
}

/** 移动光标（不按键）—— 悬停类门控（`i12e` 的 labelA/labelB）要用它。 */
function moveAt(x, y) {
  const w = windows.game;
  if (!w || w.isDestroyed()) return '没有游戏窗口（输入未发送）';
  w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  return `move ${x},${y}`;
}

/** 点一下（与 `tools/shot.cjs` 的 `click` 同形：move → down → up，各留一小段间隔给消息泵）。 */
async function clickAt(x, y) {
  const w = windows.game;
  if (!w || w.isDestroyed()) return '没有游戏窗口（输入未发送）';
  w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(150);
  w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(180);
  w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await sleep(150);
  return `click ${x},${y}`;
}

/**
 * **远程截图**（`adb shell screencap` 的形）—— 产物落仓库 `.tmp/`。
 * 为什么要有它：输入驱动一旦能远程点，"点到了哪一屏"必须能自己核（`tools/shot.cjs` 的教训：
 * 存档列表会记住上次的页/光标 ⇒ 只靠坐标猜会点错槽而看不出来）。名字不许带路径分隔符
 * （与 `shot.cjs` 的 `--name` 同一条理由：产物目录固定）。
 */
async function screenshot(name) {
  const w = windows.game;
  if (!w || w.isDestroyed()) return '没有游戏窗口（未截图）';
  const safe = String(name || 'dbg').replace(/[^A-Za-z0-9_.-]/g, '_');
  const out = path.join(ROOT, '.tmp', `dbg-${safe}.png`);
  const img = await w.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  const { width, height } = img.getSize();
  const [cw, ch] = w.getContentSize();
  return `shot ${out} (${width}x${height})  内容区=${cw}x${ch}  ← clickimg 的换算基准`;
}

/**
 * 处理一条客户端请求。
 *
 * ★命令的**语义**全在渲染窗（`debugBreak.parseDebugCommand` / `debugQuery.runQuery`）。
 * 这里的 `break` 前缀写法只是为了 CLI 方便：`dbg break b event …` 与 `dbg 'b event …'` 等价。
 * 约定：`dbg <文本>` 里文本以 `b ` / `bl` / `d ` / `c` / `?` 开头 ⇒ 当**命令台命令**（走断点通道 + 查询）；
 * 其余一律当**查询**（走 debugQuery）。
 */
async function handle(sock, msg) {
  const id = msg.id;
  if (msg.op === 'ping') {
    send(sock, { id, ok: true, lines: ['pong', `game=${windows.hasGame()}`] });
    return;
  }
  if (msg.op === 'quit') {
    send(sock, { id, ok: true, lines: ['bye'] });
    setTimeout(() => app.quit(), 100);
    return;
  }
  const text = String(msg.text ?? '').trim();
  if (text === '') {
    send(sock, { id, ok: true, lines: [] });
    return;
  }

  const head = text.split(/\s+/)[0].toLowerCase();
  // ---- 输入驱动 / 截图（主进程侧，不经过渲染窗；见文件头「输入驱动」节）----
  if (head === 'shot' || head === 'screencap') {
    try {
      send(sock, { id, ok: true, lines: [await screenshot(text.split(/\s+/)[1])] });
    } catch (err) {
      send(sock, { id, ok: false, lines: [`shot 失败：${err.message}`] });
    }
    return;
  }
  if (head === 'click' || head === 'tap' || head === 'clickimg' || head === 'move' || head === 'clickn') {
    const n = text.split(/\s+/).slice(1).map((s) => Number.parseInt(s, 10));
    if (n.length < 2 || !Number.isInteger(n[0]) || !Number.isInteger(n[1])) {
      send(sock, { id, ok: false, lines: [`${head}：用法是 \`${head} <x> <y>${head === 'clickn' ? ' [次数] [间隔ms]' : ''}\`（收到「${text}」）`] });
      return;
    }
    if (head === 'clickn') {
      // ★为什么要"一次调用点 N 下"：ADV 推进是**一页一次点击**，而序章有上百页；每次点击都走一次
      //   "客户端短连接 → 服务端 → 渲染窗"的话，外部调用方的往返开销比游戏本身还大（实测每调用 ~1.5s）。
      //   放在服务端循环里，一次调用就能推完一段。间隔默认 300ms（给 `wait-for-input` 的帧循环留时间）。
      const times = Number.isInteger(n[2]) && n[2] > 0 ? n[2] : 1;
      const gap = Number.isInteger(n[3]) && n[3] >= 0 ? n[3] : 300;
      for (let i = 0; i < times; i++) {
        const r = await clickAt(n[0], n[1]);
        if (r.startsWith('没有')) {
          send(sock, { id, ok: false, lines: [r] });
          return;
        }
        if (i < times - 1) await sleep(gap);
      }
      send(sock, { id, ok: true, lines: [`clickn ${n[0]},${n[1]} ×${times}（间隔 ${gap}ms）`] });
      return;
    }
    if (head === 'clickimg') {
      const mapped = await imgToSendLive(n[0], n[1]);
      if (!mapped) {
        send(sock, { id, ok: false, lines: ['没有游戏窗口（输入未发送）'] });
        return;
      }
      const [x, y] = mapped;
      send(sock, { id, ok: true, lines: [`${await clickAt(x, y)}（图像坐标 ${n[0]},${n[1]} → 输入坐标 ${x},${y}）`] });
      return;
    }
    const [x, y] = [n[0], n[1]];
    const what = head === 'move' ? moveAt(x, y) : await clickAt(x, y);
    send(sock, { id, ok: true, lines: [what] });
    return;
  }

  // 与 `debugBreak.parseDebugCommand` 的白名单同形（**只做分流**，不做校验 —— 校验在渲染窗）
  const isCommand = ['b', 'break', 'bl', 'breakpoints', 'd', 'delete', 'c', 'cont', 'continue', '?', 'help'].includes(head);

  if (isCommand) {
    // 断点/继续类：先下发（结果由渲染窗推送回来），再回一条确认
    if (head === '?' || head === 'help') {
      const r = await sendDebugQuery('?');
      send(sock, { id, ...r });
      return;
    }
    if (head === 'c' || head === 'cont' || head === 'continue') {
      sendBreakCommand({ kind: 'continue' });
      send(sock, { id, ok: true, lines: ['（已请求继续）'] });
      return;
    }
    if (head === 'bl' || head === 'breakpoints') {
      sendBreakCommand({ kind: 'list' });
      send(sock, { id, ok: true, lines: ['（断点表将由 event=break-list 推送；见下一条消息）'] });
      return;
    }
    if (head === 'd' || head === 'delete') {
      const rest = text.split(/\s+/).slice(1);
      const rid = rest[0] === undefined ? undefined : Number.parseInt(rest[0], 10);
      if (rest[0] !== undefined && !Number.isInteger(rid)) {
        send(sock, { id, ok: false, lines: [`delete：id 必须是整数（收到「${rest[0]}」）`] });
        return;
      }
      sendBreakCommand(rid === undefined ? { kind: 'clear' } : { kind: 'clear', id: rid });
      send(sock, { id, ok: true, lines: [`（已请求删除${rid === undefined ? '全部' : ` #${rid}`}）`] });
      return;
    }
    // `b …`
    const parts = text.split(/\s+/);
    const rest = parts.slice(1);
    if (rest[0]?.toLowerCase() === 'event') {
      sendBreakCommand({ kind: 'set', breakKind: 'event', where: (rest[1] ?? '').toLowerCase(), condition: rest.slice(2).join(' ') });
    } else {
      sendBreakCommand({ kind: 'set', breakKind: 'step', condition: rest.join(' ') });
    }
    send(sock, { id, ok: true, lines: ['（断点已下发；生效与命中会以 event=break-list / event=paused 推送）'] });
    return;
  }

  // 其余一律当**查询**（要回答案）
  const r = await sendDebugQuery(text);
  send(sock, { id, ...r });
}

(async () => {
  await app.whenReady();
  const win = await waitGameWin();
  if (!win) {
    console.error('[dbgsrv] 等不到游戏窗口，退出');
    app.quit();
    return;
  }

  // 把控制窗那几条推送镜像成广播（断点命中/列表/状态）
  const origSendToControl = windows.sendToControl.bind(windows);
  windows.sendToControl = (channel, ...args) => {
    origSendToControl(channel, ...args);
    mirrorControlPush(channel, args[0]);
  };

  const server = net.createServer((sock) => {
    clients.add(sock);
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (err) {
          send(sock, { id: -1, ok: false, lines: [`协议错误：不是 JSON（${err.message}）`] });
          continue;
        }
        void handle(sock, msg).catch((err) => send(sock, { id: msg.id ?? -1, ok: false, lines: [`服务端异常：${err.message}`] }));
      }
    });
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => clients.delete(sock));
    send(sock, { event: 'hello', text: 'amayui debug server', game: windows.hasGame() });
  });

  server.on('error', (err) => {
    console.error(`[dbgsrv] 监听失败：${err.message}`);
    app.quit();
  });
  server.listen(PORT, HOST, () => {
    console.log(`[dbgsrv] listening on ${HOST}:${PORT}（game ready；外部用 tools/dbg.cjs 连）`);
  });

  app.on('window-all-closed', () => {
    // 控制窗关掉不该带走守护进程（adb 语义）；只有显式 quit / SIGTERM 才退。
    if (!windows.hasGame() && clients.size === 0) app.quit();
  });
  process.on('SIGTERM', () => app.quit());
  process.on('SIGINT', () => app.quit());
})();

// 说明：require('../dist/electron/main.cjs') 的**副作用**就是建窗 + 注册 IPC
//（与 shot.cjs 同一手法）；上面已从它的导出里取到 `windows` 单例与调试发送函数。
