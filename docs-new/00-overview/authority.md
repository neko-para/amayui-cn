---
kind: procedure
state: live
---
# 00-overview · 权威声明细则

本文件**固化全库统一遵循的权威判定**，写作/审校任何文档时以此为准。

## 1. 翻译结果：`src/*.txt` 是唯一权威

- **汉化已完成**：`src/*.txt`（941 个）的翻译结果是**翻译域唯一权威、视为已确认**。
- 后续仅**持续校对**（统一术语/措辞/语气），改动会**整体修正**，不视为推翻既有结论。
- **旧的翻译中间产物（keywords-*/prob-*，302 篇）已作废、不再引用**；其名词/措辞不以之为准，只以 `src/` 为准。
- 进度基线：需翻译 465 中已译 453；剩余 12（系统/杂项 10 + APPEND 2）。无文本 240（基础版 11 + 追加包空壳 229）。

## 2. 引擎机制 与 游戏业务数据：严格解耦

| 域 | 归属 | 举例 | 「域」含义 |
|---|---|---|---|
| **引擎机制** | `03-engine/` | VM/opcode 分发、解释器主循环、操作数原语、`this` 布局、脚本帧、资源加载、渲染 | 引擎内部实现 |
| **脚本层（按脚本记账）** | `05-scripts/` | 某个 `src/*.txt` 的入口/结构/关键槽/不变量/坑（如设置界面的可见项表与滚动） | 那个脚本自己的流程（换脚本就不成立） |
| **业务数据** | `02-data/` | 掉落 item/rate、技能三段数组、物品/建筑/配方、地图、单位字段 | 游戏数据（脚本字节码/静态表语义） |

**结论落库的三层**（唯一会增长的处所；`docs-new/**` 是叙述层与生成物）：
`analysis/functions.json` + `fields.json`（函数/偏移是什么）· `analysis/engine-capabilities.json`（引擎常态行为）·
`analysis/scripts.json`（脚本台账）。渲染物为 `03-engine/engine-capabilities.md` 与 `05-scripts/*`，**勿手改**。

**硬性规则**：
- 业务数据的地址（如 `0x53e104` 掉落 rate、`0x1d4f4` 技能名、`0x5697a` 随机池）是**业务域常量**，**与引擎内部无必然联系**。
- **除非有确切证据**（进程内实测读取 + 与脚本语义互证），**不把业务数据地址与引擎机制混同**。
- 引擎与业务只有「读取/消费」层面的接口关系（引擎执行脚本、脚本引用业务数据），**不存在**业务数据属于引擎内部数组的默认假设。

## 3. 汉化字体基底：Sarasa Gothic SC

- **基底 = Sarasa Gothic SC（更纱黑体 SC，OFL，官方 TTF 1.0.40）**，2026-08 起替换原 WenQuanYi 微米黑。
- 渲染（UI 图）用 **Sarasa SC**；游戏内字体为 **Amayui CN**（Sarasa 基底 cnjp 替换版，族名 Amayui CN，声明 Shift-JIS 932 码页）。
- **旧 WenQuanYi 基底已弃用**（仅可回退），不再视为当前基底。

## 4. 文档自包含要求

- 任一主题文档**必须自包含**该主题的事实，不得用「见旧文档」代替。
- 仅允许在 `docs-new/` 内部做相对链接（跨主题交叉引用）。
- 不允许引用旧 `docs/` 或 `app/` 子工程 `docs/` 下的任何旧文档路径。

## 5. 事实度标注

结论标注三级事实度：**已确认**（数据/反汇编/实测实证） / **推测** / **未解**（Todo）。无法确认的明确写「待确认」。

---

# 附录 · 数据模型（2026-09 重构，**已生效**）

> 本节是 2026-09 文档/数据模型重构的**结论**。重构前的诊断（9 个结构性缺陷）、逐份归属与迁移分期
> 见 `docs-new/99-records/2026-09-datamodel/data-model-2026-09.md`（历史记录区）。

## A1. 五种存储与判据

| 存储 | 放什么 | 谁写 | 判据口诀 |
|---|---|---|---|
| `engine/*.c` `.lst` | 反编译 oracle | 外部工具 | **权威**，只读、不可编辑 |
| `analysis/*.json` + `analysis/journal.jsonl` | ① 事实台账 ② 沿革 | 手写 / 工具 | 「这是一个**事实** / 一段**沿革**」 |
| `tickets/<ID>/` | 工作项 | 手写 / 工具 | 「这是一次**工作**」 |
| `docs-new/**` | 人读文档（含生成物） | 手写 / 生成器 | 「这是一篇**叙事 / 流程**」 |
| `records`（`docs-new/99-records/`） | 一次性取证的历史快照 | 手写（只增不改） | 「这是**一次性**的东西」 |

**机器真源（唯一会增长）**：`analysis/functions.json`、`fields.json`、`opcodes.json`、`engine-capabilities.json`、
`scripts.json`、`opcode-gaps.json`、`journal.jsonl`，以及 `tickets/<ID>/ticket.json`、`docs-new/03-engine/opcode-table.md` 的**前身**
（见 A3）。

## A2. 实体 + 面（facet）模型

