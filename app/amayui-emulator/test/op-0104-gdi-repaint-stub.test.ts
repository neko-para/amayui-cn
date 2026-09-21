/**
 * `T-0104` 守卫：「`0x82` 记录后放行，**不再硬停**」。
 *
 * ## 背景（用户实测，轮 8）
 * ADV 界面 → 进入设置界面 → 右键退出 ⇒ 命中**未知指令 `i082`**（控制窗弹硬停）。
 * 引擎侧 `0x82` = `sub_41F720`（raw 28808-28826，argc 5）：体只**读** op1..op5 再转
 * `sub_466000(_this+21324(=Font), op1..op5, _this+21032)`（raw 79319 起，GDI 文本重绘族），
 * **不写任何操作数、不改 VM 态/控制流**。全语料只出现 1 次：`src/CONFIG.txt:269`
 * （`label_000014a8`，设置界面的重画/退出路径）。
 *
 * ## 本守卫锁三件事
 *  1. **静态表能解析它**（不是靠用户桩绕过）—— 删掉 `STUB_NATIVE_OPS` 的 `[0x82, …]` 条目即红；
 *  2. 「忽略」是**记录后**忽略：宿主必须收到 `unhandled(0x82)`（ADR-010 §10.2 的记录义务），
 *     不能静默丢弃；
 *  3. 忽略**不写 VM 态**：操作数引用的局部/全局池快照逐槽不变 —— 否则"放行"会变成静默改状态。
 *
 * ⚠本守卫**不**覆盖"GDI 重绘**画了什么**"：emulator 目前不建模这次重绘（等价物应是重新发布
 * 相应文本窗），口径见 `tickets/T-0104`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BinArg } from '../src/script/bin.js';
import { StubNative } from '../src/vm/native.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, loc, mkEngine } from './harness.js';

/** 全局 int 槽操作数（type 3）。harness 只导出 im/str/loc，全局槽只在本文件用到。 */
const gint = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;

/**
 * `src/CONFIG.txt:269` 的形状：`i082 (local-int 5) (local-int 6) 2 (global-int f807b) (global-int f807c)`。
 * 五个操作数都是**纯读**（两个局部槽、一个立即数、两个全局槽）。
 */
const configInstrArgs = (): BinArg[] => [loc(5), loc(6), im(2), gint(0xf807b), gint(0xf807c)];

test('T-0104 ①：`0x82`（CONFIG.txt:269 形状）走静态表放行 —— 不抛 NotImplementedOp、ip 前进', async () => {
  const e = mkEngine([instr(0x82, configInstrArgs())], 'CONFIG.BIN');
  const frame = e.curScript();
  assert.equal(frame.ip, 0);
  assert.equal(e.unknownOpStubs.size, 0, '前提：没有登记任何用户桩 —— 放行必须来自静态表');

  const trace = await stepOnce(e);

  assert.equal(trace.opcode, 0x82);
  assert.equal(trace.handlerKind, 'native', '`0x82` 应在 NATIVE_OPS（STUB_NATIVE_OPS 并入）里');
  assert.equal(frame.ip, 1, '放行 ⇒ ip 正常 +1（硬停时这里会因抛错停在 0）');
});

test('T-0104 ②：「记录后放行」——宿主必须收到 unhandled(0x82)，不是静默丢弃', async () => {
  const logs: string[] = [];
  const e = mkEngine([instr(0x82, configInstrArgs())], 'CONFIG.BIN', new StubNative((m) => logs.push(m)));

  await stepOnce(e);

  const hit = logs.filter((l) => l.includes('unhandled') && l.includes('0x82'));
  assert.equal(hit.length, 1, `应恰好记录 1 条 0x82 的 unhandled（实际日志：${JSON.stringify(logs)}）`);
});

test('T-0104 ③：放行不写 VM 态 —— 操作数引用的局部/全局槽快照逐槽不变', async () => {
  const e = mkEngine([instr(0x82, configInstrArgs())], 'CONFIG.BIN');
  const frame = e.curScript();
  // 先给被引用到的槽种上可区分的值（若 handler 误写，快照比较即可发现）。
  frame.locals.int.set(5, 0x1111);
  frame.locals.int.set(6, 0x2222);
  e.globals.int.set(0xf807b, 0x3333);
  e.globals.int.set(0xf807c, 0x4444);
  const localBefore = [...frame.locals.int.entries()];
  const globalBefore = [...e.globals.int.entries()];

  await stepOnce(e);

  assert.deepEqual([...frame.locals.int.entries()], localBefore, '局部 int 池不得被 0x82 改动');
  assert.deepEqual([...e.globals.int.entries()], globalBefore, '全局 int 池不得被 0x82 改动');
});

test('T-0104 ④：连续多条 `0x82` 逐条放行（设置界面反复重画的实际形状）', async () => {
  const logs: string[] = [];
  const e = mkEngine(
    [instr(0x82, configInstrArgs()), instr(0x82, configInstrArgs()), instr(0x82, configInstrArgs())],
    'CONFIG.BIN',
    new StubNative((m) => logs.push(m)),
  );
  const frame = e.curScript();

  for (let i = 0; i < 3; i++) {
    const trace = await stepOnce(e);
    assert.equal(trace.opcode, 0x82, `第 ${i + 1} 条应仍是 0x82`);
    assert.equal(trace.handlerKind, 'native');
  }
  assert.equal(frame.ip, 3, '三条逐条放行后 ip 应到末尾');
  assert.equal(
    logs.filter((l) => l.includes('0x82')).length,
    3,
    '每条都该独立记录一次（不合并、不丢）',
  );
});
