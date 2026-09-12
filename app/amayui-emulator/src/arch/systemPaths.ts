/**
 * **系统存档目录（game system dir）与它的 overlay 目录 —— 唯一解析点**。
 *
 * 为什么要有 overlay：`SAVE.DAT`（脚本 `save-int`/`save-string` 表）与 `SYS4REG.INI` 都是**玩家数据**，
 * emulator 既要**继承**它们（否则设置界面每次都是首次启动），又**绝不能写坏**真游戏的文件
 * （`<LOCALAPPDATA>\Eushully\<game>\` 下是玩家几十个存档槽 + 真配置）。做法是照 OverlayFS 的口径：
 *
 * ```text
 * 读：  <overlay>/<rel>  有 ⇒ 用它          没有 ⇒ <base>/<rel>
 * 写：  只写 <overlay>/<rel>（base 一个字节都不动）
 * ```
 *
 * 于是「继承玩家设置」与「不破坏数据」两件事同时成立，而且**不需要任何后缀 hack**
 * （旧实现是往真存档旁边写 `SAVE.DAT.amayui`，读时优先它 —— 一旦解码器修好，
 * 那份旧文件还会把过时的设置喂回来，见 docs-new/03-engine/save-data.md）。
 *
 * 目录布局（默认）：
 * ```text
 * base    = %LOCALAPPDATA%\Eushully\天結いキャッスルマイスター\
 * overlay = %LOCALAPPDATA%\Eushully\天結いキャッスルマイスター.overlay\      ← 与 base 同级（删掉即彻底复原）
 * ```
 * overlay 与 base **结构镜像**：`SYS4REG.INI`、`SAVE\SAVE.DAT`（将来还有 `SAVE\SAVEnn.DAT` / `RT.DAT`）。
 *
 * 本模块**刻意不用 `import.meta`**（与 `resourceDir.ts` 同理：Electron 主进程会打成 CJS）。
 */
import * as path from 'node:path';

/** 覆盖系统存档目录（= 真游戏那层目录，不是 `SAVE/` 子目录）的环境变量。 */
export const SYSTEM_DIR_ENV = 'AMAYUI_SYSTEM_DIR';

/** 覆盖 overlay 目录的环境变量。 */
export const OVERLAY_DIR_ENV = 'AMAYUI_OVERLAY_DIR';

/** 旧环境变量：指向 `SAVE/` 子目录；现按「它的上一级 = base」兼容。 */
export const LEGACY_SAVE_DIR_ENV = 'AMAYUI_SAVE_DIR';

/** `%LOCALAPPDATA%` 下的厂商目录名。 */
export const EUSHULLY_DIR_NAME = 'Eushully';

/** 本作的系统存档目录名（`%LOCALAPPDATA%\Eushully\<这个名字>`）。 */
export const DEFAULT_SYSTEM_DIR_NAME = '天結いキャッスルマイスター';

/** overlay 目录名 = base 目录名 + 该后缀（同级）。 */
export const OVERLAY_SUFFIX = '.overlay';

/** 没有 `LOCALAPPDATA`（非 Windows / CI）时的退化位置：仓库 `.tmp/` 下（gitignored 的草稿区）。 */
export const FALLBACK_APPDATA_REL = path.join('.tmp', 'appdata');

/** 系统存档目录下的逻辑文件名（overlay 与 base 共用同一套相对路径）。 */
export const INI_FILE = 'SYS4REG.INI';
/** `SAVE.DAT` 相对系统存档目录的路径（引擎在这里放"设置 + 存档槽共用"的那份）。 */
export const SAVE_DAT_REL = path.join('SAVE', 'SAVE.DAT');
/** 存档子目录名（`SAVEnn.DAT` / `RT.DAT` 都在这下面）。 */
export const SAVE_SUBDIR = 'SAVE';

/** base + overlay 一对目录。 */
export interface SystemPaths {
  /** 真游戏的系统存档目录（**只读**的一方）。 */
  baseDir: string;
  /** 本工程自己的目录（读优先、写唯一目标）。 */
  overlayDir: string;
}

function nonEmpty(v: string | undefined): string | null {
  return v && v.trim().length > 0 ? v.trim() : null;
}

function asAbs(p: string, repoRoot: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.join(repoRoot, p);
}

/**
 * 解析 base / overlay 两个目录。
 *
 * 优先级：
 *  1. `AMAYUI_SYSTEM_DIR`（base）+ `AMAYUI_OVERLAY_DIR`（overlay，缺省 = `<base>.overlay`）；
 *  2. 兼容 `AMAYUI_SAVE_DIR`（旧口径 = `SAVE/` 子目录 ⇒ base 取它的上一级）；
 *  3. 默认 `%LOCALAPPDATA%\Eushully\天結いキャッスルマイスター`；无 `LOCALAPPDATA` 时退到 `<repo>/.tmp/appdata/…`。
 */
export function resolveSystemPaths(repoRoot: string, env: NodeJS.ProcessEnv = process.env): SystemPaths {
  let baseDir: string;
  const explicit = nonEmpty(env[SYSTEM_DIR_ENV]);
  if (explicit) {
    baseDir = asAbs(explicit, repoRoot);
  } else {
    const legacy = nonEmpty(env[LEGACY_SAVE_DIR_ENV]);
    if (legacy) {
      // 旧口径指的是 `…\<game>\SAVE` ⇒ base = 上一级（`<game>`）
      baseDir = path.dirname(asAbs(legacy, repoRoot));
      // eslint-disable-next-line no-console
      console.warn(
        `[overlay] ${LEGACY_SAVE_DIR_ENV} 是旧口径（指向 SAVE/ 子目录）；已按 base=${baseDir} 处理，` +
          `建议改用 ${SYSTEM_DIR_ENV}=<game 目录>`,
      );
    } else {
      const localAppData = nonEmpty(env.LOCALAPPDATA);
      baseDir = localAppData
        ? path.join(localAppData, EUSHULLY_DIR_NAME, DEFAULT_SYSTEM_DIR_NAME)
        : path.join(repoRoot, FALLBACK_APPDATA_REL, EUSHULLY_DIR_NAME, DEFAULT_SYSTEM_DIR_NAME);
    }
  }
  const overlayEnv = nonEmpty(env[OVERLAY_DIR_ENV]);
  const overlayDir = overlayEnv ? asAbs(overlayEnv, repoRoot) : `${baseDir}${OVERLAY_SUFFIX}`;
  return { baseDir, overlayDir };
}

/** 一行摘要（启动日志/诊断用：写清"这次读的是哪两份"）。 */
export function describeSystemPaths(p: SystemPaths): string {
  return `base=${p.baseDir} overlay=${p.overlayDir}`;
}
