# 04-app · 帧循环统一设计（提案）

> **目标**（用户要求，2026-09）：把 emulator 的"帧"从**5 份实现（+1 份死代码）**收敛成**1 份共享驱动**；
> 让 **Electron 层退化为纯粹的交互 + 渲染（宿主）**，并让 **headless 能提取（记录/断言）与 Electron
> 完全一致的对外表现**。
>
> **状态**：✅ **B1–B5 全部完成（2026-09-14）**。本文是设计与验收判据的真源；每批的实施证据在
> `tickets/T-0001`..`T-0005` 的 `changes.md`，闸门清单在 `emulator.md` §7.1。**本文不改变任何行为**；
> 实施按 §6 分批，每批一个闸门（判据 + 回滚点）。
> 关联：`emulator-refactor-plan.md` §8 #3、§10 #1（本设计是那一条的展开）。
> 事实来源：`.tmp/frame-loop-divergence.md`（只读代理的**穷尽**差异清单，287 行、全部带 file:line）+
> 本文作者逐处复核。**§1 的每一行都有 file:line，可逐条核对。**

---

## 0. 现状盘点

### 0.1 六份循环（第五份是死代码）

| 循环 | 位置 | 每帧批上限 | 时钟 | 门 | 场景推进 | present/发布 |
|---|---|---|---|---|---|---|
| **Electron 主循环**（唯一产品路径） | `session.ts:161-258` | `SAFETY_PER_FRAME=10000`(`:33`) + 总 `MAX_STEPS=1e8`(`:35`) | 真实 `performance.now()`(`:168`)；**场景模型时钟另算**：`pixiBackend.ts:705` | `0x400` → 等 `sceneAnimationsDone()`(`:279`)；`SLEEP` → 等 `nowMs>=sleepUntil`(`:294-296`) | pixi 在 `present` 内推进窗（`pixi/presenter.ts:56`） | `#present()`(`:268-274`) = `texturesIdle` → **`audio tick`** → `present()` |
| `report.ts` | `:158-239` | 4096(`:108`) | 虚拟 `clock`，`frameMs=16`(`:107`) | **无 `0x400`/`SLEEP` 分支** | **唯一显式调 `advance()`** 的 headless 循环(`:176,184,231,237,240`) | 末尾一次 `snapshot()`(`:267`) |
| `config1Chain.ts` | `:351-393` | 5000(`:372`) | 虚拟 `clock += 1000/60`(`:390`) | **`0x400` 每帧无条件清**(`:359`)；`SLEEP` 等 `clock>=sleepUntil`(`:360-361`) | **从不推进**（grep 无 `.advance(`） | `sampleNow()` 按需 `snapshot()`(`:319,321,324`) |
| `gameStartChain.ts` | `:419-458` | 20000(`:439`) | 虚拟 `clock += 1000/60`(`:455`) | **`0x400` 每帧无条件清**(`:426`)；`SLEEP` 同上(`:427-428`) | **从不推进**（注释自陈 `:136-137`） | 返回时读 `scene.*`(`:320,335-366`) |
| `run.ts`（CLI/`StubNative`） | `:135-190` | 无内批（每轮 1 条） | `e.nowMs += 16` **只在逐字分支**(`:145`) ⇒ 其余时间**冻结** | 无 `0x400`/`SLEEP`/`advActive`/`serviceCharGrid` | 从不推进 | 无 present/快照 |
| `interpreter.ts` 的 `run()` | `:221-237` | `steps` 参数 | — | — | — | **死代码：全仓无导入者** |

另有 **5 处测试自造近似循环**：`title-exit.test.ts:47-66`、`config-version-substr.test.ts:274-290`、
`gallery-bgm-list.test.ts:236-255`、`save-data.test.ts:415-432`（**时钟恒 0**）、`adv-msgwin/char-reveal`
的服务单循环（`adv-msgwin.test.ts:450-534` 等）⇒ **E3 通过 ≠ Electron 表现一致**。

### 0.2 两个宿主

- `HeadlessScene`（415 行）：`NativeBridge` 子集 + `advance/snapshot/snapshotText/slotTable`。
  **桥方法集合是 pixi 的真子集**（没有一个 headless 独有的桥方法）。
