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
 * `sub_41A6C0`（raw 25539-25593）：**ASCII 数字串 → 全角**（引擎写的是 GBK `0xA3xx` / `0x8148`，
 * 本机 exe = 中文版 ⇒ GBK；emulator 的串是 Unicode ⇒ 用 Unicode 全角区 `U+FF01..U+FF5E` 表达）。
 *
 * 引擎逐字符（写 2 字节：`a1[2*i]` = 首字节、`a1[2*i+1]` = 次字节）：
 *  - `0-9`/`A-Z`/`a-z` ⇒ `{0xA3, c+0x80}`（`0`→`A3B0`、`9`→`A3B9`、`A`→`A3C1`、`a`→`A3E1`）；
 *  - `-` ⇒ `{0xA3, 0xAD}`、`+` ⇒ `{0xA3, 0xAB}`、`#` ⇒ `{0xA3, 0xA3}`；
 *  - **其余任何字符** ⇒ `{0x81, 0x48}`（raw 25574-25576）。
 * ★`%lf`/`_itoa_s` 的输出字母表 = 数字 / `-`（负数）/ `.` / `e`、`i`、`n`、`f`、`a`（`inf`/`nan` 的 C 形态）
 * ⇒ **唯一会落进"其余"那一支的就是 `.`**（字母都在 `a-z` 内、`+`/`#` 只有 `0x205` 的格式化才会产生）。
 * 而 `{0x81,0x48}` 在 GBK 里不是标点（落在 CJK 扩展区，不是全角句点 `A3AE`）⇒ 引擎在 `.` 上是输出怪码位的。
 * 本实现按"未列入 ⇒ 留半角 `.`"处理，与既有 `handlers/msgwin.ts` 的 `toFullWidth`（`0x205` 用）同一口径
 * （不另造一套无据的映射）；这一处差额已登记在 `tickets/T-0162/changes-c162.md`。
 *
 * ★**本函数是本工程唯一一份实现**（`tickets/T-0175` ⑫ 去重）：消息窗绘制侧
 * （`handlers/msgwin.ts` 的逐字直绘）原来有一份**逐字节相同**的本地副本，现在改为 `import` 这一份
 * —— 两份实现一旦漂移就会出现"同一个字符在 `0x205` 与 `0x192` 下宽度不同"这种极难察觉的分歧。
 */
export function toFullWidthAscii(s: string): string {
  return s.replace(/[0-9A-Za-z+\-#]/g, (ch) => {
    if (ch === '-') return '－';
    if (ch === '+') return '＋';
    if (ch === '#') return '＃';
    return String.fromCharCode(ch.charCodeAt(0) + 0xfee0);
  });
}

/**
 * 引擎取串原语（`sub_41B640` / `sub_42A420` / `sub_41B9B0`）。**用哪一条由 opcode 决定**，
 * 不由操作数 tag 决定 —— 差异只有两处（全角化、float 指针族 7/13），见 `readStringOperand` 的表。
 */
export type StringPrimitive = 'sub_41B640' | 'sub_42A420' | 'sub_41B9B0';

/**
 * `opcode → 取串原语`。真源 = 逐 handler 体里出现的 `sub_41B640/sub_42A420/sub_41B9B0(...)` 调用
 * （机械扫描：全库 544 条 handler 里经这三条读串的共 **29** 条）。
 *
 * ★只有 `0x1B2` 走 `sub_41B9B0`；下面 6 条走 `sub_42A420`；**其余 22 条走 `sub_41B640`**（缺省值），
 * 所以这张表只列"不是缺省"的 7 条 —— 缺省写成显式映射会让"新增一条经 `sub_41B9B0` 的指令"静默走错分支。
 */
const STRING_PRIMITIVE_BY_OP: ReadonlyMap<number, StringPrimitive> = new Map<number, StringPrimitive>([
  [0x1b2, 'sub_41B9B0'], // sub_42A9B0 raw 36550-36558（文本缓冲追加）
  [0x192, 'sub_42A420'], // sub_433660 raw 41936-41950（set-string）
  [0x193, 'sub_42A420'], // sub_433710 raw 41952-41987（concat）
  [0x194, 'sub_42A420'], // sub_42CF10 raw 37909-37938（字符串相等）
  [0x195, 'sub_42A420'], // sub_42D010 raw 37942-37972（字符串不等）
  [0x1a9, 'sub_42A420'], // sub_434FE0 raw 42935-...（save-string）
  [0x2c2, 'sub_42A420'], // sub_433DE0 raw 42180-...（6 操作数族）
]);

