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
});
