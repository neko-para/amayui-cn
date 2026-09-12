/**
 * Node 宿主文件访问实现（FileSource 的一个实现）。
 * 策略：资源根由调用方给出（**默认 `install/` = 汉化版安装目录**，见 `resourceDir.ts`）。
 *   1. 先在资源根找松散文件（游戏直读版本，语料权威 —— 汉化补丁优先落在这里）；
 *   2. 找不到则按 SYS4INI 索引给的 (archive_index, offset, length) 从对应 ALF 里切片取出。
 * 不依赖 raw-parts（那只是预解压产物）。
 * 将来 Electron renderer 侧可换 IpcFileSource：通过 IPC 把"读原始字节/读 ALF 切片"发给主进程，接口一致。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileSource, ScriptBytes } from './fileSource.js';
import { parseSys4Index, parseAppendIndex, type Sys4Index, type Sys4FileEntry } from '../script/alf.js';
import { isEngineSave } from '../vm/saveData.js';
import { parseIni } from '../engineConfig.js';

export interface NodeFileSourceOptions {
  /** 资源根目录（含 `SYS4INI.BIN`、`*.ALF` 归档、松散 `.BIN` 脚本）。默认见 `resolveResourceDir`。 */
  resourceDir: string;
  /**
   * `SYS4REG.INI` 的**回写路径**（可选）。给了才实现 `FileSource.saveConfig`。
   * ★默认不给 ⇒ 默认**不落盘**（测试/链路工具不会碰仓库里的配置文件）。
   */
  configPath?: string;
  /**
   * `SAVE.DAT` 的路径（可选）。给了才实现 `readSaveData`/`writeSaveData`（脚本 `save-int`/`save-string` 表的持久化）。
   * ★默认不给 ⇒ 不读写存档（测试不会碰仓库里的存档）。
   */
  saveDataPath?: string;
}

/** 扩展包数（与游戏一致：APPEND01..05）。 */
export const APPEND_COUNT = 5;

export class NodeFileSource implements FileSource {
  #root: string;
  #configPath: string | null;
  #saveDataPath: string | null;
  #base: Sys4Index | null = null;
  #appends: (Sys4Index | null)[] = [];

  constructor(opts: NodeFileSourceOptions) {
    this.#root = opts.resourceDir;
    this.#configPath = opts.configPath ?? null;
    this.#saveDataPath = opts.saveDataPath ?? null;
  }

  /** 资源根（诊断/报告用：写清"这次的报告读的是哪套资源"）。 */
  get root(): string {
    return this.#root;
  }

  /** 配置回写目标（未配置时为 null）。 */
  get configPath(): string | null {
    return this.#configPath;
  }

  /** 存档路径（未配置时为 null）。 */
  get saveDataPath(): string | null {
    return this.#saveDataPath;
  }

  /**
   * 把整份 INI 文本写回 `configPath`（未配置则什么也不做）。
   *
   * ★**防丢键棘轮**：写之前比对磁盘上的那份，若新文本的 `section:key` 条目数**少于**现有文件，
   * 就拒绝落盘并告警 —— 这挡住"配置还没装载就被写回"（那时内存里只有一两个键，
   * 一写就会把整个 INI 抹成两行）。宁可少写一次，也不静默丢设置。
   */
  async saveConfig(text: string): Promise<void> {
    if (!this.#configPath) return;
    const count = (t: string): number => parseIni(t).values.size;
    try {
      const prev = await fs.readFile(this.#configPath, 'utf8');
      if (count(text) < count(prev)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[config] 拒绝回写 ${this.#configPath}：新文本只有 ${count(text)} 个键，磁盘上有 ${count(prev)} 个` +
            '（疑似配置尚未装载就写回）—— 原文件保持不变',
        );
        return;
      }
    } catch {
      /* 原文件不存在：直接写 */
    }
    await fs.writeFile(this.#configPath, text, 'utf8');
  }

  /** 读 `SAVE.DAT`（未配置路径或文件不存在 ⇒ null）。**优先本工程自己的存档**（`.amayui`）。 */
  async readSaveData(): Promise<Uint8Array | null> {
    if (!this.#saveDataPath) return null;
    for (const p of [this.#oursPath(), this.#saveDataPath]) {
      try {
        const b = await fs.readFile(p);
        return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      } catch {
        /* 试下一个 */
      }
    }
    return null;
  }

  /** 本工程自己的存档路径（与引擎的 `SAVE.DAT` 并列，避免覆盖玩家的真存档）。 */
  #oursPath(): string {
    return `${this.#saveDataPath}.amayui`;
  }

  /**
   * 写 `SAVE.DAT`。
   *
   * 规则（安全优先）：
   *  - 目标不存在，或已存在且**是本工程格式**（`format = 0`）⇒ 写 `SAVE.DAT`（先写 `$$SAVE.DAT` 再改名，与引擎同口径）；
   *  - 目标是**引擎写的存档**（加密/压缩格式，或魔数不符）⇒ **不碰它**，改写 `<SAVE.DAT>.amayui`
   *    （读取时优先用后者，所以"继承玩家真存档 + 之后的改动落到我们自己的文件"两件事同时成立）。
   */
  async writeSaveData(data: Uint8Array): Promise<void> {
    if (!this.#saveDataPath) return;
    const target = this.#saveDataPath;
    await fs.mkdir(path.dirname(target), { recursive: true });
    let writeTo = target;
    try {
      const prev = await fs.readFile(target);
      if (isEngineSave(prev)) {
        writeTo = this.#oursPath();
        // eslint-disable-next-line no-console
        console.warn(
          `[save] ${target} 是引擎格式存档（加密/压缩）⇒ 不覆盖它；本工程的设置写到 ${writeTo}`,
        );
      }
    } catch {
      /* 原文件不存在：直接写 */
    }
    const tmp = path.join(path.dirname(writeTo), '$$SAVE.DAT');
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, writeTo);
  }

  async readFile(p: string): Promise<Uint8Array> {
    const b = await fs.readFile(p);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }

  async #loadBaseIndex(): Promise<Sys4Index> {
    if (this.#base) return this.#base;
    const bytes = await this.readFile(path.join(this.#root, 'SYS4INI.BIN'));
    this.#base = parseSys4Index(bytes);
    return this.#base;
  }

  /** 载入 5 个 APPEND 包索引（S4AC422 的 APPENDnn.AAI），填充 #appends[1..5]。 */
  async #loadAppends(): Promise<(Sys4Index | null)[]> {
    if (this.#appends.length) return this.#appends;
    this.#appends = Array.from({ length: APPEND_COUNT + 1 }, () => null);
    for (let n = 1; n <= APPEND_COUNT; n++) {
      const p = path.join(this.#root, `APPEND0${n}.AAI`);
      try {
        const bytes = await this.readFile(p);
        this.#appends[n] = parseAppendIndex(bytes);
      } catch {
        this.#appends[n] = null; // 无该扩展包
      }
    }
    return this.#appends;
  }

  /** 在资源根里按文件名找松散文件；找不到返回 null。 */
  async #findLoose(name: string): Promise<Uint8Array | null> {
    const p = path.join(this.#root, name);
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
    const fh = await fs.open(path.join(this.#root, arcName), 'r');
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

  /** 按统一文件 id 读出原始字节（含文件名）。用于资源（如图像 AGF / 视频 MPG）读取。 */
  async readById(id: number): Promise<{ name: string; data: Uint8Array } | null> {
    const r = await this.resolveEntry(id);
    if (!r) return null;
    const data = await this.#readEntry(r.entry, r.archives);
    if (!data) return null;
    return { name: r.entry.name, data };
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
