---
kind: index
state: live
---
# 天結いキャッスルマイスター 工程文档（docs-new）

> **本文档体系是工程全部信息的唯一新来源。** 所有内容**自包含**，不引用任何已作废的旧 `docs/`。
>
> 这里是**入口**。真正的索引、当前状态、权威契约都在 `00-overview/` 下：

| 想知道 | 去哪 |
|---|---|
| **全部文档的清单（含 `kind` / `state`）** | [`00-overview/index.md`](./00-overview/index.md) —— **生成物**，扫 front-matter 得到 |
| **现在什么状态、下一步做什么** | [`00-overview/status.md`](./00-overview/status.md) —— **生成物**，从四份台账 + 票据 + 沿革算出 |
| **权威声明 + 数据模型 + 文档状态机** | [`00-overview/authority.md`](./00-overview/authority.md) |
| 目录纪律（raw/install/data/src/res/tools/patch…） | [`00-overview/conventions.md`](./00-overview/conventions.md) |
| 工程定位与现状 | [`00-overview/project.md`](./00-overview/project.md) |
| 需求/缺陷单台账怎么用 | [`00-overview/tickets.md`](./00-overview/tickets.md) |
| 工程纪律（踩过的坑） | [`00-overview/lessons.md`](./00-overview/lessons.md) |
| 怎么接手继续做 | [`03-engine/handoff.md`](./03-engine/handoff.md) |

## 一句话现状

用 **TypeScript + Electron + PixiJS v8** 重写《天結いキャッスルマイスター》的 AGE/System4 引擎 VM：
启动链 `SYSTEM4 → LOGO → TITLE → CONFIG → GAMESTART → SN0000（序章正文）` 已**零未实现 opcode**跑通，
Electron 渲染壳（场景合成 / ADV 文本 / 音频 / 输入）与三闸门（意图丢弃 / 能力缺口 / 死写）齐备；
同时以「方案 B：改数据文件」完成**简体中文重制补丁**（翻译已收官，仅剩校对）。
（★本页**不写测试条数等会漂移的数**——跑 `cd app/amayui-emulator && npm run verify` 看；
现状数字在 `00-overview/status.md`。）

## 目录

| 目录 | 内容 |
|---|---|
| `00-overview/` | 入口、权威契约、索引与状态（后两者是生成物） |
| `01-translation/` | 汉化：决策、格式工具链、流水线、编码字体、UI 图片、发布 |
| `02-data/` | 业务数据：掉落 / 技能 / 物品配方 / 地图单位 / 训练所 / 提取口径 |
| `03-engine/` | 引擎分析：机制叙述 + opcode 全表（生成物）+ 台账渲染物 + 交接与计划 |
| `04-app/` | `amayui-emulator` / `amayui-inspector` / `amayui-toolkit` |
| `05-scripts/` | **脚本台账**（`analysis/scripts.json` 的生成物） |
| `99-records/` | **历史记录区**：一次性审计 / 规格 / 提案（`kind: record`、`state: consumed`）。结论都已落台账，**不要当现行真源读** |

## 权威声明（速查，细则见 `00-overview/authority.md`）

| 项 | 权威 | 说明 |
|---|---|---|
| 翻译结果 | **`src/*.txt`（941 个）** | 翻译域唯一权威；`docs/translate/*`（302 篇）已作废 |
| 引擎机制 | `docs-new/03-engine/` 的机制叙述 | 仅讲**整体机制**；逐条事实回链台账 id |
| 引擎事实台账 | `analysis/functions.json` + `fields.json` + `opcodes.json` + `engine-capabilities.json` + `scripts.json` + `opcode-gaps.json` | **唯一会增长的地方**；`docs-new` 下对应的 md 是生成物 |
| 沿革 | `tickets/<ID>/changes.md`（实现级）+ `analysis/journal.jsonl`（会话级）+ 各实体 `journal[]`（结论级） | **只留这三处** |
| 业务数据 | `docs-new/02-data/` | 与引擎内部**无必然联系**，不混同 |
| 汉化字体基底 | **Sarasa Gothic SC**（游戏内 = Amayui CN） | — |

## 术语速览

| 术语 | 含义 |
|---|---|
| AGE/System4 | Eushully 自研引擎；本作用 SYS4.5 / 魔数 SYS4IC450 |
| 方案 B | 不沿用心愿屋汉化壳，直接改游戏数据文件重制补丁 |
| DEC/ENC | 引擎操作数去混淆（rol32/ror32 + key） |
| `this` | 引擎对象指针（`struct Engine`） |
| front-matter 状态机 | `docs-new` 每份 md 的 `kind`/`state` 头；**读文档前先看 `state`** |
| `99-records/` | 历史记录区。`state: consumed` = 结论已落台账、只作票据证据锚点 |
| 锚点棘轮 | 台账/票据的每条结构记录带「行区间 + 必须出现的锚点串」；`src/*.txt` 一重排守卫就红 |
