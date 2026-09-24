# T-0167 · cap-missing 实施笔记（15 条 P1 真缺口）

> 台账同步的那 15 条 stale-ledger P1 已由 **T-0166** 收口（本轮 unit 7）。
> 本票只剩 §4.2 里 `missing-behavior` / `missing-consumer` 的 **15 条 P1**：引擎「一直在后台做、缺了不报错只表现不对」的持续行为。
> 每条必须二选一：**实现（带命名守卫 + 红→绿证据）**，或登记 `n/a-known` 并写 `why:`（`analysis/engine-capabilities.json` 的 status/evidence/guard/note 四处同步）。

## 条目清单（编号 = 报告 §4.2 行号，按此顺序做）

| # | capability | 缺什么（一句话） | 主战场文件 | 状态 |
|---|---|---|---|---|
| 6 | `frame-render-gate-mainloop` | 帧提交门 `Engine+667856==1` + `(667860 \|\| effectFlags & 0x2400)`；门内 20750-20751 帧时钟写 + 20758 `sub_4B4040` | `src/frame/loop.ts` | **done**（`frameRenderGate()` 纯函数 + `onFrameRenderGate`；守卫 `test/frame-render-gate.test.ts` 8 例） |
| 7 | `frame-render-gate-mainloop` | `Engine+675968`（外部挂起渲染）⇒ 整段跳过 | `src/frame/host.ts` + `loop.ts` | **done**（`FrameHost.renderSuspended?()` 缝；引擎写点 raw 11533/11630 = `sub_406050`/`sub_406220`） |
| 3 | `clock-write-clock-freeze` | 帧时钟字段写 `369336 ← 369332; 369332 ← now`（只在该门内） | `src/frame/loop.ts` | **done**（门内落地；默认 `DrawMode=0` 与 `present:never` 都不写 ⇒ 旧行为不变） |
| 4 | `clock-write-clock-freeze` | 停靠锁 429752 挡住主循环 raw 20838 等待/阶梯段与 20896 电影段 | `src/frame/loop.ts` + 台账 | **registered-n/a**（缺的是"被挡住的段"本体：效果计时器调度 `Engine+430012/+430096`、电影段；why + 重开条件写进 `analysis/engine-capabilities.json` 的 `clock-write-clock-freeze`） |
| 2 | `bullet-dirty-from-freeze-or-pending` | `(46512\|46516) ⇒ 46508 = 1` 强制本帧重画；`sceneNeedsRender` 不看 `scenePending` | `src/renderer/scene/*` | delegated（简报 A） |
| 8 | `gfx-prim-mesh-and-render-state` | 0x1FC/0x1FE 图元变换、0x321 网格属性、0x32D 3D 颜色写进 render4 后无渲染消费者 | `presenter.ts`、`scene/snapshot.ts` | delegated（简报 A） |
| 18 | `passive-camera-and-effect-render-state` | 每帧 `sub_453540`（按墙钟、上限 100 次、三路效果对象各推进一次）缺失 | `src/renderer/**` | delegated（简报 A） |
| 19 | `render-3d-layer-dual-commit` | 0x222 整趟提交 + 三表归并 + 天气推进（现无 0x222 注册） | `src/vm/handlers/scene*.ts`、`renderer/**` | delegated（简报 A；已在做 `scene-commit.ts`） |
| 20 | `scene-3d-effect-level-writer` | `Scene+46668` 等级的持续后果：36/37 scratch 槽 mode、ID3DXEffect 惰性建、绘制支路 | `renderer/**`、`scene/state.ts` | delegated（简报 A） |
| 21 | `scene-3d-weather-effects-rain-snow-leaf` | 3D 天气/粒子子系统（管理器 `Scene+50704`、三槽、每帧推进、销毁判据、0x326 共享 effect） | `renderer/**`、`handlers/stubs.ts` | delegated（简报 A） |
| 24 | `scene-render-freeze-46676` | 冻结总闸是**帧级门**：`Scene+46676` 非零 ⇒ `sub_4B4040` 整趟与 `sub_49FCD0` 3D 帧全跳 | `renderer/scene/*` | delegated（简报 A） |
| 14 | `msgwin-backlog-cursor` | `TextItemTable.moveCursor` 无调用点；滚轮位 0x8/0x2 与 `effectFlags \|= 0x100000` 无写入者 | `src/vm/engine.ts` + `textItems.ts` | delegated（简报 C；消费者在 `sub_411900` raw 20341-20360 —— 与本票 #1 同一段体） |
| 16 | `msgwin-config-gates` | `message:AutoMessage*` 有写入端无消费者（消费者 = 0x72 尾段自动翻页计时器） | `handlers/msgwin.ts`、`vm/msgwin.ts` | delegated（简报 B） |
| 1 | `adv-advance-route-table` | 右键『取消/跳读』通路（`Engine[489488+4*cur]` label + 清 ADV 掩码 + 改写帧 ip）+ 逐字中滚轮上键收尾 | `src/vm/engine.ts`、`route.ts` | delegated（简报 C） |
| 27 | `script-queue-dispatch` | `0x1F5` 计到 0 时的出队（`if (!dispatch_in_progress) sub_40FB60`） | `handlers/frame.ts` | **done**（T-0157 执行者：三层门 + `dispatchNextRequest` 导出 + `setDispatching` 接上 124350 的 5 个写点；守卫 `test/op-1f5-dequeue.test.ts` 6 例，红 1/6 → 绿 6/6） |

## 纪律

1. **引擎体是唯一权威**：`engine/天结_unpacked.exe_utf8.c` 只读；报告/台账文字可能错（本轮已实证多次，例：0x2c0/0x2f5 的「op2 = pan」经 `sub_4BB840` 第 5 实参算式证伪：该实参 = `Sound[387+ch]`（0x2F8 写的当前 pan），而 op2 落在 `Voice[277+ch]` ⇒ 只有 bit0 作循环位）。
2. **不许为绿改断言**：每条改动给出「红 → 绿」的运行证据（先跑守卫看红，改完再跑看绿）。
3. **不许静默 no-op**：17 条里凡是「登记为 n/a-known」的，必须写 `why:` 并说明**在什么条件下必须重开**（§5.0 第 3 条）。
4. **文件所有权**：并行 period 内一个文件只归一个执行者；跨文件改动先串行化。
5. 收口判据：`npm run verify` + `capabilities.js --validate` 全绿（T-0146 的 3 条基线红不算，另有基线记录）。
