# 04-app · amayui-toolkit

面向《天結いキャッスルマイスター》的本地数据查询 / 制作规划应用。

## 1. 做什么

- 查询工程已反推出的数据（物品 / 建筑 / 配方 / 单位掉落），并做**制作规划**（目标物品 → 递归展开材料树 → 汇总基础材料 → 标注获取途径）。
- **当前主攻：数据查看 / 检索 / 联动跳转**；规划器为后续独立模块。

## 2. 技术选型与架构

- **核心 = 静态 Web 应用**：React 18 + MUI 5 + TypeScript + Vite + `base:'./'`；**SPA 单视图**，页内内存历史维护查阅记录（无 URL 路由/后端）。
- 数据作为静态资源放 `public/data/metadata.json`，运行期 `fetch` 异步加载（**不经 bundler `import`**），**无后端/无 IPC 也能完整运行**（GitHub Pages 前提）。
- **独立 monorepo**：`app/amayui-toolkit` 独立子工程（不共享 scripts 环境）；提取脚本、类型、前端都放本工程。
- **桌面版（后置/可选）**：同一份静态产物 + 可选薄 WebView2 壳（推荐 Tauri 2 便携构建），打 **ZIP** 分发（无安装包），仅服务无法访问 GitHub 的场合。
- 名称：物品/建筑/单位名直接采用 `src/` 里 ITINIT/PLINIT/EBINIT 的汉化（`"日文|中文"`），支持中/日双索引搜索。

## 3. 数据 / 提取一致性（重要）

- **`src/` 是唯一权威数据源**；`scripts/extract-metadata.mjs` 读 `src/` → 直接输出 `public/data/metadata.json`（统一 schema + 中文名）。该文件为**衍生物**（`public/` gitignored；GitHub Pages 经独立 deploy 分支在 CI 生成提交）。
- **计数已核对**：`items=923`、`buildings=113`、`recipes=458`（物品 356/建筑 102）、`units=373`（带掉落 214）、`dropEntries=671`、去重掉落物品 254、`maps=145`、`locations=34`、`skills=450`（带描述 449）。
- `trainings[]`（DRINIT，v6）：`(trainerId, tid)`，字段 `prereq/quantity/race/gender/attribute/level/skillId`；`skillId` 100% 命中 `skills[]`。
- `units[]` 含 `race/gender/attribute`（枚举见 `src/types/metadata.ts` 的 `RACE_NAME/GENDER_NAME/ATTR_NAME`）。
- `skills[]`（v4）：源自 `src/` 的 SKINIT + `$1$`..`$5$`，只导出技能名 + 三行描述（题头/详述/简述，日中双份），地址模型 `skillId = 名串地址 − 0x1d4f4`。
- 中文名真值：`src/` 的 `set-string "日文|中文"`（管道分隔），读 `|` 后半段。
- **未汉化项**：`nameZh===name` 物品 40 / 建筑 8 / 单位 6（未汉化或同名），前端按「未汉化」回退展示。
- 特例：`0xcb 系留员神殿兵` 属性为 null（模板占位）。

## 4. 决策记录（D1–D5）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 产物/宿主形态 | 核心 = 静态 Web 应用；桌面壳**可选且后置**（Tauri 2 便携构建），ZIP 分发、无安装包 |
| D2 | 数据交付 | **静态资源 `public/data/metadata.json`，运行期 `fetch` 异步加载**；桌面壳复用同一产物 |
| D3 | 中/日搜索 | 用 `src/` ITINIT/PLINIT/EBINIT 汉化名（`日文|中文`），双索引，与汉化一致 |
| D4 | 规划器边界 | 纯用户输入→输出（目标+数量→依赖树+汇总），无背包/持有量；**后置为独立模块** |
| D5 | 代码结构 | `app` 独立 TS monorepo；提取脚本与类型放本工程；数据直出 `public/data/metadata.json`（衍生物，CI 在 deploy 分支生成） |

## 5. 目录 / 构建

```
app/amayui-toolkit/
├─ index.html / vite.config.ts / package.json / tsconfig.json
├─ src/          # React + MUI 前端 + types/metadata.ts
├─ scripts/      # extract-metadata.mjs
├─ public/data/  # metadata.json（衍生物，gitignored）
└─ docs/         # 方案文档（工程内部留存，不作新来源）
```

## 6. 交叉引用

- 数据表结构见 `../02-data/`（drops/skills/items-recipes/maps-units/training-speakers）；提取口径见 `../02-data/extraction.md`；翻译真值见 `../01-translation/publish-status.md`。
- 本工程按 D5 为独立 monorepo，**不引用旧的方案文档作为新来源**（其 01-06 内容已并入本文件要点）。
