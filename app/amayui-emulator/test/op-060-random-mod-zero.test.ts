/** @tier T0 @kind core @subsystem vm */

/**
 * **`0x060` random 的模 0 分支：抛之前先写一次 `op1 = 0`**（`tickets/T-0179` 第 52 轮）。
 *
 * 体 `sub_42CA50`（raw 37715-37740）逐行：
 * ```text
 * raw 37724  dword_55D54C = rand();                    // ★任何分支之前先推进 LCG（抛错路径也不例外）
 * raw 37726  dword_55D548 = v2;                        // 引擎自己的调试残留，无读者
 * raw 37727  if ( !v2 ) {                              // ★唯一的门：只有「恰好 0」才抛
 * raw 37729      sub_42B4B0(_this, 1, 0);              // ★★先写 op1 = 0（case 3 = 全局 int 持久池）
 *            …   StringFormat(aRandom0) 进 message_buf；_CxxThrowException(Command_ShowMessage);
 *            }
 * raw 37739  sub_42B4B0(_this, 1, dword_55D54C % v2);  // C 的有符号取模（被除数非负 ⇒ 结果非负）
 * ```
 * ⇒ 抛错路径**也是一次可观测的写**：`op1` 在异常之前已被写成 0。
 * emulator（`src/vm/handlers/arithmetic.ts` 的 `op_random`）已按体落了这一格，但此前**没有守卫**（
 * `engine-field-store.test.ts` 只断了"会抛"）——本文件把它钉住，并把「恰好 0 才抛、负模数照算」一起钉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx, type StepCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { readIntOperand, writeIntOperand } from '../src/vm/operand.js';
import type { BinArg } from '../src/script/bin.js';
import { instr } from './harness.js';

const gInt = (slot: number): BinArg => ({ type: 0x3, raw: slot }) as unknown as BinArg;
const imm = (v: number): BinArg => ({ type: 0x0, raw: v }) as unknown as BinArg;

const SLOT = 0x40;

/** 造一条 `random (global-int SLOT) <mod>` 的 ctx（目标槽先经**操作数写路径**垫一个非 0 旧值）。 */
function ctxRandom(mod: number, oldValue: number): { e: Engine; ctx: StepCtx; read: () => number } {
  const e = new Engine(new StubNative());
  const f = e.curScript();
  // ★必须走 `writeIntOperand`：全局 int 池是 **ENC** 的（`readIntOperand` 走 `decIntSlot`），
  //   直接 `globals.int.set(slot, v)` 会被读成 `dec(key, v)` 的垃圾。
  writeIntOperand(e, f, instr(0x55, [gInt(SLOT), imm(oldValue)]), 1, oldValue);
  const ins = instr(0x60, [gInt(SLOT), imm(mod)]);
  const ctx = makeCtx(e, f, ins, e.native, () => {});
  return { e, ctx, read: () => readIntOperand(e, f, ins, 1) };
}

test('★0x060 模数为 0：**先写 op1 = 0 再抛**（引擎 raw 37729；修前直接 throw、少这一次写）', () => {
  const { ctx, read } = ctxRandom(0, 1234);
  assert.equal(read(), 1234, '前提：目标槽是一份非 0 旧值');
  assert.throws(() => OPS.get(0x60)!(ctx), /模数为 0/, '恰好 0 ⇒ 走引擎的异常路径');
  assert.equal(read(), 0, '★★raw 37729：异常之前 op1 已被写成 0（不是保留旧值 1234）');
});

test('0x060 的门是「恰好 0」：负模数**照算**（有符号取模、被除数非负 ⇒ 结果非负）', () => {
  const { ctx, read } = ctxRandom(-3, 777);
  OPS.get(0x60)!(ctx);
  const v = read();
  assert.notEqual(v, 777, '负模数必须真的算一次（不是提前返回）');
  assert.ok(v >= 0 && v <= 2, `(rand() % -3) 的结果应落在 [0, 2]（实际 ${v}）`);
});
