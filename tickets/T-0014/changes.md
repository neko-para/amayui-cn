# T-0014 · 过程文档（changes.md）

## 2026-09-15


## 第 1 次变更（2026-09，实施：收口）

### 票面核查（实施前先核了一遍，三条已落地）
| # | 票面要求 | 实况 |
|---|---|---|
| 1 | 删 `interpreter.run()` / `RunResult` | **B1 时已删**（`src/vm/interpreter.ts:208` 的注释记录了这次删除；`src/` 无 `.run(` 命中） |
| 2 | 删 `HeadlessScene.waitFlags` | **T-0008 时已删**（`src/renderer/headlessScene.ts` 的 `setWaitFlag(_mask)` 是空实现 + 注释） |
| 3 | 删 `PixiBackend` 的 `waitFlags` 镜像 | **T-0008 时已删**（只标脏 + 日志；且已有源码棘轮 `test/anim-window-done.test.ts`） |
| 4 | 删 `Engine.pickHoverLabel()` | ★本次实施 |

### 第 4 条做了什么
1. `src/vm/engine.ts`：删掉 `pickHoverLabel()` 方法（连同它的文档注释）；把那段注释里**仍然有效**的
   内容（悬停门控的正确极性、汇编核对结论、"不在这里做命中测试"）搬到 `hoverDispatchAllowed()` 上，
   并写明"消费点只有两处：产品 = `serviceAdvanceWait()`，测试 = `test/harness.ts` 的门面"。
2. `test/harness.ts`：新增 `pickHoverLabel(e)` 门面 —— 逐字复刻产品路径那一对调用
   （`if (!e.hoverDispatchAllowed()) return -1; const l = e.routes.nextHoverLabel(); return l === 0xffffffff ? -1 : l;`）。
3. `test/adv-msgwin.test.ts`（9 处）与 `test/route-dispatch.test.ts`（7 处）：`e.pickHoverLabel()` →
   `pickHoverLabel(e)`，并从 `./harness.js` 引入。

### 判据 / 守卫
- **行为**：`adv-msgwin` + `route-dispatch` 共 **44/44** 绿（条数与修前一致）⇒
  `hoverDispatchAllowed()` 的门控（右键 / 滚轮键 + `ReDrawTextOnKey` / `i1bb 0`）与 `route.ts` 的
  两段式状态机（先发旧项"离开"、下一帧发新项"进入"）覆盖一条没丢。
- **源码棘轮**（新增，`test/anim-window-done.test.ts`）：剥注释后断言 `src/vm/engine.ts` 里
  **不再有** `pickHoverLabel`，同时断言产品路径那一对调用（`hoverDispatchAllowed()` +
  `nextHoverLabel()`）**仍在** —— 防止"删门面时把产品路径一起删掉"。
- `npx tsc -p tsconfig.json --noEmit` 干净（`src/` 里已无该 API）。

### 注记
`src/` 里 `grep pickHoverLabel` 只剩 `engine.ts` 的**注释**提到它（记录这次删除的来历）——棘轮已剥注释，
台账 anchor 也因此改指 `hoverDispatchAllowed`（见 `ticket.json` 的 evidence）。
