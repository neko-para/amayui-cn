---
kind: procedure
state: live
---
# 00-overview · 需求 / 缺陷单（票据台账）

> **一句话**：`tickets/` 是"**还要做什么**"的**唯一落点**。发现的问题、要做的事、要核实的事，
> 一律开票；做完的票变成 `done`（带守卫），不做的票变成 `dropped`（带理由）。
>
> 与既有三层数据层**分工不重叠**（这点必须守住）：
>
> | 层 | 回答 | 文件 |
> |---|---|---|
> | 事实（第一/二/三层） | 引擎/脚本/能力**是什么** | `analysis/*.json`（真源）+ `docs-new/03-engine`、`05-scripts`（渲染物） |
> | **工作（本层）** | **还要做什么、做到哪一步、判据是什么** | **`tickets/<ID>/ticket.json`（真源）+ `tickets/README.md`（看板，生成物）** |
> | 历史（变更记录） | 已经**做完了什么**、为什么 | `docs-new/04-app/emulator-refactor-plan.md` §9、各台账的 `notes`/`history` |
>
> ⇒ **票据里不许抄台账内容**（只回链）；**已完成的往事不补票**（留在 §9 变更记录里）。
> 票据只描述"现在到未来"。

---

## 1. 存储模型：**一个需求 = 一个文件夹**（多文件）

```
tickets/
  README.md                 ← 生成物：看板（node scripts/build-tickets.mjs）。勿手改。
  T-0001/
    ticket.json             ← ★唯一的机器可读真源（状态/判据/证据锚点/链接/历史）
    notes.md                ← 手写：范围、设计要点、决策、未确认项
    changes.md              ← 手写：**变更记录**（同一个需求可以改很多次，一条一次）
    design.md / repro.md / … ← 手写：任意多份过程文档（自由命名）
    evidence/                ← 可选：截图/日志等附件（不参与校验，只在看板里计数）
```

**为什么一个需求一个文件夹**（用户要求，2026-09）：一个需求往往**跨多个文档、经过多次变更**。
若一票一文件，会出现两个坏结果：① 元数据、调查笔记、设计、变更记录全挤在一个 JSON 里（人类读不动）；
② 每改一次状态都要重写整份台账（diff 噪声大、并容易冲突）。
现在：**`ticket.json` 只管"机器可读的那一半"**，其余都进同目录的手写文档，随时加、随便写。

**唯一真源只有一个文件**：`tickets/<ID>/ticket.json`。看板与 `--show` 都是它的视图；
`notes.md`/`changes.md`/… **不参与 schema 校验**（因此不会被纪律挡住笔）。

---

## 2. `ticket.json` 字段

```jsonc
{
  "id": "T-0001",              // 必须等于文件夹名（T-\d{4}）
  "type": "bug",               // bug | req | refactor | analysis | docs | tooling | translation
  "status": "open",            // open | doing | blocked | done | dropped
  "priority": "P1",            // P0 | P1 | P2 | P3
  "area": "emulator/frame-loop", // 自由分层串（建议 <子工程>/<子系统>）；看板按它分组
  "title": "一行标题",
  "why": "为什么要做 / 现象是什么（bug 要给复现与影响）",
  "acceptance": ["怎么算做完（可核对）"],        // ★必须非空
  "tests": ["app/amayui-emulator/test/x.test.ts"], // status=done 时★必须非空且文件存在
  "evidence": [                                 // 证据（★锚点棘轮的对象）
    { "file": "app/amayui-emulator/src/report.ts", "anchor": "maxStepsPerFrame", "note": "为什么指这里", "line": 108 }
  ],
  "blockedBy": ["T-0001"],      // 前置票（不许悬空 / 成环）
  "links": {                    // 回链（不复制内容）
    "docs": ["docs-new/04-app/emulator-frame-loop-design.md"],
    "analysis": ["msgwin-char-reveal-grid"],   // 能力台账 id / 函数 addr
    "tickets": ["T-0003"]
  },
  "droppedWhy": "（status=dropped 时必填）",
  "doneWhy": "（status=done 但确实没有代码守卫时必填，如文档/分析票）",
  "history": [{ "at": "2026-09-14", "kind": "created", "what": "创建" }]   // 至少一条
}
```

**★2026-09 的三条 schema 变更**（`../00-overview/authority.md` 附录 A4）：

