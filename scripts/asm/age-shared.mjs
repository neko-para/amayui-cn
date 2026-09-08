// age-shared.mjs —— AGE 脚本反汇编/重汇编共享层（data-driven opcode 表 + 头部结构 + 码页）
//
// 对应 C++ age-shared.h / age-shared.cpp 的移植。差异：
//  - 指令集不再编译进二进制，改由 ./opcodes.json 运行时加载（更新指令集=改 JSON，无需重编译）。
//  - 码页转换用 iconv-lite（与工程 scripts/lib/sjis-encode.js 同一依赖），不依赖 Windows CRT。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CP_UTF8 = 65001;
export const CP_UTF16 = 1200;
export const CP_932 = 932;
export const CP_936 = 936;

export function parseCodepage(s) {
  if (s === 'utf8' || s === 'utf-8') return CP_UTF8;
  if (s === 'sjis' || s === 'shiftjis' || s === 'shift-jis') return CP_932;
  if (s === 'gbk') return CP_936;
  const n = parseInt(s, 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function iconvName(cp) {
  switch (cp) {
    case CP_UTF8: return 'utf-8';
    case CP_UTF16: return 'utf16le';
    case CP_932: return 'shift_jis';
    case CP_936: return 'gbk';
    default: return null;
  }
}

// 对应 C++ cp_to_utf16(code_page, input)：把 bytes（按 code_page 编码）解码成 UTF-16 字符串（JS string 即 UTF-16）。
export function cpToUtf16(cp, input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'latin1');
  if (cp === CP_932) return decodeCp932(buf);
  const name = iconvName(cp);
  if (!name) return '';
  return iconv.decode(buf, name);
}

// 对应 C++ utf16_to_cp(code_page, input)：把 UTF-16 字符串编码为 code_page 字节。
// CP936 沿用 C++ 对几个不可编码字符的直接字节映射，保证行为一致。
export function utf16ToCp(cp, input) {
  const s = String(input);
  if (cp === CP_932) return encodeCp932(s);
  if (cp === CP_936) {
    const out = [];
    for (const ch of s) {
      // GBK 不可编码/映射差异字符，直接写标准 GBK 字节（与 C++ utf16_to_cp(CP_936) 一致）
      switch (ch) {
        case '\u30FB': out.push(0xA1, 0xA4); continue; // ・ -> ·
        case '\uFA19': out.push(0xC9, 0xF1); continue; // 神 -> 神
        case '\u266A': out.push(0xA1, 0xA1); continue; // ♪ -> 全角空格
        case '\u246E': out.push(0xA2, 0xE2); continue; // ⑮ -> ⑩
        default: break;
      }
      const b = iconv.encode(ch, 'gbk');
      out.push(...b);
    }
    return Buffer.from(out);
  }
  const name = iconvName(cp);
  if (!name) return Buffer.alloc(0);
  return iconv.encode(s, name);
}

// ---------------------------------------------------------------------------
// CP932（Windows-31J）：标准 JIS X 0208 交由 iconv-lite；游戏外字（UDC / PUA）
// 区域 0xF040–0xF9FC ↔ U+E000–U+E757 线性映射必须自行处理（iconv-lite 尾部有误）。
// 0xFA40–0xFCFC 该作未使用，命中时按线性续延处理以保内部往返一致。
// ---------------------------------------------------------------------------
function cp932GaijiLeadTrail(offset) {
  const lead = 0xF0 + Math.floor(offset / 188);
  const idx = offset % 188;
  const trail = idx < 63 ? idx + 0x40 : idx - 63 + 0x80;
  return [lead, trail];
}

function cp932GaijiIndex(lead, trail) {
  const trailIndex = trail < 0x7F ? trail - 0x40 : trail - 0x41;
  return (lead - 0xF0) * 188 + trailIndex;
}

export function decodeCp932(buf) {
  if (!buf) return '';
  let out = '';
  let p = 0;
  while (p < buf.length) {
    const b = buf[p];
    if (b < 0x80) { out += String.fromCharCode(b); p++; continue; }
    if (p + 1 < buf.length) {
      const t = buf[p + 1];
      const validTrail = (0x40 <= t && t <= 0x7E) || (0x80 <= t && t <= 0xFC);
      if (validTrail && 0xF0 <= b && b <= 0xFC) {
        const offset = cp932GaijiIndex(b, t);
        out += String.fromCharCode(0xE000 + offset);
        p += 2;
        continue;
      }
      if (validTrail && b <= 0xFC) {
        out += iconv.decode(buf.subarray(p, p + 2), 'shift_jis');
        p += 2;
        continue;
      }
    }
    out += iconv.decode(buf.subarray(p, p + 1), 'shift_jis');
    p += 1;
  }
  return out;
}

export function encodeCp932(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (0xE000 <= cp && cp <= 0xE757) {
      const [lead, trail] = cp932GaijiLeadTrail(cp - 0xE000);
      out.push(lead, trail);
      continue;
    }
    const b = iconv.encode(ch, 'shift_jis');
    out.push(...b);
  }
  return Buffer.from(out);
}


