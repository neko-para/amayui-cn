# 天結いキャッスルマイスター 汉化工程文档

> 更新日期：2026-08-05
> 工程根目录：`E:\Games\Eushully\天結`（git 仓库，`.gitignore` 已排除 `/install`、`/raw`）
> 游戏本体：`E:\Games\Eushully\天結いキャッスルマイスター`（Eushully，2017-05-26，v1.07 + AP01-05）

## 1. 项目概述

目标：为《天結いキャッスルマイスター》**重新制作中文补丁（方案 B：直接修改数据文件）**。

- 不沿用心愿屋汉化壳（`天结.exe`）与译文（错漏多，仅作参考对照）
- 从日文原文重新翻译/校对，写入游戏数据文件（脚本 `.BIN`），以原版引擎 + 修改后数据运行
- 中文显示层：SJIS 码位映射 + cnjp 系统字体 Amayui CN（游戏内字体设置指向它），不改游戏文件
- 工程目录名从 `天结`（中文）改为 `天結`（日文），以适配日文区域环境运行

## 2. 目录结构

```
E:\Games\Eushully\天結\
├── raw\                  junction 软连接 -> 游戏本体（只读参照，勿写入）
├── install\              可运行测试树（与本体完全独立的全量真拷贝；含 DATA1-8 解包目录）
├── data\                 只读比较基线：341 个反汇编 txt（原始日文，不再修改）
├── src\                  可编辑开发源：341 个 txt（含翻译语法）
├── scripts\              Node.js 工程脚本（setup/verify/manifest/translate）
├── tools\                本地工具链（alf / eushully-decompiler / SExtractor / UIF-已弃用）
├── docs\                 本文档（README.md / glossary-draft.md / keywords-装备与物品.md /
│                          keywords-SKINIT.md / prob-SKINIT.md / keywords-战斗地名.md /
│                          prob-STINIT2.md / keywords-单位名称.md / prob-EBINIT.md /
│                          keywords-战斗目标.md / prob-STINIT.md / prob-AMINIT2.md /
│                          keywords-关卡逻辑.md / prob-SELSTAGE.md /
│                          keywords-任务目标.md / prob-MIINIT.md /
│                          keywords-序章战斗剧情.md / prob-SC4900.md /
│                          keywords-战斗地点.md / prob-OBINIT.md /
│                          keywords-卡片.md / prob-CDINIT2.md /
│                          keywords-角色名称.md / prob-CNINIT.md /
│                          keywords-角色图鉴.md / prob-CIINIT.md /
│                          keywords-设施.md / prob-PLINIT.md /
│                          keywords-场域消息.md / prob-FIELD.md /
│                          keywords-情报首页.md / prob-INFO.md /
│                          keywords-称号.md / prob-CCINIT.md / prob-DGINIT.md / prob-COMMITDR.md /
│                          keywords-AIM.md / prob-AIM.md /
│                          keywords-城砦配置.md / prob-SELFORT.md /
│                          keywords-术语词典.md / prob-VIINIT.md /
│                          keywords-地形.md / prob-LAINIT.md /
│                          keywords-战斗奖励.md / prob-REWARD.md /
│                          keywords-教程剧情.md / prob-SC1500.md / prob-SC2000.md / prob-SC3000.md /
│                          prob-SC3010.md / prob-SC4040.md / prob-SC4070.md / prob-SC4710.md /
│                          keywords-第一章剧情.md / prob-SC0010.md / prob-SG0010.md / prob-SC2500.md /
│                          prob-SC4010.md / prob-SC5400.md / prob-SC5410.md /
│                          prob-SC0500.md / keywords-工坊.md / prob-ALCHEMY.md /
│                          SG与SC分节对应.md）
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
- [x] **翻译流水线与渲染路线**：`data`（只读基线）/ `src`（开发源，翻译语法）；
      `translate.js`（assemble 含骨架校验与 SJIS 编码映射）；cnjp 系统字体 Amayui CN + 游戏内字体设置；
      UIF hook 因 AGE.EXE 加壳放弃；OPINIT1（172 条）全量翻译、SN0000 开场 ADV 段落重排示例已完成并安装
- [x] **名词共识草稿**：`docs/glossary-draft.md`（萌娘百科世界观页 + 游戏本体页提取，含角色/地理/诸神/种族，待人工审校）
- [x] **SKINIT 技能全量翻译**：1549 条 set-string（1533 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 1532/1532）；
      技能关键字表 `docs/keywords-SKINIT.md`、待定清单 `docs/prob-SKINIT.md` 已建立
- [x] **STINIT2 战斗地名全量翻译**：130 条 set-string（95 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 118/118）；
      关键字表 `docs/keywords-战斗地名.md`、待定清单 `docs/prob-STINIT2.md` 已建立
- [x] **STINIT 战斗目标全量翻译**：1632 条 set-string（449 条非空、83 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 83/83）；
      关键字表 `docs/keywords-战斗目标.md`、待定清单 `docs/prob-STINIT.md` 已建立
- [x] **AMINIT2 地点/阵营标签全量翻译**：39 条 set-string（27 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 27/27）；
      已并入 `docs/keywords-战斗地名.md`（§7），待定清单 `docs/prob-AMINIT2.md` 已建立
- [x] **SELSTAGE 关卡逻辑翻译**：2341 行、19 条 set-string（5 个唯一译文）译完并通过 assemble（骨架/SJIS/回读 5/5）；
      关键字表 `docs/keywords-关卡逻辑.md`、待定清单 `docs/prob-SELSTAGE.md` 已建立
- [x] **MIINIT 任务/关卡内目标全量翻译**：228 条 set-string（41 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 41/41）；
      关键字表 `docs/keywords-任务目标.md`、待定清单 `docs/prob-MIINIT.md` 已建立
- [x] **SC4900 序章战斗剧情翻译**：15 页 ADV（28 条 show-text、13 条纯读音注音只存档）+ 6 个唯一 set-string 译文，
      通过 assemble（骨架/SJIS/回读 26/26）；关键字表 `docs/keywords-序章战斗剧情.md`、待定清单 `docs/prob-SC4900.md` 已建立
- [x] **SC4910 序章战斗剧情翻译**：13 页 ADV（13 条输入原文、6 条纯读音注音只存档、5 个唯一 set-string 译文）
      通过 assemble（骨架/SJIS/回读 23/23）；并入 `docs/keywords-序章战斗剧情.md`
- [x] **SC4710 序章战斗教程翻译**：26 页 ADV（42 条 show-text、纯读音注音只存档、6 个唯一 set-string 译文）
      通过 assemble（骨架/SJIS/回读 44/44）；并入 `docs/keywords-教程剧情.md`、待定清单 `docs/prob-SC4710.md`
- [x] **OBINIT 战斗地点全量翻译**：131 条 set-string（111 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 111/111）；
      关键字表 `docs/keywords-战斗地点.md`、待定清单 `docs/prob-OBINIT.md` 已建立
- [x] **CDINIT2 卡片全量翻译**：178 条 set-string（94 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 94/94）；
      关键字表 `docs/keywords-卡片.md`、待定清单 `docs/prob-CDINIT2.md` 已建立
- [x] **CNINIT 角色名称全量翻译**：203 条 set-string（106 个唯一原文、30 处「？？？？」占位保持原样）
      译完并通过 assemble（骨架/SJIS/回读 105/105）；关键字表 `docs/keywords-角色名称.md`、
      待定清单 `docs/prob-CNINIT.md` 已建立
- [x] **CIINIT 角色图鉴全量翻译**：252 条 set-string（211 个唯一原文、10 处「？？？」占位保持原样）
      译完并通过 assemble（骨架/SJIS/回读 210/210）；关键字表 `docs/keywords-角色图鉴.md`、
      待定清单 `docs/prob-CIINIT.md` 已建立
- [x] **PLINIT 设施全量翻译**：415 条 set-string（327 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 327/327）；
      关键字表 `docs/keywords-设施.md`、待定清单 `docs/prob-PLINIT.md` 已建立
- [x] **FIELD 场域消息翻译**：12 个唯一 set-string + 15 个唯一 concat 片段（F 组重排 2 条 concat 为
      「获得…个！」格式）译完并通过 assemble（骨架/SJIS/回读 27/27）；关键字表 `docs/keywords-场域消息.md`、
      待定清单 `docs/prob-FIELD.md` 已建立
- [x] **INFO 情报首页翻译**：19 处 draw-string（17 处字面量译出 + 2 处符号保持）译完并通过
      assemble（骨架/SJIS/回读 17/17）；关键字表 `docs/keywords-情报首页.md`、待定清单 `docs/prob-INFO.md` 已建立
- [x] **SC0010 第一章剧情翻译**：369 页 ADV（454 条 show-text、86 条纯读音注音只存档、8 个唯一 set-string）
      译完并通过 assemble（骨架/SJIS/回读 510/510）；关键字表 `docs/keywords-第一章剧情.md`、
      待定清单 `docs/prob-SC0010.md` 已建立
- [x] **SG0010 第一章剧情补翻译**：1 页 ADV（技能「被吸收的力量」获得提示，配合 SC0010）+
      8 个唯一 set-string 译完并通过 assemble（骨架/SJIS/回读 11/11）；并入
      `docs/keywords-第一章剧情.md` §5、待定清单 `docs/prob-SG0010.md` 已建立
- [x] **SC2500 第一章 - 城砦内部（独立新序列）翻译**：317 页 ADV（385 条 show-text、69 条纯读音
      注音只存档、10 个唯一 set-string）译完并通过 assemble（骨架/SJIS/回读 410/410）；
      并入 `docs/keywords-第一章剧情.md` §6、待定清单 `docs/prob-SC2500.md` 已建立
- [x] **SG2502A/B 第一章 - 女神之力提升（配套 SC2500）翻译**：系统提示页译完并通过
      assemble（SG2502A 回读 13/13、SG2502B 回读 8/8）；并入 `docs/keywords-第一章剧情.md` §6
- [x] **SC0500 第一章 - 关卡剧情（堆积的城砦行道树）翻译**：261 页 ADV（286 条 show-text、26 条
      纯读音注音只存档、8 个唯一 set-string）译完并通过 assemble（骨架/SJIS/回读 330/330）；
      并入 `docs/keywords-第一章剧情.md` §7、待定清单 `docs/prob-SC0500.md` 已建立
- [x] **SC4010 第一章 - 关卡剧情（教程类）翻译**：60 页 ADV（80 条 show-text、20 条注音
      （含 ＨＰ/ＳＰ 释义类 3 处保留）、14 处 set-string 配对）译完并通过 assemble（骨架/SJIS/回读 104/104）；
      配套 SG4015/SG4018（8/8、8/8）；并入 `docs/keywords-第一章剧情.md` §8、待定清单 `docs/prob-SC4010.md`
- [x] **SC1500/SC2000/SC3000/SC3010 教程剧情翻译**：城砦角色与设施教程（SC1500 363 条 show-text、
      SC2000 154 条、SC3000 215 条、SC3010 32 条）全部通过 assemble（348/348、149/149、205/205、38/38）；
      配套 SG2002/SG2003/SG2004、SG3000/SG3007 已同步翻译；并入 `docs/keywords-教程剧情.md`，
      待定清单 `docs/prob-SC1500.md` 等 4 份
- [x] **SC4040/SC4070 第一章关卡剧情（教程）翻译**：伙伴出击与指挥力（28 条 show-text）、
      防卫战与关卡剧情（83 条 show-text）通过 assemble（41/41、97/97）；配套 SG4072/SG4073/SG4075/SG4078
      已同步翻译；并入 `docs/keywords-教程剧情.md`、待定清单 `docs/prob-SC4040.md` / `docs/prob-SC4070.md`
- [x] **SG4900 序章 - 财宝获得（配套 SC4900）翻译**：4 行系统提示（鼠标/道具使用教程）译完并通过
      assemble（骨架/SJIS/回读 10/10）；并入 `docs/keywords-第一章剧情.md` §8
- [x] **CCINIT 角色称号全量翻译**：99 条 set-string（87 个唯一原文）译完并通过
      assemble（骨架/SJIS/回读 87/87）；关键字表 `docs/keywords-称号.md`、待定清单 `docs/prob-CCINIT.md` 已建立
- [x] **DGINIT 女神称号全量翻译**：16 条 set-string（16 个唯一原文）译完并通过
      assemble（骨架/SJIS/回读 16/16）；并入 `docs/keywords-称号.md`、待定清单 `docs/prob-DGINIT.md` 已建立
- [x] **COMMITDR 女神力提升翻译**：2 个 concat 片段（1 句系统提示）译完并通过
      assemble（骨架/SJIS/回读 2/2）；并入 `docs/keywords-称号.md`、待定清单 `docs/prob-COMMITDR.md` 已建立
- [x] **SC5400 第一章 - 关卡剧情（教程）翻译**：10 页 ADV（战斗基础/效果参数教程，19 条 show-text、
      ＨＰ 释义类注音 2 处保留）译完并通过 assemble（骨架/SJIS/回读 27/27）；并入
      `docs/keywords-第一章剧情.md` §8、待定清单 `docs/prob-SC5400.md`
- [x] **SC5410 第一章 - 关卡剧情 城砦行道树翻译**：17 页 ADV（20 条 show-text、纯读音注音只存档）
      译完并通过 assemble（骨架/SJIS/回读 25/25）；并入 `docs/keywords-第一章剧情.md` §7.2、
      待定清单 `docs/prob-SC5410.md`
- [x] **EBINIT 单位名称全量翻译**：528 条 set-string（335 个唯一原文）译完并通过 assemble（骨架/SJIS/回读 335/335）；
      关键字表 `docs/keywords-单位名称.md`、待定清单 `docs/prob-EBINIT.md` 已建立
- [x] **AGF 图片工具验证**：`Eushully_AGF_TooL` 导出/有头注入/无头打包回环全部通过（见 §7.5；优先级低）
- [x] **AIM 目标/采集统计界面翻译**：2 处 set-string 字面量（お金→金钱 1 处译出、女神力保持原样）
      译完并通过 assemble（骨架/SJIS/回读 1/1）；关键字表 `docs/keywords-AIM.md`、
      待定清单 `docs/prob-AIM.md` 已建立（其余显示文本为全局字符串引用，源表已译）
- [x] **SELFORT 城砦配置翻译**：9 条 set-string（当前城砦配置 + 城砦方案０１〜０８）译完并通过
      assemble（骨架/SJIS/回读 9/9）；关键字表 `docs/keywords-城砦配置.md`、
      待定清单 `docs/prob-SELFORT.md` 已建立（マイセット 待 BIINIT 统一）
- [x] **VIINIT 术语词典翻译**：30 个词条、277 条 set-string 全部译出并通过 assemble
      （骨架/SJIS/回读 277/277）；关键字表 `docs/keywords-术语词典.md`、待定清单
      `docs/prob-VIINIT.md` 已建立；按 VIINIT 阐述统一「歪み→歪曲」，回改 CIINIT 2 处、
      STINIT2 1 处
- [x] **LAINIT 地形名翻译**：35 条 set-string（吹き抜け→空洞 等 10 个唯一译文）译完并通过
      assemble（骨架/SJIS/回读 10/10）；关键字表 `docs/keywords-地形.md`、待定清单
      `docs/prob-LAINIT.md` 已建立；SC4710「风口」同步改为「空洞」
- [x] **REWARD 战斗奖励翻译**：1 处字面量（お金→金钱）译完并通过 assemble
      （骨架/SJIS/回读 1/1）；关键字表 `docs/keywords-战斗奖励.md`、待定清单
      `docs/prob-REWARD.md` 已建立（道具名引用 ITINIT，页数符号保持原样）

## 4. 本地工具（tools/）

| 工具 | 版本 | 状态 | 用途 |
|------|------|------|------|
| `alf\unpack_alf.exe` | foxofice/alf `8a70066` (2025-09-26) | 已编译可用（已去 getchar 阻塞） | 解包 `SYS4INI.BIN`+`DATA*.ALF`、`APPEND*.AAI`（LZSS 解 TOC） |
| `alf\packdata`（源码） | 同上（战Z中文项目遗留） | 需适配 | 修改文件重打包进 ALF 并重建 SYS4INI.BIN 索引 |
| `eushully-decompiler\Decompiler\Decompiler.exe` | Kelebek1 `21da1e8` (2024-08-30) | 已编译可用 | AGE 脚本反汇编 `-d` / 重汇编 `-a` / 往返校验 `-x` |
| `SExtractor\` | satan53x（HEAD） | 依赖已装（Python 3.11） | 正则提取/导入参考；`subs_cn_jp.json` 为 SJIS 码位映射字典来源 |
| `Eushully_AGF_TooL\Eushully_AGF_TooL.exe` | Koreanshy（ai2.moe「Eushully会社 AGF图片处理工具」） | 2026-02-20（PyInstaller GUI） | 可用（已实测；可无界面调用） | AGF→PNG 批量导出 / PNG→AGF 有头注入与无头打包（UI/背景图片） |
| `UniversalInjectorFramework\` | AtomCrafty（HEAD） | **已放弃** | AGE.EXE 加壳，UIF 全走 IAT hook 实测全部失败（`Unable to enumerate import address table`） |

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
npm run register-font      # 会话级注册 Amayui CN 字体（重启后需重跑；或双击安装 TTF 永久生效）
npm run assemble -- <脚本> # src → 语法展开 → 骨架校验 → 汇编 → install → 回读验证
npm run reflow -- <文案>   # 按每行 ≤25 中文字排版（支持 ruby/nb 标注）→ 三段式页面块
```

