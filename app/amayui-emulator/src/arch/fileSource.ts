/**
 * 文件访问抽象（异步代理）。
 * 约束：VM 侧一切文件操作都必须经此接口 —— 宿主跑 Node 时用 NodeFileSource（直接 fs）；
 * 将来 VM 跑在 Electron renderer 时换成 IpcFileSource（本地文件访问走 IPC 到主进程），
 * 接口不变，VM 代码零改动。这是 ADR「跨平台 + 可观测」的关键隔离点。
 */

export interface ScriptBytes {
  index: number;
  /** 文件名（如 'SYSTEM4.BIN'） */
  name: string;
  /** 原始 BIN 字节 */
  data: Uint8Array;
}

/**
 * **扩展包缺失**（访问阶段）：引擎 `sub_4559C0`（raw 67816-67823）在 `FileDB.packs[包号]` 为 NULL 时
 * 抛 `Command_ShowMessage`（异常码 65543）「拡張ファイル情報ファイル %d は読み込まれていません．」——
 * 是**可见报错**，与激活阶段（`i143` 遇到空槽静默跳过）相反。宿主据此把这个差别保住：
 * 调用方要么让错误冒到用户可见处，要么显式 catch 并降级（不要默认当"没有这个文件"）。
 */
export class MissingAppendPackError extends Error {
  constructor(
    /** 缺失的包号（统一 id 的高字节，1..255）。 */
    public readonly packNumber: number,
    /** 触发访问的统一 id（0x…）。 */
    public readonly fileId: number,
  ) {
    // 措辞照抄引擎，便于与真机日志对照
    super(`拡張ファイル情報ファイル ${packNumber} は読み込まれていません．(id=0x${fileId.toString(16)})`);
    this.name = 'MissingAppendPackError';
  }
}

export interface FileSource {
  /** 读整个文件字节（任意路径）。 */
  readFile(path: string): Promise<Uint8Array>;  /**
   * 按"call-script 索引"取回一个脚本（含文件名）。
   * index 高字节 0 -> SYS4INI base；高字节 n -> APPENDnn（低 24 位 = 包内编号）。
   * 返回 null 表示无法解析/读不到；**扩展包缺失时抛 `MissingAppendPackError`**（引擎语义）。
   */
  readScript(index: number): Promise<ScriptBytes | null>;
  /**
   * **已装载的扩展包包号（升序）**，= 引擎 `FileDB.packs` 的非空槽（`sub_455750` 按 AAI 头 @264 注册）。
   *
   * 调用方是 `0x143`（`i143`，见 `src/vm/handlers/control.ts` 的 `op_dispatch_script_requests`）：
   * 引擎遍历槽 1..255、对每个非空槽派发 `slot<<24`（= 该包的 `$n$AUTORUN.BIN`）。
   * **不实现该方法 = 当作"一个扩展包都没装"** —— 与引擎在目录里找不到 `*.AAI` 时的行为一致（静默跳过）。
   */
  appendPackNumbers?(): Promise<number[]>;

