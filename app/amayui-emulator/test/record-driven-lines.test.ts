/** @tier T1 @kind core @subsystem text */

/**
 * **「记录切片行」与「模型显示行」的常驻对照 + 页起点不变量**（`tickets/T-0179`：`P0` 波 I 落地、
 * 第 ③ 节波 K 加、第 ②④ 节波 M 加）。
 *
 * ## 这条守卫守什么（红了怎么办）
 * 「记录驱动重画」（`0x82`/`0x1D1` 照 `Font+3364` 的 72 B 记录表重画一窗正文）能不能落地，
 * 先取决于三件事：**① 记录表里的行结构是不是与排版出来的显示行一致**（第 ①② 节）；
 * **② 回看页表里的"页起点"是不是仍等于该页首条正文记录的下标**（第 ③ 节 —— 波 K 加的，
 * 它是 P1「改记录粒度」的前置不变量：粒度一动，两张并列的表就可能错位，而错位是**静默错页**）；
 * **③ 入队时刻的窗几何有没有被钉住**（第 ④ 节 —— 波 M 加的，P1a 的落点）。
 *
 * 红了有五种含义，按顺序读：
 *  1. **`i06e` 驱动的合成用例**（第 ① 节）：一段 60 字溢出正文，排版 3 行 ⇒ 记录表必须是
 *     **3 条正文 + 2 条换行记录**、且切片逐字等于模型。波 M（P1c）之前它的口径是"记录 1 条行 +
 *     0 条换行"（当时那个自动换行 push 点没有生产者），落地后改成现在的**验收口径** ——
 *     两侧行序列必须完全一致。
 *  2. **段→行边界的纯函数口径**（第 ② 节）：`rowFeedBoundaries` 只在**段内部**的相邻显示行之间
 *     给断点（段末之后不算：那是 `end-text-line` 的收尾）；同一节还有"入队点按边界拆记录"的记录序用例。
 *  3. **显式断行的合成用例**：`i06f`（`pushLineFeed`）与 `lineEnded` 段在两侧必须逐字一致 ——
 *     这条是**恒真型**（不依赖语料），用来证明第 1 例的对照方法本身没坏。
 *  4. **入队时刻的窗几何**（第 ④ 节，波 M 的 P1a）：`i06e` 之后 `i070` 改窗宽 ⇒ 该页记录的切片行
 *     与发布载荷都**不变**（+ 一条"没有快照的窗回退实时几何"的反例）。
 *  5. **真语料 24 样本棘轮**：`SN0000→SC0000` 序章连续推进 24 条消息，逐条比上面两侧。
 *     波 G/波 I/波 K/波 M **四次独立实测都是 23/24 逐字相同**（唯一不同的一例见下），
 *     `ITEM_REFLOW` 位合计 **0**。断言口径是**棘轮**：相同数**不得低于** 23、`reflow` 位必须**恒 0**、
 *     且差异必须仍只有那 1 例已知形态（**模型 1 行空串 / 记录 ≥ 2 行非空** = 切窗后页起点仍指旧窗的记录）。
 *     出现第二种差异形态 ⇒ 新缺口，先登记再决定，别直接放宽这里的数字。
 *     同一循环里还跑第 ③ 节的不变量（真语料实测 **0 违规**，见下）。
 *     页起点不变量（第 ③ 节，波 K）：`TextItemTable.pageIndexGaps()` 必须零违规。
 *     ★判据**不是**"页起点上的记录属于本窗" —— 记录表全窗共用、而 `0x70` 改窗几何时也会 push 页
 *     （真语料 51 条页里 27 条相邻同 `start`、27 条空页，页起点上常坐着别的窗的记录）。
 *     正确口径是**按窗 + 按页区间**：页 `i` 的 `start` 到下一页 `start` 之间，属于本窗的第一条记录
 *     必须恰好落在 `start` 上、且带 `ITEM_GROUP_START`（push 页后紧接着置的组首位，raw 74275/73187）。
 *
 * ## 已知的那 1 例（唯一语料的差异形态）
 * `推进12`：页起点 `start=113` 仍指旧窗（win 8）的记录，目标窗已切到 win 1 且模型侧为空
 * ⇒ 模型 `[""]`、记录 `["這个故事，…来到此", "地的那一刻。"]`。引擎两条重画循环**都不看**记录 `+0`
 * （raw 79695-79700 / 80668-80680）⇒ 这是引擎行为，不是 emulator 的记录缺陷。
 * 记录切片**按窗过滤**也只能得到 0 行（该窗在这段区间里没有自己的记录）⇒ 两条口径的相同数都是 23/24。
 *
 * ## 用法
 * ```
 * cd app/amayui-emulator && node --import tsx test/run.ts fast   # 本文件在 T0 之外，随 T1 跑
 * ```
 * 只读探针（同口径、可打表）：`.tmp/settle/probe-I-record-lines.mjs`、
 * `.tmp/settle/probe-K-page-start.mjs`（页起点不变量的真语料数字）、
 * `.tmp/settle/probe-M-record-rows.mjs`（波 M：段→行直方图 + 切片相同的真语料数字）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { NodeAudioHost } from '../src/audio/nodeAudioHost.js';
import { OverlayDir } from '../src/arch/overlay.js';
import { decideResourceDir } from '../src/arch/resourceDir.js';
import { effectiveIniText, resolveSystemPaths } from '../src/arch/systemPaths.js';
import { DEFAULT_EMULATOR_OPTIONS, applyEmulatorOptionsToEngine, normalizeEmulatorOptions } from '../src/emulatorOptions.js';
import { applyConfigToEngine, parseIni } from '../src/engineConfig.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { rowFeedBoundaries, defaultWinStyle, layoutWindow } from '../src/text/layout.js';
import { Engine, Frame } from '../src/vm/engine.js';
import { styleOfWin } from '../src/vm/handlers/msgwin.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { readIntOperand } from '../src/vm/operand.js';
import { defaultWinGeom } from '../src/vm/msgwin.js';
import { StubNative } from '../src/vm/native.js';
import { DropRecorder, withNativeTap } from '../src/vm/nativeTap.js';
import { OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import {
  ITEM_GROUP_START,
  ITEM_REFLOW,
  ITEM_ROW_LINE,
  ITEM_ROW_TEXT,
  REPAINT_KEEP_SURFACE,
  REPAINT_SET_COLORS,
  TextItemTable,
} from '../src/vm/textItems.js';
import { at, im, instr, mkEngine, scriptDerived, str } from './harness.js';

/** 仓库根（`app/amayui-emulator/test/` 上溯三层）—— 与其它真资产档同一口径。 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TICK_MS = 1000 / 60;

/** 记录侧**按窗过滤**后拼行（只把 `+0 == 目标窗` 的 `flags&8` 当行边界）。 */
function filteredLines(t: TextItemTable, win: number, start: number, end: number): string[] {
  const out: string[] = [];
  let line = '';
  let open = false;
  for (let i = start; i < end; i++) {
    const r = t.records[i];
    if (!r || r.win !== win) continue;
    if ((r.flags & ITEM_ROW_LINE) !== 0) {
      if (open) out.push(line);
      line = '';
      open = false;
    } else if ((r.flags & ITEM_ROW_TEXT) !== 0) {
      line += r.text ?? '';
      open = true;
    }
  }
  if (open) out.push(line);
  return out;
}