- `PixiBackend`（837 行）：`NativeBridge` 超集 + `present(:698) needsRender(:686) poolPending(:742)
  startFrameLoop(:691) preloadImage(:179) texturesIdle(:263) audio(:194) playMovie(:632) debugAudio(:199)`。
  ★2026-09（`tickets/T-0013`）**已修**：`needsRender`/`poolPending`（原名 `sceneAnimationsDone` → `animationsDone`
  → `poolPending`，见 `T-0024`）/
  `preloadImage` 三者已进入 `NativeBridge`(`native.ts`) 与 `withNativeTap` 白名单(`nativeTap.ts` 的 `BRIDGE_METHODS`)；
  宿主能力差异由守卫 `test/native-tap.test.ts` 的两条钉住（桥方法差异必须等于 `DECLARED_HOST_DIVERGENCE`、
  非桥方法必须登记在 `NON_BRIDGE`），`RendererSession.#native` 也已改成 `NativeBridge` 类型
  ⇒ "会话偷偷用宿主私有方法"现在会**编译期**报错。
- **模型已共享**：两侧 import 同一批 `scene/ops.ts` 的 `sc*`（`headlessScene.ts:14-61` vs
  `pixiBackend.ts:32-74`，同一函数名清单）；排版唯一实现 `scene/ops.ts:432-441`；动画窗唯一实现
  `drawitem/animWindow.ts:60-72`；消息窗载荷同源 `handlers/msgwin.ts:195-206`；`assertFlags` **已下沉**
  （`scene/ops.ts:65,188`）——`refactor-plan` §8 #4 那条已过期。

**结论：分叉只在「帧驱动 + 宿主义务 + 时钟 + 观察者」四处；模型层不用动。**

---

## 1. 分歧清单

### 1.1 刻意的（有依据 ⇒ 保留但**参数化/接口化**）
批上限（`session.ts:25-33` 明说非引擎语义）；headless 的确定性虚拟时钟（`report.ts:12-14,49-50`，
`scene-report.test.ts:56-63` 要求逐字节可复现）；`forceAdvance` 与真泵的差异（`engine.ts:964-975`，
含"压返回点会让 SN0000 跳过暗幕装配"的实测依据）；纹理帧屏障（`session.ts:259-267`，IPC 异步 vs 引擎同步）；
pixi 的留帧策略（`pixiBackend.ts:84-89,660-671`）；`0x6E` 后的 `SLEEP_GATE` 节流（`handlers/msgwin.ts:370-376`）。

### 1.2 漂移 / 缺陷（无理由说明，或说明与实际不符）← **B2 的工单**

> 状态列（2026-09，B2 进行中）：✅ = 已修 + 有守卫/实测；⏸ = 决策为刻意保留（登记）；⬜ = 未做（属 B3/B4）。
> 每条后面的 `T-00xx` 是票据号，`changes.md` 里有 before/after。

1. `report.ts` **完全没有** `0x400`/`SLEEP` 分支 ⇒ 置上后**永不清**、`sleep` 永不满足（`:158-239`）。⏸ **C2 决策**：report 是**指令驱动**的 tracer（帧边界由 `FRAME_OPS` 定），不假装是"产品的帧"；等价性由 B5 的 replay runner 证（`T-0010` 记录该决策）。
2. `run.ts` 没有 `serviceCharGrid`/`serviceAdv`/`advActive` 分支；逐字分支排在 `serviceWinReveal`
   **之前**、且两者永不同帧（`:143-149`）。✅ 已接共享驱动（`T-0012`，逐条停 + 每帧时钟前进）。
3. 两份 chain **无条件清 `0x400`** ⇒ 等价于"动画瞬间完成"（`config1Chain.ts:359`、`gameStartChain.ts:426`）。✅ 改为 `gates.anim:'wait'`（按引擎真值放行：池挂起位 + `0x238` 计时器；`T-0011`，口径见 `T-0024`），并每帧推进模型。
4. 两份 chain 与 `run.ts` **从不推进场景动画窗** ⇒ 与 `report.ts`（唯一推进者）相反；依赖"窗末 work←target"
   的取值与 Electron 不同。✅ `FrameHost.advanceModel` 契约（`T-0002` 第 1 批；`mesh-vertex-quad` 的端点色顺序依赖因此显形并修掉）。
5. ★`PixiBackend.waitFlags` **只置不清**（`:122,606,687`，全文件无清除点；被清的是 **Engine** 那份
   `session.ts:280`）⇒ `needsRender()` 一旦为真就**永久为真** ⇒ Electron 之后**每帧 present**（并连带每帧
   `audio tick`）。这是"两边表现不同"的一条**独立成因**。✅ 镜像已删、判据下沉（`T-0008` 的 D1；E4 A/B：presents 66→68、日志 2395→2384 行）。
