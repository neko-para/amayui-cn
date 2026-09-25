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
 * 这三条命令**默认不经过渲染窗**：主进程直接 `webContents.sendInputEvent`（与 `tools/shot.cjs`
 * 的 `click`/`hover` 同一手法、同一套坐标口径），因此**不需要重新打包渲染窗**。
 *
 * ★**两条输入通道（`tickets/T-0142` 的 acceptance ①）**：设 `AMAYUI_DEBUG_INPUT=vm` 时，`click`/`move`/
 * `clickimg` **不再自己造 DOM 事件**，而是把同一行命令转给渲染窗的**命令表**
 * （`src/vm/debugCommand.ts` → `applyScenarioEvent`）—— 与 **web 宿主逐字同源**。
 *
 * **两条路的差别**（★不止"真 DOM 保真度"这一条）：
 *  1. **同一件事的两处呈现**：VM 那条在**回执**里写 `已注入 N 个输入事件（cursor, press, release）`
 *     （`session.ts:608`），同时在 **trace** 里落一行 `[input] 注入 N 个事件：…`（`session.ts:607`）；
 *     DOM 那条只回 `click x,y`（没有"注入了几个事件"这回事）。★**验收看回执**，别只翻 trace。
 *  2. **坐标口径不同**（★最容易被"碰巧能跑"掩盖）：DOM 那条的数交给 `sendInputEvent`
 *     ⇒ 是**内容区 CSS 像素**（`shot.cjs` 的 `CONFIG_XY` 就是这么标的）；VM 那条由渲染窗的命令表解析
 *     ⇒ 是**虚拟坐标 0..1280 / 0..720**（`debugCommand.ts:197`）。本机内容区 ≈1280×722 CSS
 *     （截图 1600×902 ÷ DPR 1.25）⇒ 两套数**数值重合**、照抄 `CONFIG_XY` 碰巧也对；
 *     **窗口尺寸/缩放一变就分叉**（那时 VM 通道要按 1280×720 折算，或改用 `clickimg` —— 它声明
 *     "我给的数是**内容区**口径"，由本脚本按通道折算，见文件头「坐标口径」那节）。
 *  3. **保真度**：DOM 那条过宿主焦点/悬停（真 DOM 事件），VM 那条与宿主无关（两端同语义、可断言）。
 *
 * **默认仍是 DOM 那条**（不许无声改既有 E4 用法 `npm run shot --load` 的依赖路径）。
 *
 * ```
 * click <x> <y>        在游戏窗口里点一下（坐标**已经是该通道的目标口径**：DOM=内容区 CSS 像素、VM=虚拟坐标）
 * clickn <x> <y> [次数] [间隔ms]   连点 N 下（默认 1 下、300ms 间隔）—— ADV 一页一次点击时用
 * clickimg <x> <y>     同上，但坐标**声明为内容区 CSS 像素**（`click` 相对 `clickimg` 的差别就在这句话）：
 *                      DOM 通道**恒等**；VM 通道按 `getContentSize()` 折成虚拟坐标（`contentToVirtual`）
 * move <x> <y>         只移动光标（复核悬停门控）
 * shot [名字]          远程截图 → `<仓库根>/.tmp/dbg-<名字>.png`。**默认走渲染窗那条**（B′，见下表）
 * screencap [名字]     同上但走**旧的整窗那条**（主进程 `capturePage()`，形态 C）；★产物只作**目视/看覆盖层**
 * capture [路径]       渲染窗那条（B′），但路径任选；给了路径 ⇒ 直接落盘，不给 ⇒ 只回 base64
 *                      ★相对路径按**仓库根**解析（`capture .tmp/x.png` ⇒ `<仓库根>/.tmp/x.png`，
 *                        与 `shot` 的产物同目录；`save`/`load` 仍是 cwd 口径）；回执里报**绝对路径**。
 * ```
 *
 * ## 两条截图管线（`tickets/T-0133` §B.4.4 的 B′ vs 形态 C；`tickets/T-0142` acceptance ②）
 * | 命令 | 管线 | 产物形态 | 尺寸 | 有没有 HTML 覆盖层 |
 * |---|---|---|---|---|
 * | `shot` / `capture` | 渲染窗 `FrameHost.capture`（B′，`renderer.extract.canvas`） | **Pixi 舞台**读回 | 恒 **1280×720**（引擎虚拟分辨率） | 无 |
 * | `screencap` | 主进程 `webContents.capturePage()`（形态 C） | **整窗**图像像素 | 随窗口几何（本机实测 1604×903 ≈ 舞台 × DPR 1.25） | 有 |
 *
 * ★**为什么 `shot` 的默认改成了 B′**（`tickets/T-0142` acceptance ②）：两条管线抓的是**同一画面**，
 *   差别只是分辨率（实测：两个方向的缩放 1.2531/1.2542 一致、宽高比 1.7763/1.7778 一致 ⇒ 无 letterbox、
 *   无额外区域；见 `tickets/T-0142/changes.md`）—— 而 B′ 的尺寸**与窗口几何无关**（恒 1280×720），
 *   E4 取证在换窗口/换机器之后仍然可比。整窗那条降级为**显式**的 `screencap`（不删：要看"整窗/覆盖层"
 *   时只有它给得出）；★它**不再是任何坐标换算的基准**（见下一条）。
 *
 * ★**坐标口径：`clickimg` 的输入 = 内容区 CSS 像素**（`tickets/T-0142` acceptance ⑦，2026-09-25 定）。
 *   从前它是"整窗截图图像像素"，得靠一次 `capturePage()` 现算比例 —— 用户的原话是
 *   「本身携带标题后就不可控」：基准随窗口尺寸/DPI 漂，还平白多一次往返。现在改成：
 *     * **DOM 通道**：`sendInputEvent` 要的**就是**内容区 CSS 像素 ⇒ **恒等**（连 `getContentSize()` 都不用）；
 *     * **VM 通道**：按 `getContentSize()` 折成虚拟坐标（`contentToVirtual`，1280×720）。
 *   ⇒ **`capturePage()` 与点击坐标彻底解耦**（它现在只负责 `screencap` 的产物）。
 *   实务上怎么取坐标：`shot` 的图是 1280×720 舞台，本机内容区 1283×722 ⇒ 两者差 0.23%，
 *   **从 `shot` 图上量的坐标可以直接喂 `clickimg`**；窗口明显换尺寸/DPI 时按回执里印的
 *   `内容区=WxH`（`shot`/`screencap` 都印）折算。
 *
 * ★为什么 `capture` 的落盘在主进程：渲染进程**没有 fs**（`src/vm/engineSnapshot.ts` 自己也一处文件 IO
 *   都没有，有源码棘轮守着）⇒ 主进程是唯一同时"够得到渲染窗的答案"又"够得到磁盘"的地方（与
 *   `tickets/T-0122` 的 `save`/`load` 同一条理由）。
 * ★`capture` 无路径时**逐字保持既有语义**（base64 在回执的 `png` 字段里）——落盘是**加法**，不是替换。
 *
 * ⚠ **三种坐标别混**（这是本脚本最容易点错的地方）：
 *   1. **内容区 CSS 像素** —— `clickimg` 的口径，也是 DOM 通道 `sendInputEvent` 的口径；
 *   2. **虚拟坐标 0..1280 / 0..720** —— VM 通道命令表的口径，也**等于** `shot` 舞台图的像素坐标；
 *   3. **整窗图像像素**（`screencap` 的产物，= 内容区 × DPR）—— **只用于目视**，不再是任何点击的输入。
 *   本机三者数值接近（1283×722 / 1280×720 / 1604×903，前两者差 0.23%）⇒ 照抄旧例常常"碰巧能跑"，
 *   **窗口尺寸或 DPI 一变就会分叉** ⇒ 拿不准就看回执里印的折算。
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

