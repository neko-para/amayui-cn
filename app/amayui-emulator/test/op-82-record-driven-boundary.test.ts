/** @tier T0 @kind core @subsystem ops */

/**
 * **「记录驱动重画」的接线边界**（`tickets/T-0179` 波 G）—— `0x82` 与它的孪生 `0x1D1` 的**分界**。
 *
 * ## 这条守卫守什么（红了的含义）
 * 引擎里 `0x82`（`sub_466000` raw 79319-80311）与 `0x1D1`（`sub_4675A0` raw 80313-81522）**逐句同形**：
 * 都从 `op2` 起遍历 72 B 记录表 `Font+3364`，把记录画进窗 `op1`（`op2` 越界 ⇒ 整条什么都不做）。
 * 但 emulator 侧两者**故意不同源**：
 *  - `0x1D1` 是**记录驱动**的（`TextItemTable.repaintRange` → `setPageText` + `emitWin`，`tickets/T-0170`）——
 *    它的目标窗（回想页 win `3 + 行号`）本来就**只有**记录这一个内容来源；
 *  - `0x82` 是**模型快照**驱动（`emitWin` 只重发布该窗已排好版的 `segments`）—— 它的目标窗是 ADV 的**活窗**，
 *    内容来自 `show-text` 模型；把它也接成记录驱动会**整体替换**活窗正文，并丢掉注音（`setPageText` 写 `ruby: []`）
 *    与显现态（`reveal.delete`）。
 *
 * ⇒ 本文件钉住这条分界，**不许在"记录驱动的前置"落地之前把 `0x82` 悄悄改成记录驱动**
 *   （那既会让 `test/op-0104-gdi-repaint.test.ts` 的语义悄悄变味，也没有任何实测收益）。
 *
 * ## 前置（要改这条守卫的人先读这个）
 * 波 G 的实测（真语料序章 24 个样本，`.tmp/settle/probe-G-record-driven2.mjs`）：
 * 「末页起点起的记录切片行」与该窗的 `layoutWindow` 显示行 **23/24 逐字相同**（唯一不同的一例是切窗：页起点
 * 仍指旧窗 win8 的记录，而目标窗已切到 win1 —— 引擎两处循环都**不看**记录 `+0`，故那是引擎行为）；
 * `ITEM_REFLOW`（记录 flags bit1）在全语料样本里**恒 0**（唯一写者是未建模的 `sub_46CC60` 重排路径）。
 * ⇒ 前置 = ①记录表的行结构生产者（自动换行第三 push 点 raw 81530-81553）；②排版→记录的**幂等**回写
 *   （排版每次发布都重算，naive 回写会重复 push）；③「整体替换 vs 追加」的跨窗口径裁决
 *   （唯一语料点 `src/CONFIG.txt:269` 的 `op3` = `2`，不带 `0x40` ⇒ 照抄孪生会**先清空再重画**）。
 * 三条都落地后，本文件的 ① 应改成"记录切片确实驱动 `0x82` 的发布"，并同时补注音/显现态守恒。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StubNative } from '../src/vm/native.js';
import { stepOnce } from '../src/vm/interpreter.js';
import type { Engine } from '../src/vm/engine.js';
import type { BinInstruction } from '../src/script/bin.js';
import type { MsgWinInput } from '../src/text/layout.js';
import { CFG } from '../src/configRegistry.js';
import { im, instr, mkEngine, str } from './harness.js';

/** 只记 `msgWinSync` 的文本（断言"发布出去的是什么"必须看载荷，只看窗内模型不够）。 */
class SyncRecorder extends StubNative {
  readonly seen: { win: number; text: string }[] = [];
  /** ★P4：整份载荷的关键面（文本 / 注音对 / 显现游标）—— 重画不许把它们清掉。 */
  readonly payloads: { win: number; text: string; revealed: number; ruby: [string, string][] }[] = [];
  constructor() {
    super(() => {});
  }
  override msgWinSync(win: number, input: MsgWinInput): void {
    this.seen.push({ win, text: input.segments.map((s) => s.text).join('\n') });
    this.payloads.push({
      win,
      text: input.segments.map((s) => s.text).join('\n'),
      revealed: input.revealed ?? -1,
      ruby: input.segments.flatMap((s) => s.ruby),
    });
  }
  get lastText(): string {
    const v = this.seen.at(-1);
    if (!v) throw new Error('没有记录到任何 msgWinSync（发布通路没走到）');
    return v.text;
  }
}

/**
 * 跑一条脚本，**留下最后一条指令不跑**（用于"先断言前置状态、再断言这条指令的效果"）。
 */
