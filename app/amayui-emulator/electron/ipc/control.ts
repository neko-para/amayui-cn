/**
 * 主进程的**控制面 IPC**：重启 / 关窗 / 强制关闭 / trace 开关 / 桩跳过 / 状态转发。
 *
 * 设计要点：这些处理器都**只在主进程执行、不依赖渲染窗响应**。
 * 尤其是 `control-force-close`：渲染窗可能被高频 IPC / 超长指令批 / 忙等门控拖住，
 * 此时连系统关闭按钮都可能迟迟不响应，本处理器是"卡住也一定能收场"的兜底。
 */
import { app, ipcMain } from 'electron';
import { windows } from '../windows.js';

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

  // 渲染窗 → 主 → 控制窗：状态上报（当前 BIN + 已忽略/已跳过指令 + traceAll + 暂停点）
  ipcMain.on('renderer-status', (_e, s: unknown) => {
    windows.sendToControl('control-status', s);
  });
}