/** 模型侧的显示行（= 屏上真正看到的那些字）。 */
function modelLinesOf(t: TextItemTable, win: number, style: ReturnType<typeof defaultWinStyle>, segments: readonly { text: string; ruby: [string, string][]; lineEnded: boolean }[]): string[] {
  return layoutWindow(win, { style, segments }).lines.map((l) => l.glyphs.map((g) => g.ch).join(''));
}

/** 记录侧的一整行（连续 `flags&4` 拼成一行）；`count` = 拼成它的正文记录条数。 */
interface RecLine {
  text: string;
  count: number;
}

/** 记录侧按 `TextItemTable.records` 的表内顺序拼行（与 `repaintRange` 同口径，额外带回每行的记录条数）。 */
function recLines(t: TextItemTable, win: number): RecLine[] {
  const out: RecLine[] = [];
  let text = '';
  let count = 0;
  let open = false;
  for (const r of t.records) {
    if (r.win !== win) continue;
    if ((r.flags & ITEM_ROW_LINE) !== 0) {
      if (open) out.push({ text, count });
      text = '';
      count = 0;
      open = false;
    } else if ((r.flags & ITEM_ROW_TEXT) !== 0) {
      text += r.text ?? '';
      count += 1;
      open = true;
    }
  }
  if (open) out.push({ text, count });
  return out;
}

/** 合成引擎（真 `OPS` 表 + HeadlessScene 宿主）—— 让本文件能驱动**入队点**而不是手工构造记录。 */
function synthEngine(): { e: Engine; scene: HeadlessScene } {
  const scene = new HeadlessScene();
  const e = new Engine(scene);
  loadScriptIntoFrame(e.curScript(), {
    ...scriptDerived(),
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions: [],
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  }, 'FAKE.BIN');
  return { e, scene };
}

/** 跑一条指令（走真 `OPS` 表 ⇒ 与产品路径同一条 handler）。 */
function stepOp(e: Engine, op: number, args: ReturnType<typeof im>[]): void {
  const h = OPS.get(op);
  assert.ok(h, `0x${op.toString(16)} 应在 OPS 里（真实现）`);
  h!(makeCtx(e, new Frame(), instr(op, args), e.native, () => {}));
}

// ---------------------------------------------------------------------------
// ① 合成：**自动换行**的记录生产者（引擎 raw 83094 / 82667）
// ---------------------------------------------------------------------------

test('★P1c 红→绿：一次 `i06e`（60 字溢出排成 3 行）⇒ 记录表 **3 行 + 2 条换行记录**，且切片逐字等于模型', () => {
  const e = synthEngine().e;
  stepOp(e, 0x6e, [im(1), str('あ'.repeat(60))]);

  const t = e.textItems;
  const model = layoutWindow(1, { style: styleOfWin(e, 1), segments: e.msgwin.slot(1).segments });
  const rec = t.repaintRange(0, { win: 1, mode: 0x2, dedicatedPath: false, voiceBusy: false });
  const feeds = t.records.filter((r) => (r.flags & ITEM_ROW_LINE) !== 0).length;
  const rows = recLines(t, 1);

  assert.deepEqual(
    model.lines.map((l) => l.text.length),
    [26, 26, 8],
    '前置：排版把 60 字切成 3 行（窗口宽 800 / 字号 30 ⇒ 每行 26 个全角字）',
  );
  assert.equal(
    t.records.length,
    5,
    '★记录表 = 3 条正文 + 2 条**排版断点**换行记录（`sub_46AF90` 的 push，raw 82726-83095）',
  );
  assert.equal(rec.lines.length, 3, '★记录切片 = 3 行（与排版行数一致，不再是 1 行）');
  assert.equal(feeds, 2, '★换行记录 = 2 条（= 显示行数 − 1；引擎每条自动换行 push 一条，raw 83094）');
  assert.deepEqual(
    rows.map((r) => r.count),
    [1, 1, 1],
    '★3 行 = 3 条正文记录（每条显示行各一条，`sub_45F090` 的逐行记账）⇒ 一条 `i06e` 不再只记一条',
  );
  assert.deepEqual(
    t.records.map((r) => (r.text ?? '').length),
    [26, 0, 26, 0, 8],
    '★每行的正文 = 排版那一行的字（26/26/8），夹着两条空串换行记录',
  );
  assert.deepEqual(
    rec.lines,
    model.lines.map((l) => l.text),
    '★记录切片行必须**逐字等于**模型显示行（这就是 P1c 的验收口径）',
  );
  assert.deepEqual(
    modelLinesOf(t, 1, styleOfWin(e, 1), e.msgwin.slot(1).segments),
    rec.lines,
    '★同一条对照走 `modelLinesOf` 也成立（字形串 == 记录切片行）',
  );
});

