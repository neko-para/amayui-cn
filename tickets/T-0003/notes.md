# T-0003 · B3 工单（notes.md）

> 目标（用户原话的精神）：**headless 与 Electron 的核心驱动完全一致**，因此 headless 必须补齐
> ① 音频帧泵 ② `needsRender` 语义 ③ 输入源（让**悬停真的跑**）④ `FrameDigest`（可比的逐帧观察记录）。
> 本文件是动手前的现状盘点 + 决策清单；每完成一项就把结论挪进 `changes.md` 并把票据状态推进。

## 0. 已经具备的地基（B1/B2 的产出，别再重做）

| 地基 | 位置 | 状态 |
|---|---|---|
| 共享帧驱动 | `src/frame/loop.ts`（①–⑨ 帧序 + `gates{anim,sleep,advance}` + 钩子 + `stopReason`） | ✅ `T-0001` |
| 宿主接口 | `src/frame/host.ts`（`now/advanceModel/present/needsRender/animationsDone/texturesIdle/audio/yield`） | ✅ `T-0001` |
| 两条判据 | `scAnimationsPending`（合成，5 窗）/ `scGateAnimationsDone`（门，颜色窗） | ✅ `T-0009`/`T-0024` |
| 宿主能力面入桥 | `needsRender`/`animationsDone`/`preloadImage` ∈ `NativeBridge` + `BRIDGE_METHODS`；守卫钉住差异 | ✅ `T-0013` |
| 音频引擎 + 假宿主 | `src/audio/audioEngine.ts`（848 行，通道/延迟/语音仲裁/ADV 寄存/BGM 淡变）+ `test/fakeAudioHost.ts` | ✅ 已有 |
| headless 的模型推进与门判据 | `HeadlessScene.advanceModel/animationsDone`；`advance(clock)` 返回"还有窗在跑" | ✅ `T-0008` |

## 1. 音频帧泵（`T-0006`，P1）—— ✅ **已完成（2026-09-14）**

> 结论、证据与 before/after 见 `tickets/T-0006/changes.md`。要点：驱动拥有泵（`FrameLoopOptions.audio`，默认 `'host'`）、
> `HeadlessScene.audio` = 真 `AudioEngine`（**条件能力**：给 `audioHost` 才存在，否则闸门 A 记缺口）、
> 新增 `src/audio/nodeAudioHost.ts`（真字节 + 容器头推时长、不出声）、修掉 `armedAtMs` 的 `0` 哨兵
> （headless 虚拟时钟第一帧为 0 ⇒ 延迟 SE 晚一帧才响）。
> 两条 chain 新增 `audioEvents[]`（+ `audio` 开关做对照）：`drops` 里 `audio×37`/`audio×14` → 0，`audioEvents` 0 → 14/6。
> ★产品路径 `session.#present()` 里那一处 tick **暂留**：B4（`T-0004`）迁移时必须删，否则每帧双 tick。

（以下为动手前的原始工单记录，保留以备核对。）

**现状**：`HeadlessScene` **没有** `audio` ⇒ `report`/两份 chain 里所有音频意图都被闸门 A 记成 dropped；
只有 `session.#present()`（Electron）每帧发 `{kind:'tick'}`（`session.ts:272`）。

**要做的**：
1. **驱动拥有帧泵（D5）**：`runFrameLoop` 每帧调一次 `host.audio?.({kind:'tick', nowMs, advActive})`，
   从 `session.#present()` 里**移出**（`#present` 只留"屏障 + 合成"）。
   - 位置：与引擎一致——音频泵在**本帧派发之后、合成之前**（`sound-system.md` 的每帧步骤：SE 延迟到期 →
     语音排入到期 → BGM 淡变推进；ADV 位刚清时冲刷寄存语音）。
   - 判据：`frame-loop.test.ts` 新增"每帧恰好一次 tick、且带本帧 nowMs/advActive"；E4 侧证明**没有**双 tick
     （日志里 `[audio]` 行数与改动前同量级，且不出现同帧两条 tick）。
