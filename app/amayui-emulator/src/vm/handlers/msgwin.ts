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

/**
 * **「消息窗/消息渲染」与「声音」子系统的引擎内部指令 → 显式 no-op**（默认插桩，无需用户逐条跳过）。
 *
 * 判定依据 = 逐条读 handler 体（`engine/天结_unpacked.exe_utf8.c`）：体内只出现 `readIntOperand`
 *   + 对 `_this[引擎字段]` 的赋值/文本区写入，**既不 `writeIntOperand` 回写操作数，也不改 `ip`/`cur`**。
 * 这类操作 emulator 无对应子系统，效果不可观测 → 与 `ENGINE_INTERNAL_OPS` 同一取舍，但**单列并写明依据**，
 * 避免日后被当成"漏实现"。设置界面（CONFIG2/CONFIG1）实测出现次数最多的一批就在其中。
 *
 * 逐条依据：
 *  - `0x7F`(sub_42D1F0, raw 38011)   `op1 = _this[21668]`（消息窗 α；键 `message:MesWinAlpha`）
 *  - `0x80`(sub_41F690, raw 28787)   `_this[21631] = op1`（消息窗部件索引 **setter**：读 op1 写字段）
 *  - `0xC5`(sub_42E540, raw 38626)   读 op1 选键（`sound:Volume1..4`）→ `GetConfig` → 写 op2（音量显示；声音子系统）
 *  - `0x196`(sub_41FC20, raw 29032)  display-furigana：读 op1/op2/op3 写消息文本区（`WideCharToMultiByte` 组串）
 *  - `0x300`(sub_426990, raw 33743)  `_this[v2+122466] = op2 | (_this[..] & 0x10000)`、`_this[v2+122476] = op3`（消息窗对象表）
 *  - `0x301`(sub_4269F0, raw 33757)  `_this[v2+122486] = 0` + `sub_404F80(_this+21324, v2)`（清消息窗对象项）
 */
export const op_msg_ui_internal: OpHandler = () => {
  // 有意为空：见上方逐条依据（消息窗/文本子系统状态写入，无 VM 可见副作用）。
};

/**
 * **消息窗（メッセージウィンドウ）一族 —— 真实现（写/读引擎字段）**。
 *
 * 引擎里这些 handler 就是"读操作数 → 写 `_this[字段]` / 读字段 → 写 op1"，语义可完全建模；
 * emulator 只是**不渲染**消息窗，所以看不到画面效果，但这属于"已实现"而不是"插桩跳过"。
 * 字段（DWORD 下标）：
 *  - `_this[21631]`（0x151FC）：消息窗当前窗格/部件索引 ← 0x80 setter；
 *  - `_this[21668]`（0x15290）：消息窗 α（键 `message:MesWinAlpha`，启动由 SYS4REG.INI 填充）← 0x7F getter；
 *  - `_this[122466 + v]`（0x77988 区）：消息窗对象**旗标**（op2 按位或，保留 bit16）、`_this[122476 + v]`：同项的值；
 *  - `_this[122486 + v]`（0x779D8 区）：消息窗对象项（0x301 清零后调 `sub_404F80(_this+21324, v)` 重算布局——
 *    该布局子系统 emulator 未建模，故只保留字段清零这一步）。
 */
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

/** 宿主无对应子系统的消息/文本项（按引擎语义读操作数写状态，但无输出）。 */
export const MSGWIN_INTERNAL_OPS: OpTable = [
  // ---- 「消息渲染 / 声音」子系统：emulator 无对应子系统，按引擎语义"读操作数/写状态"但无输出 ----
  //  (0x7F/0x80/0x300/0x301 已升级为真实现，注册在 OPS；这里只留确实未建模的两条)
  [0x196, op_msg_ui_internal], // display-furigana（注音）：写消息文本区（文本渲染未建模）
  [0xc5, op_msg_ui_internal], // 读 op1 选 sound:Volume1..4 → GetConfig → 写 op2（音量显示；无声音子系统）
];

