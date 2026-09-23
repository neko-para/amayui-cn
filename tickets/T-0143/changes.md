# T-0143 · 变更记录

---

## 变更 1（2026-09-23）· 缺产物时不再只说 `not found`：启动自检 + 可指向的 404 + 守卫

### 一、事故与真因（本票的由来）

用户实测原话：「目前的 dsh 嵌入插件似乎坏掉了，提示的 `{"error":"not found: index.html"}`」。

**真因**：`app/amayui-emulator/dist/web/` **整个目录不在磁盘上**。`dist/` 被
`app/amayui-emulator/.gitignore` 全量忽略 ⇒ 没有任何工具会替它恢复；磁盘上只剩
`run.js`/`opcodes.js` 与 `arch`/`control`/`electron`/`renderer`/`script`/`tsc`/`util`/`vm`。
web 宿主对 `GET /` 固定去读 `<distDir>/index.html`，文件不在 ⇒ 走 `serveStatic` 的 catch ⇒
404 `{"error":"not found: index.html"}`，插件反向代理**原样透传** ⇒ 面板上就是这一句。

修好只需一条命令：`cd app/amayui-emulator && node build-electron.mjs`
（产出 `dist/web/{bridge.js 14679B, renderer.js 2637356B, index.html 1401B}`；
实测经真插件路由 `GET /dsh-emulator/dbg-a/` 返回 **200 / 1401B** 的 `<!DOCTYPE html>`）。

### 二、为什么这算缺陷而不是"你自己没构建"

那句 404 把两种情况压成同一个形状：①「**产物没构建**」；②「请求了一个不存在的资源」。
而且它既没有产物**绝对路径**、也没有**修法**。后果是排障方向被完全带偏 —— 第一反应会是查
插件路由 / 反向代理 / 端口 / 注册表，而真因在三层之外的构建产物上（本次就是这么绕了一圈，
最后靠"磁盘上 `dist/web` 根本不存在"才回头）。

### 三、改动

| 文件 | 改动 |
|---|---|
| `src/web/host.ts` | ① 新增 `checkDistAssets()`：`listen()` 成功后自检 `dist/web/{index.html,bridge.js,renderer.js}`，缺了打一条含**绝对产物目录**与 `cd app/amayui-emulator && node build-electron.mjs` 的告警（**不阻止启动** —— 实例照常 `/health`，这本身也是有用信息）；② `serveStatic` 的 404 对**那三个产物**额外带 `reason` / `distDir` / `fix` 三个字段（原 `error` 形状**保持**，面板/工具可能已经在匹配它）；③ CLI 增 `--dist-dir`（守卫测试据此指向临时目录，不依赖本机 `dist/` 是否存在） |
| `test/host-dist-assets.test.ts`（新增） | 两条用例，**各起一个真宿主进程**、各指向不同的 `--dist-dir` |
| `plugins/amayui-emulator/README.md` | 新增「排障」节：`not found: index.html` ⇒ 先跑构建（含命令）；顺带写清 503「没有渲染页」与第二渲染者告警 |

### 四、判据（acceptance 逐条）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 启动自检：缺产物时打显著告警（含绝对 `distDir` + 可照抄的构建命令），**不阻止启动** | ✅ 用例 ① 断言 `/web 产物缺失/`、`log.includes(distDir)`、`/build-electron\.mjs/`；同时 `/health` 仍 `ok:true` |
| 2 | 缺产物时 404 正文带机器可读原因（`reason`/`distDir`/`fix`），不只 `not found: <rel>` | ✅ 用例 ① 逐字段断言（并保留 `error === 'not found: index.html'`） |
| 3 | 插件侧原样透传即可（不改写） | ✅ 未改 `lib/index.js`（它本就原样转发）；README 写清"这句报错来自实例宿主、不是插件" |
| 4 | 守卫：**空 `distDir`** ⇒ 404 含 `distDir` 与构建命令；**真产物** ⇒ `GET /` 200 + `text/html`；且 `dist/web` 不存在时也跑得通 | ✅ `npx tsx --test test/host-dist-assets.test.ts` → **2/2 pass**（两条各指向临时目录，与仓库 `dist/` 无关） |
| 5 | 手工四步复现（改名 ⇒ 起 ⇒ 看告警与 404 ⇒ 改回 ⇒ 200）并归档 | ✅ 见 §五 |
| 6 | 不改宿主既有语义（注册表/心跳/`--idle-sec`/`/health`/`/events`/`/api/*`/路径逃逸守卫） | ✅ 只加自检与 404 的附加字段；`smoke.mjs` 全过、`smoke-client.mjs` 196 ✓、`tsc --noEmit` OK |

### 五、手工复现（四步）与原始输出

```text
① 缺产物：dist/web 改名（或指向一个空目录）
   $ node --import tsx src/web/host.ts --instance distmiss --port 0 --dist-dir <空目录>
   [web] ⚠ web 产物缺失（index.html / bridge.js / renderer.js）⇒ 渲染页打不开，DSH 面板会显示 {"error":"not found: index.html"}。
   [web]   产物目录：C:\…\empty-dist
   [web]   修法：cd app/amayui-emulator && node build-electron.mjs
   [web]   （实例本身照常运行、/health 正常；缺的只是"给页面看的静态产物"）
   $ curl -s http://127.0.0.1:<port>/
   {"error":"not found: index.html","reason":"web 产物未构建（dist/web 里没有这个文件）",
    "distDir":"C:\\…\\empty-dist","fix":"cd app/amayui-emulator && node build-electron.mjs"}

② 产物齐备：再起一次（`--dist-dir dist/web`）⇒ **不告警**，`GET /` 200 `text/html`
   （用例 ② 断言；实测 821ms / 783ms 两条用例通过）
```

> 四条命令与两份断言可直接由 `test/host-dist-assets.test.ts` 复跑得到，不依赖本机 `dist/` 的历史状态。

### 六、没做的

* **没有把"自动构建"塞进宿主**：那会让一个"只读观察"的宿主做重活（且需要 esbuild），
  与本工程的边界（宿主不替人做构建决定）不符；本票只要求"缺失时说清楚 + 给出命令"。
* **没有查"是谁删的 `dist/web`"**：那需要另外的证据（哪次 `tsc`/清理脚本/别的会话动过 `dist/`），
  与本票"报错要能指向"无关；`dist/` 被 gitignore ⇒ 归因不可考，且**即使查到也要保留这条自检**
  （产物缺失随时可能因为换分支/清目录再次发生）。
