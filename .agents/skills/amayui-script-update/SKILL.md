---
name: amayui-script-update
description: 对《天結いキャッスルマイスター》汉化工程中**已翻译脚本**执行「译文评估与更新」流程：定位页块与说话人 → 评估并给出字母序号（A/B/C…）候选方案（标注主推）→ 等待用户确认 → 只改页块 `// 输入原文` 注释 → reflow-apply 刷新正文并幂等校验 → assemble → 按「变更记录」节更新 CHANGELOG（新条目放最上方）。当用户要求评估/润色某句译文、修正措辞或标点句式、统一术语，或对已翻译脚本做局部修改时使用；整篇新翻译/重译仍走 amayui-script-translate 技能。
---

# Amayui Script Update（天結已译脚本更新流程）

## 概述

本技能覆盖「已翻译脚本的译文更新」这一完整闭环：评估问题 → 提供编号方案 → 用户确认 →
改页块 → 重排校验 → 汇编 → 变更记录。与 `amayui-script-translate`（整篇翻译）互补；
本技能只处理**局部更新**（单句/单页/少量页的润色、措辞修正、术语统一、标点句式调整），
不负责整篇新翻译或大批量重译。

## 适用场景

- 用户指出某句译文不自然/有疑问，要求评估；
- 用户要求按选定方案修改已翻译脚本的措辞、标点或句式；
- 术语/译名口径变更后的局部回改（跨脚本全量替换仍按 translate 技能流程复核角色语气）；
- 纯文档沉淀（prob/keywords 更新）不涉及 src 时，按 amayui-script-translate 的文档约定执行。

不适用：整篇首次翻译、大批量重排/重译（走 `amayui-script-translate`，必要时交给
`batch-task-runner`）。

## 流程

1. **定位与取证**
   - 在 `src/<脚本>.txt` 定位目标页：`// 输入原文：…` 注释 → 该页正文；
   - 以页首 `// FROM: <id> <名称>` 确定**真实说话人**（不能凭台词内容猜测角色）；
   - 读 `/* 原文存档 */` 块内的日文原句，逐字对照；
   - 检索 `docs/keywords-角色语气.md` 该角色条目，确认语气/自称/句尾风格；
   - 用 `rg` 在 `src/` 检索同类句式与工程既有译法（先例优先）。
2. **评估与建议**
   - 说明问题点（语感/语义/标点句式/冗余/术语），指出日文原句的结构与中文习惯的差异；
   - 给出候选译文，**一律用字母序号编号（A、B、C…）**，并明确标注推荐项（如「主推 A」）；
   - 每个方案附一句话取舍说明（忠实度、语感、行宽等）；
   - 评估阶段**不修改** `src/` 与 `docs/`。
3. **等待确认**
   - 用户选定（可指定字母序号或自拟措辞）后再动手；未确认不得改文件。
4. **修改页块**
   - 只改 `// 输入原文：…` 注释中的整句译文（保留 `<ruby>`/`<nb>` 标注规则）；
   - 正文留空，由 `node reflow-apply.js <脚本>` 统一刷新（scripts 目录执行）；
   - 单行放得下的页最终应是一行 show-text + `// 页面结束`，无 end-text-line。
5. **校验**
   - `node reflow-apply.js --check <脚本>`：0 差异（幂等）；
   - Windows：`npm run assemble -- <脚本>`，必须通过（骨架校验/SJIS/回读验证），
     产物写入 install 根 + DATA1；macOS 流程按 translate 技能登记 PENDING.md。
6. **记录**
   - 按 `references/conventions.md`「变更记录」节，在 `patch/CHANGELOG.md` 当前
     「开发中」版本节**最上方**添加条目（最新在前，不从下方追加）：
     `- [类型][脚本] 改动说明（旧 → 新）`；
   - 条目**不含技术校验信息**（assemble 数字、BIN 字节数等）；
   - `PROGRESS.md` / `patch/patch.config.json` 已有该脚本时不再改动。
7. **报告**
   - 改动前后对照、reflow/assemble 结果、CHANGELOG 追加到的版本节；
   - 若涉及术语口径变更，报告同步的 docs 文件。

## 规则

1. 候选方案**必须用字母序号（A/B/C…）编号**，且必须标注推荐项（「主推 A」）；
   禁止给出无编号、无推荐的并列选项。
2. 评估阶段（用户确认前）不得修改 `src/` 与 `docs/`。
3. 只改 `src/` 与 `docs/`；不修改 `data/` 基线；不执行 git 提交。
4. 说话人以页首 `// FROM:` 为准，不得凭台词内容（如台词里的称呼）推断说话人。
5. 页块修改后必须 `reflow-apply --check` 通过；Windows 上 assemble 必须通过，
   未通过不得报告完成。
6. 行宽 ≤25 中文字/视觉行；放不下时交给 reflow 断行，不手工硬折；
   行尾不得是『。
7. CHANGELOG 条目添加到当前「开发中」版本节最上方（最新在前），格式见 translate 技能
   `references/conventions.md`「变更记录」节；不含 assemble 等技术校验信息。
8. 纯措辞润色标 `[修改]`；术语/译名口径变更标 `[术语统一]`，并同步
   `docs/prob-<脚本>.md` / `docs/keywords-*.md` 且报告关联文件。

## 与 amayui-script-translate 的关系

- 整篇翻译/重译/批量任务：`amayui-script-translate`（+ `batch-task-runner`）；
- 已译脚本的评估与局部更新：本技能；
- 两者共用同一套约定：`references/conventions.md`（页块语法、折行、术语、记录）与
  `references/verify.md`（复核清单）均以 translate 技能内的版本为准。

## 资源

- `src/<脚本>.txt`：开发源（修改对象）；`data/<脚本>.txt`：只读基线（不修改）
- `docs/keywords-角色语气.md`：说话人语气核对
- `patch/CHANGELOG.md`：变更记录（添加到「开发中」版本节最上方）
- `E:\Games\Eushully\天結\.agents\skills\amayui-script-translate\references\conventions.md`：
  页块语法、折行、术语与「变更记录」格式
- `E:\Games\Eushully\天結\.agents\skills\amayui-script-translate\references\verify.md`：
  复核清单（reflow/宽度/结构/记录检查）
