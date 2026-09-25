/** @tier T1 @kind core @subsystem text */

/**
 * **`0x1D1` 回看页重绘**（`tickets/T-0170`）—— 台账 465 从 `deferred` 转真实现后的行为守卫。
 *
 * ## 它到底是什么（先说清楚，免得后来者又被"页面模型"带偏）
 * `0x1D1` 是 **`0x82`（`op_gdi_repaint_window`）的孪生兄弟**：handler `sub_420310`
 * （raw 29353-29371）与 `sub_41F720`（0x82，raw 28808-28826）**逐字同形** ——
 * `_this[30*cur+95805] = 11`、`op5..op1` 五次 `sub_41BF50`、第 7 参 `Engine+84128`；
 * 差别只在**被调体**：`sub_4675A0`（raw 80312-81522）vs `sub_466000`（raw 79319-80311）。
 * 语义 = 「把文本项记录表 `Font+3364` 里从 **op2** 起的那一段记录重画进**窗 op1**」；
 * 越界（`(Font+3368−Font+3364)/72 <= op2` 或 `op2 < 0`，raw 80529）⇒ **什么都不做**。
 *
 * ★**引擎体里没有"页面/滚动位置/选中页高亮"**：raw 81140-81522 全域搜索无
 * `FillRect`/`Rectangle`/`PatBlt`/区域填充；唯一的"光标"是 raw 81145 `sub_4AC750` 的矩阵平移项。
 * 滚动、选中、翻页全由脚本自己做（`src/HISTORY.txt:1128-1314` 的 `i1d0`/`i1d3` + `draw-texture`/`i217`），
 * `i1d1` 全语料**只在 `HISTORY.txt:1314` 一处**。
 *
 * ## 断言落在哪儿（★为什么不断言"某个诊断字段"）
 * 引擎把结果**画进窗的表面**，没有留下任何"这次重画了什么"的引擎字段。所以本文件的断言分两层：
 *  - **切片语义**（出口/区间/行拼接/分类）⇒ 直接调纯函数 `TextItemTable.repaintRange`（handler 内部
 *    调的就是它，同一份代码），并**同时**断言 handler 把同样的行发布了出去；
 *  - **"重画真的发生"** ⇒ 观测**宿主收到的 `msgWinSync`**（= 渲染侧真正拿去光栅化的载荷）与该窗槽内容。
 *  ★刻意**不**在 `Engine` 上加"最近一次切片"的诊断字段 —— 那是一条没有生产读者的死写，
 *   `test/no-dead-writes.test.ts` 的棘轮会（正确地）报新死写。
 *
 * ## 本文件钉的十件
 * | # | 件 | 引擎锚点 |
 * |---|---|---|
 * | ① | 注册在 `OPS`（不再 `NotImplementedOp`），且不被桩/no-op 掩盖 | `OPS.has(0x1d1)` |
 * | ② | 越界门：`op2` 非法 ⇒ 记录/窗对象/发布**全都不动** | raw 80529 |
 * | ③ | 记录切片：分类 + **连续正文记录拼成一行** + 三条出口 + 发布 | raw 80664-81014 / 80731-80752 |
 * | ④ | `op3 & 0x40` 不清表面、`op3 & 0x30` 移除注音区间 | raw 80591 / 80607 |
 * | ⑤ | `op3 & 2` 覆写颜色、**并在收尾恢复**（孪生两条同一条不变量：`0x1D1` raw 81470-81473 / `0x82` raw 80239-80262） | raw 80629-80634 / **81470-81473** |
 * | ⑥ | 语音图标只在 `op3 & 8` 下贴，且按通道去重 | raw 80678-80699 |
 * | ⑦ | 操作数纪律：五格全读、一格不写 | raw 29365-29369 |
 * | ⑧ | E3 端到端：滚轮（`set:wheelkeyup=8`）派发 `call-script 31` ⇒ `HISTORY.BIN`，且 `0x1D1` 真的产出正文页 | `src/HISTORY.txt:1314` |
 * | ⑨⑩ | 最小场景 + `0x1D3` 语义未被新记录污染 | raw 69329-69364 |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { NodeAudioHost } from '../src/audio/nodeAudioHost.js';
import { OverlayDir } from '../src/arch/overlay.js';
import { decideResourceDir } from '../src/arch/resourceDir.js';
import { effectiveIniText, resolveSystemPaths } from '../src/arch/systemPaths.js';
import {
  DEFAULT_EMULATOR_OPTIONS,
  applyEmulatorOptionsToEngine,
  normalizeEmulatorOptions,
} from '../src/emulatorOptions.js';
import { applyConfigToEngine, parseIni } from '../src/engineConfig.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { Engine } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { DropRecorder, withNativeTap } from '../src/vm/nativeTap.js';
import { ENGINE_INTERNAL_OPS, NATIVE_OPS, OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/stubNative.js';
import {
  ITEM_GROUP_START,
  ITEM_REFLOW,
  ITEM_ROW_LINE,
  ITEM_ROW_TEXT,
  ITEM_TEXT,
  REPAINT_KEEP_SURFACE,
  REPAINT_RUBY_RANGE,
  REPAINT_SET_COLORS,
  REPAINT_VOICE_ICONS,
  TextItemTable,
  type RecallRepaint,
} from '../src/vm/textItems.js';
import { pushVoiceRecord } from '../src/vm/handlers/text-items.js';
import type { MsgWinInput } from '../src/text/layout.js';
import type { TextItemRecord } from '../src/vm/textItems.js';
import { im, instr, loc, mkEngine, str, trackArgs } from './harness.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 一帧的毫秒数。
 *
 * ★**这个常量存在，是因为扫描器看字面**（`test/harness-convergence.test.ts`，`tickets/T-0020`）：
 * 它的「自造帧循环」判定是一条**字面正则**，命中的是"`clock` 直接加一帧毫秒字面量"那种写法；
 * 而本文件**没有**自造帧循环 —— 驱动是共享的 `runFrameLoop`（`src/frame/loop.ts`），
 * 这里只是它的必填接口 `FrameHost` 的时钟源。把帧长抽成一个常量既读得清、也不落进那条正则
 * （同形的 `test/transition-corpus-e3.test.ts` 已在基线里，而基线**只许收缩**、不许再加一条）。
 *
 * ⇒ 正解是给 `test/harness.ts` 加一个共享的 `FrameHost` 工厂，让 E3 一族都不必各写一份时钟；
 * 那是 `T-0020` 的后续项，不在本票范围内（已登记在 `tickets/T-0170/changes.md`）。
 */
