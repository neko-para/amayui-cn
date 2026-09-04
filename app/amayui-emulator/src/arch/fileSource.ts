/**
 * 文件访问抽象（异步代理）。
 * 约束：VM 侧一切文件操作都必须经此接口 —— 宿主跑 Node 时用 NodeFileSource（直接 fs）；
 * 将来 VM 跑在 Electron renderer 时换成 IpcFileSource（本地文件访问走 IPC 到主进程），
 * 接口不变，VM 代码零改动。这是 ADR「跨平台 + 可观测」的关键隔离点。
 */

export interface ScriptBytes {
  index: number;
  /** 文件名（如 'SYSTEM4.BIN'） */
  name: string;
  /** 原始 BIN 字节 */
  data: Uint8Array;
}

export interface FileSource {
  /** 读整个文件字节（任意路径）。 */
  readFile(path: string): Promise<Uint8Array>;
  /**
   * 按"call-script 索引"取回一个脚本（含文件名）。
   * index < baseCount -> SYS4INI base；否则 高字节=APPENDnn、低24位=pos。
   * 返回 null 表示无法解析/读不到。
   */
  readScript(index: number): Promise<ScriptBytes | null>;
  /** 释放资源（宿主关闭文件句柄等）。 */
  dispose?(): Promise<void>;
}
