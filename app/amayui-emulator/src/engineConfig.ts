/**
 * 引擎配置（SYS4REG.INI）解析 + 「配置键 → 引擎字段」映射。
 *
 * 引擎侧事实（`analysis/functions.json` + raw .c）：
 *  - 路径：`sub_4900F0` 拼 `[base]\SYS4REG.INI`（`set:UseAppDataFolder`→AppData，否则游戏目录；EXE 名前缀决定 SYS4/SYS3）。
 *  - 解析：`sub_4963E0` 打开逐行读（`[` 开头=分节），`sub_4957F0/sub_495950` 按 `"section:key"` 取值。
 *  - 装载后**灌进引擎字段**（raw 23649-23745 + 各 opcode handler），脚本再用 opcode 读这些字段：
 *      0xC0  `sub_42E510`  → `_this[174713]` ← `sound:Music`（写回侧 0xC3 `sub_420F10`）
 *      0x131 `sub_42F7D0`  → **直读配置** `message:MesWinAlpha`（不落任何字段；写回侧 0x141 `sub_4228C0` 直写配置）
 *      0x2CE `sub_430A20`  → `_this[167990]` ← `display:ScreenMode`（raw 11980 `... = GetConfig(aDisplayScreenm) != 0`）
 *      0x11D `sub_42F810`  → 读 `display:ForceScreen`
 *  - 本模块只做「解析 INI + 给字段赋值」；**emulator 无声音/显示子系统**，故声音类键只建模取值供脚本读，
 *    不驱动任何实际输出（与「引擎内部插桩」同一取舍，见 README 的 0.10D/输入章节说明）。
 */

import { CONFIG_REGISTRY_KEYS } from './configRegistry.js';

/** 解析结果：`section:key` -> 值（数字键保留为 number，其余为 string）。 */
export interface EngineConfig {
  /** 原始解析表（键一律小写 `section:key`）。 */
  values: Map<string, number | string>;
  /** 诊断：解析到的分节名。 */
  sections: string[];
  /**
   * 分节 → 该节里键的**出现顺序**（键名保留原大小写）—— `formatIni` 回写时用它保持文件原样，
   * 避免"改一个值就把整个 INI 重排"。
   */
  order: Map<string, string[]>;
}

/**
 * 解析 SYS4REG.INI 文本。
 * 规则（对齐 `sub_4963E0` 的读法）：`[section]` 开节；`key=value` 赋值；`;`/`#` 开头整行忽略；
 * 键名大小写不敏感（引擎用固定字符串查询，但 INI 习惯不敏感，这里统一小写存储）。
 */
export function parseIni(text: string): EngineConfig {
  const values = new Map<string, number | string>();
  const sections: string[] = [];
  const order = new Map<string, string[]>();
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim();
      if (section && !sections.includes(section)) sections.push(section);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!key) continue;
    // 纯十进制整数（含负号）→ number；其余（含空串）保留字符串
    values.set(`${section.toLowerCase()}:${key.toLowerCase()}`, /^-?\d+$/.test(val) ? parseInt(val, 10) : val);
    const keys = order.get(section.toLowerCase()) ?? [];
    keys.push(key);
    order.set(section.toLowerCase(), keys);
  }
  return { values, sections, order };
}

/** 取整数值；缺失返回 fallback。 */
export function cfgInt(cfg: EngineConfig, key: string, fallback = 0): number {
  const v = cfg.values.get(key.toLowerCase());
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return parseInt(v, 10);
  return fallback;
}

/** 取字符串值；缺失返回 fallback。 */
export function cfgStr(cfg: EngineConfig, key: string, fallback = ''): string {
  const v = cfg.values.get(key.toLowerCase());
  return v === undefined ? fallback : String(v);
}

/**
 * `set:GameVersion` 的**引擎内建缺省**（raw 111627-111629：`sub_40C210(v9, a100, 4)`，
 * 而 `char a100[5] = "1.00"` ⇒ 4 个字符）。INI 的 `[set] GameVersion=` 会覆盖它；
 * 真实安装若带 `set:VerRegPos`，引擎还会用注册表 `DisplayVersion` 覆盖（`sub_490010`，emulator 不做）。
 *
 * ★TITLE 把它切成 1/2/4 字节三段（`i2c7`）再 `i2ec`(atoi) + `i23b`(CG 数字条) 画 "Version X.YY.ZZZZ"；
 *   缺失时第一段为空 ⇒ atoi("") = 0 ⇒ 屏幕上是占位值 "0.00.0000"（这正是实现 0x2EB 前实测到的画面）。
 */
export const ENGINE_BUILTIN_GAME_VERSION = '1.00';

