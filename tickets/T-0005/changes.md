# T-0005 · 过程文档（changes.md）

## 2026-09-13

## 第 1 次变更（2026-09-14）—— Scenario 统一 + --record/--replay 回放器（G3 落地）

### 改了什么

| 文件 | 改动 |
|---|---|
| `src/frame/scenario.ts` | 增**可序列化的 Scenario**：`ScenarioSpec`（`name`/`boot`/`clock`/`gates`/`maxStepsPerFrame`/`maxFrames`/`events`）+ 三种时钟策略（`wall`/`fixed`/`replay`）+ 数据事件（`cursor`/`press`/`release`/`wheel`/`note`，判据 `atFrame`/`atMs`/`afterMarker`+`settleMs`）+ `ScenarioScheduler` + **`runScenario`**（两个跑手共用：时钟包装 `wrapHostClock`；输入由事件或回放快照提供） |
| `src/frame/trace.ts` | **新增**：轨迹格式（头 + 逐帧 `{f,t,input,digest,tex}`）、`TraceRecorder`（观察者）、`parseTrace`、`traceToSpec`、**`runReplay`**（逐帧恢复输入 + 比对 engine 段 + 给出首帧差异） |
| `src/vm/input.ts` | `snapshot()`/`restore()`（**帧首状态**快照：脚本是轮询式读输入，帧首状态足以整帧复现） |
| `src/renderer/headlessFrameHost.ts` | **新增**：headless 宿主 → `FrameHost` 的唯一接线（修前每条链路各接一遍 ⇒ "chains 从不推进动画窗"就是那么来的） |
| `src/tools/scenarioBoot.ts` | **新增**：headless 启动装配（照做 Electron 的 `boot.ts`：INI/选项/SAVE.DAT/音乐表/首脚本），回放才能从**同一初始状态**起步 |
| `src/tools/scenarioRun.ts` | **新增** CLI：`npm run scenario -- --scenario <spec.json> [--out X.jsonl]` |
| `src/tools/replay.ts` | **新增** CLI：`npm run replay -- <trace.jsonl[.gz]>`（gzip 按魔数识别；退出码 0/1） |
| `electron/{paths,logging,preload}.ts`、`src/renderer/ipcProtocol.ts` | `append-replay-line` 通道 + **gzip** 轨迹落盘（每帧约 12KB ⇒ 2000 帧 ≈ 25MB 纯文本，压缩后 ≈300KB）+ `will-quit` 排空（gzip 尾部缺失=整份不可解） |
| `src/renderer/renderer.ts` | `AMAYUI_RECORD=1` 时**从启动第一帧**挂 `TraceRecorder`（经环境变量，不是"主进程发一条开始录制"——那样帧 0 已在 TITLE，回放对不上） |
| `tools/record.cjs`、`tools/scenarios/gamestart.json` | **新增** Electron 跑手：按同一份 Scenario 用 `sendInputEvent` 注入**真实 DOM 输入**（与真人同一条链），`afterMarker` 等日志标记而不是睡固定秒数 |
| `package.json` | `record` / `replay` / `scenario` 三条脚本 |

### "一份 Scenario 两个跑手"到底共用什么（说清楚，别夸大）

- **共用**：`name` / `boot.script` / `clock` 策略 / `gates` / `maxStepsPerFrame` / `maxFrames` / `events`
  （`atFrame`/`atMs` 两宿主同义；`afterMarker` 是**同一谓词的两种观测**：Electron 看日志标记 `-> SN0000.BIN`
  —— 它只有这个可观测；headless 看 `e.curScript().name` —— 引擎状态）。
- **不共用**：`clock: {kind:'wall'}` 只有 Electron 能跑（它才有墙钟）；headless 跑手把它当固定步长近似并在输出里标注。
- **等价性的正式判据不是"跑同一份 spec"，而是 G3**：Electron 录下**时钟+输入**（+ `0x208` 的答案），
  headless 复现同一 digest 序列。spec 只负责"做什么操作"。

### ★`0x208`（纹理尺寸）为什么也录进轨迹

它是**宿主给出的输入**，不是引擎语义：`pixiBackend.getTextureSize` 走 IPC 异步 ⇒ 图还没载入就是 `0×0`，
而脚本拿它算**源矩形/描画位置**（G3 实测：SN0000 背景的 `src`/`dst` 全不同）。
headless 没有加载过程，"自己解析 AGF 尺寸"只是对那个异步答案的近似 ⇒ 录下来按帧喂回去
（`HeadlessScene.setTextureSizeAnswers`；按 slot 匹配的队列）。
**缺口登记**：让 headless **自带** AGF 尺寸解析（不靠录制）是独立事项，见本票 `notes.md`。

### 判据（实测）

- `test/scenario-replay.test.ts` **7/7**：G1 确定性 / 调度器语义 / 坏 spec 必须抛 /
  **录制→回放往返**（engine 段逐帧相等）/ **负向控制**（改一帧 digest ⇒ 指名首帧与字段）/
  **帧数少跑被发现** / `traceToSpec` 取样一一对应。
- **真语料自洽**：headless 跑 9000 帧 gamestart 场景（固定时钟）→ 录制 → **回放 9000 帧逐帧相等**。
- **真 G3（Electron→headless）**：3047 帧逐帧相等（细节与三处分叉见 `T-0004/changes.md`）。
- `emulator.md` §7.1 新增**闸门清单**：改哪些文件必须跑 G1/G3/G4，以及"关键行 ≠ 诊断量行"。