/** 取该 opcode 用的引擎取串原语（缺省 `sub_41B640`）。 */
export function stringPrimitiveForOp(op: number): StringPrimitive {
  return STRING_PRIMITIVE_BY_OP.get(op) ?? 'sub_41B640';
}

/**
 * 引擎的「取字符串操作数」原语 —— **三条**，tag 值相同但返回形态不同：
 * `sub_41B640`（raw 26249-26360）、`sub_42A420`（raw 36318-36544）、`sub_41B9B0`（raw 26366-26548）。
 *
 * ★**用哪一条由调用它的 opcode 决定**（不是由 tag 决定）。全库 544 条 handler 里经这三条读串的共
 * **29 条**，其中**只有 `0x1B2`（`sub_42A9B0` raw 36550-36558）走 `sub_41B9B0`**；`0x192`/`0x193`/
 * `0x194`/`0x195`/`0x1A9`/`0x2C2` 走 `sub_42A420`；其余 22 条（`0x6E`/`0x204`/`0x2C5`/`0x2C7` …）走
 * `sub_41B640`。（`0x7D` 另走 `sub_41A780` = 十六进制形态，本 emulator 未实现 ⇒ 命中即硬报错。）
 *
 * ## 三者的差异（逐 case 读体得出；tag 值从体里数出来）
 *
 * | tag | 形态 | `sub_41B640`（22 条） | `sub_42A420`（6 条） | `sub_41B9B0`（`0x1B2`） |
 * |---|---|---|---|---|
 * | `0` | 立即 int | `_itoa_s(payload,10)` + **全角** | 同左（raw 36419-36424） | `_itoa_s(payload,10)`，**不做全角**（raw 26400-26402） |
 * | `1` | 立即 float | `%lf(*(float*)payload)` + 全角（26273-26275→26330） | 同（36425-36427→36492） | `%lf`，不全角（26403-26404→26478-26480） |
 * | `2` | 内嵌字面量（**逐 dword 取反**存储） | 解倒置后原样返回（26276-26287） | 同（36428-36449） | 同（26405-26418） |
 * | `3`/`9` | 全局/局部 int 值池 | `_itoa_s(DEC(池值),10)` + 全角 | 同（36450-36458 / 36481-36489） | 同数值，不全角（26419-26427 / 26450-26457） |
 * | `4`/`10` | 全局/局部 float 值池 | `%lf(池值)` + 全角 | 同（36459-36461 / 36490-36494） | 同，不全角（26428-26430 / 26458-26461） |
 * | `5`/`11` | 全局/局部 string 值池 | 取串（SSO：cap `+20` ≥ 0x10 ⇒ 解堆指针）（26297-26304） | 同（36462-36469 / 36495-36502） | 同（26431-26436 / 26462-26467） |
 * | `6`/`12` | int 指针族 | `_itoa_s(DEC(*指针),10)` + 全角（26305-26310 / 26340-26343） | 同（36470-36475 / 36503-36509） | 同数值，不全角（26437-26440 / 26468-26474） |
 * | `7`/`13` | float 指针族 | **`default:` ⇒ 抛 `Command_Type_Exception`** | **同左，无 case 7/13 ⇒ 抛** | **支持**：`%lf(*指针)` / `%lf(**指针)`（26441-26445 / 26475-26480） |
 * | `8`/`14` | string 指针族 | 解引用取串（SSO）（26311-26315 / 26349-26354） | 同（36476-36480 / 36516-36519） | 同（26446-26449 / 26481-26485） |
 * | `0x8003`/`0x8009` | int 数组 | **`default:` ⇒ 抛** | 池槽值 `DEC` 即"数组向量指针"：空/null ⇒ 哨兵串 `asc_5205D4` = **`０`**（全角！）；否则 `_itoa_s(DEC(向量[0]),10)` + 全角（36524-36541 / 36510-36524） | 空/null ⇒ 全局 `a0` = **`"0"`**（半角，raw 4399）；否则 `_itoa_s(DEC(向量[0]),10)`，不全角（26490-26498 / 26510-26524） |
 * | `0x8005`/`0x800B` | 字符串数组 | **`default:` ⇒ 抛** | 取该串槽的串 → `atoi` 当**向量地址** → `[0]`；串空/向量空 ⇒ `byte_51EA3C` = **空串**（36363-36365 / 36386-36411 / 36408-36411） | 同（26502-26509 / 26525-26532） |
 * | 其它 | — | `default:` ⇒ 抛 `Command_Type_Exception` | 同（36389-36392） | 同（26486-26487 / 26533-26537） |
 *
 * ## 「全角化」是什么（`0x2C5`/`0x2C6` 与所有经 `sub_41B640`/`sub_42A420` 的数值转串）
 *
 * `sub_41B640` 与 `sub_42A420` 的**每一条数值路径**在返回前都过了 `sub_41A6C0`
 * （raw 26331/26347、36376/36421/36509/36530）＝ **ASCII 数字 → 双字节全角**：
 * 逐字符写 `{0xA3, c+0x80}`（`0`→`0xA3B0`、`A`→`0xA3C1`、`a`→`0xA3E1`）、
 * `-`→`0xA3AD`、`+`→`0xA3AB`、`#`→`0xA3A3`（raw 25539-25593）。
 * ★本机这份 exe 是**中文版（心愿屋）**，内部字符集 = GBK（`analysis` 侧证据：存档串 `b3c7edce…`＝GBK），
 * 所以 `0xA3xx` 正是 GBK 的全角 ASCII 区 —— 同一个 `sub_41A6C0` 在日文版里会是 SJIS 的 `0x82xx`。
 * 它**只在这两条原语里**被调用；`sub_41B9B0`（→ `0x1B2`）与专用指令 `0x1C8`（`sub_433820` raw 41990-42010
 * 的 `%d`，**不**调 `sub_41A6C0`）都是**半角**。⇒ 「0x192 拿 int 得到全角、0x1B2 / 0x1C8 得到半角」是引擎的真实分叉。
 *
 * ⚠**已知近似（如实登记）**：`sub_41A6C0` 对 `.`（0x2E）落的是 `0x81 0x48`（GBK 域外的怪码位，见 raw 25574-25576），
 * 本实现**只转 `[0-9A-Za-z+-#]`、`.` 留半角** —— 与既有 `handlers/msgwin.ts` 的 `toFullWidth`
 * （`0x205` 用）**同一口径**，不另造一套映射。受影响面只有 float 族转串（`%lf` 含 `.`）。
 *
 * ## 数组族在 emulator 里的可复现性
 *  - `0x8003`/`0x8009`：引擎把池槽值当**指向 `vector<int>` 的指针**；emulator 的数组模型（`T-0082` 的
 *    `0x2C9`/`refFromOperand`）是"元素就从基址槽起连续排"⇒ 这里取**首元素值**。
 *    两种模型在"元素 0"上重合；且**数组不存在**时 emulator 的缺失槽读 0（`decIntSlot`）与引擎的
 *    空容器哨兵（`０` / `0`）逐字相等 —— 见下面 `num(intToDecimal(...))` 的写法。
 *  - `0x8005`/`0x800B`：引擎把"数组地址"以**十进制字符串**存在该串槽里再 `atoi` 解回指针
 *    （`sub_42AEA0` raw 36858-36888 的自动建数组分支），emulator 的串池里没有"指针型字符串"这种值
 *    ⇒ **结构上无法复现** ⇒ 显式抛错（登记为缺口，不再静默返回槽号）。
 */
