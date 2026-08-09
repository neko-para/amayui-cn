// AGF（Eushully 图片）格式核心：与 Eushully_AGF_TooL（Python 版）逻辑一致。
// 支持 ACGF 固定头与无头两种格式的解析/导出，以及有头注入、无头打包。
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './png.js';

const LZSS_FRAME_SIZE = 4096;
const LZSS_INIT_POS = 4078;

export function lzssDecompress(data, outputLen) {
  const out = Buffer.alloc(outputLen);
  const frame = Buffer.alloc(LZSS_FRAME_SIZE);
  let outPtr = 0;
  let framePtr = LZSS_INIT_POS;
  let inPtr = 0;
  const inLen = data.length;
  while (outPtr < outputLen && inPtr < inLen) {
    let flags = data[inPtr++];
    for (let k = 0; k < 8; k++) {
      if (outPtr >= outputLen) break;
      if (flags & 1) {
        if (inPtr >= inLen) break;
        const v = data[inPtr++];
        out[outPtr++] = v;
        frame[framePtr] = v;
        framePtr = (framePtr + 1) & 4095;
      } else {
        if (inPtr + 1 >= inLen) break;
        const lo = data[inPtr];
        const hi = data[inPtr + 1];
        inPtr += 2;
        const offset = lo | ((hi & 0xf0) << 4);
        const length = (hi & 0x0f) + 3;
        for (let i = 0; i < length; i++) {
          if (outPtr >= outputLen) break;
          const v = frame[(offset + i) & 4095];
          out[outPtr++] = v;
          frame[framePtr] = v;
          framePtr = (framePtr + 1) & 4095;
        }
      }
      flags >>= 1;
    }
  }
  return out;
}

export function strideFor(w, bpp) {
  if (bpp === 8) return (w + 3) & -4;
  if (bpp === 24) return (w * 3 + 3) & -4;
  if (bpp === 32) return w * 4;
  return 0;
}

export function sizeFor(w, h, bpp) {
  const s = strideFor(w, bpp);
  return s > 0 ? s * h : 0;
}

export function plausibleWh(w, h) {
  return w >= 1 && w <= 20000 && h >= 1 && h <= 20000;
}

export function parseWhBpp(metaUnpacked) {
  let w = 0;
  let h = 0;
  let bpp = 0;
  if (metaUnpacked.length >= 32) {
    w = metaUnpacked.readUInt32LE(20);
    h = metaUnpacked.readUInt32LE(24);
    bpp = metaUnpacked.readInt16LE(30);
  }
  if ((w === 0 || h === 0) && metaUnpacked.length >= 8) {
    const w2 = metaUnpacked.readUInt32LE(0);
    const h2 = metaUnpacked.readUInt32LE(4);
    if (w2 && h2) {
      w = w2;
      h = h2;
    }
  }
  return [w, h, bpp];
}

export function extractPaletteRgb(metaUnpacked) {
  let palOff;
  if (metaUnpacked.length >= 1080) palOff = 56;
  else if (metaUnpacked.length >= 1024) palOff = metaUnpacked.length - 1024;
  else return null;
  const pal = [];
  for (let i = 0; i < 256; i++) {
    const b = metaUnpacked[palOff + i * 4];
    const g = metaUnpacked[palOff + i * 4 + 1];
    const r = metaUnpacked[palOff + i * 4 + 2];
    pal.push([r, g, b]);
  }
  return pal;
}

export function readAcgfMeta(buf) {
  if (buf.subarray(0, 4).toString('latin1') !== 'ACGF') throw new Error('Not ACGF');
  const metaUnp = buf.readInt32LE(12);
  const metaPak = buf.readInt32LE(20);
  const metaOff = 24;
  if (metaOff + metaPak > buf.length) throw new Error('Meta out of range');
  const metaPacked = buf.subarray(metaOff, metaOff + metaPak);
  const metaUnpacked = metaUnp === metaPak ? metaPacked : lzssDecompress(metaPacked, metaUnp);
  return { metaUnp, metaPak, metaOff, metaPacked, metaUnpacked };
}

