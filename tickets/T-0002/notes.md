# T-0002 · 过程文档（notes.md）

## 14 条工单（来自帧循环穷尽差异清单，逐条带 file:line）

> 清单原件：`.tmp/frame-loop-divergence.md`（只读代理产出；`.tmp` 不入库，所以**结论必须落在这里**）。
> 每条都要有 before/after 对照：改前哪个报告字段是什么、改后是什么、为什么。

### 门（gate）

- [ ] **G1** `report.ts` 完全没有 `0x400`/`SLEEP` 分支 ⇒ 置上后永不清、`sleep` 永不满足（`report.ts:158-239`）。
- [ ] **G2** 两份 chain 每帧**无条件清 `0x400`**（`config1Chain.ts:359`、`gameStartChain.ts:426`）——等价于"动画瞬间完成"。
- [ ] **G3** `run.ts` 无 `0x400`/`SLEEP` 分支（`run.ts:135-190`）。
- [ ] **G4** `session` 的 `0x400` 判据读的是**上一帧时钟**（`pixiBackend.ts:705` 在 present 内才刷新 vs `session.ts:279` 提前读）。

### 时钟 / 结构

- [ ] **C1** `run.ts` 的 `e.nowMs += 16` 只在逐字分支里（`run.ts:145`）⇒ 其余时间冻结、`sleep` 永不满足。
- [ ] **C2** 帧长三种（16 / 16.667 / 真实）；`report` 的时钟在无帧指令时可能不前进（`report.ts:227-238`）。
- [ ] **C3** `run.ts` 的逐字分支排在 `serviceWinReveal` **之前**且两者永不同帧（`run.ts:143-149`）——与其余四家顺序相反。
- [ ] **C4** `run.ts` 缺 `serviceCharGrid` / `serviceAdv` / `advActive` 分支。
- [ ] **C5** `run(frames)` 返回值语义不同：`config1Chain.ts:392` 返 `maxFrames`、`gameStartChain.ts:457` 返 `frames`。

### 模型推进（动画窗）

- [ ] **A1** 只有 `report.ts` 调 `headless.advance()`（`:176,184,231,237,240`）；两份 chain 与 `run.ts` **从不推进**。
- [ ] **A2** `scAnimationsDone` 只看**颜色窗（窗 0）**（`scene/ops.ts:414-418`），而 `advanceWindows` 判 **5 窗**（`animWindow.ts:60-72`）⇒ "已完成"与"窗走完"不等价。

### 宿主状态 / 能力面

- [ ] **H1** `PixiBackend.waitFlags` 只置不清（`:122,606,687`）⇒ `needsRender()` 永久为真 ⇒ Electron 此后每帧 present（连带每帧 audio tick）。同时 `HeadlessScene.waitFlags` 是死状态（`:103,368-370`）。
- [ ] **H2** `needsRender` / `sceneAnimationsDone` / `preloadImage` 既不在 `NativeBridge` 也不在 nativeTap 白名单 ⇒ 缺口不被闸门 A 记。
- [ ] **H3** 音频帧泵只在 `session.ts:272`；headless 完全没有（且 `HeadlessScene` 无 `audio`）。
- [ ] **H4** 悬停在 headless 从不执行：`serviceAdvanceWait` 只在 `session.ts:206`；`forceAdvance` 不做命中测试、不看 `routes.shown` ⇒ `routes.cursor` 恒 −1。

### 死代码 / 文档

- [ ] **D1** `interpreter.run()` 无导入者（第 6 份循环）。
- [ ] **D2** `Engine.pickHoverLabel()` 在 `src/` 零调用者。
- [ ] **D3** 文档称"Pixi ticker 每帧驱动渲染"，实现里 `startFrameLoop` 只记 `wallStart`。

## 5 条未确认项（先核实，再决定改不改）

1. `PixiBackend.waitFlags` 粘滞**是否有意**：无注释、无测试。核实法：给 `setWaitFlag`/`needsRender` 各加一行计数日志跑 `npm run shot -- --gamestart`，看 `0x21C` 之后 present 频率是否 100%；并回 `.c` 核对引擎清 `_+174801 & 0x400` 的时机。
2. **chains 不推进动画窗是否已经影响现有断言**：在 `run` 里临时加 `native.advance(clock)`，跑 `config1-chain` / `game-start-chain` / `scene-report` 三个测试看取值变化。
3. `report` 的 `SLEEP_GATE` 是否**真的**永不满足（`src` 里该位的读者只有 `session.ts:178` 与两份 chain）：跑 `npm run report` 后打印 `e.sleepUntil`。
4. headless 下 `cell`（▼）**是否出现在快照文本里**：`npm run report` 后 grep `.tmp/*.txt`。
5. `refactor-plan` 里给的行号与当前源码不完全对应（本文用实测行号）⇒ 是否需要重算。

## 纪律

- 每条工单落地时：**先写 before/after 对照**（写进本条票的 `changes.md`），再改代码；
- 改动若落在 `report.ts` 之外，跑 `npm test` 全绿即可；若动到 `session.ts`/`pixiBackend.ts`，
  **必须**跑 `npm run shot -- --gamestart` 目视（G4）并说明看了哪几张截图。

## 2026-09-13

第 3 批（changes.md）：A2 口径订正 —— 门判据（scGateAnimationsDone：mesh 全窗 + draw item 颜色窗）与合成判据（scAnimationsPending：5 窗）拆开。原因：序章 80 000 ms 平移窗把门钉死；引擎门真值见 T-0024。判据 npm test 439/439。

## 2026-09-13

第 4 批（H2，T-0013）：宿主能力面入桥 —— needsRender/animationsDone/preloadImage 进 NativeBridge + 闸门 A 白名单；pixi 的 sceneAnimationsDone 改名 animationsDone；session 的 #native 改 NativeBridge 类型；两条能力面守卫 + 负向实测。B2 工单现状：§1.2 第 1/11/12/13/14 条全部 ✅ 或 ⏸（C2 决策），第 9/10 条属 B3。

## 2026-09-13

第 5 批（D5）：音频帧泵所有权归驱动（frame/loop.ts 的 audio 档）+ report 显式 never。产品路径 session.#present 里那一处 tick 暂留，B4/T-0004 迁移时必须删（否则双 tick）。

## 2026-09-13

第 6 批（B3 的一部分，登记在此以免与 B2 的账脱节）：场景脏位从宿主私有搬进共享模型（SceneState.dirty）+ 驱动 present:"needsRender" 档。pixi 仍用自己的 sceneDirty（本轮不动；B4 可并入）。

## 2026-09-13

收口：changes.md 顶部补"14 条工单总表"（每条 → 结果 → 落在哪一批/票据 → 证据），并按 acceptance 三条自查：① 对照表齐 ② report sha256 FBC05509… 逐字节不变（B1/B2 每批后复跑）③ §1.2 十四条里第 10 条（悬停）按设计归 B3。B2 到此结束，后续按 T-0003 → T-0004 → T-0005 推进。