async function stageScript(script: BinInstruction[]): Promise<{
  e: Engine;
  native: SyncRecorder;
  runLast: () => Promise<void>;
}> {
  const native = new SyncRecorder();
  const e = mkEngine(script, 'FAKE.BIN', native);
  for (let i = 0; i < script.length - 1; i++) await stepOnce(e);
  return { e, native, runLast: async () => void (await stepOnce(e)) };
}

/** `0x82`/`0x1D1`：`<win> <start> <mode> <fill> <outline>`（两条 argc 同形）。 */
const repaintInstr = (op: number, win: number, start: number, mode: number): BinInstruction =>
  instr(op, [im(win), im(start), im(mode), im(0), im(0)]);

/**
 * "模型文本 ≠ 记录切片文本"的最小场景（两个窗各一条 `show-text`）：
 * ```
 * i080 1            // 默认窗 = 1
 * i06e 1 记录侧      // 窗 1：模型文本 + 一条 flags&4 记录（win 1）
 * i06e 2 模型侧      // 窗 2：模型文本 + 一条 flags&4 记录（win 2）
 * ```
 * 记录表 = `[row-text 记录侧 (win1), row-text 模型侧 (win2)]`（连续两条 ⇒ 从 0 切是**一行**拼接）。
 * ⇒ 目标窗取 **2**：模型快照答 `模型侧`，记录切片答 `记录侧模型侧`（互不相同 ⇒ 断言有辨别力）。
 */
const BOUNDARY_SCRIPT = [
  instr(0x80, [im(1)]),
  instr(0x6e, [im(1), str('记录侧')]),
  instr(0x6e, [im(2), str('模型侧')]),
];

test('★波G：`0x82` 的重画源 = 该窗的**模型快照**（记录切片不得参与）—— 记录驱动的前置未落地前不许接', async () => {
  const { e, native, runLast } = await stageScript([...BOUNDARY_SCRIPT, repaintInstr(0x82, 2, 0, 0x2)]);
  assert.deepEqual(
    e.textItems.records.map((r) => r.text),
    ['记录侧', '模型侧'],
    '前置：两条 `i06e` 各 push 一条带正文串的记录（`pushRenderedRow`）',
  );
  assert.equal(e.msgwin.textOf(2), '模型侧', '前置：窗 2 的模型文本');

  native.seen.length = 0;
  await runLast(); // `src/CONFIG.txt:269` 的 op3 = 2

  assert.equal(
    native.lastText,
    '模型侧',
    '★`0x82` 必须重发布该窗**已排好版**的正文；出现「记录侧模型侧」说明有人把它接成了记录驱动',
  );
  assert.equal(e.msgwin.textOf(2), '模型侧', '窗模型也不许被记录切片替换');
  assert.equal(e.msgwin.textOf(1), '记录侧', '更不许把别的窗的记录画进目标窗（前置 ③ 未裁决前这是错的）');
});

test('★波G：孪生对照 —— 同一份记录切片在 `0x1D1` 上**确实**驱动正文（证明上一条不是恒真）', async () => {
  const { e, native, runLast } = await stageScript([...BOUNDARY_SCRIPT, repaintInstr(0x1d1, 2, 0, 0x2)]);
  native.seen.length = 0;
  await runLast();

  assert.equal(
    native.lastText,
    '记录侧模型侧',
    '`0x1D1` 走 `repaintRange`（连续 flags&4 记录按 `memcpy` 规则拼成一行，raw 80731-80752）',
  );
  assert.equal(
    e.msgwin.textOf(2),
    '记录侧模型侧',
    '★孪生用的正是记录表当正文源；与上一条的 `模型侧` 形成对照（两条断言合起来才有辨别力）',
  );
});

/**
 * **注音 / 显现态守恒**（`tickets/T-0179` P3→P4 的验收面之一）。
 *
 * 引擎 `sub_466000` 只**画**（把记录画进该窗表面），一个字都不改窗模型；而"记录驱动"那条写法
 * （`0x1D1` 的 `setPageText` + `captureFontStyle`）是**整窗替换** —— 它会把注音清成 `ruby: []`
 * （`MsgWindow.setPageText`，`src/vm/msgwin.ts:780`）并把显现态 `reveal.delete`（同文件 `:783`）。
 * ⇒ 无论 `0x82` 将来接不接记录驱动，**这两样都不许在重画时丢**：它们是该窗自己的状态，
 * 重画只是"再画一遍"，不是"换一页"。
 *
 * 本用例把 `0x82` 钉在**已有注音 + 正在逐字显现**的活窗上（`0x196` 入队 + `0x72` 武装），
 * 断发布载荷里注音对与显现游标都在。
 */
