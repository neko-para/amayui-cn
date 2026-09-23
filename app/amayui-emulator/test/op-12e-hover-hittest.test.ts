/** @tier T0 @kind core @subsystem render */

/**
 * ★`0x12E` **悬停命中**（`sub_42F230` raw 39199-39252，argc 8）—— 合成指令守卫。
 *
 * 为什么必须有这个文件：语料 **47 处** `i12e`（TITLE / GAMESTART / CONFIG1 / FIELD …），而这条指令
 * 在审计里同时中了三条（`op-8-F3` 遍历口径、`op-8-F4` 两道边界门 + 首项偏移、`op-2-05` 之外还有
 * 「op2 的 margin 整个丢掉」），此前**一条守卫都没有** ⇒ 改坏了没人知道。语料里 op1 多数为 1
 * （跳过前缀），所以「首项 = op1+1」是真会改变结果的分支，不是死代码。
 *
 * 逐条断言的是**引擎体的四项判据**（raw 39242 的 `(A|B|C|D) >= 0` 符号位技巧展开后）：
 * ```
 * m1 + dx - S0 >= 0 && m3 + dy - S2 >= 0 && S1 - dx - m0 >= 0 && S3 - dy - m2 >= 0
 * （dx = x - x平面[j]、dy = y - y平面[j]；S0..S3 = 记录 j 的 4 个 int；m0..m3 = op2 起 4 个 int）
 * ⇒ dx ∈ [S0 - m1, S1 - m0]、dy ∈ [S2 - m3, S3 - m2]
 * ```
 * 本地槽布局（本文件私有约定，不对应任何真实脚本）：
 * `0` = op1（起始下标/写回结果）、`1..4` = margin、`0x10..0x1f` = 盒表（每记录 4 格）、
 * `0x20..` = x 平面、`0x30..` = y 平面；op3/op4/op8 用立即数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { dec, enc } from '../src/vm/bits.js';
import { im, instr, loc, mkEngine } from './harness.js';

interface Case {
  /** op1 = 起始记录下标。 */
  start: number;
  /** op2 起的 4 个 margin（m0..m3）。 */
  margin: [number, number, number, number];
  x: number;
  y: number;
  /** 盒表：每记录 4 个 int（`[xmin, xmax, ymin, ymax]`，margin 全 0 时）。 */
  boxes: number[][];
  planeX: number[];
  planeY: number[];
  /** op8 = 记录数（遍历上界）。 */
  count: number;
  marginSlot?: number;
  boxSlot?: number;
  /** 引擎 `key`（`_this[97059]`；默认 0，非 0 用来验证"未写过的槽读 0"）。 */
  key?: number;
  /** 只登记 margin 基址、**不写**这 4 格（复刻 TITLE/CONFIG1 的用法）。 */
  leaveMarginUnwritten?: boolean;
}

const X_PLANE = 0x20;
const Y_PLANE = 0x30;

/** 跑一条 `i12e`，返回写回 op1 的命中下标（−1 = 未命中）。 */
function hover(cs: Case): number {
  const e = mkEngine([]);
  const f = e.curScript();
  if (cs.key !== undefined) e.key = cs.key >>> 0;
  const set = (slot: number, v: number): void => void f.locals.int.set(slot, enc(e.key, v));
  const marginSlot = cs.marginSlot ?? 1;
  const boxSlot = cs.boxSlot ?? 0x10;
  set(0, cs.start);
  if (!cs.leaveMarginUnwritten) cs.margin.forEach((v, i) => set(marginSlot + i, v));
  cs.boxes.forEach((b, r) => b.forEach((v, k) => set(boxSlot + 4 * r + k, v)));
  cs.planeX.forEach((v, i) => set(X_PLANE + i, v));
  cs.planeY.forEach((v, i) => set(Y_PLANE + i, v));
  const ins = instr(0x12e, [
    loc(0), // op1 = 起始下标（结果写回这里）
    loc(marginSlot), // op2 = margin 基址
    im(cs.x), // op3
    im(cs.y), // op4
    loc(boxSlot), // op5 = 盒表基址
    loc(X_PLANE), // op6
    loc(Y_PLANE), // op7
    im(cs.count), // op8
  ]);
  const h = OPS.get(0x12e);
  assert.ok(h, '0x12e 必须注册在已实现表（不是 native 桩 / no-op）');
  h(makeCtx(e, f, ins, new StubNative(() => {}), () => {}));
  return dec(e.key, f.locals.int.get(0) ?? 0) | 0;
}

