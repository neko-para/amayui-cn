/**
 * 指针操作数模型（ADR-011 / docs/07-pointer-operand-model.md）。
 *
 * 引擎对指针操作数的语义（读 handler 体确认）：
 *  - 读（sub_41BF50 case 6/12）= **双重解引用**：`*(ptr 槽存的地址)` → 所指处的**值**；
 *  - 写（sub_42B4B0 case 6/12）= **写穿**：`*(ptr 槽存的地址) = ENC(value)`；
 *  - 取址（sub_42AEA0）= 直接型返回 `base+stride*idx`；指针型返回"所指处地址"（引用别名拷贝）。
 *
 * 因此指针操作数在重写版里必须是**带标记引用（Ref）**，绝不能当裸 `number`（地址）用：
 *  - 因为 ADR-003 用**按类型分池、无线性内存**（globals.int/float/str/ptr 各自独立），"地址"无法用单一 number 标识到正确池+条目。
 *  - 指针池存 `Ref | 0`（0 = 空引用）；`readRef` 解引用取所指值；`writeRef` 写穿到所指处。
 *  - 地址**从不**进入普通数值运算域（引擎读指针=解引用）；`lea`/`lookup-array`/`memcpy`/`copy-local-array` 负责构造/搬运 Ref。
 */
import type { Engine, Frame } from './engine.js';
import { dec, enc, i32, atoi } from './bits.js';

export type RefScope = 'global' | 'local';
export type RefKind = 'int' | 'float' | 'str' | 'ptr' | 'fptr';

/** 一个"指向某池中某条目"的引用（承载 ADR-003 分池模型下的地址概念）。 */
export interface Ref {
  scope: RefScope;
  kind: RefKind;
  /** 目标池中条目下标（不是字节地址）。 */
  index: number;
  /** 元素字节宽：int/float/ptr=4；string 对象=28。 */
  stride: number;
}

/** int/float/ptr 元素宽。 */
export const STRIDE_INT = 4;
/** string 对象元素宽（global-string 表条目的 stride=28，见 sub_42AEA0 case 5）。 */
export const STRIDE_STR = 28;

export function isRef(v: unknown): v is Ref {
  return typeof v === 'object' && v !== null && 'scope' in v && 'kind' in v && 'index' in v && 'stride' in v;
}

function poolFor(e: Engine, frame: Frame, r: Ref): Map<number, any> {
  switch (r.scope) {
    case 'global':
      switch (r.kind) {
        case 'int': return e.globals.int;
        case 'float': return e.globals.float;
        case 'str': return e.globals.str;
        case 'ptr': return e.globals.ptr;
        case 'fptr': return e.globals.floatPtr;
      }
      break;
    case 'local':
      switch (r.kind) {
        case 'int': return frame.locals.int;
        case 'float': return frame.locals.float;
        case 'str': return frame.locals.str;
        case 'ptr': return frame.locals.ptr;
        case 'fptr': return frame.locals.floatPtr;
      }
      break;
  }
  throw new Error(`未知 Ref：${JSON.stringify(r)}`);
}

export function nullRefError(r: Ref): Error {
  return new Error(`空/未初始化引用被解引用：${JSON.stringify(r)}`);
}

/** 读 ref 所指处值（int 族过 DEC；str 走 atoi；指针族递归一次——对应引擎"双重解引用"）。 */
export function readRef(e: Engine, frame: Frame, r: Ref): number {
  if (r.kind === 'ptr' || r.kind === 'fptr') {
    const inner = poolFor(e, frame, r).get(r.index);
    if (inner === undefined || inner === 0) throw nullRefError(r);
    if (!isRef(inner)) throw new Error(`ptr ref 指向非 Ref：${JSON.stringify(r)}`);
    return readRef(e, frame, inner);
  }
  const pool = poolFor(e, frame, r);
  const raw = pool.get(r.index);
  switch (r.kind) {
    case 'int': return i32(dec(e.key, typeof raw === 'number' ? raw : 0));
    case 'float': return (typeof raw === 'number' ? raw : 0) | 0;
    case 'str': return atoi(typeof raw === 'string' ? raw : '');
    default: throw new Error(`readRef：坏 kind ${r.kind}`);
  }
}

/**
 * 写穿：int 族过 ENC；指针族递归一次；str 存字符串。
 *
 * `v` 允许 `string`（2026-09 起）：字符串池的元素是 `std::string`，而 `0x2C9` 的
 * 「按需扩容」要对**字符串数组**的新槽写空串（引擎那边是 `std::string()` 默认构造）。
 * 对 int/float 族传字符串会按 `Number(v)` 转换（不抛，保持写穿语义）。
 */
export function writeRef(e: Engine, frame: Frame, r: Ref, v: number | string): void {
  if (r.kind === 'ptr' || r.kind === 'fptr') {
    const inner = poolFor(e, frame, r).get(r.index);
    if (inner === undefined || inner === 0) throw nullRefError(r);
    if (!isRef(inner)) throw new Error(`ptr ref 指向非 Ref：${JSON.stringify(r)}`);
    writeRef(e, frame, inner, v);
    return;
  }
  const pool = poolFor(e, frame, r);
  switch (r.kind) {
    case 'int': pool.set(r.index, enc(e.key, typeof v === 'string' ? Number(v) | 0 : v)); return;
    case 'float': pool.set(r.index, typeof v === 'string' ? Number(v) : v); return;
    case 'str': pool.set(r.index, typeof v === 'string' ? v : String(v)); return;
    default: throw new Error(`writeRef：坏 kind ${r.kind}`);
  }
}

/** 元素偏移（elemOffset 个元素；跨元素用 stride 的语义由调用方保证）。 */
export function refAt(r: Ref, elemOffset: number): Ref {
  return { scope: r.scope, kind: r.kind, index: r.index + elemOffset, stride: r.stride };
}

/**
 * 该 Ref 指向的槽**是否已有值**（未被写过 = 假）。
 *
 * 用途：引擎的池/向量在建立时是"全 `ENC(0)`"（整块内存清零 ⇒ 解码后就是 0），
 * 所以"槽里没有条目"与"槽里存着编码后的 0"在**读**的时候是同一件事。
 * emulator 的池是稀疏 `Map`：`readIntOperand` 对缺失槽写的是 `dec(key, 0)`（**不是 0**），
 * 于是"从没写过的槽"会读成垃圾。凡是需要"按引擎语义补 0"的地方（如按需扩容的 `0x2C9`）
 * 都应该先用它判断，只补**缺失**的槽 —— 已写过的槽绝不能被覆盖。
 *
 * 指针族（`ptr`/`fptr`）不适用（它们是"指向别的池"的一层间接）：一律返回 true，
 * 让调用方的 `writeRef` 走它自己的写穿/报错路径。
 */
export function hasRefValue(e: Engine, frame: Frame, r: Ref): boolean {
  if (r.kind === 'ptr' || r.kind === 'fptr') return true;
  return poolFor(e, frame, r).has(r.index);
}
