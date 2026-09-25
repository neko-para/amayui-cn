---
kind: narrative
state: live
---
# 04-app · 测试分类与组织（测试法）

> 本文是 `app/amayui-emulator/test/` 的**组织法**：分类轴、唯一真源、执行入口、机械棘轮。
> 起因是 `tickets/T-0124` 的全量测试审计（159 文件 / 1078 用例逐条判定 + 12 处变异实测）。
> **一句话**：分类不写在文档里、也不靠目录位置 —— 它写在**每个测试文件的头一行**，由**一份规则实现**读取与校验，
> 于是"怎么跑 / 红了算什么 / 去哪找"三件事都变成**会红的断言**。

---

## 1. 为什么要重做（审计给出的四条依据）

| # | 事实（可复算） | 后果 |
|---|---|---|
| 1 | `npm test` 是**唯一**档位：全量 1078 例，本机 108 s（负载下）～ 45 s（空闲）；逐文件串行合计 **245.9 s**（`tickets/T-0124/evidence/test-cost.tsv`） | 日常迭代要么慢，要么干脆不跑 |
| 2 | 最贵的 12 个文件 = 串行成本的 **73%**，全部依赖**未入库**的真游戏资源（`install/`、`raw/`、`.tmp/appdata`） | 快档 = "不需要资产的子集"，这件事本来是**可判定**的，却没人判定 |
| 3 | **零断言假绿 5 处**：`console.warn('[skip]…'); return;` 不调 `t.skip()` ⇒ node:test 记 **pass** | 最危险的一类：它**谎报绿灯** |
| 4 | 三个台账（capabilities 139 / scripts 33 / tickets 129）的 `guards`/`tests` 只查**文件存在** | "声称有守卫"与"真有守卫"之间没有机械联系（见 `T-0130`） |

另有一条**反向**依据决定了方案的选择（见 §3）：
**移动测试文件会打断跨台账引用** —— 实测移动 40 个 T1 文件会牵动 **924 处**（其中 183 处在
`analysis/engine-capabilities.json` 这类机器真源里），而收益只是"导航可读性"。

---

## 2. 设计目标与硬约束

1. **判据不降级**：分档只改变"什么时候跑"，**不改变任何期望值**。禁止把 E3 断言改成 E1/E2 充数。
2. **可机械校验**：每条分类都必须能被一条谓词复核（否则它会腐烂成注释）。
3. **单一真源**：规则实现只有一份（`test/orgRules.ts`），执行端与守卫共用。
4. **不新增第二真源**：不复制已有台账里的事实（尤其 `evidence` E0–E4，见 §6）。
5. **锚点是 ABI**：不为了"整齐"去动被台账锚定的路径。

---

## 3. 评估过的三个方案（以及为什么选第三个）

| 方案 | 形态 | 优点 | 为什么不选 |
|---|---|---|---|
| **A. 按档位分目录** `test/{fast,corpus,e4}/` | 目录 = 档位，glob 即可选档 | 档位不可能"忘了登记"；`ls` 一眼看出要不要资产 | 移动 40 个文件 ⇒ 打断 **924 处**引用（含生成物与 183 处机器真源）；且同子系统的测试被拆散 |
| **B. 按子系统分目录** + 档位清单 | 目录 = 子系统（与 `src/` 同构），档位由 `tiers.json` 决定 | 归属清晰、导航好 | 同样要移动 159 个文件（引用面更大）；且**两份真源**（文件位置 + 清单）必然漂移 |
| **C. 扁平 + 文件头声明 + 机械规则**（**定稿**） | 位置不动；首行 `/** @tier … @kind … @subsystem … */`；`test/run.ts` 选档、`test/organization.test.ts` 守 | 零路径 churn；分类**就近**声明（打开文件就看到、写新文件时只加一行）；**可机械校验**；执行端与守卫共用同一份规则 | 需要一条"声明必须与机械证据一致"的棘轮（已实现：R1/R2/R3） |

★方案 C 的关键点：**"档位"不是靠人记得填对，而是靠两条机械判据夹住**——
`T0` 不得依赖未入库资源（R2 正向）、`T1` 必须真有资产证据（R2 反向）。人只填一次，之后由规则兜底。

