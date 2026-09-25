/** @tier T0 @kind ratchet @subsystem ops */

/**
 * **T-0163 的 AGERC 族判据**（`0x14b` / `0x14c` / `0x14d`；审计 §4.1 的 P2×2 + P3×6）。
 *
 * 本文件把审计的 `suggestedGuard` 逐条变成可失败的断言。八条的处置分三类：
 *
 *  - **已修/已对**（复核后确认与体一致）：
 *    ① `0x14b` P2 `missing-behavior`：引擎"先 `FreeLibrary` + 句柄槽清 0，再把 `LoadLibraryA`
 *       的结果（含失败 NULL）写回"（raw **31068-31076**）等价物 = emulator 的 `if (e.agerc.loaded)`
 *       先清 `loaded`/`exports` 再抛 ⇒ 重载失败后**旧库不可再用**（下面第 1 条用例）。
 *    ③ `0x14c` P3 `missing-branch`（校验次序）：引擎先 `GetProcAddress`（raw **31106**）**再**判
 *       `slot > 0x63`（raw **31117**）；emulator 的"先查名、再查槽"在该组合下抛的是同一条
 *       「アドレス取得に失敗しました」⇒ **审计原文"抛的是槽号非法"读错了当前代码**（下面第 3 条用例）。
 *  - **本轮修**：
 *    ② `0x14c` P2/P3 `missing-operand-io`：越界分支的 `%s` 实参 = **op3**（`sub_41B640(_this, 3)`，
 *       raw 31120）⇒ emulator 在"有第 3 格"时改用 op3（下面第 4 条用例）。
 *    ④ `0x14c` P3 `missing-behavior`：模块未加载时引擎走的是 raw **31111** 的
 *       「`%sのアドレス取得に失敗しました．\r\n\r\nERRORCODE = %d`」（`GetProcAddress(NULL, op2)`
 *       失败）⇒ emulator 的报错改用引擎同文（下面第 2 条用例）。
 *  - **如实登记（有意保留 + 扩展点 + 重新评估条件）**：
 *    ⑤ `0x14b` P3 `approximation`：错误串缺"FileDB 解析出的文件名"与 `ERRORCODE = %d` 实参 ——
 *       emulator 运行期没有**同步**的 id→名字表（`FileSource` 是异步接口，handler 不能同步查名）
 *       ⇒ 以 id 代替 `%s`，不伪造 ERRORCODE（源文注释里记引擎原文与 raw 31079-31082）。重新评估条件
 *       = 给 `Engine` 加一个同步 id→名字解析器（`sub_454FA0` 的等价物）。
 *    ⑥ `0x14d` P2 `approximation`：引擎对槽表函数指针**零校验**（`(*v14)(...)`，raw 39839/39843）⇒
 *       槽未绑定/op1 越界就是跳 NULL 崩溃；emulator 换成明确抛错（比崩溃安全，属有意换法）。
 *    ⑦ `0x14d` P3 `unclear` / ⑧ `0x14d` P3 `approximation`：`len <= 0` 时引擎把 **NULL** 交给导出
 *       （raw 39828 `v3 = 0` + `if (v2 > 0)` 才 `new[]`），而 `_SetNameLenMax@20` 是 `dword_100A9000
 *       = *a2` **无条件解引用** ⇒ 真机 UB/崩溃；emulator 取 `buf[0] ?? 0` ⇒ `nameLenMax = 0`
 *       （下面第 5 条用例），且 `op3` 所指内存一格不动（引擎 raw 39844 的 `if (v2>0)` 回写门）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { AGERC_FILE_ID } from '../src/vm/handlers/agerc.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { dec, enc } from '../src/vm/bits.js';
import type { BinArg } from '../src/script/bin.js';
import type { NativeBridge } from '../src/vm/native.js';
import { im, instr, loc, mkEngine, str } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const AGERC = path.join(ROOT, 'app/amayui-emulator/src/vm/handlers/agerc.ts');

/**
 * 测试夹具：**引擎与帧走 `harness.mkEngine`**（T-0020 的收敛要求），本函数只补"直接派发到 handler"
 * 这一层 —— 本文件的判据是**抛错文案 / 抛错次序 / 分支相关读**，必须能构造**半成形指令**
 * （例如只有 2 格的 `i14c`、或三格的 `i14c`），而走帧驱动的 `stepOnce` 无法产生这些形状。
 */
