/**
 * 诊断日志的**批量落盘**通道。
 *
 * 为什么需要批量：逐行 IPC + 主进程同步写盘会把主进程打满（历史上出现过"一次会话写 109MB、
 * 窗口都关不掉"）。因此这里按**行数或时间**节流，并在关窗/卸载时**同步** flush（保证不丢尾）。
 *
 * 约定：所有诊断文本都写进同一个 `RenderStatus.trace`（`PixiBackend` 的日志也汇入这里），
 * 由本类按"已落盘下标"增量取走 —— **trace 数组的唯一下标游标在这里**。
 */
import type { RenderStatus } from '../renderStatus.js';

export class TraceLog {
  /** 已落盘到 `status.trace` 的下标（增量取用，不复制数组）。 */
  #flushed = 0;
  #lastFlushTs = 0;

  constructor(
    private readonly status: RenderStatus,
    /** 攒够这么多行就落盘。 */
    private readonly batchLines = 40,
    /** 或距上次落盘超过这么多毫秒。 */
    private readonly intervalMs = 120,
  ) {}

  /** 追加一行诊断；按节流规则择机落盘。 */
  line(text: string): void {
    this.status.trace.push(text);
    if (this.status.trace.length - this.#flushed >= this.batchLines || performance.now() - this.#lastFlushTs > this.intervalMs) {
      this.#lastFlushTs = performance.now();
      this.flush();
    }
  }

  /** 异步落盘（常规路径；主进程 stream 追加）。 */
  flush(): void {
    const batch = this.#take();
    if (batch === null) return;
    if (window?.api?.logLine) window.api.logLine(batch);
    else console.log('[emu]', batch);
  }

  /**
   * 同步落盘（关窗/卸载路径）。主进程的 `logLineSync` 是同步写，命中错误或强行关窗也不会丢尾；
   * 没有同步通道时退回异步的 `logLine`。
   */
  flushSync(): void {
    const batch = this.#take();
    if (batch === null) return;
    if (window?.api?.logLineSync) window.api.logLineSync(batch);
    else if (window?.api?.logLine) window.api.logLine(batch);
  }

  /** 关窗/卸载/刷新时同步 flush 尾部日志。 */
  attachUnloadHooks(): void {
    window.addEventListener('pagehide', () => this.flushSync());
    window.addEventListener('beforeunload', () => this.flushSync());
  }

  #take(): string | null {
    const lines = this.status.trace.slice(this.#flushed);
    if (lines.length === 0) return null;
    this.#flushed = this.status.trace.length;
    return lines.join('\n');
  }
}
