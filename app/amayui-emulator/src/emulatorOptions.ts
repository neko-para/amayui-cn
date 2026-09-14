/**
 * **emulator 外置选项（`emulator.config.json`）** —— 只影响"怎么跑"，**不改变引擎/脚本语义**。
 *
 * 与 `SYS4REG.INI`（`engineConfig.ts`）的区别：那份是**游戏的**玩家配置（设置界面写它、存档里有它），
 * 这份是**重写侧/测试侧的**运行开关（真游戏里没有这个概念），所以**绝不写回、绝不进存档**。
 *
 * ## 为什么需要它
 * 启动链 `SYSTEM4(0) → LOGO → INIT → TITLE` 里的 LOGO 是**版权页 + LOGO.MPG 影片**（`src/LOGO.txt` 55 行：
 * 建 3 张全屏 mesh → `poll-input`/`wait` 等 0x400 门 → `play-movie` → `exit`）。跑回归/截图时这段
 * 纯粹是等待，没有任何被测逻辑 ⇒ 需要一个"当作版权页已经看过"的开关来省掉它。
 *
 * ## 目前有两个节（`boot` / `resources`）
 *
 * | 键 | 类型 | 默认 | 含义 |
 * |---|---|---|---|
 * | `boot.showLogo` | boolean | `true` | `false` = **启动时预设 LOGO 显示标记**（`_this[96983] = 0`）⇒ cold boot **不进** `LOGO.txt`，直接 `INIT → TITLE` |
 * | `resources.version` | `"jp"` \| `"cnjp"` | `"cnjp"` | **这套资源是哪一版**；决定字体面名解析策略（见下） |
 * | `resources.path` | string（可省） | 无（⇒ `install/`） | **资源根在哪**；相对路径以**生效的 config 文件所在目录**为基准 |
 *
 * ## `resources` 段：为什么需要它（两个键共用前缀，别只改一半）
 *
 * 资源根原先只由 `AMAYUI_RESOURCE_DIR` / CLI `--resources` 选，**没有任何地方记录"当前这套是哪一版"**；
 * 而字体策略（`src/text/fontSet.ts`）是**单一 cnjp 政策**：所有引擎面名都落到 `Amayui CN`。
 * 那是为 SJIS 占位编码服务的字体（cmap 把日文写法码位换成简体字形）—— 拿它跑**纯日文资源**
 * 会把原文的日文码位也换成简体（`说/説`、`为/為` 同形替换肉眼可见），且**不报错、只是显示不对**。
 *
 * ⇒ `resources.version` 显式说明"是哪一版"，驱动字体分叉：`jp` → 未做 cnjp 替换的更纱黑体
 * （`res/fonts/SarasaGothicSC`），`cnjp` → `Amayui CN`；`resources.path` 显式说明"在哪"。
 * **优先序**（唯一权威在 `arch/resourceDir.ts` 的 `decideResourceDir`）：
 * `CLI --resources` > 环境变量 `AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`。
 *
 * ⚠️ `resources.path` 与 `resources.version` 是**两个独立键**：换路径不会自动换版本
 * （路径名不可靠，不做猜测）。入口会**同一行**打印两者，让"换了 path 忘改 version"当场可见。
 *
 * ## 为什么"预设标记"就是正确的跳过方式（依据）
 * `docs-new/03-engine/flow-control.md` §10 + `analysis/fields.json` 的 `logo_enabled`(0x5EB5C)：
 *  - `load-show-logo`(0x130) handler `sub_42F7A0` 把 `_this[96983]` 写回操作数（raw 39346）；
 *  - `src/SYSTEM4.txt:144-150`：`load-show-logo (local-int 2)` → `jcc (local-int 2) … label_00000b38`
 *    ⇒ 非 0 落下播 LOGO（`:146 call-script 5262`）、**0 跳到 `:149 INIT` / `:150 TITLE`**；
 *  - 这个 0 值不是"我们编的"：LOGO 自己结尾的 `exit`（= `exit-script` 0x9，`sub_428A60` raw 35207 置 0）
 *    以及 GAMEOVER 回标题都会把它置 0 ⇒ **"0 ⇒ 跳过 LOGO"是引擎自己反复走的一条真实路径**。
 *  - ⚠️ 唯一的差异：真机播 LOGO 时 `SYSTEM4` 的 `ip0..143` 会跑两遍（LOGO 的 `exit` 会重载根脚本再跑一遍），
 *    而预设 0 时只跑一遍。这些指令是赋值/建表（`set-font`/`i2fe`/`i260`/`i261`/`mov global 3f36 2`…），
 *    实测能一路跑到 TITLE/GAMESTART/SN0000（见 §"验证"），但要记住这是**刻意的近似**。
 *
 * ## 本模块刻意的约束
 * **不 import `node:fs`**：它同时被 Electron 渲染进程（esbuild `platform: 'browser'`）与 Node 工具引用。
 * 读文件在 `emulatorOptionsFile.ts`（node-only）/ Electron 主进程 IPC 里做，这里只做**纯解析与套用**。
 */

