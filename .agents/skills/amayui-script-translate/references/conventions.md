# 天結い脚本翻译约定（直接执行用）

把 `<SCRIPT>` 替换为目标脚本名。以下规则必须全部遵守；`assemble` 的骨架校验会强制其中一部分。

## 翻译语法

- 文本指令行 = `set-string` / `show-text` / `display-furigana` / `concat` / `end-text-line` /
  `draw-string`，允许增删改；
  其余控制行必须与 `data\<SCRIPT>.txt` 逐字节一致（严禁修改）。
- `set-string`：字符串内用对语法 `"原文|译文"`（原文须与基线一致）。
- ADV 页文本：
  - 把该页全部原始文本行（show-text/display-furigana，以及页内原有的 concat/end-text-line）逐字保留
    外字 U+E000–E010，包进块注释：
    ```
    /* 原文存档（对照用，不参与汇编）
    show-text 0 "壁に"
    display-furigana 0 "刻" "きざ"
    ...
    */
    ```
  - 块注释下写 `// 输入原文：<该页排版前译文（整句），含 <ruby> 标记>` 单行注释；
  - 正文**留空**，页块末行写 `// 页面结束` 特殊结束注释（页块显式边界，供 reflow-apply 定位）；
  - 整页译完后运行 `node reflow-apply.js <脚本>` 从 `// 输入原文` 注释自动刷新正文
    （宽度 ≤25、行尾『、孤行优化均由 reflow 处理；`--check` 幂等验证；
    **不要手工排版正文后再反向检查宽度**）；display-furigana 释义类译成
    `display-furigana 0 @"主词" @"释义"`。
- `draw-string`：参数化控件文本（`draw-string <纹理> <x> <y> <文本>`）。前 3 个操作数为绘制参数
  （纹理 / x / y），必须保持不动；尾参为字面量时用 `"原文|译文"` 对语法或 `@"译文"` 标记；
  尾参为寄存器（`(local-string …)` / `(local-string-ptr …)`）或全局字符串引用时**不译**
  （内容来自已翻译的源表，如 INFO* 页标题/单位名/道具名）。

## 注音策略

- 释义/称号类注音（第二参数是释义/称号，如 `ディル＝リフィーナ "二つの回廊の終わり"`）→
  保留在 display-furigana 位置，中文释义作注音；
- 纯读音（假名）类注音（如 `古神 "いにしえがみ"`）→ 只进块注释存档，译文不写。

## 折行规则（每页）

- 译文按 **≤25 中文字/视觉行** 排版（ASCII 按半字计）；放不下提前折行；
- 行尾不得是『（左引号）：若某行会以『结尾，提前折行把『移到下一行行首；
- 行与行之间用 `end-text-line 0` 分隔；**页面最后一行不加 end-text-line**
  （reflow 会在行间生成/调整 `end-text-line 0`；页末 `wait-for-input 0` 保留，
  其后的 `end-text-line 0` 属可增删的文本行，不要求原样保留）；
- 显式换行：译文可插入 `<br>` 强制断行（断行位置由译员决定，正文中体现为
  end-text-line 分隔的独立视觉行；含 `<br>` 时 reflow 跳过孤行优化）。
  适用于需保留原文分段的多段页（如 SG5744 类系统提示页：技能名行 + 说明行）。
- 单行能放下的页：一条 show-text（+ 需要的 display-furigana），不加 end-text-line；
- `draw-string` 为固定控件文本（非 ADV 视觉行），不适用 ≤25 字规则；但受控件绘制宽度限制，
  译文超宽需精简或用更短同义词，并在游戏内确认不溢出。
- 建议用 reflow 工具排版：把该页译文（含 `<ruby>主词<rt>释义</rt></ruby>` 标注）写入临时文件，运行
  `node scripts/reflow.js <临时文件> [--no-concat] --glossary rules/glossary.json`（输出为三段式：`// 输入原文` + 正文 + `// 页面结束`），把输出贴到 src；
  也可手工按上述规则排版。

## concat

仅当原文页内有 concat 时才生成镜像行（镜像紧随其前的 show-text 段译文，保持段边界）；
原文没有 concat 的脚本一律不生成（如 SC0000）。

## 大批量 SC 脚本：提取 → 映射 → 批替换 → reflow-apply

适用于 ADV 页较多的脚本（SC* 通常 30–300 页），避免逐页手工改块造成外字/控制行失真、
补丁体积过大与进度丢失。整套工具位于本技能 `scripts/` 目录，全程在工程根目录执行：

