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
  "history":[{"at":"2026-09-14","kind":"created","what":"创建"}]   // kind ∈ created|status|scope|decision；无 --note 不追加
}
```

**`history[]` vs `changes.md` vs `journal.jsonl`**：`history` 记**状态/范围级**事件（工具写，**没有 `--note` 就不记**）；
`changes.md` 记**实现级**改动（第 N 次变更改了哪些文件、行为怎么变、判据是什么）；`analysis/journal.jsonl` 记**会话级**沿革
（本轮几条线、方法论教训、跨票因果）。**沿革只有这三处，别在别处复述。**
★`ticket.json` 的 **`notes` 字段已废除**（2026-09）：长文一律写 `notes.md`。

---

## 2. 硬约束（`--validate` 与 `test/ticket-ledger.test.ts` 同一套规则）

1. 文件夹名 `T-\d{4}` = `ticket.json.id`；`tickets/` 下不许有野文件夹；
2. 枚举合法；`title`/`area`/`why` 非空；
3. ★**没有判据的单不算单**：`acceptance` 非空；
4. ★**done 必须带真实存在的守卫**：`tests[]` 非空且**用例**存在 —— 规格 `app/…/test/x.test.ts` 或
   **`…#<用例名片段>`**（`tickets/T-0130` 起；`#` 后字面串必须出现在该文件里）。文档/分析票可改用 `doneWhy`；
5. `dropped` 必须写 `droppedWhy`（不许静默关单）；
6. ★**证据锚点棘轮**：`file` 必须存在、`anchor` 必须能在文件里找到 ⇒ 否则**红**（代码被删/改名 ⇒ 回来核对）；
   给了 `line` 而 anchor 不在 ±40 行内 ⇒ 只 `⚠`；
7. `blockedBy`/`links.tickets` 不悬空、不成环；`history` 至少一条。

★**跨子工程的通行纪律**（踩过的坑）在 `docs-new/00-overview/lessons.md` —— 与本技能最相关的是
**#17 锚点是跨 agent 的 ABI**、**#20 派子代理的三件套**、**#22 台账/票面写入口只认"恰好一条"**（动手改票前扫一遍）。

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
- ★**结构化字段（`tests`/`evidence`/`acceptance`）走计划文件**，别在命令行拼 JSON：
  ```bash
  node …tickets.js --edit-plan .tmp/t0176-plan.json     # {id, sets:[[点路径,值]], status?, note?}
  ```
  `--edit-plan` 是**免 shell 转义**的批量改单（历史上靠 `.tmp/settle/tickets-edit.mjs` 包装器，现已收进工具本体）；
  它是**两阶段**的：若计划里的 `status=done` 过不了前置校验，`sets` 也**一条都不落盘**（不留半成品）。

### 3.2 调查 / 设计 / 变更记录（多文档、多次）
```bash
node …tickets.js --note T-0016 --file notes.md   --text "### 调查\n…"
node …tickets.js --note T-0016 --file changes.md --text "第 1 次变更：改了 A/B；判据：…；E4 截图 .tmp/x-6.png"
node …tickets.js --show T-0016    # 看 ticket.json + 该票所有过程文档清单
```
- 文件不存在会自动建立（带标题）；**同一个文件可以反复追加**（这就是"多次变更"）。
- 长调查写 `notes.md`，设计写 `design.md`，复现写 `repro.md`——名字自由，看板会列出来。
- ★**PowerShell 传长文本的坑（实测踩过三次，2026-09）**：在 PowerShell 里给 `--text`/`--note` 用
  **双引号字符串**会把反引号当转义符、`\"` 当字符串结束 ⇒ 写进票据的正文会被**吃掉反引号、甚至截断**
  （症状：`\textureCache.ts` 里的 `\t` 变成制表符、正文停在某个词）。**长文本（含 `` ` ``、`$`、`"`）请改用编辑工具直接写 `notes.md`/`changes.md`**，
  或先用 `write` 落一个临时 `.mjs` 再执行；命令行只传**短且无特殊字符**的 `--note`。

### 3.3 状态流转
```bash
node …tickets.js --set-status T-0016 doing   --note "开工"
node …tickets.js --set-status T-0016 blocked --note "等 T-0007（headless 输入源）"
node …tickets.js --set-status T-0016 done    --note "守卫 + E4 见 changes.md"
```
- `done` 之前**先**把 `tests[]` 填上（`--edit … --set-json 'tests=[…]'` 或 `--edit-plan`），否则 `--validate` 会红。
  ★**写入口有前置校验**（2026-09 起）：`--set-status … done` 会在**写盘前**核对"`tests[]` 存在且守卫**用例**真实存在，或 `doneWhy` 非空"，
  不满足就**拒绝并保持原状态**（exit 2）—— 状态流转不可逆，不该等事后 `--validate` 才发现。
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

### 3.6 证据行号维保（`fix-evidence-lines.js`）

