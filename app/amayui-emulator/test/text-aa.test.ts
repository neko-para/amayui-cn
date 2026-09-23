/** @tier T0 @kind core @subsystem text */

/**
 * **抗锯齿配置门与锯齿字形化**（`tickets/T-0035`）。
 *
 * 现象（用户实测 2026-09）：emulator 里很多文字比真游戏引擎渲染的更粗、白色更亮。
 * 引擎真源（`engine/天结_unpacked.exe_utf8.c`）：
 *  - raw 23649-23656：**只有** `set:EnableAntiFont` 非 0 时才读 `message:UseAntiFont` →
 *    `sub_4155B0(Font, v)`（raw 22409-22422）= 写 `Font+1352`（= `Engine[21662]`）+ 重建字体 + 清字形缓存；
 *  - raw 78755：`Font+1352` 初始化就是 **0**；门不过 ⇒ 一直是 0 ⇒ 引擎走 GDI/dd 的 `TextOutA`
 *    整串绘制 = **锯齿字形**（没有半透明边缘）；
 *  - ★`message:AntiFontLevel`（raw 23653 写 `Engine+303796`）与 `set:Menu_UseAntiFont`（只进配置表）
 *    在渲染侧**没有读者** ⇒ 不是"引擎的 AA 档位"，别照抄。
 * 本机现状：真游戏 base 的 SYS4REG.INI 连 `[set]` 段都没有（`GetConfig` 返 0），本工程 overlay 写的是
 * `EnableAntiFont=0` ⇒ **两边都是无 AA**。而 canvas 永远开 AA（灰边）⇒ 字看着更粗、白字边缘更亮。
 *
 * 本文件钉四件事：① 配置门的两键语义（**字段**仍按配置推导）；② 样式侧的 AA 判据以**实测像素**
 * 为准（恒 true，见下）；③ 阈值化本身的行为；④ 覆盖率 α 合成（`TEXT_FILL_ALPHA`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { applyConfigToEngine, parseIni } from '../src/engineConfig.js';
import { globalTextStyle } from '../src/vm/handlers/msgwin.js';
import { engineGlyphPixel, thresholdAlpha } from '../src/renderer/text/raster.js';
import { TEXT_FILL_ALPHA } from '../src/text/layout.js';

/** `Font+1352` = `Engine+85296+1352` ⇒ dword 下标 `(85296+1352)/4`。 */
const AA_FIELD = 21662;

test('★配置门：set:EnableAntiFont 为 0（或缺键）时 message:UseAntiFont 完全不生效', () => {
  const cases: { ini: string; want: number; why: string }[] = [
    { ini: '[set]\nEnableAntiFont=0\n[message]\nUseAntiFont=1', want: 0, why: '门关着 ⇒ 引擎根本不调 sub_4155B0' },
    { ini: '[message]\nUseAntiFont=1', want: 0, why: '连 [set] 段都没有（真游戏 base 的现状）⇒ GetConfig 返 0' },
    { ini: '[set]\nEnableAntiFont=1\n[message]\nUseAntiFont=0', want: 0, why: '门开着但配置说不用 AA' },
    { ini: '[set]\nEnableAntiFont=1\n[message]\nUseAntiFont=1', want: 1, why: '★两个键都开才走 AA 路径' },
    { ini: '[set]\nEnableAntiFont=1', want: 0, why: '门开着但 message 段缺键 ⇒ 默认 0' },
  ];
  for (const c of cases) {
    const values = new Map<number, number>();
    applyConfigToEngine(parseIni(c.ini), values);
    assert.equal(values.get(AA_FIELD), c.want, `${c.why}（INI=${JSON.stringify(c.ini)}）`);
  }
});

test('★配置门：message:AntiFontLevel 与 set:Menu_UseAntiFont 不得影响 AA（引擎里它们没有渲染读者）', () => {
  const values = new Map<number, number>();
  applyConfigToEngine(
    parseIni('[set]\nEnableAntiFont=0\nMenu_UseAntiFont=1\n[message]\nUseAntiFont=1\nAntiFontLevel=3'),
    values,
  );
  assert.equal(values.get(AA_FIELD), 0, 'AntiFontLevel/Menu_UseAntiFont 不是 AA 开关');
});