1. **提取页面清单**（只读分析，可生成译文映射骨架）：
   ```
   node ".agents\skills\amayui-script-translate\scripts\extract-pages.js" <SCRIPT> --out scripts\tmp-<SCRIPT>-map.json
   ```
   输出每页「页首行号 + 原文行」；`--out` 同时写入骨架 `{ "页首行号": "" }`。
   页面 = 连续文本指令段（show-text / display-furigana / concat / end-text-line / draw-string
   等文本类指令放在一起）；`wait-for-input 0` 为页间硬边界，其后的文本行属于下一页，
   不会与前面合并重排。纯引用页（show-text 尾参为 global-string，如
   `show-text 2 (global-string d5d)`）、页尾 `end-text-line` 段自动排除；
   含 draw-string 的页（对白与参数化控件文本交错）不进入骨架，需原位翻译
   （保留 draw-string 行、翻译其字面尾参）。
   多段同页的系统提示页（如 SG5744 合体攻击教程）在译文中用 `<br>` 保留分段，
   走页块+reflow-apply 常规流程，无需特殊处理；原位翻译仅保留给
   指令级控制流交错 / 含 draw-string 的页。
2. **填写译文映射**：把每页整句译文（可含 `<ruby>`/`<nb>` 标注）填入骨架（行号 → 译文）；
   每完成约 30–50 页保存一次，避免长任务中断丢失。
3. **批量替换为页块**：
   ```
   node ".agents\skills\amayui-script-translate\scripts\apply-page-blocks.js" <SCRIPT> scripts\tmp-<SCRIPT>-map.json
   ```
   校验：所有可译页均有非空译文（缺失即中止并列出行号）；映射中多余行号告警（防笔误）；
   已含 `// 页面结束` 的脚本拒绝执行（已翻译，改走 reflow-apply）；存档块从源文件**逐字**拷贝
   原文行（含外字 U+E000–E010）；非文本控制行与 `wait-for-input 0` 保留不动，
   `end-text-line 0` 属可增删的文本行，脚本不主动增删，由 reflow 按需调整。
   含 draw-string 的页不会被批替换（脚本跳过并列出行号），需原位翻译
   （保留 draw-string 行、翻译其字面尾参）。
4. **刷新正文**：`node reflow-apply.js <SCRIPT>`（正文留空，由 reflow 生成正文与结束注释）；
   再 `node reflow-apply.js --check <SCRIPT>` 幂等验证。
5. **清理**：删除 `scripts\tmp-<SCRIPT>-map.json` 临时映射（勿提交、勿作为产物报告）。

## 术语（必须遵守）

- `rules/glossary.json` 已确认：エルフ/Elf→**仙灵**、ディル＝リフィーナ→**迪尔-利菲娜**、
  天結いキャッスルマイスター→**天结神缘**；
- 其余名词参考 `docs/glossary-draft.md`（角色/地名/诸神/种族）；拿不准的保留日文或按上下文合理处理，
  并在报告中列出待审名词。

## 角色语气一致性（必须遵守）

- 每个 ADV 页页首的 `// FROM: <id> <名称>` 注释标明说话人（`// FROM: none` = 旁白）。
  翻译/校对该页前，先据此在 `docs/keywords-角色语气.md` 检索该角色条目：
  `rg -n "<名称>" docs/keywords-角色语气.md`（或按 id 跳转对应小节；>500 页角色为
  3×500 随机采样合并；条目含「日文表达风格 / 中文译文风格 / 翻译一致性注意事项」）。
- 按条目保持一致：自称与称呼（含对他人称呼）、敬语层级与亲疏、句尾语气助词、
  口头禅与惯用句、拟声拟态与笑声、停顿符约定（见 `docs/keywords-角色语气.md` 顶部）、
  专名与固定译法。同一角色跨脚本/跨页不得漂移（如自称「余」的译法、笑声「库库」、
  称呼的「您/你」层级）。
- `// FROM: none`（旁白/叙述）：按叙述体处理，无角色语气约束。
- 角色未收录（新角色/未知 id）：按上下文与同类型角色推断语气，在报告存疑清单中登记，
  后续补入 `docs/keywords-角色语气.md`（语料不足时标注）。
- 修正「已有译文不一致」：先查 `docs/prob-角色翻译不一致.md`；已定案条目按定案口径
  全量检索 `src/` 后统一修改，修改后按本节复核该角色语气。

## 质量优先级

