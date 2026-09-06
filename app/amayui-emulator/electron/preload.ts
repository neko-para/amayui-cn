/**
 * Preload：把主进程的 IPC 能力以受限 API 暴露给 renderer（contextIsolation）。
 * 只暴露两个只读文件访问原语，不暴露 ipcRenderer 本体。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  /** 按 call-script 索引读一个脚本（返回 {index,name,data:number[]} | null）。 */
  readScript: (index: number) => ipcRenderer.invoke('read-script', index),
  /** 读任意文件原始字节（number[]）。 */
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  /** 按统一资源 id 取一张图（AGF 解码后的 RGBA Uint8Array + 尺寸）。返回 null 表示无法解析。 */
  image: (id: number) => ipcRenderer.invoke('image', id),
  /** 诊断日志：追加一行到主进程的 .tmp/amayui-emulator.log（异步批量）。 */
  logLine: (text: string) => ipcRenderer.send('log-line', text),
  /** 诊断日志：同步追加（关窗前保证落盘，阻塞直至主进程写完）。 */
  logLineSync: (text: string) => ipcRenderer.sendSync('log-line-sync', text),
});