实体 6 种：**引擎函数**（`addr`）/ **字段偏移**（`scope+offset`）/ **opcode**（`opcode`）/ **引擎常态能力**（`kebab-id`）/
**游戏脚本**（短名）/ **工作项**（`T-####`）。每个实体带 4 个**生命周期不同**的面：

| 面 | 内容 | 何时变 | 渲染 |
|---|---|---|---|
| `engine` / 映射 | 引擎侧事实（raw 行号、handler、trigger、reads、whySilent） | 只在"又读了引擎代码"时 | ✅ |
| `emulator`（= 本工程面） | 本工程现状（status / evidence / guard / note / ticket / disposition） | 每次改代码 | ✅（`note` **裁剪**） |
| `journal` | 沿革（"原注 X 已订正为 Y"） | 每次订正 | ❌ **永不渲染** |
| `refs` / `links` | 结构化回链 | 随上两者 | ✅ |

**渲染纪律**：生成物只给**一句话摘要**，全文留在 JSON。
`opcode-gaps.md` 的 `note` 裁到 120 字（86 KB → 19 KB）、`engine-capabilities.md` 的 `emulator.note` 裁到 200 字。
全文取法：`gaps.js --show <opcode>` / `capabilities.js --show <id>`。

## A3. 真源与生成物（**改生成物会被守卫打回**）

| 真源 | 生成物 | 生成器 | 守卫 |
|---|---|---|---|
| `analysis/opcodes.json` | `docs-new/03-engine/opcode-table.md` | `scripts/build-opcode-table.mjs` | `test/doc-model.test.ts` |
| `analysis/opcodes.json` | `scripts/asm/opcodes.json` | `scripts/asm/build-opcodes.js` | `test/opcode-arity.test.ts` |
| `analysis/opcode-gaps.json` | `docs-new/03-engine/opcode-gaps.md` | `scripts/build-opcode-gaps.mjs` | `test/opcode-gaps.test.ts` |
| `analysis/engine-capabilities.json` | `docs-new/03-engine/engine-capabilities.md` | `scripts/build-capabilities.mjs` | `test/capability-ledger.test.ts` |
| `analysis/scripts.json` | `docs-new/05-scripts/*.md` | `scripts/build-scripts.mjs` | `test/script-ledger.test.ts` |
| `tickets/<ID>/ticket.json` | `tickets/README.md` | `scripts/build-tickets.mjs` | `test/ticket-ledger.test.ts` |
| `docs-new/**/*.md` 的 front-matter | `docs-new/00-overview/index.md` | `scripts/build-doc-index.mjs` | `test/doc-model.test.ts` |
| 四份台账 + 票据 + 沿革 | `docs-new/00-overview/status.md` | `scripts/build-status.mjs` | 同上 |
| 各数据层 | `docs-new/03-engine/opcode-table.md`（语义） | 同上 | — |

★**`opcode-table.md` 于 2026-09 从"真源"降为"生成物"** —— 574 行迁入 `analysis/opcodes.json`，
迁移做过往返比对（仅 2 行补了原文件缺失的收尾 ` |`，其余忽略空白后逐字节一致）。

## A4. 沿革只留三处（**别在第四处复述**）

| 级 | 家 | 记什么 |
|---|---|---|
| 实现级 | `tickets/<ID>/changes.md` | 第 N 次变更改了哪些文件、行为怎么变、判据、E4 截图 |
| 会话级 | `analysis/journal.jsonl` | 本轮几条线、方法论教训、跨票因果、计数快照 |
| 结论级 | 各实体的 `journal[]` | 某条**结论本身**被订正的沿革 |

**明令禁止**：① 在 `narrative`/`procedure`/`index` 文档里写「订正/旧句/当时/历史判据」——旧的直接删、
订正落 `journal`；② 在生成物里渲染任何 `journal`；③ 在 `handoff`/`plan` 里复述轮次。
（`test/doc-model.test.ts` 会查 ②③。）

## A5. 文档状态机

`docs-new/` 下**每份 md 必须带头部**：

```yaml
---
kind: source | generated | narrative | procedure | index | session | record
state: live | consumed | superseded
home: analysis/xxx.json          # kind=generated：真源
generated_by: scripts/build-xxx.mjs
superseded_by: ...               # state ≠ live 必填
---
```

```
live ──(产出它的票 done)──▶ consumed ──(被新文档取代)──▶ superseded
```

- `kind=record` ⇔ **必须**在 `docs-new/99-records/`
- **读文档前先看 `state`**：只有 `live` 是现行结论；`record` 是历史快照（结论已落台账，只作票据证据锚点）
- 索引（带徽章）与当前状态：`docs-new/00-overview/index.md` / `status.md`（都是生成物）

## A6. 缺口与工作项正交

`engine-capabilities.json` 的 `emulator.status ∈ {absent, partial}` 是**事实**（"我们现在没做/做了一半"），
`tickets/` 是**决定要做的事**（有判据）。**两者不互相派生**：
台账里的缺口**不强制开票**；反过来，票据必须能指向它服务的缺口或现象（`links.analysis` 用 `<file>#<id>` 形式）。
`status.md` 会把"有缺口"与"有票"分别列出，作为**建议**而不是校验。