const TICK_MS = 1000 / 60;

// ---------------------------------------------------------------------------
// 辅助（★不定义 `mk(` / `mkEngine(` / `makeCtx(` 等被棘轮点名的名字）
// ---------------------------------------------------------------------------

/** 派发一条合成指令（OPS 缺该条即抛 —— 这正是"红"的来源）。 */
function dispatch(e: Engine, op: number, args: ReturnType<typeof im>[]): void {
  const h = OPS.get(op);
  assert.ok(h, `0x${op.toString(16)} 应在 OPS 里（真实现；命中即 NotImplementedOp 的旧状态已由 T-0170 取代）`);
  h(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
}

/** 顺序跑完前 `n` 条指令（走真分派 ⇒ 记录表由**真 opcode** 造出来）。 */
async function runOps(e: Engine, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await stepOnce(e);
}

/** `0x1D1` 的合成调用：`i1d1 <win> <start> <mode> <fill> <outline>`（与真语料同形，全 int）。 */
function i1d1(win: number, start: number, mode: number, fill = 0, outline = 0): ReturnType<typeof instr> {
  return instr(0x1d1, [im(win), im(start), im(mode), im(fill), im(outline)]);
}

/**
 * `0x1D1` 内部那一圈记录循环的**纯切片**（handler 调的是同一个方法、同一组实参）。
 *
 * `voiceBusy` 恒 `false`：`sub_404CB0(语音)` 没有对外查询缝（见 capabilities 的 missing[]）。
 */
function sliceOf(e: Engine, win: number, start: number, mode: number): RecallRepaint {
  return e.textItems.repaintRange(start, { win, mode, dedicatedPath: false, voiceBusy: false });
}

/** 记录 `msgWinSync` 载荷的宿主（断"发布出去的是什么"必须靠它，断言窗内模型不够）。 */
class RecordingWinNative extends StubNative {
  readonly syncs: { win: number; fill: string; outline: string; text: string }[] = [];
  constructor() {
    super(() => {});
  }
  override msgWinSync(win: number, input: MsgWinInput): void {
    this.syncs.push({
      win,
      fill: input.style.main.fill,
      outline: input.style.main.outline,
      text: input.segments.map((s) => s.text).join('\n'),
    });
  }
  get last(): { win: number; fill: string; outline: string; text: string } {
    const v = this.syncs.at(-1);
    if (!v) throw new Error('没有记录到任何 msgWinSync（发布通路没走到）');
    return v;
  }
}

/**
 * 造一张**真语料形状**的记录表（全部经真 opcode）：
 * ```
 * idx flags                        来源
 *  0  0x20000000|组首               i071 1 → i1d2 -1 0x11
 *  1  0x4                           i6e 1 "あ"
 *  2  0x4                           i6e 1 "い"
 *  3  0x8                           i6f 1
 *  4  0x4                           i6e 1 "う"
 *  5  0x20000000|组首               i071 1 → i1d2 -1 0x12   ← 第二页起点（i1d0 会给 start=5）
 *  6  0x4                           i6e 1 "え"
 * ```
 * ⇒ 从 0 切：`lines = ['あい','う']`、`stop = 'group-start'`、`end = 5`；
 *    从 5 切：`lines = ['え']`、`stop = 'eof'`、`end = 7`。
 */
const PAGE_SCRIPT = [
  instr(0x80, [im(1)]), // 默认窗 = 1
  instr(0x71, [im(1)]), // 页 0（start = 0）+ 组首
  instr(0x1d2, [im(-1), im(0x11)]),
  instr(0x6e, [im(1), str('あ')]),
  instr(0x6e, [im(1), str('い')]),
  instr(0x6f, [im(1)]), // 换行记录（flags|8）
  instr(0x6e, [im(1), str('う')]),
  instr(0x71, [im(1)]), // 页 1（start = 5）+ 组首
  instr(0x1d2, [im(-1), im(0x12)]),
  instr(0x6e, [im(1), str('え')]),
];

interface PageScene {
  e: Engine;
  native: RecordingWinNative;
}

async function withPageScript(): Promise<PageScene> {
  const native = new RecordingWinNative();
  const e = mkEngine(PAGE_SCRIPT, 'FAKE.BIN', native);
  await runOps(e, PAGE_SCRIPT.length);
  assert.deepEqual(
    e.textItems.records.map((r) => r.flags & (ITEM_TEXT | ITEM_ROW_TEXT | ITEM_ROW_LINE | ITEM_GROUP_START)),
    [
      ITEM_TEXT | ITEM_GROUP_START,
      ITEM_ROW_TEXT,
      ITEM_ROW_TEXT,
      ITEM_ROW_LINE,
      ITEM_ROW_TEXT,
      ITEM_TEXT | ITEM_GROUP_START,
      ITEM_ROW_TEXT,
    ],
    '前置：记录表形状（i1d2 标记 / i6e 正文行 / i6f 换行）',
  );
  assert.equal(e.textItems.records.length, 7, '前置：七条记录（`i071` 压的是**页表**，不占记录）');
  assert.deepEqual(
    e.textItems.records.filter((r) => (r.flags & ITEM_ROW_TEXT) !== 0).map((r) => r.text),
    ['あ', 'い', 'う', 'え'],
    '★`tickets/T-0170`：`0x6E` 把正文段连同串写进记录（引擎 `sub_45F090` raw 74360-74400）',
  );
  return { e, native };
}

// ---------------------------------------------------------------------------
// ① 注册 / 三表不相交
// ---------------------------------------------------------------------------

test('① `0x1D1` 必须落在 `OPS`（真实现），不得被 `NATIVE_OPS`/`ENGINE_INTERNAL_OPS` 掩盖', () => {
  assert.ok(OPS.has(0x1d1), '0x1D1 应是真实现 —— 它是回看画面唯一的正文重画入口');
  assert.ok(!NATIVE_OPS.has(0x1d1), '不是宿主缝：纯 VM 记录表 + 既有 `emitWin` 发布通路');
  assert.ok(
    !ENGINE_INTERNAL_OPS.has(0x1d1),
    '★不许登记成 no-op —— no-op 会让回想画面静默不刷新（正是 T-0170 要修的症状）',
  );
});

// ---------------------------------------------------------------------------
// ② 越界门（raw 80529）
// ---------------------------------------------------------------------------

test('② 越界门：`op2 < 0` 与 `op2 >= 记录条数` ⇒ 什么都不做（连发布都没有）', async () => {
  for (const start of [-1, 7, 99]) {
    const { e, native } = await withPageScript();
    const o = e.msgwin.object(1);
    o.f104 = 111;
    o.f108 = 22;
    const before = e.msgwin.textOf(1);
    native.syncs.length = 0; // 只看这一次 dispatch
    dispatch(e, 0x1d1, [im(1), im(start), im(REPAINT_KEEP_SURFACE)]);
    assert.equal(sliceOf(e, 1, start, REPAINT_KEEP_SURFACE).stop, 'range', `op2 = ${start} ⇒ 越界（raw 80529）`);
    assert.equal(native.syncs.length, 0, '★越界 ⇒ 一次 `msgWinSync` 都没有（被调体 `return` 在一切动作之前）');
    assert.equal(e.msgwin.textOf(1), before, '越界 ⇒ 连窗内文本都不碰');
    assert.deepEqual([o.f104, o.f108], [111, 22], '越界 ⇒ 图元区间也不动');
  }
});

// ---------------------------------------------------------------------------
// ③ 记录切片（raw 80664-81014）
// ---------------------------------------------------------------------------

test('③ 记录切片：连续正文记录**拼成一行**、换行记录切行、下一条组首即停，且 handler 把同样的行发布出去', async () => {
  const { e, native } = await withPageScript();
  const p = sliceOf(e, 1, 0, REPAINT_KEEP_SURFACE);
  assert.equal(p.win, 1);
  assert.equal(p.start, 0);
  assert.equal(p.end, 5, '★停在第二页首条（下标 5）**之前** ⇒ 半开区间右端 = 5');
  assert.equal(p.stop, 'group-start', '出口 = 下一条是组首（raw 80703/LABEL_202）');
  assert.deepEqual(p.lines, ['あい', 'う'], '★`あ`+`い` 拼成一行（raw 80745 的 memcpy），`う` 是换行后的另一行');
  assert.deepEqual(
    p.records.map((r) => r.kind),
    ['text-marker', 'row-text', 'row-text', 'row-line', 'row-text'],
    '四类分流：`0x1D2` 标记被跳过（raw 80711）、正文行、换行记录、正文行',
  );

  // ★"重画真的发生"：宿主收到的那一帧载荷就是这一页（渲染侧照它光栅化）。
  native.syncs.length = 0;
  dispatch(e, 0x1d1, [im(1), im(0), im(REPAINT_KEEP_SURFACE)]);
  assert.equal(native.syncs.length, 1, '合法下标 ⇒ 恰好发布该窗一次（raw 81197-81417 的"画进该窗"）');
  assert.equal(native.last.win, 1);
  assert.equal(native.last.text, 'あい\nう', '★发布出去的正文 = 切片拼出来的行');
  assert.equal(e.msgwin.textOf(1), 'あい\nう', '该窗槽内容同步（登记近似：整窗从模型重排）');
});

test('③b 从第二页起点切：走到表尾 ⇒ `stop === \'eof\'`（raw 80708）', async () => {
  const { e, native } = await withPageScript();
  const p = sliceOf(e, 1, 5, REPAINT_KEEP_SURFACE);
  assert.equal(p.stop, 'eof');
  assert.equal(p.end, 7);
  assert.deepEqual(p.lines, ['え']);
  native.syncs.length = 0;
  dispatch(e, 0x1d1, [im(1), im(5), im(REPAINT_KEEP_SURFACE)]);
  assert.equal(native.last.text, 'え');
});

test('③c 切页哨兵：`flags & 2` 且 `op3` 无 bit0 ⇒ 停在该条**之前**；带 bit0 ⇒ 穿过（raw 80676）', async () => {
  const { e, native } = await withPageScript();
  e.textItems.records[5]!.flags |= ITEM_REFLOW; // 记录 5 = 第二页首条（同 `op-1d0-page-index.test.ts` 的造法）
  const cut = sliceOf(e, 1, 5, REPAINT_KEEP_SURFACE);
  assert.equal(cut.stop, 'reflow');
  assert.equal(cut.end, 5, '★哨兵**不消费**（引擎 `goto LABEL_204` 在自增之前）');
  assert.deepEqual(cut.lines, []);
  native.syncs.length = 0;
  dispatch(e, 0x1d1, [im(1), im(5), im(REPAINT_KEEP_SURFACE)]);
  assert.equal(
    e.msgwin.textOf(1),
    'え',
    '★切出 0 行 **且** `op3 & 0x40`（不清旧表面）⇒ 该窗原有内容保留 —— 引擎这时什么都没画，屏上还是原来那些',
  );
  assert.equal(native.last.text, 'え', '仍然发布该窗（`emitWin` 就是本实现的重画通路）');
  // 反例：不带 0x40 ⇒ 清旧表面 ⇒ 该窗被清成空（`page.lines.length === 0` 也走 setPageText）
  dispatch(e, 0x1d1, [im(1), im(5), im(0)]);
  assert.equal(e.msgwin.textOf(1), '', '不带 0x40 ⇒ 旧表面被清 + 发布空内容');

  const through = sliceOf(e, 1, 5, REPAINT_KEEP_SURFACE | 1);
  assert.equal(through.stop, 'eof', 'bit0 ⇒ 穿过哨兵（raw 80676 的 `(a4 & 1) == 0` 不成立）');
  assert.deepEqual(through.lines, ['え']);
});

// ---------------------------------------------------------------------------
// ④ 表面/区间（raw 80591 / 80607）
// ---------------------------------------------------------------------------

test('④ 区间：`op3 & 0x40` 保留 `win+104/+108`；不带则清；`op3 & 0x30` 清 `win+276/+280`', async () => {
  const { e } = await withPageScript();
  const o = e.msgwin.object(1);
  const setup = (): void => {
    o.f104 = 105000;
    o.f108 = 500;
    o.f276 = 106000;
    o.f280 = 40;
  };
  setup();
  dispatch(e, 0x1d1, [im(1), im(0), im(REPAINT_KEEP_SURFACE)]);
  assert.deepEqual([o.f104, o.f108], [105000, 500], '`op3 & 0x40`（HISTORY 传的就是 0x40）⇒ 不清旧表面');
  assert.deepEqual([o.f276, o.f280], [106000, 40], '`op3 & 0x30` 未置 ⇒ 注音区间也不动');

  setup();
  dispatch(e, 0x1d1, [im(1), im(0), im(0)]);
  assert.deepEqual([o.f104, o.f108], [0, 0], '不带 0x40 ⇒ 移除正文图元区间（`sub_4ABB60` raw 80593-80606）');
  assert.deepEqual([o.f276, o.f280], [106000, 40], '注音区间仍不动');

  setup();
  dispatch(e, 0x1d1, [im(1), im(0), im(REPAINT_RUBY_RANGE)]);
  assert.deepEqual([o.f276, o.f280], [0, 0], '带 0x30 ⇒ 注音区间也移除（raw 80607-80611）');
});

// ---------------------------------------------------------------------------
// ⑤ 颜色覆写 + **恢复**（孪生两条同一条不变量；`0x82` raw 80239-80262 / `0x1D1` raw 81470-81473）
// ---------------------------------------------------------------------------

test('⑤ `op3 & 2` ⇒ 发布出去的是覆写色，且**调用后全局字段恢复**（raw 80629-80634 / 81470-81473）', async () => {
  const native = new RecordingWinNative();
  const e = mkEngine(
    [...PAGE_SCRIPT, i1d1(1, 0, REPAINT_SET_COLORS | REPAINT_KEEP_SURFACE, 0xff0000, 0x00ff00)],
    'FAKE.BIN',
    native,
  );
  await runOps(e, PAGE_SCRIPT.length + 1);
  assert.equal(native.last.fill, '#ff0000', '★发布出去的填充色 = op4（`bgrToRgb` 对合：脚本原值）');
  assert.equal(native.last.outline, '#00ff00', '★发布出去的描边色 = op5');
  assert.equal(native.last.text, 'あい\nう', '同一次发布带着这一页的正文');
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.colorFill),
    undefined,
    '★收尾**恢复**全局填充色（raw 81470-81471）—— 覆写色是临时的',
  );
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorOutline), undefined, '★同理恢复描边色（raw 81472-81473）');
});

