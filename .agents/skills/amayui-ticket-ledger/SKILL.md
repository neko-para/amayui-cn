---
name: amayui-ticket-ledger
description: 维护《天結いキャッスルマイスター》工程的**需求/缺陷单台账**（tickets/）：一个需求=一个文件夹（ticket.json 真源 + notes.md/changes.md/design.md 等任意多份手写过程文档 + evidence/ 附件），真源只存机器可读的那一半（类型/状态/优先级/判据 acceptance/守卫 tests/证据锚点/依赖/回链/history）。用 .agents/skills/amayui-ticket-ledger/scripts/tickets.js 查询增删改与自检（--list/--show/--stats/--graph/--next-id/--add/--edit/--set-status/--note/--rm/--validate），用 node scripts/build-tickets.mjs 渲染看板 tickets/README.md（生成物，勿手改），守卫是 app/amayui-emulator/test/ticket-ledger.test.ts（锚点棘轮：evidence 的 anchor 消失即红；status=done 必须带真实存在的测试）。当用户要求记录/登记一个待办、缺陷、需求、调查项或核实项，查询当前还有什么要做，更新某件事的进展/状态/判据/证据，或把聊天里发现的结论沉淀成可跟踪的工作项时使用。
---

# amayui-ticket-ledger —— 需求/缺陷单台账（`tickets/`，一个需求一个文件夹）

> 定位：`tickets/` 是"**还要做什么**"的**唯一落点**。发现的问题、要做的改造、要核实的事，一律开票。
> 与三层数据层分工：`analysis/*.json` 回答"**是什么**"（事实），票据回答"**做什么、做到哪、判据是什么**"（工作），
> `refactor-plan` §9 回答"**已经做完了什么**"（历史）。
>
> **三条不能破的边界**：① 票据**不抄**台账内容（只回链 `links.analysis`）；② **已完成的往事不补票**（留在 §9）；
> ③ 证据**不许指 `.tmp/`**（临时区，gitignore）——结论要么进票据，要么进 `analysis/`。

---

## 0. 为什么要这个技能（教训）

本工程的结论已经有三层数据层（函数/字段、常态能力、脚本台账）与一份重构清单，但"**还没做的事**"一直散在
四处：重构清单 §10 的表格、复盘文档的"未收敛"段、能力台账的 `partial` 状态、以及**聊天记录**。
后果是可复现的：同一件（帧循环 5 份实现、`waitFlags` 粘滞、headless 无音频）被反复发现、反复讨论，
却从来没有一个"何时算做完"的判据；而**修完的东西**也没人回头核对它原来指的那行代码还在不在。

票据台账就是把这四类东西收进一个**有判据、有证据锚点、有守卫**的地方，并且**一个需求一个文件夹**
（因为一个需求往往跨多个文档、经过多次变更）。

---

## 1. 存储模型（先读这个，再动手）

```
tickets/
  README.md              ← 生成物（看板）；node scripts/build-tickets.mjs；勿手改
  T-0001/
    ticket.json          ← ★唯一真源（机器可读的那一半）
    notes.md             ← 手写：范围/调查/设计/决策/未确认项
    changes.md           ← 手写：变更记录（同一需求改很多次 ⇒ 一条一次）
    design.md/repro.md/… ← 手写：任意多份，自由命名
    evidence/            ← 可选附件（不进校验，看板只计数）
```

**`ticket.json`**（字段与枚举见 `docs-new/00-overview/tickets.md` §2）：

```jsonc
{
  "id":"T-0001","type":"bug|req|refactor|analysis|docs|tooling|translation",
  "status":"open|doing|blocked|done|dropped","priority":"P0|P1|P2|P3",
  "area":"emulator/frame-loop","title":"一行","why":"为什么/现象+影响",
  "acceptance":["怎么算做完"],                 // ★非空
  "tests":["app/amayui-emulator/test/x.test.ts"], // status=done 时★必须存在
  "evidence":[{"file":"app/…/report.ts","anchor":"maxStepsPerFrame","note":"…","line":108}],
  "blockedBy":["T-0001"],"links":{"docs":[],"analysis":[],"tickets":[]},
  "notes":"自由文本（长内容写 notes.md）",
  "history":[{"at":"2026-09-14","what":"创建"}]
}
```

