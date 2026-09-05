# 汉化（docs/translation）· 权威 README

> **地位**：这是「**游戏汉化**」方向的**新版权威 README**，收敛并取代旧散篇/旧主索引（`docs/README.md` 的过期布局、
> `AGERC对话框汉化.md`、`font-build.md`、`docs/images/*`、`scripts/README.md`、`tools/README.md` 中**属于汉化**的部分）。
> 
> **权威声明（重要）**：
> - **`src/*.txt`（941 个）的翻译结果是翻译域的唯一权威、视为已确认**；后续仅剩**持续校对、整体修正**。
> - **`docs/translate/`（302 篇 keywords-*/prob-*）是过时的中间产物，待整体合并去重（后续任务）**；本文件不逐篇整理、不以之为准。
> - 旧散篇（AGERC/font-build/images 各 SO 图）保留为详细参考，本文件用相对链接指向。

## 1. 目标与核心决策

**方案 B：不沿用心愿屋汉化壳，直接修改游戏数据文件重制补丁**。依据：

1. **不做方案 A（逆向更新 `天结.exe`）**：心愿屋壳 overlay 为高熵加密数据（MSVC rand 种子 18467/6334/26500 特征）、
   自研 hook 架构、PlayDRM（2017 起）无公开脱壳方案，零现成工具、不可维护。
2. **方案 B 可行**：工具链已实测通过脚本与 AGF（§3）；
   社区先例（ZAP 英化本作 = 备份并覆盖 BIN/AGF；封緘のグラセスタ 2018 = 覆盖 BIN + LE 启动；天结2 2021 = BIN+AGERC.DLL）。
3. **游戏直读松散文件**：多数文本（全部剧情脚本）无需动 ALF；ALF 内独有脚本缺口由 `alf/packdata` 补。
4. **显示层不改游戏文件**：SJIS 码位映射 + cnjp 系统字体 Amayui CN + 游戏内字体分类设置。

**译文策略**：不继承心愿屋 13,500+ 条内存提取译文；以日文原文为准（MT 初翻 + 术语表 + 人工校对），心愿屋译文仅参考。

## 2. 目录纪律与数据分层

（`raw/`、`install/` 被 gitignore；`install/` 为本体独立全量真拷贝。）

| 目录 | 角色 |
|---|---|
| `raw/` | 软连接(junction) → 游戏本体（**只读参照，勿写**） |
| `install/` | 可运行测试树（与本体独立的全量真拷贝，含 DATA1-8 解包目录） |
| `data/*.txt` | **只读比较基线**（原始日文），assemble 骨架校验以此为准 |
| `src/*.txt` | **可编辑开发源**（唯一权威翻译结果）+ `$N$` 前缀 = APPEND 追加包 |

配置在 `scripts/config.js`：`GAME_DIR`（游戏本体）、`SRC_DIR`、排除项（`天结.exe`、`*.dmp`、`AGE-EXTEND.TTF`）。

## 3. 数据格式与工具链

### 3.1 文件体系（SYS4.5 / S4IC450）
- `SYS4INI.BIN`：全局文件索引（魔数 `S4IC450 `，TOC 为 LZSS 压缩，登记 ~21,109 个文件）。
- `DATA1-8.ALF`（约 7.2GB）+ `APPEND01-05.ALF/.AAI`：聚合档案。
- 文件类型：OGG 13,629 / AGF 5,600 / BIN 565 / WAV 339 / PNG 322 / MOC 238 / MTN 233 / MPG 171 / 其他。
- 根目录松散 `.BIN` 105 个（含全部 26 个 `SC*` 剧情脚本）、`.AGF` 8 个、字体/exe/dll。
- **游戏直读松散文件**：89 个与 ALF 同名的 BIN 中 87 个内容不一致（1.07 修正版）→ 覆盖松散文件即可生效；**语料基于松散版**（ITINIT 等已证实有真实文本差异）。
- DATA 各盘：DATA1=角色图+全部脚本 / DATA2=角色立绘 / DATA3=BGM / DATA4=SE 语音 / DATA5=视频 / DATA6=Live2D / DATA7-8=事件图。

