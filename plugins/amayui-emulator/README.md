# @amayui/emulator-view · 静态 bundle 插件（把模拟器的**调试观察画面**嵌进 DSH，并给 agent 一套驱动工具）

> **这个包有两个半**：`lib/index.js`（Host：GUI 面板的每实例反向代理）+ `lib/client.js`（浏览器浮窗）
> —— 见下面「观察台」章节；以及 **`lib/tools.js`：agent tool `amayui_emulator`**，
> 见 **§「agent tool」**（那是"取代每次临时写 .mjs"的那一半，也是本 README 后半段的重点）。

在 DSH Web GUI 里放一个**常驻浮窗**（`shell.overlay`，`tickets/T-0137` 起）：默认收成右下角
一枚小胶囊（「🖥」+ **活实例数**徽标），点开是一块 `position: fixed` 的面板 ——
一份**活实例列表**（id / 端口 / 跑到哪支 BIN / 起于何时 / 心跳年龄）+ 选中即嵌的
640×360 / 320×180 **同源 iframe**，里面是《天結いキャッスルマイスター》emulator 的真实渲染画面
（`show:false`，**不出现任何 Electron 窗口**）。会话头部另有常驻按钮「🖥 调试画面」可把它展开；
面板里的「放大」再进全屏模态。

## ★形态：常驻浮窗（PiP）+ 模态作放大（`tickets/T-0137`）

> 用户原话：「希望渲染可以固定在外面, 例如 float 在对话流里面, 而不是现在必须模态」。

`shell.overlay` 正是框架为浮层准备的座位（官方原话：*Frame-wide floating layer, above every
column and **outside their scroll containers** … The layer itself is **click-through** — entries
opt back into pointer events*）⇒ 滚对话时它不动，且默认点击穿透、不挡聊天。具体形态：

| 状态 | 是什么 | 怎么进 / 出 |
|---|---|---|
| **收起**（默认） | 右下角一枚小胶囊：`position: fixed; right:16; bottom:16`，「🖥」+ 活实例数徽标 | 首次加载即此态；点「收起」回到这里 |
| **展开** | `position: fixed` 的浮窗面板：标题栏（可拖）+ 实例列表 + 选中实例的画面框 | 点胶囊 / 点头部按钮展开 |
| **模态** | 原来的全屏背板模态（大屏细看仍然有用） | 面板里的「放大」；关掉**回到浮窗**（不是什么都不剩） |

* **拖动**：拖标题栏（`onMouseDown` + `window` 的 `mousemove`/`mouseup`），位置 clamp 在视口内，
  抬起时摘掉监听（卸载时也摘）。
* **两档尺寸**：「尺寸档」在 `0.5×`（外层 640×360）与 `0.25×`（外层 320×180）之间切换；
  **内层 iframe 始终 1280×720**（模拟器视口写死），只对整块做 `transform: scale(...)`，
  `transform-origin: top left`。
* **持久化**：一个带插件前缀的 `localStorage` 键（`@amayui/emulator-view.panel.v1`）存
  `{collapsed,x,y,scale,selectedId}` ⇒ 刷新后位置 / 尺寸档 / 收起态 / 选中实例都还在。
  **每一次 localStorage 访问都在 `try/catch` 里**：坏 JSON、形状不对、隐私模式、根本没有
  `localStorage` —— 一律退回默认（收起胶囊）且不炸。
* **点击穿透**：`pointerEvents:'auto'` **只**加在本插件自己的容器（胶囊 / 面板 / 模态背板）上，
  不包裹页面、不加全局监听拦截。
* **面板不启动任何东西**：没有「启动/停止」（见下）。

## ★★切换形态**不重建** iframe ⇒ **收起不会杀掉会话**（`tickets/T-0138`，P0 修复）

> 用户实测原话：「我刚才点了放大按钮, 发现似乎走到了之前的 重启 的那个路径上, 导致状态刷新了」。

**根因**：三种形态曾经是**三个不同的 JSX 分支**，各渲染一个 `src` 相同的 `<iframe>` ⇒ React 在
分支之间切换时**卸载旧 iframe、挂载新的**。而 web 形态下 **VM 跑在页面里**（`T-0136` 钉住的架构
事实）⇒ 卸载 = 该实例的 VM 直接死掉，重新挂载 = 从 `ALINIT` 重跑一遍（宿主日志实测：一条 status
流 + **一条完整重引导链** `SKINIT → $3$IMINIT → INIT2 → BIINIT → $4$EBINIT → TITLE`；取证见
`tickets/T-0138/evidence/iframe-reload-forensics.txt`）。

**现在的形状**：整棵树里**只有一个 `<iframe>`**（`lib/client.js` 源码里 `createElement('iframe'`
恰好一处，`smoke-client.mjs` 有源码棘轮），**无 `key`**，`src` 只在**用户显式点选另一个实例**时改。
三种形态只改**同一个容器**（`#amayui-emulator-viewport`）的 style：

| 形态 | 承载 iframe 的那个容器的 style | 画面框在哪 |
|---|---|---|
| 展开 | `position:fixed` 落在持久化的 `{x,y}`，排在标题栏 + 列表之下 | 列表下方 |
| 模态 | `position:fixed`，排在居中大盒子的标题栏之下（`zIndex = MODAL_Z+10`） | 「大盒子」右侧 |
| 收起 | **同一个盒子、同位置同尺寸**，只是 `visibility:'hidden'` + `pointerEvents:'none'` | 原处（不可见） |
| 无选中 | **没有 iframe**（唯一合法的缺席） | — |

**语义（务必记住）**：

* **收起 ≠ 停会话**：收起来只是把画面框 `visibility:hidden`（**不用 `display:none`** ——
  那会让浏览器挂起页面、帧计数停住）。**VM 活着，会话原样保留**；展开回来是**同一个会话**，
  宿主日志里**不会再出现第二条启动链**。
