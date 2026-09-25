/**
 * **实例布局（instance layout）** —— 一个调试会话的 base / overlay / log / trace / replay 落点。
 *
 * ## 为什么要有它（`tickets/T-0133` §B.3、`T-0134` WS-3 冻结接口）
 *
 * 在 Electron 时代，"一个 emulator 进程 = 一个会话"是**白送**的：`electron/paths.ts` 的
 * `LOG_PATH`/`TRACE_PATH` 与 `electron/ipc/files.ts` 的 `fileSource`/`systemFiles` 都是**模块级单例**。
 * 一旦要"agent 调试时人能看到 / 多个调试会话并行"，单例就成了拦路虎：两个实例会共用日志、
 * 共用 overlay（存档互踩）。
 *
 * 本模块把"一个会话的落点"算成**纯数据**（不碰 fs、不碰 Electron、不改 `process.env`），
 * 于是调用方可以：
 *  - 默认实例（`id: 'default'`）= **现状路径**（`<repo>/.tmp/amayui-emulator.log` 等）⇒ 零行为变更；
 *  - 具名实例 = `<repo>/.tmp/instances/<id>/{base,overlay,log/…}` ⇒ 与其它实例、与真游戏数据**全隔离**。
 *
 * ## 两个必须做对的地方（都来自 `T-0133` §B.3.3 的坑）
 *
 * 1. **base 也必须 per-instance**：`readSaveDataBoth` / `readSaveFlags` 会**并上 base**
 *    （`electron/ipc/files.ts`），所以若 base 仍指向真游戏的
 *    `%LOCALAPPDATA%\Eushully\天結…`，调试实例会**继承玩家的真实存档** ⇒ 既不可复现，也谈不上隔离。
 *    ⇒ 具名实例的 base **不查** `resolveSystemPaths`，直接用 `<root>/base`（空目录即"干净档"）；
 *      要"从某个模板 seed"就显式传 `baseDir`。
 * 2. **不改 `process.env`**：`resolveSystemPaths(repoRoot, env)` 的 `env` 是**函数参数**
 *    （`src/arch/systemPaths.ts:88`）⇒ 多实例各传一份即可；本模块同样只经参数收 `env`。
 *
 * ★本模块**刻意不用 `import.meta`**（与 `arch/systemPaths.ts`、`arch/resourceDir.ts` 同理：
 *   Electron 主进程会打成 CJS）；`repoRoot` 因此由调用方显式给（Electron 侧给 `paths.ts` 的 `REPO_ROOT`）。
 */
import * as path from 'node:path';
import { resolveSystemPaths } from '../arch/systemPaths.js';

/** 默认实例的 id（= 现状：单实例、路径与重构前一致）。 */
export const DEFAULT_INSTANCE_ID = 'default';

/** 具名实例的根目录相对仓库根的位置（gitignored 的临时区，与 `.tmp/` 其余草稿同处）。 */
export const INSTANCES_DIR_REL = path.join('.tmp', 'instances');

/** 实例 id 的合法形状：**必须是纯文件名安全串**（会进路径，防 `../..` 逃逸）。 */
const INSTANCE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * **一个实例的全部落点**（纯数据；目录可能还不存在 —— 建目录是写者的事，`HostService` 负责）。
 */
export interface InstanceLayout {
  /** 实例 id（`default` 或具名）。 */
  id: string;
  /** 实例根目录（默认实例 = 仓库根的 `.tmp/` 语义，见上）。 */
  root: string;
  /** 只读的一方：真游戏存档目录（默认实例）或实例自己的 `base/`（具名实例）。 */
  baseDir: string;
  /** 唯一写目标：`SYS4REG.INI` / `SAVE.DAT` / 存档槽都只落这里。 */
  overlayDir: string;
  /** 诊断日志（`renderer` 经 `log-line` / 同步 `log-line-sync` 追加）。 */
  logPath: string;
  /** 结构化指令轨迹（`append-trace-line`）。 */
  tracePath: string;
  /** 回放轨迹（`append-replay-line`，gzip）。 */
  replayPath: string;
  /**
   * **调试取证落点**（`writeDebugArtifact`：`capture` 的 PNG、将来的其它抓帧产物）。
   *
   * ★为什么单独一项而不是复用 `root`：`capture` 的消费方是**仓库侧的工具**（DSH 插件
   *   `plugins/amayui-emulator/lib/tools.js` 固定读 `<repo>/.tmp/emudbg/`），所以默认实例
   *   必须落在 `<repo>/.tmp/emudbg`；具名实例落在 `<root>/emudbg`（实例自带、互不串）。
   *   路径不跟着 `logPath` 走（那个对具名实例在 `<root>/log/` 下，与插件的约定不一致）。
   */
  debugArtifactDir: string;
}

