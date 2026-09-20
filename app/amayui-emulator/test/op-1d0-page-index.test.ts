/**
 * **`0x1D0` 回看页索引表读端**（`T-0095`）—— 台账 464 从 `deferred` 转真实现后的行为守卫。
 *
 * ## 被测的三件（引擎 `engine/天结_unpacked.exe_utf8.c`，行号都用定义头 grep 定位过）
 * | 件 | 引擎 | 本文件的落点 |
 * |---|---|---|
 * | `0x1D0` 读出 | `sub_42D440` raw 38098-38110 → `sub_459860` raw **70629-70724** | `TextItemTable.pageAt` |
 * | 页写端（无门） | `0x70` → `sub_45D660` raw **73181-73191**（`a7` 恒 0） | `op_window_geometry` |
 * | 页写端（有门） | `0x71` → `sub_45EC60` raw **74267-74276**（门 = `Engine[97055] >= 0`） | `op_message_show` |
 * | 清两表 | `0x85` → `sub_45EBE0` raw **74182-74194** | `op_text_tables_clear` |
 *
 * ## 合成前奏为什么必须存在（诚实披露）
 * 引擎里页表的**两个写端都不在本票的读端脚本里**：`0x1D0` 只**读**。真语料 5 处（`src/CONFIG.txt:22`、
 * `HISTORY.txt:31/761/1130`、`REPLAYVOICE.txt:13`）全部在 ADV 记账段之后运行，页由**之前的 `i071`** 填。
 * ⇒ 本文件的合成前奏（`i080`/`i1bb`/`i071`/`i1d2`，**全是真 opcode、走真分派**）就是那个"之前的 ADV"。
 * E3 那两节把这件事显式测成一对：**没有前奏 ⇒ 真产物的 `i1d0` 合理地返回 `-1/-1`**；有前奏 ⇒ 返回真页。
 *
 * ## 掩码 bit1
 * `sub_42D440` 末参是**字面量常量 `2`**（raw 38107），写者是渲染层 `sub_46CC60`（raw 84047）那条
 * "重排/重贴已有行"路径 —— emulator 不重放绘制 ⇒ 该位正常恒 0。第 8 条守卫**直接置记录 flags** 来验证
 * 过滤器本身，并在注释里标明这是"直接置位"而不是"有语料覆盖"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { chainResourceDir } from '../src/tools/config1Chain.js';
import { parseScriptBytes, type BinInstruction, type ScriptBinary } from '../src/script/bin.js';
import { asI32, dec } from '../src/vm/bits.js';
import type { Engine } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { ITEM_GROUP_START, ITEM_REFLOW, ITEM_TEXT } from '../src/vm/textItems.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, loc, mkEngine } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---------------------------------------------------------------------------
// 合成前奏 / 读数辅助
// ---------------------------------------------------------------------------

/** 合成前奏的一页：`win` = `i071` 的窗号，`recs` = 该页里 `i1d2` 的值（key 恒 -1，语料哨兵键）。 */
interface SynthPage {
  win: number;
  recs: number[];
}

/**
 * 合成前奏 = 真语料 ADV 记账段的形状：
 * `i080 <win>`（设默认窗，让记录与页的窗号一致）→ `i1bb 1`（记账开）→ 逐页
 * `i071 <win>`（**push 一条页** = 该时刻 `records.length`，raw 74269-74271）+ 若干 `i1d2 -1 <v>`。
 *
 * `i071` 会置该窗组首标记 ⇒ 其后第一条记录的 flags 带 bit0（`ITEM_GROUP_START`）。
 */
function recordPages(pages: SynthPage[], win = 1): BinInstruction[] {
  const ops: BinInstruction[] = [instr(0x80, [im(win)]), instr(0x1bb, [im(1)])];
  for (const p of pages) {
    ops.push(instr(0x71, [im(p.win)]));
    for (const v of p.recs) ops.push(instr(0x1d2, [im(-1), im(v)]));
  }
  return ops;
}

/** 规格 §6.2 的基准三页：`{1,0}`（3 条记录）/ `{1,3}`（2 条）/ `{1,5}`（2 条）⇒ 记录共 7 条。 */
const BASE_PAGES: SynthPage[] = [
  { win: 1, recs: [0x11, 0x12, 0x13] },
  { win: 1, recs: [0x14, 0x15] },
  { win: 1, recs: [0x16, 0x17] },
];

