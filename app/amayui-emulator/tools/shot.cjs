/**
 * **自动截图（E4 目视回归）** —— `npm run shot`
 *
 * 为什么需要它：`analyse`/headless 只能证明"模型对"，证明不了"画面对"。这一轮的黑屏
 * （切到角色设定页后整屏只剩背景色）就是靠它抓到的：主进程合成鼠标事件走一遍真实链路，
 * 再用 `capturePage()` 把窗口存成 PNG。没有它就只能"让我再点一次截图发我"。
 *
 * 用法（**先 `npm run build:electron`**，因为本脚本复用主进程产物 `dist/electron/main.cjs`）：
 *   npm run shot                     # 默认路径：TITLE → CONFIG → CONFIG1 → 角色设定 → 回第 1 页
 *   npm run shot -- --tabs 9 8       # 只点指定的左侧分类序号（0..5），按给出的顺序
 *   npm run shot -- --gallery        # 回想 → BGM 鉴赏（第三个按钮）：验证曲目列表能列出来
 *   npm run shot -- --gamestart      # 右上角 Game Start → 配置界面 ゲーム開始 → SN0000 首文案
 *   npm run shot -- --name mycase    # 产物前缀（默认 shot）
 *   npm run shot -- --centered       # 恢复"窗口居中弹出"（默认测试期贴屏幕下缘、不抢焦点，见 `T-0040`）
 *
 * 产物：`<仓库根>/.tmp/<name>-<步骤>.png`（每步一张）+ 主进程 stdout。
 *
 * ★时序不要用"睡固定秒数"：机器忙时启动链会慢一倍以上（实测出现过 20s 还没到 TITLE，
 *   于是所有截图都是黑的，看起来像 bug 复现）。这里一律**等日志里出现装载标记**再动作。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { preflight, ToolPathError } = require('./paths.cjs');

// ★必须关掉"后台/被遮挡窗口"的节流：主进程是脚本自己（窗口不在前台）时，Chromium 会把
//   requestAnimationFrame 降到极低频 ⇒ 渲染循环几乎不推进 ⇒ 启动链永远到不了 TITLE
//   （实测：VM 时钟 60s 只走到 1.8s，截图全黑、`-> TITLE.BIN` 标记不出现，看起来像渲染崩了）。
//   这也解释了同一份代码"有时能截到、有时全黑"。
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// ★测试期"贴边开窗"（`tickets/T-0040`）：默认把窗口摆到屏幕**下缘**（只留标题栏）、不抢焦点，
//   免得每次弹到正中打断手头的事。必须**在 require main.cjs 之前**设（主进程模块加载期读它）；
//   `--centered` 或 `AMAYUI_WINDOW_EDGE=0` 可单次恢复"居中弹出"。
if (!process.argv.includes('--centered')) process.env.AMAYUI_WINDOW_EDGE ??= '1';

// ★★`tickets/T-0032`：**参数校验必须早于 `require(main.cjs)`** —— 否则参数错会变成
//   Electron 的「App threw an error during load」弹窗（`record.cjs` 的实测事故）。
//   截图产物固定落仓库 `.tmp/`；`--name` 只是文件名，不许带路径分隔符（那会写到别处去）。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const NAME = (() => {
  const raw = argOf('name', 'shot');
  if (/[\\/]/.test(raw) || raw.includes('..')) {
    console.error(`✗ --name 只是文件名，不能带路径分隔符或 ..（实得：${raw}）—— 产物目录固定为仓库 .tmp/`);
    process.exit(2);
  }
  return raw;
})();
const OUT = path.join(ROOT, '.tmp');
const LOG = path.join(OUT, 'amayui-emulator.log');
// 统一的路径校验装配（与 record.cjs 同一份规则；这里没有需要解析的路径参数，但要把基准打印出来）
try {
  const r = preflight({ out: `.tmp/${NAME}-0.png`, log: (m) => console.log(m) });
  console.log(`[paths] 截图产物目录 = ${OUT}（基准 = 仓库根；示例：${r.outPath}）`);
} catch (err) {
  if (!(err instanceof ToolPathError)) throw err;
}

require('../dist/electron/main.cjs'); // 真实主进程：建窗口 + 注册 IPC（脚本/图像/配置）
const TABS = (argOf('tabs', '4')) // 默认：先看角色设定（曾经黑屏的那一页）
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 0 && n <= 5);

/** TITLE 菜单「CONFIG」项命中点（与 src/tools/config1Chain.ts 的 CONFIG_XY 一致）。 */
const CONFIG_XY = [807, 621];
/**
 * TITLE 菜单「回想（ROOM）」与 ROOM 里第三个按钮「BGM 鑑賞（MMODE）」的命中点。
 * 由命中区扫描得到（`.tmp/menuScan.mts`，20px 网格取质心；同一方法给出的 CONFIG 质心
 * = (814,618)，与上面已知可用的 CONFIG_XY 一致 ⇒ 该方法可信）。
 */
