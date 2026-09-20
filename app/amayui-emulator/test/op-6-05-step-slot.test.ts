/**
 * 审计 `op-6-05`：`0x1A8` 与 `0xAF` 的引擎 handler 是**同一个** `sub_419690`，体是
 * "写当前帧的指令步长槽 = 1"，不是空实现。
 *
 * `engine/天结_unpacked.exe_utf8.c`：
 * ```c
 * 24775 //----- (00419690) --------------------------------------------------------
 * 24776 int __thiscall sub_419690(_DWORD *_this)
 * 24780   result = _this[95776];                    // 当前帧下标
 * 24781   _this[30 * result + 95805] = 1;           // ★步长槽 = 1 个 dword
 * 24782   return result;
 * 22898   *(_DWORD *)(_this + 676696) = sub_419690; // = 675996 + 4*0xAF
 * 677692  *(_DWORD *)(_this + 677692) = sub_419690; // = 675996 + 4*0x1A8
 * 20165   _this[30 * _this[95776] + 95782] += 4 * _this[30 * _this[95776] + 95805];  // 唯一读者
 * ```
 * ⇒ 写 1 = **ip 前进 4 字节 = 1 条指令**，与 0 操作数指令同值，也正是 emulator
 * `interpreter.stepOnce` 的默认推进（`curFrame.ip += 1`）。emulator 不建模该槽
 * （它只是派发器的内部计数器）⇒ 本条的守卫只能钉"恰好 ip+1、零其它 VM 副作用"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_INTERNAL_OPS, OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { instr, mkEngine } from './harness.js';
import type { Engine } from '../src/vm/engine.js';

/** VM 可见态的快照（本条的判据：除 ip 之外一格都不许动）。 */
function vmState(e: Engine): Record<string, unknown> {
  const f = e.curScript();
  return {
    cur: e.cur,
    callRet: e.callRet,
    callLink: e.callLink,
    callFlag: e.callFlag,
    effectFlags: e.effectFlags,
    awaitingAdvance: e.awaitingAdvance,
    globalsInt: [...e.globals.int.entries()],
    globalsStr: [...e.globals.str.entries()],
    localInt: [...f.locals.int.entries()],
    localStr: [...f.locals.str.entries()],
    retStack: [...f.retStack],
  };
}

test('op-6-05：`0x1A8` / `0xAF` 都注册了 handler（不再是"命中即硬报错"）', () => {
  assert.ok(OPS.get(0x1a8), '0x1A8 在 OPS 里（CONTROL_OPS）');
  // ★`ENGINE_INTERNAL_OPS` 不在 `OPS` 合并表里 —— `interpreter.resolveHandler` 单独查它
  //   （OPS → NATIVE_OPS → ENGINE_INTERNAL_OPS → 用户桩）。
  assert.ok(ENGINE_INTERNAL_OPS.get(0xaf), '0xAF 在 ENGINE_INTERNAL_OPS 里');
});

for (const op of [0x1a8, 0xaf]) {
  test(`op-6-05：0x${op.toString(16)} 的体 = "写步长槽 = 1" ⇒ emulator 侧恰好 ip+1、无其它副作用`, async () => {
    const e = mkEngine([instr(op, []), instr(0x101, []), instr(0x101, [])]);
    const before = vmState(e);
    await stepOnce(e);
    assert.equal(e.curScript().ip, 1, `0x${op.toString(16)}：ip 恰好 +1（引擎 raw 20165 的 ip += 4*1）`);
    assert.deepEqual(vmState(e), before, `0x${op.toString(16)}：不写任何 VM 可见态`);
  });
}

test('op-6-05：两条的**行为**逐字相同（引擎体的同一性 ⇒ 不该有分叉）', async () => {
  const run = async (op: number): Promise<{ ip: number; state: Record<string, unknown> }> => {
    const e = mkEngine([instr(op, [])]);
    await stepOnce(e);
    return { ip: e.curScript().ip, state: vmState(e) };
  };
  const a = await run(0x1a8);
  const b = await run(0xaf);
  assert.deepEqual(b, a, '两条对 VM 的影响完全相同（含 ip）');
});