/** 跑完 `n` 条指令（合成脚本短且确定 ⇒ 显式步数比帧循环更好定位）。 */
async function stepN(e: Engine, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await stepOnce(e);
}

/** 读本帧 int 槽（写侧过 ENC ⇒ 读侧必须过 DEC）。 */
function localInt(e: Engine, slot: number): number {
  return asI32(dec(e.key, e.curScript().locals.int.get(slot) ?? 0));
}

/** `i1d0 (local-int 5) (local-int 6) (step)` —— 与真语料 `src/CONFIG.txt:22` 同形。 */
function i1d0(step: number): BinInstruction {
  return instr(0x1d0, [loc(5), loc(6), im(step)]);
}

// ---------------------------------------------------------------------------
// ① 写端形状 / ② 双游标
// ---------------------------------------------------------------------------

test('① push 形状：`pages[k] = {窗号, push 时刻的 records.length}`（raw 73183-73186 / 74269-74271）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine(pre);
  await stepN(e, pre.length);
  assert.deepEqual(
    e.textItems.pages,
    [
      { win: 1, start: 0 },
      { win: 1, start: 3 },
      { win: 1, start: 5 },
    ],
    '★start 是**全窗共用的记录表**里的下标（= push 时刻 records.length），不是"该窗的记录数"',
  );
  assert.equal(e.textItems.records.length, 7, '3 + 2 + 2 条 72B 记录');
  assert.equal(e.textItems.records[0]!.flags & ITEM_GROUP_START, ITEM_GROUP_START, 'i071 后首条记录带组首位');
  assert.equal(e.textItems.records[3]!.flags & ITEM_GROUP_START, ITEM_GROUP_START, '第二页首条同理');
});

test('② 双游标：push 后 `cursor === baseCursor === pages.length-1`（raw 73188-73190 / 74272-74274）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine(pre);
  const pageCounts: number[] = [];
  for (let i = 0; i < pre.length; i++) {
    await stepOnce(e);
    assert.equal(e.textItems.cursor, e.textItems.baseCursor, `第 ${i} 步：两个游标必须同步（raw 73189-73190）`);
    if (e.textItems.pages.length > 0) {
      assert.equal(
        e.textItems.cursor,
        e.textItems.pages.length - 1,
        `第 ${i} 步：push 之后游标 = 新末项（raw 73190 / 74274）`,
      );
    } else {
      assert.equal(e.textItems.cursor, 0, `第 ${i} 步：还没 push 过 ⇒ 游标停在初值 0`);
    }
    pageCounts.push(e.textItems.pages.length);
  }
  assert.deepEqual(
    pageCounts,
    [0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3],
    '页数只在 3 条 `i071` 那三步增长（前两步是 `i080`/`i1bb`）',
  );
});

// ---------------------------------------------------------------------------
// ③④⑤⑥ 导航语义
// ---------------------------------------------------------------------------

test('③ `op3 = 0` 输出**当前页**（raw 70720-70721；`a4 == 0` 直落 LABEL_22）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine([...pre, i1d0(0)]);
  await stepN(e, pre.length);
  await stepOnce(e);
  assert.equal(localInt(e, 5), 1, 'op1 = 该页窗号');
  assert.equal(localInt(e, 6), 5, 'op2 = 该页起始记录下标（未 push 页时是 -1）');
  assert.equal(e.textItems.cursor, 2, '★读端**不改游标**（raw 70650 只把 Font[860] 拷进局部）');
});

test('④ `op3 < 0` 向"旧"退格：`-1` ⇒ 上一页、`-2` ⇒ 上两页（raw 70651-70670）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine([...pre, i1d0(-1), i1d0(-2)]);
  await stepN(e, pre.length);
  await stepOnce(e);
  assert.equal(localInt(e, 6), 3, '-1 ⇒ {1,3}');
  assert.equal(localInt(e, 5), 1);
  await stepOnce(e);
  assert.equal(localInt(e, 6), 0, '-2 ⇒ {1,0}（out2 单调变小）');
  assert.equal(localInt(e, 5), 1);
});

