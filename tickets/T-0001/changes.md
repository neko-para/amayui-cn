# T-0001 · 变更记录（changes.md）

> 纪律：**第 N 次变更**一节写"改了哪些文件 / 行为怎么变 / 判据是什么 / 看了哪张截图"。
> `history[]`（ticket.json）只记状态与范围级事件，别在这里重复。

## 第 1 次变更（2026-09-14）—— 抽出共享帧驱动，两份 chain 先接上（B1 阶段 1）

### 规模收敛（先记，因为它是本票范围的一部分）

原 acceptance 写的是"headless 各入口（report / config1Chain / gameStartChain / run）都经 frameLoop 跑"。
开工时发现 **`run.ts` 的逐字分支顺序与时钟推进是缺陷**（`e.nowMs += 16` 只在一个分支里、
`textRevealing` 排在 `serviceWinReveal` **之前**、缺 `serviceCharGrid`/`advActive`）⇒
把 run.ts 接进共享驱动**等于把缺陷编码进驱动**。经用户指示后把 B1 收敛为 **headless 三家 + 死代码清理**，
`run.ts` 随 B2（`T-0012`）一起处理。已在 `ticket.json` 的 acceptance 与 history 里留痕。

### 改了什么

| 文件 | 改动 |
|---|---|
| `src/frame/host.ts` | **新增**：`FrameHost` 接口（`now()` 必需；`yield/present/needsRender/animationsDone/texturesIdle/audio` 可选 —— 可选性是刻意的：headless 目前没有后五项，缺哪些见 `T-0013`） |
| `src/frame/loop.ts` | **新增**：唯一一份帧驱动 `runFrameLoop(e, host, opt)`。它实现"引擎主循环每帧顺序"①–⑨，全部差异只能经 `gates`/`services`/`maxStepsPerFrame`/`advFrame`/`advErrors`/`initialScript`/各钩子显式表达 |
| `src/tools/gameStartChain.ts` | harness 的 `run` 由"手写 for 循环 + stepAll"改为薄封装 `runFrameLoop`；配置逐项照抄原行为（见下"逐项对照"） |
| `src/tools/config1Chain.ts` | 同上；另把 `0x12F` 的 `captureSort12f` 从 `stepAll` 挪到 `onStep` + `onStepStart` 暂存 instr |

### 逐项对照（**这是本票"零行为变更"的凭据**）

驱动配置的每一项都对应原实现的一行，没有一项是"我觉得应该这样"：

| 驱动配置 | 原实现（行号为本轮改动前） |
|---|---|
| `gates.anim: 'clear'` | `gameStartChain:426` / `config1Chain:359` 的 `if (e.waitFlags & 0x400) e.waitFlags &= ~0x400;` |
| `gates.sleep: 'wait'` | 同处的 `else if (waitFlags & SLEEP_GATE) { if (clock >= e.sleepUntil) clear }` |
| `gates.advance: 'force'` | `gameStartChain:430` / `config1Chain:363` 的 `e.forceAdvance()` |
| `advFrame: true` + `advErrors: 'swallow'` | ADV 分支的 `e.serviceAdv(); try { stepAll() } catch {}`（**连 NotImplementedOp 的 throw 策略也会被吞掉** —— 实际行为如此，B1 原样保留） |
| `maxStepsPerFrame: 20000 / 5000` | 内批的 `k < 20000` / `k < 5000` |
| `onUnknown → 'continue'`（gameStart） | `stepAll` 里 catch `NotImplementedOp` → `o.onUnknown(...)`（stub 策略登记桩后继续；throw 策略在回调里上抛） |
| `onUnknown → 'stop'`（config1） | 内批 catch 里 `uninplementedPush(...); return i;`（**不登记用户桩**） |
| `onFrameEnd: clock += 1000/60` | 帧末同句 |
| `onFrameEnd: sampleNow()`（config1） | `config1Chain:389` 的 `sampleNow()`（在 `clock +=` 之前） |
| `initialScript` | 原 harness 的 `lastScript` **跨多次 run 调用保持**（驱动每次调用会重置，故显式传回） |
| `run` 返回值 | gameStart：`'cap' ⇒ frames`、否则 `r.frames`；config1：`'cap' ⇒ maxFrames`（**含那个怪返回值，见 T-0002/C5**） |

