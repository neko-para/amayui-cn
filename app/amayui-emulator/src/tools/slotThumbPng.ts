/**
 * **把存档缩略图（`.STH` = 320×180 24bpp BMP）转成 PNG**，便于直接看图核对
 * （`tickets/T-0062`：判断写出来的缩略图到底是"游戏画面"还是"存档列表的残留/素材拼贴"）。
 *
 *   node src/tools/slotThumbPng.ts <SAVE70.DAT|SAVE70.STH> [输出.png]
 *
 * 为什么需要它：`.STH` 是 BMP，而审查/看图工具（含本仓的 `read_image`）只吃 PNG/JPEG/WebP/GIF；
 * `saveDump` 只能给"非黑像素数"这类统计量，看不出**内容对不对**。
 * 只依赖 `node:zlib`（deflate）+ 手写 PNG 块，不引第三方库。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { decodeBmp } from '../vm/bmp.js';

/** CRC32（PNG 块校验；与 `util/crc32.ts` 的引擎口径无关，是 PNG 规范那一套）。 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32Png(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Png(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA（顶行在前）→ PNG（8 位真彩 + alpha）。 */
export function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = rgba[y * w * 4 + x]!;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function main(): void {
  const args = process.argv.slice(2);
  const src = args[0];
  if (!src) {
    console.error('用法：node src/tools/slotThumbPng.ts <SAVE70.DAT|SAVE70.STH> [输出.png]');
    process.exit(1);
  }
  const sth = src.toLowerCase().endsWith('.dat') ? src.replace(/\.dat$/i, '.STH') : src;
  if (!fs.existsSync(sth)) {
    console.error(`[err] 没有 ${sth}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(fs.readFileSync(sth));
  const bmp = decodeBmp(bytes);
  if (!bmp) {
    console.error(`[err] ${path.basename(sth)} 不是 BMP（${bytes.length} 字节；可能是宿主无像素时的自描述空块）`);
    process.exit(2);
  }
  const out = args[1] ?? sth.replace(/\.STH$/i, '.png');
  fs.writeFileSync(out, encodePng(bmp.width, bmp.height, bmp.rgba));
  // 统计（与 `saveDump` 同口径，便于对照）
  let nonBlack = 0;
  let opaque = 0;
  for (let i = 0; i < bmp.rgba.length; i += 4) {
    const [r, g, b, a] = [bmp.rgba[i]!, bmp.rgba[i + 1]!, bmp.rgba[i + 2]!, bmp.rgba[i + 3]!];
    if (a > 0) opaque++;
    if (r + g + b > 12) nonBlack++;
  }
  const px = bmp.width * bmp.height;
  console.log(
    `${path.basename(sth)} → ${out}（${bmp.width}x${bmp.height}；不透明 ${opaque}/${px}、非黑 ${nonBlack}/${px}）`,
  );
}

if (process.argv[1] && /slotThumbPng/.test(process.argv[1])) main();
