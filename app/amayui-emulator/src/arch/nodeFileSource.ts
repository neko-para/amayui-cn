/**
 * Node 宿主文件访问实现（FileSource 的一个实现）。
 * 策略：资源根由调用方给出（**默认 `install/` = 汉化版安装目录**，见 `resourceDir.ts`）。
 *   1. 先在资源根找松散文件（游戏直读版本，语料权威 —— 汉化补丁优先落在这里）；
 *   2. 找不到则按 SYS4INI 索引给的 (archive_index, offset, length) 从对应 ALF 里切片取出。
 * 不依赖 raw-parts（那只是预解压产物）。
 *
 * **玩家数据**（`SYS4REG.INI` 与 `SAVE\SAVE.DAT`）不走资源根，而走 `system`（系统存档目录 + overlay，
 * 见 `systemPaths.ts` / `overlay.ts`）：读优先 overlay、**写只写 overlay** ⇒ 能继承真游戏设置且不会写坏它。
 * ★**唯一的例外是"删存档槽"**（`0x1AB`）：引擎的 `DeleteFileA` 打的就是真实存档目录，而本工程的读会回落
 * base ⇒ 要让被删的槽真的消失就得连 base 那一份一起删（删前先隔离到 `<overlay>/SAVE/.deleted/`，见
 * `deleteSaveSlot` 与 `T-0153` 的 `0x1AB` 条目）。
 * 将来 Electron renderer 侧可换 IpcFileSource：通过 IPC 把"读原始字节/读 ALF 切片"发给主进程，接口一致。
 */
import * as fs from 'node:fs/promises';
// ★同步 API 单独引入（`node:fs/promises` 没有 `*Sync`）：`readHeaderSync` 用（`tickets/T-0025`）。
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import type { FileSource, ScriptBytes } from './fileSource.js';
import { MissingAppendPackError } from './fileSource.js';
import { parseSys4Index, parseSys4MusicTables, parseAppendPack, type Sys4Index, type Sys4FileEntry, type MusicTables } from '../script/alf.js';
import { OverlayDir, type OverlaySide } from './overlay.js';
import { INI_FILE, SAVE_DAT_REL, type SystemPaths } from './systemPaths.js';
import { parseIni } from '../engineConfig.js';
import { unionUsedFileIds } from '../save/saveData.js';
import { slotRelPath, slotThumbRelPath } from '../save/saveSlot.js';

export interface NodeFileSourceOptions {
  /** 资源根目录（含 `SYS4INI.BIN`、`*.ALF` 归档、松散 `.BIN` 脚本）。默认见 `resolveResourceDir`。 */
  resourceDir: string;
  /**
   * 系统存档目录 + overlay（可选）。给了才实现 `saveConfig`/`readSaveData`/`writeSaveData`。
   * ★默认不给 ⇒ **不落盘**（测试/链路工具不会碰玩家数据）。
   */
  system?: SystemPaths;
  /** 诊断日志（默认无）。主进程/CLI 会传 `console.log`，把"这次读的是哪一份"打出来。 */
  log?: (msg: string) => void;
}

/**
 * 扩展包：**扫描资源根下的 `*.AAI`，按文件头 @264 的包号注册**（= 引擎 `sub_455750`，raw 67721-67783）。
 *
 * 为什么不能像以前那样硬编码 `APPEND01..05.AAI`：
 *  - 引擎用 `FindFirstFile("<CWD>\\*.AAI")` 扫目录，**放什么装什么**、包号取自**文件头**（不是文件名）
 *    ⇒ 第 6 个包、改了名的包、或文件名与包号不一致的包，引擎全都认；
 *  - 包号决定统一 id 的高字节（`pack<<24|idx`）与 `i143` 的派发顺序 ⇒ 认错包号 = 认错资源。
 * 这里保留 `APPEND_COUNT` 作为**诊断用参考值**（官方发售 5 包），不再作为上限。
 */
export const APPEND_COUNT = 5;

