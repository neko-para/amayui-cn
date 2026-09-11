/**
 * 主进程的**诊断落盘**通道（日志 + 结构化 trace）。
 *
 * ★核心约束：**异步路径绝不能阻塞主进程事件循环**。`fs.appendFileSync` 一旦被 renderer 的高频
 * 日志/轨迹打满，主进程就连"关窗"这种自身动作都做不了（历史上出现过一次会话写 109MB 后整窗无响应）。
 * 因此：
 *  - 常规追加走 `WriteStream`（非阻塞）；
 *  - 只有关窗前的 `log-line-sync` 保留同步（必须保证落尾不丢）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ipcMain } from 'electron';
import { LOG_PATH, TRACE_PATH } from './paths.js';

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

let logAppender: Appender = { write: () => {} };
let traceAppender: Appender = { write: () => {} };

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
}
