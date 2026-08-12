# 天結いキャッスルマイスター 工程脚本

## 结构

```
E:\Games\Eushully\天結\
├── raw\       软连接(junction) -> 游戏本体目录(只读参照)
├── install\   可运行测试树（与本体完全独立的全量真拷贝，含 DATA1-8 解包目录）
├── data\      只读比较基线（341 个反汇编 txt，原始日文，不再修改）
├── src\       可编辑开发源（341 个 txt，含翻译语法）
├── scripts\   本脚本目录
├── install-manifest.json   install 文件 MD5
└── raw-manifest.json       raw（游戏本体）文件 MD5
```

## 使用

```bash
cd scripts
npm run setup              # 创建 raw 软连接 + install 全量真拷贝（幂等）
npm run setup -- --rebuild # 删除并重建 install（按当前规则）
npm run setup -- --prune   # 清理 install 中已被排除的废弃文件
npm run verify             # 校验 install 均为独立副本、无硬链接、无缺失
npm run manifest           # 生成/更新 install-manifest.json
npm run manifest-raw       # 生成/更新 raw-manifest.json
npm run manifest-all       # 同时更新两份 manifest
npm run check              # 对照 install-manifest 检查 install 改动
npm run compare            # 对照 raw-manifest 比较 install 与 raw 是否一致
npm run register-font      # 会话级注册 Amayui CN 字体（重启后需重跑；或双击安装 TTF 永久生效）
npm run assemble -- <脚本> # src → 语法展开 → 骨架校验 → 汇编 → install → 回读验证
npm run reflow -- <文案>   # 按每行 ≤25 中文字排版（支持 ruby/nb 标注）→ 三段式页面块
npm run reflow-apply [-- --check] [--sample N] [脚本...] # 从 // 输入原文 注释重排并替换 ADV 页正文（--check 只检查不写回；--sample N 随机抽查 N 个内容变更页）
npm run sync-patch         # 按 patch/patch.config.json 同步补丁包（src 相对工程根，dst 相对 patch/）
```

`manifest` / `manifest-raw` / `manifest-all` / `check` 支持追加文件参数，只处理指定文件
（相对各目录顶层的路径，绝对路径也可，可多个；省略时处理全部文件）：

```bash
npm run manifest -- AIM.BIN SC0010.BIN   # 仅重算这两个文件的 MD5 并写回 install-manifest
npm run check -- AIM.BIN                  # 仅核对 AIM.BIN 是否与清单一致
```

## 文件策略（config.js）

- install 为**全量真拷贝**：游戏资源聚合在 ALF 内（含后续要改写的脚本），硬链接可省空间有限，
  且重打包时有写入波及本体的风险，故不做硬链接。
- 排除（不进入 install）：`天结.exe`（心愿屋汉化壳，方案 B 弃用）、`*.dmp`（崩溃转储）。
- `IMMUTABLE_EXTS` 保留为扩展点：将来若确定某类文件永不可变，可恢复对其硬链接。

游戏本体目录不会被修改；install 树里修改文案文件即可测试。

## manifest 说明

- `install-manifest.json`：install 顶层每个文件（相对 install 根）的 MD5，追踪改动；
  DATA1-8 等解包子目录不计入。
- `raw-manifest.json`：raw（即游戏本体）顶层文件的 MD5，作为原始基线；
  `_analysis`、`补丁` 等子目录不计入。
- `npm run compare` 基于两份 manifest 对比：install 与 raw 不一致、缺失、多出的文件都会列出
  （排除项除外），不重新哈希，秒级完成。

注意：manifest 只统计顶层文件，生成很快；install 解包出来的 DATA1-8 子目录不参与 MD5 追踪。

## Decompiler 路径坑（重要）

`age-asm.exe`（cmake 构建产物）用 ANSI 参数接收路径（系统 ACP=936），含日文/中文的绝对路径会被搅乱，
PowerShell 的 `Push-Location` / `cd /d` 也靠不住。统一做法：使用 ASCII 别名 junction：

```powershell
New-Item -ItemType Junction -Path "E:\Games\Eushully\wk" -Target "E:\Games\Eushully\天結"
```

之后所有汇编/反汇编用 `E:\Games\Eushully\wk\...` 绝对路径：

```bash
E:\Games\Eushully\wk\tools\eushully-decompiler\build\Release\age-asm.exe -e sjis -a data\OPINIT1.txt .tmp\OPINIT1.smoke.BIN
```

## hook 路线结论（已放弃 UIF）

AGE.EXE 是加壳程序（区段名清空、导入表运行时重建），UIF 全部功能模块（text_processor、
character_substitution、font_manager、tunnel_decoder）都走**导入表级 hook**
（`DetourEnumerateImportsEx`），实测全部挂不上（日志：
`Unable to enumerate import address table`）。走 hook 路线需要 inline hook
（DetourAttach 式）或先脱壳重建导入表，暂不采用；`install` 中不再放置 UIF 代理文件。

## 字体路线（当前有效方案）

**最终结论（已实测确认）**：引擎的字体加载分两层——若游戏目录存在 `AGE-EXTEND.TTF`，
ADV 正文强制用它（内置字体），设置项不生效；**移除该文件后引擎回退到系统字体设置**，
ＡＤＶメッセージ/説明文/パラメータ 等设置项才真正控制对应文本。
因此方案 = **注册 cnjp 系统字体 Amayui CN + 游戏内把字体分类指向它**，不改任何游戏文件。

