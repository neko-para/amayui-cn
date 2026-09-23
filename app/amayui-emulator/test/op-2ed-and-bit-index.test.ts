/** @tier T0 @kind core @subsystem config */

/**
 * `T-0098` 守卫：① `0x2ED` 读侧注册（真指令闭环）；② `0x107`/`0x10B`/`0xFE` 的**无符号位号口径**。
 *
 * ## 引擎体（逐行，`engine/天结_unpacked.exe_utf8.c`）
 *
 * ```
 * 0x2ED  sub_431230 raw 40401-40409 : arity 3; v = GetConfig("message:MessageFade") → op1
 * 0x2EE  sub_426650 raw 33590-33603 : _this[80106] = op1; SetConfig("message:MessageFade", op1)
 * 0x107  sub_421E50 raw 30516-30527 : result = (unsigned)op1; if (result <= 0x1F) _this[op1+551] = op2;
 * 0x10B  sub_422070 raw 30603-30613 : result = (unsigned)op1; if (result <= 0x1F) _this[op2+1383] = op1;
 * 0xFE   sub_421CA0 raw 30443-30459 : result = (unsigned)op1;
 *                                     if (result > 0x1F) _CxxThrowException(ShowMessage("SetKeyTotalの引数が不正です．"));
 *                                     _this[517] = result;      // ★抛了就到不了这里 ⇒ 字段不变
 * ```
 *
 * ⇒ 三条口径（本守卫逐条钉）：
 *  1. `0x107`/`0x10B` 是**无符号**比较：`op1 = -1` ⇒ 按 `0xFFFFFFFF > 0x1F` ⇒ **不写表**（引擎不抛、不报错）；
 *     旧实现用有符号 `<= 0x1f` ⇒ 负数**通过**并把值写进 `负数+基址` 那个**别的槽**（静默写错地方）。
 *  2. `0xFE` 同样是**无符号**：`-1` ⇒ 越界 ⇒ 抛 + **字段一格不动**（旧实现"照存"，还会把 `-1` 写进
 *     `Engine[517]` —— 那是 `0x100` 的默认键槽下标，后面会被当数组下标用）。
 *  3. `0xFE` 的越界行为是"停下 + 把引擎的消息原文给玩家" ⇒ emulator 抛 `ShowMessageError`，
 *     走 `session.#onError` 的既有通路（粘文本 + 控制窗横幅 + 停止）；不许静默、不许新造机制。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BinArg } from '../src/script/bin.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { ShowMessageError } from '../src/vm/native.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { decIntSlot } from '../src/vm/ref.js';
import { im, instr, loc, mkEngine } from './harness.js';

/** 局部 int 槽（type 0x9）：测试里最方便的"可写操作数"。 */
const L = loc;

/**
 * 读一个**局部 int 槽**的解码值。
 * ★不能直接 `locals.int.get(n)`：int 槽在池里是 **ENC** 存的（`writeIntOperand` 会 `enc(key,v)`），
 * 直接读拿到的是位模式（实测 40 → 655360）。
 */
const decodeLocal = (e: ReturnType<typeof mkEngine>, n: number): number | undefined =>
  decIntSlot(e.key, e.curScript().locals.int.get(n));

test('★T-0098 ①：`i2ee v` → `i2ed` 读回 v（真指令闭环，不再只靠配置注册表断言）', async () => {
  const e = mkEngine([instr(0x2ee, [im(40)]), instr(0x2ed, [L(5)])], 'FAKE.BIN');
  assert.ok(e.curScript().script, '前提：脚本已装载');

  await stepOnce(e); // 0x2EE：字段 + SetConfig
  assert.equal(e.engineValues.get(ENGINE_FIELD.messageFade), 40, '写侧必须写字段');
  await stepOnce(e); // 0x2ED：读回 op1

  assert.equal(decodeLocal(e, 5), 40, '★读侧必须把 GetConfig 的值写回 op1（40；未见注册时这里会硬停）');
});

