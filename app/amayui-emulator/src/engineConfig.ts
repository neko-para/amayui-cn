/**
 * 引擎配置（SYS4REG.INI）解析 + 「配置键 → 引擎字段」映射。
 *
 * 引擎侧事实（`analysis/functions.json` + raw .c）：
 *  - 路径：`sub_4900F0` 拼 `[base]\SYS4REG.INI`（`set:UseAppDataFolder`→AppData，否则游戏目录；EXE 名前缀决定 SYS4/SYS3）。
 *  - 解析：`sub_4963E0` 打开逐行读（`[` 开头=分节），`sub_4957F0/sub_495950` 按 `"section:key"` 取值。
 *  - 装载后**灌进引擎字段**（raw 23649-23745 + 各 opcode handler），脚本再用 opcode 读这些字段：
 *      0xC0  `sub_42E510`  → `_this[174713]` ← `sound:Music`（写回侧 0xC3 `sub_420F10`）
 *      0x131 `sub_42F7D0`  → 直接读 `message:MesWinAlpha`（配置注册表 get）
 *      0x2CE `sub_430A20`  → `_this[167990]` ← `display:ScreenMode`（raw 11980 `... = GetConfig(aDisplayScreenm) != 0`）
 *      0x11D `sub_42F810`  → 读 `display:ForceScreen`
 *  - 本模块只做「解析 INI + 给字段赋值」；**emulator 无声音/显示子系统**，故声音类键只建模取值供脚本读，
 *    不驱动任何实际输出（与「引擎内部插桩」同一取舍，见 README 的 0.10D/输入章节说明）。
 */

/** 解析结果：`section:key` -> 值（数字键保留为 number，其余为 string）。 */
export interface EngineConfig {
  /** 原始解析表（键一律小写 `section:key`）。 */
  values: Map<string, number | string>;
  /** 诊断：解析到的分节名。 */
  sections: string[];
}

/**
 * 解析 SYS4REG.INI 文本。
 * 规则（对齐 `sub_4963E0` 的读法）：`[section]` 开节；`key=value` 赋值；`;`/`#` 开头整行忽略；
 * 键名大小写不敏感（引擎用固定字符串查询，但 INI 习惯不敏感，这里统一小写存储）。
 */
export function parseIni(text: string): EngineConfig {
  const values = new Map<string, number | string>();
  const sections: string[] = [];
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
  }
  return { values, sections };
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

export const CONFIG_FIELD_BINDINGS: ConfigFieldBinding[] = [
  { key: 'sound:music', field: 174713, note: '0xC0 getter / 0xC3 setter 读写的音乐字段（raw 23678、38618）' },
  { key: 'display:screenmode', field: 167990, map: (v) => (v !== 0 ? 1 : 0), note: '0x2CE 显示模式 getter（raw 11980 `= GetConfig(display:ScreenMode) != 0`）' },
  { key: 'message:messagespeed', field: 86672, note: '消息速度 ms（raw 23736-23738）' },
  { key: 'message:messagefade', field: 320424, note: '消息淡入 ms（raw 23739-23741）' },
  { key: 'message:rmouseevent', field: 5536, note: '右键行为（0/1→键位+1，2→31；raw 23722-23735）' },
  { key: 'message:meswinalpha', field: 21668, note: '消息窗 α（0x7F getter raw 39355 直接读该键，故字段取同值）' },
  { key: 'sound:sound', field: 699240, note: '声音总开关（raw 23678-23681 传入声音对象构造）' },
  { key: 'sound:se', field: 83920, note: 'SE 开关（raw 23689-23691 布尔化）' },
  { key: 'sound:voice', field: 85172, note: '语音开关（raw 23693-23695 布尔化）' },
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
