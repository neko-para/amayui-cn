/**
 * **SAVE.DAT（系统存档）：脚本 `save-int`/`save-string` 表的持久化容器**。
 *
 * ## 为什么需要它（引擎事实，2026-09 查实）
 * 设置界面里那些开关（Live2D、ADV 特效、字体、音量…）**不存在 SYS4REG.INI 里**，而是：
 *
 * ```text
 * SYSTEM4.txt:71  load-int (global-int 5)        ← 从表里读「已初始化」标志
 * SYSTEM4.txt:72  jcc (global 5) → 已初始化分支
 * SYSTEM4.txt:73      call-script 5258 LOADCONFIG   ← 29 个 load-int/load-string 把用户设置读回 global
 * SYSTEM4.txt:78      call-script 51dc INITCONFIG   ← 首次启动：写默认值 + save-int/save-string 登记
 * SYSTEM4.txt:81      save-int (global-int 5)      ← 打上「已初始化」标志
 * ```
 *
 * `INITCONFIG0..5` 逐个 `mov (global-int a9ce) 0` + **`save-int (global-int a9ce)`**（`0x1A2`），
 * `LOADCONFIG` 逐个 **`load-int (global-int a9ce)`**（`0x1A3`）—— 即"用引擎的两张字符串键表当配置存储"。
 *
 * 引擎把那两张表（`Font+5452` str→int / `Font+5472` str→str，键 = `wsprintf("%c%8.8x", 3|5, 索引)`）
 * 连同别的数据一起序列化进 `SAVE.DAT`：
 *
 * | 环节 | 函数（raw） |
 * |---|---|
 * | 组装 payload | `sub_438320`（逐表写 count + 记录） |
 * | 写文件（292B 头 + 20B 块 + payload） | `sub_437480` |
 * | 启动装载 | `sub_40AEE0` → `sub_438940`（`sub_499650` = 逐元素 RSA 混淆） |
 * | 触发 | 关窗（WM_CLOSE，除非 `set:NoSaveDat`）与「存档槽保存」之后（`sub_40AAE0`） |
 *
 * ## 本模块做什么 / 不做什么
 * - **做**：把我们的两张表按**同样的容器与同样的 payload 结构**读写到 `SAVE.DAT`，于是
 *   "改了设置 → 关掉 → 再开还在"这条链路成立（配合 `load-int`/`save-int` 的既有实现）。
 * - **不做**：payload 的**加密/压缩**（引擎 `sub_436DA0`/`sub_436F60` 一族 + `sub_499650` 的
 *   模幂混淆）。我们用 `format = 0` 标记"本工程明文格式"，读到引擎写的 `format >= 1` 时**如实拒绝**
 *   并说明原因（不猜、不损坏原文件）。容器层的两个 CRC 按引擎的两种算法逐一实现（见下），
 *   所以头的形状与校验口径与引擎一致，将来补上 payload 变换即可互通。
 */
import { crc32, crc32MsbFirst } from './crc32.js';
import { unlzss } from './lzss.js';

/** 容器魔数：引擎按 `strncmp(Str1, engine+698904, 2)` 二选一（`aS4sd`/`aS3sd`）。 */
export const SAVE_MAGIC = 'S4SD';
/** 引擎版本串（`Engine+382688`，本作 exe = "460B"）：写在头 +4。 */
export const SAVE_ENGINE_VERSION = '460B';
/** 头部字节数（引擎 `WriteFile(..., Buffer, 0x124)` = 292）。 */
export const SAVE_HEADER_BYTES = 292;
/** 头后面那个块（引擎 `WriteFile(..., &v38, 0x14)` = 20）：`[dwords, crc1, crc2, key?, key?]`。 */
export const SAVE_BLOCK_BYTES = 20;
/**
 * `format`（引擎头 +284 = `a7`）：引擎写 1/2（1 = 明文直存、2 = 压缩），≥3 走模幂混淆。
 * **0 = 本工程明文格式**（引擎从不写 0）⇒ 两侧互不误读。
 */
export const SAVE_FORMAT_PLAIN = 0;

