/**
 * 字符串族：长度 / atoi / 赋值 / 拼接 / 两张字符串表（`_this+5452` 字符串→整型、`_this+5472` 字符串→字符串）。
 *
 * 表操作（0x1A2/0x1A3/0x1A9/0x1AA）的查询键由 `readIndexOperand`/`readStringIndexOperand`
 * 给出（引擎 sub_418A30/sub_418AE0 语义），索引恒落在**全局池下标空间**，见 operand.ts 注释。
 */
import type { OpHandler } from '../step.js';
// ★迁移到计划层后，本文件只剩**一处**直接用操作数读：`readStringIndexOperand`
//   （字符串表族要的是**字符串索引**，与计划层 `index(n)` 的 int 槽号是两套索引空间）。
//   其余五个读写函数在迁完后已无使用者 ⇒ 已删（`noUnusedLocals` 没开，这类残留不会自己报出来）。
import { readStringIndexOperand } from '../operand.js';
import { atoi } from '../bits.js';
import { sjisSubstr, sjisSubstrChars } from '../../text/sjis.js';
import { sjisByteLength } from '../../text/layout.js';
import { operandsFor } from '../operandPlan.js';
import type { OpTable } from './shared.js';

/**
 * `0x2C5`（`sub_430900` raw 40063-40071）：**`op1 = strlen(op2)`** —— 引擎的 `strlen` 数的是**字节**
 * （SJIS：ASCII/半角片假名 1、其余 2）。★此前与 `0x2C6` 共用 `s.length`（字符数）⇒ 日文串长度一律偏小一半。
 */
const op_strlen_bytes: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x2c5：strlen 走操作数计划层，但没有声明计划');
  p.setInt(1, sjisByteLength(p.str(2) ?? ''));
};

/** `0x2C6`（`sub_430940` raw 40073-40084）：**`op1 = _mbstrlen(op2)`** —— 多字节**字符数**。 */
const op_strlen_chars: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x2c6：strlen（字符数）走操作数计划层，但没有声明计划');
  p.setInt(1, (p.str(2) ?? '').length);
};

/**
 * `0x1A6` **halve-strlen**（`sub_42D110` raw 37974-37982）：`op1 = strlen(op2) >> 1`。
 *
 * 体全文：`arity 槽 = 5`（⇒ argc=2）、`v2 = strlen(sub_41B640(_this, 2))`、`writeIntOperand(1, v2 >> 1)`。
 * ⇒ 与 `0x2C5` 同为**字节**口径（除 2）：SJIS 2 字节字的串得到"字符数"，ASCII 串则是"字符数的一半"。
 * ★语料 **217 处 / 215 个脚本**；此前未注册 ⇒ 命中即 `NotImplementedOp`（`tickets/T-0076`）。
 */
const op_halve_strlen: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1a6：halve-strlen 走操作数计划层，但没有声明计划');
  p.setInt(1, sjisByteLength(p.str(2) ?? '') >> 1);
};

/**
 * **`0x1C8` to-string**（`sub_433820` raw 41989-42010，argc 2）：**`op1 = 十进制字符串(op2)`**。
 *
 * 体全文（逐行）：`arity 槽 = 5`；`v2 = sub_41BF50(_this, 2)`（读 op2）；
 * `sub_408050(Buffer, 256, "%d", v2)`（★`%d` ⇒ **有符号十进制**、无前导零/空格）；
 * 构造 `std::string` 后 `sub_433310(_this, 1, v3)`（写回 **op1 字符串**）。
 * ★语料 11 处 / 6 个脚本（`opcode-gaps.md` 原记「仅映射/未读体」）⇒ 命中即 `NotImplementedOp`。
 * `%d` 对齐 ⇒ 超过 2^31 的值按**有符号 32 位**打印（与引擎一致）。
 */
const op_to_string: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1c8：to-string 走操作数计划层，但没有声明计划');
  p.setStr(1, String((p.int(2) ?? 0) | 0));
};

/**
 * **`0x1B2`**（`sub_42A9B0` raw 36550-36558，argc 1）：把 op1 的字符串**追加**到 `Engine+497344` 的文本缓冲。
 *
 * 体全文：`arity 槽 = 3`、`v2 = sub_41B9B0(_this, 1)`（取字符串指针）、
 * `sub_40C660(_this + 124336, v2, strlen(v2))`（追加 n 字节 ⇒ 容器的 push_back）。
 * ★语料 3 处（`opcode-gaps.md` 的未实现清单）。
 */
const op_text_append: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1b2：文本缓冲追加走操作数计划层，但没有声明计划');
  c.e.textBuffer += p.str(1) ?? '';
};

/**
 * **`0x1B3`**（`sub_42AA00` raw 36560-36565，argc 0）：往同一个缓冲追加 `"\r\n"`。
 *
 * 体全文：`arity 槽 = 1`、`sub_40C660(_this + 124336, asc_51EE84, 2u)`；`asc_51EE84` 的值在同文件
 * raw 4320（`char asc_51EE84[3] = "\r\n";`）⇒ 就是**两字节的 CRLF**（语料 2 处）。
 */
