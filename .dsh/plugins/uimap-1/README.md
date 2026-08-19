# uimap-1 · 天結 UI 元素地图（工具 A 直接形态，源码备份）

动态 Cordis 插件（在 DSH 会话进程内定义、运行，**进程重启即消失**）。本目录保存其精确源码，
供 DSH 重启后按下方「恢复步骤」重新创建。**本文件不是可加载的模块**——动态插件只能通过
`cordis_define` + `cordis_run` 重建。

## 保存时的运行状态

- pluginId：`uimap-1`；packageId：`pkg-4`（current）；pluginRunId：`run-3`
- Host 半 + Client 半（Client 首次激活需 GUI 审批）
- 注册的模型可见工具：`amayui_uimap`
- Client 插槽：`tool.view.cordis`（key `self`）→ Run 卡片内交互地图

## 工具行为（amayui_uimap）

- 参数：`png`（必填，相对工程根如 `res/SO020.png` 或绝对路径）、`alpha`（默认 128）、`min_px`（默认 300）。
- 执行：经 `shell` 服务运行 `python3 scripts/uimap/scan_blocks.py --json-only`，把最近一次扫描
  （png/size/alpha/min_px/blocks/imageUrl）存入 Host 内存。
- 与 `amayui-ui-text-render` 技能协同：第一步「定位 UI 元素坐标/按钮区域」由本工具直接在
  Run 卡片内交互完成，无需再猜坐标 + cc_scan 逐点查询、无需生成 HTML 手动打开。
- 图片经 `webServer` 路由 `/dsh-uimap/<相对路径>` 直接流给页面（免 base64 膨胀）。
- RPC：
  - `uimap-state`：Client 拉取最近一次扫描状态；
  - `uimap-export`：Client 提交选中块 index 清单 → Host 直写 `.tmp/<名>_selected.json`（结构同
    工具 A 导出约定：png/size/alpha/min_px/selected_count/components）并返回路径。

## 恢复步骤（DSH 重启后）

1. 读取 `host.js` 全文，逐字作为 `cordis_define` 的 `code.host`（含开头注释，不要改动转义）。
2. 读取 `client.js` 全文，逐字作为 `cordis_define` 的 `code.client`。
3. `cordis_define` 参数：
   - `plugin`：`{ "kind": "new", "idPrefix": "uimap" }`
   - `name`：`天結 UI 元素地图（工具 A 直接形态）`
   - `purpose`：`agent 调用 amayui_uimap 扫描 PNG 连通块后，在 Run 卡片内渲染可交互 UI 元素地图（画框/悬停/点选/缩放），导出选中清单 JSON 直写工程 .tmp/ 目录供 agent 直接读取。`
   - `code.host`：`host.js` 内容；`code.client`：`client.js` 内容。
   - 新插件 id 会重新分配（如 `uimap-2`），以返回值为准。
4. `cordis_run`（mode `run`）激活返回的 `pluginId` / `packageId`；Client 半首次激活需用户在 GUI 审批。
5. 验证：`cordis_inspect_query`（platform `host` / provider `Tool` / method `listTools`）应出现
   `amayui_uimap`。
6. 使用：在聊天中要求「扫描 res/SO020.png 的 UI 元素地图 / 定位按钮坐标」即可；代理调用工具后，
   用户在 Run 卡片点选并导出，代理读取 `.tmp/<名>_selected.json` 继续清理流程。

## 变更历史

- `pkg-4`（current）：修复 webServer 路由——`path` 去掉尾斜杠（match 逻辑 `startsWith(prefix + '/')`，
  带尾斜杠会拼成 `/dsh-uimap//` 永不命中，请求落到 SPA fallback）；注册用 `ctx.effect` 包裹
  （保留 disposer，避免 update 时旧路由残留导致 `duplicate prefix route`）。
- `pkg-3`：修复 Client TDZ——`btnStyle` 常量移到模块顶部（模块求值与 React 渲染同步，
  底部声明会触发 `Cannot access 'btnStyle' before initialization`）。
- `pkg-2`：增加 Client 半（Run 卡片交互地图）。
- `pkg-1`：Host 半初版（工具 + RPC + 图片路由）。

## 验证记录（pkg-4，2026-08）

- `curl /dsh-uimap/res/SO020.png` → `HTTP 200 image/png`，字节数与 `res/SO020.png` 一致（2171229）；
- `curl /dsh-uimap/res/nonexistent.png` → `HTTP 404`；`curl /dsh-uimap/..%2Fpackage.json` → `HTTP 400`（路径穿越拦截）；
- `amayui_uimap` 在 `Tool.listTools` 可见；`scan_blocks.py --json-only` 链路正常（244 块，与 docs 吻合）。
