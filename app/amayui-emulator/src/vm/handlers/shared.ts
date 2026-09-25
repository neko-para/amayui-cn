/**
 * opcode handler 之间共享的小工具。
 *
 * 这里只放**被两个以上子系统用到**的东西；单模块私有的辅助函数（如 arithmetic 的 `binOp`）
 * 留在各自模块里，避免又长成一张什么都往里塞的杂货表。
 */
import type { OpHandler } from '../step.js';
import type { Frame } from '../engine.js';

/** 一个子系统的 opcode 注册表：`[opcode, handler]` 有序对。 */
export type OpTable = readonly (readonly [number, OpHandler])[];

export function labelPos(frame: Frame, raw: number): number | null {
  const p = frame.labelMap.get(raw);
  return p === undefined ? null : p;
}

/**
 * **分支/跳转目标的两级解析**（`tickets/T-0179`；`jcc`=`0xA0`、`jmp`=`0x8C`、`call`=`0x8F` 共用）。
 *
 * 引擎对这三个目标**都不做任何校验或查找**，直接 `frame.ip = ip_base + 4 * 目标`：
 *  - `jcc` `sub_4209B0` raw 29635（`-1` = 落下句，raw 29624/29631）
 *  - `jmp` `sub_4203D0` raw 29395-29397（`-1` = 不跳）
 *  - `call` `sub_420560` raw 29469（`-1` = 不跳，raw 29461）
 * ⇒ `frame.labelMap`（本工程为「汇编器标签 → 指令下标」建的快查表，语料里目标几乎全是标签）
 * **未命中不是错误**：回落到 `script.dwordToInstr`（同一映射的逐 dword 版本，
 * `src/script/bin.ts:236-240` 的 `dwordToInstr[ins.index + d] = i`；`ret` 早已在用它）。
 *
 * @returns 指令下标；`null` = **两级都查不到**（目标越出脚本 —— 引擎此时会把 ip 指到缓冲区之外，
 *          宿主侧只能报错，这是本工程唯一的"脚本之外"护栏）。
 */
export function branchTarget(frame: Frame, raw: number): number | null {
  const p = labelPos(frame, raw);
  if (p !== null) return p;
  const viaDword = frame.script?.dwordToInstr?.[raw];
  return viaDword === undefined ? null : viaDword;
}

/** 目标越出脚本时的统一报错（写清"引擎不校验"这一事实，避免被读成"标签表缺项"）。 */
export function branchTargetError(which: string, raw: number): Error {
  return new Error(
    `${which}: 目标 0x${(raw >>> 0).toString(16)} 越出脚本 —— labelMap 与 dwordToInstr 都查不到` +
      `（引擎对跳转目标不校验，直接 ip = ip_base + 4*目标 ⇒ 落到脚本缓冲区之外）`,
  );
}

