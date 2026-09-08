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
      logLine(text: string): void;
      logLineSync(text: string): string;
      // ---- 控制窗（ControlWindow）相关 ----
      /** 控制窗→主：重启主窗口渲染流程（reload 渲染器 → 重新走完整 boot）。 */
      controlRestart(): void;
      /** 渲染窗→主：abort(0x1)/程序退出 → 关闭主窗口。 */
      closeWindow(): void;
      /** 控制窗→主：设置是否打印全量指令（true=全量，false=仅未知/已忽略）。 */
      controlSetTraceAll(enabled: boolean): void;
      /** 主→控制窗：收到渲染器上报的状态（当前 BIN + 已忽略指令 + traceAll）。 */
      onControlStatus(cb: (s: ControlStatus) => void): void;
      /** 主→渲染窗：traceAll 切换通知（控制窗改的，转发给渲染器）。 */
      onTraceAll(cb: (enabled: boolean) => void): void;
      /** 渲染窗→主：上报状态，供主进程转发给控制窗。 */
      sendRendererStatus(s: ControlStatus): void;
    };
  }
}

/** 渲染器上报给控制窗的状态。ignored = 目前遇到的「已忽略/插桩跳过」指令（去重）。 */
export interface ControlStatus {
  bin: string;
  ignored: { opcode: number; name: string }[];
  traceAll: boolean;
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