export function readStringOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): string {
  const a = operandArg(instr, n);
  const prim = stringPrimitiveForOp(instr.opcode);
  /** 数值 → 串之后的**全角化**（`sub_41A6C0`）：只有 `sub_41B9B0` 不做。 */
  const num = (s: string): string => (prim === 'sub_41B9B0' ? s : toFullWidthAscii(s));
  switch (a.type) {
    // ── tag 2：**内嵌字面量**（倒置存储，解析期已解出 `a.str`）。★它不是池槽，与 tag 0xB 是两套。
    case TYPE_LOCAL_STRING:
      if (a.str === undefined) {
        throw new Error(
          `readStringOperand: tag 2（内嵌字面量）没有解出字面量（raw=${a.raw}）—— 引擎从操作数流里的**倒置存储**解出（sub_41B640 raw 26276-26287），它不是任何一个池的下标`,
        );
      }
      return a.str;
    // ── tag 0xB：**局部串变量**（帧内串池；引擎 `_this[30*cur+95791]` 的 vector<string>）。
    case TYPE_LOCAL_STRING2:
      return frame.locals.str.get(a.raw) ?? '';
    case TYPE_GLOBAL_STRING:
      return e.globals.str.get(a.raw) ?? '';
    case TYPE_GLOBAL_STRING_PTR:
      return readStringRef(e, frame, readRefSlot(e.globals.strPtr, a.raw));
    case TYPE_LOCAL_STRING_PTR:
      return readStringRef(e, frame, readRefSlot(frame.locals.strPtr, a.raw));
    // ── 数值族 ──
    case TYPE_IMMEDIATE_INT:
      return num(intToDecimal(a.raw));
    case TYPE_IMMEDIATE_FLOAT:
      return num(floatToLf(floatBits(a.raw)));
    case TYPE_GLOBAL_INT:
    case TYPE_LOCAL_INT:
    case TYPE_GLOBAL_PTR:
    case TYPE_LOCAL_PTR:
      return num(intToDecimal(readIntOperand(e, frame, instr, n)));
    case TYPE_GLOBAL_FLOAT:
    case TYPE_LOCAL_FLOAT:
      return num(floatToLf(readFloatOperand(e, frame, instr, n)));
    // float 指针族：`sub_41B640`/`sub_42A420` 都**没有** case 7/13 ⇒ `default:` 抛；只有 `sub_41B9B0` 支持。
    case TYPE_GLOBAL_FLOAT_PTR:
    case TYPE_LOCAL_FLOAT_PTR:
      if (prim === 'sub_41B9B0') return floatToLf(readFloatOperand(e, frame, instr, n));
      throw new Error(
        `readStringOperand: float 指针族 0x${a.type.toString(16)} 不能转字符串 —— ${prim} 无 case 7/13，走 default 抛 Command_Type_Exception（raw 26355-26357 / 36389-36392）`,
      );
    // ── 数组族 ──
    case TYPE_GLOBAL_INT_ARRAY:
    case TYPE_LOCAL_INT_ARRAY:
      if (prim === 'sub_41B640') {
        throw new Error(
          `readStringOperand: 数组 tag 0x${a.type.toString(16)} 在 sub_41B640 里没有 case（switch 只到 0..14）⇒ default 抛 Command_Type_Exception（raw 26355-26357）`,
        );
      }
      // 首元素值；数组不存在 ⇒ 缺失槽读 0 ⇒ 与引擎的空容器哨兵（`０` / `0`）逐字相等。
      return num(intToDecimal(readIntOperand(e, frame, instr, n)));
    case TYPE_GLOBAL_STRING_ARRAY:
    case TYPE_LOCAL_STRING_ARRAY:
      throw new Error(
        `readStringOperand: 字符串数组 tag 0x${a.type.toString(16)} 在本 emulator **结构上无法复现** —— 引擎把数组地址以十进制字符串存在该串槽里再 atoi 解回指针（sub_42AEA0 raw 36858-36888）、随后取 vector<string>[0]（sub_42A420 raw 36394-36411 / sub_41B9B0 raw 26538-26547），emulator 的串池里没有"指针型字符串"这种值（缺口登记见 tickets/T-0162/changes-c162.md）`,
      );
    // 引擎对任何其它 tag 都走 `default:` ⇒ 抛（含 float 数组 0x8004/0x800A）。**不再**静默给槽号。
    default:
      throw new Error(
        `readStringOperand: tag 0x${a.type.toString(16)} 无对应 case（引擎 ${prim} 的 default 分支抛 Command_Type_Exception，raw 26355-26357 / 36389-36392）`,
      );
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

/**
 * 读一个 float 引用所指处的值（**保留小数**）。
 *
 * ★为什么不直接用 `ref.ts` 的 `readRef`：它对 `kind === 'float'` 做的是 `(raw) | 0`
 * （`ref.ts` raw 112 —— 那是"把 float 当整数读"的口径，给 `readIntOperand` 用的）。
 * 而引擎对 **float 指针族**（tag 7/13）读的是 `*(float*)指针` / `**(float**)指针`
 * （`sub_41B9B0` raw 26441-26445 / 26475-26480），**不是**它的整数截断。
 * ⇒ float 指针族必须走这里；这是「float 族读法」上的一处真实缺口（`tickets/T-0162` 读体时发现）。
 */
function readFloatRef(e: Engine, frame: Frame, ref: Ref): number {
  if (ref.kind === 'ptr' || ref.kind === 'fptr') {
    const pool = ref.scope === 'global' ? e.globals.floatPtr : frame.locals.floatPtr;
    return readFloatRef(e, frame, readRefSlot(pool, ref.index));
  }
  if (ref.kind !== 'float') throw new Error(`float 指针族指向的不是 float 槽：${JSON.stringify(ref)}`);
  const pool = ref.scope === 'global' ? e.globals.float : frame.locals.float;
  return pool.get(ref.index) ?? 0;
}

/** 读第 n 个操作数为 float（float 池存 JS 数；立即 float 走位模式；float 指针族解引用且**不截断**）。 */
export function readFloatOperand(e: Engine, frame: Frame, instr: BinInstruction, n: number): number {
  const a = operandArg(instr, n);
  switch (a.type) {
    case TYPE_IMMEDIATE_FLOAT: return floatBits(a.raw);
    case TYPE_GLOBAL_FLOAT: return (e.globals.float.get(a.raw) ?? 0);
    case TYPE_LOCAL_FLOAT: return (frame.locals.float.get(a.raw) ?? 0);
    case TYPE_GLOBAL_FLOAT_PTR: return readFloatRef(e, frame, readRefSlot(e.globals.floatPtr, a.raw));
    case TYPE_LOCAL_FLOAT_PTR: return readFloatRef(e, frame, readRefSlot(frame.locals.floatPtr, a.raw));
    default: return readIntOperand(e, frame, instr, n);
  }
}

/**
 * 写一个 float 引用所指处（**保留小数**；`ref.ts` 的 `writeRef` 对 float 本来就是原值写，
 * 截断发生在 `writeFloatOperand` 的 `default:` 那一格 `v | 0` —— 这里绕开它）。
 *
 * 引擎 `sub_42BA00`（float 写原语）case 7 raw 37222-37226 / case 13 raw 37245-37249：
 * `*(float *)指针 = a3`（一次截断都没有）；case 3/9/6/12（**int** 槽/指针）才把 float 的**位模式**
 * 旋转编码后写进 int 池 —— 那是 ADR-003「按类型分池」下的另一件事，不在这里。
 */
function writeFloatRef(e: Engine, frame: Frame, ref: Ref, v: number): void {
  if (ref.kind === 'ptr' || ref.kind === 'fptr') {
    const pool = ref.scope === 'global' ? e.globals.floatPtr : frame.locals.floatPtr;
    writeFloatRef(e, frame, readRefSlot(pool, ref.index), v);
    return;
  }
  if (ref.kind !== 'float') throw new Error(`float 指针族指向的不是 float 槽：${JSON.stringify(ref)}`);
  (ref.scope === 'global' ? e.globals.float : frame.locals.float).set(ref.index, v);
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
    // float 指针族：`*(float*)指针 = v`（**不截断**，见 `writeFloatRef`）
    case TYPE_GLOBAL_FLOAT_PTR: writeFloatRef(e, frame, readRefSlot(e.globals.floatPtr, a.raw), v); return;
    case TYPE_LOCAL_FLOAT_PTR: writeFloatRef(e, frame, readRefSlot(frame.locals.floatPtr, a.raw), v); return;
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
