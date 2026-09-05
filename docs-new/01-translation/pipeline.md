# 01-translation · 翻译流水线（src 源文件 + 翻译语法）

## 1. 分层

- `data/*.txt`：**只读比较基线**（原始日文），`assemble` 骨架校验以此为准；不改。
- `src/*.txt`：**可编辑开发源**（翻译真值）；`$N$` 前缀 = APPEND 追加包。

## 2. 翻译语法（组合使用）

| 语法 | 作用 |
|---|---|
| `"原文|译文"` | 对语法（#1）：`set-string` 等单行简单替换 |
| `@"译文"` | 中文标记（#3）：重写/新增文本行 |
| `/* ... */` | 块注释存档（#2）：ADV 段落重写时把原句包进块注释（原文行与基线逐字一致，git diff 只显实际修改） |
| `end-text-line 0` | **视觉行结束标记**（可调文本行，可按排版自由插入/移除） |

## 3. 命令（scripts/）

```bash
npm run assemble -- <脚本>   # 语法展开 → 骨架校验 → SJIS 编码映射 → 汇编 → install → 回读
npm run reflow -- <文案>     # 按每行 ≤25 中文字排版（ruby/nb 标注）→ 三段式页面块
npm run reflow-apply [-- --check] [脚本...]   # 从 // 输入原文 注释重排并替换正文（--check 只查不写）
npm run strip-punct-space [-- --check] [脚本...]  # 移除「？　/！　」标点后全角空格
npm run adv-context -- <脚本> <行号>         # 提取 ADV 片段上下文（校对取证）
npm run sync-patch         # 按 patch/patch.config.json 同步补丁包
```

## 4. 关键规则

- **骨架校验**：除文本行（`set-string`/`show-text`/`display-furigana`/`concat`/`end-text-line`）外，所有控制行（label/u 字节码/jcc 等）须与 `data` 基线逐字节一致；误删控制行编译期报错。
- **编码映射**：与上游 SExtractor 同字典（`res/subs_cn_jp.json`），可编码原样、否则日文写法占位、渲染时由 Amayui CN 还原简体；缺字符 assemble 报错。
- **注音策略（当前）**：释义/称号类注音保留在 `display-furigana` 位置（中文释义作注音，避免正文行过长）；纯读音（假名）类移除。
- **ADV 折行**：每视觉行 ≤25 中文字（ASCII 半字计）、有注音不拆、连续词语尽量不拆、放不下提前折行、**行尾不得是『**；正确换行用 `end-text-line`（拆分 show-text 不能换行）。页面块三段式：`// 输入原文：…` + 正文 + `// 页面结束`。
- concat 镜像行 = 紧随其前的 show-text 段译文（保持段边界，勿整句镜像）。
- 反汇编结果只用于校验，**不要用它重建已翻译脚本的 src**（BIN 只有编码后的文本）。

## 5. 后续（已收官）

- 翻译已完成；后续为**持续校对**（统一术语/措辞/语气、引号丢失补全、短句一致性、术语统一），改动经 `reflow-apply --check` 幂等验证、`data/` 零改动。
- 参考 `scripts/check-lost-quotes.js`、`scripts/adv-context.js` 等校对辅助。

## 6. 交叉引用

- 编码/字体见 `./encoding-font.md`；进度见 `./publish-status.md`。