/** 包号合法范围：槽 0 与扩展包 id 空间无关（高字节 0 = 本体），槽 ≥256 引擎会越界写。 */
const MAX_APPEND_PACK = 255;

/**
 * **删槽的隔离目录**（相对 `<overlay>/SAVE/`；本工程自己的目录）。
 *
 * 为什么存在（`T-0153` 的 `0x1AB` 条目）：引擎的 `DeleteFileA` 打的是**真实存档目录**（raw 38473-38481），
 * 而本工程的读会回落到 base ⇒ 要让被删的槽真的消失就必须也删 base 那一份。可那正是玩家的真存档，
 * 删掉不可逆 ⇒ 先复制到这里再 unlink（人工把文件挪回 `<overlay>/SAVE/` 即复原）。
 * 目录名以 `.` 开头且不是 `SAVE\d\d.DAT|STH`，不会被任何槽枚举（`test/realSlots.ts` 的正则）看见。
 */
const DELETED_DIR = '.deleted';

export class NodeFileSource implements FileSource {
  #root: string;
  #overlay: OverlayDir | null;
  #base: Sys4Index | null = null;
  /** 包号 -> 包索引（引擎 `FileDB.packs` 非空槽）。 */
  #packs = new Map<number, Sys4Index>();
  /** 已装载的包号（升序）；`0x143` 按这个顺序派发 `$n$AUTORUN`。 */
  #packNumbers: number[] = [];
  #appendsLoaded = false;
  /** 文件名（小写）→ 条目；`readByName` 用（惰性建表，见 `#nameLookup`）。 */
  #nameIndex: Map<string, { entry: Sys4FileEntry; archives: string[]; index: number }> | null = null;
  /** SYS4INI 尾部的音乐表（惰性装载；见 `musicTables`）。 */
  #music: MusicTables | null = null;
  #log: (msg: string) => void;

  constructor(opts: NodeFileSourceOptions) {
    this.#root = opts.resourceDir;
    this.#overlay = opts.system ? new OverlayDir(opts.system, { log: opts.log }) : null;
    this.#log = opts.log ?? ((): void => {});
  }

  /** 资源根（诊断/报告用：写清"这次的报告读的是哪套资源"）。 */
  get root(): string {
    return this.#root;
  }

  /** overlay 层（未配置时为 null）。 */
  get overlay(): OverlayDir | null {
    return this.#overlay;
  }

  /** 读一份玩家数据（overlay → base，都不存在 ⇒ null）。 */
  async readSystemFile(rel: string): Promise<{ data: Uint8Array; path: string; side: OverlaySide } | null> {
    return this.#overlay ? await this.#overlay.read(rel) : null;
  }

  /** 读 `SYS4REG.INI` 文本（overlay → base）。 */
  async readConfig(): Promise<{ text: string; path: string; side: OverlaySide } | null> {
    return this.#overlay ? await this.#overlay.readText(INI_FILE) : null;
  }

  /**
   * 把整份 INI 文本写到 **overlay** 的 `SYS4REG.INI`（未配置 system 则什么也不做）。
   *
   * ★**防丢键棘轮**：写之前比对**当前生效的那一份**（overlay 优先，否则 base），若新文本的
   * `section:key` 条目数**少于**它，就拒绝落盘并告警 —— 这挡住"配置还没装载就被写回"
   * （那时内存里只有一两个键，一写就会把整份 INI 抹成两行）。宁可少写一次，也不静默丢设置。
   */
  async saveConfig(text: string): Promise<void> {
    const overlay = this.#overlay;
    if (!overlay) return;
    const count = (t: string): number => parseIni(t).values.size;
    const prev = await overlay.readText(INI_FILE);
    if (prev && count(text) < count(prev.text)) {
      const which = prev.side === 'overlay' ? 'overlay' : 'base（真游戏）';
      // eslint-disable-next-line no-console
      console.warn(
        `[config] 拒绝回写 ${overlay.overlayFile(INI_FILE)}：新文本只有 ${count(text)} 个键，` +
          `${which} 那份有 ${count(prev.text)} 个（疑似配置尚未装载就写回）—— 现有文件保持不变`,
      );
      return;
    }
    await overlay.write(INI_FILE, text);
  }