`config.js` 关键配置：

- `GAME_DIR`：游戏本体目录（迁移时只需改这里；工程目录改名不影响，ROOT_DIR 相对脚本推导）
- `SRC_DIR`：开发源目录（src/）；`data/` 为只读比较基线
- 排除（不进入 install）：`天结.exe`（心愿屋汉化壳）、`*.dmp`（崩溃转储）、
  `AGE-EXTEND.TTF`（引擎内置字体，已确认移除后回退系统字体设置，无需外挂）
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
  语义为**停顿/无声标记**（与语音节奏相关）；原版引擎字体 AGE-EXTEND.TTF 含字形
  （三角旗+斜线符号）
- 编辑器显示为"□"是因为字体缺少 PUA 字形，不是解码错误
- **处理要求**：外字只出现在**未翻译的原文行**（保留原样，Decompiler 无损往返）；译文不写外字；
  Amayui CN 字体本身不含外字字形，游戏中停顿标记由引擎处理/回退显示（实测可接受）；
  字体构建/重建细节见 [font-build.md](font-build.md)

### 7.5 AGF 图片格式（UI / 背景图）

- AGF 为 Eushully 自研图片容器，分两种格式：带 `ACGF` 固定头 / 无头（`00 00 00 00` 开头）。
  install 全量扫描：**5608** 个 AGF = **3136** 个 ACGF 有头 + **2472** 个无头
