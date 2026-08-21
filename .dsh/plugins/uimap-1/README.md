# uimap-1 · 天結 UI 元素地图（工具 A）+ 清理工作台（工具 B），源码备份

动态 Cordis 插件（在 DSH 会话进程内定义、运行，**进程重启即消失**）。本目录保存其精确源码，
供 DSH 重启后按下方「恢复步骤」重新创建。**本文件不是可加载的模块**——动态插件只能通过
`cordis_define` + `cordis_run` 重建。

## 保存时的运行状态

- 最近一次恢复：pluginId `uimap-2`、packageId `pkg-9`（current）、pluginRunId `run-9`（2026-08，Windows 环境）
  —— 恢复后新增 **pkg-3**（解释器自适应）、**pkg-4**（四边保留）、**pkg-5**（两页独立）、
  **pkg-6**（清理预览+窄把手）、**pkg-7**（预览刷新+关插值+整像素）、**pkg-8**（一键打开）、
  **pkg-9**（地图选中优先+导出回归），本备份的 host.js / client.js 已同步为 pkg-9 版本。
- 原始 macOS 保存态：pluginId `uimap-1`；packageId `pkg-10`（current）；pluginRunId `run-9`
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

> 2026-08 恢复时修复：`client.js` 第 801 行（`mainImgRef` 的 `<img>` 元素）原备份含**字面量 `\n`**（`},` 与 `onLoad:` 之间），
> 属备份损坏（自 d150ac0 起即存在），JS 无法解析 → 恢复前已改为真实换行；`node --check` 通过。恢复后本备份即已修正。

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

- `pkg-9`（2026-08 新增）：① **清理工作台块清单「地图选中优先」**——挂载/切图时若地图有选中
  则用选中（新图新选块不再被 `.tmp/*_groups.json` 旧文件覆盖），否则文件 → 全部块；
  ② 模态顶栏恢复**「⬇ 导出选中 JSON」**按钮（pkg-8 重写顶栏时丢失，`doExport` 一直存在）。
- `pkg-8`（2026-08 新增）：**一键打开**——会话头部常驻按钮「🔍 UI 地图」
  （`conversation.session.header.actions` id `uimap-open`）点击自动扫描并打开模态，**无需 agent
  触发工具卡片**；模态顶部新增「🔄 重新扫描」+ png 输入框（可换图）；Host 新增 RPC `uimap-scan`
  （png 缺省用上次路径），`runScan` 抽为公共函数供工具 execute 与 RPC 复用。
- `pkg-7`（2026-08 新增）：修复三处渲染问题——① **预览不刷新**：新增 `imgReady` 状态
  （img onLoad 触发）作为绘制/预览 effect 依赖，参数变化即时重绘；② **canvas 关闭插值**
  （`imageSmoothingEnabled=false`，地图/绘制/编辑/清理预览 4 处 drawImage 均显式关闭），
  放大渲染保持像素锐利；③ **拖拽整像素**：把手命中坐标与位移全部 `Math.round` 取整，
  keep 值始终为整数（不再出现 15.33 这类浮点）。
- `pkg-6`（2026-08 新增）：清理工作台新增**独立「清理效果预览」画布**（干净结果，无边界线/
  蒙层，与编辑画布并排）；边距拖拽把手改窄——命中判定改为**固定 3 屏幕像素**（不再随画布
  缩放变宽），基准线明确为**靠中心一侧的边沿**（保留区/填充区分界线，画线/命中/拖拽同一位置）。
- `pkg-5`（2026-08 新增）：**选区/清理两页独立**——view 状态移入共享 store；工具结果卡片新增
  「🧹 清理工作台」独立入口（不经地图选区直接打开清理页）；`CleanWorkbench` 块清单改为
  **三级独立载入**（`uimap-clean-list` 读 `.tmp/<名>_groups.json` 优先、回退 `_selected.json`
  → 地图选中 → 全部块），组/块下拉选择（optgroup）；Host 新增 RPC `uimap-clean-list`；
  配套生成 `.tmp/<名>_groups.json` 的脚本 `make_so030_groups.py`（与配对检查页同规则）。
- `pkg-4`（2026-08 新增）：列填充模式新增**上下保留范围 keepT/keepB**（四边保留原图，填充后
  上/下边距覆盖回填充结果）；Client 预览/画布四边金色边界线拖拽/方案导出、Host 导出的
  `clean_fill.py` 命令均支持 `--keep-t/--keep-b`；`clean_fill.py` 同步新增两参数（逐像素校验通过）。
- `pkg-3`（2026-08 恢复时新增，恢复后 current）：Python 解释器自适应——运行时先探测 `python3`
  （macOS 约定）、找不到回退 `python`（Windows 常见，本机只有 Python 3.11 + Pillow 11.3）；
  扫描命令与导出的清理脚本均使用检测到的解释器（原 hardcode `python3` 在 Windows 上直接报
  "not recognized"）。注意：Windows 侧 DSH `shell` 服务走 PowerShell，`quote()` 的单引号
  包裹在 PowerShell 与 bash 下均合法。
- `pkg-10`（原始 macOS 保存态 current）：清理工作台修复——列填充预览前 putImageData 还原原始块（透明区可刷新）；
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
