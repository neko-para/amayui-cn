/** @tier T0 @kind core @subsystem render */

/**
 * `T-0155` 的 **VM 半边**守卫（`src/vm/handlers/gfx-state.ts` + `src/vm/handlers/gfx-item.ts`）。
 *
 * 三条**纯操作数 I/O / 几何**缺陷（审计 §5.1 批次 `gfx-item`，逐条带 raw 锚点）：
 *
 *  1. **`0x32d` 的字节→通道映射写反**（P2）。引擎（`sub_427040` raw 34033-34054）：
 *     ```
 *     v2 = min(op1, 255)                                                      // alpha
 *     v4 = (u8)op2 | ((BYTE1(op2) | (((v2 << 8) | BYTE2(op2)) << 8)) << 8)     // ARGB：B=u8 / G=BYTE1 / R=BYTE2 / A=v2
 *     r = BYTE2(v4)·dbl_51FA60 ; g = BYTE1(op2)·dbl_51FA60
 *     b = (u8)op2·dbl_51FA60   ; a = HIBYTE(v4)·dbl_51FA60                     // dbl_51FA60 = 1/255，raw 4392
 *     ```
 *     轴向与 `sub_499DF0`（raw 116637 `_this[13947] = R|((G|((B|(A<<8))<<8))<<8)`）逐位交叉核对：
 *     `a2` = **红 = op2 的第三字节**（`>>16`）、`a4` = **蓝 = 最低字节**。修前 emulator 把最低字节当红、
 *     第三字节当蓝 ⇒ 所有 `0x32d` 下发的颜色**红蓝互换**（不报错、只在画面上错）。
 *  2. **`0x320` 的顶点位置半像素偏移**（P2）。引擎把顶点位置写成 `x − 0.5` / `y − 0.5`
 *     （`dbl_51D7F8 = 0.5`，raw 4197）：两条路都做 —— `sub_4A1F00`（raw 122235-122238，**create-mesh
 *     走的这条**：`sub_432150` → `sub_4ADFE0` → `sub_4A2280` → `sub_4A1F00`）与 `sub_4A3590`
 *     （raw 123309-123316，DrawPrimitive）。修前 emulator 直接把数组值当屏幕像素 ⇒ 整块几何偏 (+0.5, +0.5)。
 *  3. **`0x33f` 的 op2/op3 两格整体没读**（P2）。引擎 `sub_427A90` raw 34423-34446 三格全读：
 *     `op2` = α（>255 钳 255；<0 ⇒ 由 op1 索取的绘制项**当前 α**）、`op3` = 颜色（<0 ⇒ 该项**当前色**）。
 *
 * ★本文件只钉 **VM handler 的可观测输出**（宿主缝收到的实参 + 操作数触点）。三条的 renderer 半边
 * （`0x258` 镜像表、`Scene+1264` 效果常量通路、`makeMesh` 的 state 初值）**不在本单元范围**，
 * 逐条记在 `tickets/T-0155/changes-gfxstate.md` 的「未做项」与「renderer 半边的耦合点」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';import { StubNative, type NativeBridge } from '../src/vm/native.js';
import type { Engine } from '../src/vm/engine.js';
import { enc } from '../src/vm/bits.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, mkEngine, trackArgs } from './harness.js';
import { stepOnce } from '../src/vm/interpreter.js';

/** 全局 int **数组**操作数（`0x8003`）：`0x320` 的 7 个"数组基址"位就是这一种。 */
const gIntArray = (slot: number): BinArg => ({ type: 0x8003, raw: slot }) as unknown as BinArg;

/**
 * 把 float 写进**全局 int 槽的位模式**（引擎侧 float 数组就住在同一块内存里）。
 *
 * ★必须过 `enc`：引擎池里存的是编码后的 u32（读侧 `DEC` 一次）。手写 `0x3f800000` 会被再 DEC 一次
 * ⇒ 解出 0x7FFFFFFF 这类垃圾（本文件的第一版就踩了这个）。
 */
function putFloatBits(e: Engine, slot: number, v: number): void {
  const f32 = new Float32Array([v]);
  const i32 = new Int32Array(f32.buffer);
  e.globals.int.set(slot, enc(e.key, i32[0]!));
}

/**
 * 录制型宿主：只记「哪个缝、收到了什么」。
 *
 * 为什么不复用 `test/harness.ts` 的 `RecordingAudioNative`：那是**音频**意图记录器，
 * 而本单元要记的是 `set3DColor` / `setSceneBlend` / `createMesh` 三条渲染缝，形状不同。
 */
