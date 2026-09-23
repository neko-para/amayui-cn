/** @tier T0 @kind core @subsystem transition */

/**
 * ★`0x223`（`sub_423F00` raw 31936-31958 → `sub_4ADDB0` raw 132590-132635，argc 8）：
 * **转场记录表 `Scene+1048` 的写入端 · 类别 0（全屏交叉淡化）**，`op1` = 记录键。
 *
 * 引擎逐字（本守卫钉的就是这几行）：
 *  - `sub_423F00`：`arity 槽 = 17`（⇒ argc 8）→ `sub_4ADDB0(Scene = Engine+80708, op1..op8)`；
 *  - `sub_4ADDB0`：`sub_4AAAF0(Scene, op1)` 按 key **确保转场记录存在**（缺则 `sub_49A640`
 *    raw 117059-117077 建 **24 格**默认记录：`[4] = -1`、`[9..12] = SetRect(0,0,0,0)`），
 *    随后**所有写入都经 `sub_4AAE10(_this + 262, &key)`** —— `_this + 262` = **dword 下标 262
 *    = 字节 1048 ⇒ 转场记录表 `Scene+1048`**（与 `0x24f`/`0x250`/`0x251` **同一张表**）；
 *  - 写集：`[0]=0`、`[1]=0`、`[2]=a8=op7`、`[3]=a9=op8`、`[4]=a3=op2`、`[5]=a4=op3`、
 *    `[7]=a5=op4`、`[6]=a6=op5`、`[8]=a7=op6`；末尾 `Scene[11627] = 1`（置脏）。
 *  - `[0] = 0` ⇒ **类别 0 = 全屏交叉淡化**（帧渲染器 `sub_4B06D0` 按 `[0]` 分四类，见
 *    `docs-new/99-records/2026-09-transition/transition-render-spec-2026-09.md` §2.2/§3.3）。
 *
 * ★为什么有这条守卫（`tickets/T-0087`）：旧实现把这 9 个数存进 emulator 私有的
 * `Engine.itemRegions` —— **数据对、容器错**（无生产读者、渲染端不可见、记录长度 9 ≠ 24）。
 * 现走 `native.setTransition` → `scene/ops.ts` 的 `scSetTransition`（与 `0x24f`/`0x250`/`0x251` 同路）。
 * 语料 **178 处 / 178 个脚本**。
 *
 * ★类别 0 的**渲染端**仍未建模（`tickets/T-0076`）——本守卫只钉「记录写对了地方、长度与默认值都在」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptIntoFrame, OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { enc, dec } from '../src/vm/bits.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scTransitionDefaultRecord } from '../src/renderer/scene/ops.js';
import { im, instr } from './harness.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const T_GLOBAL_INT = 0x3;

/**
 * 合成一条 `i223 a b c d e f g h`（8 个 global-int 槽）并走**真实派发**（`stepOnce`）执行。
 *
 * 宿主 = `HeadlessScene`（不是 `StubNative`）：`0x223` 的落点在**共享场景模型**里，
 * 桩宿主没有模型 ⇒ 断言不到「写进了哪个容器」这件事。
 */