/** 选项文件名（放在**仓库根**；路径解析见 `emulatorOptionsFile.ts` 的 `resolveOptionsPath`）。 */
export const EMULATOR_OPTIONS_FILE = 'emulator.config.json';

/** 覆盖选项文件路径的环境变量（绝对路径，或相对仓库根）。 */
export const EMULATOR_OPTIONS_ENV = 'AMAYUI_EMULATOR_CONFIG';

/**
 * **LOGO/版权页开关字段** `_this[96983]`（字节偏移 387932 = `0x5EB5C`）。
 * 写点：构造 `sub_415640` = 1（raw 22589）；`exit-script` `sub_428A60` = 0（raw 35207）。
 * 读点：`load-show-logo`(0x130) `sub_42F7A0`（raw 39346）。
 */
export const LOGO_FLAG_FIELD = 96983;

/** 选项集合（键名/默认值见文件头表格；新增键请同步更新那张表与 `docs-new/04-app/emulator.md`）。 */
export interface EmulatorOptions {
  boot: {
    /**
     * 启动时是否播 `LOGO.txt`（版权页 + LOGO.MPG）。
     * `false` ⇒ 预设 `_this[96983] = 0`，等价于"版权页已经看过"。
     */
    showLogo: boolean;
  };
  /** 资源版本 + 资源根（两键共用 `resources` 前缀；优先序见文件头）。 */
  resources: {
    /**
     * `jp` = 纯日文资源（字体走未做 cnjp 替换的更纱黑体）；
     * `cnjp` = ShiftJIS 编码的中文资源（字体走 `Amayui CN`）。
     */
    version: ResourceVersion;
    /**
     * 资源根路径；**可省**（省略 ⇒ 默认 `install/`）。相对路径以**生效的 config 文件所在目录**为基准，
     * 绝对路径直接采用。真正解析在 `arch/resourceDir.ts` 的 `decideResourceDir`（CLI/环境变量优先于它）。
     */
    path?: string;
  };
}

/** `resources.version` 的取值：纯日文 / ShiftJIS 编码的中文。 */
export type ResourceVersion = 'jp' | 'cnjp';

/** 全部合法取值（解析时用来校验；顺序 = 文档顺序）。 */
export const RESOURCE_VERSIONS: readonly ResourceVersion[] = ['jp', 'cnjp'];

/** 全部默认值 = **真游戏行为**（构造 `sub_415640` 置 1 ⇒ 播 LOGO；默认资源根 `install/` = 汉化版 ⇒ cnjp）。 */
export const DEFAULT_EMULATOR_OPTIONS: EmulatorOptions = {
  boot: { showLogo: true },
  resources: { version: 'cnjp' },
};

/** 解析是否成功（`version` 非法时保持默认值，只上浮一条 problem）。 */
function isResourceVersion(v: unknown): v is ResourceVersion {
  return typeof v === 'string' && (RESOURCE_VERSIONS as readonly string[]).includes(v);
}

/**
 * 选项的**宽松输入形状**：允许"半份选项"（只有 `boot`、或键类型不对）。
 *
 * 为什么需要它：`EmulatorOptions` 是**必填完整**类型，但测试与库调用方常手写字面量
 * （历史写法 `{ boot: { showLogo: false } }`，没有 `resources`）—— 那些调用点不走 `tsc`
 * （测试被 tsconfig 排除），于是"少一个节"会变成运行时崩溃而不是编译错误。`normalizeEmulatorOptions`
 * 把任何半份输入补成完整、合法的选项（缺失/非法 = 默认值），消费端一律先过它。
 */
