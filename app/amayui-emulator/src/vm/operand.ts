/** 操作数访问原语：读/写第 N 个操作数（N 为 1-based，对应 docs/re/engine/03/05）。 */
import type { Engine, Frame } from './engine.js';
import type { BinInstruction } from '../script/bin.js';
import { dec, enc, i32 } from './bits.js';

const TYPE_IMMEDIATE_INT = 0x0;
const TYPE_IMMEDIATE_FLOAT = 0x1;
const TYPE_LOCAL_STRING = 0x2;
const TYPE_GLOBAL_INT = 0x3;
const TYPE_GLOBAL_FLOAT = 0x4;
const TYPE_GLOBAL_STRING = 0x5;
const TYPE_GLOBAL_PTR = 0x6;
const TYPE_GLOBAL_FLOAT_PTR = 0x7;
const TYPE_LOCAL_INT = 0x9;
const TYPE_LOCAL_FLOAT = 0xa;
const TYPE_LOCAL_STRING2 = 0xb;
const TYPE_LOCAL_PTR = 0xc;
const TYPE_LOCAL_FLOAT_PTR = 0xd;
const TYPE_GLOBAL_INT_ARRAY = 0x8003;
const TYPE_LOCAL_INT_ARRAY = 0x8009;

export function operandArg(instr: BinInstruction, n: number) {
  const a = instr.args[n - 1];
  if (!a) throw new Error(`operand ${n} out of range for opcode 0x${instr.opcode.toString(16)} (${instr.name})`);
  return a;
}

/** 读第 n 个操作数为整数（int 槽过 DEC）。 */
export function readIntOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): number {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_IMMEDIATE_INT:
      return a.raw | 0; // 立即数按 i32
    case TYPE_IMMEDIATE_FLOAT:
      return a.raw | 0; // float 位模式转 int
    case TYPE_LOCAL_STRING:
    case TYPE_LOCAL_STRING2:
      return atoi(a.str ?? String(frame.locals.str.get(a.raw) ?? ''));
    case TYPE_GLOBAL_INT:
      return i32(dec(e.key, e.globals.int.get(a.raw) ?? 0));
    case TYPE_GLOBAL_FLOAT:
      return (e.globals.float.get(a.raw) ?? 0) | 0;
    case TYPE_GLOBAL_STRING:
      return atoi(e.globals.str.get(a.raw) ?? '');
    case TYPE_GLOBAL_PTR:
      return i32(dec(e.key, e.globals.ptr.get(a.raw) ?? 0));
    case TYPE_GLOBAL_FLOAT_PTR:
      return (e.globals.floatPtr.get(a.raw) ?? 0) | 0;
    case TYPE_LOCAL_INT:
      return i32(dec(e.key, frame.locals.int.get(a.raw) ?? 0));
    case TYPE_LOCAL_FLOAT:
      return (frame.locals.float.get(a.raw) ?? 0) | 0;
    case TYPE_LOCAL_PTR:
      return i32(dec(e.key, frame.locals.ptr.get(a.raw) ?? 0));
    case TYPE_LOCAL_FLOAT_PTR:
      return (frame.locals.floatPtr.get(a.raw) ?? 0) | 0;
    case TYPE_GLOBAL_INT_ARRAY:
      return i32(dec(e.key, e.globals.int.get(a.raw) ?? 0));
    case TYPE_LOCAL_INT_ARRAY:
      return i32(dec(e.key, frame.locals.int.get(a.raw) ?? 0));
    default:
      throw new Error(`readIntOperand: unsupported type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 写第 n 个操作数（int 槽过 ENC）。 */
export function writeIntOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number, value: number): void {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_INT:
      e.globals.int.set(a.raw, enc(e.key, value));
      return;
    case TYPE_GLOBAL_FLOAT:
      e.globals.float.set(a.raw, value);
      return;
    case TYPE_GLOBAL_PTR:
      e.globals.ptr.set(a.raw, enc(e.key, value));
      return;
    case TYPE_GLOBAL_FLOAT_PTR:
      e.globals.floatPtr.set(a.raw, value);
      return;
    case TYPE_LOCAL_INT:
      frame.locals.int.set(a.raw, enc(e.key, value));
      return;
    case TYPE_LOCAL_FLOAT:
      frame.locals.float.set(a.raw, value);
      return;
    case TYPE_LOCAL_PTR:
      frame.locals.ptr.set(a.raw, enc(e.key, value));
      return;
    case TYPE_LOCAL_FLOAT_PTR:
      frame.locals.floatPtr.set(a.raw, value);
      return;
    case TYPE_GLOBAL_INT_ARRAY:
      e.globals.int.set(a.raw, enc(e.key, value));
      return;
    case TYPE_LOCAL_INT_ARRAY:
      frame.locals.int.set(a.raw, enc(e.key, value));
      return;
    default:
      throw new Error(`writeIntOperand: unsupported type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 简单 atoi（字符串 -> int；age 语义：解析十进制前缀，空/失败返 0）。 */
function atoi(s: string): number {
  const m = /^\s*[+-]?\d+/.exec(s);
  if (!m) return 0;
  const v = Number.parseInt(m[0], 10);
  return Number.isFinite(v) ? v | 0 : 0;
}
