---
name: amayui-script-translate
description: 直接执行《天結いキャッスルマイスター》汉化工程的游戏脚本翻译流程：把 src/*.txt（如 SC0000、SC0001、OPINIT1）从日文翻译为简体中文，并按既有约定完成排版（≤25 字/行）、构建校验（assemble；macOS 无法汇编时在 PENDING.md 登记未编译条目）。当用户要求：翻译/重译某个游戏脚本、重排已翻译脚本、或并行翻译多个脚本时，使用本技能（单脚本在本会话内直接执行；批量/并行长流程可交由 batch-task-runner 技能用 codex CLI 子进程顺次执行）。
---

# Amayui Script Translate（天結い脚本翻译）

## 概述

本会话内**直接执行**单脚本翻译流程，不调用 codex CLI 子进程：逐页翻译 `src\<脚本>.txt`，遵循工程既有约定（翻译语法、注音策略、块注释存档、≤25 字折行、术语表、角色语气），最后校验——Windows 上用 `assemble`，macOS 上无法汇编/安装，改用本地校验并在项目根 `PENDING.md` 登记未编译条目。多个脚本可在本会话内依次处理（并行 = 每会话处理一个脚本，多开会话即可）。**批量场景**（一次处理多个脚本/大量同质任务、流程长、需稳定可续跑）可改用 `batch-task-runner` 技能，用 codex CLI 子进程顺次执行，见下节。

## 批量执行（可选；可借助 codex CLI）

单脚本翻译始终在本会话内直接执行；当用户要求**批量**处理多个同质任务（如一次翻译/重排 N 个脚本、并行多会话、逐脚本长流程）时，不再回避 codex CLI——改用 `batch-task-runner` 技能：

1. 在 `.tmp/` 下建任务专用目录（如 `.tmp/batch-translate/`）：`tasks.json`（每脚本一个任务，id=脚本名，input=`src/<脚本>.txt`）、`PROMPT.md`（通用模板）、`PROGRESS.md`（进度）。
2. `PROMPT.md` 模板必须内联本技能的**全部硬性约定**，并引用 `references/conventions.md`：
   - 三段式页块（`/* 原文存档 */` → `// 输入原文：…` → `@"译文"` → `// 页面结束`）；
   - ≤25 字折行与 reflow（`node reflow-apply.js <脚本>`）；
   - 每页按 `// FROM: <id> <名称>` 查 `docs/keywords-角色语气.md` 保持角色语气；
   - 术语表（`docs/glossary-draft.md`）、SC/SG 联动、不修改 `data/`；
   - macOS 流程：不 assemble，本地校验后登记项目根 `PENDING.md`。
   - 记录：子进程不写 `PROGRESS.md` / `patch/patch.config.json` / `patch/CHANGELOG.md`，
     由主进程统一追加（避免并发重复记账）。
3. 用 `batch-task-runner/scripts/batch-run.js` 顺次执行（每次 codex CLI 调用输出/日志独立落文件，失败重试、断点续跑）。
4. 全部完成后按「流程 4–7」统一复核、沉淀文档、登记记录并汇报。

子进程提示词必须引用约定文档而非自由发挥；单脚本仍走本技能直接流程，批量只是把同一套约定分发给多个 codex 子进程。

## 环境事实（仓库 E:\Games\Eushully\天結）

- `data\<脚本>.txt`：只读日文基线（**严禁修改**），assemble 骨架校验依据
- `src\<脚本>.txt`：开发源（修改对象；未翻译时为基线副本）
- `docs/glossary-draft.md`：已确认术语（仙灵 / 迪尔-利菲娜 / 天结神缘）与名词/世界观背景
- `docs/prob-决策清单.md`：跨文件译名/术语定稿决策表（唯一决策源）
- `docs/keywords-角色语气.md`：角色语气汇总（70 个角色；翻译时按页首 `// FROM: <id> <名称>` 定向检索）
- `docs/prob-角色翻译不一致.md`：已有译文不一致清单（2026-08-12 定案）
- `scripts/translate.js`：assemble（骨架校验 + SJIS + 回读）
- `scripts/lib/reflow.js` + `scripts/reflow.js`：折行工具（`npm run reflow`）
- Decompiler（已改用 cmake 构建，二进制为 `tools\eushully-decompiler\build\Release\age-asm.exe`）
  路径必须走 ASCII junction `E:\Games\Eushully\wk -> 天結`（translate.js 已内置）
- macOS 环境：当前仓库可在 macOS（`/Users/nekosu/Documents/Projects/amayui-cn`）上翻译与本地校验
  （node 工具均可运行）；assemble 与安装（SJIS 写盘 / install 树 / DATA1 写入）依赖 Windows，
  macOS 上翻译/修改完成后在项目根 `PENDING.md` 登记「已翻译、未编译」条目（格式见 conventions.md）。

## 流程

1. **准备**：确认目标脚本存在于 `data\` 与 `src\`；读 `references/conventions.md` 与
   `docs/glossary-draft.md`、`docs/prob-决策清单.md`；了解 `docs/keywords-角色语气.md`
   的角色条目结构与 `docs/prob-角色翻译不一致.md`（翻译时按 FROM 定向检索，不必通读）。
2. **翻译**：按 `references/conventions.md` 的规则逐页修改 `src\<脚本>.txt`：
   - 每个 ADV 页先看页首 `// FROM: <id> <名称>` 确定说话人（`none` = 旁白），
     翻译前在 `docs/keywords-角色语气.md` 检索该角色条目，按其中「日文表达风格 /
     中文译文风格 / 翻译一致性注意事项」保持语气与译名一致；
   - 每个文本页：`/* 原文存档 */` 块注释（原文逐字含外字）→ `// 输入原文：…` 单行注释 →
     `@"译文"` 正文；
   - ADV 页较多（如 SC*）用「提取 → 映射 → 批替换 → reflow-apply」流程
     （见 conventions.md「大批量 SC 脚本」节），临时映射 JSON 用后即删；
     页数很少时才手工逐页改块，每完成约 30–50 页写回一次文件。
