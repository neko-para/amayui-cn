// reassembler.mjs —— AGE 反汇编文本 → 字节码（对应 C++ reassembler.cpp）
import {
  instructionForLabel, getType, writeHeaderBytes,
  utf16ToCp, CP_UTF16,
} from './age-shared.mjs';
import { loadOpcodeTable } from './age-shared.mjs';

const RE_PARSE_ARGS = /\((\w+?\-?\w+?\-?\w+?) ([0-9a-fA-F]+)\)|(".*?")|label_([0-9a-fA-F]+)|\[(.+?)\]|([0-9a-fA-F]+)/g;

function parseMultipleArguments(line) {
  const out = [];
  RE_PARSE_ARGS.lastIndex = 0;
  let m;
  while ((m = RE_PARSE_ARGS.exec(line)) !== null) {
    out.push([m[1] || '', m[2] || '', m[3] || '', m[4] || '', m[5] || '', m[6] || '']);
    if (m[0].length === 0) RE_PARSE_ARGS.lastIndex++;
  }
  return out;
}

function parseHeader(lines) {
  const sigLine = lines[1] || '';
  const sigStart = sigLine.indexOf('= ') + 2;
  const signature = sigLine.slice(sigStart, sigStart + 8).padEnd(8, ' ');
  const isVer5 = (signature[3] || '') === '5';
  const length = isVer5 ? 0x44 : 0x3C;

  const lvLine = lines[2] || '';
  const lvMatch = lvLine.match(/local_vars\s*=\s*\{\s*([^}]*)/);
  const tokens = (lvMatch ? lvMatch[1].trim().split(/\s+/) : []).filter(Boolean);
  if (tokens.length < 6) {
    throw new Error(`Header is corrupted, there should be 6 local_vars, but could only read ${tokens.length}`);
  }

  return {
    fields: {
      local_integer_1: parseInt(tokens[0], 16),
      local_floats: parseInt(tokens[1], 16),
      local_strings_1: parseInt(tokens[2], 16),
      local_integer_2: parseInt(tokens[3], 16),
      unknown_data: parseInt(tokens[4], 16),
      local_strings_2: parseInt(tokens[5], 16),
      sub_header_length: 0x1C,
      table_1_length: 0,
      table_1_offset: 0,
      table_2_length: 0,
      table_2_offset: 0,
      table_3_length: 0,
      table_3_offset: 0,
    },
    isVer5,
    length,
    signature,
  };
}

const computeLength = (def) => 4 + ((def.argc >>> 0) << 3);

// 跳过空行 / // 注释 / /* */ 块注释，返回下一条要处理的指令行。
function nextCodeLine(lines, i) {
  while (i < lines.length) {
    let line = lines[i];
    if (line === '' || line.startsWith('//')) { i++; continue; }
    if (line.startsWith('/*')) {
      while (i < lines.length && !line.includes('*/')) { i++; line = lines[i]; }
      if (i >= lines.length) return null;
      line = line.slice(line.indexOf('*/') + 2);
      if (line === '') { i++; continue; }
      return { line, next: i + 1 };
    }
    return { line, next: i + 1 };
  }
  return null;
}

