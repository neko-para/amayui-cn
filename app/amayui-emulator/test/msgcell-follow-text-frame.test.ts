/** @tier T0 @kind core @subsystem text */

/**
 * **▼（`0x73` 字格图标）的目标坐标系回归** —— 对应 2026-09 用户实测
 * 「SC0000 的 ▼ 画到屏幕右上角」（`cellFrameOf` 的 mode-1 分支漏了窗框原点）。
 *
 * ## 引擎事实（raw = `engine/天结_unpacked.exe_utf8.c`）
 *
 * ```c
 * 71346  v6 = (_DWORD *)_this[v5 + 261];               // 窗对象（win+0..）
 * 71347  if ( v6[22] ) {                               // win+88 = `0x73` 的逐字总门
 * 71349    v7 = _this[348];                            // Font+1392 = Engine[21672]（`0x1B1` 写）
 * 71350    if ( v7 == 1 ) {
 * 71352      v8  = v6[20] + *(v6[12] - 20) + v6[3];    // op2 + 笔位 x + win+12
 * 71354      v30 = v6[21] + *(v6[12] - 16) + v6[4];    // op3 + 笔位 y + win+16
 *          } else {                                     // v7 == 0
 * 71373      v8  = v6[20] + v6[3];                     // op2 + win+12
 * 71375      v30 = v6[4] + v6[21];                     // win+16 + op3
 *          }
 * ```
 *
 * - `v6[20]`/`v6[21]` = `win+80/+84` ← `0x73` 的 op2/op3（`sub_456430` raw 68292-68293 → +80/+84）；
 * - `v6[3]`/`v6[4]` = `win+12/+16` = **窗框屏幕位置**（`0x70` 的 op4/op5，`sub_45D660` raw 73154-73155）；
 * - `*(v6[12] - 20)` / `*(v6[12] - 16)` = `win+48` 记录向量（24B 元素，raw 83929 的 `/ 24`）
 *   **末条记录的 `+4`/`+8`** = 当前笔位（初值 = 文字块原点：窗对象构造 raw 90453-90462 把
 *   `(win+28, win+32)` 当第一条记录 push；逐字排版推进它：raw 83736-83738 + 83912-83916）。
 *
 * ⇒ 笔位是**窗内表面坐标**（渲染侧那张 `style.w × style.h` 画布的坐标系），而两条分支的
 * **结果**都是屏幕坐标：模式 1 = 模式 0 的位置 **+ 笔位**。修复前模式 1 少了 `win+12/+16`，
 * 于是窗框在 (190,557) 的下方 ADV 窗把 ▼ 画到了窗**上方**（症状 = "跑到右上角"）。
 *
 * ## 为什么笔位就是"末行文字的结尾"（而不是"下一行行首"）
 *
 * `0x6F end-text-line`（`sub_46AF90` raw 82684-82685）会把末条记录改写成
 * "(文字块原点 x, 该行 y + 字号 + 行距)"；但▼出现的时刻是 `wait-for-input` **之前**，
 * 语料里那一页的末段还没 `end-text-line` —— `src/SN0000.txt:2983-2994`：
 *
 * ```text
 * 2983  show-text 0 @"这个故事，始于一位技术人员为参与调查而来到此"
 * 2985  end-text-line 0
 * 2986  show-text 0 @"地的那一刻。"        ← 页末这一段没有 end-text-line
 * 2988  // 页面结束
 * 2989  i305
 * 2992  i073 8 0 (local-int 0) c 0 (local-int 1) 38 38 8 64
 * 2993  wait-for-input 0
 * 2994  end-text-line 0                     ← 在等待**之后**
 * ```
 *
 * ## 本文件钉住四件事
 *  1. **mode 0** ⇒ `(op2 + 框x, op3 + 框y)`（`SYSTEM4.txt:23/41` 的 win1 真实几何 ⇒ `(1080,667)`）；
 *  2. **mode 1 + `(op2,op3) = (0,0)`**（NOVEL/序章形状）⇒ 目标 **逐像素等于渲染侧末行文字的结尾**；
 *  3. **mode 1 + 下方 ADV 窗** ⇒ 目标 = 固定位 + 笔位，**不得**落回"窗顶/屏幕右上角"那一类；
 *  4. **满屏启发式已删**：raw 的分岔**只**由 `Font+1392` 决定（71349 逐字）⇒ 满屏窗 + mode 0
 *     必须仍走固定公式（序章/NOVEL 靠 `src/NOVEL.txt:8 i1b1 1` 走 mode 1，它在该脚本
 *     `:147 call-script (global-int 1394)` 调起序章**之前**，`:266 i1b1 0` 在返回路径上）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { Engine, Frame, CHAR_REVEAL_ACTIVE } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { advance, type MsgCellFrame } from '../src/text/layout.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, str } from './harness.js';

/** 一次"只跑一条指令"的步骤器 + **发布通道**（`cell` 只能从载荷里看到，见 `cellFrameOf` 的调用点）。 */
function mk(): { e: Engine; scene: HeadlessScene; step: (op: number, args?: BinArg[]) => void } {
  const scene = new HeadlessScene({});
  const e = new Engine(scene);
  const f = new Frame();
  return {
    e,
    scene,
    step: (op, args = []) => {
      const h = OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应在 OPS 里（真实现）`);
      h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
    },
  };
}

/** 该窗**发布载荷**里的 ▼ 那一格（`scMsgWinSync` 存下来的渲染侧排版结果同源）。 */
function cellOf(scene: HeadlessScene, win: number): MsgCellFrame {
  const f = scene.scene.msgWins.get(win);
  assert.ok(f, `窗 ${win} 应在渲染模型里（载荷发布过）`);
  const c = f.cell;
  assert.ok(c, `窗 ${win} 的载荷里应有 ▼（bit30 已置、字格已武装、文字已显完）`);
  return c;
}

/**
 * `SYSTEM4.txt:23` 的 **win1**（下方 ADV 窗）+ `:44` 的文字起点 + `:41` 的 ▼ 字格。
 *
 * 真实语料：`i070 1 370 94 be 22d`（880×148 @(190,557)）、`i079 1 24 f`（文字块 (36,15)）、
 * `i073 1 37a 6e c 0 0 23 23 a 64`（目标偏移 (890,110)、槽 12、35×35、10 格）、
 * `i08b 10`（行距 16 ⇒ 换行步进 = 30+16 = 46；`SC0000.txt:495` 的 ADV 样式前导）。
 */
function advWindow(step: (op: number, args?: BinArg[]) => void): void {
  step(0x80, [im(1)]); // 默认窗 = 1（`SYSTEM4` 的 ADV 窗）
  step(0x8b, [im(0x10)]);
  step(0x70, [im(1), im(0x370), im(0x94), im(0xbe), im(0x22d)]);
  step(0x79, [im(1), im(0x24), im(0xf)]);
  step(0x73, [im(1), im(0x37a), im(0x6e), im(0xc), im(0), im(0), im(0x23), im(0x23), im(0xa), im(0x64)]);
}

/**
 * 满屏叙述窗 **win8**（`SYSTEM4.txt:30 i070 8 500 2d0 0 0` + 序章的文字块原点 `i079 8 8c 10`）
 * + `NOVEL.txt:11` 那张 ▼ 字格（`i073 8 0 0 c 0 0 38 38 8 64`：op2/op3 = 0/0）
 * + `NOVEL.txt:21 i08b 10`（行距 16）。
 */
function novelWindow(step: (op: number, args?: BinArg[]) => void): void {
  step(0x80, [im(8)]);
  step(0x8b, [im(0x10)]);
  step(0x70, [im(8), im(0x500), im(0x2d0), im(0), im(0)]);
  step(0x79, [im(8), im(0x8c), im(0x10)]);
  step(0x73, [im(8), im(0), im(0), im(0xc), im(0), im(0), im(0x38), im(0x38), im(8), im(0x64)]);
}

/**
 * ★(b) **mode 0（`Font+1392 = 0`）⇒ 固定公式** `(op2 + 框x, op3 + 框y)`（raw 71368-71377）。
 *
 * 数字出处：`op2 + 框x = 890 + 190 = 1080`、`op3 + 框y = 110 + 557 = 667`。
 */
test('★▼ mode 0：目标 = (op2 + 窗框 x, op3 + 窗框 y) = (1080,667)（SYSTEM4 的 ADV 窗真实几何）', () => {
  const { e, scene, step } = mk();
  advWindow(step);
  e.effectFlags |= CHAR_REVEAL_ACTIVE;
  step(0x6e, [im(0), str('あ'.repeat(30))]); // 30 字：28 字 + 2 字两行
  const c = cellOf(scene, 1);
  assert.equal(c.x, 1080, 'op2(890) + win+12(190)（raw 71373）');
  assert.equal(c.y, 667, 'op3(110) + win+16(557)（raw 71375）');
});

/**
 * ★(a) **mode 1 且 `(op2,op3) = (0,0)`**（NOVEL/序章形状）⇒ 目标 **就是末行文字的结尾**（屏幕坐标）。
 *
 * 版式（全在渲染侧同一份 `layoutWindow` 结果里，本用例对它**独立复核**）：
 *  文字块原点 (140,16)、窗框 (0,0)、`wrapRight = 1280`、字号 30、行距 16（`i08b 10`）
 *  ⇒ 第 1 行放 38 个全角字（`140 + 38×30 = 1280` 正好不换行）、第 2 行 2 个字
 *  ⇒ 末行 y = 16 + 46 = **62**、末字右边 = 140 + 2×30 = **200**。
 */
test('★▼ mode 1 + (op2,op3)=(0,0)：目标 = 渲染侧末行文字的结尾（win8 满屏，序章/NOVEL 形状）', () => {
  const { e, scene, step } = mk();
  novelWindow(step);
  step(0x1b1, [im(1)]); // `src/NOVEL.txt:8 i1b1 1` ⇒ Engine[21672] = 1
  e.effectFlags |= CHAR_REVEAL_ACTIVE;
  step(0x6e, [im(0), str('あ'.repeat(40))]); // 38 字 + 2 字两行
  const c = cellOf(scene, 8);

  // ① 与**渲染侧那份排版结果**交叉核对（不是重算一遍同一个公式：帧来自 scMsgWinSync 的宿主通道）
  const frame = scene.scene.msgWins.get(8)!;
  assert.equal(frame.lines.length, 2, '两行（38 + 2）');
  const last = frame.lines[frame.lines.length - 1]!;
  const lastGlyph = last.glyphs[last.glyphs.length - 1]!;
  assert.equal(frame.style.x, 0, '前置：win8 框 x = 0（SYSTEM4.txt:30）');
  assert.equal(frame.style.y, 0, '前置：win8 框 y = 0');
  assert.deepEqual(
    { x: c.x, y: c.y },
    { x: frame.style.x + lastGlyph.x + advance(lastGlyph.ch, frame.style.main.size), y: frame.style.y + last.y },
    '★目标 == 窗框 + 末行末字的右边（与画面同一坐标系）',
  );
  // ② 具体数字（人可复核，不依赖上面那两行推导）
  assert.deepEqual({ x: c.x, y: c.y }, { x: 200, y: 62 }, '140 + 2×30 = 200、16 + 46 = 62');
});

/**
 * ★(c) **回归（用户实测的那一形状）**：mode 1 + **窗框不在 (0,0)** 的下方 ADV 窗、文字在窗内。
 *
 * 修复前的症状：`(op2 + 笔位 x, op3 + 笔位 y)` = `(890+96, 110+61) = (986,171)` —— 窗框在
 * y=557 的下方 ADV 窗，▼ 却画在 **y=171（屏幕右上角、窗框上方 386px）**。
 */
test('★▼ 回归：mode 1 + 下方 ADV 窗（框 y=557）⇒ 目标 = 固定位 + 笔位，不得落到窗顶/右上角', () => {
  const { e, scene, step } = mk();
  advWindow(step);
  step(0x1b1, [im(1)]); // 上一步载入过 NOVEL ⇒ 模式被留在 1（`Engine[21672]` 不在存档里）
  e.effectFlags |= CHAR_REVEAL_ACTIVE;
  step(0x6e, [im(0), str('あ'.repeat(30))]);
  const c = cellOf(scene, 1);

  const geom = e.msgwin.geom(1);
  assert.equal(geom.x, 190, '前置：框 (190,557)（SYSTEM4.txt:23）');
  assert.equal(geom.y, 557, '前置：框 (190,557)');
  // 具体数字 = mode 0 的 (1080,667) + 笔位 (96,61)
  assert.deepEqual({ x: c.x, y: c.y }, { x: 1176, y: 728 }, '890+190+96 = 1176、110+557+61 = 728');
  // 形状判据（修复前 (986,171) 必然失败：171 < 557）
  assert.ok(c.y >= geom.y, `★▼ 不得画到窗框上方（框 y=${geom.y}，实际 y=${c.y}）—— 这就是"右上角"那类位置`);
  assert.ok(c.x > geom.x + geom.w / 2, `★▼ 应在窗的右半（框 x+半宽=${geom.x + geom.w / 2}，实际 x=${c.x}）`);
});

/**
 * ★**满屏启发式已删**（raw 71349 的分岔只有 `Font+1392`）。
 *
 * 修复前 `cellFrameOf` 还有一条"窗铺满视口 ⇒ 也按 mode 1"（2026-09 E4 加的，无 raw 依据）。
 * 它会把**模式 0 的满屏窗**也拉到"跟随文字"：`(op2+框x, op3+框y)` 明明是 `(0,0)` 却画到
 * 末行文字结尾。本用例钉住删掉之后的行为；序章的 ▼ 不退步的依据见文件头（`NOVEL.txt:8` 先置 1）。
 */
test('★满屏启发式已删：满屏窗 + mode 0 ⇒ 仍走固定公式 (0,0)（序章靠 `i1b1` 走 mode 1）', () => {
  const { e, scene, step } = mk();
  novelWindow(step);
  e.effectFlags |= CHAR_REVEAL_ACTIVE;
  step(0x6e, [im(0), str('あ'.repeat(40))]);
  assert.equal(e.engineValues.get(21672), undefined, '前置：`i1b1` 没跑过 ⇒ Engine[21672] 未设（= 0）');
  const c = cellOf(scene, 8);
  assert.deepEqual({ x: c.x, y: c.y }, { x: 0, y: 0 }, 'op2/op3 = 0/0 + 框 (0,0) —— 不是末行文字结尾 (200,62)');
});
