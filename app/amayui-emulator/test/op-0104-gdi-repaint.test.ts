/**
 * `T-0104` 守卫：`0x82` **已转真实现** —— 「用给定颜色把某窗的文本记录重画一遍」。
 *
 * ## 历史与语义
 * 用户实测（轮 8）：ADV → 设置界面 → 右键退出 ⇒ 命中未知指令 `i082` 而**硬停**。
 * 当时的临时处置是登记进 `STUB_NATIVE_OPS`（记录后放行、不硬停）；体读完（`sub_466000`
 * raw 79319-80311）之后语义定死为（`tickets/T-0104/notes.md` 轮 9）：
 *
 * ```
 * v8 = (Font+3368 − Font+3364)/72;                  // Font 的 72B 文本项记录条数
 * if (v8 > op2 && op2 >= 0) {                       // ★门：op2 = 起始记录下标，越界 ⇒ 整条什么都不做
 *   ... 把窗 op1 的文本记录（从 op2 起）GDI 重画进它的表面
 *   if (op3 & 2) { Font+1360 = BGR(op4); …; Font+1364 = BGR(op5); … }   // 填充色 / 描边色
 * }
 * ```
 *
 * ## 本守卫锁的事（红了的含义）
 *  1. **静态表是真实现**（`handlerKind === 'implemented'`）—— 谁把它退回 `STUB_NATIVE_OPS` 就红；
 *  2. `op3 & 2` ⇒ 全局填充/描边色被**覆盖**成 `op4`/`op5`（BGR→RGB，与 `0x76`/`0x77` 同口径）；
 *  3. `op3` 无 bit1 ⇒ **不动颜色**（引擎只在 `a4 & 2` 时才写那两格）；
 *  4. **越界门**：记录表里没有第 `op2` 条 ⇒ **连颜色都不改**（引擎 raw 79502 的门在这两件事之前）；
 *  5. 该窗被**重新发布**一次（宿主收到 `msgWinSync`）—— 这是"已排版的旧颜色文本被刷新"的唯一通路，
 *     也是 `T-0102` 紫色那条的候选 2 的可见面；
 *  6. **语料形状**（`src/CONFIG.txt:269`：`i082 (local-int 5) (local-int 6) 2 (global-int f807b) (global-int f807c)`）
 *     不再硬停、ip 正常前进。
 *
 * ⚠**不覆盖**（登记的近似，见 handler 注释与 `T-0104` 的 gaps）：`op2` 的重画粒度（emulator 整窗重排）、
 * `op3` 的其它位、`mode==1` 走 `sub_462040` 的专用路径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BinArg } from '../src/script/bin.js';
import { StubNative } from '../src/vm/native.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { enc } from '../src/vm/bits.js';
import { im, instr, loc, mkEngine } from './harness.js';

/** 全局 int 槽操作数（type 3）。harness 只导出 im/str/loc，全局槽只在本文件用到。 */
const gint = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;

/**
 * `src/CONFIG.txt:269` 的形状：`i082 (local-int 5) (local-int 6) 2 (global-int f807b) (global-int f807c)`。
 * 语料里 `f807b = #b690ff`（角色名填充）、`f807c` = 描边（探针实测值，见 `T-0102` 的 evidence）。
 */
const configInstrArgs = (): BinArg[] => [loc(5), loc(6), im(2), gint(0xf807b), gint(0xf807c)];

/** 写一个**脚本全局 int 槽**（type-3 操作数读的是 `globals.int` 且过 DEC ⇒ 必须 ENC 存）。 */
function setGlobal(e: ReturnType<typeof mkEngine>, slot: number, v: number): void {
  e.globals.int.set(slot, enc(e.key, v));
}

/** 写一个**帧局部 int 槽**（同上：`readIntOperand` 对 local-int 过 DEC）。 */
function setLocal(e: ReturnType<typeof mkEngine>, slot: number, v: number): void {
  e.curScript().locals.int.set(slot, enc(e.key, v));
}

/** 造一条"带某窗文本记录"的引擎：记录表里塞 `n` 条（引擎 `Font[841..842]` 的 72B 向量）。 */
function mkWithRecords(n: number, start = 0) {
  const e = mkEngine([instr(0x82, configInstrArgs())], 'CONFIG.BIN');
  for (let i = 0; i < n; i++) {
    e.textItems.records.push({ win: 0, v20: 0, v24: i, v32: 0, flags: 0 } as never);
  }
  setLocal(e, 6, start);
  return e;
}

