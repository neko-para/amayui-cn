/** @tier T0 @kind core @subsystem ops */

/**
 * ★`0xD0`（`id0`，argc 1）：**op1 = 墙钟毫秒**（`timeGetTime()`）。
 *
 * 引擎真源（**定义头 grep** `//----- \(0042E910\)` ⇒ raw 38790，不是按邻近常量猜）：
 * ```c
 * //----- (0042E910) --------------------------------------------------------
 * int __thiscall sub_42E910(_DWORD *_this) {
 *   _this[30 * _this[95776] + 95805] = 3;      // raw 38795：arity 槽 ⇒ argc = 1
 *   Time = timeGetTime();                      // raw 38796
 *   return sub_42B4B0((int)_this, 1, Time);    // raw 38797：op1 ← 毫秒（= writeIntOperand(1, Time)）
 * }
 * ```
 * **无门控、无副作用**、只写一个操作数；与 `0xAD`（秒计时器 `sub_4380F0`，`engine-fields.ts`
 * 的 `op_seconds_timer`）**同一个时钟源** `timeGetTime()`。
 *
 * ★披露：任务书点名的 `Engine.wallClockMs` **在本工程里不存在**（全仓 grep 无此标识符）——
 * `timeGetTime()` 的既有等价物是 **`Engine.nowMs`**（`src/vm/engine.ts`；驱动每帧开头把宿主墙钟写进去：
 * `frame/loop.ts` 的 `e.nowMs = host.now()`，产品侧 = `performance.now()`，见 `tickets/T-0008` 的单一时间域 D1）。
 * 本实现落在 `nowMs`（不新增同义字段 ⇒ 不会变成"有写无读"）。取整为 **i32**：引擎 `int Time` 收
 * `timeGetTime()` 的 DWORD 位模式，重写侧 `Math.trunc(...) | 0` 同口径。
 *
 * 偏差/口径已在 `handlers/engine-fields.ts` 的 `op_wall_clock_ms` 注释、`docs-new/03-engine/opcode-table.md`
 * 该行与 `analysis/opcode-gaps.json` 的 `0xD0` note 披露。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { loadScriptIntoFrame, OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { enc, dec } from '../src/vm/bits.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { scriptDerived } from './harness.js';

const T_LOCAL = 0x9; // 出参：本地 int 槽

/** 装一条 `0xD0` 进帧、注入时钟、真执行一次，返回读回的 op1（脚本可见值）。 */
async function run(
  nowMs: number,
  opts: { engine?: Engine; afterLoad?: (e: Engine) => void } = {},
): Promise<{ got: number; kind: string; engine: Engine }> {
  const e = opts.engine ?? new Engine(new StubNative(() => {}), new InputManager());
  e.key = 0x12345678;
  const instr: BinInstruction = {
    opcode: 0xd0,
    name: 'id0',
    argc: 1,
    args: [{ type: T_LOCAL, raw: 0x50 }] as unknown as BinArg[],
    byteOffset: 0x3c,
    index: 0,
  };
  const sc: ScriptBinary = {
    ...scriptDerived(),
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
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  // ★预置必须发生在**装载之后**：`loadScriptIntoFrame` 会 `locals.clear()` 重建局部池（引擎语义）
  opts.afterLoad?.(e);
  e.nowMs = nowMs; // = 引擎 `timeGetTime()` 的注入点
  const t = await stepOnce(e);
  return { got: dec(e.key, e.curScript().locals.int.get(0x50) ?? 0) | 0, kind: t.handlerKind, engine: e };
}

// ★2026-09-23：本票的「注册表棘轮」已并入 `test/registry-classification.test.ts` 的**一张表**
//   （`tickets/T-0129`：同一不变式在 8 个文件里各写一遍，改一处分类要改 9 个地方）。
//   那条表同样能红，且会指出「原本该在哪一类」。

test('★0xD0：注入 wallClock（`Engine.nowMs`）= 123456 ⇒ 读回 op1 = 123456', async () => {
  const { got, kind } = await run(123456);
  assert.equal(kind, 'implemented', 'handlerKind 必须是 implemented');
  assert.equal(got, 123456, 'op1 = timeGetTime() 毫秒（引擎 raw 38796-38797）');
});

test('0xD0：值随注入时钟变化（不是常量 / 不是静默 0）', async () => {
  assert.equal((await run(0)).got, 0, '时钟 0 ⇒ op1 = 0');
  assert.equal((await run(1)).got, 1);
  assert.equal((await run(0x7fffffff)).got, 0x7fffffff, 'i32 上界原样写出');
  assert.equal((await run(1234.7)).got, 1234, '小数毫秒按 `Math.trunc` 取整（引擎收 int）');
  assert.notEqual((await run(7)).got, (await run(9)).got, '两次不同时钟必须给出不同结果（防"写死常量"）');
});

test('0xD0：argc = 1（体里 arity 槽 = 3 ⇒ `2*argc+1`）且只写 op1（邻槽不动）', async () => {
  // ★2026-09-23 重写（`tickets/T-0125`）：原版把「另一个引擎」的 `enc`→`dec` 往返当成"其它槽不受影响"
  //   —— 那个引擎**从未跑过 0xD0**，是恒真（把 handler 改成写三个槽它也不会红）。
  //   现在：**在真正要执行的那台引擎上**预置邻槽 0x51，真执行 0xD0，再断言邻槽原值。
  //   反例实验：把 `op_wall_clock_ms` 改成同时写 0x51 ⇒ 本行必红。
  const e = new Engine(new StubNative(() => {}), new InputManager());
  const { got, kind } = await run(42, {
    engine: e,
    afterLoad: (x) => x.curScript().locals.int.set(0x51, enc(x.key, 0x9999)),
  });
  assert.equal(kind, 'implemented');
  assert.equal(got, 42, 'op1 = 墙钟');
  assert.equal(
    dec(e.key, e.curScript().locals.int.get(0x51) ?? 0) | 0,
    0x9999,
    '★邻槽 0x51 必须原值（引擎体只调一次 `sub_42B4B0(_this, 1, …)`）',
  );
});
