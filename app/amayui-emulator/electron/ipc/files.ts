/**
 * 主进程的**资源读取 IPC**：脚本字节 / 任意文件 / 引擎配置 / 图像（AGF 解码） / 玩家存档。
 *
 * 两条互不相干的路径：
 *  - **资源**（只读）：`install/`（汉化版）+ ALF 切片，经 `NodeFileSource`；图像在这里就地解码成
 *    top-down RGBA 再交给渲染进程（Node 侧有 zlib/fs）。
 *  - **玩家数据**（`SYS4REG.INI` / `SAVE\SAVE.DAT`）：走 `OverlayDir`（系统存档目录 + overlay）——
 *    读 overlay → base（真游戏），写只写 overlay ⇒ 继承玩家设置而**永不写坏真存档**。
 *    与 Node 侧（`run.ts`/`src/arch/nodeFileSource.ts`）共用同一份实现，避免两侧行为漂移。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ipcMain } from 'electron';
import { NodeFileSource } from '../../src/arch/nodeFileSource.js';
import { OverlayDir } from '../../src/arch/overlay.js';
import { INI_FILE, SAVE_DAT_REL } from '../../src/arch/systemPaths.js';
import { parseIni } from '../../src/engineConfig.js';
// 主进程跑 AGF 解码（Node 有 zlib/fs）。路径: electron/ipc/ -> ../../../../ = 仓库根
import { decodeAgfRgba } from '../../../../scripts/agf/format.js';
import { FONT_DIR, RESOURCE_DIR, SYSTEM_PATHS } from '../paths.js';

// 主进程侧的资源读取；log 把「扩展包扫描/注册」等一次性诊断写进主进程日志（与 logSystemPaths 同风格）
const fileSource = new NodeFileSource({ resourceDir: RESOURCE_DIR, log: (m) => console.log(`[main] ${m}`) });

/** 玩家数据的 overlay 层（`SYS4REG.INI` + `SAVE\SAVE.DAT`）。 */
const systemFiles = new OverlayDir(SYSTEM_PATHS, { log: (m) => console.log(`[main] ${m}`) });

/** 启动摘要：写清这次的 base/overlay 是哪两份目录。 */
export function logSystemPaths(): void {
  console.log(`[main] system dir (base) -> ${SYSTEM_PATHS.baseDir}`);
  console.log(`[main] system dir (overlay) -> ${SYSTEM_PATHS.overlayDir}`);
}

/** 防丢键棘轮（与 `NodeFileSource.saveConfig` 同口径）：新文本的键数不得少于当前生效的那份。 */
function configRatchetOk(text: string, prev: string | null): boolean {
  if (prev === null) return true;
  const count = (t: string): number => parseIni(t).values.size;
  if (count(text) >= count(prev)) return true;
  console.log(
    `[main] save-config-ini 拒绝回写：新文本 ${count(text)} 个键 < 现有 ${count(prev)} 个` +
      '（疑似配置未装载就写回）',
  );
  return false;
}