---

## 4. 分类法：三个轴 + 一条声明

```ts
/** @tier T1 @kind core @subsystem config */
```

| 轴 | 取值 | 回答的问题 | 判定方式 |
|---|---|---|---|
| **`tier`** | `T0` 默认档（纯合成/纯函数/棘轮）· `T1` 真资产档（依赖 `install/`·`raw/`·真存档槽）· `T2` 真机档（Electron） | **什么时候必须跑** | 机械：import 语料装载器 / 出现资源目录字面量 ⇒ 至少 T1 |
| **`kind`** | `core` 行为守卫 · `ratchet` 防漂移棘轮 · `tool` 工具与宿主管线 | **红了意味着什么** | 策展名单（`ratchet`/`tool` 是**声明**："这条红了不代表产品行为坏了"） |
| **`subsystem`** | `frame`·`vm`·`ops`·`adv`·`text`·`render`·`texture`·`transition`·`l2d`·`save`·`audio`·`config`·`input`·`host`·`ledger`·`tool` | **去哪找** | 策展：文件名前缀为主 + `op-*` 逐条归位（它们横跨多子系统） |

**声明必须在前 4 行内**（R1 的第二个判据）—— 不许漂到文件中段，否则"这个文件属于哪档"要靠翻。

---

## 5. 执行入口（`test/run.ts`）

```bash
npm test               # T0 默认档     —— 日常迭代（本机实测 ~6 s / 797 例）
npm run test:corpus    # T1 真资产档   —— 改 VM/渲染/存档 或提交前（实测 ~22.6 s / 289 例）
npm run test:all       # T0+T1        —— **提交前口径**（实测 36.6 s / 1086 例，见 §8）
npm run test:e4        # T2 真机档     —— 真 Electron + GUI 会话；**必须显式跑**（1 文件 / 2 例 / 42.1 s，见 T-0132）
npm run test:list      # 打印三轴索引（--json 给机器）
npm run test:org       # 只跑分类一致性校验（不跑例）
npm run mutate         # 闸门 E：变异闸门（定向子集，~1 min）—— 每条"引擎语义破坏"必须有测试红
npm run mutate -- --all # 闸门 E 的发现模式（每条跑全量 1086 例，慢；用来找零覆盖）
npm run verify         # ★提交前必跑：typecheck + typecheck:test（闸门 D）+ **test:all** + 死写棘轮
```

★`verify` 里是 `test:all` 而**不是** `test` —— 这样"分档"只把**日常**变快，**T0/T1 的判据一字不降**。

★★**`all` / `verify` 刻意不含 T2**（`tickets/T-0132`，2026-09-23 定口径，实测见 §8.3）：
`all` 是提交前闸门，而 T2 需要**能起得来的 Electron + GUI 会话** —— 在自动化上下文里这**不是"慢一点"，
而是"可能起不来"**（本机 agent shell 里 Electron 沙箱初始化 `Operation not permitted` ⇒ GPU 进程 SIGTRAP，
必须显式 `--no-sandbox` 才跑得动）。把这种失败模式放进提交闸门 = 让闸门红在"宿主环境"上而不是"代码"上。
⇒ **改渲染宿主 / 输入 / 窗口时序 / 帧驱动时必须显式跑一次 `npm run test:e4`**（清单：`renderer/app/*`、
`frame/*`、`vm/input.ts`、`pixi/*`、`electron/*`、`tools/shot.cjs`）。

## 6. 三条硬规则（`test/orgRules.ts`，守卫 `test/organization.test.ts`）

| 规则 | 判据 | 防的是 |
|---|---|---|
| **R1 声明齐全** | 每个 `*.test.ts` 前 4 行内必须有合法 `@tier/@kind/@subsystem`；取值必须在白名单内；**每个 subsystem 至少 1 个文件**（防拼错导致静默漏归类） | 新文件不声明 / 值拼错 |
| **R2 档位诚实** | 正向：`T0` **不得** import 语料装载器、不得出现资源目录**字符串字面量**（注释里的 `raw 33865` 不算 —— 那是反编译行号）；反向：`T1` 必须真有资产证据（防 T1 变成杂物抽屉） | "在干净 clone / CI 上跑不起来"的默认档 |
| **R3 不许零断言空跑** | 禁止 `console.warn('[skip]…')` + 裸 `return`（该形态会被 node:test 记 pass）。守卫自带**判别力自检**：合成一段正例必须能红、一段合法的 `t.skip` 不得误报 | 审计查出的最严重一类假绿 |

