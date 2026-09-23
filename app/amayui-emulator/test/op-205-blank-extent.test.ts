/** @tier T0 @kind core @subsystem text */

/**
 * **`set:BlankExtentMode`（空白字前进量的配置门）守卫** —— `tickets/T-0085`（E2）。
 *
 * 引擎事实（全部用定义头 grep 定位过，权威 = `engine/天结_unpacked.exe_utf8.c`）：
 *  - 门：`char aSetBlankextent[20] = "set:BlankExtentMode"`（raw 4280）；20 余处读取**一律 `== 1`**
 *    （raw 12230 / 85126 / 85366 / 85638 / 85812 / 86567 / 87272 / 87689 / 87908 / 88054 / 88875 /
 *    89074 / 89571 / 89760 / 90032 / 90228 …）；
 *  - 度量：`sub_404EE0`（定义头 raw 10715 → 体 raw 10716-10739）= 对**一个字符的 SJIS 字节**
 *    调 `GetTextExtentPoint32A`（度量 IC = `Font+1108`；`font_metrics_mode` 非 0 时先临时
 *    `SelectObject(Font+201784)`，量完还原）⇒ `SIZE{cx, cy}`；
 *  - 消费：`sub_4072F0`（raw 12221-12236 = `0x205` 的 `cy`）；字形路径 raw 85126-85141 /
 *    85638-85653 / 85812-85824 / 86567-86579 / 87269-87280 …：空白字（`0x20` / `0x8140` / 控制字）
 *    `mode == 1` ⇒ `pen += 全角 ? sz.cy : sz.cx`；`mode == 0` ⇒ `pen += font_size / (全角?1:2)`
 *    （raw 87279 最直白）。
 *  - **随包默认 = 0**（`tickets/T-0031/evidence/generated-SYS4REG.ini` 第 116 行 `BlankExtentMode=0`）。
 *
 * 本文件守三件事（顺序即重要性）：
 *  ① **零回归**：mode 0（= 默认）下前进量/换行/落点与"改动前的纯算术"**逐字相等**
 *     （下面的数字是**冻结字面量**，不是从被测代码里算出来的）；
 *  ② **可分辨**：同一段文本在 mode 1（给了度量）下前进量/换行/落点必须变，且**只有空白字**变；
 *  ③ **缺口可见**：mode 1 但拿不到度量（emulator 现状）必须**显式回退**并置
 *     `TextFrame.blankExtentFallback`，绝不允许静默编一个数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  advance,
  blankAdvance,
  defaultWinStyle,
  isBlankExtentChar,
  layoutWindow,
  numberCellExtent,
  textWidth,
  type BlankExtent,
  type MsgWinInput,
} from '../src/text/layout.js';
import { Engine } from '../src/vm/engine.js';
import { emitWin } from '../src/vm/handlers/msgwin.js';
import { StubNative } from '../src/vm/native.js';
import { parseIni } from '../src/engineConfig.js';
import { CFG, registryDefault } from '../src/configRegistry.js';

/** 合成度量：全角空格 44 宽 / 44 高、半角（含控制字）6 宽。**故意与网格（30/15）不同**以便分辨。 */
const STUB = (ch: string): { cx: number; cy: number } | undefined => {
  const c = ch.codePointAt(0) ?? 0;
  if (ch === '　') return { cx: 44, cy: 44 };
  if (c <= 0x20) return { cx: 6, cy: 44 };
  return { cx: 30, cy: 44 };
};

const M1: BlankExtent = { mode: 1, measure: STUB };
const M0: BlankExtent = { mode: 0 };

const input = (text: string, extra?: Partial<MsgWinInput>): MsgWinInput => ({
  style: { ...defaultWinStyle(), wrapRight: 100, wrapBottom: 720 },
  segments: [{ text, ruby: [], lineEnded: false }],
  ...extra,
});