export interface EmulatorOptionsInput {
  boot?: { showLogo?: boolean };
  resources?: { version?: string; path?: string };
}

/** 把宽松输入补成完整选项（缺失/非法一律取默认值；`path` 只保留非空字符串）。 */
export function normalizeEmulatorOptions(input?: EmulatorOptionsInput | null): EmulatorOptions {
  const showLogo = typeof input?.boot?.showLogo === 'boolean' ? input.boot.showLogo : DEFAULT_EMULATOR_OPTIONS.boot.showLogo;
  const rawVersion = input?.resources?.version;
  const version: ResourceVersion = isResourceVersion(rawVersion) ? rawVersion : DEFAULT_EMULATOR_OPTIONS.resources.version;
  const rawPath = input?.resources?.path;
  const path = typeof rawPath === 'string' && rawPath.trim().length > 0 ? rawPath : undefined;
  return { boot: { showLogo }, resources: { version, ...(path !== undefined ? { path } : {}) } };
}

export interface ParseEmulatorOptionsResult {
  options: EmulatorOptions;
  /** 不致命的配置问题（未知键 / 类型不对 / JSON 坏）——调用方应**打日志**，但继续用默认值。 */
  problems: string[];
}

/** 深度克隆默认值（避免调用方改到全局常量）。 */
function cloneDefaults(): EmulatorOptions {
  return {
    boot: { showLogo: DEFAULT_EMULATOR_OPTIONS.boot.showLogo },
    resources: { version: DEFAULT_EMULATOR_OPTIONS.resources.version },
  };
}

/**
 * 解析选项文件文本。**永不抛**：坏 JSON / 未知键 / 类型不对都降级为"用默认值 + 一条 problem"。
 *
 * 为什么严格到"未知键也报"：这个文件是**人手改**的，拼错键名（`showlogo`/`ShowLogo`/`boot.showlogo`）
 * 的后果是"以为跳过了 LOGO、其实没跳"，没有报错会让人白等 —— 所以宁可吵。
 */
export function parseEmulatorOptions(text: string): ParseEmulatorOptionsResult {
  const options = cloneDefaults();
  const problems: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    problems.push('文件为空 ⇒ 全用默认值');
    return { options, problems };
  }
  let root: unknown;
  try {
    root = JSON.parse(trimmed);
  } catch (err) {
    problems.push(`JSON 解析失败（${(err as Error).message}）⇒ 全用默认值`);
    return { options, problems };
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    problems.push('顶层必须是对象（如 `{"boot":{"showLogo":false}}`）⇒ 全用默认值');
    return { options, problems };
  }
  for (const key of Object.keys(root as Record<string, unknown>)) {
    if (key.startsWith('$')) continue; // `$comment` 之类的说明键：允许、不算未知
    if (key !== 'boot' && key !== 'resources') {
      problems.push(`未知顶层键 "${key}"（已忽略；本文件目前只认 "boot"/"resources"）`);
    }
  }

  // ---- boot 节 ----
  const boot = (root as Record<string, unknown>)['boot'];
  if (boot !== undefined) {
    if (boot === null || typeof boot !== 'object' || Array.isArray(boot)) {
      problems.push('"boot" 必须是对象 ⇒ 该节用默认值');
    } else {
      for (const key of Object.keys(boot as Record<string, unknown>)) {
        if (key.startsWith('$')) continue;
        if (key !== 'showLogo') problems.push(`未知键 "boot.${key}"（已忽略；本文件目前只认 "boot.showLogo"）`);
      }
      const showLogo = (boot as Record<string, unknown>)['showLogo'];
      if (showLogo !== undefined) {
        if (typeof showLogo !== 'boolean') {
          problems.push(`"boot.showLogo" 必须是 true/false（拿到 ${JSON.stringify(showLogo)}）⇒ 用默认值 ${DEFAULT_EMULATOR_OPTIONS.boot.showLogo}`);
        } else {
          options.boot.showLogo = showLogo;
        }
      }
    }
  }

  // ---- resources 节（`version` 驱动字体策略；`path` 驱动资源根）----
  const resources = (root as Record<string, unknown>)['resources'];
  if (resources !== undefined) {
    if (resources === null || typeof resources !== 'object' || Array.isArray(resources)) {
      problems.push('"resources" 必须是对象（如 `{"resources":{"version":"jp"}}`）⇒ 该节用默认值');
    } else {
      for (const key of Object.keys(resources as Record<string, unknown>)) {
        if (key.startsWith('$')) continue;
        if (key !== 'version' && key !== 'path') {
          problems.push(`未知键 "resources.${key}"（已忽略；本文件目前只认 "resources.version"/"resources.path"）`);
        }
      }
      const version = (resources as Record<string, unknown>)['version'];
      if (version !== undefined) {
        if (!isResourceVersion(version)) {
          problems.push(
            `"resources.version" 必须是 ${RESOURCE_VERSIONS.map((v) => `"${v}"`).join('/')}` +
              `（拿到 ${JSON.stringify(version)}）⇒ 用默认值 "${DEFAULT_EMULATOR_OPTIONS.resources.version}"`,
          );
        } else {
          options.resources.version = version;
        }
      }
      const resPath = (resources as Record<string, unknown>)['path'];
      if (resPath !== undefined) {
        if (typeof resPath !== 'string' || resPath.trim().length === 0) {
          problems.push(`"resources.path" 必须是非空字符串（拿到 ${JSON.stringify(resPath)}）⇒ 用默认资源根`);
        } else {
          options.resources.path = resPath;
        }
      }
    }
  }
  return { options, problems };
}

