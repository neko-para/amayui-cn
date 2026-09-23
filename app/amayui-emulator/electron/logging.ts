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
 *
 * ★`tickets/T-0134` WS-3：**appender 的创建与路径已下沉**到 `src/host/service.ts`（每实例一份；
 * 路径来自 `InstanceLayout`）。本文件只剩**传输层**：`ipcMain.on(…)` 的通道名、`will-quit` 的排空时机、
 * 同步 `log-line-sync` 的语义 —— 全部与重构前逐字一致（Electron 零行为变更）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, ipcMain } from 'electron';
import { REPO_ROOT, RESOURCE_DIR } from './paths.js';
import { defaultHostService, type Appender, type GzAppender, type HostService } from '../src/host/service.js';

/**
 * 进程内默认宿主服务（单例；`ipc/files.ts` 拿的是**同一个**对象 ⇒ appenders 与资源读取共享一份落点）。
 * ★懒构造：首次用到时才建（`initLogFile()` 是第一个调用点，在 `paths.ts` 之后）。
 */
function host(): HostService {
  return defaultHostService({ repoRoot: REPO_ROOT, resourceDir: RESOURCE_DIR });
}

// ★`registerLogIpc()` 之前是空实现（与重构前同语义：那之前 `logMainLine()` 只进 console）。
let logAppender: Appender = { write: () => {} };
let traceAppender: Appender = { write: () => {} };
let replayAppender: GzAppender = { write: () => {}, close: () => Promise.resolve() };

/** 启动即建诊断日志文件（写头），确认通道/路径可用。 */
export function initLogFile(): void {
  const LOG_PATH = host().layout.logPath;
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
  const svc = host();
  logAppender = svc.log;
  traceAppender = svc.trace;

  ipcMain.on('log-line', (_e, line: string) => {
    logAppender.write(line);
  });
  // 同步最终落盘（renderer 关窗前调用，保证不丢尾）。
  ipcMain.on('log-line-sync', (e, line: string) => {
    svc.logSync(line); // ★同步语义只有这一处，落在服务里（`fs.appendFileSync`）
    e.returnValue = 'ok';
  });
  ipcMain.on('append-trace-line', (_e, text: string) => {
    traceAppender.write(text);
  });
  // ★回放轨迹（`tickets/T-0005`）：路径由 `AMAYUI_REPLAY_PATH` 指定（`tools/record.cjs` 设），
  //   缺省 `.tmp/replay-trace.jsonl.gz`。**gzip**（每帧约 12KB ⇒ 一次录制几十 MB 纯文本）⇒
  //   必须有"退出前排空"的兜底，否则 gzip 尾部缺失 ⇒ 整份轨迹不可解。
  replayAppender = svc.replay;
  console.log(`[main] replay trace -> ${svc.layout.replayPath}`);
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

/**
 * **主进程写一行诊断**（写进与渲染进程同一个 `.tmp/amayui-emulator.log`）。
 *
 * 为什么需要它：主进程侧的事件（原生模块加载状态、IPC 收到的坐标换算失败……）以前只能 `console.log`
 * 到终端；而"光标怎么不动"这类问题恰恰是**主进程侧**的，终端一关就没了证据。
 * ★必须在 `registerLogIpc()` **之后**调用：在那之前 `logAppender` 是空实现（只进 console）。
 */
export function logMainLine(line: string): void {
  console.log(line);
  logAppender.write(line);
}
