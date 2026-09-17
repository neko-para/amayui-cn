/**
 * SYS4450 (v4) / SYS5501 (v5) 脚本二进制解析器（纯函数）。
 * 依据：docs/re/engine/00 + tools/Eushully-Decompiler/Decompiler 的
 *   BinaryHeader / Header / parse_instruction / disassemble()。
 * 输出结构化的指令流 + 字符串表 + label 目标映射，供解释器消费。
 */
import { ByteView } from '../util/bytes.js';
import { OPCODE_TABLE as OPCODE_DEFS } from '../opcodes.js';

/** opcode -> { name(argc 语义名), argc } 表（直接由外部配置 scripts/asm/opcodes.json 派生，574 条）。 */
const OPCODE_TABLE: Map<number, { name: string; argc: number }> = new Map(
  OPCODE_DEFS.map((e) => [e.opcode, { name: e.name, argc: e.argc }]),
);

export interface BinArg {
  type: number;
  raw: number;
  /** type==2 时解码出的字符串（SJIS->UTF8；v5 为 UTF-16->UTF8）；否则 undefined */
  str?: string;
  /** opcode 0x64 的 Data_Array 参数（copy-local-array 目标数组的数据） */
  dataArray?: number[];
}

export interface BinInstruction {
  opcode: number;
  name: string;
  argc: number;
  args: BinArg[];
  /** 绝对字节偏移（BIN 内） */
  byteOffset: number;
  /** 头后 dword 索引 = (byteOffset - headerLen) >> 2，用于 label 目标 */
  index: number;
}

export interface ScriptBinary {
  signature: string;
  isVer5: boolean;
  headerLen: number;
  localVars: number[]; // 6 个
  subHeaderLength: number;
  tables: { length: number; offset: number }[]; // 3 个
  instructions: BinInstruction[];
  /** label 目标值(index) -> 指令的 index；等价于"哪些 index 是某 label 的目标" */
  labelTargets: Set<number>;
  /**
   * **dword 偏移 → 指令数组下标**（步长位图）。第 i 项 = 该 dword 偏移是否落在指令 i 的范围内。
   *
   * 为什么需要：引擎的 `ip` 是**字节/dword 偏移**（`ip = ip_base + 4*label`），指令长度 =
   * `1 + 2*argc` 个 dword（`frames[cur][95805]` = 1+2*argc，主循环 `ip += 4*step`）；
   * 而 emulator 的 `frame.ip` 是**指令数组下标**（每条 +1）。返回栈在引擎里存的是 **dword 偏移**
   * （`sub_405360` raw 11035-11037、`call` 0x8F raw 29458-29460 都压 `(ip-ip_base)>>2` 系的量），
   * 所以 `ret`（`sub_41A9B0` raw 25704-25727：`ip = ip_base + 4*v2`）弹出来的是 dword 偏移，
   * 必须经这张表换回数组下标才能落对指令。
   */
  dwordToInstr: number[];
  /** 原始字节（供后续按需重读/调试） */
  raw: Uint8Array;
}

const SJIS = new TextDecoder('shift_jis');

function decodeSjis(bytes: Uint8Array): string {
  try {
    return SJIS.decode(bytes);
  } catch {
    // 兜底：逐字节 latin1
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return s;
  }
}

/** 读一个 v4 字符串：从 headerLen + raw*4 起，逐字节 ^0xFF 直到 0xFF 终止，再解 SJIS。 */
function readV4String(v: ByteView, headerLen: number, raw: number): string {
  let p = headerLen + raw * 4;
  const out: number[] = [];
  for (;;) {
    const c = v.bytes[p++];
    if (c === undefined || c === 0xff) break;
    out.push(c ^ 0xff);
  }
  return decodeSjis(Uint8Array.from(out));
}

/** 读一个 v5 字符串：从 headerLen + raw*4 起，读 u16，^0xFFFF 直到 0xFFFF 终止，转 UTF-16->UTF8。 */
function readV5String(v: ByteView, headerLen: number, raw: number): string {
  let p = headerLen + raw * 4;
  const units: number[] = [];
  for (;;) {
    const ch = v.u16(p);
    p += 2;
    if (ch === 0xffff) break;
    units.push(ch ^ 0xffff);
  }
  return String.fromCharCode(...units);
}

/** 判断第 idx 个参数是否控制流 label 参数（raw != 0xFFFFFFFF）——用于跨指令的 label 定位见下文。 */

