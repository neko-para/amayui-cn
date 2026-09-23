/** @tier T0 @kind core @subsystem transition */

/**
 * **转场（wipe）记录写入族 `0x24F` / `0x250` / `0x251`**（`tickets/T-0076` 的 B3 补；台账里排名最前的
 * 三条"零注册"指令：`i251` 44 处 / 21 文件、`i250` 34 处 / 20 文件、`i24f` 6 处 / 6 文件）。
 *
 * 断言的是**体里真实行为**（逐格照抄引擎的 `sub_4AAE10(Scene+1048, &id)[i] = v`），不是"不报错"：
 *  - `0x24F` → `sub_4AF6A0`（raw 133703-133787，SetBlindWipe）：`[0]=2`、`[13]=类型`、`[14]=分割宽度`、
 *    `[15]=op1`；类型非法（unsigned > 0xB）⇒ 只打错误串、**不写记录**；分割宽度 < 1 ⇒ 就地改写成
 *    `(split=1, delay=0, dur=0, type=-1)` 后 **goto LABEL_4 照写记录**（两条路径方向相反，分开断言）。
 *  - `0x250` → `sub_4AF880`（raw 133789-133858）：`[0]=3`、`[13]=0`（渲染端 `SlideBlur`），通道 B/C 显式清零。
 *  - `0x251` → `sub_4AFA30`（raw 133860-133935）：`[0]=3`、`[13]=1`（渲染端 `ZoomBlur`），通道 D 显式清零。
 *
 * 三条的 argc（10/10/12）由引擎 arity 槽 `N = 2*argc+1`（0x15/0x15/0x19）与 `.lst` 的 `push 0Ah…push 1`
 * 双向确认（见 `handlers/gfx-state.ts` 的族注释），因此 `ALLOW_UNDERRUN` **未动**（12 格全被读）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr } from './harness.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scClearTransitions, scTransitionDefaultRecord } from '../src/renderer/scene/ops.js';
import { scSnapshot } from '../src/renderer/scene/snapshot.js';

/** 转场记录：只保留**非默认**的格，便于逐格断言（默认见 `sub_49A640` raw 117059-117077）。 */
function rec(native: HeadlessScene, id: number): Record<string, number> {
  const r = native.scene.render4.transitions.get(id);
  assert.ok(r, `记录 0x${id.toString(16)} 应存在`);
  assert.equal(r!.length, 24, '引擎记录 = 96 字节 = 24 个 dword');
  const def = scTransitionDefaultRecord();
  const out: Record<string, number> = {};
  for (let i = 0; i < r!.length; i++) if (r![i] !== def[i]) out[`[${i}]`] = r![i]!;
  return out;
}

