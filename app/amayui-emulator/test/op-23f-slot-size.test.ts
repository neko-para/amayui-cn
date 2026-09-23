/** @tier T0 @kind core @subsystem ops */

/**
 * **`0x23F` 槽尺寸 getter**（`tickets/T-0076` 的 B3 补；语料 3 处 = FIELD×2 / BTL×1）。
 *
 * 引擎体（`sub_4307B0` raw 40019-40031，argc 2）：`v2 = _this[op2 + 94672]`；`v2 == 0` ⇒ `op1 = -1`，
 * 否则 `op1 = (int)(sub_4080B0(v2) * 1000.0)`（`dbl_51FB50 = 1000.0`，raw 4393）。
 * ★`sub_4080B0`（体 raw 12960-12980）按 `node[+1084]` 分派 vtable `+40`/`+68` 取尺寸；
 * 本文语料里 `0x23F` 的 `op2` 是**刚 `create-texture` 的槽**（`src/FIELD.txt:13718-13721`，120×120 正方形）
 * ⇒ **宽/高不可分辨**（已在 handler 注释披露）；`0x23E`（同族另一半）语料 0 处 ⇒ `deferred`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';

function instr(op: number, argc: number, args: { type: number; raw: number }[]): never {
  return { opcode: op, name: `i${op.toString(16)}`, argc, args, byteOffset: 0, index: 0 } as never;
}

test('★0x23F：op1 = 槽尺寸 ×1000；缺槽 ⇒ −1（与 0x1FA 释放联动）', async () => {
  const e = new Engine(new StubNative(() => {}));
  const frame = e.frames[0]!;
  const out = 0x10; // 出参：**本地** int 槽（type 0x9 才可写，见 `operand.ts`）
  const { dec } = await import('../src/vm/bits.js');
  const read = (): number => dec(e.key, frame.locals.int.get(out) ?? 0) | 0; // `| 0`：引擎的 −1 就是 0xFFFFFFFF
  const args = (slot: number): { type: number; raw: number }[] => [{ type: 0x9, raw: out }, { type: 0x0, raw: slot }];
  const run = async (op: number, argc: number, a: { type: number; raw: number }[]): Promise<void> => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op); // 0x1F8/0x23F 在 OPS、0x1FA 在 NATIVE_OPS
    assert.ok(h, `opcode 0x${op.toString(16)} 未注册`);
    await h!(makeCtx(e, frame, instr(op, argc, a), e.native, () => {}));
  };

  // 缺槽 ⇒ −1（引擎 `v2 == 0` 分支）。
  await run(0x23f, 2, args(42));
  assert.equal(read(), -1, '缺槽 ⇒ −1');

  // `create-texture 2a 78 78 0`（= 120×120，正是 `src/FIELD.txt:13718` 那一行）⇒ 120000。
  await run(0x1f8, 4, [
    { type: 0x0, raw: 42 },
    { type: 0x0, raw: 0x78 },
    { type: 0x0, raw: 0x78 },
    { type: 0x0, raw: 0 },
  ]);
  await run(0x23f, 2, args(42));
  assert.equal(read(), 120000, '★120 × 1000（`×1000` 取整，与 `dbl_51FB50` 同口径）');

  // `release-texture 2a` ⇒ 尺寸记录随之消失 ⇒ 又回 −1。
  await run(0x1fa, 1, [{ type: 0x0, raw: 42 }]);
  await run(0x23f, 2, args(42));
  assert.equal(read(), -1, '释放后 ⇒ −1（不留陈旧尺寸）');
});
