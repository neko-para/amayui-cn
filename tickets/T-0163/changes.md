# T-0163 · 过程文档（changes.md）

## 2026-09-24

## 2026-09-24 · P1 `0x10c`（SetKeyMulti）修复

- **修前**：`0x10c` 在 `ENGINE_INTERNAL_OPS` 当无条件 no-op（`stubs.ts` 的 `[0x10c, op_engine_internal]`），豁免理由「宿主键盘也不进掩码 ⇒ 写入无消费者」在 T-0052 落地后已过期；且 T-0052 交付的是**冻结常量** `DEFAULT_VK_TO_BIT`（只由 `pressKey`/`releaseKey` 直查）⇒ 两处写入仍零消费者，`op1 > 0x1F` 也被静默吞掉。
- **真缺口（审计 §4.1 的 P3 `missing-operand-io` 已指出）**：两张表都不存在 ——
  `Input[1432+键码]`（键码→VK，默认值 = `sub_476AA0`）与 `Input[1176+VK]`（VK→掩码位，**可改写**）。
- **修法**：`InputManager` 增加两张运行期表 `keycodeToVk` / `vkToBit`（默认值逐条取自 `sub_476AA0`，93 条），`pressKey`/`releaseKey` 改查**运行期表**；`0x10c` 从 `ENGINE_INTERNAL_OPS` 移入 `INPUT_OPS` → `OPS`，读 `op1`(位号)/`op2`(键码)、`unsigned > 0x1F` 抛 `ShowMessageError(「SetKeyMultiの引数が不正です．」)` 且不写表。
- **顺带**：键盘掩码不再 `& 0x7f` 截断（语料用到 bit 8/9/a/b ⇒ 旧实现会静默吃掉重映射到 ≥7 的位）。
- **守卫**：`test/input.test.ts`（0x10C ①②③④）+ `test/keyboard-mask.test.ts`（⑤ 运行期表）；`test/opcode-operands.test.ts` 的 `ALLOW_UNDERRUN['0x10c']` 白名单条目**已删**（删后守卫仍绿 = 修好的机械证明）。
- **未结**：本票 19 条里其余 18 条（P2 3 / P3 15）**不在本次范围**，票保持 `open`。
