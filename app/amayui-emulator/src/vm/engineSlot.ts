/**
 * **真游戏存档槽（`SAVE%2.2d.DAT` 的引擎格式 1..3）的状态主体解析** —— 读档续跑（`tickets/T-0059`）。
 *
 * ## 为什么需要它（背景）
 *
 * `tickets/T-0018` 把槽容器（292 B 头 + 20 B 块 + payload）与两张表解开了，但**引擎写的真槽**的 payload
 * 是引擎自己的状态主体（帧镜像 + 三个池 + 三张 ip 表 + 图像清单）⇒ 只读头，续跑不了（旧 `SLOT_GAPS` ②）。
 * 本模块把那份主体按 `sub_410160`（读）/ `sub_40CD10`（写）**逐字段**解出来，供
 * `handlers/save-slot.ts`（装载）+ `handlers/frame.ts`（`0xAE` 走帧栈）消费。
 *
 * ## 容器（与 `saveData.ts` 的 `SAVE.DAT` 同族，但槽的 payload 是被 `sub_436E90` 置乱 + LZSS 压缩的）
 *
 * ```text
 * 0..291    292 B 头（`sub_438120`：魔数 S4SD/S3SD + 版本串 + 标题 + 时间 + 游玩秒数 + format@284 + aux@288）
 * 292..311  20 B 块：{storedDwords, crcA?, crcB?, seed1, seed2}（`sub_437980`）
 * 312..     置乱流：storedDwords 个 dword（= 2×逻辑 dword）
 * ```
 *
 * 解码链（全部定位在 oracle）：
 * 1. `sub_436E90`（反置乱）：每 2 个存储 dword → 1 个逻辑 dword
 *    `out = a2 ^ (lo/a3 + (hi/a3)<<16)`，`a2 += 0x0B0B0B0B`，`a3 = (a3 + 2818) & 0xFFFF`（★`a3` 是 u16，会绕回）
 *    ⇒ **要求两个存储 dword 都能被 `a3` 整除**（否则不是这套编码）；
 * 2. 前 3 个 dword = `[解压后字节数, 同上, 压缩流字节数]`，其后是 LZSS 流（`sub_436A80` = `util/lzss.ts`）；
 * 3. 解压结果的前 2 个 dword = 两个内层 CRC（`sub_436D50` msb-first / `sub_436D00`）**覆盖其后全部 body**
 *    ⇒ 本模块两个都校验（真槽 47 个全过，见 `tickets/T-0059` 的 E4）。
 *
 * ## body（= 解压结果第 8 字节起；`a4 == 3` 那份布局）
 *
 * ```text
 * [帧镜像]  长度 = 1044 * savedCur + 22296
 *   +0            savedCur（存档时的帧号；`0xAE` 就是走栈走到它）
 *   +4            savedRet（收尾时写回 `Engine[95777]`）
 *   +8            pre8（`Engine[174713]`，语义未定；读档时原样写回 `Engine+698852`）
 *   +12..51       40 B ← `Engine+84088`（消息窗/字体状态，`qmemcpy` 0x28）
 *   +52..1251     1200 B ← `Engine+17420`（100 个「解码图槽」：每槽 3 dword = {id@+52+12k, flag@+56+12k, param@+60+12k}）
 *   +1252..21251  20000 B ← `Engine+344696`（1000 条 20 B 记录：{id, param, …}）
 *   +21252+1044k  第 k 帧记录（k = 0..savedCur；261 dword）：
 *                   [0]   returnFrame（`frames[k][95795]` = 回哪一帧；-1 = 根帧）
 *                   [1]   scriptId（`frames[k][95796]` = 统一文件 id；`sub_40ED40` 按它装载）
 *                   [2]   返回栈深度（`frames[k][97153]`）
 *                   [3..] 返回栈元素 = 返回点 **dword 偏移**（`+3` 已是"下一条"；引擎写时做过 −3 折算）
 *                   [259] `0x71` 消息表下标（= 存档时的"当前消息"；`-1` = 不是消息点）
 *                   [260] `0x3` call-script 表下标（`-1` = 不是调用点；**末帧恒 −1**，见 `sub_40CD10`）
 * [池块]     从镜像之后开始（`sub_410160` raw 19746-19790）：
 *   u32 ×6      {intsCount, floatsCount, stringsCount, ipTableA_len, ipTableB_len, ipTableC_len}
 *   ints        intsCount × u32 —— ★**文件里是明文**（`ENC` 只发生在内存侧：`fields.json` 的 DEC/ENC 口径）
 *   floats      floatsCount × f32 —— 明文（`a5 >= 20` 才有；本机 47 个真槽 aux 全是 20）
 *   u32         stringsBlobDwords（字符串区总长，含 NUL）
 *   strings     stringsCount 个 NUL 结尾串（`sub_40C210` 装进 28 B 步长的池）
 *   u32 × n     三张 ip 表：A（`0x71` 消息表）/ B（`0x3` call-script 表）/ C（`0x8F` call 表）
 * [图像清单]  `{740, count, (1 dword + 740 B) × count, 2 dword + 740 B}`（读档时按 id 重新解码图像）
 * ```
 *
 * ## 续跑怎么用（引擎侧链路，`tickets/T-0059`）
 *
 * `sub_410160` 收尾把 `Engine[383120](=95780)` 置 1（"正在读档"）、`cur = 0`、把根脚本（或
 * `CALLBACK_LOAD.BIN`）装进帧 0；之后脚本侧的 `0xAE`（`sub_4192F0`）**在每一帧**做两件事：
 * 按帧记录把该帧 ip 重算到存档位置（`0x71` 表优先 `-1` 的 `0x3` 表），再把下一帧（`sub_40F750(3)`）
 * 装载成记录里的脚本，直到 `cur == savedCur` 收尾（`loadInProgress = 0`）。
 * ⇒ 能续跑的前提 = 帧记录 + 三张表**从脚本文件**解出来（见 `script/bin.ts` 的 `ipTables`）。
 */