// ---------------------------------------------------------------------------
// ① mode 0 = 改前的纯算术（冻结字面量 ⇒ 零回归棘轮）
// ---------------------------------------------------------------------------
test('★零回归：mode 0（= 随包默认）与改动前的纯算术逐字相等', () => {
  // 冻结值（改动前 `advance()` 的公式 = sjisBytes × size / 2；raw 87279 的 `font_size / (全角?1:2)`）
  assert.equal(advance('天', 30), 30);
  assert.equal(advance('A', 30), 15);
  assert.equal(advance('　', 30), 30, '全角空格 = 1em（不是"空 = 0"）');
  assert.equal(advance(' ', 30), 15, '半角空格 = 0.5em');
  assert.equal(textWidth('あ　い', 30), 90);
  // 显式 mode 0 / 未接线（undefined）都不许改变任何一个数
  for (const ch of ['天', 'A', '　', ' ', 'ｱ']) {
    assert.equal(advance(ch, 30, M0), advance(ch, 30), `${ch} 在 mode 0 下必须与改动前相同`);
    assert.equal(advance(ch, 30, { mode: 2 }), advance(ch, 30), 'mode != 1 一律走网格（引擎判据是 == 1）');
    // ★2026-09-23 改（`tickets/T-0125`）：原版是 `assert.equal(f(x), f(x), '自反（防 NaN）')` ——
    //   实测 node:test 的 `assert.equal(NaN, NaN)` **不抛**（官方对 NaN 特判）⇒ 连注释声称的
    //   "防 NaN"都做不到，恒真。改成真正的有限性 + 正值判据（NaN/Infinity 都会红）。
    const a1 = advance(ch, 30, M1);
    assert.ok(Number.isFinite(a1) && a1 > 0, `${ch} 在 mode 1 下的推进必须是有限正数（实得 ${a1}）`);
  }
  // 排版层：同样的文本在 mode 0 / 未接线 / mode 2 下必须**完全相同**（深层相等）
  const text = 'あ　い　う　え';
  const bare = layoutWindow(9, input(text));
  const m0 = layoutWindow(9, input(text, { blankExtent: M0 }));
  const m2 = layoutWindow(9, input(text, { blankExtent: { mode: 2 } }));
  assert.deepEqual(m0, bare, 'mode 0 帧必须与"完全不传 blankExtent"的帧深层相等');
  assert.deepEqual(m2, bare, 'mode 2（引擎里也不开门）同样必须相等');
  assert.deepEqual(
    bare.lines.map((l) => l.text),
    ['あ　い', '　う　', 'え'],
    '冻结的换行结果（wrapRight=100、字号 30 ⇒ 每行 3 个全角格）',
  );
  assert.deepEqual(
    bare.lines.map((l) => l.glyphs.map((g) => g.x)),
    [
      [0, 30, 60],
      [0, 30, 60],
      [0],
    ],
    '冻结的逐字落点（全角 30 / 全角空格 30）',
  );
  assert.equal(bare.blankExtentFallback, undefined, 'mode 0 不得出现回退标志');
});

test('mode 1 下**非空白字**不受影响（只量空白字；绝不无谓调用度量）', () => {
  const seen: string[] = [];
  const m: BlankExtent = { mode: 1, measure: (ch) => (seen.push(ch), STUB(ch)) };
  assert.equal(advance('天', 30, m), 30, '全角汉字仍走网格');
  assert.equal(advance('A', 30, m), 15, '半角字母仍走网格');
  assert.equal(advance('。', 30, m), 30);
  assert.deepEqual(seen, [], '非空白字一次都不该去量（引擎只在空白字分支里调 sub_404EE0）');
});

// ---------------------------------------------------------------------------
// ② mode 1 可分辨（给了度量）
// ---------------------------------------------------------------------------
test('★mode 1：空白字前进量 = 度量（全角取 cy、半角取 cx），与 mode 0 可分辨', () => {
  // 全角取 `cy`（raw 85130/85642/85815 的 `psizl.cy`；DBCS 的格是方的）、半角取 `cx`
  assert.deepEqual(blankAdvance('　', 30, M1), { value: 44, measured: true });
  assert.deepEqual(blankAdvance(' ', 30, M1), { value: 6, measured: true });
  assert.deepEqual(blankAdvance('\t', 30, M1), { value: 6, measured: true }, '控制字（<0x20）也走空白字分支');
  assert.notEqual(blankAdvance('　', 30, M1).value, blankAdvance('　', 30, M0).value);

  const text = 'あ　い　う　え';
  const m0 = layoutWindow(9, input(text, { blankExtent: M0 }));
  const m1 = layoutWindow(9, input(text, { blankExtent: M1 }));
  // 前进量变了 ⇒ 换行位置与逐字落点都必须变（这就是"可分辨"）
  assert.notDeepEqual(
    m1.lines.map((l) => l.text),
    m0.lines.map((l) => l.text),
    'mode 1 的换行结果必须与 mode 0 不同',
  );
  assert.deepEqual(
    m1.lines.map((l) => l.text),
    ['あ　', 'い　', 'う　', 'え'],
    '冻结的 mode 1 换行（全角空格 44 ⇒ 30+44=74 放得下 2 字，第 3 字 104 > 100）',
  );
  assert.deepEqual(
    m1.lines.map((l) => l.glyphs.map((g) => g.x)),
    [
      [0, 30],
      [0, 30],
      [0, 30],
      [0],
    ],
    '冻结的 mode 1 落点',
  );
  assert.equal(m1.blankExtentFallback, undefined, '量到了就不算回退');
});

