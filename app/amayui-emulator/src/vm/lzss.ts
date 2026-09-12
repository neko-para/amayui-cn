/**
 * **AGE 引擎的 LZSS 解压**（Okumura LZSS / Allegro 变体，N=4096、F=18、THRESHOLD=2）。
 *
 * 为什么在 emulator 里也有一份：`SAVE.DAT` 在 `format >= 2` 时 payload 是
 * **Crypt 加密 + 本 LZSS 压缩**（引擎 `sub_4364E0`/`sub_436A80`；装载路径 raw 45051-45064）。
 * 要在 emulator 里读玩家的真存档（系统存档目录 `%LOCALAPPDATA%\Eushully\<game>\SAVE\SAVE.DAT`，
 * 见 `src/arch/systemPaths.ts` 的 overlay 层）就得解压这一段。
 *
 * 与 `scripts/alf/lzss.mjs`（ALF 解包工具，同一算法）的关系：那份是工具链的 Node 版，
 * 这份是 emulator 内部依赖，语义逐行相同（环形缓冲 `text_buf`、每 8 项一个 flag 字节、
 * `1` = 字面量 / `0` = 12 位位置 + 4 位长度），**CRC 校验已对真存档验证通过**（见 test/save-data.test.ts）。
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
