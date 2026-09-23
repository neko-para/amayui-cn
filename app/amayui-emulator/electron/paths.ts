/**
 * 主进程的路径常量。
 *
 * 单独成文件的原因：路径是"安装布局知识"（dist 相对仓库根、资源目录、玩家数据在哪），
 * 原先散在 IPC 处理器里，改一处布局要在处理器之间找。集中后只有这一处需要维护。
 */
import * as path from 'node:path';
import { describeResourcesLine } from '../src/arch/resourceDir.js';
import { loadEmulatorOptions, resourceDirOf } from '../src/emulatorOptionsFile.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
// ★默认实例的布局（`tickets/T-0134` WS-3）：log/trace/replay 三个路径从这里取，口径只有一份。
import { instanceLayout } from '../src/host/instance.js';

/**
 * 仓库根。运行时 `__dirname` = `<repo>/app/amayui-emulator/dist/electron`，
 * 因此向上 4 级 = 仓库根。
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * **外置选项（`emulator.config.json`）在主进程只读一次**。
 *
 * 为什么在这里读而不是各 IPC 处理器各读一遍：资源根必须在建 `FileSource` 之前定下来
 * （`resources.path`），而渲染进程要从同一份文本里拿 `boot.showLogo`/`resources.version`
 * ⇒ 读一次、两边共用（`read-emulator-options` 直接回这份 `text`）。
 * ⚠️ 进程存活期间改文件不会热重载（渲染进程本来也只在 boot 时读一次）。
 */
export const EMULATOR_OPTIONS = loadEmulatorOptions(REPO_ROOT);

/**
 * 游戏资源目录：**`CLI --resources`（此处无）> `AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`**。
 * `resources.path` 的相对基准 = 生效的 config 文件所在目录（见 `src/arch/resourceDir.ts` 的 `decideResourceDir`）。
 */
export const RESOURCE_DECISION = resourceDirOf(EMULATOR_OPTIONS, REPO_ROOT);
export const RESOURCE_DIR = RESOURCE_DECISION.dir;

/** 启动摘要里的一行：生效的资源根 + 资源版本（同一行，便于核对两者是否配套）。 */
export function describeResourceDir(): string {
  return describeResourcesLine(EMULATOR_OPTIONS.options, RESOURCE_DECISION);
}

/**
 * **玩家数据**（`SYS4REG.INI` + `SAVE\SAVE.DAT`）= 系统存档目录 + overlay 一对目录：
 * 读 overlay → base（真游戏），写只写 overlay。见 `src/arch/systemPaths.ts` / `src/arch/overlay.ts`。
 *
 * 默认 base = `%LOCALAPPDATA%\Eushully\天結いキャッスルマイスター`（真游戏那层目录，含 `SYS4REG.INI`
 * 与 `SAVE\`），overlay = 同级的 `….overlay\`。可用 `AMAYUI_SYSTEM_DIR` / `AMAYUI_OVERLAY_DIR` 覆盖。
 * 脚本 `save-int`/`save-string` 登记的两张表就写在 overlay 的 `SAVE\SAVE.DAT` —— 设置界面的开关靠它跨会话保留。
 */
export const SYSTEM_PATHS = resolveSystemPaths(REPO_ROOT);

/** 内置字体目录（渲染进程经 IPC `font` 通道读取；见 src/text/fontSet.ts）。 */
export const FONT_DIR = path.join(REPO_ROOT, 'res', 'fonts');

/**
 * **默认实例的布局**（`tickets/T-0134` WS-3：单例 → 实例化的第一步）。
 *
 * 为什么从这里取而不是本文件自己 `path.join`：路径口径只能有**一份**
 * （`T-0133` §B.3.3 坑 2）。这三个常量仍是**默认实例**的值 ⇒ Electron 路径**零行为变更**
 * （`AMAYUI_REPLAY_PATH` / `AMAYUI_SYSTEM_DIR` / `AMAYUI_OVERLAY_DIR` 照旧生效），
 * 而具名实例走 `<repo>/.tmp/instances/<id>/{base,overlay,log/…}`。
 */
export const DEFAULT_LAYOUT = instanceLayout({ repoRoot: REPO_ROOT });
/** 诊断日志文件（renderer 经 'log-line' IPC 追加到此处）。 */
export const LOG_PATH = DEFAULT_LAYOUT.logPath;
/** 结构化指令轨迹（renderer 经 'append-trace-line' IPC 追加 JSON 行；见控制窗「定向 trace」）。 */
export const TRACE_PATH = DEFAULT_LAYOUT.tracePath;
/**
 * **回放轨迹**（renderer 经 'append-replay-line' IPC 追加 JSON 行：时钟 + 输入 + digest）。
 * `tools/record.cjs` 启动时用 `AMAYUI_REPLAY_PATH` 指定本次录到哪个文件
 * （缺省 `.tmp/replay-trace.jsonl.gz`；主进程按 **gzip** 写，见 `logging.ts`）。
 */
export const REPLAY_PATH = DEFAULT_LAYOUT.replayPath;

/** 打包后的 preload（两个窗口共用；见 windows.ts 的权限说明）。 */
export const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
export const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
export const CONTROL_HTML = path.join(__dirname, '..', 'control', 'index.html');
