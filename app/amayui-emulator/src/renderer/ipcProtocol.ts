/**
 * **渲染进程 ↔ 控制窗 ↔ 主进程的线上协议**（IPC 契约 + 状态 DTO）。
 *
 * 为什么单独成文件：这段内容原先长在 `ipcFileSource.ts` 里（该文件 110 行中只有 16 行是
 * FileSource 实现），结果控制窗为了拿 `ControlStatus` 去 import 一个"文件访问"模块，
 * 顺带把这里的 `declare global` 拉进控制窗的编译单元，形成**两份互相冲突的 `Window.api` 声明**。
 * 现在两侧都从这里 import，全局声明只有一份。
 */

/** `window.api`：preload 经 contextBridge 暴露的全部通道。 */
declare global {
  interface Window {
    api: {
      readScript(index: number): Promise<{ index: number; name: string; data: number[] } | null>;
      readFile(path: string): Promise<number[]>;
      /**
       * **已装载的扩展包包号（升序）** —— 主进程扫资源根下的 `*.AAI`、按文件头 @264 的包号注册后的结果。
       * 渲染侧的 `0x143`（`i143`）用它派发各包的 `$n$AUTORUN.BIN`；旧 preload 没有此通道时按「未装扩展包」降级。
       */
      appendPacks?(): Promise<number[]>;
      /** 读引擎配置 SYS4REG.INI 文本（overlay → 真游戏那份；都没有返回 null）。 */
      readConfigIni(): Promise<{ path: string; text: string; side: 'overlay' | 'base' } | null>;
      /**
       * **写回**引擎配置 SYS4REG.INI（整份文本；主进程**只写 overlay**，真游戏那份不动）。
       * 由 `Engine.onConfigChanged` → `IpcFileSource.saveConfig` 调用；旧 preload 可能没有此通道
       * （调用点用 `?.` 降级为"只改内存"）。
       */
      saveConfigIni?(text: string): Promise<{ path: string } | null>;
      /** 读 `SAVE.DAT` 原始字节（overlay → base；都没有返回 null）。`save-int`/`save-string` 表的持久化载体。 */
      readSaveData?(): Promise<Uint8Array | number[] | null>;
      /** 写 `SAVE.DAT`（整份字节）；主进程**只写 overlay**，真存档永不被覆盖。 */
      writeSaveData?(data: Uint8Array): Promise<{ path: string } | null>;
      /**
       * **「已使用文件」标志**（`SAVE.DAT` 开头的 int 块 = FileDB 的鉴赏/解锁表；统一文件 id 数组）。
       * 主进程把 overlay 与 base **两侧取并集**（进度是单调集合 ⇒ 不因 overlay 里的旧副本丢进度）。
       */
      readSaveFlags?(): Promise<number[] | null>;
      image(id: number): Promise<{ name: string; width: number; height: number; data: Uint8Array } | null>;
      /**
       * **按统一资源 id（数字）或文件名（字符串）取一段音频的原始字节**
       * （SE=`RIFF` PCM16 WAV / BGM·语音=`OggS` Vorbis；实测见 `docs/13-audio-plan.md` §1）。
       * ★BGM 传的是**文件名**（曲号 → `BGM031.OGG`，见 `docs-new/03-engine/sound-system.md` §5）；
       * SE / 语音传统一文件 id。返回 null = 解析/读取失败。
       */
      audio?(key: number | string): Promise<Uint8Array | null>;
      /**
       * **音频流式基址**（主进程注册的 `amayui-audio://` 自定义协议 + Range）。
       * 有它时 BGM 走 `<audio>` 流播（不把 2–6MB 全解成 PCM）；没有则退回 IPC 字节 + `decodeAudioData`。
       */
      audioStreamBase?: string;
      /**
       * **音乐表**（SYS4INI 尾部：曲号 → 文件 id）。VM 的 `0x1D6/0x1D7/0x1D8` 与 BGM 曲号解析用它；
       * 返回 null = 索引里没有这张表（引擎侧只跳过一个 dword 的情形）。
       */
      musicTable?(): Promise<{ other: number[]; base: number[] } | null>;
      /**
       * 读内置字体文件字节（`res/fonts/` 下的相对路径；渲染进程用 `FontFace` 注册）。
       * 走 IPC 而不是相对 URL：渲染页在 `dist/renderer/` 下，`file://` + CSP 下加载仓外资源不可靠。
       */
      font(file: string): Promise<Uint8Array | null>;
      logLine(text: string): void;
      logLineSync(text: string): string;
      // ---- 控制窗（ControlWindow）相关 ----
      /** 控制窗→主：重启主窗口渲染流程（reload 渲染器 → 重新走完整 boot）。 */
      controlRestart(): void;
      /** 渲染窗→主：abort(0x1)/程序退出 → 关闭主窗口。 */
      closeWindow(): void;
      /** 控制窗→主：设置是否打印全量指令（true=全量，false=仅未知/已忽略）。 */
      controlSetTraceAll(enabled: boolean): void;
      /** 控制窗→主：设置定向 trace 白名单（opcode 列表；空 = 不过滤）。 */
      controlSetTraceFilter(ops: number[]): void;
      /**
       * 控制窗→主：**强制关闭**（销毁全部窗口并退出）。
       * 主进程侧实现 ⇒ 即使渲染窗被高频 IPC/长循环拖住也能收场（本轮排查中"连窗口都关不掉"的兜底）。
       */
      controlForceClose(): void;
      /** 控制窗→主→渲染窗：把某个未知 opcode 登记为 no-op 桩函数并继续执行（见 Engine.unknownOpStubs）。 */
      controlSkipOp(opcode: number): void;
      // 主→窗口 的推送：均返回**取消订阅函数**。
      /** 主→控制窗：收到渲染器上报的状态。 */
      onControlStatus(cb: (s: ControlStatus) => void): () => void;
      /** 主→渲染窗：traceAll 切换通知（控制窗改的，转发给渲染器）。 */
      onTraceAll(cb: (enabled: boolean) => void): () => void;
      /** 主→渲染窗：定向 trace 白名单变更通知。 */
      onTraceFilter(cb: (ops: number[]) => void): () => void;
      /** 主→渲染窗：控制窗点了「作为桩函数跳过」→ 携带要跳过的 opcode。 */
      onControlSkipOp(cb: (opcode: number) => void): () => void;
      /** 渲染窗→主：上报状态，供主进程转发给控制窗。 */
      sendRendererStatus(s: ControlStatus): void;
      /** 渲染窗→主：把一条**结构化 trace**（JSON 行）追加到 `.tmp/scene-trace.jsonl`。 */
      appendTraceLine(line: string): void;
    };
  }
}

