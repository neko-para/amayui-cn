# T-0004 · 过程文档（changes.md）

## 2026-09-13

## 第 1 次变更（2026-09-14）—— session.ts 迁到共享帧驱动；#present 三拆；G3 + G4 通过

### 改了什么

| 文件 | 改动 |
|---|---|
| `src/renderer/app/session.ts` | **重写**：只剩 ①装配（把 `PixiBackend` 接成 `FrameHost`）②观察者（控制窗/trace/遥测/jsonl/状态上报）③让帧（`yield` = rAF）。原来那份 300 行门控状态机**删除**，帧序全部来自 `runFrameLoop`。新增 `PRODUCT_FRAME_POLICY`（门档 + 批上限，与轨迹头**共用一份**） |
| `src/renderer/app/session.ts` 的 `#present` | **三拆**（设计 D5）：**删掉**里面的 `audio tick`（所有权早已归驱动，留着会每帧双 tick）；屏障（`await texturesIdle`）留在宿主 `present` 里；合成只调 `native.present(nowMs, waitFlags)` |
| `src/frame/loop.ts` | `onAdvanceWait`（把 `serviceAdvanceWait()` 的返回值显式交给观察者）+ `await host.present?.()` |
| `src/frame/host.ts` | `present?` 允许返回 Promise（屏障在合成前 await） |
| `src/renderer/pixiBackend.ts` | `advanceModel(nowMs)`：注入时钟 + `scAdvance`（**模型推进**从 present 里拆出来）；`present()` 不再自算时钟（`#clockInjected`）；`getTextureSize`/`audio`/`texturesIdle` 计数 |
| `src/renderer/scene/ops.ts` | `scAdvance` 补 **mesh 的窗末收尾**（见下"分叉①"） |
| `src/renderer/pixiBackend.ts` | 帧保持判据改为**无时钟**（见下"分叉③"） |
| `test/frame-loop.test.ts` | 既有 6 例继续守驱动档位（`onStep` 现在可 await；`present: 'needsRender'` 档不变） |

### 暂停（未知指令）怎么办 —— 它**不是**驱动语义

设计文档 §7 明确不把 `paused` 并进驱动。做法：驱动在 `stopReason='unknown'` 停下 ⇒ 会话跑"互动面"帧
（服务 + 音频 tick + 推进模型 + 屏障 + 合成 + 让帧），等控制窗登记桩（`#pausedOp=null`）后**重新进入驱动**
（`stepOnce` 抛 `NotImplementedOp` 时未消费操作数、未推进 ip ⇒ 同一条指令重试即可）。
与修前的"暂停态分支"等价，且驱动里没有多出一个分支。

### ★G3 实测抓到的三处真分叉（都不报错、只表现不对）

判据 = `npm run record`（Electron，真 `sendInputEvent`）→ `npm run replay`（headless，同一份 Scenario）。

| # | 现象（首帧差） | 根因 | 修法 |
|---|---|---|---|
| ① | f=33：`meshes[1].state0` 录制 `#00000000` vs 回放 `#ff000000` | **mesh 的窗末收尾（`state0 ← state1`）藏在 pixi 的 `present` 里**（`presenter.ts:130/201` → `calcDiffuse`），headless 没有 present ⇒ 永远不烘焙 | `scAdvance` 也推进 mesh 窗（**共享推进器**一份；present 只负责画） |
| ② | f=33：`color` 差 1/255（`#54` vs `#55`） | `FrameDigest.nowMs` 曾 `Math.round(x*1000)/1000`，而它同时是**回放的时钟输入** ⇒ 回放时钟与录制差 ≤0.0005ms ⇒ 插值色在舍入边界上差 1 | digest 的 `nowMs` **不舍入**（JSON 双精度往返是精确的） |
| ③ | f=1658：`meshes[1].anim.start` 录制 `15493.7` vs 回放 `15501.9`（**差一帧**） | pixi 的**帧保持（防闪）**判据 `#meshVisibleColor` 用 `calcDiffuse(m, this.clockMs)`，而帧内 `clockMs` 还是**上一帧**的值 ⇒ 给共享模型的动画窗**锁了个早一帧的起点** | 帧保持判据改成**无时钟**（`state0` 的 alpha > 0）；渲染策略不许改引擎状态 |

> 除这三处外还修了两处"回放/录制不同源"的自伤：**轨迹头必须带驱动策略**（批上限决定帧边界 ⇒ 回放侧不许猜默认值）、
> **录制必须从启动第一帧开始**（从"界面就绪"开始录会让录到的帧 0 已在 TITLE，回放对不上）。

### 判据（实测）

- **G3 通过**：`[replay] ✅ engine 段逐帧相等（比对 3047 帧；录制 3047 / 回放 3055，回放多跑 8 帧（未比对））`
  —— 轨迹 `.tmp/gm-electron.jsonl.gz`（gzip 后 ≈300KB，覆盖 启动→TITLE→GAMESTART→SN0000 首文案→推进→两次悬停）。
- **G4**：`npm run shot -- --gamestart` 与改动前基线（`.tmp/b4-base/`）逐行比对 —— **关键行全部相同**：
  `-> TITLE.BIN`/`-> GAMESTART.BIN`/`-> SN0000.BIN` 各 1；`gate 0x400 cleared` 11、`gate 0x400 WAIT` 4、
  `text reveal done` 5、`[hover-label] hover-enter` 3 / `hover-leave` 1、`advance-wait handled` 1；
  截图 `7/8/9/10-sn0000-*` 目视一致（文本/背景/侧栏/▼ 全同）。
  **诊断量行随墙钟抖动**：同一份构建连跑两次也差 1–10 行（`[present]` 67 vs 68、`[msgwin]` 502 vs 511、
  `[reveal]` 329 vs 338）⇒ 已写进 `emulator.md` §7.1：**这些不是判据**。
- `npm run verify` 全绿（476 条；唯一红的是本票自己的**锚点棘轮** ⇒ 本轮已更新锚点）。

### 教训（值得写下来）

**`advanceModel` 与 `present` 的边界不能靠"反正同一帧"含糊过去**：只要有一处推进/求值只发生在某一侧的
`present` 里（或用了宿主自己的过期时钟），两个宿主就会分叉，而分叉的表现是**画面/数字差一点点**（1/255、差一帧）
—— 不看 digest 根本发现不了。
