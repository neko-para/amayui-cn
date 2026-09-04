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

// dist/electron/main.cjs -> app/amayui-emulator/dist/electron -> 仓库根 = 上4级
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RAW_DIR = path.join(REPO_ROOT, 'raw');

const fileSource = new NodeFileSource({ rawDir: RAW_DIR });

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true, // 内容区 1280×720；renderer 在 Pixi 1920×1080 画布上缩放显示
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

void app;
