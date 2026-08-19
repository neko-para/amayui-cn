# UI 工具链 — 任务目标与接续说明

> 本文档供**切换环境/重新加载会话**后续接使用。新会话请先读本文档，再读 `docs/images/*.md`
> 了解 UI 汉化现状，然后按第五节完成技术方案评估。
>
> 最近一次讨论时间：2026-08。第五节评估已于新环境（具备动态 Cordis 插件能力）完成并**选定方案 A**，
> 工具 A 已做成 DSH 对话流内直接交互工具（见第八节「当前进度」）。

---

## 一、任务目标（当前待办）

把「UI 元素地图（工具 A）」和「清理工作台（工具 B）」从**"生成 HTML 文件再手动打开"**的形态，
做成**直接的工具**，并**评估一个合理的技术方案**。

用户当前工作环境：**VSCode + DSH**（DSH Web GUI 运行在 VSCode 集成浏览器中，即用户干活的地方）。

任务分两段：
1. **先评估技术方案**（第五节给出候选与推荐，需考虑用户环境）；
2. 方案确定后**实现"直接的工具"**，再继续做工具 B。

---

## 二、背景

《天結いキャッスルマイスター》汉化工程的 UI 图片（AGF/PNG）文字中文化，现状流程（见
`docs/images/SO009A.md`、`SO009B.md`、`SO017.md`、`SO020.md`、`SO021.md`、`SO025.md`、`SO030.md`）：

1. **人工识别**需要处理的 UI 元素（猜坐标 → `cc_scan.py` 逐点查询连通块）；
2. **人工指导**如何从日文图上构造无文字版本（框区域、定清理方式：置透明 / 保留左右 N px 复制第 N+1 列 / 复杂拼接如 SO020 关闭菜单从 SO021 提取底图）；
3. 人工调文字样式（style_tuner 逐场景确认 CSS）→ 渲染 → AGF 注入 → res/patch 同步。

用户认为前半段（1、2）非常繁琐。用户的两点关键反馈（已确认，勿偏离）：

- **不做 OCR**：文案通常很有限，手动输入很快，不引入不稳定的步骤；
- **无文字构造不能全自动**：背景即使是纯色也有噪音，需要人工评估选合适行列，
  甚至复杂拼接 —— 工具应**辅助人工判断**（统计+即时预览），不是替代。

---

## 三、已完成工作

### 3.1 联网调研结论（已与用户确认方向）

- 文字区域自动识别：macOS Vision / PaddleOCR 等可做检测框 —— **用户已否决 OCR 路线**；
- 无文字构造：LaMa/lama-cleaner 等 inpainting 可兜底复杂背景，但均匀/渐变背景
  **结构化填充（现有列填充法的自动化）更稳**；AI 修复在渐变、细描边、8bpp AGF 量化下会出伪影；
- 端到端工具（manga-image-translator / BallonsTranslator / ImageTrans / Dango-Translator）可参考
  检测+去字 pipeline，但产物管线保持工程现有「HTML 渲染 + AGF 注入」。

### 3.2 工具 A：UI 元素地图（已完成并验证）

- `scripts/uimap/scan_blocks.py`：全图连通块扫描（alpha 阈值，纯 Pillow，无 numpy），
  输出**自包含 HTML**（图片 base64 内嵌）：图上块分级画框、悬停详情、点击选中、右侧清单过滤/定位、
  「导出选中 JSON」。
- `scripts/uimap/README.md`：用法与导出 JSON 格式说明。
- 验证（res 图）：
  - `res/SO020.png`（1792×1280）→ `.tmp/so020_blocks.html`，244 块，22 个按钮坐标与
    `docs/images/SO020.md` 完全吻合（如 #1 x=1006..1147 y=6..25，142×20）；
  - `res/SO017.png`（900×1280）→ `.tmp/so017_blocks.html`，115 块，技能名文字块与
    `docs/images/SO017.md` 公式坐标吻合（(88,16) 处 89×23 块）。
