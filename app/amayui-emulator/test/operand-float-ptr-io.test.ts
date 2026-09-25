/** @tier T0 @kind core @subsystem vm */

/**
 * **float 指针族（操作数 tag `7` = `global-float-ptr` / `13` = `local-float-ptr`）的读/写都要保留小数**
 * （`tickets/T-0162`；读体时发现的**新**条目，语料有真实命中）。
 *
 * 引擎（`sub_41C300` = float 读原语；`sub_42BA00` raw 37132-37252 = float 写原语）：
 *  - 读 case 7：`*(float *)sub_41C300 指针池[payload]`；case 13（raw 37245-37249 的写侧同形）；
 *  - 写 case 7（raw 37222-37226）：`result = *(_DWORD *)(_this[95752] + 4 * payload); *(float *)result = a3;`
 *    —— **`*(float*)指针 = a3`，一次截断都没有**；
 *  - 写 case 13（raw 37245-37249）：局部版同形。
 *
 * emulator 修前两处都经过"整数口径"：
 *  - 读：`readFloatOperand` 的 `default: readIntOperand(...)` → `ref.ts` 的 `readRef` 对 `kind==='float'`
 *    做 `(raw) | 0` ⇒ `2.5` 读成 `2`；
 *  - 写：`writeFloatOperand` 的 `default: writeIntOperand(..., v | 0)` ⇒ `2.5` 写进 float 槽成 `2`。
 *
 * ★**语料真实命中**：`src/SETPOLYGON.txt:40/43` 是
 * `i2d3 (local-float-ptr 1) (local-float-ptr 0) (local-float 0)`（`0x2D3` = **fdiv**）——
 * op1 写、op2 读**都是 float 指针**，于是修前每一次 `i2d3` 都在对**被截断的整数**做除法。
 * `src/SETPOLYGON.txt:31-43` 共 12 处 float-ptr（`lookup-array`/`float-mov`/`i2d3`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import type { BinArg } from '../src/script/bin.js';
import { instr } from './harness.js';

const immFloat = (bits: number): BinArg => ({ type: 0x1, raw: bits }) as unknown as BinArg;
const lFptr = (slot: number): BinArg => ({ type: 0xd, raw: slot }) as unknown as BinArg;
const fbits = (v: number): number => new Uint32Array(new Float32Array([v]).buffer)[0]!;

function run(e: Engine, op: number, args: BinArg[]): void {
  OPS.get(op)!(makeCtx(e, e.frames[0]!, instr(op, args), e.native, () => {}));
}

test('★float 指针族**写侧**保留小数（`sub_42BA00` case 13 raw 37245-37249：`*(float*)指针 = a3`）', () => {
  const e = new Engine(new StubNative());
  const frame = e.curScript();
  frame.locals.floatPtr.set(1, { scope: 'local', kind: 'float', index: 0x20, stride: 4 });
  // float-mov (local-float-ptr 1) (立即 float 2.5)
  run(e, 0x2d5, [lFptr(1), immFloat(fbits(2.5))]);
  assert.equal(frame.locals.float.get(0x20), 2.5, '★修前经 `writeIntOperand(…, v|0)` ⇒ 这里会是 2');
});

test('★`i2d3 (local-float-ptr 1) (local-float-ptr 0) (local-float K)`：读/写两侧都不许截断', () => {
  const e = new Engine(new StubNative());
  const frame = e.curScript();
  // 复刻 src/SETPOLYGON.txt:40：ptr0 / ptr1 指向两个 float 槽
  frame.locals.floatPtr.set(0, { scope: 'local', kind: 'float', index: 0x30, stride: 4 });
  frame.locals.floatPtr.set(1, { scope: 'local', kind: 'float', index: 0x31, stride: 4 });
  frame.locals.float.set(0x30, 5.5); // 被除数
  frame.locals.float.set(0x31, 1.5); // 旧值（会被覆盖）
  run(e, 0x2d3, [lFptr(1), lFptr(0), immFloat(fbits(2))]);
  assert.equal(
    frame.locals.float.get(0x31),
    2.75,
    '★5.5 / 2 = 2.75：读侧（修前 5.5→5）+ 写侧（修前 2.75→2）两处都要修才成立',
  );
  assert.equal(frame.locals.float.get(0x30), 5.5, '被除数槽不被改动');
});
