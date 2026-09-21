/**
 * ★通用 `Queue_int` 队族：`0x132` 重建 / `0x133` 压入 / `0x134` 弹出
 * （`tickets/T-0076` 的 B3；筛体方案 `docs-new/99-records/2026-09-b3/b3-screening-2026-09.md` §2.1）。
 *
 * 引擎真源（逐条**定义头 grep** 定位，非邻近常量推断）：
 *  - `//----- (00422150)` **raw 30647-30681** ⇒ `0x132`：`op1 > 0xA`（unsigned）⇒ 打 "RESETQ" 错误串、
 *    **不动队列**；否则析构旧队 → `new(0x1C)` → `sub_407C50`（raw 12653-12663 = `buf=new[0x400]`(256 int)
 *    + cap/step=256 + rd/wr=0 ⇒ **空队**）→ `Engine[4*op1+388252] = 新队`（旧内容丢弃）。
 *  - `//----- (00422240)` **raw 30683-30701** ⇒ `0x133`：`op1 > 0xA` ⇒ 打 "ADDQ"；否则
 *    `sub_409E10(Engine[4*op1+388252], op2)`（raw 14280 起 = 顺序缓冲 push + 满时按 step 扩容 / 压实 ⇒ FIFO）。
 *  - `//----- (0042F810)` **raw 39359-39399** ⇒ `0x134`：`op1 > 0xA` ⇒ 打 "GETQ"；
 *    否则 `rd < wr` ⇒ 取值 + `rd++` + 成功位 1，否则成功位 0；再 `sub_42B4B0(_this,2,v6)`、`(_this,3,v5)`
 *    ⇒ **op2 = 成功位 / op3 = 值**，且这两条写回**只在 else 分支里**（越界时 op2/op3 都不写）。
 *    ★队空时引擎的取值变量是**未初始化栈残留**（raw 39392 `v5 = v8;` + raw 39399
 *      `// 42F84D: variable 'v8' is possibly undefined`）⇒ 重写侧取「op3 = 0」的确定口径，
 *      偏差已在 `handlers/control.ts` 的 `op_queue_pop` 注释、`opcode-table.md` 与 `opcode-gaps.json` 披露。
 *
 * 本守卫断言的是**体里的真实行为**（队列内容 / 出队顺序 / 成功位 / 越界不改队列），不是"不报错"。
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

/** 立即数 int（读）。 */
const T_LIT = 0x0;
/** 本地 int 槽（读/写；`0x134` 的 op2/op3 是出参）。 */
const T_LOCAL = 0x9;

/** 一个操作数：立即数或本地槽。 */
type Arg = { type: number; raw: number };
const lit = (v: number): Arg => ({ type: T_LIT, raw: v });
const slot = (i: number): Arg => ({ type: T_LOCAL, raw: i });

/** 本地 int 槽的当前值（脚本可见值 = DEC 之后，按 i32 解释）。 */
function readSlot(e: Engine, i: number): number {
  return dec(e.key, e.curScript().locals.int.get(i) ?? 0) | 0;
}
/** 预置一个本地 int 槽（模拟"上一句留下的旧值"，用来验"某分支没写它"）。 */
function putSlot(e: Engine, i: number, v: number): void {
  e.curScript().locals.int.set(i, enc(e.key, v));
}

/**
 * 把 `calls` 逐条装进一个脚本并**按序真执行**（经 `stepOnce` ⇒ 同时证明已注册进 `OPS`）。
 * `prep` 在装载后、执行前调用（预置输入/旧值）。
 */
async function run(calls: { op: number; args: Arg[] }[], prep?: (e: Engine) => void): Promise<Engine> {
  const e = new Engine(new StubNative(() => {}), new InputManager());
  e.key = 0x12345678;
  const instructions: BinInstruction[] = calls.map((c, i) => ({
    opcode: c.op,
    name: `i${c.op.toString(16)}`,
    argc: c.args.length,
    args: c.args as unknown as BinArg[],
    byteOffset: 0x3c + 12 * i,
    index: i,
  }));
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
    instructions,
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  prep?.(e);
  for (const c of calls) {
    const t = await stepOnce(e);
    assert.notEqual(t.handlerKind, 'unimplemented', `0x${c.op.toString(16)} 应已实现`);
  }
  return e;
}