6. 同时 `HeadlessScene.waitFlags` 是**死状态**（写后无读者：`:103,368-370`）⇒ 同一个 `setWaitFlag`
   在一侧是死状态、另一侧是永久粘滞的开关。✅ 死字段已删（`T-0008`）。
7. `session` 的 `0x400` 判据读的是**上一帧时钟**：`pixiBackend.clockMs` 只在 `present()` 内刷新(`:705`)，
   而 `#serviceAnimGate` 在 present **之前**读 `sceneAnimationsDone()`(`session.ts:279`)。✅ 单一时间域：判据带本帧 `nowMs`（`T-0008`/`T-0009`）。
8. `scAnimationsDone` 只看**颜色窗（窗 0）**（`scene/ops.ts:414-418`），而 `advanceWindows` 判 **5 个窗**
   （`animWindow.ts:60-72`）⇒ "已完成"与"窗真的走完"**不自洽**（共享层内部）。✅ **拆成两条判据**（`T-0009`/`T-0024`）：合成 = `scAnimationsPending`（5 窗）；门 = **池挂起位 + `0x238` 计时器**（引擎真值，`T-0024` 已落地：`scPoolPending` = 5 窗**排除 `DrawItem+720` bit0 的元素**，门由 `Engine.gatePending`/`sub_407E20` 判；旧的 `scGateAnimationsDone`（只看窗 0）已删除）。★两处订正：① 5 窗直接喂门会让序章 `SN0000.txt:1043` 的 80 000 ms 平移窗把门钉 80 s（E4 A/B 实测）；② 但那不是因为"门不看平移窗"，而是脚本用 `SN0000.txt:1045` 的 **`i242 f8023 1`**（`+720` bit0）把它排除出池挂起位（`sub_49AA30` raw 117843-117844）—— 实测门驻留 100 ms = 该处的 `i238 64`。
9. **音频帧泵只在 Electron**（`session.ts:272`）⇒ headless 的"发声时机 / ADV 寄存冲刷 / 延迟 SE / BGM 淡变"
   整条缺失；且 `HeadlessScene` 无 `audio` ⇒ report 把所有音频意图记成 dropped（`nativeTap.ts:55`）。✅ **B3 已补**（`T-0006`）：帧泵归驱动（`frame/loop.ts` 的 `audio` 档，每完整帧一次、先于合成）；`HeadlessScene` 有了**条件能力** `audio`（给 `audioHost` 才存在，否则闸门 A 记缺口）；新增 `NodeAudioHost`（真字节 + 容器头推时长、不出声）。before/after：两份 chain 的 `drops` 里 `audio×37`/`audio×14` → 0，`audioEvents` 0 → 14/6。`report` 显式 `audio:'never'`（C2）⇒ G2 逐字节不变。
10. **悬停在 headless 从不执行**：`serviceAdvanceWait` 只在 `session.ts:206` 调用；`forceAdvance` 不看
    `routes.shown`、不做命中测试（`engine.ts:780,964-989`）⇒ headless 的 `routes.cursor` 恒 −1。
    ★`Engine.pickHoverLabel()`（`:935-939`）在 `src/` 里**零调用者**（只剩测试）⇒ 悬停重构后的**死代码**。✅ **B3 已补**（`T-0003` 验收 3 / `T-0007`）：新增共享模块 `src/frame/scenario.ts`（输入编排=数据：帧号或条件、顺序执行、执行日志），链路默认 `gates.advance:'pump'`（真泵：命中测试+键命中+点击+悬停两段式），并加观察者 `dispatches[]`/`cursorTrail[]`。E3 实测：SN0000 出现 2 次 `hover-enter`、`routes.cursor` −1→0→12→−1、`routes.shown` 1→0；`advance:'force'` 对照为零悬停、cursor 恒 −1。`pickHoverLabel()` 仍待删（`T-0014` 的收尾项）。
11. `interpreter.run()` 是第 6 份循环且**无任何调用者**（`interpreter.ts:221-237`）。✅ 已删（`T-0014`）。
12. 文档/代码矛盾：`renderer.ts:15-16`、`native.ts:310-311` 称"渲染帧循环由 Pixi ticker/`startFrameLoop`
    每帧驱动"，而实现里 `startFrameLoop` 只记 `wallStart`（`pixiBackend.ts:690-695`），present 由 session 调。✅ 已订正（`T-0015`）。
