/** @tier T0 @kind core @subsystem text */

/**
 * **`0x2C7` / `0x2C8` 的引擎硬失败上限与错误路径守卫**（`tickets/T-0151`）。
 *
 * 审计（`docs-new/99-records/2026-09-impl-audit/raw/findings-final.json`）给了三条 `src/text/sjis.ts`
 * 的 missing-branch。三条的**权威 = 引擎函数体**（本文件所有行号都是 `engine/天结_unpacked.exe_utf8.c`
 * 的 raw 行号，逐条自己读过）：
 *
 * | # | 现象 | 引擎体 | 处置 |
 * |---|---|---|---|
 * | ① | `0x2C7` 起点为负且长度为正 | `sub_433FD0`（raw 42260-42376）的空串判据只写 `v3 >= v13 \|\| v4 <= 0`（raw 42299，`v3`/`v13` 都是 signed），`v3 < 0 && v4 > 0` 落到 else 支 ⇒ raw 42360 `sub_429F60(v19, v16, v15, v14)` ⇒ raw 36151 `sub_40C120(a2, _this, a3, a4)`（`a3` 形参是 **`unsigned int`**）⇒ raw 16220-16222 `v6 = (unsigned)a2[4]; if (v6 < a3) std___Xout_of_range(...)`：负起点变成巨大无符号数 ⇒ **必然抛 `std::out_of_range`** | 修：抛 `SjisSubstrOutOfRangeError` |
 * | ② | `0x2C8` op2 的 256 字节栈缓冲 | `sub_434260`（raw 42379-42457）raw 42401 `strcpy_s(Destination, 0x100u, v3)`：源串含结尾 0 超过 0x100 ⇒ **运行时约束违例**（invalid parameter handler，MSVC 默认终止），**不是**静默截成 255 字节 | 修：抛 `SjisSubstrSourceTooLongError` |
 * | ③ | `0x2C8` 的缓冲下界外读 | raw 42420 逐字节循环第一步 `_mbbtype(*(v2 - 1), 0)`；`v2` 初值就是 `Destination`（raw 42399）⇒ 读的是**栈上未初始化字节** | 登记为**不复制**（见 `SJIS_SUBSTR_CHARS_NOT_COPIED`）：未定义值没有可照抄的确定行为 |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SJIS_SUBSTR_CHARS_NOT_COPIED,
  SjisSubstrOutOfRangeError,
  SjisSubstrSourceTooLongError,
  sjisSubstr,
  sjisSubstrChars,
} from '../src/text/sjis.js';
import { sjisByteLength } from '../src/text/layout.js';

// ---------------------------------------------------------------------------
// ① `0x2C7`：负起点 ⇒ 引擎硬失败（不是静默空串）
// ---------------------------------------------------------------------------
test('★0x2C7 负起点：`start < 0 && len > 0` 必须走引擎的 std::out_of_range 路径（修前静默返回空串）', () => {
  // raw 42299 的判据只挡 `start >= strlen` 与 `len <= 0`；起点为负会一路走到 raw 42360 → 36151 → 16221。
  assert.throws(() => sjisSubstr('あいう', -1, 2), SjisSubstrOutOfRangeError, '起点 −1、长度 2 ⇒ 抛');
  assert.throws(() => sjisSubstr('あいう', -1, 1), SjisSubstrOutOfRangeError, '长度 1 同样抛');
  assert.throws(() => sjisSubstr('abcdef', -3, 4), SjisSubstrOutOfRangeError, 'ASCII 串同样抛');
  assert.throws(() => sjisSubstr('', -1, 2), SjisSubstrOutOfRangeError, '空串 + 负起点：`v3 >= v13`(0) 为假 ⇒ 仍抛');
  // 错误串里要能看见引擎锚点（照着 raw 报，别只说"参数非法"）
  const e = (() => {
    try {
      sjisSubstr('あいう', -1, 2);
      return null;
    } catch (err) {
      return err as Error;
    }
  })();
  assert.ok(e instanceof SjisSubstrOutOfRangeError);
  assert.equal(e.name, 'SjisSubstrOutOfRangeError');
  assert.match(e.message, /0x2c7/, '错误信息要点名 opcode');
  assert.match(e.message, /raw 16221/, '错误信息要带引擎锚点（sub_40C120 的 throw 点）');
});

test('★0x2C7 负起点：`len <= 0` 仍走空串（引擎的 `v4 <= 0` 判据在负起点之前，不许把两者合并成抛）', () => {
  // 引擎 raw 42299 是 `v3 >= v13 || v4 <= 0` —— 短路求值下 `v4 <= 0` 对负起点同样成立 ⇒ 写空串、不抛。
  assert.deepEqual(sjisSubstr('abcdef', -1, 0), { text: '' });
  assert.deepEqual(sjisSubstr('abcdef', -2, -5), { text: '' });
  // 其余既有判据一个都不许变
  assert.deepEqual(sjisSubstr('abcdef', 6, 2), { text: '' }, '`start >= strlen` ⇒ 空串');
  assert.deepEqual(sjisSubstr('abcdef', 0, 0), { text: '' });
  assert.equal(sjisSubstr('あいう', 0, 2).text, 'あ');
});

// ---------------------------------------------------------------------------
// ② `0x2C8`：256 字节栈缓冲上限（strcpy_s 约束违例 ⇒ 硬失败）
// ---------------------------------------------------------------------------
test('★0x2C8 缓冲上限：op2 的**字节长 > 255** 必须硬失败（引擎 strcpy_s(Destination, 0x100, op2) 的约束违例）', () => {
  // 255 字节 + 结尾 0 = 0x100 ⇒ 恰好放得下；256 字节含结尾 0 = 0x101 ⇒ 违例。
  const ok255 = 'a'.repeat(255);
  assert.equal(sjisByteLength(ok255), 255);
  assert.equal(sjisSubstrChars(ok255, 0, 3), 'aaa', '255 字节仍在缓冲内 ⇒ 正常执行');

  const bad256 = 'a'.repeat(256);
  assert.throws(() => sjisSubstrChars(bad256, 0, 1), SjisSubstrSourceTooLongError, '256 字节 ⇒ 抛');
  // ★门是**源串**的字节长，与 op3/op4 无关：`strcpy_s` 在 raw 42401，读 op3/op4 在 42405-42406 之后。
  assert.throws(() => sjisSubstrChars(bad256, 999, 999), SjisSubstrSourceTooLongError, '请求长度为 0/越界也照样抛');
  assert.throws(() => sjisSubstrChars(bad256, 0, 0), SjisSubstrSourceTooLongError);
  // 全角按 2 字节算：127 字 = 254 字节 OK、128 字 = 256 字节 抛。
  assert.equal(sjisByteLength('あ'.repeat(127)), 254);
  assert.equal(sjisSubstrChars('あ'.repeat(127), 0, 2), 'ああ');
  assert.throws(() => sjisSubstrChars('あ'.repeat(128), 0, 2), SjisSubstrSourceTooLongError);
  // 半角片假名按 1 字节算（引擎 strlen 口径）
  assert.equal(sjisByteLength('ｱ'.repeat(255)), 255);
  assert.throws(() => sjisSubstrChars('ｱ'.repeat(256), 0, 1), SjisSubstrSourceTooLongError);

  const e = (() => {
    try {
      sjisSubstrChars(bad256, 0, 1);
      return null;
    } catch (err) {
      return err as Error;
    }
  })();
  assert.ok(e instanceof SjisSubstrSourceTooLongError);
  assert.equal(e.name, 'SjisSubstrSourceTooLongError');
  assert.match(e.message, /0x2c8/, '错误信息要点名 opcode');
  assert.match(e.message, /raw 42401/, '错误信息要带 strcpy_s 的 raw 锚点');
  // ★与 ① 是**两个**错误类：别把两种硬失败混成一个（一个是 std::out_of_range、一个是 strcpy_s 违例）
  assert.notEqual(SjisSubstrOutOfRangeError, SjisSubstrSourceTooLongError);
});

// ---------------------------------------------------------------------------
// ③ `0x2C8`：缓冲下界外的那一读 —— 有据的**不复制**
// ---------------------------------------------------------------------------
test('★0x2C8 下界外读：登记为不复制（未定义栈字节），但建模的那条子句不许被顺手删掉', () => {
  // 登记表必须点名 raw 42420 与"`Destination[-1]` 是未初始化栈字节"这一理由（无确定行为可照抄）。
  assert.equal(SJIS_SUBSTR_CHARS_NOT_COPIED.length, 1, '0x2C8 只有这一条不复制项');
  const g = SJIS_SUBSTR_CHARS_NOT_COPIED[0]!;
  assert.equal(g.raw, '42420', '锚点 = 逐字节循环第一步的那次 _mbbtype');
  assert.match(g.what, /v2 - 1|v2-1/, '要说清读的是哪个下标');
  assert.match(g.what, /Destination\[-1\]|栈上未初始化|未初始化/);
  assert.match(g.why, /未定义/, '理由：值未定义 ⇒ 没有可照抄的确定行为');
  assert.ok(g.recheck.length > 0, '缺口的重新评估条件非空（不许用"不复制"掩盖）');

  // 建模的是**第一子句**（`_mbbtype(*v2, 0) == 1 && _mbbtype(v2[1], 1) == 2`）：双字节字整体作为一个字符。
  assert.equal(sjisSubstrChars('あいう', 0, 3), 'あいう');
  assert.equal(sjisSubstrChars('あいう', 1, 1), 'い');
  assert.equal(sjisSubstrChars('あいう', 1, 2), 'いう');
  // 后果：首字符**永不**被判成"双字节字的后半字节"而整块丢掉（引擎只在那个未定义字节恰为前导字节时才会）。
  assert.equal(sjisSubstrChars('あい', 0, 1), 'あ', '首字符是独立的全角字，不许被吞');
  assert.equal(sjisSubstrChars('Aい', 0, 1), 'A', '半角同理');
});
