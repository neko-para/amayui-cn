/**
 * `T-0114` 第 2 步（续）守卫：**语义事件断点的接线**（`Engine.debugEvent` → 主循环 `onAfterStepEvent`）。
 *
 * 为什么单独一个文件：这条链跨了**三个层** —— VM（`stepOnce` 内同步发事件）、
 * `Engine`（钩子）、主循环（`stepOnce` 之后 await 落地暂停）。
 * 单测 `debug-break.test.ts` 只覆盖了"纯函数判定"，覆盖不到"事件真的发出来了"。
 *
 * 本文件钉三件事：
 *  1. **事件真的发**：写全局 int / float / string 与绑纹理槽，各发出**对应池**的事件（不是笼统的一个）；
 *  2. **口径正确**：`global-int-write.val` 是**解码后**的值（不是 ENC 过的）；float 池的 `val` 是**位模式**；
 *  3. **接线到位**：`frame/loop.ts` 在 `stepOnce` 之后有 `onAfterStepEvent` 的 `await`；
 *     `session.ts` 既注册了 `debugEvent`，也在 `loopOptions` 里挂了它（源码棘轮）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine, type DebugEventKind } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { writeIntOperand, writeFloatOperand, writeStringOperand } from '../src/vm/operand.js';
import { NATIVE_OPS, OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { f32 } from '../src/vm/bits.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** 记下所有事件（含顺序）。 */
function recordEvents(e: Engine): { kind: DebugEventKind; values: Record<string, number> }[] {
  const out: { kind: DebugEventKind; values: Record<string, number> }[] = [];
  e.debugEvent = (ev) => out.push(ev);
  return out;
}
const instr = (op: number, args: { type: number; raw: number }[]): never =>
  ({ opcode: op, name: 'x', argc: args.length, args, byteOffset: 0, index: 0 }) as never;

test('★写全局 int ⇒ 发 `global-int-write`，且 `val` 是**解码后**的值', () => {
  const e = new Engine(new StubNative(() => {}));
  e.key = 0;
  const evs = recordEvents(e);
  const f = e.frames[0]!;
  writeIntOperand(e, f, instr(0x55, [{ type: 0x3, raw: 0x1dd7 }, { type: 0, raw: 1 }]), 1, 1);
  assert.equal(evs.length, 1, '写一次全局 int 应恰好发一个事件');
  assert.equal(evs[0]!.kind, 'global-int-write');
  assert.deepEqual(evs[0]!.values, { idx: 0x1dd7, val: 1 });
  // ★池里存的是 ENC 过的；事件里的 val 必须是**解码后**的（否则条件里写 `val == 1` 永远不成立）
  assert.notEqual(e.globals.int.get(0x1dd7), 1, '池里存的应是 ENC 后的位模式');
});

test('★写全局 float ⇒ 发 `global-float-write`（独立事件，不与 int 混）', () => {
  const e = new Engine(new StubNative(() => {}));
  const evs = recordEvents(e);
  const f = e.frames[0]!;
  writeFloatOperand(e, f, instr(0x2d5, [{ type: 0x4, raw: 0x120 }, { type: 0, raw: 0 }]), 1, 1.5);
  assert.equal(evs.length, 1);
  assert.equal(evs[0]!.kind, 'global-float-write', '★float 池要有自己的事件 —— 池是按类型分的');
  assert.equal(evs[0]!.values.idx, 0x120);
  // ★事件的 val 是 float 的 **int32 位模式**（1.5 的单精度位模式 = 0x3FC00000 = 1069547520）
  //   ⇒ `f2i` 必须能精确还原；用 `| 0` 截断会得 1（那就失去意义了）。
  const payload = evs[0]!.values.val!;
  assert.equal(payload, 1069547520, '1.5 的单精度位模式（没有被 `| 0` 截断成 1）');
  assert.equal(f32(payload), 1.5, '`f2i(val)` 还原成 1.5');
});

test('★写全局 string ⇒ 发 `global-str-write`（`val` = 长度）', () => {
  const e = new Engine(new StubNative(() => {}));
  const evs = recordEvents(e);
  const f = e.frames[0]!;
  writeStringOperand(e, f, instr(0x55, [{ type: 0x5, raw: 0x20 }, { type: 0, raw: 0 }]), 1, '阿瓦罗');
  assert.equal(evs.length, 1);
  assert.equal(evs[0]!.kind, 'global-str-write');
  assert.equal(evs[0]!.values.idx, 0x20);
  assert.equal(evs[0]!.values.val, 3, '字符串不可比 ⇒ 事件带长度');
});

test('★绑纹理槽 ⇒ 发 `slot-bind`（`0x1F9` 与 `0x249` 两条绑定路径都要发）', async () => {
  const e = new Engine(new StubNative(() => {}));
  const evs = recordEvents(e);
  const f = e.frames[0]!;
  const run = async (op: number, argc: number, args: { type: number; raw: number }[]): Promise<void> => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `opcode 0x${op.toString(16)} 未注册`);
    await h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
  };
  // `set-texture 5260 11`（= 槽 0x11）
  await run(0x1f9, 3, [{ type: 0, raw: 0x5260 }, { type: 0, raw: 0x11 }, { type: 0, raw: 0 }]);
  assert.equal(evs.length, 1, '0x1F9 应发一个 slot-bind');
  assert.equal(evs[0]!.kind, 'slot-bind');
  assert.deepEqual(evs[0]!.values, { slot: 0x11, imgid: 0x5260 });
  // `0x249`（按统一 id 载纹理进槽）—— 另一条绑定路径
  await run(0x249, 3, [{ type: 0, raw: 0x5191 }, { type: 0, raw: 0xc }, { type: 0, raw: 0 }]);
  assert.equal(evs.length, 2, '★0x249 也必须发（两条绑定路径都要覆盖）');
  assert.deepEqual(evs[1]!.values, { slot: 0xc, imgid: 0x5191 });
});

test('★无钩子时零副作用（不抛、不影响写入）', () => {
  const e = new Engine(new StubNative(() => {}));
  e.key = 0;
  const f = e.frames[0]!;
  writeIntOperand(e, f, instr(0x55, [{ type: 0x3, raw: 7 }, { type: 0, raw: 0 }]), 1, 42);
  assert.ok(e.globals.int.has(7), '没挂钩子也要照常写');
});

test('★源码棘轮：事件暂停必须挂在 `stepOnce` **之后**（`onAfterStepEvent`）', () => {
  const loop = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/src/frame/loop.ts'), 'utf8');
  assert.ok(/onAfterStepEvent\?\.\(/.test(loop), 'loop.ts 必须 await onAfterStepEvent');
  // 它必须出现在 `await stepOnce(e)` 之后（事件发生在 stepOnce 内部，同步记录、之后落地）
  const stepOnceAt = loop.indexOf('await stepOnce(e)');
  const evAt = loop.indexOf('onAfterStepEvent?.(');
  assert.ok(stepOnceAt > 0 && evAt > stepOnceAt, '事件闸门必须在 stepOnce 之后');

  const sess = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/src/renderer/app/session.ts'), 'utf8');
  assert.ok(/this\.#e\.debugEvent = /.test(sess), 'session 必须注册 Engine.debugEvent');
  assert.ok(/onAfterStepEvent:/.test(sess), 'session 必须在 loopOptions 里挂 onAfterStepEvent');
});
