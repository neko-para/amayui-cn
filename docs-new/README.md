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
| 引擎结论数据层 | **`analysis/functions.json` + `fields.json`**（函数/偏移「是什么」）、**`analysis/engine-capabilities.json`**（引擎**常态能力**）、**`analysis/scripts.json`**（**脚本台账**：每个读过的 `src/*.txt` 的结构/槽/不变量/缺口） | 三层数据层是**唯一会增长**的地方；`docs-new/03-engine/engine-capabilities.md` 与 `docs-new/05-scripts/*` 是它们的**生成物**（`scripts/build-capabilities.mjs` / `scripts/build-scripts.mjs`），勿手改。 |
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
│   ├── vm-opcodes.md         ← (已归档) 解释器主循环/分发概览；语义看 opcode-table.md + 数据层
│   ├── opcode-table.md       ← **opcode→引擎位置 / 语义 / 分析状态全表（544+30 条，真源）**
│   ├── engine-capabilities.md ← **引擎「常态能力」台账（第二层，生成物）**：逐帧流程/门控/惰性创建/转场/资源生命周期 + emulator 现状
│   ├── operands.md           ← (瘦身) 操作数速记(DEC/ENC/指针模型)；原语以 data 层 functions.json 为准
│   ├── runtime-memory.md     ← (瘦身) this 布局说明 + 消息窗对象叙事；字段以 data 层 fields.json 为准
│   ├── resource-loading.md   ← 统一文件 id 空间 / 启动链 / 纹理·AGF 映射
│   ├── save-data.md          ← **SAVE.DAT**：脚本 save-int/save-string 两张表的持久化（= 设置界面开关的真正归处）+ 容器/Crypt/LZSS 全解 + emulator 现状
│   ├── sound-system.md       ← **声音子系统**：DirectSound 设备(15 通道) / SE·Voice·Music 三模块 / `sound:Volume0..4` 路由 / ADV 文本↔语音联动
│   ├── gallery-and-unlock-flags.md ← **回想/鉴赏与解锁**：FileDB「已使用文件」哈希表 / `0x19D` / SETMEMOIR 的三套收集表 / `$$SAVE.DAT` / BGM 鑑賞列表
│   ├── rendering.md          ← 绘制模型 / FadeTimer / 淡入淡出
│   └── (其余主题件)           ← flow-control / instruction-directions / input-system / message-config-gates /
│                                adv-text-rendering / copyright-effect / engine-reset-mainloop / field-97058-timer-dialog
├── 04-app/                   ← app 工具
│   ├── README.md             ← 三子工程总览（独立、不引用 app/*/docs）
│   ├── emulator.md           ← amayui-emulator
│   ├── inspector.md          ← amayui-inspector
│   └── toolkit.md            ← amayui-toolkit
└── 05-scripts/               ← **脚本台账**（第三层数据层 `analysis/scripts.json` 的生成物，勿手改）
    ├── README.md             ← 索引 + 覆盖率（已登记 N / 941）+ 怎么用的流程
    └── <ID>.md               ← 每个读过的 src/*.txt 一页：结构（行区间+锚点）/ 关键槽 / 不变量 / 坑 / 缺口 / 相关
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
| 三层数据层 | `analysis/` 下的三类结论：① `functions.json`+`fields.json`（函数/偏移是什么）② `engine-capabilities.json`（引擎常态行为）③ `scripts.json`（脚本台账）。**唯一会增长的地方**，md 都是渲染物 |
| 脚本台账 | 第三层：每个被分析过的 `src/*.txt` 一条（结构 / 槽 / 不变量 / 坑 / 缺口）；渲染物在 `docs-new/05-scripts/` |
| 锚点棘轮 | 脚本台账每条结构记录都带「行区间 + 必须出现在该区间内的锚点串」；`src/*.txt` 一重排，守卫测试就红 ⇒ 逼人刷新行号，防止结论悄悄失真 |

## 4. 四大方向 → 文档入口

| 方向 | 入口 |
|---|---|
| ① 游戏汉化 | `01-translation/` |
| ② 游戏数据分析 | `02-data/` |
| ③ 游戏引擎分析 | `03-engine/`（+ 数据层：`analysis/*.json`；`03-engine/engine-capabilities.md` 是第二层的渲染物） |
| ④ app 工具 | `04-app/` |
| ⑤ 脚本台账（引擎分析的产物层） | `05-scripts/`（真源 `analysis/scripts.json`；`node scripts/build-scripts.mjs` 生成） |

四个方向的顶层入口见 `04-app/README.md`；方向内各主题按上述目录逐一自包含展开。
`05-scripts/` 是**按脚本**记录「这个界面/演出脚本长什么样」的台账（行区间 + 锚点钉在 `src/*.txt` 上），
与 `03-engine/` 的跨脚本叙述互补：能靠读某个脚本回答的，写进 `05-scripts/`；跨脚本的机制写进 `03-engine/`。