test('★P4：`0x82` 重画**活窗**（有注音 + 显现中）⇒ 注音与显现态都不丢（整体替换那条写法会清掉它们）', async () => {
  // ★本用例自带 Stage（不能用 `stageScript`）：`0x72` 要通过"逐字显现"那一支就必须有正的
  //   `message:MessageSpeed`（= `Font+1376`），而那要**在 `0x72` 之前**写进 `e.config`。
  const native = new SyncRecorder();
  const e = mkEngine(
    [
      instr(0x80, [im(1)]),
      instr(0x71, [im(1)]), // 页 + 组首
      instr(0x196, [im(1), str('天俟'), str('てんし')]), // 注音：本文词同时追加为文本
      instr(0x6e, [im(1), str('的城堡主人。')]),
      instr(0x72, [im(1)]), // 武装逐字显现（正节拍 ⇒ 真的进入 active）
      repaintInstr(0x82, 1, 0, 0x2), // `src/CONFIG.txt:269` 的形状（op3 = 2，不带 0x40）
    ],
    'FAKE.BIN',
    native,
  );
  for (let i = 0; i < 4; i++) await stepOnce(e);
  e.config = { values: new Map([[CFG.messageMessageSpeed.toLowerCase(), 30]]), sections: [], order: new Map() };
  await stepOnce(e); // `0x72`
  const beforeSegs = e.msgwin.slot(1).segments.map((s) => `${s.text}|${s.ruby.map((r) => r.join('/')).join(',')}`);
  assert.match(
    beforeSegs.join(''),
    /天俟的城堡主人。\|天俟\/てんし/,
    '前置：注音挂在段上（本文词同时是文本，注音对 = 天俟/てんし）',
  );
  assert.equal(e.msgwin.reveal.get(1)?.active, true, '前置：该窗正在逐字显现（`0x72` + `MessageSpeed = 30`）');
  const shown = e.msgwin.reveal.get(1)!.shown;

  native.seen.length = 0;
  await stepOnce(e); // `i082`

  assert.equal(
    e.msgwin.slot(1).segments.map((s) => `${s.text}|${s.ruby.map((r) => r.join('/')).join(',')}`).join(''),
    beforeSegs.join(''),
    '★注音对不许被重画清掉（`setPageText` 那条路会写 `ruby: []` ⇒ 这一条会红）',
  );
  assert.deepEqual(
    native.payloads.at(-1)?.ruby,
    [['天俟', 'てんし']],
    '★发布载荷里的注音也必须还在（宿主拿它排注音；载荷缺了就等于屏上丢注音）',
  );
  assert.equal(
    e.msgwin.reveal.get(1)?.active,
    true,
    '★显现态不许被重画清掉（`setPageText` 会 `reveal.delete(win)` ⇒ 整页会瞬间全亮）',
  );
  assert.equal(e.msgwin.reveal.get(1)?.shown, shown, '★显现游标也不动（重画只画已经画好的部分）');
  assert.equal(native.payloads.at(-1)?.revealed, shown, '★载荷的 `revealed` = 当时的游标（不是 -1 全亮）');
});

test('★波G：切片为空 + `op3` 不带 `0x40` ⇒ 记录驱动路径**清空**该窗（照抄引擎 raw 80589-80611）', async () => {
  // 窗 1 先有模型文本；记录表下标 1 是"换行记录 + 组首"⇒ 从它起的切片是**空页**。
  const script = [
    instr(0x80, [im(1)]),
    instr(0x6e, [im(1), str('清空前')]),
    instr(0x80, [im(2)]),
    instr(0x71, [im(2)]), // 新一段消息：`pushPage` + 组首标记（给下一条 push）
    instr(0x6f, [im(2)]), // 换行记录（flags|8，且吃到组首位）⇒ 从它切 = 0 行
    repaintInstr(0x1d1, 1, 1, 0x2),
  ];
  const { e, native, runLast } = await stageScript(script);
  assert.equal(e.msgwin.textOf(1), '清空前', '前置：窗 1 有活文本，且 `0x71` 只清新一段的那个窗');

  native.seen.length = 0;
  await runLast(); // 目标窗 1、start = 1 ⇒ 空切片、op3 不带 0x40

  assert.equal(
    e.msgwin.textOf(1),
    '',
    '★空切片 ⇒ `setPageText(win, [])` ⇒ 该窗被清空（引擎先清表面再画，raw 80589-80611）',
  );
  assert.equal(native.lastText, '', '清空也要发布出去');
});
