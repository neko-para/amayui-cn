/** @tier T1 @kind core @subsystem frame */

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
import fs from 'node:fs';
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
import { runGameStartChain, type GameStartOptions, type GameStartResult } from '../src/tools/gameStartChain.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { BinArg } from '../src/script/bin.js';
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

/**
 * ★**按键 memo**（`tickets/T-0128` 后的成本收敛）：本文件有 3 次 `runGameStartChain` 全链路，其中
 * **两次的 opts 完全相同**（都是 `{}`）⇒ 按 opts 的 JSON 键共享同一次运行结果，省掉一整次启动链。
 * 结果只读（与 `config-chain` / `adv-name-color-chain` 同一约定）；失败时逐出缓存，避免把偶发失败永久缓存。
 */
const chainCache = new Map<string, Promise<GameStartResult>>();
function chainOnce(opt: GameStartOptions = {}): Promise<GameStartResult> {
  const key = JSON.stringify(opt);
  let p = chainCache.get(key);
  if (!p) {
    p = runGameStartChain(opt).catch((e: unknown) => {
      chainCache.delete(key);
      throw e;
    });
    chainCache.set(key, p);
  }
  return p;
}

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

/**
 * ★`0x228`（审计 P0 `op-4-01`；`docs-new/99-records/2026-09-audit/audit-2026-09-opcodes.md`）：
 * 引擎 `sub_430650` → `sub_4AA060`（raw 39973-39988 / 130115 起）：
 * `op1 = 查表失败?1:0`、`op3/4/5 = 元素 +0x16C（平移 work 矩阵）的分解平移分量`。
 * 语料 1097 处且每处紧跟 `eq … 0` + `jcc` 读 op1 ⇒ 未实现时命中即硬停、当桩则分支走错。
 */
test('★0x228：op1=成功标志、op3/4/5=绘制项当前**平移**（`+0x16C`），与 0x21A 的描画位置不是同一个量', () => {
  const native = new HeadlessScene({});
  const { e, run } = mk(native as unknown as StubNative);
  const f = e.curScript();
  const H = 0x18a9c;

  // ① 项不存在 ⇒ op1 = 1（引擎 `sub_4AA060` 查表失败返回 0 ⇒ 调用方写 1），且 **op3/4/5 保持旧值**
  f.locals.float.set(2, 777);
  f.locals.float.set(3, 888);
  f.locals.float.set(4, 999);
  run(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]);
  assert.equal(
    readIntOperand(e, f, instr(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]), 1),
    1,
    '项不存在 ⇒ op1 = 1（失败）',
  );
  assert.deepEqual(
    [3, 4, 5].map((n) => readFloatOperand(e, f, instr(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]), n)),
    [777, 888, 999],
    '★失败分支不写 op3/op4/op5（引擎在同一分支直接 return）',
  );

  // ② 建项（`0x1FB` 的宿主路径）+ 设描画位置：平移矩阵仍是 0 ⇒ op1=0 且三元组全 0
  native.configureDrawItem({ handle: H, layer: 17, tex: 42, srcX: 0, srcY: 0, srcW: 100, srcH: 50, dstX: 300, dstY: 200 });
  native.setDrawPos(H, 44, 55, 66);
  run(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]);
  assert.equal(readIntOperand(e, f, instr(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]), 1), 0, '项存在 ⇒ op1 = 0');
  assert.deepEqual(
    [3, 4, 5].map((n) => readFloatOperand(e, f, instr(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]), n)),
    [0, 0, 0],
    '★与 0x21A 的 (44,55,66) 不同：0x228 读的是平移矩阵（此处还是 0）',
  );

  // ③ `0x1FF` 立即像素平移 → 0x228 读回该三元组
  native.setDrawTranslation(H, 12, 34, 56);
  run(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]);
  assert.deepEqual(
    [3, 4, 5].map((n) => readFloatOperand(e, f, instr(0x228, [lInt(1), im(H), lFloat(2), lFloat(3), lFloat(4)]), n)),
    [12, 34, 56],
    '0x228 = 0x1FF 写的平移 work 矩阵',
  );

  // ④ 反过来：0x1FF 不影响 0x21A（描画位置仍是 0x219 写的值）—— 两个三元组互不串
  run(0x21a, [im(H), lFloat(5), lFloat(6), lFloat(7)]);
  assert.deepEqual(
    [2, 3, 4].map((n) => readFloatOperand(e, f, instr(0x21a, [im(H), lFloat(5), lFloat(6), lFloat(7)]), n)),
    [44, 55, 66],
    '0x21A 读的是 +0x24（描画位置），不受 0x1FF 平移影响',
  );
});

