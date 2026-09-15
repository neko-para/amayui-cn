# T-0010 · 过程文档（changes.md）

## 2026-09-15


## 第 1 次变更（2026-09，实施）

### 改了什么
1. `src/report.ts`：把驱动口径抽成**可导出的纯函数** `reportLoopOptions(w: ReportLoopWiring)`（`runSceneReport` 是唯一调用者）——
   守卫才能用合成脚本驱动"真的这份配置"（见下）。
2. **门档**：`gates` 由 `{ anim: 'ignore', sleep: 'ignore', advance: 'force' }` 改为
   `{ anim: 'wait', sleep: 'wait', advance: 'force' }`。
3. **门分支记帧**：`onFrameEnd` 的"本帧不派发、只让时钟前进"集合由 `text-reveal|advance` 扩到
   **`+ anim|sleep`**。依据 = 引擎主循环 raw 21109-21152：`0x400`/`sleep` 分支本帧什么都不派发、
   只有时钟前进；而 report 的时钟只在帧边界走 ⇒ 不记帧就永远到不了 `sleepUntil`。
4. 新增 `ReportLoopWiring.boundaryEverySteps`（= 原来的 `ReportOptions.maxStepsPerFrame ?? 4096`），
   并写明**它和驱动的 `maxStepsPerFrame` 是两个数**（驱动那份是 1）。

### 依据（引擎真源）
- `0x400` 门真值 = `sub_407E20`（raw 12762-12786）：`0x238` 装载的等待计时器未到点 ⇒ 一律"还在等"；
  计时器为 0 时看池挂起位。emulator 对应 `Engine.gatePending/serviceWaitGate`（`src/vm/engine.ts:456-477`）。
- `sleep(0xC8)` = 帧让步到 `nowMs >= sleepUntil`（`opcode-table.md` 的 0xC8 行）。
- 语料确实会踩：`src/$1$SC0330.txt:573 sleep 1f4`（500ms）、SC0330/SC0820 大量 `i238 <ms>`。

### 判据 / 守卫
`test/scene-report.test.ts` → `★report 的驱动口径：sleep 门真等满虚拟时钟、0x400 计时器真被等满（T-0010）`：
用 `test/harness.ts` 的合成脚本驱动 `reportLoopOptions()` 真配置，断言
① `i0c8 500` ⇒ `clock ≥ 500`、`frames ≥ 31`、`SLEEP_GATE` 清；
② `i238 200`+`i21c` ⇒ `clock ≥ 200`、`0x400` 清；
③ 裸 `i21c` ⇒ 位清且不多等；
④ **阈值陷阱**：300 条 nop 默认 0 帧、`boundaryEverySteps: 2` 时 100 帧。
★**已验证"去掉修法即红"**：把 `consumesFrame` 里的 `anim|sleep` 去掉后，本用例立刻以
`sleep 门：不得因门永不放行而跑满帧上限` 失败（`maxFrames: 2000` 兜底 ⇒ 失败而不是挂死）。

### 实测 before/after（合成脚本，report 口径）
| 脚本 | 修前（`ignore`） | 修后（`wait` + 门分支记帧） |
|---|---|---|
| `i0c8 500` + 2×nop | steps 3 / frames 1 / clock **16ms** / 位留 `0x20000000` | steps 3 / frames 34 / clock **544ms** / 位清 |
| `i238 200`+`i21c` + 2×nop | steps 4 / frames 2 / clock 32ms / 位留 `0x400` | steps 4 / frames 16 / clock **256ms** / 位清 |
| `i21c` + 2×nop | steps 3 / frames 1 / 位留 `0x400` | steps 3 / frames 2 / 位清 |

### 零连带改动的证据
`src/report.ts`（`--steps 120000`，script 0）修前/修后**逐项一致**：
`执行 120000 条指令 / 29 帧 / 时钟 464ms（steps-limit）`（该路段 `0x21c/0xc8/0x238` 命中 0 条，
`.tmp/t10probe.jsonl` 为空）⇒ `scene-report` 的 `meta` 与快照零 diff。

### 顺手修掉的坑
抽函数时把帧边界阈值误写成 1（与驱动的 `maxStepsPerFrame` 撞名）⇒ script 0 的
`frames` 29→**60000**、`clockMs` 464→**960000**。已引入 `boundaryEverySteps` 并在守卫里钉住
（④ 那条），注释里写明这两个数不是一回事。

### 未收敛（本票不含）
池挂起位那一半仍未建模：report 用 `present: 'never'` ⇒ `e.scenePending` 恒 false ⇒
`serviceWaitGate` 立刻放行（只有 `0x238` 计时器能挡住）。要让 `0x400` 真的等"动画跑完"，
report 得走 `present: 'host'` + `advanceModel`/`poolPending`（帧模型变更）——归 `T-0013`/`T-0025`。
