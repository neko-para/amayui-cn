/**
 * 算术 / 位运算 / 比较 / 浮点 / mov / 随机数（VM 纯计算族，唯一不碰引擎子系统的一组）。
 *
 * 这些 handler 只经 `readIntOperand`/`writeIntOperand` 与操作数池交互，
 * 因此也是最容易被单元测试直接驱动的一族（见 test/adv-string.test.ts、test/ptr.test.ts）。
 */
import type { OpHandler, StepCtx } from '../step.js';
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
/**
 * 整除 / 取模的共享原语（T-0057 R4）。
 *
 * - **C 的截断语义**：JS 的 `%` 本身就是"符号跟随被除数"（与 C 相同）⇒ `-5 % 3 = -2`。
 *   旧实现写的是 floored 版 `((l%r)+r)%r`（`-5 % 3 = 1`），与注释和 `opcode-table.md:81` 都相反。
 * - **除零抛错**：引擎会抛除零异常；旧实现 `div` 静默得 0、`mod` 静默得 NaN，
 *   而同文件的 `random` 却抛 —— 同一族三种处理。现在三条统一走这里。
 */
function intDiv(l: number, r: number): number {
  if (r === 0) throw new Error("div: 除数为 0（引擎会抛除零异常）");
  return Math.trunc(l / r);
}
function intMod(l: number, r: number): number {
  if (r === 0) throw new Error("mod: 模数为 0（引擎会抛除零异常）");
  return (l % r) | 0;
}
const op_div = binOp(intDiv);
const op_mod = binOp(intMod);
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
/**
 * 位指令族（`0x135` SetBit / `0x136` RemBit / `0x13F` GetBit）的**越界门 + 位号**（与体同形）。
 *
 * 三条体是同一形状（raw 39401-39421 / 39423-39443 / 39548-39568），以 `0x135` 为例：
 * ```c
 * _this[30 * _this[95776] + 95805] = 5;                        // arity 槽 ⇒ argc 2（0x13F 是 7 ⇒ 3）
 * v2 = sub_41BF50(_this, 2);                                   // ★位号 = op2（0x13F 是 op3）
 * v3 = v2;                                                     // char（取低 8 位）
 * if ( v2 > 0x1F ) {                                           // ★**unsigned** 比较
 *     sub_408050((char *)(_this + 8), 1024, aSetbit);          //   把 "SetBitの引数が不正です．" 格式化进缓冲
 *     sub_4034D0((void **)_this, (const char *)(_this + 8));   //   ★打印（sub_4034D0 返回 void）——**不抛异常**
 * } else {
 *     v4 = sub_41BF50(_this, 1);                               //   值 = op1
 *     sub_42B4B0(_this, 1, (1 << v3) | v4);                    //   op1 ← 置位
 * }
 * ```
 * ⇒ 两条口径（`tickets/T-0097` ②）：
 *  ① **比较是无符号**：`v2` 声明为 `unsigned int` ⇒ `-1`（= `0xFFFFFFFF`）也算越界；
 *  ② **越界分支是"打错误串后继续"**（不写 op1），**不是**抛异常 —— 与 `0x107`/`0x10B`/`0xFE` 那族
 *     不同（那三条体里是 `_CxxThrowException(…, Command_ShowMessage)`，真的抛）。
 * 旧实现：有符号 `bit > 0x1f` 判据 + 抛 JS `Error` ⇒ 负数位号会**照常写 op1**
 * （JS 的 `1 << -1` = 位移量 mod 32 ⇒ bit31），而越界在真机上是"打印一行然后继续"。
 * 三条语料都是 **0 处**（`i135`/`i136`/`i13f` 全库无使用）⇒ 不可见，但口径必须与体一致 ——
 * 且三条**共用**这一处判据，避免同一形状出现两种写法。
 */
function bitIndexGate(c: StepCtx, operand: number, mnemonic: string): number | null {
  const v = readIntOperand(c.e, c.frame, c.instr, operand);
  if ((v >>> 0) > 0x1f) {
    // 引擎的错误串分支：打印后继续，op1 原样不动
    c.log(`${mnemonic}: bit ${v}（无符号 ${v >>> 0}）> 0x1F ⇒ 按引擎打错误串分支（不写 op1）`);
    return null;
  }
  return v;
}

const op_bit_set: OpHandler = (c) => {
  const bit = bitIndexGate(c, 2, '0x135(SETBIT)'); // 引擎 raw 39411：unsigned v2 > 0x1F ⇒ 错误串（aSetbit）
  if (bit === null) return;
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  writeIntOperand(c.e, c.frame, c.instr, 1, v | (1 << bit));
};
const op_bit_reset: OpHandler = (c) => {
  const bit = bitIndexGate(c, 2, '0x136(REMBIT)'); // 引擎 raw 39433：错误串 aRembit
  if (bit === null) return;
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  writeIntOperand(c.e, c.frame, c.instr, 1, v & ~(1 << bit));
};
const op_check_bit: OpHandler = (c) => {
  const bit = bitIndexGate(c, 3, '0x13F(GETBIT)'); // 引擎 raw 39558：错误串 aGetbit
  if (bit === null) return;
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

/**
 * **`0x191` fabs**（`sub_42CEC0` raw 37896-37906，argc 2）：`op1 = fabs(op2)`（**浮点**）。
 *
 * 体全文：`arity 槽 = 5`（⇒ argc 2）；`v3 = sub_41C300(_this, 2)`（浮点读）；`v4 = fabs(v3)`；
 * `writeFloatOperand(1, v4)`（签名 `sub_42BA00`，raw 37131-37132）。
 * ★语料 **13 处**（BTL / CGVIEWER / FIELD / INFOPL / SELACT / SELFORT）；此前零注册 ⇒ 命中即 `NotImplementedOp`
 * （审计 P1 `op-1/0x191-fabs-missing`，`tickets/T-0076` 的 B3）。
 */
const op_fabs: OpHandler = (c) => {
  const v = readFloatOperand(c.e, c.frame, c.instr, 2);
  writeFloatOperand(c.e, c.frame, c.instr, 1, Math.abs(v));
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
  [0x191, op_fabs], // ★fabs：op1 = |op2|（浮点；语料 13 处，此前零注册 ⇒ 命中即硬停；T-0076 的 B3）
  [0x60, op_random],
  [0x135, op_bit_set],
  [0x136, op_bit_reset],
  [0x13f, op_check_bit],
];

