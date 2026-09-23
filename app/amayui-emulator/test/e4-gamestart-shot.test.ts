/** @tier T2 @kind tool @subsystem host */

/**
 * **T2 真机档的第一个文件**（`tickets/T-0132`）：真 Electron + 真游戏资源 + 真窗口跑一遍
 * `TITLE → GAMESTART → SN0000`，并对**像素本身**下判据。
 *
 * ## 为什么必须有这一档（headless 测不到什么）
 *
 * 下面这些症状在 T0/T1 里**结构上不可见**：headless 没有窗口、没有 `requestAnimationFrame`、
 * 没有真实的合成器与纹理屏障。
 *  - `T-0040`：贴边开窗 + 后台节流 ⇒ 启动链永远到不了 TITLE、截图全黑（"看起来像渲染崩了"）；
 *  - `T-0102`：ADV 正文行被当图元画成纯白块 ⇒ 整个 ADV 窗口是白的；
 *  - `T-0008`：`waitFlags` 镜像只置不清 ⇒ 每帧都重画（卡顿，机器判据看不到，截图能看出脏帧）。
 *
 * ## 判据（两类，都可机械复核；**不看人眼**）
 *
 *  ① **链路深度**：工具 stdout 里的 `TITLE=true` / `GAMESTART=true` / `SN0000=true`。
 *     这三个都是 `tools/shot.cjs` 的 `waitLog(...)` 产物（**等日志标记，不睡固定秒数**）⇒
 *     机器忙时不会假红/假绿（`shot.cjs` 头注记录的正是"睡固定秒数导致全黑误判"那次教训）。
 *  ② **像素本身**：标题帧那一行的 `colors=N`（工具对 `capturePage()` 的 bitmap 按 ~2 万样点统计出的
 *     不同 RGB 三元组个数）必须 ≥ `MIN_COLORS`，且不得带 `★几乎全黑` 标记。
 *     ★为什么不是"文件大小 > N KB"这种代理：纯色 1280×720 PNG 也会有几 KB，阈值没有物理依据；
 *     `colors` 直接来自像素，纯色帧恒为 1（或个位数）。
 *
 * ## 前置探测 + skip 策略（**不许把"跑不起来"变成 fail**）
 *
 * 缺 Electron / 缺 `dist/electron/main.cjs` / 缺 `install|raw` 资源根 / 非 macOS 且无 `DISPLAY`
 * ⇒ `t.skip()` 并打出缺什么（与 T1 的真资产探测同口径，见 `test/realSlots.ts`）。
 *
 * ## 什么时候必须跑它（`all`/`verify` **不含**本档，见 `test/run.ts` 头注）
 *
 * ```bash
 * npm run build:electron && npm run test:e4     # 或 npm run shot -- --gamestart
 * ```
 * 改**渲染宿主 / 输入 / 窗口时序 / 帧驱动**时必须跑；`verify` 不含它，是为了保住 `T-0115`
 * 收口出来的 ~35 s 提交前口径与"无显示器也能跑"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveResourceDir } from '../src/arch/resourceDir.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const ROOT = path.join(APP, '..', '..');
const SHOT = path.join(APP, 'tools', 'shot.cjs');
const PREBUILT = path.join(APP, 'dist', 'electron', 'main.cjs');
const require_ = createRequire(import.meta.url);

/**
 * 标题帧的 `colors` 下限。真机实测（1280×720、TITLE 画面）为 **数千**量级（见 changes.md 的原始数字），
 * 阈值取到 64 只为"与纯色/黑屏区分开"（纯色 = 1），不追求卡住画质细节 —— 那是 G4 截图评审的事。
 */
const MIN_COLORS = 64;