13. `run(frames)` 返回值语义不同：`config1Chain.ts:392` 返回 `maxFrames`、`gameStartChain.ts:457` 返回 `frames`。✅ 统一（`T-0002` 的 C5）。
14. 宿主能力面不入桥（§0.2 的 ★）⇒ 无法"统一询问某宿主是否支持渲染/屏障"。✅ `needsRender`/`poolPending`（原 `animationsDone`，`T-0024` 改名）/`preloadImage` 入 `NativeBridge` + 闸门 A 白名单；宿主能力差异被守卫钉住（`T-0013`）。

### 1.3 模型层的唯一分叉（已确认**不是**问题）
`scMsgWinSync` 只在 `input.cell` 存在时写 `frame.cell`（`scene/ops.ts:437`），清 `cell` 靠"不带 cell 的新载荷覆盖"；
两个宿主都吃 `emitWin` 的同一判决点（`handlers/msgwin.ts:229-240`）⇒ 不分叉。

---

## 2. 目标分层

```
L0 模型层   src/renderer/scene/*  + src/vm/*                      ← 已有，共享，不动
L1 帧驱动   src/frame/frameLoop.ts                                ← 新增：顺序/门/时钟/批/错误/推进契约（唯一一份）
L2 宿主     src/frame/host.ts 的实现：pixiHost（Electron）/ headlessHost（Node）
L3 观察者   src/frame/observer.ts 的实现：控制窗+trace+jsonl（Electron）/ RecordingObserver（headless）
L4 场景脚本 src/frame/scenario.ts                                 ← 新增：脚本 + 定时输入 + 时钟策略（两宿主共用）
```

**约束**：L1 只依赖接口，不得 import pixi/DOM/electron；L2 是唯一允许分叉处，且**只允许是宿主能力**；
L3 让"对外表现"成为**同一份数据**（文本行/jsonl/digest），而不是编在 `session.ts` 里的日志。

---

## 3. 接口草案

```ts
// src/frame/host.ts
export interface FrameHost {
  readonly bridge: NativeBridge;          // 两宿主已有的桥（模型 + 渲染指令）
  now(): number;                          // 单调 ms（Electron=墙钟 / headless=虚拟）
  yield(): Promise<void>;                 // 让出一帧（rAF / 立即 resolve）
  present(): void;                        // 合成（渲染）；**不再兼职**音频/屏障（见 D5）
  needsRender(): boolean;                  // ★语义必须共享（见 D3）
  poolPending(): boolean;                  // ★池挂起位 Scene+46516（T-0024 起；原名 animationsDone）
  texturesIdle?(): Promise<void>;          // 可选宿主义务（Electron 有；headless 记录发生次数）
  audio?(intent: AudioIntent): void;       // 可选（headless 用真 AudioEngine + 假宿主）
  digest(): FrameDigest;
}

// src/frame/observer.ts
export interface FrameObserver {
  onFrameStart?(f: { index: number; nowMs: number }): void;
  onStep?(t: StepTrace): void;
  onGate?(ev: { kind: '0x400' | 'sleep' | 'text-reveal' | 'wait-input' | 'adv' | 'paused'; entered: boolean; nowMs: number }): void;
  onDispatch?(ev: { kind: string; label: number; ip: number }): void;
  onPresent?(d: FrameDigest): void;
  onAudio?(intent: AudioIntent): void;
  onError?(e: unknown, phase: 'step' | 'batch' | 'gate'): 'continue' | 'stop' | 'pause';
}

// src/frame/scenario.ts
export interface Scenario {
  boot?: { script?: number };
  events: { atMs: number; kind: 'cursor' | 'press' | 'release' | 'wheel' | 'hover' }[];  // 两宿主共用同一份
  clock: { kind: 'fixed'; stepMs: number } | { kind: 'replay'; samples: number[] } | { kind: 'wall' };
  advancePolicy: 'real' | 'synthetic' | 'force';   // 见 D4（★headless 现在只有 'force'）
  maxFrames?: number;
}

// src/frame/digest.ts
export interface FrameDigest {
  frame: number;
  nowMs: number;
  engine: {                                  // ★两宿主必须逐字段相等
    script: string;
    gates: { waitFlags: number; awaitingAdvance: boolean; advActive: boolean; textRevealing: boolean };
    msgWins: { win: number; lines: string[]; cell?: MsgCellFrame }[];
    counts: SceneSnapshot['counts'];
    items: unknown[]; meshes: unknown[];     // **求值后**（含动画插值）的状态
    routes: { count: number; cursor: number; shown: number };
    pages: number;
  };
  host: { barriers: number; audioIntents: AudioIntent[]; fontMisses: number };  // 不参与比较（白名单式）
}
```