test('★0x132/0x133/0x134：已注册（不是 native 桩、不是 no-op）；默认 = 11 个空队', () => {
  for (const op of [0x132, 0x133, 0x134]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须进已实现表`);
    assert.ok(!NATIVE_OPS.has(op) && !ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不得是 native 桩或 no-op`);
  }
  // 默认 = 引擎构造后的状态：**11 个空队**（引擎 init raw 18080-18096 建 11 个：`v27 = 10; do … while(--v27)`）。
  const e = new Engine(new StubNative(() => {}), new InputManager());
  assert.equal(e.dispatchQueues.length, 11, '队列族规模 = 11（引擎 init/teardown 都按 11 个槽遍历）');
  for (let i = 0; i < 11; i++) assert.deepEqual(e.dispatchQueues[i], [], `默认第 ${i} 个队应为空`);
});

test('★0x132：重建 ⇒ 队列清空、旧内容整份丢弃（不是追加）', async () => {
  const e = await run([
    { op: 0x133, args: [lit(0), lit(0x1111)] },
    { op: 0x133, args: [lit(0), lit(0x2222)] },
    { op: 0x132, args: [lit(0)] },
    { op: 0x134, args: [lit(0), slot(0x50), slot(0x51)] },
  ]);
  assert.deepEqual(e.dispatchQueues[0], [], '重建后是空队（`sub_407C50` = new[0x400] + rd/wr=0）');
  assert.equal(readSlot(e, 0x50), 0, '重建丢弃旧内容 ⇒ 随后弹出的成功位 = 0（引擎 rd == wr 分支）');
  assert.equal(readSlot(e, 0x51), 0, '空队 ⇒ op3 写 0（引擎此处是未初始化栈残留，偏差已披露）');
});

test('★0x133：压入后队列长度 = 1、内容是那句压入值（直接看容器，不经弹出）', async () => {
  const e = await run([
    { op: 0x132, args: [lit(0)] },
    { op: 0x133, args: [lit(0), lit(0xdeadbeef | 0)] },
  ]);
  assert.equal(e.dispatchQueues[0]!.length, 1, '一次压入 ⇒ 长度 1');
  assert.deepEqual(e.dispatchQueues[0], [0xdeadbeef | 0], '容器里就是 `sub_409E10(queue, op2)` 写进去的那个值');
});

test('★0x133 → 0x134：取回同一值且 op2 = 1；再弹一次 ⇒ op2 = 0 且 op3 = 0', async () => {
  const e = await run([
    { op: 0x132, args: [lit(0)] },
    { op: 0x133, args: [lit(0), lit(0xdeadbeef | 0)] }, // 0xDEADBEEF 的 i32 位模式
    { op: 0x134, args: [lit(0), slot(0x50), slot(0x51)] }, // 第一次弹出（非空）
    { op: 0x134, args: [lit(0), slot(0x52), slot(0x53)] }, // 第二次弹出（空队）
  ]);
  assert.equal(readSlot(e, 0x50), 1, '第一次弹出：rd < wr ⇒ op2 = 成功位 = 1');
  assert.equal(readSlot(e, 0x51), 0xdeadbeef | 0, '第一次弹出：op3 = buf[rd] = 压入的同一个值');
  assert.equal(readSlot(e, 0x52), 0, '第二次弹出：队空 ⇒ op2 = 0');
  assert.equal(readSlot(e, 0x53), 0, '第二次弹出：队空 ⇒ op3 = 0（披露口径；引擎为未初始化栈残留）');
  assert.deepEqual(e.dispatchQueues[0], [], '两次弹出后队列排空');
});

