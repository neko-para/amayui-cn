/**
 * **存档槽链路（`SAVE%2.2d.DAT` / `SAVE%2.2d.STH`）** —— 读档/存档的格式层（`tickets/T-0018`）。
 *
 * 引擎入口（逐条读过体，raw 行号 = `engine/天结_unpacked.exe_utf8.c`）：
 *
 * | opcode | handler | 语义 | 语料 |
 * |---|---|---|---|
 * | `0x1A0` | `sub_42DC70` | **读槽头**：`CreateFileA("%s\\SAVE%2.2d.DAT", 存档目录, 槽号)` → `sub_438120` 读 292 B 头 → `op1` = 结果码（0 成功 / 1 打不开 / 2 头校验失败）、`op3..op8` = 6×u16（年/月/日/时/分/秒）、`op9` = **游玩秒数**（头 +280 的 i32） | 339 |
 * | `0x1A1` | `sub_42DDE0` | **读档（LOAD）**：同一路径开后 `sub_410160(..., a6=1, a7=1)` 还原整份状态，读完把 `pool_int` 重新 ENC（33033-33038 同型循环）⇒ `op1` = `sub_410160` 的返回码 | 335 |
 * | `0x19E` | `sub_42D980` | **存档（SAVE）**：先读头（打不开或头不合法 ⇒ 弹确认框 `sub_406650(...) == 7`），再 `CREATE_ALWAYS` 写 → `sub_40CD10` → `sub_437480`（容器写）+ `sub_40AAE0`（顺带刷新 `SAVE.DAT`） | 337 |
 * | `0x19F` | `sub_42DB10` | 读档（同 `0x1A1`，但 `a6=a7=0`：不还原字体/额外块）后同样重 ENC | 0 |
 * | `0x190`/`0xAB`/`0xAA`/`0xAC` | `sub_42D830`/`sub_42D650`/`sub_42D580`/`sub_42D700` | 按 **FileDB 名字**（`sub_454FA0(FileDB, id)`）的读档 / 读头 / 存档（emulator 未建模 FileDB 名字 ⇒ 未实现，语料 0 处） | 0 |
 * | `0x1AB` | `sub_42DFC0` | **删槽**：删 `.DAT` + `.STH`（`op1`：0 都成功 / 1 `.DAT` 失败 / 2 `.STH` 失败） | 1 |
 * | `0x1AC` | `sub_42E0A0` | **复制槽**（`op2` → `op3`，两个文件都复制；返回码同 `0x1AB` 的形状） | 2 |
 * | `0x1AE` | `sub_42E1F0` | **写 `.STH`**：`sub_43BF20(Engine+1978, op3, 块)` 写 / `sub_4A5260(Scene, 名, op3)` 截图分支 | 337 |
 * | `0x1AF` | `sub_42E320` | **读 `.STH`**：`sub_40BF20(Engine+1978, op3, -1, 文件, 大小)` | 1 |
 *
 * ★**0x1A1 是读档而不是存档**（`tickets/T-0018` 的订正）：它 `CreateFileA(..., 0x80000000 = GENERIC_READ,
 * …, OPEN_EXISTING)`，且 `sub_410160` 体内只调**容器读** `sub_437980`（写侧是 `sub_40CD10` 里的 `sub_437480`）；
 * 语料侧铁证 = `src/SG0012.txt:576` 的 `comment "savemesskip q-load"` 紧接 `:579 i1a1 …`。
 * （旧文档把 `0x1A1` 记成"存档到槽位"，见本票 changes.md。）
 *
 * ## 头部契约（292 字节，与真存档同形 —— E4 实测）
 *
 * 用本机真存档 47 个 `SAVE??.DAT` 验证：`+264/266/270/272/274/276` 六个 u16 = **年/月/日/时/分/秒**
 * （注意 **跳过 `+268` 的星期**：`sub_42DC70` 读的是 `ebp-0x220/-0x21E/-0x21A/-0x218/-0x216/-0x214`
 * ⇒ 偏移依次为 264、266、270、272、274、276），`+280` 的 i32 = **游玩秒数**（SAVE00 = 15899 → SAVE48 = 148772，
 * 随存档时间单调递增；`SAVE90` 新开档 = 1055）。
 *
 * ## 本工程的槽文件布局
 *
 * 复用 `saveData.ts` 的容器（`format = 0` = 本工程明文格式 ⇒ 与引擎的 1..3 互不误读），
 * payload = 「已使用文件」块 + 两张表 + **可选尾块**（`SaveDataDecoded.trailing`）= 本模块的
 * `SlotStateBlock`（JSON，见下）。⇒ 引擎写的真槽也能被**读**：`format = 3` 的状态主体由
 * `src/vm/engineSlot.ts` 解析（帧记录 + 三个池 + 三张 ip 表 ⇒ 能真的续跑，见 `tickets/T-0059`），
 * `format = 1/2` 的旧布局仍只读头（缺口见 `SLOT_GAPS`）。
 */
