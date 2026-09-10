/**
 * 三条指令的实现测试：`0x142`（写引擎开关 `_this[174812]`）/ `0x12F`（三数组按 (A+C) 降序排序 + ENC 重编码）/
 * `0x306`（`system:EffectSkipOnClick` getter）。
 *
 * 语义依据（raw）：
 *  - 0x142 `sub_422930` raw 31020-31027：`_this[174812] = readIntOperand(1)`；字段 = 字节 0xAAB70，
 *    构造 `sub_415640` raw 22591 / 复位 `sub_40DF10` raw 17961 都置 1，唯一读者 `sub_4765C0`（raw 91057）。
 *  - 0x12F `sub_42F560` raw 39269-39335：见 ops.ts 的长注释（插入排序 + 并行搬运 + 末尾 ENC）。
 *  - 0x306 `sub_431FC0` raw 40948-40951：`op1 = GetConfig("system:EffectSkipOnClick")`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { refAt, readRef, writeRef } from '../src/vm/ref.js';
import { dec, enc } from '../src/vm/bits.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const H = 0x3c;
const T_GLOBAL_INT = 0x3;
const T_GLOBAL_PTR = 0x6;

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

test('0x142：把 op1 写进引擎字段 `_this[174812]`（构造/复位默认 1，脚本可控）', async () => {
  const e = new Engine(new StubNative(() => {}));
  assert.equal(e.engineValues.get(174812), undefined, '默认不占位（引擎构造/复位置 1 由 op 语义给出）');

  for (const v of [0, 1]) {
    loadScriptIntoFrame(e.curScript(), script(0x142, [{ type: T_GLOBAL_INT, raw: 0x100 }]), 'TEST.BIN');
    e.globals.int.set(0x100, enc(e.key, v)); // op1 = v
    const t = await stepOnce(e);
    assert.equal(t.opcode, 0x142);
    assert.notEqual(t.handlerKind, 'unimplemented');
    assert.equal(e.engineValues.get(174812), v, `i142 ${v} 应写入字段 174812`);
    assert.equal(e.curScript().ip, 1, 'ip 正常推进');
  }
});

test('0x12F：把索引按 (DEC(A[k])+DEC(C[k])) 升序重排写回 A（A 原地重编码），B/C 不被改写', async () => {
  const e = new Engine(new StubNative(() => {}));
  // 用真实非零 key：否则 ENC(i) === i（key=0 时 ROR/ROL 自抵消），测不出"末尾重编码"这一步
  e.key = 0x12345678;
  const n = 5;
  // 三个数组的全局槽号（指针操作数 raw = 指针池槽；池里存 Ref{scope:'global', kind:'int', index}）
  const A = 0x200;
  const B = 0x300;
  const C = 0x400;
  for (const [slot, base] of [
    [0x10, A],
    [0x11, B],
    [0x12, C],
  ] as const) {
    e.globals.ptr.set(slot, { scope: 'global', kind: 'int', index: base, stride: 4 });
  }
  // 原始数据
  const aInit = new Map<number, number>([
    [0, 7],
    [1, 3],
    [2, 9],
    [3, 1],
    [4, 5],
  ]);
  const cInit = new Map<number, number>([
    [0, 10],
    [1, 100],
    [2, 1],
    [3, 50],
    [4, 60],
  ]);
  // 引擎数组里存的是 **ENC 编码后的位模式**（写侧 ENC、读侧 DEC），故写入时统一编码
  const refA = { scope: 'global' as const, kind: 'int' as const, index: A, stride: 4 };
  const refC = { scope: 'global' as const, kind: 'int' as const, index: C, stride: 4 };
  for (let i = 0; i < n; i++) {
    writeRef(e, e.curScript(), refAt(refA, i), enc(e.key, aInit.get(i)!));
    writeRef(e, e.curScript(), refAt(refC, i), enc(e.key, cInit.get(i)!));
  }

  loadScriptIntoFrame(
    e.curScript(),
    script(0x12f, [
      { type: T_GLOBAL_PTR, raw: 0x10 },
      { type: T_GLOBAL_PTR, raw: 0x11 },
      { type: T_GLOBAL_PTR, raw: 0x12 },
      { type: T_GLOBAL_INT, raw: 0x20 }, // op4 = n
    ]),
    'TEST.BIN',
  );
  e.globals.int.set(0x20, enc(e.key, n));
  const t = await stepOnce(e);
  assert.equal(t.opcode, 0x12f);
  assert.notEqual(t.handlerKind, 'unimplemented');

  // 期望：逐步复刻 raw 的插入排序（逐项比对中间状态，避免"看着公式想当然"）
  //   raw：`*A=0`；for (i=1..n-1) { j=i-1; while (A[j] + C[j] > A[i] + C[i]) { A[j+1] = A[j]; j-- } A[j+1] = i }
  //   注意：比较用的是 **A[i]** —— 即"当前待插入的位置 i 上现存的元素"（第 1 轮是 i 本身，之后可能已被前一轮搬动过），
  //   这正是 raw 里 `dword_55D5A8[4*v4]`（v4 在循环里被写/读）的真实行为。
  const decA: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) decA[i] = aInit.get(i)!;
  const cVals = Array.from({ length: n }, (_, i) => cInit.get(i)!);
  decA[0] = 0;
  for (let i = 1; i < n; i++) {
    let j = i - 1;
    while (j >= 0 && decA[j] + cVals[j] > decA[i] + cVals[i]) {
      decA[j + 1] = decA[j];
      j--;
    }
    decA[j + 1] = i;
  }
  const expect = decA.map((k) => enc(e.key, k) >>> 0); // 末尾重编码：ENC(排序后的索引)

  const got: number[] = [];
  for (let i = 0; i < n; i++) {
    got.push(readRef(e, e.curScript(), refAt(refA, i)) >>> 0);
  }
  assert.notDeepEqual(expect, [...Array(n).keys()].map((k) => enc(e.key, k) >>> 0), '排序结果不应等于原始顺序');
  assert.deepEqual(got, expect, '插入排序后的索引序列（ENC 编码）');
  // 逐项 DEC 回读应等于排序后的索引（decA）
  assert.deepEqual(
    got.map((v) => dec(e.key, v)),
    decA,
  );
  // B（辅助表）与 C（键）在排序中只被读，不应被改写
  for (let i = 0; i < n; i++) {
    assert.equal(dec(e.key, readRef(e, e.curScript(), refAt(refC, i))), cInit.get(i), `C[${i}] 不应被改写`);
  }
  assert.equal(e.curScript().ip, 1);
});

test('0x306：op1 = 配置 `system:EffectSkipOnClick`（SYS4REG.INI 缺该键时取引擎构造默认 1）', async () => {
  const e = new Engine(new StubNative(() => {}));
  const read = (slot: number): number => dec(e.key, e.curScript().locals.int.get(slot) ?? 0);

  // (a) 未加载配置 → 默认 1（与引擎构造 sub_415640 的默认一致）
  loadScriptIntoFrame(e.curScript(), script(0x306, [{ type: 0x9, raw: 5 }]), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(5), 1);

  // (b) 配置文件里显式给 0 → 读 0
  e.config = { values: new Map([['system:effectskiponclick', 0]]), sections: ['system'] };
  loadScriptIntoFrame(e.curScript(), script(0x306, [{ type: 0x9, raw: 6 }]), 'TEST.BIN');
  await stepOnce(e);
  assert.equal(read(6), 0);
});