### 判据（实测）

- `npx tsc -p tsconfig.json --noEmit` 干净；
- `test/game-start-chain.test.ts` **11/11 通过**（含 E3：到达 SN0000 首文案 `firstTextIp=901`、判据⑥ 的 SE 归属）；
- `test/config1-chain.test.ts` + `test/text-style-snapshot.test.ts` **15/15 通过**（含 CONFIG1/CONFIG2 的
  可见项表/滚动/色样式 E3 断言）；
- **新增 `test/frame-loop.test.ts`（6 例）**：把驱动的档位语义钉住 —— `cap`/`until`/`script-end` 的
  `frames`/`steps` 口径、`0x400` 门 `'clear'` vs `'ignore'`、`sleep` 门 `'wait'` vs `'clear'`、
  每帧服务开关。用**合成脚本**（`loadScriptIntoFrame`）跑，不依赖语料 ⇒ 秒级、确定性；
- `npm run verify` 全绿（**427/427** = 原 421 + 6）。

### ★写测试时被纠正的一次理解（值得记下来）

我最初以为"`gates.anim='ignore'` ⇒ 内批不再受 `0x400` 影响"。实测（`test/frame-loop.test.ts` 的
`'ignore'` 用例 + `.tmp/probe-frame-loop.mts` 逐帧打印）**不是**：

> `'clear'` 每帧清位 ⇒ 那一帧不派发但**下帧一次放行到底**；
> `'ignore'` **不清位** ⇒ 位一直挂着，而**内批的"遇门即停"判据与 policy 无关**（`waitFlags & (0x400|SLEEP_GATE)`）
> ⇒ 于是每帧只放行 1 条指令，等于给脚本加了个"1 指令/帧"的节流器。

这解释了 `report.ts`（无 `0x400` 分支）为什么"看起来也能跑"：它把动画等待位变成了每帧一条的节流。
这条已写进 B2 的工单（`T-0002/notes.md` 的 G1），因为它会影响"补上 0x400 分支后报告会怎么变"。

### 未做（B1 剩余）

- ~~`report.ts` 接驱动~~ → 见第 2 次变更；
- ~~死代码清理~~ → 见第 3 次变更（`interpreter.run()` 已删；另两项改归 T-0014/T-0008）。

## 第 2 次变更（2026-09-14）—— `report.ts` 接驱动 + **G2 逐字节取证**

### 改了什么

- `src/frame/loop.ts`：新增 `onGate(branch, e)` 钩子（`FrameBranch = 'anim'|'sleep'|'text-reveal'|'advance'|'adv'|'batch'`）。
  为什么需要它：`report.ts` 的帧记账是**逐分支**的（两条门分支各占一帧、内批只在 `FRAME_OPS`/超上限时占帧），
  调用方必须知道本帧选了哪条分支。它同时就是设计文档 §3 里 `FrameObserver.onGate` 的那一项（B4 会复用）。