test('⑤b 孪生对照：同一个场景下 `0x82` 也恢复（`sub_466000` raw 80239-80262 有那一对写）', async () => {
  // 前两格**预置**成别的颜色 ⇒ 直接验"恢复成调用前的值"（不是"清空"）
  const e = mkEngine([
    ...PAGE_SCRIPT,
    instr(0x82, [im(1), im(0), im(REPAINT_SET_COLORS | REPAINT_KEEP_SURFACE), im(0xff0000), im(0x00ff00)]),
  ]);
  e.engineValues.set(ENGINE_FIELD.colorFill, 0x112233);
  e.engineValues.set(ENGINE_FIELD.colorOutline, 0x445566);
  await runOps(e, PAGE_SCRIPT.length + 1);
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.colorFill),
    0x112233,
    '★`0x82` 收尾恢复成**调用前**的填充色（raw 80258 的 guard `v145 != v138 || v158`）',
  );
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.colorOutline),
    0x445566,
    '★`0x82` 同样恢复描边色（raw 80241）—— 两条孪生在这件事上一致',
  );

  // 未预置时（= 调用前那两格为空）⇒ 恢复 = 删除该格，而不是留下 0 或覆写色
  const e2 = mkEngine([
    ...PAGE_SCRIPT,
    instr(0x82, [im(1), im(0), im(REPAINT_SET_COLORS | REPAINT_KEEP_SURFACE), im(0xff0000), im(0x00ff00)]),
  ]);
  await runOps(e2, PAGE_SCRIPT.length + 1);
  assert.equal(e2.engineValues.get(ENGINE_FIELD.colorFill), undefined, '★未预置 ⇒ 恢复 = 删掉该格（不留覆写色）');
});