/** 两张持久化表（键 = 引擎的 `"%c%8.8x"`，值 = int / string）。 */
export interface SaveDataTables {
  ints: Map<string, number>;
  strings: Map<string, string>;
}

export interface SaveDataHeader {
  magic: string;
  engineVersion: string;
  /** 头 +8 的标题串（引擎写游戏名，用于装载时 `strcmp` 校验）。 */
  title: string;
  /** 头 +240：payload 的**逻辑字节数**（未压缩时 = 4 × dword 数）。 */
  payloadBytes: number;
  /** 头 +280：`timeGetTime()/1000 +` 存盘时刻的秒数（引擎的单调时基）。 */
  stamp: number;
  format: number;
  /** 头 +288（引擎的 `a8`）。 */
  aux: number;
}

export interface SaveDataDecoded extends SaveDataHeader {
  tables: SaveDataTables;
}

export type SaveDataParseResult =
  | { ok: true; data: SaveDataDecoded }
  /** 解析失败：`header` 能给就给（便于诊断"这是引擎写的加密存档"）。 */
  | { ok: false; reason: string; header?: SaveDataHeader };

/** 12 字节定长键（引擎 `char Src[12]` + `wsprintfA("%c%8.8x")`）。 */
const KEY_BYTES = 12;

function writeAscii(view: DataView, at: number, s: string, max: number): void {
  for (let i = 0; i < max; i++) view.setUint8(at + i, i < s.length ? s.charCodeAt(i) & 0xff : 0);
}

