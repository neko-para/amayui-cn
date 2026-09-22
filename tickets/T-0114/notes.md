# T-0114 · 提案与分析：把控制面板强化为调试器（快照/恢复 · 断点 · 直接查询）

> **状态：PROPOSAL / ANALYSIS-ONLY。**本文件是评估报告，**不含实现**。
> 来源：2026-09-22 用户在 T-0102（ADV 窗口白底）排查过程中的直接诉求：
> 「目前调试过于繁琐了」—— 每验证一个假设都要**改源码加诊断 → 重编 → 从标题推进 4 分钟**。
> 用户提出的两项能力：① 应用内快照/恢复；② 控制面板下发断点/特殊日志 + 直接查询（= 把控制面板做成调试器）。
>
> 本报告的每条"现状"都带落点（文件:行），凡推断都标注"未证"。

---

## 0. 一句话结论

**两项都能实现，而且工程量比预期小** —— 现有控制面板已经是"半个调试器"
（有定向 trace、有"停在未知指令"、有结构化上报、有"作为桩跳过"），
而快照的**核心件已经在**（`scSnapshotPresent`/`scRestorePresent` + 整套存档序列化）。
真正的难点**不在机制，在纪律**：暂停的等待方式、求值器的边界、以及"哪些量不进快照"。

---

## 1. 现状盘点（已有能力，均带落点）

### 1.1 控制面板 ↔ 渲染窗的现有通道

| 通道 | 方向 | 落点 | 作用 |
|---|---|---|---|
| `control-restart` | 面板→主 | `electron/ipc/control.ts:17` | reload 渲染器（重走 boot） |
| `control-force-close` | 面板→主 | `electron/ipc/control.ts:34` | 主进程侧 destroy + quit（卡死兜底） |
| `control-set-trace-all` | 面板→主→渲染 | `electron/ipc/control.ts:46` | 全量指令日志开关 |
| `control-set-trace-filter` | 面板→主→渲染 | `electron/ipc/control.ts:56` | **定向 trace 白名单（opcode 列表）** |
| `control-skip-op` | 面板→主→渲染 | `electron/ipc/control.ts:62` | **把未知指令"作为桩跳过"并从暂停点继续** |
| `renderer-status` / `control-status` | 渲染→主→面板 | `electron/ipc/control.ts:65`、`preload.ts:111/124` | 周期性状态上报 |
| `appendTraceLine` | 渲染→主 | `preload.ts:153` | 结构化 trace 落 `.tmp/scene-trace.jsonl` |

### 1.2 已经在用的"断点"（重要）

`src/renderer/app/session.ts:112` 有 `#pausedOp`，`ControlStatus.pendingUnknown` 是它的对外形状；
面板停在该未知指令上、等用户点「作为桩跳过」再继续。
⇒ **"渲染进程停在某处、由面板下发指令继续"这条链路已经跑通并被真机验证过**，这是调试器的地基。

### 1.3 已有的追踪/观测面

| 能力 | 落点 |
|---|---|
| 帧循环可挂观测 | `runFrameLoop(e, host, { maxSteps, onFrameEnd, gates })`（`src/frame/loop.ts`） |
| 逐帧/逐事件观测 | `src/frame/observer.ts`、`src/frame/trace.ts` |
| 状态摘要 | `ControlStatus`（`src/renderer/ipcProtocol.ts`）：ignored / skipped / gaps / dropped / perf |
| 回放轨迹 | `preload.ts` 的录制通道（时钟 + 输入 + digest） |
| headless 真语料驱动 | `src/tools/scenarioBoot.ts`、`gameStartChain.ts`、`scenarioRun.ts` |

### 1.4 快照的核心件已经在

| 件 | 落点 | 覆盖 |
|---|---|---|
| 画面快照/恢复 | `src/renderer/scene/present.ts:40` / `:55` | 绘制项 / 网格 / 消息窗文本 / 槽模式 |
| **整机快照（存档）** | `src/vm/handlers/save-slot.ts`、`src/vm/engineSlot.ts`、`src/save/saveSlot.ts` | 帧链（scriptId/ip/retStack/caller）+ 三池（int/float/string）+ 绘制项 + 纹理槽记录 + `playSeconds` |
| 读档回放 | `0xAE` 走栈 + `Engine.loadHold` | 已在 T-0059/T-0063/T-0071 落地 |

⇒ **"整台机器的快照"这件事，工程已经做过了 —— 只是落在磁盘（存档）而不是内存/面板上。**

---

## 2. 能力①：应用内快照 / 恢复 —— **可行**，性价比最高

### 2.1 为什么可行
- 序列化的**字段划分**已经有权威答案：直接复用 `SlotStateBlock`（`src/save/saveSlot.ts`）与
  `EngineSlotPayload`（`src/vm/engineSlot.ts:127` 起）的划分，不必重新设计；
- 恢复路径也有现成实现（`applySlotPresentation` / `restoreEngineSlot` / `0xAE` 走栈）。

### 2.2 要新增的（按量级）

| 件 | 量级 | 说明 |
|---|---|---|
| 内存快照结构 | 小 | `{frames, pools, present, texSlots, l2d?}` 的一个 JSON；**可直接复用存档的字段名** |
| 面板按钮 + 两条 IPC | 小 | `control-snapshot` / `control-restore`，照 `control-skip-op` 抄 |
| 恢复的**安全点** | **中** | 恢复时脚本可能正停在 `0x1F9` 的纹理屏障（`waitIdle` 在途）里；L2D 运行态**不在**存档里（`tickets/T-0090` 已知缺口） |
| **"不保的量"清单** | **中（纪律件）** | 见 2.3 —— 不做这个，快照会变成"看起来恢复了，其实某个量没回去" |

