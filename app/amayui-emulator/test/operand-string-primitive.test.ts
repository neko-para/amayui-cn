/** @tier T0 @kind core @subsystem text */

/**
 * **「取字符串操作数」原语的 tag → 语义对照表**（`tickets/T-0162`；审计 `p23-worklist2.md` 的 T-0162 6 行）。
 *
 * 引擎有**三条**取串原语，`tag` 值相同但返回形态不同，且**用哪一条由 opcode 决定**：
 *  - `sub_41B640`（raw 26249-26360）：23 条指令用（`0x2C5`/`0x2C6`/`0x2C7`/`0x2EC`/`0x6E`/`0x204` …）；
 *  - `sub_42A420`（raw 36318-36544）：`0x192`/`0x193`/`0x194`/`0x195`/`0x1A9`/`0x2C2`；
 *  - `sub_41B9B0`（raw 26366-26548）：**只有 `0x1B2`**。
 *
 * 差异只有两处，本文件逐条钉住：
 *  ① **全角化**：`sub_41B640`/`sub_42A420` 的每条数值路径返回前都过 `sub_41A6C0`（raw 26331/26347、
 *     36376/36421/36509/36530）= ASCII → 全角（本机 exe 是中文版 ⇒ GBK `0xA3xx`）；
 *     `sub_41B9B0`（`0x1B2`）**不调**它 ⇒ `0x192` 得 `４２`、`0x1B2` 得 `42`。
 *  ② **float 指针族 tag 7/13**：前两条**没有** case ⇒ `default:` 抛 `Command_Type_Exception`；
 *     `sub_41B9B0` **有** case 7/13 ⇒ `%lf`。
 *
 * 另钉住：tag 2（内嵌字面量，**倒置存储**）与 tag 0xB（局部串变量）是**两套池**；数组族
 * `0x8003`/`0x8009` 取首元素且"数组不存在"的哨兵串两族不同（`０` vs `0`）；`0x8005`/`0x800B` 结构上
 * 不可复现 ⇒ 显式抛（不再是静默的槽号）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { enc } from '../src/vm/bits.js';
import type { BinArg } from '../src/script/bin.js';
import { instr } from './harness.js';

/** 操作数构造（类型 tag 见 `src/vm/operand.ts` 的 TYPE_* 常量）。 */
const immInt = (v: number): BinArg => ({ type: 0x0, raw: v }) as unknown as BinArg;
const immFloat = (bits: number): BinArg => ({ type: 0x1, raw: bits }) as unknown as BinArg;
const lit = (s: string, raw = 0): BinArg => ({ type: 0x2, raw, str: s }) as unknown as BinArg;
const litUndecoded = (raw: number): BinArg => ({ type: 0x2, raw }) as unknown as BinArg;
const gInt = (slot: number): BinArg => ({ type: 0x3, raw: slot }) as unknown as BinArg;
const gFloat = (slot: number): BinArg => ({ type: 0x4, raw: slot }) as unknown as BinArg;
const gStr = (slot: number): BinArg => ({ type: 0x5, raw: slot }) as unknown as BinArg;
const gFptr = (slot: number): BinArg => ({ type: 0x7, raw: slot }) as unknown as BinArg;
const lStr = (slot: number): BinArg => ({ type: 0xb, raw: slot }) as unknown as BinArg;
const gIntArr = (slot: number): BinArg => ({ type: 0x8003, raw: slot }) as unknown as BinArg;
const lIntArr = (slot: number): BinArg => ({ type: 0x8009, raw: slot }) as unknown as BinArg;
const gStrArr = (slot: number): BinArg => ({ type: 0x8005, raw: slot }) as unknown as BinArg;
const lStrArr = (slot: number): BinArg => ({ type: 0x800b, raw: slot }) as unknown as BinArg;
const gFloatArr = (slot: number): BinArg => ({ type: 0x8004, raw: slot }) as unknown as BinArg;
const badTag = (t: number, slot: number): BinArg => ({ type: t, raw: slot }) as unknown as BinArg;

