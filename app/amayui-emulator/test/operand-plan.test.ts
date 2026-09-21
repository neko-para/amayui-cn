/**
 * **操作数计划层守卫**（`tickets/T-0082` RF-A 的第三步）—— 把 `src/vm/operandPlan.ts` 的**声明**
 * 与三处真源焊在一起，任何一处漂移即红：
 *
 *  ① **计划 argc ⟷ 文档 argc**（`scripts/asm/opcodes.json`，= `opcode-table.md` 的 argc 列）；
 *  ② **模型操作数记数槽 ⟷ 反编译体里的 N**：`operandCountSlotValue(op, argc)` 必须逐条等于
 *     `engine/天结_unpacked.exe_utf8.c` 里 handler 体写的 `_this[30*cur+95805] = N`
 *     （反之亦然：体里写 0 的**只能**是 `ZERO_LENGTH_OPS` 那三条）；
 *  ③ **计划方向/类型 ⟷ handler 实际碰的位**：对每个有计划、也已迁到计划层的 handler，
 *     用满 argc 的合成指令跑一遍 ⇒ handler 碰过的位必须**恰好覆盖**计划声明为 `r`/`rw` 的位，
 *     且不得越界（越界/漏读的机械判据在 `test/opcode-operands.test.ts`，这里补的是"计划说了什么、实现做了什么"）。
 *
 * 另外两条：计划表的**自洽**（kinds/io 长度、evidence 非空、无重复声明 —— `declarePlan` 会抛）
 * 与**运行期**（派发器写完 `frame.operandCount` 后，`StepTrace.operandCount` 报出来的值与模型一致；
 * `exit` 那类控制流为 0）。
 *
 * ★命名：§「arity 槽」是 `tickets/T-0082` 与审计的**口语名**；数据层（`analysis/fields.json`）里它的正式名是
 * `ScriptContext/0x74 operand_count`（引擎里叫 `arity` 的是 `+0x60`，装载时清零、没有读者）⇒ 代码与
 * trace 字段一律叫 `operandCount`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { ZERO_LENGTH_OPS, operandCountSlotValue, operandsFor, planOf, plannedOps } from '../src/vm/operandPlan.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr } from './harness.js';
import { ROOT, scanArity } from './arityScan.js';

/** 迁到计划层的 handler：op → 「为什么它算已迁移」（留着当迁移台账，别删）。 */
const MIGRATED: Record<string, string> = {
  '0x347': 'live2d 节点缩放：int key + 三分量 float（审计 op-9-op840）',
  '0x348': 'live2d 节点旋转（轴角）：int key + 4 float（审计 op-9-op840-348-is-rotation-not-scale）',
  '0x349': 'live2d 节点平移：int key + 三分量 float',
  '0x34a': 'live2d 基础偏移：int key + 三分量 float',
  '0x34b': 'live2d 缩放窗：int key/delay/dur + 三分量 float ÷100（审计 op-6-01）',
  '0x34c': 'live2d 旋转窗：int key/delay/dur + 轴 float + 角 float',
  '0x34d': 'live2d 平移窗：int key/delay/dur + 三分量 float',
  '0x32': '槽→槽缩放转送：10 个 int（存档缩略图的缩屏步）',
  '0x1f9': 'set-texture：图像 id / 槽 / 颜色（审计 P2 的"丢掉第 3 操作数"）',
  '0x20f': 'play-movie：影片 id / 槽 / 音量模式（审计 P3）',
  '0x202': 'set-draw-color：图元 / delay / dur / α / 颜色',
  '0x203': 'set-draw-color-alpha：handle / blend / α / 颜色（审计 op-4-06）',
  '0x82': 'GDI 带色重画某窗的文本记录：窗 / 起始记录下标 / 模式 / 填充色 / 描边色（T-0104）',
};

const OPCODES: { opcode: number; argc: number }[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/asm/opcodes.json'), 'utf8'),
);
const ARGC_OF = new Map(OPCODES.map((o) => [o.opcode, o.argc]));

test('★计划表自洽：每个计划的 argc ⟷ 文档 argc；kinds/io 长度相等；evidence 非空', () => {
  const ops = plannedOps();
  assert.ok(ops.length >= 12, `迁移进度异常：只声明了 ${ops.length} 条计划`);
  const bad: string[] = [];
  for (const op of ops) {
    const plan = planOf(op)!;
    const key = `0x${op.toString(16)}`;
    const doc = ARGC_OF.get(op);
    if (doc === undefined) bad.push(`${key} 不在 opcodes.json 里`);
    else if (doc !== plan.argc) bad.push(`${key} 计划 argc=${plan.argc} 与文档 argc=${doc} 不符`);
    if (plan.kinds.length !== plan.argc) bad.push(`${key} kinds=${plan.kinds.length} ≠ argc=${plan.argc}`);
    if (plan.io && plan.io.length !== plan.argc) bad.push(`${key} io=${plan.io.length} ≠ argc=${plan.argc}`);
    if (!plan.evidence.trim()) bad.push(`${key} 缺 evidence`);
    if (plan.kinds.some((k) => !['int', 'float', 'str', 'ptr', 'any'].includes(k)))
      bad.push(`${key} kinds 里有未知类型：${plan.kinds.join(',')}`);
  }
  assert.deepEqual(bad, [], `计划表与文档不一致（改计划前先核体）：\n  ${bad.join('\n  ')}`);
});

