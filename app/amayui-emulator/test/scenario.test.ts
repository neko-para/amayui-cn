/**
 * **`Scenario`（输入编排）契约测试**（`tickets/T-0003` 验收 3 / 为 B5 的 `--record/--replay` 打底）。
 *
 * 它只做三件事，所以只需要锁这三件：① 到点执行一次 ② 条件成立执行一次 ③ **顺序**（前一步没执行，后面的不越过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scenario, moveTo } from '../src/frame/scenario.js';
import { InputManager } from '../src/vm/input.js';

const ctx = (input: InputManager, frame: number): { e: never; input: InputManager; frame: number } =>
  ({ e: undefined as never, input, frame });

test('Scenario：帧号到点执行一次（同一帧 apply 两次不会重复执行）', () => {
  const input = new InputManager();
  const sc = new Scenario().at(3, '移到 (100,200)', (c) => moveTo(c, 100, 200));
  sc.apply(ctx(input, 1));
  assert.equal(input.hasCursor, false, '还没到点');
  sc.apply(ctx(input, 3));
  assert.equal(input.hasCursor, true);
  assert.equal(input.readX(), 100);
  sc.apply(ctx(input, 3));
  assert.equal(sc.log.length, 1, '每个步骤只执行一次');
  assert.deepEqual(sc.log, [{ frame: 3, note: '移到 (100,200)' }]);
  assert.equal(sc.done, true);
});

test('Scenario：条件成立才执行（每帧判一次）', () => {
  const input = new InputManager();
  let ready = false;
  const sc = new Scenario().when('就绪后点一下', () => ready, (c) => c.input.pressMouse(0));
  sc.apply(ctx(input, 1));
  assert.equal(input.buttons, 0, '条件不成立 ⇒ 不执行');
  ready = true;
  sc.apply(ctx(input, 2));
  assert.notEqual(input.buttons, 0, '条件成立 ⇒ 执行');
  assert.equal(sc.done, true);
});

test('Scenario：顺序执行（前一步没执行完，后面的不越过）', () => {
  const input = new InputManager();
  const seen: string[] = [];
  const sc = new Scenario()
    .when('第一步', () => false, () => seen.push('a'))
    .at(1, '第二步', () => seen.push('b'));
  sc.apply(ctx(input, 5));
  assert.deepEqual(seen, [], '第一步的条件没成立 ⇒ 第二步（即使帧号已到）也不执行');
  assert.equal(sc.done, false);
});
