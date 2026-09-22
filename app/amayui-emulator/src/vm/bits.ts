/** 32 位整数运算与 DEC/ENC 去混淆（docs/re/engine/05）。
 *  TS number 是 double；所有位模式运算用 `|0`/`>>>0`/手写 ROL/ROR 保持 32 位语义（ADR-006）。 */

/** 32 位无符号环形左移。 */
export function rol32(v: number, n: number): number {
  n &= 31;
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}
/** 32 位无符号环形右移。 */
export function ror32(v: number, n: number): number {
  n &= 31;
  return ((v >>> n) | (v << (32 - n))) >>> 0;
}
/** 读侧去混淆：DEC(x) = ROR4(key ^ ROL4(x,11), 25) = ROL4(key ^ ROL4(x,11), 7) */
export function dec(key: number, x: number): number {
  return ror32(key ^ rol32(x, 11), 25) >>> 0;
}
/** 写侧编码：ENC(a) = ROL4(key ^ ROR4(a,7), 21)（与 DEC 互为逆运算，key 相同） */
export function enc(key: number, a: number): number {
  return rol32(key ^ ror32(a, 7), 21) >>> 0;
}

/** i32 有符号化（用于有符号算术/比较）。 */
export function asI32(v: number): number {
  return v | 0;
}

/** 把一个 32 位无符号位模式按 int32 解释（用于 DEC 后的有符号量）。 */
/**
 * **int32 位模式 → float 数值**（IEEE754 单精度）。
 *
 * 为什么需要它：调试条件语言只比**整数**（没有浮点字面量），而 `global-float-write` 事件里的
 * `val` 是 float 的**位模式** ⇒ 用户写 `f2i(val) == 10` 才能表达"值等于 10.0"。
 * 用 `Float32Array` 而不是手写位运算：语义与 JS 引擎一致，且不会在 NaN/非规格化数上出错。
 */
export function f32(bits: number): number {
  // ★必须**经 Int32 视图写入**（存的是位模式），再从 Float32 视图读出；
  //   若写成 `F32[0] = bits`，JS 会把 `bits` 当**数值**去做单精度舍入 ——
  //   位模式就被"再舍入"一次，`f32(1069547520)` 会返回 1069547520 而不是 1.5（实测踩过）。
  F32B_I32[0] = bits | 0;
  return F32B[0]!;
}
const F32B = new Float32Array(1);
const F32B_I32 = new Int32Array(F32B.buffer);

export function i32(v: number): number {
  return v | 0;
}

/** 简单 atoi（字符串 -> int；age 语义：解析十进制前缀，空/失败返 0）。 */
export function atoi(s: string): number {
  const m = /^\s*[+-]?\d+/.exec(s);
  if (!m) return 0;
  const v = Number.parseInt(m[0], 10);
  return Number.isFinite(v) ? v | 0 : 0;
}
