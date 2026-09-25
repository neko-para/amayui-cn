/** @tier T0 @kind ratchet @subsystem adv */

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
    // ★`tickets/T-0173`：这里原来还有 `callLink: e.callLink` / `callFlag: e.callFlag` 两格 ——
    //   那两格是 `Engine.callLink`(0x5D888) / `Engine.callFlag`(0x5D88C) 的**零读者镜像**，
    //   与 `callRet` 不同：没有任何生产路径读它们，`vmState()` 也从未对它们取过不同的值
    //   （两格在整个用例里恒为初值）⇒ `T-0173` 删字段时一并从快照里去掉（**不是**放宽断言：
    //   快照剩下的每一格仍逐格比对，「除 ip 之外一格都不许动」这条判据一字未改）。引擎侧那两格
    //   的活模型见下方 `T-0173` 用例（`Engine.dispatchSavedCur` / `Engine.dispatchSavedFlags`）。
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

/**
 * ★**`tickets/T-0173`：`Engine.callLink` / `Engine.callFlag` 两个零读者镜像字段已删**。
 *
 * 读体复核（`engine/天结_unpacked.exe_utf8.c`，逐条见 `tickets/T-0173/changes-t0173.md` §1）：
 * emulator 那两格过去只被声明（`engine.ts` 的 `callLink = -1` / `callFlag = 0`）与 `exit-script`
 * 复位（`control.ts`），**全仓 0 个生产读者**（`grep -rn 'callLink\|callFlag' app/amayui-emulator/src`
 * 只剩注释）⇒ 属"多余状态"，删掉比在死写基线里长期挂 `reason` 干净。
 *
 * ★**引擎侧并不是没有对应格**（这才是本条要钉的第二件事，防止下一个人又把它们当"引擎也没有"）：
 * `0x5D888`/`0x5D88C` 是引擎的**活字段**，在 `sub_40FB60` 存（raw **18978** 与 **18982**）、在
 * `sub_41A820` 的 `caller == -10` 分支读回（raw **25663-25666**）；只是 emulator 早已用**另外两个名字**
 * 建模同一条通路 —— `Engine.dispatchSavedCur` / `Engine.dispatchSavedFlags`（`control.ts` 的
 * `dispatchNextRequest` 存、`-10` 分支还原；守卫 `test/append-packs.test.ts:281/373`、
 * `test/engine-fields-t0161.test.ts:115`）⇒ 删掉的是**重复表示**，不是能力。
 */
test('T-0173：Engine 上不再有零读者镜像字段 callLink/callFlag（同名格只留 dispatchSaved*）', () => {
  const e = mkEngine([instr(0x101, [])]);
  for (const dead of ['callLink', 'callFlag'] as const) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(e, dead),
      `Engine.${dead} 应已删除（T-0173：零读者镜像；引擎的对应格由 dispatchSaved* 建模）`,
    );
  }
  // 反面（防"顺手删多了"）：活的那对必须还在，且 -10 哨兵还原走的是它们。
  assert.equal(e.dispatchSavedCur, -1, 'Engine.dispatchSavedCur 是 0x5D888(383112) 的活建模，不许删');
  assert.equal(e.dispatchSavedFlags, 0, 'Engine.dispatchSavedFlags 是 0x5D88C(383116) 的活建模，不许删');
});
