/**
 * 回归测试：**2026 复核后升级为"真实现"的 5 条**（分析见 `.tmp/re-misc-gfx.md`）。
 *
 *  - `0x2DA`：CG 数字条记录登记（`Engine+388332+28*cgno` 的 **7 个 dword**）→ `Engine.cgDigits`；
 *  - `0x23B`：按 CG 数字条画数值 → `native.drawCgNumber`（几何在 `drawItem.ts` 的 `cgDigitItems`）；
 *  - `0x208`：**纹理尺寸 getter**，把宽高**写回脚本操作数 op2/op3**（漏实现 ⇒ 脚本层逻辑错误）；
 *  - `0x23C`：帧毫秒时钟（`_this[92333]/[92334] = timeGetTime()`，只刷时钟不渲染）；
 *  - `0x1FF`：DrawItem 像素平移（`+0x68` 用世界矩阵 / `+0x16C` work 矩阵，立即生效、无动画窗）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative, type NativeBridge } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { enc } from '../src/vm/bits.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { cgDigitItems } from '../src/renderer/drawItem.js';

const H = 0x3c;
const T_GLOBAL_INT = 0x3;
const T_LOCAL_FLOAT = 0xa;

/** 造一条指令；args = [{type, raw}, …]。 */
function script(opcode: number, args: { type: number; raw: number }[]): ScriptBinary {
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: args.length,
    args: args.map((a) => ({ type: a.type, raw: a.raw })),
    byteOffset: H,
    index: 0,
  };
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: H,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 4 + 8 * args.length),
  };
}

/** 全是全局 int 操作数（槽号从 base 起），便于用 `globals.int` 读写。 */
function globalInts(opcode: number, n: number, base = 0x100): ScriptBinary {
  return script(
    opcode,
    Array.from({ length: n }, (_, i) => ({ type: T_GLOBAL_INT, raw: base + i })),
  );
}