  /**
   * **把整份 `SYS4REG.INI` 文本写回宿主自己的配置路径**（可选）。
   *
   * 调用方是 `Engine.onConfigChanged`（脚本用 `SetConfig` 族改了配置）。
   * VM 只负责"什么时候该存 + 存什么文本"（`engineConfig.formatIni`），
   * 写到哪里由宿主决定：Node 直写 `app/amayui-emulator/SYS4REG.INI`；Electron 经 IPC 交主进程。
   * **不实现该方法 = 改了内存里的配置但不落盘**（测试/链路工具即如此）。
   */
  saveConfig?(text: string): Promise<void> | void;
  /** 读 `SAVE.DAT` 原始字节（没有该文件返回 null）。 */
  readSaveData?(): Promise<Uint8Array | null>;
  /**
   * 读**「已使用文件」标志**（`SAVE.DAT` 里的鉴赏/解锁块；返回统一文件 id 数组）。
   *
   * 与 `readSaveData` 分开的理由：那份只取"优先级最高的文件"（overlay → base），而标志是**单调集合**，
   * 实现应当把两侧并起来（见 `NodeFileSource.readSaveFlags`）⇒ 不因 overlay 里的旧副本而丢玩家进度。
   * 不实现 = 只用 `readSaveData` 那一份里的标志。
   */
  readSaveFlags?(): Promise<number[] | null>;
  /**
   * 读**两侧** `SAVE.DAT` 的原始字节（overlay 在前、base 在后；缺的那侧不出现）—— 供调用方**按 key 并表**。
   *
   * 与 `readSaveData` 分开的理由（`tickets/T-0069`）：那份只取"优先级最高的文件"，而 `SAVE.DAT` 里还有一批
   * **按槽**的记录（槽标题/状态/日期…），旧版本写的 overlay 副本会缺这些键 ⇒ 存档列表没标题、点不进读档。
   * 引擎的表是**单调增长**的（从不删键）⇒ 两侧并集与引擎语义一致。
   * 不实现 = 退回 `readSaveData` 那一份（单文件行为，与修前相同）。
   */
  readSaveDataBoth?(): Promise<Uint8Array[]>;
  /**
   * 写 `SAVE.DAT`（整份字节；由 `saveData.encodeSaveData` 序列化）。
   *
   * 调用方是 `Engine.onSaveDataChanged`（脚本 `save-int`/`save-string` 改了表）。
   * 与 `saveConfig` 同样：**不实现 = 不落盘**（测试默认如此，避免改动仓库里的存档）。
   */
  writeSaveData?(data: Uint8Array): Promise<void> | void;
  /**
   * **存档槽**（`SAVE%2.2d.DAT`；`tickets/T-0018`）：读一个槽的整份字节（overlay → base，不存在 ⇒ null）。
   *
   * 调用方 = `0x1A0`（只取前 292 B 头）与 `0x1A1`/`0x19F`（读档）；路径由 `saveSlot.slotRelPath(slot)` 给出。
   * **不实现 = 读档链路不可用**（`op1` 恒为 1 = 「打不开」）。
   */
  readSaveSlot?(slot: number): Promise<Uint8Array | null>;
  /** 写一个槽（**只写 overlay**，与 `writeSaveData` 同纪律）。调用方 = `0x19E`（存档）。 */
  writeSaveSlot?(slot: number, data: Uint8Array): Promise<void> | void;
  /** 删一个槽的 `.DAT` 与 `.STH`（`0x1AB`）。返回是否删掉了 `.DAT`（engine 的 `op1` = 0/1/2 由调用方合成）。 */
  deleteSaveSlot?(slot: number): Promise<{ dat: boolean; sth: boolean }>;
  /** 复制一个槽的两个文件（`0x1AC`）。 */
  copySaveSlot?(from: number, to: number): Promise<{ dat: boolean; sth: boolean }>;
  /** 读 `.STH`（`0x1AF`；本工程只做不透明往返）。 */
  readSlotThumb?(slot: number): Promise<Uint8Array | null>;
  /** 写 `.STH`（`0x1AE`）。 */
  writeSlotThumb?(slot: number, data: Uint8Array): Promise<void> | void;
  /**
   * **按统一文件 id 读出原始字节**（含文件名）。
   *
   * 用途：资源直读（Live2D 的 `.MOC`/`.MTN`/PNG、其它非脚本二进制）。id 口径见
   * `docs-new/03-engine/resource-loading.md` §1（`pack# << 24 | idx`）。**不实现 = 该宿主
   * 不支持按 id 直读资源**（Live2D 装载会退化为"槽保持为空 ⇒ 节点不出画"，与引擎同一条门控）。
   */
  readById?(id: number): Promise<{ name: string; data: Uint8Array } | null>;
  /** 释放资源（宿主关闭文件句柄等）。 */
  dispose?(): Promise<void>;
}