**闸门 E（变异闸门）**是这套组织法的"体检"：分类解决"怎么跑/红了算什么"，变异解决"**到底有没有人守**"。
清单 `test/mutations.json`，判据见该文件头（`expectCatch` 全绿 = 守卫丢了 = 闸门失败）。

**为什么 `evidence`（E0–E4）不在这里再记一份**：它是**每条引擎能力**的属性，已经活在
`analysis/engine-capabilities.json` 的 `emulator.evidence` 里，并有守卫（声称 E2/E3 必须给真实 `guard`）。
按测试文件再记一份 = **第二个真源**，必然漂移。本组织法只回答"怎么跑 / 红了算什么 / 在哪"。

---

## 7. 现状分布（170 个文件，2026-09-23）

| 轴 | 分布 |
|---|---|
| `tier` | **T0 124**（默认档）· **T1 45**（真资产档）· **T2 1**（真机档：`e4-gamestart-shot.test.ts`，见 `T-0132`） |
| `kind` | **core 130** · **ratchet 25** · **tool 15** |
| `subsystem` | render 18 · vm 17 · ops 15 · frame 15 · text 12 · save 12 · adv 12 · config 11 · tool 9 · texture 9 · ledger 9 · l2d 8 · audio 7 · transition 6 · **host 6** · input 4 |

★文件数 160 → 166 全是**组织性**变化（不是新增覆盖）：`config1-chain` 由 1 个文件拆成 5 个（§8.1 的并行化）、
新增 `render-draw-order.test.ts`（补 z 序零覆盖）与 `registry-classification.test.ts`（收编 8 个文件里的注册表棘轮）。

★T2 = 0 是**如实登记**：E4 工具链已就位（`npm run shot`、`dbg:srv` + `dbg.cjs` 的 `click/clickimg/move/shot`，见 `T-0128`），
但**还没有 `@tier T2` 文件**（`npm run test:e4` 实测输出『T2 真机档（需要 Electron）：0 个文件』）⇒ 把工具链落成可重复判据是 `tickets/T-0132` 的工作，
★且该票必须先决定『T2 是否进 `test:all`（= `verify`）』：`all` 现在含 T2，一旦有 T2 文件，`verify` 就会拉起 Electron（需 GUI 会话、墙钟 +数十秒），
与 `T-0115` 刚收口到的 ~33 s 冲突。

---

## 8. 实测数字（本机，2026-09-23）

| 口径 | 文件 | 用例 | 墙钟 |
|---|---|---|---|
| 旧 `npm test`（无档位） | 159 | 1078 | **108.0 s**（同一轮另有负载）；空闲机重复测 66.6 s |
| 逐文件单跑（串行合计） | 159 | 1078 | 245.9 s |
| **新 `npm test`（T0）** | 121 | 797 | **5.8 s** |
| 新 `npm run test:corpus`（T1，**并行化前**） | 40 | 289 | 41.9 s |
| **新 `npm run test:corpus`（T1，并行化后）** | 44 | 289 | **22.2 s** |
| 新 `npm run test:all` / `verify` | 166 | **1082**（T0 793 + T1 289） | **31.8 s**（verify 全流程） |

- 用例数 1078 → 1082（**净 +4**）：新增 11 条守卫（`organization` ×7、`render-draw-order` ×2、`registry-classification` ×2），
  同时**删掉 7 条被更强替身覆盖的重复棘轮**（8 个文件里各写一遍的「注册表分类」+ op-d0 的恒真断言等）。
  ★判据没有降低：每一条被删的都由 §「替身」更严或等价——`registry-classification.test.ts` 一条覆盖原来 8 条的全部 opcode，
  且**已证伪**（把 0xD0 从 `OPS` 摘掉 ⇒ 该文件红）。