import {
  SAVE_BLOCK_BYTES,
  SAVE_ENGINE_VERSION,
  SAVE_FORMAT_PLAIN,
  SAVE_HEADER_BYTES,
  SAVE_MAGIC,
  decodeSaveData,
  encodeSaveData,
  type SaveDataTables,
  type SaveDataUsage,
} from '../save/saveData.js';

/** 存档目录（真游戏 = `%LOCALAPPDATA%\Eushully\<game>\SAVE`，overlay 与之结构镜像）。 */
export const SLOT_DIR = 'SAVE';
/** `.STH` 状态块（引擎把 `Engine+1978` 那个容器的内容序列化进去；本工程只做不透明往返）。 */
export const SLOT_THUMB_EXT = 'STH';
/** 本工程槽状态块的魔数前缀（JSON 头）。 */
export const SLOT_STATE_MAGIC = 'AMYS1\n';

/** `SAVE%2.2d.DAT` 的相对路径（相对系统存档目录；`%2.2d` = 至少两位、空格补齐 —— 引擎同款格式串）。 */
export function slotRelPath(slot: number): string {
  return `${SLOT_DIR}/SAVE${pad2(slot)}.DAT`;
}

/** `SAVE%2.2d.STH` 的相对路径。 */
export function slotThumbRelPath(slot: number): string {
  return `${SLOT_DIR}/SAVE${pad2(slot)}.${SLOT_THUMB_EXT}`;
}

/**
 * 引擎的 `%2.2d`：宽度 2、**精度 2** ⇒ 至少两位、不足**补 0**（MSVC 的整数精度语义）。
 * E4：真存档槽就是 `SAVE00.DAT`/`SAVE07.DAT`（不是空格补齐）。
 */
function pad2(slot: number): string {
  return String(Math.trunc(slot)).padStart(2, '0');
}