1. 语义准确与完整（否定、数量、人物关系、语气）；
2. 行结构 + 术语一致；
3. SJIS 可编码、每行 ≤25 中文字；
4. 风格自然（口语化、角色声线；翻译前按页首 `// FROM:` 查
   `docs/keywords-角色语气.md` 对应条目，保持自称/敬语/句末语气一致）。

## 执行步骤

1. 先读 `rules/glossary.json`、`docs/glossary-draft.md`、`scripts/README.md`（语法说明）、
   `scripts/lib/reflow.js`；并了解 `docs/keywords-角色语气.md`（角色条目结构；翻译时按
   FROM 定向检索）与 `docs/prob-角色翻译不一致.md`（已定案清单）。
1.5 SC/SG 联动：翻译 SC 脚本时，先扫描其 `comment "▼Gxxxx …"` 分节标记；按「SG 编号 = G 分节编号」
   检查对应 SG 系统提示页（参考 `docs/SG与SC分节对应.md`），一并翻译。SG 文案为系统提示风格
   （非对白），固定句式如「○○迷宫『××』可访问了」「获得了技能『××』」；
   术语复用既有定稿（迷宫名=STINIT2/OBINIT、道具=ITINIT、技能=SKINIT）。
1.6 不可编码字符处理：遇到 SJIS 字典（`tools/SExtractor/src/subs_cn_jp.json`）缺失或映射目标不可编码的
   生僻字时，按以下流程处理（勿改用生僻字少的替换词绕开）：
   1) 确认字体（`WenQuanYi.ttf`）已含该字形（无则先补字形）；
   2) 在字典添加 `"汉字": "载体字"`——载体字须满足：cp932 可编码（`canEncodeCp932`）、
      data 语料零出现、未被其他词条占用、字体重映射可持久化（保存后 reload 验证）；
   3) 重生成字体：`font_CN_JP.py WenQuanYi.ttf` → `WenQuanYi_cnjp.ttf`（必要时显式补单条映射并落盘验证），
      再重建 `Amayui-CN_cnjp.ttf`（族名 Amayui CN）；
   4) 恢复原文译法并 assemble。
   注意：部分载体字码位（如 鰊）字体重映射保存后不持久化，若译文将用到相关汉字（如「趟」），
   需先验证并改用可持久化载体字。
2. 逐页翻译 `src\<SCRIPT>.txt`；每个 ADV 页先确认页首 `// FROM:` 说话人，按
   「角色语气一致性」节查表后再落笔。ADV 页较多（如 SC*，约 ≥30 页）时优先用上节「大批量 SC 脚本」
   流程（提取 → 映射 → 批替换 → reflow-apply），临时映射 JSON 用后即删；页数很少时手工逐页改块，
   每完成约 30–50 页写回一次文件，避免长任务中断丢失进度；全部完成后确认文件完整。
3. 构建校验：
   - Windows：在 `scripts` 目录运行 `npm run assemble -- <SCRIPT>`，必须通过
     （骨架校验/SJIS/回读验证）。
   - macOS：无法执行 assemble/安装，改用本地校验：`node scripts/reflow-apply.js --check <SCRIPT>`
     （三段式页块流程时）、`node scripts/find-untranslated.js <SCRIPT>`、宽度/结构检查
     （见 references/verify.md「macOS 本地校验」节）；完成后按下节格式写入项目根 `PENDING.md`。
4. **文档沉淀**：为存疑名词建立/更新 `docs/prob-<SCRIPT>.md`（待定清单，按专名/音译、技能名译法、
   跨文档不一致、原文自身疑误分类，并给出后续动作）；为关键术语建立/更新
   `docs/keywords-<主题或脚本>.md`（关键字表，含状态 确认/建议/待定；已有同主题文档则合并更新，
   如 `docs/keywords-装备与物品.md`；技能类为 `docs/keywords-SKINIT.md`），必要时同步
   `docs/README.md` 的目录说明与完成状态。
5. **记录**：
   - Windows：翻译完成后更新 `PROGRESS.md`（把脚本加入已翻译内容索引）、
     `patch/patch.config.json`（把 assemble 产物 BIN 加入补丁同步清单 files）与
     `patch/CHANGELOG.md`（按「变更记录」节追加本次改动条目）。
   - macOS：只写项目根 `PENDING.md`（完全新翻译与修改均登记），不更新
     `PROGRESS.md` / `patch/patch.config.json`，等 Windows assemble 通过后再按上面登记。