/** 出参串槽固定用全局串 9。 */
const OUT = 9;

function engine(): Engine {
  return new Engine(new StubNative(() => {}));
}
async function runOp(e: Engine, op: number, args: BinArg[]): Promise<void> {
  await OPS.get(op)!(makeCtx(e, e.frames[0]!, instr(op, args), e.native, () => {}));
}

test('★原语分叉：0x192（sub_42A420）把 int 转成**全角**；0x1B2（sub_41B9B0）是**半角**', async () => {
  const e = engine();
  e.globals.int.set(40, enc(e.key, 42));
  await runOp(e, 0x192, [gStr(OUT), gInt(40)]);
  assert.equal(
    e.globals.str.get(OUT),
    '４２',
    '引擎 sub_42A420 的数值路径返回前过 sub_41A6C0（raw 36421）⇒ 全角（本机 exe = 中文版 ⇒ GBK 0xA3xx）',
  );

  e.globals.int.set(40, enc(e.key, 42));
  await runOp(e, 0x1b2, [gInt(40)]);
  assert.equal(
    e.textBuffer,
    '42',
    '引擎 0x1B2 走 sub_41B9B0，raw 26419-26427 **不调** sub_41A6C0 ⇒ 半角（与 0x192 分叉）',
  );
});

test('★全角化的字符表：数字/字母 + `-`→`－`；`. ` 留半角（已登记近似）', async () => {
  const e = engine();
  // 立即 int 负数 ⇒ `_itoa_s` 出 `-7`（raw 26400-26402 → sub_41A6C0）
  await runOp(e, 0x192, [gStr(OUT), immInt(-7)]);
  assert.equal(e.globals.str.get(OUT), '－７', '`-` 在 sub_41A6C0 里落 0xA3AD（raw 25556-25559）');

  // float 值池 ⇒ `%lf` 默认精度 6 ⇒ `3.500000`，再全角化
  e.globals.float.set(11, 3.5);
  await runOp(e, 0x192, [gStr(OUT), gFloat(11)]);
  assert.equal(
    e.globals.str.get(OUT),
    '３.５０００００',
    '数字全角、`.` 留半角（引擎对 `.` 落 0x81 0x48 —— GBK 域外的怪码位，见 operand.ts 的 toFullWidthNumber）',
  );

  // 立即 float 位模式 0x40490fdb = 3.1415927f
  await runOp(e, 0x192, [gStr(OUT), immFloat(0x40490fdb)]);
  assert.equal(e.globals.str.get(OUT), '３.１４１５９３');
});

test('★tag 2（内嵌字面量）取解析期解出的字面量；**未解码即抛**（它不是任何池的下标）', async () => {
  const e = engine();
  await runOp(e, 0x192, [gStr(OUT), lit('ABC')]);
  assert.equal(e.globals.str.get(OUT), 'ABC', '引擎从操作数流里的**倒置存储**逐 dword 取反解出（raw 26276-26287）');

  await assert.rejects(
    () => runOp(e, 0x192, [gStr(OUT), litUndecoded(5)]),
    /内嵌字面量/,
    '★修前这里静默落到「局部串**变量**池的槽 5」⇒ 两个不同的池被混成一个',
  );
});

test('★tag 2 与 tag 0xB 是**两套池**：0xB 读帧内串变量，绝不读字面量', async () => {
  const e = engine();
  e.frames[0]!.locals.str.set(3, 'LOC');
  // 故意给 0xB 的操作数也塞一个 `str`（解析器只对 tag 2 填它）——若实现按 `a.str ??` 取，就会错取字面量
  const withStr = { type: 0xb, raw: 3, str: 'LIT' } as unknown as BinArg;
  await runOp(e, 0x192, [gStr(OUT), withStr]);
  assert.equal(e.globals.str.get(OUT), 'LOC', 'tag 0xB = 局部串变量（引擎 `_this[30*cur+95791]` 的 vector<string>）');

  await runOp(e, 0x192, [gStr(OUT), lStr(77)]);
  assert.equal(e.globals.str.get(OUT), '', '未写过的局部串变量读空串');
});