test('★P0：合成对照 —— 显式断行（`i06f`）时两侧行序列**逐字一致**（证明上一条的差异不是对照方法坏了）', () => {
  const st = defaultWinStyle();
  const segA = 'い'.repeat(20);
  const segB = 'う'.repeat(20);
  const t = new TextItemTable();
  t.pushRenderedRow(1, segA, 0, 0);
  t.pushLineFeed(1); // = `i06f end-text-line`
  t.pushRenderedRow(1, segB, 0, 0);

  const model = modelLinesOf(t, 1, st, [
    { text: segA, ruby: [], lineEnded: true },
    { text: segB, ruby: [], lineEnded: false },
  ]);
  const rec = t.repaintRange(0, { win: 1, mode: 0x2, dedicatedPath: false, voiceBusy: false });

  assert.deepEqual(model, [segA, segB], '前置：两段各占一行（都在窗口内，不触发自动换行）');
  assert.deepEqual(rec.lines, model, '★显式断行之路两侧必须逐字一致（这条不依赖语料 ⇒ 恒真对照）');
});

// ---------------------------------------------------------------------------
// ② ★P1b/P1c：**段 → 行边界**（`TextFrame.rows` / `rowFeedBoundaries`）与入队点的记录分解
// ---------------------------------------------------------------------------

/**
 * P1b 的验收（提示词原文口径）：**两段各溢出一次 ⇒ 段 1 的断点数 = 其显示行数 − 1**。
 *
 * 四段的构造让"空段"与"有段"交替（这是 `TextFrame.rows` 最容易错的一格）：
 * 段 0 只有 1 行且有 `end-text-line`；段 1 = 6 字（1 行，**0 断点**）；
 * 段 2 = 52 字（26 宽 ⇒ **2 行**，其第 1 行后各一个断点）；
 * 段 3 = 1 字。⇒ 断点必须恰好是段 2 的那一个，而不是段边界（段边界由 `0x6f` 自己负责）。
 */
test('★P1b：`rowFeedBoundaries` 只在**段内部**的相邻显示行之间给断点（段末之后不算）', () => {
  const st = defaultWinStyle();
  const segs = [
    { text: 'あ', ruby: [] as [string, string][], lineEnded: true },
    { text: 'い'.repeat(6), ruby: [] as [string, string][], lineEnded: true },
    { text: 'う'.repeat(52), ruby: [] as [string, string][], lineEnded: true },
    { text: 'え', ruby: [] as [string, string][], lineEnded: false },
  ];
  const frame = layoutWindow(1, { style: st, segments: segs });

  assert.equal(frame.rows.length, frame.lines.length, '★`rows` 必须与 `lines` 逐项对齐（长度相等）');
  assert.deepEqual(
    frame.rows.map((r) => `${r.segment}.${r.line}`),
    ['0.0', '1.0', '2.0', '2.1', '3.0'],
    '★段→行来源：段 2 排成 2 行（行号 0/1），其余段各 1 行',
  );
  assert.deepEqual(
    frame.lines.map((l) => l.text.length),
    [1, 6, 26, 26, 1],
    '前置：段 2（52 字）在 800 宽/字号 30 下排成 2 行',
  );
  assert.deepEqual(
    rowFeedBoundaries(frame.rows),
    [2],
    '★断点 = [2]：段 1 溢出 1 次 ⇒ 断点数 = 其显示行数(1) − 1 = **0**（提示词口径），段 2 溢出 1 次 ⇒ 1 个断点',
  );
  assert.deepEqual(rowFeedBoundaries([]), [], '空帧没有任何断点');
  assert.deepEqual(
    rowFeedBoundaries([{ segment: 0, line: 0 }]),
    [],
    '单行帧没有断点（段末之后不算 ⇒ 不产生"行尾换行"）',
  );
});

test('★P1c：入队点按边界拆记录 —— 段内 1 个断点 ⇒ 记录侧 4 条正文 + 1 条换行（段边界由 `i06f` 自己推）', () => {
  const e = synthEngine().e;
  // 每次都 `i06f` 收尾（同一行上的连续 `show-text` 会被 `appendText` 拼成**一段** ⇒
  // 那样就没有"段"可言，见 `MsgWindow.appendText`）。
  stepOp(e, 0x6e, [im(1), str('あ')]);
  stepOp(e, 0x6f, [im(1)]);
  stepOp(e, 0x6e, [im(1), str('い'.repeat(6))]);
  stepOp(e, 0x6f, [im(1)]);
  stepOp(e, 0x6e, [im(1), str('う'.repeat(52))]);
  stepOp(e, 0x6f, [im(1)]); // 段 2 的收尾（段内断点已由排版记录，收尾笔与它同边界 ⇒ 只留一条）
  stepOp(e, 0x6e, [im(1), str('え')]);

  const t = e.textItems;
  const flags = t.records.map((r) => ((r.flags & ITEM_ROW_LINE) !== 0 ? 'F' : 'T'));
  const texts = t.records.map((r) => (r.text ?? '').length);
  const rec = t.repaintRange(0, { win: 1, mode: 0x2, dedicatedPath: false, voiceBusy: false });

  assert.deepEqual(
    flags,
    ['T', 'F', 'T', 'F', 'T', 'F', 'T', 'F', 'T'],
    '★记录顺序 = 5 条正文 + 4 条换行：段 2 的**段内**断点夹在它的两行之间（其余三处是 `i06f` 的段边界）',
  );
  assert.deepEqual(
    texts,
    [1, 0, 6, 0, 26, 0, 26, 0, 1],
    '★正文记录 = 排版行逐个记（1 / 6 / 26 / 26 / 1 字），换行记录是空串（`unk_51F030`）',
  );
  assert.deepEqual(
    rec.lines,
    layoutWindow(1, { style: styleOfWin(e, 1), segments: e.msgwin.slot(1).segments }).lines.map((l) => l.text),
    '★记录切片行逐字等于模型显示行',
  );
  assert.deepEqual(
    rec.lines.map((s) => s.length),
    [1, 6, 26, 26, 1],
    '★5 行：段 2 的两行被排版断点分开，段边界由 `i06f` 分开 —— 一条边界都不多、一条都不少',
  );
});

// ---------------------------------------------------------------------------
// ④ ★P1a：**入队时刻的窗几何**（`FontStyleSnapshot.geometry`）—— 之后改几何不重排已入队的行
// ---------------------------------------------------------------------------

