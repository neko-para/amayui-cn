# 数据模型（2026-09 重新设计 · 提案，未生效）

> **本文档是一份提案**，不是现行契约。现行契约见 `authority.md` / `README.md` / `conventions.md` / `tickets.md`。
> 生效方式是：按 §8 分期落地，落地完成后再把本文内容并入 `authority.md` 并删除本文。
>
> **设计的输入 = 历史上我们实际产生过哪些内容**（94 份 `docs-new/**.md`、36 份 `03-engine/*.md`、5 个 `analysis/*.json`、
> 104 张票的 `ticket.json` + 899 KB 过程 md、`patch/CHANGELOG.md`、`output/*`、`install|raw-manifest.json`）。
> 本文对**每一类内容**回答三件事：**要不要**、**该放哪**、**怎么保证它不腐烂**。

---

## 0. 一句话

现在的问题不是"文档太多"，而是**同一条信息有多个家、且没有任何机制阻止它们分叉**。
新模型的总原则是：

> **每个事实恰好一个家；生成物只是视图；沿革不进生成物；每一份文档都带机器可读的 `kind` / `state`。**

---

## 1. 现状诊断

### 1.1 现在维护着哪些数据（实测体量）

| 存储 | 内容 | 体量 | 谁在改 | 谁在读 |
|---|---|---|---|---|
| `engine/*.c|.lst` | 反编译 oracle | ~18 万行 | 外部工具产出，只读 | 人 / 分析 |
| `analysis/functions.json` | 588 个函数「是什么」 | 561 KB | 手写 | 工具查询；**无 md 渲染** |
| `analysis/fields.json` | 368 个字段/偏移 | 122 KB | 手写 | 工具查询；**无 md 渲染** |
| `analysis/engine-capabilities.json` | 136 条引擎常态能力 **+ 本工程现状 + 沿革** | 266 KB | 手写 | 生成 md / 守卫 |
| `analysis/opcode-gaps.json` | 71 条 opcode 处置 **+ 沿革** | 103 KB | 手写 | 生成 md / 守卫 |
| `analysis/scripts.json` | 30 个脚本台账 | 156 KB | 手写 | 生成 md / 守卫 |
| `docs-new/03-engine/*.md` | 36 份（2 生成物 + 1 真源 + ~21 叙述 + 11 一次性 + 2 流程日志） | 1.40 MB | 手写 | 人 |
| `docs-new/05-scripts/*.md` | 31 份生成物 | 157 KB | 生成 | 人 |
| `docs-new/{00,01,02,04}/*.md` | 27 份叙述/流程 | 212 KB | 手写 | 人 |
| `tickets/*/ticket.json` | 104 张票机器真源 | 557 KB | 手写 + 工具 | 守卫 / 看板 |
| `tickets/*/*.md` | 过程文档（changes/notes/design/report） | 899 KB | 手写 | 人 |
| `scripts/asm/opcodes.json` | 574 opcode（汇编器输入） | 生成 | 生成 | 汇编器 |
| 其它 | `patch/CHANGELOG.md`、`*-manifest.json`、`output/callgraph.*`、`res/*`、`tools|plugins|native/*/README.md` | — | 各自 | 各自 |

### 1.2 九个结构性缺陷（每条都带实测证据）

| # | 缺陷 | 证据 |
|---|---|---|
| **D1** | **没有 `kind` / `state` 的机器建模**。真源 / 生成物 / 叙述 / 一次性快照四类只靠正文散文标注（"勿手改"、"一次性"）。 | `docs-new/README.md:71` 至今把 `stub-reaudit-2026-09.md` §4「由代码实算」当卖点，而该表是**过期快照**（`tickets/T-0075/audit-final-docs.json:538-542`：声称 OPS 230/50/14，实测 254/51/9）。 |
| **D2** | **混层**：一个文件同时装"引擎事实 / 本工程现状 / 沿革"。 | `engine-capabilities.json` 的 `emulator.note` = 60.5 KB（占实体数据 43%）；`opcode-table.md` 单元格里塞"★审计 P2 `op-10-001`…已修"。 |
| **D3** | **沿革没有唯一的家**：同一条订正被记在 8 个地方。 | `ticket.json.history` / `changes.md` / `handoff` 暂停点 / `repair-plan` §2x / `refactor-plan` §9 / `audit-2026-09.md §6` / 表格单元格的「订正」/ `engine-capabilities.emulator.note`。逐轮日志合计 ≈183 KB，且 `handoff:2` 自己写"批次总账在 repair-plan §2c…§2k"。 |
| **D4** | **生成物把真源里"不该渲染"的字段也渲染了**。 | `opcode-gaps.md` 86,496 B 中 **80,284 B（92.8%）逐字来自 JSON 的 `note`**（`build-opcode-gaps.mjs:268/277/285/293/305`）。反例：`engine-capabilities.md` 只渲染 `absent`/`partial`（52/136），53 条 `modeled-verified` 的 note **根本不进 md** —— 同一缺陷的两个方向。 |
| **D5** | **一次性产物没有生命周期**。 | 11 份 `*-2026-09.md` = 522 KB（`03-engine` 的 37%）；其中 4 份审计 + 5 份规格的对应票（T-0076/78/79/84/85）**均已 done**，结论 100% 落库，但没有一个字段说"已消费"。 |
| **D6** | **事实与工作项没正交**：`impl.status = absent` 既是事实也是待办，于是不得不用纪律去补。 | `docs-new/00-overview/tickets.md:150`：「能力台账里有 25 条 absent/partial 的缺口 ⇒ **不要**逐条开票（那是台账的职责）」。 |
| **D7** | **引用单向/隐式**：文档↔台账只有正文里的链接，没有结构化回链。 | `resource-loading.md` / `gallery-and-unlock-flags.md` 的结论被写进 caps 条目，但 `engine-capabilities.json` 里搜不到这两个文件名。 |
| **D8** | **同一数字多点陈述 ⇒ 全部漂移**。 | 测试条数实测 **929**；`README.md:14` 写 383、`project.md:18` 写 380、`emulator.md:14` 写 612、`emulator.md:179` 写 476（同文件自相矛盾）。 |
| **D9** | **真源与视图颠倒**：`opcode-table.md`（229 KB 手写表）是真源，`scripts/asm/opcodes.json` 由它生成；而表中 574 行的语义其实与 `functions.json.purpose`（75 KB）同源。 | `opcode-table.md` 574 行 / 224 KB 表体，其中 **75 行 / 75.5 KB 含历史标记**（20 处「★审计」+ 10 处「已修/已改」）；另有 **175 行仍是「仅映射」空语义**。 |