/**
 * emulator 实际呈现的版本串（`0x2EB` 读 `set:GameVersion` 时的缺省）。
 *
 * 为什么不是引擎内建的 `1.00`：真游戏的 `SYS4REG.INI`（`%LOCALAPPDATA%\Eushully\<game>\`）里
 * **没有 `[set]` 节**（那节由引擎退出时按配置注册表写，本作安装没写），照引擎口径会退回 `1.00`，
 * 而 TITLE 会把版本号画在标题画面上 —— 与"我们模拟的是哪份 exe"不符。
 * 取值 = **被模拟的那份 exe 的 FileVersion**：汉化/修正补丁 `补丁\修正补丁\amayui_107.exe` = `1.07.0019`
 * （日版原始 `天结_unpacked.exe` 是 `4.60B`；`1.07.0019` 与旧仓库副本 `SYS4REG.INI` 里那个值一致）。
 *
 * 想换：在 overlay 的 `SYS4REG.INI` 里写 `[set] GameVersion=…`（真游戏那份不动）。
 */
export const DEFAULT_GAME_VERSION = '1.07.0019';

/**
 * 把配置渲染回 `SYS4REG.INI` 文本（**回写**用）。
 *
 * ★★**全量 + 固定顺序**（`tickets/T-0031`）★★ —— 对齐引擎的导出形态：
 * 引擎的键表/默认值/顺序由注册表对象构造 `sub_491880`（raw 111338-111845）静态写死，
 * 导出端 `sub_490590`（raw 110734）是**固定顺序的全量枚举**（53 次 `GetConfig` 直线序列，无局部编辑），
 * 只是它的目标是 HKCU 注册表；我们把它换成"写回 INI"这份跨平台等价物，形态保持一致：
 *
 *  1. **先按 `CONFIG_REGISTRY_KEYS` 的顺序全量输出**：值取 `cfg` 里的现值，缺则写**引擎内建默认**（`def`）
 *     ⇒ 首跑生成的文件天然完整（不是"只含玩家碰过的键"）；
 *  2. 再追加 `cfg` 里**不在键表内**的键（按解析顺序/大小写原样保留）⇒ 不丢任何自定义键；
 *  3. 分节顺序 = 键表里首次出现的顺序（`message`/`sound`/`display`/`set`/`system`/`debug`…），
 *     文件原有的分节名大小写优先保留（真机 INI 习惯 `[Message]` 这种写法）。
 *
 * 输出对同一份配置**确定**（同内容 ⇒ 同字节），因此"改一个值"只会改动那一行 —— 不再依赖 `order` 记账。
 */