// ---------------------------------------------------------------------------
// ③ 缺口可见：mode 1 但没有度量来源（emulator 现状）
// ---------------------------------------------------------------------------
test('★mode 1 无度量来源：显式回退到网格（= mode 0 结果）并把缺口置在帧上', () => {
  const text = 'あ　い　う　え';
  const bare = layoutWindow(9, input(text));
  const fb = layoutWindow(9, input(text, { blankExtent: { mode: 1 } }));
  assert.equal(fb.blankExtentFallback, true, '拿不到度量必须留下可观测的标志（不许静默）');
  const { blankExtentFallback, ...rest } = fb;
  assert.deepEqual(rest, bare, '回退出来的排版必须与 mode 0 逐字相同（不编数）');
  // 没有空白字时不算回退（标志只在真的遇到空白字时出现）
  assert.equal(layoutWindow(9, input('あいう', { blankExtent: { mode: 1 } })).blankExtentFallback, undefined);
  // 度量返回 undefined（宿主量不到该字）同样算回退
  assert.equal(
    layoutWindow(9, input('あ　い', { blankExtent: { mode: 1, measure: () => undefined } })).blankExtentFallback,
    true,
  );
});

test('isBlankExtentChar：半角空格/全角空格/控制字为真，其余为假（抄 raw 85083-85111 的进入条件）', () => {
  for (const ch of [' ', '　', '\t', '\n', '\u0000']) assert.equal(isBlankExtentChar(ch), true, `${JSON.stringify(ch)}`);
  for (const ch of ['A', '0', '天', '。', 'ｱ', '㍻']) assert.equal(isBlankExtentChar(ch), false, `${JSON.stringify(ch)}`);
});

// ---------------------------------------------------------------------------
// `0x205` 数字文本的格宽（`sub_4072F0` raw 12221-12236）
// ---------------------------------------------------------------------------
test('★0x205 的 cy：mode 0 = 字体度量口径；mode 1 = 量宽(0x8140) / 2×量宽(0x20)', () => {
  // mode 0：原样返回 gridCy（引擎 raw 12221-12225 = font_metrics_mode ? 字号 : -lfHeight）
  assert.deepEqual(numberCellExtent(false, 30, M0), { cy: 30, measured: false });
  assert.deepEqual(numberCellExtent(true, 30, M0), { cy: 30, measured: false });
  assert.deepEqual(numberCellExtent(false, 30, undefined), { cy: 30, measured: false });
  // mode 1（引擎 raw 12232-12235：全角 = 量宽(0x8140)、半角 = 2 × 量宽(0x20)）
  assert.deepEqual(numberCellExtent(false, 30, M1), { cy: 44, measured: true });
  assert.deepEqual(numberCellExtent(true, 30, M1), { cy: 12, measured: true });
  // mode 1 无度量 ⇒ 回退（cy 不变 ⇒ `op2` 的写回也不变）
  assert.deepEqual(numberCellExtent(false, 30, { mode: 1 }), { cy: 30, measured: false });
  assert.deepEqual(numberCellExtent(true, 30, { mode: 1 }), { cy: 30, measured: false });
});

// ---------------------------------------------------------------------------
// 接线（VM → 排版输入）：配置真的被读了，且只有一个读取口径
// ---------------------------------------------------------------------------
class CapturingNative extends StubNative {
  public inputs: MsgWinInput[] = [];
  constructor() {
    super(() => {});
  }
  override msgWinSync(_win: number, input: MsgWinInput): void {
    this.inputs.push(input);
  }
}

function emitOnce(ini: string | null): MsgWinInput {
  const n = new CapturingNative();
  const e = new Engine(n);
  if (ini !== null) e.config = parseIni(ini);
  // 直接放一段文本进槽再发布（`emitWin` 是 VM 侧唯一的 `msgWinSync` 发布点）
  e.msgwin.slot(1).segments.push({ text: 'あ　い', ruby: [], lineEnded: false });
  emitWin(e, 1);
  assert.equal(n.inputs.length, 1, 'emitWin 必须发布一次');
  return n.inputs[0]!;
}

test('★接线：emitWin 把 set:BlankExtentMode 原样交给排版（INI 缺键 ⇒ 注册表默认 0）', () => {
  assert.equal(registryDefault(CFG.setBlankExtentMode), 0, '注册表默认必须是 0（随包 INI 也是 0）');
  assert.equal(emitOnce('[set]\r\nBlankExtentMode=1\r\n').blankExtent?.mode, 1, 'INI 写 1 ⇒ 门开');
  assert.equal(emitOnce('[set]\r\nBlankExtentMode=0\r\n').blankExtent?.mode, 0);
  assert.equal(emitOnce('[set]\r\n').blankExtent?.mode, 0, '缺键 ⇒ 引擎内建默认 0');
  assert.equal(emitOnce(null).blankExtent?.mode, 0, '整个配置缺失也不抛错');
  // 端到端：读到的门直接决定排版帧的回退标志（mode 1 + 无度量来源 = 现状 ⇒ 回退可见）
  const frame = layoutWindow(9, emitOnce('[set]\r\nBlankExtentMode=1\r\n'));
  assert.equal(frame.blankExtentFallback, true);
  assert.equal(layoutWindow(9, emitOnce('[set]\r\n')).blankExtentFallback, undefined);
});
