/**
 * Preload：把主进程的 IPC 能力以受限 API 暴露给 renderer（contextIsolation）。
 *
 * 不暴露 `ipcRenderer` 本体；API 面 = `src/renderer/ipcProtocol.ts` 里声明的 `Window.api`。
 * ★注意：两个窗口（游戏窗 + 控制窗）**共用这一份 preload**，所以 API 面是并集、不做最小权限拆分；
 * 若要按窗口收窄，需要拆成两份 preload 并在 `windows.ts` 里分别指定。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ControlStatus } from '../src/renderer/ipcProtocol.js';

contextBridge.exposeInMainWorld('api', {
  // ---- 资源读取（渲染窗）----
  /** 按 call-script 索引读一个脚本（返回 {index,name,data:number[]} | null）。 */
  readScript: (index: number) => ipcRenderer.invoke('read-script', index),
  /** 读任意文件原始字节（number[]）。 */
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  /** 已装载的扩展包包号（升序；主进程扫 *.AAI 后按文件头 @264 注册的结果），供 0x143 派发 $n$AUTORUN。 */
  appendPacks: () => ipcRenderer.invoke('append-packs'),
  /** 读引擎配置 SYS4REG.INI 文本（未找到返回 null）。 */
  readConfigIni: () => ipcRenderer.invoke('read-config-ini'),
  /** 写回引擎配置 SYS4REG.INI（整份文本；写到 readConfigIni 实际返回的那份）。 */
  saveConfigIni: (text: string) => ipcRenderer.invoke('save-config-ini', text),
  /** 读存档 SAVE.DAT（`save-int`/`save-string` 表的持久化载体）。 */
  readSaveData: () => ipcRenderer.invoke('read-save-data'),
  /** 写存档 SAVE.DAT（整份字节；主进程侧对引擎格式先备份）。 */
  writeSaveData: (data: Uint8Array) => ipcRenderer.invoke('write-save-data', data),
  /** 按统一资源 id 取一张图（AGF 解码后的 RGBA Uint8Array + 尺寸）。返回 null 表示无法解析。 */
  image: (id: number) => ipcRenderer.invoke('image', id),
  /** 读内置字体文件字节（`res/fonts/` 下相对路径）。返回 null 表示不存在。 */
  font: (file: string) => ipcRenderer.invoke('font', file),

  // ---- 诊断落盘 ----
  /** 诊断日志：追加一批到主进程的 .tmp/amayui-emulator.log（异步，不阻塞主进程）。 */
  logLine: (text: string) => ipcRenderer.send('log-line', text),
  /** 诊断日志：同步追加（关窗前保证落盘，阻塞直至主进程写完）。 */
  logLineSync: (text: string) => ipcRenderer.sendSync('log-line-sync', text),
  /** 渲染窗→主：追加结构化 trace（JSON 行）到 .tmp/scene-trace.jsonl。 */
  appendTraceLine: (line: string) => ipcRenderer.send('append-trace-line', line),

  // ---- 控制面 ----
  /** 控制窗→主：重启主窗口渲染流程。 */
  controlRestart: () => ipcRenderer.send('control-restart'),
  /** 渲染窗→主：abort(0x1)/程序退出 → 关闭主窗口。 */
  closeWindow: () => ipcRenderer.send('close-window'),
  /** 控制窗→主：设置是否打印全量指令。 */
  controlSetTraceAll: (enabled: boolean) => ipcRenderer.send('control-set-trace-all', enabled),
  /** 控制窗→主：设置定向 trace 白名单（opcode 列表；空 = 不过滤）。 */
  controlSetTraceFilter: (ops: number[]) => ipcRenderer.send('control-set-trace-filter', ops),
  /** 控制窗→主：强制关闭（主进程侧销毁窗口并退出；渲染窗卡住时的兜底）。 */
  controlForceClose: () => ipcRenderer.send('control-force-close'),
  /** 控制窗→主：把某个未知 opcode 作为桩函数跳过并继续执行。 */
  controlSkipOp: (opcode: number) => ipcRenderer.send('control-skip-op', opcode),
  /** 渲染窗→主：上报状态（供主进程转发给控制窗）。 */
  sendRendererStatus: (s: ControlStatus) => ipcRenderer.send('renderer-status', s),

  // ---- 主 → 窗口 的推送 ----
  /**
   * 主→控制窗：状态更新。返回**取消订阅函数**（重新注册不会叠加监听）。
   */
  onControlStatus: (cb: (s: ControlStatus) => void) => subscribe('control-status', cb),
  /** 主→渲染窗：traceAll 切换通知。返回取消订阅函数。 */
  onTraceAll: (cb: (enabled: boolean) => void) => subscribe('renderer-set-trace-all', cb),
  /** 主→渲染窗：定向 trace 白名单变更通知。返回取消订阅函数。 */
  onTraceFilter: (cb: (ops: number[]) => void) => subscribe('renderer-set-trace-filter', cb),
  /** 主→渲染窗：控制窗点了「作为桩函数跳过」→ 携带要跳过的 opcode。返回取消订阅函数。 */
  onControlSkipOp: (cb: (opcode: number) => void) => subscribe('renderer-skip-op', cb),
});

/** 订阅一个主→窗口频道；返回取消订阅函数（避免重复注册时重复触发）。 */
function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, value: T): void => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}