test('★0x12E：注册在真实现表（不是 native 桩 / no-op）', () => {
  assert.ok(OPS.has(0x12e), '0x12e 必须在 OPS');
  assert.ok(!NATIVE_OPS.has(0x12e) && !ENGINE_INTERNAL_OPS.has(0x12e), '不得是 native 桩或 no-op');
});

test('★0x12E：首项 = op1 + 1（raw 39230），命中下标按记录表口径写回（raw 39251）', () => {
  const base = {
    margin: [0, 0, 0, 0] as [number, number, number, number],
    boxes: [
      [0, 100, 0, 100],
      [0, 100, 0, 100],
      [10, 200, 10, 200],
    ],
    planeX: [0, 0, 10],
    planeY: [0, 0, 20],
    count: 3,
    x: 50,
    y: 50,
  };
  assert.equal(hover({ ...base, start: -1 }), 0, 'op1=-1 ⇒ 首项 0 ⇒ 命中记录 0');
  assert.equal(hover({ ...base, start: 0 }), 1, 'op1=0 ⇒ 从记录 1 起（记录 0 根本不参与比较）');
  assert.equal(hover({ ...base, start: 1 }), 2, 'op1=1 ⇒ 从记录 2 起，命中记录 2（返回的是记录下标）');
});

test('★0x12E：第一道边界门——首项越界 ⇒ 直接 −1（raw 39231-39232）', () => {
  const cs: Case = {
    start: 2,
    margin: [0, 0, 0, 0],
    boxes: [
      [0, 100, 0, 100],
      [0, 100, 0, 100],
      [0, 100, 0, 100],
    ],
    planeX: [0, 0, 0],
    planeY: [0, 0, 0],
    count: 3,
    x: 50,
    y: 50,
  };
  // 首项 = 3 ≥ count = 3 ⇒ 引擎在进入循环前就返回 −1（点其实在记录 0/1/2 里，也不能命中）
  assert.equal(hover(cs), -1);
  // 首项 = 2 < 3 ⇒ 记录 2 命中 ⇒ 2（同一份数据，只差 op1）
  assert.equal(hover({ ...cs, start: 1 }), 2);
});

test('★0x12E：第二道边界门——循环尾越界 ⇒ −1（raw 39248-39249）', () => {
  const cs: Case = {
    start: -1,
    margin: [0, 0, 0, 0],
    boxes: [
      [0, 10, 0, 10],
      [20, 30, 20, 30],
    ],
    planeX: [0, 0],
    planeY: [0, 0],
    count: 2,
    x: 25,
    y: 25,
  };
  assert.equal(hover(cs), 1, '记录 0 不中、记录 1 中 ⇒ 命中 1');
  assert.equal(hover({ ...cs, x: 15, y: 15 }), -1, '两条都不中 ⇒ 尾部边界门给出 −1（不是扫过界）');
});

test('★0x12E：x/y 平面按**记录下标 j** 取（不是 4j；raw 39236-39237 两平面 +4 字节步进）', () => {
  const cs: Case = {
    start: 0,
    margin: [0, 0, 0, 0],
    boxes: [
      [0, 100, 0, 100],
      [0, 100, 0, 100],
      [0, 100, 0, 100],
    ],
    // 平面 [1] = 1000 ⇒ 记录 1 的 dx = 50 - 1000 = −950 ⇒ 不中；平面 [2] = 0 ⇒ 记录 2 命中
    planeX: [0, 1000, 0],
    planeY: [0, 1000, 0],
    count: 3,
    x: 50,
    y: 50,
  };
  // 旧实现按下标 4i 取平面（4*1 = 4 = 未写过的槽 = 0）⇒ 记录 1 会误命中并返回 1
  assert.equal(hover(cs), 2);
});