test('⑤ 越界 ⇒ `-1/-1`（表底：raw 70657 的 `while(v6)` 0-哨兵 + raw 70712 的下标越界）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine([...pre, i1d0(-3), i1d0(-99)]);
  await stepN(e, pre.length);
  await stepOnce(e);
  // -3：退到 pages[0]（start = 0）时 `while (v6)` 为假 ⇒ raw 70657 掉出循环 ⇒ raw 70673 return 0。
  // ★引擎把**记录下标 0 当"空"哨兵**（记录 0 其实是合法下标）—— 照抄，不"修正"（design.md §9 不确定项 3）。
  assert.equal(localInt(e, 5), -1, '★-3 ⇒ -1/-1（`while(v6)` 的 0-哨兵，不是"表底"）');
  assert.equal(localInt(e, 6), -1);
  await stepOnce(e);
  assert.equal(localInt(e, 5), -1, '-99 ⇒ -1/-1（同上路径）');
  assert.equal(localInt(e, 6), -1);
});

test('⑥ `op3 > 0` 向"新"进格；越界/撞 LIVE 页 ⇒ `-1/-1`（raw 70675-70693）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine([...pre, i1d0(1), i1d0(2), i1d0(1)]);
  await stepN(e, pre.length);
  // 游标在末页（2）⇒ 前进越过末页（raw 70686 `v5 >= v12`）
  await stepOnce(e);
  assert.equal(localInt(e, 5), -1, '★cursor 已在末页 ⇒ 前进越界 ⇒ -1/-1');
  assert.equal(localInt(e, 6), -1);
  // 用 `sub_459770`（真游标移动器）退两格到第 0 页
  assert.equal(e.textItems.moveCursor(-1, ITEM_REFLOW), 1, '退一格成功（raw 70616-70617）');
  assert.equal(e.textItems.cursor, 1);
  assert.equal(e.textItems.moveCursor(-1, ITEM_REFLOW), 1, '再退一格');
  assert.equal(e.textItems.cursor, 0);
  await stepOnce(e); // i1d0 +2：能计一格（到 pages[1]），第二格撞上 LIVE 页哨兵
  assert.equal(localInt(e, 6), -1, '★+2 ⇒ -1/-1：raw 70689 `v15 == *(Font[846]-4)` = 末条目的 start');
  await stepOnce(e); // i1d0 +1：pages[1] = {1,3}
  assert.equal(localInt(e, 6), 3, '+1 ⇒ {1,3}（op3 > 0 在语料里无实测用法，这里只验体内语义）');
  assert.equal(localInt(e, 5), 1);
  // `moveCursor(0, …)` = 回到 LIVE 页（raw 70624-70625）
  assert.equal(e.textItems.moveCursor(0, ITEM_REFLOW), 1, 'dir == 0 ⇒ 复位并返回 1');
  assert.equal(e.textItems.cursor, e.textItems.baseCursor, '复位到 push 时刻的末项');
  assert.equal(e.textItems.cursor, 2);
});

// ---------------------------------------------------------------------------
// ⑦⑧ 去重 / 掩码
// ---------------------------------------------------------------------------

/** 单条 `i1d2 -1 <v>`（文本项 push，语料哨兵键 -1）。 */
function rec(v: number): BinInstruction {
  return instr(0x1d2, [im(-1), im(v)]);
}

