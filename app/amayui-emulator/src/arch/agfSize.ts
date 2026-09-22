/**
 * **AGF 尺寸解析（只要尺寸，不解码像素）** —— `tickets/T-0025`：让 headless 宿主**自带** `0x208`
 * （getTextureSize）的答案，不再依赖录制轨迹里的 `tex` 字段。
 *
 * ## 为什么这里有一份"精简版"格式代码
 * 完整解码器在 `scripts/agf/format.js`（工具/主进程共用）。**`src/` 不能 import 它**：
 * `app/amayui-emulator/tsconfig.json` 是 `"rootDir": "src"` + `include` 只含 `src` 下的 ts
 * ⇒ 引用仓库根下的文件会报 TS6059（且会打乱 `dist/tsc` 的目录结构）。
 * ⇒ 这里只**移植尺寸需要的那一段**（ACGF 头 + 无头 plan 扫描），并用守卫
 * `test/agf-size.test.ts` 与 `scripts/agf/format.js` 的 `decodeAgfRgba` 在**真文件**上逐值对照，
 * 防止两份实现漂移。移植范围与出处逐段标注在下面（行号 = `scripts/agf/format.js`）。
 *
 * ## 两种容器（实测分布：id 0x4c00..0x5400 的 .AGF 里 ACGF **843** / 无头 **14**）
 *  - **ACGF**：magic `'ACGF'`，`metaUnp = i32@12`、`metaPak = i32@20`、meta 起于 **24**
 *    （`metaUnp !== metaPak` 时用 LZSS 解压），`parseWhBpp(meta)` 给 `(w,h,bpp)`；
 *  - **无头**：前 4 字节全 0 ⇒ 没有头，尺寸要从"meta 偏移 24/28 + body 头 + 常见分辨率"里**推断**
 *    （`format.js:214-244` 的 `enumerateNoheadPlans` + `scoreNoheadPlan`）。
 */
import { Buffer } from 'node:buffer';

/** LZSS 帧大小（`format.js:7-8`）。 */
const LZSS_FRAME_SIZE = 4096;
const LZSS_INIT_POS = 4078;

