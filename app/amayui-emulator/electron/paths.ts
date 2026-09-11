/**
 * 主进程的路径常量。
 *
 * 单独成文件的原因：路径是"安装布局知识"（dist 相对仓库根、raw 目录、INI 的候选位置），
 * 原先散在 IPC 处理器里，改一处布局要在处理器之间找。集中后只有这一处需要维护。
 */
import * as path from 'node:path';

/**
 * 仓库根。运行时 `__dirname` = `<repo>/app/amayui-emulator/dist/electron`，
 * 因此向上 4 级 = 仓库根。
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** 游戏原始资源目录（松散 BIN / ALF 归档）。 */
export const RAW_DIR = path.join(REPO_ROOT, 'raw');

/** 诊断日志文件（renderer 经 'log-line' IPC 追加到此处）。 */
export const LOG_PATH = path.join(REPO_ROOT, '.tmp', 'amayui-emulator.log');
/** 结构化指令轨迹（renderer 经 'append-trace-line' IPC 追加 JSON 行；见控制窗「定向 trace」）。 */
export const TRACE_PATH = path.join(REPO_ROOT, '.tmp', 'scene-trace.jsonl');

/** 打包后的 preload（两个窗口共用；见 windows.ts 的权限说明）。 */
export const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
export const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
export const CONTROL_HTML = path.join(__dirname, '..', 'control', 'index.html');

/**
 * `SYS4REG.INI` 的查找顺序：
 *  1. 随工程放的副本（`app/amayui-emulator/SYS4REG.INI`）；
 *  2. 仓库根；
 *  3. 游戏安装目录（`raw/` 的上一级）。
 */
export function configIniCandidates(): string[] {
  return [
    path.join(REPO_ROOT, 'app', 'amayui-emulator', 'SYS4REG.INI'),
    path.join(REPO_ROOT, 'SYS4REG.INI'),
    path.join(REPO_ROOT, '..', 'SYS4REG.INI'),
  ];
}
