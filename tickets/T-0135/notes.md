# T-0135 · 调试观察宿主 Phase 2 —— 设计要点（承接 T-0133/T-0134）

> 设计来源：`tickets/T-0133/notes.md`（§2 DSH 侧承载能力、§B.4 三形态、§B.6 分步）
> 与 `tickets/T-0134/notes.md` §6（Phase 2 预案）。本文件只记**本票定下来的**东西。

---

## 1. 形态已由实测定下：**P1 = 子进程 + 同源反向代理**，且**不需要 OSR**

`T-0134` 的 B′ 实验 **PASS**（实跑记录 `T-0134/evidence/bprime-run.txt`，目视核对
`T-0134/evidence/bprime-hidden-window-title.jpg`）：

| 判据 | 结果 |
|---|---|
| PNG 可解码 | PASS（3/3） |
| 1280×720 | PASS |
| 非纯色（>20KB） | PASS（1788564 / 1781821 / 1778610 B） |
| 帧间有差异（活的） | PASS（3/3） |

取帧走的是**页面内** `renderer.extract.canvas`（`FrameHost.capture` → `PixiBackend.captureFrame()`
→ `#captureStageCanvas()`），**全程不经过 `capturePage()`** ⇒
**隐藏窗口（`AMAYUI_WINDOW_HIDDEN=1`）里 Pixi 仍在跑帧、仍能读回像素** ⇒ Phase 2 不必用
`webPreferences.offscreen`，一次绕开 `T-0133` §B.4.1 里 OSR 专属的那串坑
（静止不出帧 / GPU→CPU 拷贝 / 首帧全 0 / 46 起 `getSize()` 变 DIP / shared texture 池纪律）。

⇒ 形态选择：**P1**（`T-0134/notes.md` §6.2）

| 形态 | 做法 | 取舍 |
|---|---|---|
| **P1（选它）** | 插件 Host 半 `spawn` emulator 的 web 宿主（独立进程，绑 127.0.0.1:<port>），把 `/dsh-emulator/*` **反向代理**过去 | iframe 与 DSH **同源**（无 CORS/CSP 问题）；emulator 崩溃不拖 GUI（契合「更强的 isolation」）；插件侧零构建。代价：要写 ~40 行代理；**WS 升级代理麻烦 ⇒ 控制面推送用 SSE**（已实测本 server 的 SSE 可用） |
| P2 | 插件同进程 `import` emulator 的构建产物、用 `webServer.register` 原生挂路由 | 无代理、无第二端口；但 DSH 进程内跑 emulator（崩溃面共享，与 isolation 诉求相反），且插件依赖 repo 内构建产物路径 |

## 2. 已提前完成的前置（属 Phase 2，记在 `T-0134/changes.md` 变更 2）

| 产物 | 守卫 |
|---|---|
| `src/web/envelope.ts` —— 浏览器与 Node **共用**的二进制线格式（`[u32 段数][u32 段长][段]×n`，big-endian + `x-amayui-meta` 头；严格解码） | `test/web-envelope.test.ts` **9/9** |
| `src/renderer/webBridge.ts` —— `window.api` 的 web 实现（`invoke`→`POST /api/<m>`；`send`→`POST /api/event`；`sendSync`→`sendBeacon`；`on`→SSE 按 channel 派发；可注入 `fetch`/`EventSource`/`beacon`） | `test/web-bridge.test.ts` **12/12** |

三个刻意的取舍（有守卫钉住）：不给 `audioStreamBase`（⇒ 静音/解码退化）、不给 `setSystemCursor`
（可做但故意不做）、字节一律回 `Uint8Array`（`ipcFileSource` 拿到就 `new Uint8Array(x)`）。

## 3. 本票要做的（按依赖排序）

1. **`src/web/host.ts`**（Node，独立进程）：`node:http` + 上表的四个端点；每实例一份 `HostService`
   （`--instance <id>`）；**只绑 127.0.0.1**；静态资源用 `node:fs` 直读 `dist/web/*`（本仓没有静态中间件，
   与插件侧 `ctx.fs` 同口径：自己读自己回）。
2. **web 渲染页**：`src/renderer/index.web.html`（CSP 放行同源 connect；**不再要 `amayui-audio:`**），
   在 `renderer.js` **之前** `installWebBridge()`。
3. **构建入口**：`build-electron.mjs` 增 `dist/web/{renderer.js,index.html}`（platform browser，IIFE）。
4. **端到端实跑**：起宿主 → 浏览器/无头浏览器跑到 TITLE → 截图进 `tickets/T-0135/evidence/`。
5. **agent 侧重铺**：`click/move` 走 `ScenarioEvent` → `applyScenarioEvent`；`capture` 走 `FrameHost.capture`。
6. **DSH 插件** `plugins/amayui-emulator`：Host 半前缀路由做**反向代理**（`inject` 必须含 `webServer`；
   path 不带尾斜杠）；Client 半「🖥 调试画面」按钮 + `shell.overlay` 里的 640×360 同源 iframe
   （外层 `transform: scale(0.5)` —— 内部视口固定 1280×720）。

## 4. 必须遵守的既有约束（别再踩）

* 插件 `inject` 漏 `webServer` ⇒ 路由**静默跳过**（`plugins/ticket-board/README.md:53`，实测踩过）；
* 插件路由 path **不能带尾斜杠**（`register` 会拼 `prefix + '/'`）；
* gzip：带 `content-range` 的响应不压缩（DSH webserver filter）；大二进制路由加 `Cache-Control: no-transform`
  可避开 level-1 gzip 白压（`T-0133` §7.2）；
* 命令名**不要叫 `shot`**：`tools/debugsrv.cjs:215` 在主进程截获了它（走 `capturePage`）；渲染侧那条叫 `capture`。

## 5. 单写者纪律（并行时）

`tickets/` 由主 agent 独占；子代理拿**写白名单**与**必须保留的锚点字面串**；
`npm run verify` / `npm run shot` / Electron **串行**跑（一次一个）。
