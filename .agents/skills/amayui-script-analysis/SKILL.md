---
name: amayui-script-analysis
description: 游戏脚本（src/*.txt）分析流程与纪律：分析某个脚本前**先读文档**（docs-new/05-scripts/<ID>.md 脚本台账页、docs-new/03-engine/* 指令/子系统机制、docs-new/02-data/* 数据表、docs-new/00-overview/{authority,conventions}.md 权威判定、analysis/scripts.json 真源、output/callgraph.json 调用关系），再读脚本正文；分析后**必须同步更新文档**（分析结论落 analysis/scripts.json → node scripts/build-scripts.mjs 重生成 docs-new/05-scripts/ → scripts.js --validate → test/script-ledger.test.ts；引擎层结论分别落 functions/fields.json 与 engine-capabilities.json 并回链；跨脚本叙述落 docs-new/03-engine/*.md）。用 scripts/brief.js 一键打印"开工前一页纸"（台账条目 + 文档落点 + 真源骨架 + 调用关系 + 收尾命令）。当用户要求分析/读懂某个 src/*.txt 脚本、查某个界面流程或演出脚本怎么跑、定位某个脚本里的分支与槽、登记或更新脚本台账页、或在改脚本/翻译重排后刷新台账行号时使用。
---

# amayui-script-analysis —— 游戏脚本（`src/*.txt`）分析流程：**先读文档 → 再读脚本 → 落台账 → 同步文档**

> 定位：读懂《天結いキャッスルマイスター》的 **941 个游戏脚本**（`src/*.txt`：反汇编 + 汉化正文），
> 把结论沉淀到**数据层·第三层** `analysis/scripts.json`（渲染物 = `docs-new/05-scripts/*.md`）。
>
> 本技能与 `amayui-engine-analysis` 是**同一套数据层的两个入口**：那一半管「引擎是什么 / 引擎一直在做什么」（第一、二层），
> 这一半管「**这个脚本长什么样、怎么跑通**」（第三层）。第三层的**工具**不另起一份（避免两份漂移），
> 仍用 `.agents/skills/amayui-engine-analysis/scripts/scripts.js`；本技能的独有产物是**流程纪律**与
> `scripts/brief.js`（开工前一页纸）。
>
> **两条不可省的动作**：
> 1. ★**先读文档**（`§1`）—— 不读就动手，等于把已经写下来的结论重推一遍；
> 2. ★**读完必须同步更新文档**（`§2`）—— 不同步，下次（包括三天后的自己）还得重读一遍。

---

## 0. 为什么有这个技能（真实教训，不是假想）

**案例**：用户报「点『ゲーム開始』时音效不对」。
我的实际动作是：`read src/GAMESTART.txt`（1360 行）→ `read src/SN0000.txt` → 翻反编译找 `0xB4` handler →
写测试 → 改 emulator 的派发逻辑。

而事实上：

| 我需要的结论 | 文档里**早就写着** |
|---|---|
| 点击派发走 `local 3f4`，1 = ゲーム開始 ⇒ `label_000050b8` | `docs-new/05-scripts/GAMESTART.md:19-20`（台账的 layout 段） |
| 「ゲーム開始」分支的完整动作（含它发哪个 SE） | `docs-new/05-scripts/GAMESTART.md:21`（`1327-1348` 段） |
| `local 3f4` 是**同帧内**由鼠标回调写的（帧局部池不能丢） | `docs-new/05-scripts/GAMESTART.md:41`（**坑**） |
| 三个按钮中心坐标 = (811,605)/(1027,605)/(1197,605) | `docs-new/05-scripts/GAMESTART.md:36`（**不变量**） |
| `play-sound-effect` 的 op1 是**统一文件 id**、不是文件名 | `docs-new/03-engine/sound-system.md` |

**重读成本 100% 来自"没先读文档"。** 这个技能就是把这个动作固化下来 —— 一张开工前清单 + 一条命令 + 一张同步矩阵。

---

## 1. ★纪律一：先读文档，再读脚本

### 1.1 一键：开工前一页纸

```bash
node .agents/skills/amayui-script-analysis/scripts/brief.js <ID|文件名|bin 名>
node .agents/skills/amayui-script-analysis/scripts/brief.js '$1$SC0330'   # 带包前缀的脚本
node .agents/skills/amayui-script-analysis/scripts/brief.js --list        # 已登记索引
```

它**只读不写**，四块输出（就是要按这个顺序看）：

| 块 | 内容 | 拿到它之后该干什么 |
|---|---|---|
| ① 台账条目 | `role` / `entry` / `layout`（行区间+锚点+职责）/ `slots` / `invariants` / `gotchas` / `gaps` / `links` / `guards` / **`notes` 里的"未读"** | `notes` 写的未读部分**就是**这次要补的范围；`layout` 已覆盖的段落**跳过去，别重读** |
| ② 文档落点 | 本脚本专页在不在 + **还有哪些 md 提到过它** + 该先读的引擎主题文档清单 | 打开 `docs-new/05-scripts/<ID>.md`；提到它的主题文档按需读 |
| ③ 真源骨架 | 行数 / label 清单 / 助记符直方图 / `call-script` 出口（带注释里的目标脚本名）/ **音频行** | 决定"从哪一段开始读"，而不是从第 1 行读 |
| ④ 调用关系 | 谁 call 它、它 call 谁（`output/callgraph.json`） | 填/校验 `entry` 字段 |

未登记脚本时它以退出码 1 结束，并直接给出 `--add` 骨架命令（不必手打 JSON）。

### 1.2 必读清单（不跑命令时按此顺序）

| # | 读什么 | 回答什么 | 不读会怎样 |
|---|---|---|---|
| 1 | `docs-new/05-scripts/README.md` | 这个脚本登记过没有、状态、守卫、覆盖率分母（941） | 不知道"是否已经有人读过" |
| 2 | ★`docs-new/05-scripts/<ID>.md` | 该脚本的入口/结构/槽/不变量/坑/缺口（**带行区间 + 锚点**） | 把已写下的结论重推一遍（§0 的教训） |
| 3 | `analysis/scripts.json`（`scripts.js --id <ID>`） | 真源（md 只是它的渲染物）；`notes` = 未读清单 | 把 md 当真相去手改（禁止），或漏掉 `--edit` 的正确入口 |
| 4 | `docs-new/03-engine/opcode-table.md` + 相关子系统 md | 脚本里每条指令的语义 | 为一条指令再读一遍 18 万行反编译 |
| 5 | `docs-new/02-data/*.md` | 脚本引用的业务数据表（掉落/技能/地图/单位/存档/控制流） | 把业务数据地址当成引擎内部结构 |
| 6 | `output/callgraph.json`（`node scripts/build-callgraph.mjs`） | 「谁 call 它 / 它 call 谁」= `entry` 的证据 | `entry` 只能靠猜 |
| 7 | `docs-new/00-overview/{authority,conventions}.md` | 权威判定（`src/*.txt` 是翻译唯一权威）+ 三层数据分层纪律 | 把结论写进错的层 |
| 8 | `docs-new/04-app/*`（结论要落到 emulator 时） | 重写侧现状/重构计划/未决项 | 重复劳动，或与既有约定冲突 |

### 1.3 该读哪篇引擎主题文档（`docs-new/03-engine/`）

| 脚本里出现的东西 | 去读 |
|---|---|
| 任意指令助记符 | `analysis/opcodes.json`（真源） / `opcode-table.md`（生成物） |
| 操作数形态（`(local-ptr 3)` / `(global-int …)` / `lookup-array`） | `operands.md`、`flow-control.md` |
| `i12e` / `i0cd` / `i308` / 鼠标键盘回调 / 悬停 | `input-system.md` |
| `show-text` / `i070` / `i071` / `i073` / `i300` / `i301` / 逐字显现 | `adv-text-rendering.md`、`message-config-gates.md` |
| `play-sound-effect` / `i0b5` / `play-bgm` / `play-voice` | `sound-system.md`（统一文件 id 口径在这里） |
| 场景切换 / 黑幕 / `detach-texture` / 资源生命周期 | `scene-start-flow.md`、`resource-loading.md`、`runtime-memory.md` |
| `draw-texture` / 图元 / 纹理槽 | `rendering.md` |
| 存档 / 设置回写（`load-int`/`save-*`） | `save-data.md`、`gallery-and-unlock-flags.md` |
| 版权页 / AGERC | `copyright-effect.md`、`agerc-*.md` |
| **"引擎一直在做什么"**（不是某条指令） | `engine-capabilities.md`（第二层渲染物） |

### 1.4 禁止的姿势

- ❌ **直接 `read src/XXX.txt` 从头读** —— 已登记脚本会被重读；未登记脚本会漏掉"它是否已在主题文档里被描述过"。
- ❌ **只读 `src/*.txt` 就下引擎层结论** —— 引擎层结论属于第一/二层，脚本层只**回链**（`links`）。
- ❌ **结论只写在回答里 / 只写在代码注释里** —— 必须落台账 + 同步文档（`§2`）。写在聊天里 = 下次归零。
- ❌ **手改 `docs-new/05-scripts/*.md`** —— 生成物（`build-scripts.mjs` 会覆盖你）。
- ❌ **用 emulator 当脚本行为的依据** —— 方向是「脚本/引擎分析 → emulator」。emulator 只能当**验证手段**（`guards`）与**症状来源**，不能当"脚本应该是这样"的判据。

---

## 2. ★纪律二：分析完必须同步更新文档

> **不落库 = 没分析。** 台账的锚点棘轮 + md 同步守卫就是为这件事设计的：
> 数据层改了不重生成 md，`test/script-ledger.test.ts` 会红；`src/*.txt` 重排了不更新 `lines`，也会红。

### 2.1 同步矩阵（"我发现了什么" → "写进哪" → "跑什么"）

| 你发现的 | 写进（唯一增长处） | 必须跑 |
|---|---|---|
| 脚本结构：新段落 / 行号变了 | `analysis/scripts.json` → 该条的 `layout`（`{lines, anchor, what}`） | 收尾三连（§2.2） |
| 关键槽 / 局部量 / 全局的含义 | 同条 `slots` | 收尾三连 |
| 可以拿来做回归断言的事实 | 同条 `invariants` | 收尾三连（并尽量把它写成测试） |
| 踩过的坑（"看起来对其实错"） | 同条 `gotchas` | 收尾三连 |
| 已知缺口 / 未读范围 | 同条 `gaps` 或 `notes`（**二者至少一个说话**） | 收尾三连 |
| 首次分析一个新脚本 | `scripts.js --add '<整条 json>'`，`status` 先 `partial`/`stub` | 收尾三连 |
| 覆盖该脚本的测试 | 同条 `guards`（真实存在的测试文件，相对 `app/amayui-emulator`） | 收尾三连 |
| **某个 `sub_XXXXXX` / 偏移是什么** | 第一层 `analysis/functions.json` / `fields.json`（`report.js --func-add/--func-edit`、`--field-*`） | 无渲染物；收尾跑一次 opcode/registry 相关测试 |
| **引擎的持续行为**（每帧步骤 / 门控标志 / 惰性创建 / 转场 / 资源生命周期） | 第二层 `capabilities.js --add/--edit` | `node scripts/build-capabilities.mjs` → `capabilities.js --validate` → `test/capability-ledger.test.ts` |
| **跨脚本的机制叙述**（子系统整体机制、opcode 语义表） | 主题文档 `docs-new/03-engine/*.md`（第三层只 `links.docs` 回链，**不抄**） | 相关守卫测试（如 opcode-table 系列） |
| 翻译/改文案导致 `src/*.txt` 行号漂移（`amayui-script-translate` / `amayui-script-update` 动过这个文件） | 该条 `layout[].lines` 全部刷新 | 收尾三连（锚点棘轮会先红给你看） |
| emulator 实现状态变了（该脚本相关） | `docs-new/04-app/emulator-refactor-plan.md` 的变更记录节（新条目放最上方） | `cd app/amayui-emulator && npm run verify` |

**分层不许互相复制**（`docs-new/00-overview/authority.md` §2 的硬性规则）：

| 结论 | 只写在哪 |
|---|---|
| 某个函数/偏移是什么 | 第一层 |
| 引擎持续行为 | 第二层 |
| **某个脚本**的结构/槽/不变量/坑/缺口 | 第三层（本技能） |
| 跨脚本叙述 / opcode 语义表 | 主题文档（`03-engine/*.md`）—— 第三层只回链 |

### 2.2 收尾三连（改完台账**必跑**，一条都不能少）

```bash
node scripts/build-scripts.mjs                                              # 重生成 docs-new/05-scripts/（README + <ID>.md；勿手改）
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --validate     # 离线自检：锚点棘轮 / guards / links / schema
cd app/amayui-emulator && npx tsx --test test/script-ledger.test.ts          # 守卫（含"md 与数据层同步"一项）
```

（`brief.js` 末尾会把这三条原样再打一遍，不必记。）

### 2.3 生成物 vs 真源

| 文件 | 性质 |
|---|---|
| `analysis/scripts.json` | **真源**（唯一增长处；用 `scripts.js --add/--edit/--rm` 改） |
| `docs-new/05-scripts/README.md`、`docs-new/05-scripts/<ID>.md` | **生成物**（`node scripts/build-scripts.mjs`；勿手改） |
| `docs-new/03-engine/engine-capabilities.md` | **生成物**（`node scripts/build-capabilities.mjs`；勿手改） |
| `docs-new/03-engine/*.md`（其余）、`docs-new/02-data/*.md` | 叙述层（可写；但引擎层**事实**要能在第一/二层查到） |

---

## 3. 第三层台账：schema 与硬约束

**一条一条长这样**（真源 `analysis/scripts.json`；`scripts.js --id <ID>` 或 `brief.js <ID>` 看渲染后的样子）：

```jsonc
{
  "id": "GAMESTART",                       // 短名 = md 文件名，唯一
  "file": "src/GAMESTART.txt",             // 真源（守卫校验存在）
  "bin": "GAMESTART.BIN",                  // 运行期名字（统一文件 id 空间里的那个）
  "role": "这个脚本是什么（一句话）",
  "entry": "谁调它 / 怎么进怎么出",
  "layout":   [ { "anchor": "……", "lines": "1327-1348", "what": "……" } ],  // ★读过哪些段
  "slots":    [ { "key": "local-int 3f4", "what": "退出原因：1 = ゲーム開始" } ],
  "invariants": ["选了「ゲーム開始」⇒ 退出前必然先 call-script INITGAME 与 SETFATE"],
  "gotchas":    ["local 3f4 是同帧内由鼠标回调写的 ⇒ 帧局部池不能在回调里被清"],
  "gaps":       ["配置项的读写路径未逐段读"],
  "links": { "capabilities": ["scene-pending-flag-0x400-gate"], "functions": ["0x42F230"], "docs": ["docs-new/03-engine/scene-start-flow.md"] },
  "guards": ["test/game-start-chain.test.ts"],
  "status": "partial",                     // analyzed | partial | stub
  "evidence": "src/GAMESTART.txt:32-40/64-68/…；运行期断言见 test/game-start-chain.test.ts",
  "notes": "未读：配置界面每一行控件（i12e 之外的设置项）"
}
```

| status | 判据 |
|---|---|
| `analyzed` | 结构 + 关键路径都读过并落库（未读部分写在 `notes`） |
| `partial` | 只读了用到的部分（`layout` 里列出的**就是**读过的范围） |
| `stub` | 只登记「它是谁 / 谁调它」，正文未读 |

**四条硬约束**（`test/script-ledger.test.ts` 强制、`scripts.js --validate` 可离线自检）：

1. ★**锚点棘轮**：每条 `layout[].anchor` 必须**真的出现在它声明的 `lines` 区间内**（锚点 ≥6 字符：label 名、`i12e …`、`show-text 0 @"…"` 这类真源里存在的串）。
   —— 既防"凭印象编造结构"，也让 `src/*.txt` 一旦被**翻译 reflow / 反汇编重排**必然变红，逼人刷新行号（**这是刻意的**）。
2. `guards[]` 指向的测试**用例**真实存在（规格 `test/x.test.ts` 或 `#<用例名片段>`，见 `tickets/T-0130`）；
   `links.capabilities[]` 是第二层真有的 id；`links.functions[]` 是第一层真有的 addr。
3. 一个脚本只登记**一条**（`file` 不重复）；`status` 与 `layout` 的规模相称（没读过就别写 `analyzed`）。
4. `gaps` 或 `notes` 至少有一个说话 —— **不许用沉默掩盖缺口**（与第二层 `n/a-known` 必须写 `why:` 是同一条纪律）。

> **覆盖率不是 KPI**：分母是磁盘上真实的 941 个 `src/*.txt`。**没读过的不登记**（宁可空着）；读一半写 `partial` 且只列真读过的区间。
> `scripts.js --coverage` 只是提醒还有哪些没看。

---

## 4. 分析流程（可照抄的动作序）

0. **定位**：`brief.js <ID>`。没条目就先 `scripts.js --add` 一个 `partial`/`stub` 骨架（`role`/`entry` 各写一句话，**别留空**）。
1. **读文档**（§1.2 的 1→3 项）：先 `docs-new/05-scripts/<ID>.md`，再看 `notes` 里的"未读"清单 —— 那就是本次范围。
2. **定范围**：看 `brief.js` 的 ③ 真源骨架（label 清单 / `call-script` 出口 / 音频行）决定**只读哪几段**；`layout` 里已列的段直接跳过。
3. **读脚本**：按 label 区间读，**边读边记** `layout`（行区间 + 锚点 + 一句话职责）。锚点写**真源里真有的串**，行区间写**实际看过的**。
4. **查指令语义**：遇到不认识的助记符 → `docs-new/03-engine/opcode-table.md`；还不够 → 反编译 `engine/天结_unpacked.exe_utf8.c`（带上 raw 行号写进 `evidence`）。
5. **找入口/出口**：`output/callgraph.json` + 脚本里的 `call-script <hex>`（**注释里常写着目标脚本名**）⇒ 填 `entry`。
6. **提炼**：`slots`（槽号 → 含义）、`invariants`（可做回归断言）、`gotchas`（踩过的坑）、`gaps`（未读/缺口）。
7. **回链**：引擎层结论去第一/二层落库，再在 `links` 回链 id/addr；主题文档只 `links.docs` 引用。
8. **写守卫**：能在 emulator 里断言的（快照/不变量/顺序）就写成测试，填进 `guards`。查不到就留空，**不许假称**。
9. **收尾三连**（§2.2）。红了就按失败信息改 —— 锚点棘轮红 = 行号该刷新了，不是测试坏了。

**需要看指令裸编码 / 重新汇编时**：

```bash
node scripts/asm/cli.js -e sjis -d src/XXX.txt      # 反汇编（Node 版 age-asm，跨平台）
node scripts/asm/cli.js -e sjis -a src/XXX.txt      # 重汇编（改脚本后校验）
```

---

## 5. 工具一览

| 工具 | 作用 | 备注 |
|---|---|---|
| `.agents/skills/amayui-script-analysis/scripts/brief.js` | **本技能独有**：开工前一页纸（台账 + 文档落点 + 真源骨架 + 调用关系 + 收尾命令） | 只读；未登记时退出码 1 并给 `--add` 命令 |
| `.agents/skills/amayui-engine-analysis/scripts/scripts.js` | 第三层台账：查询 + 增删改 + 自检（`--summary/--index/--coverage/--find/--id/--validate`、`--add/--edit/--rm`、`--recount`） | **不另起一份**，避免两份漂移 |
| `.agents/skills/amayui-engine-analysis/scripts/ledger.js` | 条目级手术（`layout`/`slots` 整段替换、按计划文件做 `set/add/unset/mutate`）；★默认 dry-run，`--write` 才落盘 | 结构化数组/多条一起改时**优于** `--set`；改 `counts` 会被拒 |
| `.agents/skills/amayui-engine-analysis/scripts/gaps.js` | 缺口台账全文/明细（`--show` / `--missing` / `--stale` / `--recount`） | 脚本里遇到的"未实现/近似"最终落在缺口台账，用它取全文 |
| `scripts/build-scripts.mjs` | 把台账渲染成 `docs-new/05-scripts/` | 仓库根；生成物勿手改 |
| `scripts/build-callgraph.mjs` | 重建 `output/callgraph.json`（谁 call 谁） | `entry` 的证据来源 |
| `scripts/asm/cli.js` | 反汇编 / 重汇编（`-d` / `-a`，`-e sjis`） | 指令集 = `scripts/asm/opcodes.json` |
| `scripts/reflow-apply.js` 等 | 翻译 reflow（**会移动行号** ⇒ 台账 `lines` 要刷新） | 见 `amayui-script-translate` / `amayui-script-update` |
| `app/amayui-emulator/` 的 `npm run verify` / `npm run shot` / `npm run op:inventory -- --path start` / `npm run diag:text` | 运行期验证（E3 场景级断言 / E4 截图对照） | 只作**验证**，不作脚本行为的判据 |

`scripts.js --set` 的坑：`layout`/`slots` 是**结构化数组**，别用 `--set` 硬塞（值里的 ASCII 逗号会被当分隔符、引号会破坏 JSON）。
整段结构改用 `--add '<整条 json>'`，或直接编辑 `analysis/scripts.json`（改完 `--validate` 把关）。

---

## 6. 与 `amayui-engine-analysis` 的分工（别重复劳动）

| 问题 | 归属 | 技能 |
|---|---|---|
| 这个 `sub_XXXXXX` / 偏移是什么 | 第一层 `functions.json` + `fields.json` | `amayui-engine-analysis` |
| 引擎有哪些**持续行为**（逐帧/门控/惰性创建/转场/资源生命周期） | 第二层 `engine-capabilities.json` | `amayui-engine-analysis` |
| **这个脚本**长什么样、怎么跑通 | 第三层 `analysis/scripts.json` | **本技能**（流程与纪律）+ 共用 `scripts.js` |
| 跨脚本的机制叙述 / opcode 语义表 | 主题文档 `docs-new/03-engine/*.md` | 两者都只**回链** |

**两处刻意的差异**：

- 引擎分析**禁止读取 emulator**（它是产物，方向必须是"分析 → emulator"）；
  **脚本分析可以**把 emulator 当**验证手段**（`guards` 必须落在 emulator 的测试里）与**症状来源**，
  但"脚本应该是什么行为"仍然只能由 `src/*.txt` + 引擎主题文档决定。
- 引擎分析的锚点是**反编译 raw 行号**；脚本分析的锚点是 **`src/*.txt` 行号 + 区间内必须出现的真源串** ——
  前者只在换反编译版本时才漂，后者**每次翻译 reflow 都会漂**，所以要习惯"翻译后先跑 `--validate`"。

---

## 7. 常见坑（都是真踩过的）

1. ★**没先读 `docs-new/05-scripts/<ID>.md` 就翻脚本** —— §0 的原始教训；台账里 `layout`/`gotchas` 已经回答了大部分问题。
2. **把生成的 md 当真相手改** —— 下一跑 `build-scripts.mjs` 就没了；要改的是 `analysis/scripts.json`。
3. **`layout` 行区间写成整个文件** —— 守卫按锚点核对，且这等于谎报"都读过了"；只写实际看过的范围。
4. **锚点用"我总结的话"** —— 必须能在真源里 `grep` 到；否则守卫红，且锚点棘轮失去意义。
5. **引擎层结论塞进脚本条目** —— 换一个脚本就不成立的东西才属于脚本层；引擎层的去第一/二层再回链。
6. **翻译/reflow 之后忘了刷新 `lines`** —— 守卫会红（刻意的）；这是提醒，不是故障。
7. **`status` 虚高** —— 只读了一段就写 `analyzed`；守卫按 `layout` 规模看不住的部分靠自觉，纪律是"宁低不高"。
8. **`gaps`/`notes` 留空** —— 等于用沉默掩盖缺口（第二层同款纪律：`n/a-known` 必须写 `why:`）。
9. **假称有守卫** —— `guards` 里的文件必须真实存在，否则守卫测试直接红。
10. **改了 `src/*.txt` 却不跑 `assemble`/守卫** —— 脚本层改动会影响 emulator 与台账两侧，先 `npm run verify`。

---

## 8. 硬性约定

- **先文档后脚本**：任何脚本分析的第一条命令是 `brief.js <ID>`（或至少 `scripts.js --id <ID>` + 打开 `<ID>.md`）。
- **结论只在一处增长**：脚本层结论 → `analysis/scripts.json`；引擎层 → 第一/二层；叙述 → `03-engine/*.md`。**不许互相复制**。
- **生成物勿手改**：`docs-new/05-scripts/*.md`、`docs-new/03-engine/engine-capabilities.md`。
- **锚点必须经得起核对**，行区间只写实际读过的范围；`src/*.txt` 重排后**先跑 `--validate`** 再继续分析。
- **覆盖率不是 KPI**：没读过的不登记；读一半写 `partial`。
- **不许沉默掩盖缺口**：`gaps` 或 `notes` 必须说话。
- **守卫不许空口声称**：`guards` 指向真实测试文件。
- **`src/*.txt` 是翻译唯一权威**（`docs-new/00-overview/authority.md` §1）；`data/*.txt` 是只读日文基线。
- **`docs-new/` 内部自包含**：只做 `docs-new/` 内的相对链接，不引用旧 `docs/` 或子工程 `docs/`。
- **业务数据 ≠ 引擎内部**：业务数据地址是业务域常量，除非有实测 + 脚本语义互证，不把它当引擎内部数组。
- **不做 git 提交**：只写文件，提交由人来做。

## 9. ★多 agent 并行（subagent / workflow）纪律

**为什么单列一节**：本技能的真源是**跨 agent 的共享可变文件**，而它们之间还有一层隐式依赖 —— 台账里的
**锚点**（`tickets` 的 `evidence[].anchor`、`analysis/scripts.json` 的 `layout[].anchor`）要求**别人正在改的那些文件**里存在某个字面串。
并行时踩的坑几乎全落在这两处。
★**子代理会拿到与主 agent 相同的技能目录与 `skill` 工具**（实测：目录注入挂在 `dsh-tool-skill` 的 `agent/pre-step`，对每个 agent 各发一次；
子代理实测报告里列出了全部 8 个技能并真的加载了本技能）⇒ 纪律必须写在这里，不能指望父 agent 每次口头交代。

### 9.1 单写者原则（唯一硬规则）

| 文件 | 允许的写者 | 生成物？ | 守卫 |
|---|---|---|---|
| `tickets/*/ticket.json`、`tickets/*/*.md` | **一个** owner（默认 = 主 agent） | 否 | `test/ticket-ledger.test.ts` |
| `tickets/README.md` | **只有 owner** 在结算时跑 `node scripts/build-tickets.mjs` | 是 | 同上（"md 与数据层同步"一项） |
| `analysis/scripts.json` / `analysis/engine-capabilities.json` / `analysis/fields.json` / `analysis/functions.json` | 每个文件**一个** owner（不同文件可以不同 agent，同一文件只能一个） | 否 | `test/script-ledger.test.ts` / `test/capability-ledger.test.ts` |
| `docs-new/05-scripts/*.md`、`docs-new/03-engine/engine-capabilities.md` | 由对应台账的 owner 在**结算时** build | 是 | 同上 |
| `src/*.txt`、`app/**`、`docs-new/03-engine/*.md`（叙述层） | 实现/翻译 agent；**改了必须在报告里申报"动过被锚定的文件"** | 否 | 锚点棘轮（两个台账 + `test/ticket-ledger.test.ts`） |

子代理**默认对本技能的台账只读**；要它写台账，就把它在 prompt 里指定为该台账的**唯一 owner**，并且只给它这一份。

### 9.2 三种子代理 prompt 模板（照抄进 prompt，缺一不可）

1. **ANALYSIS-ONLY**（默认选它，最安全）
   - 允许：读仓库任意处；中间物只写 `.tmp/<job>/`。
   - 禁止：写 `analysis/`、`tickets/`、`docs-new/`、`app/`、`src/`、`scripts/`。
   - ★**必须带这一句**：*"即使你加载了 `amayui-*-analysis` / `amayui-ticket-ledger` 等技能，也**跳过**它们的「读完必须更新台账/文档」步骤 —— 本次是只读分析，结论用报告交回。"*
     （实测：不写这句，子代理会在"技能要求落库"与"分析只读"之间自行取舍，结果不可预期 —— 它加载了 `amayui-script-analysis` 后只能靠自觉跳过台账更新。）
2. **IMPLEMENTATION**：给**路径所有权清单**（可写白名单 + 明确禁写 `analysis/`、`tickets/`、`docs-new/`）+ **必须保留的字面串**（= 锚点，见 9.3）+ 退出判据（`npm run verify` 全绿 + 实测 E4）。
   - ★**验收项「实现即删条目」**：子代理**无权**写 `analysis/`，所以它必须在报告里逐条列出"本轮实现/推翻后应当**删掉或改写**的 `missing[]`"，格式 = `opcode` + `raw` 键 + 一句 why（`raw` 是唯一定位键；先 `gaps.js --missing <opcode>` 取它）。
     这条是拿事故换来的：已 **3 次**出现"实现了却漏删对应 `missing`"（第 52/64/69 轮），主 agent 每次手工补删。
     ⇒ **交付物不是"能实现"，而是"实现 + 条目已消"**；owner 结算前跑 `gaps.js --stale` 兜底核验（它把 `what` 自述「已实现/不适用」的条目列出来）。
3. **LEDGER-OWNER**：整份台账独占；结算时自己 `build-*.mjs` + `--validate` + 对应守卫测试，并在报告里给**原始数字**。

### 9.3 锚点是跨 agent 的 ABI

锚点不是注释，是**契约**：它要求那个文件里**存在**那个字面串。改任何被锚定的文件（**源码注释与机制文档的表格行都算**）之前，先查谁锚在你这里：

```bash
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --anchors-in <文件>        # 哪些票据锚在这个文件
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --anchors-in <文件>      # 哪些脚本条目的 layout 锚在这里
```

处理规则（★**不许用"删证据 / 降 status / 删条目"来消红**）：
- 能保留 ⇒ 保留原串（重写注释时把旧串留在标题或引用里 —— 本会话就是这么保住 `②c ★**装载点不整批清绘制项**` 等 4 个串的）；
- 不能保留 ⇒ **在报告里申报**（"我删掉了 `<文件>` 里的字符串 `S`"），由 owner retarget 到同义新串；
- 见到红 ⇒ 先判类别再动手（9.4）。

### 9.4 `--validate` 红的分类处置

| 症状 | 真因 | 正确动作 |
|---|---|---|
| `evidence 锚点已消失` / `anchor 不在 lines 内` | 被锚文件被改（或被翻译 reflow / 换反编译版本） | retarget 到同义新串；**不要**删 evidence / 删条目 |
| `counts.<k> 应为 N`、`md 的统计行与数据层不一致` | **直接改过 JSON**（绕过工具）⇒ `counts` 陈旧、md 也旧 | 按台账跑它的**唯一口径**：`capabilities.js --recount` / `scripts.js --recount` / `gaps.js --recount`（缺口台账）/ `node scripts/build-tickets.mjs`（票据看板）⇒ 再重跑 `build-*.mjs` |
| `--set` 写进去的值变成了数组 | 值里有 **ASCII 逗号**（`--set` 按逗号切分）—— 本会话踩过两次 | 改用 `--set-json '<json>'` |
| `guards 指向的测试不存在` | 测试被改名/删除 | 先补测试再写回 `guards` |

### 9.5 共享资源（并行时必须串行化）

- `npm run shot` / `npm run verify`：**同一时刻只跑一个** —— 前者抢 Electron 窗口并**覆盖同一个 `.tmp/amayui-emulator.log`**（日志本身是证据来源），后者 CPU 密集会互相拖慢。
- `.tmp/`：每个 job 一个子目录（`.tmp/<job>/`），别共用文件名；**证据要归档进 `tickets/<id>/evidence/`**（`.tmp/` 是 gitignore 的临时区，不许当证据落点）。
- 生成物（`tickets/README.md`、`docs-new/**/*.md` 生成物）：**只在结算时由 owner build 一次**；其他 agent 不跑 build（避免用陈旧输入覆盖别人的结果）。

> ★本节与另两个技能（`amayui-engine-analysis`、`amayui-script-analysis`）的同名节**同源**：改一处请三处同步（表头规则一致，只有"谁的台账"一段随技能不同）。

### 9.6 落在本技能上的一条推论

`src/*.txt` 是**唯一会被"重排"的真源**（翻译 reflow / 重排会移动行号）⇒ 并行时 **"翻译 agent 与写台账的 agent 不能同时碰同一个脚本"**：
`layout[].lines` 与票据里 `line` 都会漂。最稳的顺序是：先让翻译/改稿 run 完（`--validate` 绿），再由台账 owner 一次性刷 `lines`；
反过来（一边 reflow 一边记 layout）必然红，且红的原因看起来像"锚点编造"，很费时间。