test('★0x133/0x134：FIFO 顺序（先压先出），且只影响 op1 指定的那个队', async () => {
  const e = await run([
    { op: 0x132, args: [lit(3)] },
    { op: 0x133, args: [lit(3), lit(11)] },
    { op: 0x133, args: [lit(3), lit(22)] },
    { op: 0x134, args: [lit(3), slot(0x50), slot(0x51)] },
    { op: 0x134, args: [lit(3), slot(0x52), slot(0x53)] },
  ]);
  assert.equal(readSlot(e, 0x51), 11, '先压先出（引擎 `sub_409E10` 顺序缓冲 + `0x134` 从 rd 取）');
  assert.equal(readSlot(e, 0x53), 22, '第二个出队 = 第二个压入');
  assert.equal(readSlot(e, 0x50), 1, '两次都成功');
  assert.equal(readSlot(e, 0x52), 1, '两次都成功');
  assert.deepEqual(e.dispatchQueues[3], [], '第 3 个队已排空');
  assert.deepEqual(e.dispatchQueues[0], [], '同族其它队不受影响（仍是空队，没被误写）');
});

test('★0x132 传 0xB（> 0xA）⇒ 走错误串分支、队列**不变**（引擎 raw 30659 是 unsigned 比较）', async () => {
  const e = await run([
    { op: 0x133, args: [lit(0), lit(777)] },
    { op: 0x132, args: [lit(0xb)] }, // > 0xA ⇒ "RESETQ" 错误串路径（raw 30661-30662）
  ]);
  assert.deepEqual(e.dispatchQueues[0], [777], '越界重置不得清空队列（引擎该分支只打错误串）');
});

test('★0x133 传 0xB（> 0xA）⇒ 不压入；0x134 传 0xB ⇒ op2/op3 **都不写**（两条写回在 else 里）', async () => {
  const e = await run(
    [
      { op: 0x133, args: [lit(0xb), lit(999)] }, // 越界 ⇒ "ADDQ"，不压
      { op: 0x134, args: [lit(0xb), slot(0x50), slot(0x51)] }, // 越界 ⇒ "GETQ"，op2/op3 都不写
    ],
    // 预置两个出参槽为已知旧值 ⇒ 若被写就会变，用来证明"没写"。
    (eng) => {
      putSlot(eng, 0x50, 0x1234);
      putSlot(eng, 0x51, 0x5678);
    },
  );
  assert.equal(e.dispatchQueues.length, 11, '越界下标不得把队列数组撑大');
  for (let i = 0; i < 11; i++) assert.deepEqual(e.dispatchQueues[i], [], 'op1 = 0xB ⇒ 没有任何压入，且没有崩');
  assert.equal(readSlot(e, 0x50), 0x1234, '越界时 op2 保持旧值（引擎把 `sub_42B4B0(2,…)` 放在 else 里）');
  assert.equal(readSlot(e, 0x51), 0x5678, '越界时 op3 保持旧值');
});

test('★unsigned 口径：op1 = −1（0xFFFFFFFF）也 > 0xA ⇒ 同走错误串分支', async () => {
  // 引擎 `v2` 声明为 `unsigned int`（raw 30650/30690/39362）⇒ −1 也 > 0xA，不得落到 `dispatchQueues[-1]`。
  const e = await run(
    [
      { op: 0x133, args: [lit(0), lit(5)] },
      { op: 0x132, args: [lit(-1)] },
      { op: 0x133, args: [lit(-1), lit(9)] },
      { op: 0x134, args: [lit(-1), slot(0x50), slot(0x51)] },
    ],
    (eng) => {
      putSlot(eng, 0x50, 0xabc);
      putSlot(eng, 0x51, 0xdef);
    },
  );
  assert.deepEqual(e.dispatchQueues[0], [5], 'op1 = −1 的重建/压入都不生效，原队保留');
  assert.equal(e.dispatchQueues.length, 11, '越界下标不得把数组撑大');
  assert.equal(readSlot(e, 0x50), 0xabc, 'op1 = −1 的弹出也不写 op2（错误串分支）');
  assert.equal(readSlot(e, 0x51), 0xdef, 'op1 = −1 的弹出也不写 op3');
});