**`history[]` vs `changes.md`**：前者记**状态/范围级**事件（由工具自动追加），后者记**实现级**改动
（第 N 次变更改了哪些文件、行为怎么变、判据是什么）。**别在两处重复记同一件事。**

---

## 2. 硬约束（`--validate` 与 `test/ticket-ledger.test.ts` 同一套规则）

1. 文件夹名 `T-\d{4}` = `ticket.json.id`；`tickets/` 下不许有野文件夹；
2. 枚举合法；`title`/`area`/`why` 非空；
3. ★**没有判据的单不算单**：`acceptance` 非空；
4. ★**done 必须带真实存在的守卫**：`tests[]` 非空且文件存在（不许空口声称有测试）；
5. `dropped` 必须写 `droppedWhy`（不许静默关单）；
6. ★**证据锚点棘轮**：`file` 必须存在、`anchor` 必须能在文件里找到 ⇒ 否则**红**（代码被删/改名 ⇒ 回来核对）；
   给了 `line` 而 anchor 不在 ±40 行内 ⇒ 只 `⚠`；
7. `blockedBy`/`links.tickets` 不悬空、不成环；`history` 至少一条。

---

## 3. 动作流程

### 3.1 开单（发现问题的当下）
```bash
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --add '{
  "title":"…","type":"bug","priority":"P1","area":"emulator/adv",
  "why":"现象 + 复现步骤 + 影响面","acceptance":["怎么算做完（可核对）"],
  "evidence":[{"file":"src/SN0000.txt","anchor":"i090 49c 0 64 281","line":63,"note":"侧边栏热点"}]
}'
```
- `id` 不用写（自动 `--next-id`）；`type/status/priority` 缺省 = `req/open/P2`，`history` 自动加"创建"。
- **`acceptance` 必须想清楚再填**：它是"何时算做完"的唯一判据，也是以后 `done` 的凭据。
- `evidence` 至少给一条（bug 给现象证据，需求给动机依据）；**锚点选稳定串**（函数名/opcode 串/`kind: 'tick'`）。

### 3.2 调查 / 设计 / 变更记录（多文档、多次）
```bash
node …tickets.js --note T-0016 --file notes.md   --text "### 调查\n…"
node …tickets.js --note T-0016 --file changes.md --text "第 1 次变更：改了 A/B；判据：…；E4 截图 .tmp/x-6.png"
node …tickets.js --show T-0016    # 看 ticket.json + 该票所有过程文档清单
```
- 文件不存在会自动建立（带标题）；**同一个文件可以反复追加**（这就是"多次变更"）。
- 长调查写 `notes.md`，设计写 `design.md`，复现写 `repro.md`——名字自由，看板会列出来。

### 3.3 状态流转
```bash
node …tickets.js --set-status T-0016 doing   --note "开工"
node …tickets.js --set-status T-0016 blocked --note "等 T-0007（headless 输入源）"
node …tickets.js --set-status T-0016 done    --note "守卫 + E4 见 changes.md"
```
- `done` 之前**先**把 `tests[]` 填上（`--edit … --set-json 'tests=[…]'`），否则 `--validate` 会红。
- `blocked` 时把 `blockedBy` 填上（`--edit … --set-json 'blockedBy=["T-0007"]'`），`--graph` 才能画出依赖。

### 3.4 收尾（三连）
```bash
node scripts/build-tickets.mjs                                                  # 刷新看板（否则守卫红）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate           # 离线自检
cd app/amayui-emulator && npx tsx --test test/ticket-ledger.test.ts             # 守卫
```

