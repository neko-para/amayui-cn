/**
 * **web 宿主的二进制信封**（`tickets/T-0134` Phase 2；设计来源 `tickets/T-0133` §B.4）。
 *
 * ## 为什么需要一个信封
 *
 * 浏览器侧的 `window.api` 里有相当一批方法要搬**原始字节**：脚本 BIN、AGF 解码后的 RGBA
 * （单张 1280×720 ≈ 3.7MB）、字体（CJK 24MB）、音频、`.MOC`/`.MTN`、`SAVE.DAT` 与存档槽。
 * 走 JSON 数组（Electron IPC 的 `number[]` 口径）或 base64 都会把这笔数据**放大 3–10 倍**
 * 并且要过一次 JS 字符串/数字数组，是本机 loopback 上最没必要的开销。
 *
 * ⇒ 定一条**最小线格式**：一次响应 = 0..n 段字节，长度为前缀，全 big-endian；元数据（名字/尺寸/索引）
 * 走 HTTP 头 `x-amayui-meta`（URL 编码的 JSON）。于是：
 *
 * ```text
 * body := [u32 段数 n]  ( [u32 段长 len_i] [len_i 字节] ) * n
 * ```
 *
 * * 单段（图像/音频/字体/脚本）= 最常见形态；
 * * 多段用于 `readSaveDataBoth`（两侧 `SAVE.DAT`）这类"一次要两份"的调用
 *   —— 免得为它单开一条协议或退化成 base64。
 *
 * ★**本模块零依赖**（不用 `Buffer`、不碰 DOM/Node）：渲染进程的浏览器 bundle 与 Node 宿主**共用同一份**，
 *   这样"编码器/解码器各写一份"的漂移从根上不可能发生（`T-0002`/`T-0057` 那类教训）。
 */

/** 段数上限（防御：畸形输入不许让我们按攻击者给的长度分配内存）。 */
export const MAX_SEGMENTS = 8;

/** 单段上限（1 GiB；超过就是协议错，而不是"合法的超大文件"）。 */
export const MAX_SEGMENT_BYTES = 0x4000_0000;

/** 二进制响应的 HTTP 头：元数据（URL 编码的 JSON 对象）。 */
export const META_HEADER = 'x-amayui-meta';

/** 响应类型头：`json` | `bin`。 */
export const KIND_HEADER = 'x-amayui-kind';

/**
 * 把若干段字节编码成信封。
 * @param parts 段（`Uint8Array` 或 `number[]`；空数组合法 —— 例如"读不到"在协议层仍要有回应）。
 */
export function encodeEnvelope(parts: readonly (Uint8Array | number[])[]): Uint8Array {
  if (parts.length > MAX_SEGMENTS) throw new Error(`信封段数过多：${parts.length} > ${MAX_SEGMENTS}`);
  const bufs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const total = 4 + bufs.reduce((s, b) => s + 4 + b.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  view.setUint32(off, bufs.length, false);
  off += 4;
  for (const b of bufs) {
    view.setUint32(off, b.length, false);
    off += 4;
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/**
 * 解码信封。**严格**：长度不自洽、段数越界、尾部有多余字节都抛错 ——
 * 半懂的信封比失败更坏（会喂给上层一段错位字节，症状会离现场很远）。
 */
export function decodeEnvelope(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length < 4) throw new Error(`信封太短：${bytes.length}B（至少要 4B 的段数）`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(0, false);
  if (n > MAX_SEGMENTS) throw new Error(`信封段数过多：${n} > ${MAX_SEGMENTS}`);
  const parts: Uint8Array[] = [];
  let off = 4;
  for (let i = 0; i < n; i++) {
    if (off + 4 > bytes.length) throw new Error(`信封截断：第 ${i} 段的长度前缀越界（off=${off}, len=${bytes.length}）`);
    const len = view.getUint32(off, false);
    off += 4;
    if (len > MAX_SEGMENT_BYTES) throw new Error(`信封段过长：第 ${i} 段 ${len}B > ${MAX_SEGMENT_BYTES}`);
    if (off + len > bytes.length) throw new Error(`信封截断：第 ${i} 段声明 ${len}B，实际只剩 ${bytes.length - off}B`);
    parts.push(bytes.subarray(off, off + len));
    off += len;
  }
  if (off !== bytes.length) throw new Error(`信封尾部有多余 ${bytes.length - off}B（长度不自洽）`);
  return parts;
}

/** 元数据的解析结果（宽松：缺字段/坏 JSON 都当"没有元数据"）。 */
export function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 元数据 → 请求头值（URL 编码的 JSON）。 */
export function formatMeta(meta: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(meta));
}