---

## 2. 设计目标与不变量

| # | 不变量 | 可判定方式 |
|---|---|---|
| I1 | 每份**文档**都有 `kind` 与 `state`，且 `state≠live ⇒ 有 superseded_by` | 守卫扫 front-matter |
| I2 | 每个 `kind=generated` 的文件**逐字等于**生成器输出 | 守卫逐字比较 |
| I3 | **沿革不进生成物**：`journal*` 字段与 `99-records/**` 不出现在任何生成物里 | 守卫断言生成物中不含 journal 串 |
| I4 | 一个事实只有一个家：`purpose`/`semantics`/`whySilent` 只写在 `analysis/*.json`；机制叙述只写"整体形状"并**回链 id** | 守卫查重复句（相似度阈值）+ 回链可解析 |
| I5 | 视图里不写死可算的数（测试条数、注册表条数、语料命中数） | 守卫扫数字黑名单 |
| I6 | 票据的 `links.analysis` 必须解析到真实 id | 守卫解析 |
| I7 | 事实（`impl`）与工作项（ticket）正交：缺口**不强制**开票；反向，票必须能指向它服务的缺口或现象 | `status.md` 列出"有缺口无票"清单，不做硬校验 |
| I8 | `99-records/**` 只增不改（除修错别字），且不进任何索引的"当前"区 | 守卫查 `kind=record` + 位置 |

---

## 3. 新模型

### 3.1 五种存储

```
① engine/            只读 oracle        反编译产物；权威；不可编辑
② analysis/*.json    ★机器真源          手写；唯一增长处；无散文渲染义务
③ analysis/journal.jsonl  ★沿革          追加写；永不渲染
④ tickets/           工作项             一票一文件夹；机器半 + 手写半
⑤ docs-new/**.md     人读文档           kind/state 受管；叙事与流程；生成物在其中
```

判据口诀：**"这是一个事实 / 一次工作 / 一段沿革 / 一篇叙事"** ⇒ 分别进 ② / ④ / ③ / ⑤。

### 3.2 实体 + 面（facet）模型

实体只有 **6 种**，各有稳定 id：

| 实体 | id | 家 |
|---|---|---|
| 引擎函数 | `addr`（如 `0x4209B0`） | `analysis/functions.json` |
| 引擎字段/偏移 | `scope+offset` | `analysis/fields.json` |
| **opcode** | `opcode`（如 `0xA0`） | **`analysis/opcodes.json`（新）** |
| 引擎常态能力 | `kebab-id` | `analysis/engine-capabilities.json` |
| 游戏脚本 | 脚本短名 | `analysis/scripts.json` |
| 工作项 | `T-####` | `tickets/<id>/ticket.json` |

每个实体带 **4 个面**，**生命周期不同 ⇒ 分开**：

| 面 | 内容 | 何时变 | 是否渲染 |
|---|---|---|---|
| `engine` / 映射 | 引擎侧事实（raw 行号、handler、trigger、reads、whySilent） | 只在"又读了引擎代码"时变 | ✅ |
| `impl` | **本工程**现状（status / evidence / guard / note / ticket / disposition） | 每次改代码就变 | ✅（`note` 裁剪） |
| `journal` | 沿革（"原注 X 已订正为 Y"、"轮 6 由 deferred 转 …"） | 每次订正就追加 | ❌ **永不渲染** |
| `refs` | 结构化回链（叙述文档 / 守卫 / 票 / 其它实体） | 随上两者 | ✅ |