function rig(native: NativeBridge = new StubNative(() => {})) {
  const e = mkEngine([], 'TEST.BIN', native);
  const f = e.curScript();
  const run = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应已实现`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  return { e, f, run };
}

const export1 = (): BinArg => str('_SetNameLenMax@20');

test('★① 0x14B 重载失败：旧库已卸（loaded=false + exports 清空），随后 0x14C 报地址取得失败', () => {
  const { e, run } = rig();
  run(0x14b, [im(AGERC_FILE_ID)]);
  run(0x14c, [im(1), export1()]);
  assert.equal(e.agerc.exports.size, 1);
  assert.throws(() => run(0x14b, [im(0x1234)]), /読み込み出来ません/);
  assert.equal(e.agerc.loaded, false, '引擎 raw 31068-31076：FreeLibrary + 句柄槽清 0；第二次加载失败 ⇒ 空句柄');
  assert.equal(e.agerc.exports.size, 0, '槽表随句柄作废（0x14C 不得再绑到旧导出）');
  assert.throws(() => run(0x14c, [im(1), export1()]), /アドレス取得に失敗しました/);
});

test('★② 0x14C 模块未加载：报错用引擎同文「アドレス取得に失敗しました．」（raw 31111）', () => {
  const { run } = rig();
  assert.throws(
    () => run(0x14c, [im(0), export1()]),
    /アドレス取得に失敗しました．/,
    '引擎：GetProcAddress(NULL, op2) 失败 ⇒ 地址取得失败串（不是 emulator 自造文案）',
  );
});

test('★③ 0x14C 校验次序 = 引擎：先取地址（31106）再判槽 > 0x63（31117）', () => {
  const { e, run } = rig();
  run(0x14b, [im(AGERC_FILE_ID)]);
  assert.throws(
    () => run(0x14c, [im(100), str('NotAnExport')]),
    /アドレス取得に失敗しました/,
    '未知导出名 + 越界槽 ⇒ 引擎先撞地址失败（raw 31106 早于 31117）',
  );
  assert.throws(() => run(0x14c, [im(100), export1()]), /0から99まで/);
  assert.equal(e.agerc.exports.size, 0, '越界路径不得写入槽表');
});

test('★④ 0x14C 越界分支的 %s 实参 = op3（raw 31120 的 sub_41B640(_this, 3)）', () => {
  const { run } = rig();
  run(0x14b, [im(AGERC_FILE_ID)]);
  assert.throws(
    () => run(0x14c, [im(100), export1(), str('CALLSITE_3')]),
    /CALLSITE_3/,
    '越界分支的 %s 必须取 op3（引擎 sub_41B640(_this, 3)），而不是导出名',
  );
  assert.throws(
    () => run(0x14c, [im(100), export1()]),
    /_SetNameLenMax@20/,
    '缺第三格时回退到导出名（引擎此处读栈上残留；语料那条 2 格调用不走这个分支）',
  );
});

test('★⑤ 0x14D：槽未绑定 / op1 越界 ⇒ 明确抛错（引擎会跳 NULL），槽表不做越界读', () => {
  const { e, run } = rig();
  run(0x14b, [im(AGERC_FILE_ID)]);
  assert.throws(() => run(0x14d, [im(100), loc(0), loc(1), im(1), loc(1), im(0)]), /未绑定导出/);
  assert.throws(() => run(0x14d, [im(1), loc(0), loc(1), im(1), loc(1), im(0)]), /未绑定导出/);
  assert.equal(e.agerc.exports.size, 0);
});

test('★⑥ 0x14D len<=0：nameLenMax=0、op2 写 0、op3 所指内存不被动（引擎 RAW 39828/39844）', () => {
  const { e, f, run } = rig();
  run(0x14b, [im(AGERC_FILE_ID)]);
  run(0x14c, [im(1), export1()]);
  f.locals.int.set(0x21bc, enc(e.key, 12));
  f.locals.int.set(0x0c, enc(e.key, -1));
  run(0x14d, [im(1), loc(0x0c), loc(0x21bc), im(0), loc(0x21bc), im(0)]);
  assert.equal(e.agerc.nameLenMax, 0, '引擎把 NULL 交给 _SetNameLenMax ⇒ 真机 UB；emulator 取 0（已登记的差异）');
  assert.equal(dec(e.key, f.locals.int.get(0x21bc) ?? 0), 12, 'len<=0 ⇒ 不回写 op3（raw 39844 的 if (v2>0) 门）');
  assert.equal(dec(e.key, f.locals.int.get(0x0c) ?? 0), 0, 'op2 ← 返回值 0');
});

test('★源文棘轮：引擎原文 / raw 锚点 / 三处「有意保留」的理由必须写在 agerc.ts 里', () => {
  const src = fs.readFileSync(AGERC, 'utf8');
  for (const s of [
    '按引擎顺序先读满操作数', // T-0082 evidence[54] 的锚点：不许删
    'ERRORCODE = %d', // 引擎 raw 31082 / 31111 / 31128 的格式串
    'GetLastError',
    '31120', // 越界分支取 op3
    '39839', // 0x14D 直接 (*v14)(…) 零校验
    '跳到空函数指针',
    'NULL', // len<=0 传 NULL
    'agerc-internals', // NULL 解引用的依据出处
  ]) {
    assert.ok(src.includes(s), `agerc.ts 必须出现 ${s}`);
  }
});