* 隐藏期间浏览器可能**节流**这个页面（后台标签页/不可见 iframe 的 `requestAnimationFrame`
  会被降低甚至暂停）⇒ 面板里的 **`f=` 帧计数可能不再增长**，这是节流、**不是崩了**；
  展开/让它可见后帧计数继续走。
* 模态的**背板是另一个兄弟节点**（`#amayui-emulator-backdrop`，z-index 更低）——它**不包裹**
  画面框，所以进出模态同样不碰 iframe。

## ★观察者数（`viewers`）：一个实例只应该有一个页面

宿主半（`lib/index.js`）在反向代理里按实例统计**活 SSE 连接数**：一个响应只要上游回的是
`text/event-stream` 就 +1，`res` 关闭时 -1（`WeakSet` 保证每个响应只减一次，不会被减成负数）。
`GET /dsh-emulator/api/__instances` 的每个实例条目因此多一个 **`viewers`** 字段；面板显示
「👁 观察者 N」（列表每行一个）。

* **N=1** 是正常状态（就是面板自己的那一个 iframe）。
* **N>1 = 同一个实例上挂了多个页面**。因为 **VM 跑在页面里**，这不是"多一个观众"，而是
  **第二个 VM**：两个 VM 抢同一份 overlay/log，画面与存档都会互相打架。所以面板会在 N>1 时
  显示明确告警，并把「新标签打开」的文案改成
  **「新标签打开（会开第二个 VM）」**（`title` 也写清风险）。
  **策略选择**：我们**保留可点**（只标注风险）而不是禁用 —— 运维上偶尔确实需要，但**绝不能
  悄悄发生**；看到告警就关掉多余的标签页。
* 关掉第二个标签页后，它的 SSE 断开 ⇒ `viewers` 自己会掉回 1（最多一个轮询周期，3s）。
* 这个计数**完全来自本插件的代理**，`app/**` 一行没改（宿主的注册表 schema 也不变）。


## ★形态：纯观察台（`tickets/T-0136` 起，替代 `T-0135` 的启动/停止形态）

> 用户实测 `T-0135` 后的原话：「能够启动，但是好像每次打开时是一个新实例。我其实感觉并不需要
> 我自己去创建实例，而是类似于，查看目前所有后台实例，选择激活某一个」

于是本插件的角色从**启动器**改成**观察台 + 切换器**：

* **生命周期只由 agent / CLI 持有**：插件**不 spawn、不 stop、不持有任何子进程**。
  面板里没有「启动/停止」按钮，只有列表 + 切换 + 「新标签打开」。
* **列表来自文件注册表**（跨进程/跨终端）：agent 在**别的终端**起的实例，DSH 里也看得见。
* **路由是每实例一条**：`/dsh-emulator/<id>/…`，所以可以并排看多个实例；裸前缀在恰好只有
  一个活实例时 302 过去。
* **闲置自停**由实例自己执行（见下），插件不管。

## 它怎么工作

```text
浏览器 (DSH GUI, 127.0.0.1:3080)
  │  GET /dsh-emulator/api/__instances        ← 列表（读注册表，不碰进程）
  └─ iframe src=/dsh-emulator/<id>/           ← 同源！无 CORS / 无跨源 CSP
        ├─ GET  /dsh-emulator/<id>/           ─┐
        ├─ POST /dsh-emulator/<id>/api/<m>     ├─▶ [lib/index.js 的每实例反向代理，流式]
        ├─ POST /dsh-emulator/<id>/api/event   │        │
        └─ GET  /dsh-emulator/<id>/events(SSE) ┘        ▼
                                                  127.0.0.1:<注册表里的 port>
                                                  emulator web 宿主（**独立进程**，
                                                  由 agent/CLI 启动）
                                                    ├─ 静态产物 dist/web/*（bridge.js + renderer.js）
                                                    ├─ /api/*   22 个宿主方法（JSON 或二进制信封）
                                                    ├─ /events  SSE 推送
                                                    └─ HostService（每实例一份：log/trace/存档）
```

* **为什么独立进程**：崩溃不拖 DSH；日志/存档按实例隔离在 `<repo>/.tmp/instances/<id>/`
  （**不碰真游戏存档**）。
* **为什么反向代理**：iframe 与 GUI **同源** ⇒ iframe 里的 `bridge.js`（`src/renderer/webBridgeEntry.ts`）
  从 `location.pathname` 推出宿主基址，SSE 也直接可用；不需要 CORS 头、不需要放宽 CSP。
* **为什么 SSE 而不是 WebSocket**：控制面推送是单向的，而代理 WebSocket **upgrade** 要另写一套；
  SSE 在 DSH 的 `webServer` 上已实测可用（`tickets/T-0133` §2.5）。代理**不缓冲、不设空闲超时**，
  否则会掐断 SSE。

## 实例注册表（插件与宿主之间的唯一契约）

路径（**两种布局**，与 app 侧 `src/host/registry.ts` 同口径）：

```text
<workspaceRoot>/.tmp/instances/<id>/instance.json    # 具名实例（--instance dbg-a）
<workspaceRoot>/.tmp/instance.json                   # 缺省实例（id = "default"）
```

目录里另有该实例的 `log/`、`overlay/`、`base/` 等。**由宿主机自己写**（`src/web/host.ts`）：

