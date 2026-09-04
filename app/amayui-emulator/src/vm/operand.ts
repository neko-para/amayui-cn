/**
 * 操作数访问原语：读/写第 N 个操作数（N 为 1-based，对应 docs/re/engine/03/05）。
 *
 * 指针操作数语义（ADR-011 / docs/07-pointer-operand-model.md，改自此前的错误实现）：
 *  - 指针型操作数（global-ptr/local-ptr/string-ptr/float-ptr）是**引用**：
 *      * `readIntOperand(ptr)` = **解引用**取所指处值；
 *      * `writeIntOperand(ptr)` = **写穿**到所指处；
 *      * 指针池存 `Ref | 0`（见 ./ref.ts），`lea`/`lookup-array` 用 `setRefOperand` 设引用。
 *  - 地址**从不**作为数值进入普通运算域。
 *  - 直接型（int/float/string）仍是普通值槽。
 */
import type { Engine, Frame } from './engine.js';
import type { BinInstruction } from '../script/bin.js';
import { dec, enc, i32, atoi } from './bits.js';
import { isRef, readRef, writeRef, STRIDE_INT, STRIDE_STR, type Ref } from './ref.js';

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

function isPtrType(t: number): boolean {
  return t === TYPE_GLOBAL_PTR || t === TYPE_GLOBAL_FLOAT_PTR || t === TYPE_LOCAL_PTR || t === TYPE_LOCAL_FLOAT_PTR;
}

export function operandArg(instr: BinInstruction, n: number) {
  const a = instr.args[n - 1];
  if (!a) throw new Error(`operand ${n} out of range for opcode 0x${instr.opcode.toString(16)} (${instr.name})`);
  return a;
}

/** 读一个指针池槽里的 Ref；空引用/非 Ref 即报错。 */
function readRefSlot(pool: Map<number, Ref | 0>, index: number): Ref {
  const v = pool.get(index);
  if (v === undefined || v === 0) throw new Error(`空/未初始化引用被取址：指针池槽 ${index}`);
  if (!isRef(v)) throw new Error(`指针池槽 ${index} 存的不是 Ref（${String(v)}）`);
  return v;
}

/**
 * 由操作数构造 Ref（lea/lookup-array 的"取址"底座）。
 *  - 直接型（int/float/string）：Ref{scope, kind, index=raw, stride}（指向该操作数槽所在位置）。
 *  - 指针型：返回该指针槽**已存**的 Ref（=所指处地址，即别名拷贝；引擎 sub_42AEA0 对指针型返回所指处地址）。
 */
export function refFromOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): Ref {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_INT: return { scope: 'global', kind: 'int', index: a.raw, stride: STRIDE_INT };
    case TYPE_GLOBAL_FLOAT: return { scope: 'global', kind: 'float', index: a.raw, stride: STRIDE_INT };
    case TYPE_GLOBAL_STRING: return { scope: 'global', kind: 'str', index: a.raw, stride: STRIDE_STR };
    case TYPE_LOCAL_INT: return { scope: 'local', kind: 'int', index: a.raw, stride: STRIDE_INT };
    case TYPE_LOCAL_FLOAT: return { scope: 'local', kind: 'float', index: a.raw, stride: STRIDE_INT };
    case TYPE_LOCAL_STRING:
    case TYPE_LOCAL_STRING2: return { scope: 'local', kind: 'str', index: a.raw, stride: STRIDE_STR };
    case TYPE_GLOBAL_PTR: return readRefSlot(e.globals.ptr, a.raw);
    case TYPE_GLOBAL_FLOAT_PTR: return readRefSlot(e.globals.floatPtr, a.raw);
    case TYPE_LOCAL_PTR: return readRefSlot(frame.locals.ptr, a.raw);
    case TYPE_LOCAL_FLOAT_PTR: return readRefSlot(frame.locals.floatPtr, a.raw);
    default:
      throw new Error(`refFromOperand: unsupported operand type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 把 Ref 写入一个指针型操作数槽（lea/lookup-array 设置引用用；非指针型 dest 报错）。 */
export function setRefOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number, ref: Ref): void {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_PTR: e.globals.ptr.set(a.raw, ref); return;
    case TYPE_GLOBAL_FLOAT_PTR: e.globals.floatPtr.set(a.raw, ref); return;
    case TYPE_LOCAL_PTR: frame.locals.ptr.set(a.raw, ref); return;
    case TYPE_LOCAL_FLOAT_PTR: frame.locals.floatPtr.set(a.raw, ref); return;
    default:
      throw new Error(`setRefOperand: dest 非指针型 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 读第 n 个操作数为字符串（用于 string→resource-id 之类的子系统 op；非字符串型取 raw 兜底）。 */
export function readStringOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): string {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_LOCAL_STRING:
    case TYPE_LOCAL_STRING2:
      return a.str ?? String(frame.locals.str.get(a.raw) ?? '');
    case TYPE_GLOBAL_STRING:
      return e.globals.str.get(a.raw) ?? '';
    case TYPE_IMMEDIATE_INT:
    case TYPE_IMMEDIATE_FLOAT:
    default:
      return String(a.raw);
  }
}