export function registerFileIpc(): void {
  // 读脚本（call-script 索引 -> 原始字节 + 文件名）
  ipcMain.handle('read-script', async (_e, index: number) => {
    const r = await fileSource.readScript(index);
    if (!r) return null;
    return { index: r.index, name: r.name, data: Array.from(r.data) };
  });

  // 读任意文件（原始字节）
  ipcMain.handle('read-file', async (_e, p: string) => {
    const b = await fileSource.readFile(p);
    return Array.from(b);
  });

  // 已装载的扩展包包号（升序）。渲染侧 0x143(i143) 用它派发各包的 $n$AUTORUN.BIN。
  // 扫描+注册在 NodeFileSource 内完成（扫资源根 *.AAI、按文件头 @264 的包号），与引擎 sub_455750 同口径。
  ipcMain.handle('append-packs', async () => await fileSource.appendPackNumbers());

  // 读引擎配置文件 SYS4REG.INI（启动时填充引擎字段用；见 src/engineConfig.ts）。
  // ★overlay 优先：有本工程写过的那份就用它，否则读真游戏那份（⇒ 继承玩家的显示/声音/文本设置）。
  ipcMain.handle('read-config-ini', async () => {
    const hit = await systemFiles.readText(INI_FILE);
    if (!hit) {
      console.log('[main] config ini: overlay/base 都没有 SYS4REG.INI（引擎字段用默认值）');
      return null;
    }
    console.log(`[main] config ini -> ${hit.path} (${hit.side}, ${hit.text.length} bytes)`);
    return { path: hit.path, text: hit.text, side: hit.side };
  });

  // 写回引擎配置（脚本用 SetConfig 族改了配置 ⇒ 渲染进程把整份 INI 文本发过来）。
  // 安全：**只写 overlay**（真游戏的 INI 一个字节都不动），所以不需要白名单路径校验。
  ipcMain.handle('save-config-ini', async (_e, text: string) => {
    if (typeof text !== 'string' || text.length === 0) return null;
    const prev = await systemFiles.readText(INI_FILE);
    if (!configRatchetOk(text, prev?.text ?? null)) return null;
    const target = await systemFiles.write(INI_FILE, text);
    console.log(`[main] config ini <- ${target} (${text.length} bytes)`);
    return { path: target };
  });

  // ---- SAVE.DAT（`save-int`/`save-string` 表的持久化；设置界面的开关靠它跨会话保留）----
  // 读：overlay → base（base 那份是真游戏的，引擎加密格式也照读：用于"继承玩家真存档"）。
  ipcMain.handle('read-save-data', async () => {
    const hit = await systemFiles.read(SAVE_DAT_REL);
    if (!hit) {
      console.log(
        `[main] save data: overlay/base 都没有 ${SAVE_DAT_REL}（首次启动 ⇒ 走 INITCONFIG 默认值分支）`,
      );
      return null;
    }
    console.log(`[main] save data -> ${hit.path} (${hit.side}, ${hit.data.length} bytes)`);
    return Buffer.from(hit.data); // Buffer 经 IPC 到达渲染进程即 Uint8Array
  });
  ipcMain.handle('write-save-data', async (_e, data: Uint8Array) => {
    if (!data || data.length === 0) return null;
    // ★只写 overlay：真存档（base）**永远**不被覆盖，所以不再需要"探测对方是不是引擎格式"。
    const target = await systemFiles.write(SAVE_DAT_REL, Buffer.from(data));
    console.log(`[main] save data <- ${target} (${data.length} bytes)`);
    return { path: target };
  });

  // 读内置字体文件（`res/fonts/<file>`）。**白名单式**：拒绝任何含 `..` 或绝对路径的请求。
  ipcMain.handle('font', async (_e, file: string) => {
    if (typeof file !== 'string' || file.length === 0) return null;
    const full = path.resolve(FONT_DIR, file);
    if (!full.startsWith(FONT_DIR + path.sep)) {
      console.log(`[main] font 拒绝越界路径: ${file}`);
      return null;
    }
    try {
      const buf = fs.readFileSync(full);
      console.log(`[main] font -> ${file} (${(buf.length / 1024).toFixed(0)}KB)`);
      // ★返回 Buffer 而不是 Array.from(buf)：CJK 字体 24MB，转成 number[] 会变成
      //   数千万个 JS number（structured clone 极慢且吃内存）。Buffer 经 IPC 到达渲染进程即 Uint8Array。
      return buf;
    } catch (err) {
      console.log(`[main] font 读取失败 ${file}: ${(err as Error).message}`);
      return null;
    }
  });

  // 按统一资源 id 取一张图像：resolveEntry(id) -> AGF 字节 -> 解码成 top-down RGBA
  ipcMain.handle('image', async (_e, id: number) => {
    const r = await fileSource.readById(id);
    if (!r) return null;
    const img = decodeAgfRgba(r.data);
    if (!img) return null;
    // Buffer 经 structured clone 到 renderer 变 Uint8Array
    return { name: r.name, width: img.width, height: img.height, data: img.rgba };
  });
}