test('★T-0098 ②：`0x107` 按 **unsigned** 判位号 —— 负数 / 0x20 都不许写表，0..0x1F 才写', async () => {
  const base = ENGINE_FIELD.keyTableBase;

  // (a) op1 = -1：按无符号是 0xFFFFFFFF > 0x1F ⇒ 不写（旧实现会写到 base-1）
  const neg = mkEngine([instr(0x107, [im(-1), im(0x1234)])], 'FAKE.BIN');
  const before = new Map(neg.engineValues);
  await stepOnce(neg);
  assert.equal(neg.engineValues.get(base - 1), undefined, '★负数不得写 base-1（旧有符号实现的静默写错点）');
  assert.deepEqual([...neg.engineValues], [...before], '负数路径 ⇒ 引擎字段一格不动');

  // (b) op1 = 0x20：越界 ⇒ 不写
  const over = mkEngine([instr(0x107, [im(0x20), im(0x1234)])], 'FAKE.BIN');
  await stepOnce(over);
  assert.equal(over.engineValues.get(base + 0x20), undefined, '0x20 越界 ⇒ 不写');

  // (c) op1 = 5：写
  const ok = mkEngine([instr(0x107, [im(5), im(0x1234)])], 'FAKE.BIN');
  await stepOnce(ok);
  assert.equal(ok.engineValues.get(base + 5), 0x1234, '0..0x1F 正常写');
});

test('★T-0098 ②：`0x10B` 同型 —— 越界的**值**（op1）不写表，键（op2）照用', async () => {
  const base = ENGINE_FIELD.keyTable2Base;

  const neg = mkEngine([instr(0x10b, [im(-1), im(7)])], 'FAKE.BIN');
  await stepOnce(neg);
  assert.equal(neg.engineValues.get(base + 7), undefined, '★值 -1 越界 ⇒ 不写表（引擎 unsigned 口径）');

  const ok = mkEngine([instr(0x10b, [im(3), im(7)])], 'FAKE.BIN');
  await stepOnce(ok);
  assert.equal(ok.engineValues.get(base + 7), 3, '值 3 合法 ⇒ 写 `op2 + 基址`');
});

test('★T-0098 ③：`0xFE` 越界 ⇒ 抛 ShowMessageError（引擎消息原文）+ **字段一格不动**', async () => {
  for (const bad of [-1, 0x20, 0x100]) {
    const e = mkEngine([instr(0xfe, [im(bad)])], 'FAKE.BIN');
    e.engineValues.set(ENGINE_FIELD.setKeyTotal, 7); // 引擎默认 7（Input 构造 raw 92385）
    await assert.rejects(
      () => stepOnce(e),
      (err: unknown) => {
        assert.ok(err instanceof ShowMessageError, `应为 ShowMessageError（实得 ${String(err)}）`);
        assert.match((err as Error).message, /SetKeyTotalの引数が不正です．/, '必须带引擎的消息原文（控制窗横幅直接展示它）');
        assert.match((err as Error).message, /0xfe/, '消息里要能看出是哪条指令');
        return true;
      },
      `op1=${bad} 越界 ⇒ 引擎抛 ShowMessage（unsigned > 0x1F）`,
    );
    assert.equal(e.engineValues.get(ENGINE_FIELD.setKeyTotal), 7, '★抛在写之前 ⇒ 字段保持原值（旧实现会照存）');
  }
});

test('T-0098 ③ 反面：`0xFE` 合法值（0..0x1F）照写字段，不抛', async () => {
  const e = mkEngine([instr(0xfe, [im(12)])], 'FAKE.BIN'); // 语料唯一一处：`src/SYSTEM4.txt:86` 的 `i0fe c`
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.setKeyTotal), 12, '合法值写进 `Engine[517]`');
});

/** 操作数形状自检：本票四条指令的 argc 必须与 `scripts/asm/opcodes.json` 一致。 */
test('T-0098：四条指令的 argc（0x2ED 1 / 0x2EE 1 / 0x107 2 / 0x10B 2 / 0xFE 1）', () => {
  const cases: [number, BinArg[]][] = [
    [0x2ed, [L(5)]],
    [0x2ee, [im(1)]],
    [0x107, [im(1), im(2)]],
    [0x10b, [im(1), im(2)]],
    [0xfe, [im(1)]],
  ];
  for (const [op, args] of cases) assert.equal(instr(op, args).argc, args.length, `0x${op.toString(16)} argc`);
});