- 分布：DATA1 2556、DATA7 889、DATA8 1477、根目录 8 个（MI040 等）。命名前缀示例：
  `BG*`（背景，如 BG000AA = 1280×720@24bpp）、`AE*`（事件图，如 AE000AB = 768×768@8bpp）、
  根目录 `MI040`（横幅，1280×202@8bpp）
- 工具：`tools/Eushully_AGF_TooL`（Koreanshy，2026-02-20，作者实测含天結い）。GUI 能力：
  - 导出 PNG：自动/强制有头/强制无头三种识别模式，支持多选批量
  - 有头注入（原 AGF + PNG → AGF）：保留原结构与 ACIF/Alpha 块；要求 PNG 与原始尺寸一致
  - 无头导入（PNG → AGF）：固定输出 24bpp 无压缩；丢弃 Alpha
- 实测（无界面调用验证）：
  - 导出 MI040（1280×202@8）、AE000AB（768×768@8）、BG000AA（无头，1280×720@24）全部成功
  - 有头注入回环：AE000AB 注入 → 重新导出 PNG 与原图 **md5 完全一致**（无损）；文件 273KB→1.18MB
  - 无头重打包回环：BG000AA 尺寸/颜色模式一致；1.97MB→2.76MB
- 注意：
  - 注入产物为**无压缩写入**，体积明显增大，DATA1 回 ALF 打包会膨胀（引擎读取尚未实测）
  - 脚本 txt 中**不直接引用 `.AGF` 文件名** → “界面 → AGF”映射需另行建立（资源表/内存层面）
  - **优先级：低**：固定 UI 图面文字汉化暂缓，文案/剧情脚本优先