**这一条同时修掉 D2（混层）与 D4（生成物渲染了不该渲染的字段）**：渲染器只读 `engine`+`impl`+`refs`，`journal` 只被工具打印。

### 3.3 沿革的两级模型

沿革有且只有两个家：

| 级 | 家 | 记什么 | 谁写 |
|---|---|---|---|
| **实现级** | `tickets/<id>/changes.md` | 第 N 次变更改了哪些文件、行为怎么变、判据、E4 截图 | 人/代理 |
| **会话级** | `analysis/journal.jsonl`（一行一轮） | 本轮几条线、方法论教训、跨票因果、计数快照 | 人/代理 |
| **结论级** | 各实体的 `journal[]` | 某条**结论本身**被订正的沿革 | 人/代理 |

**明令禁止**（新纪律，进 `conventions.md`）：
1. 在 `docs-new/**` 的 narrative / procedure / index 里写「订正」「旧句」「当时」「历史判据」——**旧的直接删，订正落 `journal`**；需要保留旧值做对照的，写进 `99-records/`。
2. 在生成物里渲染任何 `journal`。
3. 在 `handoff` / `plan` 里复述轮次（轮次只属于 `journal.jsonl`）。

### 3.4 文档模型：front-matter + state 机

`docs-new/` 下**每份 md** 必须带头部：

```yaml
---
kind: source | generated | narrative | procedure | index | record | session
state: live | consumed | superseded
home: analysis/opcodes.json            # kind=generated：真源；kind=source：= 自身
generated_by: scripts/build-opcode-table.mjs   # kind=generated 必填
superseded_by: docs-new/99-records/...         # state≠live 必填
tickets: [T-0102]                      # 可选
updated: 2026-09-21                    # 可选
---
```

state 迁移规则（守卫强制）：

```
live ──(产出它的票 done)──▶ consumed ──(被新文档取代)──▶ superseded
```

- `kind=record` ⇔ **必须**位于 `docs-new/99-records/`；反之亦然（I8）
- `kind=generated` ⇒ 逐字等于生成器输出（I2）
- `kind=narrative` ⇒ 位于 `00–05` 区，且**不得含沿革标记超阈值**
- `kind=session`（handoff / plan）⇒ 只允许"最新一份"含状态段；历史段非法

### 3.5 目录拓扑（现状 → 目标）

```
engine/                                     不变
analysis/
  functions.json                            不变（notes 里的沿革 → journal[]）
  fields.json                               不变
  opcodes.json                          ★新  取代 opcode-table.md 的"映射 + 状态"两列
  engine-capabilities.json                  改名面：emulator → impl；拆出 journal[]
  scripts.json                              不变
  journal.jsonl                         ★新  一行一轮
  live2d-deform-semantics.md            → 移出到 docs-new/99-records/

scripts/asm/opcodes.json                    生成源改为 analysis/opcodes.json

docs-new/
  00-overview/
    authority.md                        ★改造为"宪法"（并入本模型）
    conventions.md / project.md / tickets.md   保留（同步新 schema）
    lessons.md                          ★新  纪律清单（去重后的"踩过的坑"）
    index.md                            ★新（生成物）全库索引 + kind/state 徽章
    status.md                           ★新（生成物）当前状态 + 下一步
  01-translation/  02-data/                 不变
  03-engine/
    handoff.md                          ★改名，只手写 live（交接/起手/纪律/当前批次）
    plan-2026-09.md                     ★改名（原 repair-plan），只手写 live
    opcode-table.md                     ★真源 → 生成物
    opcode-gaps.md                      ★生成物（改输入）
    engine-capabilities.md              生成物（改渲染）
    <~21 机制叙述>.md                    保留；删重复段与"旧句+订正句"
    vm-opcodes.md                       ★删（已被 opcode-table 覆盖）
  04-app/                                  不变；refactor-plan §9 删除
  05-scripts/*.md                          不变（生成物）
  99-records/                           ★新  历史区
    2026-09-audit/{audit-2026-09,audit-2026-09-opcodes,audit-2026-09-capabilities,audit-2026-09-docs,stub-reaudit-2026-09}.md
    2026-09-b3/{b3-screening-2026-09,b3-bit2-model-spec-2026-09}.md
    2026-09-route-c/route-c-text-metrics-2026-09.md
    2026-09-transition/transition-render-spec-2026-09.md
    2026-09-live2d/{CONTEXT.md,live2d-deform-semantics.md}
    2026-09-t0075/{audit-final-*.json}

tickets/                                    结构不变；ticket.json schema 见 §4.7
```

**未移动的**（就地保留，避免断 `evidence[].file`）：`docs-new/03-engine/` 的机制叙述、
`docs-new/01-translation|02-data|04-app/`、`tools|plugins|native/*/README.md`、`patch/CHANGELOG.md`。

---

## 4. Schema 定义

### 4.1 `analysis/functions.json`（不大改）