`evidence[].anchor` 是 ABI，`line` 只是**缓存**：代码重构 / 换反编译版本 / 翻译 reflow 后行号会整片漂移。
```bash
node .agents/skills/amayui-ticket-ledger/scripts/fix-evidence-lines.js            # dry-run：只报要改哪些
node …fix-evidence-lines.js --any                                                 # 范围扩到全部被锚文件（缺省只修 analysis/）
node …fix-evidence-lines.js --write                                               # 真的写回
node …fix-evidence-lines.js --any --check                                         # 收尾闸门：有漂移/失效锚点 ⇒ exit 1
node …fix-evidence-lines.js --any --pick T-0168:3=478 --write                     # ★多命中且无旧行号时，显式指定取哪一行
```
- ★**它只改 `line`，绝不改 `anchor`**：串真的没了 ⇒ **只报告**（retarget 是人判的事，见 §5.3）；也**不删** `evidence`。
- ★**取行规则分两类**（"猜"与"不猜"的界线）：
  - **有旧 `line`（漂移）** ⇒ 多命中时优先 `"id": "<anchor>"` 的定义行，否则取**离旧行号最近**的一次（有旧行号当基准，这是有依据的）；
  - **没有旧 `line`（补全）** ⇒ **唯一命中**才自动补；**多命中一律不猜**，列成「待人选」（每条候选行 + 所属小节），
    要填就用 `--pick <T-xxxx>:<evidence 下标>=<行号>` 显式指定。
    ★为什么不能猜：同一条锚点串可能落在**语义不同的两处** —— 实测审计报告 §4.1 的 finding 表与 §4.6 的
    「被复核**订正**的条目」表里各有一份同样的句子，指称并不相同（一个按 finding 编号、一个按批次名）。
    留空**无害**：守卫只认"锚点在不在文件里"，`line` 只是 ±40 的提示。
- 多命中的取法是**确定**的：优先 `"id": "<anchor>"` 的定义行，否则取离原行号最近的一次（会打印理由）。
- ★`--pick` 指到**不含锚点**的行、或 `--pick` 没被用上（下标/票号写错）⇒ **响亮失败**（exit 1），不许静默咽下。
- ★`--check` 的判据只有**真漂移**与**失效锚点**；"历史证据本来就没写 `line`"算**补全**、不算失败
  （否则这个闸门在"早期证据没记行号"的库上永远是红的，就没人看了）。

---

### 3.7 ★「已关闭但有条件缺口」的单：重开条件写在哪、怎么被发现

**背景（2026-09-26 用户提问）**：「你提到 `T-0091` 的重开条件，但是这个要如何发现？目前这个单是已经关掉了的」。
诚实答案 = **靠人记**；这一节就是把"靠人记"改成"有落脚点 + 有查法"。

**写在哪（开/关单时）**：

- `done` **不等于**没有缺口：允许「判据已建模 + 已加守卫 + 缺口已登记」这种收口（`T-0091` ② 就是）。
  但这种 `done` **必须**在 `why` 或 `acceptance` 里用固定措辞写明 **`重开条件：① … ② …`**（条件要**可判定**：出现什么语料/什么日志/什么宿主能力）。
- 缺口的事实本体仍然只写在一个地方：**引擎层缺口 → 第二层 capability 的 `note`**（`T-0091` ② 的落点在 `clock-read-transition-window`）；
  票侧**只回链**（`links.analysis` + `links.tickets`），不要抄一遍（分层不许互相复制）。
- ★**动机**：重开条件写在 capability 的散文里，机器不读 ⇒ `--validate`/`--list`/看板全都不会现出来。
  实测基线（T-0186 evidence）：145 条 capability 里 **16 条**带「重开条件」（partial 9 / modeled-verified 4 / n/a-known 3），
  而 **181 张票里 0 张**带它 —— 所以 `T-0091` 这种"已 done 却带条件缺口"的单在票层是**隐形的**。

**怎么发现（今天可用的三条）**：

```bash
# ① 缺口视图（第二层侧的真源）：哪些 capability 是 partial/absent、它们的重开条件是什么
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --list --status partial
node .agents/skills/amayui-engine-analysis/scripts/gaps.js --stale      # 自述"已实现/不适用"的缺口条目兜底
# ② 票侧搜措辞（固定措辞就是为了能 grep）
grep -rl '重开条件' tickets/*/ticket.json
# ③ 回链反查：哪些票挂在这条 capability 上（谁是它的 owner）
grep -l 'engine-capabilities.json' tickets/*/ticket.json
```

- ★**只查 `partial|absent` 会漏**：`clock-read-transition-window` 的 status 是 `modeled-verified`（主体确实建模 + E3 守卫），
  缺口在 `note` 的子项里 ⇒ 查重开条件**必须查 note 文本**，不能只看 status 字段。
- 条件的"机械版"（出现即自动亮灯）优先做成**守卫测试**（语料静态棘轮）或**日志检查**（运行期），
  而不是靠人定期回看散文 —— 这正是 `tickets/T-0186` 要做的事（样本 = `T-0091` ② 的 `[4]` 越界/后台缓冲分支）。

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
   - ★**验收项「实现即删条目」**：子代理**无权**写 `analysis/`，所以它必须在报告里逐条列出"本轮实现/推翻后应当**删掉或改写**的 `missing[]`"，格式 = `opcode` + `raw` 键 + 一句 why（`raw` 是唯一定位键；先 `gaps.js --missing <opcode>` 取它）。
     这条是拿事故换来的：已 **3 次**出现"实现了却漏删对应 `missing`"（第 52/64/69 轮），主 agent 每次手工补删。
     ⇒ **交付物不是"能实现"，而是"实现 + 条目已消"**；owner 结算前跑 `gaps.js --stale` 兜底核验（它把 `what` 自述「已实现/不适用」的条目列出来）。
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
| `counts.<k> 应为 N`、`md 的统计行与数据层不一致` | **直接改过 JSON**（绕过工具）⇒ `counts` 陈旧、md 也旧 | 按台账跑它的**唯一口径**：`capabilities.js --recount` / `scripts.js --recount` / `gaps.js --recount`（缺口台账）/ `node scripts/build-tickets.mjs`（票据看板）⇒ 再重跑 `build-*.mjs` |
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