- skip 12 → 12：分档**没有丢掉任何覆盖**（11 在 T1、1 在 T0）。
- 失败 0：`test:all` 与 `test:org` 全绿；`typecheck`（原三套）与 `check:dead-writes` 全绿。

### 8.1 T1 的"并行化"：把串行链路拆成多进程（**判据一字不改**）

`config1-chain.test.ts` 原来在**一个进程**里串行跑 **9 次** CONFIG1 全链路（单文件实测 59.2 s = 整轮 verify 的一半以上）。
逐条看过：9 个变体的注入各不相同（`fontPicker` / `scroll` / `advReturn` 的 6 组不同 `{g0,g1397,msg,seedRecords}`）
⇒ **没有可 memo 的共享状态**（想"共享一次 boot + 逐变体重放尾段"需要引擎态快照/回灌 = `T-0122` 的能力，当前没有）。

但 node:test 是**按文件分进程并行**的 ⇒ 把互不相干的探针**按文件拆开**：CPU 总工作量一字不变
（还是 9 次 boot），墙钟却从"九次相加"变成"最慢那一组"：

| 文件 | 全链路次数 |
|---|---|
| `config1-chain.test.ts`（8 条共享同一次 `chain()`） | 1 |
| `config1-chain-fontpicker-scroll.test.ts` | 2 |
| `config1-chain-advreturn.test.ts` | 2 |
| `config1-chain-advreturn-seed.test.ts` | 3 |
| `config1-chain-advreturn-real.test.ts` | 1 |

实测：**59.2 s（1 文件）→ 15.2 s（5 文件并行）**；整个 T1 档 **41.9 s → 22.6 s**。
★这正是"分档不降判据"的另一种形态：**判据没动，只是把互相不依赖的东西放到能并行的位置**。

### 8.1b 去重导致的总量变化（`T-0129` 第 3 次变更，2026-09-23）

T0 用例 **799 → 797**（删掉 `option-font-speed-menu` 里 2 条被 `adv-msgwin` 更强替身覆盖的消息速度用例），
总用例 **1088 → 1086**。★同一轮里 `adv-msgwin` 那侧原本的 `st.intervalMs === revealInterval(5)`（镜像 + 恒真）
改成了具体数（`1000/60` 与 `(1000/60) × 5`）—— 属于 `T-0125` 的判据清理。

### 8.3 T2 真机档落地 + `all` 口径对照（`T-0132`，2026-09-23）

| 口径 | 文件 | 用例 | 墙钟 | 机器要求 |
|---|---|---|---|---|
| `npm run verify`（= `typecheck` + `typecheck:test` + `test:all` + 死写） | 169 | **1086** | **36.6 s** | 无（含 T0+T1） |
| `npm run test:e4`（T2） | 1 | 2 | **42.1 s** | ★真 Electron + GUI 会话（自动化上下文需 `--no-sandbox`） |
| 对照实验：把 T2 临时并回 `all` 后的 `test:all` | 170 | 1088 | **52.6 s** | 同上 |

★对照实验的**修正**：T2 并回 `all` 的边际墙钟只有 **+16 s**（node:test 按文件并行 ⇒ 那 42 s 与 T0/T1 重叠），
比我最初估的"数十秒"小。**决定口径的不是这 16 s，而是失败模式**：T2 需要"宿主的 Electron 起得来"，
本机 agent shell 下就是 `Failed to initialize sandbox: Operation not permitted` ⇒ GPU 进程 SIGTRAP、
整个 run 起不来。提交闸门红在"宿主环境"上而不是"代码"上，是不可接受的假红来源。

判据（`test/e4-gamestart-shot.test.ts`，两类都机器可判、都不看人眼）：