```jsonc
{
  "addr": "0x4209B0", "raw_name": "sub_4209B0", "semantic_name": "op_jcc_4209B0",
  "op": "0xA0", "status": "ANALYZED",           // ANALYZED | PARTIAL | STUB
  "purpose": "两目标条件跳转…",                   // ★语义的唯一条目级家
  "signature_override": {...}, "sub_behaviors": [...], "fields_used": [...],
  "unmodeled": [...], "evidence": "raw 29596-29612",
  "notes": "脚本用法/emulator 落地现状",           // ★保持"当前态"，不得写沿革
  "journal": [{"at":"2026-09-19","round":6,"what":"原写『面板填矩形』，读体后订正为键位绑定表写入端"}]  // ★新
}
```

### 4.2 `analysis/fields.json`（不变）

`offset / type / name / scope / meaning / evidence / status`。可选新增 `journal[]`。

### 4.3 `analysis/opcodes.json`（★新，取代 `opcode-table.md` 的真源地位 + 吞并 `opcode-gaps.json`）

```jsonc
{
  "_doc": "opcode 注册与处置真源。映射部分可由 .c 的 dispatch 表重新推导并交叉校验；语义与处置手写。",
  "entries": [
    {
      "opcode": 160,
      "mnemonic": "jcc",
      "aliases": ["i0a0"],
      "argc": 3,
      "handler": "sub_4209B0",          // 可由 .c 交叉校验
      "handlerRaw": "4209B0",
      "semantics": "op1!=0→跳 op2；op1==0→跳 op3；0xFFFFFFFF = 落下句",   // ★手写；空 = 未解
      "semanticsRef": "0x4209B0",        // → functions.json.addr（可选；有值 ⇒ 已核对）
      "impl": {                          // ★本工程面
        "disposition": "implemented",    // implemented | deferred | engine-internal | unimplemented
        "reason": "…",                   // 渲染（裁剪）；deferred/engine-internal 必填
        "extension": "若将来做 X：…",     // deferred 必填
        "guard": "test/op-a2-a3.test.ts",
        "ticket": "T-0076"
      },
      "journal": [{"at":"2026-09","round":4,"what":"旧注 raw 33930 是邻居函数，已订正"}]   // ★不渲染
    }
  ]
}
```

**派生量**（不存储、渲染时算、守卫时查）：`注册表归属`（扫 `handlers/*.ts`）、`语料命中数`（扫 `src/*.txt`）、
`分析状态` = `unknown | mapped | read | guessed`：

| 派生状态 | 条件 |
|---|---|
| `unknown` | 无 handler（越界落默认表） |
| `mapped` | 有 handler 且 `semantics` 空（**吞并现「仅映射」175 行**） |
| `read` | `semantics` 非空且 `semanticsRef` 能解析到 `functions.json` |
| `guessed` | `semantics` 非空但无 ref（原「推测」） |

⇒ **`opcode-gaps.json` 作为文件消失**：它就是 `entries.filter(impl.disposition …)` 的视图。

### 4.4 `analysis/engine-capabilities.json`（改名面 + 拆沿革）

```jsonc
{
  "id": "text-line-pitch-font-1380", "subsystem": "消息窗", "name": "行距写入与换行步进",
  "engine": {                                    // ★面 1：引擎事实
    "trigger": "…", "reads": ["Font+1380"], "whySilent": "…",
    "fns": ["sub_412345"], "raw": "82674-82690", "confidence": "confirmed"
  },
  "narrative": "docs-new/03-engine/adv-text-rendering.md#L204",   // ★叙述的唯一家（结构化回链）
  "impl": {                                      // ★面 2：本工程现状（原 emulator 面）
    "status": "modeled-verified", "evidence": "E2", "guard": "test/…",
    "note": "已实现：…", "why_na": "…", "ticket": "T-0000"
  },
  "journal": [{"at":"2026-09","round":4,"what":"status absent → partial；原注『11 条只记录』不成立"}]  // ★不渲染
}
```

### 4.5 `analysis/scripts.json`（不变）

`id/file/bin/role/entry/layout[]/slots[]/invariants[]/gotchas[]/gaps[]/links/guards[]/status/evidence/notes`。可选 `journal[]`。

### 4.6 `analysis/journal.jsonl`（★新）

一行一轮，append-only：

```jsonc
{"at":"2026-09-21","round":9,"title":"T-0102 判据跑通 + T-0091③ G1/G2 落地 + 0x82 体定性",
 "lines":[{"topic":"T-0091③","result":"G1/G2 落地，两处以体订正规格","tickets":["T-0091"]}],
 "lessons":["读脚本/反编译先核指令的操作数位置","『某一步算错了』要先证伪再当结论","守卫的辨别力也可以来自内部对照"],
 "counts":{"tests":"929/917/12/0","gaps":"0/0/13/38/20","capabilities":"136"},
 "tickets":["T-0091","T-0102","T-0104"]}
```