test('★样式携带：main.antiAlias 恒 true —— 由**像素判据**定，不再跟随字段 21662（T-0042）', () => {
  // 引擎侧 `Font+1352` 的推导（raw 23649 门 + raw 491880 的默认 0）指向"无 AA"，但那条路径的
  // 合成结果是**纯色**（`sub_46D9F0` 的 1bpp 分支 v18/v31 恒满 ⇒ 白 255），与真机实测的
  // `α·255+(1-α)·描边 = (233,230,228)`（α<1、边缘 3px 斜坡）**互相矛盾** ⇒ 运行期走的是
  // 覆盖率路径。样式因此恒 true，压暗由 raster 的覆盖率 α 合成负责。
  const e = new Engine(new StubNative(() => {}));
  assert.equal(globalTextStyle(e).main.antiAlias, true, '默认即覆盖率路径');
  e.engineValues.set(AA_FIELD, 0);
  assert.equal(globalTextStyle(e).main.antiAlias, true, '字段 21662 = 0 也不改判据（实测像素优先）');
  e.engineValues.set(AA_FIELD, 1);
  assert.equal(globalTextStyle(e).main.antiAlias, true);
});

test('★阈值化：AA 关闭时边缘 alpha 只取 {0,255}（GDI 锯齿字形），颜色不动', () => {
  // 造一张 2×1 的"假 canvas"：第 0 像素半透明边缘（127）、第 1 像素 200（应记满不透明）
  const data = new Uint8ClampedArray([
    255, 255, 255, 127, // 半透明边缘（< 128 ⇒ 清掉）
    10, 20, 30, 200, // 偏实（>= 128 ⇒ 记满）
  ]);
  let written = false;
  const ctx = {
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      assert.equal(w, 2);
      assert.equal(h, 1);
      return { data, width: w, height: h } as unknown as ImageData;
    },
    putImageData: () => {
      written = true;
    },
  } as unknown as CanvasRenderingContext2D;

  const changed = thresholdAlpha(ctx, 2, 1);
  assert.equal(changed, 2, '两个中间值都被改写');
  assert.equal(data[3], 0, '127 < 128 ⇒ 全透明（锯齿边缘不发光）');
  assert.equal(data[7], 255, '200 >= 128 ⇒ 满不透明');
  assert.deepEqual([data[0], data[1], data[2]], [255, 255, 255], '颜色通道不动');
  assert.deepEqual([data[4], data[5], data[6]], [10, 20, 30], '颜色通道不动（含暗色像素）');
  assert.equal(written, true, '有改动才回写');
});

test('阈值化：本来就是 0/255 的像素不产生改写（幂等 + 不白跑 putImageData）', () => {
  const data = new Uint8ClampedArray([1, 2, 3, 0, 4, 5, 6, 255]);
  let written = false;
  const ctx = {
    getImageData: (_x: number, _y: number, w: number, h: number) =>
      ({ data, width: w, height: h }) as unknown as ImageData,
    putImageData: () => {
      written = true;
    },
  } as unknown as CanvasRenderingContext2D;
  assert.equal(thresholdAlpha(ctx, 2, 1), 0);
  assert.equal(written, false);
});

test('★覆盖率 α：白字落在 α·255+(1-α)·描边上，正好是真机实测的 (233,230,228)', () => {
  // 引擎 `sub_46D9F0`（raw 84893-84898 / 84996-85011）：α = 255·cov/17，cov=15 ⇒ 225。
  assert.equal(TEXT_FILL_ALPHA, 225 / 255, 'α 常量 = 255*15/17 / 255');
  const a = TEXT_FILL_ALPHA;
  const blend = (dst: number): number => a * 255 + (1 - a) * dst;
  // 序章旁白：描边实测 ≈ (63,32,16)（真机像素剖面）⇒ 引擎侧实测量 **(233,230,228)**。
  // 整数截断/描边实际取值有 ±1~2 的差，这里只钉"模型落在实测值上"。
  const got = [blend(63), blend(32), blend(16)];
  const want = [233, 230, 228];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(got[i]! - want[i]!) <= 2, `通道 ${i}: α 合成 ${got[i]!.toFixed(1)} ≈ 实测 ${want[i]}`);
  }
  // 满覆盖上限（cov=16 ⇒ 240）也不到 255 ⇒ "白字永不纯白"
  const maxA = 255 * 16 / 17 / 255;
  assert.ok(Math.round(maxA * 255) < 255, '覆盖率达上限也不产生纯白');
});