test('T-0104 ①：`0x82` 走静态表真实现（不再是 STUB）—— 不抛 NotImplementedOp、ip 前进', async () => {
  const e = mkWithRecords(8);
  const frame = e.curScript();
  assert.equal(frame.ip, 0);
  assert.equal(e.unknownOpStubs.size, 0, '前提：没有登记任何用户桩 —— 解析必须来自静态表');

  const trace = await stepOnce(e);

  assert.equal(trace.opcode, 0x82);
  assert.equal(trace.handlerKind, 'implemented', '★`0x82` 必须在 OPS（真实现）里，不是 STUB_NATIVE_OPS');
  assert.equal(frame.ip, 1, '真实现 ⇒ ip 正常 +1');
});

test('★T-0104 ②：`op3 & 2` ⇒ 用 `op4`/`op5` 覆盖全局填充/描边色（BGR→RGB，与 0x76/0x77 同口径）', async () => {
  const e = mkWithRecords(8);
  // 先把两格写成"别的颜色"，证明是被**覆盖**而不是恰好为空
  e.engineValues.set(ENGINE_FIELD.colorFill, 0x112233);
  e.engineValues.set(ENGINE_FIELD.colorOutline, 0x445566);
  // f807b = 0xb690ff ⇒ BGR 读入 = R=ff,G=90,B=b6 ⇒ 0xff90b6
  setGlobal(e, 0xf807b, 0xb690ff);
  setGlobal(e, 0xf807c, 0x000000);

  await stepOnce(e);

  assert.equal(e.engineValues.get(ENGINE_FIELD.colorFill), 0xff90b6, '★填充色 = BGR(f807b)');
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorOutline), 0x000000, '★描边色 = BGR(f807c)');
});

test('T-0104 ③：`op3` 不带 bit1 ⇒ 一个颜色都不动（引擎只在 `a4 & 2` 时写那两格）', async () => {
  const e = mkEngine([instr(0x82, [loc(5), loc(6), im(0), im(0xff0000), im(0x00ff00)])], 'CONFIG.BIN');
  e.textItems.records.push({ win: 0, v20: 0, v24: 0, v32: 0, flags: 0 } as never);
  e.engineValues.set(ENGINE_FIELD.colorFill, 0x112233);

  await stepOnce(e);

  assert.equal(e.engineValues.get(ENGINE_FIELD.colorFill), 0x112233, '不带 bit1 ⇒ 不得改色');
});

test('★T-0104 ④：越界门 —— 记录表里没有第 `op2` 条 ⇒ 整条什么都不做（**连颜色都不改**）', async () => {
  const e = mkWithRecords(3, 6); // 只有 3 条记录（下标 0..2），而 op2 = 6（语料的形状）
  e.engineValues.set(ENGINE_FIELD.colorFill, 0x112233);
  setGlobal(e, 0xf807b, 0xb690ff);
  const before = new Map(e.engineValues);

  await stepOnce(e);

  assert.equal(e.engineValues.get(ENGINE_FIELD.colorFill), 0x112233, '★越界 ⇒ 不动颜色（引擎 raw 79502 的门在设色之前）');
  assert.deepEqual([...e.engineValues], [...before], '越界 ⇒ 引擎字段一格不动');
});

test('★T-0104 ⑤：该窗被重新发布一次（宿主收到 msgWinSync）—— 已排版的旧色文本才会被刷新', async () => {
  const e = mkWithRecords(8);
  const seen: number[] = [];
  const native = new StubNative(() => {});
  (native as unknown as { msgWinSync: (w: number) => void }).msgWinSync = (w: number) => {
    seen.push(w);
  };
  const e2 = mkEngine([instr(0x82, configInstrArgs())], 'CONFIG.BIN', native);
  e2.textItems.records.push({ win: 0, v20: 0, v24: 0, v32: 0, flags: 0 } as never);

  await stepOnce(e2);

  assert.equal(seen.length, 1, '★恰好重发布一次（少了它 = 旧颜色留在屏上；多了 = 无谓多合成）');
  void e;
});

test('T-0104 ⑥：语料形状（CONFIG.txt:269）端到端不硬停、不写操作数', async () => {
  const logs: string[] = [];
  const e = mkWithRecords(8);
  const frame = e.curScript();
  const localsBefore = new Map(frame.locals.int);
  const globalsBefore = new Map(e.globals.int);
  const native = new StubNative((m) => logs.push(m));
  const e2 = mkEngine([instr(0x82, configInstrArgs())], 'CONFIG.BIN', native);
  e2.textItems.records.push({ win: 0, v20: 0, v24: 0, v32: 0, flags: 0 } as never);
  e2.curScript().locals.int.set(5, 0);
  e2.curScript().locals.int.set(6, 0);

  const trace = await stepOnce(e2);

  assert.equal(trace.handlerKind, 'implemented');
  assert.deepEqual([...frame.locals.int], [...localsBefore], '不写操作数（局部槽）');
  assert.deepEqual([...e.globals.int], [...globalsBefore], '不写操作数（全局槽）');
  assert.equal(logs.filter((l) => l.includes('unhandled')).length, 0, '真实现 ⇒ 不再记 unhandled');
});
