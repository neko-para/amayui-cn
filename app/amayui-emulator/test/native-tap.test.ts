/**
 * **闸门 A 回归测试**：`withNativeTap` 让"宿主没实现的 native 调用"不再静默。
 *
 * 背景：`NativeBridge` 的方法几乎都是可选的，`c.native.setLight?.(...)` 在宿主未实现时会**静默变成空操作**
 * —— 无日志、无计数、控制窗里也看不到。实测有 11 个被 `ops.ts` 调用的方法处于这种状态，而对应的 opcode
 * 全都标着"真实现"。本测试锁死"一定会留下痕迹"这条性质。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DropRecorder, withNativeTap } from '../src/vm/nativeTap.js';

test('未实现的方法被调用时会记事件（方法名/次数/实参/归因 opcode）', () => {
  let opcode = 0x32f;
  const rec = new DropRecorder(() => opcode);
  const inner = {
    log: (m: string) => void m,
    playSound: (id: number) => void id,
  };
  const tapped = withNativeTap(inner, rec) as unknown as {
    log(m: string): void;
    playSound(id: number, vol: number): void;
    setLight(idx: number, on: boolean): void;
    setRenderState(state: number, value: number): void;
  };

  tapped.setLight(3, false);
  tapped.setLight(4, false);
  opcode = 0x340;
  tapped.setRenderState(22, 1);

  const list = rec.list();
  assert.equal(list.length, 2, '两个未实现方法各记一条');
  const light = list.find((e) => e.method === 'setLight')!;
  assert.equal(light.count, 2, '次数累加');
  assert.equal(light.sample, '4, false', '采样保留最近一次实参');
  assert.deepEqual(light.opcodes, ['0x32f'], '归因到 opcode');
  assert.ok(light.why.includes('无报错'), '每条都带"缺了它会有什么无报错表现"的说明');
  assert.equal(list[0]!.count >= list[1]!.count, true, '按次数降序（影响大的先看）');
  assert.equal(rec.totalCalls(), 3, '总调用次数');
});

test('已实现的方法原样转发，且不进事件表', () => {
  const rec = new DropRecorder();
  const got: unknown[] = [];
  const inner = {
    log: (m: string) => got.push(m),
    playSound: (id: number, vol: number) => got.push([id, vol]),
  };
  const tapped = withNativeTap(inner, rec) as unknown as {
    log(m: string): void;
    playSound(id: number, vol: number): void;
    playBgm(id: number): void;
  };
  tapped.log('hi');
  tapped.playSound(7, 100);
  tapped.playBgm(9); // 未实现 → 记事件
  assert.deepEqual(got, ['hi', [7, 100]], '已实现的方法行为不变');
  assert.equal(rec.count(), 1);
  assert.equal(rec.list()[0]!.method, 'playBgm');
});

test('Proxy 不会被当成 thenable（否则 await 会挂住）', async () => {
  const rec = new DropRecorder();
  const tapped = withNativeTap({ log: () => {} }, rec) as unknown as Record<string, unknown>;
  assert.equal(tapped['then'], undefined, 'then 必须为 undefined');
  await Promise.resolve(tapped); // 不应挂起
  assert.equal(rec.count(), 0, '探测 then 不应产生事件');
});

test('数据属性（非函数）透传；未实现的数据属性不会凭空出现', () => {
  const rec = new DropRecorder();
  const marker = { hello: 'world' };
  const tapped = withNativeTap({ log: () => {}, input: marker }, rec) as unknown as {
    input?: unknown;
    nothing?: unknown;
  };
  assert.equal(tapped.input, marker, '数据属性原样透传');
  assert.equal(tapped.nothing, undefined, '非桥方法（数据属性）保持 undefined，不会凭空变成真值');
});