### 3.2 脚本格式（SYS4450）
- 头部：`SYS4450 ` + 6 个 u32 局部变量数 + 0x1C + 三张表（length/offset）。
- 指令流为 AGE 字节码；字符串在数据表尾部，**0xFF 按位取反 + SJIS**，0xFF 结束。
- 反汇编输出 UTF-8；`age-asm` 支持 `-d`(反汇编)/`-a`(重汇编)/`-x`(往返校验)。

### 3.3 AGF 图片格式（UI / 背景）
- 分两种：带 `ACGF` 固定头 / 无头（`00 00 00 00` 开头）。install 全量 5608 个 = 3136 ACGF + 2472 无头。
- 命名前缀：`BG*`（背景，如 BG000AA=1280×720@24bpp）、`AE*`（事件图）、根目录 `MI040`（横幅）。
- 工具：`tools/Eushully_AGF_TooL`（Koreanshy，GUI/可无界面）+ **Node 版** `scripts/agf/`（`npm run agf`：
  `extract`/`inject`/`build`，与 Python 版交叉验证像素级一致；无头自回环 4 字节偏移为原工具固有问题，改图走有头注入=无损）。

### 3.4 exe / DLL
| 文件 | 大小 | 说明 |
|---|---|---|
| `天结.exe` | 19,980,350 | 心愿屋汉化壳（方案 B 弃用） |
| `AGE.EXE` | 1,007,104 | 原版引擎（干净，无 overlay） |
| `start.exe` | 31,945,168 | 启动器 |
| `AGERC.DLL` | 335,872 | 资源 DLL（主菜单 MENU 110/124 + 16 个对话框） |

## 4. 翻译流水线（src 源文件 + 翻译语法）

**分层**：`data/*.txt`（基线）/ `src/*.txt`（开发源，翻译语法）。

翻译语法（组合使用）：
- `"原文|译文"` —— 对语法：`set-string` 等单行替换（#1）。
- `@"译文"` —— 中文标记：重写/新增文本行（#3）。
- `/* ... */` —— 块注释存档（#2）：ADV 段落重写把原句包进块注释（原文行与基线逐字一致，git diff 只显实际修改）。
- `end-text-line 0` —— **视觉行结束标记**（可调文本行）。

常用命令（`scripts/`）：
```bash
npm run assemble -- <脚本>   # src → 语法展开 → 骨架校验 → 汇编 → install → 回读
npm run reflow -- <文案>     # 按每行 ≤25 中文字排版（ruby/nb 标注）→ 三段式页面块
npm run reflow-apply [-- --check] [脚本...]  # 从 // 输入原文 注释重排并替换正文
npm run strip-punct-space [-- --check] [脚本...]  # 移除「？　/！　」标点后全角空格
npm run adv-context -- <脚本> <行号>         # 提取 ADV 片段上下文（译文评估前取证）
npm run sync-patch         # 按 patch/patch.config.json 同步补丁包
```

**要点**：
- **骨架校验**：除文本行外所有控制行须与基线的字节一致；误删控制行编译期报错。
- **外字（gaiji）**：U+E000–E010（SJIS 0xF040–F9FC 用户定义外字区）大量出现，语义为停顿/无声标记；
  **只保留在未翻译原文行**（Decompiler 无损往返），**译文不写外字**。
- **编码映射**：与上游 SExtractor 同字典（`res/subs_cn_jp.json`），可编码原样、否则日文写法占位、渲染时由 Amayui CN 还原简体；缺字符 assemble 报错。
- **注音策略（当前）**：释义/称号类注音保留在 `display-furigana` 位置（中文释义作注音）；纯读音（假名）类移除。
- **ADV 折行**：每视觉行 ≤25 中文字（ASCII 半字计）、有注音不拆、连续词语尽量不拆、放不下提前折行、**行尾不得是『**。
  正确换行方式是用 `end-text-line`（拆分 show-text 不能换行）。页面块为三段式：`// 输入原文：…` + 正文 + `// 页面结束`。
- concat 镜像行 = 紧随其前的 show-text 段译文（保持段边界，勿整句镜像）。

## 5. 编码与字体（中文显示层）

- **引擎字体加载两层**：若游戏目录存在 `AGE-EXTEND.TTF`，ADV 正文强制用它（设置不生效）；**移除后回退系统字体设置**。
  故方案 = **注册 cnjp 系统字体 Amayui CN + 游戏内把字体分类指向它**，不改任何游戏文件。