const op_text_append_crlf: OpHandler = (c) => {
  if (!operandsFor(c)) throw new Error('0x1b3：文本缓冲追加 CRLF 走操作数计划层，但没有声明计划');
  c.e.textBuffer += '\r\n';
};

/**
 * **`0x1B4`**（`sub_428DB0` raw 35322-35331，argc 0）：把文本缓冲**取出整段并清空**。
 *
 * 体全文：`*(_DWORD *)(_this + 120 * cur + 383220) = 1`（本指令长度槽 1 ⇒ argc 0）、
 * `sub_4034F0(_this)`（派发/输出）、`sub_40B420(_this + 497344, 0, 0xFFFFFFFF)`（取 `[0, -1]` 整段）。
 * ★不写任何操作数（语料 1 处）⇒ emulator 的观测面 = 一条日志 + 缓冲复位。
 */
const op_text_flush: OpHandler = (c) => {
  if (!operandsFor(c)) throw new Error('0x1b4：文本缓冲取出走操作数计划层，但没有声明计划');
  if (c.e.textBuffer.length > 0) {
    c.log(`0x1B4: 取出文本缓冲 ${c.e.textBuffer.length} 字符 ${JSON.stringify(c.e.textBuffer.slice(0, 120))}`);
  }
  c.e.textBuffer = '';
};

/** atoi (0x2ec)：`op1 = atoi(string op2)`（字符串→整数）。 */
const op_atoi: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x2ec：atoi 走操作数计划层，但没有声明计划');
  p.setInt(1, atoi(p.str(2) ?? ''));
};

/** set-string (0x192)：`string op1 = op2`（写全局/局部串槽；**VM 核心，非 native stub**）。 */
const op_set_string: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x192：set-string 走操作数计划层，但没有声明计划');
  p.setStr(1, p.str(2) ?? '');
};

/** concat (0x193)：`string op1 = op2 + op3`（字符串拼接；VM 核心）。 */
const op_concat: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x193：concat 走操作数计划层，但没有声明计划');
  p.setStr(1, (p.str(2) ?? '') + (p.str(3) ?? ''));
};

/**
 * `0x2C7` **SBSubstr**（`sub_433FD0` raw 42259-42376）：`string op1 = substr(串op2, op3, op4)`。
 *
 * ★op3/op4 是**字节**起点与**字节**长度（`strlen` 比较，raw 42298-42299），并按 SJIS 全角边界修正：
 * 起点落在全角字中间 ⇒ 丢首字节；最后一个字节落在全角字首字节 ⇒ 丢末字节（raw 42319-42359，
 * 两条警告串见 raw 4457/4458）。越界或 `op4 <= 0` ⇒ **写空串**。纯字节语义实现见 `text/sjis.ts`。
 *
 * 真实用例：`TITLE.txt:583-592` 取 `set:GameVersion` 的三段（1 / 2 / 4 字节）交给
 * `0x2EC`(atoi) + `0x23B`(CG 数字条) 画成 "Version X.YY.ZZZZ"。
 */
const op_substr: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x2c7：SBSubstr 走操作数计划层，但没有声明计划');
  const src = p.str(2) ?? '';
  const start = p.int(3) ?? 0;
  const len = p.int(4) ?? 0;
  // 引擎的两种"切在全角中间"警告（raw 42331/42346）只进调试日志，不改语义 ⇒ 这里只取文本；
  // 修正逻辑本身在 `sjisSubstr` 里（纯函数，可单测，见 test/sjis-substr.test.ts）。
  p.setStr(1, sjisSubstr(src, start, len).text);
};

/**
 * `0x2C8`（`sub_434260`, raw 42379-42457）：**按「字符」取子串** —— `0x2C7`（按字节）的兄弟。
 *
 * 引擎：`op2` 的**字符数**由 `_mbstrlen` 给出，`op3` = 起始字符下标、`op4` = 字符长度，
 * 逐字节用 `_mbbtype` 认 SJIS 双字节字；结果经 `sub_433310(this,1,…)` **写回 op1 字符串**。
 * 与 `0x2C7` 的区别只在"单位"：一个按字节、一个按字符（`op4` 为负时两者行为还不一样，
 * 见 `sjisSubstrChars` 的注释 —— 那是引擎里的真实不对称，本实现逐条复刻）。
 *
 * ★**必须实现**：它会回写 op1；当 no-op 跳过时脚本拿到的是旧串（静默逻辑错误）。
 * 语料现状：`i2c8` 在 941 个 `src/*.txt` 里**没有任何调用点**（0x2C7 才被大量使用）——
 * 实现它主要是为了补全"按字符"这条语义并消除"命中即硬报错"的隐患。
 */
const op_substr_chars: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x2c8：按字符取子串走操作数计划层，但没有声明计划');
  p.setStr(1, sjisSubstrChars(p.str(2) ?? '', p.int(3) ?? 0, p.int(4) ?? 0));
};

// ---- 字符串表族（save/load-int=str→int 表 `_this+5452`；save/load-string=str→str 表 `_this+5472`；见 opcode-table.md）----

