/**
 * 主进程的**资源读取 IPC**：脚本字节 / 任意文件 / 引擎配置 / 图像（AGF 解码）。
 *
 * 文件访问统一经 `NodeFileSource`（fs 直读 `raw/` + ALF 切片），
 * 图像在这里就地解码成 top-down RGBA 再交给渲染进程（Node 侧有 zlib/fs）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ipcMain } from 'electron';
import { NodeFileSource } from '../../src/arch/nodeFileSource.js';
// 主进程跑 AGF 解码（Node 有 zlib/fs）。路径: electron/ipc/ -> ../../../../ = 仓库根
import { decodeAgfRgba } from '../../../../scripts/agf/format.js';
import { FONT_DIR, RAW_DIR, configIniCandidates } from '../paths.js';

const fileSource = new NodeFileSource({ rawDir: RAW_DIR });

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
  ipcMain.handle('read-config-ini', async () => {
    for (const p of configIniCandidates()) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        console.log(`[main] config ini -> ${p} (${text.length} bytes)`);
        return { path: p, text };
      } catch {
        /* 尝试下一个候选 */
      }
    }
    console.log('[main] config ini: 未找到 SYS4REG.INI（引擎字段用默认值）');
    return null;
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
