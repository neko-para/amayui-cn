/** @tier T0 @kind core @subsystem ops */

/**
 * ★`0x191` **fabs**（`sub_42CEC0` raw 37896-37906，argc 2）：`op1 = fabs(op2)`（**浮点**）。
 *
 * 体全文：`arity 槽 = 5` ⇒ argc 2；`v3 = sub_41C300(_this, 2)`（浮点读）→ `fabs` → `writeFloatOperand(1, v4)`。
 * 语料 **13 处**（BTL / CGVIEWER / FIELD / INFOPL / SELACT / SELFORT）；此前零注册 ⇒ 命中即 `NotImplementedOp`
 * （审计 P1 `op-1/0x191-fabs-missing`，`tickets/T-0076` 的 B3）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { loadScriptIntoFrame, OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const T_LOCAL_FLOAT = 0xa;

/** 跑 `i191 <浮点槽 1> <浮点槽 2>`，返回写回的浮点值。 */
async function fabs(op: number, v: number): Promise<number> {
  const e = new Engine(new StubNative(() => {}), new InputManager());
  const instr: BinInstruction = {
    opcode: op,
    name: `i${op.toString(16)}`,
    argc: 2,
    args: [
      { type: T_LOCAL_FLOAT, raw: 1 },
      { type: T_LOCAL_FLOAT, raw: 2 },
    ] as unknown as BinArg[],
    byteOffset: 0x3c,
    index: 0,
  };
  const sc: ScriptBinary = {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  const f = e.curScript();
  loadScriptIntoFrame(f, sc, 'TEST.BIN');
  f.locals.float.set(2, v);
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', '0x191 应已实现');
  return f.locals.float.get(1) ?? Number.NaN;
}

test('★0x191：op1 = |op2|（浮点；此前三表全无 ⇒ 命中即硬停）', async () => {
  // ★2026-09-23：0x191 的注册表棘轮已并入 `test/registry-classification.test.ts`（`tickets/T-0129`）。
  assert.equal(await fabs(0x191, -3.5), 3.5);
  assert.equal(await fabs(0x191, 2.25), 2.25);
  assert.equal(await fabs(0x191, 0), 0);
  assert.equal(await fabs(0x191, -0.5), 0.5);
});
