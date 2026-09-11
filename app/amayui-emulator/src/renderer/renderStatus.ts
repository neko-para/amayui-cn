/**
 * 渲染进程的**状态/诊断载体**。
 *
 * 单独成文件的原因：`RenderStatus` 同时被渲染入口（写）与渲染后端（`PixiBackend` 写日志与 trace）
 * 使用，放在后端文件里会让"入口 → 后端"这条依赖看起来像"入口需要后端类型"，
 * 掩盖了它其实只是一个共享数据结构。
 */
export interface RenderStatus {
  scriptName: string;
  ip: number;
  steps: number;
  log: string[];
  /** 全量日志（不截断），供渲染器按批次落盘诊断。 */
  trace: string[];
}
