/** @tier T0 @kind ratchet @subsystem ops */

/**
 * **T-0163 的「桩族越界诊断」三条**（`0x10c` / `0x137` / `0x30a`）。
 *
 * 三条都是审计 §4.1 的 `missing-branch`：**引擎在实参越界时不是静默接受**（改脚本/坏脚本才会命中，
 * 语料 0 处）。
 *
 *  - `0x10c`（SetKeyMulti，P3）：`op1 > 0x1F`（unsigned）⇒ `_CxxThrowException(ShowMessage
 *    「SetKeyMultiの引数が不正です．」)`（raw **30626-30631**，抛点在写表之前）⇒ **本轮之前已修**
 *    （`handlers/input.ts` 的 `op_set_key_multi`：读满 op1/op2、越界抛 `ShowMessageError`；守卫
 *    `test/input.test.ts`）。本文件只钉"它确实在 `OPS` 且确实抛引擎原文"。
 *  - `0x137`（ResetStack，P3）：`op1 > 0xA`（unsigned）⇒ `sub_408050` 写错误缓冲
 *    「ResetStackの引数が不正です．\r\n」（字面量 raw 4423）+ `sub_4034D0` 上报（raw **30714-30718**），
 *    **不碰栈槽**；注意它**不是** `_CxxThrowException`（与 0x10c/0x30a 不同形）。
 *  - `0x30a`（SetGesKey，P3）：`op1 > 0x1F || op2 > 7`（unsigned）⇒ `_CxxThrowException(ShowMessage
 *    「SetGesKeyの引数が不正です．」)`（raw **33828-33833**，抛点在 `_this[op2+1969] = op1` 之前）。
 *
 * ★这三条的"越界诊断"本轮**只登记不实现**（`0x10c` 除外，它已在前一轮修好）：忠实实现需要在
 * `src/vm/operandPlan.ts` 声明操作数计划（并把条目从 `ENGINE_INTERNAL_OPS` 迁进 `OPS`），
 * `0x137` 还需要一个**非致命**的宿主错误上报缝 —— 两个文件都不属于本票的文件范围（见
 * `tickets/T-0163/changes-c163.md` 的交接清单）。本测试把**登记内容**钉住（不许丢掉这条缺口）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { ShowMessageError } from '../src/vm/native.js';
import { Engine, Frame } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { makeCtx } from '../src/vm/step.js';
import { stepOnce } from '../src/vm/interpreter.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr, scriptDerived } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const STUBS = path.join(ROOT, 'app/amayui-emulator/src/vm/handlers/stubs.ts');
const H = 0x3c;

function script(opcode: number, argc: number): ScriptBinary {
  const one: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc,
    args: Array.from({ length: argc }, (_, i) => ({ type: 0, raw: 6 + i })),
    byteOffset: H,
    index: 0,
  };
  return {
    ...scriptDerived(),
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: H,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [one],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 4 + 8 * argc),
  };
}

test('★0x10c（P3 missing-branch）：已在 OPS 真实现，op1 > 0x1F 抛引擎原文 ShowMessageError', () => {
  assert.ok(OPS.has(0x10c), '0x10c 已转真实现（handlers/input.ts 的 op_set_key_multi）');
  assert.equal(ENGINE_INTERNAL_OPS.has(0x10c), false, '不再在 ENGINE_INTERNAL_OPS（旧登记会静默吞掉越界实参）');
  const native = new StubNative(() => {});
  const e = new Engine(native, new InputManager());
  const h = OPS.get(0x10c);
  assert.ok(h, '0x10c handler 必须存在');
  assert.throws(
    () => h!(makeCtx(e, new Frame(), instr(0x10c, [im(0x20), im(0x1c)]), native, () => {})),
    (err: unknown) =>
      err instanceof ShowMessageError &&
      /SetKeyMultiの引数が不正です．/.test(err.engineText) &&
      err.opcode === 0x10c,
    'op1=0x20 越界 ⇒ 引擎 raw 30626-30631 的 ShowMessage，且写在抛点之后一格都不动',
  );
});

test('★0x137 / 0x30a（P3 missing-branch）：仍登记在 ENGINE_INTERNAL_OPS（不硬停），且缺口如实写进源文', async () => {
  for (const op of [0x137, 0x30a]) {
    assert.ok(ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 必须已登记（否则命中即 NotImplementedOp）`);
    const e = new Engine(new StubNative(() => {}));
    loadScriptIntoFrame(e.curScript(), script(op, 1), 'TEST.BIN');
    const before = e.curScript().ip;
    const t = await stepOnce(e);
    assert.equal(t.handlerKind, 'engine-internal');
    assert.equal(e.curScript().ip, before + 1, '语料合法区间 ⇒ 只应"合法跳过"');
  }
  const src = fs.readFileSync(STUBS, 'utf8');
  // 0x137：越界 ⇒ 写错误缓冲 + sub_4034D0 上报（不是 C++ 异常），且不碰栈槽
  for (const s of ['30714', 'ResetStackの引数が不正です．', 'sub_4034D0', '本轮未实现', '不碰栈槽']) {
    assert.ok(src.includes(s), `0x137 的登记必须出现 ${s}`);
  }
  // 0x30a：越界 ⇒ _CxxThrowException(SetGesKey…)，抛点在写 _this[op2+1969] 之前
  for (const s of ['33828', 'SetGesKeyの引数が不正です．', '1969', '本轮未实现']) {
    assert.ok(src.includes(s), `0x30a 的登记必须出现 ${s}`);
  }
});
