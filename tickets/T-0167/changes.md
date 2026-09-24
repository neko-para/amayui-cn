# T-0167 · 本轮实施记录（2026-09-24）

> 范围：审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4.2 里本批的 **15 条 P1**
> （`missing-behavior` / `missing-consumer`；另 15 条 stale-ledger P1 由 `T-0166` 收口）。
> 每条的最终处置见报告 §4.8；机器可读台账 = `app/amayui-emulator/.tmp/p1-fix/dispositions.json`（`reconcile.mjs` 对账）。

## 一、主票自己做的 3 条（帧提交门/时钟写/外部挂起）

| # | capability | 结论 | 落地 | 守卫 |
|---|---|---|---|---|
| 6 | `frame-render-gate-mainloop`（门本身） | **已修** | `src/frame/loop.ts` 新增导出纯函数 `frameRenderGate(e, suspended)`，逐字复刻引擎主循环 raw 20740-20761（① `Engine+667856==1` ② `Engine+675968` ③ `667860` 或 `effect_flags & 0x2400` ④ 帧时钟写 ⑤ 内层提交门可判定部分）+ 新钩子 `onFrameRenderGate` | `test/frame-render-gate.test.ts`（8 例） |
| 3 | `clock-write-clock-freeze`（主循环时钟写） | **已修** | 门内 `ENGINE_FIELD.clockPrev ← clock; clock ← nowMs`（raw 20750-20751）；`present:'never'` 的 tracer 档不写 | 同上 ⑤⑥⑦ 例 |
| 7 | `frame-render-gate-mainloop`（`Engine+675968`） | **已修** | `src/frame/host.ts` 新增 `renderSuspended?()` 宿主缝（引擎写点 = `sub_406050` raw 11517-11544 / `sub_406220` raw 11625-11631，都在窗口/显示层 ⇒ 归宿主） | 同上 ② 与 ⑥ 第二档 |
| 4 | `clock-write-clock-freeze`（429752 挡住 raw 20838/20896） | **registered-n/a** | 门内 raw 20755 的锁判据已落；被锁挡住的两段（效果计时器调度 `Engine+430012/+430096`、电影段）**本体未建模** | 台账 `clock-write-clock-freeze` 的 `why:` + 重开条件 |

★ `present` **不**按该门开关（有据登记）：本块的 `sub_4B4040` 是 `DrawMode==1` 的 D3D 提交，而随包 INI 实测 `DrawMode=0`（真机走另一条 GDI 出帧路径），emulator 的 `host.present` 同时代表两条 ⇒ 按 `drawMode==1` 去门它会让默认配置一帧都不画。差异只在 `DrawMode=1` 的配置上。

## 二、并行执行者交付（按批次）

| 批次 | 条目 | 结论 | 守卫 |
|---|---|---|---|
| `T-0157` | §4.2 #27 `script-queue-dispatch` 的 `0x1F5` 帧驱动出队 | **已修**：0x1F5 三层门（帧计数 / 停靠标志原值必须为 1 / `dispatchInProgress==0`）→ 先清停靠标志 → 仅当可派发才 `dispatchNextRequest`；`dispatchNextRequest` 导出并加 raw 18966 停靠闸；`setDispatching` 把 124350 的 5 个引擎写点全接上（修前该键只有读没有写 ⇒ 门恒真的死键） | `test/op-1f5-dequeue.test.ts`（6 例；红 1/6 → 绿 6/6；写点回潮 → 0/6） |
| `T-0154` | §4.1 #8 `0x22f` 层 20..29 是轴角旋转 | **已修**：`D3DXMatrixRotationAxis`（raw 117627-117632）+ 四块矩阵可叠加（不再 `kind` 三选一） | `test/op-22a-22f-scene-world.test.ts`（+3 例；红 3/28 → 绿 28/28） |
| `T-0151`(msgwin) | §4.1 #4/#5 `0x1b6`/`0x1b7`、#13 `0x305`；§4.2 #16 | **已修**（读端 + 行为端） | `test/adv-msgwin.test.ts` / `test/char-reveal.test.ts`（55/55） |
| `T-0151`(msgwin) | §4.1 #9 `0x260`、#18 `0xfa` | **推翻**（体证，见报告 §4.4 第 12/13 条） | `test/adv-msgwin.test.ts` |
| `T-0167-A` | §4.2 #2 #8 #18 #19 #20 #21 #24 | 见下方 A 段 | `test/headless-needs-render.test.ts`、`test/scene-freeze-46676-gate.test.ts`、`test/op-222-scene-commit.test.ts`、`test/scene-3d-effect-level.test.ts`、`test/scene-3d-weather.test.ts`、`test/gfx-prim-mesh-consumers.test.ts` |
| `T-0167-C` | §4.2 #1 `adv-advance-route-table`、#14 `msgwin-backlog-cursor` 的 missing-consumer | **已修**：右键取消路由（`#cancelRoute`）+ 滚轮回看游标（`#textRewindWheel`） | `test/adv-right-click-cancel-route.test.ts`（3 例）、`test/msgwin-backlog-wheel.test.ts`（5 例） |