/**
 * 本进程的**代码新鲜度**自述（`--ping` 回执里给出来）。
 *
 * 为什么要有它：本守护进程是**唯一长期活着的**进程 —— `tools/*.cjs` 在 `require` 那一刻定死，
 * 改了磁盘上的文件**不会**影响已经在跑的它（`tools/dbg.cjs` 每次都是新进程，所以永远是新的）。
 * 于是"我改了代码但它没生效"会被误读成"代码写错了"。这里把两个时间点都印出来，
 * 让"要不要重启"从**猜**变成**查**：磁盘 mtime > 启动时刻 ⇒ 本进程是旧代码。
 */
const SRV_START_MS = Date.now();
const STARTED_AT = new Date(SRV_START_MS).toISOString();
function srvFreshness() {
  try {
    const st = fs.statSync(__filename);
    return { disk: st.mtime.toISOString(), stale: st.mtimeMs > SRV_START_MS + 1 };
  } catch {
    return { disk: '（读不到 tools/debugsrv.cjs 的 mtime）', stale: false };
  }
}

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

/** 引擎**虚拟分辨率**（= 渲染窗命令表的坐标口径 = `shot` 舞台图的尺寸：见文件头「两条截图管线」）。 */
const STAGE_W = 1280;
const STAGE_H = 720;

