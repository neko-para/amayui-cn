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
  /**
   * **把整份 `SYS4REG.INI` 文本写回宿主自己的配置路径**（可选）。
   *
   * 调用方是 `Engine.onConfigChanged`（脚本用 `SetConfig` 族改了配置）。
   * VM 只负责"什么时候该存 + 存什么文本"（`engineConfig.formatIni`），
   * 写到哪里由宿主决定：Node 直写 `app/amayui-emulator/SYS4REG.INI`；Electron 经 IPC 交主进程。
   * **不实现该方法 = 改了内存里的配置但不落盘**（测试/链路工具即如此）。
   */
  saveConfig?(text: string): Promise<void> | void;
  /** 读 `SAVE.DAT` 原始字节（没有该文件返回 null）。 */
  readSaveData?(): Promise<Uint8Array | null>;
  /**
   * 写 `SAVE.DAT`（整份字节；由 `saveData.encodeSaveData` 序列化）。
   *
   * 调用方是 `Engine.onSaveDataChanged`（脚本 `save-int`/`save-string` 改了表）。
   * 与 `saveConfig` 同样：**不实现 = 不落盘**（测试默认如此，避免改动仓库里的存档）。
   */
  writeSaveData?(data: Uint8Array): Promise<void> | void;
  /** 释放资源（宿主关闭文件句柄等）。 */
  dispose?(): Promise<void>;
}
