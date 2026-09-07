// disassembler.mjs —— AGE 脚本字节码 → 反汇编文本（对应 C++ disassembler.cpp）
import {
  readHeader, instructionForOpCode, getTypeLabel,
  isControlFlowOpcode, isLabelArgument, cpToUtf16,
  hex, labelHex, opcodeLabel, CP_932,
} from './age-shared.mjs';
import { loadOpcodeTable } from './age-shared.mjs';

export function disassemble(buf, tableInfo, codepage = CP_932) {
  const table = tableInfo || loadOpcodeTable();
  const header = readHeader(buf);
  const { fields } = header;
  const headerLen = header.length;

  const minTableOffset = Math.min(fields.table_1_offset, fields.table_2_offset, fields.table_3_offset);
  let dataArrayEnd = headerLen + (minTableOffset << 2);

  const instructions = [];
  let pos = headerLen;

  while (pos < dataArrayEnd) {
    const byteOffset = pos;
    const opCode = buf.readUInt32LE(pos);
    pos += 4;
    if (opCode === 0x0) throw new Error(`Offset 0x${byteOffset.toString(16)} bad opcode : 0`);

    const def = instructionForOpCode(table, opCode);
    if (!def) throw new Error(`Unknown instruction : 0x${opCode.toString(16)} at 0x${byteOffset.toString(16)}`);
    if (def.argc === null) throw new Error(`Unknown argc for opcode 0x${opCode.toString(16)} at 0x${byteOffset.toString(16)}`);

    const instr = { def, args: [], byteOffset, offset: (byteOffset - headerLen) >> 2 };

    for (let current = 0; current < def.argc; current++) {
      const type = buf.readUInt32LE(pos); pos += 4;
      const rawData = buf.readUInt32LE(pos); pos += 4;
      const arg = { type, raw_data: rawData, text: undefined, bytes: undefined, data_array: null };

      if (type === 2) {
        const stringOffset = headerLen + (rawData << 2);
        dataArrayEnd = Math.min(dataArrayEnd, stringOffset);
        const curOff = pos;
        if (header.isVer5) {
          const utf16 = [];
          let p = stringOffset;
          for (;;) {
            let ch = buf.readUInt16LE(p); p += 2;
            if (ch === 0xFFFF) break;
            utf16.push(ch ^ 0xFFFF);
          }
          arg.text = String.fromCharCode(...utf16);
        } else {
          const bytes = [];
          let p = stringOffset;
          for (;;) {
            const c = buf[p++];
            if (c === 0xFF) break;
            bytes.push(c ^ 0xFF);
          }
          arg.text = cpToUtf16(codepage, Buffer.from(bytes));
        }
        pos = curOff;
      } else if (def.opcode === 0x64 && current === 1) {
        const arrayOffset = headerLen + (rawData << 2);
        dataArrayEnd = Math.min(dataArrayEnd, arrayOffset);
        const curOff = pos;
        const length = buf.readUInt32LE(arrayOffset);
        const data = [];
        for (let i = 0; i < length; i++) data.push(buf.readUInt32LE(arrayOffset + 4 + i * 4));
        arg.data_array = { length, data };
        pos = curOff;
      }

      if (type < 0 || (type > 0xE && type < 0x8003) || type > 0x800B) {
        throw new Error(
          `Pos : ${pos.toString(16)} -> Opcode : ${def.opcode.toString(16)}, argument ${current}\n` +
          `Unknown type : ${type.toString(16)}\nValue : ${rawData.toString(16)}`
        );
      }
      instr.args.push(arg);
    }
    instructions.push(instr);
  }

  return writeScriptFile(header, instructions);
}

function disassembleHeader(header) {
  const { fields } = header;
  let s = '==Binary Information - do not edit==\n';
  s += 'signature = ' + header.signature;
  s += '\nlocal_vars = { ';
  s += hex(fields.local_integer_1) + ' ';
  s += hex(fields.local_floats) + ' ';
  s += hex(fields.local_strings_1) + ' ';
  s += hex(fields.local_integer_2) + ' ';
  s += hex(fields.unknown_data) + ' ';
  s += hex(fields.local_strings_2);
  s += ' }\n';
  s += '====\n\n';
  return s;
}

function disassembleInstruction(header, instr) {
  let s = opcodeLabel(instr.def);
  if (instr.args.length > 0) s += ' ';
  let x = 0;
  for (const arg of instr.args) {
    const typeLabel = getTypeLabel(arg.type);
    if (typeLabel !== '') {
      s += '(' + typeLabel + ' ' + hex(arg.raw_data) + ')';
    } else if (arg.type === 2) {
      s += '"' + arg.text + '"';
    } else if (instr.def.opcode === 0x64 && arg.type === 0) {
      s += '[' + arg.data_array.data.map(hex).join(' ') + ']';
    } else if (isControlFlowOpcode(instr.def.opcode)) {
      if (isLabelArgument(instr, x)) {
        s += 'label_' + labelHex(header.length + (arg.raw_data << 2));
      } else {
        s += hex(arg.raw_data);
      }
    } else {
      s += hex(arg.raw_data);
    }
    if (x < instr.args.length - 1) s += ' ';
    x++;
  }
  s += '\n';
  return s;
}

function writeScriptFile(header, instructions) {
  const labels = new Set();
  for (const instr of instructions) {
    if (isControlFlowOpcode(instr.def.opcode)) {
      let x = 0;
      for (const arg of instr.args) {
        if (isLabelArgument(instr, x)) labels.add(arg.raw_data);
        x++;
      }
    }
  }
  let out = disassembleHeader(header);
  for (const instr of instructions) {
    if (labels.has(instr.offset)) {
      out += '\nlabel_' + labelHex(header.length + (instr.offset << 2)) + '\n';
    }
    out += disassembleInstruction(header, instr);
  }
  return out;
}