test('★0x12E：op2 的四个 margin 参与判据且符号方向与体一致（raw 39242 四项）', () => {
  const cs: Case = {
    start: -1,
    margin: [-100, 100, -100, 100], // dx ∈ [S0−m1, S1−m0] = [−100, 200]、dy ∈ [S2−m3, S3−m2] = [−100, 200]
    boxes: [[0, 100, 0, 100]],
    planeX: [0],
    planeY: [0],
    count: 1,
    x: 0,
    y: 0,
  };
  assert.equal(hover({ ...cs, x: 50, y: 50 }), 0, '盒内命中');
  assert.equal(hover({ ...cs, x: -50, y: -50 }), 0, '下界由 m1/m3 放宽到 −100');
  assert.equal(hover({ ...cs, x: 150, y: 150 }), 0, '上界由 m0/m2 放宽到 200');
  assert.equal(hover({ ...cs, x: 250, y: 0 }), -1, '超出 m0/m2 放宽后的上界 ⇒ 不命中');
  assert.equal(hover({ ...cs, x: -101, y: 0 }), -1, '超出 m1/m3 放宽后的下界 ⇒ 不命中');
  // margin 全 0（引擎 4 项就是 [xmin,xmax,ymin,ymax]）时 ±150 都在盒外
  const zero = { ...cs, margin: [0, 0, 0, 0] as [number, number, number, number] };
  assert.equal(hover({ ...zero, x: 150, y: 0 }), -1, 'margin 全 0 ⇒ 上界就是 100');
  assert.equal(hover({ ...zero, x: -50, y: 0 }), -1, 'margin 全 0 ⇒ 下界就是 0');
});

test('★0x12E：盒记录基址与 margin 基址相同时跳过该记录的比较（raw 39239-39244）', () => {
  const shared: Case = {
    start: -1,
    margin: [0, 100, 0, 100],
    boxes: [[0, 100, 0, 100]],
    planeX: [0],
    planeY: [0],
    count: 1,
    x: 50,
    y: 50,
    marginSlot: 1,
    boxSlot: 1, // ★记录 0 = local 1..4 = margin 本身 ⇒ 地址相同
  };
  assert.equal(hover(shared), -1, '地址相同 ⇒ 这次比较被跳过（不是命中）');
  assert.equal(hover({ ...shared, boxSlot: 0x10 }), 0, '同一份数值、基址不同 ⇒ 正常命中 0');
  // 地址相同只跳过**那一条**：count=2 时记录 1（local 5..8）照常参与
  const second: Case = {
    ...shared,
    margin: [0, 0, 0, 0],
    boxes: [
      [0, 100, 0, 100], // 记录 0 = local 1..4 = margin
      [0, 100, 0, 100], // 记录 1 = local 5..8
    ],
    planeX: [0, 0],
    planeY: [0, 0],
    count: 2,
  };
  assert.equal(hover(second), 1, '记录 0 被跳过、记录 1 命中 ⇒ 返回 1');
});

test('★0x12E：脚本只登记基址、不写值 ⇒ 按引擎 `enc_zero` 读 0（不是 `dec(key,0)` 的垃圾）', () => {
  const cs: Case = {
    start: -1,
    margin: [0, 0, 0, 0],
    leaveMarginUnwritten: true, // ★TITLE/CONFIG1/GAMESTART 的 margin 就是 `local 1..4`（全脚本一次都没写过）
    boxes: [[0, 100, 0, 100]],
    planeX: [0],
    planeY: [0],
    count: 1,
    x: 50,
    y: 50,
    key: 0x12345678, // 真存档装载后 `key` 非 0（`handlers/save-slot.ts` 从存档读回）
  };
  assert.equal(hover(cs), 0, '未写过的 margin 必须读 0（引擎：装载时填 `enc_zero`）');
  // 同一个 key 下若真写了 margin，行为不变
  assert.equal(hover({ ...cs, leaveMarginUnwritten: false, margin: [-100, 100, -100, 100], x: 250, y: 0 }), -1);
});