用途：① 取代 `handoff` 的 4 个堆叠暂停点、`repair-plan` §2b–§2j、`refactor-plan` §9、`audit §6`；
② `lessons` 累计后人工去重进 `docs-new/00-overview/lessons.md`。

### 4.7 `tickets/<id>/ticket.json`

```jsonc
{
  "id":"T-0102","type":"bug","status":"open","priority":"P1","area":"emulator/adv","title":"…",
  "why":"…",                        // ★≤400 字；超了进 notes.md（新纪律）
  "acceptance":["…"], "tests":["…"],
  "evidence":[{"file":"…","anchor":"…","note":"…","line":123}],
  "blockedBy":[],
  "links":{"docs":[],"analysis":["engine-capabilities.json#text-reveal-pump-409400"],"tickets":[]},
  "history":[{"at":"…","kind":"created|status|scope","what":"…","note":"…"}],   // ★加 kind
  "droppedWhy":"…"
}
```

变化：
- **删除 `notes` 字段**（载体错位：39 张票把长文内联在 JSON，契约却写"长内容请写进 notes.md"）⇒ 内容迁入 `notes.md`
- `history[].kind` 新增；**`--edit` 无 `--note` 时不追加**（消掉 262 条 `改字段：evidence` 噪音）；
  字段级 diff 不再进 history（改由 `scope` 事件在改 `acceptance`/`why`/`status` 时记一句）
- `doneWhy` 字段取消（9 张票用到但 schema 未声明）⇒ 进 `history` 的 `status` 事件
- `links.analysis` 从自由串改为 **`<file>#<id>` 可解析形式**（I6）

### 4.8 文档 front-matter

见 §3.4。**只有 `docs-new/**` 强制**；`tickets/**/*.md` 保持自由（`tickets.js` 已声明它们不参与校验）。

---

## 5. 视图（生成物）清单

| 视图 | 真源 | 生成器 |
|---|---|---|
| `docs-new/03-engine/opcode-table.md` | `analysis/opcodes.json` + `functions.json` + `fields.json` | `build-opcode-table.mjs`（新） |
| `docs-new/03-engine/opcode-gaps.md` | `analysis/opcodes.json` + 代码注册表 + `src/` 扫描 | `build-opcode-gaps.mjs`（改） |
| `docs-new/03-engine/engine-capabilities.md` | `analysis/engine-capabilities.json` | `build-capabilities.mjs`（改） |
| `docs-new/05-scripts/*.md` | `analysis/scripts.json` | `build-scripts.mjs`（不变） |
| `docs-new/00-overview/index.md` | 全部 `docs-new/**` 的 front-matter | `build-index.mjs`（新） |
| `docs-new/00-overview/status.md` | 全部台账 + `tickets/` | `build-status.mjs`（新） |
| `tickets/README.md` | `tickets/*/ticket.json` | `build-tickets.mjs`（不变） |
| `scripts/asm/opcodes.json` | `analysis/opcodes.json` | `scripts/asm/build-opcodes.js`（改源） |

**渲染纪律**（进生成器注释 + 守卫）：`journal` 字段一律不渲染；`note`/`reason` 一律裁剪
（`opcode-gaps.md` 实测：`note` 裁到 160 字 ⇒ 86.5 KB → ≈23.8 KB，**−72%**）。

---

## 6. 守卫清单

| 守卫 | 守什么 |
|---|---|
| `test/doc-model.test.ts`（新） | I1/I2/I3/I5/I8：front-matter 合法性、state 机、生成物逐字一致、`99-records` 位置不变式、数字黑名单、生成物里不得出现 journal 串 |
| `test/opcode-ledger.test.ts`（改自 `opcode-gaps.test.ts`） | `analysis/opcodes.json` ↔ 代码三张注册表 ↔ `src/` 语料 ↔ 生成 md；`impl.disposition` 纪律（deferred 必填 extension、engine-internal 必真注册为 no-op、implemented 必真实现） |
| `test/capability-ledger.test.ts`（改） | `engine.whySilent` 必填；E2/E3 必带真实守卫；`n/a-known` 必写 `why_na`；`narrative` 回链目标存在 |
| `test/script-ledger.test.ts`（不变） | 锚点棘轮 + 回链 + md 同步 |
| `test/ticket-ledger.test.ts`（改） | evidence 锚点棘轮（不变）；`history[].kind` 合法；`links.analysis` 可解析；`why` ≤400 字 |
| `test/journal.test.ts`（新） | JSONL 每行合法、`round` 严格递增、`tickets[]` 存在、`lessons` 非空 |

---

## 7. 归属与清理策略（逐份）

图例：**保留** = 原地不动（或仅同步 schema）｜**瘦身** = 删重复段/沿革段｜**改造** = 改结构｜
**变生成物** = 手写真源改为生成｜**移动** = 改路径到 `99-records/`｜**删除** = 移除。

### 7.1 `analysis/`