### 3.5 查询（开工前先看）
```bash
node …tickets.js                     # 统计 + 待办（按 状态/优先级 排序）
node …tickets.js --list --open        # 只看未完成
node …tickets.js --stats              # 按状态/类型/优先级/域 分布
node …tickets.js --graph              # blockedBy 依赖树
node …tickets.js --show T-0002        # 单票（含 14 条工单那种清单）
node …tickets.js --list --area emulator/frame-loop
```

---

## 4. 这个技能不做的事（🚫）

- **不把台账/清单整表抄成票**：能力台账的 `absent/partial` 条目由台账自己管；只在"决定要做"时开票并回链。
- **不补历史票**：已经做完的事留在 `refactor-plan` §9 与台账 `notes` 里；票据只描述"现在到未来"。
- **不写进 `.tmp` 当证据**：`.tmp/` 是临时区（gitignore）。代理产出的分析报告要么落到票据的过程文档里，
  要么落到 `analysis/` / `docs-new/`，然后票据回链它。
- **不手改生成物** `tickets/README.md`（重跑 `build-tickets.mjs`）。
- **不做 git 提交**：只写文件。

## 5. ★多 agent 并行（subagent / workflow）纪律

**为什么单列一节**：本技能的真源是**跨 agent 的共享可变文件**，而它们之间还有一层隐式依赖 —— 台账里的
**锚点**（`tickets` 的 `evidence[].anchor`、`analysis/scripts.json` 的 `layout[].anchor`）要求**别人正在改的那些文件**里存在某个字面串。
并行时踩的坑几乎全落在这两处。
★**子代理会拿到与主 agent 相同的技能目录与 `skill` 工具**（实测：目录注入挂在 `dsh-tool-skill` 的 `agent/pre-step`，对每个 agent 各发一次；
子代理实测报告里列出了全部 8 个技能并真的加载了本技能）⇒ 纪律必须写在这里，不能指望父 agent 每次口头交代。

### 5.1 单写者原则（唯一硬规则）

| 文件 | 允许的写者 | 生成物？ | 守卫 |
|---|---|---|---|
| `tickets/*/ticket.json`、`tickets/*/*.md` | **一个** owner（默认 = 主 agent） | 否 | `test/ticket-ledger.test.ts` |
| `tickets/README.md` | **只有 owner** 在结算时跑 `node scripts/build-tickets.mjs` | 是 | 同上（"md 与数据层同步"一项） |
| `analysis/scripts.json` / `analysis/engine-capabilities.json` / `analysis/fields.json` / `analysis/functions.json` | 每个文件**一个** owner（不同文件可以不同 agent，同一文件只能一个） | 否 | `test/script-ledger.test.ts` / `test/capability-ledger.test.ts` |
| `docs-new/05-scripts/*.md`、`docs-new/03-engine/engine-capabilities.md` | 由对应台账的 owner 在**结算时** build | 是 | 同上 |
| `src/*.txt`、`app/**`、`docs-new/03-engine/*.md`（叙述层） | 实现/翻译 agent；**改了必须在报告里申报"动过被锚定的文件"** | 否 | 锚点棘轮（两个台账 + `test/ticket-ledger.test.ts`） |

子代理**默认对本技能的台账只读**；要它写台账，就把它在 prompt 里指定为该台账的**唯一 owner**，并且只给它这一份。

### 5.2 三种子代理 prompt 模板（照抄进 prompt，缺一不可）

1. **ANALYSIS-ONLY**（默认选它，最安全）
   - 允许：读仓库任意处；中间物只写 `.tmp/<job>/`。
   - 禁止：写 `analysis/`、`tickets/`、`docs-new/`、`app/`、`src/`、`scripts/`。
   - ★**必须带这一句**：*"即使你加载了 `amayui-*-analysis` / `amayui-ticket-ledger` 等技能，也**跳过**它们的「读完必须更新台账/文档」步骤 —— 本次是只读分析，结论用报告交回。"*
     （实测：不写这句，子代理会在"技能要求落库"与"分析只读"之间自行取舍，结果不可预期 —— 它加载了 `amayui-script-analysis` 后只能靠自觉跳过台账更新。）
