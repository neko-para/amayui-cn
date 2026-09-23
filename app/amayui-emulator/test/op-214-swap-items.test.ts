/** @tier T0 @kind core @subsystem render */

/**
 * `i214`（`0x214`）—— **交换两条绘图项记录**（`tickets/T-0049`）。
 *
 * 引擎：`sub_423AE0`(raw 31779) → `sub_4ABEF0`(raw 131084-131143)。读 op1/op2 两个 handle，在**绘图项表**
 * （Scene `_this+258` dwords = byte +1032）里把两条记录**整块互换**（`qmemcpy` ×2 × `0x2E4` = 740 字节，
 * raw 131135-131139），并置脏位 `Scene[11627] = 1`；某一侧缺键 ⇒ 先 `sub_40C910` 建一条**全 0 记录**
 * （`flags` 无 bit0 ⇒ 不画）再搬；两侧都缺 ⇒ 只置脏位（引擎**没有错误串** ⇒ 是合法无操作）。
 *
 * 三条要点（本文件就是这三条的守门人）：
 *  ① **键（handle）不动** —— 层序 = map key（`draw-texture` 的注释），所以交换后两图**绘制次序不变**，
 *     换的是"长什么样、画在哪"（纹理槽 / 源矩形 / 描画位置 / pivot / 动画窗 / 颜色 / 矩阵 / flipbook）；
 *  ② 只碰**绘图项表**，网格表（+1064）不动 —— 与 `0x21D` CopyScene（两张表都拷）不同；
 *  ③ 必须走**真实现**（此前 `0x214` 不在任何表里 ⇒ 命中即 `NotImplementedOp` 硬报错；语料 229 处）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptIntoFrame, OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { dec } from '../src/vm/bits.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scSwapItems, scConfigureDrawItem } from '../src/renderer/scene/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr, loc } from './harness.js';

const A = 0x1000;
const B = 0x2000;
const C = 0x3000;

test('★0x214 模型：整份互换记录、键(handle/layer)不动、脏位置位；缺键/同键/双缺各自的语义', () => {
  const s = newSceneState();
  scConfigureDrawItem(s, { handle: A, layer: A, tex: 5, srcX: 10, srcY: 20, srcW: 30, srcH: 40, dstX: 200, dstY: 300 });
  scConfigureDrawItem(s, { handle: B, layer: B, tex: 7, srcX: 50, srcY: 60, srcW: 70, srcH: 80, dstX: 400, dstY: 500 });
  // 再补两个"非 draw-texture 写的"字段，证明交换的是**整条记录**而不是只换纹理槽
  const ia0 = s.drawItems.get(A)!;
  const ib0 = s.drawItems.get(B)!;
  ia0.blend = 2;
  ia0.entryParam = 1;
  ib0.blend = 0;
  ib0.entryParam = 9;
  ia0.wins[0]!.dur = 111;
  ib0.wins[0]!.dur = 222;

  assert.equal(scSwapItems(s, A, B), true, '两侧都在 ⇒ 真换');
  const ia = s.drawItems.get(A)!;
  const ib = s.drawItems.get(B)!;
  assert.equal(ia, ia0, '★原地交换：对象身份不变（渲染侧按 handle 的缓存不必失效）');
  assert.equal(ib, ib0, '★原地交换：对象身份不变');
  assert.equal(ia.tex, 7);
  assert.equal(ib.tex, 5);
  assert.equal(ia.srcX, 50);
  assert.equal(ib.srcX, 10);
  assert.equal(ia.posX, 400);
  assert.equal(ib.posX, 200);
  assert.equal(ia.blend, 0);
  assert.equal(ib.blend, 2);
  assert.equal(ia.entryParam, 9);
  assert.equal(ib.entryParam, 1);
  assert.equal(ia.wins[0]!.dur, 222);
  assert.equal(ib.wins[0]!.dur, 111);
  assert.equal(ia.handle, A, '★键不动');
  assert.equal(ia.layer, A, '★层序（= map key）不动 ⇒ 绘制次序不变');
  assert.equal(ib.handle, B, '★键不动');
  assert.equal(ib.layer, B, '★层序不动');
  assert.equal(s.dirty, true, '引擎置脏位 `Scene[11627] = 1`');

  // 一侧缺键 ⇒ 与"一条全 0 记录"交换（引擎先 sub_40C910 建记录）
  assert.equal(scSwapItems(s, B, C), true);
  assert.equal(s.drawItems.get(B)!.flags & 1, 0, 'B 拿到空记录 ⇒ flags 无 bit0（不画）');
  assert.equal(s.drawItems.get(C)!.tex, 5, 'C 拿到 B 原来的内容');
  assert.equal(s.drawItems.get(C)!.handle, C, '新建记录的键 = C');
  assert.equal(s.drawItems.get(C)!.layer, C);

  // 两侧都不存在 ⇒ 合法无操作（引擎只置脏位、无错误串）；同一个键 ⇒ 无操作
  assert.equal(scSwapItems(s, 0x7777, 0x8888), false, '两侧都不存在 ⇒ 引擎只置脏位');
  assert.equal(scSwapItems(s, C, C), false, '同一个键：两次 memcpy 互相覆盖 ⇒ 净效果不变');
});

/** 最小脚本映像（`index` 按 dword 步长排，labelMap 由 `loadScriptIntoFrame` 建）。 */
function mkScript(instructions: BinInstruction[]): ScriptBinary {
  let d = 0;
  for (const ins of instructions) {
    (ins as { index: number }).index = d;
    d += 1 + 2 * ins.argc;
  }
  const dwordToInstr: number[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const n = 1 + 2 * instructions[i]!.argc;
    for (let k = 0; k < n; k++) dwordToInstr[instructions[i]!.index + k] = i;
  }
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
    ],
    instructions,
    labelTargets: new Set(),
    dwordToInstr,
    raw: new Uint8Array(0),
  };
}

