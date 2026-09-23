# @amayui/emulator-view · 静态 bundle 插件（把模拟器的**调试观察画面**嵌进 DSH）

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

## 安装 / 重启边界

```bash
# 工程根
dsh plugin --profile web add ./plugins/amayui-emulator
# ★bundle 成员是**启动边界**：改了 lib/*.js 要重启 web profile（`dsh web`）才会加载
```

验证（不重启也能做）：

```bash
node --check plugins/amayui-emulator/lib/index.js
node --check plugins/amayui-emulator/lib/client.js
node plugins/amayui-emulator/smoke.mjs          # 离线冒烟（Host 半）：路由 + 真起实例 + 注册表发现 + 代理 + 410（含 tsx 冷启）
node plugins/amayui-emulator/smoke-client.mjs   # 离线冒烟（Client 半）：单一 iframe 不变式 / 三态切换不换节点 / viewers 告警 / 常驻胶囊 / 两档尺寸 / 拖动 / localStorage / 无启动停止
dsh --profile web --dump-config | grep -A2 amayui-emulator-view
```

重启后：右下角出现一枚「🖥」小胶囊（徽标 = 活实例数；会话头部也有「🖥 调试画面」按钮）→
点开面板 → 列表里选一个 → 画面出现；「放大」进全屏模态，「尺寸档」切 0.5×/0.25×，拖标题栏挪位置。
列表为空 = 此刻确实没有活实例；按面板里的命令让 agent/自己起一个。

## 依赖与前提

* 插件自身**零运行时依赖**（Host 半只用 `node:fs` / `node:http` / `node:path`）。
* **被观察的 emulator 侧**要有依赖：`app/amayui-emulator/node_modules`（`tsx`）。
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
* 插件**不持有子进程**，所以卸载时没有需要清理的钩子（`T-0135` 的 `SIGTERM` 收尾随之删除）。

## 变更历史

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
