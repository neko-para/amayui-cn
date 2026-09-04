/**
 * Electron 主进程（渲染壳）。
 * 职责：
 *  - 打开一个 640×480 窗口（游戏内部渲染分辨率，见 engine.cpp _this[699168]/[699172]），
 *    标题 = 游戏名（SetGameName 配置）。
 *  - 提供文件访问 IPC：renderer 通过 IpcFileSource 把"读脚本/读文件"交给本进程，
 *    本进程复用 NodeFileSource（fs 直读 raw/ + ALF 切片）。
 *  - renderer 侧用 Canvas 2D 作为起始渲染后端（技术评估见 docs/08-render-backend.md）。
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
// 主进程跑 AGF 解码（Node 有 zlib/fs）。路径: electron/ -> ../../.. = 仓库根
import { decodeAgfRgba } from '../../../scripts/agf/format.js';

// dist/electron/main.cjs -> app/amayui-emulator/dist/electron -> 仓库根 = 上4级
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RAW_DIR = path.join(REPO_ROOT, 'raw');

const fileSource = new NodeFileSource({ rawDir: RAW_DIR });

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true, // 内容区 1280×720（真实视口，见 docs/10 §4）；renderer 的 Pixi 画布同为 1280×720
    title: '天結いキャッスルマイスター',
    backgroundColor: '#000000',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // 强制内容区为 1280×720（16:9）。useContentSize 在 Windows DPI 缩放下可能不准（electron#10659），
  // 显式 setContentSize 保证内容区比例正确，避免画布填满后仍因内容区非 16:9 出现黑边。
  win.setContentSize(1280, 720);
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
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
  // 按统一资源 id 取一张图像：resolveEntry(id) -> AGF 字节 -> 解码成 top-down RGBA
  ipcMain.handle('image', async (_e, id: number) => {
    const r = await fileSource.readById(id);
    if (!r) return null;
    const img = decodeAgfRgba(r.data);
    if (!img) return null;
    // Buffer 经 structured clone 到 renderer 变 Uint8Array
    return { name: r.name, width: img.width, height: img.height, data: img.rgba };
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

void app;