/**
 * P1a 的验收（提示词原文口径）：「`i06e` → `i070`（改几何）后该页切片行不变」。
 *
 * 引擎侧依据：断行发生在**入队那一刻**（`sub_46BE30` 的逐字循环，raw 83596-83718），
 * 而 `0x70` 的落点 `sub_45D660`（raw 73132-73193）只写几何字段与回看页，
 * **一行排版调用都没有** ⇒ 改几何不会回头重排已经排好的行。
 */
test('★P1a：`i06e` → `i070`（窗宽 800→400）⇒ 该页记录的切片行不变、发布载荷仍用入队时的几何', () => {
  const e = synthEngine().e;
  stepOp(e, 0x6e, [im(1), str('あ'.repeat(60))]); // 入队：800 宽 ⇒ 3 行 + 2 条断点
  const before = e.textItems.records.map((r) => `${r.flags}:${r.text ?? ''}`);

  stepOp(e, 0x70, [im(1), im(400), im(720), im(0), im(0)]); // 改几何（窗宽 400 ⇒ 每行 13 字）

  assert.deepEqual(
    e.textItems.records.map((r) => `${r.flags}:${r.text ?? ''}`),
    before,
    '★记录表一格不动（改几何不重排、也不追加记录 —— 引擎 `sub_45D660` 体里没有排版调用）',
  );
  const rec = e.textItems.repaintRange(0, { win: 1, mode: 0x2, dedicatedPath: false, voiceBusy: false });
  assert.deepEqual(
    rec.lines.map((s) => s.length),
    [26, 26, 8],
    '★该页切片行不变：仍是入队时那 3 行（若取实时几何会变成 13/13/… 的 5 行）',
  );
  assert.equal(
    e.msgwin.slot(1).fontStyle?.geometry.wrapRight,
    800,
    '★入队时刻的几何（`wrapRight = 800`）已钉进 `FontStyleSnapshot.geometry`',
  );
  assert.equal(e.msgwin.geom(1).wrapRight, 400, '★窗字段本身照 `0x70` 改成了 400（快照与实时是两件事）');
  assert.equal(
    styleOfWin(e, 1).wrapRight,
    800,
    '★发布载荷（`styleOfWin`）用的是**入队快照**的几何 ⇒ 画面不会重排',
  );
  assert.deepEqual(
    layoutWindow(1, { style: styleOfWin(e, 1), segments: e.msgwin.slot(1).segments }).lines.map((l) => l.text.length),
    [26, 26, 8],
    '★重排一次也仍是 3 行（这就是"该页切片行不变"的机制）',
  );
});

test('★P1a 反例：没有入队快照的窗（还没入过文本）⇒ 回退到**实时**几何（`0x70` 立刻生效）', () => {
  const e = synthEngine().e;
  stepOp(e, 0x70, [im(2), im(400), im(720), im(0), im(0)]);
  assert.equal(e.msgwin.slot(2).fontStyle, null, '前置：这个窗还没有文本 ⇒ 没有快照');
  assert.equal(styleOfWin(e, 2).wrapRight, 400, '★没有快照时按实时几何（那一刻还没有"已排好的行"可言）');
  assert.deepEqual(defaultWinGeom().wrapRight, 800, '对照：`defaultWinGeom` 的初值仍是 800');
});

// ---------------------------------------------------------------------------
// ⑤ ★P2：**幂等** —— 同一页发布 3 次 ⇒ 记录条数不变（`MsgSegment.recordedChars` 增量游标）
// ---------------------------------------------------------------------------

/**
 * **P2 的判据（提示词原文）**：同一页发布 3 次 ⇒ 记录条数不变。
 *
 * 引擎由来：记录只在 **入队那一刻** 写（`sub_46BE30` → `sub_4691A0` → `sub_45F090`，
 * raw 83363-83995），发布（绘制/贴出）**不写记录表** ⇒ 同一页重画多少次，记录表都不该动。
 * 重写侧的锚点 = ① 入队时刻的窗几何快照（P1a）+ ② `MsgSegment.recordedChars` 增量游标（P1c）：
 * 每次只记**本段还没记过的那一截**（跨在游标上的那一行只记尾巴）。
 *
 * ★**为什么这条守得住**（去掉游标/改成"水位式 ⇒ 每次发布都按已排版的行重记一遍" ⇒ 它必须红）：
 *   `recordRenderedRow` 有两条推记录的出口 —— ① 排版行（`laid.rows` 里属于本段的那几行）；
 *   ② **排出来的字比这一段少**时的兜底（`rowTexts` 为空 ⇒ `push(seg.text.slice(done))`，与修前同口径）。
 *   出口 ② 在**没有游标**时会无条件再 push 一次本段 ⇒ 同一页重复发布就**重复记账**
 *   （真语料上的症状就是回想页正文出现「『迪爾-利菲娜『迪爾-利菲娜』」这类重复片段）。
 *   本用例的 `wrapBottom = 10`（窗高 < 字号 ⇒ **一个字都排不下**）正是为了**不依赖语料**地走到出口 ②：
 *   `layoutWindow` 排出的显示行比这一段短 ⇒ 兜底把**整段**记进去（引擎那一步是真画出去了，
 *   只是本模型的排版提前停了 —— `TextFrame` 对越下边界是"停"，没有"滚出窗口还在屏上"这一层）。
 */
