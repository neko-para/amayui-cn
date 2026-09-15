# T-0010 · 过程文档（notes.md）

## 2026-09-15


## 研究（2026-09，动手前）

### 结论
缺陷成立，且比票面描述**重一档**：不只是"置上后永不清"，`sleep` 门在 report 里等于**不存在**（脚本直接越过等待）；
而如果只把 `ignore` 改成 `wait`，report 会**死循环**（它没有 `maxFrames` 兜底）——所以修法必须同时给门分支加帧边界。

### 现状（代码核查）
- `src/report.ts` 的驱动配置：`gates: { anim: 'ignore', sleep: 'ignore', advance: 'force' }`（B1 逐句照抄旧循环，
  注释自己写明"原实现**没有** 0x400/SLEEP 分支"）；帧边界只在 `onStep`（`FRAME_OPS`）与 `onFrameEnd` 的
  `text-reveal`/`advance` 两支上推进。
- 驱动侧：`src/frame/loop.ts:245`（anim 门）、`:251`（sleep 门）、`:310`（内批"遇门即停"）都在读 `e.waitFlags`；
  report 不看 ⇒ **位永远留着**，此后内批每帧只放行 1 条（`frame-loop.test.ts:191-201` 把这个后果写成了"现状注记"）。
- 门的真值：`Engine.serviceWaitGate`/`gatePending`（`src/vm/engine.ts:456-477`）= **池挂起位**（`scenePending`，
  由 `present !== 'never'` 的帧末锁存）**或** `0x238` 装载的**等待计时器**（`gateWaitStart/gateWaitMs`）。
- `src/frame/host.ts:52-58` 已声明："宿主未实现 `poolPending` ⇒ 驱动按'池不挂起'处理（`gates.anim: 'wait'` 就**只等 `0x238` 计时器**）"
  ⇒ 本票的目标口径已被宿主接口承认，不需要新概念。

### 实测（合成脚本，report 口径逐句照抄：`maxStepsPerFrame: 1`、`present/audio: 'never'`、`FRAME_OPS` 判帧边界）
| 脚本 | 现状（`ignore`） | 拟改（`wait` + 门分支算帧） |
|---|---|---|
| `i0c8 500` + 2×`nop` | steps 3 / frames 1 / clock **16ms** / 位留 `0x20000000` | steps 3 / frames 34 / clock **544ms** / 位清 |
| `i238 200` + `i21c` + 2×`nop` | steps 4 / frames 2 / clock 32ms / 位留 `0x400` | steps 4 / frames 16 / clock **256ms** / 位清 |
| `i21c` + 2×`nop` | steps 3 / frames 1 / clock 16ms / 位留 `0x400` | steps 3 / frames 2 / clock 32ms / 位清 |
| 只改 `wait`、**不**给门分支加帧边界（`sleep 500`） | — | `stopReason=cap` / steps 1 / frames 0 / clock 0 / 门访问 4999 ⇒ **挂死** |

### 语料侧（谁真的会踩到）
- `sleep`（0xC8）**真实在用**：`src/$1$SC0330.txt:573 sleep 1f4`（=500ms）、SC0820 同处；
- `i238 <ms>`（装载 0x400 计时器）在 SC0330/SC0820 大量出现（`:430 :447 :1301 :6360 …`）；
- `i21c`（置 0x400）**语料 0 处**（唯一置位者就是它，`src/vm/handlers/frame.ts:75-77`）。
- SYSTEM4 前 120k 步实测 `--ops 0x21c,0xc8,0x238` 命中 **0 条**（`.tmp/t10probe.jsonl` 0 行；
  同次 steps 120000 / frames 29 / clock 464ms）⇒ 本票缺陷**不在** script 0 的这段路线上，
  所以 `scene-report` 的 `meta`/快照应当**零 diff**（正好是"没有连带改坏"的判据）。
  ⇒ 现存可见影响：凡走到 `sleep` 的场景，report 的时钟/帧数/门行为与产品路径**不同源**。

### 修法（最小、有依据）
1. `report.ts` 的 `gates` → `{ anim: 'wait', sleep: 'wait', advance: 'force' }`；
2. `onFrameEnd` 里"占一帧"的分支集合从 `text-reveal|advance` 扩到 **`+ anim|sleep`**（引擎里这两支各自占满一帧、时钟前进）；
3. 重写那段"原实现没有分支"的注释：改成"按引擎语义放行；**池挂起位这一半**要等宿主能力入桥（`T-0013`/`T-0025`）"；
4. 顺手改 `frame-loop.test.ts:191-201`：那里的注记把缺陷写成了"现状"，要指向新档位。

### 守卫方案（与 `T-0012` 共用设施）
`runSceneReport` 是完整场景入口（要资源根），单测打不动它 ⇒ 先把驱动配置从 `runSceneReport` 里**抽成可导出**
的常量/纯函数（如 `REPORT_GATES` / `mkReportLoopOptions`），再用 `test/harness.ts` 的 `instr` + `Engine(StubNative)`
合成脚本 + `runFrameLoop` 断言上表"拟改"列的 steps/frames/clock，并补一条"不许退回 `ignore`"的棘轮断言。

### 风险 / 未收敛（改完也要留在这）
- **池挂起位这一半仍未建模**：report 用 `present: 'never'` ⇒ `e.scenePending` 恒 false ⇒ `serviceWaitGate`
  立刻放行。要让 `0x400` 真的等动画，report 得走 `present: 'host'` + `advanceModel`/`poolPending`
  ——那是**帧模型变更**（会改 frames/clock 语义），不在本票范围，已由 `T-0013`（宿主能力面入桥）/`T-0025` 承接。
  ⇒ 验收时**不许**把"0x400 已处理"说成完整。
- 改 `wait` 后带 `sleep` 的脚本会多花帧（虚拟时钟 16ms/帧）：`sleep 2500` 约需 ~156 帧，无风险。
