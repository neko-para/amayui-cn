/** @tier T0 @kind core @subsystem text */

/**
 * **`0x204` 直绘路径的空白字前进量**守卫（`tickets/T-0151`；审计 `0x204`/approximation）。
 *
 * 引擎链（逐行读过 `engine/天结_unpacked.exe_utf8.c`）：
 * ```
 * 0x204 → sub_423390 (raw 31454) → sub_456710 (raw 68470)
 *   raw 68490-68493:  if (Font+1372「描边档位」!= 0) sub_471180(...) else sub_46F2D0(...)
 *
 * sub_471180（描边档位 1/2/3）  raw 87255-87280：
 *   空白字（*v96 == 0x20 / 0x8140 / <0x20 分支）⇒ LABEL_26
 *     if ( Font+201680 <= 1 && GetConfig("set:BlankExtentMode") == 1 )   // raw 87269-87272
 *       { sub_404EE0(_this, &psizl, v16); cx = psizl.cx; }               // raw 87274-87275
 *     else cx = Font+201684 / (((unsigned __int16)v16 < 0x100u) + 1);    // raw 87279（= 字号网格）
 *
 * sub_46F2D0（描边档位 0）      raw 86050-86067：
 *     if ( GetConfig("set:BlankExtentMode") == 1 )                       // raw 86057-86059
 *       { sub_404EE0(_this, &psizl, v14); cx = psizl.cx; }               // raw 86061-86062
 *     else cx = (__int16)Font+201704 / (((unsigned __int16)v14 < 0x100u) + 1);  // raw 86066
 * ```
 * 两条必须分开记的三件事（本文件守它们）：
 *  1. **mode 1 下空白字一律取量宽的 `cx`**（全角**也**取 `cx`）—— 这与消息窗排版路径
 *     （`raw 85129-85132` 等，全角取 `psizl.cy`）**口径不同**，照抄 `blankAdvance` 会把全角空格前进量算错；
 *  2. `Font+201680 <= 1` 这道额外门**只**在描边路径（`sub_471180`，raw 87269）上有，档位 0 那条没有；
 *     ★且 `Font+201680` 全库只有 raw 78769 / 78895 两处写、都是 `= 0` ⇒ 本 build 里该门**恒真**；
 *  3. mode 0（随包默认 `BlankExtentMode=0`）与改动前的纯算术**逐字相等**（零回归棘轮）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  drawStringAdvance,
  drawStringBlankAdvance,
  drawStringGlyphs,
  type BlankExtent,
} from '../src/text/layout.js';

/** 合成度量：`cx` 与 `cy` **故意差得远**，这样"取 cx 还是取 cy"一望可知。 */
const CX = 44;
const CY = 99;
const STUB = (ch: string): { cx: number; cy: number } => {
  const c = ch.codePointAt(0) ?? 0;
  if (ch === '　') return { cx: CX, cy: CY };
  if (c <= 0x20) return { cx: 6, cy: CY };
  return { cx: 30, cy: CY };
};

const M1: BlankExtent = { mode: 1, measure: STUB };
const M0: BlankExtent = { mode: 0 };

test('★mode 1：直绘空白字前进量 = 量宽的 **cx**（全角也取 cx，不许照搬消息窗的 cy）', () => {
  assert.deepEqual(drawStringBlankAdvance('　', 30, 3, M1), { value: CX, measured: true }, '全角空格 ⇒ cx=44（不是 cy=99）');
  assert.deepEqual(drawStringBlankAdvance(' ', 30, 3, M1), { value: 6, measured: true }, '半角空格 ⇒ cx=6');
  assert.deepEqual(drawStringBlankAdvance('\t', 30, 3, M1), { value: 6, measured: true }, '控制字（<0x20）也走空白字分支');
  // 档位 0 也一样取 cx（raw 86061-86062 与 87274-87275 同形）
  assert.deepEqual(drawStringBlankAdvance('　', 30, 0, M1), { value: CX, measured: true });
});

