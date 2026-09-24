/** @tier T0 @kind core @subsystem text */

/**
 * **`0x205` 不回写 op2**（`tickets/T-0147`；审计 `docs-new/99-records/2026-09-impl-audit/` §4.1 的 P1）。
 *
 * 引擎 `sub_4233E0`（raw 31470-31491）全文：
 * ```c
 * v8 = sub_41BF50(_this, 2);                       // x 读进**栈局部**（`int v8; // BYREF` = [ebp-28h]）
 * sub_4072F0(_this, v9, &v8, v2, v4, v6);          // &v8 = 栈地址 ⇒ 更新的只是这个局部
 * v5 = v8;  sub_456710(_this + 21324, v3, v9, v5, v7);
 * ```
 * ⇒ 引擎**从不回写操作数**。修前 emulator 写 `plan.setInt(2, x + advance)`，后果两面：
 *  ① `op2` 是**立即数**时 `writeIntOperand` 直接抛（真实语料 `i205 c5 166 50 …` 的第二格就是立即数 ⇒ 硬停）；
 *  ② `op2` 是**可写槽**时静默污染脚本状态（脚本下一次读该槽会拿到"数字排完后"的 x）。
 * 本文件把这两面都钉住，并确认绘制用的 x 仍是**前进后**的值（引擎 `v5 = v8` 交给 `sub_456710`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { dec, enc } from '../src/vm/bits.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, loc } from './harness.js';

/** 记录 `drawString` 的宿主（0x205 唯一的宿主缝）。★`drawString` 在 `NativeBridge` 里是**可选**成员、
 *  `StubNative` 没实现它 ⇒ 这里是**新增**成员，不能写 `override`（`typecheck:test` 会红）。 */
class Recorder extends StubNative {
  readonly draws: { slot: number; x: number; y: number; text: string }[] = [];
  constructor() {
    super(() => {});
  }
  drawString(slot: number, x: number, y: number, text: string): void {
    this.draws.push({ slot, x, y, text });
  }
}

function call205(e: Engine, native: Recorder, args: BinArg[]): void {
  const instr = { opcode: 0x205, name: 'i205', argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
  OPS.get(0x205)!(makeCtx(e, e.frames[0]!, instr, native, () => {}));
}

test('★0x205：op2 是**立即数**时不抛错（修前 writeIntOperand 硬抛）', () => {
  const native = new Recorder();
  const e = new Engine(native);
  // 语料形态 `i205 c5 166 50 (local-int 2776) 1 10000`：op2 = 立即数 50
  assert.doesNotThrow(() => call205(e, native, [im(0xc5), im(50), im(50), im(1234), im(1), im(10000)]));
  assert.equal(native.draws.length, 1, '仍然画了一次');
});

test('★0x205：op2 是可写槽时**不写回**（脚本读到的仍是原值）', () => {
  const native = new Recorder();
  const e = new Engine(native);
  const slot = 0x2776;
  e.frames[0]!.locals.int.set(slot, enc(e.key, 50)); // x = 50
  const before = dec(e.key, e.frames[0]!.locals.int.get(slot) ?? 0);
  assert.equal(before, 50);
  call205(e, native, [im(0xc5), loc(slot), im(50), im(1234), im(1), im(10000)]);
  const after = dec(e.key, e.frames[0]!.locals.int.get(slot) ?? 0);
  assert.equal(after, 50, '★op2 保持原值（引擎的 x 前进量只在栈局部 v8 上）');
});

test('0x205：绘制用的 x = **前进后**的值（与引擎 `v5 = v8` 一致）', () => {
  const native = new Recorder();
  const e = new Engine(native);
  // 引擎的 `cy`（一个全角格宽）= `Engine[71744] ? Engine[71745] : -Engine[21632]`；
  // 这里把度量模式置 1、字号置 30 ⇒ cy = 30（否则缺省两侧都是 0，前进量恒 0、测不出东西）。
  e.engineValues.set(ENGINE_FIELD.fontMetricsMode, 1);
  e.engineValues.set(ENGINE_FIELD.fontSize, 30);
  // width=4、value=7、flags=0 ⇒ 数字只占最右一格（`cell.start` = 3）⇒ 右对齐前进量 = 3 × 30 = 90。
  call205(e, native, [im(0xc5), im(100), im(50), im(7), im(4), im(0)]);
  const d = native.draws[0]!;
  assert.equal(d.x, 190, '★绘制用的是前进后的 x（100 + 3×30）—— 修前这个值还会被写回 op2');
  assert.equal(d.y, 50);
  assert.equal(d.text.length > 0, true, '画的是格式化后的数字串');
});
