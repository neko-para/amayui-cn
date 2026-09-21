/**
 * opcode -> { name, argc } 表，**直接由生成物 `src/generated/opcodes.json` 派生**（不再手写 uXXX 名）。
 * - **真源**：`scripts/asm/opcodes.json`（由 `node scripts/asm/build-opcodes.js` 从
 *   `docs-new/03-engine/opcode-table.md` + `tools/eushully-decompiler/.../age-shared.cpp` 生成）；
 *   本文件 import 的是同一次生成写出的**包内副本**（`tickets/T-0022`）—— 这样 `tsc` 的
 *   `rootDir: src` 不再被跨包 import 越过（此前是 `../../../scripts/asm/opcodes.json`）。
 *   两份必须逐字节相同：守卫 `test/opcode-json-sync.test.ts`（改了真源忘了重跑生成器即红）。
 * - name 解析与装配器 `scripts/asm/age-shared.mjs` 的 opcodeLabel() 完全一致：
 *     `def.name` 非空用之（语义助记符，如 get-input-type / detach-texture）；
 *     否则按 opcode 生成规范 `iXXX`（如 0x109 -> i109），与 data/src 反汇编 txt 基线一致。
 */
import canonical from './generated/opcodes.json' with { type: 'json' };

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
