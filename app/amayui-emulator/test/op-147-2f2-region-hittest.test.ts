/** @tier T0 @kind core @subsystem render */

/**
 * ★`0x147` / `0x2F2` **GDI 区域命中测试**（`sub_42FD60` raw 39655-39702 / `sub_4318A0` raw 40687-40721）
 * —— 合成指令守卫（`tickets/T-0093` 第②半）。
 *
 * 为什么必须有这个文件：这两条此前在 `analysis/opcode-gaps.json` 里是 `deferred`（理由写的是
 * "需要先建 GDI region 原语"），**一条守卫都没有**；而它们的语义全在 GDI 的 region 细节里
 * （WINDING ≠ 奇偶、`PtInRegion` 半开区间、`CreateEllipticRgnIndirect` 的逐行跨度与
 * `right--/bottom--` 内缩），改坏了不会有任何东西报警。本文件把**体里的每一处判据**钉住：
 *
 * | 判据 | 依据（raw 行） | 本文件的测试 |
 * |---|---|---|
 * | `op2/op3` = 点，`op4/op5` = **两张数组的基址**（x/y 分开取） | 39671-39674、39684-39685 | 「命中/未命中」「x 取 op4 / y 取 op5」 |
 * | `op4/op5` **只读**（体里没有任何写回） | 39684-39685 全程只解引用读 + `v2++` | 「只读源数组」 |
 * | `CreatePolygonRgn(..., 2)` = **WINDING** | 39689 | 「WINDING 不是奇偶」 |
 * | `PtInRegion` 左/上含、右/下不含 | 39692-39693 + GDI 半开区间 | 「边界口径」 |
 * | `n`（op6）门：`n < 2` 不加边 ⇒ 空区 | 39679 `if (v3 > 0)` + GDI `count < 2` | 「n ≤ 1 / n = 2」 |
 * | `op5/op6` = 椭圆矩形的 x/y 偏移，**加在 DEC 之后** | 40705-40708 | 「偏移加在 DEC 之后」 |
 * | `op4` 四格顺序 = left/right/top/bottom | 40705-40708 | 「四格顺序」 |
 * | 椭圆 = **逐行跨度的内切椭圆**（不是解析式椭圆） | 40709（`CreateEllipticRgnIndirect`） | 「逐行跨度」「包围盒角上不命中」 |
 * | 退化矩形（`ew<2`/`eh<2`）走 `CreateRectRgn` 分支 | GDI `CreateRoundRectRgn` 713-714 | 「退化矩形」 |
 *
 * GDI 语义的判据与存疑处写在本模块头部（`src/vm/handlers/region-hittest.ts`）：wine 的
 * `dlls/win32u/region.c`（与 NT GDI 同源的 X11/MIT region 扫描转换）与
 * `dlls/gdi32/objects.c`（`CreatePolygonRgn` = `CreatePolyPolygonRgn(pts,&count,1,mode)` 直传）。
 *
 * 本地槽布局（本文件私有约定，不对应任何真实脚本；语料实证见 `src/CONFIGCV.txt:380` 与
 * `src/REIGN.txt:550`）：`0` = op1（结果）、`1/2` = 点 (x,y)、`0x10..` = x 数组 / 矩形四格、
 * `0x20..` = y 数组。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { dec, enc } from '../src/vm/bits.js';
import { gdiPolygonWindingHit } from '../src/vm/handlers/region-hittest.js';
import { im, instr, loc, mkEngine } from './harness.js';

const XS = 0x10;
const YS = 0x20;

/** 逐条跑一次 `i147`；返回 op1 与两张源数组**跑完后**的解码值（用来验"不写回"）。 */
function run147(cs: {
  x: number;
  y: number;
  xs: number[];
  ys: number[];
  n: number;
  /** 不写这些下标（复刻"脚本只登记基址、个别格没写过"）。 */
  omitXs?: number[];
  key?: number;
}): { hit: number; xArr: (number | null)[]; yArr: (number | null)[] } {
  const e = mkEngine([]);
  const f = e.curScript();
  e.key = (cs.key ?? 0) >>> 0;
  const set = (slot: number, v: number): void => void f.locals.int.set(slot, enc(e.key, v));
  set(1, cs.x);
  set(2, cs.y);
  const omit = new Set(cs.omitXs ?? []);
  cs.xs.forEach((v, i) => {
    if (!omit.has(i)) set(XS + i, v);
  });
  cs.ys.forEach((v, i) => {
    if (!omit.has(i)) set(YS + i, v);
  });
  // ★op2/op3 用**局部槽**（与两个真实调用点一致）；op6 用立即数（语料就是 `… 4`）
  const ins = instr(0x147, [loc(0), loc(1), loc(2), loc(XS), loc(YS), im(cs.n)]);
  const h = OPS.get(0x147);
  assert.ok(h, '0x147 必须注册在已实现表（不是 native 桩 / no-op）');
  h(makeCtx(e, f, ins, new StubNative(() => {}), () => {}));
  /** 解码一个槽；**没写过的槽返回 null**（而不是 dec(key,0) 的垃圾）。 */
  const rd = (slot: number): number | null =>
    f.locals.int.has(slot) ? dec(e.key, f.locals.int.get(slot)!) | 0 : null;
  const hit = rd(0);
  assert.notEqual(hit, null, 'op1 必须被写（引擎 39693/39699 两条路径都写 op1）');
  return { hit: hit!, xArr: cs.xs.map((_, i) => rd(XS + i)), yArr: cs.ys.map((_, i) => rd(YS + i)) };
}