// ---------------------------------------------------------------------------
// E3：真实语料走完整条链路
// ---------------------------------------------------------------------------

test('E3：启动 → Game Start → ゲーム開始 → SN0000 首文案（SN0000.txt:1224）', async () => {
  const r = await chainOnce({});
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
  // ★B2（`tickets/T-0002`）：这条链路的目标是"**第一条** show-text"，而 run 现在会**恰好停在它那一刻**
  //   （`stopAfterStep` 逐条判；修前只在帧边界判 ⇒ 会越过目标最多一整批，于是顺手执行完了一整页）。
  //   所以这里不再断言"整页 3 行"——那其实是**停止点伪影**，不是目标判据；"首个文案是三行一页"
  //   是**脚本结构**的事实，登记在脚本台账 `docs-new/05-scripts/SN0000.md`（`i304/i305` 文本块 + 3×show-text）。
  assert.ok(r.pageText.split('\n').length >= 1, `首句那一刻至少有 1 行文本；实际 ${JSON.stringify(r.pageText)}`);
  assert.ok(r.scene.drawable > 0, `场景应有可绘制项，实际 ${r.scene.drawable}/${r.scene.drawItems}`);
  // ④ 路径上**零**未实现 opcode（throw 策略 ⇒ 有缺口会直接抛）
  assert.deepEqual(r.unknown, [], '这条路径上不应有未实现 opcode');
  // ⑤ ★默认（不传外置选项）= 真游戏行为：cold boot **会**经过 LOGO/版权页。
  //    `boot.showLogo=false`（`emulator.config.json`）才能跳过它 —— 见 test/emulator-options.test.ts。
  //    这条断言顺手锁住"外置选项不得悄悄改变默认行为"。
  assert.equal(
    r.scriptTrail.some((s) => s.startsWith('LOGO')),
    true,
    `默认应播 LOGO（版权页），实际轨迹 ${r.scriptTrail.slice(0, 8).join(',')}`,
  );
  // ⑥ ★B3（`tickets/T-0003` 验收 3 / `T-0007`）：headless 的等待门走**真泵** ⇒ 悬停真的会跑。
  //   修前 headless 走 `forceAdvance` 旁路（不做命中测试、不看 `routes.shown`）⇒ 游标恒 −1、悬停从不发生。
  assert.equal(r.advancePolicy, 'pump', '默认（真游戏行为）应走真泵');
  assert.ok(
    r.dispatches.some((d) => d.kind === 'hover-enter'),
    `SN0000 右侧面板的悬停进入应被派发；实际派发序列 ${JSON.stringify(r.dispatches.slice(0, 6))}`,
  );
  assert.ok(
    r.dispatches.every((d) => d.kind !== 'headless'),
    '真泵模式下不应出现 `headless`（`forceAdvance` 旁路）的派发记录',
  );
  assert.ok(
    r.cursorTrail.some((c) => c.cursor >= 0),
    `routes.cursor 应真的被命中过（修前恒 −1）；实际轨迹 ${JSON.stringify(r.cursorTrail.slice(0, 8))}`,
  );
  assert.ok(
    r.cursorTrail.some((c) => c.shown !== 0),
    'routes.shown 应出现过"面板已显示"（悬停才有对象可命中）',
  );
  // 悬停的**两段式**（进入 labelA / 离开 labelB、一帧只给一个）由 `test/route-dispatch.test.ts` 判据①③
  // 用合成表钉死；这里只证明"headless 真的走到了那条代码路径"（上面四条）。
  // ⑦ ★`tickets/T-0016`（用户实测：ADV 页右侧悬停 ⇒ 中间的 ADV 文字不断被重放、页不推进）：
  //   悬停 label 的 `ret` 回到门指令重跑 `0x72`（引擎 `sub_405360(-3)`），而引擎的 `0x72` 只重装 ▼ 与
  //   等待门（raw 28539-28555）、**不碰文字游标** ⇒ 整条真实链路上"文字重放"必须为 0。
  //   判据在 `runGameStartChain` 的 `revealRestarts`（内容版本不变而显现游标变小 = 重放）。
  assert.equal(
    r.revealRestarts,
    0,
    `悬停/重跑门指令不得把整页文字重放；实际重放 ${r.revealRestarts} 次（派发序列 ${JSON.stringify(r.dispatches.slice(0, 6))}）`,
  );
});

