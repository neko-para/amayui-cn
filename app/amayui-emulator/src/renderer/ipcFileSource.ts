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
      /** 读引擎配置 SYS4REG.INI 文本（未找到返回 null）。 */
      readConfigIni(): Promise<{ path: string; text: string } | null>;
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
      /** 控制窗→主→渲染窗：把某个未知 opcode 登记为 no-op 桩函数并继续执行（见 Engine.unknownOpStubs）。 */
      controlSkipOp(opcode: number): void;
      /** 主→控制窗：某未知 opcode 已被登记为桩函数（用于把控制窗的"待处理"块收掉）。 */
      onControlOpSkip(cb: (opcode: number) => void): void;
      /** 主→控制窗：收到渲染器上报的状态（当前 BIN + 已忽略指令 + traceAll）。 */
      onControlStatus(cb: (s: ControlStatus) => void): void;
      /** 主→渲染窗：traceAll 切换通知（控制窗改的，转发给渲染器）。 */
      onTraceAll(cb: (enabled: boolean) => void): void;
      /** 主→渲染窗：控制窗点了「作为桩函数跳过」→ 携带要跳过的 opcode。 */
      onControlSkipOp(cb: (opcode: number) => void): void;
      /** 渲染窗→主：上报状态，供主进程转发给控制窗。 */
      sendRendererStatus(s: ControlStatus): void;
    };
  }
}

/** 渲染器上报给控制窗的状态。ignored = 目前遇到的「已忽略/插桩跳过」指令（去重）。 */
export interface ControlStatus {
  bin: string;
  /** 真·忽略：纯 no-op 插桩（`op_engine_internal`，本机无对应子系统，不做任何事）。 */
  ignored: { opcode: number; name: string }[];
  /** 已插桩但有专门处理：消息窗/声音/数组排序/字段写入等（按引擎语义执行，只是不产出可渲染输出）。 */
  internal: { opcode: number; name: string }[];
  traceAll: boolean;
  /** 硬错误（如「xxx 指令未实现」）；无错误时不填。 */
  error?: string;
  /** 当前**停在未知指令**等待处理（控制窗据此显示「作为桩函数跳过」按钮）；已放行/未暂停时不填。 */
  pendingUnknown?: {
    opcode: number;
    name: string;
    script: string;
    byteOffset: number;
    instrIndex: number;
  };
  /** 已被用户当作桩函数跳过的 opcode（去重，含各自被执行的次数）。 */
  skipped: { opcode: number; name: string; count: number }[];
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