// reader：{ buf, pos } 的简单文件视图
function readSection(reader, unpackedSize, packedSize) {
  if (packedSize <= 0) return Buffer.alloc(0);
  let raw = reader.buf.subarray(reader.pos, reader.pos + packedSize);
  reader.pos += raw.length;
  if (raw.length !== packedSize) {
    const pad = Buffer.alloc(packedSize - raw.length);
    raw = Buffer.concat([raw, pad]);
  }
  return unpackedSize === packedSize ? raw : lzssDecompress(raw, unpackedSize);
}

function readNoheadMeta(reader, fileSize, metaOff, metaUnp, metaPak) {
  if (metaOff < 0 || metaOff + metaPak > fileSize) return null;
  reader.pos = metaOff;
  const metaPacked = reader.buf.subarray(metaOff, metaOff + metaPak);
  if (metaPacked.length !== metaPak) return null;
  return metaUnp === metaPak ? metaPacked : lzssDecompress(metaPacked, metaUnp);
}

function guessResolutionBruteforce(bodyUnp) {
  const commonWidths = [2560, 1920, 1600, 1366, 1280, 1024, 960, 800, 640, 512, 480, 320];
  const seen = new Set();
  const widths = [];
  for (const w of commonWidths) {
    if (!seen.has(w)) {
      widths.push(w);
      seen.add(w);
    }
  }
  for (let w = 64; w < 4097; w++) {
    if (!seen.has(w)) {
      widths.push(w);
      seen.add(w);
    }
  }
  for (const bpp of [32, 24, 8]) {
    for (const w of widths) {
      const s = strideFor(w, bpp);
      if (s <= 0 || bodyUnp % s !== 0) continue;
      const h = Math.floor(bodyUnp / s);
      if (plausibleWh(w, h)) return [w, h, bpp];
    }
  }
  return [0, 0, 0];
}

function guessResolutionCommon(bodyUnp) {
  const resolutions = [
    [2560, 1440], [1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1024, 768],
    [800, 600], [960, 640], [1280, 512], [1024, 512], [1280, 202], [1024, 576],
    [640, 480], [512, 512],
  ];
  for (const [w, h] of resolutions) {
    for (const bpp of [32, 24, 8]) {
      if (sizeFor(w, h, bpp) === bodyUnp) return [w, h, bpp];
      if (bpp === 24 || bpp === 32) {
        if (w * h * (bpp / 8) === bodyUnp) return [w, h, bpp];
      } else if (bpp === 8 && w * h === bodyUnp) {
        return [w, h, 8];
      }
    }
  }
  return [0, 0, 0];
}

export function inferBppFromBodySize(w, h, bodyUnp, metaBpp) {
  for (const bpp of [8, 24, 32]) {
    if (sizeFor(w, h, bpp) === bodyUnp) return bpp;
  }
  return metaBpp;
}

function scoreNoheadPlan(metaOff, metaUnp, metaPak, metaData, bodyHdrPos, hdrSz, bodyUnp, bodyPak, w0, h0, bpp0) {
  let score = 0;
  if (bodyPak <= bodyUnp) score += 10;
  if (bodyUnp === bodyPak) score += 8;
  const metaOk = plausibleWh(w0, h0) && [8, 24, 32].includes(bpp0);
  if (metaOk) score += 10;
  let w = w0;
  let h = h0;
  let bpp = bpp0;
  if (metaOk) {
    const bppInf = inferBppFromBodySize(w0, h0, bodyUnp, bpp0);
    if ([8, 24, 32].includes(bppInf) && sizeFor(w0, h0, bppInf) === bodyUnp) {
      score += 60;
      bpp = bppInf;
    }
  }
  if (!(metaOk && sizeFor(w, h, bpp) === bodyUnp)) {
    let [gw, gh, gbpp] = guessResolutionCommon(bodyUnp);
    if (gw === 0) [gw, gh, gbpp] = guessResolutionBruteforce(bodyUnp);
    if (gw !== 0) {
      score += 45;
      w = gw;
      h = gh;
      bpp = gbpp;
    }
  }
  if (plausibleWh(w, h) && [8, 24, 32].includes(bpp) && sizeFor(w, h, bpp) === bodyUnp) score += 40;
  if (hdrSz === 8) score += 3;
  return { score, metaOff, metaUnp, metaPak, metaData, bodyHdrPos, bodyHdrSize: hdrSz, bodyUnp, bodyPak, w, h, bpp };
}