test('★操作数记数槽模型 ⟷ 反编译体：`operandCountSlotValue(op, argc)` 逐条等于体里写的 N（含"谁写 0"）', () => {
  const { rows } = scanArity();
  const mismatch: string[] = [];
  const zeroByEngine = new Set<number>();
  for (const r of rows) {
    if (r.step === 0) zeroByEngine.add(r.op);
    const model = operandCountSlotValue(r.op, r.argc);
    if (model !== r.step) {
      mismatch.push(`0x${r.op.toString(16)}(${r.handler}) 体写 ${r.step}，模型给 ${model}（argc=${r.argc}）`);
    }
  }
  assert.deepEqual(mismatch, [], `操作数记数槽模型与引擎体不一致：\n  ${mismatch.join('\n  ')}`);
  assert.deepEqual(
    [...zeroByEngine].sort((a, b) => a - b),
    [...ZERO_LENGTH_OPS].sort((a, b) => a - b),
    '★"体里写 0（自己定 ip）"的指令集合必须与模型 `ZERO_LENGTH_OPS` 完全一致（多一条少一条都红）',
  );
  // 计划里的每一条也要能被模型覆盖（防止声明了却不参与核验）
  for (const op of plannedOps()) {
    const plan = planOf(op)!;
    assert.equal(operandCountSlotValue(op, plan.argc), ZERO_LENGTH_OPS.has(op) ? 0 : 2 * plan.argc + 1, `0x${op.toString(16)}`);
  }
});

test('★计划 ⟷ 实现：已迁移的 handler 碰过的位必须覆盖计划声明为 r/rw 的位，且不越界', () => {
  const bad: string[] = [];
  for (const [key, why] of Object.entries(MIGRATED)) {
    const op = Number(key);
    const plan = planOf(op);
    if (!plan) {
      bad.push(`${key} 在 MIGRATED 里但没有计划（${why}）`);
      continue;
    }
    if (!OPS.has(op) && !NATIVE_OPS.has(op) && !ENGINE_INTERNAL_OPS.has(op)) {
      bad.push(`${key} 未注册 handler`);
      continue;
    }
    const e = new Engine(new StubNative(() => {}), new InputManager());
    const f = e.curScript();
    const realArgs: BinArg[] = [];
    // 满 argc 的**本地 int 槽**实参：每一种类型的读法都能落地（float 读 int 槽 = int→float 转换）
    for (let i = 0; i < plan.argc; i++) realArgs.push({ type: 0x9, raw: 0x40 + i } as unknown as BinArg);
    // ★用 Proxy 观测 handler **真的碰了**哪几格（与 `test/opcode-operands.test.ts` 同一手法）——
    //   不能拿 `operandsFor()` 自己返回的 view 的 `touched`：那是**守卫这边**新建的视图，
    //   handler 内部还会再建一个（两者不是同一个 Set），观测不到它的行为。
    const touched = new Set<number>();
    const args = new Proxy(realArgs, {
      get(t, p, r) {
        if (typeof p === 'string' && /^\d+$/.test(p)) touched.add(Number(p) + 1); // 1-based
        return Reflect.get(t, p, r);
      },
    });
    const one: BinInstruction = {
      opcode: op,
      name: `i${op.toString(16)}`,
      argc: plan.argc,
      args,
      byteOffset: 0,
      index: 0,
    } as unknown as BinInstruction;
    const sc = {
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
      instructions: [one],
      labelTargets: new Set<number>(),
      raw: new Uint8Array(0),
    } as unknown as ScriptBinary;
    (f as unknown as { script: ScriptBinary }).script = sc;
    assert.ok(operandsFor({ e, frame: f, instr: one }), `${key} 有计划但 operandsFor 没认出来`);
    const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
    const ret = h!(makeCtx(e, f, one, new StubNative(() => {}), () => {})) as unknown as Promise<unknown> | undefined;
    if (ret && typeof (ret as { then?: unknown }).then === 'function') void ret.catch(() => {});
    const hit = [...touched].sort((a, b) => a - b);
    const want = plan.kinds.map((_k, i) => i + 1).filter((n) => (plan.io?.[n - 1] ?? 'r') !== 'w');
    const missing = want.filter((n) => !hit.includes(n));
    const beyond = hit.filter((n) => n < 1 || n > plan.argc);
    if (missing.length) bad.push(`${key} 计划声明要读的位 ${missing.join(',')} 没被碰（${why}）`);
    if (beyond.length) bad.push(`${key} 碰了越界位 ${beyond.join(',')}`);
  }
  assert.deepEqual(bad, [], `计划与实现不一致：\n  ${bad.join('\n  ')}`);
});

test('★运行期：派发器把模型值写进 `frame.operandCount`，`StepTrace.operandCount` 报出来（控制流三条为 0）', async () => {
  const native = new StubNative(() => {});
  const e = new Engine(native, new InputManager());
  const script: ScriptBinary = {
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
    instructions: [
      instr(0x32, [im(2), im(0xe), im(0), im(0), im(0x500), im(0x2d0), im(0), im(0), im(0x140), im(0xb4)]),
      instr(0x2, []), // exit：操作数记数槽写 0（自己定 ip）
    ],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), script, 'FAKE.BIN');

  const t1 = await stepOnce(e);
  assert.equal(t1.operandCount, 2 * 10 + 1, '0x32（argc 10）⇒ 操作数记数槽 = 21');
  assert.equal(e.curScript().operandCount, t1.operandCount, '帧字段与 trace 同源');
  assert.equal(t1.operandCount, operandCountSlotValue(0x32, 10));

  // `0x2` exit：**操作数记数槽为 0**（引擎派发器因此不前进，由 handler 自己定 ip）。handler 会抛"script exit"
  // ⇒ 断言那一步之前写进帧里的值（派发器在 handler 之前写该槽，这正是引擎的次序）。
  await assert.rejects(() => stepOnce(e), /script exit/);
  assert.equal(e.curScript().operandCount, 0, '★0x2 exit 的操作数记数槽为 0');
  assert.equal(ZERO_LENGTH_OPS.has(0x2), true);
});
