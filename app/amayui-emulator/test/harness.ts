/**
 * 测试公共 harness（2026-09 抽取）。
 *
 * 为什么需要：`instr()` 曾在 11 个测试文件里逐字重复、`im`/`str` 也在多处逐字重复
 * （见 `docs-new/04-app/emulator-refactor-plan.md` §4）。重复的后果不是"啰嗦"而是**漂移**：
 * 有人改了某个文件里的 `instr`（例如补 `byteOffset`）其余文件不会跟着改，
 * 于是同一批断言在不同文件里跑的是**不同的指令形状**。
 *
 * 只放"与引擎语义无关、纯构造"的东西；任何涉及 opcode 语义的假件都应留在各自测试里显式写出。
 */
import type { BinArg, BinInstruction } from '../src/script/bin.js';

/** 立即数 int 操作数（type 0）。 */
export const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;

/** 字符串操作数（type 2，`str` 字段直给）。 */
export const str = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg;

/** 本帧 int 槽（type 0x9）—— 只有池操作数能做**写目标**，立即数不行。 */
export const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;

/**
 * 构造一条**二进制指令**（只填测试用得到的字段）。
 *
 * `name` = `i${opcode.toString(16)}`：与 `src/script/opcodes.ts` 的助记符表无关，
 * 仅用于断言失败时的可读输出（引擎日志里也是这个形状）。
 */
export function instr(op: number, args: BinArg[]): BinInstruction {
  return { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
}
