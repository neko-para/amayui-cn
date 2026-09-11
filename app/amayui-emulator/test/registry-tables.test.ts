/**
 * 三张注册表（`OPS` / `NATIVE_OPS` / `ENGINE_INTERNAL_OPS`）**必须两两不相交**。
 *
 * 为什么值得一条测试：解释器按 `OPS → NATIVE_OPS → ENGINE_INTERNAL_OPS` 的顺序查找，
 * 所以同一个 opcode 同时出现在两张表里**不会报错**，只会让先命中的那张静默生效。
 * 后果是「把某个 opcode 升级成真实现」时忘了删旧桩 ⇒ 真实现被 no-op / 旧桩掩盖，
 * 表现为"改了代码但行为没变"，而且没有任何报错（2026 实测：`0x70/0x74/0x75/0x79/0x197/
 * 0x198/0x1B5/0x1C1/0x260/0x2BD/0x2BE/0x2E8/0x2FE/0x303` 在 `MSGWIN_OPS` 与
 * `ENGINE_INTERNAL_OPS` 里各有一份；`0x1A5` 在 `MSGWIN_OPS` 与 `STUB_NATIVE_OPS` 里各有一份）。
 *
 * 这条不变式也是 `src/vm/handlers/stubs.ts` 头部注释所声明的分类契约的一部分：
 * 表里每条都必须是**当前**的分类结论，而不是历史遗留。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';

const hex = (n: number): string => '0x' + n.toString(16).toUpperCase();

/** `a ∩ b` 的 opcode（升序）。 */
function overlap(a: Map<number, unknown>, b: Map<number, unknown>): number[] {
  return [...a.keys()].filter((k) => b.has(k)).sort((x, y) => x - y);
}

test('OPS / NATIVE_OPS / ENGINE_INTERNAL_OPS 两两不相交', () => {
  const pairs: Array<[string, Map<number, unknown>, Map<number, unknown>]>= [
    ['OPS ∩ NATIVE_OPS', OPS, NATIVE_OPS],
    ['OPS ∩ ENGINE_INTERNAL_OPS', OPS, ENGINE_INTERNAL_OPS],
    ['NATIVE_OPS ∩ ENGINE_INTERNAL_OPS', NATIVE_OPS, ENGINE_INTERNAL_OPS],
  ];
  for (const [name, a, b] of pairs) {
    const hit = overlap(a, b);
    assert.deepEqual(
      hit.map(hex),
      [],
      `${name} 重复登记（先命中的表会把另一张静默掩盖；升级实现时请删掉旧桩）`,
    );
  }
});

test('三张表都非空，且查找顺序决定的分类可用（抽查若干已知 opcode）', () => {
  assert.ok(OPS.size > 100, `OPS 应有大量实现（当前 ${OPS.size}）`);
  assert.ok(NATIVE_OPS.size > 0);
  assert.ok(ENGINE_INTERNAL_OPS.size > 0);
  // 抽查：0x71 show-message（真实现）、0x1F6 清绘制容器（真实现）、0x1111 谁都不在。
  assert.ok(OPS.has(0x71));
  assert.ok(OPS.has(0x1f6));
  assert.ok(!OPS.has(0x1111) && !NATIVE_OPS.has(0x1111) && !ENGINE_INTERNAL_OPS.has(0x1111));
});
