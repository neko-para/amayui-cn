/**
 * **overlay 文件层**：对系统存档目录下的一切访问都走这里。
 *
 * ```text
 * read(rel)   : <overlay>/<rel>  →  <base>/<rel>      （overlay 优先；两边都没有 ⇒ null）
 * write(rel)  : <overlay>/<rel>   （只写这一份；先写 <name>.$$tmp 再改名，与引擎写盘同口径）
 * ```
 *
 * 为什么值得单独一层（而不是各处 `fs.readFile` 两遍）：
 *  - **安全规则只有一处**：写永远不会落到 base，所以"emulator 跑一圈把玩家真存档写坏"不可能发生；
 *  - **宿主无关**：Node 工具（`run.ts`/`saveDump.ts`）与 Electron 主进程（`electron/ipc/files.ts`）
 *    用同一份实现 ⇒ 不会出现"命令行能继承设置、GUI 不能"的漂移；
 *  - **诊断明确**：每次读都告诉你命中 overlay 还是 base（日志里 `[overlay] … (base)`）。
 */
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SystemPaths } from './systemPaths.js';

/** 一份文件是从哪一侧读到的。 */
export type OverlaySide = 'overlay' | 'base';

/** `read` 的命中结果。 */
export interface OverlayHit {
  data: Uint8Array;
  /** 实际读到的绝对路径。 */
  path: string;
  side: OverlaySide;
}

/** `readText` 的命中结果。 */
export interface OverlayTextHit {
  text: string;
  path: string;
  side: OverlaySide;
}

/** 临时文件名后缀（写到一半崩溃时不会污染正式文件）。 */
const TMP_SUFFIX = '.$$tmp';

/** 相对路径校验：必须是相对路径、不含 `..`（防止越出 overlay/base）。 */
export function assertRelative(rel: string): string {
  if (path.isAbsolute(rel)) throw new Error(`overlay 只接受相对路径（收到绝对路径：${rel}）`);
  const norm = path.normalize(rel);
  if (norm.startsWith('..') || norm.includes(`..${path.sep}`)) {
    throw new Error(`overlay 路径不得越出目录（收到：${rel}）`);
  }
  return norm;
}

export class OverlayDir {
  readonly baseDir: string;
  readonly overlayDir: string;
  #log: ((msg: string) => void) | null;

  constructor(paths: SystemPaths, opts?: { log?: (msg: string) => void }) {
    this.baseDir = path.normalize(paths.baseDir);
    this.overlayDir = path.normalize(paths.overlayDir);
    this.#log = opts?.log ?? null;
  }

  /** overlay 侧的绝对路径（不检查存在性）。 */
  overlayFile(rel: string): string {
    return path.join(this.overlayDir, assertRelative(rel));
  }

  /** base 侧的绝对路径（不检查存在性）。 */
  baseFile(rel: string): string {
    return path.join(this.baseDir, assertRelative(rel));
  }

  /** 命中哪一侧（都不存在 ⇒ null）。 */
  async locate(rel: string): Promise<{ path: string; side: OverlaySide } | null> {
    for (const [side, p] of [
      ['overlay', this.overlayFile(rel)],
      ['base', this.baseFile(rel)],
    ] as [OverlaySide, string][]) {
      try {
        const st = await fs.stat(p);
        if (st.isFile()) return { path: p, side };
      } catch {
        /* 试下一侧 */
      }
    }
    return null;
  }

