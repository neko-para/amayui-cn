/**
 * **web 宿主的桥入口**（`tickets/T-0135` Phase 2）—— 必须在 `renderer.js` **之前**执行。
 *
 * 它只做一件事：把 `window.api` 装成"HTTP + SSE"的实现（`./webBridge.ts`），
 * 于是 `renderer.ts` / `boot.ts` / `ipcFileSource.ts` / `pixiBackend.ts` **一行都不用改** ——
 * 它们只认 `window.api` 这个面（`ipcProtocol.ts` 的全局声明）。
 *
 * ## API 基址从**页面自身位置**推
 *
 * 同一份产物要同时服务两种挂法（`T-0135/notes.md` §1）：
 *
 * ```text
 * 独立进程直连   http://127.0.0.1:8899/            → /api/*        /events
 * DSH 同源代理   http://127.0.0.1:3080/dsh-emulator/ → /dsh-emulator/api/*  /dsh-emulator/events
 * ```
 *
 * ⇒ 用 `location.pathname` 去掉文件名当目录前缀，两种挂法都对（写死任何一个都会让另一种 404）。
 */
import { installWebBridge, type WebBridge } from './webBridge.js';

declare global {
  interface Window {
    /** 诊断/冒烟用：桥实例（`connect()`/`close()` 可手动调）。 */
    __amayuiWebBridge?: WebBridge;
  }
}

const dir = location.pathname.replace(/[^/]*$/, ''); // '/' 或 '/dsh-emulator/'
const base = `${dir}api`;
const eventsPath = `${dir}events`;

const bridge = installWebBridge({
  base,
  eventsPath,
  log: (line) => console.log(line),
});
window.__amayuiWebBridge = bridge;
console.log(`[web] window.api 已装（base=${base} events=${eventsPath}）`);