/** 从工具 stdout 里取某一步的截图行。 */
export function parseShotLine(out: string, step: string): { path: string; w: number; h: number; colors: number; blackish: boolean } | null {
  const re = new RegExp(`\\[shot\\] (\\S*${step}\\.png) \\((\\d+)x(\\d+)\\) colors=(\\d+)(.*)$`, 'm');
  const m = re.exec(out);
  if (!m) return null;
  return {
    path: m[1]!,
    w: Number(m[2]),
    h: Number(m[3]),
    colors: Number(m[4]),
    blackish: m[5]!.includes('几乎全黑'),
  };
}

/**
 * **判据本体**（纯函数，吃工具 stdout 吐"问题清单"，空 = 通过）。
 *
 * ★抽成纯函数是为了让"这条判据有没有判别力"**本身可测**：下面第一条用例喂三种合成 stdout
 * （好帧 / 纯色帧 / 缺标记），必须分别得到"无问题 / 报纯色 / 报缺标记"。这样即使没有 GUI 会话的机器
 * 上本文件只是 skip，判据也不会退化成"从没被验证过的正则"。
 */
export function judgeShotReport(out: string): string[] {
  const bad: string[] = [];
  for (const marker of ['TITLE', 'GAMESTART', 'SN0000']) {
    if (!new RegExp(`\\[shot\\] ${marker}=true`).test(out)) bad.push(`链路未到达 ${marker}（日志里没有 \`[shot] ${marker}=true\`）`);
  }
  const title = parseShotLine(out, '0-title');
  if (!title) bad.push('没有产出标题帧截图行（`0-title.png`）—— 工具没走到第一次 shot');
  else {
    if (title.blackish) bad.push(`标题帧被判为几乎全黑（colors=${title.colors}）`);
    if (title.colors < MIN_COLORS) bad.push(`标题帧 colors=${title.colors} < ${MIN_COLORS} ⇒ 疑似纯色/黑屏帧`);
  }
  // ADV 首文案帧（`T-0102` 那一类"ADV 窗口整片白/黑"在这里现形：背景立绘 + 文字 + 窗框都在一帧里）
  const first = parseShotLine(out, '7-sn0000-first-text');
  if (!first) bad.push('没有产出 ADV 首文案帧截图行（`7-sn0000-first-text.png`）');
  else {
    if (first.blackish) bad.push(`ADV 首文案帧被判为几乎全黑（colors=${first.colors}）`);
    if (first.colors < MIN_COLORS) bad.push(`ADV 首文案帧 colors=${first.colors} < ${MIN_COLORS} ⇒ 疑似纯色帧`);
  }
  return bad;
}

test('★判据自检（不需要 Electron）：好帧 / 纯色帧 / 缺标记 三种 stdout 必须给出不同结论', () => {
  const good = [
    '[shot] TITLE=true',
    '[shot] /tmp/x/t2-0-title.png (2560x1440) colors=4213',
    '[shot] GAMESTART=true',
    '[shot] SN0000=true',
    '[shot] /tmp/x/t2-7-sn0000-first-text.png (2560x1440) colors=3977',
  ].join('\n');
  assert.deepEqual(judgeShotReport(good), [], '好帧必须判通过');

  // ① 纯色/黑屏帧（= `T-0040` 那类"启动链没画出东西"，而日志标记可能仍然齐）
  const uniform = good.replace('colors=4213', 'colors=1');
  assert.deepEqual(
    judgeShotReport(uniform).filter((s) => s.includes('纯色')),
    ['标题帧 colors=1 < 64 ⇒ 疑似纯色/黑屏帧'],
    '纯色帧必须被抓住（判别力 ①）',
  );
  // ② 工具自己的"几乎全黑"标记也要算数
  const blackish = good.replace('colors=4213', 'colors=1  ★几乎全黑：可能有渲染缺陷');
  assert.equal(judgeShotReport(blackish).length, 2, '全黑帧应同时命中两条（colors 与 ★几乎全黑标记）');
  // ③ 链路半途断掉（标记缺失）——这是 `waitLog` 超时的形状
  const noSn = good.replace('[shot] SN0000=true\n', '');
  assert.deepEqual(
    judgeShotReport(noSn),
    ['链路未到达 SN0000（日志里没有 `[shot] SN0000=true`）'],
    '链路断掉必须被抓住（判别力 ②）',
  );
  // ④ 连截图都没走到
  const noShot = good.replace(/\[shot\] \/tmp\/x\/t2-[^\n]*/g, '');
  assert.match(judgeShotReport(noShot)[0] ?? '', /没有产出标题帧截图行/, '没走到 shot 也必须报');
});

