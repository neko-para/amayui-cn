/** ADR-011 指针操作数模型测试：lea/lookup-array/memcpy/copy-local-array/random + 解引用/写穿。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { readIntOperand, writeIntOperand, refFromOperand, setRefOperand } from '../src/vm/operand.js';
import { readRef, writeRef, refAt, isRef, type Ref } from '../src/vm/ref.js';
import { dec, enc } from '../src/vm/bits.js';
import type { BinInstruction, BinArg } from '../src/script/bin.js';

function mk(opcode: number, ...args: [number, number][]): { instr: BinInstruction } {
  // 第 1 位是 type，第 2 位是 raw。
  const ins: BinInstruction = {
    opcode,
    name: `0x${opcode.toString(16)}`,
    argc: args.length,
    args: args.map(([type, raw]) => ({ type, raw }) as BinArg),
    byteOffset: 0,
    index: 0,
  };
  return { instr: ins };
}

function ctxFor(e: Engine) {
  const frame = e.curScript();
  return makeCtx(e, frame, { opcode: 0, name: 'test', argc: 0, args: [], byteOffset: 0, index: 0 }, e.native, () => {});
}

test('lea 设引用 → mov(指针) 读=解引用；mov(指针) 写=写穿', () => {
  const e = new Engine(new StubNative());
  e.key = 0x12345678;
  const frame = e.curScript();
  const c = ctxFor(e);

  // globals.int[7] = 100
  e.globals.int.set(7, enc(e.key, 100));

  // lea (local-ptr 1) (global-int 7)  → local-ptr1 = Ref{global,int,7,4}
  const lea = OPS.get(0x63)!;
  const { instr: li } = mk(0x63, [0xc, 1], [0x3, 7]);
  lea({ ...c, instr: li });
  const r = frame.locals.ptr.get(1)!;
  assert.ok(isRef(r), 'local-ptr1 应是 Ref');
  const rr = r as Ref;
  assert.deepEqual({ scope: rr.scope, kind: rr.kind, index: rr.index, stride: rr.stride }, { scope: 'global', kind: 'int', index: 7, stride: 4 }, 'Ref 指向 global.int[7]');

  // mov (local-int 0) (local-ptr 1) → local-int0 = *(local-ptr1) = 100
  const mov = OPS.get(0x55)!;
  const { instr: mi } = mk(0x55, [0x9, 0], [0xc, 1]);
  mov({ ...c, instr: mi });
  assert.equal(dec(e.key, frame.locals.int.get(0)!), 100, '读指针=解引用取所指值');

  // mov (local-ptr 1) 42 → 写穿到 globals.int[7]
  const { instr: wi } = mk(0x55, [0xc, 1], [0x0, 42]);
  mov({ ...c, instr: wi });
  assert.equal(dec(e.key, e.globals.int.get(7)!), 42, '写指针=写穿到所指处');
});

test('lea of 指针 = 别名拷贝（lea (ptr0)(ptr2) 指向同处）', () => {
  const e = new Engine(new StubNative());
  e.key = 5;
  const frame = e.curScript();
  const c = ctxFor(e);
  e.globals.int.set(3, enc(e.key, 999));

  const lea = OPS.get(0x63)!;
  lea({ ...c, instr: mk(0x63, [0xc, 2], [0x3, 3]).instr }); // ptr2 = &global.int[3]
  lea({ ...c, instr: mk(0x63, [0xc, 0], [0xc, 2]).instr }); // ptr0 = ptr2（别名）
  const p0 = frame.locals.ptr.get(0)! as Ref;
  const p2 = frame.locals.ptr.get(2)! as Ref;
  assert.deepEqual({ scope: p0.scope, kind: p0.kind, index: p0.index, stride: p0.stride }, { scope: 'global', kind: 'int', index: 3, stride: 4 }, '别名拷贝指向同处');
  assert.equal(readRef(e, frame, p0), 999, '读 p0 得所指值');
});

test('lookup-array 按索引取址；lookup-array-2d 二维取址', () => {
  const e = new Engine(new StubNative());
  e.key = 0xabcdef;
  const frame = e.curScript();
  const c = ctxFor(e);
  e.globals.int.set(0x100, enc(e.key, 11));
  e.globals.int.set(0x100 + 3, enc(e.key, 33));

  // lookup-array (local-ptr 0) (global-int 100) (immediate 3) → &global.int[100+3]
  const la = OPS.get(0x61)!;
  la({ ...c, instr: mk(0x61, [0xc, 0], [0x3, 0x100], [0x0, 3]).instr });
  const r0 = frame.locals.ptr.get(0)! as Ref;
  assert.equal(r0.index, 0x103, 'lookup-array 基址+索引');
  assert.equal(readRef(e, frame, r0), 33, '解引用得 global.int[0x103]');

  // lookup-array-2d (ptr 1) (global-int 200) row=1 colStride=4 col=2 → &global.int[200+1*4+2]
  const la2 = OPS.get(0x12c)!;
  la2({ ...c, instr: mk(0x12c, [0xc, 1], [0x3, 200], [0x0, 1], [0x0, 4], [0x0, 2]).instr });
  const r1 = frame.locals.ptr.get(1)! as Ref;
  assert.equal(r1.index, 206, '二维: 200 + row*colStride + col');
});

test('memcpy 拷贝 n 个元素；copy-local-array 填字面数组（含 ENC）', () => {
  const e = new Engine(new StubNative());
  e.key = 0x55;
  const frame = e.curScript();
  const c = ctxFor(e);

  // 源：global.int[10..12] = 1,2,3
  for (let i = 0; i < 3; i++) e.globals.int.set(10 + i, enc(e.key, i + 1));

  // lea ptr0 = &global.int[10]（dest），lea ptr1 = &global.int[10]（src），memcpy ptr0 ptr1 3
  const lea = OPS.get(0x63)!;
  lea({ ...c, instr: mk(0x63, [0xc, 0], [0x3, 10]).instr });
  lea({ ...c, instr: mk(0x63, [0xc, 1], [0x3, 10]).instr });
  const mem = OPS.get(0x1b0)!;
  mem({ ...c, instr: mk(0x1b0, [0xc, 0], [0xc, 1], [0x0, 3]).instr });

  // 目标应为 global.int[10..12]（同处拷贝）
  assert.equal(dec(e.key, e.globals.int.get(10)!), 1);
  assert.equal(dec(e.key, e.globals.int.get(11)!), 2);
  assert.equal(dec(e.key, e.globals.int.get(12)!), 3);

  // copy-local-array (global-int 20) [dataArray 7 8 9]
  const cla = OPS.get(0x64)!;
  const instr = mk(0x64, [0x3, 20], [0x0, 0]).instr;
  instr.args[1]!.dataArray = [7, 8, 9];
  cla({ ...c, instr });
  assert.equal(dec(e.key, e.globals.int.get(20)!), 7, '第 0 项');
  assert.equal(dec(e.key, e.globals.int.get(21)!), 8, '第 1 项');
  assert.equal(dec(e.key, e.globals.int.get(22)!), 9, '第 2 项');
});

test('random 写穿到指针所指处（0..mod-1）', () => {
  const e = new Engine(new StubNative());
  e.key = 1;
  const frame = e.curScript();
  const c = ctxFor(e);

  const lea = OPS.get(0x63)!;
  lea({ ...c, instr: mk(0x63, [0xc, 0], [0x3, 50]).instr }); // ptr0 = &global.int[50]
  const rnd = OPS.get(0x60)!;
  rnd({ ...c, instr: mk(0x60, [0xc, 0], [0x0, 0x64]).instr }); // random (ptr0) 100
  const v = dec(e.key, e.globals.int.get(50)!);
  assert.ok(v >= 0 && v < 100, `random 应在 [0,99]，实际 ${v}`);
});

test('copy-to-global = 置零（count 个槽），与 mov(单值) 不同', () => {
  const e = new Engine(new StubNative());
  e.key = 0x99;
  const frame = e.curScript();
  const c = ctxFor(e);

  // 预填非零
  for (let i = 0; i < 5; i++) e.globals.int.set(0x4000 + i, enc(e.key, 100 + i));

  // copy-to-global (global-int 0x4000) 3  → 置 3 个槽为 0
  const c2g = OPS.get(0x6c)!;
  c2g({ ...c, instr: mk(0x6c, [0x3, 0x4000], [0x0, 3]).instr });
  assert.equal(dec(e.key, e.globals.int.get(0x4000)!), 0, '槽1=0');
  assert.equal(dec(e.key, e.globals.int.get(0x4000 + 1)!), 0, '槽2=0');
  assert.equal(dec(e.key, e.globals.int.get(0x4000 + 2)!), 0, '槽3=0');
  assert.equal(dec(e.key, e.globals.int.get(0x4000 + 3)!), 103, '槽4 未被置零');

  // 对比 mov (global-int 0x4100) (immediate 42)：只写 1 槽 = 42
  const mov = OPS.get(0x55)!;
  mov({ ...c, instr: mk(0x55, [0x3, 0x4100], [0x0, 42]).instr });
  assert.equal(dec(e.key, e.globals.int.get(0x4100)!), 42, 'mov 写单槽=42');
  assert.ok(!e.globals.int.has(0x4100 + 1), 'mov 不动相邻槽');
});

