# T-0012 · 过程文档（notes.md）

## 2026-09-15


## 研究（2026-09，动手前）

### 结论
**代码已经修完（B2 第 2 批），本票现在只剩"补守卫"**；而"守卫一直没补"的**真实卡点**此前没写下来：
`src/run.ts` 结尾是**无条件** `main().catch(...)`（`run.ts:212`），**没有** `report.ts:379` 那种
"直接执行才跑 CLI"的守卫 ⇒ **测试 import 不了它**，于是既做不了单元断言，也没法把配置抽出来复用。

### 现状（代码核查）
- 四处漂移已收敛，`run.ts:138-150` 的注释逐条登记：C3 顺序（改用驱动产品序）、C1 时钟（每帧末 `+= 1000/60`）、
  C4（`services` 两个都开 + `advFrame: true`）、G3（吃驱动的统一门）。
- 实测：`STEPS=300 npx tsx src/run.ts` → `共执行 300 条指令`（修前会跑成 20000 条），
  耗时 **0.45s**（含 tsx 启动）⇒ 冒烟测试成本可接受。
- `gates.anim` 仍是 `'clear'` 而非 `'wait'`，依据在 `run.ts:147-149`：CLI 宿主是 `StubNative`（**没有场景模型**）
  ⇒ `host.poolPending` 无从计算；`host.ts:52-58` 也写明"未实现 ⇒ 只等 `0x238` 计时器"。
  ⇒ 这是**宿主能力缺口**（`T-0013`），守卫里**不得**把 `anim` 断言成 `'wait'`。

### 守卫方案（推荐 A，B 可一起做）
**A. 行为守卫（无子进程，主判据）**
1. 给 `run.ts` 加与 `report.ts` 同形的直接执行守卫（`if (process.argv[1] && … === fileURLToPath(import.meta.url)) main()…`）；
2. 把驱动配置抽成 `export function mkRunLoopOptions(deps)`（deps = 要注入的钩子：`host`/`maxSteps`/
   `onStepTrace`/`markScript`/`advanceWaits++`/`lastInstr`）——**纯搬移**，CLI 行为零变化；
3. 测试用 `test/harness.ts` 的 `instr` + `Engine(new StubNative())` 合成脚本 + `runFrameLoop` 断言四处漂移：
   - **C1**：跑 N 帧后 `clock == N × 1000/60`；`i0c8 100` 的脚本能在 ~7 帧后自然放行（修前"只在逐字分支 +16"⇒ `sleep` 永不满足）；
   - **C4**：`onGate` 序列里能看到 `adv` 分支，且 `serviceCharGrid` 被调（用调用计数桩）；
   - **C3**：`textRevealing` 的帧里 `serviceWinReveal` 必须**先于** `serviceTextReveal`（钩子顺序断言）；
   - **B2**：`stopAfterStep` 恰好停（`STEPS=1` 只派发 1 条）。
4. **棘轮（"= 产品语义"的机械判据）**：`assert.deepEqual({ ...RUN_GATES, anim: 'wait' }, PRODUCT_FRAME_POLICY.gates)`
   —— `PRODUCT_FRAME_POLICY` 已从 `src/renderer/app/session.ts:54` 导出，两边门差异**只允许** `anim`
   （`'clear'` vs `'wait'`，理由见上），其余任何漂移即红。
**B. CLI 冒烟（可选，0.45s）**：`spawnSync(process.execPath, ['--import','tsx','src/run.ts'], { env: { ...process.env, STEPS:'300' } })`
→ 断言 stdout 含 `共执行 300 条指令`；用 `stdio: ['ignore','pipe','pipe']` + 30s 超时（仓库测试原本没有任何子进程用法，
这是第一条，故建议放在 A 稳定之后再补）。

### 顺带发现（同一处代码，非本票缺陷）
`run.ts` 的 `onGate('advance')` 里仍调 `e.forceAdvance()`，而驱动在 `gates.advance === 'force'` 时**自己也会调一次**
（`src/frame/loop.ts:271`）⇒ 每次等待门 `forceAdvance` 被调两次。**目前无害**：`forceAdvance` 开头
`if (!this.awaitingAdvance) return null`，第一次调用就把位清掉（`src/vm/engine.ts:1140/1143`）⇒ 幂等。
但它是"同一件事两处实现"的典型（`T-0008` 的教训）。A 方案抽函数时顺手收敛：`onGate` 只记账，
跳转结果从 `e.lastDispatch.kind === 'headless'`（`engine.ts:1147`）读；或保留调用并**写明幂等理由**。

### 验收
`test/run-cli-loop.test.ts`（新）全绿 + `npm run verify` 全绿；`STEPS=300 npm run run` 输出**逐字不变**（纯搬移的判据）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

（2026-09-14 B2 第 2 批）代码已修：run.ts 现在经 runFrameLoop 跑 —— 产品顺序 + 每帧时钟 + 两个每帧服务 + ADV 分支 + 门。
- 实测：STEPS=300 恰好 300 条（修前 20000 条：cap 只在帧边界判；这正是新加的 stopAfterStep 解决的）。
- 仍 doing：守卫待补。run.ts 是 CLI（只被 npm run run 调用，没有测试面）⇒ 按纪律不能标 done。
  两条候选：① 把它的驱动配置抽成可导出的常量/函数，用单测断言"= 产品语义"；② 给 CLI 写一个 spawnSync 冒烟测试（注意沙箱下"捕获子进程管道输出"可能被拒，需 stdio: ignore + 退出码判据）。已登记进 T-0020（测试结构）。
