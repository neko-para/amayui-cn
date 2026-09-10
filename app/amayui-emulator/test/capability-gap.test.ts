/**
 * **闸门 B 回归测试**：`StepTrace.gap`（能力缺口）—— 被当作 no-op 跳过、却收到**非平凡实参**的指令。
 *
 * 为什么要有它：现在的分类只有"真实现 / 已插桩 / 真·忽略"，其中"真·忽略"里混着两类完全不同的东西：
 *  - **本场景空转**（`i32f 0`：关灯索引 0，引擎里也没什么可做的）→ 忽略它是**对的**；
 *  - **脚本真的想做点什么而我没做**（`i213 1 19a28 1f4`：给消息窗对象配参数）→ **这就是能力缺口**。
 * 不区分这两类，就没法从"忽略清单"里看出真正缺失的能力。
 *
 * 判据（见 `interpreter.ts` 的 `significantOperands`）：立即数 |v|>1；池里的 int/float 解码值 |v|>1；
 * 任何指针/字符串/数组操作数。**只用它降噪，不声称"缺口一定导致画面错误"**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce, formatOperands } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { enc } from '../src/vm/bits.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const H = 0x3c;
const T_IMM = 0x0;
const T_GLOBAL_INT = 0x3;
const T_GLOBAL_PTR = 0x6;

function script(opcode: number, args: { type: number; raw: number }[]): ScriptBinary {
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: args.length,
    args: args.map((a) => ({ type: a.type, raw: a.raw })),
    byteOffset: H,
    index: 0,
  };
  return {
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
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 4 + 8 * args.length),
  };
}

test('被忽略的 no-op 指令收到立即数实参 ⇒ 记能力缺口（gap）', async () => {
  const e = new Engine(new StubNative(() => {}));
  // 0x346 = op_engine_internal（纯 no-op），argc=1
  loadScriptIntoFrame(e.curScript(), script(0x346, [{ type: T_IMM, raw: 0x1f4 }]), 'TEST.BIN');
  const t = await stepOnce(e);
  assert.equal(t.handlerKind, 'engine-internal');
  assert.equal(t.noop, true);
  assert.ok(t.gap, '收到实参 0x1f4（>1）⇒ 应记为能力缺口');
  assert.deepEqual(t.gap!.operands, ['imm-int#500'], '操作数旁注带解码值');
});

test('被忽略的 no-op 指令只有 0/1 实参 ⇒ 视为空转，不记缺口', async () => {
  const e = new Engine(new StubNative(() => {}));
  loadScriptIntoFrame(
    e.curScript(),
    script(0x349, [
      { type: T_IMM, raw: 0 },
      { type: T_IMM, raw: 1 },
    ]),
    'TEST.BIN',
  );
  const t = await stepOnce(e);
  assert.equal(t.noop, true);
  assert.equal(t.gap, undefined, '0/1 是开关默认位，不算"传了参数"');
});

test('指针/字符串操作数一律算缺口（脚本传了真实对象）', async () => {
  const e = new Engine(new StubNative(() => {}));
  e.globals.ptr.set(0x10, { scope: 'global', kind: 'int', index: 0x200, stride: 4 });
  loadScriptIntoFrame(e.curScript(), script(0x346, [{ type: T_GLOBAL_PTR, raw: 0x10 }]), 'TEST.BIN');
  const t = await stepOnce(e);
  assert.ok(t.gap, '指针操作数 ⇒ 缺口');
  assert.deepEqual(t.gap!.operands, ['g-int*#16'], '指针型只写槽号（不解引用）');
});

test('已实现（非 no-op）的指令即使有实参也不算缺口', async () => {
  const e = new Engine(new StubNative(() => {}));
  // 0x2da = OPS 里的真实现（CG 数字条登记）
  loadScriptIntoFrame(
    e.curScript(),
    script(0x2da, [
      { type: T_IMM, raw: 0 },
      { type: T_IMM, raw: 0x48 },
      { type: T_IMM, raw: 0x2a1 },
      { type: T_IMM, raw: 1 },
      { type: T_IMM, raw: 2 },
      { type: T_IMM, raw: 3 },
      { type: T_IMM, raw: 4 },
      { type: T_IMM, raw: 5 },
    ]),
    'TEST.BIN',
  );
  const t = await stepOnce(e);
  assert.equal(t.handlerKind, 'implemented');
  assert.equal(t.gap, undefined, '只有"被忽略"的指令才谈得上缺口');
});

test('用户桩跳过的指令（user-stub）也算缺口路径', async () => {
  const e = new Engine(new StubNative(() => {}));
  // 0x1111 不在任何静态表里（与 skip-unknown.test.ts 用同一个「永不冲突」的值）
  e.unknownOpStubs.set(0x1111, 1);
  loadScriptIntoFrame(e.curScript(), script(0x1111, [{ type: T_IMM, raw: 99 }]), 'TEST.BIN');
  const t = await stepOnce(e);
  assert.equal(t.handlerKind, 'user-stub');
  assert.ok(t.gap, '用户桩同样会掩盖真实语义 ⇒ 也要记缺口');
});

test('formatOperands：值型操作数带解码值，取不到时只留下标（绝不抛错）', async () => {
  const e = new Engine(new StubNative(() => {}));
  e.key = 0x12345678;
  e.globals.int.set(0x41, enc(e.key, 1234));
  loadScriptIntoFrame(
    e.curScript(),
    script(0x346, [
      { type: T_GLOBAL_INT, raw: 0x41 },
      { type: T_IMM, raw: 7 },
    ]),
    'TEST.BIN',
  );
  const f = e.curScript();
  const ops = formatOperands(e, f, f.script!.instructions[0]!);
  assert.deepEqual(ops, ['g-int#1234', 'imm-int#7']);
});
