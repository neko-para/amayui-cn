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
   * 配置回写：整份 `SYS4REG.INI` 文本经 IPC 交主进程写盘（写到启动时**实际读到**的那份，
   * 见 `electron/ipc/files.ts` 的 `read-config-ini`）。
   *
   * `window.api.saveConfigIni` 在旧 preload（未更新）时可能缺失 ⇒ 静默降级为"只改内存"。
   */
  async saveConfig(text: string): Promise<void> {
    await window.api.saveConfigIni?.(text);
  }

  async dispose(): Promise<void> {
    /* IPC 无句柄需清理，保持接口对齐。 */
  }
}