- 用法示例：
  ```bash
  python3 scripts/uimap/scan_blocks.py res/SO020.png --min-px 300 --out .tmp/so020_blocks.html
  ```
- 导出 JSON 结构（工具 B 的输入约定）：
  ```json
  { "png": "SO020.png", "size": {"w":1792,"h":1280}, "alpha":128, "min_px":300,
    "selected_count": 22,
    "components": [ {"index":6,"x0":1006,"x1":1147,"y0":6,"y1":25,"w":142,"h":20,"px":2634}, ... ] }
  ```

---

## 四、环境事实与技术线索（新会话调研起点）

- 工程根：`/Users/nekosu/Documents/Projects/amayui-cn`（macOS；图片素材在 `res/`（已处理中文版）与
  `install/DATA1-png/`（Windows 侧日文原版，本机没有）。工具需最终能在 Windows 侧跑，产物尽量纯 HTML+Python）。
- 依赖：Python 3.14 + Pillow 12.3（无 numpy）；Node 可用；VSCode 集成浏览器打开 DSH GUI。
- **DSH 工程级 client-plugin 示例已存在**：`.dsh/plugins/amsrc-1/host.js` ——
  用 `harness.registerTool(ctx, harness.defineTool({...}))` 注册为 agent 可调用工具，
  `inject: ['fs']` 注入文件系统，`output.render` 返回文本；说明 DSH 支持在工程 `.dsh/plugins/`
  目录放 host.js 自动加载插件（该示例是 amayui-script-update 技能的定位取证工具）。
- DSH 安装目录（可查插件机制文档/源码）：
  `/Users/nekosu/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/`
  （`lib/plugin-9h8shc4d.js` 等；`README.zh.md` 在包根）。
- 系统提示中的相关约束（当时语境）：
  - client-plugin 改动在 `pnpm run dev:web`（同一 checkout）运行时热更；否则需重建 Web artifacts 并刷新验证；
  - apps/web 壳改动需 rebuild；当前会话**宣称未提供插件开发能力** → 需确认：能力边界、
    插件加载是否需要重启 DSH、`harness` 对象在插件外的可用性。
- 会话中断原因：当前环境无 DSH 插件开发能力 → 用户切换环境重载会话。

---

## 五、待评估的技术方案（新会话输出评估并选定）

用户诉求：「直接的工具」—— 最好在当前 VSCode 集成浏览器里零切换操作，不用生成 HTML 文件再手动打开。
候选方案：

| 方案 | 形态 | 优点 | 风险/成本 |
|---|---|---|---|
| A. DSH client-plugin | 在 `.dsh/plugins/` 加 host.js，注册一个工具/面板，复用 DSH GUI 与文件系统注入 | 与 agent 工作流一体化，零切换；可读写工程文件、导出 JSON 直接给 agent | 需要 DSH 插件开发能力与加载机制确认；交互（看图/点选/缩放）受 GUI 能力限制 |
| B. VSCode Webview 扩展 | 独立扩展，Webview 面板 + 命令 + 文件选择 | 与 VSCode 原生集成，交互自由 | 需 vsce 工程与调试流程，开发较重；仍要装扩展 |
| C. 本地 HTTP 服务 | Python http.server/FastAPI 起 localhost，集成浏览器 iframe 嵌入或新标签打开 | 实现简单，复用现有 HTML 交互；后端直接读工程文件 | 多一个进程；iframe 嵌入可能受 DSH 页面 CSP/端口限制 |
| D. 维持生成 HTML + 自动打开 | `open` 命令自动在默认浏览器打开生成的 HTML | 最轻量、跨平台、零依赖 | 仍有"文件→浏览器"间接动作；交互在工具页面而非 agent 侧 |

评估维度：开发/维护成本、交互体验（看图、点选、缩放、选列预览）、与 agent 工作流衔接、
跨平台（Windows 侧原图）、依赖面。

