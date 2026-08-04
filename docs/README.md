# 天結いキャッスルマイスター 汉化工程文档

> 更新日期：2026-08-04
> 工程根目录：`E:\Games\Eushully\天結`（git 仓库，`.gitignore` 已排除 `/install`、`/raw`）
> 游戏本体：`E:\Games\Eushully\天結いキャッスルマイスター`（Eushully，2017-05-26，v1.07 + AP01-05）

## 1. 项目概述

目标：为《天結いキャッスルマイスター》**重新制作中文补丁（方案 B：直接修改数据文件）**。

- 不沿用心愿屋汉化壳（`天结.exe`）与译文（错漏多，仅作参考对照）
- 从日文原文重新翻译/校对，写入游戏数据文件（脚本 `.BIN`），以原版引擎 + 修改后数据运行
- 中文显示层方案待定：UIF 运行时注入（tunnel 编码）或 GBK 直写（需小样本实测）
- 工程目录名从 `天结`（中文）改为 `天結`（日文），以适配日文区域环境运行

## 2. 目录结构

```
E:\Games\Eushully\天結\
├── raw\                  junction 软连接 -> 游戏本体（只读参照，勿写入）
├── install\              可运行测试树（与本体完全独立的全量真拷贝；含 DATA1-8 解包目录）
├── data\                 文案语料：341 个反汇编 txt（69MB，松散版 1.07 基线 + ALF-only 脚本）
├── scripts\              Node.js 工程脚本（setup/verify/manifest）
├── tools\                本地工具链（alf / eushully-decompiler / SExtractor / UIF）
├── docs\                 本文档
├── install-manifest.json install 文件 MD5
├── raw-manifest.json     游戏本体 + 补丁目录文件 MD5
└── .gitignore            /install、/raw
```

游戏本体目录本身始终不被修改；一切开发在 `天結\` 内进行。

## 3. 当前状态（已完成）

- [x] 目录工程化：raw 软连接、install 全量拷贝、脚本、tools、manifest、git
- [x] 工具链获取与验证：
  - alf 解包 `SYS4INI.BIN`（`S4IC450`）成功：21,109 个文件索引，DATA3 完整解出
  - Kelebek1 反汇编/重汇编天結い脚本：`SC0000.BIN` 等往返 `-x` 逐字节 equal；
    ALF 内脚本（DEAL/GAMESTART/ROOM）同样 equal
  - `unpack_alf` 已移除源码中全部 `getchar()` 阻塞并重新编译（可直接作流水线工具）
  - SExtractor 正则（来自永焔の戦姫补丁页）已验证匹配反汇编输出
- [x] 数据文件清单与文本载体摸清（见 §7）
- [x] 社区先例确认（见 §8）：ZAP 英化本作、封緘のグラセスタ汉化均采用覆盖 BIN 文件
- [x] **文案语料基线**：`data\` 共 341 个 txt（69MB），以**松散版（1.07 现行）BIN** 反汇编为准，
  其余 ALF-only 脚本保留 DATA1 版本；已过滤全部无实际文案（纯逻辑/纯 ASCII）的文件
- [x] **松散 vs ALF 差异排查**：89 个同名 BIN 中 87 个不一致；ITINIT 差异 343 行且含真实文本修正
  （如「ふくへき/おおへき」「封錬/封練」「８マス/４マス」）→ 语料必须基于松散版
- [x] **gaiji 外字发现**（见 §7.4）：脚本内含私有区字符 U+E000（SJIS 0xF040），须原样保留

## 4. 本地工具（tools/）

| 工具 | 版本 | 状态 | 用途 |
|------|------|------|------|
| `alf\unpack_alf.exe` | foxofice/alf `8a70066` (2025-09-26) | 已编译可用（已去 getchar 阻塞） | 解包 `SYS4INI.BIN`+`DATA*.ALF`、`APPEND*.AAI`（LZSS 解 TOC） |
| `alf\packdata`（源码） | 同上（战Z中文项目遗留） | 需适配 | 修改文件重打包进 ALF 并重建 SYS4INI.BIN 索引 |
| `eushully-decompiler\Decompiler\Decompiler.exe` | Kelebek1 `21da1e8` (2024-08-30) | 已编译可用 | AGE 脚本反汇编 `-d` / 重汇编 `-a` / 往返校验 `-x` |
| `SExtractor\` | satan53x（HEAD） | 依赖已装（Python 3.11） | 按正则提取/导入文本；可导出 UIF tunnel 配置与 `sjis_ext.bin` |
| `UniversalInjectorFramework\` | AtomCrafty（HEAD） | 源码（无 release，需编译） | 运行时注入：字体/编码/转区/tunnel 解码（中文显示方案） |

常用命令：

```bash
# 解包（在含 SYS4INI.BIN 的目录运行）
tools/alf/unpack_alf.exe SYS4INI.BIN