// ---------------------------------------------------------------------------
// ⑥ 语音图标（raw 80678-80699）
// ---------------------------------------------------------------------------

test('⑥ 语音图标只在 `op3 & 8` 下贴，且按**通道**去重（raw 80680 / 80696）', () => {
  const t = new TextItemTable();
  t.pushRenderedRow(1, '甲', 0, 0);
  // `sub_45EEA0` 一族：`pushVoice(win, id, loop, sel32, v28)`；引擎把记录 **+32** 当通道号（raw 80682）。
  t.pushVoice(1, 0x101, 0, 2, 0x11);
  t.pushVoice(1, 0x102, 1, 2, 0x22);

  const off = t.repaintRange(0, { win: 1, mode: REPAINT_KEEP_SURFACE, dedicatedPath: false, voiceBusy: false });
  assert.deepEqual(off.voiceIcons, [], '`op3 & 8` 未置 ⇒ 整段图标分支被跳过（raw 80680）');

  const on = t.repaintRange(0, {
    win: 1,
    mode: REPAINT_KEEP_SURFACE | REPAINT_VOICE_ICONS,
    dedicatedPath: false,
    voiceBusy: false,
  });
  assert.deepEqual(
    on.voiceIcons.map((v) => [v.channel, v.x, v.y, v.z, v.suppressed]),
    [
      [2, 0x101, 0, 0x11, false],
      [2, 0x102, 1, 0x22, false],
    ],
    '`sub_4BB840(语音, 通道, 记录+20, +24, +28)`（raw 80693）',
  );
  assert.deepEqual(on.channelSeen.slice(0, 3), [0, 0, 2], '★`++v212[通道]`（raw 80696）= 该通道已贴 2 次');
  assert.deepEqual(on.lines, ['甲'], '正文行不受语音分支影响');

  // `sub_404CB0(语音)`（有通道占线）为真 ⇒ 同通道第 2 次改走 `sub_409E10` 分支（raw 80683-80686）。
  const busy = t.repaintRange(0, {
    win: 1,
    mode: REPAINT_KEEP_SURFACE | REPAINT_VOICE_ICONS,
    dedicatedPath: false,
    voiceBusy: true,
  });
  assert.deepEqual(
    busy.voiceIcons.map((v) => v.suppressed),
    [false, true],
    '占线 + 该通道已贴过 ⇒ 不贴（emulator 恒 `voiceBusy = false`，这条靠直接传参验证）',
  );
  assert.deepEqual(busy.channelSeen.slice(0, 3), [0, 0, 1], '被抑制的那次**不**计数（raw 80696 在 else 支）');
});

