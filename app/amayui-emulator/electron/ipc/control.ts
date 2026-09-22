/**
 * 主进程的**控制面 IPC**：重启 / 关窗 / 强制关闭 / trace 开关 / 桩跳过 / 状态转发。
 *
 * 设计要点：这些处理器都**只在主进程执行、不依赖渲染窗响应**。
 * 尤其是 `control-force-close`：渲染窗可能被高频 IPC / 超长指令批 / 忙等门控拖住，
 * 此时连系统关闭按钮都可能迟迟不响应，本处理器是"卡住也一定能收场"的兜底。
 */
import { app, ipcMain } from 'electron';
import { windows } from '../windows.js';

/** 调试查询的等待者（`id` → resolve）。见 `control-debug-query`。 */
const debugQueryWaiters = new Map<number, (result: unknown) => void>();

/** 调试查询超时（ms）。渲染窗卡住时不至于让控制窗永远转圈。 */
const DEBUG_QUERY_TIMEOUT_MS = 5000;

/** 调试查询的**单调 id**（控制窗与调试服务器共用；见 `sendDebugQuery`）。 */
let debugQuerySeq = 0;

/**
 * **发一条调试查询给渲染窗并等答案**（`tickets/T-0114`）。
 *
 * ★为什么抽成导出函数：控制窗的 IPC 处理器（`control-debug-query`）与
 * **外部调试服务器**（`tools/debugsrv.cjs`）要走**同一条**逻辑 ——
 * 两处各写一遍 id 配对/超时几乎必然漂移（本工程已踩过同类事故：控制面板手抄事件类型清单）。
 */
export async function sendDebugQuery(text: string): Promise<unknown> {
  if (!windows.hasGame()) return { ok: false, query: text, lines: ['主窗口不在（没有引擎可查）'] };
  return new Promise((resolve) => {
    const id = ++debugQuerySeq;
    const timer = setTimeout(() => {
      debugQueryWaiters.delete(id);
      resolve({ ok: false, query: text, lines: [`查询超时（渲染窗未在 ${DEBUG_QUERY_TIMEOUT_MS}ms 内回应）`] });
    }, DEBUG_QUERY_TIMEOUT_MS);
    debugQueryWaiters.set(id, (result) => {
      clearTimeout(timer);
      debugQueryWaiters.delete(id);
      resolve(result);
    });
    windows.sendToRenderer('renderer-debug-query', { id, text });
  });
}

/** 发一条**断点指令**给渲染窗（单向；结果由渲染窗推送回来 —— 见 `renderer-break-list`）。 */
export function sendBreakCommand(cmd: unknown): void {
  windows.sendToRenderer('renderer-break-command', cmd);
}

export function registerControlIpc(): void {
  // 控制窗：重启主窗口渲染流程
  ipcMain.on('control-restart', () => {
    if (windows.hasGame()) {
      // 主窗口还在：reload 渲染器 → 重新走完整 boot
      windows.game!.webContents.reload();
      console.log('[main] control: restart -> reload renderer');
    } else {
      // 主窗口已关闭/不存在（控制窗仍开）：重新创建主窗口（boot 重新跑）
      windows.createGame();
      console.log('[main] control: restart -> recreate main window');
    }
  });

  // abort(0x1)/程序退出：渲染窗请求关闭主窗口
  ipcMain.on('close-window', () => {
    if (windows.hasGame()) windows.game!.close();
    console.log('[main] abort -> close main window');
  });

  // 控制窗：**强制关闭**（主进程侧 destroy + quit）
  ipcMain.on('control-force-close', () => {
    console.log('[main] control: FORCE CLOSE');
    try {
      if (windows.game && !windows.game.isDestroyed()) windows.game.destroy();
      if (windows.control && !windows.control.isDestroyed()) windows.control.destroy();
    } catch (err) {
      console.error(`[force-close] ${(err as Error).message}`);
    }
    app.exit(0);
  });

  // 控制窗：设置是否打印全量指令 → 转发给渲染窗（renderer 监听 onTraceAll）
  ipcMain.on('control-set-trace-all', (_e, enabled: boolean) => {
    windows.sendToRenderer('renderer-set-trace-all', enabled);
    console.log(`[main] control: traceAll=${enabled}`);
  });

  // 控制窗：设置定向 trace 白名单（opcode 列表；空 = 不过滤）→ 转发给渲染窗
  ipcMain.on('control-set-trace-filter', (_e, ops: number[]) => {
    windows.sendToRenderer('renderer-set-trace-filter', ops);
    console.log(
      `[main] control: traceFilter=${ops.length ? ops.map((o) => '0x' + o.toString(16)).join(',') : '（空=全部）'}`,
    );
  });

  // 控制窗：「作为桩函数跳过」→ 转发给渲染窗（renderer 登记用户桩 + 从暂停点继续）。
  // 渲染窗此刻应正停在该未知指令上；如已不在该状态，渲染器会自行忽略并记一条日志。
  ipcMain.on('control-skip-op', (_e, opcode: number) => {
    windows.sendToRenderer('renderer-skip-op', opcode);
    console.log(`[main] control: skip-as-stub opcode=0x${Number(opcode).toString(16)}`);
  });

  // 控制窗：**调试查询**（`tickets/T-0114` 第 1 步）。
  //   控制窗 →（invoke）主 →（send）渲染窗；渲染窗用同一个 id 回发结果，这里 resolve 那个 invoke。
  //   ★为什么必须中转：引擎状态在**渲染窗**，而控制窗是本工程**独立**的 BrowserWindow（`windows.control`），
  //     两窗之间没有 ipcRenderer 直连通道（见 `windows.ts` 的 `sendToRenderer`/`sendToControl`）。
  //   ★为什么用 invoke：这是一条**要回答案**的请求；`send` 拿不到返回值。
  //   ★为什么带超时：渲染窗可能正卡在长指令批/门控里；没有超时会让控制窗的按钮永远转圈。
  ipcMain.handle('control-debug-query', async (_e, payload: { id: number; text: string }) => {
    return sendDebugQuery(String(payload?.text ?? ''));
  });

  // 渲染窗 → 主：回一条调试查询结果（按 id 配对上面那个 invoke）。
  ipcMain.on('renderer-debug-query-result', (_e, payload: { id: number; result: unknown }) => {
    const w = debugQueryWaiters.get(Number(payload?.id));
    if (w) w(payload.result);
  });

  // 控制窗 → 主 → 渲染窗：断点指令（set/clear/list/continue）。★`send` 即可（不需要回值）：
  //   断点表的"回读"由渲染窗**推送**全量快照（`renderer-break-list`）—— 状态在渲染窗，
  //   面板只管显示，避免"请求/应答"与"推送"两套并行造成不同步。
  ipcMain.on('control-break-command', (_e, cmd: unknown) => {
    sendBreakCommand(cmd);
  });

  // 渲染窗 → 主 → 控制窗：断点命中（持续态）与断点表快照（两路都是**推送**）。
  ipcMain.on('renderer-break-paused', (_e, payload: unknown) => {
    windows.sendToControl('control-break-paused', payload);
  });
  ipcMain.on('renderer-break-list', (_e, payload: unknown) => {
    windows.sendToControl('control-break-list', payload);
  });

  // 渲染窗 → 主 → 控制窗：状态上报（当前 BIN + 已忽略/已跳过指令 + traceAll + 暂停点）
  ipcMain.on('renderer-status', (_e, s: unknown) => {
    windows.sendToControl('control-status', s);
  });
}
