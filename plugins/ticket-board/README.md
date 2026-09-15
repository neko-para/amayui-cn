# @amayui/ticket-board · 静态 bundle 插件（顶部「📋 需求单」按钮 + 按优先级的需求模态）

这是一个**可安装的静态插件**（dsh bundle）：在会话顶部的操作区（`conversation.session.header.actions`）
放一个常驻按钮「📋 需求单 N」，点击后用全屏模态（`shell.overlay`）**按优先级 P0→P3 分组**列出
`tickets/` 台账里**还要做**的票据（正在处理 🔜 / 待处理 ⬜，可选被阻塞 ⛔），每条可展开看
「为什么 / 判据 / 证据锚点 / 前置票 / 守卫 / 回链 / 过程文档」。

与 `.dsh/plugins/*`（动态插件源码备份，进程重启即消失，需 `cordis_define` 重建）不同：
本目录是**真正的 npm 包**，用 `dsh plugin` 安装后**每次启动自动加载**。

## 包结构

```
plugins/ticket-board/
├── package.json         # dsh.bundle.patch（可被 dsh plugin 安装成 bundle）+ dsh.client（浏览器半区元数据）
├── lib/index.js         # Host 半：webServer 路由 /dsh-tickets/api/list
│                        #   读 tickets/<ID>/ticket.json（真源）→ 汇总成一个 JSON
├── lib/client.js        # Client 半：window.__ModuleLoader__.load({...})
│                        #   注册 shell.overlay（模态）+ conversation.session.header.actions（顶部按钮）
├── cordis.patch.yml     # insert: name:'@amayui/ticket-board'
├── smoke.mjs            # 离线冒烟：Host 路由 + 聚合结果对真实 tickets/ 核对
├── smoke-client.mjs     # 离线冒烟：Client 两个 slot 用 react-dom/server 真渲染一遍
└── README.md            # 本文件
```

## 数据来源（只读，不写）

唯一真源就是票据台账本身：`tickets/<ID>/ticket.json`（见 `docs-new/00-overview/tickets.md`）。
Host 半**不抄台账进代码**，也不做校验（校验是 `tickets.js --validate` 与守卫测试的事），
只把「机器可读的那一半」复制成一份扁平 JSON：

| 展示在哪 | 来自 |
|---|---|
| 分组（P0→P3） | `priority` |
| 状态药丸 + 顶部按钮徽标 | `status`（`doing` + `open` 计数） |
| 域 / 类型标签 | `area` / `type` |
| 展开区「为什么」 | `why` |
| 展开区「判据」 | `acceptance[]` |
| 展开区「证据锚点」 | `evidence[]{file, anchor, note, line}` |
| 展开区「前置票 / 守卫 / 回链」 | `blockedBy[]` / `tests[]` / `links{}` |
| `+Ndoc`、页脚附件数 | 该票目录里的 `*.md` 文件数、`evidence/` 里的文件数 |
| 卡片右上角日期 | `history[]` 最后一条的 `at` |

`done` / `dropped` **不进模态**（它们不再欠工作），但会在顶栏以
「台账 38 张 · ✅ 25 已完 · 🚫 1 关单」的形式给出总量，便于判断看板是否完整。

## 关键设计

- **Host 半**：`inject:['fs','webServer']` + `ctx.effect(() => webServer.register({kind:'prefix', path:'/dsh-tickets', handler}))`。
  - `GET|POST /dsh-tickets/api/list` → `{ ok, root, dir, generatedAt, counts, tickets[], issues[] }`；
  - `GET /dsh-tickets/` → 端点自述（排障用）；未知端点 → `404 {ok:false}`；
  - 一律 `Cache-Control: no-store`（看板要能立刻反映台账改动）。
- **⚠️ 必须 `inject` `webServer`**：它由 `@deepseek-ai/dsh-web-app` bundle 提供，加载晚于基础
  `fs`。若只 `inject:['fs']`，插件会在 base 阶段挂载，`ctx.get('webServer')` 返回 `undefined`，
  路由被**静默跳过**——表现为按钮与模态都在、但永远报「读取票据台账失败」。
- **工作区根目录**：HTTP 请求没有 agent/session 上下文，只能从 `ctx.get('sandboxPolicy')?.workspaceRoot`
  取（惰性、可选服务）；取不到才退到 `DSH_WORKSPACE_ROOT` / `process.cwd()`。解析结果在每次响应里
  以 `root` 回显、并在模态页脚显示，因此「读的是不是这个仓库」一眼可辨。