# 反汇编 / 重汇编 / 往返校验
tools/eushully-decompiler/Decompiler/Decompiler.exe -d SC0000.BIN SC0000.txt
tools/eushully-decompiler/Decompiler/Decompiler.exe -a SC0000.txt SC0000.BIN
tools/eushully-decompiler/Decompiler/Decompiler.exe -x SC0000.BIN
```

构建备注：

- Decompiler 为 VS 工程（v143 工具集）；本机为 VS18/v180，手动编译方式：
  `cl /std:c++20 /O2 /EHsc age-asm.cpp age-shared.cpp disassembler.cpp reassembler.cpp /Fe:Decompiler.exe`
- unpack_alf 手动编译：`cl /O2 /EHsc unpack_alf.cpp lzss.cpp /Fe:unpack_alf.exe /link Shlwapi.lib`
- UIF 同样锁定 v143，需要重定向工程或手动编译后再用
- `unpack_alf` 运行时会生成 `lzssdata.bin/lzssdata2.bin` 调试文件（可删）

## 5. 工程脚本（scripts/）

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
```

`config.js` 关键配置：

- `GAME_DIR`：游戏本体目录（迁移时只需改这里；工程目录改名不影响，ROOT_DIR 相对脚本推导）
- 排除（不进入 install）：`天结.exe`（心愿屋汉化壳）、`*.dmp`（崩溃转储）
- `RAW_SKIP_DIRS`：raw manifest 跳过 `_analysis`、`.claude`（开发工作区，非游戏数据）
- `IMMUTABLE_EXTS`：当前为空（全量真拷贝）；将来可对确定永不变的文件恢复硬链接

## 6. manifest 与数据完整性

- `install-manifest.json`：install 每个文件（相对路径）的 MD5，追踪修改
- `raw-manifest.json`：游戏本体 + 补丁目录的 MD5，作为原始基线（不含开发工作区）
- `npm run compare` 秒级对比两份 manifest：不一致/缺失/新增全部列出（排除项除外）
- 注意：`manifest-all` 需重新哈希约 15GB，耗时 1-2 分钟

## 7. 游戏数据格式研究结论

### 7.1 文件体系（SYS4.5 / S4IC450）

- `SYS4INI.BIN`：全局文件索引（魔数 `S4IC450 `，TOC 为 LZSS 压缩），登记 21,109 个文件
- `DATA1-8.ALF`（约 7.2GB）+ `APPEND01-05.ALF/.AAI`：聚合档案
- 文件类型分布：OGG 13,629 / AGF 5,600 / **BIN 565** / WAV 339 / PNG 322 / MOC 238 / MTN 233 / MPG 171 / 其他
- 松散文件：根目录 105 个 `.BIN`（17.6MB，含全部 26 个 SC* 剧情脚本）、8 个 `.AGF`、字体、exe、dll
- **游戏直读松散文件**：89 个与 ALF 同名的 BIN 中 87 个内容不一致（1.07 修正版），证明
  游戏实际加载松散副本，覆盖松散文件即可生效
- ALF 内独有 `.BIN` 共 476 个：SC* 118 / \*INIT 43 / 逻辑脚本 315（如 DEAL/GAMESTART/ROOM 等，无台词命令）
- DATA 各盘内容：DATA1=角色图+全部脚本 / DATA2=角色立绘 / DATA3=BGM / DATA4=SE/语音 /
  DATA5=视频 / DATA6=Live2D（MOC+MTN+PNG）/ DATA7-8=事件图

### 7.2 脚本格式（SYS4450）

- 头部：`SYS4450 ` + 6 个 u32 局部变量数 + 0x1C + 三张表（length/offset）
- 指令流为 AGE 字节码；字符串位于数据表尾部，**0xFF 按位取反 + SJIS** 存储，0xFF 结束
- Kelebek1 反汇编输出 UTF-8 文本；SExtractor 正则：
  `show-text 0 "..."` / `display-furigana 0 "..." "..."` / `set-string (...) "..."`
- 实测 SC0000.BIN：527 条 show-text、109 条 display-furigana、426 条 wait-for-input、16 条 set-string

### 7.3 exe / DLL

| 文件 | 大小 | 说明 |
|------|------|------|
| `天结.exe` | 19,980,350 | 心愿屋汉化壳 = 引擎 + 18.9MB overlay（加密翻译表，方案 B 弃用） |
| `AGE.EXE` | 1,007,104 | 原版引擎（干净，无 overlay） |
| `start.exe` | 31,945,168 | 启动器（2014 时间戳，带签名） |
| `AGERC.DLL` | 335,872 | 资源 DLL（标题菜单/模态窗口，可能含少量 UI 文本，待验证） |

### 7.4 gaiji 外字（重要）

- Shift-JIS `0xF040–0xF9FC` 是**用户定义外字区**，CP932 线性映射到私有区 `U+E000–U+E757`
- 天結い脚本大量使用：U+E000 共 17,210 处（156 个文件），常成对出现在台词开头/停顿/句尾，
  语义为**停顿/无声标记**（与语音节奏相关）；游戏字体与系统字体均有字形（三角旗+斜线符号）
- 编辑器显示为"□"是因为字体缺少 PUA 字形，不是解码错误
- **处理要求**：提取语料时用占位符（如 `〔E000〕`）保留，翻译/校对不得删除，写回前还原；
  反汇编/重汇编对该字符无损往返（已验证）

