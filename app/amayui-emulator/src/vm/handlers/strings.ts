/**
 * 字符串族：长度 / atoi / 赋值 / 拼接 / 两张字符串表（`_this+5452` 字符串→整型、`_this+5472` 字符串→字符串）。
 *
 * 表操作（0x1A2/0x1A3/0x1A9/0x1AA）的查询键由 `readIndexOperand`/`readStringIndexOperand`
 * 给出（引擎 sub_418A30/sub_418AE0 语义），索引恒落在**全局池下标空间**，见 operand.ts 注释。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand, readStringOperand, writeStringOperand, readIndexOperand, readStringIndexOperand } from '../operand.js';
import { atoi } from '../bits.js';
import { sjisSubstr } from '../../text/sjis.js';
import type { OpTable } from './shared.js';

const op_strlen: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, s.length);
};

/** atoi (0x2ec)：`op1 = atoi(string op2)`（字符串→整数）。 */
const op_atoi: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, atoi(s));
};

/** set-string (0x192)：`string op1 = op2`（写全局/局部串槽；**VM 核心，非 native stub**）。 */
const op_set_string: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  writeStringOperand(c.e, c.frame, c.instr, 1, s);
};

/** concat (0x193)：`string op1 = op2 + op3`（字符串拼接；VM 核心）。 */
const op_concat: OpHandler = (c) => {
  const a = readStringOperand(c.e, c.frame, c.instr, 2);
  const b = readStringOperand(c.e, c.frame, c.instr, 3);
  writeStringOperand(c.e, c.frame, c.instr, 1, a + b);
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
  const src = readStringOperand(c.e, c.frame, c.instr, 2);
  const start = readIntOperand(c.e, c.frame, c.instr, 3);
  const len = readIntOperand(c.e, c.frame, c.instr, 4);
  // 引擎的两种"切在全角中间"警告（raw 42331/42346）只进调试日志，不改语义 ⇒ 这里只取文本；
  // 修正逻辑本身在 `sjisSubstr` 里（纯函数，可单测，见 test/sjis-substr.test.ts）。
  writeStringOperand(c.e, c.frame, c.instr, 1, sjisSubstr(src, start, len).text);
};

// ---- 字符串表族（save/load-int=str→int 表 `_this+5452`；save/load-string=str→str 表 `_this+5472`；见 opcode-table.md）----

/** 组查询键：引擎 `wsprintfA("%c%8.8x", 哨兵, idx)`。int 表哨兵=3；string 表哨兵=5。 */
function stringTableKey(sentinel: number, idx: number): string {
  return String.fromCharCode(sentinel) + ((idx >>> 0).toString(16).padStart(8, '0'));
}

/** 0x1A2 save-int (sub_434F60)：把 op1 的值登记到引擎 `_this+5452` 字符串→整型表，键 = stringTableKey(3, op1 索引)。 */
const op_save_int: OpHandler = (c) => {
  const value = readIntOperand(c.e, c.frame, c.instr, 1);
  const key = stringTableKey(3, readIndexOperand(c.e, c.frame, c.instr, 1));
  c.e.stringIndexTable.set(key, value);
  // 表变了 ⇒ 通知宿主把两张表落盘（`SAVE.DAT`；引擎在关窗/存档槽保存时写，见 saveData.ts）
  c.e.onSaveDataChanged?.();
};

/** 0x1A3 load-int (sub_42DF40)：按 op1 索引查 `_this+5452` 表，命中取 *v3、未命中取 0，写回 op1（VM 可见）。 */
const op_load_int: OpHandler = (c) => {
  const key = stringTableKey(3, readIndexOperand(c.e, c.frame, c.instr, 1));
  const value = c.e.stringIndexTable.get(key) ?? 0;
  writeIntOperand(c.e, c.frame, c.instr, 1, value);
};

/** 0x1A9 save-string (sub_434FE0)：把 op1 的字符串登记到引擎 `_this+5472` 字符串→字符串表，键 = stringTableKey(5, op1 字符串索引)。 */
const op_save_string: OpHandler = (c) => {
  const str = readStringOperand(c.e, c.frame, c.instr, 1);
  const key = stringTableKey(5, readStringIndexOperand(c.e, c.frame, c.instr, 1));
  c.e.stringTable.set(key, str);
  c.e.onSaveDataChanged?.();
};

/** 0x1AA load-string (sub_433A70)：按 op1 字符串索引查 `_this+5472` 表，命中取字符串、未命中取空串，写回 op1（VM 可见）。 */
const op_load_string: OpHandler = (c) => {
  const key = stringTableKey(5, readStringIndexOperand(c.e, c.frame, c.instr, 1));
  const str = c.e.stringTable.get(key) ?? '';
  writeStringOperand(c.e, c.frame, c.instr, 1, str);
};

// ---- 引擎全局时间阈值槽 `_this[97058]`（0x148 读 / 0x149 写，get/set 对；见 analysis/sub_42FEC0/sub_4229A0）----
// 引擎里该槽被 sub_4B9240 用作「光标贴顶/Alt→弹系统对话框」的去抖时长；
// **emulator 暂无对应逻辑使用此值**，仅为让 0x148/0x149 可执行（原 0x148 未映射会抛 NotImplementedOp）而建模为固定变量读写。
/** 0x149 (sub_4229A0)：`op1 → _this[97058]`（写）。 */

// 系统调用 opcode -> 走 NativeBridge（记录即可，无界面）。后续按需逐个转真。

/** ★注意：`0x2DE` **不是**字符串资源 id 查询，而是**字体名→字体表下标**（见 `handlers/msgwin.ts`）：
 *  引擎 `sub_430DF0`（raw 40251-40261）→ `sub_428990(textobj, 串)` 在 `Font+201664` 的字体名向量里
 *  线性查名并返回下标/-1。原实现按助记符猜成 `stringResourceId`，会让 `$1$CHECKCONFIG` 的
 *  "保存的字体名是否还装着"判定永远拿到 -1 ⇒ 每次启动都把默认面名写回去。
 *  `NativeBridge.stringResourceId` 保留（未来若有真正的资源 id 指令再用）。 */

/** 字符串处理 / 字符串表（真实现）。 */
export const STRING_OPS: OpTable = [
  [0x2c5, op_strlen],
  [0x2c6, op_strlen],
  [0x2c7, op_substr], // SBSubstr：字节起点/长度 + SJIS 全角边界修正
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