| 现 | 体量 | 归属 | 处置 | 依据 |
|---|---|---|---|---|
| `functions.json` | 561 K | ② 机器真源 | **保留** + `notes` 里沿革 → `journal[]` | 无 md 渲染 ⇒ 无重复问题；`notes` 里 40/588 条含沿革 |
| `fields.json` | 122 K | ② | **保留** | 同上 |
| `engine-capabilities.json` | 266 K | ② | **改造**：`emulator`→`impl`；拆 `journal[]`；`note` 60.5 K 里沿革段迁出 | D2/D4 |
| `opcode-gaps.json` | 103 K | ② | **删除**（并入 `opcodes.json` 的 `impl` 面） | 它就是视图；D9 |
| `scripts.json` | 156 K | ② | **保留** | 生成物只 5.7% 是 notes |
| `live2d-deform-semantics.md` | 80 K | ⑤ record | **移动** → `99-records/2026-09-live2d/` | 一次性 oracle 专项报告 |
| `opcodes.json` | — | ② | **新建** | D9 |

### 7.2 `docs-new/03-engine/`

| 现 | 体量 | 归属 | 处置 | 依据 |
|---|---|---|---|---|
| `opcode-table.md` | 229 K | 生成物 | **变生成物**；574 行迁入 `analysis/opcodes.json`；75 K 沿革 → `journal` | D9/D3；迁移需脚本 + 两个测试重定向 |
| `engine-capabilities.md` | 88 K | 生成物 | **改渲染**：`impl.note` 裁剪；补渲染 53 条 verified（现完全不渲染） | D4 双向 |
| `opcode-gaps.md` | 86 K | 生成物 | **改渲染**：`reason` 裁到 160 字 + 指向 JSON；预期 −72% | D4 |
| `handoff-2026-09.md` | 90 K | session | **改造** → `handoff.md`：只手写 live（交接话术/起手命令/纪律/当前批次）；4 个暂停点 + §6 + §7 → `journal.jsonl` | 62% 是历史；D3 |
| `repair-plan-2026-09.md` | 66 K | session | **改造** → `plan-2026-09.md`：保留 §0–§3 + 当前批次；§2b–§2j → `journal.jsonl`（先解 T-0080/81/82 的 3 个 evidence 锚） | 80% 是历史；D3 |
| `audit-2026-09.md` | 43 K | record | **移动** + `state=consumed`；§6（32 K 逐轮日志）**删除** | D5/D3 |
| `audit-2026-09-opcodes.md` | 72 K | record | **移动** + consumed（先解 8 个票锚）；**归档前抽出"未落地清单"**（opcode-table 仍有 175 行 `mapped`） | D5 |
| `audit-2026-09-capabilities.md` | 45 K | record | **移动** + consumed（先解 2 个票锚） | D5 |
| `audit-2026-09-docs.md` | 31 K | record | **移动** + consumed（先解 2 个票锚） | D5 |
| `stub-reaudit-2026-09.md` | 33 K | record | **移动** + consumed；**§4 整节删除**（过期快照，换指向 `registry-tables.test.ts` 的指针） | D1 |
| `b3-screening-2026-09.md` | 34 K | record | **移动** + consumed（文档 `:239-243` 已自述作废） | D5 |
| `b3-bit2-model-spec-2026-09.md` | 32 K | record | **移动** + consumed | T-0076 done |
| `route-c-text-metrics-2026-09.md` | 22 K | record | **移动** + consumed + 订正 §4 头条（"保持 deferred" 已被 T-0095 推翻）；**需同步改 `op-1d0-1d1-text-metrics.test.ts` 的路径与 6 个字面锚** | 守卫当 fixture 读 |
| `transition-render-spec-2026-09.md` | 53 K | record | **移动** + consumed | T-0084 done |
| `adv-text-rendering.md` | 65 K | narrative | **瘦身**：删与 caps 条目重复的段（`text-line-pitch-font-1380` 等）、删「旧句+订正句」 | R6/R7 |
| `save-data.md` | 59 K | narrative | **保留**【本册被引最多】 + 补 caps 反向回链 | D7 |
| `input-system.md` | 49 K | narrative | **保留** | 抽查无重述 |
| `flow-control.md` | 38 K | narrative | **瘦身**：`:181` 旧句删、`:427` 订正句改为直述 | R7 |
| `rendering.md` | 36 K | narrative | **瘦身**：`:112` 订正句直述；`:125/:130` 与 `drawitem-world-matrix-composition` 重复段改回链 | R6/R7 |
| `sound-system.md` | 37 K | narrative | **瘦身**：与 `music-number-table-lifecycle` 重复段改回链 | R6 |
| `engine-reset-mainloop.md` | 35 K | narrative | **保留** | — |
| `agerc-internals.md` | 29 K | narrative | **保留**（与 `T-0088` 的覆盖关系待核） | — |
| `live2d.md` | 22 K | narrative | **瘦身**：删与 `live2d-node-matrix-compose` 双份的"轮 8 落地"叙述 | R6 |
| `scene-start-flow.md` | 15 K | narrative | **瘦身**：`:96-105` 的"历史判据表"移 `99-records/`，正文改直述 | R7 |
| `agerc-module.md` | 14 K | narrative | **保留** | — |
| `live2d-moc-format.md` | 14 K | narrative | **保留** | — |
| `copyright-effect.md` | 11 K | narrative | **保留** + **补 `engine-capabilities.json` 条目**（当前无落点） | D6 反向 |
| `gallery-and-unlock-flags.md` | 11 K | narrative | **保留** + 补反向回链 | D7 |
| `instruction-directions.md` | 8.8 K | index | **保留**（已是目标形态：只索引 + 回链） | 模板 |
| `resource-loading.md` | 8.3 K | narrative | **保留** + 补反向回链 | D7 |
| `field-97058-timer-dialog.md` | 8.0 K | narrative | **保留** | — |
| `message-config-gates.md` | 6.1 K | narrative | **保留** | — |
| `runtime-memory.md` | 6.1 K | narrative | **瘦身**：§1.1 与 `adv-text-rendering` 重复段改回链 | R6 |
| `unpacking.md` | 3.5 K | narrative | **保留** | 体积极小 |
| `operands.md` | 2.6 K | narrative | **保留**（"已瘦身"模板） | 模板 |
| `vm-opcodes.md` | 1.6 K | — | **删除**（内容被 `opcode-table.md` 全覆盖） | 已自称归档 |