test('⑦ 相邻**同 start** 的重复页被跳过：带/不带重复页的表**逐页结果相同**（raw 70666 `v6 != v18`）', async () => {
  // `0x70` 恒 push（raw 73181 无门）⇒ 连续两次"没有新记录"的 i071/i070 会产出同 start 的相邻条目。
  // 这里用两次空 recs 的 `i071` 复现，再补两条记录让末页的 start(5) < records.length(7)。
  const withDup = recordPages([
    { win: 1, recs: [0x11, 0x12, 0x13] }, // push @0 ⇒ {1,0}
    { win: 1, recs: [0x14, 0x15] }, // push @3 ⇒ {1,3}
    { win: 1, recs: [] }, // push @5 ⇒ {1,5}
    { win: 1, recs: [] }, // push @5 ⇒ {1,5}  ★与上一条同 start
  ]);
  const eDup = mkEngine([...withDup, rec(0x16), rec(0x17), i1d0(0), i1d0(-1), i1d0(-2)]);
  await stepN(eDup, withDup.length + 2);
  assert.deepEqual(
    eDup.textItems.pages,
    [
      { win: 1, start: 0 },
      { win: 1, start: 3 },
      { win: 1, start: 5 },
      { win: 1, start: 5 },
    ],
    '前提：第 3、4 页同 start',
  );
  const dup: Array<[number, number]> = [];
  for (let k = 0; k < 3; k++) {
    await stepOnce(eDup);
    dup.push([localInt(eDup, 5), localInt(eDup, 6)]);
  }

  // 对照表：删掉那条重复页
  const noDup = recordPages([
    { win: 1, recs: [0x11, 0x12, 0x13] },
    { win: 1, recs: [0x14, 0x15] },
    { win: 1, recs: [] },
  ]);
  const eNo = mkEngine([...noDup, rec(0x16), rec(0x17), i1d0(0), i1d0(-1), i1d0(-2)]);
  await stepN(eNo, noDup.length + 2);
  const no: Array<[number, number]> = [];
  for (let k = 0; k < 3; k++) {
    await stepOnce(eNo);
    no.push([localInt(eNo, 5), localInt(eNo, 6)]);
  }

  assert.deepEqual(
    dup,
    no,
    '★去重 ⇒ "退 k 格"数的是**不同的页**，重复条目完全透明（`-1` 跳 index 2 落到 index 1）',
  );
  assert.deepEqual(dup, [[1, 5], [1, 3], [1, 0]], 'step 0/-1/-2 ⇒ 当前页 / page1 / page0');
  // 若照抄时漏掉 raw 70666 的 `v6 != v18`，`-2` 会被那条重复页吃掉一格 ⇒ 停在 index 1（start = 3）而不是 0。
  assert.notEqual(dup[2]![1], 3, '★-2 不得被重复页吃掉一格（漏去重就会得到 3）');
});

test('⑧ 记录 flags 带 bit1（掩码 2）的页被跳过（raw 38107 常量 2 + raw 70666/70694）', async () => {
  // ★直接置位：该位的写者是渲染层 sub_46CC60（raw 84047）那条"重排/重贴已有行"路径，
  //   emulator 不重放绘制 ⇒ 没有真语料能产出它。这一条验的是**过滤器本身**，不假装有语料。
  const run = async (setBit: boolean): Promise<number> => {
    const pre = recordPages(BASE_PAGES);
    const e = mkEngine([...pre, i1d0(-1)]);
    await stepN(e, pre.length);
    if (setBit) e.textItems.records[3]!.flags |= ITEM_REFLOW; // 记录 3 = 第 1 页（start 3）的首条
    await stepOnce(e);
    return localInt(e, 6);
  };
  assert.equal(await run(false), 3, '对照：bit1 未置 ⇒ -1 取到第 1 页 {1,3}');
  assert.equal(await run(true), 0, '★bit1 置 ⇒ 第 1 页被掩码挡掉 ⇒ 继续退到第 0 页 {1,0}');
});

// ---------------------------------------------------------------------------
// ⑨ 写端门（i1bb）
// ---------------------------------------------------------------------------