- `src/report.ts`：手写 `while` 循环 → `runFrameLoop`。逐项对照：
  | 驱动配置 | 原实现 |
  |---|---|
  | `gates.anim/sleep: 'ignore'` | 原实现**没有**这两条分支（是"不看"，不是"清掉"） |
  | `gates.advance: 'force'` + `onGate('advance')` 里 `advanceWaits++` | `if (e.awaitingAdvance) { advanceWaits++; forceAdvance(); …continue }` |
  | `advFrame: false` + `onStepStart` 里 `advFrameNow = e.advActive; if (advFrameNow) e.serviceAdv();` | `const advFrame = e.advActive; if (advFrame) e.serviceAdv();`（在 stepOnce 之前） |
  | `maxStepsPerFrame: 1` | 原循环"一轮一条" |
  | `until` 里做"帧首脚本尾/步数上限"判定 | `while (steps < opt.steps) { if (!f.script \|\| ip>=len) { 'script-end'; break } … }`（★放在 `until` 里 ⇒ 那两种情况都不跑每帧服务，与原来一致） |
  | `onStep` 里做 opCounts/gaps/jsonl + 帧边界 | 逐句照抄 |
  | `onFrameEnd` 里对 `text-reveal`/`advance` 两条分支各记一帧 | 那两条分支原来的 `frames++; clock += frameMs; advance(clock); continue` |
  | `onUnknown → 'stop'`（记 `unimplemented 0x…`）/ `onError → 'stop'`（记 `error: …`） | 原来的 try/catch 四条 break |

### ★G2 取证方法（可复用，B2 会再用来做 before/after 对照）

`scene-report.test.ts` 只证明"两次跑一致"，**不**证明"与重构前一致"。所以做了一次真正的 before/after：

1. `Copy-Item src/report.ts .tmp/report.live.ts`（备份工作区版）；
2. `git show HEAD:app/amayui-emulator/src/report.ts | Set-Content src/report.ts`（**只读 git**，把旧版放回原位）；
3. 跑 `.tmp/dump-report.mts before`（`script 0 / steps 120000 / frameMs 16`，dump 快照文本 + 全部 JSONL）；
4. 还原工作区版，跑 `.tmp/dump-report.mts live`；
5. `Get-FileHash` 比对。

结果：**两侧 sha256 完全相同** `FBC05509C25BDFA7163040A48A1047EFCE55612BF6A1ECC8B8F686C36333ADDE`，
且 `steps=120000 clockMs=480 frames=30 stop=steps-limit jsonl=120000` 全等 ⇒ 快照文本 + 12 万行 JSONL **逐字节一致**。

（`git show` 是只读操作，符合"不做 git 写操作"的约束；尝试过"复制整棵树再换文件"，但 `src/opcodes.ts` 的
跨包相对 import `../../../scripts/asm/opcodes.json` 会因为目录深度变化而解析失败 —— 所以直接换原位更省事。）

### 判据（实测）

- `npx tsc -p tsconfig.json --noEmit` 干净；
- `test/scene-report.test.ts` 3/3（含"两次跑逐字节一致"）；
- 全量 `npm run verify` **427/427** 全绿。

## 第 3 次变更（2026-09-14）—— 删 `interpreter.run()`（第 6 份"帧循环"）

- `src/vm/interpreter.ts`：删 `run()` 与 `RunResult`（全仓无导入者；且它**没有任何每帧服务**：不 present、
  不跑门、不推进时钟 ⇒ 它就是"第 6 份帧循环"），并在原位置留一条"为什么删、现在该用什么"的注释；
  顺带清掉随之无用的 `ExitScript`/`ScriptReset` import。
- 另两项**没有**盲删（实测后改归）：
  - `Engine.pickHoverLabel()` 只被**测试**调用（`adv-msgwin.test.ts` 5 处 + `route-dispatch.test.ts` 5 处），
    是"产品已改走 `serviceAdvanceWait` 内部"之后的**测试门面**；删它要同步改写那 10 条断言、并会丢掉其中
    对 `hoverDispatchAllowed()` 门控的覆盖 ⇒ 归 `T-0014` 单独做；
  - `PixiBackend.waitFlags` 粘滞是**缺陷**（`needsRender()` 因此永久为真）⇒ 归 `T-0008`，删字段要跟它一起做。
- 两次"票据锚点棘轮"都因本轮改动**变红**（T-0015 的 `return maxFrames`、T-0014 的 `export async function run`）——
  这正是设计它的目的：代码动了，票据必须回来核对。两处都已上移锚点并记录。

### 判据

`npm run verify` **427/427** 全绿；`tickets.js --validate` 通过（23 张）。