// ---------------------------------------------------------------------------
// 指令表（data-driven）
// ---------------------------------------------------------------------------
export function loadOpcodeTable(file) {
  const p = file || path.join(__dirname, 'opcodes.json');
  const entries = JSON.parse(fs.readFileSync(p, 'utf8'));
  const byOpcode = new Map();
  const byLabel = new Map();
  for (const e of entries) {
    if (byOpcode.has(e.opcode)) {
      throw new Error(`opcodes.json 重复 opcode 0x${e.opcode.toString(16)}`);
    }
    byOpcode.set(e.opcode, e);
    byLabel.set(e.name, e);
    for (const a of e.aliases || []) {
      if (!byLabel.has(a)) byLabel.set(a, e);
    }
  }
  return { entries, byOpcode, byLabel };
}

export function instructionForOpCode(table, op) {
  return table.byOpcode.get(op) ?? null;
}

export function instructionForLabel(table, label) {
  return table.byLabel.get(label) ?? null;
}

/** opcodeLabel: 指令的显示名 —— 有助记符用助记符；无助记符（name 为空）则按 opcode 生成规范 iXXX。 */
export function opcodeLabel(def) {
  if (def.name) return def.name;
  return 'i' + (def.opcode >>> 0).toString(16).padStart(3, '0');
}

/** instructionForToken: 解析指令 token —— 先按助记符（name/aliases）查询；
 *  否则若形如规范 `iXXX`（i + hex），则按 opcode 反查（编译期自动生成，不落 JSON）。 */
export function instructionForToken(table, token) {
  const found = table.byLabel.get(token);
  if (found) return found;
  const m = /^i([0-9a-fA-F]+)$/.exec(token);
  if (m) return table.byOpcode.get(parseInt(m[1], 16)) ?? null;
  return null;
}

export const isControlFlowOpcode = (op) =>
  [0x8C, 0x8F, 0xA0, 0xCC, 0xFB, 0xD4, 0x90, 0x7B, 0xA2, 0xA3].includes(op);

export const isArrayOpcode = (op) => op === 0x64;

export function isLabelArgument(instr, x) {
  const { opcode } = instr.def;
  const raw = instr.args[x].raw_data;
  if ((opcode === 0x8C || opcode === 0x8F) && raw !== 0xFFFFFFFF) return true;
  if (opcode === 0xA0 && x > 0 && raw !== 0xFFFFFFFF) return true;
  if ((opcode === 0xCC || opcode === 0xFB) && x > 0 && raw !== 0xFFFFFFFF) return true;
  if (opcode === 0xD4 && x >= 2 && raw !== 0xFFFFFFFF) return true;
  if (opcode === 0x90 && x >= 4 && raw !== 0xFFFFFFFF) return true;
  if (opcode === 0x7B && raw !== 0xFFFFFFFF) return true;
  // 菜单派发：menu-bind(op2=目标 label) / menu-dispatch(op2=回退 label) 的第 2 个操作数是 label。
  if ((opcode === 0xA2 || opcode === 0xA3) && x === 1 && raw !== 0xFFFFFFFF) return true;
  return false;
}

export function getTypeLabel(type) {
  switch (type) {
    case 0: return '';
    case 1: return 'float';
    case 2: return '';
    case 3: return 'global-int';
    case 4: return 'global-float';
    case 5: return 'global-string';
    case 6: return 'global-ptr';
    case 8: return 'global-string-ptr';
    case 9: return 'local-int';
    case 0xA: return 'local-float';
    case 0xB: return 'local-string';
    case 0xC: return 'local-ptr';
    case 0xD: return 'local-float-ptr';
    case 0xE: return 'local-string-ptr';
    case 0x8003: return '0x8003';
    case 0x8005: return '0x8005';
    case 0x8009: return '0x8009';
    case 0x800B: return '0x800B';
    default:
      throw new Error(`Unknown type value: ${type.toString(16)}`);
  }
}

export function getType(name) {
  const map = {
    'local-int': 9, 'local-ptr': 0xC, 'global-int': 3, 'global-float': 4,
    'global-string': 5, 'global-ptr': 6, 'global-string-ptr': 8,
    'local-float': 0xA, 'local-string': 0xB, 'local-string-ptr': 0xE,
    float: 1, 'local-float-ptr': 0xD,
  };
  if (name in map) return map[name];
  const special = {
    '0x8003': 0x8003, '0x8005': 0x8005, '0x8009': 0x8009, '0x800B': 0x800B,
    'unknown0x8003': 0x8003, 'unknown0x8005': 0x8005,
    'unknown0x8009': 0x8009, 'unknown0x800B': 0x800B,
  };
  if (name in special) return special[name];
  throw new Error(`Unknown variable type: ${name}`);
}