## 三、T-0167-A 段（场景/渲染 6 条）

（待 A 执行者回报后补：逐条结论 + 红→绿数字 + 残项）

## 四、登记为缺口 / 口径差（都不假装已覆盖）

1. **`Engine+97052` 的清零点**（`sub_4090F0`）在 AGERC 系统命令层（IAGEService vtable+132 = `sub_4764E0`，case 40035/40037）⇒ emulator 无触发点。扩展点 = `Engine.serviceCoexistMesLatch()` + `handlers/control.ts` 载入点挂 `CALLBACK_SETTING.BIN`。
2. **`CALLBACK_TEXT.BIN`（raw 20351 `sub_411560`）未建模** ⇒ 滚轮回看只回拨游标 + 置跳读位，不弹回看画面（页表/记录表已动 ⇒ `0x1D0` 与 `HISTORY.txt` 那条链仍读得到）。
3. **`489812`（`redisplayReturn`）在右键取消路径有意不写**：它要"回调脚本跑完那一刻的 (ip−ip_base)>>2"，而回调不跑 ⇒ 写猜测值会把 ip 还原到错的地方；因 `redisplayMode` 写的是 `0x6000000`（不含 `0x2000000`），真到 `0x7C` 会照 raw 25791-25796 抛 `END.HWL`（有可观测后果，不是静默乱跳）。
4. **`jump` 不在 `frame.labelMap` 时**：引擎是野跳（`ip = ip_base + 4*表项`），emulator 的 ip 是映像下标、无处野跳 ⇒ 选择"什么都不做"并登记。
5. **新发现（建议单开 finding）**：`src/vm/textItems.ts` 的 `moveCursor(-1, …)` **不是"走一格就停"** —— 新游标所在页的 `start` 与出发页相同时（raw 70616 的 `v9 !== from` 去重判据）它继续往回走（实测页起点 `[0,3,3]`、从游标 2 出发一路到 0），与本台账旧措辞不符。新增守卫用"起点两两不同的 6 页"绕开，未改动本体。
6. **`0x2F5` 的 ADV 位写槽语义**（audio 批 T-0152 的 P2 残余）：ADV 位置位时引擎写槽不起播，emulator 的 `op_voice_queue` 直接发 `voice-queue`。
7. **`0x7C` 的 raw 25816-25822 收尾**（frame-loop 批的 P2 残余）：`if (387940) { 387940 = 0; if (队列恰剩 1 项) dispatchNextRequest(c) }` —— `dispatchNextRequest` 现已导出可复用。

## 六、收尾补修：**滚轮事件从来没有进过输入掩码**（用户实测反馈）

用户实测："在 ADV 界面滚动滚轮无法进入历史消息/回看界面"。逐层查证后定位到一个**结构性缺口**（不属于原 48 条 P1，是 #14 那条修好之后仍然"看不见效果"的根因）：