/**
 * **判据⑦（`tickets/T-0003` 验收 3 的 before/after）**：同一链路把等待门换回修前的 `'force'` 旁路 ⇒
 * 悬停整条通路消失（游标恒 −1、零 `hover-enter`）。这就是"headless 与 Electron 表现分叉"的实证。
 */
test('E3 判据⑦：`advance: "force"`（修前旁路）⇒ 悬停不发生（对照 pump）', async () => {
  const r = await chainOnce({ unknownPolicy: 'stub', advance: 'force' });
  assert.equal(r.advancePolicy, 'force');
  assert.equal(
    r.dispatches.some((d) => d.kind === 'hover-enter' || d.kind === 'hover-leave'),
    false,
    '旁路不做命中测试 ⇒ 不应有悬停派发',
  );
  assert.deepEqual(
    r.cursorTrail.map((c) => c.cursor),
    [-1],
    '`routes.cursor` 恒 −1（修前的 headless 就是这个状态）',
  );
  assert.equal(r.firstTextReached, true, '旁路仍能推进脚本（这正是它当年被引入的原因）');
});

/**
 * **判据⑥（规格 `.tmp/mouse-dispatch-spec.md` §F.4-6）**：点「ゲーム開始」之后，**下一条 SE 必须由
 * `GAMESTART` 发出**（而不是被 SN0000 的通用 ADV 框架抢先）。
 *
 * 依据：`0xB4 play-sound-effect` 的 op1 是**统一文件 id**（`SYS4INI` 下标）；
 * `GAMESTART.txt:1307` 附近的那条 = **0x51e3**（id 20963 = **SE009.WAV**，2026-09 订正：旧注释误写 SE004，
 * 实测 `0x51e3`→`SE009.WAV`，而 SE004 是 `0x2e` = id 46），而 SN0000 的通用 ADV 框架用的是
 * `SE002`（id **0x32**，`SN0000.txt:526/571`）。用户报的症状「点击进游戏时响的是错误音效」正**不是**
 * 「鼠标沿被 SN0000 的 ADV 泵抢先消费」（2026-09 已推翻，见 `.tmp/se-51e3-analysis.md`：意图一直是对的，
 * 错的是 emulator 起播时复用了通道 1 上的旧 clip）—— 这条断言锁的是**意图**这一半。
 * 起播侧的锁在 `test/audio-engine.test.ts` 的「同一通道换装不同 id」。
 */
