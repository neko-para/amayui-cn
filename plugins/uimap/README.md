# @amayui/uimap · 静态 bundle 插件（amayui_uimap 工具 + UI 元素地图 + 清理工作台）

这是一个**可安装的静态插件**（dsh bundle）：模型可见工具 `amayui_uimap` 扫描天結 UI 图片（PNG）
的 alpha 连通块，工具结果卡内生成交互式 UI 元素地图（全屏模态选择 + 清理工作台），并导出选中清单
与清理方案。

与 `.dsh/plugins/uimap-1/`（动态插件源码备份，进程重启即消失，需 cordis_define 重建）不同：
本目录是**真正的 npm 包**，用 `dsh plugin` 安装后**每次启动自动加载**，无需重启后重建。

## 包结构

```
plugins/uimap/
├── package.json         # dsh.bundle.patch（可被 dsh plugin 安装成 bundle）+ dsh.client（浏览器半区元数据）
├── lib/index.js         # Host 半：ctx.tools.register(defineTool(...)) 注册 amayui_uimap 工具
│                        #   + webServer 路由 /dsh-uimap（图片 + /dsh-uimap/api/* JSON 端点）
├── lib/client.js        # Client 半：window.__ModuleLoader__.load({...}) 注册工具卡 / 全屏模态 / 头部按钮
├── cordis.patch.yml     # insert: name:'@amayui/uimap'
└── README.md            # 本文件
```

## 与动态插件版（.dsh/plugins/uimap-1）的关系

- 本包由 `.dsh/plugins/uimap-1` 的 host.js/client.js（pkg-10 保存态）改写而来，功能一致：
  工具 A「UI 元素地图」+ 工具 B「清理工作台」，含列/行填充、置透明、贴底图、四边保留拖拽、
  独立清理预览、地图选中优先、头部「🔍 UI 地图」一键按钮等全部特性。
- **关键差异**：动态插件用 `harness.handle`/`host.call`（仅动态 cordis 包可用）在 Client↔Host 间传
  RPC；静态 bundle 无此配对，改为**纯 HTTP**——Host 在 `/dsh-uimap` 前缀路由上同时服务图片
  （`/dsh-uimap/<png>`）与 JSON 端点（`/dsh-uimap/api/<method>`），Client 用 `fetch` 调用。
- 其余 API（`shell`/`fs`/`sandboxPolicy`/`webServer`/`tools`/`timer`）在静态 Host 里同样用
  `ctx.get(...)` 读取，行为不变。

## 关键设计

- **Host 半**（`lib/index.js`）：`inject:['tools']` + `ctx.tools.register(defineTool({...}))`；
  工具参数 `png`（必填）/`alpha`/`min_px`。返回结构含 `output.schema` + `render`。
  `execute` 经 `ctx.get('shell')` 跑 `scripts/uimap/scan_blocks.py`（解释器自适应 python3/python）；
  最近一次扫描存进程内 `latest` 状态。
- **webServer 路由**：`ctx.effect(() => webServer.register({ kind:'prefix', path:'/dsh-uimap', handler }))`。
  - `GET /dsh-uimap/<png>` → 直接回 PNG 字节；
  - `POST /dsh-uimap/api/<method>`（`state` / `scan` / `export` / `clean-list` / `clean-export`）→ JSON。
- **Client 半**（`lib/client.js`）：模块加载器格式
  （`window.__ModuleLoader__.load({ id, factory })`，`require("react")` + `ctx.slots`）：
  - `tool.call.toolview`（key `amayui_uimap`）→ 工具结果卡片；
  - `shell.overlay`（id `uimap-dialog`）→ 全屏模态（地图选择视图 + 清理工作台视图）；
  - `conversation.session.header.actions`（id `uimap-open`）→ 常驻「🔍 UI 地图」按钮。
- Client 与 Host 之间所有交互都走 `/dsh-uimap/api/*`；图片走 `<img src="/dsh-uimap/<png>">`。

## 安装与测试（重启后生效，bundle 成员是启动边界）

在工程根目录（`E:\Games\Eushully\天結`）执行：

```powershell
# 把本包安装进 web profile（. 相对安装目录被锚定为工程根 → 安装本 checkout）
dsh plugin --profile web add ./plugins/uimap
```

> 这会把它写进 `$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles`，并 pnpm 装进
> profile 的 `node_modules`。**然后重启 profile**（如重启 web 服务）。

重启后验证：

```powershell
# 不启动、只看合并后的配置树，确认 amayui-uimap 行被插入
dsh --profile web --dump-config | Select-String -Pattern amayui-uimap
```

进 UI 后让它调用一次：

```
amayui_uimap(png="res/SO020.png")
```

工具卡应出现「🖥 全屏选择」入口；或直接点会话头部「🔍 UI 地图」按钮一键扫描并打开模态。

## 本地已校验

- `node --check`：`lib/index.js`、`lib/client.js` 均通过。
- Host 半运行时冒烟：`apply` 用 `ctx.tools.register(defineTool(...))` 注册 **`amayui_uimap`**，
  并用 `ctx.effect(() => webServer.register({kind:'prefix', path:'/dsh-uimap', handler}))` 注册路由；
  `/dsh-uimap/api/*` 各端点（state/scan/export/clean-list/clean-export）都能返回正确 JSON 结构。
- Client 半运行时冒烟：工厂返回 `{ name:'amayui-uimap', inject:['slots','timer'], apply }`，
  `apply` 正确注册 **`tool.call.toolview`**（key `amayui_uimap`）、**`shell.overlay`**（id `uimap-dialog`）
  与 **`conversation.session.header.actions`**（id `uimap-open`）。

## 注意

- **解释器自适应**：运行时先试 `python3`（macOS 约定），找不到回退 `python`（Windows 常见）。
  扫描命令与导出的清理脚本均使用检测到的解释器。Windows 侧 DSH `shell` 走 PowerShell，
  `quote()` 的单引号包裹在 PowerShell 与 bash 下均合法。
- **路由 path 不能带尾斜杠**：`webServer.register` 会拼 `prefix+'/'`，带斜杠永不命中。
  本包 path 用 `/dsh-uimap`（无尾斜杠）。
- **依赖**：`@deepseek-ai/dsh-tools`（Host 运行时）+ `@deepseek-ai/cordis`（peer，仅类型）。
  `dsh.client.inject` 列表与 `@amayui/html-preview-card` 一致（提供模块系统 / slots / 工具卡运行时）。

## 变更历史

- `0.1.0`：由 `.dsh/plugins/uimap-1`（pkg-10）改写为静态 bundle。Host 工具 + `/dsh-uimap` 路由 +
  Client 卡片/模态/头部按钮；Client↔Host 由 `host.call` 改为 `/dsh-uimap/api/*` HTTP 端点。
