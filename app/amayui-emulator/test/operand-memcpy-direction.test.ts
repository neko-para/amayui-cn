/** @tier T0 @kind core @subsystem vm */

/**
 * **`0x1B0` memcpy 的方向**（`tickets/T-0162`；审计 `p23-worklist2.md` 的 T-0162 首行）。
 *
 * 体 `sub_42D150`（raw 37985-37996）全文：
 * ```text
 * _this[30*cur + 95805] = 7;                  // arity 槽 ⇒ argc 3
 * v5 = 4 * sub_41BF50(_this, 3);              // op3 = **个数**（×4 = 字节数）
 * v4 = (const void *)sub_42AEA0(_this, 1);    // ★op1 取址 ⇒ **源**
 * v2 = (void *)sub_42AEA0(_this, 2);          // ★op2 取址 ⇒ **目标**
 * return memcpy(v2, v4, v5);                  // memcpy(目标 = op2, 源 = op1, 4*op3)
 * ```
 * ⇒ **源是 op1、目标是 op2**。修前的 emulator 把 `op1` 当目标、`op2` 当源 —— 反了。
 *
 * ★语料里 `^i1b0` 命中 **0** 处（941 个 `src/*.txt`，`analysis/opcodes.json` 的 handler 表也记着
 * `memcpy(dest=op2, src=op1, n=4*op3)`）⇒ 这条只能由**合成指令**证伪/证实：既有 `test/ptr.test.ts`
 * 的那个用例两侧都指向 `&global.int[10]`（自拷贝），对方向**不敏感**，所以它一直是绿的。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx, type StepCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { enc, dec } from '../src/vm/bits.js';
import type { BinArg } from '../src/script/bin.js';
import { instr } from './harness.js';

const gInt = (slot: number): BinArg => ({ type: 0x3, raw: slot }) as unknown as BinArg;
const ptr = (slot: number): BinArg => ({ type: 0xc, raw: slot }) as unknown as BinArg;
const imm = (v: number): BinArg => ({ type: 0x0, raw: v }) as unknown as BinArg;

function ctxFor(e: Engine): StepCtx {
  return makeCtx(e, e.frames[0]!, instr(0x1b0, []), e.native, () => {});
}

test('★0x1B0 memcpy：op1 = **源**、op2 = **目标**（`memcpy(op2, op1, 4*op3)`）', () => {
  const e = new Engine(new StubNative());
  e.key = 0x37;
  const frame = e.curScript();
  const c = ctxFor(e);

  // 源 global.int[10..12] = 11,22,33；目标 global.int[20..22] = 原样 7,8,9
  for (let i = 0; i < 3; i++) e.globals.int.set(10 + i, enc(e.key, [11, 22, 33][i]!));
  for (let i = 0; i < 3; i++) e.globals.int.set(20 + i, enc(e.key, [7, 8, 9][i]!));

  const lea = OPS.get(0x63)!;
  lea({ ...c, instr: instr(0x63, [ptr(0), gInt(10)]) }); // ptr0 = &int[10]（op1 = 源）
  lea({ ...c, instr: instr(0x63, [ptr(1), gInt(20)]) }); // ptr1 = &int[20]（op2 = 目标）
  OPS.get(0x1b0)!({ ...c, instr: instr(0x1b0, [ptr(0), ptr(1), imm(3)]) });

  assert.deepEqual(
    [20, 21, 22].map((i) => dec(e.key, e.globals.int.get(i)!)),
    [11, 22, 33],
    '★目标(op2)=&int[20] 应拿到**源(op1)**=&int[10] 的三个值（修前方向反 ⇒ 这里会是 7,8,9）',
  );
  assert.deepEqual(
    [10, 11, 12].map((i) => dec(e.key, e.globals.int.get(i)!)),
    [11, 22, 33],
    '★源(op1) **不被改动**（修前它会被当成目标、被 op2 的旧值覆盖）',
  );

  // 反向再验一次：两侧都换过来，结果必须随 op1/op2 一起换（排除"只是把两个池都写了一遍"）
  OPS.get(0x1b0)!({ ...c, instr: instr(0x1b0, [ptr(1), ptr(0), imm(2)]) }); // 源 = ptr1(&int[20])、目标 = ptr0(&int[10])
  assert.deepEqual(
    [10, 11].map((i) => dec(e.key, e.globals.int.get(i)!)),
    [11, 22],
    '反过来写：目标 = &int[10] 拿到 &int[20] 的头两个值',
  );
  assert.deepEqual(
    [20, 21].map((i) => dec(e.key, e.globals.int.get(i)!)),
    [11, 22],
    '&int[20] 未被这一趟改写',
  );
});

test('0x1B0 的**跨类型**限制：引擎是裸 dword 拷贝（不看类型），emulator 显式抛（有据登记）', () => {
  const e = new Engine(new StubNative());
  e.key = 5;
  const frame = e.curScript();
  const c = ctxFor(e);
  // op1 = global-float 槽（kind float）、op2 = global-int 槽（kind int）⇒ 步长同为 4 但 kind 不同
  const floatOp = { type: 0x4, raw: 5 } as unknown as BinArg;
  const intOp = { type: 0x3, raw: 20 } as unknown as BinArg;
  assert.throws(
    () => OPS.get(0x1b0)!({ ...c, instr: instr(0x1b0, [floatOp, intOp, imm(1)]) }),
    /跨类型裸拷贝/,
    '引擎 memcpy(4*n 字节) 没有类型检查；emulator 的 int 池是 ENC 的、float 池是 JS number ⇒ 没有可表达的值',
  );
  // str 池步长 28 ≠ 4：同样不可复现
  const strOp = { type: 0x5, raw: 1 } as unknown as BinArg;
  assert.throws(() => OPS.get(0x1b0)!({ ...c, instr: instr(0x1b0, [strOp, intOp, imm(1)]) }), /跨类型裸拷贝/);
  void frame;
});