/** 简易 NativeBridge：记录新接口的调用。 */
class Spy implements NativeBridge {
  log(): void {}
  cg: { id: number; rec: number[]; value: number; x: number; y: number; digits: number; flags: number }[] = [];
  translations: { handle: number; x: number; y: number; z: number }[] = [];
  sizes: number[] = [];
  frameTicks = 0;
  drawCgNumber(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void {
    this.cg.push({ id, rec: [...rec], value, x, y, digits, flags });
  }
  setDrawTranslation(handle: number, x: number, y: number, z: number): void {
    this.translations.push({ handle, x, y, z });
  }
  getTextureSize(slot: number): { w: number; h: number } {
    this.sizes.push(slot);
    return { w: 640, h: 480 };
  }
  frameTick(): void {
    this.frameTicks++;
  }
}

test('0x2DA：CG 数字条记录（7 个 int）写进 Engine.cgDigits，越界编号被忽略', async () => {
  const e = new Engine(new StubNative(() => {}));
  loadScriptIntoFrame(e.curScript(), globalInts(0x2da, 8), 'TEST.BIN');
  for (let k = 0; k < 8; k++) e.globals.int.set(0x100 + k, enc(e.key, 100 + k)); // op1=100（越界！见下）
  e.globals.int.set(0x100, enc(e.key, 0)); // op1 = CG 番号 0
  await stepOnce(e);
  assert.deepEqual(e.cgDigits.get(0), [101, 102, 103, 104, 105, 106, 107], 'op2..op8 共 7 个值');

  // 番号 > 0xA ⇒ 引擎只记日志、不写
  loadScriptIntoFrame(e.curScript(), globalInts(0x2da, 8), 'TEST.BIN');
  e.globals.int.set(0x100, enc(e.key, 0xb));
  await stepOnce(e);
  assert.equal(e.cgDigits.size, 1, '越界番号不产生新记录');
});

test('0x23B：查表命中才调用 native.drawCgNumber，且把记录一并传出', async () => {
  const spy = new Spy();
  const e = new Engine(spy);
  e.cgDigits.set(3, [42, 1, 2, 16, 20, 0, 18]);
  loadScriptIntoFrame(e.curScript(), globalInts(0x23b, 7), 'TEST.BIN');
  const vals = [0x6f, 3, 1234, 300, 700, 6, 0]; // op1..op7
  vals.forEach((v, i) => e.globals.int.set(0x100 + i, enc(e.key, v)));
  await stepOnce(e);
  assert.equal(spy.cg.length, 1, 'record 存在且 rec[0]!=0 ⇒ 应调用 native');
  const c = spy.cg[0]!;
  assert.equal(c.id, 0x6f);
  assert.equal(c.value, 1234);
  assert.equal(c.digits, 6);
  assert.equal(c.x, 300);
  assert.equal(c.y, 700);
  assert.deepEqual(c.rec, [42, 1, 2, 16, 20, 0, 18]);

  // 记录不存在 ⇒ 只打日志，不调用 native
  loadScriptIntoFrame(e.curScript(), globalInts(0x23b, 7), 'TEST.BIN');
  const vals2 = [0x6f, 9, 1, 0, 0, 2, 0];
  vals2.forEach((v, i) => e.globals.int.set(0x100 + i, enc(e.key, v)));
  await stepOnce(e);
  assert.equal(spy.cg.length, 1, '未登记记录号不调用 native');
});

test('0x208：纹理尺寸写回脚本操作数 op2/op3（getter 语义）', async () => {
  const spy = new Spy();
  const e = new Engine(spy);
  loadScriptIntoFrame(e.curScript(), globalInts(0x208, 3), 'TEST.BIN');
  e.globals.int.set(0x100, enc(e.key, 7)); // op1 = 纹理槽
  e.globals.int.set(0x101, 0);
  e.globals.int.set(0x102, 0);
  await stepOnce(e);
  assert.deepEqual(spy.sizes, [7], '应查询 op1 指定的槽');
  assert.equal(e.globals.int.get(0x101), enc(e.key, 640), 'op2 应被写回宽度');
  assert.equal(e.globals.int.get(0x102), enc(e.key, 480), 'op3 应被写回高度');
});

test('0x23C：帧毫秒时钟（92334←92333、92333←now），且不触发 frameTick 渲染', async () => {
  const spy = new Spy();
  const e = new Engine(spy);
  e.engineValues.set(92333, 111);
  e.nowMs = 222;
  loadScriptIntoFrame(e.curScript(), script(0x23c, []), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(e.engineValues.get(92334), 111, '上一帧时刻 ← 旧当前时刻');
  assert.equal(e.engineValues.get(92333), 222, '当前时刻 ← now');
  assert.equal(spy.frameTicks, 0, '0x23C 只刷时钟、不渲染（对照 0x20C 会 frameTick）');
});

test('0x1FF：DrawItem 像素平移 → native.setDrawTranslation（op2..op4 为 float）', async () => {
  const spy = new Spy();
  const e = new Engine(spy);
  const instr: BinInstruction = {
    opcode: 0x1ff,
    name: 'i1ff',
    argc: 4,
    args: [
      { type: T_GLOBAL_INT, raw: 0x100 },
      { type: T_LOCAL_FLOAT, raw: 11 },
      { type: T_LOCAL_FLOAT, raw: 12 },
      { type: T_LOCAL_FLOAT, raw: 13 },
    ],
    byteOffset: H,
    index: 0,
  };
  loadScriptIntoFrame(
    e.curScript(),
    {
      ...script(0x1ff, []),
      instructions: [instr],
    },
    'TEST.BIN',
  );
  e.globals.int.set(0x100, enc(e.key, 0x30));
  e.curScript().locals.float.set(11, 12.5);
  e.curScript().locals.float.set(12, -3.25);
  e.curScript().locals.float.set(13, 0);
  await stepOnce(e);
  const t = spy.translations[0]!;
  assert.equal(t.handle, 0x30);
  assert.equal(t.x, 12.5);
  assert.equal(t.y, -3.25);
  assert.equal(t.z, 0);
});

// ---- 纯几何：CG 数字条 → DrawItem（`drawItem.ts` 的 cgDigitItems） ----

// 记录：槽42 / x0=1 / y0=2 / 单字宽 16 / 字高 20 / 字内空隙 0 / **字距 18**
// ⇒ 字形条内的取字步进 = 单字宽 + 空隙 = 16；**位与位之间的步进 adv = 单字宽 + 字距 = 34**（引擎 raw 32421）
const REC = [42, 1, 2, 16, 20, 0, 18];
const CELL = REC[3]!;
const GAP = REC[5]!;
const ADV = REC[3]! + REC[6]!; // 34

test('cgDigitItems：只画有效位；id=个位（自右向左），源矩形按数字取字形', () => {
  const items = cgDigitItems(0x6f, REC, 1234, 300, 700, 6, 0);
  // 右对齐 + 不补零：只画 4 位 ⇒ 4 项；k 从 last 递减 ⇒ items[0] = k=5（个位）
  assert.equal(items.length, 4);
  assert.equal(items[0]!.handle, 0x6f, 'handle = id（个位）');
  assert.equal(items[0]!.srcX, 1 + CELL * 4, '个位字形 = 4 → x0 + 单字宽·4');
  assert.equal(items[0]!.dstX, 5 * ADV + 300, '右对齐：个位在 (digits−1)·adv + x');
  assert.equal(items[3]!.handle, 0x72, '千位 = id+3');
  assert.equal(items[3]!.srcX, 1 + CELL * 1, '千位字形 = 1');
  assert.equal(items[3]!.dstX, 2 * ADV + 300, '千位在 k=2');
  for (const it of items) {
    assert.equal(it.tex, 42);
    assert.equal(it.srcW, CELL);
    assert.equal(it.srcH, 20);
    assert.equal(it.srcY, 2);
    assert.equal(it.dstY, 700);
  }
});

test('cgDigitItems：补零（flags bit0）把前导零也建出来，最左位在 k=0', () => {
  const items = cgDigitItems(0x6f, REC, 1234, 0, 0, 6, 1);
  assert.equal(items.length, 6, '补零 ⇒ 6 位全画');
  assert.equal(items[0]!.dstX, 5 * ADV, '个位仍在 k=5');
  // k 递减 ⇒ items[5] 是 k=0（最左的前导零）
  assert.equal(items[5]!.srcX, 1 + 0, '前导零 ⇒ 字形 0 ⇒ 源 x = x0');
  assert.equal(items[5]!.dstX, 0 * ADV, '最左位在 k=0');
});

test('cgDigitItems：居中（bit1）与左对齐（bit2）的 x 公式', () => {
  // 数值 1234 ⇒ 4 位；digits=6 ⇒ last=5、dc=4
  const center = cgDigitItems(0, REC, 1234, 100, 0, 6, 2);
  // 个位 k=5：x = 5·adv − adv·(last−dc+1)/2 + x
  assert.equal(center[0]!.dstX, 5 * ADV - (ADV * (5 - 4 + 1)) / 2 + 100);
  const left = cgDigitItems(0, REC, 1234, 100, 0, 6, 4);
  // 左对齐：某位 x = (dc−1−(last−k))·adv + x；个位 k=last ⇒ 3·adv+100
  assert.equal(left[0]!.dstX, 3 * ADV + 100);
  // 千位 k=2 ⇒ (4−1−(5−2))·adv + 100 = 100
  assert.equal(left[3]!.dstX, 100, '最左有效位落在 x 处');
});

test('cgDigitItems：数值 0 至少画出个位的字形 0；字内空隙参与取字步进', () => {
  const zero = cgDigitItems(0x10, REC, 0, 5, 6, 4, 0);
  assert.equal(zero.length, 1, '数值 0 ⇒ 只画个位那一轮');
  assert.equal(zero[0]!.handle, 0x10);
  assert.equal(zero[0]!.srcX, 1, '字形 0');
  assert.equal(zero[0]!.dstX, 3 * ADV + 5);

  // 空隙 let 有值时：取字步进 = 单字宽 + 空隙
  const rec2 = [42, 1, 2, 16, 20, 4, 18];
  const items = cgDigitItems(0, rec2, 7, 0, 0, 2, 0);
  assert.equal(items[0]!.srcX, 1 + (16 + 4) * 7, '取字步进 = 单字宽 + 字内空隙');
});