/**
 * ★**透明表面上的字形写入**（`T-0042` 残留：设置界行标签 255 → 真机 226-234 暖）。
 *
 * `0x204` draw-string 的槽表面是 `create-texture` 出来的空白 A8R8G8B8：引擎把**覆盖率 α 写进
 * 表面的 alpha**（`A = max(A_dst, α)`，raw 84873-85011 / 机器码 0x46DDC0-0x46DE7E），
 * 之后 `draw-texture` 按这个 alpha 合成 ⇒ 白字落在 `α·255 + (1−α)·底板` 上（暖灰），不是纯白。
 * canvas 的 `source-over` 会把描边遍 + 填充遍的 alpha 累加（≈1）⇒ 必须逐像素复现引擎的写入。
 */
test('★透明表面字形写入：A_dst=0 ⇒ RGB=原色、A=α（而不是不透明）', () => {
  const d = new Uint8ClampedArray([0, 0, 0, 0]);
  engineGlyphPixel(d, 0, 255, 255, 255, 225); // 白字、α = 255·15/17
  assert.deepEqual([...d], [255, 255, 255, 225], 'alpha 留下覆盖率 α（这正是"白字永不纯白"的来源）');
});

test('★透明表面字形写入：已有像素按 α 混合、alpha 取 max（引擎不是 source-over 累加）', () => {
  // 第一遍：描边副本（白）落在透明表面上
  const d = new Uint8ClampedArray([0, 0, 0, 0]);
  engineGlyphPixel(d, 0, 0, 0, 0, 225); // 黑描边
  assert.deepEqual([...d], [0, 0, 0, 225]);
  // 第二遍：白填充叠在描边上 ⇒ RGB 按 α 混合、A 仍是 225（**不是** 225+α(255−225)）
  engineGlyphPixel(d, 0, 255, 255, 255, 225);
  assert.deepEqual([...d], [225, 225, 225, 225], 'RGB = (255·225 + 0·30)/255 = 225');
  // 白填充 + 白描边（CONFIG1 设置界行标签的样式）：表面 RGB = 255，alpha = 225
  const w = new Uint8ClampedArray([0, 0, 0, 0]);
  engineGlyphPixel(w, 0, 255, 255, 255, 225);
  engineGlyphPixel(w, 0, 255, 255, 255, 225);
  assert.deepEqual([...w], [255, 255, 255, 225]);
  // ⇒ 合成到设置界底板 (65,47,40) 上 = α·255 + (1−α)·底板 ≈ (233,231,230) 暖
  const bg = [65, 47, 40];
  const out = bg.map((b) => Math.round((225 / 255) * 255 + (30 / 255) * b));
  assert.deepEqual(out, [233, 231, 230], '正是真机实测的行标签区间（226-234 暖）');
});

test('★透明表面字形写入：已经是不透明的表面 ⇒ 只按 α 混合，alpha 不被压', () => {
  // 消息窗表面有底色（A_dst = 255）⇒ 引擎的写入退化成"RGB 按 α 混合、A 恒 255"，
  // 与 canvas 的直接绘制等价 ⇒ 这条路径（rasterFrame）不需要逐像素合成。
  const d = new Uint8ClampedArray([20, 20, 20, 255]);
  engineGlyphPixel(d, 0, 255, 255, 255, 225);
  assert.deepEqual([...d], [227, 227, 227, 255], 'α 混合后仍不透明（不产生第二层 α 压暗）');
});

test('★透明表面字形写入：满覆盖（α=255，1bpp 路径）⇒ 纯色不透明', () => {
  const d = new Uint8ClampedArray([10, 20, 30, 0]);
  engineGlyphPixel(d, 0, 255, 255, 255, 255);
  assert.deepEqual([...d], [255, 255, 255, 255], 'AA 关时 α 恒满 ⇒ 纯色（T-0035 的 1bpp 分支）');
});