test('★P2：同一页发布 3 次 ⇒ **记录条数不变**（多行页与"排不下"的兜底出口都不许重记）', () => {
  const e = synthEngine().e;
  stepOp(e, 0x6e, [im(1), str('あ'.repeat(60))]); // 默认几何 ⇒ 3 行 + 2 条断点（第 ① 例的同一形状）

  const t = e.textItems;
  assert.deepEqual(
    t.records.map((r) => (r.flags & ITEM_ROW_LINE) !== 0 ? 'F' : (r.text ?? '').length),
    [26, 'F', 26, 'F', 8],
    '前置：多行页的记录结构（3 条正文 + 2 条排版断点）',
  );
  assert.equal(e.msgwin.slot(1).segments[0]!.recordedChars, 60, '前置：游标 = 本段已记账的前缀长度');

  const frozen = t.records.map((r) => `${r.flags}:${r.text ?? ''}`);
  // ★连发 3 次"同一页"（`0x82` / `0x1D1` 重画、`0x70` 改几何也会重发布）⇒ 记录表必须**一格不动**
  for (const op of [0x82, 0x1d1, 0x70, 0x82, 0x1d1] as const) {
    if (op === 0x82 || op === 0x1d1) stepOp(e, op, [im(1), im(0), im(0x40), im(0), im(0)]);
    else stepOp(e, op, [im(1), im(400), im(720), im(0), im(0)]); // `0x70` 只写几何 + 重发布
    assert.deepEqual(
      t.records.map((r) => `${r.flags}:${r.text ?? ''}`),
      frozen,
      `★重复发布（这一步 = \`0x${op.toString(16)}\`）不得改动记录表 —— 同一页发布 3 次 ⇒ 条数/内容一格不变`,
    );
  }
  // ★游标不在这条守卫的判据里：`0x1d1` 会 `setPageText` 换掉整组段（新段 = 新游标），
  //   而 `0x82`/`0x70` 连段都不碰。要钉的口径只有一条：**发布不往记录表里加/改任何东西**。
  //
  // `0x6F end-text-line` 是**入队侧**而不是发布侧 ⇒ 单独看：实测它在这里给"末行"补一条换行记录
  // （末行 8 字**没有溢出** ⇒ 排版侧那个断点生产者没被走到，`pushLayoutLineFeed` 看到的末条是正文
  // ⇒ 照体推一条）。★口径：这一条**不产生空行**（`repaintRange` 在表尾 `flushLine` 时 `lineOpen`
  // 已被这条换行清掉）⇒ 切片仍逐字等于模型。发布侧那 3 条断言才是本用例的主判据。
  stepOp(e, 0x6f, [im(1)]);
  assert.deepEqual(
    t.records.map((r) => `${r.flags}:${r.text ?? ''}`),
    [...frozen, '9:'],
    '★`0x6F` 是**入队**侧的动作：它只给末行补**一条**换行记录（`flags = 8 | 1`：这个窗还没 `0x71` 消耗过组首标记）',
  );
  assert.deepEqual(
    t.repaintRange(0, { win: 1, mode: 0x2, dedicatedPath: false, voiceBusy: false }).lines.map((s) => s.length),
    [26, 26, 8],
    '★多出来的那条换行**不产生空行**（切片仍是 3 行 26/26/8 = 模型）⇒ 它不破坏 P0 的对照',
  );

  // 判别力：同一段**继续变长**时，新的一截必须记进去 —— 否则"游标"就退化成了"只记一次"。
  // ★在**干净的窗**上验（下面另起一个引擎）：`0x1D1` 的 `setPageText` 会把这一窗的段整组换掉
  //   （那是它"记录驱动重画"的本职），在它之后再验"段级游标"就换了对象、失去判别力。
  const g = synthEngine().e;
  const gt = g.textItems;
  stepOp(g, 0x6e, [im(1), str('あ'.repeat(60))]);
  const grown = gt.records.length;
  stepOp(g, 0x6e, [im(1), str('い'.repeat(10))]); // 同一行上的第二段 ⇒ `appendText` 拼进**同一段**
  assert.equal(
    gt.records.length,
    grown + 1,
    '★段变长 ⇒ **只加一条**（不是把 3 行 60 字重记一遍）',
  );
  assert.equal(
    at(gt.records, gt.records.length - 1, '记录').text,
    'い'.repeat(10),
    '★新记录只带**新入队的那一截**（`done = 60` ⇒ 只记 `slice(60)`）',
  );

  // 换页（`0x71` 清窗）之后重新入队：游标是**段级**的 ⇒ 新段必须重新记（"窗级水位"会把这一条吞掉）
  stepOp(g, 0x71, [im(1)]);
  const before = gt.records.length;
  stepOp(g, 0x6e, [im(1), str('う'.repeat(10))]);
  assert.equal(gt.records.length, before + 1, '★换页重入队 ⇒ 新段必须记一条');
  assert.equal(at(gt.records, gt.records.length - 1, '记录').text, 'う'.repeat(10), '新段的正文如实入账');
});

/**
 * **P2 的第二条口径**：窗高小于字号（引擎「文字がウインドウ内に収まりません」那条早退，raw 83720-83728）
 * 时走的**兜底出口**（`rowTexts` 为空 ⇒ `push(seg.text.slice(done))`）同样受游标管。
 *
 * ★**如实记录这条出口的现状**（不是等价）：这种窗口下模型只排得出**第一行**（26 字），
 * 兜底记的是 `slice(26)` 那一截 —— 与"引擎仍把 60 字都画出去"**不同**，属越界早退这个
 * 登记近似的可见后果；本用例锁的是**它一样是增量的**（第二次入队只记 `slice(26)` 的 44 字，
 * 而不是把整段 70 字重记一遍）⇒ 重复发布会把它变成「26 + 70」这种错账。
 */
test('★P2 兜底出口：窗排不下时第二次入队只记**新的一截**（`slice(done)`），不重记整段', () => {
  const e = synthEngine().e;
  stepOp(e, 0x70, [im(1), im(800), im(10), im(0), im(0)]); // 窗高 10 < 字号 30
  stepOp(e, 0x6e, [im(1), str('あ'.repeat(60))]);
  const t = e.textItems;
  assert.deepEqual(
    t.records.map((r) => (r.text ?? '').length),
    [26],
    '前置：模型只排得出一行 ⇒ 兜底记了 `slice(26)`（登记近似，见上方说明）',
  );

  stepOp(e, 0x6e, [im(1), str('い'.repeat(10))]); // 同一段变长（60 → 70）
  assert.deepEqual(
    t.records.map((r) => (r.text ?? '').length),
    [26, 44],
    '★第二条只记 `slice(26)` 的 44 字（**不是**整段 70 字，也不是再一次 26）—— 游标在兜底出口一样生效',
  );
  assert.equal(
    e.msgwin.slot(1).segments[0]!.text.length,
    70,
    '对照：段本身确实变长了（70 字）⇒ 上面那条"只记 44"是**增量**而不是"少记了入队"',
  );

  // 重复发布不会让这张账再变（发布不记账）
  const frozen = t.records.map((r) => `${r.flags}:${r.text ?? ''}`);
  stepOp(e, 0x82, [im(1), im(0), im(0x40), im(0), im(0)]);
  stepOp(e, 0x1d1, [im(1), im(0), im(0x40), im(0), im(0)]);
  assert.deepEqual(t.records.map((r) => `${r.flags}:${r.text ?? ''}`), frozen, '★发布不改这张账（P2 的判据）');
});