const ROOM_XY = [956, 577];
const MMODE_XY = [1018, 450];
/**
 * TITLE 菜单「Game Start」（第 0 项，**右上角**）与 GAMESTART 配置界面「ゲーム開始」（第 0 项）。
 * 由脚本数据算出（不写死像素"魔法数"）：`TITLE.txt:100` 的 `i12e` 命中盒 `156×156`
 * + baseX `local 5[0]=0x44e` / baseY `local 69[0]=0x126` ⇒ 中心 (1180,372)；
 * `GAMESTART.txt:115` 的命中盒 `193×59` + baseX `local 195[0]=0x2cb` / baseY `local 1f9[0]=0x240`
 * ⇒ 中心 (811,605)。与 `src/tools/gameStartChain.ts` 的两个常量一致。
 */
const GAME_START_XY = [1180, 372];
const START_GAME_XY = [811, 605];
/**
 * TITLE 菜单第 **1** 项 = 「Load Data」：同一张 `i12e` 数据表（`TITLE.txt:100`）的第 1 项
 * = baseX `local 5[1] = 0x3e0`、baseY `local 69[1] = 0x192`、盒 156×156 ⇒ 中心 (1070,480)。
 */
const LOAD_MENU_XY = [1070, 480];
/** 左侧分类列表第 i 项的中心（贴片画在 (24, 106+50i)，190×26）。 */
const tabXY = (i) => [120, 106 + 50 * i];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitLog(marker, timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (fs.readFileSync(LOG, 'utf8').includes(marker)) return true;
    } catch {
      /* 日志还没建 */
    }
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(500);
  }
}

function gameWin() {
  const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  // 主进程日志里的 `窗口=1280x720` 是**请求尺寸**；`getContentSize()` 取到的是实际内容区
  // （贴边档/边框会让它不等于 1280）⇒ 按"宽 ≥1200 的那个"认，并在找不到时把候选项打出来。
  const hit = all.find((w) => w.getContentSize()[0] >= 1200);
  if (hit) return hit;
  if (all.length > 0) {
    console.log('[shot] 候选窗口：' + all.map((w) => `${w.getContentSize().join('x')}`).join(' / '));
  }
  return null;
}

/** 等游戏窗口出现（主进程建窗是异步的；固定 `sleep(2000)` 在慢机器上会扑空 ⇒ "未找到游戏窗口"）。 */
async function waitGameWin(timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const w = gameWin();
    if (w) return w;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(500);
  }
}

async function click(win, [x, y]) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(150);
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(180);
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

/** 只移动光标（不按键）——复核悬停 UI（热点的 labelA/labelB 派发）。 */
async function hover(win, [x, y]) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(120);
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y: y + 1 }); // 再动一格 ⇒ 确保有 mouseMoved 沿
  await sleep(120);
}

async function shot(win, step) {
  // ★窗口被销毁（用户关窗 / 进程退出）时不要抛穿整个流程：留一条显式告警，后面的步骤会被跳过。
  if (win.isDestroyed()) {
    console.log(`[shot] 跳过 ${step}：窗口已销毁`);
    return false;
  }
  let img;
  try {
    img = await win.webContents.capturePage();
  } catch (e) {
    console.log(`[shot] 跳过 ${step}：capturePage 失败（${e.message}）`);
    return false;
  }
  const p = path.join(OUT, `${NAME}-${step}.png`);
  fs.writeFileSync(p, img.toPNG());
  const { width, height } = img.getSize();
  // 全黑/全透明（= 只剩 Pixi 背景色）时给个显眼提示：这类"没画出东西"正是要抓的 bug
  const blackish = img.toBitmap().every((v, i) => i % 4 === 3 || v < 40);
  console.log(`[shot] ${p} (${width}x${height})${blackish ? '  ★几乎全黑：可能有渲染缺陷' : ''}`);
  return true;
}

