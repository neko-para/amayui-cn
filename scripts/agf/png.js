// 最小 PNG 编解码（8 位、非隔行），用于 AGF 图片导出/导入。
// 支持 color type：0(灰度) / 2(RGB) / 3(调色板) / 4(灰度+Alpha) / 6(RGBA)。
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function channelsOf(colorType) {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: throw new Error(`不支持的 PNG color type ${colorType}`);
  }
}

export function decodePng(buf) {
  const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(MAGIC)) {
    throw new Error('非 PNG 文件');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  const idat = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = [];
      for (let i = 0; i + 3 <= len; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}（仅 8 位）`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG（Adam7）');
  const ch = channelsOf(colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  if (raw.length < height * (stride + 1)) throw new Error('PNG 数据不完整');
  // 反滤波
  const rows = [];
  let off = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[off];
    off++;
    const row = Buffer.from(raw.subarray(off, off + stride));
    off += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      switch (filter) {
        case 0: break;
        case 1: row[x] = (row[x] + a) & 0xff; break;
        case 2: row[x] = (row[x] + b) & 0xff; break;
        case 3: row[x] = (row[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: row[x] = (row[x] + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`未知 PNG 滤波 ${filter}`);
      }
    }
    rows.push(row);
    prev = row;
  }
  // 转 RGBA（top-down）
  const rgba = Buffer.alloc(width * height * 4);
  let o = 0;
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) {
      const p = x * ch;
      if (colorType === 3) {
        const idx = row[p];
        const c = palette && palette[idx] ? palette[idx] : [idx, idx, idx];
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      } else if (colorType === 0) {
        rgba[o] = row[p]; rgba[o + 1] = row[p]; rgba[o + 2] = row[p]; rgba[o + 3] = 255;
      } else if (colorType === 4) {
        rgba[o] = row[p]; rgba[o + 1] = row[p]; rgba[o + 2] = row[p]; rgba[o + 3] = row[p + 1];
      } else if (colorType === 2) {
        rgba[o] = row[p]; rgba[o + 1] = row[p + 1]; rgba[o + 2] = row[p + 2]; rgba[o + 3] = 255;
      } else {
        rgba[o] = row[p]; rgba[o + 1] = row[p + 1]; rgba[o + 2] = row[p + 2]; rgba[o + 3] = row[p + 3];
      }
      o += 4;
    }
  }
  return { width, height, palette, rgba };
}

// 编码：mode = 'rgba' | 'rgb' | 'palette'（palette 需提供 palette + indices）
export function encodePng(width, height, { rgba, rgb, palette, indices }) {
  let colorType;
  let src;
  let plte = null;
  if (indices) {
    colorType = 3;
    src = indices;
    plte = palette;
  } else if (rgba) {
    colorType = 6;
    src = rgba;
  } else {
    colorType = 2;
    src = rgb;
  }
  const ch = colorType === 3 ? 1 : colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const raw = Buffer.alloc(height * (stride + 1));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o] = 0; // filter None
    o++;
    src.copy(raw, o, y * stride, (y + 1) * stride);
    o += stride;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[12] = 0;
  const out = [Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', ihdr)];
  if (plte) {
    const p = Buffer.alloc(plte.length * 3);
    for (let i = 0; i < plte.length; i++) {
      p[i * 3] = plte[i][0];
      p[i * 3 + 1] = plte[i][1];
      p[i * 3 + 2] = plte[i][2];
    }
    out.push(chunk('PLTE', p));
  }
  out.push(chunk('IDAT', zlib.deflateSync(raw)));
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}