/** 读定长 ASCII（引擎这些字段都是定长、NUL 补齐）。 */
function readAscii(bytes: Uint8Array, at: number, max: number): string {
  let s = '';
  for (let i = 0; i < max; i++) {
    const b = bytes[at + i]!;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

/** 槽头（`0x1A0` 能取到的全部字段）。 */
export interface SlotHeader {
  magic: string;
  engineVersion: string;
  title: string;
  year: number;
  month: number;
  /** 日（头 +270；`+268` 是星期，`0x1A0` 不取）。 */
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** **游玩秒数**（头 +280 i32；E4：随存档时间单调递增）。 */
  playSeconds: number;
  /**
   * 头 +284（引擎写侧的 `a4` = **`set:SaveVersion1`**）：本工程写 `SAVE_FORMAT_PLAIN = 0`，
   * 真槽写 1/2/3 ⇒ 这个字段同时是"容器载荷的变换口径"与"**存档版本号**"
   * （`0xAE` 按它选帧记录的槽位组，见 `EngineSlotResume.sv1`）。
   */
  format: number;
  /**
   * 头 +288（引擎写侧的 `a8` = **`set:SaveVersion2`**）：本工程写 0，真槽实测 0/10/20。
   * 与 `format` 一起决定读档走栈的槽位组（`sv1 == 1` 时还要 `sv2 == 20`）。
   */
  aux: number;
}

/** 读头结果：`code` 与 `0x1A0` 写进 `op1` 的三态一致（0 成功 / 1 打不开 / 2 头校验失败）。 */
export type SlotHeaderRead =
  | { ok: true; code: 0; header: SlotHeader }
  | { ok: false; code: 1 | 2; reason: string };

/**
 * `parseSlotHeader` 的**判据来源**（每一项都可注入 —— 引擎里这三项各来自不同的地方）。
 *
 * ★哪一条是引擎的、哪一条是本工程的（2026-09 按体复核，`T-0159`）：
 *  - `sub_438120`（raw 45106-45149）只做三件事：① `ReadFile(...,0x124)` 且 `NumberOfBytesRead == 292`；
 *    ② `Buffer[0] == *(DWORD*)Destination`（魔数 = `S4SD` 或 `S3SD`，由 `strncmp(Str1, Engine+698904, 2)`
 *    二选一 ⇒ **该 exe 只认一个**）；③ `strcmp((char*)&Buffer[2], a4)` —— `&Buffer[2]` 是**字节 +8**
 *    （`Buffer` 是 `int[]`）、`a4` = `Engine+698912` = **游戏名**（raw 23745 用配置键
 *    `aSetGamename`（raw 4242，键名字面量见下）灌进那一格）。
 *  - ⇒ 引擎**没有**"头 +4 的版本串"这一项判据；本工程从 `T-0018` 起就在比它（真槽 E4 实测 = `460B`），
 *    这是**本工程更严的额外判据**，保留但必须如实标注（换 exe 时在这里注入，别当引擎事实）。
 *  - ⇒ `gameName` 这一项**当前没有生产注入点**：要注入就得先有 `Engine+698912` 的模型 —— 也就是把那个
 *    配置键加进 `configRegistry.ts` 的权威键表（该文件不在 `T-0159` 的写范围内，已登记为待应用项，
 *    见 `tickets/T-0159/changes-slots.md`）。★**不许**在 `src/**` 里手打这个键名：`test/config-keys.test.ts`
 *    会把"不在权威键表里的配置键字面量"判红（`T-0057` R1）。
 */
export interface SlotHeaderCriteria {
  /** 本 exe 的魔数（默认 `S4SD`；引擎按 `Engine+698904` 的前 2 字符二选一）。 */
  magic?: string;
  /**
   * 是否容忍旧魔数 `S3SD`（默认 **true** = 历史容忍）。
   * 引擎在**本 exe** 上只会选中一个魔数（真槽 47 个全是 `S4SD`）⇒ 这是本工程放宽的一格，登记在 `SLOT_GAPS`。
   */
  acceptLegacyMagic?: boolean;
  /** 头 +4 的 4 字节（**本工程的额外判据**，引擎不比它）。 */
  engineVersion?: string;
  /**
   * 引擎真正的检查：头 +8 的 0xE8 字节**游戏名**（= `Engine+698912`，来自 `set:` 段的 GameName 键）。
   * ★不给 ⇒ 跳过（生产调用点当前不注入：那个键还没进权威键表 ⇒ 见 `SLOT_GAPS`）；
   * 给了就必须逐字一致，否则 code 2（引擎会打「このゲームのセーブデータではありません」）。
   */
  gameName?: string;
}

/**
 * 解析槽头（292 B）。**逐条对齐 `sub_438120`**（raw 45106-45149）：
 * 读满 292 字节（定长 `ReadFile` + `== 292`）→ 魔数（该 exe 选中的那一个）→ **+8 游戏名 `strcmp`**。
 * 任一步失败 ⇒ 引擎打错误串并返回 0（调用方写 `op1 = 2`）。
 * 另有本工程的额外判据 `+4` 版本串（可注入，见 `SlotHeaderCriteria`）。
 */
export function parseSlotHeader(bytes: Uint8Array, criteria: SlotHeaderCriteria = {}): SlotHeaderRead {
  const engineVersion = criteria.engineVersion ?? SAVE_ENGINE_VERSION;
  const magicWanted = criteria.magic ?? SAVE_MAGIC;
  const acceptLegacy = criteria.acceptLegacyMagic ?? true;
  if (bytes.length < SAVE_HEADER_BYTES) {
    return { ok: false, code: 2, reason: `文件只有 ${bytes.length} 字节（头需要 ${SAVE_HEADER_BYTES}）` };
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = readAscii(bytes, 0, 4);
  if (magic !== magicWanted && !(acceptLegacy && magic === 'S3SD')) {
    return {
      ok: false,
      code: 2,
      reason: acceptLegacy
        ? `魔数既不是 ${magicWanted} 也不是 S3SD（实际「${magic}」）`
        : `魔数不是 ${magicWanted}（实际「${magic}」；引擎在该 exe 上只认这一个）`,
    };
  }
  const ver = readAscii(bytes, 4, 4);
  if (ver !== engineVersion) {
    return {
      ok: false,
      code: 2,
      reason: `引擎版本串不符（文件「${ver}」≠ 本 exe「${engineVersion}」；★本工程额外判据，引擎 raw 45117-45127 不比 +4）`,
    };
  }
  // ★引擎的真判据（raw 45123）：+8 的 0xE8 字节游戏名 == `Engine+698912`（`set:GameName`）。
  if (criteria.gameName !== undefined) {
    const name = readAscii(bytes, 8, 0xe8);
    if (name !== criteria.gameName) {
      return {
        ok: false,
        code: 2,
        reason: `游戏名不符（文件「${name}」≠ set:GameName「${criteria.gameName}」；引擎 raw 45123 的 strcmp）`,
      };
    }
  }
  return {
    ok: true,
    code: 0,
    header: {
      magic,
      engineVersion: ver,
      title: readAscii(bytes, 8, 0xe8),
      year: dv.getUint16(264, true),
      month: dv.getUint16(266, true),
      day: dv.getUint16(270, true),
      hour: dv.getUint16(272, true),
      minute: dv.getUint16(274, true),
      second: dv.getUint16(276, true),
      playSeconds: dv.getInt32(280, true),
      format: dv.getUint32(284, true),
      aux: dv.getUint32(288, true),
    },
  };
}

/** 一帧的存档快照（`Frame` 的可恢复子集）。 */
export interface SlotFrameState {
  /**
   * **帧号**（`frames[]` 的下标）。
   *
   * 为什么要存它（`tickets/T-0061`）：引擎的帧记录是**按帧号铺的**（镜像里 `+21252+1044*k` 就是第 k 帧），
   * 读侧 `sub_40F750` 也按帧号装载 ⇒ 帧号必须原样带过来。旧实现只写"有脚本的帧"、读侧按数组序归位
   * ⇒ 一旦中间有空帧就会整体错位（写进另一个帧槽）。
   * 老槽（本字段出现之前写的）没有它 ⇒ 读侧退化为"按数组序"（见 `loadSlotIntoEngine`）。
   */
  index?: number;
  /** 统一文件 id（引擎 `frames[cur][95796]`；读档时用它重新读回脚本字节）。 */
  scriptId: number;
  name: string;
  ip: number;
  retStack: number[];
  /**
   * **返回帧号**（引擎帧记录的 `[0]` = `frames[cur][95795]`）：该帧 `exit`(0x2) 时回到哪一帧（-1 = 无）。
   * 不存它 ⇒ 续跑后的 `exit` 会退回**当前实例里那一格碰巧留下的值**（跨实例读档几乎必错）。
   */
  caller?: number;
  /**
   * **本帧最后一次 `0x71`（开始消息）的指令下标**（`tickets/T-0063`）。
   * 读档时作为**末帧**的落点 ⇒ 重放存档当时那句话；`undefined`/`-1` ⇒ 退回 `ip`。
   */
  lastMsgIp?: number;
}

/**
 * **本工程槽状态块**（写在容器 payload 的尾块里；`SAVE.DAT` 不含它）。
 *
 * 为什么用 JSON：这是我们自己的格式（容器已经是 `format = 0` 私有口径），JSON 便于演进与人工核对，
 * 且与字符串表已经是 UTF-8 的既定取舍一致。**引擎不会读它**（真槽没有这一段）⇒ 不影响互操作方向。
 */
export interface SlotStateBlock {
  /** DEC/ENC key（引擎启动时随机化；读档后要一致才能正确解码池）。 */
  key: number;
  cur: number;
  /** 只有 `script != null` 的帧会被写进来。 */
  frames: SlotFrameState[];
  globals: {
    int: [number, number][];
    float: [number, number][];
    str: [number, string][];
  };
  /** 游玩秒数（与头 +280 同一个值；引擎那份在还原时也会带上）。 */
  playSeconds: number;
  /**
   * **纹理槽绑定记录**（槽号 → 统一文件 id；引擎 `_this[81174]` 那两张 1000×2 组 5 dword 表里的一格）。
   * 读档时按它 `bindTexture` 让宿主重新取图（引擎也是按存档里的记录 `sub_4559C0`+`sub_4A3800` 重装的）。
   */
  texSlots?: [number, number][];
  /**
   * **场景呈现态快照**（绘制项/网格/消息窗文本/槽模式…；见 `renderer/scene/present.ts`）。
   *
   * 为什么必须存（`tickets/T-0063`）：ADV 场景的背景/立绘是**一次性**画出来的，而读档续跑会从各帧的
   * 入口跑到各自的 `i0ae` 就跳过去（`NOVEL.BIN` 在指令 43 画背景、落点却是 124）⇒ 只还原帧栈/池的话
   * 读档后画面上什么都没有（GUI 留帧 ⇒ 玩家看到"回到标题界面"）。引擎的等价物 = 存档里的绘制记录。
   */
  present?: unknown;
  /**
   * **ADV/场景的 VM 侧状态**（热点区/消息窗标量态/文本项账本/阶梯动画表/引擎字段；
   * 见 `src/vm/advState.ts`）。引擎读档时也会把这些搬回去（`sub_410160` 装载段 + `sub_45F1B0`）。
   *
   * ★是 `unknown` 而不是 import VM 的类型：本层是**不透明载荷的搬运工**，形状由 VM 侧定义 ——
   * 存档格式层依赖 VM 正是 `tickets/T-0021` 要消的 A1 分层违规（`import type` 也会把依赖方向写成
   * save → vm）。解包方在交给 `restoreAdvState` 时按 `AdvStateJson` 断言（见 `vm/handlers/save-slot.ts`）。
   */
  adv?: unknown;
}

/** 把状态块编成尾块字节（`SLOT_STATE_MAGIC` + JSON）。 */
export function encodeSlotState(state: SlotStateBlock): Uint8Array {
  return new TextEncoder().encode(SLOT_STATE_MAGIC + JSON.stringify(state));
}

/** 解析尾块；不是本工程的块（或没有）⇒ null。 */
export function decodeSlotState(trailing: Uint8Array | undefined): SlotStateBlock | null {
  if (!trailing || trailing.length <= SLOT_STATE_MAGIC.length) return null;
  const text = new TextDecoder().decode(trailing);
  if (!text.startsWith(SLOT_STATE_MAGIC)) return null;
  try {
    const obj = JSON.parse(text.slice(SLOT_STATE_MAGIC.length)) as SlotStateBlock;
    if (!Array.isArray(obj.frames) || !obj.globals) return null;
    return obj;
  } catch {
    return null;
  }
}

/** 组一个槽文件（本工程格式：容器 + 尾块状态）。 */
export function buildSlotFile(input: {
  tables: SaveDataTables;
  usedFileIds: Iterable<number>;
  state: SlotStateBlock;
  title?: string;
  now?: Date;
}): Uint8Array {
  const now = input.now ?? new Date();
  return encodeSaveData({
    tables: input.tables,
    usedFileIds: input.usedFileIds,
    ...(input.title !== undefined ? { title: input.title } : {}),
    now,
    stamp: input.state.playSeconds,
    trailing: encodeSlotState(input.state),
  });
}

/** 一个槽被读出来的全部内容。 */
export interface SlotReadResult {
  header: SlotHeader;
  /** 两张表（**只有本工程格式的槽**才有；引擎槽的两张表在 `SAVE.DAT` 里，槽自己那份是池，见 `SLOT_GAPS`）。 */
  tables: SaveDataTables;
  usage: SaveDataUsage;
  /** 本工程状态块（真游戏槽里没有 ⇒ null：真槽的状态主体由 `engineSlot.ts` 走另一条路，见 `SLOT_GAPS`）。 */
  state: SlotStateBlock | null;
  /** `true` = 这是**引擎写**的槽（format 1..3）：本模块不解析它的 payload（交给 `engineSlot.ts`）。 */
  engineFormat: boolean;
}

/**
 * 读一个槽文件的全部内容。
 *
 * ★**引擎格式（format 1..3）的槽在这里只读头**：真槽的 payload 是引擎自己的状态主体（帧镜像 + 池 + ip 表），
 * 两张表在其中的偏移与 `SAVE.DAT` 不同（`SAVE.DAT` 的 payload 是"标志块 + 两张表"，槽不是）
 * ⇒ 直接套 `decodeSaveData` 会解错（E4 实测：`SAVE00.DAT` 报"字符串记录越界"）。
 * 状态主体由 `src/vm/engineSlot.ts` 按 `sub_410160`/`sub_40CD10` 的 `a4 == 3` 布局解析
 * （`tickets/T-0059`；`format = 1/2` 的旧布局仍未解析 ⇒ 见 `SLOT_GAPS`）。
 */
export function parseSlotFile(
  bytes: Uint8Array,
  criteria: SlotHeaderCriteria = {},
): { ok: true; data: SlotReadResult } | { ok: false; reason: string } {
  const headerRead = parseSlotHeader(bytes, criteria);
  if (!headerRead.ok) return { ok: false, reason: headerRead.reason };
  const header = headerRead.header;
  if (header.format !== SAVE_FORMAT_PLAIN) {
    return {
      ok: true,
      data: {
        header,
        tables: { ints: new Map(), strings: new Map() },
        usage: { usedFileIds: new Set(), layout: 'engine-new' },
        state: null,
        engineFormat: true,
      },
    };
  }
  const decoded = decodeSaveData(bytes);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  return {
    ok: true,
    data: {
      header,
      tables: decoded.data.tables,
      usage: decoded.data.usage,
      state: decodeSlotState(decoded.data.trailing),
      engineFormat: false,
    },
  };
}

/**
 * 本工程 T-0018 时期写进 `.STH` 的自造块前缀（**引擎读不回来** ⇒ 写侧已按体废弃，见 `SLOT_GAPS`）。
 *
 * ★`buildSlotThumb()`（4 字节长度前缀 + 载荷的**写**侧构造器）随写侧一起删了（`tickets/T-0159`）：
 * 引擎在同一格的产物是"**0 字节**文件 + `op1 = 2`"，没有第二种合法块 ⇒ 留着无人调用的构造器
 * 只会让人以为还能写。这一半只保留**读**（`isLegacySlotThumb`）。
 */
export const SLOT_THUMB_LEGACY_MAGIC = 'AMYTH1\n';

/**
 * 认不认得出**旧版自造 `.STH` 块**（4 字节小端长度前缀 + `AMYTH1\n{...}` 载荷）。
 *
 * ★为什么只留"读"这一半（`tickets/T-0159`，P3 `0x1ae` host-invented）：引擎在**同一情形**下
 * （`op3` 槽没有创建）返回 **2** 并把 `.STH` 停在 **0 字节**（`CreateFileA` 已建、两条写路都不写，
 * raw 38532-38546）⇒ 写侧已改成"0 字节 + op1 = 2"，不再产出这种块。但**玩家机器上已有的**
 * （本工程旧版本写的）`.STH` 仍然要能读回来 ⇒ 读侧保留这一格，并把口径收窄到"前缀 + 魔数都对"。
 */
export function isLegacySlotThumb(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const n = (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
  if (n === 0 || 4 + n > bytes.length) return false;
  const magic = SLOT_THUMB_LEGACY_MAGIC;
  if (n < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[4 + i] !== magic.charCodeAt(i)) return false;
  return true;
}

/** 读 `0x1A0` 头的 292 字节是否够（`CopyFile` 之类的判据用）。 */
export function hasSlotHeader(bytes: Uint8Array | null): boolean {
  return bytes !== null && bytes.length >= SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES;
}

/** `SLOT_GAPS`：本票已知但未做的部分（读档链路的诚实边界，勿当成保证）。 */
export const SLOT_GAPS: readonly string[] = [
  '真游戏槽的 `format = 3`（SaveVersion1=3）**已解析并可续跑**：帧记录（脚本 id / 返回栈 / 消息点下标 / call-script 下标）、' +
    'int/float/string 三个池、三张全局 ip 表、100 个解码图槽、1000 条 20 B 记录都解得出来（`src/vm/engineSlot.ts`，' +
    '两个内层 CRC 都校验；本机 47 个真槽全过）。★**`format = 1/2` 的旧布局仍未解析**（引擎 `sub_410160` 的 a4=1/2 段：' +
    '263 步长 / 1052 字节帧头等各不相同）⇒ 那些槽退回"重载根脚本"。',
  '★**续跑已实现**（`tickets/T-0059`）：`0x1A1` 解出状态主体 → 还原池 + 帧记录 + 装载记录 0 的脚本（`cur = 0`）→ ' +
    '脚本入口的 `i0ae`（`0xAE`）按记录逐帧落 ip/装脚本，直到 `cur == savedCur` 收尾。仍未做的：' +
    '① **跳过 `CALLBACK_LOAD.BIN` 那一跳**（引擎把回调装进帧 0、靠它 `exit` 时的 `frames[0][95795] == -11` 再 `sub_40F750(3)` 装记录 0 的脚本；' +
    'emulator 能直接装帧脚本 ⇒ 直接装。★回调的副产物里**只有 BGM 重播（`CALLBACK_LOAD.txt:20` 的 `i0b7 0`）已被显式补上**' +
    '（`handlers/save-slot.ts` 的 `replaySavedBgm`，`tickets/T-0064`）；charm/LOADCHARM 绘制管线、savemesskip 复位、10 个 SE 通道重装**仍不复现**）；' +
    '② 存档里的 **100 个解码图槽（ImageDB）+ 1000 条记录 + 尾部的图像重载清单**已解码但**未应用**（emulator 的纹理由脚本的 ' +
    '`set-texture`/宿主按 id 惰性解码重建）；③ 镜像里那 40 B 消息窗/字体状态（`Engine+84088`）未还原（emulator 的 msgwin 有自己的状态）。',
  '本工程槽只存**当前帧 + 栈上未结束的帧**（scriptId/name/ip/retStack）与全局池；场景（纹理/绘制项）靠脚本重跑重建。',
  '`0x19E` 的「覆盖确认框」：**已建模但宿主侧还没有对话框**（`tickets/T-0159`）。引擎在「`op3` 槽的 `.DAT` **只读打开成功**（= 文件存在）' +
    '**且**头读不出合法 292 B」时才弹 `MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2`（`sub_406650(...) == 0x34`，raw 38309-38310），' +
    '玩家选「否」（`IDNO = 7`）⇒ `CloseHandle` + `op1 = 1`、**原文件不动**（raw 38312-38313）。★文件**不存在**时那条 `if` 根本不进' +
    '（只读 `CreateFileA` 带 `0x8000000` ⇒ 不存在即 `INVALID_HANDLE_VALUE`）⇒ 不存在也会弹框是**错的**读法。' +
    'emulator：`saveSlotFromEngine` 已按此判据调用**可选宿主缝** `NativeBridge.confirmSlotOverwrite?(slot)`（返回 `false` = 玩家点了否）；' +
    '★**宿主缝尚未进桥**（`src/vm/native.ts` + `nativeTap.ts` 的 `BRIDGE_METHODS` 由 `T-0153` 侧所有）⇒ 当前两个真宿主都不实现它，' +
    '行为 = **恒按「玩家点了是」覆盖**（这条缺口仍在）。守卫：`test/save-slot-engine-codes.test.ts`。',
  '`0x19E` 写失败时的**错误提示通道**未建模（`tickets/T-0159`）：引擎在写侧 `CreateFileA` 失败时先 `sub_40A4C0(_this, hwnd, aE, 5)`' +
    '（`aE` = 「セーブデータの保存に失敗しました。…」raw 4331）**再** `op1 = 1`（raw 38318-38322）。emulator 的 `op1` 已对齐为 **1**' +
    '（含宿主抛异常那条路），并调用可选缝 `NativeBridge.slotWriteFailed?(slot, message)`；该缝同样**尚未进桥** ⇒ 两个真宿主当前' +
    '只在日志里留一行（玩家看不到弹框）。',
  '`0x19F`/`0x1A1` 的 `op1` 码域按体对齐为 **{1, -1, 0}**（`tickets/T-0159`，P2）：`1` = `CreateFileA` 失败（raw 38351-38352）；' +
    '`-1` = **仅当** `set:SaveVersion1 ∈ {2,3}` 且 292 B 头读不出（`sub_410160` raw 19411-19412，全函数**唯一**的 `return -1`）；' +
    '其余（**含容器读 `sub_437980` 失败**）都是主出口 `return 0`（raw 19930-19932）⇒ 旧实现自造的 `2` 已删除。' +
    '★「一条帧都没装载也照样 0」是引擎行为（a4∈{1,2,3} 之外时从 raw 19430 起是空循环）⇒ **不许**用 `op1` 判"装载完整性"。',
  '`0x1AE`/`0x1AF` 的 `op3` 是**纹理槽**：`.STH` = **320×180 24bpp BMP**（`tickets/T-0036` 已解：`0x1AE`/`0x1AF` 的 `op3` 是纹理槽，写/读该槽的位图，见 `src/vm/bmp.ts`）；' +
    '·**槽没有像素时** `0x1AE` 按体返回 **2** 且 `.STH` 留 **0 字节**（`T-0159`，旧的 `AMYTH1` 自造块已废弃）；' +
    '·`0x1AF` 读到 **0 字节**的 `.STH` ⇒ **2**（打开成功、读入失败），文件不存在 ⇒ 1；' +
    '·仍未做的：DrawMode==1 的截图分支（`sub_4A5260`/`sub_49E9D0`，本机 DrawMode=0）与 D3D 读侧的**第二格式**（`BM` 魔数不符时按 `+8 ∈ {1,2} && +12 == 0` 解入，raw 119663-119676）。',
  '头 +4 的**版本串**是**本工程**的额外判据（`tickets/T-0159`，P3 `0x1a0`）：引擎 `sub_438120` 只比 `+0` 魔数与 **`+8` 游戏名**' +
    '（raw 45117-45127；`&Buffer[2]` 是 `int[]` 的字节 +8，`a4` = `Engine+698912` ← `set:GameName` raw 23745）。' +
    '⇒ ① emulator 比 `+4`（真槽 E4 = `460B`）比引擎**严**，换 exe 时用 `parseSlotHeader(bytes, { engineVersion })` 注入；' +
    '② 引擎真正的游戏名判据已实现（`{ gameName }`），但 `set:GameName` 未进 `configRegistry` ⇒ 调用点**暂不注入**（不启用该项）；' +
    '③ 魔数容忍 `S3SD`：引擎在该 exe 上只认一个（真槽 47 个全 `S4SD`）⇒ `{ acceptLegacyMagic: false }` 可关。',
  '`0x1AC` 的两份是**两次独立**的 `CopyFileA`（`tickets/T-0159`，P2）：引擎 `.DAT` 失败不影响 `.STH` 那次（raw 38505/38510）⇒' +
    '「源槽只有 `.STH`」时真机仍会复制 `.STH`、`op1 = 1`。emulator 的 handler 映射已与体一致（`sth ? (dat ? 0 : 1) : 2`），' +
    '但宿主实现 `NodeFileSource.copySaveSlot` 目前**只在 `dat` 为真时才写 `.STH`** ⇒ 那一格会漏复制（该文件在 `T-0153` 的所有权里，' +
    '已登记为待应用，见 `tickets/T-0159/changes-slots.md`）。',
  '按 FileDB 名字的 `0xAA/0xAB/0xAC/0x190` 未实现（语料 0 处；需要 FileDB 名→路径）。',
  '★**装载点"上一屏那一层 UI 消失"是近似**（`tickets/T-0083` 的 (B) 步）。引擎在装载段复位两个**仮想ディスプレイ**' +
    '对象（raw 19913-19915 `sub_403EF0`；体 raw 9958-9971 = `_this[258] = 0` 项数清零 + 游标/矩形复位）⇒ 那一层整体不再组成；' +
    '同时它**不整批清绘制容器**（27 个 callee 里没有 `sub_4AB7A0`/`sub_41A130`/`sub_40BF80`），上一屏的绘制项保留下来、' +
    '因为槽表与纹理对象刚按存档重建 ⇒ 那些项当场指向存档里的图像。emulator 是单一扁平绘制表、没有"平面"对象 ⇒ ' +
    '用 `Item.ownerFrame`（"这一项是哪一帧画的"）近似那一层：装载点只丢掉**被放弃的调用方帧**画的项。' +
    '真正的修法是补平面/离屏（render-to-texture）合成模型；实测与判据见 `tickets/T-0083` 与 `test/slot-load-screen.test.ts`。',
];