- `install` 中 `AGE-EXTEND.TTF` 已移除（`config.js` 排除名单；原文件备份 `.tmp/font-backup/`）。
- `res/fonts/`（**基底 = Sarasa Gothic SC（更纱黑体 SC），2026-08 起替换原 WenQuanYi**；详见 [`../font-build.md`](../font-build.md)）：
  - `Amayui-CN_cnjp.ttf`：**SarasaGothicSC 基底** + 按 `res/subs_cn_jp.json` 替换 + 唯一族名「Amayui CN」+ **声明 Shift-JIS(932) 码页**；**不含外字字形**（停顿标记由引擎处理/回退，可接受）。
  - `SarasaGothicSC/SarasaGothicSC-Regular_cnjp.ttf`：中间产物（cnjp 替换但未改族名）。
  - `MSGothic_WenQuanYi.ttf` / `WenQuanYi.ttf`：**旧 WenQuanYi 基底**（已弃用，可回退）。
  - `AGE-Extend_cnjp.ttf`：族名伪装为 AGE Extend 的同内容变体并并入外字字形（文件覆盖方案遗留，当前不用）。
- 注册：`npm run register-font`（会话级，重启需重跑）或双击安装 TTF（永久）。游戏内字体分类（説明文/パラメータ文字数字/ＡＤＶルビ/ＡＤＶメッセージ）指向 Amayui CN；ＡＤＶメッセージ落在 `SYS4REG.INI`（`[message] Font=`），参数字体按索引持久化在 `SAVE.DAT`、需进游戏设置一次。
- 字体重建（Sarasa 基底，需 fonttools）：`python scripts/font_CN_JP.py res/fonts/SarasaGothicSC/SarasaGothicSC-Regular.ttf` → `…_cnjp.ttf`；
  再改族名为 `Amayui CN` + 对齐 OS/2 码页 `0x603E019F / 0xDFD70000`（Shift-JIS 932，**关键**——日文 locale 会按字符集码页过滤字体，缺 932 会被排除回退默认字体）。完整流程见 [`../font-build.md`](../font-build.md) §8。

## 6. 界面汉化

### 6.1 AGERC.DLL（主菜单 / 对话框）
- `AGERC.DLL` 含主菜单 MENU 110/124 + 16 个对话框；汉化流程见 [`../AGERC对话框汉化.md`](../AGERC对话框汉化.md)（DIALOG 3 退出确认框已定稿）。
- `res/` 下有 `AGERC_RAW.DLL.rc`、`AGERC.DLL.rc`、`build-localized-agerc.ps1`、`inject-localized-agerc.rsh` 等构建资产。