- 引擎 WndProc 对 `WM_MOUSEWHEEL`(0x20A) / `WM_MOUSEHWHEEL`(0x20E) 有**两条路**（raw 141520-141611）：
  `(Engine+699204 & 0x90100000) != 0` 时**不累加增量**，而是取 `set:WheelKeyUp/Down`（横滚 `HWheelKeyUp/Down`）
  当**掩码位号**执行 `Engine[699208] |= 1 << 位`；否则才 `Engine[7796]/[7800] += delta`。
- 而 ADV 侧所有"滚轮键位"判据读的都是**掩码**（`sub_411BC0` raw 20345/20355、`sub_411590` raw 20047-20055、
  `sub_411900` raw 20264）⇒ emulator 修前只喂 `wheelDelta` ⇒ 那些判据**恒假**、滚轮在 ADV 里"完全没有反应"。
- 修法（引擎逐字）：`InputManager.wheelKeyBits` + `wheelKeyPolicy`（`Engine` 构造时注入的**活值闭包**：
  `asKey = effectFlags & 0x90100000`；四个位号来自 `CFG.setWheelKeyUp/Down/HWheelKeyUp/HWheelKeyDown`，
  缺键 = -1 不映射；位号非法 ⇒ 引擎那条 `if (v19 >= 0)` 不成立、也不回流到累加器）；
  `flushPending`/`flushHeld` 把它并进掩码；`consumeEdges` 随掩码一起消费（引擎每轮收尾 `*v9 = 0`）；
  `snapshot`/`restore` 带上它（旧轨迹无此格 ⇒ 按 0 降级）。
- 守卫：`test/wheel-as-key.test.ts`（9 例，全绿；含"一次真实滚轮事件 ⇒ 等待泵回看分支（游标后退 + `489816=-1`
  + `effect_flags |= 0x100000`）"的端到端例）。快速档 959 / 958 pass / 0 fail。
- 台账/文档同步：`analysis/engine-capabilities.json` 的 `input-wheel-two-accumulators`（E3 + 新守卫 + 两条路的说明）、
  `docs-new/03-engine/input-system.md` §15。
- ★**同一次查证还纠正了一条登记**：`sub_411560(Engine, "CALLBACK_TEXT.BIN")` 那一跳**不是缺口** ——
  `sub_455000` 按名找不到返回 **-1**（raw 67420），`sub_40FC90(Engine, -1)` 体首 `if (a2 != -1)` 直接早退
  （raw 19021-19026）；而本机数据（`install/SYS4INI.BIN` 21109 条 / 565 个 `.BIN`、`raw-parts/DATA1/` 抽取）
  里**没有** `CALLBACK_TEXT.BIN`，也没有任何条目名含 "text"。⇒ 真机同样是 no-op，台账两条 note 已改正，
  重开条件 = 数据里出现该文件（或换用带它的版本）。

## 五、台账同步（本轮写入 `analysis/engine-capabilities.json`，140 条 / `--validate` 绿）

- 新增：`msgwin-coexist-auto-message`（partial）、`msgwin-vertical-rect-pad`（n/a-known，0x260 P1 推翻的登记）。
- 改写：`frame-render-gate-mainloop`、`clock-write-clock-freeze`、`scene-layer-xform-compose-20-29`、`msgwin-window-reveal-gate-300`、`voice-request-deferral-and-adv-gate`、`msgwin-config-gates`、`adv-advance-route-table`、`msgwin-backlog-cursor`。
- 结构：`T-0014` 的证据锚点改指（`hoverDispatchAllowed()` → `hoverDispatchAllowed(mask?: number)`）；`T-0077`/`T-0081` 改指到 `[0x10c, op_set_key_multi]`；`analysis/opcode-gaps.json` 的 `0x10c` 由 `engine-internal` 改判 `implemented`（`build-opcode-gaps.mjs` 重算 counts 12/40）。