| 类别 | 判据 | 真机实测（本机 2026-09-23） |
|---|---|---|
| 链路深度 | 工具 stdout 的 `TITLE=true` / `GAMESTART=true` / `SN0000=true`（`shot.cjs` 的 `waitLog(...)` 产物，**不睡固定秒数**） | 三个全部 `true` |
| 像素本身 | 标题帧与 ADV 首文案帧的 `colors=N`（`shot.cjs` 对 `capturePage()` bitmap 按 ~2 万样点统计的不同 RGB 三元组数）≥ 64，且不带 `★几乎全黑` | 标题 **14985**、首文案 **13737**、其余帧 7299~11877；纯色/黑屏帧 = **1** ⇒ 阈值有 ~100× 余量 |

反例实验：把 `session.ts` 的 `present` 改成不合成（`if (false) …`）⇒ `test:e4` **fail 1**，
失败信息同时点出两帧 `colors=1`（链路标记仍为 true ⇒ 像素判据有**独立**判别力）；还原后逐字节一致、绿。
另有一条**纯函数自检**（不需要 Electron）：喂"好帧 / 纯色帧 / 缺标记"三种合成 stdout，必须给出三种不同结论。

★`capturePage()` 给的是**物理像素**（本机 DPR=2 ⇒ 2560×1440），所以判据只钉"不小于逻辑 1280×720 + 16:9"，
不钉设备像素 —— 否则换台 DPR=1 的机器就假红。

### 8.2 `test/` 类型债清零（`T-0126` 第 2 次变更，2026-09-23）

| 口径 | 值 |
|---|---|
| `npm run typecheck:test` 错误数 | **131 → 0**（60 个文件 → 0；`id` 84 个） |
| 主要类别 | TS2739 37 + TS2741 14 = **51 条手搓 `ScriptBinary` fixture 缺派生字段**；`noUncheckedIndexedAccess` 38（TS2532 24 + TS18048 14）；TS2440 **4 条「import 与本地声明同名」**（4 个文件各自逐字重抄了一份 `instr`）；其余 38 条散落 |
| 闸门 | 基线文件 `test-typecheck.baseline.json` 与棘轮工具 `src/tools/typecheckTestBaseline.ts` **一并删除**，`verify` 改跑 `typecheck:test`。★基线归零后 `--recount` 只剩一个用途：**把新错误登记成合法** ⇒ 留着它就是留后门 |

处置口径（**没有一条是把类型放松**）：①补 fixture 派生字段（`harness.scriptDerived()`：`ipTables`/`dwordToInstr`
是 `parseScript()` 从 `raw` 反推出的索引，`engineSlot.ts:577` 直接索引 ⇒ 不许改成可选）；②删掉 4 份逐字重复的
本地 `instr`，改用 `harness.instr`；③数组解包加 `at()`/`must()`（越界即抛，失败信息带下标与长度 —— `!` 与
`?? 0` 会把「数组短了」这条信息丢掉）；④**类型本身就是错的**那几处按真实形状修：`Ticket.history[].kind`/
`doneWhy` 缺字段、`GameStartOptions.emulatorOptions` 收的是已归一化的 `EmulatorOptions`（应放宽为
`EmulatorOptionsInput`）、`SlotStateBlock.adv` 是 `unknown`（断言侧按 `AdvStateJson` 断言）、跨目录
`scripts/agf/format.js` 补 `.d.ts`；⑤删掉一条同义反复断言（`op-02`：`assert.equal(thrown, null)` 之后的
`!(thrown instanceof ExitScript)` 恒真，`tickets/T-0125` 口径）。

---

## 9. 已知债与后续票