2. **IMPLEMENTATION**：给**路径所有权清单**（可写白名单 + 明确禁写 `analysis/`、`tickets/`、`docs-new/`）+ **必须保留的字面串**（= 锚点，见 5.3）+ 退出判据（`npm run verify` 全绿 + 实测 E4）。
3. **LEDGER-OWNER**：整份台账独占；结算时自己 `build-*.mjs` + `--validate` + 对应守卫测试，并在报告里给**原始数字**。

### 5.3 锚点是跨 agent 的 ABI

锚点不是注释，是**契约**：它要求那个文件里**存在**那个字面串。改任何被锚定的文件（**源码注释与机制文档的表格行都算**）之前，先查谁锚在你这里：

```bash
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --anchors-in <文件>        # 哪些票据锚在这个文件
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --anchors-in <文件>      # 哪些脚本条目的 layout 锚在这里
```

处理规则（★**不许用"删证据 / 降 status / 删条目"来消红**）：
- 能保留 ⇒ 保留原串（重写注释时把旧串留在标题或引用里 —— 本会话就是这么保住 `②c ★**装载点不整批清绘制项**` 等 4 个串的）；
- 不能保留 ⇒ **在报告里申报**（"我删掉了 `<文件>` 里的字符串 `S`"），由 owner retarget 到同义新串；
- 见到红 ⇒ 先判类别再动手（5.4）。

### 5.4 `--validate` 红的分类处置

| 症状 | 真因 | 正确动作 |
|---|---|---|
| `evidence 锚点已消失` / `anchor 不在 lines 内` | 被锚文件被改（或被翻译 reflow / 换反编译版本） | retarget 到同义新串；**不要**删 evidence / 删条目 |
| `counts.<k> 应为 N`、`md 的统计行与数据层不一致` | **直接改过 JSON**（绕过工具）⇒ `counts` 陈旧、md 也旧 | `--recount`（见 5.5）后重跑 `build-*.mjs` |
| `--set` 写进去的值变成了数组 | 值里有 **ASCII 逗号**（`--set` 按逗号切分）—— 本会话踩过两次 | 改用 `--set-json '<json>'` |
| `guards 指向的测试不存在` | 测试被改名/删除 | 先补测试再写回 `guards` |

### 5.5 共享资源（并行时必须串行化）

- `npm run shot` / `npm run verify`：**同一时刻只跑一个** —— 前者抢 Electron 窗口并**覆盖同一个 `.tmp/amayui-emulator.log`**（日志本身是证据来源），后者 CPU 密集会互相拖慢。
- `.tmp/`：每个 job 一个子目录（`.tmp/<job>/`），别共用文件名；**证据要归档进 `tickets/<id>/evidence/`**（`.tmp/` 是 gitignore 的临时区，不许当证据落点）。
- 生成物（`tickets/README.md`、`docs-new/**/*.md` 生成物）：**只在结算时由 owner build 一次**；其他 agent 不跑 build（避免用陈旧输入覆盖别人的结果）。

> ★本节与另两个技能（`amayui-engine-analysis`、`amayui-script-analysis`）的同名节**同源**：改一处请三处同步（表头规则一致，只有"谁的台账"一段随技能不同）。

### 5.6 落在本技能上的一条推论

票据是**跨 agent 的协调面**：并行时最省事的做法是 **"主 agent 独占 `tickets/`，子代理只回报告"**（本会话就是这样：
两个分析子代理 + 一个实现子代理，`tickets/` 从头到尾只有我一个人写）。
只有当一张票据的工作**整体**交给一个子代理时才把 `tickets/` 给它，并在 prompt 里写清"你是这批票的唯一 owner"。
