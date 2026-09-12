/**
 * ALF / SYS4INI 容器索引解析（纯函数，不触文件系统）。
 * 移植自 tools/alf/unpack_alf/unpack_alf.cpp 的 S4TOCARCENTRY / S4TOCFILENTRY 布局。
 * 作用：把 `SYS4INI.BIN` / `APPENDnn.AAI` 的索引区段解出
 *   - archives[] ：每个归档（`DATA1.ALF` 等）的文件名；
 *   - files[]    ：每个文件条目的 名字 + 所属归档 + 偏移 + 长度。
 * 有了 offset/length/archive_index 才能在运行时从 ALF 里按索引取出文件字节（而非依赖预解压的 raw-parts）。
 *
 * ★两种体形态（引擎 `sub_414AC0` / `sub_401100` 的魔数门，raw 22016-22030 / 7883-7921）：
 *   - `S?IC`（SYS4INI）/ `S?AC`（APPEND）= 区段 = **12 字节头 + LZSS**（`readSection`）；
 *   - `S?IN`（SYS4INI）/ `S?AI`（APPEND）= 头之后**整段直读**（`GetFileSize - headerSize`）。
 *   官方发售的 6 个索引文件都是压缩形态（S4IC / S4AC），但直读形态必须认（否则引擎能读、我们读不了）。
 */
import { unlzss } from './lzss.js';
import { ByteView, decodeAnsi } from '../util/bytes.js';

const ARCENTRY = 256; // S4TOCARCENTRY.filename[256]
const FILENTRY = 80; // S4TOCFILENTRY: filename[64] + archive_index u32 + file_index u32 + offset u32 + length u32
const S4TOCARCHDR_SIZE = 4; // entry_count
const S4TOCFILHDR_SIZE = 4;
/** SYS4INI.BIN 的 TOC 起点（300 字节头之后）。 */
const SYS4_TOC_POS = 300;
/** APPEND*.AAI 的 TOC 起点（268 字节头之后）。 */
const APPEND_TOC_POS = 268;
/** APPEND*.AAI 头里的**包号**（引擎 `sub_455750` 用它决定写 FileDB.packs 的哪一槽；实测 1..5）。 */
const APPEND_PACK_NUMBER_POS = 264;

export interface Sys4FileEntry {
  name: string;
  archiveIndex: number;
  fileIndex: number;
  offset: number;
  length: number;
}

export interface Sys4Index {
  /** 归档数（即 archives[]) */
  arcCount: number;
  /** 归档文件名（如 'DATA1.ALF'）。 */
  archives: string[];
  /** 文件条目表（index -> entry）。 */
  files: Sys4FileEntry[];
}

/** 扩展包索引（AAI）= 包号 + 单归档 TOC。 */
export interface AppendPack {
  /** 包号 = 头部 @264（统一 id 的高字节；引擎按它注册到 `FileDB.packs[包号]`）。 */
  packNumber: number;
  index: Sys4Index;
}

/** 前 4 字节按 ASCII 读（魔数；引擎用 dword 比较，这里用字符串更可读）。 */
function ascii4(b: Uint8Array): string {
  return String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0);
}

/**
 * 区的形态：压缩（`S?IC` / `S?AC`）还是直读（`S?IN` / `S?AI`）。
 * 返回 null = 魔数不认识（引擎此时报「初期化ファイルのバージョン…」/整包装载失败）。
 */
function sectionForm(magic: string): 'lzss' | 'raw' | null {
  if (magic === 'S4IC' || magic === 'S3IC' || magic === 'S4AC' || magic === 'S3AC') return 'lzss';
  if (magic === 'S4IN' || magic === 'S3IN' || magic === 'S4AI' || magic === 'S3AI') return 'raw';
  return null;
}

/** 解出一个区段：12 字节头（orig=u32(0)，len=u32(8)）+ len 字节 LZSS -> orig 字节。 */
function readSection(b: Uint8Array, sectionPos: number): Uint8Array {
  const v = new ByteView(b);
  const orig = v.u32(sectionPos);
  const len = v.u32(sectionPos + 8);
  const buff = b.subarray(sectionPos + 12, sectionPos + 12 + len);
  const out = new Uint8Array(orig);
  unlzss(buff, len, out, orig);
  return out;
}