/** LZSS 解压（逐字移植 `format.js:10-46`；只用于 meta 块）。 */
function lzssDecompress(data: Buffer, outputLen: number): Buffer {
  const out = Buffer.alloc(outputLen);
  const frame = Buffer.alloc(LZSS_FRAME_SIZE);
  let outPtr = 0;
  let framePtr = LZSS_INIT_POS;
  let inPtr = 0;
  const inLen = data.length;
  while (outPtr < outputLen && inPtr < inLen) {
    let flags = data[inPtr++]!;
    for (let k = 0; k < 8; k++) {
      if (outPtr >= outputLen) break;
      if (flags & 1) {
        if (inPtr >= inLen) break;
        const v = data[inPtr++]!;
        out[outPtr++] = v;
        frame[framePtr] = v;
        framePtr = (framePtr + 1) & 4095;
      } else {
        if (inPtr + 1 >= inLen) break;
        const lo = data[inPtr]!;
        const hi = data[inPtr + 1]!;
        inPtr += 2;
        const offset = lo | ((hi & 0xf0) << 4);
        const length = (hi & 0x0f) + 3;
        for (let i = 0; i < length; i++) {
          if (outPtr >= outputLen) break;
          const v = frame[(offset + i) & 4095]!;
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

/** 每行字节数（`format.js:48-53`）。 */
function strideFor(w: number, bpp: number): number {
  if (bpp === 8) return (w + 3) & -4;
  if (bpp === 24) return (w * 3 + 3) & -4;
  if (bpp === 32) return w * 4;
  return 0;
}

/** 表面字节数（`format.js:55-58`）。 */
function sizeFor(w: number, h: number, bpp: number): number {
  const s = strideFor(w, bpp);
  return s > 0 ? s * h : 0;
}

/** 尺寸是否看起来合理（`format.js:60-62`）。 */
function plausibleWh(w: number, h: number): boolean {
  return w >= 1 && w <= 20000 && h >= 1 && h <= 20000;
}

/** meta → `(w,h,bpp)`（`format.js:64-82`；先读 `@20/@24/@30`，全 0 时退回 `@0/@4`）。 */
function parseWhBpp(metaUnpacked: Buffer): [number, number, number] {
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

/** 常见分辨率表（`format.js:157-174` 的一半：只按 body 解压后字节数配对）。 */
function guessResolutionCommon(bodyUnp: number): [number, number, number] {
  const resolutions: Array<[number, number]> = [
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

/** 暴力扫宽（`format.js:130-155`）。 */
function guessResolutionBruteforce(bodyUnp: number): [number, number, number] {
  const commonWidths = [2560, 1920, 1600, 1366, 1280, 1024, 960, 800, 640, 512, 480, 320];
  const seen = new Set<number>();
  const widths: number[] = [];
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

/** 由 body 字节数反推 bpp（`format.js:176-181`）。 */
function inferBppFromBodySize(w: number, h: number, bodyUnp: number, metaBpp: number): number {
  for (const bpp of [8, 24, 32]) {
    if (sizeFor(w, h, bpp) === bodyUnp) return bpp;
  }
  return metaBpp;
}

/**
 * 一个无头 plan 的评分与结论尺寸（逐字移植 `format.js:183-212`；本模块只用 `w/h`）。
 * ★评分必须与共享实现一致，否则"选中的 plan"可能不同 ⇒ 尺寸分叉（守卫会抓）。
 */
function scoreNoheadPlan(
  metaOff: number,
  metaUnp: number,
  metaPak: number,
  bodyHdrPos: number,
  hdrSz: number,
  bodyUnp: number,
  bodyPak: number,
  w0: number,
  h0: number,
  bpp0: number,
): { score: number; w: number; h: number; metaOff: number; metaUnp: number; metaPak: number; bodyHdrPos: number; bodyHdrSize: number; bodyUnp: number; bodyPak: number } {
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
  return { score, w, h, metaOff, metaUnp, metaPak, bodyHdrPos, bodyHdrSize: hdrSz, bodyUnp, bodyPak };
}

/** 无头：扫 meta 偏移 24/28 × body 头 8/12 字节，选总分最高的 plan（`format.js:214-244`）。 */
function enumerateNoheadPlans(buf: Buffer, fileSize: number, metaUnp: number, metaPak: number) {
  const plans: ReturnType<typeof scoreNoheadPlan>[] = [];
  for (const metaOff of [24, 28]) {
    if (metaOff < 0 || metaOff + metaPak > fileSize) continue;
    const metaPacked = buf.subarray(metaOff, metaOff + metaPak);
    if (metaPacked.length !== metaPak) continue;
    const metaData = metaUnp === metaPak ? metaPacked : lzssDecompress(metaPacked, metaUnp);
    const [w0, h0, bpp0] = parseWhBpp(metaData);
    const bodyHdrPos = metaOff + metaPak;
    if (bodyHdrPos + 8 > fileSize) continue;
    const bh8 = buf.subarray(bodyHdrPos, bodyHdrPos + 8);
    if (bh8.length === 8) {
      const unp8 = bh8.readInt32LE(0);
      const pak8 = bh8.readInt32LE(4);
      if (unp8 > 0 && pak8 > 0 && bodyHdrPos + 8 + pak8 <= fileSize) {
        plans.push(scoreNoheadPlan(metaOff, metaUnp, metaPak, bodyHdrPos, 8, unp8, pak8, w0, h0, bpp0));
      }
    }
    if (bodyHdrPos + 12 <= fileSize) {
      const bh12 = buf.subarray(bodyHdrPos, bodyHdrPos + 12);
      if (bh12.length === 12) {
        const unp12 = bh12.readInt32LE(4);
        const pak12 = bh12.readInt32LE(8);
        if (unp12 > 0 && pak12 > 0 && bodyHdrPos + 12 + pak12 <= fileSize) {
          plans.push(scoreNoheadPlan(metaOff, metaUnp, metaPak, bodyHdrPos, 12, unp12, pak12, w0, h0, bpp0));
        }
      }
    }
  }
  return plans;
}

/**
 * **AGF 的尺寸**（不解码像素）。失败/不认识 ⇒ `null`（调用方按"未知"处理，不要伪造 0×0 当真值）。
 *
 * @param totalSize **文件的真实字节数**（可选）。★无头那一路的 plan 判定要用它做边界校验
 *   （`bodyHdrPos + hdr + pak <= fileSize`）—— 只喂**头部切片**时必须传真实文件大小，
 *   否则所有 plan 都会被边界条件否掉（实测：`BG050ABL.AGF` 只给 64 KB 头 ⇒ 拿不到尺寸）。
 */
export function agfSizeOf(bytes: Uint8Array, totalSize?: number): { w: number; h: number } | null {
  if (bytes.length < 32) return null;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileSize = totalSize ?? buf.length;
  const magic = buf.subarray(0, 4).toString('latin1');
  if (magic === 'ACGF') {
    const metaUnp = buf.readInt32LE(12);
    const metaPak = buf.readInt32LE(20);
    const metaOff = 24;
    if (metaPak <= 0 || metaOff + metaPak > buf.length) return null;
    const metaPacked = buf.subarray(metaOff, metaOff + metaPak);
    const metaData = metaUnp === metaPak ? metaPacked : lzssDecompress(metaPacked, metaUnp);
    const [w, h] = parseWhBpp(metaData);
    return plausibleWh(w, h) ? { w, h } : null;
  }
  // 无头：magic 位全 0（`format.js:637` 的判据）
  if (!buf.subarray(0, 4).equals(Buffer.alloc(4))) return null;
  const metaUnp = buf.readInt32LE(12);
  const metaPak = buf.readInt32LE(20);
  const plans = enumerateNoheadPlans(buf, fileSize, metaUnp, metaPak);
  if (!plans.length) return null;
  const best = plans.reduce((a, b) => (b.score > a.score ? b : a));
  return plausibleWh(best.w, best.h) ? { w: best.w, h: best.h } : null;
}
