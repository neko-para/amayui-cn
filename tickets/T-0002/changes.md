# T-0002 · 变更记录（changes.md）

> 纪律：**第 N 批/次变更**一节写"改了哪些文件 / 行为怎么变 / 判据是什么 / 看了哪张截图"。
> `history[]`（ticket.json）只记状态与范围级事件，别在这里重复。
> 本文件同时承担 B2 的 **before/after 对照表**职责（每处差异 → 哪个字段变了 → 为什么）。

## ★ 收口总表：设计文档 §1.2 的 14 条漂移工单（2026-09-14）

| # | 工单 | 结果 | 落在哪一批 / 票据 | 证据 |
|---|---|---|---|---|
| 1 | `report.ts` 无 `0x400`/`SLEEP` 分支 | ⏸ **刻意保留** | C2 决策（本文件第 1 批 ④） | report 输出 sha256 `FBC05509…` 与 B1 前逐字节相同；等价性交给 B5 的 replay |
| 2 | `run.ts` 分支顺序/时钟缺陷 | ✅ 已修 | 第 2 批 ⑤（`T-0012`） | `run.ts` 接驱动；实测 `STEPS=n` 逐条生效（修前 300 会跑成 20000） |
| 3 | 两份 chain 无条件清 `0x400` | ✅ 已修 | 第 1 批 ①/②（`T-0011`） | `gates.anim:'wait'`；`game-start-chain` 11/11 |
| 4 | chains 从不推进动画窗 | ✅ 已修 | 第 1 批 ②（`FrameHost.advanceModel`） | `mesh-vertex-quad` ②；端点色顺序依赖显形并修掉 |
| 5 | `PixiBackend.waitFlags` 只置不清 | ✅ 已修 | `T-0008`（D1） | E4 A/B：presents 66→68、日志 2395→2384；源码棘轮 + 负向实测 |
| 6 | `HeadlessScene.waitFlags` 死状态 | ✅ 已修 | `T-0008` | 死字段删除；源码棘轮覆盖两文件 |
| 7 | 门的判据读"上一帧时钟" | ✅ 已修 | `T-0008`/`T-0009` | `animationsDone(nowMs)`；`T-0009` 的三条验收全绿 |
| 8 | `scAnimationsDone` 只看窗 0 | ✅ 已修（拆两条判据） | 第 3 批（`T-0009`/`T-0024`） | 合成 = `scAnimationsPending`（5 窗）；门 = `scGateAnimationsDone`（颜色窗，等 `0x238` 计时器落地，`T-0024` 立案） |
| 9 | 音频帧泵只在 Electron | ✅ 已修（属 B3） | `T-0006` | before/after：`drops` 里 `audio×37`/`×14` → 0；`audioEvents` 0 → 14/6；G2 不变 |
| 10 | 悬停只在 Electron 跑 | ⬜ **属 B3**（`T-0003` 的"输入源"一项，子票 `T-0007`） | — | — |
| 11 | `interpreter.run()` 死循环 | ✅ 已删 | `T-0014` | 零调用者；删除时留注释说明 |
| 12 | 文档与代码矛盾（ticker 说法） | ✅ 已订正 | `T-0015` | `renderer.ts`/`native.ts` 注释 |
| 13 | `run(frames)` 返回语义两处不同 | ✅ 已统一 | 第 2 批 ⑥（C5） | `'cap' ? frames : r.frames` 两处一致 |
| 14 | 宿主能力面不入桥 | ✅ 已修 | `T-0013` | 三名入桥 + 闸门 A 白名单；两条能力面守卫（差异表 16→15） |

**判据（acceptance）**：
1. before/after 对照表 = 上面这张总表 + 第 1–6 批的分项表（每批都在本文件里）✅
2. `test/scene-report.test.ts` 快照文本 + `report` 全文**逐字节不变**：`sha256 FBC05509C25BDFA7163040A48A1047EFCE55612BF6A1ECC8B8F686C36333ADDE`
   （`steps=120000 clockMs=480 frames=30 stop=steps-limit jsonl=120000`）—— 在 B1/B2 每一批之后都复跑过 ✅
3. §1.2 的 14 条：13 条已修/已登记决策，第 10 条**按设计归 B3**（`T-0003`）✅

> 注：第 9/10 条在设计文档里本来就标着"属 B3"；B2（本票）的范围到此收口。