/** 组查询键：引擎 `wsprintfA("%c%8.8x", 哨兵, idx)`。int 表哨兵=3；string 表哨兵=5。 */
function stringTableKey(sentinel: number, idx: number): string {
  return String.fromCharCode(sentinel) + ((idx >>> 0).toString(16).padStart(8, '0'));
}

/** 0x1A2 save-int (sub_434F60)：把 op1 的值登记到引擎 `_this+5452` 字符串→整型表，键 = stringTableKey(3, op1 索引)。 */
const op_save_int: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1a2：save-int 走操作数计划层，但没有声明计划');
  // ★值用 `int(1)`（槽里的值）、键用 `index(1)`（槽号本身）—— 引擎 `sub_41BF50` vs `sub_418A30` 的区别
  const value = p.int(1) ?? 0;
  const key = stringTableKey(3, p.index(1) ?? 0);
  c.e.stringIndexTable.set(key, value);
  // 表变了 ⇒ 通知宿主把两张表落盘（`SAVE.DAT`；引擎在关窗/存档槽保存时写，见 saveData.ts）
  c.e.onSaveDataChanged?.();
};

/** 0x1A3 load-int (sub_42DF40)：按 op1 索引查 `_this+5452` 表，命中取 *v3、未命中取 0，写回 op1（VM 可见）。 */
const op_load_int: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1a3：load-int 走操作数计划层，但没有声明计划');
  const key = stringTableKey(3, p.index(1) ?? 0);
  const value = c.e.stringIndexTable.get(key) ?? 0;
  p.setInt(1, value);
};

/** 0x1A9 save-string (sub_434FE0)：把 op1 的字符串登记到引擎 `_this+5472` 字符串→字符串表，键 = stringTableKey(5, op1 字符串索引)。 */
const op_save_string: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1a9：save-string 走操作数计划层，但没有声明计划');
  const str = p.str(1) ?? '';
  const key = stringTableKey(5, readStringIndexOperand(c.e, c.frame, c.instr, 1));
  c.e.stringTable.set(key, str);
  c.e.onSaveDataChanged?.();
};

/** 0x1AA load-string (sub_433A70)：按 op1 字符串索引查 `_this+5472` 表，命中取字符串、未命中取空串，写回 op1（VM 可见）。 */
const op_load_string: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) throw new Error('0x1aa：load-string 走操作数计划层，但没有声明计划');
  const key = stringTableKey(5, readStringIndexOperand(c.e, c.frame, c.instr, 1));
  const str = c.e.stringTable.get(key) ?? '';
  p.setStr(1, str);
};

/** ★注意：`0x2DE` **不是**字符串资源 id 查询，而是**字体名→字体表下标**（见 `handlers/msgwin.ts`）：
 *  引擎 `sub_430DF0`（raw 40251-40261）→ `sub_428990(textobj, 串)` 在 `Font+201664` 的字体名向量里
 *  线性查名并返回下标/-1。原实现按助记符猜成 `stringResourceId`，会让 `$1$CHECKCONFIG` 的
 *  "保存的字体名是否还装着"判定永远拿到 -1 ⇒ 每次启动都把默认面名写回去。
 *  `NativeBridge.stringResourceId` 保留（未来若有真正的资源 id 指令再用）。 */

/** 字符串处理 / 字符串表（真实现）。 */
export const STRING_OPS: OpTable = [
  [0x2c5, op_strlen_bytes], // strlen（**字节**口径；SJIS 日文 2 字节/字）
  [0x2c6, op_strlen_chars], // _mbstrlen（字符数）
  [0x1a6, op_halve_strlen], // halve-strlen：strlen(op2) >> 1（语料 217 处/215 脚本；B3 补）
  [0x1b2, op_text_append], // 文本缓冲追加字符串（B3 补；raw 36550-36558）
  [0x1b3, op_text_append_crlf], // 文本缓冲追加 CRLF（B3 补；raw 36560-36565）
  [0x1b4, op_text_flush], // 文本缓冲取出整段并清空（B3 补；raw 35322-35331）
  [0x1c8, op_to_string], // to-string：op1 = "%d" 的十进制字符串(op2)（B3 补；raw 41989-42010）
  [0x2c7, op_substr], // SBSubstr：字节起点/长度 + SJIS 全角边界修正
  [0x2c8, op_substr_chars], // 按「字符」取子串（_mbstrlen 计数；写回 op1 字符串）
  [0x2ec, op_atoi],
  [0x192, op_set_string],
  [0x193, op_concat],
  [0x1a2, op_save_int], // save-int：字符串→整型表登记（`_this+5452`）
  [0x1a3, op_load_int], // load-int：查表写回 op1（VM 可见）
  [0x1a9, op_save_string], // save-string：字符串→字符串表登记（`_this+5472`）
  [0x1aa, op_load_string], // load-string：查表写回 op1 字符串（VM 可见）
];

/** 字符串 → 资源 id（子系统查询；StubNative 返回 -1）—— 当前**无 opcode 使用**（原 0x2DE 映射是错的）。 */
export const STRING_NATIVE_OPS: OpTable = [];

