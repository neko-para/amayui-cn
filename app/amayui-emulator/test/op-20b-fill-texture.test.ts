/**
 * ★`0x20B` **FillTexture**（`sub_423690` raw 31569-31592 → `sub_4A4C70` raw 124572 起，argc 7）。
 *
 * 引擎体逐字（这也是本测试的判据来源）：
 * ```
 * arity 槽 = 15;                       // ⇒ argc 7
 * v7 = op2; v8 = op3;                  // 左上角
 * v9 = v7 + op4; v10 = v8 + op5;       // ★op4/op5 = 宽/高（不是右下角坐标）
 * v2 = min(op6, 255);                  // α 夹到 255
 * v6 = 0xFFRRGGBB（A 固定 FF；op7 只取低 24 位）
 * sub_4A4C70(Scene, op1, &rect, v6, v2);
 * ```
 * 语料 **204 处 / 187 个脚本**（DRAWMINIMAP / INFOFA / SC0330 等）；此前未注册 ⇒ 命中即 `NotImplementedOp`。
 *
 * 本测试断言「引擎算出来的 6 个值」逐个到了宿主缝（`tickets/T-0076` 的 B3）：
 * 槽 / 左上角 / 宽高 / `0xFFRRGGBB` / 夹过的 α。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptIntoFrame, OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { dec, enc } from '../src/vm/bits.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const T_GLOBAL_INT = 0x3;

/** 造一条 7 操作数、全部落 global-int 槽的指令（槽号 = 0x40 + i）。 */
function mkScript(op: number, vals: number[]): { sc: ScriptBinary; slots: number[] } {
  const slots = vals.map((_, i) => 0x40 + i);
  const instr: BinInstruction = {
    opcode: op,
    name: `i${op.toString(16)}`,
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
  return { sc, slots };
}

async function run(op: number, vals: number[]): Promise<HeadlessScene> {
  const native = new HeadlessScene({});
  const e = new Engine(native as unknown as NativeBridge, new InputManager());
  e.key = 0x12345678;
  const { sc, slots } = mkScript(op, vals);
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  slots.forEach((slot, i) => e.globals.int.set(slot, enc(e.key, vals[i]!)));
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', `0x${op.toString(16)} 应已实现`);
  assert.equal(e.curScript().ip, 1, '应推进 ip');
  return native;
}

test('★0x20B：FillTexture 已注册且按体走真实现（不是 no-op 桩）', () => {
  assert.ok(NATIVE_OPS.has(0x20b) || OPS.has(0x20b), '0x20B 必须在已实现表里（此前三张表都没有 ⇒ 命中即硬停）');
  assert.ok(!ENGINE_INTERNAL_OPS.has(0x20b), '不得是 engine-internal 的 no-op 桩');
});

test('★0x20B：op4/op5 是**宽/高**（体里 x2 = x + op4），op7 组装成 0xFFRRGGBB，op6 夹到 255', async () => {
  // i20b <槽=7> <x=10> <y=20> <w=100> <h=30> <α=300→255> <rgb=0x123456>
  const native = await run(0x20b, [7, 10, 20, 100, 30, 300, 0x123456]);
  const recs = native.scene.slotFills.get(7);
  assert.ok(recs && recs.length === 1, '应记录一条填充（共享模型：报告与 Pixi 同源）');
  const r = recs![0]!;
  assert.deepEqual(
    { x: r.x, y: r.y, w: r.w, h: r.h, alpha: r.alpha, argb: `0x${(r.argb >>> 0).toString(16)}` },
    { x: 10, y: 20, w: 100, h: 30, alpha: 255, argb: '0xff123456' },
    'op4/op5 必须是宽/高（不是右下角）；颜色 A 固定 FF；α 夹 255',
  );
});

test('0x20B：α 不越界时原样传递；同槽多次填充累加记录（引擎是往同一表面反复涂）', async () => {
  const native = await run(0x20b, [3, 0, 0, 8, 9, 128, 0x00ff00]);
  native.fillSlotRect(3, 1, 1, 2, 2, 0xff000000, 64); // 再叠一次（走宿主缝）
  const recs = native.scene.slotFills.get(3)!;
  assert.equal(recs.length, 2);
  assert.equal(recs[0]!.alpha, 128, 'α = op6 原样（≤255）');
  assert.equal(recs[0]!.argb >>> 0, 0xff00ff00, '绿色：0xFFRRGGBB');
  assert.equal(recs[1]!.alpha, 64);
});

test('0x20B：槽没有 create-texture 表面时 Pixi 侧忽略（引擎打 FillTexture 错误串）；headless 仍记录', async () => {
  // headless 侧：无画布概念，记录即可（与 drawString 同口径）
  const native = await run(0x20b, [0x2e, 1, 2, 3, 4, 255, 0xffffff]);
  assert.ok(native.scene.slotFills.has(0x2e), 'headless 记录该槽的填充');
  // 共享模型层：create-texture 会清掉该槽的记录（新表面）
  const { scCreateTextureReset } = await import('../src/renderer/scene/ops.js');
  scCreateTextureReset(native.scene, 0x2e);
  assert.equal(native.scene.slotFills.has(0x2e), false, '重建表面 ⇒ 该槽的填充记录随之清空（同 slotText）');
});
