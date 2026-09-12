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
 *   npm run shot -- --name mycase    # 产物前缀（默认 shot）
 *
 * 产物：`<仓库根>/.tmp/<name>-<步骤>.png`（每步一张）+ 主进程 stdout。
 *
 * ★时序不要用"睡固定秒数"：机器忙时启动链会慢一倍以上（实测出现过 20s 还没到 TITLE，
 *   于是所有截图都是黑的，看起来像 bug 复现）。这里一律**等日志里出现装载标记**再动作。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

require('../dist/electron/main.cjs'); // 真实主进程：建窗口 + 注册 IPC（脚本/图像/配置）

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, '.tmp');
const LOG = path.join(OUT, 'amayui-emulator.log');

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const NAME = argOf('name', 'shot');
const TABS = (argOf('tabs', '4')) // 默认：先看角色设定（曾经黑屏的那一页）
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 0 && n <= 5);

/** TITLE 菜单「CONFIG」项命中点（与 src/tools/config1Chain.ts 的 CONFIG_XY 一致）。 */
const CONFIG_XY = [807, 621];
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
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getContentSize()[0] === 1280) ?? null;
}

async function click(win, [x, y]) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(150);
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(180);
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

async function shot(win, step) {
  const img = await win.webContents.capturePage();
  const p = path.join(OUT, `${NAME}-${step}.png`);
  fs.writeFileSync(p, img.toPNG());
  const { width, height } = img.getSize();
  // 全黑/全透明（= 只剩 Pixi 背景色）时给个显眼提示：这类"没画出东西"正是要抓的 bug
  const blackish = img.toBitmap().every((v, i) => i % 4 === 3 || v < 40);
  console.log(`[shot] ${p} (${width}x${height})${blackish ? '  ★几乎全黑：可能有渲染缺陷' : ''}`);
}

(async () => {
  await app.whenReady();
  await sleep(2000);
  const win = gameWin();
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
