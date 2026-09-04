/**
 * ALF / SYS4INI 容器索引解析（纯函数，不触文件系统）。
 * 移植自 tools/alf/unpack_alf/unpack_alf.cpp 的 S4TOCARCENTRY / S4TOCFILENTRY 布局。
 * 作用：把 `SYS4INI.BIN` / `APPENDnn.AAI` 的索引区段解出
 *   - archives[] ：每个归档（`DATA1.ALF` 等）的文件名；
 *   - files[]    ：每个文件条目的 名字 + 所属归档 + 偏移 + 长度。
 * 有了 offset/length/archive_index 才能在运行时从 ALF 里按索引取出文件字节（而非依赖预解压的 raw-parts）。
 */
import { unlzss } from './lzss.js';
import { ByteView, decodeAnsi } from '../util/bytes.js';

const ARCENTRY = 256; // S4TOCARCENTRY.filename[256]
const FILENTRY = 80; // S4TOCFILENTRY: filename[64] + archive_index u32 + file_index u32 + offset u32 + length u32
const S4TOCARCHDR_SIZE = 4; // entry_count
const S4TOCFILHDR_SIZE = 4;
// SYS4INI.BIN（S4IC，非 S4AC）的 TOC 区段起始偏移；APPEND（S4AC422）用 268。
const SYS4_TOC_POS = 300;

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

/** 解析 SYS4INI.BIN 字节 -> 索引表。 */
export function parseSys4Index(indexBytes: Uint8Array): Sys4Index {
  return parseSys4Toc(readSection(indexBytes, SYS4_TOC_POS));
}

/** 解析 APPEND*.AAI 字节 -> 索引表（S4AC，区段偏移 268）。 */
export function parseAppendIndex(aaiBytes: Uint8Array): Sys4Index {
  return parseSys4Toc(readSection(aaiBytes, 268));
}

/** 把一个 call-script 立即数索引解析成文件条目（base 或 APPEND）。
 *  index < base.files.length -> SYS4INI base；否则 高字节编号 -> APPENDnn，低 24 位 -> pos。
 */
export function resolveFileEntry(
  index: number,
  base: Sys4Index,
  appendPacks: (Sys4Index | null)[],
): Sys4FileEntry | null {
  if (index < base.files.length) return base.files[index]!;
  const apn = Math.floor(index / 0x1000000);
  const pos = index - apn * 0x1000000;
  const pack = appendPacks[apn];
  if (apn >= 1 && apn <= 5 && pack && pos < pack.files.length) return pack.files[pos]!;
  return null;
}
