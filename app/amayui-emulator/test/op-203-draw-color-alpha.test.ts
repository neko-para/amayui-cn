/** @tier T0 @kind core @subsystem render */

/**
 * ★`0x203` **set-draw-color-alpha**（`sub_4232C0` raw 31419-31451，argc 4）—— clamp 与「<0 回退取当前色」。
 *
 * 引擎逐字（`v2 = op3(α)`、`v3 = op4(color)`）：
 * ```
 * raw 31431-31442  if (α <= 255) { if (α < 0) α = (unsigned)sub_4ADD60(Scene, handle) >> 24; } else α = 255;
 * raw 31443-31447  if (color < 0) color = sub_4ADD60(Scene, handle);
 * raw 31450        argb = (α & 0xff) << 24 | (color & 0xffffff)
 * ```
 * `sub_4ADD60`（raw 132579-132588）= 按 handle 查绘制项表、**查不到返回 −1**、否则读 `DrawItem+0x60`
 * （= 本工程 `Item.from`，正是 `0x203` 写的那一格）⇒ 回退必须在**写入之前**取。
 *
 * 审计 P2 `op-4-06`：旧实现只有自造的 `(alpha & 0xff)`（α ≥ 256 ⇒ 0、α < 0 ⇒ 丢回退）⇒ 本文件钉死四条。
 * 语料 7637 处静态实参都在合法区间（所以这是**潜在**边界错），故用**合成指令**覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { im, instr, trackArgs } from './harness.js';
import type { BinArg } from '../src/script/bin.js';

const HANDLE = 0x10;

/** 记录 `setDrawColorAlpha` 的实参，并提供一个可配置的"当前色"（= `sub_4ADD60` 的对应物）。 */
class ColorRecorder extends StubNative {
  readonly calls: { handle: number; from: number; blend: number }[] = [];
  readonly colorReads: number[] = [];
  constructor(private current: number) {
    super(() => {});
  }
  override getDrawItemColor(handle: number): number {
    this.colorReads.push(handle);
    return this.current;
  }
  override setDrawColorAlpha(handle: number, from: number, blend: number): void {
    this.calls.push({ handle, from: from >>> 0, blend });
  }
}

/** 跑一条 `i203 <handle> <blend> <α> <color>`，返回落到宿主的 ARGB。 */
function run203(alpha: number, color: number, current = -1, blend = 0) {
  const native = new ColorRecorder(current);
  const e = new Engine(native);
  const f = new Frame();
  const h = OPS.get(0x203) ?? NATIVE_OPS.get(0x203);
  assert.ok(h, '0x203 必须已注册（NATIVE_OPS 路由）');
  h(makeCtx(e, f, instr(0x203, [im(HANDLE), im(blend), im(alpha), im(color)]), native, () => {}));
  assert.equal(native.calls.length, 1, '每次都恰好下发一次');
  return { call: native.calls[0]!, reads: native.colorReads };
}

test('★0x203：注册为 native 路由（不是 engine-internal no-op）', () => {
  assert.ok(NATIVE_OPS.has(0x203), '0x203 应在 NATIVE_OPS');
});

test('★0x203：α > 255 夹到 255（raw 31439-31442；旧实现给 α = op3 & 0xff）', () => {
  assert.equal(run203(300, 0x123456).call.from, 0xff123456);
  assert.equal(run203(256, 0x000000).call.from, 0xff000000);
  assert.equal(run203(255, 0x123456).call.from, 0xff123456, '255 不夹也一致');
});

test('★0x203：α < 0 ⇒ 取该项当前色的 α 通道（raw 31433-31437）', () => {
  const { call, reads } = run203(-1, 0x123456, 0x80402010);
  assert.equal(call.from, 0x80123456, 'α 来自当前 ARGB 的 >> 24，颜色仍用 op4');
  assert.deepEqual(reads, [HANDLE], '回退读的是同一个 handle');
});

test('★0x203：color < 0 ⇒ 取该项当前 ARGB（raw 31443-31447）', () => {
  assert.equal(run203(10, -1, 0x80aabbcc).call.from, 0x0aaabbcc, '颜色取整个当前 ARGB 的 RGB，α 用 op3');
});

test('★0x203：α 与 color 都 < 0 ⇒ 整份当前色（写入前读，raw 调序 31436/31446 在 31450 之前）', () => {
  assert.equal(run203(-1, -1, 0x40203040).call.from, 0x40203040);
});

test('★0x203：项不存在（sub_4ADD60 返回 −1）⇒ α=255、颜色=0xFFFFFF（引擎位运算原样）', () => {
  const { call } = run203(-1, -1, -1);
  assert.equal(call.from, 0xffffffff, '(unsigned)−1 >> 24 = 255；color = −1 ⇒ 0xFFFFFF');
});

test('★0x203：blend（op2 → DrawItem+0x30）原样透传', () => {
  assert.equal(run203(0xff, 0xffffff, -1, 7).call.blend, 7);
});

test('★0x203 端到端（headless 场景）：第二次 `−1/−1` 保持第一次写入的 ARGB（回退读的是"当前值"）', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const run = (alpha: number, color: number): void => {
    const h = (OPS.get(0x203) ?? NATIVE_OPS.get(0x203))!;
    h(makeCtx(e, f, instr(0x203, [im(HANDLE), im(0), im(alpha), im(color)]), native, () => {}));
  };
  run(0x40, 0x203040); // 第一次：α=0x40、颜色=0x203040
  assert.equal(native.scene.drawItems.get(HANDLE)?.from, 0x40203040, '第一次正常写入');
  run(-1, -1); // 第二次：回退 = 第一次写进去的那份
  assert.equal(native.scene.drawItems.get(HANDLE)?.from, 0x40203040, '回退回了当前的 0x40203040，而不是被 -1 污染');
  run(-1, 0x0000ff); // α 回退（0x40）、颜色用 op4
  assert.equal(native.scene.drawItems.get(HANDLE)?.from, 0x400000ff);
});

/** 合成的 `i203` 必须与真语料同形（op1 handle / op2 blend / op3 α / op4 color 都是 int 槽）。 */
test('★0x203：四格操作数全部被读（不触越界）', () => {
  // ★触碰观测用共享的 `harness.trackArgs`（`tickets/T-0129` 上收；口径与另外三处同一份）
  const { args, hits } = trackArgs([im(HANDLE), im(0), im(255), im(0xffffff)]);
  const native = new ColorRecorder(-1);
  const e = new Engine(native);
  const h = (OPS.get(0x203) ?? NATIVE_OPS.get(0x203))!;
  h(makeCtx(e, new Frame(), instr(0x203, args), native, () => {}));
  assert.deepEqual(hits(), [1, 2, 3, 4]);
});
