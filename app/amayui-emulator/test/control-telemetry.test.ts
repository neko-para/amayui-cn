/**
 * 回归测试：**控制窗三张「被跳过」清单互斥**（同一条指令不得被列两遍）。
 *
 * 背景：闸门 B 的「能力缺口」是从"被跳过"集合里筛出来的子集，早期实现把 `ignored`/`skipped`
 * 原样全量渲染、`gaps` 又单独渲染一遍，于是**同一条指令在面板上出现两次**——
 * 实测一次启动链路里 21 条"真·忽略"有 16 条同时出现在"能力缺口"。
 *
 * 现在的不变量（本测试锁定）：
 *  - `gaps` ∩ `ignored` = ∅，`gaps` ∩ `skipped` = ∅；
 *  - 进过 `gaps` 的 opcode 只保留在 `gaps` 里（并带 `source` 说明它原本属于哪张表）；
 *  - 三张表的并集 = 期间见过的全部"被跳过" opcode（信息不丢）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Telemetry } from '../src/renderer/app/telemetry.js';
import type { StepTrace } from '../src/vm/interpreter.js';

/** 造一条 trace：只填本测试关心的字段。 */
function trace(opcode: number, name: string, kind: StepTrace['handlerKind'], gap?: string[]): StepTrace {
  return {
    opcode,
    name,
    ip: 0,
    byteOffset: 0,
    handlerKind: kind,
    script: 'TEST.BIN',
    operands: [],
    ...(gap ? { gap: { operands: gap } } : {}),
  } as unknown as StepTrace;
}

test('能力缺口与「真·忽略」互斥：收到实参的指令只出现在缺口栏', () => {
  const tel = new Telemetry();
  tel.note(trace(0x346, 'i346', 'engine-internal')); // 空转 → 真·忽略
  tel.note(trace(0x349, 'i349', 'engine-internal'));
  tel.note(trace(0x213, 'i213', 'engine-internal', ['imm-int#500'])); // 有实参 → 缺口
  tel.note(trace(0x213, 'i213', 'engine-internal', ['imm-int#500'])); // 同一条反复出现

  const ignored = tel.ignoredList().map((e) => e.opcode);
  const gaps = tel.gapsList().map((e) => e.opcode);
  assert.deepEqual(ignored, [0x346, 0x349], '有实参的 0x213 不得同时留在「真·忽略」里');
  assert.deepEqual(gaps, [0x213]);
  assert.equal(gaps.find((o) => ignored.includes(o)), undefined, '两表必须互斥');
  assert.equal(tel.gapsList()[0]!.count, 2, '缺口次数按"收到实参的次数"累计');
});

test('用户桩（user-stub）同样从「已跳过指令」里让位给缺口栏，并标注来源', () => {
  const tel = new Telemetry();
  tel.registerStub(0x1111, 'i1111');
  tel.registerStub(0x2222, 'i2222');
  tel.note(trace(0x1111, 'i1111', 'user-stub')); // 没实参 → 留在「已跳过指令」
  tel.note(trace(0x2222, 'i2222', 'user-stub', ['imm-int#99'])); // 有实参 → 缺口

  assert.deepEqual(tel.skippedList().map((e) => e.opcode), [0x1111]);
  assert.deepEqual(tel.gapsList().map((e) => e.opcode), [0x2222]);
  assert.equal(tel.gapsList()[0]!.source, 'skipped', '缺口行要标出它原本属于「已跳过指令」');
});

test('引擎内部 no-op 的缺口来源标为 ignored', () => {
  const tel = new Telemetry();
  tel.note(trace(0x70, 'i070', 'engine-internal', ['l-int#16']));
  assert.equal(tel.gapsList()[0]!.source, 'ignored');
});

test('三表并集 = 期间见过的全部"被跳过" opcode（信息不丢）', () => {
  const tel = new Telemetry();
  const seen = [0x346, 0x349, 0x213, 0x70, 0x143, 0x2f6];
  for (const op of seen) {
    tel.note(trace(op, `i${op.toString(16)}`, 'engine-internal', op === 0x213 || op === 0x70 ? ['imm-int#500'] : undefined));
  }
  const union = new Set([
    ...tel.ignoredList().map((e) => e.opcode),
    ...tel.skippedList().map((e) => e.opcode),
    ...tel.gapsList().map((e) => e.opcode),
  ]);
  assert.deepEqual([...union].sort((a, b) => a - b), [...seen].sort((a, b) => a - b));
});
