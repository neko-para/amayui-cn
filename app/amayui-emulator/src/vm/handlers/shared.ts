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