/**
 * 把选项套用进引擎字段。**在 `applyConfigToEngine` 之后调用**（本文件不碰 `SYS4REG.INI` 的键，
 * 但顺序固定下来可避免"以后有人给 96983 加配置绑定"时互相覆盖）。
 *
 * 无论 `showLogo` 是 true 还是 false 都**显式写入**：`true` 写 1 = 引擎构造 `sub_415640` 的行为（raw 22589），
 * 显式写让"默认值"也变成可核对的日志，而不是依赖 `Engine` 构造函数的隐式初值。
 *
 * @returns 人类可读的说明行（调用方逐行打日志/trece）。
 */
export function applyEmulatorOptions(values: Map<number, number>, options: EmulatorOptions): string[] {
  const show = options.boot.showLogo;
  values.set(LOGO_FLAG_FIELD, show ? 1 : 0);
  return [
    show
      ? `boot.showLogo=true ⇒ _this[${LOGO_FLAG_FIELD}]=1（cold boot 播 LOGO/版权页，真游戏行为）`
      : `boot.showLogo=false ⇒ 预设 _this[${LOGO_FLAG_FIELD}]=0（跳过 LOGO/版权页；与 LOGO 自身的 exit-script、GAMEOVER 回标题同一条路径 —— SYSTEM4.txt:144-146 将直接落到 :149 INIT / :150 TITLE）`,
  ];
}

/**
 * `applyEmulatorOptions` 的**引擎版**：除了写引擎字段，还把 `resources.version` 落到
 * `Engine.resourceVersion`（字体面名解析策略，`src/text/fontSet.ts` 按它取表）。
 *
 * 为什么单独一个函数而不是改 `applyEmulatorOptions` 的签名：后者是纯"值 → 字段"的映射，
 * 被测试直接用来喂一个裸 `Map`；这里多认 `Engine` 上的策略字段，调用方一律是"建好引擎之后"。
 *
 * ⚠️ `resources.path` **不在这里套用**：资源根必须在**建 `FileSource` 之前**决定
 * （见 `arch/resourceDir.ts` 的 `decideResourceDir`），而本函数的调用时机在引擎建好之后。
 */
export function applyEmulatorOptionsToEngine(
  e: { engineValues: Map<number, number>; resourceVersion: ResourceVersion },
  optionsInput: EmulatorOptionsInput,
): string[] {
  const options = normalizeEmulatorOptions(optionsInput);
  const lines = applyEmulatorOptions(e.engineValues, options);
  e.resourceVersion = options.resources.version;
  lines.push(
    options.resources.version === 'jp'
      ? 'resources.version=jp ⇒ 字体面名落到未做 cnjp 替换的更纱黑体（res/fonts/SarasaGothicSC）'
      : 'resources.version=cnjp ⇒ 字体面名落到 Amayui CN（SJIS 占位编码的简体还原字体）',
  );
  return lines;
}
