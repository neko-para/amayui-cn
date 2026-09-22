/**
 * **文本样式的作用域：入队时钉住，全局改动不回溯**（用户实测缺陷的回归）。
 *
 * ## 缺陷（2026-09 实测）
 * 「在角色设置页面，角色名是有颜色的，但颜色设置溢出到了下面的 ADV 展示页面上，
 *   导致其颜色被修改为设置页面中最下面一个可见的角色名的颜色。」
 *
 * ## 引擎事实（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）
 *  - 全局样式指令 `0x75/0x76/0x77/0x78/0x8B/0x197/0x1A4/0x1A5/0x2BD/0x2BE/0x2FE/0x261` 只写
 *    `Font` 对象上的**一套**字段（`+1360` 填充色、`+1364` 描边色、`+1368/+1380/+1392` 另三色、
 *    `+1372` 描边档位、`+1384/+1388` 描边偏移、`+201684` 主字号、`+235108` 竖排…）。
 *  - 这些字段是在**排版那一刻**被消费的：`show-text`(0x6E) → `sub_46BE30` 逐字测量/断行，并把字形
 *    （连同当时的颜色）画进**该窗自己的离屏表面**（`sub_455ED0`/`sub_456820`）。
 *  - 之后改全局色**不会回溯**：`0x76` 只是写字段 + `sub_459F40` 重建 GDI 字体对象/字宽
 *    （raw 70941-71060 全是 LOGFONT/`GetTextMetricsA`，没有一行重画字形）；
 *    `0x20A` 的重排 `sub_45AD30`(raw 71482-72100) 也不调用任何字形绘制函数。
 *  - 直接后果：`CONFIG2`（角色设定页）逐行 `i076 <adcd[该行]>` + `draw-string` 画角色名后，
 *    全局填充色停在**最后一个可见行**的颜色上；而设置界面下方的 ADV 样例窗（win 9）是
 *    `CONFIG.txt:47`/`CONFIG2.txt:1392-1394` **入队时**就画好的，理应保持它自己的颜色。
 *
 * ## 本测试防什么
 *  1. `styleOfWin` 必须用**入队快照**（`MsgSlot.fontStyle`），而不是实时读全局；
 *  2. 全局样式指令**不得**把新样式"发布"给所有已排版的窗（`emitAllWins`）；
 *  3. `draw-string`(0x204) 相反：它是"立即消费全局样式"，必须随全局色走；
 *  4. 真实语料 E3：切到角色设定页后，win 9 的颜色**不得**变成最后一个可见角色名的颜色
 *     （探针 `previewProbe`，见 `src/tools/config1Chain.ts`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { runConfig1Chain } from '../src/tools/config1Chain.js';
import { bgrToRgb } from '../src/vm/handlers/msgwin.js';
import type { DrawStringStyle } from '../src/vm/native.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, str } from './harness.js';



/** 最小宿主：HeadlessScene 之上记录 `draw-string` 收到的样式。 */
function mk(): {
  e: Engine;
  scene: HeadlessScene;
  step: (op: number, args?: BinArg[]) => void;
  draws: { slot: number; text: string; style: DrawStringStyle }[];
} {
  const scene = new HeadlessScene({});
  const draws: { slot: number; text: string; style: DrawStringStyle }[] = [];
  const orig = scene.drawString.bind(scene);
  scene.drawString = (slot, x, y, text, style) => {
    draws.push({ slot, text, style });
    orig(slot, x, y, text, style);
  };
  const e = new Engine(scene);
  const f = new Frame();
  return {
    e,
    scene,
    draws,
    step: (op, args = []) => {
      const h = OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应在 OPS 里（真实现）`);
      h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
    },
  };
}

/**
 * 引擎 `0x76` 的操作数是**脚本写的 RGB 值**，`0x76` 的 handler 把它翻成 **COLORREF** 存进 `Font+1360`
 * （raw 28669），而屏幕上的颜色 = 该字段的 COLORREF 读法 = **再翻一次**（= 脚本原值）。
 * `tickets/T-0102` 判据 4 的修复把最后那一次翻转加到了 `globalTextStyle`（raw 79241 → 68093
 * `SetTextColor(hdc, *(Font+1360))` 证明引擎把该字段当 COLORREF 用）。
 *
 * ⇒ 断言里的期望色 = **脚本写的那个字面值**（不再是它的 R/B 互换）。
 */
const rgbOf = (v: number): string => {
  const rgb = (((v & 0xff) << 16) | (((v >> 8) & 0xff) << 8) | ((v >> 16) & 0xff)) >>> 0;
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
};
const win9Fill = (scene: HeadlessScene): string | undefined => scene.scene.msgWins.get(9)?.style.main.fill;

test('★入队时钉住：先设全局色再 show-text ⇒ 该窗用入队那一刻的颜色', () => {
  const { scene, step } = mk();
  step(0x76, [im(0x563412)]); // 脚本写的 RGB 色（字段里存 COLORREF `0x123456`）
  step(0x71, [im(9)]); // 开始新消息（清窗 9）
  step(0x6e, [im(9), str('神缘ＳＡＭＰＬＥ')]);
  // ★样式里保留脚本原色（偏灰由 raster 的覆盖率 α 合成负责，见 tickets/T-0042）
  assert.equal(win9Fill(scene), '#563412', '窗 9 的填充色应 = 入队时的脚本原色（`0x563412`）');
});

test('★全局色改变不回溯：角色设定页逐行设色后，已排版的 ADV 样例窗保持原色', () => {
  const { scene, step } = mk();
  // —— CONFIG.BIN 的样例：设样式 → 入队 ——
  step(0x76, [im(0x563412)]);
  step(0x75, [im(30)]);
  step(0x71, [im(9)]);
  step(0x6e, [im(9), str('神缘ＳＡＭＰＬＥ')]);
  assert.equal(win9Fill(scene), '#563412');
  // —— CONFIG2 的行为：每画一行角色名就改一次全局色（这里模拟最后一行；其调色板原值 = 0xff90b6）——
  for (const c of [0xffe100, 0x4dbf67, 0xff90b6]) step(0x76, [im(c)]);
  step(0x75, [im(28)]);
  assert.equal(
    win9Fill(scene),
    '#563412',
    '窗 9 已被排版 ⇒ 全局改色**不得**回溯（否则就是用户实测的"角色名颜色溢出"）',
  );
  assert.equal(scene.scene.msgWins.get(9)?.style.main.size, 30, '字号同理：不回溯');
});

test('新一页才用新样式：`0x71` 之后入队的文本用当时的全局色', () => {
  const { scene, step } = mk();
  step(0x76, [im(0x563412)]);
  step(0x71, [im(9)]);
  step(0x6e, [im(9), str('第一页')]);
  assert.equal(win9Fill(scene), '#563412');
  step(0x76, [im(0xb690ff)]); // 角色设定页把它改了
  step(0x71, [im(9)]); // 新一页（脚本站点：CONFIG.txt:171-179 的 i300/i071/show-text 模板）
  step(0x6e, [im(9), str('第二页')]);
  assert.equal(win9Fill(scene), '#b690ff', '新入队的文本应当用**当前**全局色');
});

test('draw-string(0x204) 相反：直绘是"立即消费全局样式"', () => {
  const { step, draws } = mk();
  step(0x76, [im(0x563412)]);
  step(0x204, [im(196), im(6), im(6), str('喚醒了女神的鍛梁師')]);
  assert.equal(draws.length, 1);
  assert.equal(draws[0]!.style.fill, '#563412', '直绘用写入那一刻的全局色');
  step(0x76, [im(0xb690ff)]);
  step(0x204, [im(196), im(6), im(46), str('另一个角色')]);
  assert.equal(draws[1]!.style.fill, '#b690ff', '第二次直绘用新的全局色（同槽叠字）');
});

test('★E3 真实语料：切到角色设定页后，ADV 样例窗(win 9)的色 ≠ 最后一个可见角色名的颜色', async () => {
  const r = await runConfig1Chain({ previewProbe: true });
  const p = r.previewStyle;
  assert.ok(p, 'previewProbe 应给出 previewStyle');
  assert.equal(r.unimplemented.length, 0, `链路里不应有未实现指令：${r.unimplemented.join(', ')}`);
  assert.ok(p!.win9Present, 'ADV 样例窗（win 9）在切页后仍应存在');
  assert.ok(p!.win9Fills.length > 50, `应采到足够帧（实际 ${p!.win9Fills.length}）`);

  // 前提检查：这一页的角色名确实是**多色**的（否则本测试没有意义）
  const rowColors = [...new Set(p!.rowFills)];
  assert.ok(
    rowColors.length >= 3,
    `角色设定页的行文本应是多色的（实际 ${rowColors.length} 种：${rowColors.join(' ')}）`,
  );
  const liveColors = [...new Set(p!.liveFills)];
  assert.ok(liveColors.length >= 2, `逐行设色应当改过全局色（实际 ${liveColors.join(' ')}）`);

  // ★核心不变量 1：样例窗的颜色在整页绘制期间**不许变**（入队时钉住）
  const win9Colors = [...new Set(p!.win9Fills)];
  assert.deepEqual(
    win9Colors,
    [p!.beforeFill],
    `ADV 样例窗的颜色被全局逐行设色改动了：${win9Colors.join(' → ')}`,
  );

  // ★核心不变量 2：它**不得**等于最后一个可见角色名的颜色（用户实测的那一条）
  const liveLast = p!.liveFills.at(-1);
  assert.notEqual(
    p!.win9Fills.at(-1),
    liveLast,
    `ADV 样例窗变成了最后一个可见角色名的颜色（${liveLast}）—— 这正是被测缺陷`,
  );
});

/**
 * ★`tickets/T-0102` **判据 4**（「阿瓦罗的名字变成青色，预期橘色」）：把**通道顺序**钉在
 * 引擎写入端的**位表达式**上，而不是钉在"我自己写的另一个同款函数"上。
 *
 * 引擎逐字（`sub_466000` raw 79666；`bgrToRgb` 的注释引了同一行）：
 *   `*(Font + 1360) = BYTE2(a5) + ((BYTE1(a5) + ((unsigned __int8)a5 << 8)) << 8)`
 * ⇒ 输入按 **COLORREF（`0x00BBGGRR`）** 读、写成 `0xRRGGBB`。本用例**独立**求值这段位运算
 * （不调用被测函数），逐值比对 `bgrToRgb` ⇒ 「交换方向写反 / 漏交换 / 多交换一次」必红。
 *
 * 取值用**真机 `SAVE.DAT` 的调色板**（`adcd[0..12]`，BGR/COLORREF 编码；全表 1000 条、28 种取值，
 * 转储见 `tickets/T-0042/notes.md`）。★为什么必须记下这组值：真机调色板里**青色与橘色是相邻的几条**
 * （`adcd[4]` ⇒ `#00E1FF` 青、`adcd[5]/[7]/[10]` ⇒ `#FFB184`/`#FFD871`/`#DD9B2C` 橘）
 * ⇒ 「青 vs 橘」这个症状**不可能**由通道顺序产生（同一次交换作用在全表上，白/暖白那几条是
 * 近似中性色、交换前后几乎无差，所以正文看起来正常而角色名一眼就偏）——
 * 它是**取了下标 4 还是下标 5/7/10**的问题，即 `14acda`（角色号）的派生。
 */
test('★T-0102 判据 4：文本色通道顺序 == 引擎 raw 79666 的写入端表达式（真机调色板逐个比对）', () => {
  /** 逐字照抄 `sub_466000` raw 79666 的写入端表达式（独立实现，不复用被测函数）。 */
  const engineWrite = (a5: number): number => {
    const byte0 = a5 & 0xff; // (unsigned __int8)a5
    const byte1 = (a5 >>> 8) & 0xff; // BYTE1(a5)
    const byte2 = (a5 >>> 16) & 0xff; // BYTE2(a5)
    return (byte2 + ((byte1 + (byte0 << 8)) << 8)) & 0xffffff;
  };
  /** 真机 `SAVE.DAT` 的 `adcd[0..12]`（原值，BGR/COLORREF 编码）。 */
  const PALETTE = [
    0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffe100, 0x84b1ff, 0xdcdcc6,
    0x71d8ff, 0x00d3c3, 0x4dbf67, 0x2c9bdd, 0xd15e4b, 0xff90b6,
  ];
  for (const v of PALETTE) {
    assert.equal(
      bgrToRgb(v),
      engineWrite(v),
      `0x${v.toString(16).padStart(6, '0')} 的交换必须与引擎写入端表达式逐位相同`,
    );
  }
  // 真机调色板 ⇒ 渲染色（交换后）：青与橘是**相邻**的下标
  assert.equal(bgrToRgb(0xffe100), 0x00e1ff, 'adcd[4] ⇒ #00E1FF（青）');
  assert.equal(bgrToRgb(0x84b1ff), 0xffb184, 'adcd[5] ⇒ #FFB184（浅橘）');
  assert.equal(bgrToRgb(0x71d8ff), 0xffd871, 'adcd[7] ⇒ #FFD871（金橘）');
  assert.equal(bgrToRgb(0x2c9bdd), 0xdd9b2c, 'adcd[10] ⇒ #DD9B2C（橘）');
  assert.equal(bgrToRgb(0xff90b6), 0xb690ff, 'adcd[12] ⇒ #B690FF（紫；= 判据 3 里那个残留色）');
  // 交换的幂等性反面：交换两次必须回到原值（否则"多交换一次"这类改动也能蒙过上面几条）
  for (const v of PALETTE) assert.equal(bgrToRgb(bgrToRgb(v)), v & 0xffffff);
});
