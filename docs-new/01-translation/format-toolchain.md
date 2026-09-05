# 01-translation · 数据格式与工具链

## 1. 文件体系（SYS4.5 / S4IC450）

- `SYS4INI.BIN`：全局文件索引（魔数 `S4IC450 `，TOC 为 LZSS 压缩，登记 ~21,109 个文件）。
- `DATA1-8.ALF`（约 7.2GB）+ `APPEND01-05.ALF/.AAI`：聚合档案。
- 文件类型分布：OGG 13,629 / AGF 5,600 / BIN 565 / WAV 339 / PNG 322 / MOC 238 / MTN 233 / MPG 171 / 其他。
- 根目录松散 `.BIN` 105 个（含全部 26 个 `SC*` 剧情脚本）、`.AGF` 8 个、字体/exe/dll。
- **游戏直读松散文件**：89 个与 ALF 同名的 BIN 中 87 个内容不一致（1.07 修正版）→ 覆盖松散文件即可生效；**语料基于松散版**（ITINIT 等已证实有真实文本差异，勿混用 ALF 内副本——ALF 内为旧版）。
- DATA 各盘：DATA1=角色图+全部脚本 / DATA2=角色立绘 / DATA3=BGM / DATA4=SE/语音 / DATA5=视频 / DATA6=Live2D（MOC+MTN+PNG）/ DATA7-8=事件图。

## 2. 脚本格式（SYS4450）

- 头部：`SYS4450 ` + 6 个 u32 局部变量数 + 0x1C + 三张表（length/offset）。
- 指令流为 AGE 字节码；字符串位于数据表尾部，**0xFF 按位取反 + SJIS** 存储，0xFF 结束。
- 反汇编/重汇编：**Node 版 age-asm**（`scripts/asm/cli.js`，data-driven 指令集 `scripts/asm/opcodes.json`；
  `-d` 反汇编 / `-a` 重汇编 / `-x` 往返校验，逐字节 equal，跨平台、无路径坑）。`age-asm.exe` 为旧 Windows 版（仅兜底）。

## 3. AGF 图片格式（UI / 背景）

- 分两种：带 `ACGF` 固定头 / 无头（`00 00 00 00` 开头）。install 全量 5608 个 = 3136 ACGF + 2472 无头。
- 命名：`BG*`（背景，如 BG000AA=1280×720@24bpp）、`AE*`（事件图）、根目录 `MI040`（横幅 1280×202@8bpp）。
- **工具**：`tools/Eushully_AGF_TooL`（Koreanshy，GUI/可无界面）+ **Node 版** `scripts/agf/`（`npm run agf`：`extract`/`inject`/`build`，与 Python 版交叉验证像素级一致；无头自回环 4 字节偏移为原工具固有问题；**改图走有头注入=无损**）。
- ⚠️ 脚本 txt **不直接引用 `.AGF` 文件名** →「界面 → AGF」映射另行建立（资源表/内存层面，见 `../03-engine/resource-loading.md`）。

## 4. exe / DLL

| 文件 | 大小 | 说明 |
|---|---|---|
| `天结.exe` | 19,980,350 | 心愿屋汉化壳（方案 B 弃用） |
| `AGE.EXE` | 1,007,104 | 原版引擎（干净，无 overlay） |
| `start.exe` | 31,945,168 | 启动器（2014 时间戳，带签名） |
| `AGERC.DLL` | 335,872 | 资源 DLL（主菜单 MENU 110/124 + 16 个对话框） |

## 5. gaiji 外字（重要）

- Shift-JIS `0xF040–0xF9FC` 为用户定义外字区，CP932 线性映射到私有区 `U+E000–U+E757`。
- 天結い脚本大量使用：U+E000 共 17,210 处（156 个文件），成对出现在台词开头/停顿/句尾，语义为**停顿/无声标记**。
- **处理要求**：外字只出现在**未翻译原文行**（保留原样，asm 工具（scripts/asm）无损往返）；**译文不写外字**；`Amayui CN` 字体本身不含外字字形，游戏中停顿标记由引擎处理/回退显示（实测可接受）。

## 6. 工具链常用命令

```bash
node scripts/alf/unpack_alf.mjs SYS4INI.BIN                 # ALF 解包（Node 跨平台版，推荐）
node scripts/alf/unpack_alf.mjs --out raw-parts raw/SYS4INI.BIN
node scripts/asm/cli.js -e sjis -d SC0000.BIN SC0000.txt    # 反汇编（Node 版，推荐）
node scripts/asm/cli.js -e sjis -a SC0000.txt SC0000.BIN    # 重汇编
node scripts/asm/cli.js -e sjis -x SC0000.BIN               # 往返校验（逐字节 equal）
node scripts/agf/cli.js extract <AGF...> --out <目录>      # AGF→PNG（Node 版）
```

> ⚠️ 旧 `age-asm.exe` 用 ANSI 接收路径（ACP=936），含日文/中文绝对路径会被搅乱；
> **Node 版 `scripts/asm/cli.js` 无此问题**（UTF-8 处理路径），无需 ASCII 别名 junction。
> Node 版指令集数据也在 `scripts/asm/opcodes.json`，更新指令集改该 JSON 即可，无需重编译。

## 7. 交叉引用

- 目录纪律见 `../00-overview/conventions.md`；流水线见 `./pipeline.md`。