test('★数组族 0x8003/0x8009：取首元素（含 DEC）并全角化；数组不存在 ⇒ 哨兵串', async () => {
  const e = engine();
  e.globals.int.set(100, enc(e.key, 7));
  await runOp(e, 0x192, [gStr(OUT), gIntArr(100)]);
  assert.equal(e.globals.str.get(OUT), '７', 'DEC(首元素) → _itoa_s → sub_41A6C0（raw 36529-36530）');

  // 数组不存在：引擎 sub_42A420 的 0x8003 支走 `else` ⇒ `sub_40C210(a2, asc_5205D4, 2)` = 全角 `０`
  await runOp(e, 0x192, [gStr(OUT), gIntArr(9999)]);
  assert.equal(e.globals.str.get(OUT), '０', 'asc_5205D4（raw 4438）= 全角零；缺失槽读 0 ⇒ 与引擎的空容器哨兵相等');

  // 同一个"空数组"在 0x1B2 那边是**半角** `a0`（raw 4399 = `char a0[2] = "0"`）
  await runOp(e, 0x1b2, [lIntArr(9999)]);
  assert.equal(e.textBuffer, '0', 'sub_41B9B0 的空容器哨兵 = 全局 `a0` = "0"（半角）');
});

test('★0x8005/0x800B（字符串数组）**结构上不可复现** ⇒ 显式抛（不再静默返回槽号）', async () => {
  const e = engine();
  await assert.rejects(
    () => runOp(e, 0x192, [gStr(OUT), gStrArr(1)]),
    /字符串数组/,
    '引擎：串槽里存的是"数组地址的十进制字符串"→ atoi 解回指针 → vector<string>[0]（raw 36858-36888 / 36394-36411）',
  );
  await assert.rejects(() => runOp(e, 0x1b2, [lStrArr(1)]), /字符串数组/);
});

test('★int 数组 tag 在 sub_41B640 里没有 case ⇒ 抛（该族的 23 条指令都走它）', async () => {
  const e = engine();
  // 0x2C5（strlen，sub_41B640）：引擎 switch 只到 0..14，数组 tag 落 default ⇒ Command_Type_Exception
  await assert.rejects(
    () => runOp(e, 0x2c5, [gInt(OUT), gIntArr(100)]),
    /sub_41B640/,
    'sub_41B640 的 switch（raw 26268-26357）没有 0x8003 族 ⇒ default 抛',
  );
});

test('★float 指针族 7/13：0x192 抛（无 case），0x1B2 按 `%lf` 取（有 case）', async () => {
  const e = engine();
  e.globals.float.set(30, 2.5);
  e.globals.floatPtr.set(2, { scope: 'global', kind: 'float', index: 30, stride: 4 });

  await assert.rejects(
    () => runOp(e, 0x192, [gStr(OUT), gFptr(2)]),
    /float 指针族/,
    'sub_42A420 无 case 7/13（raw 36361-36392 的 switch）⇒ default 抛',
  );

  await runOp(e, 0x1b2, [gFptr(2)]);
  assert.equal(e.textBuffer, '2.500000', 'sub_41B9B0 有 case 7（raw 26441-26445）⇒ `%lf(*指针)`，**不**全角化');
});

test('★未建模 tag（float 数组 0x8004 / 任意乱值）⇒ 抛（引擎 default 抛，不再静默给槽号）', async () => {
  const e = engine();
  await assert.rejects(
    () => runOp(e, 0x192, [gStr(OUT), gFloatArr(3)]),
    /无对应 case/,
    'sub_42A420 的 switch 只认 0..14 + 0x8003/0x8005/0x8009/0x800B（raw 36359-36522）',
  );
  await assert.rejects(() => runOp(e, 0x192, [gStr(OUT), badTag(0x0f, 3)]), /无对应 case/);
});
