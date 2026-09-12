/**
 * 主进程的路径常量。
 *
 * 单独成文件的原因：路径是"安装布局知识"（dist 相对仓库根、资源目录、玩家数据在哪），
 * 原先散在 IPC 处理器里，改一处布局要在处理器之间找。集中后只有这一处需要维护。
 */
import * as path from 'node:path';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';

/**
 * 仓库根。运行时 `__dirname` = `<repo>/app/amayui-emulator/dist/electron`，
 * 因此向上 4 级 = 仓库根。
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * 游戏资源目录：默认 **`install/`（汉化版）** —— 松散 BIN / 打过补丁的 ALF 归档 / SYS4INI 索引。
 * 可用 `AMAYUI_RESOURCE_DIR` 覆盖（对比原版：`AMAYUI_RESOURCE_DIR=raw`）。见 `src/arch/resourceDir.ts`。
 */
export const RESOURCE_DIR = resolveResourceDir(REPO_ROOT);

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

/** 诊断日志文件（renderer 经 'log-line' IPC 追加到此处）。 */
export const LOG_PATH = path.join(REPO_ROOT, '.tmp', 'amayui-emulator.log');
/** 结构化指令轨迹（renderer 经 'append-trace-line' IPC 追加 JSON 行；见控制窗「定向 trace」）。 */
export const TRACE_PATH = path.join(REPO_ROOT, '.tmp', 'scene-trace.jsonl');

/** 打包后的 preload（两个窗口共用；见 windows.ts 的权限说明）。 */
export const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
export const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
export const CONTROL_HTML = path.join(__dirname, '..', 'control', 'index.html');