---

## 4. 「完全一致」的可执行定义

**定义**：给定**同一份 `Scenario`**，两宿主产出的 `FrameDigest` 序列在 `engine` 段**逐帧逐字段相等**；
差异只允许出现在 `host` 段。

| 闸门 | 内容 | 环境 | 地位 |
|---|---|---|---|
| **G1 确定性** | 同一 Scenario 跑两次 ⇒ digest 序列逐字节相等 | CI | 必过 |
| **G2 零 diff** | 各 headless 循环迁到 `frameLoop` 后，`test/scene-report.test.ts` 快照文本**逐字节不变**（迁移批） | CI | 每批 |
| **G3 回放等价** | Electron `--record` 落"时钟+输入+digest"；headless `--replay` 复现**同一 digest 序列** | 本地（`npm run replay`） | ★"完全一致"的可执行定义 |
| **G4 观感** | `npm run shot -- --gamestart` 截图 + 日志关键行不变 | 本地 | B4 必过 |

用**回放**而非"让 Electron 确定性"：视频/`sleep`/真实动画需要墙钟，把 Electron 变确定性=改产品行为。
回放把"时间"变成**输入数据**，确定性只存在于 headless 侧 —— 这正是"headless 提取全部对外表现"的落地方式。

---

## 5. 必须拍板的设计决定

| # | 问题 | 建议 | 理由（现状证据） |
|---|---|---|---|
| **D1** | 时钟域 | `FrameHost.now()` **单一**时钟；场景模型时钟由驱动统一注入，不再让 pixi 自算 `performance.now()-wallStart` | Electron 现在有**两个**时间域（`session.ts:168` vs `pixiBackend.ts:705`）且门的判据读的是上一帧（§1.2-7） |
| **D2** | 纹理屏障 | 保留为**可选宿主义务**；headless 也实现并记 `host.barriers`（不比较纹理本身） | 引擎同步 vs IPC 异步是真实差异（`session.ts:259-267`），不能假装相等 |
| **D3** | `advanceWindows`/`needsRender`/门判据 的归属 | **全部收进共享层**：推进契约 = "每帧 present 前推进一次"；"是否渲染/池是否挂起"改为共享函数，喂 **Engine** 的门标志（不再读宿主的镜像字段） | 现在推进点三个（pixi `presenter.ts:56` / report `advance` / chains 不推进）；`needsRender` 读 pixi 私有 `waitFlags` 且**永久粘滞**（§1.2-5）；`scAnimationsDone` 只看窗 0（§1.2-8） | ✅ 2026-09（`T-0008`/`T-0009`/`T-0003`/`T-0024`）：判据 `sceneNeedsRender` / `scAnimationsPending` / `scPoolPending` 都在共享层，门由引擎 `Engine.gatePending` 判（`T-0024`）；"脏"也进了共享模型（`SceneState.dirty`：变更型 `sc*` 置位，pixi 在 `present` 清、headless 在 `snapshot` 清）；驱动有 `present: 'needsRender'` 档（只跳过"画"，不跳 `advanceModel`/音频 tick） |
| **D3b** | ★"该不该合成"与"门能不能放行"是**两条**判据 | `scAnimationsPending`（mesh 全窗 + draw item **5 窗**）供 `sceneNeedsRender`；`scPoolPending`（5 窗但**排除 `+720` bit0 的元素**）→ 驱动锁存进 `Engine.scenePending`，门 = 它 + `0x238` 计时器。**不许再共用一个函数** | 二者共用一个函数时，任一侧的正确范围都会伤到另一侧：把 5 窗同时喂给门 ⇒ 序章 `SN0000.txt:1043` 的 80 000 ms 平移窗把门钉死（E4 A/B 实测 20 s 不放行、黑屏）；只喂窗 0 给合成 ⇒ 缩放/平移/flipbook 的中间帧不上屏。门的真值（`sub_407E20` = 池挂起位 + `0x238` 装载的等待计时器）见 `tickets/T-0024`（已落地） |
| **D4** | 无输入源的推进 | 建模成 `Scenario.advancePolicy`，**默认 `synthetic`**：走与真实点击**同一条** `routes`/`labelC` 路由代码（含命中测试与 `routes.shown`），只把事件由脚本合成；`force` 保留为显式登记的近似 | 现存 `forceAdvance` 与真泵刻意不同（`engine.ts:780,964-989`），且 headless 因此**完全没有悬停**（§1.2-10） |
| **D5** | `present` 的三合一 | 拆开：`host.audio(tick)` 由**驱动**每帧调（不再藏在 `#present` 里）；屏障=可选义务；`present()` 只做渲染 | `session.ts:268-274` 把"音频帧泵/纹理屏障/渲染"挤在一个函数里 ⇒ headless 永远拿不到音频 tick（§1.2-9） | ✅ 2026-09 完成（`tickets/T-0006` + `T-0004`）：`FrameLoopOptions.audio`（默认 `'host'`）+ 每完整帧一次 tick（先于 `advanceModel`/`present`）；`report` 传 `'never'`；**产品路径那一处 tick 已在 B4 删除**（`session.ts` 现在只剩 `FrameHost.present` 的"屏障 + 合成"两件事） |
| **D6** | 宿主能力面入桥 | 把 `needsRender`/`poolPending`/`preloadImage` **并入 `NativeBridge` + nativeTap 白名单**（可选方法） | 现在它们不在桥里 ⇒ 缺口不被闸门 A 记（§0.2 ★） | ✅ 2026-09 完成（`tickets/T-0013`；`animationsDone` → `poolPending` 的改名见 `T-0024`）：三者入桥 + `BRIDGE_METHODS`；`RendererSession.#native` 改成 `NativeBridge` 类型；两条宿主能力面守卫（差异清单 + 非桥清单）带负向实测 |
| **D7** | Electron 的 CI 覆盖 | 接受"Electron 只在 G3/G4（本地）验证"，CI 靠 G1/G2；把 pixi 的**非渲染**逻辑（脏标记/needsRender/digest）下沉共享以缩小不可测面 | Electron 无法在 `node:test` 里跑（需要 GPU/窗口） |
| **D8** | 死代码 | 删 `interpreter.run()`、`Engine.pickHoverLabel()`（零调用者）；`HeadlessScene.waitFlags` 与 `PixiBackend.waitFlags` 镜像字段随 D3 一并消失 | §1.2-6/10/11 |

