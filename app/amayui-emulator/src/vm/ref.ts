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

/**
 * ★**「没写过的 int 槽读 0」—— 全工程唯一的实现**（`tickets/T-0097` ③；审计"两套口径并存"）。
 *
 * ## 引擎口径（判据：三处 raw 体，都是"槽里放 `ENC(0)`"）
 * 1. **局部 int 池**：`loadScriptFrame_40ED40`（raw 18773-18781）建池后
 *    `for (i = 0; i <= count; ++i) local_int[i] = _this[97060];`
 *    —— `_this[97060]` = `enc_zero` = `ENC(0)`（`fields.json` 的 `Engine/0x5EC90`：
 *    `"ENC(0) 常量槽 (this[97060])"`，`evidence: members.cpp 388240；loadScriptFrame 填 local_int 用`）。
 * 2. **全局 int 池**：构造/preload（raw 22328-22329）与全量 teardown `0x9`（raw 35218-35219）同样是
 *    `for (j = 0; j <= count; ++j) pool_int[j] = *(this + 388240);`（同一 `enc_zero`）。
 * 3. **数组按需扩容** `0x2C9`（`sub_4344A0` raw 42526-42531）：新元素
 *    `v16 = __ROL4__(key ^ __ROR4__(0, 7), 21)` = `ENC(0)`（就地算出来，不是读常量槽）。
 *  ⇒ 未写过的 int 槽在位模式上是 `ENC(key, 0)`，读侧 `DEC(key, ·)` 之后**就是 0**。
 *  旁证：`sub_418940` / `sub_4218D0`（raw 24240 / 30296）用 `ROL4(enc_zero, 11) != key` 做密钥自检
 *  —— 只有 `enc_zero == ENC(0)` 才成立。
 *
 * ## 为什么不能沿用 `dec(key, 0)`
 * 缺省写成 `dec(key, 0)` 只在 `key == 0` 时等于 0（`ror32(0,25) = 0`），一旦 `key != 0`
 * —— 读**真存档**就会设非零 key（`handlers/save-slot.ts` 从槽里读回）—— 缺槽读出的是
 * `ror32(key,25)` 这种垃圾。而 `save-slot.ts` 装 int 池时**只装非零项**（`if (v !== 0)`，
 * 注释就写着"读侧缺省即 0"）⇒ 修前每个"存档里是 0 的全局量"都读成垃圾。
 *
 * ## 纪律
 * ★**只此一处**：`readIntOperand`（local/global int 与 int 数组操作数）与 `readRef`（int 引用）
 * 都走它。**不许**再在个别 handler 里另起一套读口径（轮 6 的 `0x12E` 本地 `hasRefValue` 绕法
 * 已随之删除，守卫见 `test/operand-missing-slot-zero.test.ts` 的"不许两套口径"棘轮）。
 * `hasRefValue` 保留下来只用于**写侧**的一件事：`0x2C9` 扩容时"只补缺失槽、不覆盖已有值"。
 */
export function decIntSlot(key: number, raw: number | undefined): number {
  return raw === undefined ? 0 : i32(dec(key, raw));
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
    // ★int 槽走 `decIntSlot`：没写过的槽 = 引擎的 `enc_zero` ⇒ 读 0（不是 `dec(key,0)` 的垃圾）
    case 'int': return decIntSlot(e.key, typeof raw === 'number' ? raw : undefined);
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
 * 该 Ref 指向的槽**是否已被写过**（未被写过 = 假）。
 *
 * 用途（**只剩写侧这一处**）：引擎的池/向量在建立时"整块是 `ENC(0)`"，所以"槽里没有条目"与
 * "槽里存着编码后的 0"在**读**的时候是同一件事 —— 读口径由 `decIntSlot` 统一负责（缺槽 = 0），
 * 不再需要在这里分叉。本函数现在只用于「扩容时只补缺失槽、不覆盖已有值」那种**写**判据
 * （`handlers/memory.ts` 的 `0x2C9`）：已有值绝不能被新元素初始化覆盖。
 *
 * 指针族（`ptr`/`fptr`）不适用（它们是"指向别的池"的一层间接）：一律返回 true，
 * 让调用方的 `writeRef` 走它自己的写穿/报错路径。
 */
export function hasRefValue(e: Engine, frame: Frame, r: Ref): boolean {
  if (r.kind === 'ptr' || r.kind === 'fptr') return true;
  return poolFor(e, frame, r).has(r.index);
}