export function enumerateNoheadPlans(reader, fileSize, metaUnp, metaPak) {
  const plans = [];
  for (const metaOff of [24, 28]) {
    const metaData = readNoheadMeta(reader, fileSize, metaOff, metaUnp, metaPak);
    if (!metaData) continue;
    const [w0, h0, bpp0] = parseWhBpp(metaData);
    const bodyHdrPos = metaOff + metaPak;
    if (bodyHdrPos + 8 > fileSize) continue;
    reader.pos = bodyHdrPos;
    const bh8 = reader.buf.subarray(bodyHdrPos, bodyHdrPos + 8);
    if (bh8.length === 8) {
      const unp8 = bh8.readInt32LE(0);
      const pak8 = bh8.readInt32LE(4);
      if (unp8 > 0 && pak8 > 0 && bodyHdrPos + 8 + pak8 <= fileSize) {
        plans.push(scoreNoheadPlan(metaOff, metaUnp, metaPak, metaData, bodyHdrPos, 8, unp8, pak8, w0, h0, bpp0));
      }
    }
    if (bodyHdrPos + 12 <= fileSize) {
      reader.pos = bodyHdrPos;
      const bh12 = reader.buf.subarray(bodyHdrPos, bodyHdrPos + 12);
      if (bh12.length === 12) {
        const unp12 = bh12.readInt32LE(4);
        const pak12 = bh12.readInt32LE(8);
        if (unp12 > 0 && pak12 > 0 && bodyHdrPos + 12 + pak12 <= fileSize) {
          plans.push(scoreNoheadPlan(metaOff, metaUnp, metaPak, metaData, bodyHdrPos, 12, unp12, pak12, w0, h0, bpp0));
        }
      }
    }
  }
  return plans;
}

function imgToRgb(img) {
  const n = img.width * img.height;
  const rgb = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = img.rgba[i * 4];
    rgb[i * 3 + 1] = img.rgba[i * 4 + 1];
    rgb[i * 3 + 2] = img.rgba[i * 4 + 2];
  }
  return rgb;
}

function imgToRgba(img) {
  return img.rgba;
}

function flipRows(buf, w, h, ch) {
  const row = w * ch;
  const out = Buffer.alloc(buf.length);
  for (let y = 0; y < h; y++) buf.copy(out, (h - 1 - y) * row, y * row, (y + 1) * row);
  return out;
}

// bpp=8：按调色板最近色量化（无抖动）
function quantizeToPalette(img, palette) {
  const n = img.width * img.height;
  const idx = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const r = img.rgba[i * 4];
    const g = img.rgba[i * 4 + 1];
    const b = img.rgba[i * 4 + 2];
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const dr = r - palette[k][0];
      const dg = g - palette[k][1];
      const db = b - palette[k][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    idx[i] = best;
  }
  return idx;
}

export function buildBodyFromPng(pngPath, w, h, bpp, paletteRgb = null) {
  const img = decodePng(fs.readFileSync(pngPath));
  if (img.width !== w || img.height !== h) {
    throw new Error(`PNG尺寸不匹配: ${img.width}x${img.height} != ${w}x${h}`);
  }
  if (bpp === 8) {
    if (!paletteRgb) throw new Error('8bpp 需要调色板');
    const idx = quantizeToPalette(img, paletteRgb);
    const raw = flipRows(idx, w, h, 1);
    const s = strideFor(w, 8);
    if (s === w) return raw;
    const out = Buffer.alloc(s * h);
    for (let y = 0; y < h; y++) raw.copy(out, y * s, y * w, (y + 1) * w);
    return out;
  }
  if (bpp === 24) {
    const rgb = flipRows(imgToRgb(img), w, h, 3);
    // RGB → BGR
    for (let i = 0; i < rgb.length; i += 3) {
      const t = rgb[i];
      rgb[i] = rgb[i + 2];
      rgb[i + 2] = t;
    }
    const rowBytes = w * 3;
    const s = strideFor(w, 24);
    if (s === rowBytes) return rgb;
    const out = Buffer.alloc(s * h);
    for (let y = 0; y < h; y++) rgb.copy(out, y * s, y * rowBytes, (y + 1) * rowBytes);
    return out;
  }
  if (bpp === 32) {
    const rgba = flipRows(imgToRgba(img), w, h, 4);
    // RGBA → BGRA
    for (let i = 0; i < rgba.length; i += 4) {
      const t = rgba[i];
      rgba[i] = rgba[i + 2];
      rgba[i + 2] = t;
    }
    return rgba; // stride == w*4
  }
  throw new Error(`不支持的bpp=${bpp}`);
}

