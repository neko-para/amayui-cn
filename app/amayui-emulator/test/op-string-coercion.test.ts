/** @tier T0 @kind core @subsystem text */

/**
 * **「取字符串」原语的数值强制转换**（`tickets/T-0165`；审计 `docs-new/99-records/2026-09-impl-audit/` §4.1 的 P1）。
 *
 * 引擎的取串原语 `sub_41B640`（raw 26248-26359）/ `sub_42A420`（raw 36317-36544）/ `sub_41B9B0`（raw 26365-26470）
 * **三条同构**，都对数值族操作数做转换：
 *   立即 int → `_itoa_s(v, buf, 0x400, 10)`；int 值池/指针 → `_itoa_s(DEC(值), …, 10)`；
 *   float 值池 → `sub_408050(buf, 1024, "%lf", v)`；float 指针族(7/13) → `sub_41B640`/`sub_42A420` 抛
 *   `Command_Type_Exception`（`sub_41B9B0` 支持，见下）。
 *
 * 修前 emulator 的 `readStringOperand` 对数值族一律 `String(a.raw)`（返回**槽号**），于是
 * `0x192 set-string` / `0x193 concat` / `0x1B2 text-append` 在真实语料上产出错串。语料锚点：
 *   - `src/COMMITDR.txt:9`：`concat (local-string 0) @"菲亚的女神等级提升为" (global-int a40e1)`
 *   - `src/FIELD.txt:8595/8710/9416`、`src/ALCHEMY.txt:1063`、`src/REACH.txt:2243/2264`：`(local-ptr N)`
 *   - `src/FIELD.txt:9365`：`(local-int …)`
 *   - `src/SYSTEM4.txt:463-464`：`i1b2 (global-int 0)`
 *
 * ★**2026-09-24 retarget（`tickets/T-0162` 读体复核）**：本文件原来断言的是**半角 ASCII** 十进制
 * （`'42'`/`'3.140000'`）。复核 `sub_41B640`/`sub_42A420` 的**每条数值路径**后发现：
 *   - `sub_41B640` 的 case 0/6/12 与 case 1/4/10 在返回前都 `return (char *)sub_41A6C0(dword_55C8E0)`
 *     （raw **26331** / **26347**）；`sub_42A420` 的 case 0/1/3/4/6/9/10/12 也都在 assign 前过
 *     `sub_41A6C0`（raw **36376** / **36421** / **36509** / **36530**）。
 *   - `sub_41A6C0`（raw 25539-25593）= **ASCII 数字 → 双字节全角**（本机 exe = 中文版 ⇒ GBK `0xA3xx`；
 *     日文版会是 SJIS `0x82xx`）。逐字符：`0-9/A-Z/a-z` → `{0xA3, c+0x80}`、`-`→`0xA3AD`、`+`→`0xA3AB`。
 *   - 旧断言的前提（"`_itoa_s` 的输出就是最终串"）因此**被体证推翻** ⇒ 期望值改成全角口径；
 *     "读的是**值**而不是**槽号**"这条（T-0165 的本体）**原样保留**。
 *   ★分叉：**`0x1B2` 走 `sub_41B9B0`，它不调 `sub_41A6C0`** ⇒ 该条仍是半角（下面的用例即是这个对照）。
 *   逐 case 表见 `src/vm/operand.ts` 的 `readStringOperand` 头注；新增守卫 `test/operand-string-primitive.test.ts`。
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
const gStr = (slot: number): BinArg => ({ type: 0x5, raw: slot }) as unknown as BinArg;
const gInt = (slot: number): BinArg => ({ type: 0x3, raw: slot }) as unknown as BinArg;
const gFloat = (slot: number): BinArg => ({ type: 0x4, raw: slot }) as unknown as BinArg;
const gPtr = (slot: number): BinArg => ({ type: 0x6, raw: slot }) as unknown as BinArg;
const gFptr = (slot: number): BinArg => ({ type: 0x7, raw: slot }) as unknown as BinArg;
const gStrPtr = (slot: number): BinArg => ({ type: 0x8, raw: slot }) as unknown as BinArg;
const lInt = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;

/** 出参串槽固定用全局串 9。 */
const OUT = 9;

function engine(): Engine {
  return new Engine(new StubNative(() => {}));
}
async function runOp(e: Engine, op: number, args: BinArg[]): Promise<void> {
  await OPS.get(op)!(makeCtx(e, e.frames[0]!, instr(op, args), e.native, () => {}));
}

