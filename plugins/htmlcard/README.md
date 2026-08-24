# @amayui/html-preview-card · 静态 bundle 插件（preview_html 工具 + 预览卡片 + 全屏模态）

这是一个**可安装的静态插件**（dsh bundle）：模型可见工具 `preview_html`，工具结果卡在对话内
**内嵌 iframe 实时预览** HTML，**点击卡片标题行可打开全屏模态**展开完整预览。

与 `plugins/htmlcard-1/`（动态插件源码备份，进程重启即消失，需 cordis_define 重建）不同：
本目录是**真正的 npm 包**，用 `dsh plugin` 安装后**每次启动自动加载**。

## 包结构

```
plugins/htmlcard/
├── package.json         # dsh.bundle.patch（可被 dsh plugin 安装成 bundle）+ dsh.client（浏览器半区元数据）
├── lib/index.js         # Host 半：ctx.tools.register(defineTool(...)) 注册 preview_html 工具
├── lib/client.js        # Client 半：window.__ModuleLoader__.load({...}) 注册 tool.call.toolview + shell.overlay
├── cordis.patch.yml     # insert: name:'@amayui/html-preview-card'
└── README.md            # 本文件
```

## 关键设计

- **Host 半**（`lib/index.js`）：`inject:['tools']` + `ctx.tools.register(defineTool({...}))`；
  工具参数 `html`（必填）/`title`/`height`/`allowScripts`。返回结构含 `output.schema` + `render`。
- **Client 半**（`lib/client.js`）：预打包的**模块加载器格式**
  （`window.__ModuleLoader__.load({ id, factory })`，`require("react")` + `ctx.slots`）：
  - `tool.call.toolview`（key `preview_html`）→ 工具结果卡片（内嵌 iframe 预览 + 可点击标题行）；
  - `shell.overlay`（id `htmlcard-dialog`）→ 全屏模态。
- **HTML 由工具调用 argsRaw 读取**（`block.call.argsRaw`），因此卡片无需 Host RPC/内存态，
  会话回放、界面刷新后仍可渲染。
- 一个包**双角色**：`dsh.bundle.patch` 让 `dsh plugin add` 把它当作 bundle（加入 profile 的
  `dsh.profile.bundles`，每次启动作为一层配置被应用）；`dsh.client` 让 web 的 modules 节点
  同时加载它的浏览器半区。

## 安装与测试（重启后生效，bundle 成员是启动边界）

在工程根目录（`/Users/nekosu/Documents/Projects/amayui-cn`）执行：

```sh
# 把本包安装进 web profile（. 相对安装目录被锚定为工程根 → 安装本 checkout）
dsh plugin --profile web add ./plugins/htmlcard
```

> 这会把它写进 `$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles`，并 pnpm 装进
> profile 的 `node_modules`。**然后重启 profile**（如重启 web 服务）。

重启后验证：

```sh
# 不启动、只看合并后的配置树，确认 html-preview-card 行被插入
dsh --profile web --dump-config | grep -A2 html-preview-card
```

进 UI 后让它调用一次：
```
preview_html(html="<div ...>...</div>", title="SO020 文字预览", height=420)
```
工具卡应出现内嵌预览 + 可点击标题行 → 全屏模态。

## 本地已校验

- `node --check`：`lib/index.js`、`lib/client.js` 均通过。
- Host 半运行时冒烟：`apply` 用 `ctx.tools.register(defineTool(...))` 注册了 **`preview_html`**（`html` 必填、`execute`/`output.render` 为函数）。
- Client 半运行时冒烟：工厂返回 `{ name, inject, apply }`，`apply` 正确注册 **`tool.call.toolview`**（key `preview_html`）与 **`shell.overlay`**（id `htmlcard-dialog`）。

## 注意

- **图片必须自包含**：iframe `srcDoc` 内相对路径图片不会加载；请把图内嵌为 **base64 data URI**，
  或改用绝对 URL（如其它插件的 `/dsh-uimap/...` 路由）。
- 默认 `sandbox`（禁脚本）；需要脚本时传 `allowScripts: true`。
- 若 `dsh plugin add` 报 pnpm `allowBuilds` 拦截，按提示把 key 写入 profile 的
  `pnpm-workspace.yaml`（本包无 prepare 脚本，通常无需）。
- 依赖：`@deepseek-ai/dsh-tools`（运行时）+ `@deepseek-ai/cordis`（peer，仅类型）。

## 变更历史

- `0.1.0`：初版静态 bundle。Host 工具 + Client 卡片/模态。
