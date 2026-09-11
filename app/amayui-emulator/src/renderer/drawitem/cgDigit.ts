/** `0x23B`：CG 数字条 → DrawItem 几何（纯函数；引擎 raw 32381-32503）。 */
import type { Item } from './model.js';
import { makeDefaultItem } from './model.js';

// ---------------------------------------------------------------------------
// `0x23B`：CG 数字条 → DrawItem 几何（纯函数；引擎 raw 32381-32503）
// ---------------------------------------------------------------------------

/** 一个待建的绘制项（`0x23B` 的输出）。 */
export interface CgDigitItem {
  handle: number;
  /** 纹理槽（记录 `[0]`）。 */
  tex: number;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dstX: number;
  dstY: number;
}

/**
 * **`0x23B` 的几何**（子集：只算要建哪些 DrawItem，不做删除）。
 *
 * 记录 `rec`：`[0]` 纹理槽 / `[1]` x0 / `[2]` y0 / `[3]` 单字宽 / `[4]` 字高 /
 * `[5]` 字内空隙 / `[6]` 字距（`adv = rec[3] + rec[6]`）。
 *
 * 循环：`k` 从 `digits-1` 递减到 0，每轮 `digit = value % 10` 后 `value /= 10`
 * ⇒ **第一个建出的项（handle = id）是"个位"、id+1 是十位…（自右向左）**。
 * 源矩形：`srcX = rec[1] + (rec[3] + rec[5]) · digit`、`srcY = rec[2]`。
 * x 三档：`flags & 2` 居中 `k·adv − adv·(last − 数位 + 1)/2 + op4`；
 * `flags & 4` 左对齐 `(数位 − 1 − (last − k))·adv + op4`；否则右对齐 `k·adv + op4`。
 * 前导零跳过，除非 `flags & 1`（补零）或是个位那一轮。（引擎 raw 32419/32452/32481 的判据）
 */
export function cgDigitItems(
  id: number,
  rec: readonly number[],
  value: number,
  x: number,
  y: number,
  digits: number,
  flags: number,
): CgDigitItem[] {
  const [tex = 0, sx0 = 0, sy0 = 0, cellW = 0, cellH = 0, gap = 0, adv0 = 0] = rec;
  const last = digits - 1;
  if (last < 0) return [];
  const advance = cellW + adv0;
  // 数位个数（引擎：居中/左对齐两档先算有效位数）
  let dc = 1;
  for (let t = Math.trunc(value / 10); t; t = Math.trunc(t / 10)) dc++;

  const out: CgDigitItem[] = [];
  let rem = value;
  for (let k = last; k >= 0; k--) {
    const digit = rem % 10;
    // 引擎判据（raw 32481）：`flags&1 || k == last || 当前剩余值 != 0`
    //（当前剩余值即"这一位有没有内容"；引擎用 v44 = 上一轮除完的余数，等价于本轮的 rem）
    if ((flags & 1) !== 0 || k === last || rem !== 0) {
      let px: number;
      if ((flags & 2) !== 0) px = k * advance - (advance * (last - dc + 1)) / 2 + x;
      else if ((flags & 4) !== 0) px = (dc - 1 - (last - k)) * advance + x;
      else px = k * advance + x;
      out.push({
        handle: id + out.length,
        tex,
        srcX: sx0 + (cellW + gap) * digit,
        srcY: sy0,
        srcW: cellW,
        srcH: cellH,
        dstX: px, // 引擎写入的是 float（居中档会出现 .5）
        dstY: y,
      });
    }
    rem = Math.trunc(rem / 10);
  }
  return out;
}