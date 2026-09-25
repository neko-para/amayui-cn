/** @tier T0 @kind core @subsystem texture */

/**
 * `tickets/T-0179`（审计 §8.2 `0x245` P2 / `0x246` P3）：引擎的**「该槽有没有纹理对象」门**。
 *
 * ## 体证（`engine/天结_unpacked.exe_utf8.c`）
 * ```text
 * 0x245 sub_4251E0 raw 32661-32676
 *   v2 = _this[sub_41BF50(_this, 1) + 94672];     // 对象表
 *   if ( v2 ) sub_4081B0(v2, op2 / dbl_51FB50);   // ★门在前：没有对象 ⇒ 连 op2 都不读
 * 0x246 sub_425250 raw 32680-32700
 *   obj = _this[op1 + 94672];                     // ★第一道门：不存在 ⇒ 什么都不做
 *   if ( obj && *(obj + 1084) == dword_52839C )   //   第二道门（类型标记 == 0）宿主缝拿不到 ⇒ 仍未建模
 * ```
 * 宿主侧等价判据 = **可选缝** `hasSlotTexture`（`tickets/T-0164` 为同一类门引入）：
 * `undefined`（宿主不建模该缝）⇒ **保持旧行为、不误跳**；`false` ⇒ 确知没有对象 ⇒ 跳过且不读 op2；`true` ⇒ 照常下发。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../src/vm/step.js';
import { im, instr, mkEngine } from './harness.js';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/stubNative.js';
import type { BinArg } from '../src/script/bin.js';
import type { Engine } from '../src/vm/engine.js';

/** 记录宿主收到的两次下发 + 可配置的 `hasSlotTexture` 三态。 */
class RecordingNative extends StubNative {
  got: Array<[string, number, number]> = [];
  hasSlotTexture?: (slot: number) => boolean | undefined;

  setTextureObjectFloat?(slot: number, v: number): void {
    this.got.push(['float', slot, v]);
  }
  setTextureObjectSubParam?(slot: number, v: number): void {
    this.got.push(['sub', slot, v]);
  }
}

async function dispatch(e: Engine, op: number, args: BinArg[]): Promise<void> {
  const handler = OPS.get(op);
  assert.ok(handler, `0x${op.toString(16)} 应有 handler`);
  await handler(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
}

test('★T-0179 0x245：宿主答"该槽没有纹理对象"（false）⇒ 不下发（引擎 raw 32663 的门）', async () => {
  const n = new RecordingNative();
  n.hasSlotTexture = () => false;
  const e = mkEngine([], 'FAKE.BIN', n);
  await dispatch(e, 0x245, [im(3), im(2500)]);
  assert.deepEqual(n.got, [], '门为假 ⇒ 一次下发都不能有');
});

test('★T-0179 0x245：宿主答"有对象"（true）⇒ 照常下发 `op2 / 1000`', async () => {
  const n = new RecordingNative();
  n.hasSlotTexture = () => true;
  const e = mkEngine([], 'FAKE.BIN', n);
  await dispatch(e, 0x245, [im(3), im(2500)]);
  assert.deepEqual(n.got, [['float', 3, 2.5]], '`dbl_51FB50 = 1000.0`（raw 4393）⇒ 2500/1000 = 2.5');
});

test('★T-0179 0x245/0x246：宿主**不建模**该缝（undefined）⇒ 保持旧行为（照常下发，不误跳）', async () => {
  const n = new RecordingNative(); // 不装 hasSlotTexture
  const e = mkEngine([], 'FAKE.BIN', n);
  await dispatch(e, 0x245, [im(1), im(1000)]);
  await dispatch(e, 0x246, [im(1), im(150)]);
  assert.deepEqual(n.got, [['float', 1, 1], ['sub', 1, 1.5]], 'undefined = 宿主不建模 ⇒ 与修前逐字相同');
});

test('★T-0179 0x246：宿主答 false ⇒ 不下发子对象参数（引擎 raw 32681 的第一道门）', async () => {
  const n = new RecordingNative();
  n.hasSlotTexture = () => false;
  const e = mkEngine([], 'FAKE.BIN', n);
  await dispatch(e, 0x246, [im(2), im(999)]);
  assert.deepEqual(n.got, []);
});
