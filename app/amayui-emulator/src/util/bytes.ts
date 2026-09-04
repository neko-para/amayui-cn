/** 字节读取：基于平台原生 DataView（getUint32/getUint16）的轻量 reader。
 *  TypedArray 本身没有多字节读方法；`readUInt32LE` 是 Node Buffer 的方法、`getUint32` 是 DataView 的方法。
 *  ByteView 用 DataView 实现，且正确处理「Uint8Array 是更大 buffer 的一段视图」的情形（subarray 的 byteOffset）。
 *  所有二进制定长字段均为 little-endian。 */
export class ByteView {
  readonly bytes: Uint8Array;
  private dv: DataView;
  constructor(b: Uint8Array) {
    this.bytes = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u16(offset: number): number {
    return this.dv.getUint16(offset, true);
  }
  u32(offset: number): number {
    return this.dv.getUint32(offset, true); // 返回 0..2^32-1（无符号）
  }
}

/** ANSI(单字节, 到 NUL 截断) 解码为 latin1 字符串（文件名用；脚本名是 ASCII）。 */
export function decodeAnsi(b: Uint8Array, offset: number, byteLen: number): string {
  let end = offset;
  const limit = offset + byteLen;
  while (end < limit && b[end] !== 0) end++;
  let s = '';
  for (let i = offset; i < limit && i < end; i++) s += String.fromCharCode(b[i]!);
  return s;
}
