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
 *  - 本模块**刻意不使用 `import.meta`**：它同时被 Electron 主进程（esbuild 打成 CJS）与
 *    Node 工具（tsx/ESM）引用，`import.meta` 在 CJS 产物里会报错。
 */
import * as path from 'node:path';

/** 默认资源目录名（仓库根下的汉化版安装目录）。 */
export const DEFAULT_RESOURCE_DIR_NAME = 'install';

/** 覆盖用环境变量名。 */
export const RESOURCE_DIR_ENV = 'AMAYUI_RESOURCE_DIR';

/**
 * 解析资源根目录。
 * @param repoRoot 仓库根（调用方各自已经从自己的模块位置算好）。
 * @param env 注入用（测试可传自己的对象；默认 `process.env`）。
 */
export function resolveResourceDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[RESOURCE_DIR_ENV];
  if (override && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.join(repoRoot, override);
  }
  return path.join(repoRoot, DEFAULT_RESOURCE_DIR_NAME);
}

/** 默认存档目录（仓库根下，随工程的 `SAVE/`）。 */
export const DEFAULT_SAVE_DIR_NAME = path.join('app', 'amayui-emulator', 'SAVE');

/** 覆盖用环境变量名（指向真游戏的存档目录即可"继承"玩家的设置，注意本工程会写明文格式）。 */
export const SAVE_DIR_ENV = 'AMAYUI_SAVE_DIR';

/**
 * 解析 `SAVE.DAT` 的完整路径。
 *
 * 默认 `app/amayui-emulator/SAVE/SAVE.DAT`（**随工程**，这样"改了设置 → 关掉 → 再开还在"
 * 可复现、也不会污染真游戏目录）。`AMAYUI_SAVE_DIR` 可指向任意目录（含真游戏的
 * `%LOCALAPPDATA%\Eushully\<game>\SAVE`）—— 但请留意：真存档是引擎加密格式，
 * 本工程**认不出**时会先备份成 `SAVE.DAT.engine.bak` 再写自己的格式（见 `NodeFileSource.writeSaveData`）。
 */
export function resolveSaveDataPath(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[SAVE_DIR_ENV];
  const dir =
    override && override.trim().length > 0
      ? path.isAbsolute(override)
        ? override
        : path.join(repoRoot, override)
      : path.join(repoRoot, DEFAULT_SAVE_DIR_NAME);
  return path.join(dir, 'SAVE.DAT');
}
