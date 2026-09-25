/** @tier T0 @kind core @subsystem vm */

/**
 * `tickets/T-0179`（审计 `0xa0` approximation ＋ `0x8c` missing-operand-io）：**分支目标的两级解析**。
 *
 * ## 体证（`engine/天结_unpacked.exe_utf8.c`）—— 三条都**不校验目标**
 * ```text
 * 0xA0 jcc  sub_4209B0 raw 29620-29636
 *   if (readOperand(1)) { v3 = readOperand(2); if (v3 == -1) return; }
 *   else                { v3 = readOperand(3); if (v3 == -1) return; }
 *   ip = ip_base + 4 * v3;
 * 0x8C jmp  sub_4203D0 raw 29392-29397
 *   result = readOperand(1); if (result != -1) ip = ip_base + 4 * readOperand(1);
 * 0x8F call sub_420560 raw 29452-29473
 *   retStack[top++] = (ip - ip_base) >> 2 + 3;  if (readOperand(1) == -1) return;
 *   ip = ip_base + 4 * readOperand(1);
 * ```
 * ⇒ 目标就是**dword 偏移**，引擎既不查表也不校验。`frame.labelMap` 是本工程为「汇编器标签 → 指令下标」
 * 建的快查表（语料里目标几乎全是标签），`script.dwordToInstr` 是同一映射的逐 dword 版本
 * （`src/script/bin.ts:236-240`）⇒ 修前 emulator 在 `labelMap` 未命中时抛
 * `jcc/jmp/call: unknown label` 是**宿主自造的硬错误**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, mkEngine, scriptDerived } from './harness.js';
import type { BinInstruction } from '../src/script/bin.js';

/**
 * 造一个"指令下标 ≠ dword 偏移"的合成脚本（真实脚本里两者由头部排布决定）。
 *
 * `dwordToInstr` 是**逐 dword** 映射：`dwordToInstr[ins.index + d] = 指令下标`。
 * 这里让各条指令落在 dword 0 / 4 / 8 … ⇒ 目标 `8` 是"合法偏移但**不是**标签"。
 */
function engineWithOffsets(ops: BinInstruction[], dwordStarts: number[]): ReturnType<typeof mkEngine> {
  const e = mkEngine(ops);
  const script = e.curScript().script!;
  script.instructions = ops.map((o, i) => ({ ...o, index: dwordStarts[i]! }));
  const map: number[] = [];
  for (let i = 0; i < ops.length; i++) for (let d = 0; d < 4; d++) map[dwordStarts[i]! + d] = i;
  script.dwordToInstr = map;
  return e;
}

const RET_OP = 0x1a7;

test('★T-0179 0xA0 jcc：真支目标是**非标签的合法 dword 偏移** ⇒ 照引擎跳过去（不许抛）', async () => {
  const ops = [instr(0xa0, [im(1), im(8), im(0xffffffff)]), instr(0x1a8, []), instr(RET_OP, [])];
  const e = engineWithOffsets(ops, [0, 4, 8]);
  assert.equal(e.curScript().labelMap.has(8), false, '目标 8 只在 dwordToInstr 里，不是标签');
  const t = await stepOnce(e);
  assert.equal(t.opcode, 0xa0);
  assert.equal(e.curScript().ip, 2, '引擎 raw 29635 是 `ip = ip_base + 4*目标` ⇒ 目标 8 ⇒ 第 3 条指令（下标 2）');
});

test('★T-0179 0x8C jmp：非标签的合法 dword 偏移 ⇒ 跳过去（修前抛 `jmp: unknown label`）', async () => {
  const ops = [instr(0x8c, [im(8)]), instr(0x1a8, []), instr(RET_OP, [])];
  const e = engineWithOffsets(ops, [0, 4, 8]);
  const t = await stepOnce(e);
  assert.equal(t.opcode, 0x8c);
  assert.equal(e.curScript().ip, 2, '引擎 raw 29397 同样不校验目标');
});

test('★T-0179 0x8F call：非标签的合法 dword 偏移 ⇒ 跳过去 + 返回栈里压的是 dword 偏移（不是下标）', async () => {
  const ops = [instr(0x8f, [im(8)]), instr(0x1a8, []), instr(RET_OP, [])];
  const e = engineWithOffsets(ops, [0, 4, 8]);
  const t = await stepOnce(e);
  assert.equal(t.opcode, 0x8f);
  assert.equal(e.curScript().ip, 2, '引擎 raw 29469 不校验目标');
  assert.equal(e.curScript().retStack.at(-1), 3, '压入的是 `(ip-ip_base)>>2 + 3` = dword 偏移 3（本指令 3 dword 长）');
});

test('★T-0179：目标越出脚本（两级都查不到）⇒ 三条都抛（宿主侧护栏；引擎此处会落到缓冲区之外）', async () => {
  const cases: [number, BinInstruction[]][] = [
    [0xa0, [instr(0xa0, [im(1), im(9999), im(0xffffffff)]), instr(RET_OP, [])]],
    [0x8c, [instr(0x8c, [im(9999)]), instr(RET_OP, [])]],
    [0x8f, [instr(0x8f, [im(9999)]), instr(RET_OP, [])]],
  ];
  for (const [op, ops] of cases) {
    const e = engineWithOffsets(ops, [0, 4]);
    await assert.rejects(
      () => stepOnce(e),
      (err: unknown) => {
        assert.match(String((err as Error).message), /越出脚本/, `0x${op.toString(16)} 应报"越出脚本"`);
        return true;
      },
    );
  }
});

test('★T-0179：`-1` 仍是"落下句/不跳"（三个方向都不设跳转，也不报错）', async () => {
  const negCases: [number, number[]][] = [
    [0xa0, [1, 0xffffffff, 0xffffffff]],
    [0x8c, [0xffffffff]],
    [0x8f, [0xffffffff]],
  ];
  for (const [op, args] of negCases) {
    const e = mkEngine([instr(op, args.map((v) => im(v))), instr(RET_OP, [])]);
    const t = await stepOnce(e);
    assert.equal(t.opcode, op);
    assert.equal(e.curScript().ip, 1, `0x${op.toString(16)}：-1 ⇒ 落到下一句`);
  }
  assert.equal(scriptDerived().dwordToInstr.length, 0, '（harness 的 scriptDerived 仍是空表；本文件不依赖它）');
});
