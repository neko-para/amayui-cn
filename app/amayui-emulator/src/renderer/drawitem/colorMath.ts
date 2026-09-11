/** 插值原语：三元组线性插值 + 两种 ARGB 插值（整型窗插值与浮点插值）。 */
import type { Vec3 } from './model.js';

/** 线性插值三元组。 */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * **引擎的整数 lerp —— DrawItem 颜色窗（窗0）的逐帧求值器**（raw 117466-117479）。
 *
 * ```
 * we   = clock − delay − start          // "已过时间"（引擎 v18）
 * left = start + dur − (clock − delay)  // "剩余时间"（引擎 v19）= dur − we
 * ch   = (left·from_ch + we·to_ch) / dur  // 整数除法（截断；窗内 we/left 均 > 0，dur > 0 已前置保证）
 * ```
 * 通道字节序 = B(0) / G(8) / R(16) / A(24)（`B | G<<8 | R<<16 | A<<24`）。
 * ★是**截断**不是四舍五入：`from=0x00, to=0xFF, dur=2, we=1` ⇒ **127**（不是 128）。
 * ★与元素2（mesh）的浮点式**不是同一条公式**，见 {@link lerpArgbFloat}。
 */
export function lerpArgbWindow(from: number, to: number, we: number, dur: number): number {
  const ch = (shift: number) => {
    const a = (from >>> shift) & 0xff;
    const b = (to >>> shift) & 0xff;
    return (((dur - we) * a + we * b) / dur) | 0;
  };
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/**
 * **引擎的浮点 lerp —— mesh（元素2）的 `CalcDiffuse`**（`sub_4A2050` raw 122287-122294）。
 * `ch = (int)(state1_ch·t + state0_ch·(1−t))`：C 截断、**无 clamp**（`t` 由调用方保证 `∈[0,1]`）。
 * 引擎另有"四通道全 255 ⇒ 直接拷基础色"的快路（raw 122294-122307）。
 */
export function lerpArgbFloat(from: number, to: number, t: number): number {
  const ch = (shift: number) => {
    const a = (from >>> shift) & 0xff;
    const b = (to >>> shift) & 0xff;
    return Math.trunc(b * t + a * (1 - t));
  };
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}