test('★0x192 set-string：int 值池/指针/立即数都按引擎**转十进制**（不再回槽号）', async () => {
  const e = engine();
  // 全局 int 值池（含 DEC）：槽 40 存 enc(key, 42)
  e.globals.int.set(40, enc(e.key, 42));
  await runOp(e, 0x192, [gStr(OUT), gInt(40)]);
  assert.equal(
    e.globals.str.get(OUT),
    '４２',
    '引擎 `_itoa_s(DEC(池值), …, 10)`（raw 36450-36458）→ 再经 `sub_41A6C0`（raw 36421）转全角',
  );

  // 局部 int 值池
  e.frames[0]!.locals.int.set(7, enc(e.key, -7));
  await runOp(e, 0x192, [gStr(OUT), lInt(7)]);
  assert.equal(e.globals.str.get(OUT), '－７', '负数带符号（`_itoa_s` 有符号）+ `-`→`－`（sub_41A6C0 raw 25556-25559）');

  // 立即数
  await runOp(e, 0x192, [gStr(OUT), immInt(12345)]);
  assert.equal(e.globals.str.get(OUT), '１２３４５');

  // int 指针：解引用 + DEC
  e.globals.int.set(50, enc(e.key, 99));
  e.globals.ptr.set(3, { scope: 'global', kind: 'int', index: 50, stride: 4 });
  await runOp(e, 0x192, [gStr(OUT), gPtr(3)]);
  assert.equal(e.globals.str.get(OUT), '９９', '指针族 = `_itoa_s(DEC(*指针), …, 10)`（raw 36470-36475）+ 全角');
});

test('★0x193 concat：数值操作数转串后拼接（复刻 src/COMMITDR.txt:9 的形态）', async () => {
  const e = engine();
  e.globals.str.set(0, '菲亚的女神等级提升为');
  e.globals.int.set(0xa40e, enc(e.key, 3));
  await runOp(e, 0x193, [gStr(OUT), gStr(0), gInt(0xa40e)]);
  assert.equal(
    e.globals.str.get(OUT),
    '菲亚的女神等级提升为３',
    '★修前这里会得到「…提升为26510」（槽号）；全角口径见 operand.ts 的表（sub_42A420 raw 36450-36458 → 36421）',
  );
});

test('★0x1B2 text-append：按值的十进制追加（复刻 src/SYSTEM4.txt:464 的 `(global-int 0)`）——**半角**', async () => {
  const e = engine();
  e.globals.int.set(0, enc(e.key, 0));
  await runOp(e, 0x1b2, [gInt(0)]);
  assert.equal(e.textBuffer, '0');
  // 值 ≠ 槽号 的组合才是有判别力的：槽 200 的值是 0 ⇒ 追加 "0"（修前追加 "200"）
  e.textBuffer = '';
  e.globals.int.set(200, enc(e.key, 0));
  await runOp(e, 0x1b2, [gInt(200)]);
  assert.equal(e.textBuffer, '0', '★值=0、槽=200：修前会追加槽号 "200"');
  // ★与 0x192 的对照（同一条指令族、两条不同原语）：0x1B2 走 sub_41B9B0，**不调** sub_41A6C0
  e.textBuffer = '';
  e.globals.int.set(201, enc(e.key, 42));
  await runOp(e, 0x1b2, [gInt(201)]);
  assert.equal(e.textBuffer, '42', '★半角（sub_41B9B0 raw 26419-26427 不带 sub_41A6C0）—— 与 0x192 的「４２」成对');
});

test('★float 族按 C 的 `%lf`（默认精度 6）+ 全角；float 指针族在 sub_42A420 里照引擎抛错', async () => {
  const e = engine();
  e.globals.float.set(11, 3.14);
  await runOp(e, 0x192, [gStr(OUT), gFloat(11)]);
  assert.equal(
    e.globals.str.get(OUT),
    '３.１４００００',
    '`sub_408050(…, "%lf", v)` 的默认精度 6（raw 36490-36494）→ 数字全角、`.` 留半角',
  );

  await runOp(e, 0x192, [gStr(OUT), immFloat(0x40490fdb)]);
  assert.equal(e.globals.str.get(OUT), '３.１４１５９３', '立即 float 走位模式 → `%lf`（0x40490fdb = 3.1415927f）');

  await assert.rejects(
    () => runOp(e, 0x192, [gStr(OUT), gFptr(1)]),
    /float 指针族/,
    '引擎 `sub_41B640`/`sub_42A420` 对 tag 7/13 走 default ⇒ 抛 Command_Type_Exception（raw 26355-26357 / 36389-36392）',
  );
});

test('0x192 字符串族仍原样取串（没被数值转换改动）', async () => {
  const e = engine();
  e.globals.str.set(21, 'ABC');
  await runOp(e, 0x192, [gStr(OUT), gStr(21)]);
  assert.equal(e.globals.str.get(OUT), 'ABC');
  // 全局串指针（tag 8）：解引用取串
  e.globals.strPtr.set(2, { scope: 'global', kind: 'str', index: 21, stride: 28 });
  await runOp(e, 0x192, [gStr(OUT), gStrPtr(2)]);
  assert.equal(e.globals.str.get(OUT), 'ABC');
});