## 第 1 批（2026-09-14）—— A2 门判据 + A1 模型推进；门统一**暂缓**并给出实测原因

### ① A2：`scAnimationsDone` 与 `advanceWindows` 口径不一致（已修）

**改了什么**：`src/renderer/scene/ops.ts` 的 `scAnimationsDone` 原先只查 **窗 0（颜色窗）**，
而 `advanceWindows` 推进 **5 个窗**（颜色/缩放/旋转/平移/flipbook）。改为复用 `animWindow.ts` 里
**已经存在**的 `itemAnimationsPending`（逐 5 窗）。

**为什么**：这是 `0x400` 动画等待门的放行判据。只看颜色窗 ⇒ 缩放/旋转/平移/flipbook 在跑的项被判成
"没有动画" ⇒ 门提前放行、画面半途切走。

**过程中的两个发现**（都值得记）：
1. 我第一版把极性写反了 —— `itemAnimationsPending` **本身**就是"还有窗没走完"，不需要再取反。
   **新写的守卫当场抓住**（`test/anim-window-done.test.ts`：4 个非颜色窗全红）。这正是"先写判据再写实现"的价值。
2. 窗起点用的是 **`animStart === 0` 哨兵**（引擎 `+0x34`），而 headless 的**虚拟时钟从 0 起** ⇒
   在 `clock === 0` 那一刻配置的动画会**反复重新锁存、永不结束**。真实使用都在若干帧之后配置
   （墙钟更不可能为 0）⇒ 守卫文件从 `T0 = 16` 起算，并把这条记为**时钟域问题（设计 D1）**的实例。

**判据**：`test/anim-window-done.test.ts` **7/7**；**负向对照**（把判据换回 `windowDone(it,0,clock)`）：
缩放/旋转/平移/flipbook **四例红**、颜色窗与"无动画"两例**仍绿** —— 精确刻画了原缺陷。

### ② A1：模型推进成为宿主契约（已做）

**改了什么**：
- `src/frame/host.ts`：`FrameHost` 增 `advanceModel?(nowMs)`（帧末推进模型）与 `animationsDone?(nowMs)`
  （门判据，**带本帧时钟**，避免"读上一帧时钟"那个偏差）。`present?()` 保持"只渲染"（设计 D5：拆开三件事）。
- `src/frame/loop.ts`：帧末 `host.advanceModel?.(nowMs)` → `host.present?.()`；新增 `present?: 'host' | 'never'`。
- `src/renderer/headlessScene.ts`：实现 `advanceModel`（= `scAdvance`）与 `animationsDone`（= `!scAnimationsDone`）。
- 两份 chain：`host` 接上这两个能力 ⇒ **每帧推进一次模型**（修前**从不推进动画窗**）。
- `src/report.ts`：显式 `present: 'never'` —— 它是**指令驱动**的 tracer（帧边界由 `FRAME_OPS`/批上限决定），
  模型推进仍由它自己的钩子做（C2 决策：tracer 不假装是"产品的帧"；等价性由 B5 的 replay runner 负责）。

**判据**：`game-start-chain` 11/11、`config1-chain`+`text-style-snapshot` 15/15 全绿；
**★`report` 的输出与重构前仍逐字节一致**（`sha256 FBC05509…`，B1 的 before/after 探针复跑）⇒ A1 没碰 report 的粒度
（正是 `present: 'never'` 的作用）。

### ③ 顺带修：`gameStartChain` 报告里的"端点色"被求值污染（顺序依赖）

**改了什么**：mesh 映射原先先算 `meshColor(m, calcDiffuse(m, harness.clock))`、**之后**才读
`m.state0/m.state1/m.flags`；而 `calcDiffuse` **在窗末有烘焙副作用**（`state0 ← state1`、清 bit1，
见 `drawitem/eval.ts`）。B1 把模型推进接上后这个顺序依赖第一次显形
（`mesh-vertex-quad.test.ts` ① 的 `state0` 从 `#ff000000` 变成 `#00000000`）。现在**先抓后算**，
报告字段与它的说明（"`0x322`/`0x323` 写的两端色"）重新一致。

### ④ ⏸ 门统一（G1/G2/G3）**暂缓** —— 它不只是记账差异，会改变脚本执行路径