```jsonc
{
  "id": "dbg-a",                 // 合法 id：[A-Za-z0-9._-]{1,64}；保留段 "api" 不允许
  "pid": 12345,                  // 宿主进程 pid
  "port": 53819,                 // listen 后的真实端口（--port 0 ⇒ OS 分配）
  "host": "127.0.0.1",
  "repoRoot": "/…/amayui-cn",
  "startedAt": 1758600000000,    // ms
  "heartbeatAt": 1758600300000,  // ms；每 5s 刷一次
  "lastStatus": { "bin": "SYSTEM4.BIN", "frames": 12345, "gate": null }  // 可选摘要
}
```

* **写**：`listen` 成功后**原子写**（tmp + rename）；**每 5s** 刷 `heartbeatAt`（顺带 `lastStatus`）；
  `close()` / 信号退出**删记录**。
* **活**的定义：`pid` 活着 **且** `heartbeatAt > Date.now() - 20000`（连续丢 4 次心跳）。
  插件按这个口径过滤，坏 JSON / 半文件当不存在（不炸）。
* 插件**只读**这个目录（用 `node:fs`，因为我们读的是 `.tmp/` 临时区、且要按请求热读）。
  **两种落点都会被扫到**（`__instances` 一次返回两者，按 `id` 去重）：缺省实例在
  `<root>/.tmp/instance.json`，具名实例在 `<root>/.tmp/instances/<id>/instance.json`；
  两处都没有 / 坏 JSON / 目录里没有记录 ⇒ 跳过，不抛。

### `GET /dsh-emulator/api/__instances`

```jsonc
{
  "instances": [
    { "id": "dbg-a", "port": 53819, "startedAt": 1758600000000,
      "heartbeatAt": 1758600300000, "bin": "SYSTEM4.BIN", "frames": 12345, "gate": null,
      "viewers": 1 }        // 本插件代理上该实例的活 SSE 连接数（1 = 正常；>1 = 第二个 VM，见上）
  ],
  "root": "/…/amayui-cn",                 // workspaceRoot
  "tmpDir": "/…/amayui-cn/.tmp",
  "registryDir": "/…/amayui-cn/.tmp/instances",   // 具名实例的目录（default 在 tmpDir 下）
  "staleMs": 20000
}
```

### 其余路由

| 请求 | 行为 |
|---|---|
| `ANY /dsh-emulator/<id>/<rest>` | 反向代理到该活实例的 `/<rest>`（method/headers/body 原样，**流式**，SSE 直通） |
| `GET /dsh-emulator/` 或 `/dsh-emulator` | 恰好一个活实例 ⇒ `302 /dsh-emulator/<id>/`；否则 `200 { instances, hint }` |
| 未知 id | `404` + 可读 JSON（从没见过） |
| 记录在但 pid/心跳已死，或本会话见过后记录被删 | `410 Gone` + 可读 JSON（**不挂住**） |
| `GET /dsh-emulator/api/<其它>` | `404`（保留段 `api` 不给实例用） |

## agent 怎么起一个实例（面板只显示这条命令，不代跑）

```bash
cd app/amayui-emulator
# --port 0 = OS 分配；--instance <id> = 实例身份（决定 .tmp/instances/<id>/ 与注册表条目）
node --import tsx src/web/host.ts --instance dbg-a --port 0
# 闲置时限可调：--idle-sec 600（缺省 10 分钟；0 = 关掉自停）
```

* **闲置自停**：实例自己执行 —— **无 SSE 观察者且无任何请求**持续超过 `--idle-sec`（缺省 `600`s）
  就写一行日志、删注册项、退出；磁盘状态（overlay/log/trace）保留，下次同 id 起来还在。
  也就是说"起一个实例 → 看一眼 → 忘了它"不会留下一个永远活着的进程。
* 同 id 互斥：已有活记录时，第二个同 id 实例会**拒绝启动**并打印
  `实例 <id> 已在运行 pid=… port=…`（不静默抢 overlay/log）。要用新实例就换个 id。
* 想让实例常驻：`--idle-sec 0`，并在自己的终端里保持它（或交给 agent 的会话管）。

### 让 agent 不依赖人：`--attach-headless`（`tickets/T-0140`）

```bash
cd app/amayui-emulator
# 宿主自己附一个**隐藏的渲染页**（哑窗，show:false）
node --import tsx src/web/host.ts --instance dbg-a --port 0 --attach-headless
```

web 形态下 **VM 跑在页面里** ⇒ 没有渲染页附着的实例，`/health` 正常但 agent 的 `debug-query`
**必然 503**。开这个开关之后，实例**不需要人打开面板**就能被 agent 直接驱动：

```bash
curl -s -X POST http://127.0.0.1:3080/dsh-emulator/dbg-a/api/debug-query \
     -H 'content-type: application/json' -d '{"args":["move 640 360"]}'
curl -s -X POST http://127.0.0.1:3080/dsh-emulator/dbg-a/api/debug-query \
     -H 'content-type: application/json' -d '{"args":["capture"]}'
# → {"ok":true,"path":"capture-….png","dir":"<绝对路径>",…}：PNG 已由宿主写盘（`<dir>/<path>`），
#   回执里**没有** base64（`T-0180` ②；旧宿主才回 `png` 字段）。
```

缺省**关**（起一个 Electron 渲染进程是要付代价的）。也可用 `AMAYUI_ATTACH_HEADLESS=1`。
宿主的**静态产物**必须已构建（见下面「排障」）；缺了它无头页打开是白页，`capture` 会超时。

## 排障

* **面板里只有 `{"error":"not found: index.html"}`** ⇒ 被观察实例的 **web 产物没构建**
  （`app/amayui-emulator/dist/web/` 整个目录缺失；`dist/` 在 `.gitignore` 里，不会自愈）。修法：

  ```bash
  cd app/amayui-emulator && node build-electron.mjs
  ```

  宿主启动时会在 stdout 打一条 `⚠ web 产物缺失（index.html / bridge.js / renderer.js）` 的告警，
  含产物**绝对路径**与上面这条命令；`GET /` 的 404 正文里也带 `reason`/`distDir`/`fix` 三个字段
  （`tickets/T-0143`）。**插件的反向代理只是原样透传**，所以这句报错来自实例宿主、不是插件。