import { SAVE_BLOCK_BYTES, SAVE_HEADER_BYTES } from './saveData.js';
import { crc32, crc32MsbFirst } from './crc32.js';
import { unlzss } from '../util/lzss.js';
import type { ScriptBinary } from '../script/bin.js';

/** 帧记录的 dword 步长（`sub_40F750`/`sub_40CD10` 的 261）；字节 = 1044。 */
export const SLOT_FRAME_STRIDE_DWORDS = 261;
/** 帧镜像的固定前导字节数（记录从 +21252 开始；记录总数 = savedCur+1 ⇒ 镜像 = 1044*savedCur + 22296）。 */
export const SLOT_IMAGE_PRELUDE_BYTES = 21252;
/** 100 个「解码图槽」在镜像里的起点（每槽 12 B）。 */
export const SLOT_IMAGE_SLOTS_AT = 52;
/** 1000 条 20 B 记录在镜像里的起点。 */
export const SLOT_IMAGE_RECORDS_AT = 1252;

/** 一帧的存档记录（`sub_40CD10` 写 / `sub_40F750`+`0xAE` 读）。 */
export interface EngineSlotFrame {
  /** 返回帧号（记录[0] = `frames[k][95795]`；-1 = 根帧，-11 = 「装载时按存档版本初始化」哨兵）。 */
  returnFrame: number;
  /** 统一文件 id（记录[1] = `frames[k][95796]`）。 */
  scriptId: number;
  /**
   * 同脚本返回栈的**下标**（记录[3..3+depth-1]）：存的是**表 C（`0x8F` call 表）的下标**，
   * 不是 dword 偏移 —— `sub_40F750` mode 3 恢复时是 `frames[k][97193+j] = tableC[idx] + 3`
   * （raw 18942-18946）⇒ 用 `resolveSlotRetStack` 换算。
   */
  retIdx: number[];
  /** `0x71`（显示消息）表下标（记录[259]）；-1 = 该帧停的不是消息点。 */
  messageIdx: number;
  /** `0x3`（call-script）表下标（记录[260]）；-1 = 不是调用点（末帧恒 -1）。 */
  callIdx: number;
  /**
   * **直接落点**（本工程槽 `format = 0` 专用；引擎真槽没有这一格）。
   *
   * 引擎的存档记录存的是"**表下标**"（`[259]`/`[260]`），落点要拿帧里那份脚本的两张表换算；
   * 而本工程槽存的就是 emulator 的**指令下标** ⇒ 直接落这里。`0xAE` 见到它就跳过表换算
   * （也不做 `95805 = 3` 那种"前进 3 dword"——存下来的就是"该执行的那条"）。
   */
  instr?: number;
  /**
   * **直接返回栈**（本工程槽 `format = 0` 专用）：emulator 口径的"返回点 dword 偏移"数组
   * （= `Frame.retStack`，`op_call` 压的是 `指令.index + 3`）。
   *
   * 引擎真槽用的是 `retIdx`（表 C 下标，靠 `resolveSlotRetStack` 换算）；本工程槽直接存 emulator 的值
   * ⇒ 走栈装载时用它覆盖脚本装载时的空栈。
   */
  retStack?: number[];
}

