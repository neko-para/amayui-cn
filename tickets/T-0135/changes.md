# T-0135 · 变更记录

> 每次变更一条：改了哪些文件、行为怎么变、判据是什么、看了哪些证据。

---

## 变更 1（2026-09-23）· Phase 2 主体：Node web 宿主 + web 渲染页 + 构建入口 + **端到端实跑取证**

### 一、Node web 宿主（新）

| 文件 | 内容 |
|---|---|
| `src/web/host.ts`（新，~430 行） | `createWebHost({repoRoot, instance, port, host, distDir, env, log})`：`node:http` 只绑 `127.0.0.1`；四个端点 —— `GET /`+`GET /<file>`（静态产物，带目录逃逸守卫）、`POST /api/<method>`（22 个方法，JSON 或**信封**二进制 + `x-amayui-meta`）、`POST /api/event`（渲染页→宿主单向）、`POST /api/push`（控制面注入，扇出到 SSE）、`GET /events`（SSE + 心跳）、`GET /health`（就绪探测/排障）。每实例一份 `HostService`（`--instance`），**env 只作参数下传**。CLI 入口支持 `--instance/--port/--repo-root/--bind`。 |

**关键实现选择（都写进了注释）**：
* 二进制响应用 `Cache-Control: no-store, no-transform` —— 原始 RGBA/字体/MOC 是高熵数据，避免代链路上的 level-1 gzip 白压（`T-0133` §7.2）；
* 写方向（`write-save-data`/`write-save-slot`/`write-slot-thumb`）的 body 也用**同一份信封**（`decodeEnvelope`），两个方向共用一个格式才不漂移；
* `--instance <id>` ⇒ log/trace/replay/base/overlay 全在 `<repo>/.tmp/instances/<id>/`；缺省实例 = 现状路径。

### 二、web 渲染页与桥入口（新）

| 文件 | 内容 |
|---|---|
| `src/renderer/index.web.html`（新） | 与 Electron 版同构，两处必然差别：**不再需要 `amayui-audio:`**（web 形态不给 `audioStreamBase`）、`connect-src 'self'` 覆盖 SSE+POST。两个 `script` 标签的顺序即契约：`bridge.js` 先装 `window.api`，`renderer.js` 再 boot |
| `src/renderer/webBridgeEntry.ts`（新） | 桥入口：API 基址**从页面位置推**（`location.pathname` 去文件名）⇒ 直连（`/api`）与 DSH 代理（`/dsh-emulator/api`）两种挂法同一份产物都对 |

### 三、构建

`build-electron.mjs` 增两条产物：`dist/web/bridge.js`（`webBridgeEntry`）、`dist/web/renderer.js`（**复用同一份渲染入口**）+ 拷 `index.web.html`。实测产物：`bridge.js` 14KB / `renderer.js` 2.6MB。

### 四、★端到端实跑（真实运行证据）

```bash
npm run build:electron
npx electron tools/webhost-shot.cjs --port 8901 --instance shot --wait-ms 45000
```

Electron 只当**哑浏览器**（`show:false`、无 preload/IPC），页面由我们的 Node 宿主经 HTTP 提供：

| 判据 | 结果 |
|---|---|
| 页面 boot 到 TITLE | **PASS** —— 截图 `evidence/webhost-titleshot.jpg`（logo / 五个菜单 / 立绘 / 槽位 / 版本号 1.07.0043） |
| 页面内 API 通道通 | **PASS** —— `window.api.readScript(0)` → **12012** 字节 |
| 不出现 Electron 窗口 | **PASS**（`show:false`） |
| 实例隔离 | **PASS** —— `/health` 显示 base/overlay/log 均在 `.tmp/instances/shot/` 下；干净实例 `read-config-ini` → `null`（**不继承玩家配置**） |
| HTTP 层 22 方法冒烟 | **PASS**（`read-script` 带回 `x-amayui-kind: bin` + `x-amayui-meta:{"index":0,"name":"SYSTEM4.BIN"}`；`music-table` 回真表） |

实跑记录：`evidence/webhost-e2e.txt`。

### 五、★端到端抓到的**真 bug**（假宿主单测抓不出来的那种）

`webBridge` 原先把 `fetch` 存进字段、再以**桥实例**为 receiver 调用 ⇒ 浏览器里
`TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`
（Node 的 `fetch` 不挑 receiver ⇒ `test/web-bridge.test.ts` 注入假 fetch 时完全测不出来；
症状是"页面黑屏 + 页面内调 API 报 Failed to fetch"）。
**修法**：改成裸调包装 `(input, init) => raw(input, init)`；
**守卫**：`test/web-bridge.test.ts` 增一条"默认路径下 fetch 的 receiver 不许是桥实例"的断言（现 13/13）。

### 六、判据与证据（变更 1）

| 判据 | 证据 |
|---|---|
| 全量回归 | `npm run verify` → **EXIT=0**（`tests 1135 / pass 1133 / fail 0 / skipped 2` + dead-writes 干净） |
| web 桥 | `npx tsx --test test/web-bridge.test.ts` → **13/13** |
| 信封 | `npx tsx --test test/web-envelope.test.ts` → **9/9** |
| 端到端 | 上面的实跑表 + `evidence/`（截图 JPEG 120KB + 记录 txt） |

### 七、未做完（本票剩余）

1. **DSH 插件 `plugins/amayui-emulator`**：Host 半 `inject` 含 `webServer` + `register({kind:'prefix', path:'/dsh-emulator'})` 反向代理到子进程；Client 半头部按钮 + `shell.overlay` 里 640×360 同源 iframe（外层 `transform: scale()`）。
2. **agent 侧重铺**：`tools/dbg.cjs`/守护进程的 `click/move` 在 web 宿主下走 `ScenarioEvent` → `applyScenarioEvent`；`capture` 走 `FrameHost.capture`。
3. **两实例并行隔离实跑**：当前只有单实例实跑 + 路径断言（`test/host-instance.test.ts` 有断言，但没有"两个真进程同时跑"的证据）。