function readAscii(bytes: Uint8Array, at: number, max: number): string {
  let s = '';
  for (let i = 0; i < max; i++) {
    const b = bytes[at + i]!;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

/** 读 NUL 结尾的 UTF-8 串（我们的字符串表值用 UTF-8；引擎用 SJIS，见文件头说明）。 */
function readCString(bytes: Uint8Array, at: number): { text: string; next: number } {
  let end = at;
  while (end < bytes.length && bytes[end] !== 0) end++;
  const text = new TextDecoder().decode(bytes.subarray(at, end));
  return { text, next: end + 1 };
}

/**
 * 组装 payload（**结构对齐引擎 `sub_438320`**）：
 * ```text
 * u32 intBlockCount(=0，引擎那份是存档槽的模幂块，本工程不用)
 * u32 recCount ; recCount × { key[12]; u32 value }      ← str→int 表（save-int / load-int）
 * u32 strCount ; strCount × { key\0 value\0 }           ← str→str 表（save-string / load-string）
 * u32 0                                                  ← 额外块终止符（引擎 3.10+ 才有内容）
 * ```
 *
 * ⚠与引擎的**唯一**结构差异：本工程格式**不写** `strCount` 之后的那个 `trailerDwords`
 * （= 记录区字节数/4 + 1，引擎用它在读侧定位尾部块）。少这 4 字节不丢信息、也不影响引擎语义，
 * 但读侧必须用 `parseTables(..., engineLayout: false)` 走本工程布局——见 `parsePayload`。
 */
function buildPayload(t: SaveDataTables): Uint8Array {
  const ints = [...t.ints.entries()];
  const strs = [...t.strings.entries()];
  const parts: Uint8Array[] = [];
  const push = (b: Uint8Array): void => void parts.push(b);
  const u32 = (v: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    return b;
  };
  push(u32(0));
  push(u32(ints.length));
  for (const [key, value] of ints) {
    const rec = new Uint8Array(KEY_BYTES + 4);
    writeAscii(new DataView(rec.buffer), 0, key, KEY_BYTES);
    new DataView(rec.buffer).setUint32(KEY_BYTES, value >>> 0, true);
    push(rec);
  }
  push(u32(strs.length));
  const enc = new TextEncoder();
  for (const [key, value] of strs) {
    push(enc.encode(key));
    push(new Uint8Array([0]));
    push(enc.encode(value));
    push(new Uint8Array([0]));
  }
  push(u32(0));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 解析**本工程格式**的明文主体（`buildPayload` 写的布局：无 `trailerDwords`，见其文档）。 */
function parsePayload(bytes: Uint8Array): SaveDataTables | { error: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number): boolean => at + n <= bytes.length;
  if (!need(4)) return { error: 'payload 太短（缺 int 块计数）' };
  at += 4; // intBlockCount（本工程恒 0）
  if (!need(4)) return { error: 'payload 太短（缺 int 记录数）' };
  const recCount = view.getUint32(at, true);
  at += 4;
  const ints = new Map<string, number>();
  for (let i = 0; i < recCount; i++) {
    if (!need(KEY_BYTES + 4)) return { error: `int 记录 ${i} 越界` };
    const key = readAscii(bytes, at, KEY_BYTES);
    const value = view.getUint32(at + KEY_BYTES, true);
    at += KEY_BYTES + 4;
    ints.set(key, value);
  }
  if (!need(4)) return { error: 'payload 太短（缺 string 记录数）' };
  const strCount = view.getUint32(at, true);
  at += 4;
  const strings = new Map<string, string>();
  for (let i = 0; i < strCount; i++) {
    const k = readCString(bytes, at);
    if (k.next > bytes.length) return { error: `string 记录 ${i} 的键越界` };
    const v = readCString(bytes, k.next);
    if (v.next > bytes.length + 1) return { error: `string 记录 ${i} 的值越界` };
    strings.set(k.text, v.text);
    at = v.next;
  }
  return { ints, strings } as SaveDataTables;
}

/**
 * 写一个 `SAVE.DAT`（引擎容器 + 明文 payload）。
 *
 * 头布局（照 `sub_437480` 的 `WriteFile`）：`[0]"S4SD" [4]引擎版本 [8..8+0xE8) 标题 [240]逻辑字节数
 * [264..280) SYSTEMTIME [280]stamp [284]format [288]aux`，随后 20 字节块 `[dwords][crc1][crc2][0][0]`。
 */
export function encodeSaveData(input: {
  tables: SaveDataTables;
  title?: string;
  engineVersion?: string;
  /** 存盘时刻（引擎写 SYSTEMTIME(local)；这里允许注入便于测试）。 */
  now?: Date;
  stamp?: number;
}): Uint8Array {
  const title = input.title ?? 'AmayuiEmulator';
  const engineVersion = input.engineVersion ?? SAVE_ENGINE_VERSION;
  const body = buildPayload(input.tables);
  const crc1 = crc32MsbFirst(body);
  const crc2 = crc32(body);
  const now = input.now ?? new Date();

  const header = new Uint8Array(SAVE_HEADER_BYTES);
  const hv = new DataView(header.buffer);
  writeAscii(hv, 0, SAVE_MAGIC, 4);
  writeAscii(hv, 4, engineVersion, 4);
  writeAscii(hv, 8, title, 0xe8);
  hv.setUint32(240, body.length >>> 0, true); // 逻辑字节数（= 主体长度）
  hv.setUint16(264, now.getFullYear(), true);
  hv.setUint16(266, now.getMonth() + 1, true);
  hv.setUint16(268, now.getDay(), true);
  hv.setUint16(270, now.getHours(), true);
  hv.setUint16(272, now.getMinutes(), true);
  hv.setUint16(274, now.getSeconds(), true);
  hv.setUint32(280, (input.stamp ?? 0) >>> 0, true);
  hv.setUint32(284, SAVE_FORMAT_PLAIN, true);
  hv.setUint32(288, 0, true);

  // 20 字节块：[主体字节数][crc1][crc2][0][0]（与引擎同形；明文格式下解码端以主体前缀的 CRC 为准）
  const block = new Uint8Array(SAVE_BLOCK_BYTES);
  const bv = new DataView(block.buffer);
  bv.setUint32(0, body.length >>> 0, true);
  bv.setUint32(4, crc1, true);
  bv.setUint32(8, crc2, true);

  // payload 段 = [crc1][crc2][主体]（引擎的 `a5[0]/a5[1]` 约定）
  const section = new Uint8Array(8 + body.length);
  const sv = new DataView(section.buffer);
  sv.setUint32(0, crc1, true);
  sv.setUint32(4, crc2, true);
  section.set(body, 8);

  const out = new Uint8Array(header.length + block.length + section.length);
  out.set(header, 0);
  out.set(block, header.length);
  out.set(section, header.length + block.length);
  return out;
}

/** 只读头（诊断用：能认出"这是引擎写的存档"，即便 payload 解不开）。 */
export function readSaveHeader(bytes: Uint8Array): SaveDataHeader | undefined {
  if (bytes.length < SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES) return undefined;
  const hv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    magic: readAscii(bytes, 0, 4),
    engineVersion: readAscii(bytes, 4, 4),
    title: readCString(bytes, 8).text,
    payloadBytes: hv.getUint32(240, true),
    stamp: hv.getUint32(280, true),
    format: hv.getUint32(284, true),
    aux: hv.getUint32(288, true),
  };
}

/** 引擎存档的 payload 是否加密/压缩（我们只实现了 `format <= 3` 的那套）。 */
export function isEngineSave(bytes: Uint8Array): boolean {
  const h = readSaveHeader(bytes);
  return !!h && (h.magic === 'S4SD' || h.magic === 'S3SD') && h.format !== SAVE_FORMAT_PLAIN;
}

/**
 * **引擎 `Crypt` 解密**（`sub_436E90` raw 44348-44390，逐字照抄）。
 *
 * 加密侧（`sub_436DE0`）对每个输入 dword `v = key1 ^ in[i]` 产出 8 字节：
 * `out[2i] = key2 * (v >>> 16)`、`out[2i+1] = key2 * (v & 0xffff)`；每轮 `key1 += 0x0B0B0B0B`、
 * `key2 += 0x0B02`。解密即逐项整除还原（除不尽 ⇒ 失败返回 false）。`key1/key2` 就在文件头的
 * 20 字节块里（第 4/5 个 dword）——所以这是**混淆**而不是加密。
 */
export function cryptDecrypt(payload: Uint8Array, key1in: number, key2in: number): { out: Uint8Array; ok: boolean } {
  const outLen = payload.length / 8;
  const out = new Uint8Array(outLen * 4);
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const ov = new DataView(out.buffer);
  let key1 = key1in >>> 0;
  let key2 = key2in & 0xffff;
  for (let j = 0; j < outLen; j++) {
    const hiPart = dv.getUint32(j * 8, true);
    const loPart = dv.getUint32(j * 8 + 4, true);
    if (key2 === 0 || hiPart % key2 !== 0 || loPart % key2 !== 0) {
      return { out: out.subarray(0, j * 4), ok: false };
    }
    const v = ((key1 ^ (((loPart / key2) + (((hiPart / key2) << 16) >>> 0)) >>> 0)) >>> 0);
    ov.setUint32(j * 4, v, true);
    key1 = (key1 + 0x0b0b0b0b) >>> 0;
    key2 = (key2 + 0x0b02) & 0xffff;
  }
  return { out, ok: true };
}

/**
 * 解出 payload **主体**（= 序列化数据，跳过前置的两个 CRC dword）。
 *
 * 引擎流程（`sub_437980` raw 44892-45090）：
 *  1. 读 292 字节头 + 20 字节块（块 = `[payloadDwords][crc1][crc2][key1][key2]`）；
 *  2. 校验两个 CRC（对**密文**算）；
 *  3. `format < 2`：`Crypt` 解密后就地取 `+8`；
 *     `format >= 2`：解密后是 `[inLen][outLen][cSize][LZSS(压缩)]`，解压后再跳过 `+8`。
 */
function extractEnginePayload(bytes: Uint8Array, header: SaveDataHeader): { data: Uint8Array } | { error: string } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(SAVE_HEADER_BYTES + 0, true);
  const crc1 = dv.getUint32(SAVE_HEADER_BYTES + 4, true);
  const crc2 = dv.getUint32(SAVE_HEADER_BYTES + 8, true);
  const key1 = dv.getUint32(SAVE_HEADER_BYTES + 12, true);
  const key2 = dv.getUint32(SAVE_HEADER_BYTES + 16, true);
  const at = SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES;
  if (n <= 0 || at + 4 * n > bytes.length) return { error: `payload 长度越界（n=${n}）` };
  const raw = bytes.subarray(at, at + 4 * n);
  // CRC 对密文算（引擎 raw 44995-45013 的 `sub_436D50/sub_436D00(..., 4*v36, Src)`）
  const c1 = crc32MsbFirst(raw);
  const c2 = crc32(raw);
  if (c1 !== crc1 || c2 !== crc2) {
    return { error: `密文 CRC 不符（文件 ${crc1.toString(16)}/${crc2.toString(16)} ≠ 实算 ${c1.toString(16)}/${c2.toString(16)}）` };
  }
  const dec = cryptDecrypt(raw, key1, key2);
  if (!dec.ok) return { error: 'Crypt 解密失败（key2 除不尽）' };
  if (header.format < 2) return { data: dec.out.subarray(8) };
  const pdv = new DataView(dec.out.buffer, dec.out.byteOffset, dec.out.byteLength);
  if (dec.out.length < 12) return { error: '压缩头缺失' };
  const inLen = pdv.getUint32(8, true);
  const outLen = pdv.getUint32(4, true);
  if (outLen <= 0 || 12 + inLen > dec.out.length) return { error: `压缩头越界（in=${inLen} out=${outLen}）` };
  const out = new Uint8Array(outLen);
  unlzss(dec.out.subarray(12, 12 + inLen), inLen, out, outLen);
  return { data: out.subarray(8) };
}

