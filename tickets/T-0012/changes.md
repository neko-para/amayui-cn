# T-0012 · 过程文档（changes.md）

## 2026-09-15


## 第 1 次变更（2026-09，实施：补守卫）

### 真实卡点（本票 3 个月没动的原因）
`src/run.ts` 结尾是**无条件** `main().catch(...)` —— 与 `report.ts` 的"直接执行才跑 CLI"守卫不同，
**测试 import 它就会把整个 CLI 跑起来**（读 overlay、写 INI、跑 300 条…）⇒ 既做不了单元断言，
也拿不到那份配置。**这就是"run.ts 是 CLI、没有测试面"的实际内容**。

### 改了什么（纯搬移 + 一处守卫，零行为变更）
1. `src/run.ts` 结尾加与 `report.ts` 同形的直执行守卫
   （`path.resolve(process.argv[1])…=== fileURLToPath(import.meta.url)…`）。
2. 把驱动口径抽成 `export function runLoopOptions(w: RunLoopWiring): FrameLoopOptions`：
   `gates: { anim: 'clear', sleep: 'wait', advance: 'force' }`、`services` 两个都开、`advFrame: true`、
   `maxStepsPerFrame: 20000`、`until`/`stopAfterStep` 同时看 `STEPS`、`onFrameEnd` 推时钟——**逐项照抄**。
3. `main()` 改成只提供接线（`maxSteps`/`executed`/`beforeStep`/`afterStep`/`onAdvanceGate`/`onFatal`/
   `advanceClock`），打印内容与顺序一字不改。

### 判据 / 守卫
`test/run-cli-loop.test.ts`（新，6 条）：
- ★**能 import 而不执行 CLI**（守卫前提；若 `main()` 改回无条件执行，这条立刻变成"跑整个 CLI"）；
- **C1**：每完整帧时钟恰好 `+1000/60`；`sleep 100` 能被等满（修前时钟冻结 ⇒ `sleep` 永不放行）；
- **C3/C4**：逐字帧的顺序必须是 `winReveal → charGrid → textReveal`（修前逐字分支在最前、且没有 charGrid）；
  `charGrid` 每帧都跑；把 ADV 位置上时门必须选 `'adv'`；
- **B2**：`STEPS=3` ⇒ 恰好 3 条（不是一整批 20000）；
- **棘轮**：`opt.gates` 与 `session.ts` 的 `PRODUCT_FRAME_POLICY.gates` 逐项相等，**只允许两处宿主缺口**：
  `anim`（`StubNative` 无场景模型 ⇒ 无 `poolPending`，`T-0013`）与 `advance`（headless 无输入源 ⇒ `force`）；
- ★**直执行守卫的另一半**：子进程 `tsx src/run.ts --no-save-config --no-save-data` + `STEPS=1`
  ⇒ stdout 必须含 `共执行 1 条指令`（守卫条件写错的形态是**静默**的：`npm run run` 变空操作而单测全绿）。

★**已验证"去掉修法即红"**：把 `onFrameEnd` 里的 `advanceClock()` 去掉（= 修前 C1 的形态），
`C1` 与 `C3/C4` 两条立刻失败。

### 实测
- `STEPS=300 npx tsx src/run.ts` ⇒ `共执行 300 条指令（其中引擎内部/子系统 8 条已插桩跳过；
  等待推进门自动放行 0 次）。cur=1 caller=0`，与改动前**逐字一致**（纯搬移的判据）。
- 冒烟测试成本：子进程 ≈ **0.15s**。

### 未收敛（本票不含）
`gates.anim` 仍是 `'clear'` 而非产品档 `'wait'` —— 归 `T-0013`（宿主能力面入桥：要让驱动能统一问
"这个宿主能不能报池挂起位"）。棘轮里已把这条差异**显式化**，等 `T-0013` 落地后应当变成
"CLI 与产品门档完全相等"（那时把 `anim: 'clear'` 从守卫里去掉）。