/** 清单条目（opcode + 助记符）。 */
export interface OpcodeStat {
  opcode: number;
  name: string;
}

/** 已被用户当作桩函数跳过的 opcode（含被执行次数）。 */
export interface SkippedEntry extends OpcodeStat {
  count: number;
}

/** ★闸门 B：被当作 no-op 跳过、却收到了**非平凡实参**的 opcode。 */
export interface GapEntry extends OpcodeStat {
  count: number;
  sample: string[];
  /** 它原本属于哪张表（在缺口行上标注来源）。 */
  source: 'ignored' | 'skipped';
}

/** ★闸门 A：脚本调用了宿主**没实现**的 native 方法（`?.` 静默 no-op）。 */
export interface DroppedIntentEntry {
  method: string;
  count: number;
  sample: string;
  opcodes: string[];
  why: string;
}

/**
 * **★性能/门控遥测**（回答"到底是慢还是坏"）：
 *  - `stepsPerSec`：最近一个上报窗口内的指令执行速度（VM 本身很快：实测 30–60 万步/秒）；
 *  - `gate`：当前卡在哪个门（`0x400` 动画等待 / `sleep` / `paused` 未知指令 / 空 = 正常推进）；
 *  - `gateMs`：本门已持续多久（长时间不变即可判定为"卡住"而不是"慢"）；
 *  - `jsonlLines`：本会话写出的定向 trace 行数（用于发现"日志把主进程打满"这类问题）；
 *  - `frames`：present 次数（渲染帧数）。
 */
export interface PerfTelemetry {
  stepsPerSec: number;
  gate: string;
  gateMs: number;
  jsonlLines: number;
  frames: number;
}

/** 渲染器停在一条未知指令上，等控制窗决定是否当桩跳过。 */
export interface PendingUnknown {
  opcode: number;
  name: string;
  script: string;
  byteOffset: number;
  instrIndex: number;
}

/** 渲染器上报给控制窗的状态。 */
export interface ControlStatus {
  bin: string;
  /**
   * 真·忽略：引擎内部 no-op 插桩，且**本场景没收到实参**（即"空转"）。
   * 收到实参的那些会被提到 `gaps`（闸门 B），因此这三张表互斥、不会重复列出同一条指令。
   */
  ignored: OpcodeStat[];
  /** ★闸门 B：被跳过且收到非平凡实参（最该看的一档）。 */
  gaps?: GapEntry[];
  dropped?: DroppedIntentEntry[];
  traceAll: boolean;
  /** 定向 trace 白名单（空 = 全部）；十六进制字符串，如 `0x1fb`。 */
  traceFilter?: string[];
  perf?: PerfTelemetry;
  /** 硬错误；无错误时不填。 */
  error?: string;
  pendingUnknown?: PendingUnknown;
  /** 已被用户当作桩函数跳过的 opcode（去重，含各自被执行的次数）。 */
  skipped: SkippedEntry[];
}