**实测**：把两份 chain 的 `0x400` 从 `'clear'`（每帧无条件清）改成 `'wait'`（等 `animationsDone()`）后，
`mesh-vertex-quad.test.ts` 的 ② 变红：ADV 暗幕 `0x19640` 的 `state0` 期望 `#80000000`（50% 黑）、实际 `#00000000`。

**隔离实验（决定性）**：

| 实验 | 结果 |
|---|---|
| 只做 A1（每帧推进模型）、门仍 `'clear'` | ✅ 该测试通过 |
| 只把门改成 `'wait'` | ❌ 变红 |

⇒ 门策略通过**时钟节奏**间接影响"读时间的脚本分支"（`0x1F4`/`0x1F5`/`i1c7`/`i1cc` 一族）与 `0x323` 窗的
完成时刻。**结论：门收敛必须先做"路径级 before/after"**（哪几条指令的走向变了），不能只看报告字段。

## 第 2 批（2026-09-14）—— 门统一（G1/G2/G3）+ run.ts 接驱动（C1/C3/C4）+ C5 + D3 + 「逐条停」

### ① 门统一：`0x400` 不再"每帧无条件清"（G2/G3）

两份 chain 改为 `gates: { anim: 'wait', … }`（等 `host.animationsDone()`）—— 与产品（`session` 的
`#serviceAnimGate`）同源。判据：**全套 434/434 只挂了 1 条**（见 ③），改完断言后全绿。

**G1（`report.ts` 没有 `0x400`/`SLEEP` 分支）不是"补上"，而是"决策为不补"**：`report` 是**指令驱动**的 tracer
（帧边界由 `FRAME_OPS`/批上限决定、时钟按自己的粒度走）⇒ 它显式传 `gates: { anim: 'ignore', sleep: 'ignore' }`
且 `present: 'never'`。**两宿主等价性不由它承担**，而由 B5 的 `--record/--replay` 产品帧 runner 承担（G3）。
把它"补成 wait"只会让它的时钟不再与指令数脱钩，反而丢掉 tracer 的价值。

### ② 用 trace 对照定位"门策略到底改了什么"（instead of 猜）

`.tmp/trace-chain.mts`（新增，`git`-free）：dump 全链路逐条 `script:ip:opcode` + 两块幕布端点色。

| | `anim:'clear'`（修前） | `anim:'wait'`（修后） |
|---|---|---|
| 步数 | **283100** | **250913** |
| 停下时所在脚本 | `CHARMEDIT.BIN`（**越过了目标**） | `SN0000.BIN`（目标所在） |
| `clockMs` | 100233 | 172900 |
| `0x19258` 淡入幕 | `state0=#ff000000 state1=#00000000 flags=3` | 同左 ✓ |
| `0x19640` ADV 暗幕 | `state0=#80000000 state1=#00000000 flags=1` | `state0=#00000000 state1=#80000000 flags=3` |

⇒ 两条结论：
1. `clear` 那份"幕布已淡完"是**停止点伪影**：它越过了目标一整批（见 ④），不是"门策略改了画面语义"；
2. 修后 0x19640 正在 `0x323` 的**淡入窗内**（目标 50% 黑）⇒ 断言应指向**目标色**而不是当前 `state0`。

### ③ 两处测试断言订正（都写在测试里，附原因）

- `test/mesh-vertex-quad.test.ts` ②：由 `adv.state0 === '#80000000'` 改为
  `(flags & 2) ? state1 : state0 === '#80000000'`（**目标色**），并保留 ③ 的"不存在不透明满屏黑"不变量。
- `test/game-start-chain.test.ts`：删掉 `pageText.split('\n').length >= 3`（"首文案三行一页"）——
  它同样依赖"越过目标一整批才会把整页 3 行都执行完"；"三行一页"是**脚本结构**事实，登记在
  `docs-new/05-scripts/SN0000.md`，不该由停止点编码。

### ④ 新驱动能力：`stopAfterStep`（逐条停）—— 修掉"越过目标一整批"

**发现**：`until` 只在**帧开头**判，而一帧能派发一整批（上限 20000）⇒ "到达目标"实际会**越过目标最多一整批**。
证据：`run.ts` 的 `STEPS=300` 会跑成 **20000** 条；两份 chain 的 E3 会停在 `CHARMEDIT`。