* **`debug-query` 回 503「没有渲染页」** ⇒ 这个实例没有任何页面附着（web 形态下没有页面就没有 VM）。
  开 `--attach-headless`，或在面板里选中它让 iframe 挂上去。

* **同一个实例被两个页面附着** ⇒ 就是**两个 VM** 抢同一份 overlay/log。宿主会打
  `⚠ 第二渲染者：实例 <id> 现在有 N 个**外部**渲染页…`，`GET /health` 里也有
  `viewers`/`viewersWarn` 可机读判断；面板侧也会在 `viewers > 1` 时告警。**刷新页面**时新旧 SSE
  会短暂并存，所以策略是"允许 + 显著告警"而不是拒绝（拒了会把正常刷新打成故障）。
  `renderer-status` 的日志形如 `[web] status obs=#<观察者序号> frames=<N> {…}`：多页面时
  **按 `obs` 拆开**才能看出各自有没有回零（注册表心跳里的 `frames` 是"最后一个上报者"的值）。

## 安装 / 重启边界

```bash
# 工程根
dsh plugin --profile web add ./plugins/amayui-emulator
# ★bundle 成员是**启动边界**：改了 lib/*.js 要重启 web profile（`dsh web`）才会加载
```

验证（不重启也能做）：

```bash
node --check plugins/amayui-emulator/lib/index.js
node --check plugins/amayui-emulator/lib/tools.js
node plugins/amayui-emulator/smoke.mjs          # 离线冒烟（Host 半）：路由 + 真起实例 + 注册表发现 + 代理 + 410（含 tsx 冷启）
node plugins/amayui-emulator/smoke-client.mjs   # 离线冒烟（Client 半）：单一 iframe 不变式 / 三态切换不换节点 / viewers 告警 / 常驻胶囊 / 两档尺寸 / 拖动 / localStorage / 无启动停止
dsh --profile web --dump-config | grep -A2 amayui-emulator-view
```

重启后：右下角出现一枚「🖥」小胶囊（徽标 = 活实例数；会话头部也有「🖥 调试画面」按钮）→
点开面板 → 列表里选一个 → 画面出现；「放大」进全屏模态，「尺寸档」切 0.5×/0.25×，拖标题栏挪位置。
列表为空 = 此刻确实没有活实例；按面板里的命令让 agent/自己起一个。
**agent tool 侧**：重启 web profile 后，模型可见的工具面里会多出 `amayui_emulator`
（`dsh --profile web --dump-config` 不显示工具面；直接让 agent 发一次 `action=instances` 最快）。

## 依赖与前提

* 插件自身**零运行时依赖**（Host 半只用 `node:fs` / `node:http` / `node:path` / `node:child_process`；
  agent tool 另需 `@deepseek-ai/dsh-tools` 的 `defineTool`，由 profile 提供，见 `package.json` 的
  `peerDependencies`）。
  ★**从仓库根跑 `smoke.mjs` 需要它可解析**：本包以 junction 挂在 profile 的
  `node_modules/@amayui/` 下，而 `@deepseek-ai/dsh-tools` 只在 **profile / DSH 安装**的
  node_modules 里 ⇒ 仓库里放了一个 `plugins/amayui-emulator/node_modules/@deepseek-ai/dsh-tools`
  junction（指向 DSH 安装那份；`node_modules/` 是 gitignored 的，与 `plugins/uimap` 同做法）。
  没有它冒烟会**优雅降级**（打印一条 `✗ 加载 @deepseek-ai/dsh-tools 失败` 并 skip 工具断言）。
* **被观察的 emulator 侧**要有依赖：`app/amayui-emulator/node_modules`（`tsx`；`--attach-headless` 还要 `electron`）。
* 路由**没有认证**（`webServer.register` 的普通路由不走 `connection` 的鉴权/围栏）⇒
  宿主只绑 `127.0.0.1`、且 DSH 本身拒绝 `--host 0.0.0.0`。**不要**把这套路由暴露到网络。

## 注意

* **路由 path 不带尾斜杠**（`webServer.register` 会拼 `prefix + '/'`）；
* `inject` 必须含 `webServer`（否则 base 阶段挂载、路由被**静默跳过** —— 与 `@amayui/uimap`/`@amayui/ticket-board` 同一个坑）；
* iframe 内部视口**写死** 1280×720（`src/renderer/viewport.ts`）⇒ "小画面"靠外层 `transform: scale(0.5)` /
  `scale(0.25)`（两档），不要压小 iframe 元素（那样 canvas 会被裁剪）；
* `shell.overlay` 是**点击穿透**层 ⇒ `pointerEvents:'auto'` 只能加在自己容器上（胶囊 / 面板 / 模态背板），
  不要包裹页面或加全局监听（会吞掉对话区的点击）；
* ★**永远不要再为某个形态新加 `<iframe>`**：整个 `lib/client.js` 里 `createElement('iframe'` 只允许
  出现**一次**（`smoke-client.mjs` 的源码棘轮会红）。形态差异只写在 style 里；收起用
  `visibility:'hidden'`（**不要 `display:'none'`**）—— 卸载 iframe 或挂起页面都会让 VM 死/停；
* 浮窗位置 / 尺寸档 / 收起态 / 选中实例存在 `localStorage`（键 `@amayui/emulator-view.panel.v1`），
  每个访问都在 `try/catch` 里；清掉这个键就等于恢复默认（收起胶囊、右下角、0.5×）；