- 无界面调用（临时手段）：exe 为 PyInstaller（Python 3.13）打包，已解包至 `.tmp\agf_runtime`
  （约 1GB，gitignore 覆盖），可用 `.tmp\py313\python.exe` import
  `extract_agf_to_png / inject_acgf_fixed / build_nohead_agf_from_png` 做批量处理；未纳入正式流水线

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
2. **翻译与校对**：`data\*.txt` 为只读比较基线（原始日文）；`src\*.txt` 为开发源，
   支持翻译语法（`"原文|译文"` 对、`@"译文"` 标记、`/* */` 块注释重写——
   原文行保持与基线逐字一致，git diff 只显示实际修改）；
   `scripts/translate.js` 提供 assemble（语法展开+骨架校验+编码映射），
   编码映射同 SExtractor 的 JIS 替换字典 `subs_cn_jp.json`。
   **ADV 折行**：show-text/display-furigana 到 `end-text-line` 前始终为同一视觉行，
   `end-text-line` 已释放为可调文本行；每视觉行 ≤25 中文字，由 `scripts/lib/reflow.js`
   （`npm run reflow`，支持 `<ruby>`/`<nb>` 标注、放不下提前折行、行尾不得悬空左引号『、
   输出 `// 输入原文` 单行注释 + 正文 + `// 页面结束` 结束注释的三段式页面块）自动排版。
   已完成：OPINIT1（172 条设置文案）、SN0000 开场 ADV 段落（重排示例，待游戏内验证）。
   注音策略（当前）：释义/称号类注音保留在 display-furigana 位置（中文释义作注音），
   纯读音（假名）类注音移除。