/** 按形态取 TOC 缓冲：压缩形态解 12 字节头 + LZSS，直读形态就是头之后的全部字节。 */
function readToc(b: Uint8Array, tocPos: number, form: 'lzss' | 'raw'): Uint8Array {
  return form === 'lzss' ? readSection(b, tocPos) : b.subarray(tocPos);
}

/** 解析已解压的 TOC 缓冲 -> 归档/文件条目表。 */
export function parseSys4Toc(toc: Uint8Array): Sys4Index {
  const v = new ByteView(toc);
  const arcCount = v.u32(0);
  const arcBase = S4TOCARCHDR_SIZE;
  const archives: string[] = [];
  for (let i = 0; i < arcCount; i++) archives.push(decodeAnsi(toc, arcBase + i * ARCENTRY, 256));
  const filhdrBase = arcBase + arcCount * ARCENTRY;
  const filCount = v.u32(filhdrBase);
  const filBase = filhdrBase + S4TOCFILHDR_SIZE;
  const files: Sys4FileEntry[] = [];
  for (let i = 0; i < filCount; i++) {
    const off = filBase + i * FILENTRY;
    files.push({
      name: decodeAnsi(toc, off, 64),
      archiveIndex: v.u32(off + 64),
      fileIndex: v.u32(off + 68),
      offset: v.u32(off + 72),
      length: v.u32(off + 76),
    });
  }
  return { arcCount, archives, files };
}

/** 解析 SYS4INI.BIN 字节 -> 索引表（S4IC 压缩 / S4IN 直读）。 */
export function parseSys4Index(indexBytes: Uint8Array): Sys4Index {
  const magic = ascii4(indexBytes);
  const form = sectionForm(magic);
  if (form === null || magic[2] !== 'I') {
    throw new Error(`SYS4INI 魔数不认识：${JSON.stringify(magic)}（期望 S4IC/S4IN/S3IC/S3IN）`);
  }
  return parseSys4Toc(readToc(indexBytes, SYS4_TOC_POS, form));
}

/**
 * 解析 APPEND*.AAI 字节 -> 包号 + 索引表。
 * ★包号取自**文件头**（@264），不是文件名 —— 引擎 `sub_455750` 就是这么注册的（raw 67769）。
 */
export function parseAppendPack(aaiBytes: Uint8Array): AppendPack {
  const magic = ascii4(aaiBytes);
  const form = sectionForm(magic);
  if (form === null || magic[2] !== 'A') {
    throw new Error(`APPEND 魔数不认识：${JSON.stringify(magic)}（期望 S4AC/S4AI/S3AC/S3AI）`);
  }
  const packNumber = new ByteView(aaiBytes).u32(APPEND_PACK_NUMBER_POS);
  return { packNumber, index: parseSys4Toc(readToc(aaiBytes, APPEND_TOC_POS, form)) };
}

/** 解析 APPEND*.AAI 字节 -> 索引表（丢弃包号；需要包号时用 `parseAppendPack`）。 */
export function parseAppendIndex(aaiBytes: Uint8Array): Sys4Index {
  return parseAppendPack(aaiBytes).index;
}

/**
 * 把一个 call-script 立即数索引解析成文件条目（base 或 APPEND）。
 * 判据与引擎一致（`sub_4559C0` raw 67810）：**看高字节是否为 0**，不是与 base 表长度比大小。
 *   - 高字节 0  -> 本体 id（须 `0 <= index < base.files.length`）；
 *   - 高字节 n  -> APPEND 包 n（`n = index >>> 24`、低 24 位 = 包内编号），`appendPacks[n]` 必须非空。
 */
export function resolveFileEntry(
  index: number,
  base: Sys4Index,
  appendPacks: readonly (Sys4Index | null)[],
): Sys4FileEntry | null {
  if (index < 0) return null;
  if ((index & 0xff000000) === 0) return base.files[index] ?? null;
  const apn = (index >>> 24) & 0xff;
  const pos = index & 0xffffff;
  const pack = appendPacks[apn];
  if (apn >= 1 && pack && pos < pack.files.length) return pack.files[pos]!;
  return null;
}