---

## 变更 2（2026-09-23）· DSH 插件 + agent 侧控制面（输入重铺）+ 最强端到端证据

### 一、DSH 插件 `plugins/amayui-emulator`（新，`@amayui/emulator-view`）

| 文件 | 内容 |
|---|---|
| `lib/index.js`（Host 半） | `/dsh-emulator` **反向代理**（流式，不缓冲 ⇒ SSE 直通）+ 控制端点 `api/__status`（不触发冷启）/`api/__start`/`api/__stop`；**懒启动**独立子进程（`node --import tsx src/web/host.ts --instance dsh --port 0`），从横幅解析端口、等 `/health`、环形缓冲最后 40 行日志；卸载时 `SIGTERM` 收子进程。`inject:['fs','webServer']`、path **不带尾斜杠** |
| `lib/client.js`（Client 半） | 会话头部「🖥 调试画面」按钮（带运行态圆点）+ `shell.overlay` 模态：启动/停止/刷新/新标签打开 + **640×360 同源 iframe**（内部 1280×720 × 外层 `transform: scale(0.5)`）+ 出错时显示子进程最后几行日志 |
| `package.json` / `cordis.patch.yml` | 与 `@amayui/uimap`/`ticket-board`/`htmlcard` 同形（`dsh.bundle.patch` + `dsh.client{platform:'web'}`） |
| `smoke.mjs` | **离线冒烟 9 条全过**：路由注册（kind/path/inject 含 webServer）+ 真子进程 + 真代理（JSON/二进制信封）+ agent 控制面三条路径（无渲染页 **503** / 往返 200 / 不答 **504**） |
| `README.md` | 架构图、安装（`dsh plugin --profile web add ./plugins/amayui-emulator` + **重启 web profile**）、可调项、注意（无认证 ⇒ 只绑回环） |

**已安装**：`dsh plugin --profile web add ./plugins/amayui-emulator`（需越权写 `~/.dsh/profiles/web`，已获批准）⇒ profile 的 `dependencies` 与 `dsh.profile.bundles` 都已含 `@amayui/emulator-view`，symlink 与现有三个插件同形。**bundle 成员是启动边界 ⇒ 必须重启 `dsh web` 才会加载**。

### 二、agent 侧输入重铺（共享层，两宿主同义）

| 文件 | 改动 |
|---|---|
| `src/vm/debugCommand.ts` | `DebugAction` 增 `{a:'input'; events:[…]}`（**本地结构字面量**，保持零依赖）+ 8 条命令：`move <x> <y>` / `leave`（★`valid:false` 就是"光标出窗"）/ `click <x> <y> [左\|右]` / `press` / `release` / `wheel <±120> [x y]` / `key <vk>` / `keyup <vk>`；非法参数走既有"当查询回报"（不抛错）；帮助文本同步 |
| `src/renderer/app/session.ts` | `#applyDebugAction` 增 `case 'input'` ⇒ 逐个 `applyScenarioEvent(this.#e.input, ev)`（**纯 VM 外层桥**：不经 DOM ⇒ 浏览器宿主与 Electron 宿主同一条路；`setCursor` 会触发引擎命中测试/悬停） |
| `src/web/host.ts` | `POST /api/debug-query {args:[text]}`：push `renderer-debug-query` 经 SSE → 按 `id` 配对渲染页回执 → 返回结果；**超时 504、无渲染页 503**（可区分，不挂住）；超时可用 `AMAYUI_DEBUG_QUERY_TIMEOUT_MS` 调 |
| `test/bridge-input-focus.test.ts` | +3 条守卫（现 **9/9**）：8 条命令的解析形状、非法参数的回报口径 + 帮助完整性、以及**真的执行**（`leave` ⇒ `hasCursor=false`、`press/release` ⇒ 按钮位、`wheel` ⇒ 累加器、`key/keyup` ⇒ 键盘位） |

### 三、★最强端到端证据（真浏览器 + 真渲染页 + agent 命令 + 真 PNG）

```bash
npm run build:electron
npx electron tools/webhost-shot.cjs --port 8903 --instance shot --wait-ms 40000
```

| 观察点 | 结果 |
|---|---|
| 页面 boot（截图） | 4,038,670B |
| 页面内 `window.api.readScript(0)` | **12012** |
| **agent `move 640 360`** | HTTP **200** `["已注入 1 个输入事件（cursor）"]` —— 经 agent→宿主→SSE→渲染页→`applyScenarioEvent`→回执 |
| **agent `capture`** | **1,797,870B / 1280×720 PNG**（经 `FrameHost.capture`，**不是** `capturePage`） |

记录：`evidence/webhost-agent-control.txt`；目视核对 `evidence/webhost-agent-capture.jpg`。

### 四、判据

| 判据 | 结果 |
|---|---|
| 全量回归 | `npm run verify` → **EXIT=0**（`tests 1138 / pass 1136 / fail 0 / skipped 2`） |
| 插件离线冒烟 | `node plugins/amayui-emulator/smoke.mjs` → **9/9**（含真子进程 + 真代理 + 控制面三路径） |
| 输入命令守卫 | `npx tsx --test test/bridge-input-focus.test.ts` → **9/9** |

### 五、剩余

* **两实例并行隔离实跑**（当前只有单实例实跑 + 路径断言）；
* Phase 2 收口时把 DSH 侧安装步骤与"重启边界"正式写进插件 README（已写）；
* `T-0135` 结算（`tests[]` + done）待上面两项之一完成后再做（先保持 `doing`）。