test('E4：真 Electron 跑 gamestart ⇒ 三个链路标记 + 标题帧 colors ≥ 64 且非全黑', async (t) => {
  // ---- 前置探测：缺什么说什么，绝不把"跑不起来"当 fail ----
  const missing: string[] = [];
  if (!fs.existsSync(path.join(APP, 'node_modules', 'electron'))) missing.push('node_modules/electron（npm ci 没跑全）');
  if (!fs.existsSync(PREBUILT)) missing.push('dist/electron/main.cjs（先 `npm run build:electron`）');
  const resourceDir = resolveResourceDir(ROOT);
  if (!fs.existsSync(resourceDir)) missing.push(`资源根 ${path.relative(ROOT, resourceDir)}/（需要 install/ 或 raw/）`);
  if (process.platform !== 'darwin' && !process.env.DISPLAY) missing.push('GUI 会话（DISPLAY 未设；本档需要一个真窗口）');
  if (missing.length) {
    t.skip(`T2 前置不满足：${missing.join('；')}`);
    return;
  }

  const electron = require_(path.join(APP, 'node_modules', 'electron')) as unknown as string;
  const name = 't2-gamestart';
  // ★`--no-sandbox`：自动化上下文（CI / 受限 shell / 无 seatbelt 权限）里 Electron 的沙箱初始化会
  //   `Failed to initialize sandbox: Operation not permitted` ⇒ GPU 进程 SIGTRAP、整个进程起不来
  //   （本机 2026-09-23 实测；`npm run shot` 交互式跑不需要它）。放在脚本路径**之前**由 Chromium 解析。
  const r = spawnSync(electron, ['--no-sandbox', SHOT, '--gamestart', '--name', name], {
    cwd: APP,
    encoding: 'utf8',
    timeout: 300_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(
    r.error,
    undefined,
    `拉起 Electron 失败：${r.error?.message ?? ''}（若是沙箱报错，见本文件对 --no-sandbox 的说明）`,
  );
  assert.equal(r.status, 0, `真机跑 gamestart 必须 exit 0；实际 ${r.status}\n---- 输出尾部 ----\n${out.slice(-4000)}`);

  // ---- 判据：链路标记 + 像素 ----
  const problems = judgeShotReport(out);
  assert.deepEqual(problems, [], `E4 判据不通过：\n  ${problems.join('\n  ')}\n---- 输出尾部 ----\n${out.slice(-4000)}`);

  // ---- 产物落盘（判据之外的最小完整性：文件真在，且不是 0 字节） ----
  const title = parseShotLine(out, '0-title')!;
  assert.ok(path.isAbsolute(title.path), `截图路径应是绝对路径：${title.path}`);
  const size = fs.statSync(title.path).size;
  assert.ok(size > 4096, `标题帧 PNG 应写出实质内容（实际 ${size} B）`);
  // ★`capturePage()` 给的是**物理像素**：本机 DPR=2 ⇒ 2560×1440（实测），故只钉"不小于逻辑 1280×720 + 16:9"
  assert.ok(title.w >= 1280 && title.h >= 720, `窗口内容尺寸应不小于 1280×720（实际 ${title.w}×${title.h}）`);
  assert.ok(Math.abs(title.w / title.h - 16 / 9) < 0.01, `宽高比应为 16:9（实际 ${title.w}×${title.h}）`);
});