test('⑨ `i1bb 0` 期间 `i071` **不** push、不置组首；`i070` **仍** push + 置组首（raw 74267 vs 73181）', async () => {
  const GATE_ON = ENGINE_FIELD.textBaseGate;
  // 场景 A：记账关 ⇒ i071 什么都不做
  const a = mkEngine([
    instr(0x80, [im(1)]),
    instr(0x1bb, [im(0)]), // i1bb 0 ⇒ Engine[97055] = 0x80000000
    instr(0x71, [im(1)]), // 门 = a3 >= 0（raw 74267）⇒ 假
    instr(0x1bb, [im(1)]),
    rec(0x21),
  ]);
  await stepOnce(a); // i080
  await stepOnce(a); // i1bb 0
  assert.equal(a.engineValues.get(GATE_ON), 0x80000000 | 0, '前提：门为负（`0x1BB` → `sub_420000` raw 29240）');
  await stepOnce(a); // i071
  assert.equal(a.textItems.pages.length, 0, '★i1bb 0 期间 i071 不 push 页（旧实现因 textSlotArg 恒真而漏判）');
  await stepOnce(a); // i1bb 1
  await stepOnce(a); // i1d2
  assert.equal(a.engineValues.get(GATE_ON), 0, '恢复记账（门 = 0 ⇒ `>= 0`）');
  assert.equal(a.textItems.records.length, 1, '恢复记账后 i1d2 正常 push');
  assert.equal(a.textItems.records[0]!.flags & ITEM_GROUP_START, 0, '★组首标记也没被置（同一道门内，raw 74275）');

  // 场景 B：同一个 i1bb 0 段里 i070 无门 ⇒ 照样 push + 置组首（raw 73181 `a7` 恒 0）
  const b = mkEngine([
    instr(0x80, [im(1)]),
    instr(0x1bb, [im(0)]),
    instr(0x70, [im(1), im(100), im(50), im(0), im(0)]), // 几何 + push 页 + 组首（不过门）
    instr(0x1bb, [im(1)]),
    rec(0x22),
  ]);
  await stepOnce(b);
  await stepOnce(b);
  assert.equal(b.engineValues.get(GATE_ON), 0x80000000 | 0, '前提：门为负');
  await stepOnce(b); // i070
  assert.equal(b.textItems.pages.length, 1, '★i070 在 i1bb 0 段里**仍然** push（无门）');
  assert.deepEqual(b.textItems.pages[0], { win: 1, start: 0 }, 'start = 该时刻的记录条数 0');
  assert.equal(b.textItems.records.length, 0, '此时还没有记录');
  await stepOnce(b); // i1bb 1
  await stepOnce(b); // i1d2
  assert.equal(b.textItems.records[0]!.flags & ITEM_GROUP_START, ITEM_GROUP_START, '★i070 也置组首（raw 73187）');
});

// ---------------------------------------------------------------------------
// ⑩ 清表（0x85）
// ---------------------------------------------------------------------------

test('⑩ `i085` 清空**两张表**（raw 74188-74193）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine([...pre, instr(0x85, [])]);
  await stepN(e, pre.length);
  await stepOnce(e);
  assert.equal(e.textItems.pages.length, 0, '页表清空（raw 74190-74193）');
  assert.equal(e.textItems.records.length, 0, '72B 记录表清空（raw 74188-74189）');
  // ★与规格 §6.2 第 10 条不一致的**体证事实**：`sub_45EBE0` **不复位** `Font[859]`/`Font[860]`
  //   （raw 74182-74194 里一次都没出现这两个偏移）⇒ 残留游标照抄。它不可观测：
  //   表已空 ⇒ 下一次 pageAt 必然走 raw 70712 的"表空"分支写 -1/-1。
  assert.equal(e.textItems.cursor, 2, '★i085 后游标保持（引擎不复位；请勿"顺手补全"）');
  assert.equal(e.textItems.baseCursor, 2);
  const after = mkEngine([...pre, instr(0x85, []), i1d0(0)]);
  await stepN(after, pre.length + 2);
  assert.equal(localInt(after, 5), -1, '表空 ⇒ 即便 step 0 也写 -1/-1（raw 70712）');
  assert.equal(localInt(after, 6), -1);
  // 对照：`0x9 exit-script` 的 `reset()`（`handlers/control.ts` 调）**会**把游标一并归零。
  e.textItems.reset();
  assert.equal(e.textItems.cursor, 0);
  assert.equal(e.textItems.baseCursor, 0);
});

// ---------------------------------------------------------------------------
// ⑪ 语料闭环：i1d0 的 op2 直接当 i1d3 的第 4 操作数
// ---------------------------------------------------------------------------

test('⑪ `i1d0` 的 op2 直接喂 `i1d3` 的第 4 操作数时命中（`src/CONFIG.txt:22/26`、`HISTORY.txt:31/33`）', async () => {
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine([
    ...pre,
    i1d0(0), // op1 = 窗号、op2 = 起始记录下标（= 5）
    instr(0x51, [loc(12), im(0), im(1)]), // 语料形状：先算出哨兵键 -1（`sub c 0 1`，HISTORY.txt:25）
    instr(0x1d3, [loc(8), loc(9), loc(5), loc(6), loc(12)]), // 真语料 `CONFIG.txt:26` 的形状
  ]);
  await stepN(e, pre.length + 3);
  assert.equal(localInt(e, 6), 5, 'i1d0 给出的起始下标');
  assert.equal(localInt(e, 8), 1, '★i1d3 命中（found = 1）：op2 确实是合法记录下标');
  assert.equal(localInt(e, 9), 0x17, '取组内**最后一次**匹配（raw 69356：不提前 break）');
  assert.ok(
    e.textItems.records[localInt(e, 6)!]!.flags & ITEM_TEXT,
    'start 处的记录必须是文本项（0x1D2 push）',
  );
});