// ---------------------------------------------------------------------------
// 头部结构
// ---------------------------------------------------------------------------
const S4_SIG = Buffer.from('SYS4', 'latin1');
// v5 签名前 4 字节为 UTF-16LE "SY"（0x53 0x00 0x59 0x00）
export const S5_SIG4 = Buffer.from([0x53, 0x00, 0x59, 0x00]);

// 从 Buffer 的 offset 处解析 BinaryHeader 的数值字段（local_* 与三张表）。
function parseNumericFields(buf, offset) {
  const rd = (o) => buf.readUInt32LE(offset + o);
  return {
    local_integer_1: rd(8),
    local_floats: rd(12),
    local_strings_1: rd(16),
    local_integer_2: rd(20),
    unknown_data: rd(24),
    local_strings_2: rd(28),
    sub_header_length: rd(32),
    table_1_length: rd(36),
    table_1_offset: rd(40),
    table_2_length: rd(44),
    table_2_offset: rd(48),
    table_3_length: rd(52),
    table_3_offset: rd(56),
  };
}

// 解析脚本头字节 → Header。返回 { fields, isVer5, length, signature(显示串), sigBytes }。
export function readHeader(buf) {
  if (buf.length < 4) throw new Error('file too small');
  const sig4 = buf.subarray(0, 4);
  if (sig4.equals(S4_SIG)) {
    return {
      fields: parseNumericFields(buf, 0),
      isVer5: false,
      length: 0x3C,
      signature: buf.subarray(0, 8).toString('latin1'),
      sigBytes: Buffer.from(buf.subarray(0, 8)),
    };
  }
  if (sig4.equals(S5_SIG4)) {
    const sig16 = buf.subarray(0, 16);
    const utf8sig = iconv.decode(sig16, 'utf16le').replace(/[\u0000]+$/, '');
    return {
      fields: parseNumericFields(buf, 16),
      isVer5: true,
      length: 0x44,
      signature: utf8sig,
      sigBytes: Buffer.from(sig16),
    };
  }
  throw new Error('Could not determine header version!');
}

export function computeHeaderLength(fields) {
  return fields; // placeholder for readability
}

// 组装头部字节（v4 全 0x3C；v5 写 UTF-16 签名 + 数值字段）。
export function writeHeaderBytes(header) {
  const { fields, isVer5, signature } = header;
  const out = isVer5 ? Buffer.alloc(0x44) : Buffer.alloc(0x3C);
  const wr = (o, v) => out.writeUInt32LE(v >>> 0, o);
  if (isVer5) {
    // signature 按 UTF-8 文本 → UTF-16LE 写入前 16 字节
    const utf8sig = signature.replace(/[\u0000]+$/, '') || 'SYS5501 ';
    const u16 = iconv.encode(utf8sig, 'utf16le');
    u16.copy(out, 0);
    // 数值字段写第 16 字节起（0x44-0x10=0x34=52 字节）
    wr(16, fields.local_integer_1); wr(20, fields.local_floats);
    wr(24, fields.local_strings_1); wr(28, fields.local_integer_2);
    wr(32, fields.unknown_data); wr(36, fields.local_strings_2);
    wr(40, fields.sub_header_length);
    wr(44, fields.table_1_length); wr(48, fields.table_1_offset);
    wr(52, fields.table_2_length); wr(56, fields.table_2_offset);
    wr(60, fields.table_3_length); wr(64, fields.table_3_offset);
  } else {
    // signature 8 字节按 latin1 写
    const sigBytes = Buffer.isBuffer(signature) ? signature : Buffer.from(String(signature || '        '), 'latin1');
    sigBytes.copy(out, 0);
    wr(8, fields.local_integer_1); wr(12, fields.local_floats);
    wr(16, fields.local_strings_1); wr(20, fields.local_integer_2);
    wr(24, fields.unknown_data); wr(28, fields.local_strings_2);
    wr(32, fields.sub_header_length);
    wr(36, fields.table_1_length); wr(40, fields.table_1_offset);
    wr(44, fields.table_2_length); wr(48, fields.table_2_offset);
    wr(52, fields.table_3_length); wr(56, fields.table_3_offset);
  }
  return out;
}

// 辅助：十六进制格式化（C++ std::hex 默认小写）
export function hex(v) {
  return (v >>> 0).toString(16);
}

// 8 位小写十六进制，零填充（对应 std::setw(8)<<std::setfill('0')<<std::hex）
export function labelHex(v) {
  return (v >>> 0).toString(16).padStart(8, '0');
}