test('★0x214 端到端：两个 handle 的纹理槽经 i214 互换（真实现，不是 no-op 桩）', async () => {
  const native = new HeadlessScene();
  const e = new Engine(native as unknown as NativeBridge, new InputManager());
  loadScriptIntoFrame(
    e.curScript(),
    mkScript([
      instr(0x1fb, [im(A), im(5), im(10), im(20), im(30), im(40), im(200), im(300)]), // draw-texture A（tex=5）
      instr(0x1fb, [im(B), im(7), im(50), im(60), im(70), im(80), im(400), im(500)]), // draw-texture B（tex=7）
      instr(0x214, [im(A), im(B)]), // ★交换
      instr(0x215, [loc(0), im(A)]), // op1 = A 的纹理槽
      instr(0x215, [loc(1), im(B)]), // op1 = B 的纹理槽
    ]),
    'FAKE.BIN',
  );

  assert.ok(OPS.has(0x214), '0x214 必须在已实现表里（此前三张表都没有它 ⇒ 命中即硬报错）');
  assert.ok(!ENGINE_INTERNAL_OPS.has(0x214), '★不得是 engine-internal 的 no-op 桩');

  const kinds: string[] = [];
  for (let i = 0; i < 5; i++) kinds.push((await stepOnce(e)).handlerKind);
  assert.equal(kinds[2], 'implemented', '★0x214 走真实现');
  const local = (slot: number): number => dec(e.key, e.curScript().locals.int.get(slot) ?? -1);
  assert.equal(local(0), 7, '★A 拿到 B 的纹理槽');
  assert.equal(local(1), 5, '★B 拿到 A 的纹理槽');
  assert.equal(native.scene.drawItems.get(A)!.layer, A, '层序（键）不变');
  assert.equal(native.scene.drawItems.get(B)!.layer, B, '层序（键）不变');
});
