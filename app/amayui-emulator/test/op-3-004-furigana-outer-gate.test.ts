/**
 * 审计 `op-3-004`：`0x196 display-furigana` 的**外层门**（raw 29071）。
 *
 * 引擎 `sub_41FC20`（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）：
 * ```c
 * 29055  v2 = sub_41B640((_DWORD *)_this, 3);   // op3 → 拷进栈缓冲 v20（a4）
 * …
 * 29071  v7 = (*(_BYTE *)(_this + 489988) & 1) == 0;   // ★外层门：489988/4 = 下标 122497
 * 29073  if ( v7 ) {                                   //   文本块位**未置** ⇒ 第①②路
 * 29075      if ( !*(_DWORD *)(_this + 86672) || (*(_DWORD *)(_this + 699204) & 0x8000000) != 0 ) {
 * 29081          return sub_46CBF0(...);               //     MessageSpeed=0 或 ADV=1 ⇒ 同步排空
 * 29083      } else {
 * 29088          result = sub_46BE30(...);
 * 29089          if ( result ) {
 * 29093              *(_DWORD *)(_this + 699204) |= 0x20000000u;   //     节流计时器
 * 29095              return sub_453A60((_DWORD *)(_this + 430572), v12);
 * 29099  } else {                                     //   文本块位**已置**（`0x304`…`0x305` 之间）⇒ 第③路
 * 29104      result = sub_46BE30(...);
 * 29105      if ( result ) {
 * 29108          *(_DWORD *)(_this + 489988) |= 0x10000u;          //     bit16
 * 29109          *(_DWORD *)(_this + 489484) = result;             //     = msgwin.lastArg
 * ```
 * `0x304`（`sub_41A420` raw 25392 `_this[122497] = 1`）置的就是这个 bit0。
 *
 * ★**已登记的缺口**（不静默跳过，见 `handlers/msgwin.ts` 该 handler 的注释）：第①②路的
 * `effect_flags |= 0x20000000` + `sub_453A60(Engine+430572, MessageSpeed)` 节流半边**未建模**
 * （下面第 3 条测试就是这条缺口的棘轮：将来补上它会变红，那时把断言改成正向即可）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLEEP_GATE } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, mkEngine, str } from './harness.js';

test('op-3-004：`0x304` 置位后 `0x196` 走引擎第③路（raw 29099-29109）', async () => {
  const e = mkEngine([instr(0x304, []), instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 40); // MessageSpeed ≠ 0（第③路不看它）
  await stepOnce(e); // 0x304 → `Engine[122497] = 1`
  assert.equal(e.msgwin.flags & 1, 1, '0x304 置 bit0（raw 25392）');
  await stepOnce(e); // 0x196
  assert.equal(e.msgwin.flags & 0x10000, 0x10000, '★第③路 raw 29108：`_this[489988] |= 0x10000`');
  assert.equal(e.waitFlags & SLEEP_GATE, 0, '第③路不装节流门（raw 29099-29111 里没有 0x20000000）');
  assert.equal(e.msgwin.lastArg, 1, 'raw 29109：`_this[489484] = op1`（= msgwin.lastArg）');
  assert.deepEqual(
    e.msgwin.slot(1).segments.map((s) => [s.text, s.ruby]),
    [['天結', [['天結', 'あまゆ']]]],
    '入队照旧（注音 + 本文词进正文）',
  );
});

test('op-3-004：文本块位未置时 `0x196` **不得**写 bit16（外层门的另一半）', async () => {
  const e = mkEngine([instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  await stepOnce(e);
  assert.equal(e.msgwin.flags & 1, 0, '没有 0x304 ⇒ bit0 = 0（`v7` 为真）');
  assert.equal(e.msgwin.flags & 0x10000, 0, '★bit16 只由第③路写（raw 29108）');
  assert.equal(e.msgwin.lastArg, 1, 'raw 29077/29094：三条出口都写 `_this[489484] = op1`');
});

test('op-3-004 ★缺口棘轮：第①②路的 MessageSpeed 节流半边**尚未建模**（补上后此断言应变红并改成正向）', async () => {
  const e = mkEngine([instr(0x196, [im(1), str('天結'), str('あまゆ')])]);
  e.engineValues.set(ENGINE_FIELD.messageSpeed, 40);
  e.nowMs = 1000;
  await stepOnce(e);
  assert.equal(e.advActive, false, 'ADV 未置 ⇒ 引擎应走 raw 29083 的 else 支');
  assert.equal(e.waitFlags & SLEEP_GATE, 0, '★已知偏差：引擎会在此置 0x20000000 + 起计时器，emulator 尚未建模');
});