## 8. 关键决策：方案 B（改数据文件）及依据

**为什么不做方案 A（逆向更新 `天结.exe`）**：overlay 为高熵加密数据（MSVC rand 种子 18467/6334/26500 特征），hook 架构为心愿屋自研，PlayDRM（2017 起）无公开脱壳方案，零现成工具、不可维护。

**为什么方案 B 可行**：

1. 工具链已对天結い实测通过（§3）
2. 社区先例：ZAP 英化**本作**（备份并覆盖 BIN/AGF 文件）、封緘のグラセスタ（2018，同代引擎）汉化 V1.3（覆盖 BIN + LE 启动）、天结2（2021）汉化（BIN + AGERC.DLL）
3. ZAP 作者当年指出"没有工具重打包 DATA#.ALF"，该缺口现由 `alf/packdata` 补上
4. 游戏直读松散文件，多数文本（全部剧情脚本）无需动 ALF

**译文策略**：不继承心愿屋 13,500+ 条内存提取译文；以日文原文为准，MT 初翻 + 术语表 + 人工校对，心愿屋译文仅作参考。

## 9. 后续流程（方案 B 实施步骤）

1. **全量提取与语料基线** ✅：`data\` 341 个反汇编 txt（松散版 1.07 基线 + ALF-only），已入 git 跟踪（基线提交由人工执行）
2. **翻译与校对**：标准流程 = `locale/` 可读译文 + `scripts/translate.js`
   （extract/apply/assemble，编码映射同 SExtractor 的 JIS 替换字典 `subs_cn_jp.json`）；
   341 个脚本的 locale 基线已全部生成入库（不依赖 git）；`data\*.txt` 为生成产物，不手改；
   设置界面（OPINIT1，172 条）已完成全量翻译并安装。
   注意保留 gaiji 占位符与文本长度限制
3. **编码策略实测**（最小闭环）：挑 1 个剧情脚本 + 1 个 UI 脚本，各翻译数句，对比
   - tunnel 编码（UIF 解码，引擎始终见合法 SJIS；永焔の戦姫方案）
   - GBK 直写（中文系统区域，封緘疑似路线，需验证引擎是否接受）
4. **写回**：`-a` 重汇编 → 覆盖 install 根目录松散 BIN → 游戏内验证（字体/截断/分行）
5. **ALF 内脚本**：packdata 适配重打包，或实测松散同名文件覆盖 ALF 副本
6. **运行时方案**：编译 UIF（v143→v180 重定向），配置字体/编码/转区
7. **发布**：`patch/` 目录（修改文件 + UIF + install/restore 脚本）

## 10. 待验证 / 待决策

- [x] `data\` 文案语料基线（松散版）——已完成，纳入 git 跟踪
- [ ] 中文字符编码路线（tunnel vs GBK 直写）——最小闭环实测
- [x] **中文渲染路线**——OPINIT1 顶部 6 条已翻译并汇编（`data\OPINIT1.txt` → BIN）。
      UIF hook 已确认不可行（AGE.EXE 加壳，IAT hook 全部失败），install 中 UIF 文件已移除。
      最终方案（已实测确认）：**cnjp 系统字体 Amayui CN + 游戏内字体分类设置**，
      移除 `AGE-EXTEND.TTF` 外挂文件后 ＡＤＶメッセージ 等设置项真正生效；
      外字字形（U+E000/E001/E002/E003/E010）已并入字体。设置持久化在 SAVE.DAT
      （加密/索引形式）。待办：全部文本区域设为 Amayui CN 的完整覆盖验证、
      可选 FontSubstitutes 兜底（见 `scripts/README.md`）
- [ ] ALF 内脚本覆盖方式（packdata 重打包 vs 松散覆盖）
- [ ] UIF 编译（本机工具集 v180，需重定向）
- [ ] AGERC.DLL 是否需要处理（少量系统文本）
- [ ] 引擎文本长度/换行限制（ZAP 有 UI 截断先例）
- [ ] `Uninst*.exe` 是否移出 install（误运行可能卸载本体）；`project.json` 是否删除（引用已移除的 天结.exe）
- [ ] `tools/` 嵌套 git 仓库处理：加入 .gitignore 或删除嵌套 `.git` 后提交源码

## 11. 注意事项与风险

- 游戏存档位于 `%localappdata%\Eushully`，install 与本体会共用，测试前备份
- 游戏运行会在自身目录生成崩溃转储等新文件（install 内产生不影响本体）
- `manifest-all` / `check` 会全量哈希，耗时 1-2 分钟
- 修改 install 中的文件后先 `npm run check` 确认改动范围，再 `npm run manifest` 更新基线
- ALF 若重打包，务必在 install 的副本上进行（install 已是独立拷贝，无硬链接风险）
- `data\` 语料以松散版为准；ALF 内副本为旧版，切勿混用（ITINIT 等已证实有真实文本差异）
- 日文语料中的 gaiji（U+E000 等）须用占位符保留，写回前还原
