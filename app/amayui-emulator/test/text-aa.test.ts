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
 * 本文件钉三件事：① 配置门的两键语义；② 样式把它带到渲染侧；③ 阈值化本身的行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { applyConfigToEngine, parseIni } from '../src/engineConfig.js';
import { globalTextStyle } from '../src/vm/handlers/msgwin.js';
import { thresholdAlpha } from '../src/renderer/text/raster.js';

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

test('★样式携带：globalTextStyle().main.antiAlias 来自字段 21662（默认 false = 锯齿）', () => {
  const e = new Engine(new StubNative(() => {}));
  assert.equal(globalTextStyle(e).main.antiAlias, false, '未灌配置时引擎字段是 0（raw 78755 的初值）');
  e.engineValues.set(AA_FIELD, 1);
  assert.equal(globalTextStyle(e).main.antiAlias, true);
  e.engineValues.set(AA_FIELD, 0);
  assert.equal(globalTextStyle(e).main.antiAlias, false);
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
