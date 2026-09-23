/** @tier T0 @kind ratchet @subsystem vm */
/**
 * **opcode 的实现类别：一张表** —— 把散在 8 个票文件里的「注册表棘轮」收成一处
 * （`tickets/T-0124` 的分组审计点名：同一条不变式在 8~9 个文件里各写一遍，改一处分类要改 9 个地方）。
 *
 * ## 判据
 *
 * 解释器按 `OPS → NATIVE_OPS → ENGINE_INTERNAL_OPS` 顺序查找 ⇒ **同时出现在两张表里不会报错**，
 * 只会让先命中的那张静默生效。后果是「把某个 opcode 升级成真实现时忘了删旧桩 ⇒ 改了代码但行为没变」
 * （本工程实测过 14 条 + 1 条，见 `test/registry-tables.test.ts` 的头部）。
 *
 * 所以每条 opcode 的类别是一个**声明**，本表把它连同出处一起记下来：
 *
 *  - **恰好在一张表里**（三表两两不交由 `registry-tables.test.ts` 守）；
 *  - 且**就在它该在的那张**里（`want` 给集合时表示"这两类都算对"，与原文件的口径一致）。
 *
 * ★反例实验：把 `src/vm/ops.ts` 里 `0xD0` 从 `OPS` 挪进 `ENGINE_INTERNAL_OPS`（或其他任意一条），
 *   本文件**必红**并指出是哪条、原本该在哪一类。这正是原来那 8 处各自能红的东西，只是收成了一处。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';

type Cls = 'OPS' | 'NATIVE_OPS' | 'ENGINE_INTERNAL_OPS';

const TABLES: Record<Cls, Map<number, unknown>> = {
  OPS,
  NATIVE_OPS,
  ENGINE_INTERNAL_OPS,
};
const ALL: Cls[] = ['OPS', 'NATIVE_OPS', 'ENGINE_INTERNAL_OPS'];

/** `[opcode, 期望类别（可给集合 = 都算对）, 出处/理由]`。 */
const CLASSIFICATION: Array<[number, Cls | Cls[], string]> = [
  // ---- A4 / A6 族（原 test/op-a4-a6.test.ts）----
  ...[0x14b, 0x14c, 0x14d].map((op): [number, Cls, string] => [op, 'OPS', 'T-0105：A6 真实现']),
  ...[0x1fc, 0x1fe, 0x207, 0x20e, 0x224, 0x229, 0x238, 0x242, 0x256, 0x258, 0x321, 0x32a, 0x32d].map(
    (op): [number, Cls, string] => [op, 'OPS', 'T-0105：A4 真实现'],
  ),
  // ---- A5 族（原 test/op-a5.test.ts）----
  ...[0x91, 0x92, 0x93, 0x94, 0x97, 0xd9, 0xad, 0x1ad, 0x1b1, 0x1bc, 0x1c9].map(
    (op): [number, Cls[], string] => [op, ['OPS', 'NATIVE_OPS'], 'T-0097：A5 已实现（VM 或 native 皆可）'],
  ),
  // ---- A2 / A3 族（原 test/op-a2-a3.test.ts）----
  // ★注意：下面这张 A2/A3 宽松名单里**不含** 0x1d3/0x1d4/0x2f3/0x199 —— 那四条单独用更严的
  //   `'OPS'` 登记（原文件里它们也是**另一条**断言：「过去压根没注册、命中即 NotImplementedOp 的读取端」）。
  //   同一 opcode 只登记一次：本文件第 2 条用例会把"重复且期望不一致"判红（写这版时它真的抓到过一次）。
  ...[0x7b, 0x1bb, 0x25a, 0xae, 0x7a, 0x1d2, 0x25c, 0x25e, 0x25f, 0x205, 0x245, 0x246, 0x249].map(
    (op): [number, Cls[], string] => [op, ['OPS', 'NATIVE_OPS'], 'T-0097：A2/A3 已实现'],
  ),
  ...[0x1d3, 0x1d4, 0x2f3, 0x199].map((op): [number, Cls, string] => [op, 'OPS', 'T-0097：读取端，必须真实现']),
  // ---- 0x1CB / 0x2C8 / 0x2C9（原 test/op-1cb-2c8-2c9.test.ts）----
  ...[0x1cb, 0x2c8, 0x2c9].map((op): [number, Cls, string] => [op, 'OPS', 'T-0099：回写操作数 ⇒ 必须真实现']),
  // ---- 单条（原各票文件）----
  [0x191, 'OPS', 'T-0096：|op2|（此前三表全无 ⇒ 命中即硬停）'],
  [0xd0, 'OPS', 'T-0093：墙钟毫秒（体里有真实效果：写 op1）'],
  [0x132, 'OPS', 'T-0101：派发队列'],
  [0x133, 'OPS', 'T-0101：派发队列'],
  [0x134, 'OPS', 'T-0101：派发队列'],
  // ---- SETWEATHER 族（原 test/op-327-32e-setweather-noop.test.ts）----
  ...[0x327, 0x328, 0x329, 0x32c, 0x32e].map(
    (op): [number, Cls, string] => [op, 'ENGINE_INTERNAL_OPS', 'T-0111：登记为引擎内部 no-op（否则命中即 NotImplementedOp）'],
  ),
];

test('★opcode 实现类别（一张表）：恰好在一张表里，且就在它该在的那张', () => {
  assert.ok(CLASSIFICATION.length >= 40, `表规模下限（当前 ${CLASSIFICATION.length}）—— 别把它删空`);
  const problems: string[] = [];
  for (const [op, want, why] of CLASSIFICATION) {
    const wantList = Array.isArray(want) ? want : [want];
    const where = ALL.filter((k) => TABLES[k].has(op));
    const hex = `0x${op.toString(16)}`;
    if (where.length === 0) {
      problems.push(`${hex} 三张表全无（命中即 NotImplementedOp）—— ${why}`);
    } else if (where.length > 1) {
      problems.push(`${hex} 同时在 ${where.join(' + ')}（先命中的那张会静默生效）—— ${why}`);
    } else if (!wantList.includes(where[0]!)) {
      problems.push(`${hex} 在 ${where[0]}，但期望 ${wantList.join('/')} —— ${why}`);
    }
  }
  assert.deepEqual(problems, [], `类别不符：\n${problems.join('\n')}`);
});

test('★表里没有重复登记（同一 opcode 写了两条不同期望 ⇒ 表本身自相矛盾）', () => {
  const seen = new Map<number, string>();
  const dup: string[] = [];
  for (const [op, want] of CLASSIFICATION) {
    const key = Array.isArray(want) ? want.join('+') : want;
    const prev = seen.get(op);
    if (prev !== undefined && prev !== key) dup.push(`0x${op.toString(16)}：${prev} vs ${key}`);
    seen.set(op, key);
  }
  assert.deepEqual(dup, []);
});
