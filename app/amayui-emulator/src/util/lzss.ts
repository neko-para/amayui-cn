/**
 * **AGE 引擎的 LZSS 解压**（Okumura LZSS / Allegro 变体，N=4096、F=18、THRESHOLD=2）。
 *
 * 为什么放在 `src/util/`（T-0057 R5）：这段算法原先有**两份**逐行同义的实现
 * （`src/vm/lzss.ts` 供 `SAVE.DAT` 解压、`src/script/lzss.ts` 供 ALF/AAI 解包），
 * 而两份都不知道对方存在 —— 典型"同一语义两处、改一处漏一处"。
 * 现在只留这一份；`save/saveData.ts` 与 `script/alf.ts` 都 import 它。
 * （工具链 `scripts/alf/lzss.mjs` 是另一个包里的 Node 工具，属 T-0022 的跨包边，不在此列。）
 *
 * 语义（raw `sub_436A80` 一族）：环形缓冲 `text_buf`、每 8 项一个 flag 字节、
 * `1` = 字面量 / `0` = 12 位位置 + 4 位长度。**只解压方向**。
 */

const N = 4096;
const F = 18;
const THRESHOLD = 2;

/**
 * 解压 `input` 到 `output`。
 * @returns 实际写入 `output` 的字节数（引擎不看返回值；不足/超出都以缓冲区为准）。
 */
export function unlzss(input: Uint8Array, inputLen: number, output: Uint8Array, outputLen: number): number {
  const textBuf = new Uint8Array(N + F - 1);
  let r = N - F;
  let flags = 0;
  let size = 0;
  let at = 0;
  let c = 0;
  for (;;) {
    if (((flags >>= 1) & 256) === 0) {
      if (at >= inputLen) break;
      c = input[at++]!;
      flags = c | 0xff00;
    }
    if (flags & 1) {
      if (at >= inputLen) break;
      c = input[at++]!;
      textBuf[r++] = c;
      r &= N - 1;
      output[size++] = c;
      if (size >= outputLen) break;
    } else {
      if (at >= inputLen) break;
      let i = input[at++]!;
      if (at >= inputLen) break;
      let j = input[at++]!;
      i |= (j & 0xf0) << 4;
      j = (j & 0x0f) + THRESHOLD;
      for (let k = 0; k <= j; k++) {
        c = textBuf[(i + k) & (N - 1)]!;
        textBuf[r++] = c;
        r &= N - 1;
        output[size++] = c;
        if (size >= outputLen) break;
      }
      if (size >= outputLen) break;
    }
  }
  return size;
}