- **Client 半**：模块加载器格式（`window.__ModuleLoader__.load({ id, factory })`，`require("react")` + `ctx.slots`）：
  - `conversation.session.header.actions`（id `ticket-board-open`，order 35）→ 顶部按钮；
  - `shell.overlay`（id `ticket-board-dialog`，order 150）→ 模态（uimap 100、htmlcard 200 之间）。
- **静态 bundle 没有 `host.call`**：Client↔Host 全走 `/dsh-tickets/api/*`（与 `@amayui/uimap` 同一套做法）。
- **模态内交互**：状态开关（🔜/⬜/⛔，默认开前两个）、域下拉、全文搜索、↻ 刷新（强制重取）、
  点卡片标题行展开/收起详情。数据 30s 内视为新鲜，避免每次打开都打一次 HTTP。

## 安装与测试（重启后生效，bundle 成员是启动边界）

在工程根目录执行：

```sh
# 把本包安装进 web profile（. 相对安装目录被锚定为工程根 → 安装本 checkout）
dsh plugin --profile web add ./plugins/ticket-board
```

> 这会把它写进 `$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles`，并 pnpm 装进
> profile 的 `node_modules`。**然后重启 profile**（如重启 web 服务）——静态 bundle 的
> Host 半只在启动时挂载，不重启则路由不存在。

重启后验证：

```sh
# 不启动、只看合并后的配置树，确认 amayui-ticket-board 行被插入
dsh --profile web --dump-config | grep -A2 amayui-ticket-board

# 起了 web 服务之后，直接问端点（不看界面也能确认 Host 半活着）
curl -s http://127.0.0.1:3080/dsh-tickets/api/list | head -c 300
```

进 UI 后：会话标题旁应出现「📋 需求单 12」，点击即弹出按 P1/P2/P3 分组的模态
（`12 = doing 1 + open 11`，被阻塞的票默认折叠，用状态开关打开）。

## 本地已校验（不依赖重启）

```sh
node --check plugins/ticket-board/lib/index.js
node --check plugins/ticket-board/lib/client.js
node plugins/ticket-board/smoke.mjs          # Host：路由 + 聚合，对真实 tickets/ 逐项核对
node plugins/ticket-board/smoke-client.mjs   # Client：两个 slot 用 react-dom/server 真渲染一遍
```

- `smoke.mjs`：以 `node:fs` 假装 `ctx.fs` 跑 `apply()`，再拿注册到的 handler 打
  `GET /dsh-tickets/api/list`，核对票数与 `tickets/` 下的 `T-XXXX` 目录数一致、id 集合逐一对应、
  `counts` 与逐票统计一致、待办票的 `priority` 合法且 `title`/`acceptance` 非空、边界路由返回 404。
- `smoke-client.mjs`：先取真实 payload，再加载 Client 半、校验两个 slot 的 id，点击按钮打开模态，
  用 `react-dom/server` 渲染并核对分组头（P1/P2/P3）、状态图例、判据小节、页脚根目录，
  以及**全部待办票都渲染进了模态**。产物 `.tmp/ticket-board-preview.html`（临时区）可直接看外观。

## 注意

- **路由 path 不能带尾斜杠**：`webServer.register` 会拼 `prefix+'/'`，带斜杠永不命中。
  本包 path 用 `/dsh-tickets`（无尾斜杠）。
- **不改台账**：本插件只读 `tickets/`，任何状态流转仍走
  `.agents/skills/amayui-ticket-ledger/scripts/tickets.js`（技能纪律）。
- **不做 OCR/网络请求**：纯本地文件读取。
- **依赖**：无运行时依赖（Host 半不 import `@deepseek-ai/dsh-tools`）；
  `dsh.client.inject` 列表与 `@amayui/html-preview-card`、`@amayui/uimap` 一致。
- `smoke-client.mjs` 需要一份真实 react/react-dom 才能渲染；本仓库里那份在
  `app/amayui-toolkit/node_modules`（React 18）。解析不到时脚本**跳过**渲染核对而不是报错。

## 变更历史

- `0.1.0`：新建。Host 半 `/dsh-tickets/api/list`（读 `tickets/<ID>/ticket.json`）；
  Client 半顶部「📋 需求单 N」按钮 + 按 P0→P3 分组的需求模态（状态开关 / 域过滤 / 搜索 / 展开详情）。