### 5.1 评估结论（2026-08 新会话完成，已实测验证）

**选定方案 A：DSH 动态 Cordis 插件**，已在新环境实测可行（本会话具备完整动态插件能力，
上一会话的「无插件开发能力」阻断已解除）：

| 已验证能力 | 实测结论 |
|---|---|
| Host 工具注册 | `harness.registerTool(ctx, harness.defineTool({...}))` 可用（amsrc-1 同款），工具对 agent 可见 |
| Client 交互 UI | `tool.view.cordis`（key: `self`）插槽可用——在 `cordis_run` 卡片内渲染 React 交互区域 |
| Client→Host RPC | `harness.handle(method, handler)` + `host.call(method, args)` 可用，JSON 直通 |
| 文件系统 | `fs` 服务（readText/writeText/readBytes/stat/listDir）可用 |
| 运行 Python 脚本 | `shell` 服务（resolve→run，返回 exitCode/stdout/stderr）可用，可调 `scan_blocks.py` |
| 图片直出浏览器 | `webServer.register({kind:'prefix', path:'/dsh-uimap/'})` 可把 PNG 字节直接流给 GUI 页面，免 base64 膨胀 |

**架构（工具 A 直接形态）**：

1. agent 调用 `amayui_uimap` 工具（参数 `png` / `alpha` / `min_px`）→ Host 经 `shell` 跑
   `scan_blocks.py --json-only`，把最近一次扫描状态存内存；
2. Run 卡片（`tool.view.cordis`）内渲染交互地图：原图 + 块画框、悬停详情、点击选中、缩放、
   右侧清单过滤/勾选（复用 scan_blocks.py 现有 HTML 的交互语义）；
3. 「导出选中 JSON」→ `host.call('uimap-export')` → Host 直写 `.tmp/<名>_selected.json`，
   返回路径给 agent 直接读取 → 无文件下载、无手工打开 HTML。

**否决/回退**：

- 方案 B（VSCode Webview 扩展）：vsce 工程 + 调试流程重，且仍要装扩展，收益与 A 重复，否决；
- 方案 C（本地 HTTP 服务）：`webServer.register` 已提供同源图片服务，无需额外进程；
  仅在 A 不可用时回退；
- 方案 D（生成 HTML + `open`）：保留为**离线备用**（Windows 侧无 DSH 时用），不作为主路径。

**已知成本与对策**：

- 动态插件**进程重启即消失** → 与 amsrc-1 相同：源码备份到 `.dsh/plugins/uimap-1/` 并写恢复步骤；
- 首次激活需 GUI 审批（Client 半）→ 用户点一次允许；
- Run 卡片宽度有限 → 画布按容器缩放 + 缩放按钮；
- 跨平台（Windows 原图）：工具 A 计算核心仍是 `scan_blocks.py`（纯 Pillow），插件只是 DSH 侧交互壳，
  导出 JSON 结构不变，Windows 侧可直接用同一脚本与 JSON 约定。

---

## 六、工具 B：清理工作台（方案确定后实现）

需求（来自用户反馈，务必保留人工判断）：

- 输入：工具 A 导出的 `components` 清单（或直接框选区域）；
- 自动统计区域内每列/每行的**笔画密度曲线**（含噪音阈值），可视化标出可能干净的行列；
- 用户**点击选列/选行 → 即时预览**填充效果（复用现有「列填充」逻辑：保留左右 N px、复制选定列）；
- 支持**多块拼接**（先填一块再填一块，各自选列）；
- 支持**从其它图/块复制干净底图粘贴**（SO020 关闭菜单那种复杂拼接）；
- 导出清理方案 JSON → 生成清理脚本（衔接 `clean_text_area.py` 现有逻辑）；
- 噪音评估与拼接决策由用户定，工具只做统计+预览辅助。

### 6.1 实现形态（2026-08 选定方案 A 后补充）

