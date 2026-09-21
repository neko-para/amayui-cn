/**
 * 引擎存档用的两种 CRC32（`engine/天结_unpacked.exe_utf8.c` 的 `sub_436D00` / `sub_436D50`）。
 *
 * 引擎先建两张 256 项表（`sub_436BD0` = 以 `0x4C11DB7` 逐位左移建表；`sub_436C60` = 以 `0xEDB88320`
 * 逐位右移建表），运行期同一份 CRC 上下文只建一次（`_this[512]` 作标志）：
 *
 * | 函数 | 表 | 迭代 | 结果 | 对应本文件 |
 * |---|---|---|---|---|
 * | `sub_436D00` | `+256`（`0xEDB88320`） | `v = tab[(v ^ b) & 0xff] ^ (v >>> 8)` | `~v` | `crc32`（= 标准 zlib CRC32） |
 * | `sub_436D50` | `+256`（`0xEDB88320`） | `v = tab[b ^ (v >>> 24)] ^ (v << 8)` | `~v` | `crc32MsbFirst`（同表、反向移位） |
 *
 * `SAVE.DAT` 里这两个值都出现在：payload 内的前两个 dword（引擎 `sub_438320` 的 `a5[0]/a5[1]`，
 * 由 `sub_437480` 填入，覆盖 payload 的第 3 个 dword 起 = 我们的 payload 主体）与头后 20 字节块的
 * 第 2/3 个 dword（对整段 payload 再算一遍）。本工程两者一致：**都对 payload 主体计算**。
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/**
 * `sub_436BD0` 建的那张表（`_this[0..255]`）：非反射、poly `0x4C11DB7`，
 * 但索引按 `i << 25` 起步（等价于把 8 位索引**反过来**取），共 8 次移位。
 */
const TABLE_MSB = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = (i & 0x80 ? ((i << 25) >>> 0) ^ 0x4c11db7 : (i << 25) >>> 0) >>> 0;
    for (let k = 0; k < 7; k++) {
      v = (v & 0x80000000) === 0 ? (v * 2) >>> 0 : (((v * 2) >>> 0) ^ 0x4c11db7) >>> 0;
    }
    t[i] = v >>> 0;
  }
  return t;
})();

/** 标准（反射、低位先行）CRC32 —— 引擎 `sub_436D00`（表在 `+256`）。 */
export function crc32(data: Uint8Array): number {
  let v = 0xffffffff;
  for (let i = 0; i < data.length; i++) v = (TABLE[(v ^ data[i]!) & 0xff]! ^ (v >>> 8)) >>> 0;
  return (~v) >>> 0;
}

/** 高位先行 CRC32 —— 引擎 `sub_436D50`（表在 `+0`，由上表的另一种建表法生成）。 */
export function crc32MsbFirst(data: Uint8Array): number {
  let v = 0xffffffff;
  for (let i = 0; i < data.length; i++) v = (TABLE_MSB[(data[i]! ^ (v >>> 24)) & 0xff]! ^ (v << 8)) >>> 0;
  return (~v) >>> 0;
}