3. **编码策略（已定）**：SJIS 码位映射（`subs_cn_jp.json` 字典：可编码原样、否则日文写法占位），
   渲染时由 cnjp 字体 Amayui CN 还原简体；不再考虑 tunnel/GBK 直写
4. **写回**：`-a` 重汇编 → 覆盖 install 根目录松散 BIN → 游戏内验证（字体/截断/分行）
5. **ALF 内脚本**：packdata 适配重打包，或实测松散同名文件覆盖 ALF 副本
6. **字体分发**：Amayui CN 注册（`npm run register-font` 会话级，或安装 TTF）；游戏内把字体分类设为
   Amayui CN；可选 FontSubstitutes（ＭＳ 明朝 → Amayui CN）兜底
7. **发布**：`patch/` 目录（修改的 src 产物 + 字体 + install/restore 脚本）

## 10. 待验证 / 待决策

- [x] `data\` 文案语料基线（松散版）——已完成，纳入 git 跟踪
- [x] **中文渲染路线**——OPINIT1 顶部 6 条已翻译并汇编（`data\OPINIT1.txt` → BIN）。
      UIF hook 已确认不可行（AGE.EXE 加壳，IAT hook 全部失败），install 中 UIF 文件已移除。
      最终方案（已实测确认）：**cnjp 系统字体 Amayui CN + 游戏内字体分类设置**，
      移除 `AGE-EXTEND.TTF` 外挂文件后 ＡＤＶメッセージ 等设置项真正生效；
      外字字形（U+E000/E001/E002/E003/E010）已并入字体。ＡＤＶメッセージ字体
      明文落在 `SYS4REG.INI`（`[message] Font=`，可脚本化）；其余字体分类
      （含设置界面自身的 パラメータ文字/数字）按索引形式持久化在 SAVE.DAT，
      仍需用户进游戏设置一次。待办：全部文本区域设为 Amayui CN 的完整覆盖验证、
      可选 FontSubstitutes 兜底（见 `scripts/README.md`）
- [ ] ALF 内脚本覆盖方式（packdata 重打包 vs 松散覆盖）
- [ ] SN0000 ADV 段落重排/注音显示 游戏内验证；bba（concat 镜像）消费方确认
- [ ] 字典精修：上下文相关映射（如 发→髪 在“爆发/发展”中按字形还原正常，但“头发”语义冲突）
      需按词条/语境处理
- [ ] 剧本脚本提取器扩展（show-text/display-furigana/concat 段落级视图，用于批量机翻）
- [ ] AGERC.DLL 是否需要处理（少量系统文本）
- [ ] UI 图片汉化（AGF→PNG→改图→有头注入→回 ALF）：工具已验证可用；界面→AGF 映射未建；**优先级低**
- [x] 引擎文本长度/换行限制：ADV 视觉行按 ≤25 中文字排版（`scripts/lib/reflow.js`，
      `end-text-line` 可调；UI 固定控件截断风险仍需随测试观察）
- [ ] `Uninst*.exe` 是否移出 install（误运行可能卸载本体）；`project.json` 是否删除（引用已移除的 天结.exe）
- [ ] `tools/` 嵌套 git 仓库处理：加入 .gitignore 或删除嵌套 `.git` 后提交源码

## 11. 注意事项与风险

- 游戏存档位于 `%localappdata%\Eushully`，install 与本体会共用，测试前备份
- 游戏运行会在自身目录生成崩溃转储等新文件（install 内产生不影响本体）
- `manifest-all` / `check` 会全量哈希，耗时 1-2 分钟
- 修改 install 中的文件后先 `npm run check` 确认改动范围，再 `npm run manifest` 更新基线
- ALF 若重打包，务必在 install 的副本上进行（install 已是独立拷贝，无硬链接风险）
- `data\` 语料以松散版为准；ALF 内副本为旧版，切勿混用（ITINIT 等已证实有真实文本差异）
- 日文语料中的 gaiji（U+E000–E010）保留在未翻译原文行（Decompiler 无损往返）；译文不写外字