(async () => {
  await app.whenReady();
  await sleep(2000);
  const win = await waitGameWin();
  if (!win) {
    console.error('[shot] 未找到游戏窗口');
    app.quit();
    return;
  }
  win.focus?.();
  const okTitle = await waitLog('-> TITLE.BIN');
  console.log(`[shot] TITLE=${okTitle}`);
  await sleep(4000);
  await shot(win, '0-title');

  // ---- --gallery：回想 → BGM 鉴赏（第三个按钮）。验证 0x19D/0x1BF/0x21D/0xB8 那一族的可见效果 ----
  if (argv.includes('--gallery')) {
    await click(win, ROOM_XY);
    const okRoom = await waitLog('-> ROOM.BIN', 30000);
    console.log(`[shot] ROOM=${okRoom}`);
    await sleep(3000);
    await shot(win, '4-room');
    await click(win, MMODE_XY);
    const okMmode = await waitLog('-> MMODE.BIN', 30000);
    console.log(`[shot] MMODE=${okMmode}`);
    await sleep(4000);
    await shot(win, '5-bgm-list');
    console.log('[shot] 完成（gallery）');
    app.quit();
    return;
  }

  // ---- --load：右上角菜单「Load Data」→ 读档列表 → 「LOAD」按钮 → 确认 → 读档后的画面 ----
  // 用途：读档链路的 E4 目视回归（"读档后画面到底是什么"）。
  //   ★载入的是**列表当前选中的槽**（列表会记住上次的页/光标，机器相关）：
  //     `--back N` 先用左侧大箭头回退 N 个「百」页（页号按钮 0..90 是十位），默认 0 = 不动列表
  //     —— 此时底部信息面板显示的就是即将载入的槽，`11-load-list.png` 上可核。
  //   ★坐标系：`sendInputEvent` 与 `capturePage` **不是同一套**（实测 DPR 1.2523 + 标题栏偏移）；
  //     `toSend` 由"点 (640,325) → 命中第 4 行、点 (640,547) → 命中第 8 行"两点标定。
  if (argv.includes('--load')) {
    const slot = argOf('load', '79');
    await click(win, LOAD_MENU_XY); // TITLE 菜单第 1 项 = Load Data
    const okSave = await waitLog('-> SAVE.BIN', 30000);
    console.log(`[shot] SAVE.BIN=${okSave}`);
    await sleep(4000);
    const toSend = (ix, iy) => [Math.round((ix + 28.4) / 0.955), Math.round((iy + 28.4) / 0.955)];
    // ★页号行（image y≈19）是**十位**选择器：「70」⇒ 显示 070..079，且此时底部面板的当前槽就是 079。
    //   x 与 y 的换算**不是同一个比例**（实测：send 850 命中「60」）⇒ 允许一次给多个候选，
    //   逐个点+截图，人工核对哪一张到了 07x（pageCal 前缀）。
    const pageXs = String(argOf('page', '0'))
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    for (let i = 0; i < pageXs.length; i++) {
      await click(win, [pageXs[i], toSend(0, 19)[1]]);
      await sleep(2500);
      await shot(win, `11-pageCal-${i}-x${pageXs[i]}`);
    }
    // ★页号按钮那一行很薄、命不中 ⇒ 用左侧大箭头逐页回退（每步移动一个「百」），每步截图可核。
    const backPages = Number(argOf('back', '0'));
    for (let i = 0; i < backPages; i++) {
      await click(win, toSend(30, 296)); // 左翻页箭头
      await sleep(2000);
      await shot(win, `11-load-page-${i}`);
    }
    // ★`--row <y>`：在列表里先**点一行**再按 LOAD —— `--load <slot>` 只是"标记"，实际载入的是
    //   **列表当前选中的那一行**（列表会记住上次的页/光标 ⇒ 连跑两次会重复载入同一个槽；
    //   用户实测踩过：`--load 78` 实际载入了 79）。y 用**图像坐标**（与 `11-load-list.png` 同尺）；
    //   标定参考：第 4 行 ≈ 325、第 8 行 ≈ 547（`toSend` 的标定来源见文件头注释）。
    //   ★**不要用按键移动光标**：曾加过 `--key Up`，实测那个键会"看起来一直被按着"（用户观察），
    //   而且会污染后续输入 ⇒ 已移除，只保留点行。
    const rowY = Number(argOf('row', '0'));
    if (Number.isFinite(rowY) && rowY > 0) {
      await click(win, toSend(400, rowY));
      await sleep(1200);
      await shot(win, `11-row-y${rowY}`);
    }
    await shot(win, '11-load-list');
    await click(win, toSend(130, 575)); // 左下「LOAD」按钮（加载当前选中槽）
    const okDlg = await waitLog('SBUNKIMOVE.BIN', 15000);
    console.log(`[shot] 确认框=${okDlg}`);
    await sleep(2500);
    await shot(win, '12-load-confirm');
    if (okDlg) {
      await click(win, toSend(530, 266)); // 确认框「是」
      // ★判据用日志里的 `savedCur=2`（= 槽 79 的特征），而不是笼统的 `[slot-load]`：
      //   否则"载入了别的槽"会被当成成功。
      const okLoad = (await waitLog('savedCur=2', 25000)) || (await waitLog('[slot-load]', 5000));
      console.log(`[shot] slot-load=${okLoad}（槽 ${slot}）`);
      if (!okLoad) {
        const l = fs.readFileSync(LOG, 'utf8').split('\n').filter((x) => x.includes('[slot-load]'));
        console.log(`[shot] ★实际载入的槽：${l[l.length - 1] ?? '（无）'}`);
      }
    }
    await sleep(1500);
    await shot(win, '13-load-right-after');
    await sleep(6000);
    await shot(win, '14-load-6s');
    await click(win, [640, 450]); // 推进一步
    await sleep(4000);
    await shot(win, '15-load-next');
    // ★`--burst <秒>`：点完之后**连拍**（每 2 秒一张）——用来抓"只出现一小段时间"的画面：
    //   · SN0000 → SC0000 的**切章过场**（用户口径：点完要等 ~15s 才结束，之后才看得到 SC0000 的 ADV 窗）；
    //   · 存档页消失一瞬（`T-0067`）。
    //   不连拍就只能靠"睡固定秒数再截一张"猜时刻，实测总是错过那一帧。
    const burstSec = Number(argOf('burst', '0'));
    if (Number.isFinite(burstSec) && burstSec > 0) {
      const N = Math.ceil(burstSec / 2);
      for (let i = 1; i <= N; i++) {
        await sleep(2000);
        await shot(win, `16-t${i * 2}s`);
      }
    }
    console.log('[shot] 完成（load）');
    app.quit();
    return;
  }

  // ---- --gamestart：右上角 Game Start → 配置界面 ゲーム開始 → SN0000 首文案 ----
  // 判据：日志里出现 `-> SN0000.BIN`（call-script 足迹），截图应看到第一段文案与背景立绘
  //      （「由两个世界融合而生的『迪尔-利菲娜』的世界上…三神战争」= src/SN0000.txt:1224）。
  if (argv.includes('--gamestart')) {
    await click(win, GAME_START_XY);
    const okGs = await waitLog('-> GAMESTART.BIN', 30000);
    console.log(`[shot] GAMESTART=${okGs}`);
    await sleep(3500);
    await shot(win, '6-gamestart');
    await click(win, START_GAME_XY);
    const okSn = await waitLog('-> SN0000.BIN', 60000);
    console.log(`[shot] SN0000=${okSn}`);
    // 首文案是"逐字显现"的：等足以走完第一页（3 行 × 每字 MessageSpeed）再多留一截
    await sleep(9000);
    await shot(win, '7-sn0000-first-text');
    // 点一下推进到下一页，确认 ADV 推进门工作（不是卡死在同一屏）
    await click(win, [640, 360]);
    await sleep(6000);
    await shot(win, '8-sn0000-next');
    // ★悬停门控复核（2026-09 bug："右侧侧边栏无条件展示"）：只移动光标、不点击。
    //   SN0000.txt:63/74 的热点（文本区 / 侧边栏条）labelA = 展开侧边栏；
    //   SN0000.txt:66 的全屏热点 labelA = 收起 ⇒ 光标移出文本区应看到侧边栏收起。
    await hover(win, [1240, 300]); // 侧边栏条（SN0000.txt:63 的热点 x=0x49c..0x500, y=0..0x281）
    await sleep(1500);
    await shot(win, '9-sn0000-hover-out');
    await hover(win, [400, 300]);
    await sleep(1500);
    await shot(win, '10-sn0000-hover-in');
    console.log('[shot] 完成（gamestart）');
    app.quit();
    return;
  }

  await click(win, CONFIG_XY);
  const okConfig = await waitLog('-> CONFIG1.BIN', 30000);
  console.log(`[shot] CONFIG1=${okConfig}`);
  await sleep(2500);
  await shot(win, '1-config1');
  for (let i = 0; i < TABS.length; i++) {
    await click(win, tabXY(TABS[i]));
    await sleep(3500);
    await shot(win, `2-tab${TABS[i]}`);
  }
  // 回到第 1 页（对照：黑屏那次即使切回来也不会恢复）
  await click(win, tabXY(0));
  await sleep(3500);
  await shot(win, '3-tab0-back');
  console.log('[shot] 完成');
  app.quit();
})().catch((e) => {
  console.error('[shot] 失败:', e);
  app.quit();
});
