# Amayui Toolkit — 技术方案文档索引

> 面向《天結いキャッスルマイスター》的本地数据查询 / 制作规划应用。
> 工程位置：`app/amayui-toolkit`（本目录即其子目录 `docs/`）。
> 技术栈目标：React + MUI；既可部署为 **GitHub Pages 静态页**，也可经 **Windows 原生 WebView2 薄壳** 按 **ZIP 便携目录**分发。

## 方案速览（TL;DR）

- **做什么**：离线工具，查询工程已反推出的数据（物品 / 建筑 / 配方 / 单位掉落），并做**制作规划**（目标物品 → 递归展开材料树 → 汇总基础材料 → 标注获取途径）。**当前主攻：数据查看 / 检索 / 联动跳转**；规划器为后续独立模块。
- **用什么**：**核心 = 静态 Web 应用**（React 18 + MUI 5 + TypeScript + Vite + `base:'./'`），**SPA 单视图**，页内用**内存历史**维护查阅记录（无需 URL 路由/后端）。数据作为**静态资源**放 `public/data/metadata.json`，运行期 `fetch` 异步加载（**不经 bundler `import`**），**无后端/无 IPC 也能完整运行**（GitHub Pages 前提）。
- **独立 monorepo**：`app/amayui-toolkit` 为独立子工程（不共享 scripts 环境）。**提取脚本、类型与前端都放本工程内**。
- **桌面版（可选/后置）**：同一份静态产物 + **可选薄 WebView2 壳**（推荐 Tauri 2 便携构建），打 **ZIP** 分发（**无安装包**）。仅用于无法访问 GitHub 的自用/分发，非主路径、**不提前介入**。
- **名称**：物品/建筑/单位名直接采用 `src/` 里 ITINIT/PLINIT/EBINIT 的汉化（`set-string "日文|中文"`），**与当前汉化一致**，支持中/日双索引搜索。
- **权威源与衍生物**：`src/` 是唯一权威数据源；提取脚本 `app/amayui-toolkit/scripts/extract-metadata.mjs` 读 `src/` → **直接输出**到 `app/amayui-toolkit/public/data/metadata.json`（统一 schema + 中文名）。该文件是**衍生物**（`public/` gitignored；**GitHub Pages 经独立 deploy 分支在 CI 构建生成并提交**，主分支不提交衍生物；本地 gitignore 仅为调试便利）。

## 文档目录

| 文档 | 内容 | 决策密度 |
|---|---|---|
| [01-需求与范围.md](01-需求与范围.md) | 目标 / 用户 / 用例 / 非目标 / 非功能 | 低 |
| [02-技术选型与架构.md](02-技术选型与架构.md) | 架构（静态优先 + 可选薄壳）、部署、IPC、数据流（核心评估） | 高 |
| [03-数据模型与数据管道.md](03-数据模型与数据管道.md) | 统一 schema（v4 含 skills）、**TS 类型契约**、名称中文化、索引/规划图、一键提取 | 高 |
| [04-功能与界面设计.md](04-功能与界面设计.md) | UI/UX 模块、中/日搜索 + 纯输入输出规划、状态管理 | 中 |
| [05-工程结构与构建打包.md](05-工程结构与构建打包.md) | 目录树（monorepo）、脚手架、依赖、构建、GitHub Pages + ZIP（后置）、测试 | 中 |
| [06-路线图与风险.md](06-路线图与风险.md) | 里程碑、数据语义风险、决策记录 | 中 |

## 决策记录（已按用户拍板）

| # | 决策 | 结论 |
|---|---|---|
| **D1** | 产物/宿主形态 | 核心 = 静态 Web 应用；桌面壳**可选且后置**（推荐 Tauri 2 便携构建），ZIP 分发、**无安装包**，仅服务无法访问 GitHub 的场合。 |
| **D2** | 数据交付 | **静态资源 `public/data/metadata.json`，运行期 `fetch` 异步加载**（不经 bundler `import`）；桌面壳复用同一产物。 |
| **D3** | 中文/日文搜索 | 用 `src/` ITINIT/PLINIT/EBINIT 汉化名（`日文|中文`），双索引，**与汉化一致**。 |
| **D4** | 规划器边界 | 纯用户输入→输出（目标+数量 → 依赖树+汇总），**无背包/持有量状态**；**后置为独立模块**。 |
| **D5** | 代码结构 | **app 为独立 TS monorepo**；提取脚本与 TS 类型都放本工程内；数据**直接输出到 `public/data/metadata.json`**（衍生物，`public/` gitignored，CI 在 deploy 分支生成），`src/` 为权威源。 |

## 数据 / 提取一致性说明（重要）

- **计数已核对**：`metadata.json` 实测 **items=923，buildings=113，recipes=458（物品 356 / 建筑 102），units=373（带掉落 214），dropEntries=671，去重掉落物品 254，maps=145，locations=34，skills=450（带描述 449）**。
- **技能（v4 新增）**：源自 `src/` 的 `SKINIT.txt` + `$1$`..`$5$`，**只导出技能名 + 三行描述文案**（题头 / 详述 / 简述，日中双份）。地址模型（三段并列数组，`skillId = 名串地址 − 0x1d4f4`）与全量校验见 `docs/re/src/05-技能数据.md`；技能的数值字段尚未提取。
- **中文名真值来源**：`src/` 的 `set-string "日文|中文"`（管道分隔），读取 `|` 后半段。`metadata.json` 已带 `nameZh`/`titleZh`/`productZh`。
- **未汉化项**：`metadata.json` 中 `nameZh===name` 的物品 40 / 建筑 8 / 单位 6（未汉化或两侧同名），前端需按“未汉化”回退展示。
- **主工程旧产物/文档**：主工程 `scripts/extract-recipes.js`、`extract-unit-drops.js` 及 `metadata/` 下 5 个旧 JSON（多文件、纯日文、两任务格式）已被本工程的 **单一 `metadata.json`** 取代。**建议**后续把这些旧提取脚本与旧文档（`docs/物品建筑配方.md`、`docs/单位掉落物.md`）对齐到新统一格式；本工程默认忽略，不作真值。
- **待复核**：单位“副标题”地址在 `src` 多落在 `17e` 区间，与某些旧提取脚本的副标题判据（`17f-181`）表面不一致；本脚本沿用现有已验证的判据，产出 `title`/`titleZh` 正确。