2. **headless 接真 `AudioEngine`**：`HeadlessScene` 增 `audioHost`（构造注入，默认见 3）+ `audio(intent)` 转发。
3. **默认宿主（headless 无 Web Audio）**：新增 `src/audio/*Host.ts` 的 Node 实现，两条路可选：
   - (a) **真字节 + 时长估算**：`FileSource.readFile` 取 OGG/WAV，从容器头推时长
     （WAV 直接读 fmt/data；OGG 取最后一个 `OggS` 页的 granule ÷ 采样率）⇒ 时长**准确**，
     语音占线/延迟判定与 Electron 同源；
   - (b) **注入式时长表**：`durationOf(id)` 由调用方给，缺省 0 ⇒ **登记为近似**（`durationSec=0` 会让
     语音通道立刻释放，与 Electron 不同）。
   ★建议 (a)：headless 本来就有 `FileSource`（`NodeFileSource`），而时长是音频语义的关键输入。
   ★注意：`AudioEngine` 的 LRU 用 `clip.bytes`，所以 `load` 要返回真实长度（(a) 天然满足）。
4. **测试**（`test/headless-audio.test.ts` 新建）：用 `FakeAudioHost` 断言——
   - 延迟 SE（`se-load` + 延迟）在 tick 到点时**恰好**起播一次；
   - 语音通道占线/排队按 `durationSec` 释放；
   - ADV 激活位期间 `0xC4/0x1BD/0x2F4` 寄存、位清除的**下一次 tick** 冲刷；
   - BGM 淡变按步长走到目标（`handle({kind:'bgm-fade'...})` + N 次 tick 后的 gain 历史）。
5. **等价性判据**：同一脚本 + 同一输入下，headless 的"音频事件序列"与 Electron 的 `[audio]` 日志
   **逐条一致**（这条是 B5 replay 的一个子集，先在链路工具里手工对一次）。

## 2. `needsRender` 语义（`T-0003` 本体）—— ✅ **已完成（2026-09-14）**

> 做法：把"脏"搬进**共享模型**（`SceneState.dirty`，每个变更型 `sc*` 置位、`scAdvance` 只在真的推进了窗时置位），
> headless 的 `needsRender()` = 共享判据 `sceneNeedsRender(scene, clockMs, scene.dirty)`，
> **`snapshot()` 清脏**（"取快照 = 消费当前状态"）。驱动新增 `present: 'needsRender'` 档：
> 只跳过"画"这一步，`advanceModel`（窗末收尾在里面）与音频 tick 都不跳。
> 判据：`test/headless-needs-render.test.ts`（5 条，含**源码棘轮**：变更型 `sc*` 必须置脏、只读白名单钉住；
> 负向实测：删掉 `scSetDrawPos` 的置脏 ⇒ 棘轮变红）+ `test/frame-loop.test.ts` 的 `'needsRender'` 档用例。
> ★顺带：`T-0013` 的宿主能力差异表因此从 16 项缩到 15 项（`needsRender` 两个宿主都有了）。

（以下为动手前的原始工单记录，保留以备核对。）

## 2. `needsRender` 语义（`T-0003` 本体）

**现状**：pixi 有真实现（`sceneNeedsRender(scene, clockMs, sceneDirty)`）；headless 没有该概念
（它的"合成" = `advanceModel`，由驱动每帧无条件调）。

**要做的**：headless 增一个**脏标记**（模型写入即脏：所有 `sc*` 写路径 + `msgWinSync` 等），
`needsRender()` = `sceneNeedsRender(scene, clockMs, dirty)`，并在 `advanceModel`/快照后清脏。
判据：① "只读脚本段"（TITLE 轮询）里 headless 的 `needsRender` 能变回 false；
② 有窗在跑时恒 true；③ 与 pixi 同判据（同一函数，只在 dirty 来源上不同）。
★注意 headless 的 `advanceModel` 是**模型推进**，不能因为 `needsRender=false` 就跳过推进（那会改语义）——
驱动里 `advanceModel` 与 `present` 是两件事（D5），`needsRender` 只影响**合成**。

## 3. 输入源（`T-0007`，P1）：让悬停真的跑

**现状**：`serviceAdvanceWait` 只在 `session.ts:206` 被调；`forceAdvance` 不做命中测试也不看 `routes.shown`
⇒ headless 的 `routes.cursor` 恒 −1，**悬停从不发生**（`label` 子程序、`[hover-label]` 证据行都缺）。

**要做的**：
1. 驱动把"等待推进门"的出口显式化（已有 `gates.advance: 'pump'` 调 `e.serviceAdvanceWait()`），
   headless 侧只要**给输入源**就能走同一条路。
2. **输入源 = 脚本化的 `InputManager` 写入**（B5 的 `Scenario` 雏形）：
   - 移动：`input.cursor(x,y)`（含 `moved` 边沿）、点击：`input.press(btn)`/`release`、
     滚轮：`wheel`；都由场景脚本按"帧号或条件"排定；
   - 判据：headless 跑 `gameStartChain` 的悬停场景时，`routes.cursor` 跟着鼠标坐标变，
     日志出现 `[hover-label] hover-enter/leave`（与 Electron 同一套 `sub_403E70` 两段式）。