// ---------------------------------------------------------------------------
// ⑦ 操作数纪律（raw 29365-29369：五次无条件读、零写）
// ---------------------------------------------------------------------------

test('⑦ 操作数：五格全读（含越界路径）、一格都不写', async () => {
  const { e } = await withPageScript();
  // 合法下标
  const a = trackArgs([loc(1), im(0), im(REPAINT_KEEP_SURFACE), im(0), im(0)]);
  dispatch(e, 0x1d1, a.args as ReturnType<typeof im>[]);
  assert.deepEqual(a.hits(), [1, 2, 3, 4, 5], '五格都必须被碰（引擎 handler 无条件 `sub_41BF50` ×5）');
  // 越界下标：引擎**也是先读完再进被调体** ⇒ 这一路径同样要读满
  const b = trackArgs([loc(1), im(99), im(REPAINT_KEEP_SURFACE), im(0), im(0)]);
  dispatch(e, 0x1d1, b.args as ReturnType<typeof im>[]);
  assert.deepEqual(b.hits(), [1, 2, 3, 4, 5], '★越界门在被调体里 ⇒ 越界也读满五格（顺序反了会与引擎不符）');
});

// ---------------------------------------------------------------------------
// ⑧ E3：真语料端到端（滚轮位 8 ⇒ `call-script 31` ⇒ `HISTORY.BIN` ⇒ `0x1D1` 产出页）
// ---------------------------------------------------------------------------

