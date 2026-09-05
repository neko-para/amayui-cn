# 天結いキャッスルマイスター 工程文档（docs-new · 唯一新来源）

> **本文档体系是工程全部信息的唯一新来源**，于 2026-09 全量重建。所有内容**自包含**，
> **不再引用任何 `docs/` 或 `app/*/docs/` 下的旧文档**；旧文档已作废，仅作历史参考（不应再作为事实源）。
>
> 工程根：`E:\Games\Eushully\天結`（git 仓库，`/install`、`/raw` 已被 `.gitignore` 排除）。
> 游戏本体：`E:\Games\Eushully\天結いキャッスルマイスター`（Eushully，2017-05-26，v1.07 + AP01-05）。

## 0. 一条话现状

用 **TypeScript + Electron + PixiJS v8** 重写《天結いキャッスルマイスター》的 AGE/System4 引擎 VM
（解释器已能无界面跑启动链到 `TITLE.BIN`，Electron 渲染壳已接通、标题真实图像已接入），
同时以「方案 B：改数据文件」完成**简体中文重制补丁**（翻译已收官，仅剩校对），
并配套**进程内存查看器**与**数据查询/制作规划 App** 两个落地工具。

## 1. 权威声明（贯穿全库）

| 项 | 权威 | 说明 |
|---|---|---|
| 翻译结果 | **`src/*.txt`（941 个）** | 唯一权威、视为已确认；后续仅持续校对、整体修正。**`docs/translate/*`（302 篇）已作废**，不再引用。 |
| 引擎机制 | `docs-new/03-engine/` | 仅引擎内部（VM/opcode/`this` 布局/资源加载/渲染）。 |
| 业务数据 | `docs-new/02-data/` | 掉落/技能/物品/地图等及其地址，**与引擎内部无必然联系**；除非有确切证据不与引擎混同。 |
| 汉化字体基底 | **Sarasa Gothic SC**（更纱黑体 SC，2026-08 起替换 WenQuanYi） | 渲染用 Sarasa SC；游戏内为 Amayui CN（Sarasa 基底 cnjp 替换版）。 |

## 2. 文档结构（docs-new）

```
docs-new/
├── README.md                 ← 本文件：总览 + 权威声明 + 结构表 + 术语速览
├── 00-overview/
│   ├── project.md            ← 工程定位与现状、四大方向
│   ├── conventions.md        ← 目录纪律（raw/install/data/src/res/tools/patch…）
│   └── authority.md          ← 权威声明细则（src=真值 / 引擎·数据解耦 / 字体基底）
├── 01-translation/           ← 游戏汉化
│   ├── decision.md           ← 方案 B 决策与依据
│   ├── format-toolchain.md   ← 数据格式（脚本/AGF/exe/DLL）+ 工具链
│   ├── pipeline.md           ← 翻译语法 + assemble/reflow/校验收官
│   ├── encoding-font.md      ← SJIS 码位映射 + 字体（Sarasa SC / Amayui CN）
│   ├── ui-images.md          ← 界面图片汉化（AGF→PNG→注入）+ AGERC
│   └── publish-status.md     ← 发布/patch/manifest + 当前进度
├── 02-data/                  ← 游戏数据分析
│   ├── scripts-control.md    ← call-script 索引 / jcc 语义 / 脚本 CFG
│   ├── drops.md              ← 掉落 item/rate/随机池/调用链
│   ├── skills.md             ← 技能三段数组 + 数值字段
│   ├── items-recipes.md      ← 物品/建筑/配方
│   ├── maps-units.md         ← 地图地板 / 地图内单位 / 特殊点位
│   ├── training-speakers.md  ← 训练所(DRINIT) / 单位字段 / 说话人 id
│   └── extraction.md         ← 数据提取口径（toolkit metadata）
├── 03-engine/                ← 游戏引擎分析
│   ├── unpacking.md          ← AGE 引擎加壳拆壳 + 重定型管线
│   ├── vm-opcodes.md         ← 解释器主循环 / opcode 分发 / handler 表
│   ├── operands.md           ← 操作数原语 / DEC·ENC / 指针模型
│   ├── runtime-memory.md     ← this 对象布局 / 脚本帧 / 调用栈（引擎内部）
│   ├── resource-loading.md   ← 统一文件 id 空间 / 启动链 / 纹理·AGF 映射
│   └── rendering.md          ← 绘制模型 / FadeTimer / 淡入淡出
└── 04-app/                   ← app 工具
    ├── README.md             ← 三子工程总览（独立、不引用 app/*/docs）
    ├── emulator.md           ← amayui-emulator
    ├── inspector.md          ← amayui-inspector
    └── toolkit.md            ← amayui-toolkit
```

## 3. 术语速览

| 术语 | 含义 |
|---|---|
| AGE/System4 | Eushully 自研引擎；本作用 SYS4.5 / 魔数 SYS4IC450 |
| 方案 B | 不沿用心愿屋汉化壳，直接改游戏数据文件重制补丁 |
| src/*.txt | 反汇编脚本 + 翻译语法；**翻译真值** |
| data/*.txt | 只读日文基线（assemble 骨架校验基准） |
| SYS4INI.BIN | 全局文件索引（TOC 为 LZSS 压缩） |
| DATA1-8.ALF / APPENDnn.AAI | 聚合档案；`$N$` 前缀=APPEND(追加包) |
| AGF | Eushully 图片容器（ACGF 有头 / 无头） |
| set-string | 脚本字面量文本指令 |
| DEC/ENC | 引擎操作数去混淆（rol32/ror32 + key） |
| `this` | 引擎对象指针（engine.hpp 的 `struct Engine`） |
| Amayui CN | 游戏内中文字体（Sarasa SC 基底，cnjp 替换版，族名 Amayui CN） |

## 4. 四大方向 → 文档入口

| 方向 | 入口 |
|---|---|
| ① 游戏汉化 | `01-translation/` |
| ② 游戏数据分析 | `02-data/` |
| ③ 游戏引擎分析 | `03-engine/` |
| ④ app 工具 | `04-app/` |

四个方向的顶层入口见 `04-app/README.md`；方向内各主题按上述目录逐一自包含展开。
