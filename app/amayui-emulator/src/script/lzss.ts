/**
 * LZSS 解压（Allegro 变体 / Okumura LZSS）—— 由 scripts/alf/lzss.mjs 移植。
 * 详情见该文件头注：环形缓冲 N+F-1、每 8 单位 1 个 flag 字节、flag=1 字面量 / flag=0 位置-长度对。
 * 仅解压方向，单次新建 state==0 上下文（与 unpack_alf 一致）。
 */
export const N = 4096;
export const F = 18;
export const THRESHOLD = 2;

interface UnlzssData {
  i: number;
  j: number;
  k: number;
  r: number;
  c: number;
  flags: number;
  text_buf: Uint8Array;
}

function createUnlzssData(): UnlzssData {
  return { i: 0, j: 0, k: 0, r: 0, c: 0, flags: 0, text_buf: new Uint8Array(N + F - 1).fill(0) };
}

function lzssRead(inputbuf: Uint8Array, inputsize: number, dat: UnlzssData, s: number, buf: Uint8Array): number {
  let inputindex = 0;
  let { i, j, k, r, c, flags } = dat;
  let size = 0;
  let done = false;
  r = N - F;
  flags = 0;
  for (;;) {
    if (((flags >>= 1) & 256) === 0) {
      if (inputindex >= inputsize) break;
      c = inputbuf[inputindex++]!;
      flags = c | 0xff00;
    }
    if (flags & 1) {
      if (inputindex >= inputsize) break;
      c = inputbuf[inputindex++]!;
      dat.text_buf[r++] = c;
      r &= N - 1;
      buf[size++] = c;
      if (size >= s) {
        done = true;
        break;
      }
    } else {
      if (inputindex >= inputsize) break;
      i = inputbuf[inputindex++]!;
      if (inputindex >= inputsize) break;
      j = inputbuf[inputindex++]!;
      i |= (j & 0xf0) << 4;
      j = (j & 0x0f) + THRESHOLD;
      for (k = 0; k <= j; k++) {
        c = dat.text_buf[(i + k) & (N - 1)]!;
        dat.text_buf[r++] = c;
        r &= N - 1;
        buf[size++] = c;
        if (size >= s) {
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }
  if (!done) (dat as any).state = 0;
  dat.i = i;
  dat.j = j;
  dat.k = k;
  dat.r = r;
  dat.c = c;
  dat.flags = flags;
  return size;
}

/** 解压 inputbuf（len 字节）到 outputbuf（应为 outputlen 字节），返回写入字节数。 */
export function unlzss(inputbuf: Uint8Array, inputlen: number, outputbuf: Uint8Array, outputlen: number): number {
  const dat = createUnlzssData();
  return lzssRead(inputbuf, inputlen, dat, outputlen, outputbuf);
}
