/**
 * Preload：把主进程的 IPC 能力以受限 API 暴露给 renderer（contextIsolation）。
 * 只暴露两个只读文件访问原语，不暴露 ipcRenderer 本体。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  /** 按 call-script 索引读一个脚本（返回 {index,name,data:number[]} | null）。 */
  readScript: (index: number) => ipcRenderer.invoke('read-script', index),
  /** 读任意文件原始字节（number[]）。 */
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  /** 读引擎配置 SYS4REG.INI 文本（未找到返回 null）。 */
  readConfigIni: () => ipcRenderer.invoke('read-config-ini'),
  /** 按统一资源 id 取一张图（AGF 解码后的 RGBA Uint8Array + 尺寸）。返回 null 表示无法解析。 */
  image: (id: number) => ipcRenderer.invoke('image', id),
  /** 诊断日志：追加一行到主进程的 .tmp/amayui-emulator.log（异步批量）。 */
  logLine: (text: string) => ipcRenderer.send('log-line', text),
  /** 诊断日志：同步追加（关窗前保证落盘，阻塞直至主进程写完）。 */
  logLineSync: (text: string) => ipcRenderer.sendSync('log-line-sync', text),
  // ---- 控制窗（ControlWindow）相关 IPC ----
  /** 控制窗→主：重启主窗口渲染流程。 */
  controlRestart: () => ipcRenderer.send('control-restart'),
  /** 渲染窗→主：abort(0x1)/程序退出 → 关闭主窗口。 */
  closeWindow: () => ipcRenderer.send('close-window'),
  /** 控制窗→主：设置是否打印全量指令。 */
  controlSetTraceAll: (enabled: boolean) => ipcRenderer.send('control-set-trace-all', enabled),
  /** 控制窗→主：设置定向 trace 白名单（opcode 列表；空 = 不过滤）。 */
  controlSetTraceFilter: (ops: number[]) => ipcRenderer.send('control-set-trace-filter', ops),
  /** 控制窗→主：把某个未知 opcode 作为桩函数跳过并继续执行。 */
  controlSkipOp: (opcode: number) => ipcRenderer.send('control-skip-op', opcode),
  /** 主→控制窗：某未知 opcode 已被登记为桩函数。 */
  onControlOpSkip: (cb: (opcode: number) => void) => ipcRenderer.on('control-op-skip-request', (_e, opcode) => cb(opcode)),
  /** 主→控制窗：状态更新。 */
  onControlStatus: (cb: (s: unknown) => void) => ipcRenderer.on('control-status', (_e, s) => cb(s)),
  /** 主→渲染窗：traceAll 切换通知。 */
  onTraceAll: (cb: (enabled: boolean) => void) => ipcRenderer.on('renderer-set-trace-all', (_e, v) => cb(v)),
  /** 主→渲染窗：定向 trace 白名单变更通知。 */
  onTraceFilter: (cb: (ops: number[]) => void) => ipcRenderer.on('renderer-set-trace-filter', (_e, ops) => cb(ops)),
  /** 主→渲染窗：控制窗点了「作为桩函数跳过」→ 携带要跳过的 opcode。 */
  onControlSkipOp: (cb: (opcode: number) => void) => ipcRenderer.on('renderer-skip-op', (_e, opcode) => cb(opcode)),
  /** 渲染窗→主：上报状态（供主进程转发给控制窗）。 */
  sendRendererStatus: (s: unknown) => ipcRenderer.send('renderer-status', s),
  /** 渲染窗→主：追加一条结构化 trace（JSON 行）到 .tmp/scene-trace.jsonl。 */
  appendTraceLine: (line: string) => ipcRenderer.send('append-trace-line', line),
});