export function buildAlphaTopdown(pngPath, w, h) {
  const img = decodePng(fs.readFileSync(pngPath));
  if (img.width !== w || img.height !== h) throw new Error('Alpha尺寸不匹配');
  const n = w * h;
  const a = Buffer.alloc(n);
  for (let i = 0; i < n; i++) a[i] = img.rgba[i * 4 + 3];
  return a;
}

export function extractAgfToPng(agfPath, outDir, mode = 'auto', log = console.log) {
  const name = path.basename(agfPath);
  const buf = fs.readFileSync(agfPath);
  const reader = { buf, pos: 0 };
  if (buf.length < 32) {
    log(`[跳过] 文件过短: ${name}`);
    return null;
  }
  let isAcgf;
  if (mode === 'force_acgf') isAcgf = true;
  else if (mode === 'force_nohead') isAcgf = false;
  else if (buf.subarray(0, 4).toString('latin1') === 'ACGF') isAcgf = true;
  else if (buf.subarray(0, 4).equals(Buffer.alloc(4))) isAcgf = false;
  else {
    log(`[跳过] 未知头: ${name}`);
    return null;
  }
  let alpha = null;
  let hasAcif = false;
  let w;
  let h;
  let bpp;
  let metaData;
  let bodyData;
  if (isAcgf) {
    const metaUnp = buf.readInt32LE(12);
    const metaPak = buf.readInt32LE(20);
    const metaOff = 24;
    const metaPacked = buf.subarray(metaOff, metaOff + metaPak);
    if (metaPacked.length !== metaPak) {
      log(`[失败] Meta读取不足: ${name}`);
      return null;
    }
    metaData = metaUnp === metaPak ? metaPacked : lzssDecompress(metaPacked, metaUnp);
    [w, h, bpp] = parseWhBpp(metaData);
    const bodyHdrPos = metaOff + metaPak;
    const bh = buf.subarray(bodyHdrPos, bodyHdrPos + 12);
    if (bh.length < 12) {
      log(`[失败] Body头不足: ${name}`);
      return null;
    }
    const bodyUnp = bh.readInt32LE(4);
    const bodyPak = bh.readInt32LE(8);
    reader.pos = bodyHdrPos + 12;
    bodyData = readSection(reader, bodyUnp, bodyPak);
    const bodyDataEndPos = reader.pos;
    const tail = buf.subarray(bodyDataEndPos, bodyDataEndPos + 2048);
    const idx = tail.indexOf(Buffer.from('ACIF', 'latin1'));
    if (idx >= 0) {
      const acifOff = bodyDataEndPos + idx;
      const aUnp = buf.readInt32LE(acifOff + 4 + 24);
      const aPak = buf.readInt32LE(acifOff + 4 + 24 + 4);
      if (aUnp === w * h) {
        reader.pos = acifOff + 4 + 24 + 8;
        alpha = readSection(reader, aUnp, aPak);
        hasAcif = true;
      }
    }
  } else {
    const metaUnp = buf.readInt32LE(12);
    const metaPak = buf.readInt32LE(20);
    const plans = enumerateNoheadPlans(reader, buf.length, metaUnp, metaPak);
    if (!plans.length) {
      log(`[失败] 无头结构无法识别: ${name}`);
      return null;
    }
    const plan = plans.reduce((a, b) => (b.score > a.score ? b : a));
    w = plan.w;
    h = plan.h;
    bpp = plan.bpp;
    metaData = plan.metaData;
    reader.pos = plan.bodyHdrPos + plan.bodyHdrSize;
    bodyData = readSection(reader, plan.bodyUnp, plan.bodyPak);
  }
  let palette = null;
  if (bpp === 8) {
    palette = extractPaletteRgb(metaData);
    if (!palette) {
      if (metaData.length >= 1024) {
        const palData = metaData.subarray(metaData.length - 1024);
        palette = [];
        for (let i = 0; i < 256; i++) {
          palette.push([palData[i * 4 + 2], palData[i * 4 + 1], palData[i * 4]]);
        }
      } else {
        palette = [];
        for (let i = 0; i < 256; i++) palette.push([i, i, i]);
      }
    }
  }
  const s = strideFor(w, bpp);
  const need = s * h;
  if (bodyData.length < need) {
    const pad = Buffer.alloc(need - bodyData.length);
    bodyData = Buffer.concat([bodyData, pad]);
  }
  let outImg; // { width, height, rgba }（top-down）
  const applyAlpha = hasAcif && alpha && alpha.length === w * h;
  if (bpp === 24) {
    // body 是 bottom-up BGR + stride
    const rgb = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * s;
      for (let x = 0; x < w; x++) {
        rgb[(y * w + x) * 3] = bodyData[srcRow + x * 3 + 2];
        rgb[(y * w + x) * 3 + 1] = bodyData[srcRow + x * 3 + 1];
        rgb[(y * w + x) * 3 + 2] = bodyData[srcRow + x * 3];
      }
    }
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = applyAlpha ? alpha[i] : 255;
    }
    outImg = { width: w, height: h, rgba };
  } else if (bpp === 32) {
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * s;
      for (let x = 0; x < w; x++) {
        const d = (y * w + x) * 4;
        const s2 = srcRow + x * 4;
        rgba[d] = bodyData[s2 + 2];
        rgba[d + 1] = bodyData[s2 + 1];
        rgba[d + 2] = bodyData[s2];
        rgba[d + 3] = bodyData[s2 + 3];
      }
    }
    if (applyAlpha) {
      for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = alpha[i];
    }
    outImg = { width: w, height: h, rgba };
  } else if (bpp === 8) {
    const idx = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * s;
      for (let x = 0; x < w; x++) idx[y * w + x] = bodyData[srcRow + x];
    }
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const c = palette[idx[i]];
      rgba[i * 4] = c[0];
      rgba[i * 4 + 1] = c[1];
      rgba[i * 4 + 2] = c[2];
      rgba[i * 4 + 3] = applyAlpha ? alpha[i] : 255;
    }
    outImg = { width: w, height: h, rgba };
  } else {
    log(`[失败] 不支持bpp=${bpp}: ${name}`);
    return null;
  }
  const outPath = outDir && fs.existsSync(outDir) && fs.statSync(outDir).isDirectory()
    ? path.join(outDir, path.basename(agfPath).replace(/\.[^.]+$/, '') + '.png')
    : agfPath.replace(/\.[^.]+$/, '') + '.png';
  const hasAlpha = outImg.rgba.some((v, i) => i % 4 === 3 && v !== 255);
  const png = hasAlpha
    ? encodePng(w, h, { rgba: outImg.rgba })
    : encodePng(w, h, { rgb: imgToRgb(outImg) });
  fs.writeFileSync(outPath, png);
  log(`[OK] 导出: ${path.basename(outPath)}  (${w}x${h}@${bpp})`);
  return { outPath, w, h, bpp };
}