### 2.3 ★风险与纪律（本提案最重要的部分）

`tickets/T-0102` 这一轮踩的坑正是"有个量没回去"：`global f8080 = 1015936` **在保存池之外**
（池长 1015792），不随存档持久化，是**进程内裸量**。同类还有 ADV 场景大量使用的**池外引擎全局**
（`global 708ada` = 7,375,578、`global f8c48` = 1,018,952，见 `save-slot.ts:198-203` 的注释）。

⇒ 快照**必须**：
1. 明确列出"**哪些量不进快照**"（池外裸量、L2D 运行态、宿主侧纹理在途、音频队列）；
2. 恢复后**主动打一行日志**列出这些量（"这些没被恢复，当前值 = …"），否则调查者会误信快照；
3. 优先只在**帧边界**做快照与恢复（避开在途态）—— 见 §4 的待定项。

---

## 3. 能力②：断点 / 特殊日志 / 直接查询 —— **可行**，机理已存在

### 3.1 机理
执行在**渲染进程**，面板只能"请求"。现有 `#pausedOp` 证明"停在某处等指令继续"可行。
需要补的是**三个面**：

| 面 | 现状 | 要补 |
|---|---|---|
| **断点** | 只有"未知指令"一种（`session.ts:112`） | 条件断点：`(脚本, ip)` / `opcode` / `handle` / **表达式**（如 `global 0 == 6`）/ "第 N 次命中" |
| **特殊日志** | 只有 opcode 白名单（`traceFilter`） | **表达式化**的"命中即打一行"，含任意全局/槽/栈 —— 即把现在"改源码加 `[T-0102 诊断]`"变成面板上的一句话 |
| **直接查询** | 只有周期性状态汇总 | 任意时刻的任意量：`global X`、`frame[i].locals`、`texSlots`、`drawItems[h]`、`msgWins` |

### 3.2 ★两条必须提前定的设计约束

**(a) 求值器不能 `eval` 脚本。**
建议一个**极小子集 + 白名单解析**：
```
expr := term (('=='|'!='|'<'|'<='|'>'|'>=') term)?
term := factor (('&&'|'||') factor)*
factor := 'global' INT | 'local' INT | 'frame' '(' INT ')' '.' 'local' INT
        | 'slot' INT | 'handle' INT | INT | TRUE | FALSE | '(' expr ')'
```
理由：安全（无代码执行）、可测（纯函数，能上守卫）、且避开"求值本身被 trace 干扰"。

**(b) ⚠️ 暂停绝不能同步阻塞 IPC。**
若在渲染进程里同步等面板指令，会**冻住它自己**处理"继续"的通道（死锁）。
工程里已有正确 idiom：主循环已经是 async（`readIndex`、`waitIdle` 都是 async）
⇒ 加一个 **`DebugGate`（Promise 门）**，主循环 `await` 它，**零新架构**。

### 3.3 一个已知的"看起来像卡住"的坑
`0x1F9` 之后的 `waitIdle()` 会阻塞到纹理就绪（`textureCache.ts` 的 `BARRIER_GIVEUP_MS` 值棘轮）。
调试模式下应把上限改成"不截断"，否则断点会被误读成 hang。

---

## 4. 建议的推进顺序（未决，待用户确认范围）

| 步 | 做什么 | 为什么这个顺序 |
|---|---|---|
| **1** | **直接查询**（`global X` / 帧 / 槽 / 绘制项的一次性 dump） | 零风险、当天可用；**直接取代"改源码加诊断"的循环** —— T-0102 级排查的最大痛点 |
| **2** | **表达式断点 + 表达式日志**（复用第 1 步的求值器） | 让"从标题推进 4 分钟才能看到那一帧"变成"停住看" |
| **3** | **内存快照/恢复**（复用存档字段划分 + 帧边界安全点） | 收益最大但难点在 §2.3 的纪律件，放最后 |

**未决项（需用户定，本报告不擅自定）**：
- **A. 范围**：只做第 1 步 / 1+2 / 全做？
- **B. 表达式语法**：极小子集白名单 vs 复用 `src/*.txt` 的助记符风格（如 `gr (global-int f8080) a`）？
- **C. 快照安全点**：只允许帧边界（避开在途态，推荐）vs 任意步 + 连在途态一起重建？

---

## 5. 与本工程既有纪律的关系

- **不改 `src/*.txt`**：调试器是**观测/驱动**手段，不碰脚本真源（与 `authority.md` §1 一致）；
- **面板是宿主侧**：所有新增缝都在 `app/amayui-emulator/**`（渲染 + electron IPC + control），
  不引入引擎层结论 ⇒ 不需要回链 `analysis/*.json`；
- **可测性**：求值器与断点表命中判定都应是**纯函数** ⇒ 能写 E2 守卫（`test/`），不靠真界面；
- **缺口要说话**：若某能力只做到一部分（例如快照不含 L2D），必须写进票与日志（与第二层 `why:` 同纪律）。

---

## 6. 证据锚点（本报告引用的落点）

| 落点 | 说明 |
|---|---|
| `electron/ipc/control.ts:56` | `control-set-trace-filter`（已有定向 trace） |
| `electron/ipc/control.ts:62` | `control-skip-op`（已有"跳过并继续"） |
| `src/renderer/app/session.ts:112` | `#pausedOp`（已有"停在未知指令"= 断点雏形） |
| `src/renderer/scene/present.ts:40` | `scSnapshotPresent`（画面快照已在） |
| `src/vm/engineSlot.ts:127` | 槽状态块的字段划分（快照可直接复用） |
| `src/vm/handlers/save-slot.ts:198` | "池外裸量"的纪律说明（快照"不保的量"的依据） |
