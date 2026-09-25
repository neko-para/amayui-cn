---
kind: generated
state: live
home: docs-new/**/*.md 的 front-matter
generated_by: scripts/build-doc-index.mjs
---

# 文档索引（生成物）

> 由 `docs-new/**/*.md` 的 front-matter 投影而来：`node scripts/build-doc-index.mjs`。**勿手改。**

**`kind`**：`source`=📌 真源 · `generated`=⚙️ 生成物 · `narrative`=📖 叙述 · `procedure`=📋 流程 · `index`=🧭 索引 · `session`=🔁 会话 · `record`=🗄 历史记录
**`state`**：`live`=✅ · `consumed`=📤 已消费 · `superseded`=⤵ 已取代

> ★**读文档前先看 `state`**：`live` 才是现行结论；`record` 是**一次性取证的历史快照**（结论已落台账，
> 只作票据证据锚点用）；`generated` 一律勿手改，改真源后重跑生成器。

共 **110** 份：📋 流程 18 · ⚙️ 生成物 42 · 📖 叙述 29 · 🔁 会话 2 · 🧭 索引 3 · 🗄 历史记录 16；按 state：live 94 · consumed 16

## `00-overview/`（7）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`00-overview/authority.md`](./authority.md) | 📋 流程 | ✅ | — | 00-overview · 权威声明细则 |
| [`00-overview/conventions.md`](./conventions.md) | 📋 流程 | ✅ | — | 00-overview · 目录纪律与数据分层 |
| [`00-overview/index.md`](./index.md) | ⚙️ 生成物 | ✅ | `scripts/build-doc-index.mjs` | 文档索引（生成物） |
| [`00-overview/lessons.md`](./lessons.md) | 📋 流程 | ✅ | — | 工程纪律（踩过的坑，全部是实测教训） |
| [`00-overview/project.md`](./project.md) | 📋 流程 | ✅ | — | 00-overview · 工程定位与现状 |
| [`00-overview/status.md`](./status.md) | ⚙️ 生成物 | ✅ | `scripts/build-status.mjs` | 当前状态（生成物） |
| [`00-overview/tickets.md`](./tickets.md) | 📋 流程 | ✅ | — | 00-overview · 需求 / 缺陷单（票据台账） |

## `01-translation/`（6）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`01-translation/decision.md`](./../01-translation/decision.md) | 📋 流程 | ✅ | — | 01-translation · 方案 B 决策与依据 |
| [`01-translation/encoding-font.md`](./../01-translation/encoding-font.md) | 📋 流程 | ✅ | — | 01-translation · 编码与字体（中文显示层） |
| [`01-translation/format-toolchain.md`](./../01-translation/format-toolchain.md) | 📋 流程 | ✅ | — | 01-translation · 数据格式与工具链 |
| [`01-translation/pipeline.md`](./../01-translation/pipeline.md) | 📋 流程 | ✅ | — | 01-translation · 翻译流水线（src 源文件 + 翻译语法） |
| [`01-translation/publish-status.md`](./../01-translation/publish-status.md) | 📋 流程 | ✅ | — | 01-translation · 发布 / 补丁 / 进度 |
| [`01-translation/ui-images.md`](./../01-translation/ui-images.md) | 📋 流程 | ✅ | — | 01-translation · 界面图片汉化（AGF / AGERC） |

## `02-data/`（7）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`02-data/drops.md`](./../02-data/drops.md) | 📋 流程 | ✅ | — | 02-data · 掉落数据（item / rate / 随机池 / 调用链） |
| [`02-data/extraction.md`](./../02-data/extraction.md) | 📋 流程 | ✅ | — | 02-data · 数据提取口径（以 amayui-toolkit metadata 为准） |
| [`02-data/items-recipes.md`](./../02-data/items-recipes.md) | 📋 流程 | ✅ | — | 02-data · 物品 / 建筑 / 配方 |
| [`02-data/maps-units.md`](./../02-data/maps-units.md) | 📋 流程 | ✅ | — | 02-data · 地图 / 单位摆放 / 特殊点位 |
| [`02-data/scripts-control.md`](./../02-data/scripts-control.md) | 📋 流程 | ✅ | — | 02-data · 脚本控制流与调用（call-script / jcc / CFG） |
| [`02-data/skills.md`](./../02-data/skills.md) | 📋 流程 | ✅ | — | 02-data · 技能表结构与数值字段 |
| [`02-data/training-speakers.md`](./../02-data/training-speakers.md) | 📋 流程 | ✅ | — | 02-data · 训练所 / 单位字段 / 说话人 id / 存档 |

