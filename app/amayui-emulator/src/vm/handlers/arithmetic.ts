/**
 * 算术 / 位运算 / 比较 / 浮点 / mov / 随机数（VM 纯计算族，唯一不碰引擎子系统的一组）。
 *
 * 这些 handler 只经 `readIntOperand`/`writeIntOperand` 与操作数池交互，
 * 因此也是最容易被单元测试直接驱动的一族（见 test/adv-string.test.ts、test/ptr.test.ts）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand, readFloatOperand, writeFloatOperand } from '../operand.js';
import { asI32 } from '../bits.js';
import type { OpTable } from './shared.js';

function binOp(apply: (l: number, r: number) => number): OpHandler {
  return (c) => {
    const l = readIntOperand(c.e, c.frame, c.instr, 2);
    const r = readIntOperand(c.e, c.frame, c.instr, 3);
    writeIntOperand(c.e, c.frame, c.instr, 1, apply(l, r));
  };
}

// ---- 算术/位运算 (0x50-0x59) ----
const op_add = binOp((l, r) => (l + r) | 0);
const op_sub = binOp((l, r) => (l - r) | 0);
const op_mul = binOp((l, r) => Math.imul(l, r));
const op_div = binOp((l, r) => Math.trunc(l / r));
const op_mod = binOp((l, r) => ((l % r) + r) % r); // C 的 % 对负数是剩余（符号跟随被除数）；AGE 语义按需在 M1 定
const op_and = binOp((l, r) => l & r);
const op_or = binOp((l, r) => l | r);
const op_sar = binOp((l, r) => l >> (r & 31));
const op_shl = binOp((l, r) => (l << (r & 31)) | 0);
// ---- 比较 (0x5A-0x5F)：结果 0/1 ----
const op_eq = binOp((l, r) => (asI32(l) === asI32(r) ? 1 : 0));
const op_ne = binOp((l, r) => (asI32(l) !== asI32(r) ? 1 : 0));
const op_lt = binOp((l, r) => (asI32(l) < asI32(r) ? 1 : 0));
const op_lte = binOp((l, r) => (asI32(l) <= asI32(r) ? 1 : 0));
const op_gr = binOp((l, r) => (asI32(l) > asI32(r) ? 1 : 0));
const op_gre = binOp((l, r) => (asI32(l) >= asI32(r) ? 1 : 0));

// ---- mov (0x55) ----
const op_mov: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, v);
};

/** op_mov (0x55) */
const op_fmov: OpHandler = (c) => {
  const v = readFloatOperand(c.e, c.frame, c.instr, 2);
  writeFloatOperand(c.e, c.frame, c.instr, 1, v);
};

/** float 双目：readFloat(2) [op] readFloat(3) -> writeFloat(1)。 */
function floatBinOp(apply: (l: number, r: number) => number): OpHandler {
  return (c) => {
    const l = readFloatOperand(c.e, c.frame, c.instr, 2);
    const r = readFloatOperand(c.e, c.frame, c.instr, 3);
    writeFloatOperand(c.e, c.frame, c.instr, 1, apply(l, r));
  };
}

/** int→float（0x2d6 专用已内联 in OPS 表）。 */

// ---- 位运算（0x135/0x136/0x13F）----
const op_bit_set: OpHandler = (c) => {
  const bit = readIntOperand(c.e, c.frame, c.instr, 2);
  if (bit > 0x1f) throw new Error(`bit-set: bit ${bit} > 31`);
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  writeIntOperand(c.e, c.frame, c.instr, 1, v | (1 << bit));
};
const op_bit_reset: OpHandler = (c) => {
  const bit = readIntOperand(c.e, c.frame, c.instr, 2);
  if (bit > 0x1f) throw new Error(`bit-reset: bit ${bit} > 31`);
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  writeIntOperand(c.e, c.frame, c.instr, 1, v & ~(1 << bit));
};
const op_check_bit: OpHandler = (c) => {
  const bit = readIntOperand(c.e, c.frame, c.instr, 3);
  if (bit > 0x1f) throw new Error(`check-bit: bit ${bit} > 31`);
  const v = readIntOperand(c.e, c.frame, c.instr, 2);
  writeIntOperand(c.e, c.frame, c.instr, 1, ((1 << bit) & v) !== 0 ? 1 : 0);
};

const op_random: OpHandler = (c) => {
  const mod = readIntOperand(c.e, c.frame, c.instr, 2);
  if (mod === 0) throw new Error('random: 模数为 0（引擎会抛除零异常）');
  // 近似引擎 rand()%mod：rand() 返回 [0,2^31)，与 Math.random() 近似（M0 非确定性，后续可换 LCG）。
  writeIntOperand(c.e, c.frame, c.instr, 1, ((Math.random() * 0x80000000) | 0) % mod);
};

/** int→float（0x2D6）：`op1 = (float)op2`。 */
const op_int_to_float: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 2);
  writeFloatOperand(c.e, c.frame, c.instr, 1, v);
};

/** 算术 / 位 / 比较 / 浮点 / 随机（VM 纯计算族）。 */
export const ARITHMETIC_OPS: OpTable = [
  [0x50, op_add],
  [0x51, op_sub],
  [0x52, op_mul],
  [0x53, op_div],
  [0x54, op_mod],
  [0x55, op_mov],
  [0x56, op_and],
  [0x57, op_or],
  [0x58, op_sar],
  [0x59, op_shl],
  [0x5a, op_eq],
  [0x5b, op_ne],
  [0x5c, op_lt],
  [0x5d, op_lte],
  [0x5e, op_gr],
  [0x5f, op_gre],
  [0x2d0, floatBinOp((l, r) => l + r)], // fadd
  [0x2d1, floatBinOp((l, r) => l - r)], // fsub
  [0x2d2, floatBinOp((l, r) => l * r)], // fmul
  [0x2d3, floatBinOp((l, r) => l / r)], // fdiv
  [0x2d4, floatBinOp((l, r) => (r === 0 ? 0 : l % r))], // fmod
  [0x2d5, op_fmov], // 浮点 mov（op1 = op2）
  [0x2d6, op_int_to_float], // int→float（op1 = (float)op2）
  [0x60, op_random],
  [0x135, op_bit_set],
  [0x136, op_bit_reset],
  [0x13f, op_check_bit],
];

