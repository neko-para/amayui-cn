#!/usr/bin/env node
/**
 * ops/_template.mjs —— **新增一个"从某个界面做某事"用例的模板**（照抄改名，然后填三样东西）。
 *
 * 为什么要有模板：本目录一条用例一个文件，**索引在 `ops/README.md`**。新场景（战斗界面、工房界面、
 * 地图/探索、組合、公会、标题以外的一切子界面…）都必须走同一条路 —— 一个可复跑的脚本，
 * 而不是"现场读界面猜坐标"。
 *
 * ## 登记一条 op 必须给出的三样东西（缺一不可）
 * 1. **开屏手势**：从该界面到下一样东西要做什么（点哪里 / 悬停哪里 / 有没有"先展开"这种前置）。
 *    ★坐标一律从**脚本**里量（`src/<脚本>.txt` 的 `i090 <x> <y> <w> <h> …` 热点定义），
 *      或从 capture 图上量（虚拟坐标 = 1280×720 像素坐标，1:1）；**不要**拿另一场景的坐标套。
 * 2. **开屏判据**：机器可读的"到了"信号 —— 首选 `cur` 变成某个 `*.BIN`；其次是全局
 *    （如 SAVE/LOAD 画面的模式全局 `f7ff0`：0=存档、1=读档）；再其次是日志行。
 *    ★**没有判据就不要写**：`sleep` 不算判据（本次就是因为靠 sleep 变得不稳）。
 * 3. **该场景特有的坑**：写进文件头。已知的两条通用坑（两帧点击 / 视觉展开≠逻辑展开）见
 *    `load-from-adv.mjs`；每个场景还常有自己的（模式全局、要先把光标移开、悬停靠位置变化…）。
 *
 * ## 未登记的场景（写在这里，别让读者以为它们能用）
 * - `battle`（战斗界面）：未登记。要知道战斗界面里读档的入口是哪个脚本/hotspot（多半是战斗菜单
 *   里的"读档"或系统菜单），以及开屏后**战斗状态是否需要复位**。
 * - `workshop`（工房界面）：未登记。同上。
 * - `field` / `guild` / `alchemy` …：未登记。
 * 上面这些一旦实测出来，就复制本文件 → `<名字>.mjs`，填三样东西，再在 `ops/README.md` 的表里加一行。
 */
import { binOf, tap, waitBin, waitTicking } from '../emu.mjs';

const argOf = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};
const id = argOf('instance');
if (!id) {
  console.error('用法：_template.mjs --instance <id> …');
  process.exit(2);
}

await waitTicking(id);
const start = await binOf(id);
console.log(`起跑状态：cur = ${start}`);

// ① 开屏手势（照抄后改坐标；两帧点击用 tap()，悬停用 hover()）
// await tap(id, X, Y, { settleMs: 900 });

// ② 开屏判据（必须机器可读；下面是最常见的两种）
// if (!(await waitBin(id, '<期望的 BIN>', { timeoutMs: 15_000 }))) throw new Error('没到 <期望的 BIN>');

// ③ 该场景特有的坑写在本文件头，并在这里用断言或注释点明。

console.log('（模板没做任何事 —— 复制本文件后填三样东西）');