export function buildNoheadAgfFromPng(pngPath, outPath, log = console.log) {
  const img = decodePng(fs.readFileSync(pngPath));
  const w = img.width;
  const h = img.height;
  const meta = Buffer.alloc(32);
  meta.writeUInt32LE(w, 0);
  meta.writeUInt32LE(h, 4);
  meta.writeUInt32LE(w, 20);
  meta.writeUInt32LE(h, 24);
  meta.writeInt16LE(24, 30);
  const ms = meta.length;
  const rgb = flipRows(imgToRgb(img), w, h, 3);
  for (let i = 0; i < rgb.length; i += 3) {
    const t = rgb[i];
    rgb[i] = rgb[i + 2];
    rgb[i + 2] = t;
  }
  const rowBytes = w * 3;
  const s = strideFor(w, 24);
  let body;
  if (s === rowBytes) {
    body = rgb;
  } else {
    body = Buffer.alloc(s * h);
    for (let y = 0; y < h; y++) rgb.copy(body, y * s, y * rowBytes, (y + 1) * rowBytes);
  }
  const bs = body.length;
  const final = Buffer.alloc(68 + bs);
  let o = 0;
  final.fill(0, o, o + 4); o += 4; // 00 00 00 00
  final.writeInt32LE(1, o); o += 4; // 1
  final.fill(0, o, o + 4); o += 4; // 0
  final.writeInt32LE(ms, o); o += 4;
  final.writeInt32LE(ms, o); o += 4;
  final.writeInt32LE(ms, o); o += 4;
  meta.copy(final, o); o += ms;
  final.writeInt32LE(bs, o); o += 4;
  final.writeInt32LE(bs, o); o += 4;
  final.writeInt32LE(bs, o); o += 4;
  body.copy(final, o);
  fs.writeFileSync(outPath, final);
  log(`[OK] 无头生成: ${path.basename(outPath)}`);
  return true;
}

