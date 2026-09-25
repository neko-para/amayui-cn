/** @tier T0 @kind core @subsystem input */

/**
 * **`0xFF` / `0x100` / `0x101` 的引擎字段镜像**（`tickets/T-0158`）。
 *
 * | 条 | 缺的东西 | 引擎依据 |
 * |---|---|---|
 * | P3 `0xff` | `_this[cur + 122327] = _this[517]`（后备扫描游标镜像） | raw 25007（读者 `sub_419D20` raw 25096/25134） |
 * | P2 `0x101` | ① `effect_flags &= ~0x8000000` ② `_this[122370] = 0` ③ `_this[122367] = 1` | raw 25077-25080 |
 * | P2 `0x100` | 自行定 ip 之后长度槽写 **0**（"handler 决定 ip 是否前进"） | raw 25064（早退支保持入口的 1 = raw 25024） |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { operandCountSlotValue } from '../src/vm/operandPlan.js';
import { im, instr, mkEngine } from './harness.js';

function run(e: ReturnType<typeof mkEngine>, op: number, args: Parameters<typeof instr>[1] = []) {
  const f = e.curScript();
  // ★复刻 `stepOnce` 在**派发之前**写的那一格（`interpreter.ts:196`）—— 否则"handler 是否改写它"
  //   就测不出来（`Frame` 初值 0 会让"没写"与"写成 0"无法区分）。
  f.operandCount = operandCountSlotValue(op, args.length);
  const ctx = makeCtx(e, f, instr(op, args), new StubNative(() => {}), () => {});
  const h = OPS.get(op);
  assert.ok(h, `0x${op.toString(16)} 必须注册在已实现表`);
  h!(ctx);
  return ctx;
}

test('★P3 0xff：复位写 `Engine[cur + 122327] = Engine[517]`（后备扫描游标镜像）', () => {
  const e = mkEngine([]);
  e.engineValues.set(ENGINE_FIELD.setKeyTotal, 12); // `i0fe c`（SYSTEM4.txt:86）
  e.engineValues.set(ENGINE_FIELD.keyScanCursor + e.cur, 5);
  run(e, 0xff);
  assert.equal(e.engineValues.get(122327 + e.cur), 12, '★raw 25007：镜像 = `Engine[517]`（读者 = sub_419D20 raw 25096）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.keyScanCursor + e.cur), 0, 'raw 25005：逐帧游标归零');
});

test('★P3 0xff：`Engine[517]` 未置时镜像取 Input 构造的默认 7（raw 92386）', () => {
  const e = mkEngine([]);
  run(e, 0xff);
  assert.equal(e.engineValues.get(122327 + e.cur), 7, '`_this[259] = 7`（Input ctor raw 92386）');
});

test('★P2 0x101：三条引擎写（清 ADV 运行位 / `[122367] = 1` / `[122370] = 0`）', () => {
  const e = mkEngine([]);
  e.effectFlags = 0x8000000 | 0x1000;
  e.engineValues.set(122367, 0);
  e.engineValues.set(122370, 2);
  e.input.pressMouse(0);
  run(e, 0x101);
  assert.equal(e.effectFlags & 0x8000000, 0, '★① raw 25077：清 ADV 运行位（下一次 ADV 泵动作前必须重新 arm）');
  assert.equal(e.effectFlags & 0x1000, 0x1000, '其余位不动');
  assert.equal(e.engineValues.get(122367), 1, '★③ raw 25079');
  assert.equal(e.engineValues.get(122370), 0, '★② raw 25080：CancelMessageKey 三态机复位');
  assert.equal(e.input.flushPending(), 0, '消费刷仍被消费（raw 25076 的 `*v2 = 0`）');
});

test('★P2 0x100：派发（自行定 ip）后长度槽 = 0；早退支保持 1', () => {
  const e = mkEngine([instr(0x100, []), instr(0x5, [im(1)]), instr(0x5, [im(2)])]);
  const f = e.curScript();
  e.engineValues.set(ENGINE_FIELD.setKeyTotal, 12);
  f.labelMap.set(0x500, 2);
  e.input.joyJump[7] = 0x500;

  // ① 掩码为空 ⇒ 默认键槽（keyTotal = 12）未注册 ⇒ **早退**（槽保持 1）
  e.input.consumeEdges();
  let ctx = run(e, 0x100);
  assert.equal(ctx._nextIp, null, '默认键槽未注册 ⇒ 不跳');
  assert.equal(f.operandCount, 1, '★早退支：引擎入口的 `95805 = 1`（raw 25024）未被改写');

  // ② 掩码 bit7 ⇒ 派发 ⇒ 槽写 0（raw 25064）
  e.input.pressJoy(3); // 按钮 3 ⇒ 掩码位 4+3 = 7
  ctx = run(e, 0x100);
  assert.equal(ctx._nextIp, 2, '掩码 bit7 ⇒ joyJump[7] 的目标');
  assert.equal(f.operandCount, 0, '★raw 25064：自行定 ip ⇒ 长度槽 0（派发器不再前进）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.keyScanCursor + e.cur), 8, '游标 = b+1（跨帧保留，raw 25038）');
});

test('★P2 0x100：默认键分支派发后长度槽同样写 0（raw 25062 → 25064）', () => {
  const e = mkEngine([instr(0x100, []), instr(0x5, [im(1)])]);
  const f = e.curScript();
  e.engineValues.set(ENGINE_FIELD.setKeyTotal, 12);
  f.labelMap.set(0x600, 1);
  e.input.joyJump[12] = 0x600;
  e.input.consumeEdges();
  const ctx = run(e, 0x100);
  assert.equal(ctx._nextIp, 1, '空掩码 ⇒ joyJump[SetKeyTotal]');
  assert.equal(f.operandCount, 0, '★同一个出口（raw 25064）');
  assert.equal(f.retStack.pop(), 1, '默认键分支压 **+1**（raw 25052）—— 与掩码分支的不对称仍在');
});