/**
 * **内容区 CSS 像素 → 引擎虚拟坐标（1280×720）**。
 *
 * ★`tickets/T-0142` acceptance ⑦（用户 2026-09-25 的决定）：`clickimg` 的输入口径从
 *   「整窗截图图像像素」改成「**内容区 CSS 像素**」—— 换算只用 `getContentSize()`，
 *   **不再调 `capturePage()`**。理由：那次 `capturePage()` 既是一次多余往返，又让基准随窗口尺寸/DPI
 *   漂（用户的原话：「本身携带标题后就不可控」）。
 * ★DOM 通道**不需要这一步**：`sendInputEvent` 要的口径**就是**内容区 CSS 像素 ⇒ 恒等。
 * ★`tools/shot.cjs` 里那份 `toSend`（`(x+28.4)/0.955`）是**当时那台机器、那个窗口尺寸**标出来的
 *   （DPR + 标题栏偏移揉在一起）；2026-09-23 本机实测它对不上（点存档列表的行没有反应）⇒ 不沿用。
 */
function contentToVirtual(x, y) {
  const w = windows.game;
  if (!w || w.isDestroyed()) return null;
  const [cw, ch] = w.getContentSize();
  if (!cw || !ch) return null;
  return [Math.round((x * STAGE_W) / cw), Math.round((y * STAGE_H) / ch)];
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
/**
 * **远程截图（形态 C：主进程 `capturePage()` = 整窗图像像素）** —— 现在只由**显式**的 `screencap` 用。
 *
 * `tickets/T-0142` acceptance ②：`shot` 已改走渲染窗那条（B′，见 `screenshotStage`）。旧管线降级为
 * **显式选择**而不是删掉 —— 现在它只用来看**整窗/HTML 覆盖层**（★**不再**参与任何坐标换算，
 * 见文件头「坐标口径」那节：`clickimg` 已改成内容区口径，与 `capturePage()` 解耦）。
 */
async function screenshotWholeWindow(name) {
  const w = windows.game;
  if (!w || w.isDestroyed()) return '没有游戏窗口（未截图）';
  const safe = String(name || 'dbg').replace(/[^A-Za-z0-9_.-]/g, '_');
  const out = path.join(ROOT, '.tmp', `dbg-${safe}.png`);
  const img = await w.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  const { width, height } = img.getSize();
  const [cw, ch] = w.getContentSize();
  return `screencap ${out} (${width}x${height})  内容区=${cw}x${ch}  管线=主进程 capturePage（只作目视，非点击基准）`;
}

/** 向渲染窗要一帧（**B′：`FrameHost.capture`** = 页面内 `renderer.extract` 读回）—— `shot` / `capture` 共用这一步。 */
async function rendererCapturePng() {
  const r = await sendDebugQuery('capture');
  const b64 = r?.png;
  if (r?.ok === false || typeof b64 !== 'string' || b64 === '') {
    throw new Error(String(r?.lines?.[0] ?? '渲染窗没给出 PNG'));
  }
  return Buffer.from(b64, 'base64');
}

/** 落盘（目录不存在就建）—— 主进程是唯一有 fs 的那一侧。 */
function writePng(abs, buf) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

/**
 * **远程截图（B′：渲染窗 `FrameHost.capture`）** —— `shot` 的默认做法（`tickets/T-0142` acceptance ②）。
 *
 * 换管线的理由（实测口径，见 `tickets/T-0142/changes.md`）：
 *  1. 两条管线抓的是**同一画面**，差别只是分辨率 —— 整窗那条约等于舞台 × DPR
 *     （1604×903 vs 1280×720，两个方向的缩放 1.2531/1.2542 一致、宽高比 1.7763/1.7778 一致）；
 *  2. 舞台那条的尺寸**与窗口几何无关**（恒 1280×720 = 引擎虚拟分辨率）⇒ E4 取证在换窗口/换机器后
 *     仍然可比，而整窗那条会随窗口尺寸/缩放漂；
 *  3. 代价 = 丢掉 HTML 覆盖层 —— 本 app 的覆盖层为空（游戏窗的内容区就是画布），要看它用 `screencap`。
 */
async function screenshotStage(name) {
  const safe = String(name || 'dbg').replace(/[^A-Za-z0-9_.-]/g, '_');
  const out = path.join(ROOT, '.tmp', `dbg-${safe}.png`);
  const buf = await rendererCapturePng();
  writePng(out, buf);
  const dim = pngSize(buf);
  // ★回执里同时印出**内容区尺寸**：`clickimg` 的口径是内容区 CSS 像素（acceptance ⑦），
  //   而图是 1280×720 舞台 —— 两者不等时（换窗口/DPI）这就是那个折算系数，省得再开别的命令问。
  const w = windows.game;
  const cs = w && !w.isDestroyed() ? w.getContentSize() : null;
  return (
    `shot ${out} (${dim ? `${dim[0]}x${dim[1]}` : '尺寸未知'})` +
    `  内容区=${cs ? `${cs[0]}x${cs[1]}` : '（无窗口）'}` +
    `  管线=渲染窗 FrameHost.capture（舞台=虚拟分辨率）`
  );
}

/**
 * 从 PNG 字节里读 IHDR 的宽高（**不引依赖**：签名 8 字节 + 长度 4 + `IHDR` 4 ⇒ 宽在 16、高在 20）。
 * 为什么报告它：`capture` 与 `shot` 是两条管线，最容易被忽略的差异就是**尺寸不同**
 * （一个是整窗图像像素、一个是 Pixi 舞台读回）——把它印在回执里，E4 取证时不必再开图工具。
 */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
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
    const f = srvFreshness();
    const lines = ['pong', `game=${windows.hasGame()}`, `守护进程起于 ${STARTED_AT}；磁盘上的 tools/debugsrv.cjs 改于 ${f.disk}`];
    if (f.stale) {
      lines.push('★★ 磁盘上的 tools/debugsrv.cjs 比本进程新 ⇒ 本进程跑的是**旧代码**（改了工具行为看不到效果就是这里）');
      lines.push('   ⇒ 重启守护进程才会生效：`node tools/dbg.cjs --quit` 后重跑 `npm run dbg:srv`（tools/*.cjs 不参与编译）');
    }
    send(sock, { id, ok: true, lines });
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
  // ★`tickets/T-0142` acceptance ②：`shot` 现走**渲染窗那条**（B′），`screencap` 保留旧的整窗那条 ——
  //   两条管线由**命令名**区分（不再有"同一个名字两套语义"）。
  if (head === 'shot' || head === 'screencap') {
    const name = text.split(/\s+/)[1];
    try {
      const line = head === 'shot' ? await screenshotStage(name) : await screenshotWholeWindow(name);
      send(sock, { id, ok: true, lines: [line] });
    } catch (err) {
      send(sock, { id, ok: false, lines: [`${head} 失败：${err.message}`] });
    }
    return;
  }
  // ★**另一条截图管线**（`tickets/T-0142` acceptance ② / `T-0133` §B.4.4 的 B′）：本命令**不**在本进程
  //   抓图，而是把裸命令 `capture` 转给渲染窗的命令表（`FrameHost.capture` = 页面内 `renderer.extract`
  //   读回），因此它抓的是 **Pixi 舞台**（无 HTML 覆盖层），与 `screencap` 的整窗 `capturePage()` 是两条路。
  //   ★给了路径就**由本进程落盘**（渲染进程没有 fs；与 `save`/`load` 同一条理由）——
  //   于是"要哪条管线"与"存哪"两件事都显式，且回执直接报字节数/图像尺寸（不必再手工解 base64）。
  //   ★无路径 ⇒ 逐字保持既有语义（base64 在回执的 `png` 字段里），落盘是**加法**不是替换。
  //   ★与 `shot` 的关系：`shot <名字>` 就是"这条管线 + 固定落点 `<root>/.tmp/dbg-<名字>.png`"。
  if (head === 'capture') {
    const file = text.slice(head.length).trim();
    if (file === '') {
      const r = await sendDebugQuery('capture');
      send(sock, { id, ...r });
      return;
    }
    let buf;
    try {
      buf = await rendererCapturePng();
    } catch (err) {
      send(sock, { id, ok: false, lines: [`capture：${err.message}`] });
      return;
    }
    // ★相对路径按**仓库根**（`ROOT`）解析，与 `shot` 的产物落点（`<root>/.tmp/dbg-*.png`）同一口径 ——
    //   两条管线的图要能摆在一起对照，先得"写 `.tmp/x.png` 就都写进同一个 `.tmp/`"。
    //   （★与 `save`/`load` 的 cwd 口径**不同**：那两条是既有行为，本轮不动它；回执里一律报**绝对路径**。）
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    writePng(abs, buf);
    const dim = pngSize(buf);
    send(sock, {
      id,
      ok: true,
      lines: [`capture → ${abs}（${buf.length} 字节${dim ? `，${dim[0]}x${dim[1]}` : ''}；管线 = 渲染窗 FrameHost.capture）`],
    });
    return;
  }
  if (head === 'click' || head === 'tap' || head === 'clickimg' || head === 'move' || head === 'clickn') {
    const n = text.split(/\s+/).slice(1).map((s) => Number.parseInt(s, 10));
    if (n.length < 2 || !Number.isInteger(n[0]) || !Number.isInteger(n[1])) {
      send(sock, { id, ok: false, lines: [`${head}：用法是 \`${head} <x> <y>${head === 'clickn' ? ' [次数] [间隔ms]' : ''}\`（收到「${text}」）`] });
      return;
    }
    // ★`tickets/T-0142`（acceptance ①）：**VM 外层桥**这条输入通道。
    //   为什么要它：Electron 侧原先走 `webContents.sendInputEvent`（真 DOM 事件），而 web 宿主走
    //   `ScenarioEvent` → `applyScenarioEvent`（`src/vm/debugCommand.ts` 的命令表）⇒ **同一个"agent 点一下"
    //   有两条实现**，语义与可观测性会漂（本工程最忌的那种）。打开这个开关后，本进程**不再自己造 DOM 事件**，
    //   而是把同一行命令原样转给渲染窗的命令表 —— 与 web 宿主**逐字同源**（trace 里会出现 `[input] 注入 N 个事件`）。
    //   ★**默认关**（`AMAYUI_DEBUG_INPUT=vm` 才开）：`sendInputEvent` 那条路有"真 DOM 保真度"（过宿主焦点/悬停），
    //   而它是**既有 E4 用法（`npm run shot --load` 一族）依赖**的路径 ⇒ 不许无声改默认行为。
    //   两条路的差别写在 `tools/dbg.cjs` 的用法头与 `debugsrv.cjs` 的文件头里。
    if (String(process.env.AMAYUI_DEBUG_INPUT ?? '').toLowerCase() === 'vm' && head !== 'clickn') {
      // ★`clickimg` 的坐标是**内容区 CSS 像素**（acceptance ⑦ 改的口径）⇒ 渲染窗只认虚拟坐标，
      //   所以这里折算一次；`click`/`move` 则按"坐标已是该通道的目标口径"**原样透传**。
      let x = n[0];
      let y = n[1];
      if (head === 'clickimg') {
        const mapped = contentToVirtual(n[0], n[1]);
        if (!mapped) {
          send(sock, { id, ok: false, lines: ['没有游戏窗口（输入未发送）'] });
          return;
        }
        [x, y] = mapped;
      }
      const cmd = head === 'move' ? `move ${x} ${y}` : `click ${x} ${y}`;
      const r = await sendDebugQuery(cmd);
      // 回执里带上这次折算（"点了没反应"时第一件要排除的事就是坐标口径）
      const extra = head === 'clickimg' ? [`（内容区 ${n[0]},${n[1]} → 虚拟 ${x},${y}）`] : [];
      send(sock, { id, ...r, lines: [...(r?.lines ?? []), ...extra] });
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
      // ★口径 = **内容区 CSS 像素**，而 `sendInputEvent` 要的**正是**它 ⇒ **恒等**（不再有 capturePage 往返）。
      const [x, y] = [n[0], n[1]];
      send(sock, { id, ok: true, lines: [`${await clickAt(x, y)}（内容区坐标 ${n[0]},${n[1]}；DOM 通道恒等）`] });
      return;
    }
    const [x, y] = [n[0], n[1]];
    const what = head === 'move' ? moveAt(x, y) : await clickAt(x, y);
    send(sock, { id, ok: true, lines: [what] });
    return;
  }

  // ★`tickets/T-0122`：**引擎态快照的落盘/读取在"这一层"**（`save <路径>` / `load <路径>`）。
  //   为什么不是渲染窗：渲染进程**没有 fs**（`engineSnapshot.ts` 自己也一处文件 IO 都没有，
  //   见它的源码棘轮守卫）。⇒ 这里是唯一同时"够得到渲染窗的答案"又"够得到磁盘"的地方。
  //   命令名刻意与渲染窗的 `snapshot` / `restore` 分开：`save`/`load` 是**带路径**的整件事，
  //   `snapshot`/`restore` 是**纯内存**的两个动词（面板/别的宿主也能用）。
  if (head === 'save' || head === 'load') {
    const file = text.slice(head.length).trim();
    if (!file) {
      send(sock, { id, ok: false, lines: [`${head}：用法 ${head} <路径>（save = 导出引擎态快照；load = 灌回）`] });
      return;
    }
    if (head === 'save') {
      const r = await sendDebugQuery('snapshot');
      const json = (r?.lines ?? [])[0];
      if (r?.ok === false || typeof json !== 'string' || !json.startsWith('{')) {
        send(sock, { id, ok: false, lines: [`✗ snapshot 没给出 JSON：${JSON.stringify(r).slice(0, 200)}`] });
        return;
      }
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, `${json}\n`, 'utf8');
      const bytes = fs.statSync(file).size;
      send(sock, { id, ok: true, lines: [`已存引擎态快照 → ${file}（${bytes} 字节）`] });
      return;
    }
    if (!fs.existsSync(file)) {
      send(sock, { id, ok: false, lines: [`✗ 没有这个文件：${file}`] });
      return;
    }
    const b64 = Buffer.from(fs.readFileSync(file, 'utf8'), 'utf8').toString('base64');
    const r = await sendDebugQuery(`restore ${b64}`);
    send(sock, { id, ...r });
    return;
  }

  // ★`tickets/T-0127`：**本进程不再认识任何命令** —— 它只把整行原样转发给渲染窗，由那里的
  //   `parseDebugCommand`（零依赖纯词汇表，与控制面板同一份）解析并派发，回执也由它给出。
  //   为什么改：这里原先有一份"与 `debugBreak.parseDebugCommand` 同形"的手抄分流表 —— 那是**第三份**
  //   拷贝（面板一份、渲染窗一份、这里一份），而面板那份已经漂移出过非法事件名 `global-write`。
  //   现在增删命令只需改 `src/vm/debugCommand.ts` 一处。
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
    send(sock, { event: 'hello', text: 'amayui debug server', game: windows.hasGame(), ...srvFreshness(), startedAt: STARTED_AT });
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
