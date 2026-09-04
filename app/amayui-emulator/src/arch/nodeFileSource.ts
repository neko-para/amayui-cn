/**
 * Node 宿主文件访问实现（FileSource 的一个实现）。
 * 策略（按用户要求）：只依赖 `raw/`。
 *   1. 先在 raw/ 找松散文件（游戏直读版本，语料权威）；
 *   2. 找不到则按 SYS4INI 索引给的 (archive_index, offset, length) 从对应 ALF 里切片取出。
 * 不依赖 raw-parts（那只是预解压产物）。
 * 将来 Electron renderer 侧可换 IpcFileSource：通过 IPC 把"读原始字节/读 ALF 切片"发给主进程，接口一致。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileSource, ScriptBytes } from './fileSource.js';
import { parseSys4Index, parseAppendIndex, type Sys4Index, type Sys4FileEntry } from '../script/alf.js';

export interface NodeFileSourceOptions {
  /** raw/ 目录（含 SYS4INI.BIN、*.ALF 归档、松散 .BIN 脚本）。 */
  rawDir: string;
}

/** 扩展包数（与游戏一致：APPEND01..05）。 */
export const APPEND_COUNT = 5;

export class NodeFileSource implements FileSource {
  #rawDir: string;
  #base: Sys4Index | null = null;
  #appends: (Sys4Index | null)[] = [];

  constructor(opts: NodeFileSourceOptions) {
    this.#rawDir = opts.rawDir;
  }

  async readFile(p: string): Promise<Uint8Array> {
    const b = await fs.readFile(p);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }

  async #loadBaseIndex(): Promise<Sys4Index> {
    if (this.#base) return this.#base;
    const bytes = await this.readFile(path.join(this.#rawDir, 'SYS4INI.BIN'));
    this.#base = parseSys4Index(bytes);
    return this.#base;
  }

  /** 载入 5 个 APPEND 包索引（S4AC422 的 APPENDnn.AAI），填充 #appends[1..5]。 */
  async #loadAppends(): Promise<(Sys4Index | null)[]> {
    if (this.#appends.length) return this.#appends;
    this.#appends = Array.from({ length: APPEND_COUNT + 1 }, () => null);
    for (let n = 1; n <= APPEND_COUNT; n++) {
      const p = path.join(this.#rawDir, `APPEND0${n}.AAI`);
      try {
        const bytes = await this.readFile(p);
        this.#appends[n] = parseAppendIndex(bytes);
      } catch {
        this.#appends[n] = null; // 无该扩展包
      }
    }
    return this.#appends;
  }

  /** 在 raw/ 里按文件名找松散文件；找不到返回 null。 */
  async #findLoose(name: string): Promise<Uint8Array | null> {
    const p = path.join(this.#rawDir, name);
    try {
      const st = await fs.stat(p);
      if (st.isFile()) return await this.readFile(p);
    } catch {
      /* 不存在 */
    }
    return null;
  }

  /** 从归档（ALF）里取一个切片。 */
  async #readArchiveSlice(arcName: string, offset: number, length: number): Promise<Uint8Array> {
    const fh = await fs.open(path.join(this.#rawDir, arcName), 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally {
      await fh.close();
    }
  }

  /** 按统一文件 id（本体或 APPEND 包）解析出文件条目（含归档名 + offset/length），并带上其所属索引（决定用哪套归档）。 */
  async resolveEntry(index: number): Promise<{ entry: Sys4FileEntry; archives: string[] } | null> {
    const base = await this.#loadBaseIndex();
    const appends = await this.#loadAppends();
    if (index < base.files.length) return { entry: base.files[index]!, archives: base.archives };
    const apn = Math.floor(index / 0x1000000);
    const pos = index - apn * 0x1000000;
    const pack = appends[apn];
    if (apn >= 1 && apn <= APPEND_COUNT && pack && pos < pack.files.length) {
      return { entry: pack.files[pos]!, archives: pack.archives };
    }
    return null;
  }

  async readScript(index: number): Promise<ScriptBytes | null> {
    const r = await this.resolveEntry(index);
    if (!r) return null;
    const data = await this.#readEntry(r.entry, r.archives);
    if (!data) return null;
    return { index, name: r.entry.name, data };
  }

  async #readEntry(entry: Sys4FileEntry, archives: string[]): Promise<Uint8Array | null> {
    // 1) 松散文件优先
    const loose = await this.#findLoose(entry.name);
    if (loose) return loose;
    // 2) 否则从 ALF 切片
    if (entry.length > 0) {
      const arcName = archives[entry.archiveIndex];
      if (arcName) return await this.#readArchiveSlice(arcName, entry.offset, entry.length);
    }
    return null;
  }

  async dispose(): Promise<void> {
    /* Node 读文件即用即关，无句柄需清理；保留以对齐接口。 */
  }
}
