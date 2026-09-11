/**
 * 字符串族：长度 / atoi / 赋值 / 拼接 / 两张字符串表（`_this+5452` 字符串→整型、`_this+5472` 字符串→字符串）。
 *
 * 表操作（0x1A2/0x1A3/0x1A9/0x1AA）的查询键由 `readIndexOperand`/`readStringIndexOperand`
 * 给出（引擎 sub_418A30/sub_418AE0 语义），索引恒落在**全局池下标空间**，见 operand.ts 注释。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand, readStringOperand, writeStringOperand, readIndexOperand, readStringIndexOperand } from '../operand.js';
import { atoi } from '../bits.js';
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

/** 0x2DE (u0042BAC0)：`op1 = system.stringResourceId(op2 字符串)`（设置/消息子系统查找，-1=未找到）。
 *  读 op2 字符串 + 写 op1 结果，故虽为核心流程但值来自子系统；按 native 路由（StubNative 返回 -1）。 */
const op_string_resource_id: OpHandler = (c) => {
  const s = readStringOperand(c.e, c.frame, c.instr, 2);
  const id = c.native.stringResourceId?.(s) ?? -1;
  writeIntOperand(c.e, c.frame, c.instr, 1, id);
};

/** 字符串处理 / 字符串表（真实现）。 */
export const STRING_OPS: OpTable = [
  [0x2c5, op_strlen],
  [0x2c6, op_strlen],
  [0x2ec, op_atoi],
  [0x192, op_set_string],
  [0x193, op_concat],
  [0x1a2, op_save_int], // save-int：字符串→整型表登记（`_this+5452`）
  [0x1a3, op_load_int], // load-int：查表写回 op1（VM 可见）
  [0x1a9, op_save_string], // save-string：字符串→字符串表登记（`_this+5472`）
  [0x1aa, op_load_string], // load-string：查表写回 op1 字符串（VM 可见）
];

/** 字符串 → 资源 id（子系统查询；StubNative 返回 -1）。 */
export const STRING_NATIVE_OPS: OpTable = [
  [0x2de, op_string_resource_id], // 字符串→索引；StubNative 返回 -1
];