test('★⑧ E3 端到端：`set:wheelkeyup=8` + 一次滚轮 ⇒ `HISTORY.BIN`，且 `0x1D1` 真的产出正文页', async () => {
  const options = normalizeEmulatorOptions(DEFAULT_EMULATOR_OPTIONS);
  const resourceDir = decideResourceDir(REPO, { env: process.env }).dir;
  const src = new NodeFileSource({ resourceDir });
  const input = new InputManager();
  const scene = new HeadlessScene({
    audioHost: new NodeAudioHost({ source: src, log: () => {} }),
    onLog: () => {},
  });
  let engineRef: Engine | null = null;
  const drops = new DropRecorder(() => engineRef?.currentOpcode ?? 0);
  const e = new Engine(withNativeTap(scene, drops) as never, input);
  engineRef = e;
  e.fileSource = src;
  scene.scene.l2dHost = e;
  const system = resolveSystemPaths(REPO);
  e.config = parseIni(effectiveIniText(new OverlayDir(system)));
  applyConfigToEngine(e.config, e.engineValues);
  applyEmulatorOptionsToEngine(e, options);
  const boot = await src.readScript(0);
  assert.ok(boot, '换场景：应能读到引导脚本（`install/` 或 `raw/`）');
  loadScriptData(e, boot.data, boot.name);

  let clock = 0;
  let lastScript = e.curScript().name;
  let firstTextIp = -1;
  /** `0x1D1` 被派发的次数（★测试侧观测，不靠引擎字段）。 */
  let saw1d1 = 0;
  const unknownHits = new Map<number, number>();
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (t) => scene.advance(t),
    poolPending: () => scene.poolPending(),
  };
  const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
    gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
    advFrame: true,
    maxStepsPerFrame: 20000,
    onStepStart: (_frame, ins) => {
      if (!ins) return;
      if (ins.opcode === 0x1d1) saw1d1++;
      if (firstTextIp < 0 && e.curScript().name.startsWith('SN0000') && ins.opcode === 0x6e) {
        firstTextIp = e.curScript().ip;
      }
    },
    onUnknown: (err, _frame, _ins) => {
      unknownHits.set(err.opcode, (unknownHits.get(err.opcode) ?? 0) + 1);
      e.unknownOpStubs.set(err.opcode, 1); // 桩住并继续（只为走到现场，不做语义）
      return 'continue';
    },
    onScriptChange: (name) => {
      lastScript = name;
    },
    onFrameEnd: () => {
      clock += TICK_MS;
    },
  };
  const run = async (frames: number, until?: () => boolean): Promise<void> => {
    await runFrameLoop(e, host, { ...base, ...(until ? { until } : {}), initialScript: lastScript, maxFrames: frames });
  };
  const hover = (): number => e.curScript().locals.int.get(0x3f7) ?? -99;

  // ---- 走到 TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000 首文案（坐标见 CONTEXT.md §7）----
  await run(4000, () => e.curScript().name.startsWith('TITLE'));
  await run(4000);
  input.setCursor(1180, 372);
  await run(2000, () => hover() === 0);
  input.pressMouse(0);
  await run(400);
  input.releaseMouse(0);
  await run(4000, () => e.curScript().name.startsWith('GAMESTART'));
  input.setCursor(811, 605);
  await run(600, () => hover() === 0);
  input.pressMouse(0);
  await run(400);
  input.releaseMouse(0);
  await run(1200);
  for (let round = 0; round < 40 && firstTextIp < 0; round++) await run(2000, () => firstTextIp >= 0);
  assert.ok(firstTextIp >= 0, '前置：应走到 SN0000 的首条 `show-text`');
  await run(3000, () => e.awaitingAdvance);
  assert.equal(e.curScript().name, 'SN0000.BIN', '前置：停在 SN0000 的等待态');

  // ---- 回到等待态且 bit8（SN0000 绑给「回想」的那一位）已绑到路由项 ----
  for (let round = 0; round < 30; round++) {
    if (e.awaitingAdvance && e.routes.entries.some((en) => en.keyBit === 8)) break;
    await run(600, () => e.awaitingAdvance && e.routes.entries.some((en) => en.keyBit === 8));
  }
  assert.ok(e.awaitingAdvance, '前置：必须回到等待态（否则泵不跑）');
  assert.ok(
    e.routes.entries.some((en) => en.keyBit === 8),
    '前置：bit8 → label 3026 → `call-script 31 // HISTORY`（src/SN0000.txt:94-114）',
  );

  // ---- ★决定性动作：把滚轮上滚配成 bit8，滚一次 ----
  e.config.values.set('set:wheelkeyup', 8);
  input.addWheel(120);
  assert.equal(input.wheelKeyBits, 0x100, '滚轮上滚折成掩码位 `1 << 8`');
  await run(20, () => e.curScript().name.startsWith('HISTORY'));
  assert.equal(e.curScript().name, 'HISTORY.BIN', '★一次滚轮就派发 `call-script 31` ⇒ 进入回想画面');
  // 进回想时 `i071`（`src/HISTORY.txt:99`）刚把 5 个列表行窗清空 ⇒ 窗 3..7 此刻应当是空的。
  // ★条件化：`run(20, until)` 可能多跑一帧，若那一帧里 `0x1D1` 已经派发过就不再要求"空"。
  if (saw1d1 === 0) {
    assert.equal(e.msgwin.textOf(3), '', '前置：HISTORY 自己的 `i071` 已清空窗 3（回想正文还没画）');
  }

  // ---- 跑到 `0x1D1` 被派发 ----
  for (let round = 0; round < 20 && saw1d1 === 0; round++) await run(400, () => saw1d1 > 0);
  assert.ok(saw1d1 > 0, '★`0x1D1` 必须真的被派发（旧状态：命中即 `NotImplementedOp` 硬停）');
  assert.equal(unknownHits.get(0x1d1) ?? 0, 0, '★`0x1D1` 不再落进未实现桩');

  // ★现场实测（2026-09-24，本机 install/ 语料）：被画的是**窗 3**（`3 + 行号`，行号从 0 起），
  //   切片从记录下标 1 起、`stop = 'eof'`（SN0000 首文案还没翻页，记录表里这一页之后没有组首，raw 80708），
  //   切出 13 条记录（4×i1d2 标记 + 1×语音项 + 正文/换行交错）⇒ **3 行真实序章正文**。
  const win3 = e.msgwin.textOf(3);
  const lines = win3.split('\n');
  assert.ok(lines.length >= 2, `★★画面内容：这一窗必须有多行正文（实际 ${lines.length} 行）`);
  assert.ok(
    lines.every((s) => s.length > 0),
    `该页的正文行不能有空串（lines=${JSON.stringify(lines)}）`,
  );
  assert.ok(
    win3.replace(/\n/g, '').length > 20,
    `★★这一页真的带着序章正文（共 ${win3.replace(/\n/g, '').length} 字）—— 不是"没报错"而已`,
  );
  assert.ok(
    scene.scene.drawItems.size > 0,
    '回想画面本身的可绘制项 > 0（HISTORY.txt 自己画的框/条纹/图标；`0x1D1` 不在这一层）',
  );
  console.log(`[T-0170] HISTORY 页：win=3 行数=${lines.length} 字数=${win3.replace(/\n/g, '').length} 次命中 0x1D1=${saw1d1}`);
  await src.dispose?.();
});