install 中 `AGE-EXTEND.TTF` 已移除（`config.js` 已将其加入排除名单，setup 不会再拷贝）；
原文件备份在 `.tmp\font-backup\`（楷体 11.7MB、原版 323KB、v2 两份）。

1. 注册字体：`npm run register-font`（AddFontResourceEx 会话级；重启后需重跑，
   或双击 `tools\SExtractor\tools\Font\Amayui-CN_cnjp.ttf` 永久安装）。
2. 启动游戏（LE 932），设置界面中把字体分类（説明文、パラメータ文字/数字、
   ＡＤＶルビ、ＡＤＶメッセージ）设为 **Amayui CN**——已实测可枚举并可设置成功；
   注意：**パラメータ文字/数字 = 设置界面自身的字体**；ＡＤＶメッセージ字体落在
   `SYS4REG.INI`（明文 `[message] Font=`）可脚本化，其余分类（含参数字体）按索引形式
   持久化在 `SAVE.DAT`，仍需用户进游戏设置一次。
3. 对应区域的文本渲染为简体（码位映射：显→顕 等由字体字形完成）。
   注意：若某分类保持默认（ＭＳ 明朝），该区域会显示衬线且**缺外字字形**，
   所有分类都应指向 Amayui CN（或后续用 FontSubstitutes 兜底）。

字体来源（`tools\SExtractor\tools\Font\`）：

- `Amayui-CN_cnjp.ttf`：WenQuanYi 基底 + 按当前 `subs_cn_jp.json` 替换 + 唯一族名
  “Amayui CN”（name 表全语言一致）；实测**不含**外字字形，停顿标记 U+E000–E010
  由引擎处理/回退显示（可接受）。
- `AGE-Extend_cnjp.ttf`：族名伪装为 AGE Extend 的同内容变体，且**已并入**原版
  AGE-EXTEND.TTF 的外字字形 U+E000–E010（文件覆盖方案遗留，当前方案不再使用）。

注意：SExtractor 自带的老版 cnjp 字体缺 `顕→显` 替换，必须按当前字典重新生成
（`python font_CN_JP.py MSGothic_WenQuanYi.ttf`，依赖 fonttools）。

## 标准翻译流程（src 源文件 + 翻译语法）

**分层**：

- `data\*.txt`：只读比较基线（原始日文），`assemble` 的骨架校验以此为准；
- `src\*.txt`：可编辑开发源，支持三种翻译语法（组合使用）：
  - `"原文|译文"` —— 对语法：set-string 等单行简单替换（#1，语法糖）；
  - `@"译文"` —— 中文标记：重写/新增的文本行（#3）；
  - `/* ... */` —— 块注释存档（#2）：ADV 段落重写时把原句包进块注释（标记行独立，
    原文行保持与 data 基线**逐字一致**，git diff 中显示为上下文，便于准确识别实际修改；
    预处理时整块丢弃；`//` 行注释仍兼容支持）；
  - `end-text-line 0` —— **视觉行结束标记**：属可调文本行，可按排版自由插入/移除
    （show-text/display-furigana 直到遇到它才结束当前视觉行）。

```bash
cd scripts
npm run assemble -- OPINIT1   # src → 语法展开（对/标记 → SJIS 码位）→ 骨架校验 → 汇编 → 安装 → 回读
```

要点：

- **骨架校验**：除文本行（set-string / show-text / display-furigana / concat / **end-text-line**）外，
  所有控制行（label / u 字节码 / jcc 等）必须与 data 基线逐字节一致；误删控制行编译期报错；
- **外字**（U+E000–E010）：原文中保留（Decompiler 可无损往返），译文不写外字；
- **编码映射**：与 SExtractor 的 JIS 替换同一字典（`subs_cn_jp.json`），可编码原样、否则日文写法占位、
  渲染时由 Amayui CN 字体还原简体；字典缺失字符在 assemble 时报错；
- **注音策略（当前）**：释义/称号类注音保留在 display-furigana 位置（中文释义作注音，
  避免正文行过长）；纯读音（假名）类注音移除；
- concat 镜像行 = **紧随其前的 show-text 段**的译文（保持段边界，勿整句镜像；
  如 SN0000 原式 `show-text "』の"` 后 `concat "』の"`）；当前人工维护，后续可加自动一致性检查；
- **ADV 折行**：引擎中 show-text/display-furigana 直到 `end-text-line` 前始终是同一视觉行，
  拆分 show-text 无法换行；正确做法是用 `end-text-line` 结束一行。排版规则：
  每视觉行 ≤ 25 中文字（ASCII 按半字计）、有注音/标注内容不拆、连续词语尽量不拆、
  放不下提前折行、**行尾不得是『**（发现则提前折行，把『移到下一行行首）。
  用 `npm run reflow -- <文案文件>` 自动生成标准脚本行：
  - 文案支持 `<ruby>主词<rt>注音</rt></ruby>`（→ display-furigana）与 `<nb>不折行内容</nb>`；
  - `--max N` 改行宽（默认 25 中文字）、`--glossary rules/glossary.json` 注入术语原子、
    `--no-concat` 去掉 concat 镜像行；
  - 每个页面块为三段式：首行 `// 输入原文：…` 单行注释（含 ruby 标记，排版前原文）、
    正文（show-text/display-furigana/concat/end-text-line）、末行 `// 页面结束`
    特殊结束注释（页块显式边界，reflow-apply 据此定位）；
  - 多个段落用空行分隔，每段输出一个页面块（每行含 show-text/display-furigana + concat；
    非末行追加 end-text-line，**页面最后一行不加**——对应原文结构，行由 wait-for-input
    后的 end-text-line 收尾）；
  - 孤行优化：若最后一行 ≤5 字，自动递减行宽重新排版（最多重试 3 次）。
- 反汇编结果只用于校验，**永远不要用它重建已翻译脚本的 src**（BIN 只有编码后的文本）。