* **GUI 面板不持有子进程**，所以卸载时没有需要清理的钩子（`T-0135` 的 `SIGTERM` 收尾随之删除）。
  ★agent tool 那一半的 `start` **会**起进程 —— 见下一节末尾「两条不变量为什么不冲突」。

---

# agent tool：`amayui_emulator`（`tickets/T-0181`）

## 为什么有它（它就是被"临时脚本"逼出来的）

在它之前，让 agent 自己驱动一个 emulator 实例的**唯一**做法是**每次现场手写一个 `.mjs`**：

```text
写 drive.mjs → 起实例（长命令行 + 自己管后台进程 + 从注册表把端口捞回来）
            → fetch POST debug-query → 自己量往返毫秒
            → capture（把 1.8MB 的 base64 PNG 打到 stdout，**模型上下文直接烧掉**）
            → 想等"跑到 TITLE"只能 Start-Sleep + 反复 frame 去猜
            → 读输出 → 改脚本 → 再跑一遍
```

定位「存档页 80→90 切页卡 1.5s」那一轮，这个循环跑了十几次，每次都是一份新脚本，跑完就废。
现在同样的事是**一次工具调用**。三条硬设计（取舍都写在这里，不藏在代码里）：

| # | 设计 | 为什么 |
|---|---|---|
| 1 | **复用既有 HTTP 路由，不另写驱动逻辑** | 命令面只有一条：`app/amayui-emulator/src/web/host.ts` 的 `POST /api/debug-query`（命令表仍是 `src/vm/debugCommand.ts` 那一份）。插件**不解析任何仿真命令**，只拼字符串、转发、读回执。两处真源 = 之后必然漂移的债。 |
| 2 | **PNG 只落盘，绝不回模型** | `capture` 回执里的 `png` 是 base64（1280×720 ≈ 1.8MB），打到 stdout/回执里就是一次上下文事故。工具就地解码写文件，只回 `{path, bytes, width, height}`；`lib/tools.js` 里 base64 只活在 `doCapture` 一个函数体内。 |
| 3 | **往返毫秒是证据** | 每个动作回 `elapsedMs`，`query` 另有**逐条** `roundTripMs`。要量的是"卡多久"，不是"命令发了"。 |

**为什么直连实例端口、不走本插件的 `/dsh-emulator/<id>/…` 代理**：同一条路由、同一份契约，
但**少一跳 TCP** —— 把插件自己那一跳算进 `roundTripMs` 会**污染证据**。
GUI 面板走代理（同源 iframe 需要它），agent 走直连：**两个调用方，一条被调用的路由**。

## 参数表（一个工具，八个动作）

```jsonc
amayui_emulator {
  action: "instances" | "start" | "stop" | "query" | "capture" | "input" | "profile" | "wait",
  instance?: string,        // 实例 id；缺省要求"恰好一个活实例"（多个就报错并列出）
  ...
}
```

| action | 关键参数 | 行为 / 回执 |
|---|---|---|
| **`instances`** | `include_dead` | 读 `.tmp` 文件注册表（跨进程/跨终端可见）→ 每个实例 `{id, port, pid, live, bin, frames, gate, heartbeatAgeMs}`。**不碰进程**。 |
| **`start`** | `port`(0) `idle_sec`(0) `headless`(true) `wait_ms`(20000) | 以**受管后台进程**起：`node --import tsx src/web/host.ts --instance <id> --port <p> --idle-sec <n> [--attach-headless]`，env `AMAYUI_AUDIO_ENABLED=0`（静音）、`detached:true`、stdout/stderr → `.tmp/emudbg/<id>.log`。**`--port 0` 的真实端口从注册表捞回来**再回执。`idle_sec` 缺省 **0**（agent 的实例不该自己消失）。 |
| **`stop`** | `force` `grace_ms`(8000) | `SIGTERM` → 等 `grace_ms` → 还在就 `taskkill /T /F` 收**整棵树**（`--attach-headless` 的哑窗是宿主的子进程，不一起收就是孤儿）。**只收本进程起的**；别人的实例必须显式 `force:true`（注册表在磁盘上、跨进程可见 ⇒ 没有这道摩擦就可能一键杀掉用户正在看的那个）。 |
| **`query`** | `command` 或 `commands[]` | 发任意调试命令（`run`/`global`/`frame`/`slot`/`barrier`/`snapshot`/`restore`/`focus`/`help`…），逐条回 `{cmd, status, roundTripMs, ok, lines[]}`。 |
| **`capture`** | `out` | 抓帧 → **落盘** `.tmp/emudbg/<out>`（缺省 `<id>-<MMDD-HHMMSS>.png`）→ 回 `{path, bytes, width, height, pngRoundTripMs}`。宽高直接读 PNG 的 `IHDR`（8 字节，零依赖）。 |
| **`input`** | `kind` `x` `y` `button` `hover`(click 缺省 true) `hover_wait_ms`(250) `settle_ms` `delta` `vk` `keyup`(true) | `click/move/leave/press/release/wheel/key` 的封装。★**合成悬停**：`move(目标左侧 2px) → move(目标) → 等 hover_wait_ms → click`。回执里逐条列命令与各自的 `roundTripMs`。 |
| **`profile`** | `sub` `min_ms` `watch` `slow_ms` | `profile on/off/reset/report [minMs]/watch on\|off/slow <ms>` 的封装。归因卡顿的标准接法：`reset` → `on` → 发输入 → `report 20`。 |
| **`wait`** | `until{}` `timeout_ms`(30000) `poll_ms`(200) | 轮询**只读**探针 `frame`（+ `run`/`global`）直到条件成立：`bin`（正则）、`gate`（`free`/`waiting`）、`frames_above`/`frames_below`/`frames_change`、`global`（正则，配 `until.global_idx`）。超时回 `ok:false` + **每个条件的期望/实得**。 |