**做法**：驱动加 `stopAfterStep?(t, e)`（每条指令之后判，`stopReason = 'step-stop'`）。
**但有个必须区分的坑（实测踩到）**：逐条停只对"**一旦为真就永久为真**"的条件成立 ——
把 chain 里 `hover() === 0` 这类条件也逐条判，会在 `3f5` 命中而下标 `3f7` 还没写时停下，
`gameStartHover` 变成 `-1`（红）。所以 API 明确分成两个参数：
`run(frames, until?, stopStep?)` —— `until` 给"帧内后段才定型"的状态，`stopStep` 只给目标判定
（`firstTextIp >= 0`）。

### ⑤ C1/C3/C4 + G3：`run.ts` 接共享驱动

`src/run.ts` 的手写 `while` 循环 → `runFrameLoop`：
- **C3** 逐字分支顺序回归产品顺序（原先排在 `serviceWinReveal` 之前、两分支永不同帧）；
- **C1** 时钟每帧末 `+= 1000/60`（原先只在逐字分支 `+= 16`，其余时间**冻结** ⇒ `sleep` 门永不满足）；
- **C4** `serviceCharGrid` / `advActive` 分支补齐（按产品开）；
- **G3** 吃驱动统一后的门；另修 `STEPS=n` 逐条生效（见 ④）。
- ★`gates.anim` 仍是 `'clear'`：该 CLI 的宿主是 `StubNative`（**没有场景模型**）⇒ `animationsDone` 无从计算，
  传 `'wait'` 会死等。这是**宿主能力缺口**（`tickets/T-0013`），已在代码注释里写明。

### ⑥ C5 / D3

- **C5**：`config1Chain.run` 不再返回 `maxFrames`（默认 `+∞`，靠"`Infinity < N` 为假"侥幸成立），
  与 `gameStartChain` 统一为 `'cap' ? frames : r.frames`。
- **D3**：`renderer.ts` / `native.ts` 里"渲染帧循环由 Pixi ticker/`startFrameLoop` 每帧驱动"的说法订正为
  "帧驱动在 `src/frame/loop.ts`，`present` 由驱动调用；`startFrameLoop` 只记墙钟起点"。

### 判据

`npm run verify` **434/434**（3×tsc + 测试 + 死写棘轮）；`tickets.js --validate` 通过；
`report` 的输出与重构前仍逐字节一致（`sha256 FBC05509…`，本批未改它的策略）。

## 第 3 批（2026-09-14）—— A2 的口径订正：门判据 ≠ 合成判据（`tickets/T-0008` 的 D1 证据里发现）

**症状（E4 A/B 实测）**：第 1 批的 A2 把 `scAnimationsDone` 从"窗 0（颜色窗）"扩到"5 个窗"后，
`npm run shot -- --gamestart` 在**序章黑屏 20 s 以上不放行**：`[present …] meshes={0x19258:255/#000000…} wait=0x400`
连续三帧数字完全不动、`gate 0x400 cleared` 只有 3 次（HEAD 是 11 次）。

**根因**：这条判据被**两处**复用（`needsRender` 的"该不该合成" + `0x400` 门的"能不能放行"），
而两者范围本就不同。序章 `src/SN0000.txt:1043` 在 `wait`(`:1048`) 前装了
`i220 (global-int f8023) 0 13880 …` = **80 000 ms 的平移窗**（整场慢推）⇒ 门被钉 80 s。
`TEMP-DIAG` 回调（跑完即删）抓到真凶：`item 0x18a88 flags=3 animStart=13580.6 w3:d0/80000`。

**改法**：
- `scAnimationsPending`（mesh 全窗 + draw item **5 窗**）→ **合成**口径，`sceneNeedsRender` 用它；
- `scGateAnimationsDone`（mesh 全窗 + draw item **颜色窗**）→ **门**口径，`session` / 两份 chain 用它；
- 引擎依据与后续（`0x238` 装载的等待计时器 + 池挂起位）见 `tickets/T-0024` 的 `notes.md`。

**判据**：`npm test` **439/439**；A/B（`.tmp/t8-ab.mjs`，同配置、src 逐字节还原）after 侧恢复为
"门清 11 次 + 进 SN0000 正文（316 行 `[reveal]`）"，与 HEAD（323 行）等价；
新增守卫 `test/anim-window-done.test.ts` 的 `T-0024` 两条（80 000 ms 平移窗：合成要合成、门要放行）。

