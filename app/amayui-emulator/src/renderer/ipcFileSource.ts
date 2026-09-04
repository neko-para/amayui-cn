/**
 * Renderer 侧文件访问实现（FileSource）。
 * 真实字节在 Electron 主进程读取；这里只做 IPC 转发（见 electron/main.ts 的 read-script/read-file）。
 * 这是 ADR「跨平台 + 可观测」的隔离点：VM 代码零改动，只需换 FileSource 实现。
 */
import type { FileSource, ScriptBytes } from '../arch/fileSource.js';

declare global {
  interface Window {
    api: {
      readScript(index: number): Promise<{ index: number; name: string; data: number[] } | null>;
      readFile(path: string): Promise<number[]>;
      image(id: number): Promise<{ name: string; width: number; height: number; data: Uint8Array } | null>;
    };
  }
}

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

  async dispose(): Promise<void> {
    /* IPC 无句柄需清理，保持接口对齐。 */
  }
}