test('★mode 0 / 未接线：空白字仍走字号网格 `字号/(全角?1:2)`（raw 87279），且**一次都不去量**', () => {
  const seen: string[] = [];
  const m: BlankExtent = { mode: 1, measure: (ch) => (seen.push(ch), STUB(ch)) };
  for (const blank of [undefined, M0, { mode: 2 } as BlankExtent]) {
    assert.deepEqual(drawStringBlankAdvance('　', 30, 3, blank), { value: 30, measured: false }, '全角空格 = 1em');
    assert.deepEqual(drawStringBlankAdvance(' ', 30, 3, blank), { value: 15, measured: false }, '半角空格 = 0.5em');
  }
  assert.deepEqual(seen, [], 'mode != 1 ⇒ 不许调用度量（引擎只在 `== 1` 分支里调 sub_404EE0）');
  // 非空白字在**任何**模式下都是网格，且不碰度量（引擎只在空白字分支里调 sub_404EE0）
  assert.equal(drawStringAdvance('天', 30, 3, m), 30);
  assert.equal(drawStringAdvance('A', 30, 3, m), 15);
  assert.deepEqual(seen, []);
});

test('★`Font+201680 <= 1` 这道额外门只在描边路径上（raw 87269），档位 0 那条没有（raw 86057）', () => {
  const seen: string[] = [];
  const m: BlankExtent = { mode: 1, fontMetricsFlag: 2, measure: (ch) => (seen.push(ch), STUB(ch)) };
  // 描边档位（Font+1372 != 0）⇒ 门关 ⇒ 回退网格，且不许去量
  for (const mode of [1, 2, 3] as const) {
    assert.deepEqual(drawStringBlankAdvance('　', 30, mode, m), { value: 30, measured: false }, `档位 ${mode} 门关`);
  }
  assert.deepEqual(seen, [], '门关时不许调用度量');
  // 档位 0（sub_46F2D0）体里**没有**这道理 ⇒ 照样量
  assert.deepEqual(drawStringBlankAdvance('　', 30, 0, m), { value: CX, measured: true });
  assert.deepEqual(seen, ['　']);
  // `<= 1`（不是 `== 0`）：0 与 1 都开门、负数也开（C 的有符号比较）
  for (const flag of [0, 1, -1]) {
    const mm: BlankExtent = { mode: 1, fontMetricsFlag: flag, measure: STUB };
    assert.equal(drawStringBlankAdvance('　', 30, 3, mm).measured, true, `fontMetricsFlag=${flag} 应开门`);
  }
});

test('★接线：`drawStringGlyphs` 的落点随空白字前进量整段平移（mode 1 vs mode 0 可分辨）', () => {
  const text = 'あ　い';
  const g1 = drawStringGlyphs(text, 0, 0, 30, 3, 1, 1, M1);
  const fills1 = g1.filter((g) => g.role === 'fill');
  assert.deepEqual(
    fills1.map((g) => [g.ch, g.x]),
    [
      ['あ', 0],
      ['　', 30],
      ['い', 30 + CX],
    ],
    '全角空格占 44 ⇒ 后续字整段右移 14px',
  );
  // 未接线 / mode 0 ⇒ 与改动前逐字相等（零回归棘轮；下面的数字是**冻结字面量**）
  const legacy = drawStringGlyphs(text, 0, 0, 30, 3, 1, 1);
  const m0 = drawStringGlyphs(text, 0, 0, 30, 3, 1, 1, M0);
  assert.deepEqual(legacy, m0, 'mode 0 必须与"完全不传 blank"的旧签名结果深层相等');
  assert.deepEqual(
    m0.filter((g) => g.role === 'fill').map((g) => g.x),
    [0, 30, 60],
    '冻结的旧落点（全角 30 / 全角空格 30）',
  );
  // 描边副本的偏移一个都不许跟着变（描边偏移是 Font+1384/+1388 的事）
  assert.deepEqual(
    g1.filter((g) => g.role === 'outline').map((g) => [g.x, g.y]),
    fills1.flatMap((g) => [
      [g.x + 1, g.y + 1],
      [g.x - 1, g.y - 1],
      [g.x + 1, g.y - 1],
      [g.x - 1, g.y + 1],
    ]),
  );
});

test('★无度量来源时显式回退到网格（回退可见，而不是编一个数）', () => {
  assert.deepEqual(drawStringBlankAdvance('　', 30, 3, { mode: 1 }), { value: 30, measured: false });
  assert.deepEqual(drawStringBlankAdvance(' ', 30, 3, { mode: 1, measure: () => undefined }), { value: 15, measured: false });
  assert.deepEqual(
    drawStringBlankAdvance('　', 30, 3, { mode: 1, measure: () => ({ cx: 0, cy: 0 }) }),
    { value: 30, measured: false },
    '量到 0×0 ⇒ 视为没量到（引擎 raw 87274-87279 的 else 分支）',
  );
});