test('注册表棘轮：0x24F/0x250/0x251 落在 OPS（不是 no-op 表），且不回写操作数', () => {
  for (const op of [0x24f, 0x250, 0x251]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 应已实现（OPS）`);
    assert.equal(NATIVE_OPS.has(op), false, `0x${op.toString(16)} 不该在 NATIVE_OPS（GFX_STATE_OPS 属 OPS）`);
    assert.equal(ENGINE_INTERNAL_OPS.has(op), false, `0x${op.toString(16)} 不得留在 stub 表`);
  }
  // 引擎这三条**不读也不写**脚本操作数（只有 `sub_41BF50` 的取值）⇒ op1 保持原值
  const e = new Engine(new StubNative(() => {}));
  const f = new Frame();
  const native = new HeadlessScene({});
  const g = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;
  const before = e.globals.int.get(0x300);
  const h = OPS.get(0x24f) ?? NATIVE_OPS.get(0x24f);
  assert.ok(h);
  h!(makeCtx(e, f, instr(0x24f, [g(0x300), im(2), im(3), im(4), im(5), im(6), im(0), im(8), im(0), im(500)]), native, () => {}));
  assert.equal(e.globals.int.get(0x300), before, '0x24F 不写操作数');
});

test('★0x24F（SetBlindWipe）：[0]=2 / [13]=类型 / [14]=分割宽度 / [15]=op1 / [2][3]=延迟·时长', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const run = (args: BinArg[]): void => {
    const h = OPS.get(0x24f) ?? NATIVE_OPS.get(0x24f);
    assert.ok(h, '0x24f 未注册');
    h!(makeCtx(e, f, instr(0x24f, args), native, () => {}));
  };
  // 形态取自语料：`i24f (local-int 0) (local-ptr 2) 3 1 (local-ptr 4) 1 3 8 0 5dc`
  //   ⇒ op3/op4 = 绘制项区间 3/1、op5/op6 = 5/6、op7 = 类型 3、op8 = 分割宽度 8、op9/op10 = 延迟 0/时长 1500
  run([im(0x1234), im(2), im(3), im(1), im(5), im(6), im(3), im(8), im(0), im(0x5dc)]);
  assert.deepEqual(
    rec(native, 0x1234),
    {
      '[0]': 2, // 盲式擦除（渲染端 `v384[0] == 2` 分支）
      '[3]': 0x5dc, // 时长 = 1500（窗口到点由渲染器清 0）
      '[4]': 2, // 工作纹理槽（子 #2 != 默认 -1）
      '[5]': 3, // 起始绘制项 id
      '[6]': 5, // op5（转场渲染路径未读，如实记录）
      '[7]': 1, // 跨度 count
      '[8]': 6, // op6（同上）
      '[13]': 3, // 盲式类型（渲染端 switch 的选择子）
      '[14]': 8, // 分割宽度
      '[15]': 0x1234, // 目标绘制项 handle（`sub_459EA0(Scene+1032, &v384[15])`）
    },
  );
  // `[1]` 与 `[9..12]` 保持默认（引擎只写 [0..8]/[13..15]；`[1]` 由渲染器首帧锁存时钟）
  const r = native.scene.render4.transitions.get(0x1234)!;
  assert.equal(r[1], 0, '`[1]` 窗口起点由渲染器锁存，指令不写');
  assert.equal(r[2], 0, '`[2]` 延迟 = op9 = 0（写的是默认值，故不出现在差分里）');
  assert.deepEqual(r.slice(9, 13), [0, 0, 0, 0], '`[9..12]` = SetRect(0,0,0,0) 默认值（本族不写）');
  assert.equal(native.scene.dirty, true, '模型变更 ⇒ 置脏');
});

test('★0x24F 两条错误路径方向相反：分割宽度 < 1 ⇒ 改写后**照写**；类型 > 0xB ⇒ **不写**', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const run = (args: BinArg[]): void => {
    const h = OPS.get(0x24f) ?? NATIVE_OPS.get(0x24f);
    h!(makeCtx(e, f, instr(0x24f, args), native, () => {}));
  };
  // ① 分割宽度 0（raw 133730-133738：a9=1, a10=0, a11=0, a8=-1，然后 goto LABEL_4 ⇒ 仍写记录）
  run([im(0x11), im(2), im(3), im(1), im(5), im(6), im(7), im(0), im(99), im(88)]);
  assert.deepEqual(rec(native, 0x11), {
    '[0]': 2,
    '[4]': 2,
    '[5]': 3,
    '[6]': 5,
    '[7]': 1,
    '[8]': 6,
    '[13]': -1, // a8 = -1 ⇒ 渲染器的 `if (v384[13] < 0) Scene+46512 = 1`（立即中止）
    '[14]': 1, // 分割宽度被夹到 1
    '[15]': 0x11,
  });
  const r11 = native.scene.render4.transitions.get(0x11)!;
  assert.equal(r11[2], 0, '★延迟被就地清 0（传入的 op9 = 99 不生效）');
  assert.equal(r11[3], 0, '★时长被就地清 0（传入的 op10 = 88 不生效）');
  // ② 类型 12（unsigned 12 > 0xB，raw 133740-133787：打「タイプが不正です．」后 return）
  run([im(0x12), im(2), im(3), im(1), im(5), im(6), im(12), im(8), im(0), im(0x5dc)]);
  assert.equal(native.scene.render4.transitions.has(0x12), false, '类型非法 ⇒ 一个格都不写');
  // ③ 类型 -1 也是 unsigned 巨大值 ⇒ 同样不写（a8 是 `unsigned int`）
  run([im(0x13), im(2), im(3), im(1), im(5), im(6), im(-1), im(8), im(0), im(0x5dc)]);
  assert.equal(native.scene.render4.transitions.has(0x13), false, '负数类型按 unsigned 比较 ⇒ 非法');
  // ④ 合法边界 0xB 走正常路径
  run([im(0x14), im(2), im(3), im(1), im(5), im(6), im(0xb), im(8), im(0), im(0x5dc)]);
  assert.equal(native.scene.render4.transitions.get(0x14)![13], 0xb, '类型 11 合法');
});

test('★0x250（[13]=0 ⇒ 渲染端 SlideBlur）：[0]=3、通道 B/C 清零、[16]/[19]←op5/op6、[20]/[23]←op7/op8', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const h = OPS.get(0x250) ?? NATIVE_OPS.get(0x250);
  assert.ok(h, '0x250 未注册');
  // 形态取自语料：`i250 (local-int 0) 3f59 f8024 1 1 2 4 6 0 bb8`
  h!(makeCtx(e, f, instr(0x250, [im(0), im(0x3f59), im(1), im(1), im(2), im(4), im(6), im(0), im(0), im(0xbb8)]), native, () => {}));
  const r = native.scene.render4.transitions.get(0)!;
  assert.deepEqual(r, [
    3, 0, 0, 0xbb8, // [0]=3（插值转场）、[1]=0（首帧锁存）、[2]=延迟 op9、[3]=时长 op10
    0x3f59, 1, 0, 1, // [4]=工作纹理槽 op2、[5]=起始 id op3、[6] 未写、[7]=跨度 op4
    0, 0, 0, 0, // [8] 未写 + [9..12] = SetRect 默认
    0, 0, 0, 0, // [13] = 0 ⇒ SlideBlur、[14]/[15] 未写（类别 3 不读）
    2, 0, 0, 4, // [16]=op5、[17]/[18]=0（通道 B/C 显式清零）、[19]=op6
    6, 0, 0, 0, // [20]=op7、[21]/[22]=0、[23]=op8（=0，与默认同值）
  ]);
});

test('★0x251（[13]=1 ⇒ 渲染端 ZoomBlur）：[0]=3、通道 D 清零、[16..18]←op5..op7、[20..22]←op8..op10', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const h = OPS.get(0x251) ?? NATIVE_OPS.get(0x251);
  assert.ok(h, '0x251 未注册');
  // 形态取自语料：`i251 (local-int 0) 3f5f f8026 1 1 3 5 7 a d 0 5dc`（12 格，末两格 = 延迟/时长）
  h!(
    makeCtx(
      e,
      f,
      instr(0x251, [im(0), im(0x3f5f), im(1), im(1), im(3), im(5), im(7), im(0xa), im(0xd), im(0), im(0), im(0x5dc)]),
      native,
      () => {},
    ),
  );
  const r = native.scene.render4.transitions.get(0)!;
  assert.deepEqual(r, [
    3, 0, 0, 0x5dc, // [0]=3、[1]=0、[2]=延迟 op11、[3]=时长 op12
    0x3f5f, 1, 0, 1, // [4]=op2、[5]=op3、[6] 未写、[7]=op4
    0, 0, 0, 0, // [8] 未写、[9..12] 默认
    0, 1, 0, 0, // [12] 默认、[13] = 1 ⇒ ZoomBlur（raw 135837）、[14]/[15] 未写
    3, 5, 7, 0, // [16]=op5、[17]=op6、[18]=op7、[19]=0（通道 D 显式清零）
    0xa, 0xd, 0, 0, // [20]=op8、[21]=op9、[22]=op10、[23]=0
  ]);
});

test('转场记录是**合并**语义（同 id 再下发只改被写的格）：与引擎 `sub_4AAAF0`+`sub_4AAE10` 同', () => {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const run = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  run(0x251, [im(0x20), im(2), im(3), im(1), im(1), im(2), im(3), im(4), im(5), im(6), im(0), im(100)]);
  assert.equal(native.scene.render4.transitions.get(0x20)![20], 4, '先写 [20] = op8');
  // 同 id 换成 `0x250`（它的 [20] = op7）：被写的格覆盖，未被写的格（[17]/[18] 由 0x251 写过）保持
  run(0x250, [im(0x20), im(2), im(3), im(1), im(7), im(8), im(9), im(0), im(0), im(50)]);
  const r = native.scene.render4.transitions.get(0x20)!;
  assert.equal(r[20], 9, '[20] 被 0x250 的 op7 覆盖');
  assert.equal(r[13], 0, '[13] 改成 0（SlideBlur）');
  assert.equal(r[17], 0, '[17] 被 0x250 显式清 0');
  assert.equal(r[23], 0, '[23] 被 0x250 显式清 0');
  assert.equal(r[3], 50, '[3] 时长改为 50');
});

test('★0x224 真的清空转场记录（引擎 `sub_4A9BE0` 逐节点 delete，raw 129282-129302）', () => {
  const s = newSceneState();
  const native = new HeadlessScene({});
  // 直接走共享层：写一条再清
  const e = new Engine(native);
  const f = new Frame();
  const h251 = OPS.get(0x251) ?? NATIVE_OPS.get(0x251);
  h251!(makeCtx(e, f, instr(0x251, [im(7), im(2), im(3), im(1), im(1), im(2), im(3), im(4), im(5), im(6), im(0), im(100)]), native, () => {}));
  assert.equal(native.scene.render4.transitions.size, 1);
  scClearTransitions(native.scene);
  assert.equal(native.scene.render4.transitions.size, 0, '清空容器（不只是计数）');
  assert.equal(native.scene.render4.transitionClears, 1, '计数仍保留（报告/digest 用）');
  // 独立实例的空表：清一次不报错
  scClearTransitions(s);
  assert.equal(s.render4.transitions.size, 0);
});

test('转场记录导出到快照（报告/测试可断言"脚本确实下发了这个状态"）', () => {
  const s = newSceneState();
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const h = OPS.get(0x250) ?? NATIVE_OPS.get(0x250);
  h!(makeCtx(e, f, instr(0x250, [im(0x99), im(1), im(2), im(1), im(3), im(4), im(5), im(6), im(7), im(0x2d0)]), native, () => {}));
  const snap = scSnapshot(native.scene, 0, e);
  const row = snap.render4.transitions.find(([k]) => k === 0x99);
  assert.ok(row, 'id 0x99 的记录必须在快照里');
  assert.equal(row![1].length, 24);
  assert.equal(row![1][3], 0x2d0, '时长 = 720 落进快照');
  assert.equal(row![1][13], 0, '[13] = 0（SlideBlur）');
  assert.deepEqual(snap.render4.transitions, [...native.scene.render4.transitions.entries()].map(([k, v]) => [k, [...v]]));
});