/** 逐条跑一次 `i2f2`；返回 op1 与矩形四格**跑完后**的解码值。 */
function run2f2(cs: {
  x: number;
  y: number;
  /** ★**体里的顺序**：`[left, right, top, bottom]`（raw 40705-40708 的 `v2[0..3]`）。 */
  lrtb: [number, number, number, number];
  offX: number;
  offY: number;
  key?: number;
}): { hit: number; rectAfter: (number | null)[] } {
  const e = mkEngine([]);
  const f = e.curScript();
  e.key = (cs.key ?? 0) >>> 0;
  const set = (slot: number, v: number): void => void f.locals.int.set(slot, enc(e.key, v));
  set(1, cs.x);
  set(2, cs.y);
  cs.lrtb.forEach((v, i) => set(XS + i, v));
  const ins = instr(0x2f2, [loc(0), loc(1), loc(2), loc(XS), im(cs.offX), im(cs.offY)]);
  const h = OPS.get(0x2f2);
  assert.ok(h, '0x2f2 必须注册在已实现表（不是 native 桩 / no-op）');
  h(makeCtx(e, f, ins, new StubNative(() => {}), () => {}));
  const rd = (slot: number): number | null =>
    f.locals.int.has(slot) ? dec(e.key, f.locals.int.get(slot)!) | 0 : null;
  const hit = rd(0);
  assert.notEqual(hit, null, 'op1 必须被写（引擎 40713/40719 两条路径都写 op1）');
  return { hit: hit!, rectAfter: cs.lrtb.map((_, i) => rd(XS + i)) };
}