async function run(vals: number[]): Promise<{ e: Engine; native: HeadlessScene }> {
  const native = new HeadlessScene({});
  const e = new Engine(native, new InputManager());
  e.key = 0x12345678;
  const slots = vals.map((_, i) => 0x40 + i);
  const instr: BinInstruction = {
    opcode: 0x223,
    name: 'i223',
    argc: vals.length,
    args: slots.map((raw) => ({ type: T_GLOBAL_INT, raw })) as unknown as BinArg[],
    byteOffset: 0x3c,
    index: 0,
  };
  const sc: ScriptBinary = {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  slots.forEach((s, i) => e.globals.int.set(s, enc(e.key, vals[i]!)));
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', '0x223 应已实现');
  assert.equal(e.curScript().ip, 1, '应推进 ip');
  // 顺带证明参数确实来自脚本槽（读回一个槽的 DEC 值）
  assert.equal(dec(e.key, e.globals.int.get(0x40) ?? 0), vals[0]);
  return { e, native };
}

function rec(native: HeadlessScene, id: number): number[] {
  const r = native.scene.render4.transitions.get(id);
  assert.ok(r, `记录 0x${id.toString(16)} 必须在 render4.transitions（= 引擎 Scene+1048）里`);
  return r;
}

test('注册表棘轮：0x223 落在 OPS（不是 no-op 桩、不是 native 桩表）', () => {
  assert.ok(OPS.has(0x223), '0x223 必须在已实现表里');
  assert.equal(NATIVE_OPS.has(0x223), false, '0x223 不该在 NATIVE_OPS');
  assert.equal(ENGINE_INTERNAL_OPS.has(0x223), false, '0x223 不得留在 no-op 表');
});

test('★0x223：写进 Scene+1048 转场记录表（类别 0）—— 不是 emulator 私有容器', async () => {
  // i223 <op1=key 0x18a9c> <op2=7> <op3=11> <op4=22> <op5=33> <op6=44> <op7=55> <op8=66>
  const { e, native } = await run([0x18a9c, 7, 11, 22, 33, 44, 55, 66]);
  const r = rec(native, 0x18a9c);

  // ① 容器：转场记录表（同一张表 0x24f/0x250/0x251 也走它）
  assert.equal(native.scene.dirty, true, '模型变更 ⇒ 置脏（Scene[11627] = 1）');

  // ② 类别：`[0] = 0` = 全屏交叉淡化
  assert.equal(r[0], 0, '`[0] = 0` ⇒ 类别 0（全屏交叉淡化）');
  assert.equal(r[1], 0, '`[1] = 0`（窗口起点由消费端首帧锁存，指令只写 0）');

  // ③ 前 9 格与引擎逐格相等（注意 [2]/[3] ← op7/op8、[6]/[7] ← op5/op4 的交叉）
  assert.deepEqual(
    r.slice(0, 9),
    [0, 0, 55, 66, 7, 11, 33, 22, 44],
    '引擎写序：[0]=0 [1]=0 [2]=op7 [3]=op8 [4]=op2 [5]=op3 [6]=op5 [7]=op4 [8]=op6',
  );

  // ④ 长度与默认值：引擎先建 **24 格**默认记录再覆盖前 9 格（旧实现只存 9 格 ⇒ 丢了这些）
  assert.equal(r.length, 24, '记录 = sub_49A640 建出来的 96 字节 = 24 个 dword（不是 9）');
  assert.equal(r[4], 7, '`[4] = op2` 覆盖默认 −1（这是预期的覆盖，不是默认值丢失）');
  assert.deepEqual(r.slice(9, 13), [0, 0, 0, 0], '`[9..12]` 保持默认 = SetRect(0,0,0,0)');
  assert.equal(r[13], 0, '`[13]` 保持默认 0（0x223 不写子类型）');
  assert.deepEqual(r.slice(14), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], '`[14..23]` 保持默认 0');

  // ⑤ 与共享层默认记录逐格对照（防"恰好全 0 也算过"）
  const def = scTransitionDefaultRecord();
  assert.equal(def.length, 24);
  assert.equal(def[4], -1, '共享层默认记录 `[4] = -1`（sub_49A640 的 +16 = −1）');
  assert.notEqual(r[4], def[4], '`[4]` 已被 op2 覆盖 ⇒ 与默认可区分');

  // ⑥ 旧死模型必须消失（容器错了就不能留影子账本）
  assert.equal(
    (e as unknown as Record<string, unknown>).itemRegions,
    undefined,
    '`Engine.itemRegions` 已删：0x223 的唯一落点是转场记录表',
  );
});

test('0x223：同 key 重写 = 合并（只改被写的格）；不同 key 各自一条', async () => {
  const { e, native } = await run([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(rec(native, 1).slice(0, 9), [0, 0, 7, 8, 2, 3, 5, 4, 6]);
  assert.equal(native.scene.render4.transitions.size, 1, '只记当前这条指令涉及的 key');
  assert.equal(e.curScript().ip, 1);
});

test('0x223 与 0x24F/0x250/0x251 同表：类别 0 与类别 2 的记录并存且互不串格', async () => {
  const { native } = await run([0x55, 2, 3, 4, 5, 6, 7, 8]);
  // 同表再写一条类别 2（0x24F）：`[0]=2`、`[13]=类型`、`[15]=key`
  const h = OPS.get(0x24f) ?? NATIVE_OPS.get(0x24f);
  assert.ok(h, '0x24f 未注册');
  const e2 = new Engine(native);
  h!(
    makeCtx(
      e2,
      new Frame(),
      instr(0x24f, [im(0x66), im(2), im(3), im(1), im(5), im(6), im(3), im(8), im(0), im(0x5dc)]),
      native,
      () => {},
    ),
  );
  assert.equal(native.scene.render4.transitions.size, 2, '两类记录在同一张表里并存');
  assert.equal(rec(native, 0x55)[0], 0, '类别 0 的记录不被 0x24F 触碰');
  assert.equal(rec(native, 0x55)[2], 7, '类别 0 的 `[2]`（= op7）仍是 7');
  assert.deepEqual(rec(native, 0x55).slice(9, 13), [0, 0, 0, 0], '类别 0 的 `[9..12]` 仍是默认');
  assert.equal(rec(native, 0x66)[0], 2, '新记录是类别 2');
  assert.deepEqual(rec(native, 0x66).slice(9, 13), [0, 0, 0, 0]);
});