### 6.2 UI 图片（AGF→PNG→改图→有头注入）
- 流程：`clean_fill` 清理原日文 → HTML+CSS 渲染简体中文（headless Chrome 截图）→ `node scripts/agf/cli.js inject <原AGF> <PNG> -o <install>.AGF` → 同步 `res\` → `npm run sync-patch` → `npm run manifest`。
- **字体**：渲染统一 **Sarasa Gothic SC**（`res/fonts/SarasaGothicSC/`，渲染页**必须 @font-face 引用本地字体**，否则 headless 拉丁 fallback）。
- 现状（详见 [`../images/README.md`](../images/README.md) 总览 + 各 `SO0xx.md`）：
  SO001(15+2 按钮+操作説明面板)、SO002(菜单×2)、SO009A、SO009B、SO017(兵种技能名 96 区)、SO020、SO021、SO025、SO030、SO039；
  效果速查见 [`../images/FONT.md`](../images/FONT.md)；阴刻方案见 [`../images/阴刻文字.md`](../images/阴刻文字.md)。
- 待办：SO009B 第一列 outline、SO009A 初期化/戻る、SO021 头部块、SO017 游戏内目检（优先级低）。
- 脚本 txt **不直接引用 `.AGF` 文件名** →「界面 → AGF」映射另行建立（资源表/内存层面）；**优先级低**（文案/剧情优先）。

## 7. 发布与维护

- `patch/`：`BIN\`（已汉化脚本）、`AGF\`（已汉化 UI 图）、`AGERC.DLL`、`Amayui-CN_cnjp.ttf`、`README-测试版说明.md`（安装步骤）、`CHANGELOG.md`（改动记录）。
- 安装要点（见 [`../patch/README-测试版说明.md`](../patch/README-测试版说明.md)）：复制一份游戏 → 改名/移出 `AGE-EXTEND.TTF`（**必须**）→ 覆盖 BIN/AGF/AGERC.DLL → 安装字体 → **Locale Emulator 日语区域**运行 `AGE.EXE`（目录路径须英文/日文，不能含中文）→ 游戏内把字体分类设为 Amayui CN。
- 存档：`%localappdata%\Eushully\天結いキャッスルマイスター`；与心愿屋版存档通用，但旧存档部分信息（如称号）内容需重跑。
- 数据完整性：`install-manifest.json`/`raw-manifest.json` + `npm run check/compare/manifest`（大文件默认跳过，`--full` 强制；`--diff` 按 git diff 只处理 txt/AGF 对应产物）。

## 8. 当前状态（翻译已收官）

- **翻译完成（453/465 需翻译文件已译）**，进度基线见 **`PROGRESS.md`**（2026-08-08 全量重扫 data：**需翻译 465 / 无文本 240**）。
- **未翻译（12）**：系统/杂项 10（CHECKCONFIG、DEBUGADV、DEBUGADV2、DRAWILLTIP、INIT、INIT2、INITCONFIG0、MUINIT、REACH、TITLE）+ APPEND 2（`$3$AGENCY`、`$4$CNINIT`）。
- 无文本、无需翻译 240 = 基础版 11（ALLMAP、CALLBACK_LOAD、CLOSE、DELEN、DELENMASS、REIGN、REPLAYVOICE、SETHALLTEX、SUNSET、SYSTEM4、UNITECH）+ 追加包空壳 229。
- **后续 = 持续校对**（统一术语/措辞/语气，局部改动整体修正，见 `../patch/CHANGELOG.md` 的修订与 `scripts/check-lost-quotes.js` 等）；**`docs/translate/*` 的 keywords/prob 待整体合并去重**（后续任务）。

## 9. 冲突与取舍（本轮收敛）

| 冲突点 | 采纳结论 |
|---|---|
| 翻译结果权威 | **`src/*.txt` = 唯一权威、已确认**；后续只校对；`docs/translate` 非权威、待合并去重 |
| 文案规模计数（341 vs 705 vs 941） | 旧 `docs/README` 记 341（旧基线）；PROGRESS 2026-08-08 重扫 data 705（需翻译 465/无文本 240）；`src/`、`data/` 实为 **941 txt**。进度以 **PROGRESS.md 扫描**为准，src 文件数 941 |
| 显示方案 | 不 hook、不改游戏文件；cnjp 字体 Amayui CN + 游戏内字体分类；弃用 UIF（IAT hook 全失败）与 AGERC-EXTEND.TTF 外挂 |
| UIF 路线 | 已放弃（AGE.EXE 加壳，`Unable to enumerate import address table`） |
| 语料基线 | 以**松散版（1.07 现行）**为准，非 ALF 内副本（ITINIT 等有真实文本差异） |
| 图面字号 vs 游戏内字体 | 渲染用 Sarasa Gothic SC（真实浏览器）；游戏内为 Amayui CN（Sarasa 基底 cnjp 替换版），两者区分 |

## 10. 待确认 / 待办

- ⬜ **ALF 内脚本覆盖方式**：packdata 重打包 vs 松散同名覆盖。
- 🟡 字典精修：上下文相关映射（如 发→髪 在「爆发/发展」恢复但「头发」语义冲突）；按词条/语境处理。
- 🟡 `Uninst*.exe` 是否移出 install（误运行会卸载本体）；`project.json` 是否删除（引用已移除的 天结.exe）。
- 🟡 `tools/` 嵌套 git 仓库处理（gitignore 或删嵌套 `.git` 后提交源码）。
- ⬜ 剧本脚本提取器扩展（段落级视图，用于批量机翻）——当前翻译已收官，此项降级。
- ⬜ **`docs/translate/*` 整体合并去重**（后续任务，不在本 README 范围）。
