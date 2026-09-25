/** @tier T0 @kind core @subsystem ops */

/**
 * `tickets/T-0179`（审计 P3 `0xA3` `missing-branch`）：**菜单派发目标也走两级解析**。
 *
 * 体（`sub_429830` raw 35742-35758）：
 * ```text
 * raw 35749  v2 = sub_41B640(_this, 1);             // 键
 * raw 35750  v3 = sub_428E00(_this + 107679, v2);   // 哈希查表
 * raw 35752  命中   ⇒ ip = ip_base + 4*(*v3);       // ★ 不校验目标
 * raw 35754  未命中 ⇒ ip = ip_base + 4*readInt(2);  // ★ 回退 label，同样不校验
 * raw 35756  _this[30*cur + 95805] = 0;             // 长度槽 0 ⇒ 派发器不再前进
 * ```
 * ⇒ 目标就是 **dword 偏移**；`labelMap` 未命中**不是**"不跳"的理由 —— 修前 emulator 在这里
 * `c.log` 一句就 `return`（控制流落回顺序执行），与引擎分叉且只有日志。现在与
 * `0x8C`/`0x8F`/`0xA0` 同口径（`handlers/shared.ts` 的 `branchTarget`）：
 * `labelMap` → `script.dwordToInstr`，两级都查不到（目标越出脚本）才抛。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, mkEngine } from './harness.js';
import type { BinInstruction } from '../src/script/bin.js';

/**
 * 造一个"指令下标 ≠ dword 偏移"的合成脚本（同 `test/op-a0-8c-8f-branch-targets.test.ts` 的
 * `engineWithOffsets`）：`dwordToInstr` 是逐 dword 映射（`dwordToInstr[ins.index + d] = 下标`）。
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

test('★T-0179 0xA3：命中表值 = **非标签的合法 dword 偏移** ⇒ 照引擎跳过去（修前只打日志、落回顺序执行）', async () => {
  // 指令落在 dword 0 / 4 / 8 / 12 ⇒ 目标 12 是合法偏移但不是标签
  const ops = [
    instr(0xa2, [im(0), im(12)]),
    instr(0xa3, [im(0), im(0xffffffff)]),
    instr(0x1a8, []),
    instr(RET_OP, []),
  ];
  const e = engineWithOffsets(ops, [0, 4, 8, 12]);
  const f = e.curScript();
  assert.equal(f.labelMap.has(12), false, '前提：目标 12 只在 dwordToInstr 里，不是标签');
  await stepOnce(e); // ① 0xA2 登记 key `0` → 12
  assert.equal(e.menuMap.get('0'), 12, '前提：表里存的是 dword 偏移 12');
  await stepOnce(e); // ② 0xA3 命中 ⇒ 引擎 raw 35752 `ip = ip_base + 4*12`
  assert.equal(f.ip, 3, '★必须跳到下标 3（修前 labelPos=null ⇒ 返回 ⇒ 顺序执行到下标 2 的那条 0x1a8）');
});

test('★T-0179 0xA3：未命中 ⇒ 回退位（op2）同样走两级解析（引擎 raw 35754 不校验）', async () => {
  const ops = [
    instr(0xa3, [im(7), im(8)]), // key 7 没登记 ⇒ 用 op2 = 8（合法偏移、非标签）
    instr(0x1a8, []),
    instr(RET_OP, []),
  ];
  const e = engineWithOffsets(ops, [0, 4, 8]);
  const f = e.curScript();
  assert.equal(e.menuMap.size, 0, '前提：表空');
  await stepOnce(e);
  assert.equal(f.ip, 2, '★回退位 8 ⇒ 下标 2（修前同样落回下标 1）');
});

test('★T-0179 0xA3：标签目标照旧（回归）＋ 两级都查不到才抛（宿主护栏）', async () => {
  const ok = mkEngine([instr(0xa2, [im(1), im(0x99)]), instr(0xa3, [im(1), im(0xffffffff)]), instr(RET_OP, [])]);
  ok.curScript().labelMap.set(0x99, 2);
  await stepOnce(ok);
  await stepOnce(ok);
  assert.equal(ok.curScript().ip, 2, '标签目标（语料唯一形态）行为不变');

  const bad = mkEngine([instr(0xa3, [im(1), im(0xffffffff)]), instr(RET_OP, [])]);
  await assert.rejects(
    () => stepOnce(bad),
    (err: unknown) => {
      assert.match(String((err as Error).message), /越出脚本/, '两级都查不到 ⇒ 报"越出脚本"（引擎此处是野跳）');
      return true;
    },
  );
});