export function parseScriptBytes(bin: Uint8Array): ScriptBinary {
  const sig4 = String.fromCharCode(bin[0]!, bin[1]!, bin[2]!, bin[3]!); // "SYS4" 或 "SYS5"
  const isVer5 = sig4 === 'SYS5';
  const signature = String.fromCharCode(bin[0]!, bin[1]!, bin[2]!, bin[3]!, bin[4]!, bin[5]!, bin[6]!, bin[7]!); // "SYS4450 " / "SYS5501 "
  const v = new ByteView(bin);

  let headerLen: number;
  let localVars: number[];
  let subHeaderLength: number;
  let tables: { length: number; offset: number }[];

  if (!isVer5) {
    // v4: 头 0x3C。signature[8] + 6 u32 + sub_header_len + 3 表(len,offset)
    headerLen = 0x3c;
    localVars = [v.u32(8), v.u32(12), v.u32(16), v.u32(20), v.u32(24), v.u32(28)];
    subHeaderLength = v.u32(0x20);
    tables = [
      { length: v.u32(0x24), offset: v.u32(0x28) },
      { length: v.u32(0x2c), offset: v.u32(0x30) },
      { length: v.u32(0x34), offset: v.u32(0x38) },
    ];
  } else {
    // v5: 头 0x44。signature[8](UTF16LE 为 16 字节) + 6 u32 + ... 与 v4 布局不同，M0 不深入。
    headerLen = 0x44;
    localVars = [v.u16(16), 0, 0, 0, 0, 0]; // 仅占位；v5 未在 M0 范围
    subHeaderLength = v.u32(0x20);
    tables = [ { length: 0, offset: 0 }, { length: 0, offset: 0 }, { length: 0, offset: 0 } ];
  }

  // data_array_end = headerLen + min(table offsets)*4：指令流止于第一个表起点。
  const minOff = Math.min(tables[0]!.offset, tables[1]!.offset, tables[2]!.offset);
  const dataArrayEnd = headerLen + minOff * 4;
  // 读字符串时会动态收窄（防止某些字符串位于表之前——参考 disassembler 的 data_array_end 语义）。

  const instructions: BinInstruction[] = [];
  let p = headerLen;
  let curDataEnd = dataArrayEnd;

  const controlFlowOps = new Set<number>([0x8c, 0x8f, 0xa0, 0xcc, 0xfb, 0xd4, 0x90, 0x7b]);
  // 哪些 opcode 的哪些参数位是 label（raw != 0xFFFFFFFF 才是目标）：按 docs/re/engine/02 §4 的口径。
  const labelArgIndexForOp = (op: number): number[] => {
    switch (op) {
      case 0x8c:
      case 0x8f:
        return [0];
      case 0xa0:
        return [0];
      case 0xcc:
      case 0xfb:
        return [0];
      case 0xd4:
        // ★`0xD4` 的 label 是**操作数 3 与 4**（不是操作数 1）：反汇编器一侧的同一口径见
        //   `scripts/asm/age-shared.mjs` 的 `isLabelArgument`（`opcode === 0xD4 && x >= 2`）。
        //   旧值 `[0]` 把"间隔 ms"当成了 label —— 该集合此前只被工具读，VM 不受影响（`frame.labelMap`
        //   是**全部**指令下标），但会让 label 目标集合漏掉 i0d4 的两个真实目标。
        return [2, 3];
      case 0x90:
        return [];
      case 0x7b:
        return [0];
      case 0xa2:
      case 0xa3:
        return [1]; // 菜单派发：menu-bind / menu-dispatch 的第 2 操作数是 label
      default:
        return [];
    }
  };

  while (p < curDataEnd) {
    const byteOffset = p;
    const opcode = v.u32(p);
    p += 4;
    if (opcode === 0) {
      // 0 是非法 opcode（disassembler 认为错误）；按"停止"处理并记警告。
      break;
    }
    const def = OPCODE_TABLE.get(opcode) ?? { name: `0x${opcode.toString(16)}`, argc: 0 };
    const args: BinArg[] = [];
    for (let i = 0; i < def.argc; i++) {
      const type = v.u32(p);
      const raw = v.u32(p + 4);
      p += 8;
      let str: string | undefined;
      let dataArray: number[] | undefined;
      if (type === 2) {
        const sOff = headerLen + raw * 4;
        if (sOff < curDataEnd) curDataEnd = sOff; // 收窄，防止读到数据区之后
        str = isVer5 ? readV5String(v, headerLen, raw) : readV4String(v, headerLen, raw);
      } else if (opcode === 0x64 && i === 1) {
        // copy-local-array 第 2 个参数：raw 指向数据区里的数组（len u32 + len 个 u32），不在指令流内。
        // 该字面数组位于"松散数据区"（可能在 string 表起点之前）；指令流必须在其之前停止，
        // 否则会把字面数组误读成指令（越界）。故与 string 一样收窄 curDataEnd。
        const dataArrayStart = headerLen + raw * 4;
        let ap = dataArrayStart;
        const len = v.u32(ap);
        ap += 4;
        const vals: number[] = [];
        for (let k = 0; k < len; k++) {
          vals.push(v.u32(ap));
          ap += 4;
        }
        dataArray = vals;
        if (dataArrayStart < curDataEnd) curDataEnd = dataArrayStart;
      }
      args.push({ type, raw, str, dataArray });
    }
    const index = (byteOffset - headerLen) >> 2;
    instructions.push({ opcode, name: def.name, argc: def.argc, args, byteOffset, index });
  }

  // 收集 label 目标：控制流 op 的 label 参数值（raw != 0xFFFFFFFF）就是目标指令的 index。
  const labelTargets = new Set<number>();
  for (const ins of instructions) {
    if (!controlFlowOps.has(ins.opcode)) continue;
    const idxs = labelArgIndexForOp(ins.opcode);
    for (const i of idxs) {
      const a = ins.args[i];
      if (a && a.raw !== 0xffffffff) labelTargets.add(a.raw);
    }
  }

  // dword 偏移 → 指令下标（每 4 字节一格；一条 `1+2*argc` dword 的指令占满自己那几格）。
  const dwordToInstr: number[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const ins = instructions[i]!;
    const dwords = 1 + 2 * ins.argc;
    for (let d = 0; d < dwords; d++) dwordToInstr[ins.index + d] = i;
  }

  return {
    signature,
    isVer5,
    headerLen,
    localVars,
    subHeaderLength,
    tables,
    instructions,
    labelTargets,
    dwordToInstr,
    raw: bin,
  };
}

/** opcode → { name, argc }（本文件用的**Map 视图**，见文件头；`run.ts` 依赖它做诊断名）。 */
export { OPCODE_TABLE };