// ---------------------------------------------------------------------------
// ⑥ ★P3：跨窗「**整体替换 vs 追加**」口径 —— 唯一语料点 `src/CONFIG.txt:269`
// ---------------------------------------------------------------------------

/**
 * **P3 的口径（写死，别再猜）**：`0x82`/`0x1D1` 的 `op3` **bit6（`0x40` = `REPAINT_KEEP_SURFACE`）
 * 就是"整体替换 vs 追加"的唯一开关**：
 *  - **不带 `0x40`** ⇒ 引擎先清旧表面、并移除该窗的正文图元区间（`win+104/+108`），再画这一页
 *    ⇒ 该窗从**这一页**重新开始（= **整体替换**，不是追加）；
 *  - **带 `0x40`** ⇒ 旧表面与图元区间都留着，只把这一页叠上去 ⇒ 屏上是"原内容 + 这一页"
 *    （= **追加**，孪生 `0x1D1` 的语料点 `src/HISTORY.txt:1314` 传的就是 `0x40`）。
 *
 * ★**本工程的唯一 `0x82` 语料点**：`src/CONFIG.txt:269`（= `install/CONFIG.BIN` 的第 **205** 条指令）
 * 的 `op3` = **2** —— **不带 `0x40`** ⇒ 照抄孪生（`0x40`）会把它做成"叠加"，而引擎是"先清空再重画"。
 * ⇒ 结论文档化在此，并由本节的（a）语料形状 +（b）handler 语义两条一起钉住。
 */
test('★P3（a）语料形状：`CONFIG.txt:269` 的 `i082` 是 `op3 = 2`（**不带** `0x40`）⇒ 整体替换', async () => {
  const resourceDir = decideResourceDir(REPO, { env: process.env }).dir;
  const src = new NodeFileSource({ resourceDir });
  const bin = await src.readByName('CONFIG.BIN');
  assert.ok(bin, '`install/CONFIG.BIN` 应可读（缺产物时先 `cd scripts && node translate.js assemble CONFIG`）');
  const e = new Engine(new StubNative(() => {}));
  loadScriptData(e, bin.data, bin.name);
  const frame = e.curScript();
  const script = frame.script;
  assert.ok(script, '前置：脚本已装载（`loadScriptData` 之后根帧必有 script）');
  const ins = script.instructions;
  const idx = ins.findIndex((x) => x.opcode === 0x82);
  assert.notEqual(idx, -1, '★`0x82` 在全语料只有这一处（`src/CONFIG.txt:269`）—— 找不到说明语料换了');
  assert.equal(idx, 205, '★`install/CONFIG.BIN` 的第 205 条 = `src/CONFIG.txt:269`（本文件钉的锚点）');
  const op3 = readIntOperand(e, frame, at(ins, idx, '指令'), 3);
  assert.equal(op3, 2, '★`op3 = 2`');
  assert.equal(
    op3 & REPAINT_KEEP_SURFACE,
    0,
    '★`op3` 的 bit6（`0x40`）**没置** ⇒ 引擎走"清旧表面 + 重画这一页" ⇒ **整体替换**（不是追加）',
  );
  assert.equal(
    (op3 & REPAINT_SET_COLORS) !== 0,
    true,
    '对照：它置的是 bit1（`0x2` = 覆写填充/描边色）—— 与 `0x40` 是两件事，别混',
  );
  await src.dispose?.();
});

test('★P3（b）handler 语义：不带 `0x40` ⇒ 移除旧图元区间（整体替换）；带 `0x40` ⇒ 留着（追加）', async () => {
  const script = [
    instr(0x80, [im(1)]),
    instr(0x71, [im(1)]),
    instr(0x1d2, [im(-1), im(0x11)]),
    instr(0x6e, [im(1), str('旧内容')]),
    instr(0x82, [im(1), im(0), im(0), im(0), im(0)]),
  ];
  const e = mkEngine(script, 'FAKE.BIN');
  for (let i = 0; i < script.length - 1; i++) await stepOnce(e);
  const o = e.msgwin.object(1);
  const setup = (): void => {
    o.f104 = 105000;
    o.f108 = 500;
    o.f132 = 7;
  };
  setup();
  await stepOnce(e); // `op3 = 0`（不带 0x40）
  assert.deepEqual([o.f104, o.f108], [0, 0], '★不带 `0x40` ⇒ 移除正文图元区间（raw 79634-79653 / 80593-80606）');
  assert.equal(e.msgwin.textOf(1), '旧内容', '整体替换 = 该窗以后只有这一页的画法，不是"叠一层"');

  // 带 0x40：图元区间保留（= 追加/叠加口径），发布起点随之后移（`win+104 + win+132`）
  const e2 = mkEngine(
    [...script.slice(0, -1), instr(0x82, [im(1), im(0), im(REPAINT_KEEP_SURFACE), im(0), im(0)])],
    'FAKE.BIN',
  );
  for (let i = 0; i < script.length - 1; i++) await stepOnce(e2);
  const o2 = e2.msgwin.object(1);
  o2.f104 = 105000;
  o2.f108 = 500;
  o2.f132 = 7;
  await stepOnce(e2);
  assert.deepEqual([o2.f104, o2.f108], [105000, 500], '★带 `0x40` ⇒ 两个图元区间都留着（= 追加口径）');
});


// ---------------------------------------------------------------------------
// ③ ★波 K：**页起点 == 该页首条正文记录的下标**（P1 改记录粒度前必须钉住的不变量）
// ---------------------------------------------------------------------------