/** 把 u32 位模式解释成 float32（用于立即 float 操作数）。 */
function floatBits(bits: number): number {
  return new Float32Array(new Uint32Array([bits >>> 0]).buffer)[0]!;
}

/** 写第 n 个操作数为字符串（set-string / concat 目标串槽）。 */
export function writeStringOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number, s: string): void {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_STRING: e.globals.str.set(a.raw, s); return;
    case TYPE_LOCAL_STRING:
    case TYPE_LOCAL_STRING2: frame.locals.str.set(a.raw, s); return;
    default: throw new Error(`writeStringOperand: dest 非字符串型 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 读第 n 个操作数为 float（float 池存 JS 数；立即 float 走位模式）。 */
export function readFloatOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): number {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_IMMEDIATE_FLOAT: return floatBits(a.raw);
    case TYPE_GLOBAL_FLOAT: return (e.globals.float.get(a.raw) ?? 0);
    case TYPE_LOCAL_FLOAT: return (frame.locals.float.get(a.raw) ?? 0);
    default: return readIntOperand(e, frame, instr, n);
  }
}

/** 写第 n 个操作数为 float。 */
export function writeFloatOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number, v: number): void {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_FLOAT: e.globals.float.set(a.raw, v); return;
    case TYPE_LOCAL_FLOAT: frame.locals.float.set(a.raw, v); return;
    default: writeIntOperand(e, frame, instr, n, v | 0);
  }
}

/** 读第 n 个操作数为整数（int 槽过 DEC；指针型 = 解引用取所指值）。 */
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
    case TYPE_GLOBAL_FLOAT_PTR:
    case TYPE_LOCAL_PTR:
    case TYPE_LOCAL_FLOAT_PTR:
      // 指针操作数：解引用取所指处值（ADR-011）
      return readRef(e, frame, refFromOperand(e, frame, instr, n));
    case TYPE_LOCAL_INT:
      return i32(dec(e.key, frame.locals.int.get(a.raw) ?? 0));
    case TYPE_LOCAL_FLOAT:
      return (frame.locals.float.get(a.raw) ?? 0) | 0;
    case TYPE_GLOBAL_INT_ARRAY:
      return i32(dec(e.key, e.globals.int.get(a.raw) ?? 0));
    case TYPE_LOCAL_INT_ARRAY:
      return i32(dec(e.key, frame.locals.int.get(a.raw) ?? 0));
    default:
      throw new Error(`readIntOperand: unsupported type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 写第 n 个操作数（int 槽过 ENC；指针型 = 写穿到所指处）。 */
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
    case TYPE_GLOBAL_FLOAT_PTR:
    case TYPE_LOCAL_PTR:
    case TYPE_LOCAL_FLOAT_PTR:
      // 指针操作数：写穿到所指处（ADR-011）；设引用请用 setRefOperand
      writeRef(e, frame, refFromOperand(e, frame, instr, n), value);
      return;
    case TYPE_LOCAL_INT:
      frame.locals.int.set(a.raw, enc(e.key, value));
      return;
    case TYPE_LOCAL_FLOAT:
      frame.locals.float.set(a.raw, value);
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
