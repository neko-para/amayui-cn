/**
 * 「未知指令 → 作为桩函数跳过」的恢复路径测试（控制窗按钮背后的机制）。
 *
 * 前提（interpreter.stepOnce 的契约）：查表/抛 NotImplementedOp 阶段**不修改任何 VM 状态**
 * （不读操作数、不推进 ip）。因此调用方在登记 `Engine.unknownOpStubs` 后，可以对**同一条指令**
 * 直接重试 stepOnce 而无需回滚 —— 这正是控制窗点按钮后的行为（见 src/renderer/renderer.ts）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { NotImplementedOp, stepOnce } from '../src/vm/interpreter.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';

const HEADER_LEN = 0x3c;

/** 造一个最小 v4 脚本：header(0x3c) + N 条 dword 指令（每条只含 opcode，argc=0）。 */
function scriptOf(...opcodes: number[]): ScriptBinary {
  const instructions: BinInstruction[] = opcodes.map((opcode, i) => ({
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: 0,
    args: [],
    byteOffset: HEADER_LEN + i * 4,
    index: i,
  }));
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: HEADER_LEN,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: opcodes.length },
      { length: 0, offset: opcodes.length },
      { length: 0, offset: opcodes.length },
    ],
    instructions,
    labelTargets: new Set<number>(),
    raw: new Uint8Array(HEADER_LEN + opcodes.length * 4),
  };
}

test('未知 opcode：先抛 NotImplementedOp（带可重试定位信息），登记用户桩后同一条指令即放行', async () => {
  const e = new Engine(new StubNative(() => {}));
  // 0x1111 不在 OPS/NATIVE_OPS/ENGINE_INTERNAL_OPS 任何静态表中（永不与真实 opcode 冲突的测试值）。
  loadScriptIntoFrame(e.curScript(), scriptOf(0x1111, 0x2f6), 'TEST.BIN');
  const frame = e.curScript();
  assert.equal(frame.ip, 0);

  // 1) 未登记：硬报错，且**状态未被改动**（ip 仍 0 → 可从同一条指令重试）
  const err = await stepOnce(e).then(
    () => null,
    (x: unknown) => x as NotImplementedOp,
  );
  assert.ok(err instanceof NotImplementedOp, '未登记的用户桩应抛 NotImplementedOp');
  assert.equal(err.opcode, 0x1111);
  assert.equal(err.scriptName, 'TEST.BIN');
  assert.equal(err.instrIndex, 0);
  assert.equal(err.byteOffset, HEADER_LEN);
  assert.equal(frame.ip, 0, '抛错阶段不得推进 ip（不然无法从同一条指令重试）');
  assert.equal(frame.locals.int.size, 0, '抛错阶段不得写局部变量池');

  // 2) 用户点「作为桩函数跳过」：登记 no-op 桩 → 从同一条指令重试成功
  e.unknownOpStubs.set(0x1111, 1);
  const t = await stepOnce(e);
  assert.equal(t.opcode, 0x1111);
  assert.equal(t.handlerKind, 'user-stub');
  assert.equal(frame.ip, 1, 'user-stub 是 no-op，ip 应正常 +1');

  // 3) 后续静态表里的指令不受影响（0x2f6 = engine-internal）
  const t2 = await stepOnce(e);
  assert.equal(t2.opcode, 0x2f6);
  assert.equal(t2.handlerKind, 'engine-internal');
  assert.equal(frame.ip, 2);
});

test('用户桩只兜底：不会遮蔽静态表里的同 opcode 实现', async () => {
  const e = new Engine(new StubNative(() => {}));
  loadScriptIntoFrame(e.curScript(), scriptOf(0x2f6), 'TEST.BIN');
  // 即便用户"跳过"了一个已实现的 opcode，解析仍优先静态表（engine-internal），不会降级成 user-stub。
  e.unknownOpStubs.set(0x2f6, 1);
  const t = await stepOnce(e);
  assert.equal(t.handlerKind, 'engine-internal');
});

test('多条未知指令可逐条跳过（控制窗反复点的场景）', async () => {
  const e = new Engine(new StubNative(() => {}));
  loadScriptIntoFrame(e.curScript(), scriptOf(0x1111, 0x2222, 0x3333), 'TEST.BIN');
  const frame = e.curScript();
  const ops = [0x1111, 0x2222, 0x3333];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const err = await stepOnce(e).then(
      () => null,
      (x: unknown) => x as NotImplementedOp,
    );
    assert.ok(err instanceof NotImplementedOp && err.opcode === op, `应停在第 ${i} 条未知指令 0x${op.toString(16)}`);
    assert.equal(frame.ip, i, '每次抛错都应停在自己的指令上（未推进）');
    e.unknownOpStubs.set(op, 1);
    const t = await stepOnce(e);
    assert.equal(t.handlerKind, 'user-stub');
    assert.equal(t.opcode, op);
  }
  assert.equal(frame.ip, 3, '三条指令逐条跳过后 ip 应到末尾');
});
