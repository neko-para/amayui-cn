/**
 * 定向 trace（`scene-trace.jsonl`）的**唯一写入者**。
 *
 * 为什么必须唯一：每条 JSONL 行都要一次 IPC + 主进程写盘，代价极高（见 README 的"事故复盘"），
 * 所以必须按批发送；而"按批发送"与"统计已写行数"如果分散在两处，行数统计就会漏
 * （历史实现里内联 flush 忘了累加，导致控制窗的 `jsonlLines` 系统性偏小）。这里把
 * **缓冲、批量、计数**放在同一个类里，从结构上消除该分歧。
 */
const FLUSH_THRESHOLD = 200;

export class JsonlWriter {
  #buf: string[] = [];
  /** 本会话已写出的 JSONL 行数（遥测：发现"日志把主进程打满"）。 */
  lines = 0;

  /** 追加一行（已 JSON.stringify）；攒够阈值自动 flush。 */
  push(line: string): void {
    this.#buf.push(line);
    if (this.#buf.length >= FLUSH_THRESHOLD) this.flush();
  }

  /** 把缓冲一次性交给主进程（一次 IPC）。 */
  flush(): void {
    if (this.#buf.length === 0) return;
    if (window.api?.appendTraceLine) window.api.appendTraceLine(this.#buf.join('\n'));
    this.lines += this.#buf.length;
    this.#buf.length = 0;
  }
}