## `03-engine/`（26）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`03-engine/adv-text-rendering.md`](./../03-engine/adv-text-rendering.md) | 📖 叙述 | ✅ | — | 03-engine · ADV／消息文本子系统：渲染逻辑与指令面 |
| [`03-engine/agerc-internals.md`](./../03-engine/agerc-internals.md) | 📖 叙述 | ✅ | — | AGERC.DLL 内部能力地图（模块功能归类） |
| [`03-engine/agerc-module.md`](./../03-engine/agerc-module.md) | 📖 叙述 | ✅ | — | AGERC.DLL 模块接口（0x14B / 0x14C / 0x14D） |
| [`03-engine/copyright-effect.md`](./../03-engine/copyright-effect.md) | 📖 叙述 | ✅ | — | 版权页「frame 效果」机制记录（LOGO.txt — 已收敛） |
| [`03-engine/engine-capabilities.md`](./../03-engine/engine-capabilities.md) | ⚙️ 生成物 | ✅ | `scripts/build-capabilities.mjs` | 引擎「常态能力」台账（第二层） |
| [`03-engine/engine-reset-mainloop.md`](./../03-engine/engine-reset-mainloop.md) | 📖 叙述 | ✅ | — | 03-engine · sub_40DF10(engineInitReset) + sub_412290(mainLoo |
| [`03-engine/field-97058-timer-dialog.md`](./../03-engine/field-97058-timer-dialog.md) | 📖 叙述 | ✅ | — | 03-engine · _this[97058] 全局时间阈值槽 与「光标贴顶/Alt → 弹系统对话框」触发链 |
| [`03-engine/flow-control.md`](./../03-engine/flow-control.md) | 📖 叙述 | ✅ | — | 03-engine · 流程控制指令族（exit / call-script / ret / exit-script / |
| [`03-engine/gallery-and-unlock-flags.md`](./../03-engine/gallery-and-unlock-flags.md) | 📖 叙述 | ✅ | — | 03-engine · 回想/鉴赏与「已使用文件」解锁标志 |
| [`03-engine/handoff.md`](./../03-engine/handoff.md) | 🔁 会话 | ✅ | — | 03-engine · 交接文档（可续跑） |
| [`03-engine/input-system.md`](./../03-engine/input-system.md) | 📖 叙述 | ✅ | — | 鼠标/输入系统机制记录（已收敛） |
| [`03-engine/instruction-directions.md`](./../03-engine/instruction-directions.md) | 🧭 索引 | ✅ | — | 03-engine · 指令功能方向分类（功能簇索引） |
| [`03-engine/live2d-moc-format.md`](./../03-engine/live2d-moc-format.md) | 📖 叙述 | ✅ | — | 03-engine · Live2D .MOC 二进制格式（本作 Cubism 2.0.06 / version 10） |
| [`03-engine/live2d.md`](./../03-engine/live2d.md) | 📖 叙述 | ✅ | — | 03-engine · Live2D 子系统（Cubism 2.0.06 for DirectX） |
| [`03-engine/message-config-gates.md`](./../03-engine/message-config-gates.md) | 📖 叙述 | ✅ | — | 03-engine · 消息 / ADV 路径上的配置门（未走到分支清单） |
| [`03-engine/opcode-gaps.md`](./../03-engine/opcode-gaps.md) | ⚙️ 生成物 | ✅ | `scripts/build-opcode-gaps.mjs` | 03-engine · opcode 缺口台账（生成物，勿手改） |
| [`03-engine/opcode-table.md`](./../03-engine/opcode-table.md) | ⚙️ 生成物 | ✅ | `scripts/build-opcode-table.mjs` | 03-engine · opcode→handler 全表（引擎位置 / 语义 / 分析状态） |
| [`03-engine/operands.md`](./../03-engine/operands.md) | 📖 叙述 | ✅ | — | 03-engine · 操作数访问原语（已瘦身） |
| [`03-engine/plan-2026-09.md`](./../03-engine/plan-2026-09.md) | 🔁 会话 | ✅ | — | 03-engine · 修复计划（2026-09，依据 audit-2026-09.md） |
| [`03-engine/rendering.md`](./../03-engine/rendering.md) | 📖 叙述 | ✅ | — | 03-engine · 绘制模型与淡入淡出 |
| [`03-engine/resource-loading.md`](./../03-engine/resource-loading.md) | 📖 叙述 | ✅ | — | 03-engine · 资源加载（统一文件 id / 启动链 / 纹理·AGF） |
| [`03-engine/runtime-memory.md`](./../03-engine/runtime-memory.md) | 📖 叙述 | ✅ | — | 03-engine · 引擎内部内存布局（this / 帧 / 调用栈） |
| [`03-engine/save-data.md`](./../03-engine/save-data.md) | 📖 叙述 | ✅ | — | 存档与「设置」的真正归处：SAVE.DAT（表持久化） |
| [`03-engine/scene-start-flow.md`](./../03-engine/scene-start-flow.md) | 📖 叙述 | ✅ | — | 新游戏开局链路：TITLE → Game Start → GAMESTART → SN0000 首文案 |
| [`03-engine/sound-system.md`](./../03-engine/sound-system.md) | 📖 叙述 | ✅ | — | 03-engine · 声音子系统（设备 / 三模块 / 音量路由 / ADV 语音联动） |
| [`03-engine/unpacking.md`](./../03-engine/unpacking.md) | 📖 叙述 | ✅ | — | 03-engine · 加壳拆壳与反汇编管线 |

## `04-app/`（10）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`04-app/emulator-copyright-effect.md`](./../04-app/emulator-copyright-effect.md) | 📖 叙述 | ✅ | — | Emulator：版权页「frame 效果」实现（架构性调整 + 已落地） |
| [`04-app/emulator-frame-loop-design.md`](./../04-app/emulator-frame-loop-design.md) | 📖 叙述 | ✅ | — | 04-app · 帧循环统一设计（提案） |
| [`04-app/emulator-refactor-plan.md`](./../04-app/emulator-refactor-plan.md) | 📖 叙述 | ✅ | — | 04-app · amayui-emulator 重构清单（活文档） |
| [`04-app/emulator.md`](./../04-app/emulator.md) | 📖 叙述 | ✅ | — | 04-app · amayui-emulator |
| [`04-app/inspector.md`](./../04-app/inspector.md) | 📖 叙述 | ✅ | — | 04-app · amayui-inspector |
| [`04-app/live2d-support-assessment.md`](./../04-app/live2d-support-assessment.md) | 📖 叙述 | ✅ | — | 04-app · Live2D 支持评估（系统能力 / 依赖路线 / 落地计划） |
| [`04-app/native-addon.md`](./../04-app/native-addon.md) | 📖 叙述 | ✅ | — | 04-app · 宿主侧原生模块（N-API）：为什么、怎么建、怎么打包 |
| [`04-app/README.md`](./../04-app/README.md) | 🧭 索引 | ✅ | — | 04-app · app 工具（三大子工程） |
| [`04-app/test-organization.md`](./../04-app/test-organization.md) | 📖 叙述 | ✅ | — | 04-app · 测试分类与组织（测试法） |
| [`04-app/toolkit.md`](./../04-app/toolkit.md) | 📖 叙述 | ✅ | — | 04-app · amayui-toolkit |

## `05-scripts/`（37）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`05-scripts/ALLMAP.md`](./../05-scripts/ALLMAP.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · ALLMAP |
| [`05-scripts/AUTORUN1.md`](./../05-scripts/AUTORUN1.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · AUTORUN1 |
| [`05-scripts/AUTORUN3.md`](./../05-scripts/AUTORUN3.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · AUTORUN3 |
| [`05-scripts/BUNKIMOVE.md`](./../05-scripts/BUNKIMOVE.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · BUNKIMOVE |
| [`05-scripts/CALLBACK_LOAD.md`](./../05-scripts/CALLBACK_LOAD.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · CALLBACK_LOAD |
| [`05-scripts/CHARMEDIT.md`](./../05-scripts/CHARMEDIT.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · CHARMEDIT |
| [`05-scripts/CHECKCONFIG.md`](./../05-scripts/CHECKCONFIG.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · CHECKCONFIG |
| [`05-scripts/CONFIG.md`](./../05-scripts/CONFIG.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · CONFIG |
| [`05-scripts/CONFIG1.md`](./../05-scripts/CONFIG1.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · CONFIG1 |
| [`05-scripts/CONFIG2.md`](./../05-scripts/CONFIG2.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · CONFIG2 |
| [`05-scripts/CVINIT.md`](./../05-scripts/CVINIT.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · CVINIT |
| [`05-scripts/GAMESTART.md`](./../05-scripts/GAMESTART.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · GAMESTART |
| [`05-scripts/HISTORY.md`](./../05-scripts/HISTORY.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · HISTORY |
| [`05-scripts/INIT2.md`](./../05-scripts/INIT2.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · INIT2 |
| [`05-scripts/INITCONFIG.md`](./../05-scripts/INITCONFIG.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · INITCONFIG |
| [`05-scripts/INITCONFIG0.md`](./../05-scripts/INITCONFIG0.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · INITCONFIG0 |
| [`05-scripts/INITCONFIG4.md`](./../05-scripts/INITCONFIG4.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · INITCONFIG4 |
| [`05-scripts/INITGAME.md`](./../05-scripts/INITGAME.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · INITGAME |
| [`05-scripts/LOADCONFIG.md`](./../05-scripts/LOADCONFIG.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · LOADCONFIG |
| [`05-scripts/MMODE.md`](./../05-scripts/MMODE.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · MMODE |
| [`05-scripts/MUINIT.md`](./../05-scripts/MUINIT.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · MUINIT |
| [`05-scripts/NOVEL.md`](./../05-scripts/NOVEL.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · NOVEL |
| [`05-scripts/README.md`](./../05-scripts/README.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账（src/*.txt 逐个记） |
| [`05-scripts/ROOM.md`](./../05-scripts/ROOM.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · ROOM |
| [`05-scripts/SAVE.md`](./../05-scripts/SAVE.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SAVE |
| [`05-scripts/SC0000.md`](./../05-scripts/SC0000.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SC0000 |
| [`05-scripts/SC0330.md`](./../05-scripts/SC0330.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SC0330 |
| [`05-scripts/SCJUMP.md`](./../05-scripts/SCJUMP.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SCJUMP |
| [`05-scripts/SELFONT.md`](./../05-scripts/SELFONT.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SELFONT |
| [`05-scripts/SETADVFLAG.md`](./../05-scripts/SETADVFLAG.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SETADVFLAG |
| [`05-scripts/SETFATE.md`](./../05-scripts/SETFATE.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SETFATE |
| [`05-scripts/SETL2DMOC.md`](./../05-scripts/SETL2DMOC.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SETL2DMOC |
| [`05-scripts/SETMEMOIR.md`](./../05-scripts/SETMEMOIR.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SETMEMOIR |
| [`05-scripts/SN0000.md`](./../05-scripts/SN0000.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SN0000 |
| [`05-scripts/SP2563.md`](./../05-scripts/SP2563.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SP2563 |
| [`05-scripts/SYSTEM4.md`](./../05-scripts/SYSTEM4.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · SYSTEM4 |
| [`05-scripts/TITLE.md`](./../05-scripts/TITLE.md) | ⚙️ 生成物 | ✅ | `scripts/build-scripts.mjs` | 脚本台账 · TITLE |

## `99-records/`（16）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`99-records/2026-09-audit/audit-2026-09-capabilities.md`](./../99-records/2026-09-audit/audit-2026-09-capabilities.md) | 🗄 历史记录 | 📤 已消费 | — | 常态能力台账审计（source = capabilities，2026-09）（结论已落 `analysis/engine-capabilities.json`） |
| [`99-records/2026-09-audit/audit-2026-09-docs.md`](./../99-records/2026-09-audit/audit-2026-09-docs.md) | 🗄 历史记录 | 📤 已消费 | — | docs（docs-new/03-engine 十七份文档）审计报告 —— 2026-09（结论已落 `analysis/engine-capabilities.json`） |
| [`99-records/2026-09-audit/audit-2026-09-opcodes.md`](./../99-records/2026-09-audit/audit-2026-09-opcodes.md) | 🗄 历史记录 | 📤 已消费 | — | 天結いキャッスルマイスター — opcode 审计报告（2026-09）（结论已落 `analysis/opcode-gaps.json`） |
| [`99-records/2026-09-audit/audit-2026-09.md`](./../99-records/2026-09-audit/audit-2026-09.md) | 🗄 历史记录 | 📤 已消费 | — | 03-engine · 文档×实现 凭空/推测点审计（2026-09）（结论已落 `docs-new/03-engine/plan-2026-09.md`） |
| [`99-records/2026-09-audit/stub-reaudit-2026-09.md`](./../99-records/2026-09-audit/stub-reaudit-2026-09.md) | 🗄 历史记录 | 📤 已消费 | — | 已 stub 指令的复评与实施台账（2026-09）（结论已落 `analysis/opcode-gaps.json`） |
| [`99-records/2026-09-b3/b3-bit2-model-spec-2026-09.md`](./../99-records/2026-09-b3/b3-bit2-model-spec-2026-09.md) | 🗄 历史记录 | 📤 已消费 | — | B3 实现规格：Item.flags bit2 族（opcode 0x230 / 0x231 / 0x235，连带 0x（结论已落 `analysis/engine-capabilities.json`） |
| [`99-records/2026-09-b3/b3-screening-2026-09.md`](./../99-records/2026-09-b3/b3-screening-2026-09.md) | 🗄 历史记录 | 📤 已消费 | — | B3 剩余未实现指令 · 逐条筛体（2026-09）（结论已落 `analysis/opcode-gaps.json`） |
| [`99-records/2026-09-datamodel/data-model-2026-09.md`](./../99-records/2026-09-datamodel/data-model-2026-09.md) | 🗄 历史记录 | 📤 已消费 | — | 数据模型（2026-09 重新设计 · 提案，未生效）（结论已落 `docs-new/00-overview/authority.md`） |
| [`99-records/2026-09-impl-audit/impl-audit-2026-09.md`](./../99-records/2026-09-impl-audit/impl-audit-2026-09.md) | 🗄 历史记录 | 📤 已消费 | `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` | 全指令「实现 × 引擎」逐条核对与缺口汇总（2026-09）（结论已落 `tickets/README.md`） |
| [`99-records/2026-09-impl-audit/raw/coverage.md`](./../99-records/2026-09-impl-audit/raw/coverage.md) | 🗄 历史记录 | 📤 已消费 | — | 覆盖账（机器生成）（结论已落 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md`） |
| [`99-records/2026-09-impl-audit/raw/summary.md`](./../99-records/2026-09-impl-audit/raw/summary.md) | 🗄 历史记录 | 📤 已消费 | — | 汇总（机器生成骨架；最终叙述见 records 报告）（结论已落 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md`） |
| [`99-records/2026-09-live2d/CONTEXT.md`](./../99-records/2026-09-live2d/CONTEXT.md) | 🗄 历史记录 | 📤 已消费 | — | CONTEXT — Live2D（TITLE）实现进度快照（结论已落 `tickets/T-0054/notes.md`） |
| [`99-records/2026-09-live2d/live2d-deform-semantics.md`](./../99-records/2026-09-live2d/live2d-deform-semantics.md) | 🗄 历史记录 | 📤 已消费 | — | Live2D（Cubism 2.0.06 for DirectX）变形与顶点生成 + 每帧求值语义（结论已落 `tickets/T-0054/notes.md`） |
| [`99-records/2026-09-route-c/route-c-text-metrics-2026-09.md`](./../99-records/2026-09-route-c/route-c-text-metrics-2026-09.md) | 🗄 历史记录 | 📤 已消费 | — | 扩展路线 C「字形度量」实测：0x1D0 / 0x1D1 的真身与处置（结论已落 `analysis/opcode-gaps.json`） |
| [`99-records/2026-09-t0114-debugger/session-state-2026-09-22.md`](./../99-records/2026-09-t0114-debugger/session-state-2026-09-22.md) | 🗄 历史记录 | 📤 已消费 | — | 会话中间状态记录（2026-09-22）（结论已落 `tickets/T-0102/evidence/chapter-chain-runtime-trace.md`） |
| [`99-records/2026-09-transition/transition-render-spec-2026-09.md`](./../99-records/2026-09-transition/transition-render-spec-2026-09.md) | 🗄 历史记录 | 📤 已消费 | — | 转场渲染规格（T-0084 · 引擎侧算法 → emulator 实现手册）（结论已落 `analysis/engine-capabilities.json`） |

## `README.md/`（1）

| 文档 | kind | state | 真源 / 生成器 | 标题 |
|---|---|---|---|---|
| [`README.md`](./../README.md) | 🧭 索引 | ✅ | — | 天結いキャッスルマイスター 工程文档（docs-new） |

## 不在本索引里的文档

- `analysis/*.json`、`analysis/journal.jsonl` —— **机器真源**（不是文档；用 `.agents/skills/amayui-engine-analysis/scripts/*.js` 查）。
- `tickets/**` —— 工作项台账（看板 `tickets/README.md`，单票 `tickets.js --show <ID>`）。
- `tools|plugins|native/*/README.md` —— 子工程自述，就地维护。
- `.agents/skills/*/SKILL.md` —— 流程契约（技能目录）。