/** 一个「解码图槽」（镜像 +52+12k）。 */
export interface EngineSlotImageSlot {
  /** 统一文件 id（< 0 = 空槽）。 */
  id: number;
  /** 1 = 该槽有效（`sub_410160` 只重载 flag==1 且 id>=0 的）。 */
  flag: number;
  param: number;
}

/** 一条 20 B 记录（镜像 +1252+20k）—— 引擎的**图像槽表**（`set-texture`/`0x1F9` 的槽登记 + `draw-texture` 的解析源）。 */
export interface EngineSlotRecord {
  /**
   * 该槽里那张图的统一文件 id（`sub_4A3800` 的 `[5*slot+466]`；< 0 = 空槽）。
   * ★这就是 `set-texture <imgid> <槽> <param>`（`0x1F9`，`sub_422CB0`）写进去的那一格 ——
   * 读档后脚本会用同一个槽号去 `draw-texture`，所以**必须装回 `Engine.texSlots`**（`tickets/T-0071`）。
   */
  id: number;
  /** `set-texture` 的第 3 操作数（`[5*slot+467]`）。 */
  param: number;
  /**
   * **读档时要重新解码该槽**的标志（`[5*slot+468]`，`sub_410160` raw 19877 判 `== 1` 才重载）。
   * 实证（本机 81 个真槽）：只有"场景大图"（`BG*`/`CS*`/`EV*`/`AE*` 这类 AGF）会被标记，
   * 每个槽 0–3 条；`SO0xx`（窗口 UI）不标 —— 它们由脚本自己在续跑路上重新 `set-texture`。
   */
  flag: number;
  /** `[5*slot+469]`（语义未确证；本机真槽恒 0）。 */
  unknown12: number;
  /** `[5*slot+470]`（`sub_4A3800` 写 0、其它载入/释放路径写 1；语义未确证）。 */
  unknown16: number;
}

/** 池块里被解码出来的全部内容。 */
export interface EngineSlotPayload {
  /** 存档时的帧号（镜像[0]）：`0xAE` 走栈的目标。 */
  savedCur: number;
  /** 收尾写回 `Engine[95777]` 的值（镜像[1]）。 */
  savedRet: number;
  /** 镜像[2]（`Engine[174713]`；读档时原样写回 `Engine+698852`）。 */
  pre8: number;
  /** 逐帧记录（0..savedCur）。 */
  frames: EngineSlotFrame[];
  /** int 池（**明文**；下标 = `(global-int X)` 的 X）。 */
  ints: number[];
  /** float 池（明文）。 */
  floats: number[];
  /** string 池（明文；下标 = `(global-string X)` 的 X）。 */
  strings: string[];
  /** 三张全局 ip 表（引擎 `Engine+383000/383008/383016`）。 */
  ipTableA: number[];
  ipTableB: number[];
  ipTableC: number[];
  /** 100 个解码图槽。 */
  images: EngineSlotImageSlot[];
  /** 1000 条 20 B 记录。 */
  records: EngineSlotRecord[];
  /** 图像重载清单（`{740, count, …}`）；解析失败 ⇒ null（不致命）。 */
  imageReload: { size: number; count: number; ids: number[] } | null;
}

export type EngineSlotParseResult =
  | { ok: true; payload: EngineSlotPayload }
  | { ok: false; reason: string };