class SeamRecorder extends StubNative {
  readonly calls: Array<{ seam: string; args: number[] }> = [];
  /** `createMesh` 的完整 spec（含 `verts` 对象数组，`args: number[]` 表达不了）。 */
  readonly meshes: Array<{
    handle: number;
    layer: number;
    vcount: number;
    verts: Array<{ x: number; y: number; z: number; u: number; v: number }>;
    baseColors: number[];
  }> = [];
  constructor() {
    super(() => {});
  }
  // ★这里是**新增**桥方法（不是覆写）：`StubNative` 自己没有 `set3DColor`（它是可选缝，
  //   桩宿主不实现 ⇒ 0x32d 的下发在桩上被丢弃）⇒ 不能写 `override`（TS4117：基类没有该成员）。
  set3DColor(r: number, g: number, b: number, a: number): void {
    this.calls.push({ seam: 'set3DColor', args: [r, g, b, a] });
  }
  override setSceneBlend(blend: number): void {
    this.calls.push({ seam: 'setSceneBlend', args: [blend] });
  }
  override createMesh(spec: {
    handle: number;
    layer: number;
    vcount: number;
    verts: Array<{ x: number; y: number; z: number; u: number; v: number }>;
    baseColors: number[];
  }): void {
    this.calls.push({ seam: 'createMesh', args: [spec.handle, spec.layer, spec.vcount] });
    this.meshes.push({ ...spec, verts: spec.verts.map((v) => ({ ...v })) });
  }
  /** 该缝唯一一条调用的实参（0 条或 ≥2 条都直接失败，失败信息里给出"其实收到了什么"）。 */
  only(seam: string): number[] {
    const hit = this.calls.filter((c) => c.seam === seam);
    assert.equal(hit.length, 1, `${seam} 应恰好被调用一次，实际 ${hit.length} 次（全部调用：${JSON.stringify(this.calls)}）`);
    return hit[0]!.args;
  }
}

test('★0x32d：op1=α、op2 第三字节=红、最低字节=蓝（raw 34046-34053 + sub_499DF0 raw 116637）', async () => {
  // 非对称色 0x336699：R=0x33 / G=0x66 / B=0x99 —— 修前的"最低字节当红"会给出 (0x99,0x66,0x33)。
  const rec = new SeamRecorder();
  const e = mkEngine([instr(0x32d, [im(0x80), im(0x336699)])], 'T0155.BIN', rec);
  await stepOnce(e);
  const [r, g, b, a] = rec.only('set3DColor');
  assert.deepEqual(
    [r, g, b, a],
    [0x33 / 255, 0x66 / 255, 0x99 / 255, 0x80 / 255],
    '★轴向：红 = `op2 >> 16`、绿 = `op2 >> 8`、蓝 = `op2 & 0xff`（各 ÷255 = `dbl_51FA60` raw 4392）',
  );

  // 逐通道独立可判：只给蓝 ⇒ 必须落在**第 3** 个分量（修前落到第 1 个）。
  const rec2 = new SeamRecorder();
  await stepOnce(mkEngine([instr(0x32d, [im(255), im(0x0000ff)])], 'T0155.BIN', rec2));
  assert.deepEqual(rec2.only('set3DColor'), [0, 0, 1, 1], '`i32d 255 ff` = 纯蓝不透明');

  // α > 255 钳到 255（raw 34046-34047）；α<0 不钳（引擎只判 `> 255`）。
  const rec3 = new SeamRecorder();
  await stepOnce(mkEngine([instr(0x32d, [im(0x1ff), im(0)])], 'T0155.BIN', rec3));
  assert.deepEqual(rec3.only('set3DColor'), [0, 0, 0, 1], 'α > 255 ⇒ 钳 255（不是 `a & 0xff`）');
});

