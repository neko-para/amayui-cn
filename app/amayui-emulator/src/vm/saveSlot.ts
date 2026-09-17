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
} from './saveData.js';

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
  format: number;
}

/** 读头结果：`code` 与 `0x1A0` 写进 `op1` 的三态一致（0 成功 / 1 打不开 / 2 头校验失败）。 */
export type SlotHeaderRead =
  | { ok: true; code: 0; header: SlotHeader }
  | { ok: false; code: 1 | 2; reason: string };

/**
 * 解析槽头（292 B）。**逐条对齐 `sub_438120`**（raw 45106-45149）：
 * 读满 292 字节 → 魔数（`S4SD`/`S3SD` 二选一，由 `Engine+698904` 的两个字节决定）→ 引擎版本串 `strcmp`。
 * 任一步失败 ⇒ 引擎打错误串并返回 0（调用方写 `op1 = 2`）。
 */
export function parseSlotHeader(bytes: Uint8Array, engineVersion = SAVE_ENGINE_VERSION): SlotHeaderRead {
  if (bytes.length < SAVE_HEADER_BYTES) {
    return { ok: false, code: 2, reason: `文件只有 ${bytes.length} 字节（头需要 ${SAVE_HEADER_BYTES}）` };
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = readAscii(bytes, 0, 4);
  if (magic !== SAVE_MAGIC && magic !== 'S3SD') {
    return { ok: false, code: 2, reason: `魔数既不是 ${SAVE_MAGIC} 也不是 S3SD（实际「${magic}」）` };
  }
  const ver = readAscii(bytes, 4, 4);
  if (ver !== engineVersion) {
    return { ok: false, code: 2, reason: `引擎版本串不符（文件「${ver}」≠ 本 exe「${engineVersion}」）` };
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
    },
  };
}

/** 一帧的存档快照（`Frame` 的可恢复子集）。 */
export interface SlotFrameState {
  /** 统一文件 id（引擎 `frames[cur][95796]`；读档时用它重新读回脚本字节）。 */
  scriptId: number;
  name: string;
  ip: number;
  retStack: number[];
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
): { ok: true; data: SlotReadResult } | { ok: false; reason: string } {
  const headerRead = parseSlotHeader(bytes);
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

/** 头 + 2 字节 UTF-16 长度前缀的原始块（`.STH` 用；本工程只做不透明往返）。 */
export function buildSlotThumb(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length >>> 0, true);
  out.set(payload, 4);
  return out;
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
    'emulator 能直接装帧脚本 ⇒ 直接装，回调的副产物：charm/LOADCHARM 绘制管线、savemesskip 复位**不复现**）；' +
    '② 存档里的 **100 个解码图槽（ImageDB）+ 1000 条记录 + 尾部的图像重载清单**已解码但**未应用**（emulator 的纹理由脚本的 ' +
    '`set-texture`/宿主按 id 惰性解码重建）；③ 镜像里那 40 B 消息窗/字体状态（`Engine+84088`）未还原（emulator 的 msgwin 有自己的状态）。',
  '本工程槽只存**当前帧 + 栈上未结束的帧**（scriptId/name/ip/retStack）与全局池；场景（纹理/绘制项）靠脚本重跑重建。',
  '`0x19E` 的「覆盖确认框」未建模（无对话框宿主 ⇒ 直接覆盖；引擎在打不开或头不合法时会 `sub_406650(...)==7` 弹框）。',
  '`.STH` = **320×180 24bpp BMP**（`tickets/T-0036` 已解：`0x1AE`/`0x1AF` 的 `op3` 是纹理槽，写/读该槽的位图，见 `src/vm/bmp.ts`）；仍未做的是 DrawMode==1 的截图分支（`sub_4A5260`/`sub_49E9D0`，本机 DrawMode=0）。',
  '按 FileDB 名字的 `0xAA/0xAB/0xAC/0x190` 未实现（语料 0 处；需要 FileDB 名→路径）。',
];
