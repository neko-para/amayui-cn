# 天結いキャッスルマイスター 工程脚本

## 结构

```
E:\Games\Eushully\天結\
├── raw\       软连接(junction) -> 游戏本体目录(只读参照)
├── install\   可运行测试树（与本体完全独立的全量真拷贝，含 DATA1-8 解包目录）
├── data\      文案语料（341 个反汇编 txt，松散版基线，由人工编辑）
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
npm run extract-all        # 为 data 下尚无基线的脚本生成 locale/<脚本>.json（不依赖 git）
npm run extract -- <脚本>  # 为单个脚本生成基线（已存在则跳过，--force 从 data txt 重建）
npm run apply -- <脚本>    # 编码译文写回 data/<脚本>.txt（校验字典缺失字符）
npm run assemble -- <脚本> # SJIS 校验 → Decompiler 汇编 → install → 回读验证
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

`Decompiler.exe` 用 ANSI 参数接收路径（系统 ACP=936），含日文/中文的绝对路径会被搅乱，
PowerShell 的 `Push-Location` / `cd /d` 也靠不住。统一做法：使用 ASCII 别名 junction：

```powershell
New-Item -ItemType Junction -Path "E:\Games\Eushully\wk" -Target "E:\Games\Eushully\天結"
```

之后所有汇编/反汇编用 `E:\Games\Eushully\wk\...` 绝对路径：

```bash
E:\Games\Eushully\wk\tools\eushully-decompiler\Decompiler\Decompiler.exe -e sjis -a data\OPINIT1.txt .tmp\OPINIT1.smoke.BIN
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
   设置持久化在 `SAVE.DAT`（加密/索引形式，暂无明文可脚本化）。
3. 对应区域的文本渲染为简体（码位映射：显→顕 等由字体字形完成）。
   注意：若某分类保持默认（ＭＳ 明朝），该区域会显示衬线且**缺外字字形**，
   所有分类都应指向 Amayui CN（或后续用 FontSubstitutes 兜底）。

字体来源（`tools\SExtractor\tools\Font\`）：

- `Amayui-CN_cnjp.ttf`：WenQuanYi 基底 + 按当前 `subs_cn_jp.json` 替换 + 唯一族名
  “Amayui CN”（name 表全语言一致）；已合并游戏外字字形 U+E000/E001/E002/E003/E010。
- `AGE-Extend_cnjp.ttf`：族名伪装为 AGE Extend 的同内容变体（文件覆盖方案遗留，
  当前方案不再使用）。

注意：SExtractor 自带的老版 cnjp 字体缺 `顕→显` 替换，必须按当前字典重新生成
（`python font_CN_JP.py MSGothic_WenQuanYi.ttf`，依赖 fonttools）。

## 标准翻译流程（locale）

**原则：翻译只改 `locale/` 里的可读简体中文，编码（简体→SJIS 码位映射）由脚本自动完成**；
`data\*.txt` 是生成产物，不手改。编码机制与 SExtractor 的 JIS 替换导入一致
（同一份 `subs_cn_jp.json` 字典：可 cp932 编码的字符原样保留，否则查字典映射为日文写法占位，
渲染时由 Amayui CN 字体还原为简体）。

```bash
cd scripts
# 基线已全部生成（341 个 locale/<脚本>.json，orig 为原始日文）；新脚本用 extract/extract-all
# 编辑 locale/OPINIT1.json 的 trans 字段（可读简体中文）
npm run apply -- OPINIT1        # 编码译文写回 data/OPINIT1.txt（存在字典缺失字符时报错）
npm run assemble -- OPINIT1     # SJIS 兜底校验 → Decompiler 汇编 → 安装到 install → 回读验证
```

文件结构：

- `locale/<脚本>.json`：单文件单大对象 `{id: {orig: 原文, trans: 译文}}`，基线已全部入库
  （extract-all 一次性生成，不依赖 git）；人工直接编辑 `trans` 字段（可读简体中文）；
- `data/<脚本>.txt`：生成产物（编码后文本），不要手改；
- 校验失败（字典缺失字符）时 `apply` 拒绝写回，需调整措辞或扩字典（扩字典需同步重建字体）。

注意：`--force` 重建基线会读取**当前** data txt，已 apply 过的脚本 txt 是编码后文本，
不应重建（基线以入库版本为准）；剧本脚本（SC*.txt）当前只提取 `set-string` 行，
`show-text` 等行类型待提取器扩展后再刷新。

与 SExtractor 的关系：SExtractor GUI 可做同样的事（其导入即 `generateSubsJis` 做此映射），
本流程用同一字典脚本化，便于批量与验证；设置界面（OPINIT1，172 条）已按此流程完成并安装。