### `input` 的两条输入语义（照抄引擎实测，别踩）

1. **悬停靠"位置真的变了"触发**（`src/vm/input.ts` 的 `setCursor`：同一点连发两次 `move`
   **不**产生第二次 hover）⇒ 这就是 `hover:true` 要**先移到旁边再移回来**的原因，
   也是"TITLE 这类菜单不悬停点不动"的机制。`move 867 385` 连发两次**没有用**。
2. `click` = `cursor + press + release` 三连（天然会先移动），但需要"先悬停若干帧让菜单展开/高亮"
   的界面仍要拆开 —— 那是 `hover_wait_ms` 在管的事。

## 与"临时写 .mjs"的对比

| 事 | 临时脚本 | 本工具 |
|---|---|---|
| 起实例 | 手写命令行 + 自己管后台 + 自己查端口 | `action=start`（自带静音/无头/日志/端口回填） |
| 量往返 | 自己 `Date.now()` 包 fetch | 每条命令自带 `roundTripMs` |
| 抓帧 | 自己 `base64` 解码 + **容易顺手 print 出去** | `action=capture` 落盘，base64 不出函数 |
| 点菜单 | 猜坐标 + 反复 `click` | `action=input`（含合成悬停）+ `capture` 看图 |
| 等状态 | `Start-Sleep` + 反复 `frame` 猜 | `action=wait`（带超时 + 条件差异） |
| 归因 | 自己拼 `profile` 命令 | `action=profile` |
| 收工 | 自己找 pid / 杀进程 | `action=stop`（含进程树） |
| 复用 | 每次重写，跑完就废 | 一次调用，参数可变 |

## 实测证据（2026-09-25，本机；报告原文 `.tmp/emudbg/acceptance-report.txt`）

```text
① instances  → 1 个活实例：hlt3 port=49946 pid=22712 bin=TITLE.BIN gate=sleep
② wait {bin:"TITLE\\.BIN"}  → 成立（轮询 1 次，11ms）；state.bin=TITLE.BIN cur=1 ip=52
③ query ["frame","run"]     → frame 200/2ms、run 200/2ms（往返都 2ms）
④ capture @TITLE            → .tmp/emudbg/hlt3-1-title.png 1778973B 1280×720（capture 往返 6976ms）
⑦ input click (1067,478)    → 3 条命令（含合成悬停）共 1080ms：
                              move 1065 478 [3ms] / move 1067 478 [2ms] / click 1067 478 [3ms]
⑧ capture @LoadData         → .tmp/emudbg/hlt3-2-loaddata.png 1795463B 1280×720（6940ms）
⑨ wait {bin:"^(?!TITLE\\.BIN)"} → 成立：bin=SAVE.BIN ←cur（进的是 LOAD 画面）
⑩ input click (1231,358)    → move 1229 358 [8ms] / move 1231 358 [1ms] / click 1231 358 [4ms]
⑪ capture @arrow            → .tmp/emudbg/hlt3-3-arrow.png 1428671B 1280×720（1205ms）
⑫ profile report 20         → 200/3ms：0x1a0 ×120 合计 202.8ms 最坏 3.3ms；慢帧 10 次（帧 #31 工作 137ms）
```

**坐标口径（★订正过一次，见下）**：

* `capture` 的像素坐标 **== 引擎虚拟坐标，1:1（都是 1280×720）** —— 这一条成立且有用：
  用 `capture` 落盘、在图里量出按钮中心，直接把那两个数喂给 `input` 即可。
  （本插件验收里点页号按钮 `(559,21)` 真的翻到 020~029 页；独立一轮实测里点 `(1067,478)`
  真的进了 LOAD 画面、点 `(1231,358)` 真的把列表从 070-079 翻到 080-089 再翻到 090-099。）
* ★**「某个坐标是什么」不许当结论写死**，但**已被反复证实的值也不许写成"未定"**：
  到 2026-09-25，`(1067,478)` = TITLE 的 Load Data、`(1231,358)` = LOAD 画面的右箭头
  **已被三次独立实测证实**（每次都有截图或状态判据）：
  ① 一轮性能定位里用它翻过 070-079 → 080-089 → 090-099；
  ② 本插件 agent 验收里用它进了 LOAD（`cur=2 / SAVE.BIN`）；
  ③ **本插件的 tool 实测**里用它把列表从 `0` 页（000-009）翻到 `10` 页（010-019，截图
     `.tmp/emudbg/vtest-2-load.png` / `vtest-3-arrow.png`）—— 那次实例的 base 是**隔离空目录**，
     所以"空列表 ⇒ 箭头不灵"这个猜想也不成立。
  ★反例只有一条且**原因至今未查明**：另一次验收在 `(1231,358)` 上没翻页。
  ⇒ 规则：坐标一律 **`capture` 现量**（像素 = 虚拟 1:1）；点了没反应先用 `wait` 看脚本名/`global` 变没变，
   再考虑换落点。**不要**因一次失败就把某坐标判死 —— 技能手册里"大箭头点不动"那句就是这么来的（已订正）。
* 页号按钮那条仍然最稳（`(606 + 42*N, 30)`，多种场合验过）：翻页不稳时优先用它。

## 已知限制（都是实测结论，不是猜测）