test('E3 判据⑥：点「ゲーム開始」后下一条 SE 由 GAMESTART 发（id 0x51e3），且早于任何 SN0000 的 SE', async () => {
  const r = await chainOnce({});
  const i = r.sePlays.findIndex((s) => s.id === 0x51e3);
  assert.ok(i >= 0, `应发出 id 0x51e3 的 SE；实际 ${JSON.stringify(r.sePlays.map((s) => `0x${s.id.toString(16)}@${s.script}`))}`);
  assert.equal(r.sePlays[i]!.script, 'GAMESTART.BIN', '这条 SE 必须由 GAMESTART 发出');
  // 在它之前不得有任何 SN0000 发起的 SE（= 鼠标沿没被 SN0000 的通用 ADV 框架抢先消费）
  const before = r.sePlays.slice(0, i);
  assert.equal(
    before.some((s) => s.script.startsWith('SN0000')),
    false,
    `0x51e3 之前不得有 SN0000 的 SE；实际 ${JSON.stringify(before.map((s) => `0x${s.id.toString(16)}@${s.script}`))}`,
  );
  // SN0000 的通用 ADV SE 是 0x32（SE002，`SN0000.txt:526/571`）—— 更直白地排除"SN0000 抢先发声"
  assert.equal(
    before.some((s) => s.script.startsWith('SN0000') && s.id === 0x32),
    false,
    '0x51e3 之前不得出现 SN0000 的 SE002（0x32）',
  );
});

/**
 * ★**`T-0102` 判据 5 的可达性棘轮**：序章（`SN0000`）里**不可能**出现"有发言人"的 ADV 行。
 *
 * 为什么要把这条写成测试：判据 5（"角色名是青还是橘"）的判决量是 `bgrToRgb(adcd[14acda])`，
 * 而 `14acda` 的派生输入是**消息号 `3f37`** —— 旁白恒 `-1`（走 `14acda = 0` 那一支，没有辨别力）。
 * 本轮实测（`tickets/T-0102/evidence/adv-speaker-line-probe.md`）在真语料链路上把 ADV 跑到了序章，
 * `3f37` 全程 `-1`，**0 条**"有发言人"的样本 ⇒ 取样点必须先证明存在。
 *
 * 本棘轮锁的是**脚本数据侧**的事实（便宜、不需要跑链路）：
 *   ① `SN0000.txt` **没有** `mov (global-int 3f37)`（设置点），只有 `sub`（递减）+ 读点；
 *   ② 全库的设置点分布在 `SC*`/`SG*`/`SP*`/`NOVEL`/`HMODE`/`GAMECLEAR`/`DEBUGADV` 等**对话/剧情**脚本里。
 * ⇒ 下一轮要找"有角色名的那一行"，只能去这些脚本的**对话段**（如 `SC0000.txt:1688` 起），
 *   而不是想办法把序章多推几页。
 */
test('★T-0102 判据 5：序章（SN0000）没有「有发言人」的行 —— `3f37` 的设置点只在对话脚本里', () => {
  const srcDir = path.join(ROOT, 'src');
  const read = (f: string): string => fs.readFileSync(path.join(srcDir, f), 'utf8');
  const count = (text: string, needle: string): number => text.split(needle).length - 1;

  // ① 序章：0 个设置点，≥1 个递减点（递减也是写，但它不产生"有发言人"的语义）
  const sn = read('SN0000.txt');
  assert.equal(count(sn, 'mov (global-int 3f37)'), 0, 'SN0000 不该有 `3f37` 的设置点（序章全是旁白）');
  assert.ok(count(sn, 'sub (global-int 3f37) 0 1') >= 1, 'SN0000 应有 `3f37` 的递减点（实测 3 处）');

  // ② 设置点必须存在，且落在对话/剧情脚本里（不是序章）
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.txt'));
  const setters = files.filter((f) => count(read(f), 'mov (global-int 3f37)') > 0);
  assert.ok(setters.length >= 10, `应有多个脚本设 3f37；实际 ${setters.length} 个`);
  assert.ok(
    setters.some((f) => /SC\d{4}/.test(f)),
    `SC#### 系脚本里必须有设置点；实际 ${setters.slice(0, 8).join(', ')}`,
  );
  assert.equal(setters.includes('SN0000.txt'), false, 'SN0000 不得出现在设置点列表里');
});
