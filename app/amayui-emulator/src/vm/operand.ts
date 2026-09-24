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
import { enc, atoi } from './bits.js';
import { isRef, readRef, writeRef, decIntSlot, STRIDE_INT, STRIDE_STR, type Ref } from './ref.js';

const TYPE_IMMEDIATE_INT = 0x0;
const TYPE_IMMEDIATE_FLOAT = 0x1;
const TYPE_LOCAL_STRING = 0x2;
const TYPE_GLOBAL_INT = 0x3;
const TYPE_GLOBAL_FLOAT = 0x4;
const TYPE_GLOBAL_STRING = 0x5;
const TYPE_GLOBAL_PTR = 0x6;
const TYPE_GLOBAL_FLOAT_PTR = 0x7;
const TYPE_GLOBAL_STRING_PTR = 0x8;
const TYPE_LOCAL_INT = 0x9;
const TYPE_LOCAL_FLOAT = 0xa;
const TYPE_LOCAL_STRING2 = 0xb;
const TYPE_LOCAL_PTR = 0xc;
const TYPE_LOCAL_FLOAT_PTR = 0xd;
const TYPE_LOCAL_STRING_PTR = 0xe;
const TYPE_GLOBAL_INT_ARRAY = 0x8003;
const TYPE_LOCAL_INT_ARRAY = 0x8009;
/**
 * 其余「数组」操作数标签（低 3 位与直接型同构：3=int / 4=float / 5=string，9/A/B = 局部）：
 * `0x8004`/`0x800A` = 全局/局部 **float 数组**、`0x8005`/`0x800B` = 全局/局部 **字符串数组**。
 * 引擎侧证据：`0x2C9`（sub_4344A0 raw 42494-42522）按 `op2` 的 tag 分派 ——
 * `0x8003/0x8009` 走 4 字节元素（int 向量）、`0x8005/0x800B` 走 **28 字节元素**（`std::string` 向量，
 * 与 `STRIDE_STR` 一致），其余 tag ⇒ 抛 `Command_Type_Exception`。
 * ★这些标签此前**完全没有被建模**：`refFromOperand` 遇到就抛，于是任何"数组型操作数"的取址都用不了。
 */
const TYPE_GLOBAL_FLOAT_ARRAY = 0x8004;
const TYPE_GLOBAL_STRING_ARRAY = 0x8005;
const TYPE_LOCAL_FLOAT_ARRAY = 0x800a;
const TYPE_LOCAL_STRING_ARRAY = 0x800b;