  /** 读：overlay → base。 */
  async read(rel: string): Promise<OverlayHit | null> {
    for (const [side, p] of [
      ['overlay', this.overlayFile(rel)],
      ['base', this.baseFile(rel)],
    ] as [OverlaySide, string][]) {
      try {
        const b = await fs.readFile(p);
        this.#log?.(`${rel} -> ${p} (${side})`);
        return { data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength), path: p, side };
      } catch {
        /* 试下一侧 */
      }
    }
    this.#log?.(`${rel}: overlay/base 都没有`);
    return null;
  }

  /**
   * **部分读**：只要前 `maxBytes` 字节（overlay → base；都没有 ⇒ null）。命中/优先级语义与 `read` 相同。
   *
   * 为什么要有它（实测数字）：引擎的槽头读（`sub_438120`，raw 45115）是
   * `ReadFile(hFile, Buffer, 0x124)` —— **固定读 292 字节**；而 `0x1A0` 在 LOAD 画面
   * **一帧内会被问 100~120 次**。走整份 `read()` 时一个 1~1.5MB 的真存档要
   * 84~117ms/次（读盘 + 过桥搬运 1MB）⇒ 一帧 **4.8s**（实测帧 #2503 = 4832ms，其中
   * `0x1a0` ×120 = 4758ms）—— 这就是用户看到的"切页卡 4 秒"。
   * 只读前 292 字节后，成本回到"一次往返"的地板价（~5ms）。
   *
   * ★文件比 `maxBytes` 短时返回**读到的那么多**（不补齐）：调用方的判据是
   *   "必须恰好 292 字节"（引擎 `NumberOfBytesRead == 292`），补齐会把坏文件伪装成好文件。
   */
  async readPrefix(rel: string, maxBytes: number): Promise<OverlayHit | null> {
    for (const [side, p] of [
      ['overlay', this.overlayFile(rel)],
      ['base', this.baseFile(rel)],
    ] as [OverlaySide, string][]) {
      let fh: fs.FileHandle | null = null;
      try {
        fh = await fs.open(p, 'r');
        const buf = Buffer.allocUnsafe(maxBytes);
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
        this.#log?.(`${rel} -> ${p} (${side}, 前 ${bytesRead}/${maxBytes} 字节)`);
        return { data: new Uint8Array(buf.buffer, buf.byteOffset, bytesRead), path: p, side };
      } catch {
        /* 试下一侧 */
      } finally {
        await fh?.close().catch(() => undefined);
      }
    }
    this.#log?.(`${rel}: overlay/base 都没有`);
    return null;
  }

  /** 文本读（INI 用）。 */
  async readText(rel: string): Promise<OverlayTextHit | null> {
    const hit = await this.read(rel);
    if (!hit) return null;
    return { text: new TextDecoder().decode(hit.data), path: hit.path, side: hit.side };
  }

  /** 同步版 `read`（模块级/初始化期用的工具与测试用；语义完全一致）。 */
  readSync(rel: string): OverlayHit | null {
    for (const [side, p] of [
      ['overlay', this.overlayFile(rel)],
      ['base', this.baseFile(rel)],
    ] as [OverlaySide, string][]) {
      try {
        const b = fsSync.readFileSync(p);
        this.#log?.(`${rel} -> ${p} (${side})`);
        return { data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength), path: p, side };
      } catch {
        /* 试下一侧 */
      }
    }
    return null;
  }

  /** 同步版 `readText`。 */
  readTextSync(rel: string): OverlayTextHit | null {
    const hit = this.readSync(rel);
    if (!hit) return null;
    return { text: new TextDecoder().decode(hit.data), path: hit.path, side: hit.side };
  }

  /**
   * 写：**只写 overlay**（目录不存在则建；先写 `<name>.$$tmp` 再改名）。
   * 返回实际写入的路径（调用方一般打日志用）。
   */
  async write(rel: string, data: Uint8Array | string): Promise<string> {
    // Windows 路径大小写不敏感 ⇒ 比较前统一小写，避免"同一个目录被当成两层"而覆盖真数据
    const same = (a: string, b: string): boolean =>
      process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (same(this.overlayDir, this.baseDir)) {
      throw new Error(`overlay 目录与 base 目录相同（${this.overlayDir}）⇒ 拒绝写，避免覆盖真游戏数据`);
    }
    const target = this.overlayFile(rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}${TMP_SUFFIX}`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
    this.#log?.(`${rel} <- ${target} (overlay)`);
    return target;
  }
}