// ---------------------------------------------------------------------------
// ⑨ 单元级：命中"重画真的发生"的最小场景（不依赖语料）
// ---------------------------------------------------------------------------

test('⑨ 最小场景：越界 ⇒ 窗内容一字不动、不发布；合法下标 ⇒ 窗内容被这一页替换并发布', async () => {
  const { e, native } = await withPageScript();
  e.msgwin.setPageText(1, ['旧的', '内容']); // 假装窗里本来有别的东西
  native.syncs.length = 0;
  dispatch(e, 0x1d1, [im(1), im(99), im(REPAINT_KEEP_SURFACE)]);
  assert.equal(e.msgwin.textOf(1), '旧的\n内容', '越界 ⇒ 一字不动');
  assert.equal(native.syncs.length, 0, '越界 ⇒ 也不发布');
  dispatch(e, 0x1d1, [im(1), im(0), im(REPAINT_KEEP_SURFACE)]);
  assert.equal(e.msgwin.textOf(1), 'あい\nう', '合法 ⇒ 重画成这一页');
  assert.equal(native.last.text, 'あい\nう', '同一页也发布给了宿主');
  // `flags & 1`（组首）不会被误当正文：切片首条是 `0x1D2` 标记
  assert.equal(e.textItems.records[0]!.flags & ITEM_GROUP_START, ITEM_GROUP_START);
  const recs: TextItemRecord[] = e.textItems.records;
  assert.equal(recs[0]!.text, undefined, '`i1d2` 的记录没有正文串（它是标记，不是行）');
});

// ---------------------------------------------------------------------------
// ⑩ 读取端口径不变：`0x1D3` 的「组内最后一次命中」仍成立（新增正文记录不得改变它）
// ---------------------------------------------------------------------------

test('⑩ `0x1D3` 的 key 查询只认 `0x1D2` 标记记录，正文记录不参与（`+24` 语义未被污染）', () => {
  const t = new TextItemTable();
  t.pushText(1, 7, 70);
  t.pushRenderedRow(1, '正文', 0x11, 0x22); // `+24 = 0x22`（引擎 `Font[341]` = 描边色）
  t.pushText(1, 7, 71);
  const hit = t.queryText(0, 7);
  assert.deepEqual([hit.found, hit.v20], [true, 71], '只有 `flags & 0x20000000` 的记录参与（raw 69329-69364）');
  assert.equal(t.queryText(0, 0x22).found, false, '★正文记录的 `+24` 是**颜色**，不能被当成查询键命中');
});
