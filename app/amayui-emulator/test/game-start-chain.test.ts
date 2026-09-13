/**
 * **「启动 → TITLE 右上角 Game Start → 配置界面 ゲーム開始 → SN0000 首文案」链路**（2026-09）。
 *
 * 用户下的题目：跑通这条路径、**采集所有缺失指令**、逐条评估**能否安全跳过**、以"进入
 * `SN0000.txt:1224` 的第一个文案"为成功判据。
 *
 * ## 采集结果（`npm run op:inventory -- --path start`，`unknownPolicy: 'stub'` 一次跑干净）
 * 这条路径上命中但未实现的 opcode 共 **25 条**。逐条读 handler 体（raw 行号见各处注释）后分两类：
 *
 * | 类别 | 条数 | opcode | 判据 |
 * |---|---|---|---|
 * | **必须实现**（handler 会**回写脚本操作数**） | 9 | `0x195` `0x19A` `0x1B6` `0x1C7` `0x1CC` `0x215` `0x216` `0x218` `0x21A` | 跳过 ⇒ op1/op2..4 保留旧值，而脚本紧接着用它做条件跳转/算术 ⇒ **静默的逻辑错误** |
 * | **可以安全跳过**（只碰 emulator 无消费者的引擎字段 / 渲染 / 3D 子系统） | 16 | `0x93` `0x94` `0x97` `0xD9` `0x1AD` `0x1B1` `0x1BC` `0x20E` `0x224` `0x229` `0x238` `0x242` `0x256` `0x258` `0x32A` `0x32D` | handler 体**既不回写操作数、也不改 ip/cur**；其中 `0x1B1`/`0x238` 写的字段**全工程无读者**（死写） |
 *
 * 第二类已连同依据登记进 `ENGINE_INTERNAL_OPS`（跳过后 0 个未知指令）。
 *
 * ## 本文件的守卫
 *  - **E2**：9 条真实现的语义（含 `0x1B6↔0x1B7` 往返、`0x215/0x218/0x21A` 与场景模型往返）；
 *  - **E2（棘轮）**：16 条 engine-internal **确实不写操作数**（机械判据，防止"悄悄改成半实现"）；
 *  - **E3**：真语料跑完整条链路 ⇒ 到达 `SN0000` 且**执行到第一条 `show-text`（ip = 901）**、
 *    页面文本含该串、路径上**零未实现 opcode**、`GAMESTART` 确实返回"开始游戏"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/stubNative.js';
import { readIntOperand, readFloatOperand } from '../src/vm/operand.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { dec, enc } from '../src/vm/bits.js';
import { runGameStartChain } from '../src/tools/gameStartChain.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, str } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
void ROOT;

const gInt = (n: number): BinArg => ({ type: 3, raw: n }) as unknown as BinArg;
const lInt = (n: number): BinArg => ({ type: 9, raw: n }) as unknown as BinArg;
const lFloat = (n: number): BinArg => ({ type: 0xa, raw: n }) as unknown as BinArg;
const imStr = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;
const gStr = (n: number): BinArg => ({ type: 5, raw: n }) as unknown as BinArg;
/** 局部字符串（type 0xb）—— `0x195` 的两个待比较串。 */
const lStr = (n: number): BinArg => ({ type: 0xb, raw: n }) as unknown as BinArg;
const instr = (op: number, args: BinArg[]): BinInstruction =>
  ({ opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

function mk(native: NativeBridge = new StubNative(() => {})): {
  e: Engine;
  run: (op: number, args: BinArg[]) => void;
} {
  const e = new Engine(native, new InputManager());
  const f = e.curScript();
  return {
    e,
    run: (op, args) => {
      const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应已注册`);
      h!(makeCtx(e, f, instr(op, args), native, () => {}));
    },
  };
}

/** 本链路采集到的 25 条。 */
const IMPLEMENTED_9 = [0x195, 0x19a, 0x1b6, 0x1c7, 0x1cc, 0x215, 0x216, 0x218, 0x21a] as const;
/**
 * A4（图元/网格/纹理/渲染状态）9 条：2026-09 转真实现（`handlers/gfx-state.ts`）。
 * 它们**不回写操作数**（从 VM 视角不可观测），所以不在 IMPLEMENTED_9 里；但也**不再是"无依据的 no-op"**。
 */
const A4_IMPLEMENTED = [0x20e, 0x224, 0x229, 0x238, 0x242, 0x256, 0x258, 0x32a, 0x32d] as const;
/** A5（单行字段 / 计时 / 音频设备）7 条：2026-09 也转真实现（`handlers/panel.ts` / `engine-fields.ts` / `audio.ts`）。 */
const A5_IMPLEMENTED = [0x93, 0x94, 0x97, 0xd9, 0x1ad, 0x1b1, 0x1bc] as const;

// ---------------------------------------------------------------------------
// 注册表棘轮
// ---------------------------------------------------------------------------

test('注册表棘轮：本链路采集到的 25 条**全部**已转真实现（OPS）', () => {
  for (const op of IMPLEMENTED_9) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须已实现（它会回写脚本操作数）`);
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应是 no-op`);
  }
  for (const op of A4_IMPLEMENTED) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须已实现（A4：见 handlers/gfx-state.ts）`);
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应再是 no-op`);
  }
  for (const op of A5_IMPLEMENTED) {
    // `0x93`/`0x94`/`0x97`/`0xD9`/`0xAD`/`0x1AD`/`0x1B1` 在 OPS；
    // `0x1BC`/`0x1C9` 在 NATIVE_OPS（音频子系统：`AUDIO_OPS` 经 NativeBridge 落宿主）
    assert.ok(OPS.has(op) || NATIVE_OPS.has(op), `0x${op.toString(16)} 必须已实现（A5）`);
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应再是 no-op`);
  }
  // ★2026-09 收口：这条链路上采集到的 16 条"按依据跳过"的**全部**已实现 ⇒ 本链路不再有任何 no-op。
  const ALL_25 = [...IMPLEMENTED_9, ...A4_IMPLEMENTED, ...A5_IMPLEMENTED];
  assert.equal(ALL_25.length, 25);
  for (const op of ALL_25) {
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应留在 ENGINE_INTERNAL_OPS`);
  }
});

test('棘轮：A5 的 7 条也不写脚本操作数（引擎里它们只改引擎状态/渲染态）', () => {
  // 机械判据：把 op1/op2 指向两个全局 int，跑完 handler 后两者必须都没变。
  // （这正是"能否安全跳过"的定义 —— 一旦有人把它们改成半实现并开始回写，本测试会红，
  //   提示应当把它们搬进 OPS 并补断言。）——A4 那 9 条就是这么搬走的（2026-09）。
  const { e, run } = mk();
  const before = { a: 0x1234, b: 0x5678 };
  e.globals.int.set(0x300, enc(e.key, before.a));
  e.globals.int.set(0x301, enc(e.key, before.b));
  for (const op of A5_IMPLEMENTED) {
    run(op, [gInt(0x300), gInt(0x301), gInt(0x302), gInt(0x303), gInt(0x304)]);
    assert.equal(dec(e.key, e.globals.int.get(0x300) ?? 0), before.a, `0x${op.toString(16)} 不应写 op1`);
    assert.equal(dec(e.key, e.globals.int.get(0x301) ?? 0), before.b, `0x${op.toString(16)} 不应写 op2`);
  }
});
// ---------------------------------------------------------------------------
// E2：9 条真实现的语义
// ---------------------------------------------------------------------------

test('0x195 string-ne：op1 = (op2 != op3)（0x194 的取反兄弟）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  const read = (): number => readIntOperand(e, f, instr(0x195, [lInt(1), lStr(0), lStr(1)]), 1);
  f.locals.str.set(0, 'アムリタ');
  f.locals.str.set(1, 'アムリタ');
  run(0x195, [lInt(1), lStr(0), lStr(1)]);
  assert.equal(read(), 0, '相同 ⇒ 0');
  f.locals.str.set(1, '');
  run(0x195, [lInt(1), lStr(0), lStr(1)]);
  assert.equal(read(), 1, '不同（含与空串比较）⇒ 1');
  f.locals.str.set(0, '');
  f.locals.str.set(1, '');
  run(0x195, [lInt(1), lStr(0), lStr(1)]);
  assert.equal(read(), 0, '空串 == 空串 ⇒ 0（SETFATE 的 1000 次循环正是靠这一条跳过空名条目）');
  // 与 0x194 互补：同一对串，两条指令的结果必须相反
  const eq = (a: string, b: string): [number, number] => {
    f.locals.str.set(0, a);
    f.locals.str.set(1, b);
    run(0x194, [lInt(1), lStr(0), lStr(1)]);
    const e1 = readIntOperand(e, f, instr(0x194, [lInt(1), lStr(0), lStr(1)]), 1);
    run(0x195, [lInt(1), lStr(0), lStr(1)]);
    return [e1, read()];
  };
  assert.deepEqual(eq('x', 'x'), [1, 0]);
  assert.deepEqual(eq('x', 'y'), [0, 1]);
  // 立即串（`i195 <out> <str> ""` 的常见形态）
  f.locals.str.set(0, 'ab');
  run(0x195, [lInt(1), lStr(0), imStr('ab')]);
  assert.equal(read(), 0);
  run(0x195, [lInt(1), lStr(0), imStr('')]);
  assert.equal(read(), 1, '非空串 vs 空串 ⇒ 1');
  f.locals.str.set(0, '');
  run(0x195, [lInt(1), lStr(0), imStr('')]);
  assert.equal(read(), 0, '空串 vs 空串 ⇒ 0（SETFATE 靠它跳过空名条目）');
  e.globals.str.set(0, 'アムリタ');
  run(0x195, [lInt(1), gStr(0), imStr('')]);
  assert.equal(read(), 1, '全局串非空 vs 空立即串 ⇒ 1');
  e.globals.str.set(0, '');
  run(0x195, [lInt(1), gStr(0), imStr('')]);
  assert.equal(read(), 0);
});

test('0x19A：op1 = Engine[97050]（跳读/自动模式镜像，0x88 写入）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  run(0x19a, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x19a, [lInt(1)]), 1), 0, '初值 0');
  e.msgwin.skipMode = 3;
  run(0x19a, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x19a, [lInt(1)]), 1), 3, '直读字段（不做布尔化）');
});

test('0x1B6 ↔ 0x1B7：共存消息状态（Engine[97052]）往返', () => {
  const { e, run } = mk();
  const f = e.curScript();
  run(0x1b6, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1b6, [lInt(1)]), 1), 0);
  run(0x1b7, [im(7)]);
  assert.equal(e.advFields.get(97052), 1, '非 0 一律归一为 1');
  run(0x1b6, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1b6, [lInt(1)]), 1), 1);
  run(0x1b7, [im(0)]);
  run(0x1b6, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1b6, [lInt(1)]), 1), 0);
});

test('0x1C7：op1 = (effect_flags & 0x8000000) != 0（ADV 激活）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  run(0x1c7, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1c7, [lInt(1)]), 1), 0);
  e.effectFlags |= 0x8000000;
  run(0x1c7, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1c7, [lInt(1)]), 1), 1);
  e.effectFlags |= 0x200; // 别的位不该影响
  e.effectFlags &= ~0x8000000;
  run(0x1c7, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1c7, [lInt(1)]), 1), 0);
});

test('0x1CC：op1 = Engine[122455]（本页文本显示中）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  e.msgwin.showing = 0;
  run(0x1cc, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1cc, [lInt(1)]), 1), 0);
  e.msgwin.showing = 1;
  run(0x1cc, [lInt(1)]);
  assert.equal(readIntOperand(e, f, instr(0x1cc, [lInt(1)]), 1), 1, '直读（不布尔化以外的加工）');
});

test('0x216：op1 = 纹理槽绑定的 imgid（= Scene[5*slot+466]，由 0x1F9 建立）', () => {
  const { e, run } = mk();
  const f = e.curScript();
  run(0x216, [lInt(1), im(0x2e)]);
  assert.equal(readIntOperand(e, f, instr(0x216, [lInt(1), im(0x2e)]), 1), 0, '未绑定的槽 ⇒ 0');
  e.texSlots.set(0x2e, 0x18a9c);
  run(0x216, [lInt(1), im(0x2e)]);
  assert.equal(readIntOperand(e, f, instr(0x216, [lInt(1), im(0x2e)]), 1), 0x18a9c);
});

test('0x215/0x218/0x21A：绘制项 → 纹理槽号 / pivot / 描画位置（与场景模型往返）', () => {
  const native = new HeadlessScene({});
  const { e, run } = mk(native as unknown as StubNative);
  const f = e.curScript();
  const H = 0x18a9c;

  // 项不存在：0x215 ⇒ −1（引擎 `sub_4ADC20`）；0x218/0x21A ⇒ 全 0（引擎 `sub_4ADCF0`/`4ADC80`）
  run(0x215, [lInt(1), im(H)]);
  assert.equal(readIntOperand(e, f, instr(0x215, [lInt(1), im(H)]), 1), -1);
  run(0x218, [im(H), lFloat(2), lFloat(3), lFloat(4)]);
  assert.deepEqual([2, 3, 4].map((n) => readFloatOperand(e, f, instr(0x218, [im(H), lFloat(2), lFloat(3), lFloat(4)]), n)), [0, 0, 0]);
  run(0x21a, [im(H), lFloat(2), lFloat(3), lFloat(4)]);
  assert.deepEqual([2, 3, 4].map((n) => readFloatOperand(e, f, instr(0x21a, [im(H), lFloat(2), lFloat(3), lFloat(4)]), n)), [0, 0, 0]);

  // 建项（`0x1FB` draw-texture 的宿主路径 = `configureDrawItem`）→ 读回
  native.configureDrawItem({ handle: H, layer: 17, tex: 42, srcX: 0, srcY: 0, srcW: 100, srcH: 50, dstX: 300, dstY: 200 });
  run(0x215, [lInt(1), im(H)]);
  assert.equal(readIntOperand(e, f, instr(0x215, [lInt(1), im(H)]), 1), 42, 'op1 = DrawItem+4 = 纹理槽号');
  native.setDrawPivot(H, 11, 22, 33);
  native.setDrawPos(H, 44, 55, 66);
  run(0x218, [im(H), lFloat(2), lFloat(3), lFloat(4)]);
  assert.deepEqual(
    [2, 3, 4].map((n) => readFloatOperand(e, f, instr(0x218, [im(H), lFloat(2), lFloat(3), lFloat(4)]), n)),
    [11, 22, 33],
    '0x218 = pivot（0x217 写的三元组）',
  );
  run(0x21a, [im(H), lFloat(2), lFloat(3), lFloat(4)]);
  assert.deepEqual(
    [2, 3, 4].map((n) => readFloatOperand(e, f, instr(0x21a, [im(H), lFloat(2), lFloat(3), lFloat(4)]), n)),
    [44, 55, 66],
    '0x21A = 描画位置（0x219 写的三元组）—— 与 pivot 是两个不同的三元组',
  );
});

// ---------------------------------------------------------------------------
// E3：真实语料走完整条链路
// ---------------------------------------------------------------------------

test('E3：启动 → Game Start → ゲーム開始 → SN0000 首文案（SN0000.txt:1224）', async () => {
  const r = await runGameStartChain({});
  // ① TITLE 菜单第 0 项 = 右上角 Game Start
  assert.equal(r.titleHover, 0, 'TITLE 悬停点应命中第 0 项（Game Start）');
  assert.ok(r.reachedGameStart, `应进入 GAMESTART，实际轨迹尾部 ${r.scriptTrail.slice(-6).join(',')}`);
  // ② GAMESTART 第 0 项 = ゲーム開始（不是右键取消）
  assert.equal(r.gameStartHover, 0, 'GAMESTART 悬停点应命中第 0 项（ゲーム開始）');
  assert.equal(r.gameStartResult, 1, 'GAMESTART 退出时应写 global 0 = 1（已选择开始游戏）');
  assert.ok(r.reachedInitGame, '「ゲーム開始」分支会 call-script INITGAME（GAMESTART.txt:1338）');
  // ③ 进入 SN0000 并执行到「第一条 show-text」= SN0000.txt:1225（BIN ip 901）
  assert.ok(r.reachedSn0000, '应进入 SN0000');
  assert.ok(r.firstTextReached, 'SN0000 的第一条 show-text 应被执行');
  assert.equal(r.firstTextIp, 901, 'SN0000 第一条 show-text 的指令下标（与 SN0000.txt:1225 对应）');
  assert.ok(r.firstText.length > 0);
  assert.ok(r.pageText.includes(r.firstText), `整页文本应包含首句；实际 ${JSON.stringify(r.pageText)}`);
  assert.ok(r.pageText.split('\n').length >= 3, '首个文案是三行一页（show-text ×3 + end-text-line）');
  assert.ok(r.scene.drawable > 0, `场景应有可绘制项，实际 ${r.scene.drawable}/${r.scene.drawItems}`);
  // ④ 路径上**零**未实现 opcode（throw 策略 ⇒ 有缺口会直接抛）
  assert.deepEqual(r.unknown, [], '这条路径上不应有未实现 opcode');
});