test('★0x320：顶点位置 `x − 0.5` / `y − 0.5`（sub_4A1F00 raw 122235-122238，create-mesh 走这条）', async () => {
  const rec = new SeamRecorder();
  // 语料形态（满屏四边形）：x = (0, 0x500, 0, 0x500)、y = (0, 0, 0x2d0, 0x2d0)。
  const e = mkEngine(
    [instr(0x320, [
      im(0x30d40),
      gIntArray(300), gIntArray(310), gIntArray(320), // x / y / z 三个浮点数组基址
      gIntArray(350), gIntArray(360), // op5 = 逐顶点 α、op6 = 逐顶点 rgb
      gIntArray(330), gIntArray(340), // u / v
      im(4), im(0), // op9 = vcount、op10 = layer
    ])],
    'T0155.BIN',
    rec,
  );
  const xs = [0, 0x500, 0, 0x500];
  const ys = [0, 0, 0x2d0, 0x2d0];
  const zs = [0, 0, 0, 0];
  const us = [0, 1, 0, 1];
  const vs = [0, 0, 1, 1];
  // ★`op5`/`op6` 两格的数组元素是**引擎的 u32 槽值**（`sub_41BF50` 直取、不是按 float 位模式解释）
  //   ⇒ 逐顶点 α 的"1.0f"在内存里就是 0xFFFFFFFF、rgb 就是 0xFFFFFF（INIT2 的 `copy-local-array` 原样搬）。
  //   别用 `putFloatBits(350, 1)` —— 那会写进"1.0 这个**数值**的位模式"= 0x3F800000（本文件第一版踩过）。
  const alphas = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];
  const rgbs = [0xffffff, 0xffffff, 0xffffff, 0xffffff];
  for (let i = 0; i < 4; i++) {
    putFloatBits(e, 300 + i, xs[i]!);
    putFloatBits(e, 310 + i, ys[i]!);
    putFloatBits(e, 320 + i, zs[i]!);
    putFloatBits(e, 330 + i, us[i]!);
    putFloatBits(e, 340 + i, vs[i]!);
    e.globals.int.set(350 + i, enc(e.key, alphas[i]!));
    e.globals.int.set(360 + i, enc(e.key, rgbs[i]!));
  }
  await stepOnce(e);

  assert.equal(rec.meshes.length, 1, `createMesh 必须被调用（调用记录：${JSON.stringify(rec.calls)}）`);
  const m = rec.meshes[0]!;
  assert.equal(m.vcount, 4);
  assert.deepEqual(
    m.verts.map((v) => [v.x, v.y]),
    [[-0.5, -0.5], [1279.5, -0.5], [-0.5, 719.5], [1279.5, 719.5]],
    '★每个顶点的 x/y 都 −0.5（`dbl_51D7F8` raw 4197；不是四舍五入、也不是只改第一个顶点）',
  );
  assert.deepEqual(m.verts.map((v) => v.z), [0, 0, 0, 0], 'z **不减** 0.5（体里只动 `a2+0` 与 `a2+4` 两格）');
  assert.deepEqual(m.verts.map((v) => [v.u, v.v]), [[0, 0], [1, 0], [0, 1], [1, 1]], 'uv 不受偏移影响');
  assert.deepEqual(
    m.baseColors.map((c) => c >>> 0),
    [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
    '逐顶点基础色 = `(α << 24) | (rgb & 0xFFFFFF)`（语料形态 ⇒ 不透明白，喂 CalcDiffuse 的 `a2+16`）',
  );
});

test('★0x33f：op2 的 α 回退读 op1 项的当前 α、op3 的颜色回退读该项当前色（raw 34423-34446）', async () => {
  // 回退源 `sub_4ADD60(Scene, op1)` = 该项当前 ARGB（宿主缝 `getDrawItemColor`）：
  // 0x80402010 ⇒ α = 0x80、颜色 = 0x402010（红 0x40 / 绿 0x20 / 蓝 0x10）。
  const rec = new SeamRecorder() as SeamRecorder & { getDrawItemColor?: (h: number) => number };
  rec.getDrawItemColor = (h: number): number => (h === 0x777 ? 0x80402010 : -1);

  // ① op2 = −1、op3 = −1 ⇒ 两格都走回退（引擎在**钳位之前**读满三格：raw 34423-34424 先读 op2/op3）
  const { args, hits } = trackArgs([im(1), im(0x777), im(-1), im(-1)]);
  await stepOnce(mkEngine([instr(0x33f, args)], 'T0155.BIN', rec));
  assert.deepEqual(rec.only('setSceneBlend'), [1], '`Scene+1260` 的选择子仍只由 op1 承载（`Scene+1264` 通路未建模）');
  assert.deepEqual(hits(), [1, 2, 3], '★三格全读：op1（场景混合）+ op2（α）+ op3（颜色）');

  // ② op2 > 255 ⇒ 钳 255（raw 34433-34435）且**不回退**（不读该格的当前 α 之外的东西）
  const rec2 = new SeamRecorder() as SeamRecorder & { getDrawItemColor?: (h: number) => number };
  rec2.getDrawItemColor = (): number => 0x80402010;
  const { args: a2, hits: h2 } = trackArgs([im(0), im(0x777), im(0x1ff), im(0x112233)]);
  await stepOnce(mkEngine([instr(0x33f, a2)], 'T0155.BIN', rec2));
  assert.deepEqual(h2(), [1, 2, 3], '非零取值也要读满三格（引擎的 `sub_41BF50` 先于钳位）');
  assert.deepEqual(rec2.only('setSceneBlend'), [0]);
});
