/**
 * **A5 的回归测试**（2026-09）：单行字段写 / 计时 / 音频设备 / 消息面。
 *
 * A5 = `0x93` `0x94` `0x97`（消息面/面板表面）+ `0xD9` `0xAD` `0x1AD` `0x1B1`（清位/秒计时器/字段写）
 *      + `0x1BC` `0x1C9`（清消息·声音字段 / 音频设备初始化）。
 * 逐条引擎实证见各 handler 注释；台账见 `docs-new/03-engine/stub-reaudit-2026-09.md` §6。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { PANEL_BASE } from '../src/vm/handlers/panel.js';
import { dec, enc } from '../src/vm/bits.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { AudioIntent } from '../src/audio/audioEngine.js';
import { im, instr, str } from './harness.js';

const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;
const F = (k: number): number => PANEL_BASE + k;


function mk(native: NativeBridge = new StubNative(() => {}), input = new InputManager()) {
  const e = new Engine(native, input);
  const f = new Frame();
  const run = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应已实现`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  return { e, f, run, input };
}

const A5 = [0x93, 0x94, 0x97, 0xd9, 0xad, 0x1ad, 0x1b1, 0x1bc, 0x1c9] as const;

test('注册表棘轮：A5 的 9 条都已实现，且不在 ENGINE_INTERNAL_OPS', () => {
  for (const op of A5) {
    assert.ok(OPS.has(op) || NATIVE_OPS.has(op), `0x${op.toString(16)} 应已实现`);
    assert.equal(ENGINE_INTERNAL_OPS.has(op), false, `0x${op.toString(16)} 不得留在 stub 表`);
  }
});

test('A5 0x93：清 effect_flags 0x800000 + 复位面板游标态 + toggle 12956/12957', () => {
  const { e, run } = mk();
  e.effectFlags = 0x800000 | 0x40;
  e.routes.push(0, 0, 10, 10, 1, 2, 3, 0);
  e.routes.hitTest(5, 5);
  assert.equal(e.routes.cursor, 0);
  e.engineValues.set(12957, 1);
  run(0x93);
  assert.equal(e.effectFlags & 0x800000, 0, '清掉了 0x800000');
  assert.equal(e.effectFlags & 0x40, 0x40, '别的位不动');
  assert.equal(e.routes.cursor, -1, '`[7468]` 游标复位');
  assert.equal(e.engineValues.get(F(959)), -1);
  assert.equal(e.routes.count, 1, '复位**不清**路由条目表');
  assert.equal(e.engineValues.get(12957), 0, '12957 原为 1 ⇒ 清 0');
  // 再跑一次：12957 已 0 ⇒ 置 12956 = 1
  run(0x93);
  assert.equal(e.engineValues.get(12956), 1);
});

test('A5 0x94：置 12957 + 面板填充色（首次初始化时按鼠标做命中测试）', () => {
  const input = new InputManager();
  input.x = 5;
  input.y = 5;
  input.hasCursor = true;
  const { e, run } = mk(new StubNative(() => {}), input);
  e.routes.push(0, 0, 10, 10, 1, 2, 3, 0);
  run(0x94);
  assert.equal(e.engineValues.get(12957), 1);
  assert.equal(e.engineValues.get(F(7465)), 1, '置"已初始化"');
  assert.equal(e.routes.cursor, 0, '首次初始化按鼠标坐标命中（GetCursorPos→sub_403C50 等价物）');
  // 第二次：只写填充色 + 待填充标记
  e.routes.cursor = -1;
  run(0x94);
  assert.equal(e.engineValues.get(F(960)), 10000, '填充色 = 10000');
  assert.equal(e.engineValues.get(F(7464)), 1, '待填充');
  assert.equal(e.routes.cursor, -1, '已初始化分支不再做命中测试');
});

test('A5 0x97：面板填矩形转发（rect = 左上+宽高）', () => {
  const calls: number[][] = [];
  const native = new StubNative(() => {});
  (native as unknown as { fillPanelRect?: (...a: number[]) => void }).fillPanelRect = (...a) => calls.push(a);
  const { run } = mk(native);
  run(0x97, [im(10), im(20), im(30), im(40), im(7)]);
  assert.deepEqual(calls, [[10, 20, 40, 60, 7]]);
});

test('A5 0xD9：清 effect_flags & 0x1000（派发中时同清 95779）', () => {
  const { e, run } = mk();
  e.effectFlags = 0x1000 | 0x2000;
  run(0xd9);
  assert.equal(e.effectFlags & 0x1000, 0);
  assert.equal(e.effectFlags & 0x2000, 0x2000);
  e.engineValues.set(95779, 0x1000 | 0x8);
  run(0xd9);
  assert.equal(e.engineValues.get(95779) & 0x1000, 0x1000, '124350 == 0 ⇒ **不**清 95779 的该位');
  e.engineValues.set(124350, 1);
  e.engineValues.set(95779, 0x1000 | 0x8);
  run(0xd9);
  assert.equal(e.engineValues.get(95779), 0x8, '派发中 ⇒ 同清 95779 的该位');
});

test('A5 0xAD：秒计时器 = timeGetTime/1000（定点近似，BigInt 复刻）', () => {
  const { e, run } = mk();
  e.nowMs = 1_500; // 1.5 秒
  e.engineValues.set(5451, 42); // 「当前秒」的另一个槽
  run(0xad);
  assert.equal(e.engineValues.get(5449), 1, '1500ms ⇒ 1 秒');
  assert.equal(e.engineValues.get(5450), 42, '`[259] ← [260]`');
  e.nowMs = 12_345;
  run(0xad);
  assert.equal(e.engineValues.get(5449), 12, '12345ms ⇒ 12 秒');
  assert.equal(e.engineValues.get(5450), 42, '`[259] ← [260]`（5451 = 42 未被本指令改动）');
});

test('A5 0x1AD / 0x1B1：字段写（166963=cur、21672=op1）', () => {
  const { e, run } = mk();
  e.cur = 7;
  run(0x1ad);
  assert.equal(e.engineValues.get(166963), 7, '存档序列化用的"当前帧"记忆（语料 1100 处）');
  run(0x1b1, [im(0x1234)]);
  assert.equal(e.engineValues.get(21672), 0x1234);
});

test('A5 0x1BC：清语音通道状态位/寄存槽 + 对 3 个通道发 voice-reset', () => {
  const intents: AudioIntent[] = [];
  const native = new StubNative(() => {});
  (native as unknown as { audio?: (i: AudioIntent) => void }).audio = (i) => intents.push(i);
  const { e, run } = mk(native);
  e.engineValues.set(21315, 1);
  e.engineValues.set(21317, 1);
  e.engineValues.set(122505, 0x7001);
  e.engineValues.set(122510, 9);
  run(0x1bc);
  assert.deepEqual([e.engineValues.get(21315), e.engineValues.get(21317)], [0, 0]);
  assert.deepEqual([e.engineValues.get(122505), e.engineValues.get(122510)], [0, 0]);
  assert.deepEqual(intents, [
    { kind: 'voice-reset', ch: 0 },
    { kind: 'voice-reset', ch: 1 },
    { kind: 'voice-reset', ch: 2 },
  ]);
});

test('A5 0x1C9：音频设备初始化写 18656/18660（装载=已登记缺口，不抛）', () => {
  const { e, run } = mk();
  run(0x1c9, [im(0x5250), im(11), im(22)]);
  assert.equal(e.engineValues.get(18656), 11);
  assert.equal(e.engineValues.get(18660), 22);
});

test('A5：9 条都不写脚本操作数（与"单行字段"判据一致）', () => {
  const { e, run } = mk();
  const before = { a: 0x1234, b: 0x5678 };
  e.globals.int.set(0x300, enc(e.key, before.a));
  e.globals.int.set(0x301, enc(e.key, before.b));
  const g = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;
  for (const op of A5) {
    run(op, [g(0x300), g(0x301), g(0x302), g(0x303), g(0x304)]);
    assert.equal(dec(e.key, e.globals.int.get(0x300) ?? 0), before.a, `0x${op.toString(16)} 不应写 op1`);
    assert.equal(dec(e.key, e.globals.int.get(0x301) ?? 0), before.b, `0x${op.toString(16)} 不应写 op2`);
  }
});
