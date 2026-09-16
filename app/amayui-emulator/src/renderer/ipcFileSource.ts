/**
 * Renderer 侧文件访问实现（`FileSource`）。
 *
 * 真实字节在 Electron 主进程读取；这里只做 IPC 转发（见 `electron/main.ts` 的 read-script/read-file）。
 * 这是 ADR「跨平台 + 可观测」的隔离点：VM 代码零改动，只需换 FileSource 实现。
 *
 * IPC 契约与跨窗 DTO 见 `./ipcProtocol.ts`（那里负责 `Window.api` 的全局声明）。
 */
import type { FileSource, ScriptBytes } from '../arch/fileSource.js';

export type { ControlStatus } from './ipcProtocol.js';

export class IpcFileSource implements FileSource {
  async readFile(p: string): Promise<Uint8Array> {
    const a = await window.api.readFile(p);
    return new Uint8Array(a);
  }

  async readScript(index: number): Promise<ScriptBytes | null> {
    const r = await window.api.readScript(index);
    if (!r) return null;
    return { index: r.index, name: r.name, data: new Uint8Array(r.data) };
  }

  /**
   * 已装载的扩展包包号（主进程侧扫 `*.AAI` + 读文件头得到的）。
   *
   * ★缺失包号时的报错语义由**主进程**保证：`readScript` 走主进程的 `NodeFileSource.resolveEntry`，
   * 包未装载会抛 `MissingAppendPackError`（消息即引擎原文），经 IPC 以 rejected promise 冒到渲染侧。
   * 旧 preload 没有 `appendPacks` 时返回空数组 = 引擎「目录里没有 *.AAI」的静默行为。
   */
  async appendPackNumbers(): Promise<number[]> {
    return (await window.api.appendPacks?.()) ?? [];
  }

  /**
   * 配置回写：整份 `SYS4REG.INI` 文本经 IPC 交主进程写盘（写到启动时**实际读到**的那份，
   * 见 `electron/ipc/files.ts` 的 `read-config-ini`）。
   *
   * `window.api.saveConfigIni` 在旧 preload（未更新）时可能缺失 ⇒ 静默降级为"只改内存"。
   */
  async saveConfig(text: string): Promise<void> {
    await window.api.saveConfigIni?.(text);
  }

  /** 读 `SAVE.DAT`（主进程从存档目录读；不存在返回 null）。 */
  async readSaveData(): Promise<Uint8Array | null> {
    const r = await window.api.readSaveData?.();
    return r ? new Uint8Array(r) : null;
  }

  /** 写 `SAVE.DAT`（主进程写盘；见 `electron/ipc/files.ts` 的 `write-save-data`）。 */
  async writeSaveData(data: Uint8Array): Promise<void> {
    await window.api.writeSaveData?.(data);
  }

  /** 「已使用文件」标志（主进程把 overlay 与 base 两侧取并集；见 `read-save-flags`）。 */
  async readSaveFlags(): Promise<number[] | null> {
    return (await window.api.readSaveFlags?.()) ?? null;
  }

  // ---- 存档槽（`tickets/T-0018`；`0x19E`/`0x1A1`/`0x1A0`/`0x1AB`/`0x1AC`/`0x1AE`/`0x1AF`）----
  // ★这些方法在旧 preload（未更新）时可能缺失 ⇒ 返回 null/不做事 = 引擎"打不开该槽"的行为
  //   （脚本会把它当空槽画出来），而不是抛错。

  /** 读一个槽的整份字节（overlay → base；没有返回 null）。 */
  async readSaveSlot(slot: number): Promise<Uint8Array | null> {
    const r = await window.api.readSaveSlot?.(slot);
    return r ? new Uint8Array(r) : null;
  }

  /** 写一个槽（主进程**只写 overlay**）。 */
  async writeSaveSlot(slot: number, data: Uint8Array): Promise<void> {
    await window.api.writeSaveSlot?.(slot, data);
  }

  /** 删一个槽的 `.DAT` + `.STH`（只删 overlay）。 */
  async deleteSaveSlot(slot: number): Promise<{ dat: boolean; sth: boolean }> {
    return (await window.api.deleteSaveSlot?.(slot)) ?? { dat: false, sth: false };
  }

  /** 复制槽（源 overlay→base、目标只写 overlay）。 */
  async copySaveSlot(from: number, to: number): Promise<{ dat: boolean; sth: boolean }> {
    return (await window.api.copySaveSlot?.(from, to)) ?? { dat: false, sth: false };
  }

  /** 读槽的 `.STH`（状态块/缩略图）。 */
  async readSlotThumb(slot: number): Promise<Uint8Array | null> {
    const r = await window.api.readSlotThumb?.(slot);
    return r ? new Uint8Array(r) : null;
  }

  /** 写槽的 `.STH`（只写 overlay）。 */
  async writeSlotThumb(slot: number, data: Uint8Array): Promise<void> {
    await window.api.writeSlotThumb?.(slot, data);
  }

  /**
   * **按统一文件 id 读原始字节**（`FileSource.readById` 的渲染进程实现）。
   *
   * ★为什么必须补这一条：Live2D 的 `0x341`/`0x345`/`0x34E` 由 `live2d/assetLoader` 直接调
   * `Engine.fileSource.readById` —— 渲染进程缺它，装载链就整条哑掉（槽保持为空 ⇒ 572B 节点
   * 按引擎门控整块不出画，**不报错**）。旧 preload 没有该通道时返回 null 同上。
   */
  async readById(id: number): Promise<{ name: string; data: Uint8Array } | null> {
    const r = await window.api.readById?.(id);
    return r ? { name: r.name, data: new Uint8Array(r.data) } : null;
  }

  async dispose(): Promise<void> {
    /* IPC 无句柄需清理，保持接口对齐。 */
  }
}