| 变更 | 为什么 |
|---|---|
| **`notes` 字段废除**（长文一律进 `notes.md`） | 契约本来就写"长内容请写进 notes.md"，但 75 张票把长文内联在 JSON（最大 1,637 字）⇒ 载体错位、`ticket.json` 被 prose 撑大。迁移时已把所有 `notes` 搬进同名 `notes.md` |
| `history[].kind` 必填：`created \| status \| scope \| decision` | 让"状态流转"与"分析结论"可分（前者可机械生成、后者不可） |
| **没有 `--note` 就不记 history** | 此前每次 `--edit` 都追加 `改字段：evidence` 这类字段 diff ⇒ 全库 515 条里 **262 条是零信息噪音**。字段级 diff 归版本控制 |
```

**`history` 与 `changes.md` 的分工**（别重复记）：

| | 记什么 | 谁写 |
|---|---|---|
| `history[]` | **状态/范围级**事件（`created`/`status`/`scope`/`decision`，一句话 + 日期）。**没有 `--note` 不记** | 工具 |
| `changes.md` | **实现级**改动：第 N 次变更改了哪些文件、行为怎么变、判据是什么、看了哪张截图 | 人/代理手写 |
| `analysis/journal.jsonl` | **会话级**沿革：本轮几条线、方法论教训、跨票因果 | 人/代理手写 |

> ★**沿革只有这三处**。**不要**把轮次复述进 `handoff` / `plan` / 生成物（`test/doc-model.test.ts` 会查）。

---

## 3. 硬约束（`tickets.js --validate` 与 `test/ticket-ledger.test.ts` **同一套规则**）

1. 文件夹名 = `T-\d{4}`，且 `ticket.json.id` 必须与之一致；`tickets/` 下不许有野文件夹；
2. `type/status/priority` 在枚举内；`title`/`area`/`why` 非空；
3. ★**没有判据的单不算单**：`acceptance` 必须非空（否则"做完了吗"无法判定）；
4. ★**done 必须带真实存在的守卫**：`status=done` ⇒ `tests[]` 非空且每个测试文件存在
   （与能力台账同纪律：**不许空口声称有守卫**）；
5. `status=dropped` ⇒ 必须写 `droppedWhy`（或 `notes` 里 `why:`）——**不许静默关单**；
6. ★**证据锚点棘轮**：`evidence[].file` 必须存在；给了 `anchor` 就必须在文件里出现
   —— 代码被删/改名 ⇒ 这张票**变红**，逼人回来核对（票据不许腐烂）；
7. `blockedBy` / `links.tickets` 不许悬空、不许成环；`history` 至少一条。

**锚点棘轮的两级**（刻意的宽严分离）：

- **硬失败**：文件不存在、或 `anchor` 在文件里找不到 ⇒ 票据过期，必须回来改；
- **软警告**：给了 `line` 而 `anchor` 不在该行 ±40 行内 ⇒ 只 `⚠`（重构会挪行号，不该因此判失败）。
- 锚点请选**稳定串**（函数名、opcode 名、`kind: 'tick'` 这种），不要选会随重构消失的中间变量名。

**证据只能指 durable 文件**：`.tmp/` 是 gitignore 的临时区 ⇒ **不许**做证据（结论要落到票据本身或 `analysis/`）。

---

## 4. 工作流

```bash
# ① 开单（发现问题的当下就开，别记在聊天里）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --add '{
  "title":"…","type":"bug","priority":"P1","area":"emulator/adv",
  "why":"现象 + 复现 + 影响","acceptance":["怎么算做完"],
  "evidence":[{"file":"src/SN0000.txt","anchor":"i090 49c 0 64 281","line":63,"note":"侧边栏热点"}]
}'

# ② 调查/设计：往过程文档里写（可多份、可多次追加）
node …tickets.js --note T-0016 --file notes.md   --text "### 调查\n…"
node …tickets.js --note T-0016 --file changes.md --text "第 1 次变更：…（判据：…）"

# ③ 状态流转（history 自动追加）
node …tickets.js --set-status T-0016 doing --note "开工"
node …tickets.js --set-status T-0016 blocked --note "等 T-0007 的 headless 输入源"

# ④ 收尾：填 tests[]、改 status=done、看板刷新、过闸门
node …tickets.js --edit T-0016 --set-json 'tests=["app/amayui-emulator/test/adv-msgwin.test.ts"]'
node …tickets.js --set-status T-0016 done --note "守卫与 E4 截图见 changes.md"
node scripts/build-tickets.mjs && node …tickets.js --validate

# 常用查询
node …tickets.js                 # 统计 + 待办
node …tickets.js --list --open    # 只看未完成（按 优先级/状态 排序）
node …tickets.js --show T-0002    # 单票：ticket.json + 该票所有过程文档
node …tickets.js --graph          # blockedBy 依赖树
```

**看板是生成物**：`tickets/README.md` 由 `node scripts/build-tickets.mjs` 渲染。
改了票据不重跑 ⇒ `test/ticket-ledger.test.ts` 会红（与 `analysis/*.json` 的台账同一纪律）。

---

## 5. 命名与分配

- **id**：`T-####`（4 位补零，工具 `--next-id` 自动分配）。**id 不复用、不回收**（删票=删文件夹，但更推荐 `dropped` 留档）。
- **area** 建议：`emulator/<子系统>`（如 `emulator/frame-loop`、`emulator/adv`、`emulator/audio`）、
  `engine/<主题>`、`translation`、`docs`、`repo`、`tooling`。
- **priority**：`P0` 阻塞他人的正确性缺陷；`P1` 当前主线；`P2` 该做但不急；`P3` 有空再说。

---

## 6. 与其它真源的关系（防重复的硬规则）

| 情形 | 怎么做 |
|---|---|
| 引擎/脚本的**事实**变了 | 改 `analysis/*.json`（第一/二/三层），票据只回链 id |
| 能力台账里有 25 条 `absent`/`partial` 的缺口 | **不要**逐条开票（那是台账的职责）；只在"决定要做"时开票，`links.analysis` 指向该条目 |
| 一件事做完了 | 把结论写进 §9 变更记录 / 台账 `notes`，并把票据置 `done`（带 `tests[]`） |
| 一个需求跨多个子工程 | **一张票**（一票一文件夹正好放得下多份文档），不要拆成若干张"同源票" |
| 票据之间相关 | `links.tickets`（相关）或 `blockedBy`（前置），**不要**把同一件事开两张票 |

---

## 7. 守卫挂在哪

- 工具自检：`node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate`
- 自动闸门：`app/amayui-emulator/test/ticket-ledger.test.ts`（在 `cd app/amayui-emulator && npm test` /
  `npm run verify` 里跑）—— 它读 `tickets/`，**不依赖 emulator 代码**，所以跨子工程的票也受同一闸门保护。
- 维护流程与工具用法：`.agents/skills/amayui-ticket-ledger/SKILL.md`