### 7.3 `docs-new/` 其它

| 现 | 处置 |
|---|---|
| `README.md` | **拆分**：权威声明 → `00-overview/authority.md`（并并入本模型）；目录结构表 → `00-overview/index.md`（生成物） |
| `00-overview/{project,conventions,tickets,authority}.md` | **保留** + 删写死计数（D8）+ 同步新 schema |
| `00-overview/lessons.md`、`index.md`、`status.md` | **新建**（后两者生成物） |
| `01-translation/*`、`02-data/*` | **保留**（22 K + 10 K，无冗余） |
| `04-app/emulator.md` | **保留** + 删写死计数（`:14` 612 / `:179` 476） |
| `04-app/emulator-refactor-plan.md` | **改造**：§9 变更记录（357 行 / 41 K）删除 → `journal` + tickets；§0–§8 + §10 保留为 live |
| `04-app/{emulator-frame-loop-design,emulator-copyright-effect,live2d-support-assessment,native-addon,inspector,toolkit,README}.md` | **保留** |
| `05-scripts/*.md` | **保留**（生成物） |
| `CONTEXT.md`（仓根） | **移动** → `99-records/2026-09-live2d/CONTEXT.md` + consumed |

### 7.4 `tickets/`

| 现 | 处置 |
|---|---|
| 104 × `ticket.json` | **改造**：删 `notes`（→ `notes.md`）、`history[]` 加 `kind`、`why` 限 400 字、`links.analysis` 可解析、`doneWhy` 并入 history |
| `T-0075/audit-final-{opcodes,capabilities,docs}.json` | **326 K 无人引用**：**移动** → `docs-new/99-records/2026-09-t0075/raw/`（或删除）；并在 `T-0075/ticket.json` 回链 |
| `T-0072/notes.md` | **删除**（57 B，内容只有一个 `.`） |
| `T-0102/notes.md` | **瘦身**：自述是 `changes.md` 的摘要 ⇒ 合并进 `changes.md` |
| `T-0051` / `T-0058` 的 `notes` 悬空引用 | **修**（指向的 md 不存在） |
| 其余 76 份非标准名过程文档 | **保留**（`T-0093/deferred-triage-report.md`、`T-0102/white-report.md`、`T-0077/l2d-and-hover-report.md` 是跨票资产；其余是设计使然不被引用） |
| `T-0074` / `T-0058` / `T-0072` 的 history | **必须保留**（这三票的历史是唯一记录，无任何过程文档） |
| 262 条 bare `改字段：X` | **清理**（工具规则改了之后一次性删） |

### 7.5 其它存储（声明，不重构）

| 存储 | 模型定位 | 处置 |
|---|---|---|
| `engine/*` | oracle | 只读 |
| `src/*.txt`（941） | **翻译真值**（独立 store） | 不动 |
| `patch/CHANGELOG.md` + `patch/patch.config.json` | **发布沿革**（与 `tickets/*/changes.md` 的"实现沿革"不同 scope，不冲突） | 保留；在 `authority.md` 显式声明 |
| `install-manifest.json` / `raw-manifest.json` | 提取产物清单（生成物） | 保留 |
| `output/callgraph.*` | 分析生成物 | 保留；kind=generated |
| `res/*`、`data/*.txt` | 汉化资源 / 只读日文基线 | 不动 |
| `tools|plugins|native/*/README.md` | 子工程自述 | 就地保留，**不进 `docs-new/`**（`docs-new/README.md` 已声明不引用 `app/*/docs`） |
| `.agents/skills/*/SKILL.md` | 流程契约 | 保留；§2 三层数据层表述需按新模型改写 |

---

## 8. 迁移分期

