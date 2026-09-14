/**
 * **资源根目录的唯一解析点**。
 *
 * 为什么要有这个文件：资源根原先散落在 4 处（`electron/paths.ts` 的 `RAW_DIR`、
 * `src/run.ts`、`src/report.ts`、`src/tools/config1Chain.ts`），5 个测试又各自硬编码了一遍
 * `path.join(ROOT, 'raw')` —— 于是"换一套资源"要改 9 个地方，而且**测试测的语料与产品读的语料可以悄悄不一致**。
 *
 * 现在的约定：
 *  - 默认根 = 仓库根的 **`install/`**（= **汉化版**安装目录：松散 `.BIN` 脚本 + 打过补丁的
 *    `DATA*.ALF` / `APPEND0n.AAI` + `SYS4INI.BIN` 索引）。理由：emulator 的产物目标是
 *    "跑汉化版游戏"，界面/文本必须来自汉化资源，否则又会出现"测试对、画面是日文"的漂移；
 *  - 可用环境变量 **`AMAYUI_RESOURCE_DIR`** 覆盖（绝对路径，或相对仓库根）——
 *    对比原版（`raw/`，是指向日文安装目录的 junction）时用它：
 *    `$env:AMAYUI_RESOURCE_DIR='raw'; npm run report -- --steps 200000`；
 *  - ★也可由 `emulator.config.json` 的 **`resources.path`** 指定（相对路径以**该 config 文件所在目录**
 *    为基准）—— 它是**持久默认值**，优先级**低于**环境变量/CLI：
 *    `CLI --resources` > `AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`（唯一权威 = `decideResourceDir`）。
 *  - 本模块**刻意不使用 `import.meta`**：它同时被 Electron 主进程（esbuild 打成 CJS）与
 *    Node 工具（tsx/ESM）引用，`import.meta` 在 CJS 产物里会报错。
 *  - ★`decideResourceDir` 是**纯函数**（不读任何文件）：读 `emulator.config.json` 是调用方的事
 *    （`src/emulatorOptionsFile.ts`），这样库入口/工具的默认值不会取决于开发机上的一个 JSON。
 */
import * as path from 'node:path';

/** 默认资源目录名（仓库根下的汉化版安装目录）。 */
export const DEFAULT_RESOURCE_DIR_NAME = 'install';

/** 覆盖用环境变量名。 */
export const RESOURCE_DIR_ENV = 'AMAYUI_RESOURCE_DIR';

/** 资源根实际来自哪里（`decideResourceDir` 的结论；日志也按它措辞）。 */
export type ResourceDirSource = 'cli' | 'env' | 'config' | 'default';

/** `decideResourceDir` 的输入（全部可选；不给 = 默认 `install/`）。 */
export interface ResourceDirInput {
  /** CLI `--resources`（最高优先；相对路径按**仓库根**解析，与既有 `--resources` 用法一致）。 */
  cli?: string;
  /** 环境变量来源（测试可注入；默认 `process.env`）。 */
  env?: NodeJS.ProcessEnv;
  /** `emulator.config.json` 的 `resources.path`（未设 = 不参与）。 */
  configResourcePath?: string;
  /** 生效的 config 文件所在目录（`configResourcePath` 的相对基准；缺省 = 仓库根，仅在"选项不是从文件读来的"时兜底）。 */
  configDir?: string;
}

/** 资源根的解析结论。 */
export interface ResourceDirDecision {
  /** 最终资源根（绝对路径；相对输入已按来源基准解析）。 */
  dir: string;
  /** 哪个来源赢了。 */
  source: ResourceDirSource;
  /** 该来源给出的原值（`default` 时 undefined）。 */
  raw?: string;
}

const nonEmpty = (s: string | undefined): string | undefined => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > 0 ? t : undefined;
};

/** 相对路径按 base 解析，绝对路径直接采用（与 `resolveOptionsPath` 同一套约定）。 */
const resolveAgainst = (base: string, p: string): string => (path.isAbsolute(p) ? p : path.join(base, p));

/**
 * **资源根的唯一权威解析**：`CLI --resources` > `AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`。
 *
 * 为什么是这个顺序：环境变量/CLI 是**单次调用的临时覆盖**（测试、临时对比原版照旧可用），
 * `emulator.config.json` 里的 `resources.path` 是**持久默认值**。
 *
 * ★`configResourcePath` 的相对基准是 `configDir`（= **生效的 config 文件所在目录**），
 *   不是仓库根、也不是 cwd —— `AMAYUI_EMULATOR_CONFIG` 把 options 文件指到别处时基准随之改变。
 */
export function decideResourceDir(repoRoot: string, input: ResourceDirInput = {}): ResourceDirDecision {
  const cli = nonEmpty(input.cli);
  if (cli) return { dir: resolveAgainst(repoRoot, cli), source: 'cli', raw: cli };

  const env = input.env ?? process.env;
  const fromEnv = nonEmpty(env[RESOURCE_DIR_ENV]);
  if (fromEnv) return { dir: resolveAgainst(repoRoot, fromEnv), source: 'env', raw: fromEnv };

  const fromConfig = nonEmpty(input.configResourcePath);
  if (fromConfig) {
    return { dir: resolveAgainst(input.configDir ?? repoRoot, fromConfig), source: 'config', raw: fromConfig };
  }

  return { dir: path.join(repoRoot, DEFAULT_RESOURCE_DIR_NAME), source: 'default' };
}

/**
 * 解析资源根目录（**兼容旧签名**：只看环境变量 + 默认）。
 *
 * ★这是库入口/工具的默认值口径 —— **不读** `emulator.config.json`，所以测试结果不会取决于
 *   开发机上的一个 JSON。要让配置里的 `resources.path` 生效，请由 CLI 入口调 `decideResourceDir`
 *   并把结论作为显式 `resourceDir` 传下去（或走 `emulatorOptionsFile.ts` 的 `resourceDirOf`）。
 */
export function resolveResourceDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return decideResourceDir(repoRoot, { env }).dir;
}

/**
 * 人类可读的一行：**同一行**打印生效的 `resources.path` 与 `resources.version`。
 *
 * 为什么两者必须同一行：`version` 缺省恒为 `cnjp`、**不**根据路径名猜测（路径不可靠），
 * 所以"换了 `resources.path` 却忘改 `resources.version`"只能靠这行当场看出来。
 */
export function describeResourcesLine(options: { resources: { version: string } }, d: ResourceDirDecision): string {
  const src = d.source === 'default' ? '默认' : `${d.source}: ${d.raw}`;
  return `resources: version=${options.resources.version} path=${d.dir}（来源=${src}）`;
}

// ★玩家数据（`SYS4REG.INI` / `SAVE\SAVE.DAT`）**不在**这里解析：它们走系统存档目录 + overlay，
//   见 `systemPaths.ts`（base/overlay 的唯一解析点）与 `overlay.ts`（读 overlay→base、写只写 overlay）。
//   旧实现把"随工程的 app/amayui-emulator/SAVE/SAVE.DAT"当默认值，既会把仓库当存档区、
//   又会用 `SAVE.DAT.amayui` 后缀去规避覆盖真存档 —— 已废弃。