6. 不修改 `data\`；不执行 git 提交。

## macOS 流程与 PENDING.md 登记

macOS 上无法实际运行 assemble 与安装流程（SJIS 写盘、install 树、DATA1 写入依赖 Windows）。
文本更新完成后，在项目根 `PENDING.md`（不存在则新建，含顶部用途说明）登记「已翻译、未编译」条目，
供回到 Windows 后补做编译；条目按日期分节、每脚本一条：

- 脚本：`<SCRIPT>`（章节/用途说明，章节写法沿用 PROGRESS.md 归类，如「第三章 剧情」）
- 类型：`完全新翻译` 或 `修改`（修改含重译、重排、局部修正、术语统一等）
- 状态：`已翻译，未编译（macOS）`
- 改动：翻译/修改范围与统计（页数、show-text/display-furigana/set-string 数量）+ 一句话概述
- 关联：`docs/prob-<SCRIPT>.md`、`docs/keywords-*.md`（新建/更新）
- 待办：Windows 上 `cd scripts && npm run assemble -- <SCRIPT>`，通过后登记
  `PROGRESS.md` 与 `patch/patch.config.json`，并从 `PENDING.md` 删除该条

规则：

- 完全新翻译与修改都必须登记；仅排版/术语修正等小改也属「修改」；
- 同一脚本已有条目时**更新合并**（改动累加、日期刷新），不重复追加；
- `PENDING.md` 只含未编译条目：Windows assemble 通过并登记 `PROGRESS.md` /
  `patch/patch.config.json` 后，删除对应条目，避免与 PROGRESS.md 重复记账。

## 变更记录（patch/CHANGELOG.md）

每次修改完成（Windows assemble 通过并登记 `PROGRESS.md` / `patch.config.json`）后，
必须同步在 `patch/CHANGELOG.md` 追加一条变更记录；macOS 流程不写本文件
（改动已登记在项目根 `PENDING.md`，待 Windows 编译通过后一并追加）。

### 格式

- 版本节：当前开发版本写作 `## vX.Y（开发中）`（不带日期）；发布后补发布日期写作
  `## vX.Y（YYYY-MM-DD）`；新版本在前；
- 追加规则：技能默认把条目追加到最新一个标记「开发中」的版本节；若不存在「开发中」节
  （如刚发布过），先新建 `## vX.(Y+1)（开发中）` 再追加，不直接写进已发布节；
- 每条改动一个条目（单条 bullet，字段内联）：

  `- [类型][脚本] 改动说明（关联：…）`

  - 类型：`新翻译`（首次翻译）/ `修改`（润色、重排、局部修正）/ `术语统一`
    （译名/术语口径变更）/ `文档`（仅文档沉淀）/ `发布`（版本汇总条目）；
  - 脚本：BIN 脚本名（如 SC0560、SKINIT、SG5744），多个用「、」分隔；
    纯文档条目可省略；
  - 改动说明：写清「旧 → 新」或行为变化；
  - 关联：实际新增/更新的 docs 文件（prob/keywords 等），逗号分隔，无则省略；
- 条目**不记录纯技术层面信息**：如 assemble 校验数字、BIN 字节数、编译/工具调用细节
  （这些属工程内部校验，见 verify.md / PROGRESS.md，不进 CHANGELOG）。

### 示例

    ## v1.2（开发中）

    - [修改][SC0560] 阿瓦罗台词「……旧……」→「……新……」
      （关联：docs/prob-SC0560.md）

### 规则

1. 同一版本节按时间先后追加，不做合并/去重（CHANGELOG 是流水账）；
2. 条目内容必须与实际改动一致：脚本名、改动范围；
3. 不记录 `data/` 改动（基线不允许修改）；
4. 发布时由发布任务把「开发中」节改为发布日期（保留全部条目），并开启下一开发版本节；
5. 报告时说明追加到的版本节与条目数。

## 报告内容

- 翻译统计：处理页数、show-text/display-furigana/set-string 数量；
- 术语应用情况（仙灵/迪尔-利菲娜/天结神缘）；
- assemble 结果（字节数/骨架校验/回读；macOS 流程报告 PENDING.md 登记条目）；
- CHANGELOG 更新情况（追加到哪个版本节、条目数）；
- 文档沉淀路径（prob / keywords / README 索引）；
- PROGRESS.md 与 patch/patch.config.json 更新情况（macOS 流程报告「待 Windows 补登记」）；
- 不确定/存疑名词清单。
