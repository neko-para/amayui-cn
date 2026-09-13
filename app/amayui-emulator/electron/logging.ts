/**
 * 主进程的**诊断落盘**通道（日志 + 结构化 trace + 回放轨迹）。
 *
 * ★核心约束：**异步路径绝不能阻塞主进程事件循环**。`fs.appendFileSync` 一旦被 renderer 的高频
 * 日志/轨迹打满，主进程就连"关窗"这种自身动作都做不了（历史上出现过一次会话写 109MB 后整窗无响应）。
 * 因此：
 *  - 常规追加走 `WriteStream`（非阻塞）；
 *  - 只有关窗前的 `log-line-sync` 保留同步（必须保证落尾不丢）。
 *
 * ★**回放轨迹走 gzip**（`tickets/T-0005`）：每帧一行（约 12KB）⇒ 一次 2000 帧的录制 ≈ 25MB 纯文本，
 * 而 JSONL 的压缩比约 20:1。gzip 有"缺尾部即整文件损坏"的风险 ⇒ 退出时**显式 close 并等 flush**
 * （`app.on('will-quit')`，见 `registerLogIpc`）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { app, ipcMain } from 'electron';
import { LOG_PATH, REPLAY_PATH, TRACE_PATH } from './paths.js';

/** 一个只写的追加器。 */
export interface Appender {
  write(text: string): void;
}

/** 以追加模式打开一个非阻塞写入流；失败时退化为丢弃（不抛，避免影响启动）。 */
export function openAppender(p: string): Appender {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const s = fs.createWriteStream(p, { flags: 'a' });
    s.on('error', (err) => console.error(`[append] ${p}: ${err.message}`));
    return { write: (text: string) => void s.write(text.endsWith('\n') ? text : text + '\n') };
  } catch (err) {
    console.error(`[append] 打开失败 ${p}: ${(err as Error).message}`);
    return { write: () => {} };
  }
}

/** 一个 gzip 追加器（`close()` 会结束 gzip 流并等它 flush 到磁盘）。 */
export interface GzAppender extends Appender {
  close(): Promise<void>;
}

/**
 * 以 gzip 追加一个文件（大体积轨迹用）。**不做 `flags:'a'`**：gzip 是多成员流，追加虽然合法
 * （gunzip 会依次读所有成员），但"一次运行一个文件"更好 diff ⇒ 这里用 `'w'`（覆盖）。
 */
export function openGzAppender(p: string): GzAppender {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const file = fs.createWriteStream(p, { flags: 'w' });
    const gz = zlib.createGzip({ level: 6 });
    gz.pipe(file);
    file.on('error', (err) => console.error(`[append] ${p}: ${err.message}`));
    return {
      write: (text: string) => void gz.write(text.endsWith('\n') ? text : text + '\n'),
      close: () =>
        new Promise<void>((resolve) => {
          file.on('close', () => resolve());
          gz.end(); // 结束 gzip ⇒ 写尾部 ⇒ file 收到 end ⇒ close
        }),
    };
  } catch (err) {
    console.error(`[append] 打开 gzip 失败 ${p}: ${(err as Error).message}`);
    return { write: () => {}, close: () => Promise.resolve() };
  }
}

let logAppender: Appender = { write: () => {} };
let traceAppender: Appender = { write: () => {} };
let replayAppender: GzAppender = { write: () => {}, close: () => Promise.resolve() };

/** 启动即建诊断日志文件（写头），确认通道/路径可用。 */
export function initLogFile(): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, '=== amayui-emulator.log ===\n');
    console.log(`[main] diagnostic log -> ${LOG_PATH}`);
  } catch (err) {
    console.error(`[main] init log failed: ${(err as Error).message}`);
  }
}

/** 注册日志/轨迹相关的 IPC（异步批量 + 关窗同步兜底）。 */
export function registerLogIpc(): void {
  logAppender = openAppender(LOG_PATH);
  traceAppender = openAppender(TRACE_PATH);

  ipcMain.on('log-line', (_e, line: string) => {
    logAppender.write(line);
  });
  // 同步最终落盘（renderer 关窗前调用，保证不丢尾）。
  ipcMain.on('log-line-sync', (e, line: string) => {
    try {
      fs.appendFileSync(LOG_PATH, line + '\n');
    } catch (err) {
      console.error(`[log-line-sync] ${(err as Error).message}`);
    }
    e.returnValue = 'ok';
  });
  ipcMain.on('append-trace-line', (_e, text: string) => {
    traceAppender.write(text);
  });
  // ★回放轨迹（`tickets/T-0005`）：路径由 `AMAYUI_REPLAY_PATH` 指定（`tools/record.cjs` 设），
  //   缺省 `.tmp/replay-trace.jsonl.gz`。**gzip**（每帧约 12KB ⇒ 一次录制几十 MB 纯文本）⇒
  //   必须有"退出前排空"的兜底，否则 gzip 尾部缺失 ⇒ 整份轨迹不可解。
  replayAppender = openGzAppender(REPLAY_PATH);
  console.log(`[main] replay trace -> ${REPLAY_PATH}`);
  ipcMain.on('append-replay-line', (_e, text: string) => {
    replayAppender.write(text);
  });
  app.on('will-quit', (event) => {
    if (flushed) return;
    event.preventDefault();
    void replayAppender.close().then(() => {
      flushed = true;
      console.log('[main] replay trace flushed');
      app.quit();
    });
  });
}

/** `will-quit` 的排空只做一次（否则 `app.quit()` 会再触发一轮）。 */
let flushed = false;
