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
export function i32(v: number): number {
  return v | 0;
}