3. **构建校验**：
   - Windows：在 `scripts` 目录运行 `npm run assemble -- <脚本>`，必须通过
     （骨架校验 / SJIS / 回读验证），产物写入 install 根 + DATA1。
   - macOS：无法 assemble / 安装。改用本地校验（`reflow-apply.js --check`、
     `find-untranslated.js`、宽度/结构检查，见 `references/verify.md`），
     并在项目根 `PENDING.md` 登记该脚本（完全新翻译与修改均登记）。
4. **复核**：按 `references/verify.md` 检查宽度（≤25 中文字）、结构（`// 输入原文` 注释、
   末行无 end-text-line、concat 规则）、git status 只出现预期文件。
5. **文档沉淀**：为存疑名词建立/更新 `docs/prob-<脚本>.md`（待定清单，按专名/技能名/跨文档不一致/
   原文疑误分类）；为关键术语建立/更新 `docs/keywords-<主题或脚本>.md`（关键字表，已有同主题文档
   则合并更新，如 `keywords-装备与物品.md`）；必要时同步 `docs/README.md` 的目录与完成状态。
6. **记录**：
   - Windows：翻译完成后更新 `PROGRESS.md`（把脚本加入已翻译索引）、`patch/patch.config.json`
     （把 assemble 产物 BIN 加入补丁同步清单）与 `patch/CHANGELOG.md`（按 conventions.md
     「变更记录」节，把本次改动条目添加到「开发中」版本节最上方）。
   - macOS：只更新项目根 `PENDING.md`（同一脚本已有条目则更新合并，不重复追加）；
     `PROGRESS.md` 与 `patch/patch.config.json` 留待 Windows assemble 通过后登记。
7. **报告**：翻译统计、术语应用、assemble 结果（macOS 流程为 PENDING.md 登记情况）、
   CHANGELOG 追加情况（版本节与条目数）、文档沉淀路径、存疑名词清单。

## 关键约定（概要；完整规则见 references/conventions.md）

- 文本行（set-string/show-text/display-furigana/concat/end-text-line/draw-string）可增删改；
  其余控制行与 data 基线逐字节一致。
- set-string：`"原文|译文"` 对语法；ADV 文本：`/* 原文存档 */` 块注释 + `// 输入原文：…` + `@"译文"` 行。
- draw-string：参数化控件文本（`draw-string <纹理> <x> <y> <文本>`），前 3 个操作数为绘制参数不动，
  尾参为字面量时用对语法或 `@"译文"`；尾参为寄存器/全局字符串引用时不译（源表已译）。
- SC/SG 联动：SC 内以 `comment "▼Gxxxx　分节标题"` 隐式分节（原文标记，非翻译内容）；
  翻译 SC 时一并检查并翻译对应 SG 系统提示（SG 编号 = SC 内 G 分节编号，A/B 后缀为多页），
  SG 按系统提示风格翻译，PROGRESS 中 SG 表述为「第Ｘ章（汉字，如 第一章）- [分节注释意译]」。
- 注音：释义/称号类保留为 display-furigana（中文释义作注音）；纯读音类只存档。
- 折行：≤25 中文字/视觉行；行间 end-text-line；页面最后一行不加 end-text-line；
  `<br>` 强制换行保留分段；concat 仅当原文有才生成镜像行。
- 页块三段式：`// 输入原文` 注释 + 正文 + `// 页面结束` 结束注释；行尾不得是『（提前折行）。
- 术语：仙灵 / 迪尔-利菲娜 / 天结神缘；其余查 docs/glossary-draft.md。
- 角色语气：按页首 `// FROM: <id> <名称>` 查 `docs/keywords-角色语气.md` 对应条目，
  保持自称/称呼、敬语层级、句尾语气、口头禅、拟声、译名一致；修正已有不一致时
  对照 `docs/prob-角色翻译不一致.md` 的定案口径。
- 沉淀：prob-<脚本>.md（待定）+ keywords-<主题>.md（关键字表）→ docs/；同步 docs/README.md。
- 记录：Windows 上翻译完成后改 PROGRESS.md、patch/patch.config.json 与 patch/CHANGELOG.md
  （变更条目添加到「开发中」版本节最上方）；macOS 上只写项目根 PENDING.md（已翻译未编译登记），待 Windows assemble
  通过后再登记 PROGRESS/patch.config/CHANGELOG。
- 不修改 data/；不执行 git 提交。

## 资源

- `references/conventions.md`：完整翻译约定（语法、注音、折行、concat、术语、执行步骤、报告）
- `references/verify.md`：复核清单（assemble / 宽度 / 结构 / git status / 抽查）
- `patch/CHANGELOG.md`：补丁更新记录（修改完成后按约定追加条目）
- `docs/keywords-角色语气.md`：角色语气汇总（70 个角色；按 FROM 定向检索对应条目）
- `docs/prob-角色翻译不一致.md`：已有译文不一致清单（含 2026-08-12 定案状态）
- `scripts/extract-pages.js`：提取 ADV 页清单 / 生成译文映射骨架（`--out`），大批量 SC 流程第 1 步
- `scripts/apply-page-blocks.js`：按译文映射批量替换为三段式页块（校验全覆盖），大批量 SC 流程第 3 步
- `batch-task-runner` 技能：批量执行多个同质任务（codex CLI 子进程顺次执行），见「批量执行」节
