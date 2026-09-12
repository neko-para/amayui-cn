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

// ★玩家数据（`SYS4REG.INI` / `SAVE\SAVE.DAT`）**不在**这里解析：它们走系统存档目录 + overlay，
//   见 `systemPaths.ts`（base/overlay 的唯一解析点）与 `overlay.ts`（读 overlay→base、写只写 overlay）。
//   旧实现把"随工程的 app/amayui-emulator/SAVE/SAVE.DAT"当默认值，既会把仓库当存档区、
//   又会用 `SAVE.DAT.amayui` 后缀去规避覆盖真存档 —— 已废弃。