在工具 A 的同一张 Run 卡片中增加「清理工作台」模式，**像素统计与预览全部在 Client 端 canvas 完成**（零网络往返、即时反馈）：

| 能力 | 实现方式 |
|---|---|
| 块区域放大视图 | 原图已通过 `/dsh-uimap/` 路由加载到浏览器，`drawImage` 到块区域 canvas 并放大 |
| 列/行笔画密度曲线 | `getImageData` 取块区域像素，按列/行统计「实体像素数」（alpha≥128 且与背景色差异超过阈值），画成直方图；标出低密度（可能干净）的列 |
| 点击选列即时预览 | 本地 canvas 像素操作：保留左右 N px、中间逐行复制选中列（纯色底）或复制第 N+1 列（渐变底）——与 `ui-text-styles.md` 列填充规则一致（纯色 N=15 / 渐变 N=20 / 多行面板 N=40 / 小按钮 N=23） |
| 多块拼接 | 块间切换，每块独立记录「保留边距 + 填充列」参数，可逐块确认 |
| 跨图/跨块复制底图 | Client 再加载第二张图的 `/dsh-uimap/<path>`，`getImageData` 取干净块区域，粘贴到目标块（SO020 关闭菜单模式） |
| 导出方案 JSON | `host.call('uimap-clean-export', 方案)` → Host 直写 `.tmp/<名>_clean.json`，并生成清理脚本（`clean_text_area.py` 同逻辑的 Python 脚本） |
| 衔接工具 A | 从工具 A 已选中的块直接「进入清理」；导出文件名与 A 的 `_selected.json` 对应 |

人工判断保留点：密度曲线只做统计与高亮，选哪一列/是否干净由用户看预览决定；复杂拼接（贴底图 + 局部恢复）由用户框选来源块与恢复区域。

---

## 七、参考文件清单

- 现状文档：`docs/images/*.md`（7 篇）
- 技能：`.agents/skills/amayui-ui-text-render/SKILL.md`（含 clean/analyze/cc_scan 脚本用法）
- 工具 A：`scripts/uimap/scan_blocks.py`、`scripts/uimap/README.md`
- 产物示例：`.tmp/so020_blocks.html`、`.tmp/so017_blocks.html`
- 现有 DSH 插件示例：`.dsh/plugins/amsrc-1/host.js`、`.dsh/plugins/amsrc-1/README.md`
- 工具 A 直接形态（动态 Cordis 插件）：`.dsh/plugins/uimap-1/`（host.js / client.js / README.md）
- 素材：`res/SO009A.png`、`SO009B.png`、`SO017.png`、`SO020.png`、`SO021.png`、`SO025.png`、`SO030.png`
- 复现命令：见 `scripts/uimap/README.md`

## 八、当前进度（2026-08，新环境）

1. **第五节评估已完成并选定方案 A**（见 5.1，本环境具备动态 Cordis 插件能力，已实测验证）。
2. **工具 A 直接形态已实现**（动态插件 `uimap-1`，源码备份于 `.dsh/plugins/uimap-1/`）：
   - Host 半：工具 `amayui_uimap`（shell 调 `scan_blocks.py --json-only`）+ RPC `uimap-state` / `uimap-export`
     + webServer 路由 `/dsh-uimap/*`（PNG 直出浏览器）；
   - Client 半：`tool.view.cordis`（key self）Run 卡片内交互地图（画框/悬停/点选/缩放/清单/导出）；
   - 导出 JSON 直写 `.tmp/<名>_selected.json`，结构与 scan_blocks.py 导出一致。
3. **验证状态**：`uimap-1/pkg-3` 已定义并提交 `cordis_run`，Client 半首次激活需 GUI 审批
   （run-1 曾因 `btnStyle` TDZ 渲染失败，pkg-3 已修复；审批通过后即激活）。
4. **工具 B 设计已定**（见 6.1，Client 端 canvas 统计+预览），待工具 A 验证通过后实现。

---