1. ★**`--attach-headless` 在本会话曾起不来（环境问题，不是本插件的问题；DSH 重启后已复现不了）**：宿主 spawn 的哑窗
   **秒退，退出码 4294967295、零输出**（宿主日志只留一行
   `[web] 无头渲染页退出 code=4294967295`）⇒ 实例活着但 `debug-query` 必然 503。
   同一个 `electron.exe` 由 pwsh **直接**起同样的脚本却**能活**（实测挂住 60s+、`/health.viewers=1`、
   VM 一路跑到 TITLE），所以不是 `tools/attach-headless.cjs` 的错，是"宿主 spawn 出去之后
   那个子进程被本会话环境带走"。**绕过办法**（本次验收就是这么做的）：
   宿主用 **不带** `--attach-headless` 起，再由 agent 用同样的隐藏窗口脚本自己附一个渲染页
   （`show:false` + 那 5 个节流开关）；`viewers` 会显示 1，之后本工具一切照常。
   ⛔**不要**为了这个去改 `app/**` 的 spawn 逻辑：先确认是不是所有终端都这样（本次只有 agent 会话里复现）。
   ★**2026-09-25 DSH 重启后的复测**：`action=start`（`--port 0` → 62692）**无头页一次就附上了** ——
   `action=wait {bin:"TITLE\.BIN"}` **7.8s** 成立、随后 `query`/`capture`/`input`/`profile`/`stop` 全部正常。
   ⇒ 这条按"**会话环境瞬时问题**"记，不是插件的稳定缺陷；再遇到时按上面的绕过办法做。
2. **坐标不属于本插件**：TITLE 菜单的命中位置随**游戏版本**变（本机是 `Version 1.0.0.1`）。
   坐标请用 `capture` 对着量，或用 `plugins/uimap` 的 `amayui_uimap` 扫连通块；本工具只搬坐标。
3. **`wait` 的探针是文本解析**：从 `frame`/`run`/`global` 的人读文本里正则取数
   （`lib/tools.js` 的 `parseFrameLines`/`parseRunLines`）。这些行是 app 侧的稳定契约（有守卫测试），
   但若那几行文案改版，`wait` 会**先失效**（回 `checks[].got=null`），`query`/`capture` 不受影响。
   ★不新开一条"机读命令"是刻意的：那要在 app 侧加第二条真源，而等待是**调用方**的诉求。
4. **`capture` 的耗时是"页面内读回"的真成本**（本机实测 **0.7~7.0s**：冷启动后第一张 ~7s、
   之后同一实例 0.7~1.2s），**不是插件的开销**（同一个实例 `frame` 只要 2~18ms）。
   连着抓多张要有耐心，别把它当成卡死；`capture` 的回执里自带 `capture 往返`，可直接对照。
5. **`stop` 不保证注册项立刻消失**：宿主正常退会摘记录；被硬杀会留一条残记录，
   20s 后自然不算活（`instances` 里消失）。`ok` 的判据是"进程没了"，不是"文件没了"。
6. **`start` 的 `detached:true` 意味着实例不随 DSH 退出而死**：这是刻意的（"实例归 agent 管"），
   代价是收工必须 `action=stop`（或让它 `idle_sec` 到期）。
7. **本工具不碰用户实例**：没有 `instance` 参数而同时有多个活实例时**直接报错**，不猜；
   `stop` 对非本进程起的实例要求 `force:true`。

## 两条不变量为什么不冲突

`lib/index.js` 头上的「纯观察（不 spawn、不 stop）」说的是 **GUI 面板**：面板里没有启动/停止按钮，
它只列实例、只开 iframe。本节的 `start`/`stop` 是 **agent 显式要求**的，进程句柄只活在
`lib/index.js` 的 `spawned` Map 里、**只覆盖"我自己起的那个"**；别人的实例一律只读。
`T-0136` 的教训（"面板不该每次开一个新实例"）因此毫发无损。

## 怎么验（不重启 DSH 也能做）

```bash
node --check plugins/amayui-emulator/lib/index.js
node --check plugins/amayui-emulator/lib/tools.js
node plugins/amayui-emulator/smoke.mjs          # Host 半（路由 + 代理 + 注册表发现）
node plugins/amayui-emulator/smoke-client.mjs   # Client 半（浮窗/iframe 不变式）
```

★`lib/tools.js` 的逻辑是**纯函数级**可自测的（`createExecutor({getRoot, spawned, toolLog})`，
不需要 Cordis 容器）—— 本次验收就是直接调它跑的（见 `.tmp/emudbg/acceptance.mjs`）。
**bundle 成员是启动边界**：改了 `lib/*.js` 要重启 web profile（`dsh web`）工具才会出现。

## 变更历史

* **`T-0181`**：**agent tool `amayui_emulator`（本 README 的「agent tool」整节）**。
  起因是"每次驱动 emulator 都要现场写一个 `.mjs`"（那轮 1.5s 卡顿定位跑了十几次）。
  新增 `lib/tools.js`（`createExecutor` + 注册表扫描 + `POST /api/debug-query` 客户端 +
  PNG 落盘/尺寸 + `wait` 的只读探针），`lib/index.js` 增 `tools` 注入与工具注册，
  `inject` 从 `['fs','webServer']` 扩到 `['fs','webServer','tools']`。
  八个动作：`instances` / `start` / `stop` / `query` / `capture` / `input` / `profile` / `wait`。
  三条硬设计：复用既有 HTTP 路由（不另写驱动逻辑）、**PNG 只落盘不回 base64**、
  **往返毫秒进回执**。GUI 面板的"纯观察"不变量不变（`start`/`stop` 只覆盖本进程起的实例）。

* **`T-0143`**：**静态产物缺失不再只说 `not found`**。宿主 `listen()` 成功后自检
  `dist/web/{index.html,bridge.js,renderer.js}`，缺了就打印含**绝对产物目录**与
  `cd app/amayui-emulator && node build-electron.mjs` 的告警（**不阻止启动**：实例本身照常
  `/health` 正常）；`GET /` 的 404 正文增 `reason`/`distDir`/`fix` 三个字段（原 `error` 形状不变）。
  新增 CLI `--dist-dir`（守卫测试据此指向临时目录）。守卫 `test/host-dist-assets.test.ts`：
  缺产物 ⇒ 告警 + 404 正文三字段 + `/health` 仍 ok；产物齐 ⇒ **不误报** + `GET /` 200 `text/html`。

