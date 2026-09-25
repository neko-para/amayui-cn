/** @tier T0 @kind core @subsystem l2d */

/**
 * ★Live2D **572B 立绘节点变换族**（`0x347`/`0x348`/`0x349`/`0x34A`/`0x34B`/`0x34C`/`0x34D`）——
 * 合成指令守卫（`tickets/T-0077`，审计 P2 `op-9-op840`、P1 `op-6-01`）。
 *
 * 为什么必须是**合成指令**：`i347`/`i348`/`i34a`/`i34b`/`i34c` 在本作语料里 **0 处**
 * （`i349` 7 处、`i34d` 12 处，全在 `src/BTL.txt`），所以真实脚本既不会覆盖 int/float 混排的解析，
 * 也不会暴露"值落错字段"。这里逐条钉死「**操作数类型/顺序**」与「**落点字段**」：
 *
 * | op | 体（raw） | 操作数 | 落点 |
 * |---|---|---|---|
 * | `0x347` | `sub_427E10` 34567-34580 | `key(int) + sx/sy/sz(float ÷100)` | `record+80`（立即缩放） |
 * | `0x348` | `sub_427EA0` 34583-34599 | `key(int) + ax/ay/az(float) + deg(float)` | `+464/468/472` 轴、`+488` 角（**旋转**，不是缩放） |
 * | `0x349` | `sub_427F30` 34602-34615 | `key(int) + x/y/z(float)` | `+336`（立即平移） |
 * | `0x34A` | `sub_427FB0` 34618-34631 | `key(int) + x/y/z(float)` | `record[2..4]`（`+8/+12/+16` 基础偏移） |
 * | `0x34B` | `sub_428030` 34633-34651 | `key(int) + delay/dur(int) + sx/sy/sz(float ÷100)` | 窗1（`+32/+52` + `+144` 矩阵） |
 * | `0x34C` | `sub_4280D0` 34655-34674 | `key(int) + delay/dur(int) + ax/ay/az/deg(float)` | 窗2（`+36/+56` + `+476..492`） |
 * | `0x34D` | `sub_428170` 34677-34694 | `key(int) + delay/dur(int) + x/y/z(float)` | 窗3（`+40/+60` + `+400` 矩阵） |
 *
 * ★窗1/2/3 还有一道门：引擎 `sub_4B0030`/`sub_4B0110`/`sub_4B0280` 都先 `if ((*rec & 1) == 0) return;`
 * （raw 134157/134202/134254），而 `record[0]` 的 bit0 只有 `0x344` 会置（`sub_4AFBF0` raw 133942）
 * ⇒ **没有 `0x344` 建过的记录收不到窗口**（只被隐式建出来，flags = 0）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { enc } from '../src/vm/bits.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, loc } from './harness.js';
import type { L2dNode } from '../src/live2d/runtime.js';

/** 立即数 float：`raw` 必须是 IEEE 位模式（`readFloatOperand` 走 `floatBits(raw)`）。 */
const fm = (v: number): BinArg =>
  ({ type: 1, raw: new Uint32Array(new Float32Array([v]).buffer)[0]! }) as unknown as BinArg;

const KEY = 0x14;

