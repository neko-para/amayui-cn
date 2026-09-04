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
import { parseSys4Index, resolveFileEntry, type Sys4Index, type Sys4FileEntry } from '../script/alf.js';

export interface NodeFileSourceOptions {
  /** raw/ 目录（含 SYS4INI.BIN、*.ALF 归档、松散 .BIN 脚本）。 */
  rawDir: string;
}

export class NodeFileSource implements FileSource {
  #rawDir: string;
  #base: Sys4Index | null = null;

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

  async readScript(index: number): Promise<ScriptBytes | null> {
    const base = await this.#loadBaseIndex();
    const entry = resolveFileEntry(index, base, []); // M0：先只解析 base；APPEND 后补
    if (!entry) return null;
    const data = await this.#readEntry(entry);
    if (!data) return null;
    return { index, name: entry.name, data };
  }

  async #readEntry(entry: Sys4FileEntry): Promise<Uint8Array | null> {
    // 1) 松散文件优先
    const loose = await this.#findLoose(entry.name);
    if (loose) return loose;
    // 2) 否则从 ALF 切片
    if (entry.length > 0) {
      const arcName = this.#base?.archives[entry.archiveIndex];
      if (arcName) return await this.#readArchiveSlice(arcName, entry.offset, entry.length);
    }
    return null;
  }

  async dispose(): Promise<void> {
    /* Node 读文件即用即关，无句柄需清理；保留以对齐接口。 */
  }
}