export function injectAcgfFixed(origAgfPath, pngPath, outPath, log = console.log) {
  try {
    const buf = fs.readFileSync(origAgfPath);
    const meta = readAcgfMeta(buf);
    const [w, h, metaBpp] = parseWhBpp(meta.metaUnpacked);
    const bodyHdrOff = meta.metaOff + meta.metaPak;
    if (bodyHdrOff + 12 > buf.length) throw new Error('Body header out of range');
    const unk = buf.readInt32LE(bodyHdrOff);
    const bodyUnp = buf.readInt32LE(bodyHdrOff + 4);
    const bodyPak = buf.readInt32LE(bodyHdrOff + 8);
    const bodyDataOff = bodyHdrOff + 12;
    const bodyDataEnd = bodyDataOff + bodyPak;
    if (bodyDataEnd > buf.length) throw new Error('Body data out of range');
    const bpp = inferBppFromBodySize(w, h, bodyUnp, metaBpp);
    if (![8, 24, 32].includes(bpp)) {
      throw new Error(`不支持或异常的bpp=${bpp} (meta_bpp=${metaBpp})`);
    }
    let acifOff = null;
    let padBetween = Buffer.alloc(0);
    for (let pad = 0; pad < 513; pad++) {
      const off = bodyDataEnd + pad;
      if (off + 4 <= buf.length && buf.subarray(off, off + 4).toString('latin1') === 'ACIF') {
        acifOff = off;
        padBetween = buf.subarray(bodyDataEnd, off);
        break;
      }
    }
    const hasAcif = acifOff !== null;
    const palette = bpp === 8 ? extractPaletteRgb(meta.metaUnpacked) : null;
    const newBody = buildBodyFromPng(pngPath, w, h, bpp, palette);
    let newAcifBlock = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    if (hasAcif) {
      if (acifOff + 4 + 24 + 8 > buf.length) throw new Error('ACIF header out of range');
      const acifPrefix = buf.subarray(acifOff, acifOff + 4 + 24);
      const aPak = buf.readInt32LE(acifOff + 4 + 24 + 4);
      const alphaDataOff = acifOff + 4 + 24 + 8;
      const alphaDataEnd = alphaDataOff + aPak;
      if (alphaDataEnd > buf.length) throw new Error('ACIF data out of range');
      tail = buf.subarray(alphaDataEnd);
      const alphaRaw = buildAlphaTopdown(pngPath, w, h);
      const hdr = Buffer.alloc(8);
      hdr.writeInt32LE(alphaRaw.length, 0);
      hdr.writeInt32LE(alphaRaw.length, 4);
      newAcifBlock = Buffer.concat([acifPrefix, hdr, alphaRaw]);
    } else {
      tail = buf.subarray(bodyDataEnd);
    }
    const bh = Buffer.alloc(12);
    bh.writeInt32LE(unk, 0);
    bh.writeInt32LE(newBody.length, 4);
    bh.writeInt32LE(newBody.length, 8);
    const out = Buffer.concat([
      buf.subarray(0, meta.metaOff),
      meta.metaPacked,
      bh,
      newBody,
      hasAcif ? padBetween : Buffer.alloc(0),
      hasAcif ? newAcifBlock : Buffer.alloc(0),
      tail,
    ]);
    fs.writeFileSync(outPath, out);
    log(`[OK] 注入完成: ${path.basename(outPath)}  (bpp=${bpp}, ACIF=${hasAcif})`);
    return true;
  } catch (e) {
    log(`[FAIL] ${path.basename(origAgfPath)} -> ${e.message}`);
    return false;
  }
}