* **`T-0140`**：**宿主可自持无头渲染页**。`--attach-headless`（或 env `AMAYUI_ATTACH_HEADLESS=1`，
  缺省关）在 `listen()` 成功后 spawn `tools/attach-headless.cjs` —— 一个隐藏 Electron 哑窗
  （`show:false` + 三个 `disable-*-throttling/backgrounding` + `--no-sandbox`）加载实例根 URL ⇒
  **agent 不需要人打开面板**就能 `move`/`capture`（web 形态下没有页面就没有 VM，否则 `debug-query`
  必然 503）。宿主 `close()`/`detachHeadless()`/`process.on('exit')` 三条路径都会收掉它。
  **第二渲染者防护**（策略 = **允许 + 显著告警**，不拒绝：浏览器刷新时新旧 SSE 会短暂并存，
  硬拒会把正常刷新打成故障）：日志 `⚠ 第二渲染者：… N 个**外部**渲染页…`（自持的无头页不计入）、
  `GET /health` 增 `viewers`（活 SSE 数）与 `viewersWarn`。顺带一条诊断改进：
  `[web] status obs=#<观察者序号> frames=<N> {…}` —— 宿主在 SSE 首帧下发序号、`webBridge` 在
  `renderer-status` 里回带，多页面时**按来源拆开**才看得出各自有没有回零（此前 `frames` 被
  `slice(0,200)` 截掉、且两套计数器交错，害得 `T-0138` 把 `402→35` 误判成重启）。

* **`T-0138`**（P0 修复）：**单一 iframe + 观察者数告警**。三种形态从"三个 JSX 分支各挂一个同 `src`
  的 iframe"改成**全树唯一一个 iframe**（无 `key`，`src` 只在换实例时变；源码里
  `createElement('iframe'` 恰好一处），形态差异只落在 `#amayui-emulator-viewport` 的 style 上
  （收起 = 原位 `visibility:'hidden'` + `pointerEvents:'none'`，**不 unmount、不 `display:none`**）；
  模态背板成为**独立兄弟节点**（更低 z-index，不包裹画面框）；面板本体（`PanelChrome`）常驻 DOM、
  收起/模态时 `visibility:hidden`，作为画面框的稳定几何锚点。**效果：收起/放大/关闭不再重建
  iframe ⇒ 不再重启实例、不再丢进度。** 同票新增 `viewers`：Host 半在反向代理里按实例统计活 SSE
  连接数（`Map` + `WeakSet` 防重复减）并写进 `GET /dsh-emulator/api/__instances` 的每个条目，
  面板显示「👁 观察者 N」，N>1 时告警并把「新标签打开」标注为「（会开第二个 VM）」（保留可点）。
  `smoke-client.mjs` 增断言：三态（含**收起且选中实例**）渲染出的 HTML 恰好一个 iframe 且 `src`
  相同、`createElement('iframe'` 源码棘轮、收起→展开→放大→关闭整条序列里 **iframe DOM 节点身份
  不变**（真 `react-dom/client` 挂载 + 节点引用比对，拿不到才降级为元素 props 稳定断言）、
  `viewers` N=1 无告警 / N=2 有告警。app 侧与 `smoke.mjs` 不变。

* **`T-0137`**：形态从"只有全屏模态"改成**常驻浮窗（PiP）**——`shell.overlay` 的组件在**未开模态**时
  也渲染：默认收起为右下角小胶囊（「🖥」+ 活实例数），展开成 `position: fixed` 的面板
  （标题栏可拖 + clamp 视口、两档尺寸 0.5×=640×360 / 0.25×=320×180、「收起」「放大」「新标签打开」
  「↻ 刷新」），「放大」保留原来的全屏模态且**关掉回到浮窗**；`localStorage` 持久化
  `{collapsed,x,y,scale,selectedId}`（坏数据/无 storage 一律退默认）；`pointerEvents:'auto'` 只在
  自己容器上（不破坏 overlay 的点击穿透）；面板**仍然没有启动/停止**。
  `smoke-client.mjs` 相应重写（139 条断言，覆盖胶囊 / 面板 / 两档尺寸 / 拖动监听与清理 / 持久化读写与
  坏数据回退 / 无启动停止 / 空态命令 / 模态可达）；Host 半与 `smoke.mjs` 不变。
* **本次重写（`T-0136`）**：**替代** `T-0135` 的"插件自己 spawn + 启动/停止"形态 ——
  Host 半改纯观察（删 `spawn`/`ensureStarted`/`stop` 与 `api/__start`/`api/__stop`），
  列表改读文件注册表，路由改**每实例** `/dsh-emulator/<id>/…`（流式代理），
  新增 `GET /api/__instances` 与裸前缀 302，未知/已死 id 回 404/410；
  Client 半改纯观察面板（列表每 3s 刷新、点行切换、640×360 同源 iframe、「新标签打开」、
  空列表显示起实例命令，**无启动/停止按钮**）；`smoke.mjs` 改为以 agent 身份真起实例验发现与代理。
  闲置自停由实例侧 `--idle-sec` 执行（缺省 600s）。
  ★`T-0135` 的插件部分在本票被替代；`T-0135` 已验证过的桥（`envelope`/`webBridge`/`webBridgeEntry`）不动。
* `0.1.0`（`T-0135`，**已被替代**）：Host 半 `/dsh-emulator` 反向代理 + `__status/__start/__stop`；
  Client 半头部按钮 + 模态（640×360 同源 iframe）；离线冒烟 `smoke.mjs`。