export function assemble(text, tableInfo, codepage) {
  const table = tableInfo || loadOpcodeTable();
  const lines = text.split(/\r?\n/);
  const header = parseHeader(lines);
  const headerLen = header.length;

  const instructions = [];
  const labelToOffset = new Map();
  const labelArguments = [];
  const stringArguments = [];
  const arrayArguments = [];
  const instr3Offsets = new Set();
  const instr71Offsets = new Set();
  const instr8fOffsets = new Set();

  let dataArrayEnd = headerLen;
  let lineCount = 6;

  let i = 4;
  let nxt;
  while ((nxt = nextCodeLine(lines, i)) !== null) {
    const { line, next } = nxt;
    i = next;

    const m = line.match(/^[\w\-_]+/);
    if (!m) throw new Error(`Failed to parse line ${lineCount}: ${line}`);
    const instrToken = m[0];

    if (instrToken.startsWith('label_')) {
      labelToOffset.set(parseInt(instrToken.slice(6), 16), dataArrayEnd);
      continue;
    }

    const def = instructionForLabel(table, instrToken);
    if (!def) throw new Error(`Unknown instruction : ${instrToken} on line ${lineCount}`);
    if (def.argc === null) throw new Error(`Unknown argc for instruction ${instrToken}`);

    const instr = { def, args: [], byteOffset: dataArrayEnd, offset: (dataArrayEnd - headerLen) >> 2 };

    if (def.argc > 0) {
      const argStr = line.substring(instrToken.length + 1);
      const parsed = parseMultipleArguments(argStr);
      if (def.argc !== parsed.length) {
        throw new Error(
          `Argument mismatch for ${instrToken} on line ${lineCount}. ` +
          `Expected ${def.argc} args but found ${parsed.length}.`
        );
      }
      for (const a of parsed) {
        const arg = { type: 0, raw_data: 0, text: undefined, bytes: undefined, data_array: null };
        const idx = [instructions.length, instr.args.length];
        if (a[0] !== '') {
          arg.type = getType(a[0]);
          arg.raw_data = parseInt(a[1], 16);
        } else if (a[2] !== '') {
          const content = a[2].slice(1, -1);
          arg.type = 2;
          if (header.isVer5) arg.bytes = utf16ToCp(CP_UTF16, content);
          else arg.bytes = utf16ToCp(codepage, content);
          stringArguments.push(idx);
        } else if (a[3] !== '') {
          arg.type = 0;
          arg.raw_data = parseInt(a[3], 16);
          labelArguments.push(idx);
        } else if (a[4] !== '') {
          const data = [];
          for (const p of a[4].split(' ')) if (p !== '') data.push(parseInt(p, 16));
          arg.type = 0;
          arg.data_array = { length: data.length, data };
          arrayArguments.push(idx);
        } else if (a[5] !== '') {
          arg.type = 0;
          arg.raw_data = parseInt(a[5], 16);
        } else {
          throw new Error(`Bad argument for ${instrToken} on line ${lineCount}.`);
        }
        instr.args.push(arg);
      }
    }

    if (def.opcode === 0x3) instr3Offsets.add(dataArrayEnd);
    else if (def.opcode === 0x71) instr71Offsets.add(dataArrayEnd);
    else if (def.opcode === 0x8F) instr8fOffsets.add(dataArrayEnd);

    dataArrayEnd += computeLength(def);
    lineCount++;
    instructions.push(instr);
  }

  // 解析 label 引用（目标是在解析过程中已知的字节偏移）
  for (const [instrIdx, argIdx] of labelArguments) {
    const arg = instructions[instrIdx].args[argIdx];
    const target = labelToOffset.get(arg.raw_data);
    if (target === undefined) throw new Error(`Unknown label reference 0x${arg.raw_data.toString(16)}`);
    arg.raw_data = (target - headerLen) >> 2;
  }

  // 组装字符串区
  const stringData = [];
  let currentStringOffset = dataArrayEnd;
  for (const [instrIdx, argIdx] of stringArguments) {
    const arg = instructions[instrIdx].args[argIdx];
    let bytes = arg.bytes || Buffer.alloc(0);
    if (header.isVer5) {
      // v5：bytes 为 UTF-16LE；按 u16 字符计数（=bytes.length/2）
      const charCount = bytes.length / 2;
      arg.raw_data = (currentStringOffset - headerLen) >> 2;
      currentStringOffset += (charCount + 1) * 2;
      for (let b = 0; b < bytes.length; b++) stringData.push(bytes[b] ^ 0xFF);
      const padding = 4 - (currentStringOffset % 4);
      for (let k = 0; k < padding + 2; k++) stringData.push(0xFF);
      currentStringOffset += padding;
    } else {
      arg.raw_data = (currentStringOffset - headerLen) >> 2;
      currentStringOffset += bytes.length + 1;
      for (const b of bytes) stringData.push(b ^ 0xFF);
      const padding = 4 - (currentStringOffset % 4);
      for (let k = 0; k < padding + 1; k++) stringData.push(0xFF);
      currentStringOffset += padding;
    }
  }

  // 组装 footer（数组块 + 三张表）
  const footerData = [];
  let currentArrayOffset = (currentStringOffset - headerLen) >> 2;
  for (const [instrIdx, argIdx] of arrayArguments) {
    const arg = instructions[instrIdx].args[argIdx];
    arg.raw_data = currentArrayOffset;
    footerData.push(arg.data_array.length);
    currentArrayOffset += arg.data_array.length + 1;
    footerData.push(...arg.data_array.data);
  }

  const toIndex = (off) => (off - headerLen) >> 2;
  const sorted = (set) => [...set].map(toIndex).sort((a, b) => a - b);

  const instr71Vec = sorted(instr71Offsets);
  footerData.push(...instr71Vec);
  header.fields.table_1_length = instr71Vec.length;
  header.fields.table_1_offset = currentArrayOffset;

  const instr3Vec = sorted(instr3Offsets);
  footerData.push(...instr3Vec);
  header.fields.table_2_length = instr3Vec.length;
  header.fields.table_2_offset = header.fields.table_1_offset + header.fields.table_1_length;

  const instr8fVec = sorted(instr8fOffsets);
  footerData.push(...instr8fVec);
  header.fields.table_3_length = instr8fVec.length;
  header.fields.table_3_offset = header.fields.table_2_offset + header.fields.table_2_length;

  // 写字节
  const parts = [writeHeaderBytes(header)];
  const code = Buffer.alloc(dataArrayEnd - headerLen);
  let pos = 0;
  for (const instr of instructions) {
    code.writeUInt32LE(instr.def.opcode, pos); pos += 4;
    for (const arg of instr.args) {
      code.writeUInt32LE(arg.type >>> 0, pos); pos += 4;
      code.writeUInt32LE(arg.raw_data >>> 0, pos); pos += 4;
    }
  }
  parts.push(code);
  parts.push(Buffer.from(stringData));
  const footer = Buffer.alloc(footerData.length * 4);
  for (let k = 0; k < footerData.length; k++) footer.writeUInt32LE(footerData[k] >>> 0, k * 4);
  parts.push(footer);

  return Buffer.concat(parts);
}
