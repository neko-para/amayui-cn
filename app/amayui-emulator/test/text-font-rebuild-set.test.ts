/** @tier T0 @kind core @subsystem text */

/**
 * **`sub_459F40` / `sub_45A6E0` 建的 GDI 句柄组与字形度量缓冲**守卫（`tickets/T-0151`；
 * 审计 `lazy-gdi-font-set`/missing-behavior）。
 *
 * 审计原话：*「引擎在 `sub_459F40` 里重建的不只是 HFONT，还有字形度量/位图缓冲与竖排两面
 * （`lfEscapement=1800`）；重写侧只做 `(family,weight,size)→文件` 的选择，量宽与缩放修正整块缺失」*。
 *
 * 权威 = 函数体（全部行号是 `engine/天结_unpacked.exe_utf8.c` 的 raw 行号，逐行读过）：
 * ```
 * sub_459F40（raw 70940-71188）入口守卫：raw 70984  if (!*(_BYTE*)(Font+1260)) return;   // 主面名为空
 *   raw 70987-70989   Font+1232 = Font+101972 = -Font+201684          // 两套 LOGFONTA 模板的 lfHeight
 *   raw 70990         sub_456C90(…, Font+201708, Font+201688)          // 参考字 0x8C83 的度量 + Font+201784 面
 *   raw 71024-71035   delete/new：Font+102092 / Font+102096 两块缓冲 + Font+102100（字节数）
 *   raw 71038-71046   Font+101852 = CreateFontIndirectA(Font+101972) + GetTextMetricsA → Font+101860
 *   raw 71096-71099   v35 = Font+1232 副本、面名 → "AGE Extend"；v38 = Font+101972 副本、面名 → "@AGE Extend"
 *   raw 71134-71143   delete/new：Font+1408 / Font+1412 两块字形位图缓冲 + Font+1416（字节数）
 *   raw 71144-71169   DeleteObject ×10（1084 / 1100 / 218624 / 235068 / 235072 / 235076 / 235080 / 235100 / 235104；
 *                                         Font+101852 在上面 71039 已删）
 *   raw 71170-71187   CreateFontIndirectA ×10，其中 raw 71178-71181 把 v38/v39 的
 *                     lfEscapement/lfOrientation 设成 **1800** 后才建 → Font+235100 / Font+235104
 * sub_45A6E0（raw 71192-71273）入口守卫：raw 71212  if (!*(_BYTE*)(Font+1320)) return;   // 注音面名为空
 *   raw 71214-71226   DeleteObject（1096 / 218568 / 101856 / 218628）
 *   raw 71229-71232   Font+1096 = CreateFontIndirectA(Font+1292) + GetTextMetricsA → Font+1168
 *   raw 71263-71272   CreateFontIndirectA ×4（218568 / 218628 / 101856）
 * ```
 * 量宽用哪支句柄（审计点名的"关键格"）：`sub_404EE0` raw 10733-10737 ——
 * `Font+201680` 非 0 时先 `SelectObject(Font+1108, Font+201784)`（`sub_456C90` raw 68712-68716 建的
 * "ＭＳ ゴシック" 参考面），否则用度量 IC 上**当时已选中**的那支（重建把它留在 `Font+101852`，
 * raw 71041-71046；`sub_456B80` raw 68661-68662 也再选一次）。
 *
 * ★本文件**不**假装 emulator 有 GDI：它守的是"重写侧必须知道引擎建了什么、以及哪些格没有等价物"
 * ——数据表 + 纯算术 + 缺口登记，全是可在 Node 里断言的。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGE_EXTEND_FACES,
  GDI_FACE_REBUILD,
  GDI_FACE_REBUILD_NOT_MODELED,
  aspectCorrectedLfWidth,
  aspectScaledLfHeight,
  glyphBitmapBufferBytes,
  metricFaceSlot,
  resolveFace,
} from '../src/text/fontSet.js';

const slots = (list: readonly { slot: string }[]): string[] => list.map((f) => f.slot).sort();

test('★主套 = CreateFontIndirectA **10** 次（不是台账旧写的 ×8）：含字形度量面 +101852 与两张 1800 竖排面', () => {
  assert.equal(GDI_FACE_REBUILD.main.length, 10, 'sub_459F40 raw 71170-71187 是 10 次 CreateFontIndirectA');
  assert.deepEqual(
    slots(GDI_FACE_REBUILD.main),
    [
      'Font+101852',
      'Font+1084',
      'Font+1100',
      'Font+218624',
      'Font+235068',
      'Font+235072',
      'Font+235076',
      'Font+235080',
      'Font+235100',
      'Font+235104',
    ].sort(),
    '槽号必须与体里的 DeleteObject 清单（raw 71144-71169 + 71039）逐格对上',
  );
  assert.equal(GDI_FACE_REBUILD.ruby.length, 4, 'sub_45A6E0 raw 71263-71272 是 4 次 CreateFontIndirectA');
  assert.deepEqual(
    slots(GDI_FACE_REBUILD.ruby),
    ['Font+101856', 'Font+1096', 'Font+218568', 'Font+218628'].sort(),
  );
});

test('★竖排两面：只有 Font+235100 / Font+235104 带 lfEscapement=1800，且都由 "\\@AGE Extend" 面派生', () => {
  const rot = GDI_FACE_REBUILD.main.filter((f) => f.rotated1800);
  assert.deepEqual(slots(rot), ['Font+235100', 'Font+235104'], 'raw 71178-71186');
  for (const f of rot) {
    assert.equal(f.face, '@AGE Extend', '它们是 v38/v39 —— `@` 前缀 + AGE Extend（raw 71099 的 aAgeExtend_0）');
    assert.equal(f.raw, f.slot === 'Font+235100' ? '71182' : '71183', 'raw 71182/71183 两次 CreateFontIndirectA');
  }
  assert.deepEqual(
    rot.map((f) => f.size).sort(),
    ['base', 'scaled'],
    '一张原尺寸（v38）、一张缩放修正（v39，raw 71180-71181 在缩放副本上设 1800）',
  );
  assert.equal(GDI_FACE_REBUILD.ruby.filter((f) => f.rotated1800).length, 0, '注音那 4 支不带 1800');
});

test('★面名替换：主套有两族派生面 "AGE Extend"（v35/v37）与 "@AGE Extend"（v38/v39），引擎对它免白名单警告', () => {
  assert.deepEqual([...AGE_EXTEND_FACES], ['AGE Extend', '@AGE Extend'], 'aAgeExtend[]="AGE Extend"（raw 4455）、aAgeExtend_0[]="@AGE Extend"（raw 4678）');
  const byFace = (face: string) => slots(GDI_FACE_REBUILD.main.filter((f) => f.face === face));
  assert.deepEqual(byFace('AGE Extend'), ['Font+235068', 'Font+235072'].sort(), 'raw 71097 把 v35 的面名换成 "AGE Extend"');
  assert.deepEqual(byFace('@AGE Extend'), ['Font+235076', 'Font+235080', 'Font+235100', 'Font+235104'].sort());
  // 未做面名替换的：主面模板 Font+1232（1084/1100）与 @主面模板 Font+101972（101852/218624）
  assert.deepEqual(slots(GDI_FACE_REBUILD.main.filter((f) => f.face === 'main')), ['Font+1084', 'Font+1100'].sort());
  assert.deepEqual(slots(GDI_FACE_REBUILD.main.filter((f) => f.face === '@main')), ['Font+101852', 'Font+218624'].sort());
  // ★重写侧现状：AGE Extend 没进 FACE_MAPS ⇒ 回退 + unknown。这是**有据的缺口**（见登记表），不是"正确"。
  assert.equal(resolveFace('AGE Extend').unknown, true, 'AGE Extend 不在内置字族表里（登记为缺口，未做映射）');
  assert.equal(resolveFace('@AGE Extend').unknown, true, '剥 `@` 后同样查不到');
});

test('★量宽用哪支句柄（审计点名的关键格）：`Font+201680` 非 0 ⇒ Font+201784，否则 Font+101852', () => {
  assert.equal(metricFaceSlot(0), 'Font+101852', 'raw 10733 门关 ⇒ 用度量 IC 上当时选中的那支（重建留在 101852）');
  assert.equal(metricFaceSlot(1), 'Font+201784', 'raw 10734 SelectObject(Font+1108, Font+201784)');
  assert.equal(metricFaceSlot(-3), 'Font+201784', '判据是 `!= 0`（有符号），负数也算非 0');
  // ★该标志全库只有 Initialize 的两处写、都是 0 ⇒ 本 build 恒 0（raw 78769 / 78895）
  assert.equal(metricFaceSlot(0), 'Font+101852', '默认路径就是它');
});

test('★字形位图缓冲尺寸（纯算术，冻结字面量）：主套 16(h/4−1)²、注音 4(4·(h/4)+4)²，各两块', () => {
  // 主套 raw 71138-71141：h = Font+1232 = −字号 ⇒ size 30 → h/4 = −7（C 向零截断）→ n = −8 → 16·64 = 1024
  assert.deepEqual(glyphBitmapBufferBytes('main', 30), { each: 1024, sizeWord: 1024 }, 'raw 71138-71141');
  assert.deepEqual(glyphBitmapBufferBytes('main', 32), { each: 1296, sizeWord: 1296 });
  assert.deepEqual(glyphBitmapBufferBytes('main', 10), { each: 144, sizeWord: 144 });
  // 注音 raw 71028-71035：4·(−30/4)+4 = −24 ⇒ abs 24 ⇒ 4·576 = 2304
  assert.deepEqual(glyphBitmapBufferBytes('ruby', 30), { each: 2304, sizeWord: 2304 }, 'raw 71028-71035');
  assert.deepEqual(glyphBitmapBufferBytes('ruby', 32), { each: 3136, sizeWord: 3136 });
  assert.deepEqual(glyphBitmapBufferBytes('ruby', 10), { each: 64, sizeWord: 64 });
  // 主套的"字节数"格与每块长度在体里是同一个式子（raw 71141 展开 = 16(h/4−1)²）⇒ 两者必须恒等
  for (const s of [8, 12, 16, 24, 30, 48, 60]) {
    const m = glyphBitmapBufferBytes('main', s);
    assert.equal(m.sizeWord, m.each, `主套 size=${s}：raw 71141 与 71138 必须算出同一个数`);
  }
});

test('★缩放修正（审计说"整块缺失"的那部分）：lfHeight 加 0.5 后向零截断；lfWidth 按 218592/218596 纵横比修正', () => {
  // raw 71055 `(int)((double)Font+1232 * Font+218596 + dbl_51D7F8)`，dbl_51D7F8 = 0.5（raw 4197）
  assert.equal(aspectScaledLfHeight(-30, 1), -29, '★缩放 1（默认 Font+218596=1.0，raw 78767）也**不是**恒等：(−30+0.5) 向零截断 = −29');
  assert.equal(aspectScaledLfHeight(-30, 2), -59, '(−60+0.5) = −59.5 ⇒ C 向零截断 = −59');
  assert.equal(aspectScaledLfHeight(30, 2), 60, '(60+0.5) = 60.5 ⇒ 60');
  // raw 71088 `(int)((double)lf.lfWidth / Font+218596 * Font+218592)`
  assert.equal(aspectCorrectedLfWidth(15, 1, 1), 15, '两个缩放相等 ⇒ 不变');
  assert.equal(aspectCorrectedLfWidth(15, 2, 1), 7, '15/2*1 = 7.5 ⇒ 向零截断 7');
  assert.equal(aspectCorrectedLfWidth(-15, 2, 1), -7, '负数同样向零截断');
  assert.equal(aspectCorrectedLfWidth(15, 1, 2), 30, '15/1*2 = 30');
  assert.equal(aspectCorrectedLfWidth(0, 3, 7), 0);
});

test('★缺口登记：重写侧没有等价物的那几格必须逐条写明（不许沉默掩盖）', () => {
  const raws = GDI_FACE_REBUILD_NOT_MODELED.map((g) => g.raw);
  // ① TEXTMETRICA（两套）② 字形位图缓冲（两族）③ 缩放修正的输入缩放因子 ④ AGE Extend 面名映射
  for (const need of ['71045', '71232', '71029', '71138', '71028']) {
    assert.ok(raws.includes(need), `缺口登记缺 raw ${need}（现有：${raws.join(', ')}）`);
  }
  for (const g of GDI_FACE_REBUILD_NOT_MODELED) {
    assert.ok(g.what.length > 0 && g.why.length > 0 && g.recheck.length > 0, `raw ${g.raw} 的三段都要写`);
  }
});
