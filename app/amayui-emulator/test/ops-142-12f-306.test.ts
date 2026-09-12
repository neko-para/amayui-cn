/**
 * 三条指令的实现测试：`0x142`（写引擎开关 `_this[174812]`）/ `0x12F`（按 `B[idx]+C[idx]` 排索引数组 A）/
 * `0x306`（`system:EffectSkipOnClick` getter）。
 *
 * 语义依据（raw）：
 *  - 0x142 `sub_422930` raw 31020-31027：`_this[174812] = readIntOperand(1)`；字段 = 字节 0xAAB70，
 *    构造 `sub_415640` raw 22591 / 复位 `sub_40DF10` raw 17961 都置 1，唯一读者 `sub_4765C0`（raw 91057）。
 *  - 0x12F `sub_42F560` raw 39269-39335：见 `handlers/memory.ts` 的长注释。
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

/** 0x12F 的公共脚手架：A/B/C 三个全局数组 + 一条指令；`aInit` 可为"残留内容"（不变量测试用）。 */
async function run12f(opts: {
  bVals: number[];
  cVals: number[];
  aInit?: number[];
  key?: number;
}): Promise<{ e: Engine; refA: { scope: 'global'; kind: 'int'; index: number; stride: number }; A: number; B: number; C: number }> {
  const e = new Engine(new StubNative(() => {}));
  // 用真实非零 key：key=0 时 ROR/ROL 自抵消，测不出"读要 DEC、写要 ENC"这一步
  e.key = opts.key ?? 0x12345678;
  const n = opts.bVals.length;
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
  const refA = { scope: 'global' as const, kind: 'int' as const, index: A, stride: 4 };
  const refB = { scope: 'global' as const, kind: 'int' as const, index: B, stride: 4 };
  const refC = { scope: 'global' as const, kind: 'int' as const, index: C, stride: 4 };
  // ★数组访存只走 `writeRef`/`readRef`（它们就是引擎的 ENC 写 / DEC 读）——**不要**再手工 `enc()`
  for (let i = 0; i < n; i++) {
    writeRef(e, e.curScript(), refAt(refB, i), opts.bVals[i]!);
    writeRef(e, e.curScript(), refAt(refC, i), opts.cVals[i]!);
    writeRef(e, e.curScript(), refAt(refA, i), opts.aInit?.[i] ?? 0);
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
  return { e, refA, A, B, C };
}

/** 读回 A 的索引序列（readRef 已是 DEC 视角）。 */
function gotA(e: Engine, refA: { scope: 'global'; kind: 'int'; index: number; stride: number }, n: number): number[] {
  return Array.from({ length: n }, (_, i) => readRef(e, e.curScript(), refAt(refA as never, i)));
}

test('★0x12F：比较键是 **B[A[j]] + C[A[j]]**（用 A 里的索引查 B/C），不是按位置比 A/C', async () => {
  // 键故意与索引顺序无关：B = [50,10,40,20,30]、C 全 0 ⇒ 期望顺序 = 索引 [1,3,4,2,0]
  const bVals = [50, 10, 40, 20, 30];
  const cVals = [0, 0, 0, 0, 0];
  const { e, refA } = await run12f({ bVals, cVals });
  assert.deepEqual(gotA(e, refA, 5), [1, 3, 4, 2, 0], '按 B 升序排出的索引序');
});

test('★0x12F：C 是次键（同 B 时用 C 决序），且 B/C 都不被改写', async () => {
  const bVals = [7, 7, 7];
  const cVals = [30, 10, 20];
  const { e, refA } = await run12f({ bVals, cVals });
  assert.deepEqual(gotA(e, refA, 3), [1, 2, 0], 'B 相同 ⇒ 按 C 升序');
  for (let i = 0; i < 3; i++) {
    assert.equal(readRef(e, e.curScript(), refAt({ scope: 'global', kind: 'int', index: 0x300, stride: 4 }, i)), bVals[i], `B[${i}] 不应被改写`);
    assert.equal(readRef(e, e.curScript(), refAt({ scope: 'global', kind: 'int', index: 0x400, stride: 4 }, i)), cVals[i], `C[${i}] 不应被改写`);
  }
});

test('★0x12F 不变量：结果只取决于 B/C，与 A 里的**残留内容**无关（"首次进入 vs 切 tab 回来"的回归闸）', async () => {
  // 真实现场（CONFIG1）：A 是**同一帧里反复使用的局部数组**，每帧带着上一轮的结果进来。
  // 旧实现按"A 位置上的值"比较 ⇒ 顺序会跟着历史变：首次进入「字体系列」被排到最前，
  // 切一次 tab 再回来又"看起来对了"。正确实现必须对任意 A 初值给出同一结果。
  const bVals = [50, 10, 40, 20, 30];
  const cVals = [0, 0, 0, 0, 0];
  const expectations: number[][] = [];
  for (const aInit of [
    [0, 0, 0, 0, 0],
    [0, 4, 3, 2, 1],
    [3, 1, 4, 0, 2],
    [9, 9, 9, 9, 9],
  ]) {
    const { e, refA } = await run12f({ bVals, cVals, aInit });
    expectations.push(gotA(e, refA, 5));
  }
  for (const got of expectations) {
    assert.deepEqual(got, [1, 3, 4, 2, 0], `A 的初值不应影响结果（实际 ${JSON.stringify(expectations)}）`);
  }
  // 结果必须是 0..n-1 的一个排列（"只写 0 或重复"这类错法会被这条抓住）
  assert.deepEqual([...expectations[0]!].sort((x, y) => x - y), [0, 1, 2, 3, 4]);
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