test('★0x147/0x2F2：都注册在真实现表（不是 native 桩 / no-op）', () => {
  for (const op of [0x147, 0x2f2]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须在 OPS`);
    assert.ok(
      !NATIVE_OPS.has(op) && !ENGINE_INTERNAL_OPS.has(op),
      `0x${op.toString(16)} 不得同时在 native 桩 / no-op 表里（会被静默掩盖）`,
    );
  }
});

test('★0x147：命中/未命中都写 op1 = 1/0（raw 39692-39693；不是 −1、不是记录下标）', () => {
  const square = { xs: [0, 10, 10, 0], ys: [0, 0, 10, 10], n: 4 };
  assert.equal(run147({ ...square, x: 5, y: 5 }).hit, 1, '方形内 ⇒ 1');
  assert.equal(run147({ ...square, x: 15, y: 5 }).hit, 0, '右侧外 ⇒ 0');
  assert.equal(run147({ ...square, x: -1, y: 5 }).hit, 0, '左侧外 ⇒ 0');
  assert.equal(run147({ ...square, x: 5, y: -1 }).hit, 0, '上方外 ⇒ 0');
  assert.equal(run147({ ...square, x: 5, y: 11 }).hit, 0, '下方外 ⇒ 0');
});

test('★0x147：x 取 op4 数组、y 取 op5 数组（两张独立表逐点配对；raw 39684-39685）', () => {
  // 横向 20×10 矩形
  assert.equal(run147({ xs: [0, 20, 20, 0], ys: [0, 0, 10, 10], n: 4, x: 15, y: 5 }).hit, 1);
  // ★同样的数字**交换两张表** ⇒ 变成纵向 10×20 矩形 ⇒ 同一个点必须变未命中
  assert.equal(run147({ xs: [0, 0, 10, 10], ys: [0, 20, 20, 0], n: 4, x: 15, y: 5 }).hit, 0);
});

test('★0x147：fill mode = 2 是 **WINDING**（绕数 ≠ 0），不是奇偶（raw 39689）', () => {
  // 同一个方形**绕两圈**（8 个顶点，绕数 = ±2）：WINDING 下命中；奇偶规则下穿越数为偶数 ⇒ 会被挖空
  assert.equal(
    run147({ xs: [0, 10, 10, 0, 0, 10, 10, 0], ys: [0, 0, 10, 10, 0, 0, 10, 10], n: 8, x: 5, y: 5 }).hit,
    1,
    '绕两周的方形内部必须命中 ⇒ 实现的是 WINDING（若写成奇偶，这里会是 0）',
  );
  // 对照：同样形状只绕一圈 ⇒ 两种规则都给命中（说明上面那条的差异只能来自填充规则）
  assert.equal(run147({ xs: [0, 10, 10, 0], ys: [0, 0, 10, 10], n: 4, x: 5, y: 5 }).hit, 1);
  // 自交"领结"(0,0)(10,10)(10,0)(0,10)：左右两瓣绕数 ±1 ⇒ WINDING 下**两瓣都命中**
  const bowtie = { xs: [0, 10, 10, 0], ys: [0, 10, 0, 10], n: 4 };
  assert.equal(run147({ ...bowtie, x: 2, y: 5 }).hit, 1, '左瓣（绕数 +1）⇒ 命中');
  assert.equal(run147({ ...bowtie, x: 8, y: 5 }).hit, 1, '右瓣（绕数 −1）⇒ 命中');
  assert.equal(run147({ ...bowtie, x: 5, y: 2 }).hit, 0, '两瓣之外 ⇒ 未命中');
});

test('★0x147：GDI region 边界口径 —— 左/上含、右/下不含（`PtInRegion` 半开区间）', () => {
  const square = { xs: [0, 10, 10, 0], ys: [0, 0, 10, 10], n: 4 };
  assert.equal(run147({ ...square, x: 0, y: 5 }).hit, 1, '左边上（含）');
  assert.equal(run147({ ...square, x: 5, y: 0 }).hit, 1, '上边上（含）');
  assert.equal(run147({ ...square, x: 0, y: 0 }).hit, 1, '左上顶点（含）');
  assert.equal(run147({ ...square, x: 10, y: 5 }).hit, 0, '右边上（不含）');
  assert.equal(run147({ ...square, x: 5, y: 10 }).hit, 0, '下边上（不含）');
  assert.equal(run147({ ...square, x: 10, y: 10 }).hit, 0, '右下顶点（不含）');
  assert.equal(run147({ ...square, x: 9, y: 9 }).hit, 1, '右下角内侧 1px 仍命中');
});

test('★0x147：n ≤ 1 ⇒ 空区域（GDI `count < 2` 不加任何边）；n = 3 起是真多边形', () => {
  assert.equal(run147({ xs: [0, 10], ys: [0, 10], n: 0, x: 0, y: 0 }).hit, 0, 'n = 0 ⇒ 0');
  assert.equal(run147({ xs: [0], ys: [0], n: 1, x: 0, y: 0 }).hit, 0, 'n = 1 ⇒ 0');
  assert.equal(run147({ xs: [0, 10], ys: [0, 10], n: 2, x: 5, y: 5 }).hit, 0, 'n = 2（两条反向边互相抵消 ⇒ 零面积）');
  // 三角形 (0,0)(10,0)(5,10)：内部 (5,1)，外部 (5,9)
  const tri = { xs: [0, 10, 5], ys: [0, 0, 10], n: 3 };
  assert.equal(run147({ ...tri, x: 5, y: 1 }).hit, 1, 'n = 3 参与判定');
  assert.equal(run147({ ...tri, x: 5, y: 9 }).hit, 0);
});

test('★0x147/0x2F2：源数组**只读** —— 两条体里都没有任何写回（★推翻筛体「另按 op4/op5 顺带写回」）', () => {
  const r1 = run147({ xs: [0, 10, 10, 0], ys: [0, 0, 10, 10], n: 4, x: 5, y: 5 });
  assert.equal(r1.hit, 1);
  assert.deepEqual(r1.xArr, [0, 10, 10, 0], 'op4 的 4 格必须原样（引擎只解引用读 + `v2++`）');
  assert.deepEqual(r1.yArr, [0, 0, 10, 10], 'op5 的 4 格必须原样');
  const r2 = run2f2({ x: 4, y: 5, lrtb: [0, 10, 0, 10], offX: 0, offY: 0 });
  assert.equal(r2.hit, 1);
  assert.deepEqual(r2.rectAfter, [0, 10, 0, 10], 'op4 的 4 格必须原样（left/right/top/bottom 只读）');
});

test('★0x147：key ≠ 0 时 DEC 链一致；未写过的格按引擎口径读 0（不是 dec(key,0) 的垃圾）', () => {
  const key = 0x12345678;
  assert.equal(
    run147({ xs: [0, 10, 10, 0], ys: [0, 0, 10, 10], n: 4, x: 5, y: 5, key }).hit,
    1,
    'key ≠ 0：op2/op3 与两张数组都过 DEC ⇒ 同一结论',
  );
  // x 数组第 0 格**留空**（复刻"脚本只登记基址、值未必写"）。key = 1 时 `dec(key,0) = 128`：
  // 若按稀疏 Map 的缺省取值，顶点会被搬到 x=128 ⇒ 那个"方角"就不含 (5,5) 了。
  const omit = run147({ xs: [0, 10, 10, 0], ys: [0, 0, 10, 10], n: 4, x: 5, y: 5, key: 1, omitXs: [0] });
  assert.equal(omit.hit, 1, '未写过的格必须读 0（= 引擎装载时整池填 enc_zero 的口径）');
  assert.equal(omit.xArr[0], null, '该格确实没有被本指令写回（否则上面那条无从判别）');
});

test('★0x2F2：椭圆内命中 / 包围盒角上未命中（内切椭圆，raw 40709-40713）', () => {
  // 矩形 (0,0)-(10,10) 在体里是 `[left, right, top, bottom]` = [0,10,0,10]
  const lrtb: [number, number, number, number] = [0, 10, 0, 10];
  const hit = (x: number, y: number): number => run2f2({ x, y, lrtb, offX: 0, offY: 0 }).hit;
  assert.equal(hit(4, 5), 1, '中线行 y=5 的 span = [0,9)');
  assert.equal(hit(0, 5), 1, '同一行左端（含）');
  assert.equal(hit(9, 5), 0, '★右端半开：x=9 不在 [0,9)');
  assert.equal(hit(0, 0), 0, '★包围盒左上角在椭圆**外** —— 这正说明它不是矩形 region');
  assert.equal(hit(4, 0), 1, '顶行 span = [3,6)（极窄）');
  assert.equal(hit(2, 0), 0, '顶行左外');
  assert.equal(hit(6, 0), 0, '顶行右外（半开）');
  assert.equal(hit(0, 1), 0, '第二行 span = [1,8)：x=0 已在椭圆外');
  assert.equal(hit(1, 1), 1);
  assert.equal(hit(4, 8), 1, '★上下镜像：y=8 与 y=0 同跨度 [3,6)');
  assert.equal(hit(4, 9), 0, '盒底下一行不在 region 里（盒 = [0,9)×[0,9)）');
});

test('★0x2F2：op4 的四格顺序严格是 left/right/top/bottom（raw 40705-40708）', () => {
  // 横扁：left=0 / right=10 / top=0 / bottom=3 ⇒ 盒 [0,9)×[0,2)，两行整宽
  assert.equal(run2f2({ x: 5, y: 1, lrtb: [0, 10, 0, 3], offX: 0, offY: 0 }).hit, 1);
  assert.equal(run2f2({ x: 5, y: 4, lrtb: [0, 10, 0, 3], offX: 0, offY: 0 }).hit, 0, 'y=4 在盒外');
  // 竖窄：同样四个数字换成 left=0 / right=3 / top=0 / bottom=10 ⇒ 盒 [0,2)；若把中间两格读反，结论会翻转
  assert.equal(run2f2({ x: 5, y: 1, lrtb: [0, 3, 0, 10], offX: 0, offY: 0 }).hit, 0, '细高椭圆里 x=5 在盒外');
  assert.equal(run2f2({ x: 0, y: 4, lrtb: [0, 3, 0, 10], offX: 0, offY: 0 }).hit, 1, '中线行（y=4）整宽');
  assert.equal(run2f2({ x: 1, y: 4, lrtb: [0, 3, 0, 10], offX: 0, offY: 0 }).hit, 1);
  assert.equal(run2f2({ x: 2, y: 4, lrtb: [0, 3, 0, 10], offX: 0, offY: 0 }).hit, 0, 'span 半开右端不含');
});

test('★0x2F2：op5/op6 是 x/y 偏移，且加在 DEC **之后**（raw 40705-40708）', () => {
  const lrtb: [number, number, number, number] = [0, 10, 0, 10];
  // 平移 (100, 7)：region 跑到 [100,109) × [7,16)
  assert.equal(run2f2({ x: 104, y: 12, lrtb, offX: 100, offY: 7 }).hit, 1, '平移后的中线行');
  assert.equal(run2f2({ x: 4, y: 5, lrtb, offX: 100, offY: 7 }).hit, 0, '原位置已不在 region 里');
  assert.equal(run2f2({ x: 104, y: 5, lrtb, offX: 100, offY: 7 }).hit, 0, 'y 偏移也必须生效（y=5 < 7）');
  // ★key ≠ 0：若实现把偏移加到 **ENC 后的原始值**上再解码，结论会崩（这正是"加在 DEC 之后"的判别）
  assert.equal(run2f2({ x: 104, y: 12, lrtb, offX: 100, offY: 7, key: 0x5a5a5a5a }).hit, 1);
  assert.equal(run2f2({ x: 4, y: 5, lrtb, offX: 100, offY: 7, key: 0x5a5a5a5a }).hit, 0);
});

test('★0x2F2：退化矩形 —— 0 高/0 宽不含自身包围盒内的点；极扁(2 宽)退化成 1px 竖列', () => {
  assert.equal(run2f2({ x: 5, y: 0, lrtb: [0, 10, 0, 0], offX: 0, offY: 0 }).hit, 0, '0 高的"椭圆"');
  assert.equal(run2f2({ x: 3, y: 5, lrtb: [0, 0, 0, 10], offX: 0, offY: 0 }).hit, 0, '0 宽的"椭圆"');
  // ew < 2 ⇒ GDI 走 `CreateRectRgn` 分支（CreateRoundRectRgn 713-714）：2×10 的"椭圆 region"
  // = 左起 1px 竖列 [0,1) × [0,9)
  assert.equal(run2f2({ x: 0, y: 5, lrtb: [0, 2, 0, 10], offX: 0, offY: 0 }).hit, 1);
  assert.equal(run2f2({ x: 1, y: 5, lrtb: [0, 2, 0, 10], offX: 0, offY: 0 }).hit, 0, 'span 半开右端不含');
});

test('★0x147 的纯几何内核在 n = 0 时不读任何点（不着越界）', () => {
  // 直接钉内核：n = 0 / n = 1 / n = 2 ⇒ 恒 false（GDI `count < 2` 不加边；n = 2 零面积）
  assert.equal(gdiPolygonWindingHit([], 0, 0, 0), false);
  assert.equal(gdiPolygonWindingHit([5, 5], 1, 5, 5), false);
  assert.equal(gdiPolygonWindingHit([0, 0, 10, 10], 2, 5, 5), false);
  // 正方形（含左/上边、不含右/下边）的四个典型点
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(gdiPolygonWindingHit(square, 4, 0, 0), true);
  assert.equal(gdiPolygonWindingHit(square, 4, 10, 10), false);
});