/**
 * **页起点不变量**的判据（与 `TextItemTable.pageIndexGaps` 同一条语义，这里逐条重写一遍是为了
 * 让失败信息能直接说出"哪一页、哪条记录"）：对每一页，取「本页起点 → 下一页起点」那一段，
 * 该段里**属于本窗**的第一条记录必须恰好落在页起点上（该段一条本窗记录都没有 = 空页，合法）。
 *
 * ★为什么不简单地写成 `records[pages[i].start].win === pages[i].win`：**记录表是全窗共用的一张**，
 * 而页 push 也发生在 `0x70`（改窗几何）—— 真语料里 `i070` 把 1..9 号窗的几何连着设一遍，
 * 于是相邻页常常同 `start`（实测 51 条页里 27 条同 start、27 条空页），页起点上坐的是**别的窗**的记录。
 */
function pageStartViolations(t: TextItemTable): string[] {
  const bad: string[] = [];
  for (let i = 0; i < t.pages.length; i++) {
    const p = at(t.pages, i, '页');
    const next = t.pages[i + 1];
    const end = next ? next.start : t.records.length;
    if (next && next.start < p.start) bad.push(`页 ${i}（窗 ${p.win}）的起点 ${p.start} 大于下一页的 ${next.start}`);
    let first = -1;
    for (let j = p.start; j < end; j++) {
      if (at(t.records, j, '记录').win === p.win) {
        first = j;
        break;
      }
    }
    if (first === -1) continue; // 空页：这一页还没有本窗的记录
    if (first !== p.start) bad.push(`页 ${i}（窗 ${p.win}）首条正文在 ${first}，页起点写 ${p.start}`);
    else if ((at(t.records, first, '记录').flags & ITEM_GROUP_START) === 0) {
      bad.push(`页 ${i}（窗 ${p.win}）起点 ${p.start} 上的记录没有组首位`);
    }
  }
  return bad;
}

test('★波K：**页起点 == 该页首条正文记录下标** —— 真值（真 opcode 造的记录/页）下零违规', async () => {
  const t = new TextItemTable();
  t.pushPage(1); // = `i070`（改窗几何，无门）
  t.markGroupStart(1);
  t.pushRenderedRow(1, 'あ'.repeat(60), 0, 0); // = 一次 `i06e`（**一条**记录，与排版行数无关）
  t.pushLineFeed(1); // = `i06f`
  t.pushRenderedRow(2, '别的窗的记录', 0, 0); // ★页起点之后、下一页之前，坐着**别的窗**的记录
  t.pushPage(1); // = `i071 1`（消息开始；此时 records.length === 3）
  t.markGroupStart(1);
  t.pushRenderedRow(1, '同窗的下一页', 0, 0);
  t.pushPage(2); // 空页：这一页之后一条 2 号窗的记录都没有

  assert.deepEqual(
    t.pages,
    [
      { win: 1, start: 0 },
      { win: 1, start: 3 },
      { win: 2, start: 4 },
    ],
    '前置：页起点是 push 时刻的 `records.length`（raw 73183 / 74269）',
  );
  assert.equal(t.records.length, 4, '前置：四条记录（两段正文 + 一条换行 + 一条别的窗）');

  assert.deepEqual(t.pageIndexGaps(), [], '★`pageIndexGaps()` 必须零违规（这就是要钉的不变量）');
  assert.deepEqual(pageStartViolations(t), [], '★逐条判据同口径 ⇒ 同样零违规');
  assert.equal(
    t.repaintRange(3, { win: 1, mode: 0x2, dedicatedPath: false, voiceBusy: false }).lines.join(''),
    '同窗的下一页',
    '★从页 1 的起点切入，第一段拼出来的就是该页的正文（不是上一页、也不是别的窗那条）',
  );
});

test('★波K 红：两个反例必须**报出**违规（否则这条守卫是恒真的摆设）', async () => {
  // 反例 A：页 push 之后**没有** `markGroupStart`（等价于 `0x71` 置组首位那一步被搬走/被跳掉）
  const a = new TextItemTable();
  a.pushPage(1);
  a.pushRenderedRow(1, '没有组首位的首条正文', 0, 0);
  const gapsA = a.pageIndexGaps();
  assert.equal(gapsA.length, 1, `★漏掉 markGroupStart ⇒ 恰好一条违规（实得 ${gapsA.length}）`);
  assert.match(at(gapsA, 0, '违规'), /没有组首位/, '违规信息必须点明"组首位"这件事');
  assert.ok(pageStartViolations(a).length === 1, '★逐条判据同口径也报同一条');

  // 反例 B：同一窗的两页被**对调**（页表被重排过）—— 同一条组首记录在两条页的区间里各算一次
  //   ⇒ 拼接结果重复一段，且页起点不再单调不减。
  const b = new TextItemTable();
  b.pushPage(1);
  b.markGroupStart(1);
  b.pushRenderedRow(1, '甲', 0, 0);
  b.pushPage(1);
  b.markGroupStart(1);
  b.pushRenderedRow(1, '乙', 0, 0);
  assert.deepEqual(b.pageIndexGaps(), [], '前置：这样造出来的页/记录是一致的（零违规）');
  const [q0, q1] = [at(b.pages, 0, '页'), at(b.pages, 1, '页')];
  b.pages[0] = { win: q0.win, start: q1.start };
  b.pages[1] = { win: q1.win, start: q0.start };
  const gapsB = b.pageIndexGaps();
  assert.equal(gapsB.length, 1, `★页表被重排 ⇒ 恰好一条违规（实得 ${gapsB.length}）`);
  assert.match(at(gapsB, 0, '违规'), /单调不减/, '违规信息必须点明"页起点单调不减"这条结构性前提');
  assert.deepEqual(
    pageStartViolations(b),
    ['页 0（窗 1）的起点 1 大于下一页的 0'],
    '★逐条判据也必须报出这一条（页 0 的区间被抽空 ⇒ 同一条记录会落到两条页上）',
  );
});


interface Sample {
  win: number;
  start: number;
  model: string[];
  lines: string[];
  filt: string[];
  reflows: number;
  /** ★波 K：该采样点时「页起点 == 该页首条正文记录下标」不变量的违规条数（必须恒 0）。 */
  gaps: string[];
  /** 该采样点时**有本窗记录的页**数（空页不计）—— 用来证明上一条不是"页表是空的所以恒 0"。 */
  nonEmptyPages: number;
}