// ---------------------------------------------------------------------------
// E3：真产物 `install/CONFIG.BIN`（426 条；`0x1D0` 恰好 1 处 = 第 14 条）
// ---------------------------------------------------------------------------

interface RealConfig {
  ops: BinInstruction[];
  i1d0: BinInstruction;
  at: number;
}

/**
 * 从真 `install/CONFIG.BIN` 取回看页那一段（与 `test/op-3-004-furigana-outer-gate.test.ts`
 * 同一条读取路径：`NodeFileSource` + `chainResourceDir` + 名字解析 + 松散文件优先）。
 */
async function realConfig(): Promise<RealConfig> {
  const src = new NodeFileSource({ resourceDir: chainResourceDir() });
  const boot = await src.readByName('CONFIG.BIN');
  assert.ok(boot, 'install/CONFIG.BIN 应可读（缺产物时先 `cd scripts && node translate.js assemble CONFIG`）');
  const sc = parseScriptBytes(boot.data);
  const ops = sc.instructions;
  const at = ops.findIndex((x) => x.opcode === 0x1d0);
  assert.notEqual(at, -1, 'CONFIG.BIN 里应有 `0x1d0`（源码 `src/CONFIG.txt:22`）');
  return { ops, i1d0: ops[at]!, at };
}

test('E3 载体核对：`install/CONFIG.BIN` 426 条，`0x1d0`×1（第 14 条，实参 = local-int 5/6/7）', async () => {
  const { ops, i1d0: real, at } = await realConfig();
  assert.equal(ops.length, 426, 'CONFIG.BIN 指令总数');
  assert.equal(at, 14, '`i1d0` 在帧内下标 14（★它在 `i1bb 0`(27) 与 `i071`(132) **之前** ⇒ 页只能来自更早的场景）');
  assert.equal(real.argc, 3);
  assert.deepEqual(
    real.args.map((a) => [a.type, a.raw]),
    [[9, 5], [9, 6], [9, 7]],
    '★与 `src/CONFIG.txt:22` 逐字对应：op1/op2 = 出参槽、op3 = 步数槽（都是 local-int ⇒ 池操作数）',
  );
  const count = (op: number): number => ops.filter((x) => x.opcode === op).length;
  assert.deepEqual(
    [count(0x70), count(0x71), count(0x1bb), count(0x1d2), count(0x1d3), count(0x1d1), count(0x85)],
    [1, 3, 2, 1, 1, 0, 0],
    '真产物里本族的规模（与 design.md §6.3 实测一致）',
  );
});

test('E3 ★诚实披露：**没有前奏**时真产物的 `i1d0` 合理地返回 `-1/-1`（CONFIG 自己只读页表）', async () => {
  const { i1d0: real } = await realConfig();
  const e = mkEngine([{ ...real }]);
  await stepOnce(e);
  assert.equal(e.textItems.pages.length, 0, '前提：CONFIG.BIN 自己没有 push 过任何页');
  assert.equal(localInt(e, 5), -1, 'op1 = -1（raw 70648-70649 的初值）');
  assert.equal(localInt(e, 6), -1, 'op2 = -1');
});

test('E3 ★有前奏（= 主 ADV 的记账段）时真产物的 `i1d0` 返回真页：op2 是合法记录下标', async () => {
  const { i1d0: real } = await realConfig();
  const pre = recordPages(BASE_PAGES);
  const e = mkEngine([...pre, { ...real }]);
  await stepN(e, pre.length + 1);
  assert.equal(localInt(e, 5), 1, 'op1 = 窗号（前奏 push 的页），不是 -1');
  assert.equal(localInt(e, 6), 5, 'op2 = 该页在记录表里的起始下标');
  assert.notEqual(localInt(e, 6), -1, '★真产物的 `i1d0` 不再是恒 -1/-1');
  const start = localInt(e, 6);
  assert.ok(
    start >= 0 && start < e.textItems.records.length,
    `op2 = ${start} 必须是合法 records 下标（records.length = ${e.textItems.records.length}）`,
  );
  assert.equal(e.textItems.records[start]!.flags & ITEM_TEXT, ITEM_TEXT, 'start 处是文本项记录');
});
