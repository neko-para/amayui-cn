/**
 * 控制窗的**纯格式化**（`tickets/T-0127`）—— 从 `control/control.ts` 抽出来，唯一目的是**可测**。
 *
 * 为什么：审计的变异实测（`tickets/T-0124` 的 Z3）证明「删掉 `opHex` 的前导零 ⇒ 全量 1086 例无一红」——
 * `control/` 层零测试覆盖。而 `control.ts` 在模块加载时就摸 DOM/`window.api`，Node 测试 import 不了它。
 * ⇒ 把纯函数挪到本文件（**不 import 任何 DOM/IPC**），测试就能直接钉住它。
 */

/**
 * 指令码的规范写法（**所有清单行都以它开头**）。
 *
 * ★为什么必须带 opcode 且**补足三位**：助记符在缺名时是 `i0b5` 这种"i + 三位十六进制"，
 *   极易与别的 opcode 混读 —— 2026-09 用户实测就把 `0x0B5`（`i0b5`，DsPlaySound 音轨）看成了
 *   `0x05B`（`ne`，已实现），于是以为"已实现的指令被当成缺口"。带上 `0x0b5` 后不可能再混。
 */
export function opHex(opcode: number): string {
  return `0x${opcode.toString(16).padStart(3, '0')}`;
}