/** 引擎的 12 字节定长键 → JS 串（键是 ASCII 的 `"%c%8.8x"`）。 */
function engineKey(bytes: Uint8Array, at: number): string {
  let s = '';
  for (let i = 0; i < KEY_BYTES; i++) {
    const b = bytes[at + i]!;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

/**
 * 解析序列化主体（引擎 `sub_438940` 的结构；与我们的 `buildPayload` 只差 `trailerDwords` 那 4 字节）：
 * ```text
 * u32 intCount ; intCount × u32            ← 存档槽用的"int 块"（引擎 ≥2.10 逐元素模幂混淆 ⇒ 本模块跳过）
 * u32 recCount ; recCount × { key[12]; u32 }   ← ★str→int 表（配置值就在这里）
 * u32 strCount
 * u32 trailerDwords                        ← ★引擎专有：= 记录区字节数/4 + 1（`sub_438320` 写 `v16[1] = v46 + 1`）
 * strCount × { key\0 value\0 }             ← str→str 表（字体名等）
 * 尾部块（`trailerDwords` 个 dword；3.10+ 才有内容，低版本仅首个 dword = 0）
 * ```
 * 字符串值：引擎按 **SJIS** 写、本工程按 UTF-8 写 ⇒ 由 `shiftJis` 开关选择解码。
 *
 * ★`trailerDwords` 这 4 字节**必须跳过**：引擎读侧 `sub_438940` raw 45564-45566 是
 * `v23 = *v20; v34 = v20[1]; v24 = (char *)(v20 + 2)` —— 记录区从 strCount **之后 8 字节**开始。
 * 少跳这 4 字节不会报错，只会把第 1 条记录读成乱码键、并**静默丢掉最后一条记录**
 * （天結真存档里最后一条恰好是字体键 `\x05…bbf`，见 `docs-new/03-engine/save-data.md` §3）。
 * 因此这里顺带用 `trailerDwords` 做**结构自校验**：读满 `strCount` 条之后，记录区字节数必须落在
 * `4 × (trailerDwords - 1)` 之内（引擎按 dword 对齐，尾部最多补 3 字节零）——对不上就如实报错。
 */
function parseTables(data: Uint8Array, shiftJis: boolean, engineLayout: boolean): SaveDataTables | { error: string } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  const need = (n: number): boolean => at + n <= data.length;
  if (!need(4)) return { error: '缺 int 块计数' };
  const intCount = dv.getUint32(at, true);
  at += 4;
  at += 4 * intCount;
  if (!need(4)) return { error: '缺记录表计数（int 块越界）' };
  const recCount = dv.getUint32(at, true);
  at += 4;
  const ints = new Map<string, number>();
  for (let i = 0; i < recCount; i++) {
    if (!need(KEY_BYTES + 4)) return { error: `int 记录 ${i} 越界` };
    ints.set(engineKey(data, at), dv.getUint32(at + KEY_BYTES, true));
    at += KEY_BYTES + 4;
  }
  if (!need(4)) return { error: '缺字符串表计数' };
  const strCount = dv.getUint32(at, true);
  at += 4;
  let trailerDwords = 0;
  if (engineLayout) {
    if (!need(4)) return { error: '缺字符串表的尾部块长度' };
    trailerDwords = dv.getUint32(at, true);
    at += 4;
  }
  const recordsAt = at;
  const dec = shiftJis ? new TextDecoder('shift_jis') : new TextDecoder();
  const readC = (o: number): { s: string; next: number } => {
    let e = o;
    while (e < data.length && data[e] !== 0) e++;
    return { s: dec.decode(data.subarray(o, e)), next: e + 1 };
  };
  const strings = new Map<string, string>();
  for (let i = 0; i < strCount; i++) {
    if (at >= data.length) return { error: `字符串记录 ${i} 越界` };
    const k = readC(at);
    if (k.next > data.length) return { error: `字符串记录 ${i} 的键越界` };
    const v = readC(k.next);
    strings.set(k.s, v.s);
    at = v.next;
  }
  if (engineLayout && strCount > 0) {
    // 引擎把记录区按 dword 对齐（`v46 = SizeInBytes/4`）⇒ 实际记录字节数只允许比声明区短 0..3 字节（尾部补零）
    const declared = 4 * (trailerDwords - 1);
    const actual = at - recordsAt;
    if (actual > declared || declared - actual > 3) {
      return { error: `字符串表与尾部块长度不符（记录区 ${actual} 字节，尾部块声明 ${declared} 字节）` };
    }
  }
  return { ints, strings };
}

/** payload 内的两个 CRC dword（引擎/本工程都在主体前留 8 字节）。 */
function verifyBodyCrc(body: Uint8Array, crc1: number, crc2: number): boolean {
  if (body.length < 8) return false;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return dv.getUint32(0, true) === crc1 && dv.getUint32(4, true) === crc2;
}

/**
 * 解析 `SAVE.DAT`：**本工程明文格式（format 0）与引擎格式（1..3）都读**。
 *
 * - 引擎格式：头 → `Crypt` 解密 →（format ≥ 2）LZSS 解压 → 表结构；`int 块`跳过（模幂混淆；
 *   配置值不在那里，而在 str→int 记录表里，见 `INITCONFIG*` 的 `save-int (global …)`）。
 * - 我们的格式：头 → 明文 payload → 表结构（并逐项校验 payload 内的两个 CRC）。
 */
export function decodeSaveData(bytes: Uint8Array): SaveDataParseResult {
  const header = readSaveHeader(bytes);
  if (!header) return { ok: false, reason: `文件太短（${bytes.length} < 312 字节）` };
  if (header.magic !== SAVE_MAGIC) return { ok: false, reason: `魔数不是 ${SAVE_MAGIC}（实际「${header.magic}」）`, header };
  const engine = header.format !== SAVE_FORMAT_PLAIN;

  if (!engine) {
    const payloadAt = SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES;
    const bodyLen = bytes.length - payloadAt;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const crc1File = dv.getUint32(SAVE_HEADER_BYTES + 4, true);
    const crc2File = dv.getUint32(SAVE_HEADER_BYTES + 8, true);
    const payload = bytes.subarray(payloadAt);
    if (bodyLen !== header.payloadBytes + 8) {
      return { ok: false, reason: `payload 长度不符（文件 ${bodyLen} ≠ 头声明 ${header.payloadBytes} + 8）`, header };
    }
    if (!verifyBodyCrc(payload, crc32MsbFirst(payload.subarray(8)), crc32(payload.subarray(8)))) {
      return { ok: false, reason: 'payload CRC 不符', header };
    }
    void crc1File;
    void crc2File;
    const tables = parsePayload(payload.subarray(8));
    if ('error' in tables) return { ok: false, reason: tables.error, header };
    return { ok: true, data: { ...header, tables } };
  }

  const ex = extractEnginePayload(bytes, header);
  if ('error' in ex) return { ok: false, reason: ex.error, header };
  const tables = parseTables(ex.data, true, true);
  if ('error' in tables) return { ok: false, reason: `引擎 payload 解析失败：${tables.error}`, header };
  return { ok: true, data: { ...header, tables } };
}