function u32(dv: DataView, at: number): number {
  return dv.getUint32(at, true);
}
function i32(dv: DataView, at: number): number {
  return dv.getInt32(at, true);
}

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const SJIS_DEC = new TextDecoder('shift_jis');
const UTF16_DEC = new TextDecoder('utf-16le');

/**
 * 池里的字符串用哪种编码？引擎把**内存里那份字符串**原样写进存档 ⇒ 编码跟着**脚本资源**走：
 * 日文原版脚本是 ShiftJIS（v4 `SYS4450`）、本工程的 v5 资源是 UTF-16 文本。
 * 判据按"能严格解出就用它"层层退（与 `script/bin.ts` 的 v4/v5 之分同源，但存档里没有版本位，
 * 只能靠字节判）：UTF-8 严格 → ShiftJIS → UTF-16LE。
 */
function decodePoolString(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  // 含 NUL 的偶长串基本只能是 UTF-16（SJIS 文本不会夹 NUL）
  const hasNul = bytes.some((b) => b === 0);
  if (hasNul && bytes.length % 2 === 0) return UTF16_DEC.decode(bytes);
  try {
    return UTF8_STRICT.decode(bytes);
  } catch {
    return SJIS_DEC.decode(bytes);
  }
}

/**
 * **反置乱**（`sub_436E90`）：每 2 个存储 dword → 1 个逻辑 dword。
 *
 * ★`a3` 是 `unsigned __int16`：`a3 += 2818` 必须 **& 0xFFFF**（不绕回就解不出真槽 —— 最初的失败原因）。
 * 两个存储 dword 都必须能被 `a3` 整除，否则说明这份 payload 不是这套编码（返回 null，不猜）。
 */
export function descrambleSlotPayload(stored: Uint8Array, seed1: number, seed2: number): Uint8Array | null {
  const count = stored.length >> 2;
  const out = new Uint8Array(4 * (count >> 1));
  const dv = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
  const od = new DataView(out.buffer);
  let a2 = seed1 >>> 0;
  let a3 = seed2 & 0xffff;
  let src = 0;
  let dst = 0;
  for (let i = 0; i < count >> 1; i++) {
    if (a3 === 0) return null;
    const hi = dv.getUint32(src, true);
    const lo = dv.getUint32(src + 4, true);
    if (hi % a3 !== 0 || lo % a3 !== 0) return null;
    od.setUint32(dst, (a2 ^ (((lo / a3) >>> 0) + (((hi / a3) << 16) >>> 0))) >>> 0, true);
    a2 = (a2 + 185273099) >>> 0; // 0x0B0B0B0B
    a3 = (a3 + 2818) & 0xffff; // 0x0B02，★u16 绕回
    src += 8;
    dst += 4;
  }
  return out;
}

/** 置乱（`sub_436DE0`）：逻辑 dword → 2 个存储 dword。与 `descrambleSlotPayload` 互为逆（测试用合成槽）。 */
export function scrambleSlotPayload(plain: Uint8Array, seed1: number, seed2: number): Uint8Array {
  const count = plain.length >> 2;
  const out = new Uint8Array(8 * count);
  const pd = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const od = new DataView(out.buffer);
  let a2 = seed1 >>> 0;
  let a3 = seed2 & 0xffff;
  for (let i = 0; i < count; i++) {
    const x = (a2 ^ pd.getUint32(4 * i, true)) >>> 0;
    od.setUint32(8 * i, (a3 * ((x >>> 16) & 0xffff)) >>> 0, true);
    od.setUint32(8 * i + 4, (a3 * (x & 0xffff)) >>> 0, true);
    a2 = (a2 + 185273099) >>> 0;
    a3 = (a3 + 2818) & 0xffff;
  }
  return out;
}

/** LZSS 编码（**只发字面量**：每 8 个字节一个 `0xFF` flag）。只用于测试/合成，不追求压缩率。 */
export function lzssLiterals(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + Math.ceil(data.length / 8));
  let at = 0;
  for (let i = 0; i < data.length; i += 8) {
    out[at++] = 0xff;
    for (let k = 0; k < 8 && i + k < data.length; k++) out[at++] = data[i + k]!;
  }
  return out;
}