export function formatIni(cfg: EngineConfig): string {
  // 文件原有的分节名/键名大小写（仅用于"显示"，语义一律小写查表）
  const secCase = new Map<string, string>();
  const keyCase = new Map<string, string>();
  for (const s of cfg.sections) {
    const sl = s.toLowerCase();
    secCase.set(sl, s);
    for (const k of cfg.order.get(sl) ?? []) keyCase.set(`${sl}:${k.toLowerCase()}`, k);
  }

  // 键表里的键一律用**键表的拼写**（`setConfigValue` 写进 cfg 的是小写键 ⇒ 不能让它决定文件名拼写）
  const canonicalCase = new Map<string, string>();
  for (const { key } of CONFIG_REGISTRY_KEYS) {
    canonicalCase.set(key.toLowerCase(), key.slice(key.indexOf(':') + 1));
  }
  const secOrder: string[] = [];
  const secLines = new Map<string, string[]>();
  const seen = new Set<string>();
  const put = (fullLower: string, fallbackKeyCase: string, value: number | string): void => {
    if (seen.has(fullLower)) return;
    seen.add(fullLower);
    const ci = fullLower.indexOf(':');
    const sl = ci < 0 ? '' : fullLower.slice(0, ci);
    const bare = ci < 0 ? fullLower : fullLower.slice(ci + 1);
    const dispKey = canonicalCase.get(fullLower) ?? keyCase.get(fullLower) ?? fallbackKeyCase;
    if (!secLines.has(sl)) {
      secLines.set(sl, []);
      secOrder.push(sl);
    }
    secLines.get(sl)!.push(`${dispKey}=${value}`);
  };

  // ① 键表全量（顺序 = 引擎构造顺序）
  for (const { key, def } of CONFIG_REGISTRY_KEYS) {
    const full = key.toLowerCase();
    const v = cfg.values.get(full);
    put(full, key.slice(key.indexOf(':') + 1), v ?? def);
  }
  // ② cfg 里的额外键（解析顺序：分节顺序 + 节内键序）
  for (const s of cfg.sections) {
    for (const k of cfg.order.get(s.toLowerCase()) ?? []) {
      const full = `${s.toLowerCase()}:${k.toLowerCase()}`;
      put(full, k, cfg.values.get(full) ?? '');
    }
  }
  // ③ 兜底：values 里有、但 sections/order 没记到的键（手写怪文件）
  for (const [full, v] of cfg.values) put(full, full.slice(full.indexOf(':') + 1), v);

  const lines: string[] = [];
  for (const sl of secOrder) {
    const body = secLines.get(sl) ?? [];
    if (!body.length) continue;
    lines.push(`[${secCase.get(sl) ?? sl}]`, ...body);
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * 「配置键 → 引擎字段」映射（字段号=DWORD 下标 `_this[K]`，`K*4`=字节偏移）。
 * 只列 emulator 有语义落点的键；其余键仍进 `cfg.values`（便于后续按需取用）。
 */
export interface ConfigFieldBinding {
  /** 配置键 `section:key`（小写）。 */
  key: string;
  /** 引擎字段 DWORD 下标 `_this[K]`。 */
  field: number;
  /** 取值变换（如 `!=0` 布尔化）。默认原样。 */
  map?: (v: number) => number;
  /** 说明/证据。 */
  note: string;
}

/**
 * 配置键 → 引擎字段。
 *
 * ★**`field` 一律是 dword 下标**（与 opcode handler 里的 `_this[K]` 同一空间），
 *   不是 raw 里的字节偏移。凡在 raw 中看到的是 `*(_DWORD *)(a1 + N)`（字节寻址），
 *   换算成字段下标必须 `N / 4`。历史上本表混用了两种写法，导致「写入的字段」与
 *   「handler 读的字段」对不上（`engineValues` 按数字键取，取不到就静默得到 0）。
 */
export const CONFIG_FIELD_BINDINGS: ConfigFieldBinding[] = [
  // ⚠待专项复核：raw 23676-23678 把 sound:Music 写进**字节 699240**（= 下标 174810，
  //   见 raw 13223/13229 的 `v1[174810]`）；而 0xC0(`sub_42E510`) 读的是 `_this[174713]`，
  //   后者是**运行期音乐状态**（raw 13521/13531/29857 读写）。这里保留 174713 以维持 0xC0 的
  //   既有取值，但两处语义需要在音频子系统专项里对齐（属**非渲染**范围）。
  { key: 'sound:music', field: 174713, note: '0xC0 getter / 0xC3 setter 读写的音乐字段（raw 38618/38622）；⚠raw 的配置写入目标是字节 699240=下标 174810，待专项复核' },
  { key: 'display:screenmode', field: 167990, map: (v) => (v !== 0 ? 1 : 0), note: '0x2CE 显示模式 getter（raw 11980 `= GetConfig(display:ScreenMode) != 0`）' },
  // ★文本路径：21668×4 = 86672 = Font+1376。op 0x74 写、0x7F 读（i07f 全工程 210 处）；
  //   既是逐字显现的 Sleep 节拍（raw 13954），又是淡入定时器间隔（raw 28382/28763）。
  { key: 'message:messagespeed', field: 21668, note: '消息速度 ms（raw 23736-23738 写字节 86672 ⇒ 下标 21668 = Font+1376）；op 0x74 写 / 0x7F 读' },
  // ★文本路径：80106×4 = 320424 = Font+235128。op 0x2EE 写（raw 33600 `_this[80106] = op1`）。
  { key: 'message:messagefade', field: 80106, note: '消息淡入 ms（raw 23739-23741 写字节 320424 ⇒ 下标 80106 = Font+235128）；op 0x2EE 写、行 alpha 动画窗时长因子（MessageSpeed×MessageFade/100）' },
  { key: 'message:rmouseevent', field: 1384, note: '右键行为（0/1→键位+1，2→31；raw 23722-23735 写字节 5536 ⇒ 下标 1384）' },
  // ★`message:MesWinAlpha` **不在这里**：引擎从不把它灌进持久字段，
  //   只由 0x131（sub_42F7D0 直读配置）/ 0x141（sub_4228C0 直写配置）按名存取。
  //   历史错误：曾绑到字段 21668，而 21668 正是 message:MessageSpeed 的字段
  //   ⇒ 两个键互相覆盖（随包 INI 里 MesWinAlpha=8 会把 MessageSpeed 的 5 顶掉），
  //   并且 0x7F（i07f 全工程 210 处）会读到错误的消息速度。
  { key: 'sound:sound', field: 174810, note: '声音总开关（raw 23676-23678 写字节 699240 ⇒ 下标 174810）' },
  { key: 'sound:se', field: 20980, note: 'SE 开关（raw 23689-23691 写字节 83920 ⇒ 下标 20980，布尔化）' },
  { key: 'sound:voice', field: 21293, note: '语音开关（raw 23693-23695 写字节 85172 ⇒ 下标 21293，布尔化）' },
];

/** 把配置写入 `Engine.engineValues`（幂等：同键重复调用覆盖）。返回实际写入的 `[字段, 值]` 列表。 */
export function applyConfigToEngine(
  cfg: EngineConfig,
  engineValues: Map<number, number>,
): { field: number; value: number; key: string }[] {
  const applied: { field: number; value: number; key: string }[] = [];
  for (const b of CONFIG_FIELD_BINDINGS) {
    // 键一律按小写查（解析表用小写键；绑定表也统一小写，避免大小写笔误导致静默漏绑）
    const key = b.key.toLowerCase();
    if (!cfg.values.has(key)) continue;
    const raw = cfgInt(cfg, key);
    const value = b.map ? b.map(raw) : raw;
    engineValues.set(b.field, value);
    applied.push({ field: b.field, value, key });
  }
  return applied;
}
