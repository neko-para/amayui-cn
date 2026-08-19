# uimap-1 · 天結 UI 元素地图（工具 A）+ 清理工作台（工具 B），源码备份

动态 Cordis 插件（在 DSH 会话进程内定义、运行，**进程重启即消失**）。本目录保存其精确源码，
供 DSH 重启后按下方「恢复步骤」重新创建。**本文件不是可加载的模块**——动态插件只能通过
`cordis_define` + `cordis_run` 重建。

## 保存时的运行状态

- pluginId：`uimap-1`；packageId：`pkg-10`（current）；pluginRunId：`run-9`
- Host 半 + Client 半（Client 激活已获授权：单勾覆盖当前包；后续新包可能仍需一次授权）
- 注册的模型可见工具：`amayui_uimap`
- Client 插槽：
  - `tool.call.toolview`（key `amayui_uimap`）→ 工具结果卡片（已选摘要 + 全屏入口 + 导出）
  - `shell.overlay`（id `uimap-dialog`）→ 全屏模态（地图选择视图 + 清理工作台视图）

## 功能

### 工具 A：UI 元素地图
- 工具 `amayui_uimap`：参数 `png`（必填）、`alpha`（默认 128）、`min_px`（默认 300）；
  经 `shell` 跑 `python3 scripts/uimap/scan_blocks.py --json-only`，最近一次扫描存 Host 内存。
- 全屏模态「地图」视图：图上块分级画框、悬停详情、点击选中/取消（**金色蒙层**）、缩放、
  右侧清单过滤/勾选。
- RPC `uimap-export`：导出选中块 → `.tmp/<名>_selected.json`（png/size/alpha/min_px/selected_count/components）。

### 工具 B：清理工作台（pkg-9 起）
- 模态「清理工作台」视图：对选中块逐块：
  - **列笔画密度直方图**（与背景众数色差异 >120 的像素数/列；蓝=笔画多 灰=保留区 金=填充列；点击选列）；
  - **列填充即时预览**（保留左右 N px、中间逐行复制选中列；keepL/keepR **左右独立**，
    工作画布上金色边界线可**拖拽**调整，拖拽侧红色高亮；预设 纯色15/渐变20/面板40/小按钮23）；
  - 置透明模式；跨图贴底图模式（来源图路径 + 区域坐标，预览拉伸粘贴）；
  - 多块逐个处理，「＋ 加入方案」收集；
- RPC `uimap-clean-export`：写 `.tmp/<名>_clean.json`（方案结构）+ `.tmp/<名>_clean.sh`
  （逐块调用 `scripts/uimap/clean_fill.py` 链式脚本，含 `--keep-l/--keep-r/--fill-col`）。
- 清理执行器：`scripts/uimap/clean_fill.py`（列填充/置透明/贴底图/局部恢复，已支持左右不对称）。

### 关键实现要点（踩坑记录）
- webServer 路由 path **不能带尾斜杠**（match 拼 `prefix+'/'`，带斜杠永不命中 → 请求落 SPA fallback）。
- `webServer.register` 返回 disposer，须用 `ctx.effect(() => register(...))` 包裹，
  否则 update 时旧路由残留 → `duplicate prefix route`。
- Client 动态包**禁用浏览器 timer 全局**（setTimeout/clearTimeout）→ 用 `inject: ['timer']` +
  `ctx.timer.timeout(cb, ms)`（返回 disposer）。
- 共享 store 的订阅 force **必须递增**（`force(n=>n+1)`）；无参 `setState` 在 state 变 undefined 后
  React bail out，后续 `setShared` 全部失效（表现为加载中卡死、关不掉）。
- 列填充预览**必须先 putImageData 还原原始块 ImageData**：原图区域是透明的，`drawImage` 无法覆盖
  透明像素，直接重绘会残留旧填充。

## 恢复步骤（DSH 重启后）

1. 读取 `host.js` 全文，逐字作为 `cordis_define` 的 `code.host`（含开头注释，不要改动转义）。
2. 读取 `client.js` 全文，逐字作为 `cordis_define` 的 `code.client`。
3. `cordis_define` 参数：
   - `plugin`：`{ "kind": "new", "idPrefix": "uimap" }`
   - `name`：`天結 UI 元素地图（工具 A）+ 清理工作台（工具 B）`
   - `purpose`：agent 调用 amayui_uimap 扫描 PNG 连通块后，在全屏模态中点选 UI 元素并导出
     选中清单；清理工作台逐块做列密度统计 + 选列即时预览（列填充/置透明/贴底图），导出
     清理方案 JSON + clean_fill.py 脚本。
   - `code.host`：`host.js` 内容；`code.client`：`client.js` 内容。
   - 新插件 id 会重新分配（如 `uimap-2`），以返回值为准。
4. `cordis_run`（mode `run`）激活返回的 `pluginId` / `packageId`；Client 半首次激活需用户在 GUI 审批。
5. 验证：`cordis_inspect_query`（platform `host` / provider `Tool` / method `listTools`）应出现
   `amayui_uimap`。
6. 使用：聊天中要求「扫描 res/SO020.png 的 UI 元素地图」→ 工具卡片点「🖥 全屏选择」→ 点选 →
   「🧹 清理工作台」逐块清理 → 导出方案；代理读取 `.tmp/<名>_selected.json` / `_clean.json` 继续。

## 变更历史

- `pkg-10`（current）：清理工作台修复——列填充预览前 putImageData 还原原始块（透明区可刷新）；
  keepL/keepR 左右独立 + 画布金色边界线拖拽；`clean_fill.py` 增加 `--keep-r`。
- `pkg-9`：新增清理工作台（密度直方图/选列预览/置透明/贴底图/方案导出）+ RPC `uimap-clean-export`。
- `pkg-8`：修复 store 订阅失效（force 递增），解决加载中卡死与关闭无效。
- `pkg-7`：选中块金色蒙层；模态（shell.overlay）+ 卡片分离。
- `pkg-6`：修复 Client timer——setTimeout 不可用，改 `inject:['timer']` + `ctx.timer.timeout`。
- `pkg-5`：交互卡片挂到工具结果卡片（tool.call.toolview key amayui_uimap）。
- `pkg-4`：修复路由尾斜杠与 disposer（ctx.effect 包裹）。
- `pkg-3`：修复 Client TDZ（btnStyle 移到模块顶部）。
- `pkg-2`：增加 Client 半（首版交互地图）。
- `pkg-1`：Host 半初版（工具 + RPC + 图片路由）。

## 验证记录

- `/dsh-uimap/res/SO020.png` → 200 image/png（字节数 = 原文件）；404 / 路径穿越 400 正确。
- `scan_blocks.py`：SO020 244 块，按钮坐标与 `docs/images/SO020.md` 完全吻合。
- 导出 `_selected.json`：结构与坐标正确（7 个按钮全命中）。
- `clean_fill.py`：对称（15/15）与非对称（10/20）保留均通过逐像素校验。