| # | 内容 | 票 |
|---|---|---|
| 1 | ~~**`test/` 的类型债**~~ —— **已还清**（`tickets/T-0126`，2026-09-23）：131 条 / 60 文件（TS2739 37 手搓 `ScriptBinary` 缺 `ipTables`/`dwordToInstr`、`noUncheckedIndexedAccess` 38、TS2741 14、TS2440 4 …）逐类清零，**基线文件与棘轮工具一并删除**（基线归零后 `--recount` 只会变成「把新错误登记成合法」的后门）⇒ 闸门 D = `typecheck:test` 零容忍，直接进 `verify` | 已做 |
| 2 | ~~**T1 内部重复链路**~~ —— ①`config1-chain` 已**拆成 5 个文件并行**（59.2 s → 15.2 s，见 §8.1）；②`adv-name-color-chain` 的 3 次链路里 2 次 opts 相同，已加**按键 memo**（21.9 s → ~14.6 s）。★想再往下压（"共享一次 boot + 逐变体重放尾段"）需要**引擎态快照/回灌** = `T-0122` 的能力 | 已做 / `T-0122` |
| 3 | ~~**E4 档落地**~~ —— **已做**（`T-0132`，2026-09-23）：首个 T2 文件 `test/e4-gamestart-shot.test.ts`（真 Electron 跑 `TITLE→GAMESTART→SN0000`，= 三个 `waitLog` 标记 + 像素 `colors≥64` 且非全黑），口径定为 **`all`/`verify` 不含 T2**、`npm run test:e4` 显式跑（实测数字见 §8.3） | 已做 |
| 4 | **去重**：同一不变量的第 2/3 份（`adv-msgwin` 路由组、存档族、注册表棘轮 8~9 处）—— 删冗余不损失检出，但**每处都要给替身位置与反例实验** | `T-0129` |
| 5 | **台账 `guards` 加内容锚点**（现在只查文件存在）：与本组织法同源的问题 —— "声明"要能被机械复核 | `T-0130` |
| 6 | 断言级清理（恒真 / 镜像 / 错 oracle / 判据钉错地方）与补 3 处零覆盖：**z 序已闭**（`render-draw-order.test.ts`）、**快照 drawable 已闭**（`scene-report` 独立下限）、**面板 `opHex` 待补**（`T-0127`） | `T-0125`/`T-0127` |

---

## 10. 给"新增一个测试"的人（三步）

1. **写文件**，首行加声明：`/** @tier T? @kind ? @subsystem ? */`
   - 需要 `install/`·`raw/`·真存档槽 ⇒ `T1`；纯合成/纯函数/读 `analysis/*.json` ⇒ `T0`。
   - ★`@kind` 的**合法值只有 `core` / `ratchet` / `tool`**（`test/orgRules.ts` 的 `KINDS`）。
     写成别的（如 `regression`）会让 pragma 解析成 `null` ⇒ `test/run.ts` 直接抛
     `TypeError: Cannot read properties of null (reading 'tier')`，**整档测试都跑不了**（不是"这一个文件红"）。
   - ★**档位要与机械可见的资产依赖一致**：声明 `T0` 就不得 import 语料装载器 / 不得出现资源目录字符串字面量
     （R2 判红）；声明 `T1` 就必须真有资产证据。
2. **跑** `npm run test:org` —— 若档位填错（例如声明 T0 却 import 了 `loadScriptData`），它会当场红并告诉你改什么。
3. **跑** `npm test`（快档）与 `npm run test:corpus`（若你写了 T1）。

★缺资产时**必须**用 `t.skip()`（回调记得接 `t`），**不许** `console.warn` + 裸 `return` —— R3 会红。

### 10.1 ★自造 fixture 工厂 / 帧循环：棘轮只许收缩

**用 `test/harness.ts` 的工厂**（`mkEngine`/`instr`/`im`/`loc`/`str`），**不要**在新测试里再抄一份
`mk()` / `mkEngine()` / `makeCtx()` 变体，也不要自造帧循环（走 `src/frame/loop.ts` 的共享驱动）。

- 守卫：`test/harness-convergence.test.ts`；基线 `test/harness-convergence.baseline.json`（**只许收缩**）；
  扫描口径的唯一实现在 `test/harnessScan.ts`。
- ★**基线的用法是"收缩"，不是"登记例外"**：确属"差异是真实需求"才可加进基线并在文件头写清为什么；
  能用 harness 的就改 —— 存量 42 个文件是既成事实，**不是新写一份的理由**。
- ★**扫描口径是"正则扫全文"**（`test/harnessScan.ts` 的四条模式），**注释里出现同样会命中**：
  实测把一个新测试的注释写成"名字故意不叫 `const mk = `"就被判成"新抄的变体"。
  要提这件事就写"自造 fixture 工厂"，**别把源码形态原样抄进注释**。
- 收缩入口：`node --import tsx test/run.ts --shrink-harness`（把已消失的条目从基线里摘掉）。
