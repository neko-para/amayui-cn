# T-0151 · msgwin-text 批：本轮实施记录（2026-09-24）

> 范围：审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4.1 里本批的 **6 条 P1**（`0x196` 一族之外的 5 条 + `0x205`）
> 与相关 P2/P3。**本轮只结 P1**；P2/P3 见文件末「仍未做」。

## 一、P1 逐条结论

| opcode | finding | 结论 | 落地 | 守卫 |
|---|---|---|---|---|
| `0x205` | `host-invented`（回写 op2） | **已修** | 删 `plan.setInt(2, nx)`（引擎 `sub_4233E0` raw 31470-31491 的 x 前进量只在栈局部 `v8`）；`operandPlan.ts` 的 io 由 `r,rw` 改 `r,r`；`analysis/opcodes.json` 语义订正 + 重建 opcode-table | `test/op-205-no-writeback.test.ts`（3 例）；旧断言在 `test/op-a2-a3.test.ts` 按纪律**改指**（不是放宽） |
| `0x1b6` | `missing-consumer`（`Engine[97052]` 只写不读） | **已修**（读端 + 行为端） | `handlers/msgwin.ts` 的 `armCoexistAutoMessage`（0x72 尾段 raw 28556-28586）+ `engine.ts` 的 `#serviceAutoMessage`（等待泵 `LABEL_44` raw 20376-20461，三条输入分支统一走 `#endWaitPump`） | `test/adv-msgwin.test.ts`（0x72 尾段的共存块 / 等待泵的自动翻页块 / 两组参数 / 文本回卷态） |
| `0x1b7` | `missing-consumer`（`97052` 无到期机制） | **同上** | 同上（`0x1B7` 置位 ⇒ `0x72` 尾段武装计时器 ⇒ 到期自动翻页） | 同上 |
| `0x305` | `missing-branch`（缺总门） | **已修** | `handlers/msgwin.ts`：总门 `(flags & 0x10001) === 0x10001`（raw 26045）、门外只清 flags、门内只贴当前窗、total 按当前文本重算、出口节拍 `SLEEP_GATE/sleepUntil`、`set:DrawMode==1 && (92340&2)==0` 清 `gateWaitStart/gateWaitMs` | `test/char-reveal.test.ts`（总门 / 出口节拍 / 出口计时器） |
| `0x260` | `missing-consumer`（`vPad` 无消费者） | **推翻**（报告 §4.4） | 体证：目标矩形与源采样原点**同步**位移 ⇒ 落点不变（`srcX(p) = X0 + (p−L0)/s`，与补白量无关）；重写侧无源矩形复制/逐字裁切；语料 878/878 值 2px 级且下一行恒 `i261 1`。P3 归属修已做（值改落 Font 级 `msgwin.font.vPad`） | `test/adv-msgwin.test.ts`（0x260 的四个值是 Font 级） |
| `0xfa` | `missing-consumer`（3 个待播槽） | **推翻**（报告 §4.4） | 体证：槽步长是 `122505 + i`（不是 `+3*i`）；等价物在宿主 —— `voice-defer`（`handlers/audio.ts`）→ `AudioEngine.tick(nowMs, advActive=false)` 冲刷（`audioEngine.ts:641-651`，注释原本锚 raw 20146/24966）。顺带修 raw 24985 的 `Engine[174802]=0` ⇒ `inputMask = 0` | `test/adv-msgwin.test.ts`（0xfa 清掉掩码格） |

## 二、登记为缺口（`registered-n/a`，带 `why:` + 重开条件）

1. **`Engine[97052]` 的清零点**：`sub_4090F0` 的「消费即清零」（raw 13699-13703）挂在 **IAGEService vtable+132 = `sub_4764E0`**，由 **AGERC.DLL 系统命令 `case 40035/40037`（进设置画面）** 调用 ⇒ emulator 没有 AGERC 系统命令层，无触发点。
   - 扩展点 = `Engine.serviceCoexistMesLatch()`（体 = raw 13699-13707 逐字）+ 在脚本载入点挂 `CALLBACK_SETTING.BIN`（属 `handlers/control.ts`，本轮未授权）。
   - 重开条件：AGERC 系统命令层进 emulator，或授权接 `handlers/control.ts` 的载入点。
   - 订正：键名是 `set:CoexistMesSkip`（raw 4276），**不是**报告写的「每帧消息泵入口 / `set:CoexistMess`」。
2. `0x2F5` 在 ADV 位已置时引擎是**写槽**（不起播），emulator 的 `op_voice_queue` 直接发 `voice-queue` ⇒ 属 audio 批（T-0152）的 P2 残余。

## 三、红→绿证据（7 条对照实验）

为避免在共享树上改别人正在读的代码，实验跑在**当前树的即时只读快照**上（`.tmp/t0151/`，已删除），逐个把对应实现临时置回修前行为；快照 green 基线 = **55/55**：

| # | 置回 | 修前实测（红） |
|---|---|---|
| R1 | `0x305` 门判据置假 | `★门未满足 ⇒ 不得把余下的行贴出（修前这里会变成 5）` |
| R2 | `0x305` 出口节拍支置假 | `raw 26080：effect_flags |= 0x20000000` |
| R3 | `0x72` 尾段整段 no-op | `sub_453A60 的 t[2] = 1（周期序号）` |
| R4 | `0x260` 写回 `geom(defaultWin)` | `Font+235112/116/120/124 = op1/op2/op3/op4` |
| R5 | 去掉 `inputMask = 0` | `0xFA 出口必须把掩码格清零` |
| R6 | 等待泵自动翻页块整块不跑 | `★到期 ⇒ 清等待门（raw 20432）` |
| R7 | 同上 | `sub_453BC0：t[4] = 1` |

恢复后：`node --import tsx --test test/char-reveal.test.ts test/adv-msgwin.test.ts` = **55 / 55 pass / 0 fail / 0 skip**。

## 四、仍未做（本批 P2/P3，下一轮）

- `0x196`/`0x197`/`0x198`/`0x19c`/`0x1a5`/`0x1ce`/`0x204`/`0x20a`/`0x212` 等（§4.1 本批的 P2/P3）。
- `0x2F5` 的 ADV 位写槽语义（见上 §二.2，与 audio 批交叉）。
- `handlers/control.ts` 的 `serviceCoexistMesLatch()` 接线（需主票授权）。

## 五、台账同步（已由主票写入 `analysis/engine-capabilities.json`）

- 新增 `msgwin-coexist-auto-message`（`partial`，E2，guard `test/adv-msgwin.test.ts`）。
- 新增 `msgwin-vertical-rect-pad`（`n/a-known`，E1，why + 重开条件）。
- 更新 `msgwin-window-reveal-gate-300`（`0x305` 总门，E3）、`voice-request-deferral-and-adv-gate`（`0xfa` 证伪 + 槽步长订正）、`msgwin-config-gates`（消费端已实现）。