---

## 6. 迁移批次

| 批 | 内容 | 判据 | 回滚点 |
|---|---|---|---|
| **B1 抽驱动（零行为变更）** | 新增 `src/frame/{host,observer,frameLoop,digest,scenario}.ts`；**先把 headless 各循环**接到 `frameLoop`，差异逐项用 `policy` **显式**表达（**不许顺手统一**）；同时删 D8 的死代码 | `npm test` 全绿 + **G2**（快照逐字节不变）+ 各入口报告的 steps/clock/门计数逐字不变 | 各循环是薄壳，逐个还原 |
| **B2 收敛漂移** | 逐条处理 §1.2 的工单（补门、统一顺序、推进契约、`0x400` 不再无条件清、清 `waitFlags` 粘滞、`scAnimationsDone` 5 窗、`run(frames)` 返回语义、文档订正） | **必须有一张 before/after 对照表**：每处差异 → 哪个报告字段变了、为什么；G2 仍不变 | 每处差异一个 commit |
| **B3 headless 补齐能力面** | headless 加 `audio`（真 `AudioEngine` + `test/fakeAudioHost.ts`）、共享 `needsRender`/`animationsDone`、`digest()`；**输入源**（`Scenario.events` → `InputManager`，从而悬停/命中测试真的跑起来） | 新等价测试：同 Scenario 两宿主 digest 的 `engine` 段相等；现有 E3 不变 | 逐能力回退 |
| **B4 Electron 迁到驱动** | `session.ts` 缩成"装配 + 观察者 + `yield`"；`PixiBackend` 成为 `FrameHost`；D1/D3/D5 落地 | **G4** + **G3** + `npm run verify` | 保留旧 `session.ts` 分支直到 G3 通过 |
| **B5 Scenario 统一 + 回放器** | `tools/shot.cjs` 的点击脚本与 chain 的 `setCursor/pressMouse` 合到一份 `Scenario`；加 `--record`/`--replay` | G3 一键可跑；shot 与 chain 用同一份输入定义 | 工具独立文件，删除即回退 |

