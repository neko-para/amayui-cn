/**
 * opcode -> { name, argc } 表，**直接由外部配置 scripts/asm/opcodes.json 派生**（不再手写 uXXX 名）。
 * - 单一数据源：指令集定义统一在 `scripts/asm/opcodes.json`（由 build-opcodes.js 从 opcode-table.md +
 *   age-shared.cpp 生成），此文件只做映射，不重复维护。
 * - name 解析与装配器 `scripts/asm/age-shared.mjs` 的 opcodeLabel() 完全一致：
 *     `def.name` 非空用之（语义助记符，如 get-input-type / detach-texture）；
 *     否则按 opcode 生成规范 `iXXX`（如 0x109 -> i109），与 data/src 反汇编 txt 基线一致。
 */
import canonical from '../../../scripts/asm/opcodes.json' with { type: 'json' };

export interface OpcodeDef {
  opcode: number;
  name: string;
  argc: number;
}

const canonicalList = canonical as { opcode: number; argc: number; name?: string }[];

export const OPCODE_TABLE: OpcodeDef[] = canonicalList.map((e) => ({
  opcode: e.opcode,
  name: e.name || 'i' + (e.opcode >>> 0).toString(16).padStart(3, '0'),
  argc: e.argc,
}));
