/**
 * **BMP 编解码（`.STH` 存档缩略图的真实格式）** —— `tickets/T-0036`。
 *
 * ## 为什么需要它
 *
 * 引擎的 `0x1AE`/`0x1AF`（写/读 `SAVE%2.2d.STH`）**不是**自定义容器，而是普通的 Windows BMP：
 *  - 写侧 `sub_43BF20`（raw 47838，本工程命名 ddWriteBmp）：`*((_WORD *)v5 + 2) = 19778`（= `0x4D42` = `"BM"`）、
 *    `offBits = 54`、DIB 头 40 字节、宽/高取自该槽的 surface、`bpp = 24`，行按 32 bit 对齐
 *    （`v8 = 24*w`，`v8 % 32` 时向上补到 32 的倍数）；
 *  - 读侧 `sub_40BF20`（raw 16072）→ `sub_43E9F0`（raw 49926，函数里报错串写的就是 ddReadBmp）先校验
 *    `*((_WORD *)v7 + 2) == 19778` 再按 BMP 解进 `op3` 那个纹理槽。
 *
 * ★**引擎写出的 `bfSize` 比真实文件小 14 字节**（raw 47894 写的是 `像素字节数 + 40`，而文件还有 14 字节
 * 文件头）⇒ **解码不许信 `bfSize`**（E4 实测：本机 47 个 `SAVE??.STH` 全是 172,854 字节，头里写的却是 172,840）。
 * 同理也不要信 `biSizeImage`（引擎写 0）。
 *
 * 本模块只做 24bpp BI_RGB（无压缩）——那正是引擎写的那一种；其余形态（压缩/调色板/32bpp）返回 null，
 * 由调用方按"解不出"处理（`op1 = 2`），不假装成功。
 */

/** 解出的位图（`rgba` 为**顶行在前**的 RGBA8，长度 `w*h*4`）。 */
export interface Bitmap {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** `"BM"` 小端读作 u16。 */
export const BMP_MAGIC = 0x4d42;

/** 判断一段字节是不是 BMP（只看魔数；引擎的 `ddReadBmp` 同口径）。 */
export function isBmp(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 2) return false;
  return (bytes[0]! | (bytes[1]! << 8)) === BMP_MAGIC;
}

/**
 * 解析 24bpp 未压缩 BMP。
 *
 * - 高度可正（自底向上，BMP 常规）可负（自顶向下）；
 * - 行按 4 字节对齐（`rowBytes = ceil(w*3/4)*4`）；
 * - 像素是 **BGR**，输出转成 **RGBA**（alpha 恒 255：BMP 没有透明通道）；
 * - 长度不足（截断文件）⇒ null（宁可报"解不出"，也不给半张图）。
 */
export function decodeBmp(bytes: Uint8Array): Bitmap | null {
  if (!isBmp(bytes) || bytes.length < 54) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dibSize = dv.getUint32(14, true);
  if (dibSize < 40) return null; // BITMAPCOREHEADER 等老形态不在此列
  const width = dv.getInt32(18, true);
  const rawHeight = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  if (width <= 0 || rawHeight === 0 || bpp !== 24 || compression !== 0) return null;
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const offBits = dv.getUint32(10, true);
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const need = offBits + rowBytes * height;
  if (offBits < 14 + dibSize || need > bytes.length) return null;

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    // 自底向上：文件第 0 行是图像**最后**一行
    const src = offBits + (topDown ? y : height - 1 - y) * rowBytes;
    const dst = y * width * 4;
    for (let x = 0; x < width; x++) {
      const p = src + x * 3;
      rgba[dst + x * 4] = bytes[p + 2]!; // R ← 第 3 字节
      rgba[dst + x * 4 + 1] = bytes[p + 1]!; // G
      rgba[dst + x * 4 + 2] = bytes[p]!; // B ← 第 1 字节
      rgba[dst + x * 4 + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/**
 * 编码成 24bpp 未压缩 BMP（自底向上、行 4 字节对齐、RGB→BGR）。
 *
 * ★与引擎的唯一差异：`bfSize` 写**正确值**（`54 + 行字节*高`）。引擎 raw 47894 写的是
 * `像素字节数 + 40`（少算了自己的 14 字节文件头），但那是**读侧不看**的字段（ddReadBmp 用 DIB 头 +
 * 调用方给的 GetFileSize）⇒ 写正确值不会影响引擎读我们的槽。
 */
export function encodeBmp(bmp: Bitmap): Uint8Array {
  const { width, height, rgba } = bmp;
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const out = new Uint8Array(54 + pixelBytes);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  dv.setUint32(2, out.length, true); // bfSize（真实值；引擎那份少 14，见函数注释）
  dv.setUint32(10, 54, true); // bfOffBits
  dv.setUint32(14, 40, true); // BITMAPINFOHEADER
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true); // 正数 = 自底向上
  dv.setUint16(26, 1, true); // planes
  dv.setUint16(28, 24, true); // bpp
  dv.setUint32(30, 0, true); // BI_RGB
  dv.setUint32(34, pixelBytes, true); // biSizeImage（引擎写 0，这里给真值，读侧不用它）
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4; // 自底向上：先写图像最后一行
    const dst = 54 + y * rowBytes;
    for (let x = 0; x < width; x++) {
      out[dst + x * 3] = rgba[src + x * 4 + 2]!; // B
      out[dst + x * 3 + 1] = rgba[src + x * 4 + 1]!; // G
      out[dst + x * 3 + 2] = rgba[src + x * 4]!; // R
    }
  }
  return out;
}
