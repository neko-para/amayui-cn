/**
 * CG 数字条：用一张 CG 图当数字字模画数值（`0x2DA` 登记记录 / `0x23B` 消费绘制）。
 *
 * 记录 = `Engine+388332+28*cgno` 的 7 个 dword：
 * `[0]` 纹理槽 / `[1]` x0 / `[2]` y0 / `[3]` 单字宽 / `[4]` 字高 / `[5]` 字内空隙 / `[6]` 字距。
 * 消费方 `0x23B` 先删 DrawItem/Mesh 的 `[id, id+digits)` 区间，再逐位建 DrawItem。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';

/**
 * **`0x2DA`（sub_426420, raw 33498，argc=8）：CG 数字条记录登记**。
 * 引擎：`op1` = CG 番号（合法 0..0xA，越界只记日志）→ 把 `op2..op8`（**7 个 int**）写进
 * `Engine+388332+28*cgno` 的 28 字节记录（两种写法 `28*(n+13869)` 与 `4*97084+28*n` 等价）。
 * 字段语义由消费方 `0x23B` 反推：`+0` 纹理槽 / `+4` x0 / `+8` y0 / `+12` 单字宽 /
 * `+16` 字高 / `+20` 字内空隙 / `+24` 字距。**纯数据登记**，不碰 Scene、不置脏。
 */
const op_set_cg_digit_record: OpHandler = (c) => {
  const n = readIntOperand(c.e, c.frame, c.instr, 1);
  if (n < 0 || n > 0xa) return; // 引擎：越界仅日志
  const rec: number[] = [];
  for (let k = 2; k <= 8; k++) rec.push(readIntOperand(c.e, c.frame, c.instr, k));
  c.e.cgDigits.set(n, rec);
};

/**
 * **`0x23B`（sub_424970, raw 32335，argc=7）：按 CG 数字条画数值**。
 * 引擎：`op1` = 起始 DrawItem id、`op2` = CG 数字条记录号、`op3` = 数值、`op4/op5` = x/y 偏移、
 * `op6` = 位数、`op7` = 对齐/补零标志（bit0 补前导零、bit1 居中、bit2 左对齐）。
 * 先 `sub_4ABB60(Scene, op1, op6)` **删 DrawItem + MeshEntry 的 `[op1, op1+op6)` 区间**，
 * 再逐位 `sub_4ACE50` 建 DrawItem（几何见 `drawCgNumber`）。
 * ★记录号以 `round(rec[0]) != 0` 为存在判据，否则只打日志「CG番号…」。
 */
const op_draw_cg_number: OpHandler = (c) => {
  const id = readIntOperand(c.e, c.frame, c.instr, 1);
  const n = readIntOperand(c.e, c.frame, c.instr, 2);
  const value = readIntOperand(c.e, c.frame, c.instr, 3);
  const x = readIntOperand(c.e, c.frame, c.instr, 4);
  const y = readIntOperand(c.e, c.frame, c.instr, 5);
  const digits = readIntOperand(c.e, c.frame, c.instr, 6);
  const flags = readIntOperand(c.e, c.frame, c.instr, 7);
  if (n < 0 || n > 0xa) return;
  const rec = c.e.cgDigits.get(n);
  if (!rec || !rec[0]) return; // 引擎：未登记的 CG 数字条 → 只打日志
  c.native.drawCgNumber?.(id, rec, value, x, y, digits, flags);
};

/** CG 数字条：登记 + 绘制（真实现；转发 native.drawCgNumber）。 */
export const GFX_CG_OPS: OpTable = [
  [0x2da, op_set_cg_digit_record], // CG 数字条记录登记（Engine+388332+28*n 的 7 dword）
  [0x23b, op_draw_cg_number], // 按 CG 数字条画数值（删 [id,id+digits) 后逐位建 DrawItem）
];

