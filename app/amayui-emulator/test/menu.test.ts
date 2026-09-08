/** 菜单派发（0xA1 复位 / 0xA2 登记 / 0xA3 查表跳转）单元测试。
 *  语义依据：engine 0xA1/sub_433A40、0xA2/sub_434F10、0xA3/sub_429830 + helpers sub_415530/sub_434D00/sub_428E00。
 *  key 用菜单项序号字符串("-1"/"0"/...，引擎 sub_41B640 读 string，emulator 取 op1 的 DEC 值字符串化)，value=目标 label(dword index)。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import type { BinInstruction, BinArg } from '../src/script/bin.js';

function instr(opcode: number, args: BinArg[]): BinInstruction {
  return { opcode, name: 'x', argc: args.length, args, byteOffset: 0, index: 0 };
}
/** 立即 int 操作数（TYPE_IMMEDIATE_INT=0x0）。 */
const im = (raw: number): BinArg => ({ type: 0x0, raw });

test('0xA1/0xA2/0xA3 菜单派发：reset/bind/dispatch', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  // 模拟脚本 label 映射（dword index -> 指令 index）
  f.labelMap.set(0x44f, 3);
  f.labelMap.set(0x452, 4);

  const step = (opcode: number, args: BinArg[]) => makeCtx(e, f, instr(opcode, args), native, () => {});

  // 0xA1：复位
  OPS.get(0xa1)!(step(0xa1, []));
  assert.equal(e.menuMap.size, 0, '0xA1 reset 应清空菜单表');

  // 0xA2：登记 key→label
  OPS.get(0xa2)!(step(0xa2, [im(0), im(0x44f)]));
  assert.equal(e.menuMap.get('0'), 0x44f);
  OPS.get(0xa2)!(step(0xa2, [im(-1), im(0x452)]));
  assert.equal(e.menuMap.get('-1'), 0x452);
  assert.equal(e.menuMap.get('1'), undefined, '未登记的 key 不应存在');

  // 0xA3：命中 → 跳到登记的 label(指令 index)
  const c1 = step(0xa3, [im(0), im(0x7df)]);
  OPS.get(0xa3)!(c1);
  assert.equal(c1._nextIp, 3, '0xA3 key="0" 应跳到 label 0x44f 的指令 index');

  const c2 = step(0xa3, [im(-1), im(0x7df)]);
  OPS.get(0xa3)!(c2);
  assert.equal(c2._nextIp, 4, '0xA3 key="-1" 应跳到 label 0x452 的指令 index');

  // 0xA3：未命中 → 回退 op2(0x7df)；该回退 label 不在 labelMap → 不跳
  const c3 = step(0xa3, [im(9), im(0x7df)]);
  OPS.get(0xa3)!(c3);
  assert.equal(c3._nextIp, null, '0xA3 未命中且回退 label 无映射 → 不跳');

  // 复位后再 dispatch：空表 → 走回退
  OPS.get(0xa1)!(step(0xa1, []));
  const c4 = step(0xa3, [im(0), im(0x7df)]);
  OPS.get(0xa3)!(c4);
  assert.equal(c4._nextIp, null, '复位后 0xA3 key="0" 走回退(label 0x7df 无映射)→ 不跳');
});