/** 容器解码结果（`storedDwords`/两个 CRC 都验过）。 */
export interface EngineSlotContainer {
  /** 解压后的完整字节（前 8 B = 两个内层 CRC，其后 = body）。 */
  decompressed: Uint8Array;
  /** = `decompressed.subarray(8)`：状态主体。 */
  body: Uint8Array;
  /** 解压后的字节数（= 头 +240 的语义）。 */
  decompressedBytes: number;
  /** 压缩流字节数（内层第 3 个 dword）。 */
  compressedBytes: number;
  /** 头 +240 声明的 payload 逻辑字节数（用于交叉校验；缺失/不匹配只是诊断，不致命）。 */
  declaredBytes: number;
}

/**
 * 解容器（置乱 + LZSS + 两个内层 CRC）。**不解析 body**（那是 `parseEngineSlotBody`）。
 *
 * 为什么把 CRC 当硬门槛：真槽 47/47 两个 CRC 全过（E4）⇒ 校验失败说明这份 payload 不是这套编码，
 * 与其"猜着读"给出错位的帧/池，不如如实报错。
 */
export function decodeEngineSlotContainer(bytes: Uint8Array): { ok: true; container: EngineSlotContainer } | { ok: false; reason: string } {
  if (bytes.length < SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES) {
    return { ok: false, reason: `文件只有 ${bytes.length} 字节（头+块需要 ${SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES}）` };
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const storedDwords = u32(dv, SAVE_HEADER_BYTES);
  const declaredBytes = u32(dv, 240);
  const seed1 = u32(dv, SAVE_HEADER_BYTES + 12);
  const seed2 = u32(dv, SAVE_HEADER_BYTES + 16);
  const payloadAt = SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES;
  const storedEnd = payloadAt + 4 * storedDwords;
  if (storedDwords === 0 || storedEnd > bytes.length) {
    return { ok: false, reason: `storedDwords=${storedDwords} 超出文件（${bytes.length} 字节）` };
  }
  const plain = descrambleSlotPayload(bytes.subarray(payloadAt, storedEnd), seed1, seed2);
  if (!plain || plain.length < 12) return { ok: false, reason: '反置乱失败（a3 除不尽；不是这套编码）' };
  const pd = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const decompSize = u32(pd, 0);
  const compSize = u32(pd, 8);
  if (decompSize === 0 || decompSize > 64 * 1024 * 1024 || compSize === 0 || compSize > plain.length - 12) {
    return { ok: false, reason: `内层尺寸不合理（解压=${decompSize} 压缩=${compSize} 可用=${plain.length - 12}）` };
  }
  const out = new Uint8Array(decompSize);
  unlzss(plain.subarray(12), compSize, out, decompSize);
  const od = new DataView(out.buffer);
  const body = out.subarray(8);
  const crcA = od.getUint32(0, true);
  const crcB = od.getUint32(4, true);
  if ((crc32MsbFirst(body) >>> 0) !== crcA) return { ok: false, reason: `内层 CRC-A 不符（msb-first 覆盖 body）` };
  if ((crc32(body) >>> 0) !== crcB) return { ok: false, reason: `内层 CRC-B 不符（覆盖 body）` };
  return { ok: true, container: { decompressed: out, body, decompressedBytes: decompSize, compressedBytes: compSize, declaredBytes } };
}

/**
 * 解析 body（`a4 == 3` 的帧镜像 + 池块）。逐条对齐 `sub_410160` raw 19744-19790 与
 * `sub_40CD10` raw 17465-17632；越界/计数不合理一律**如实报错**（不返回"部分正确"的帧表 ——
 * 那会让读档续到错误的位置，比不续跑更糟）。
 */
export function parseEngineSlotBody(body: Uint8Array): EngineSlotParseResult {
  if (body.length < SLOT_IMAGE_PRELUDE_BYTES + 8) {
    return { ok: false, reason: `body 只有 ${body.length} 字节（不足帧镜像前导 ${SLOT_IMAGE_PRELUDE_BYTES}）` };
  }
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const savedCur = i32(dv, 0);
  const savedRet = i32(dv, 4);
  if (savedCur < 0 || savedCur > 39) {
    return { ok: false, reason: `savedCur=${savedCur} 不合理（帧号应 0..39）` };
  }
  const imageBytes = 1044 * savedCur + 22296;
  if (imageBytes > body.length) {
    return { ok: false, reason: `帧镜像长度 ${imageBytes} 超出 body（${body.length}）` };
  }

  const frames: EngineSlotFrame[] = [];
  for (let k = 0; k <= savedCur; k++) {
    const at = SLOT_IMAGE_PRELUDE_BYTES + 1044 * k;
    const depth = i32(dv, at + 8);
    if (depth < 0 || depth > 256) return { ok: false, reason: `帧 ${k} 的返回栈深度 ${depth} 不合理` };
    const retIdx: number[] = [];
    for (let j = 0; j < depth; j++) retIdx.push(i32(dv, at + 12 + 4 * j));
    frames.push({
      returnFrame: i32(dv, at),
      scriptId: i32(dv, at + 4),
      retIdx,
      messageIdx: i32(dv, at + 4 * 259),
      callIdx: i32(dv, at + 4 * 260),
    });
  }

  const images: EngineSlotImageSlot[] = [];
  for (let k = 0; k < 100; k++) {
    const at = SLOT_IMAGE_SLOTS_AT + 12 * k;
    images.push({ id: i32(dv, at), flag: i32(dv, at + 4), param: i32(dv, at + 8) });
  }
  const records: EngineSlotRecord[] = [];
  for (let k = 0; k < 1000; k++) {
    const at = SLOT_IMAGE_RECORDS_AT + 20 * k;
    records.push({
      id: i32(dv, at),
      param: i32(dv, at + 4),
      flag: i32(dv, at + 8),
      unknown12: i32(dv, at + 12),
      unknown16: i32(dv, at + 16),
    });
  }

  // ---- 池块（镜像之后） ----
  let p = imageBytes;
  const need = (n: number, what: string): boolean => p + n <= body.length;
  if (!need(24, '池块头')) return { ok: false, reason: `池块头超出 body（镜像结束于 ${imageBytes}，body=${body.length}）` };
  const intsCount = i32(dv, p);
  const floatsCount = i32(dv, p + 4);
  const stringsCount = i32(dv, p + 8);
  const ipALen = i32(dv, p + 12);
  const ipBLen = i32(dv, p + 16);
  const ipCLen = i32(dv, p + 20);
  p += 24;
  for (const [n, what] of [
    [intsCount, 'int 池'],
    [floatsCount, 'float 池'],
    [stringsCount, 'string 池'],
    [ipALen, 'ip 表 A'],
    [ipBLen, 'ip 表 B'],
    [ipCLen, 'ip 表 C'],
  ] as [number, string][]) {
    // int 池是**定长稀疏数组**（本机真槽 = 1,015,792 项 = 4 MB，对应 `(global-int f8019)` 这类大下标；
    // 引擎侧 `_this[95738]` 就是它的项数、`VirtualAlloc(4*(...))` 按它分配）⇒ 上界放到 8M 项。
    if (n < 0 || n > 8 * 1024 * 1024) return { ok: false, reason: `${what} 计数 ${n} 不合理` };
  }
  if (!need(4 * intsCount + 4 * floatsCount + 4, '池数据')) return { ok: false, reason: '池数据超出 body' };
  const ints: number[] = [];
  for (let i = 0; i < intsCount; i++) ints.push(i32(dv, p + 4 * i));
  p += 4 * intsCount;
  const floats: number[] = [];
  for (let i = 0; i < floatsCount; i++) floats.push(dv.getFloat32(p + 4 * i, true));
  p += 4 * floatsCount;
  const stringsBlobDwords = i32(dv, p);
  p += 4;
  if (stringsBlobDwords < 0 || !need(4 * stringsBlobDwords, '字符串区')) {
    return { ok: false, reason: `字符串区长度 ${stringsBlobDwords} dword 超出 body` };
  }
  const stringsEnd = p + 4 * stringsBlobDwords;
  const strings: string[] = [];
  let sp = p;
  for (let i = 0; i < stringsCount; i++) {
    let end = sp;
    while (end < stringsEnd && body[end] !== 0) end++;
    strings.push(decodePoolString(body.subarray(sp, end)));
    sp = end + 1;
    if (sp > stringsEnd) return { ok: false, reason: `第 ${i} 个字符串越过字符串区` };
  }
  p = stringsEnd;

  const readTable = (len: number, what: string): number[] | null => {
    if (!need(4 * len, what)) return null;
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push(i32(dv, p + 4 * i));
    p += 4 * len;
    return out;
  };
  const ipTableA = readTable(ipALen, 'ip 表 A');
  const ipTableB = readTable(ipBLen, 'ip 表 B');
  const ipTableC = readTable(ipCLen, 'ip 表 C');
  if (!ipTableA || !ipTableB || !ipTableC) return { ok: false, reason: '三张 ip 表超出 body' };

  // ---- 图像重载清单（`{740, count, (1+740) dwords …}`）；结构不符只是解析不到，不影响续跑 ----
  let imageReload: EngineSlotPayload['imageReload'] = null;
  if (p + 8 <= body.length) {
    const size = i32(dv, p);
    const count = i32(dv, p + 4);
    const stride = 1 + size / 4;
    if (size === 740 && count >= 0 && count < 4096 && p + 8 + 4 * stride * count <= body.length) {
      const ids: number[] = [];
      for (let i = 0; i < count; i++) ids.push(i32(dv, p + 8 + 4 * stride * i));
      imageReload = { size, count, ids };
    }
  }

  return {
    ok: true,
    payload: {
      savedCur,
      savedRet,
      pre8: i32(dv, 8),
      frames,
      ints,
      floats,
      strings,
      ipTableA,
      ipTableB,
      ipTableC,
      images,
      records,
      imageReload,
    },
  };
}

/** 完整解码一个真槽（容器 + body）。 */
export function decodeEngineSlot(bytes: Uint8Array): { ok: true; container: EngineSlotContainer; payload: EngineSlotPayload } | { ok: false; reason: string } {
  const c = decodeEngineSlotContainer(bytes);
  if (!c.ok) return c;
  const p = parseEngineSlotBody(c.container.body);
  if (!p.ok) return p;
  return { ok: true, container: c.container, payload: p.payload };
}

/** 一帧的续跑落点。 */
export interface SlotResumeIp {
  /** 要落的指令数组下标（`script.instructions[]`）。 */
  instr: number;
  /**
   * `true` = 引擎在 `0xAE` 里把 ip **再前进 3 个 dword**（`95805 = 3`）：该帧停在一条
   * `0x3` call-script（长度正好 3 dword）上，续跑要从**它的下一条**开始（调用点本身不重放）。
   * `false` = `95805 = 0`（ip 不动）：该帧停在一条 `0x71` 显示消息上，续跑要**重放这条消息**。
   */
  advance: boolean;
  /** 落点来源（观测/诊断）。 */
  from: 'call' | 'message';
  /** 原始 dword 偏移（表里的值）。 */
  dword: number;
}

/**
 * **一次读档续跑要用的最小状态**（= `Engine.saveResume`）：`0xAE` 就靠它逐帧走栈。
 *
 * 为什么只留这三样：引擎侧同一批信息散在帧镜像里（`_this[151210]` = savedCur、`[151211]` = savedRet、
 * `156524+261k` 起的记录），emulator 不需要那份内存镜像，只需要"走到哪一帧、收尾写什么、每帧的落点下标"。
 */
export interface EngineSlotResume {
  /** 存档时的帧号（走栈目标；`0xAE` 在 `cur == savedCur` 时收尾）。 */
  savedCur: number;
  /** 收尾写回 `Engine[95777]`（`ENGINE_FIELD.callRet`）的值。 */
  savedRet: number;
  /** 逐帧记录（下标 = 帧号）。 */
  frames: EngineSlotFrame[];
  /**
   * **这份槽自己声明的存档版本**（`set:SaveVersion1/2` 的等价物 = 容器头 +284/+288，由写侧
   * `sub_40CD10(Engine, file, sv1, "set:SaveVersion2")` 写进去）。
   *
   * ★为什么必须由**文件**带：`0xAE`（`sub_4192F0`）按 `sv1/sv2` 选帧记录的槽位组（263/261 步长三套），
   * 选错 ⇒ 整个走栈不发生。引擎那份 `sv1/sv2` 来自配置注册表（`GetConfig("set:SaveVersion1")`），而注册表
   * 的值又是启动时从 `SAVE.DAT`/`$$SAVE.DAT` 的**头**（raw 15024-15203 读到字段 21968/21972）得来的 ——
   * 所以"以文件为准"与引擎同源；而**玩家数据里 `[set]` 段可能整个不存在**（实测：把真存档复制进来后
   * `SYS4REG.INI` 没有 `[set]` ⇒ `cfgInt(..., 0)` 得到 0 ⇒ `0xAE` 没有可用分支 ⇒ 读档不续跑、一路跑回
   * TITLE，`tickets/T-0065`）。
   */
  sv1?: number;
  sv2?: number;
  /**
   * **还没跑 `CALLBACK_LOAD.BIN` 那一跳**（`tickets/T-0072`）。
   *
   * 引擎在 `sub_410160` 末尾把帧 0 交给 `CALLBACK_LOAD.BIN`（返回帧 = **-11** 哨兵），它跑完 `exit` 时
   * `sub_41A820` 见到 -11 ⇒ `_this[95777] = -1` + `sub_40F750(sv1, sv2)` ⇒ 才把**记录 0 的脚本**装进帧 0。
   * 本标志 = "帧 0 里现在跑的是那个回调，它 `exit` 时要装记录 0"（`handlers/control.ts` 的 `op_exit` 消费）。
   */
  pendingRecord0?: boolean;
}

/**
 * 返回栈换算（`sub_40F750` mode 3 raw 18942-18946）：
 * `frames[k][97193+j] = tableC[retIdx[j]] + 3` —— emulator 的 `Frame.retStack` 存的正是这种
 * **"返回点 dword 偏移"**（`op_call` 压的是 `指令.index + 3`）⇒ 这里换算成同一口径。
 * 越界/负数项**丢掉并回报**（调用方写日志；宁可少一层返回也不要落错指令）。
 */
export function resolveSlotRetStack(script: ScriptBinary, frame: EngineSlotFrame): { retStack: number[]; dropped: number } {
  const table = script.ipTables[2] ?? [];
  const retStack: number[] = [];
  let dropped = 0;
  for (const idx of frame.retIdx) {
    if (idx < 0 || idx >= table.length) {
      dropped++;
      continue;
    }
    const dword = table[idx]!;
    if (dword < 0 || script.dwordToInstr[dword] === undefined) {
      dropped++;
      continue;
    }
    retStack.push(dword + 3);
  }
  return { retStack, dropped };
}

/**
 * 把一帧的存档记录解成"要落的指令"（`sub_40F750` mode 3 raw 18936-18946 + `0xAE` raw 24706-24723）：
 *
 * ```text
 * callIdx    >= 0 ⇒ ip = ipBase + 4 * 表B[callIdx]      （表 B = `0x3` call-script 表；随后 95805 = 3）
 * 否则
 * messageIdx >= 0 ⇒ ip = ipBase + 4 * 表A[messageIdx]   （表 A = `0x71` 消息表；随后 95805 = 0）
 * ```
 *
 * 引擎的"表 A/B"是**当前帧那份脚本自己的**两张表（`frames[cur][95798]/[95800]`，`sub_40ED40` 从脚本
 * 文件头建好）⇒ 所以这里必须拿**帧里那份已装载的脚本**来解，不能拿存档里的全局三张表。
 *
 * 返回 null = 该帧没有可用的落点（记录里两个下标都是 -1）或下标越界（视为无落点，调用方保持原 ip）。
 */
export function resolveSlotResumeIp(script: ScriptBinary, frame: EngineSlotFrame): SlotResumeIp | null {
  const pick = (table: number[] | undefined, idx: number, from: 'call' | 'message'): SlotResumeIp | null => {
    if (idx < 0 || !table || idx >= table.length) return null;
    const dword = table[idx]!;
    if (dword < 0) return null;
    const instr = script.dwordToInstr[dword];
    if (instr === undefined) return null;
    return { instr, advance: from === 'call', from, dword };
  };
  return pick(script.ipTables[1], frame.callIdx, 'call') ?? pick(script.ipTables[0], frame.messageIdx, 'message');
}
