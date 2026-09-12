/**
 * 主进程的**资源读取 IPC**：脚本字节 / 任意文件 / 引擎配置 / 图像（AGF 解码）。
 *
 * 文件访问统一经 `NodeFileSource`（fs 直读资源根 `install/`（汉化版）+ ALF 切片），
 * 图像在这里就地解码成 top-down RGBA 再交给渲染进程（Node 侧有 zlib/fs）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ipcMain } from 'electron';
import { NodeFileSource } from '../../src/arch/nodeFileSource.js';
import { parseIni } from '../../src/engineConfig.js';
// 主进程跑 AGF 解码（Node 有 zlib/fs）。路径: electron/ipc/ -> ../../../../ = 仓库根
import { decodeAgfRgba } from '../../../../scripts/agf/format.js';
import { FONT_DIR, RESOURCE_DIR, SAVE_DATA_PATH, configIniCandidates } from '../paths.js';

const fileSource = new NodeFileSource({ resourceDir: RESOURCE_DIR });

/** `read-config-ini` 实际读到的那份 INI（`save-config-ini` 写回同一份）。 */
let configIniPath: string | null = null;

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

  // 读引擎配置文件 SYS4REG.INI 文本（启动时填充引擎字段用；见 src/engineConfig.ts）。
  // ★记下**实际读到的那一份**：写回时写同一个文件（避免"读 A 写 B"把配置写丢/写错地方）。
  ipcMain.handle('read-config-ini', async () => {
    for (const p of configIniCandidates()) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        configIniPath = p;
        console.log(`[main] config ini -> ${p} (${text.length} bytes)`);
        return { path: p, text };
      } catch {
        /* 尝试下一个候选 */
      }
    }
    console.log('[main] config ini: 未找到 SYS4REG.INI（引擎字段用默认值）');
    return null;
  });

  // 写回引擎配置（脚本用 SetConfig 族改了配置 ⇒ 渲染进程把整份 INI 文本发过来）。
  // 安全：只允许写 `configIniCandidates()` 里的路径（不接任意路径，避免把 IPC 变成任意文件写）。
  ipcMain.handle('save-config-ini', async (_e, text: string) => {
    if (typeof text !== 'string' || text.length === 0) return null;
    const target = configIniPath ?? configIniCandidates()[0]!;
    if (!configIniCandidates().includes(target)) {
      console.log(`[main] save-config-ini 拒绝非候选路径: ${target}`);
      return null;
    }
    // ★防丢键棘轮（与 NodeFileSource.saveConfig 同口径）：新文本的键数不得少于现有文件。
    try {
      const prev = fs.readFileSync(target, 'utf8');
      const count = (t: string): number => parseIni(t).values.size;
      if (count(text) < count(prev)) {
        console.log(
          `[main] save-config-ini 拒绝回写 ${target}：新文本 ${count(text)} 个键 < 磁盘 ${count(prev)} 个` +
            '（疑似配置未装载就写回）',
        );
        return null;
      }
    } catch {
      /* 原文件不存在 */
    }
    fs.writeFileSync(target, text, 'utf8');
    console.log(`[main] config ini <- ${target} (${text.length} bytes)`);
    return { path: target };
  });

  // ---- SAVE.DAT（`save-int`/`save-string` 表的持久化；设置界面的开关靠它跨会话保留）----
  // 读：优先本工程自己的 `<SAVE.DAT>.amayui`，其次引擎的 `SAVE.DAT`（后者只读，用于"继承玩家真存档"）。
  ipcMain.handle('read-save-data', async () => {
    for (const p of [`${SAVE_DATA_PATH}.amayui`, SAVE_DATA_PATH]) {
      try {
        const buf = fs.readFileSync(p);
        console.log(`[main] save data -> ${p} (${buf.length} bytes)`);
        return buf; // Buffer 经 IPC 到达渲染进程即 Uint8Array
      } catch {
        /* 试下一个 */
      }
    }
    console.log(`[main] save data: 无 ${SAVE_DATA_PATH}（首次启动 ⇒ 走 INITCONFIG 默认值分支）`);
    return null;
  });
  ipcMain.handle('write-save-data', async (_e, data: Uint8Array) => {
    if (!data || data.length === 0) return null;
    fs.mkdirSync(path.dirname(SAVE_DATA_PATH), { recursive: true });
    // ★绝不覆盖引擎格式的真存档：那种情况改写 `<SAVE.DAT>.amayui`（读取时优先它）。
    let target = SAVE_DATA_PATH;
    try {
      const prev = fs.readFileSync(SAVE_DATA_PATH);
      const format = prev.length >= 292 ? prev.readUInt32LE(284) : -1;
      const magic = prev.subarray(0, 4).toString('latin1');
      if (!(magic === 'S4SD' && format === 0)) {
        target = `${SAVE_DATA_PATH}.amayui`;
        console.log(`[main] save data: ${SAVE_DATA_PATH} 是引擎格式（format=${format}）⇒ 写到 ${target}`);
      }
    } catch {
      /* 原文件不存在 */
    }
    const tmp = path.join(path.dirname(target), '$$SAVE.DAT');
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, target);
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