test(
  '★P0 真语料棘轮：序章 24 样本「记录切片行 vs 排版显示行」相同数 ≥ 23、`ITEM_REFLOW` 恒 0、差异只许那 1 例切窗形态',
  { timeout: 180_000 },
  async () => {
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
    assert.ok(boot, '引导脚本应可读（真资产档；缺资源时本档整体跳过）');
    loadScriptData(e, boot.data, boot.name);

    let clock = 0;
    let lastScript = e.curScript().name;
    let firstTextIp = -1;
    const host: FrameHost = {
      now: () => clock,
      advanceModel: (t: number) => scene.advance(t),
      poolPending: () => scene.poolPending(),
    };
    const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
      gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
      advFrame: true,
      maxStepsPerFrame: 20000,
      onStepStart: (_frame, ins) => {
        if (!ins) return;
        if (firstTextIp < 0 && e.curScript().name.startsWith('SN0000') && ins.opcode === 0x6e) {
          firstTextIp = e.curScript().ip;
        }
      },
      onUnknown: (err) => {
        e.unknownOpStubs.set(err.opcode, 1);
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
    const segKey = (): string =>
      e.msgwin
        .slot(e.msgwin.resolveWin(e.msgwin.lastArg))
        .segments.map((s) => s.text)
        .join('|');

    // ---- TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000 首文案（坐标见 `CONTEXT.md` §7）----
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
    await run(3000, () => e.awaitingAdvance);

    const snapshot = (): Sample => {
      const t = e.textItems;
      const win = e.msgwin.resolveWin(e.msgwin.lastArg);
      const model = modelLinesOf(t, win, styleOfWin(e, win), e.msgwin.slot(win).segments);
      const start = t.pages.length ? at(t.pages, t.pages.length - 1, '页').start : -1;
      const rec =
        start >= 0
          ? t.repaintRange(start, { win, mode: 0x2, dedicatedPath: false, voiceBusy: false })
          : { lines: [] as string[], end: start, records: [] };
      // ★波 K 的守卫：页起点与"该页首条正文记录下标"必须始终一致（见 `TextItemTable.pageIndexGaps`）。
      let nonEmptyPages = 0;
      for (let i = 0; i < t.pages.length; i++) {
        const p = at(t.pages, i, '页');
        const end = i + 1 < t.pages.length ? at(t.pages, i + 1, '页').start : t.records.length;
        if (t.records.slice(p.start, end).some((r) => r.win === p.win)) nonEmptyPages++;
      }
      return {
        win,
        start,
        model,
        lines: rec.lines,
        filt: start >= 0 ? filteredLines(t, win, start, rec.end) : [],
        reflows: t.records.filter((r) => (r.flags & ITEM_REFLOW) !== 0).length,
        gaps: t.pageIndexGaps(),
        nonEmptyPages,
      };
    };

    const rows: Sample[] = [snapshot()];
    for (let i = 0; i < 24; i++) {
      const before = segKey();
      input.pressMouse(0);
      await run(3);
      input.releaseMouse(0);
      await run(600);
      if (segKey() === before) {
        await run(1200);
        if (segKey() === before) continue; // 没换消息（可能停在选择支/其他脚本）
      }
      rows.push(snapshot());
    }

    assert.ok(
      rows.length >= 20,
      `序章应推得动（实得样本 ${rows.length} 条；脚本=${e.curScript().name}）—— 少了说明驱动路径坏了，不是"没有差异"`,
    );

    const same = rows.filter((r) => JSON.stringify(r.model) === JSON.stringify(r.lines)).length;
    const sameFilt = rows.filter((r) => JSON.stringify(r.model) === JSON.stringify(r.filt)).length;
    const reflowSum = rows.reduce((n, r) => n + r.reflows, 0);
    const diff = rows.filter((r) => JSON.stringify(r.model) !== JSON.stringify(r.lines));

    // ---- 棘轮三条 ----
    assert.equal(reflowSum, 0, '★`ITEM_REFLOW`（记录 flags bit1）在真语料里必须恒 0（全仓无生产者）—— 变非 0 说明有人接了重排路径');
    assert.ok(
      same >= 23 && rows.length >= 23,
      `★记录切片行与排版显示行的相同数必须 ≥ 23（实测 ${same}/${rows.length}）；` +
        `降低了说明记录表或排版有一侧变了 —— 先把差异打出来再决定放宽数字`,
    );
    assert.equal(sameFilt, same, `★按窗过滤（只保留目标窗的记录）与不过滤的相同数必须一致（${sameFilt} vs ${same}）—— 不一致说明"跨窗记录"开始影响切片`);

    // ---- ★波 K：页起点不变量的**真语料**棘轮（P1 粒度改动的前置守卫）----
    const gapSum = rows.reduce((n, r) => n + r.gaps.length, 0);
    const pagesSeen = rows.reduce((n, r) => n + r.nonEmptyPages, 0);
    assert.ok(
      pagesSeen > 0,
      '★前置：这段推进里必须真的出现过"有本窗正文的页"（否则下面的 0 违规只是"页表是空的"，不构成证据）',
    );
    assert.equal(
      gapSum,
      0,
      `★「页起点 == 该页首条正文记录下标」必须**一个违规都没有**（实测 ${gapSum} 条 / ${pagesSeen} 个有正文的页）：` +
        `·${rows.flatMap((r) => r.gaps).slice(0, 3).join(' ·')} —— ` +
        `违规说明记录表与回看页表错位（\`0x1d0\`/\`0x1d1\`/\`0x1d3\` 全都按页起点直接索引记录）`,
    );

    // ---- 差异只许那 1 例已知形态 ----
    for (const r of diff) {
      const known = r.model.length === 1 && at(r.model, 0, '模型行') === '' && r.lines.length >= 2;
      assert.ok(
        known,
        `★只有一种已知差异形态（切窗：模型 1 行空串 / 记录 ≥ 2 行非空），实得 win=${r.win} start=${r.start} ` +
          `模型 ${JSON.stringify(r.model)} 记录 ${JSON.stringify(r.lines)} ⇒ 若这是新形态，请按 CONTEXT.md §8 第 18 条登记新缺口后再动本断言`,
      );
      assert.deepEqual(
        r.filt,
        [],
        '★切窗那一例按窗过滤后必须是**空**（该窗在这段区间里没有自己的记录）',
      );
    }

    await src.dispose?.();
  },
);