  /** 读 `SAVE.DAT`（overlay → base；都不存在 ⇒ null）。 */
  async readSaveData(): Promise<Uint8Array | null> {
    const hit = await this.readSystemFile(SAVE_DAT_REL);
    return hit ? hit.data : null;
  }

  /**
   * 读**两侧** `SAVE.DAT` 的「已使用文件」标志并取并集（鉴赏/解锁进度；见 `saveData.unionUsedFileIds`）。
   *
   * 与 `readSaveData` 的区别：那个只取"优先级最高的那一份"（overlay → base）。鉴赏进度是**单调集合**
   * （引擎只会往表里加、从不删），所以两侧取并更稳：本工程的 overlay 副本可能由旧版本写过（缺 flag 块，
   * 2026-09 之前的 bug）或落后于真游戏那份。都不存在 ⇒ null。
   */
  async readSaveFlags(): Promise<number[] | null> {
    if (!this.#overlay) return null;
    const bufs: Uint8Array[] = [];
    for (const p of [this.#overlay.overlayFile(SAVE_DAT_REL), this.#overlay.baseFile(SAVE_DAT_REL)]) {
      try {
        const b = await fs.readFile(p);
        bufs.push(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
      } catch {
        /* 该侧没有 */
      }
    }
    if (bufs.length === 0) return null;
    const { ids, layouts } = unionUsedFileIds(bufs);
    this.#log(`[save] 已使用文件（两侧并集）：${ids.length} 个（${layouts.join(' + ')}）`);
    return ids;
  }

  /**
   * 读**两侧** `SAVE.DAT` 的原始字节（overlay 在前、base 在后；缺的那侧不出现）—— 见 `FileSource` 的说明。
   *
   * 为什么不能让 `readSaveData` 直接返回合并结果：那是**字节**（还可能是引擎加密格式），"按 key 并表"
   * 只能在解出表之后做（`saveData.mergeSaveDataTables`）⇒ 这里只负责把两份都给出来。
   */
  async readSaveDataBoth(): Promise<Uint8Array[]> {
    if (!this.#overlay) return [];
    const out: Uint8Array[] = [];
    for (const p of [this.#overlay.overlayFile(SAVE_DAT_REL), this.#overlay.baseFile(SAVE_DAT_REL)]) {
      try {
        const b = await fs.readFile(p);
        out.push(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
      } catch {
        /* 该侧没有 */
      }
    }
    return out;
  }

  /**
   * 写 `SAVE.DAT`：**只写 overlay**（真存档在 base，读时优先 overlay ⇒
   * "继承玩家真存档 + 之后的改动落到我们自己的目录"两件事同时成立）。
   */
  async writeSaveData(data: Uint8Array): Promise<void> {
    if (!this.#overlay) return;
    await this.#overlay.write(SAVE_DAT_REL, data);
  }

  // ---------------------------------------------------------------------------
  // 存档槽（`SAVE%2.2d.DAT` / `.STH`；`tickets/T-0018`）—— 与 SAVE.DAT 同纪律：
  //   读 overlay → base，**写只碰 overlay**（真存档槽在 base，永不覆盖）。
  //   ★**删是唯一例外**（`T-0153` 的 `0x1AB` 条目）：引擎的 `DeleteFileA` 打在真实存档目录
  //   （raw 38473-38481），而本工程的读会回落 base ⇒ 只删 overlay 的话"只存在于 base 的槽删不掉"、
  //   且删掉自己那份会让基座的旧槽复活。⇒ 两侧都删，base 那份先隔离到 `SAVE/.deleted/`（字节不丢）。
  // ---------------------------------------------------------------------------

  /** 读一个槽的整份字节（overlay → base；都没有 ⇒ null）。 */
  async readSaveSlot(slot: number): Promise<Uint8Array | null> {
    const hit = await this.readSystemFile(slotRelPath(slot));
    return hit ? hit.data : null;
  }

  /** 写一个槽（只写 overlay）。 */
  async writeSaveSlot(slot: number, data: Uint8Array): Promise<void> {
    const overlay = this.#overlay;
    if (!overlay) {
      // ★**不许静默**（`T-0153` 的 `0x19E` 条目）：旧实现 `if (!this.#overlay) return;` 什么都没写、
      //   也不报，于是 `saveSlotFromEngine` 走到末尾仍返回 0（"已保存"）而槽文件**一个字节都没落盘**。
      //   引擎在同一格是**可见失败**：`CreateFileA(..., GENERIC_WRITE, ...)` 拿不到句柄 ⇒ 弹
      //   「セーブデータの保存に失敗しました。」+ `op1 = 1`（`sub_42D980` raw 38317-38321）。
      //   本工程没有 system 目录（测试/链路工具刻意不碰玩家数据）时无处可写 ⇒ 抛，由调用方
      //   （`saveSlotFromEngine` 的 `catch`）落成非 0 结果码。
      throw new Error(
        `writeSaveSlot(slot=${slot})：宿主没有配置系统存档目录（NodeFileSourceOptions.system 缺失）⇒ 无处可写；` +
          '拒绝静默 no-op（引擎此时会弹「セーブデータの保存に失敗しました。」并返回 op1 = 1）',
      );
    }
    const p = await overlay.write(slotRelPath(slot), data);
    this.#log(`[slot] 写入槽 ${slot} → ${p}（${data.length} 字节）`);
  }

  /**
   * 删一个槽（`.DAT` + `.STH`；**两侧都删**）。返回各自是否删掉了。
   *
   * ★`T-0153` 的 `0x1AB` 条目（引擎 `sub_42DFC0` raw 38462-38483）：
   * ```c
   * sub_408A40(_this, ArgList, 0x100u);                                  // 真实存档目录
   * sub_408050(FileName, 256, "%s\\SAVE%2.2d.DAT", ArgList, op2);
   * v4 = !DeleteFileA(FileName);                                         // 删成功 ⇒ 0
   * sub_408050(FileName, 256, "%s\\SAVE%2.2d.STH", ArgList, op2);
   * if ( !DeleteFileA(FileName) ) v4 = 2;                                // `.STH` 失败盖成 2
   * ```
   * 引擎只有一个真实存档目录；本工程的"槽是否存在" = **overlay ∪ base**（`readSaveSlot` 会回落 base）
   * ⇒ 只删 overlay 时，**只存在于 base 的槽根本删不掉**（旧行为：两个 `false` ⇒ `op1 = 1`，
   * 而引擎删的是 base 里那一份、返回 0），而且"删掉自己那份"会让基座的旧槽**复活**。
   * ⇒ 两侧都删，`true` = 至少删掉了一份（= 引擎 `DeleteFileA` 的"存在且删成功"口径）。
   *
   * ★**与写路径的安全规则不冲突**（`T-0018` 的"真存档一个字节都不动"只约束**写**：`writeSaveSlot`
   * /`writeSlotThumb`/`writeSaveData`/`saveConfig`）：删槽是玩家显式动作，引擎删的就是真实目录里那一份；
   * 但本工程仍然先把它**隔离**到 `<overlay>/SAVE/.deleted/`，字节不丢（可人工复原）。
   */
  async deleteSaveSlot(slot: number): Promise<{ dat: boolean; sth: boolean }> {
    return { dat: await this.#removeSlotFile(slotRelPath(slot)), sth: await this.#removeSlotFile(slotThumbRelPath(slot)) };
  }

  /** 复制一个槽（`op2` → `op3`）：先取源（overlay → base），再写到目标槽的 overlay。 */
  async copySaveSlot(from: number, to: number): Promise<{ dat: boolean; sth: boolean }> {
    const d = await this.readSaveSlot(from);
    const t = await this.readSlotThumb(from);
    if (d) await this.writeSaveSlot(to, d);
    if (t) await this.writeSlotThumb(to, t);
    return { dat: d !== null, sth: t !== null };
  }

  /** 读 `.STH`（overlay → base）。 */
  async readSlotThumb(slot: number): Promise<Uint8Array | null> {
    const hit = await this.readSystemFile(slotThumbRelPath(slot));
    return hit ? hit.data : null;
  }

  /** 写 `.STH`（只写 overlay）。 */
  async writeSlotThumb(slot: number, data: Uint8Array): Promise<void> {
    if (!this.#overlay) return;
    await this.#overlay.write(slotThumbRelPath(slot), data);
  }

  /**
   * **删一份槽文件**：overlay 与 base **两侧都试**（见 `deleteSaveSlot` 的说明）。
   *
   * base 那一份**先隔离**到 `<overlay>/SAVE/.deleted/<原名>`（同一相对目录下）：本工程从不在 base 上
   * 写/改，删是唯一的例外，而删真存档是不可逆的 ⇒ 先留一份副本再 unlink。隔离写失败 ⇒ **不删**
   * base（宁可让这次删除报失败，也不静默丢字节）。
   *
   * @returns 是否至少删掉了一份（= 引擎 `DeleteFileA` 的"该文件存在且删成功"）
   */
  async #removeSlotFile(rel: string): Promise<boolean> {
    const overlay = this.#overlay;
    if (!overlay) return false;
    let removed = false;
    for (const side of ['overlay', 'base'] as const) {
      const target = side === 'overlay' ? overlay.overlayFile(rel) : overlay.baseFile(rel);
      let exists = false;
      try {
        exists = (await fs.stat(target)).isFile();
      } catch {
        continue; // 该侧没有
      }
      if (!exists) continue;
      if (side === 'base') {
        const backup = overlay.overlayFile(path.join(path.dirname(rel), DELETED_DIR, path.basename(rel)));
        try {
          await fs.mkdir(path.dirname(backup), { recursive: true });
          await fs.copyFile(target, backup);
        } catch (err) {
          this.#log(`[slot] ${target} 的隔离副本写入失败（${(err as Error).message}）⇒ 不删 base 那一份`);
          continue;
        }
        this.#log(`[slot] base 那一份先隔离 → ${backup}`);
      }
      try {
        await fs.unlink(target);
        removed = true;
        this.#log(`[slot] 删除槽文件 ${target}`);
      } catch (err) {
        this.#log(`[slot] 删除 ${target} 失败：${(err as Error).message}`);
      }
    }
    return removed;
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

  /**
   * 扫描并装载扩展包（只做一次，惰性）。
   *
   * 与引擎逐条对齐：
   *  - 扫的是**资源根**（引擎=`GetCurrentDirectoryA()`；两者都等于游戏安装目录），只认 `*.AAI`（大小写不敏感、
   *    **不递归子目录** —— 引擎的搜索模式是 `<CWD>\*.AAI`）；
   *  - 逐个 `parseAppendPack`：魔数门（S4AC/S4AI/S3AC/S3AI）+ 头 @264 的包号；
   *  - 失败的包**只记一行日志、不抛**（引擎：`sprintf` + `sub_4034C0` 记录后释放对象，游戏照常启动）；
   *  - 同包号覆盖（引擎直接赋值 ⇒ 后者覆盖、前者泄漏；我们保留后者并记一行日志）。
   *
   * 顺序：按文件名的确定性排序（引擎用 `FindFirstFile` 的目录顺序；包号才是语义，顺序只影响诊断信息）。
   */
  async #loadAppends(): Promise<void> {
    if (this.#appendsLoaded) return;
    this.#appendsLoaded = true;
    let names: string[];
    try {
      names = (await fs.readdir(this.#root)).filter((n) => /\.aai$/i.test(n)).sort();
    } catch (err) {
      this.#log(`[append] 扫描 ${this.#root} 失败：${(err as Error).message}（按「没有扩展包」继续）`);
      return;
    }
    for (const name of names) {
      let pack;
      try {
        pack = parseAppendPack(await this.readFile(path.join(this.#root, name)));
      } catch (err) {
        // 引擎：AAIファイルの読み込みに失敗しました． %s
        this.#log(`[append] ${name} 装载失败（按未装载跳过）：${(err as Error).message}`);
        continue;
      }
      if (pack.packNumber < 1 || pack.packNumber > MAX_APPEND_PACK) {
        // 引擎会写 FileDB.packs[包号]（槽 0 无人读、槽 ≥256 越界写）⇒ 两种都等于"装了也访问不到"
        this.#log(`[append] ${name} 包号 ${pack.packNumber} 不在 1..${MAX_APPEND_PACK}（引擎语义上不可达，跳过）`);
        continue;
      }
      if (this.#packs.has(pack.packNumber)) {
        this.#log(`[append] ${name} 包号 ${pack.packNumber} 重复 ⇒ 覆盖先装载的那个（引擎同行为）`);
      }
      this.#packs.set(pack.packNumber, pack.index);
      this.#log(
        `[append] ${name} -> pack#${pack.packNumber}（${pack.index.arcCount} 归档 ` +
          `${pack.index.archives.join(',')} / ${pack.index.files.length} 文件）`,
      );
    }
    this.#packNumbers = [...this.#packs.keys()].sort((a, b) => a - b);
  }

  /** 已装载的扩展包包号（升序）。 = 引擎 `FileDB.packs` 的非空槽，供 `0x143` 派发 `$n$AUTORUN`。 */
  async appendPackNumbers(): Promise<number[]> {
    await this.#loadAppends();
    return [...this.#packNumbers];
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

  /**
   * 按统一文件 id（本体或 APPEND 包）解析出文件条目（含归档名 + offset/length），并带上其所属索引（决定用哪套归档）。
   *
   * 与引擎 `sub_4559C0`（raw 67795-67886）逐条对齐：
   *  - **判据是高字节是否为 0**（不是与 base 表长度比大小）：高字节 n ⇒ 包 n、低 24 位 = 包内编号；
   *  - 包未装载 ⇒ **抛 `MissingAppendPackError`**（引擎抛可见异常，不是静默返回"没有"）；
   *  - 包内编号越界 ⇒ null（引擎：「拡張ファイル %s を開くことが出来ません．」）。
   */
  async resolveEntry(index: number): Promise<{ entry: Sys4FileEntry; archives: string[] } | null> {
    const base = await this.#loadBaseIndex();
    await this.#loadAppends();
    return this.#lookupEntry(index, base);
  }

  /**
   * **纯查表**部分（同步）—— `resolveEntry` 与 `readHeaderSync` 共用同一份判定
   * （高字节 = 包号、低 24 位 = 包内编号；`tickets/T-0025` 抽出来避免两处漂移）。
   */
  #lookupEntry(index: number, base: Sys4Index): { entry: Sys4FileEntry; archives: string[] } | null {
    if (index < 0) return null;
    if ((index & 0xff000000) === 0) return base.files[index] ? { entry: base.files[index]!, archives: base.archives } : null;
    const apn = (index >>> 24) & 0xff;
    const pos = index & 0xffffff;
    const pack = this.#packs.get(apn);
    if (!pack) throw new MissingAppendPackError(apn, index);
    return pos < pack.files.length ? { entry: pack.files[pos]!, archives: pack.archives } : null;
  }

  /**
   * **同步**读某个文件 id 的**头部字节**（`tickets/T-0025`：headless 的 `0x208` 需要一个同步答案，
   * 因为脚本可能在**绑定后的同一条指令批**里就问尺寸 —— 异步预取赶不上，而引擎的
   * `set-texture` 是同步读+解码的）。
   *
   * 口径：**松散文件优先**，否则从 ALF 按 offset 切（与 `#readEntryRange` 同判定）。
   * 索引/扩展包必须先由异步路径建好（boot 一定读过 `SYS4INI.BIN` 与脚本）；否则返回 `null`
   * ⇒ 调用方按"尚未就绪/不是 AGF"处理（**不伪造**尺寸）。
   *
   * @param maxBytes 最多读多少字节（默认 64 KB：ACGF 的 meta 与无头的 plan 头都在这段里）
   */
  readHeaderSync(id: number, maxBytes = 65536): { name: string; data: Uint8Array; total: number } | null {
    const base = this.#base;
    if (!base) return null;
    let r: { entry: Sys4FileEntry; archives: string[] } | null;
    try {
      r = this.#lookupEntry(id, base);
    } catch {
      return null; // 包未装载（`MissingAppendPackError`）⇒ 同步路径只当"取不到"
    }
    if (!r) return null;
    const want = Math.max(32, Math.min(maxBytes, r.entry.length > 0 ? r.entry.length : maxBytes));
    // ① 松散文件优先
    const loosePath = path.join(this.#root, r.entry.name);
    try {
      const st = fsSync.statSync(loosePath);
      if (st.isFile()) {
        const fd = fsSync.openSync(loosePath, 'r');
        try {
          const buf = Buffer.alloc(Math.max(32, Math.min(want, st.size)));
          const n = fsSync.readSync(fd, buf, 0, buf.length, 0);
          return { name: r.entry.name, data: new Uint8Array(buf.buffer, buf.byteOffset, n), total: st.size };
        } finally {
          fsSync.closeSync(fd);
        }
      }
    } catch {
      /* 不存在 ⇒ 落到归档 */
    }
    // ② 否则从 ALF 切片
    const arcName = r.archives[r.entry.archiveIndex];
    if (!arcName) return null;
    try {
      const fd = fsSync.openSync(path.join(this.#root, arcName), 'r');
      try {
        const buf = Buffer.alloc(want);
        const n = fsSync.readSync(fd, buf, 0, want, r.entry.offset);
        return { name: r.entry.name, data: new Uint8Array(buf.buffer, buf.byteOffset, n), total: r.entry.length };
      } finally {
        fsSync.closeSync(fd);
      }
    } catch {
      return null;
    }
  }

  /** 按统一文件 id 读出原始字节（含文件名）。用于资源（如图像 AGF / 视频 MPG）读取。 */
  async readById(id: number): Promise<{ name: string; data: Uint8Array } | null> {
    const r = await this.resolveEntry(id);
    if (!r) return null;
    const data = await this.#readEntry(r.entry, r.archives);
    if (!data) return null;
    return { name: r.entry.name, data };
  }

  /**
   * 按统一文件 id 读出**一个字节区间**（含文件名与总长度）。
   *
   * 用途：音频流式（`amayui-audio://audio/<id>` 自定义协议 + `Range` 请求）——BGM 单曲 2–6MB，
   * 整段过一个 IPC 会把 6MB 拷进渲染进程；`<audio>` 按 Range 取块时这里只读那一块。
   * 判定与 `#readEntry` 同口径：**松散文件优先**（读整文件后切片），否则从 ALF 按 offset 切。
   */
  async readByIdRange(
    id: number,
    start: number,
    endInclusive: number,
  ): Promise<{ name: string; data: Uint8Array; total: number } | null> {
    const r = await this.resolveEntry(id);
    if (!r) return null;
    return await this.#readEntryRange(r.entry, r.archives, start, endInclusive);
  }

  /**
   * 按**文件名**读字节（大小写不敏感；本体索引 + 已装载扩展包）。
   *
   * 为什么需要：BGM 的剧本操作数是**曲号**而不是统一文件 id（引擎 `MusicBase` 有一张
   * 曲号→文件 id 表，本作等价于 `BGM%03d.OGG`；证据见 `docs-new/03-engine/sound-system.md` §5）——
   * 用统一 id 解释会静音错曲（2026-09 用户实测：标题曲 `play-bgm 1f` 被解析成 id 31 = `BGM041.OGG`）。
   */
  async readByName(name: string): Promise<{ name: string; data: Uint8Array } | null> {
    const hit = await this.#nameLookup(name);
    if (!hit) return null;
    const data = await this.#readEntry(hit.entry, hit.archives);
    return data ? { name: hit.entry.name, data } : null;
  }

  /** 按文件名读一个字节区间（协议流式用；语义同 `readByIdRange`）。 */
  async readByNameRange(
    name: string,
    start: number,
    endInclusive: number,
  ): Promise<{ name: string; data: Uint8Array; total: number } | null> {
    const hit = await this.#nameLookup(name);
    if (!hit) return null;
    return await this.#readEntryRange(hit.entry, hit.archives, start, endInclusive);
  }

  /** 名字 → 条目（惰性建表：本体 + 已装载扩展包；扩展包先装载以保证表完整）。 */
  async #nameLookup(name: string): Promise<{ entry: Sys4FileEntry; archives: string[]; index: number } | null> {
    const base = await this.#loadBaseIndex();
    await this.#loadAppends();
    if (!this.#nameIndex) {
      const m = new Map<string, { entry: Sys4FileEntry; archives: string[]; index: number }>();
      base.files.forEach((e, i) => m.set(e.name.toLowerCase(), { entry: e, archives: base.archives, index: i }));
      for (const [packNumber, pack] of this.#packs) {
        pack.files.forEach((e, i) => {
          const k = e.name.toLowerCase();
          if (!m.has(k)) m.set(k, { entry: e, archives: pack.archives, index: (packNumber << 24) | i });
        });
      }
      this.#nameIndex = m;
    }
    return this.#nameIndex.get(name.trim().toLowerCase()) ?? null;
  }

  /**
   * **按文件名取回一个脚本**（= 引擎 `sub_455000(FileDB, name)` 的等价物，读档时用来装 `CALLBACK_LOAD.BIN`）。
   * 与 `readScript(id)` 同一条读取路径，只是用名字换到统一 id；命中不了的扩展包条目仍按"松散文件优先"读。
   */
  async readScriptByName(name: string): Promise<ScriptBytes | null> {
    const hit = await this.#nameLookup(name);
    if (!hit) return null;
    const data = await this.#readEntry(hit.entry, hit.archives);
    if (!data) return null;
    return { index: hit.index, name: hit.entry.name, data };
  }

  /** 条目 + 区间 → 字节（松散文件优先）。 */
  async #readEntryRange(
    entry: Sys4FileEntry,
    archives: string[],
    start: number,
    endInclusive: number,
  ): Promise<{ name: string; data: Uint8Array; total: number } | null> {
    const loose = await this.#findLoose(entry.name);
    const total = loose ? loose.length : entry.length;
    if (total <= 0) return null;
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(total - 1, Math.floor(endInclusive));
    if (to < from) return null;
    if (loose) return { name: entry.name, data: loose.subarray(from, to + 1), total };
    const arcName = archives[entry.archiveIndex];
    if (!arcName) return null;
    const data = await this.#readArchiveSlice(arcName, entry.offset + from, to - from + 1);
    return { name: entry.name, data, total };
  }

  /**
   * **音乐表**（SYS4INI 尾部，`FileDB TOC` 之后）：`base[i] = 曲号 (i+2) 的统一文件 id`。
   *
   * 与引擎 `sub_48A0D0` 同口径解析（见 `parseMusicTables`）：装载 PCM 对象的 `+1304` 扁平表。
   * 用途：① `0x1D6/0x1D7/0x1D8` 修改它；② `play-bgm` 的**曲号 → 文件 id** 解析（`sub_48DB80`）。
   */
  async musicTables(): Promise<MusicTables> {
    if (!this.#music) {
      const bytes = await this.readFile(path.join(this.#root, 'SYS4INI.BIN'));
      this.#music = parseSys4MusicTables(bytes);
    }
    return this.#music;
  }

  async readScript(index: number): Promise<ScriptBytes | null> {    const r = await this.resolveEntry(index);
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