function mk() {
  const e = new Engine(new StubNative(() => {}));
  const f = new Frame();
  const setInt = (slot: number, v: number): void => void f.locals.int.set(slot, enc(e.key, v));
  const setFloat = (slot: number, v: number): void => void f.locals.float.set(slot, v);
  const run = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 必须在已实现表（不是 native 桩 / no-op）`);
    h(makeCtx(e, f, instr(op, args), new StubNative(() => {}), () => {}));
  };
  setInt(1, KEY); // op1 = key（本地槽 1）
  return { e, f, setInt, setFloat, run };
}

function node(e: Engine, key = KEY): L2dNode {
  const n = e.l2dNodes.get(key);
  assert.ok(n, `节点 ${key} 应已存在`);
  return n;
}

test('★Live2D 节点族：7 条都在 OPS（不是 native 桩 / no-op），0x348 不再复用缩放 handler', () => {
  for (const op of [0x347, 0x348, 0x349, 0x34a, 0x34b, 0x34c, 0x34d]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 应在 OPS`);
    assert.ok(!NATIVE_OPS.has(op) && !ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不该是桩/no-op`);
  }
});

test('★0x347：key(int) + 三分量 float ÷100 ⇒ node.scale（不是标量、不是 rotation）', () => {
  const { e, run } = mk();
  run(0x347, [loc(1), fm(150), fm(50), fm(25)]);
  assert.deepEqual(node(e).scale, [1.5, 0.5, 0.25], '150/50/25 百分数 ⇒ 1.5/0.5/0.25');
  // ★`T-0160` 最小 retarget：缺省轴从 `[0,0,1]` 改为 `[0,0,0]`（引擎 `sub_49CA10` raw 118487-118490
  //   写 `+464/+468/+472 = 0.0`）—— 断言强度不变（仍是"缩放不得碰旋转"），只是缺省值按体订正。
  assert.deepEqual(node(e).rotation, { axis: [0, 0, 0], deg: 0 }, '缩放不得碰旋转（缺省轴角 = (0,0,0)/0）');
});

test('★0x347：int 型操作数按 int→float 转换（引擎 sub_41C300 case 9；旧 optInt 在 float 型上读位模式）', () => {
  const { e, setInt, run } = mk();
  setInt(2, 100); // 本帧 int 槽 = 100
  run(0x347, [loc(1), loc(2), fm(100), fm(100)]);
  assert.deepEqual(node(e).scale, [1, 1, 1], 'int 100 ⇒ 100/100 = 1');
});

test('★0x348：是**轴角旋转**（key + 轴 xyz float + 角 float）⇒ node.rotation，绝不动 node.scale', () => {
  const { e, run } = mk();
  run(0x348, [loc(1), fm(0), fm(0), fm(1), fm(30)]);
  assert.deepEqual(node(e).rotation, { axis: [0, 0, 1], deg: 30 }, '轴 +464/468/472、角 +488（raw 134085-134097）');
  assert.deepEqual(node(e).scale, [1, 1, 1], '★旧实现把 0x348 当成缩放 ⇒ 这里必须不动 scale');
  run(0x348, [loc(1), fm(1), fm(2), fm(2), fm(90)]);
  assert.deepEqual(node(e).rotation, { axis: [1, 2, 2], deg: 90 }, '轴分量不被 ÷100（只有 0x347/0x34B 才除）');
});

test('★0x349 / 0x34A：三分量 float ⇒ translate / baseOffset（旧实现按 int 读）', () => {
  const { e, run } = mk();
  run(0x349, [loc(1), fm(12.5), fm(-3), fm(0.25)]);
  assert.deepEqual(node(e).translate, [12.5, -3, 0.25]);
  run(0x34a, [loc(1), fm(1), fm(2), fm(4)]);
  assert.deepEqual(node(e).baseOffset, [1, 2, 4]);
});

test('★0x34B：delay/dur 是 **int**、三分量 float 才 ÷100 ⇒ wins.scale（旧实现把 delay 当缩放百分数）', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(0)]); // 先建节点（bit0 = 1）⇒ 窗门打开
  run(0x34b, [loc(1), im(400), im(500), fm(200), fm(100), fm(50)]);
  // ★2026-09（T-0096）`wins.*` 结构订正：目标的字段名从 `value` 改为 **`to`**，并补上 `from`
  //   —— 引擎里窗的 from 与"立即值"是**同一块**（`+20`/`+52`/`+84`），to 在 `+144`/`+272`/`+400`。
  assert.deepEqual(node(e).wins.scale, {
    delay: 400,
    dur: 500,
    from: [1, 1, 1], // 窗指令不写 from ⇒ from = 那一刻的立即缩放
    to: [2, 1, 0.5],
  });
  assert.deepEqual(node(e).scale, [1, 1, 1], '窗写入不得碰立即缩放');
});

test('★0x34B/0x34C/0x34D：`record[0] & 1` 门 —— 没有 0x344 建过的记录收不到窗口（raw 134157/134202/134254）', () => {
  const { e, run } = mk();
  run(0x34b, [loc(1), im(400), im(500), fm(200), fm(100), fm(50)]);
  const n = node(e); // `sub_4AACA0` 会把它建出来（raw 130129），但 flags = 0
  assert.equal(n.flags & 1, 0, '隐式建出的记录 flags bit0 = 0');
  assert.deepEqual(n.wins.scale, { delay: 0, dur: 0, from: [1, 1, 1], to: [1, 1, 1] }, '门挡掉 ⇒ 窗保持缺省');
  run(0x34c, [loc(1), im(10), im(20), fm(0), fm(0), fm(1), fm(45)]);
  run(0x34d, [loc(1), im(30), im(40), fm(7), fm(8), fm(9)]);
  assert.equal(node(e).wins.rotation.delay, 0, '0x34C 同样被门挡掉');
  assert.deepEqual(node(e).wins.translation.to, [0, 0, 0], '0x34D 同样被门挡掉');
  // 门打开后同一批指令立刻生效
  run(0x344, [loc(1), im(0)]);
  run(0x34b, [loc(1), im(400), im(500), fm(200), fm(100), fm(50)]);
  run(0x34c, [loc(1), im(10), im(20), fm(0), fm(0), fm(1), fm(45)]);
  run(0x34d, [loc(1), im(30), im(40), fm(7), fm(8), fm(9)]);
  assert.deepEqual(node(e).wins.scale, { delay: 400, dur: 500, from: [1, 1, 1], to: [2, 1, 0.5] });
  assert.deepEqual(node(e).wins.rotation, {
    delay: 10,
    dur: 20,
    // ★`T-0160` 最小 retarget：窗的 `from` = 那一刻的立即轴角，而缺省轴已按体订正为 `(0,0,0)`
    from: { axis: [0, 0, 0], deg: 0 },
    to: { axis: [0, 0, 1], deg: 45 },
  });
  assert.deepEqual(node(e).wins.translation, { delay: 30, dur: 40, from: [0, 0, 0], to: [7, 8, 9] });
  assert.equal(node(e).flags & 2, 2, '窗写入置 bit1（引擎 `*rec |= 2`）');
  assert.equal(node(e).wins.startedAtMs, 0, '窗指令把窗起点 `+24` 置 0（下一条窗重新锁存）');
  assert.equal(node(e).matrixDirty, true, '窗指令置 `+76`（待重算位）');
});

test('★0x34D：真语料口径（BTL `i34d <key> 190 1f4 <z> 0 0`）—— op2/op3 是 delay/dur，平移从 op4 起', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(0)]);
  // 对应 src/BTL.txt:906 `i34d (local-int fff) 190 1f4 (local-int 1001) 0 0`
  run(0x34d, [loc(1), im(0x190), im(0x1f4), fm(300), fm(0), fm(0)]);
  assert.deepEqual(node(e).wins.translation, { delay: 400, dur: 500, from: [0, 0, 0], to: [300, 0, 0] });
});

test('★0x34C：key(int) + delay/dur(int) + 轴 xyz + 角（float）⇒ wins.rotation（旧实现整体错位一格）', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(0)]);
  run(0x34c, [loc(1), im(10), im(20), fm(1), fm(0), fm(0), fm(90)]);
  assert.deepEqual(node(e).wins.rotation, {
    delay: 10,
    dur: 20,
    from: { axis: [0, 0, 0], deg: 0 }, // ★T-0160：窗的 from = 那一刻的立即轴角（缺省已按体订正为 (0,0,0)）
    to: { axis: [1, 0, 0], deg: 90 }, // `0x34C` 写 `+476..484`/`+492`
  });
  assert.equal(node(e).rotation.axis[0], 0, '窗写入**不碰**立即旋转（`0x348` 的那一份）');
});

test('★0x346 复位：保留 flags/slot/baseOffset/wins（引擎只写 4 个矩阵块 + `+76`，raw 133952-134032）', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(3)]); // slot = 3、flags bit0 = 1
  run(0x34a, [loc(1), fm(1), fm(2), fm(4)]);
  run(0x349, [loc(1), fm(5), fm(6), fm(7)]);
  run(0x34b, [loc(1), im(100), im(200), fm(200), fm(200), fm(100)]); // 窗：复位**不该**清它
  run(0x346, [loc(1)]);
  const n = node(e);
  assert.equal(n.slot, 3, '复位不碰 +4(slot)');
  assert.equal(n.flags & 1, 1, '复位不碰 record[0]');
  assert.deepEqual(n.baseOffset, [1, 2, 4], '复位不碰 +8/+12/+16');
  assert.deepEqual(n.translate, [0, 0, 0], '复位把平移矩阵清回单位');
  assert.deepEqual(n.scale, [1, 1, 1]);
  assert.equal(n.resets, 1);
  assert.equal(n.matrixDirty, false, '复位写 `+76 = 0`');
  // ★2026-09 订正（T-0096）：旧实现用 `makeNode()` 重建整个节点 ⇒ 把 `wins` 也清了，那是**偏差**。
  //   引擎 `sub_4AFC40` 只写 `+76` 与 `+20..35`/`+52..67`/`+84..99`/`+127..142` ⇒ delay/dur/to **保留**。
  assert.equal(n.wins.scale.delay, 100, '复位不碰 `+32`（delay）');
  assert.equal(n.wins.scale.dur, 200, '复位不碰 `+52`（dur）');
  assert.deepEqual(n.wins.scale.to, [2, 2, 1], '复位不碰 `+144`（to）');
  assert.equal(n.flags & 2, 2, '复位也不清"窗在跑"位（那不是 `+76`）');
});
