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
import * as fs from 'node:fs';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
// 主进程跑 AGF 解码（Node 有 zlib/fs）。路径: electron/ -> ../../.. = 仓库根
import { decodeAgfRgba } from '../../../scripts/agf/format.js';

// dist/electron/main.cjs -> app/amayui-emulator/dist/electron -> 仓库根 = 上4级
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RAW_DIR = path.join(REPO_ROOT, 'raw');

const fileSource = new NodeFileSource({ rawDir: RAW_DIR });

/** 诊断日志文件（renderer 经 'log-line' IPC 追加到此处）。 */
const LOG_PATH = path.join(REPO_ROOT, '.tmp', 'amayui-emulator.log');

let win: BrowserWindow | null = null;
let controlWin: BrowserWindow | null = null;

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

/** 控制窗：启动即打开的小窗，提供重启/日志开关/状态展示（见 docs 控制窗设计）。 */
function createControlWindow(): void {
  controlWin = new BrowserWindow({
    width: 400,
    height: 600,
    title: 'amayui-emulator 控制',
    backgroundColor: '#1e1e1e',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  controlWin.loadFile(path.join(__dirname, '..', 'control', 'index.html'));
  controlWin.on('closed', () => {
    controlWin = null;
  });
}

app.whenReady().then(() => {
  // 启动即建诊断日志文件（写头），确认通道/路径可用。
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, '=== amayui-emulator.log ===\n');
    console.log(`[main] diagnostic log -> ${LOG_PATH}`);
  } catch (err) {
    console.error(`[main] init log failed: ${(err as Error).message}`);
  }
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
  // 诊断日志：追加到 .tmp/amayui-emulator.log（异步批量）
  ipcMain.on('log-line', (_e, line: string) => {
    try {
      fs.appendFileSync(LOG_PATH, line + '\n');
    } catch (err) {
      console.error(`[log-line] ${(err as Error).message}`);
    }
  });
  // 诊断日志：同步最终落盘（renderer 关窗前调用，保证不丢尾）
  ipcMain.on('log-line-sync', (e, line: string) => {
    try {
      fs.appendFileSync(LOG_PATH, line + '\n');
    } catch (err) {
      console.error(`[log-line-sync] ${(err as Error).message}`);
    }
    e.returnValue = 'ok';
  });
  console.log(`[main] diagnostic log -> ${LOG_PATH}`);
  // 控制窗：重启主窗口渲染流程
  ipcMain.on('control-restart', () => {
    if (win && !win.isDestroyed()) {
      // 主窗口还在：reload 渲染器 → 重新走完整 boot
      win.webContents.reload();
      console.log('[main] control: restart -> reload renderer');
    } else {
      // 主窗口已关闭/不存在（控制窗仍开）：重新创建主窗口（boot 重新跑）
      createWindow();
      console.log('[main] control: restart -> recreate main window');
    }
  });
  // abort(0x1)/程序退出：渲染窗请求关闭主窗口
  ipcMain.on('close-window', () => {
    if (win && !win.isDestroyed()) win.close();
    console.log('[main] abort -> close main window');
  });
  // 控制窗：设置是否打印全量指令 → 转发给渲染窗（renderer 监听 onTraceAll）
  ipcMain.on('control-set-trace-all', (_e, enabled: boolean) => {
    if (win && !win.isDestroyed()) win.webContents.send('renderer-set-trace-all', enabled);
    console.log(`[main] control: traceAll=${enabled}`);
  });
  // 渲染窗 → 主 → 控制窗：状态上报（当前 BIN + 已忽略指令 + traceAll）
  ipcMain.on('renderer-status', (_e, s: unknown) => {
    if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('control-status', s);
  });
  createWindow();
  createControlWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

void app;
