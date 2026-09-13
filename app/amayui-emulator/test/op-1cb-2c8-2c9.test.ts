/**
 * **A1 三条「会回写脚本操作数」的 stub 转真实现**（2026-09）。
 *
 * | opcode | handler | 语义 | 语料 |
 * |---|---|---|---|
 * | `0x1CB` | `sub_42D3D0`(38082) | `op1 ← GetConfig("message:ReadTextSkip")`（`0x1CA` 的**读取端**） | 30+ 个扩展包场景脚本 `i1cb (global-int 139d)` |
 * | `0x2C8` | `sub_434260`(42379) | **按「字符」取子串**：`op1 = substr_chars(op2, op3, op4)`（`0x2C7` 是**字节**版） | `i2c8` 全语料 0 处（0x2C7 才被大量使用） |
 * | `0x2C9` | `sub_4344A0`(42460) | **可变数组元素引用**：`op1 = &op2[op3]`（按需扩容，负下标抛错） | `i2c9` 全语料 0 处 |
 *
 * 三条共同点：**handler 都会 `sub_42B4B0/433310/418CC0` 回写操作数** —— 当 no-op 跳过时
 * op1 保留上一条指令的旧值，而脚本紧接着就用它 ⇒ **静默逻辑错误**（不报错、只是不对）。
 *
 * ★`0x1CB` 是其中最严重的一条：`0x1CA`（SetConfig）与 `0x1CB`（GetConfig）是**同一个键**的写/读对，
 * 而读的一侧此前被当 no-op ⇒ 脚本永远读到旧值。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/stubNative.js';
import { readIntOperand, readStringOperand, writeIntOperand, writeStringOperand, refFromOperand } from '../src/vm/operand.js';
import { readRef, writeRef, refAt } from '../src/vm/ref.js';
import { parseIni } from '../src/engineConfig.js';
import { sjisSubstrChars } from '../src/text/sjis.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const gInt = (n: number): BinArg => ({ type: 3, raw: n }) as unknown as BinArg;
const lInt = (n: number): BinArg => ({ type: 9, raw: n }) as unknown as BinArg;
const lStr = (n: number): BinArg => ({ type: 0xb, raw: n }) as unknown as BinArg;
const gStr = (n: number): BinArg => ({ type: 5, raw: n }) as unknown as BinArg;
const lPtr = (n: number): BinArg => ({ type: 0xc, raw: n }) as unknown as BinArg;
/** 局部**字符串**指针（`0xe`）—— 字符串数组的元素引用要存在这里（写出串时走字符串写穿）。 */
const lStrPtr = (n: number): BinArg => ({ type: 0xe, raw: n }) as unknown as BinArg;
/** 数组型操作数（`0x8003` 族）。 */
const arr = (type: number, raw: number): BinArg => ({ type, raw }) as unknown as BinArg;
const instr = (op: number, args: BinArg[]): BinInstruction =>
  ({ opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

function mk(): { e: Engine; run: (op: number, args: BinArg[]) => void; inp: (op: number, args: BinArg[]) => BinInstruction } {
  const native = new StubNative(() => {});
  const e = new Engine(native, new InputManager());
  const f = e.curScript();
  return {
    e,
    run: (op, args) => {
      const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应已注册`);
      h!(makeCtx(e, f, instr(op, args), native, () => {}));
    },
    inp: (op, args) => instr(op, args),
  };
}

// ---------------------------------------------------------------------------
// 注册表棘轮
// ---------------------------------------------------------------------------

test('注册表棘轮：0x1CB/0x2C8/0x2C9 都不再是任何形式的 stub', () => {
  for (const op of [0x1cb, 0x2c8, 0x2c9]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须已实现（它回写操作数）`);
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应再是 engine-internal no-op`);
    assert.ok(!NATIVE_OPS.has(op), `0x${op.toString(16)} 不应是 native stub`);
  }
});

// ---------------------------------------------------------------------------
// 0x1CB：op1 ← GetConfig("message:ReadTextSkip")
// ---------------------------------------------------------------------------

test('0x1CB：默认读到 0；写回 op1（先埋哨兵，证明它真的写了）', () => {
  const { e, run, inp } = mk();
  const i = inp(0x1cb, [lInt(1)]);
  writeIntOperand(e, e.curScript(), i, 1, 0x5a5a); // 哨兵：no-op 时会留着它
  run(0x1cb, [lInt(1)]);
  assert.equal(readIntOperand(e, e.curScript(), i, 1), 0, '默认 message:ReadTextSkip = 0');
});

test('0x1CB ↔ 0x1CA：同一个键的写/读对（运行期覆盖优先）', () => {
  const { e, run, inp } = mk();
  const i = inp(0x1cb, [lInt(1)]);
  run(0x1ca, [im(1)]); // SetConfig message:ReadTextSkip = 1
  run(0x1cb, [lInt(1)]);
  assert.equal(readIntOperand(e, e.curScript(), i, 1), 1, '写 1 后读回 1');
  run(0x1ca, [im(0)]);
  run(0x1cb, [lInt(1)]);
  assert.equal(readIntOperand(e, e.curScript(), i, 1), 0, '写回 0 后读回 0');
  run(0x1ca, [im(7)]);
  run(0x1cb, [lInt(1)]);
  assert.equal(readIntOperand(e, e.curScript(), i, 1), 7, '非 0 值原样读回（不布尔化）');
});

test('0x1CB：没有运行期覆盖时回落到启动配置 message:ReadTextSkip', () => {
  const { e, run, inp } = mk();
  const i = inp(0x1cb, [lInt(1)]);
  e.config = parseIni('[message]\nReadTextSkip=1\n');
  run(0x1cb, [lInt(1)]);
  assert.equal(readIntOperand(e, e.curScript(), i, 1), 1, '配置里写了 1 ⇒ 读到 1');
  // 运行期覆盖（0x1CA）优先于启动配置
  run(0x1ca, [im(0)]);
  run(0x1cb, [lInt(1)]);
  assert.equal(readIntOperand(e, e.curScript(), i, 1), 0, '运行期写 0 覆盖配置里的 1');
});

test('0x1CB：写到全局槽（语料形态 `i1cb (global-int 139d)`）', () => {
  const { e, run, inp } = mk();
  const i = inp(0x1cb, [gInt(0x139d)]);
  run(0x1ca, [im(1)]);
  run(0x1cb, [gInt(0x139d)]);
  assert.equal(readIntOperand(e, e.curScript(), i, 1), 1);
});

// ---------------------------------------------------------------------------
// 0x2C8：按「字符」取子串
// ---------------------------------------------------------------------------

test('sjisSubstrChars：ASCII / 全角 / 混排 都按**字符**计数', () => {
  assert.equal(sjisSubstrChars('abcdef', 1, 3), 'bcd');
  assert.equal(sjisSubstrChars('あいうえお', 1, 2), 'いう');
  assert.equal(sjisSubstrChars('aあbい', 1, 2), 'あb', '混排时"2 个字符"= 全角 1 + 半角 1');
  assert.equal(sjisSubstrChars('あいうえお', 0, 99), 'あいうえお', '结束位置越界 ⇒ 钳到总字符数');
  assert.equal(sjisSubstrChars('あいうえお', 3, 5), 'えお');
  assert.equal(sjisSubstrChars('あいうえお', 9, 2), '', '起点超过总长 ⇒ 空串');
  assert.equal(sjisSubstrChars('abcdef', 2, 0), '', '普通情况下长度为 0 ⇒ 空串');
  assert.equal(sjisSubstrChars('', 0, 3), '');
});

test('sjisSubstrChars：长度为 0 且起点为 0 时，引擎的「双字节仍保留」不对称照原样复刻', () => {
  // 引擎 raw 42435 的分支：单字节看 `v12 >= v8`（钳制**前**的结束位置 ⇒ 0 时全部丢弃），
  // 而双字节只看起点 ⇒ 起点 0 时**全部保留**。这是引擎里的真实不对称，不"顺手修正"。
  assert.equal(sjisSubstrChars('あいう', 0, 0), 'あいう', '双字节：只受起点约束 ⇒ 全保留');
  assert.equal(sjisSubstrChars('abc', 0, 0), '', '单字节：受 `v8` 约束 ⇒ 全丢弃');
  assert.equal(sjisSubstrChars('aあb', 0, 0), 'あ', '混排：只留双字节那个');
});

test('0x2C8：写回 op1 字符串（源串与 op1 可不同槽）；不改源串', () => {
  const { e, run, inp } = mk();
  const frame = e.curScript();
  frame.locals.str.set(0, 'あいうえお');
  const i = inp(0x2c8, [lStr(1), lStr(0), im(1), im(2)]);
  run(0x2c8, [lStr(1), lStr(0), im(1), im(2)]);
  assert.equal(readStringOperand(e, frame, i, 1), 'いう');
  assert.equal(frame.locals.str.get(0), 'あいうえお', '源串不动');
  // 全局串目标（语料里 0x2C7 的常见形态）
  e.globals.str.set(0x20, 'ABCDEF');
  const i2 = inp(0x2c8, [gStr(0x21), gStr(0x20), im(2), im(3)]);
  run(0x2c8, [gStr(0x21), gStr(0x20), im(2), im(3)]);
  assert.equal(readStringOperand(e, frame, i2, 1), 'CDE');
});

test('0x2C8 vs 0x2C7：按字符与按字节在混排串上给出不同结果（互为对照）', () => {
  const { e, run, inp } = mk();
  const frame = e.curScript();
  frame.locals.str.set(0, 'あaい');
  // 0x2C7：op3/op4 是**字节**（全角 2 字节）⇒ 字节 [2,3) = 'a'
  const i7 = inp(0x2c7, [lStr(1), lStr(0), im(2), im(1)]);
  run(0x2c7, [lStr(1), lStr(0), im(2), im(1)]);
  assert.equal(readStringOperand(e, frame, i7, 1), 'a');
  // 0x2C8：op3/op4 是**字符** ⇒ 字符 [2,3) = 'い'
  const i8 = inp(0x2c8, [lStr(1), lStr(0), im(2), im(1)]);
  run(0x2c8, [lStr(1), lStr(0), im(2), im(1)]);
  assert.equal(readStringOperand(e, frame, i8, 1), 'い');
});

// ---------------------------------------------------------------------------
// 0x2C9：可变数组元素引用
// ---------------------------------------------------------------------------

test('0x2C9：op1 = &数组[op3]（写指针），且按需扩容把**缺失槽**补成 0', () => {
  const { e, run, inp } = mk();
  const frame = e.curScript();
  const BASE = 0x40;
  const i = inp(0x2c9, [lPtr(0), arr(0x8009, BASE), im(3)]);
  // 前提：0x2C9 之前这些槽**根本不存在**（= 引擎那边"向量还没增长到"）
  for (let k = 0; k <= 3; k++) {
    assert.equal(frame.locals.int.has(BASE + k), false, `槽 ${k} 应为"从未写入"`);
  }
  run(0x2c9, [lPtr(0), arr(0x8009, BASE), im(3)]);
  // 扩容后：0..3 都被补成 0（引擎是逐个写 ENC(0)）
  for (let k = 0; k <= 3; k++) {
    assert.equal(frame.locals.int.has(BASE + k), true, `槽 ${k} 应被补上`);
    assert.equal(readIntOperand(e, frame, instr(0x9, [lInt(BASE + k)]), 1), 0, `槽 ${k} 读出来应是 0`);
  }
  // op1 是指向第 3 个元素的引用（下标加过，不是值）
  const r = refFromOperand(e, frame, i, 1);
  assert.deepEqual({ scope: r.scope, kind: r.kind, index: r.index, stride: r.stride }, { scope: 'local', kind: 'int', index: BASE + 3, stride: 4 });
  // 通过 op1 写 42 ⇒ 落在第 3 个元素上（其余不动）
  writeRef(e, frame, r, 42);
  assert.equal(readIntOperand(e, frame, instr(0x9, [lInt(BASE + 3)]), 1), 42);
  assert.equal(readIntOperand(e, frame, instr(0x9, [lInt(BASE)]), 1), 0);
});

test('★补 0 是有意义的：DEC key ≠ 0 时，缺失槽读出来**不是 0**（引擎那边是 ENC(0) ⇒ 0）', () => {
  const { e, run } = mk();
  const frame = e.curScript();
  e.key = 0x12345678; // 真实运行期的 key（引擎从资源里取；测试里 M0 缺省是 0）
  const BASE = 0x90;
  const absent = readIntOperand(e, frame, instr(0x9, [lInt(BASE)]), 1);
  assert.notEqual(absent, 0, 'key≠0 时"从未写入的槽"会读成 dec(key,0) 的垃圾值');
  run(0x2c9, [lPtr(0), arr(0x8009, BASE), im(2)]);
  for (let k = 0; k <= 2; k++) {
    assert.equal(readIntOperand(e, frame, instr(0x9, [lInt(BASE + k)]), 1), 0, '补 0 后与引擎一致');
  }
});

test('0x2C9：扩容**不覆盖**已有值（只补缺失槽）', () => {
  const { e, run } = mk();
  const frame = e.curScript();
  const BASE = 0x50;
  writeIntOperand(e, frame, instr(0x9, [lInt(BASE + 1)]), 1, 7);
  writeIntOperand(e, frame, instr(0x9, [lInt(BASE + 2)]), 1, 9);
  run(0x2c9, [lPtr(0), arr(0x8009, BASE), im(4)]);
  const at = (k: number): number => readIntOperand(e, frame, instr(0x9, [lInt(BASE + k)]), 1);
  assert.equal(at(0), 0, '缺失槽补 0');
  assert.equal(at(1), 7, '已有值保持');
  assert.equal(at(2), 9, '已有值保持');
  assert.equal(at(3), 0);
  assert.equal(at(4), 0);
});

test('0x2C9：全局 int 数组（0x8003）与普通 local-int 基址都可用', () => {
  const { e, run, inp } = mk();
  const frame = e.curScript();
  // 0x8003 = 全局 int 数组
  run(0x2c9, [lPtr(0), arr(0x8003, 0x30), im(2)]);
  const r = refFromOperand(e, frame, inp(0x2c9, [lPtr(0), arr(0x8003, 0x30), im(2)]), 1);
  assert.equal(r.scope, 'global');
  assert.equal(r.index, 0x32);
  for (let k = 0; k <= 2; k++) assert.equal(readIntOperand(e, frame, instr(0x3, [gInt(0x30 + k)]), 1), 0);
  // 普通 local-int 基址（等价于"局部 int 数组的首槽"）
  run(0x2c9, [lPtr(1), lInt(0x60), im(1)]);
  const r2 = refFromOperand(e, frame, inp(0x2c9, [lPtr(1), lInt(0x60), im(1)]), 1);
  assert.equal(r2.index, 0x61);
});

test('0x2C9：字符串数组（0x800B）扩容补**空串**，op1 指向该串', () => {
  const { e, run, inp } = mk();
  const frame = e.curScript();
  // 字符串数组的元素引用要存进**字符串指针**槽（0xE），否则写出串时找不到目标池
  run(0x2c9, [lStrPtr(0), arr(0x800b, 0x70), im(2)]);
  assert.equal(frame.locals.str.get(0x70) ?? '', '', '缺失的字符串槽补成空串（引擎 std::string 默认构造）');
  assert.equal(frame.locals.str.get(0x72) ?? '', '');
  const call = inp(0x2c9, [lStrPtr(0), arr(0x800b, 0x70), im(2)]);
  const r = refFromOperand(e, frame, call, 1);
  assert.deepEqual({ kind: r.kind, index: r.index, stride: r.stride }, { kind: 'str', index: 0x72, stride: 28 });
  // 通过引用写字符串（writeStringOperand 走写穿）
  writeStringOperand(e, frame, call, 1, 'きゃっする');
  assert.equal(frame.locals.str.get(0x72), 'きゃっする');
  // 已有串不被扩容覆盖
  frame.locals.str.set(0x71, '既存');
  run(0x2c9, [lStrPtr(0), arr(0x800b, 0x70), im(2)]);
  assert.equal(frame.locals.str.get(0x71), '既存');
});

test('0x2C9：负下标抛错（引擎 raw 42488「可変配列のインデックス %d は不正です」）', () => {
  const { run } = mk();
  assert.throws(() => run(0x2c9, [lPtr(0), arr(0x8009, 0x40), im(-1)]), /可変配列のインデックス/);
});

test('0x2C9：非 int/字符串数组的类型抛错（引擎 default: 抛 Command_Type_Exception）', () => {
  const { run } = mk();
  // 0x8004 = 全局 float 数组：引擎的 switch 没有这一支 ⇒ default: 抛类型异常
  assert.throws(() => run(0x2c9, [lPtr(0), arr(0x8004, 0x40), im(0)]), /Type_Exception|不支持/);
});

test('0x2C9：op1 必须是指针型（写引用），值型目标报错', () => {
  const { run } = mk();
  assert.throws(() => run(0x2c9, [lInt(1), arr(0x8009, 0x40), im(0)]), /setRefOperand|指针/);
});

test('0x2C9：等价于 lea+lookup-array 的组合（同一引用、同一写穿语义）', () => {
  const { e, run, inp } = mk();
  const frame = e.curScript();
  const BASE = 0x80;
  // 0x63 lea + 0x61 lookup-array 得到 &base[2]
  run(0x63, [lPtr(0), arr(0x8009, BASE)]);
  run(0x61, [lPtr(1), lPtr(0), im(2)]);
  // 0x2C9 直接得到 &base[2]
  run(0x2c9, [lPtr(2), arr(0x8009, BASE), im(2)]);
  const r1 = refFromOperand(e, frame, inp(0x61, [lPtr(1), lPtr(0), im(2)]), 1);
  const r2 = refFromOperand(e, frame, inp(0x2c9, [lPtr(2), arr(0x8009, BASE), im(2)]), 1);
  assert.deepEqual(r1, r2, '两条路径应给出同一个引用');
  // 且都按"写穿"落到同一槽
  writeRef(e, frame, r1, 123);
  assert.equal(readRef(e, frame, r2), 123);
  assert.equal(readIntOperand(e, frame, instr(0x9, [lInt(BASE + 2)]), 1), 123);
});