| 期 | 内容 | 风险 | 出口判据 |
|---|---|---|---|
| **A** | 建 `analysis/journal.jsonl`（把 handoff 的 4 个暂停点、repair-plan §2b–§2j、refactor-plan §9、audit §6 共 ≈183 KB 逐轮搬进去）；`handoff.md` / `plan-2026-09.md` 瘦身 | 低（纯搬运，无守卫依赖内容） | 4 份文档合计 −183 KB；`journal` 校验绿 |
| **B** | `engine-capabilities.json` 拆 `impl` / `journal`；两个生成器改为裁剪渲染 + 不渲染 journal；`opcode-gaps.json` 的 `note` 拆 `reason`/`journal` | 低（守卫自动跟随；`renderGapMd` 是纯函数） | `opcode-gaps.md` −72%；`npm run verify` 绿；四份 `--validate` 绿 |
| **C** | front-matter + `kind`/`state` 上 94 份 md；新建 `doc-model.test.ts` + `index.md`（生成）+ `status.md`（生成） | 中（机械编辑，量大） | 守卫绿；`index.md` 能列出全部文档的 kind/state |
| **D** | 11 份一次性文档 + `CONTEXT.md` + `live2d-deform-semantics.md` 移入 `99-records/`；改 `evidence[].file` 与 `route-c` 测试路径 | **中高**（断锚风险；需脚本化重写 + `tickets.js --validate`） | `tickets --validate` 绿；`npm run verify` 绿 |
| **E** | `analysis/opcodes.json` 建库（脚本从 `opcode-table.md` + `.c` dispatch 表迁移）；`opcode-table.md` 变生成物；`opcode-gaps.json` 删除；两个测试重定向 | **高**（229 KB 真源翻转 + 574 行迁移） | 574 行逐行对照无差异；`opcode-arity.test.ts` / `op-1d0-1d1-text-metrics.test.ts` 绿 |
| **F** | `ticket.json` schema 改造（删 `notes`、`history[].kind`、`why` 限长、`links.analysis` 可解析）；262 条噪音清理；`T-0075` raw json 归档 | 中 | `tickets --validate` 绿；`ticket-ledger.test.ts` 绿 |
| **G** | 21 份机制叙述瘦身（删重复段 + 旧句直述 + 补反向回链）；`copyright-effect.md` 补台账条目 | 中（判断密集） | 抽查 8 条不再重复；caps 回链双向 |
| **H** | 收尾：`authority.md` 并入本模型；删本文；`docs-new/README.md` 拆分完成 | 低 | `doc-model.test.ts` 绿 |

**A/B 可以立刻做**（纯收益、零守卫风险）；**E 风险最高**，建议单独一轮并保留 `opcode-table.md` 的归档副本做对照。

---

## 9. 预期收益

`03-engine` 现状 1,404,040 B。目标 = 1,404,040 − 366,356（移入 `99-records/`）− 1,626（删 `vm-opcodes.md`）
− 255,528（原地瘦身：`opcode-table` −75,453 / `opcode-gaps` −62,000 / `handoff` −56,110 / `repair-plan` −52,965 /
`engine-capabilities` ≈−9,000）= **≈780 KB（−44%）**。

| 项 | 现在 | 目标 | Δ |
|---|---|---|---|
| `03-engine` 体量 | 1.40 MB | ≈0.78 MB | **−44%** |
| 其中"活区"（不含 `99-records/`） | 1.40 MB | ≈0.41 MB | **−71%** |
| 沿革副本数 | 8 处 | 2 处（`changes.md` + `journal.jsonl`） | **−75%** |
| `opcode-gaps.md`（生成物） | 86 KB | ≈24 KB | **−72%** |
| 逐轮日志在"活文档"里的字节 | ≈183 KB | 0 | **−100%** |
| 全库直接删除字节 | — | `T-0075` raw JSON 325,870 + history 噪音 48,573 + `vm-opcodes.md` 1,626 | **≈376 KB** |
| 漂移类缺陷（D8 型） | 4 处已知 | 0（数字不写死 + 守卫黑名单） | — |
| 一次性文档的"当前性"歧义 | 无标记 | `state` 机 + 索引徽章 | — |
| 事实↔工作项 | 靠纪律 | 正交 + `status.md` 派生清单 | — |

---

## 10. 明确不做的事

- **不引入"精仿源码"**：`analysis/*.json` 仍是结论层，不迁移成代码。
- **不给 `tickets/**/*.md` 加 front-matter**：它们按契约不参与校验，加了反而挡住笔。
- **不把 `docs-new/01-translation|02-data|04-app` 拆小**：体量小、无冗余。
- **不为"看起来整齐"重命名**已稳定的文件名（`engine-capabilities.*`、`scripts.json`、`functions.json`）——重命名成本 > 收益；本模型只改**结构与字段**。
- **不删除任何 `tickets/*/changes.md`**：它们是锚点棘轮的落点，也是实现级沿革的唯一家。
- **不把 `output/`、`install-manifest.json` 等生成物纳入 `docs-new/`**：它们有自己的消费方。