function isPtrType(t: number): boolean {
  return (
    t === TYPE_GLOBAL_PTR ||
    t === TYPE_GLOBAL_FLOAT_PTR ||
    t === TYPE_GLOBAL_STRING_PTR ||
    t === TYPE_LOCAL_PTR ||
    t === TYPE_LOCAL_FLOAT_PTR ||
    t === TYPE_LOCAL_STRING_PTR
  );
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

/** 取字符串池（按 Ref 的 scope）；kind 须为 'str'。 */
function strPoolFor(e: Engine, frame: Frame, ref: Ref): Map<number, string> {
  if (ref.kind !== 'str') throw new Error(`字符串解引用坏 kind ${ref.kind}`);
  return ref.scope === 'global' ? e.globals.str : frame.locals.str;
}

/** 读一个字符串 Ref 所指的字符串（解引用；指针族递归一次，str 取池值）。 */
function readStringRef(e: Engine, frame: Frame, ref: Ref): string {
  if (ref.kind === 'ptr' || ref.kind === 'fptr') {
    const inner = strPtrForRef(e, frame, ref);
    return readStringRef(e, frame, inner);
  }
  return String(strPoolFor(e, frame, ref).get(ref.index) ?? '');
}

/** 指针族再取一次 Ref（string ref 的 strPtr 池）。 */
function strPtrForRef(e: Engine, frame: Frame, ref: Ref): Ref {
  const pool = ref.scope === 'global' ? e.globals.strPtr : frame.locals.strPtr;
  return readRefSlot(pool, ref.index);
}

/** 写穿一个字符串 Ref（写字符串池）。 */
function writeStringRef(e: Engine, frame: Frame, ref: Ref, s: string): void {
  if (ref.kind === 'ptr' || ref.kind === 'fptr') {
    writeStringRef(e, frame, strPtrForRef(e, frame, ref), s);
    return;
  }
  strPoolFor(e, frame, ref).set(ref.index, s);
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
    case TYPE_GLOBAL_STRING_PTR: return readRefSlot(e.globals.strPtr, a.raw);
    case TYPE_LOCAL_PTR: return readRefSlot(frame.locals.ptr, a.raw);
    case TYPE_LOCAL_FLOAT_PTR: return readRefSlot(frame.locals.floatPtr, a.raw);
    case TYPE_LOCAL_STRING_PTR: return readRefSlot(frame.locals.strPtr, a.raw);
    // 数组型操作数（`0x8003` 族）：**基址就在槽号 `a.raw` 处**，元素由 `refAt` 按 stride 平移。
    // 这与 `readIntOperand(0x8003)`（把它当"该数组首元素所在槽"读一个值）互相一致。
    case TYPE_GLOBAL_INT_ARRAY: return { scope: 'global', kind: 'int', index: a.raw, stride: STRIDE_INT };
    case TYPE_GLOBAL_FLOAT_ARRAY: return { scope: 'global', kind: 'float', index: a.raw, stride: STRIDE_INT };
    case TYPE_GLOBAL_STRING_ARRAY: return { scope: 'global', kind: 'str', index: a.raw, stride: STRIDE_STR };
    case TYPE_LOCAL_INT_ARRAY: return { scope: 'local', kind: 'int', index: a.raw, stride: STRIDE_INT };
    case TYPE_LOCAL_FLOAT_ARRAY: return { scope: 'local', kind: 'float', index: a.raw, stride: STRIDE_INT };
    case TYPE_LOCAL_STRING_ARRAY: return { scope: 'local', kind: 'str', index: a.raw, stride: STRIDE_STR };
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
    case TYPE_GLOBAL_STRING_PTR: e.globals.strPtr.set(a.raw, ref); return;
    case TYPE_LOCAL_PTR: frame.locals.ptr.set(a.raw, ref); return;
    case TYPE_LOCAL_FLOAT_PTR: frame.locals.floatPtr.set(a.raw, ref); return;
    case TYPE_LOCAL_STRING_PTR: frame.locals.strPtr.set(a.raw, ref); return;
    default:
      throw new Error(`setRefOperand: dest 非指针型 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 引擎 `_itoa_s(v, buf, 0x400, 10)` 的等价物：**有符号 32 位十进制**（无前导零/空格）。 */
function intToDecimal(v: number): string {
  return String(v | 0);
}

/**
 * 引擎 `sub_408050(buf, 1024, "%lf", v)` 的等价物：C `%lf` 的**默认精度 6**（非有限值按 C 的 `nan`/`inf` 形态）。
 */
function floatToLf(v: number): string {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  return v.toFixed(6);
}

/**
 * 读第 n 个操作数为字符串（引擎「取字符串」原语：`sub_41B640` raw 26248-26359 / `sub_42A420` raw 36317-36544 /
 * `sub_41B9B0` raw 26365-26470 三条**同构**）。
 *
 * ★**引擎的这条原语带"数值 → 字符串"强制转换**，逐 case 对照（以 `sub_41B640` 为准，另两条同形）：
 *
 * | operand tag | 引擎行为 | 本实现 |
 * |---|---|---|
 * | `0` 立即 int | `_itoa_s(*v8, buf, 0x400, 10)` | `String(raw \| 0)` |
 * | `1` 立即 float | `sub_408050(…, "%lf", *(float*)v8)` | `floatBits(raw).toFixed(6)` |
 * | `2` 内嵌字面量（倒置存储：逐 dword 取反到 0xFF 结尾） | 解倒置后原样用 | 解析器已解出 `a.str` |
 * | `3`/`9` 全局/局部 int 值池 | `_itoa_s(DEC(池值), …, 10)` | `readIntOperand`（含 DEC）→ 十进制 |
 * | `4`/`10` 全局/局部 float 值池 | `%lf` | `readFloatOperand` → `%lf` |
 * | `5`/`11` 全局/局部 string 值池 | 取串（SSO：`+20 < 0x10` 内联） | 池取串 |
 * | `6`/`12` int 指针族 | `_itoa_s(DEC(*指针), …, 10)` | `readIntOperand`（解引用 + DEC）→ 十进制 |
 * | `7`/`13` float 指针族 | **`default:` ⇒ 抛 `Command_Type_Exception`**（引擎不支持） | 同样抛错 |
 * | `8`/`14` string 指针族 | 解引用取串 | `readStringRef` |
 * | `0x8003`/`0x8009` int 数组 | 首元素 `DEC` → `_itoa_s`；空容器 ⇒ 哨兵串 `asc_5205D4`(2 字节) | **未建模**（语料 0 处触发，见下） |
 *
 * 修前本函数对**全部数值族**一律 `String(a.raw)` —— 那返回的是**槽号**而不是值，于是 `0x192 set-string`/
 * `0x193 concat`/`0x1B2 text-append` 在真实语料上产出错串。语料命中（本次审计 `T-0165`）：
 * `COMMITDR.txt:9`（`concat … (global-int a40e1)`）、`FIELD.txt:8595/8710/9416`（`local-ptr`）、
 * `FIELD.txt:9365`（`local-int`）、`ALCHEMY.txt:1063`（`local-ptr`）、`REACH.txt:2243/2264`（`local-ptr`）、
 * `SYSTEM4.txt:463-464`（`i1b2 (global-int 0)`）。
 * 引擎依据：`analysis/functions.json` 的 `sub_41B640`/`sub_42A420`/`sub_41B9B0`；守卫 `test/op-string-coercion.test.ts`。
 */
export function readStringOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): string {
  const a = operandArg(instr, n);
  switch (a.type) {
    // ── 字符串族：原样取串（引擎 case 2/5/8/11/14）──
    case TYPE_LOCAL_STRING:
    case TYPE_LOCAL_STRING2:
      return a.str ?? String(frame.locals.str.get(a.raw) ?? '');
    case TYPE_GLOBAL_STRING:
      return e.globals.str.get(a.raw) ?? '';
    case TYPE_GLOBAL_STRING_PTR:
      return readStringRef(e, frame, readRefSlot(e.globals.strPtr, a.raw));
    case TYPE_LOCAL_STRING_PTR:
      return readStringRef(e, frame, readRefSlot(frame.locals.strPtr, a.raw));
    // ── 数值族：按引擎**转成十进制/浮点串**（★本轮修复：此前返回槽号）──
    case TYPE_IMMEDIATE_INT:
      return intToDecimal(a.raw);
    case TYPE_IMMEDIATE_FLOAT:
      return floatToLf(floatBits(a.raw));
    case TYPE_GLOBAL_INT:
    case TYPE_LOCAL_INT:
    case TYPE_GLOBAL_PTR:
    case TYPE_LOCAL_PTR:
      return intToDecimal(readIntOperand(e, frame, instr, n));
    case TYPE_GLOBAL_FLOAT:
    case TYPE_LOCAL_FLOAT:
      return floatToLf(readFloatOperand(e, frame, instr, n));
    // 引擎对 float 指针族走 `default:` ⇒ 抛 `Command_Type_Exception`（不是静默给个值）。
    case TYPE_GLOBAL_FLOAT_PTR:
    case TYPE_LOCAL_FLOAT_PTR:
      throw new Error(
        `readStringOperand: float 指针族 0x${a.type.toString(16)} 不能转字符串（引擎 sub_41B640/sub_42A420 的 default 分支抛 Command_Type_Exception）`,
      );
    // 数组族和其它未建模 tag：保持旧口径（语料 0 处触发），不静默改变已有行为。
    default:
      return String(a.raw);
  }
}

/** 把 u32 位模式解释成 float32（用于立即 float 操作数）。 */
function floatBits(bits: number): number {
  return new Float32Array(new Uint32Array([bits >>> 0]).buffer)[0]!;
}

/** 写第 n 个操作数为字符串（set-string / concat 目标串槽）。 */
/** 复用的位模式缓冲（把 float 编成 int32 位模式；模块级避免每次分配）。 */
const F32B = new Float32Array(1);
const I32B = new Int32Array(F32B.buffer);

export function writeStringOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number, s: string): void {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_STRING:
      e.globals.str.set(a.raw, s);
      // 事件里带字符串**长度**（条件语言不能比字符串；见 `Engine.debugEvent` 的说明）
      e.emitDebugEvent('global-str-write', { idx: a.raw, val: s.length });
      return;
    case TYPE_LOCAL_STRING:
    case TYPE_LOCAL_STRING2: frame.locals.str.set(a.raw, s); return;
    case TYPE_GLOBAL_STRING_PTR:
      writeStringRef(e, frame, readRefSlot(e.globals.strPtr, a.raw), s);
      return;
    case TYPE_LOCAL_STRING_PTR:
      writeStringRef(e, frame, readRefSlot(frame.locals.strPtr, a.raw), s);
      return;
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
    case TYPE_GLOBAL_FLOAT:
      e.globals.float.set(a.raw, v);
      // ★事件里带 **float 的 int32 位模式**（用 `Math.fround` 取单精度位模式，**不是** `| 0`）：
      //   `| 0` 是**截断**（1.5 → 1），那样 `f2i(val)` 就没有意义了；`Math.fround` 才能让
      //   `f2i(val) == 1.5` 成立，与调试条件语言里的 `f2i(...)` 配套。
      //   （本条件语言只比整数，所以 float 值必须先编码成位模式才能带进事件。）
      F32B[0] = v;
      e.emitDebugEvent('global-float-write', { idx: a.raw, val: I32B[0]! | 0 });
      return;
    case TYPE_LOCAL_FLOAT: frame.locals.float.set(a.raw, v); return;
    default: writeIntOperand(e, frame, instr, n, v | 0);
  }
}

/** 读第 n 个操作数为整数（int 槽过 DEC；指针型 = 解引用取所指值）。
 *
 * ★int 槽的缺省（脚本从未写过的槽）由 `decIntSlot` 统一给出 **0**（引擎装载时整块填 `enc_zero`，
 *   见 `ref.ts` 的判据）—— 不要在别处再写一套 `?? 0` / `hasRefValue` 的读口径。
 */
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
      return decIntSlot(e.key, e.globals.int.get(a.raw));
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
      return decIntSlot(e.key, frame.locals.int.get(a.raw));
    case TYPE_LOCAL_FLOAT:
      return (frame.locals.float.get(a.raw) ?? 0) | 0;
    case TYPE_GLOBAL_INT_ARRAY:
      return decIntSlot(e.key, e.globals.int.get(a.raw));
    case TYPE_LOCAL_INT_ARRAY:
      return decIntSlot(e.key, frame.locals.int.get(a.raw));
    default:
      throw new Error(`readIntOperand: unsupported type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/**
 * 读第 n 个操作数的**原始索引**（引擎 sub_418A30 的 readIndexOperand 语义），
 * 供 string-lookup-set 族（0x1A2 登记 / 0x1A3 查表）用作查询键。
 *  - 这个"索引"永远落在**全局池**的下标空间：引擎 sub_418A30 用 `_this[95744]`(全局 int 池基址) 做基准，
 *    因此 `global-int N` 给出全局槽号 N；指针（global/local-ptr）给出"所指元素在全局池的下标"。
 *  - `local-int` 不在这个键空间里：引擎 sub_418A30 只认 type 3(global int)/6(global ptr)/12(local ptr)，
 *    对 `local-int`(9) 会抛 Type_Exception —— 局部变量与全局变量是不同的 identity，**不是同一个键**。
 *    局部指针能参与是因为它指向的是全局池元素。
 *  - 立即数：emulator 宽容退回字面值（引擎对立即数本应抛 Type 异常）。
 */
export function readIndexOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): number {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_INT:
    case TYPE_LOCAL_INT:
      return a.raw; // 全局池下标（槽号），非存量值
    case TYPE_GLOBAL_PTR:
      return readRefSlot(e.globals.ptr, a.raw).index; // 指针所指全局池元素下标
    case TYPE_LOCAL_PTR:
      return readRefSlot(frame.locals.ptr, a.raw).index; // 局部指针所指数（全局池）元素下标
    case TYPE_GLOBAL_STRING_PTR:
      return readRefSlot(e.globals.strPtr, a.raw).index; // 字符串指针所指字符串池下标
    case TYPE_LOCAL_STRING_PTR:
      return readRefSlot(frame.locals.strPtr, a.raw).index;
    case TYPE_IMMEDIATE_INT:
    case TYPE_IMMEDIATE_FLOAT:
      return a.raw | 0; // 立即数退化：字面值即索引
    default:
      throw new Error(`readIndexOperand: unsupported type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/**
 * 读第 n 个操作数的**字符串索引**（引擎 sub_418AE0 语义，save-string / load-string 的查询键）。
 *  global/local-string 返回字符串池下标（a.raw）；字符串指针(8/14)返回所指字符串池下标。
 */
export function readStringIndexOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): number {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_STRING:
    case TYPE_LOCAL_STRING:
    case TYPE_LOCAL_STRING2:
      return a.raw;
    case TYPE_GLOBAL_STRING_PTR:
      return readRefSlot(e.globals.strPtr, a.raw).index;
    case TYPE_LOCAL_STRING_PTR:
      return readRefSlot(frame.locals.strPtr, a.raw).index;
    default:
      throw new Error(`readStringIndexOperand: unsupported type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}

/** 写第 n 个操作数（int 槽过 ENC；指针型 = 写穿到所指处）。 */
export function writeIntOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number, value: number): void {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_GLOBAL_INT:
      e.globals.int.set(a.raw, enc(e.key, value));
      // 语义事件（`tickets/T-0114`）：**给出解码后的值**，面板条件里写 `val == 1` 才直观
      e.emitDebugEvent('global-int-write', { idx: a.raw, val: value });
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
      // ★`tickets/T-0127`：本帧 local int 的**唯一写门面**（脚本可见的 local 写都经这里）
      //   ⇒ "谁写了 local N" 现在是事件断点能回答的问题，不必再写专门的探针用例。
      e.emitDebugEvent('local-int-write', { idx: a.raw, val: value });
      return;
    case TYPE_LOCAL_FLOAT:
      frame.locals.float.set(a.raw, value);
      return;
    case TYPE_GLOBAL_INT_ARRAY:
      e.globals.int.set(a.raw, enc(e.key, value));
      e.emitDebugEvent('global-int-write', { idx: a.raw, val: value });
      return;
    case TYPE_LOCAL_INT_ARRAY:
      frame.locals.int.set(a.raw, enc(e.key, value));
      return;
    default:
      throw new Error(`writeIntOperand: unsupported type 0x${a.type.toString(16)} for opcode 0x${instr.opcode.toString(16)}`);
  }
}