3. **删死代码**：`Engine.pickHoverLabel()` 零调用者（`T-0014` 已删 `interpreter.run()`，这条一起清）。

## 4. `FrameDigest`（G1/G3 的量具）

**用途**：把"一帧的对外表现"压成**可比、可存、可 diff** 的记录，用于
① G1 确定性（同输入两次跑逐字节相同）② G3 回放等价（headless vs Electron 的 digest 序列相等）
③ 失败时能定位到"第几帧的哪一项不同"。

**建议形状**（在 `src/frame/digest.ts`，纯函数 + 结构化数据，可 JSON 序列化）：

```
FrameDigest = {
  frame: number; clock: number; gate: 'anim'|'sleep'|'text-reveal'|'advance'|'adv'|'batch'|'paused';
  steps: number;                       // 本帧派发条数（累计也留一份）
  audio: string[];                     // 本帧音频事件（起播/停/淡变到 → 规范化文本）
  hover?: number;                      // routes.cursor（−1 = 无）
  msg?: { win: number; revealed: number; glyphs: number; cell?: number }[];
  scene: string;                       // 模型摘要（item/mesh/窗状态 → 稳定序列化）
  hash: string;                        // 上面几项的短哈希（快速比对用）
}
```

**要做的**：驱动加 `FrameObserver`（已有钩子足够：`onFrameStart/onGate/onStep/onFrameEnd/onScriptChange`），
在 `onFrameEnd` 收集 → `digest()`；`--record` 落 JSONL、`--replay` 逐帧比对（B5）。
判据：① 同一脚本两次跑 digest 序列逐字节相同（G1）；② 故意改一个窗的 delay ⇒ 恰好第 N 帧之后的 digest 变红。

## 5. 顺序建议（每步都要 `npm run verify` 全绿 + 票据更新）

1. **D5 帧泵所有权**（驱动 tick + 从 session 移出）——小、可证零行为变更。
2. **headless `audioHost`（真字节+时长）** + `test/headless-audio.test.ts`（4 条语义）。
3. **`needsRender` 脏标记**（headless）。
4. **输入源 + 悬停**（`Scenario` 雏形；与 B5 合流）。
5. **`FrameDigest` + 链路工具对齐**（G1 → G3）。

★每一步的"等价性"都不是靠读代码声称，而是靠：headless digest / 音频事件序列 **与 Electron 的日志逐条对比**。

## 2026-09-13

B3 工单落 tickets/T-0003/notes.md：① 驱动拥有音频帧泵（D5）+ headless 真 AudioEngine（默认宿主走 FileSource 真字节 + 容器头推时长）② headless needsRender 脏标记 ③ 输入源（Scenario 雏形）让悬停真的跑 ④ FrameDigest（G1/G3 量具）。地基清单（B1/B2 产出 + 已有 FakeAudioHost）也在该文件里，避免重做。

## 2026-09-13

B3 进度：① 音频帧泵 ✅ 完成（见 T-0006：驱动拥有泵 + headless 真 AudioEngine + NodeAudioHost；before/after 与三条语义测试都在 T-0006/changes.md）。剩余：② headless needsRender 脏标记 ③ 输入源（悬停）④ FrameDigest。

## 2026-09-13

B3 进度②：headless needsRender ✅。①"脏"进共享模型（SceneState.dirty：35 个变更型 sc* 置位，scAdvance 只在真的推进窗时置位）；② headless needsRender() = sceneNeedsRender(scene, clockMs, scene.dirty)，snapshot() 清脏（取快照=消费）；③ 驱动新增 present:"needsRender" 档（只跳过"画"，advanceModel/音频 tick 照旧）。守卫：test/headless-needs-render.test.ts（5 条，含源码棘轮：变更型 sc* 必须置脏／只读白名单钉住；负向实测删置脏⇒变红）+ test/frame-loop.test.ts 的 needsRender 档用例。判据 npm test 460/460、report sha256 FBC05509… 不变。剩余：③ 输入源（悬停，T-0007）④ FrameDigest。

## 2026-09-13

B3 进度③：输入源（悬停真的跑）✅ —— 见 T-0007。剩余只有验收 4：FrameDigest（同 Scenario 两宿主产出同一 digest 序列的 engine 段）。
