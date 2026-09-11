/**
 * 消息窗（メッセージウィンドウ）族。
 *
 * 引擎里这些 handler 就是「读操作数 → 写 `_this[字段]` / 读字段 → 写 op1」，语义可完全建模；
 * emulator 只是**不渲染**消息窗，所以看不到画面效果，但这属于「已实现」而不是「插桩跳过」。
 *
 * 字段（DWORD 下标）：
 *  - `_this[21631]`（0x151FC）：消息窗当前窗格/部件索引 ← 0x80 setter；
 *  - `_this[21668]`（0x15290）：消息窗 α（键 `message:MesWinAlpha`）← 0x7F getter；
 *  - `_this[122466 + v]`：消息窗对象**旗标**（按位或，保留 bit16）、`_this[122476 + v]`：同项的值；
 *  - `_this[122486 + v]`（0x779D8 区）：消息窗对象项（0x301 清零；引擎随后的布局重算 `sub_404F80`
 *    属未建模子系统，故只保留字段清零这一步）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';

const op_set_msgwin_part: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(21631, v);
};
const op_get_msgwin_alpha: OpHandler = (c) => {
  // 引擎：`op1 = _this[21668]`（该字段启动时由 `message:MesWinAlpha` 填充）
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.engineValues.get(21668) ?? 0);
};
const op_msgwin_slot_flags: OpHandler = (c) => {
  // 引擎：`v2 = readIntOperand(1)`（对象项下标）；`_this[v2+122466] = readIntOperand(2) | _this[v2+122466] & 0x10000`；
  //       `_this[v2+122476] = readIntOperand(3)`
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  const flags = readIntOperand(c.e, c.frame, c.instr, 2);
  const value = readIntOperand(c.e, c.frame, c.instr, 3);
  const slot = v + 122466;
  c.e.engineValues.set(slot, (flags | ((c.e.engineValues.get(slot) ?? 0) & 0x10000)) | 0);
  c.e.engineValues.set(v + 122476, value);
};
const op_msgwin_slot_clear: OpHandler = (c) => {
  // 引擎：`v2 = readIntOperand(1)`；`_this[v2+122486] = 0`；`sub_404F80(_this+21324, v2)`（消息窗布局重算，未建模 → no-op）
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.engineValues.set(v + 122486, 0);
};

/** 消息窗字段读写（真实现；emulator 不渲染）。 */
export const MSGWIN_OPS: OpTable = [
  [0x7f, op_get_msgwin_alpha], // op1 = _this[21668]（消息窗 α）
  [0x80, op_set_msgwin_part], // _this[21631] = op1（窗格/部件索引 setter）
  [0x300, op_msgwin_slot_flags], // _this[v+122466] 旗标 / _this[v+122476] 值
  [0x301, op_msgwin_slot_clear], // _this[v+122486] = 0（+ 布局重算未建模）
];