> B1 = `refactor-plan` §10 #1（"先只合并 headless 三家"）；本设计把"三家"扩为"全部 headless 入口 + 两个能力面"。

### 6.1 五批的落地结果（2026-09-14，逐批证据见票据）

| 批 | 结果 | 票据 | 关键证据 |
|---|---|---|---|
| B1 | ✅ `src/frame/{host,loop}.ts` + headless 三家接线；**G2**：report 全文 sha256 `FBC05509…` 逐字节不变 | `T-0001` | 427 → 434 测试 |
| B2 | ✅ 14 条漂移工单逐条落定（13 修 + 1 刻意保留） | `T-0002` | before/after 总表在 `T-0002/changes.md` 顶部 |
| B3 | ✅ ①音频帧泵归驱动（`T-0006`）②`needsRender` 脏标记进共享模型 ③输入源 ⇒ 悬停真的跑（`T-0007`）④**FrameDigest** + 两宿主等价测试 | `T-0003` | `test/frame-digest.test.ts`（5 例）、`test/headless-needs-render.test.ts` |
| B4 | ✅ `session.ts` 只剩装配 + 观察者 + `yield`；`#present` 三拆（音频归驱动、屏障 await、present 只渲染）；**G3 通过**（Electron 录 3047 帧 → headless 逐帧 engine 段相等）；**G4 关键行不变** | `T-0004` | `tickets/T-0004/changes.md` 的 before/after |
| B5 | ✅ 一份 `ScenarioSpec`（`.json`）被 Electron 跑手（`tools/record.cjs`）与 headless 跑手（`npm run scenario`）共用；`--record/--replay` 一键 G3；`emulator.md` §7.1 闸门清单 | `T-0005` | `test/scenario-replay.test.ts`（7 例） |

**G3 实测抓到的三处真分叉**（都不报错、只表现不对 —— 正是本设计存在的理由）：
1. `scAdvance` 只推进 draw item、**mesh 的窗末收尾藏在 pixi 的 `present` 里** ⇒ 两宿主的幕布状态分叉；
2. `digest.nowMs` 曾舍入到 3 位小数 ⇒ 回放的时钟与录制差 ≤0.0005ms ⇒ 插值色在边界上差 1/255；
3. pixi 的**帧保持**判据用过期 `clockMs` 调 `calcDiffuse` ⇒ 给共享模型的动画窗锁了早一帧的起点。
> 三处都在 `T-0004/changes.md` 有 before/after。

---

## 7. 明确不做（🚫）

- 不做逐字节 GPU/D3D 复刻、不做 WebGL 与 D3D 像素级对齐。
- 不把 pixi 的文本光栅化/字体度量搬进模型（`scMsgWinSync` 已划清：排版在模型、光栅化在宿主）。
- 不让 Electron 变确定性（会改产品行为）。
- 不做"headless 也走 IPC 纹理加载"（除非 D2 反过来决定）。
- 不把 `paused`（控制窗交互）并入驱动语义 —— 它是观察者/交互面。

---

## 8. 风险与开放问题

1. **digest 字段边界**要一次划清（`scene/snapshot.ts` 现有字段哪些属 `engine` 段、哪些属 `host` 段）；
   划错会让 G3 要么假绿要么永远红。
2. **G3 对动画时序敏感**：回放时 `advanceWindows` 的推进次数必须一致 ⇒ D3 是前提。
3. **B2 会改变 headless 报告的数字**（补门、推进窗之后 steps/clock/几何必然变）⇒ 必须"每一处变化都有解释"。
4. **Electron 不可 CI** ⇒ G3/G4 是手动闸门，要在 `emulator.md` §3.3 的闸门清单里写清"改哪些文件必须跑 G3/G4"。
5. 代理清单的 5 条未确认项（`.tmp/frame-loop-divergence.md` §7）要在对应批次里落成实测：
   `waitFlags` 粘滞是否有意、chains 不推进窗是否已影响现有断言、`report` 的 `SLEEP_GATE` 是否真永不满足、
   headless 快照里是否真的出现 `cell`、`refactor-plan` 里的旧行号是否需要重算。
6. B3/B4 之后要复核 `engine-capabilities.json` 里相关条目的 `emulator.status`（部分会从 `partial` 升到
   `modeled-verified`）。