/** `instanceLayout` 的入参。 */
export interface InstanceOptions {
  /** 实例 id；缺省 `DEFAULT_INSTANCE_ID`。非法（含路径分隔符/`..`）⇒ 抛错。 */
  id?: string;
  /** **仓库根**（解析相对路径的基准）。★必填：本模块不能用 `import.meta`/`__dirname` 猜。 */
  repoRoot: string;
  /** 实例根目录；缺省 `<repoRoot>/.tmp/instances/<id>`（默认实例不用它）。 */
  root?: string;
  /**
   * 覆盖 base（= 只读的那一方）。**具名实例**想"从模板/真存档 seed 一份干净档"时显式传它；
   * 不传就 `<root>/base`（空目录）。默认实例不传则走 `resolveSystemPaths`（= 现状：读真游戏那份）。
   */
  baseDir?: string;
  /** 环境变量来源（缺省 `process.env`）。**只读**：本模块不改它（`T-0133` §B.3.3 坑 2）。 */
  env?: NodeJS.ProcessEnv;
}

/** 校验并归一化实例 id。 */
function normalizeId(id: string | undefined): string {
  const v = (id ?? DEFAULT_INSTANCE_ID).trim();
  if (!INSTANCE_ID_RE.test(v)) {
    throw new Error(
      `非法实例 id：${JSON.stringify(id)}（只允许 [A-Za-z0-9._-]{1,64}；它会被拼进路径，必须防逃逸）`,
    );
  }
  return v;
}

/**
 * 算出一个实例的布局。**纯函数**（不建目录、不读盘、不改 `process.env`）。
 *
 * 默认实例（`id === 'default'`）刻意**完全等于重构前的三处常量**：
 * `LOG_PATH = <repo>/.tmp/amayui-emulator.log`、`TRACE_PATH = <repo>/.tmp/scene-trace.jsonl`、
 * `REPLAY_PATH = $AMAYUI_REPLAY_PATH ?? <repo>/.tmp/replay-trace.jsonl.gz`
 * ⇒ 保住"零行为变更"这条硬要求（`electron/paths.ts` 仍导出这三个常量）。
 */
export function instanceLayout(opts: InstanceOptions): InstanceLayout {
  const id = normalizeId(opts.id);
  const repoRoot = opts.repoRoot;
  const tmpDir = path.join(repoRoot, '.tmp');
  const env = opts.env ?? process.env;

  if (id === DEFAULT_INSTANCE_ID) {
    // ── 默认实例：与重构前逐字一致（含 AMAYUI_SYSTEM_DIR / AMAYUI_OVERLAY_DIR / AMAYUI_REPLAY_PATH）──
    const sys = resolveSystemPaths(repoRoot, env);
    return {
      id,
      root: tmpDir,
      baseDir: opts.baseDir ?? sys.baseDir,
      overlayDir: sys.overlayDir,
      logPath: path.join(tmpDir, 'amayui-emulator.log'),
      tracePath: path.join(tmpDir, 'scene-trace.jsonl'),
      replayPath: env.AMAYUI_REPLAY_PATH || path.join(tmpDir, 'replay-trace.jsonl.gz'),
      // ★与插件（`plugins/amayui-emulator/lib/tools.js` 的 `.tmp/emudbg`）**同一处**：capture 的 PNG
      //   由宿主直接写这里，回执只带相对路径 ⇒ 那条 JSON 腿不再搬 1.8MB 的 base64。
      debugArtifactDir: path.join(tmpDir, 'emudbg'),
    };
  }

  // ── 具名实例：base/overlay/log 全在实例根下（★base 不查 resolveSystemPaths ⇒ 不继承玩家真存档）──
  const root = opts.root ?? path.join(tmpDir, 'instances', id);
  const logDir = path.join(root, 'log');
  return {
    id,
    root,
    baseDir: opts.baseDir ?? path.join(root, 'base'),
    overlayDir: env.AMAYUI_OVERLAY_DIR
      ? path.resolve(repoRoot, env.AMAYUI_OVERLAY_DIR)
      : path.join(root, 'overlay'),
    logPath: path.join(logDir, 'amayui-emulator.log'),
    tracePath: path.join(logDir, 'scene-trace.jsonl'),
    replayPath: env.AMAYUI_REPLAY_PATH || path.join(logDir, 'replay-trace.jsonl.gz'),
    // ★具名实例：产物落在**实例自己的**根下（与 base/overlay/log 同一份隔离）；默认实例见上。
    //   自定义 `root` 时落 `<root>/emudbg`，`writeDebugArtifact` 回的是**相对该目录**的文件名
    //   ⇒ "宿主写 `<dir>/<name>`、消息里的路径由 <dir> 拼出"这条不变量两种实例都成立。
    debugArtifactDir: path.join(root, 'emudbg'),
  };
}

/** 是不是默认实例（调用方据此决定"要不要走现状路径/要不要隔离"）。 */
export function isDefaultInstance(id: string): boolean {
  return id === DEFAULT_INSTANCE_ID;
}

/** 一行摘要（启动日志/诊断用；与 `describeSystemPaths` 同风格）。 */
export function describeInstance(l: InstanceLayout): string {
  return `instance=${l.id} base=${l.baseDir} overlay=${l.overlayDir} log=${l.logPath}`;
}
