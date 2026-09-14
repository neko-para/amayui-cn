# T-0024 · 过程文档（changes.md）

## 2026-09-14

## 第 1 次变更（2026-09）：把 `0x400` 门的真值建进引擎（`sub_407E20` 全语义）

### 改了什么（按文件）

| 文件 | 改动 |
|---|---|
| `src/vm/engine.ts` | 新增 `gateWaitStart`/`gateWaitMs`（= `Scene+46520/46524` = `Engine[92338]/[92339]`）、`scenePending`（池挂起位 `46516`）、`sceneFreeze`（`46512`）；方法 `gatePending`（= `sub_407E20` raw 12762-12786 逐行）、`serviceWaitGate`（主循环 raw 21109-21152）、`skipWaitGate`（= `sub_407EA0` raw 12789-12801） |
| `src/vm/handlers/gfx-state.ts` | `0x238` 的 handler `op_set_canvas_size` → `op_load_wait_timer`：写上面两格（旧的"画布/视口尺寸"是**无依据**的旧名，已订正；`engineValues` 同两格照旧写） |
| `src/frame/loop.ts` | 门分支改成引擎语义（`e.serviceWaitGate(nowMs)`，raw 21151）；帧末 `advanceModel` 之后锁存 `e.scenePending = !e.sceneFreeze && host.poolPending()` 并按 raw 130427 清冻结位；`adv` 分支补 `e.skipWaitGate()`（raw 21161） |
| `src/frame/host.ts` | `animationsDone?(nowMs)` → `poolPending?()`（**无参**：宿主只报"本遍池是否挂起"；门由引擎判） |
| `src/renderer/scene/ops.ts` | **删** `scGateAnimationsDone`（"只看窗 0"的口径）；**增** `scPoolPending`（raw 117843-117844 的 `+720` bit0 排除）；`scSetDrawEntryParam`（`0x242`）现在真的写 `DrawItem+720` |
| `src/renderer/drawitem/model.ts` | `Item` 增 `entryParam`（`+720`） |
| `headlessScene.ts` / `headlessFrameHost.ts` / `pixiBackend.ts` / `session.ts` / `scenario.ts` / `vm/native.ts` / `vm/nativeTap.ts` / 两份 chain / `run.ts` | 接口改名与接线同步；`session.#onGate` 的日志判据改为问同一个引擎函数（不再是"第二份判据"） |
| `src/tools/gameStartChain.ts` | 新增 `gateWaits` 观测（`onGateWait`/`onFrameEnd`）⇒ 每道 `0x400` 门的**驻留毫秒 + 引擎里装着的计时器**都进结果（acceptance ③ 的证据来源） |

### 判据（验收 ①②③④）

1. **计时器定律**：`wait-gate-timer.test.ts` 的三条单测（未到点不放行 / 恰好 `start+dur` 仍不放行（raw 12776 是 `>`）/ 到期放行并清两格；冻结 ⇒ 立刻到期）。
2. **门与"扫动画窗"解耦**：门的唯一判据 = `Engine.gatePending`（池挂起位 + 计时器）；`scPoolPending` 的排除项有 raw 117843-117844 依据，不再是"5 窗 / 窗 0"的口径猜测。
3. **真实语料（E3）**：`gateWaits` 表见 `notes.md` §6.2 —— 装了 `i238` 的门驻留逐条等于脚本值（5500/100/2000/200 ms）；`SN0000.txt:1048` 那道门驻留 100 ms，旁边就是 80 000 ms 慢推（`:1043`）+ `i242`（`:1045`）；版权页 5 s 是 mesh 颜色窗（`LOGO.txt:44`），`timer=0`。
4. **对照守卫**：同一个慢推**不写** `i242 … 1` ⇒ 池挂起位把门钉住（`stopReason='cap'`，0x400 位一直留着）——证明"门之所以开"是排除项在起作用，而不是"门的窗口范围恰好不含平移窗"。

### 守卫

- `app/amayui-emulator/test/wait-gate-timer.test.ts`（新：计时器定律 / 冻结 / 80 000 ms 慢推两态对照 / 序章锚点棘轮）
- `app/amayui-emulator/test/anim-window-done.test.ts`（`scPoolPending` 口径 + `i220`+`i242`+`i238`+`wait` 证据棘轮）
- `app/amayui-emulator/test/frame-loop.test.ts`（`'wait'` 档：池挂起位是**绘制期锁存量** ⇒ 门比"帧首现问宿主"晚一帧，已按引擎次序改断言）
- `app/amayui-emulator/test/headless-needs-render.test.ts`（只读白名单：`scGateAnimationsDone` → `scPoolPending`）
- `app/amayui-emulator/test/native-tap.test.ts`（桥能力面：`poolPending` 两宿主都必须实现）
- `app/amayui-emulator/test/game-start-chain.test.ts`（真实语料：仍能经那道门进入 SN0000 首文案）

判据：`npm run verify` 全绿（498 tests + 无新增死写）。

### 台账同步（同一轮）

- 第一层 `analysis/functions.json`：新增 `sub_407E20`（`gateWaitPending_407E20`，ANALYZED）、`sub_407EA0`（`forceFreezePool_407EA0`，ANALYZED）；订正 `sub_4248C0` 的 purpose；给 `sub_49AA30` 补上"池挂起位 + `+720` 排除 + 冻结豁免"三条 raw 依据。
- 第二层 `analysis/engine-capabilities.json`：`scene-pending-flag-0x400-gate` → `modeled-verified`/E3/guard；`scene-freeze-flag` 与 `bullet-dirty-from-freeze-or-pending` 的 note 订正（残余缺口点名）。`node scripts/build-capabilities.mjs` 已跑。
- 第三层 `analysis/scripts.json`：`SN0000` 增一条 layout（`1043-1048`，锚 `i242 (global-int f8023) 1`）、一条 invariant（门驻留 = `i238`）、一条 gotcha（慢推后必须紧跟 `i242`）。`node scripts/build-scripts.mjs` 已跑。
- 文档：`docs-new/03-engine/opcode-table.md` 的 `0x238` 行"emulator 缺口"→ 已建模 + E3 数字；`docs-new/03-engine/copyright-effect.md` 的 `0x400` 行补 emulator 状态与"版权页 5 s 来自 mesh 窗"。
- 关联票：`T-0009` 的 evidence 锚点（指向已删的 `animationsDone`）已刷新；`T-0013`/`T-0027` 的 evidence 锚点与 note 同步（改名 + 行号漂移）。
