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
  /** 按文件名读一个脚本（读档时装 `CALLBACK_LOAD.BIN` 用；返回 {index,name,data:number[]} | null）。 */
  readScriptByName: (name: string) => ipcRenderer.invoke('read-script-by-name', name),
  /** 读任意文件原始字节（number[]）。 */
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  /** 已装载的扩展包包号（升序；主进程扫 *.AAI 后按文件头 @264 注册的结果），供 0x143 派发 $n$AUTORUN。 */
  appendPacks: () => ipcRenderer.invoke('append-packs'),
  /** 读引擎配置 SYS4REG.INI 文本（未找到返回 null）。 */
  readConfigIni: () => ipcRenderer.invoke('read-config-ini'),
  /** 写回引擎配置 SYS4REG.INI（整份文本；写到 readConfigIni 实际返回的那份）。 */
  saveConfigIni: (text: string) => ipcRenderer.invoke('save-config-ini', text),
  /**
   * 读**外置选项文件** `emulator.config.json` 的文本（主进程侧只读；渲染进程无 `fs`）。
   * `exists=false` 是正常情况（没配就用默认值）。解析/校验在 `src/emulatorOptions.ts`。
   */
  readEmulatorOptions: () => ipcRenderer.invoke('read-emulator-options'),
  /** 读存档 SAVE.DAT（`save-int`/`save-string` 表的持久化载体）。 */
  readSaveData: () => ipcRenderer.invoke('read-save-data'),
  /** 写存档 SAVE.DAT（整份字节；主进程侧对引擎格式先备份）。 */
  writeSaveData: (data: Uint8Array) => ipcRenderer.invoke('write-save-data', data),
  /** 按统一资源 id 取一张图（AGF 解码后的 RGBA Uint8Array + 尺寸）。返回 null 表示无法解析。 */
  image: (id: number) => ipcRenderer.invoke('image', id),
  /**
   * 按统一资源 id 取**原始字节**（`{name, data}`；取不到 null）。
   * Live2D 的 `.MOC` / `.MTN` / 纹理 PNG 走这条（`image` 只会解 AGF，对 PNG/二进制必然失败）。
   */
  readById: (id: number) => ipcRenderer.invoke('read-by-id', id),
  /** 按统一资源 id（数字）或文件名（字符串）取一段音频的原始字节（SE = RIFF PCM16 / BGM·语音 = Ogg Vorbis）。 */
  audio: (key: number | string) => ipcRenderer.invoke('audio', key),
  /**
   * 音频流式基址（主进程注册的 `amayui-audio://` + Range）；BGM 用它走 `<audio>` 流播。
   * ★id 放在**路径**段：纯数字主机名会被 URL 解析器当成 IPv4（`//31` → `0.0.0.31`）。
   */
  audioStreamBase: 'amayui-audio://audio/',
  /** 已使用文件标志（`SAVE.DAT` 的鉴赏/解锁块；两侧并集）。 */
  readSaveFlags: (): Promise<number[] | null> => ipcRenderer.invoke('read-save-flags'),
  /** 两侧 `SAVE.DAT` 的原始字节（overlay 在前；渲染侧按 key 并表，见 `tickets/T-0069`）。 */
  readSaveDataBoth: (): Promise<Uint8Array[]> => ipcRenderer.invoke('read-save-data-both'),
  // ---- 存档槽（`tickets/T-0018`）：`0x19E` 存 / `0x1A1` 读 / `0x1A0` 读头 / `0x1AB` 删 / `0x1AC` 复制 / `0x1AE`·`0x1AF` `.STH` ----
  /** 读一个存档槽 `SAVE\SAVE%2.2d.DAT` 的整份字节（overlay → base；没有返回 null）。 */
  readSaveSlot: (slot: number): Promise<Uint8Array | null> => ipcRenderer.invoke('read-save-slot', slot),
  /** 写一个存档槽（主进程**只写 overlay**）。 */
  writeSaveSlot: (slot: number, data: Uint8Array): Promise<void> => ipcRenderer.invoke('write-save-slot', slot, data),
  /** 删槽的 `.DAT` + `.STH`（只删 overlay）。 */
  deleteSaveSlot: (slot: number): Promise<{ dat: boolean; sth: boolean } | null> =>
    ipcRenderer.invoke('delete-save-slot', slot),
  /** 复制槽（源 overlay→base、目标只写 overlay）。 */
  copySaveSlot: (from: number, to: number): Promise<{ dat: boolean; sth: boolean } | null> =>
    ipcRenderer.invoke('copy-save-slot', from, to),
  /** 读槽的 `.STH` 状态块/缩略图字节。 */
  readSlotThumb: (slot: number): Promise<Uint8Array | null> => ipcRenderer.invoke('read-slot-thumb', slot),
  /** 写槽的 `.STH`（只写 overlay）。 */
  writeSlotThumb: (slot: number, data: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('write-slot-thumb', slot, data),
  /** 音乐表（SYS4INI 尾部：曲号 → 文件 id）；VM 的 0x1D6/0x1D7/0x1D8 与 BGM 解析用它。 */
  musicTable: () => ipcRenderer.invoke('music-table'),
  /** 读内置字体文件字节（`res/fonts/` 下相对路径）。返回 null 表示不存在。 */
  font: (file: string) => ipcRenderer.invoke('font', file),

  // ---- 诊断落盘 ----
  /** 诊断日志：追加一批到主进程的 .tmp/amayui-emulator.log（异步，不阻塞主进程）。 */
  logLine: (text: string) => ipcRenderer.send('log-line', text),
  /** 诊断日志：同步追加（关窗前保证落盘，阻塞直至主进程写完）。 */
  logLineSync: (text: string) => ipcRenderer.sendSync('log-line-sync', text),
  /** 渲染窗→主：追加结构化 trace（JSON 行）到 .tmp/scene-trace.jsonl。 */
  appendTraceLine: (line: string) => ipcRenderer.send('append-trace-line', line),
  /**
   * 渲染窗→主：追加一条**回放轨迹**行（时钟 + 输入 + digest）到 `AMAYUI_REPLAY_PATH`
   * （`tools/record.cjs` 启动时设；见 `electron/logging.ts`）。`tickets/T-0005` 的 `--record`。
   */
  appendReplayLine: (line: string) => ipcRenderer.send('append-replay-line', line),
  // ---- `--record`（`tickets/T-0005`）：录制开关与 Scenario 名（环境变量由 `tools/record.cjs` 设）----
  /**
   * **本次是否录制**（`AMAYUI_RECORD=1`）。★为什么走环境变量而不是"主进程发一条开始录制"：
   * 轨迹必须**从启动第一帧**开始录 —— 回放是从"刚装载 SYSTEM4"开始的，若从"界面就绪"才开始录，
   * 录到的帧 0 已经在 TITLE，回放对不上（实测过这个错法）。
   */
  record: process.env.AMAYUI_RECORD === '1',
  /** 录制用的 Scenario 名（进轨迹头；与 `--scenario` 那份同名）。 */
  recordScenario: process.env.AMAYUI_SCENARIO_NAME ?? 'scenario',
  /** 录制用的启动脚本索引。 */
  recordScript: Number(process.env.AMAYUI_SCENARIO_SCRIPT ?? '0'),

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
  /**
   * 控制窗→主：**调试查询**（`tickets/T-0114` 第 1 步）。
   *
   * 走 `invoke` 而不是 `send`：这是一条**要回答案**的请求（控制窗要拿到 `DebugQueryResult` 渲染）。
   * 主进程把它转发给渲染窗（那里才有 `Engine`），渲染窗用 `session.ts` 的同一个 `id` 回发结果。
   */
  debugQuery: (payload: { id: number; text: string }) =>
    ipcRenderer.invoke('control-debug-query', payload) as Promise<unknown>,
  /** 渲染窗→主：回一条调试查询结果（主进程按 `id` 配对并 resolve 上面那个 invoke）。 */
  sendDebugQueryResult: (payload: { id: number; result: unknown }) =>
    ipcRenderer.send('renderer-debug-query-result', payload),
  /** 控制窗→主→渲染窗：一条断点指令（set/clear/list/continue，见 `BreakCommand`）。 */
  controlBreakCommand: (cmd: unknown) => ipcRenderer.send('control-break-command', cmd),
  /** 渲染窗→主→控制窗：断点命中、已暂停（持续态 ⇒ 推送）。 */
  sendBreakPaused: (payload: unknown) => ipcRenderer.send('renderer-break-paused', payload),
  /** 渲染窗→主→控制窗：断点表 + 当前暂停态（全量快照）。 */
  sendBreakList: (payload: unknown) => ipcRenderer.send('renderer-break-list', payload),
  /** 渲染窗→主：上报状态（供主进程转发给控制窗）。 */
  sendRendererStatus: (s: ControlStatus) => ipcRenderer.send('renderer-status', s),
  /**
   * 渲染窗→主：**把真实系统光标挪到客户区坐标 (clientX, clientY)**（引擎 `0x10A` 的宿主侧动作）。
   *
   * 主进程补上内容区原点（`getContentBounds`）并做 DIP→物理（`screen.dipToScreenPoint`），
   * 最后落到 `native/win32-input` 的 `SetCursorPos`；原生模块缺失时静默降级（只改引擎侧光标）。
   */
  setSystemCursor: (clientX: number, clientY: number) => ipcRenderer.send('set-system-cursor', clientX, clientY),

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
  /** 主→渲染窗：一条调试查询（含 `id`，渲染窗原样带回）。返回取消订阅函数。 */
  onDebugQuery: (cb: (payload: { id: number; text: string }) => void) =>
    subscribe('renderer-debug-query', cb),
  /** 主→渲染窗：一条断点指令。返回取消订阅函数。 */
  onBreakCommand: (cb: (cmd: unknown) => void) => subscribe('renderer-break-command', cb),
  /** 主→控制窗：断点命中、已暂停。返回取消订阅函数。 */
  onBreakPaused: (cb: (payload: unknown) => void) => subscribe('control-break-paused', cb),
  /** 主→控制窗：断点表快照。返回取消订阅函数。 */
  onBreakList: (cb: (payload: unknown) => void) => subscribe('control-break-list', cb),
});

/** 订阅一个主→窗口频道；返回取消订阅函数（避免重复注册时重复触发）。 */
function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, value: T): void => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}
