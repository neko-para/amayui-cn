# T-0094 · 过程文档（changes.md）

## 2026-09-20

## 轮 7 变更：第①②路的 MessageSpeed 节流半边已落地

**判据（回答"补了会不会变"）= (A) 会变，且实测**：`SLEEP_GATE = 0x20000000` 就是引擎 `effect_flags` 的那一位，被 `src/frame/loop.ts:296-299` 的 sleep 分支消费（到点前不派发任何指令），`loop.ts:343` 的批内 break 也读它 ⇒ **不是死写**。

**改动**
1. `app/amayui-emulator/src/vm/handlers/msgwin.ts`（+52 行）：`op_display_furigana` 文档块从「未建模」改写为已建模（三具被调函数 raw 区间表 + `0x20000000` 全生命周期 + 「为什么是少等一拍」）；函数尾部按 raw 29075/29093/29095 装门：
   `MessageSpeed != 0 && !advActive` ⇒ `effectFlags |= SLEEP_GATE` + `sleepUntil = nowMs + max(1, MessageSpeed)`。
   ★**复用**既有字段（`SLEEP_GATE` / `sleepUntil` / `ADV_ACTIVE` / `e.advActive`），**未新造机制、未新造字段、未硬接合成级**。
2. `app/amayui-emulator/test/op-3-004-furigana-outer-gate.test.ts`（+257 行）：原第 3 条「缺口棘轮 · 断言尚未建模」删除 ⇒ L87 正向棘轮（必须装门且 `sleepUntil == now + SPEED`）、L100（ADV 已置 ⇒ 不装门）、L113（MessageSpeed=0 ⇒ 不装门）、L129 语料 6341 棘轮、L238/L248 E3 时序。**测试名保留「缺口棘轮」四字**（不动 `evidence[1]` 锚点）。

**体证（三具被调函数，全部 `//-----` 定义头定位后逐段读）**
| 函数 | raw | 结论 |
|---|---|---|
| `sub_46BE30` | 83363-83995 | 只排版（raw 83918 `sub_45D120` push 本行+注音进窗记录）；**无 Sleep/无计时器/无自旋**；返回值 = 「本行有内容吗」（raw 83493-83497 空串 ⇒ 0，raw 83994 ⇒ 1） |
| `sub_46CBF0` | 83998-84010 | = `sub_46BE30` + 结尾 `do … while(!sub_45BE20(Font, op1))` **行泵自旋**；「同步排空」排的就是行泵（raw 72172 的 `win+132` 行游标、raw 72227 `return 1` 退出）；**无 Sleep、不起计时器** |
| `sub_453A60(Engine+430572, ms)` | 66100-66112 | 节拍计时器对象（dword 107643）：`[2]`=tick 序号、`[5]`=起算、`[6]`=周期 `a2?:1` ⇒ **单位 ms、量级 = MessageSpeed 本身**；到期判定 `sub_453B60`（66188-66212）未到点返回 **-1** |

`0x20000000` 的**读者** = 主循环 raw **21176**；**清位点** = `sub_409400` 内 raw **13892/13919/13940/13964**（每条都在 `sub_453B60 >= 0` 之后）。

**E3（真产物，非合成）**：`install/CONFIG1.BIN`（2378 条，`0x196` 恰好 1 处，帧内下标 2131）：
`0x71 9` → `0x196 0 "天俟" "天俟"` → `0x6E 0 "神俣ＳＡＭＰＬＥ"` → `0x6F 0`。
- L238：该段进 `runFrameLoop`（虚拟时钟 +1000/60）⇒ 派发序 `[0x71, 0x196, 0x6E]`，注音之后那条 `clock >= MessageSpeed`。
- L248：同一对重复 10 遍 ⇒ `MessageSpeed=40` 时每处 Δ = **66.7ms**、整段 1267ms；`MessageSpeed=0` ⇒ 21 条全在第 0 帧、**0ms / 0 帧**（★修复前两档都是 0）。断言：每处 Δ ∈ `[SPEED, max(2·SPEED, SPEED+3帧)]`、整段 ≥ `N·SPEED`、两档差 ≥ `N·SPEED`。
- 不用 `config1Chain` 整链做时序的理由：整链 43s 且 `0x196` 只在链末一瞬（采样窗对不齐）；改用「真产物取指令 + 最小帧循环」既吃真语料又确定。整链仍 10/10 绿（无回归）。

**测试（主 agent 独立复跑核对）**
```
node --env-file=test/options.test.env --import tsx --test test/op-3-004-furigana-outer-gate.test.ts test/wait-gate-timer.test.ts test/op-10-002-adv-sleep-order.test.ts
→ tests 19 / pass 19 / fail 0
```
子代理另跑：`op-3-004` 8/8、相关五文件 63/63、八文件 73/73、`config1-chain` 10/10。

**文档同步（主 agent）**：`docs-new/03-engine/audit-2026-09-opcodes.md` 的 `### op-3-004` 节末句已换成「轮 7 已落地 + 三具体证 + 实测可观测时序 + 守卫位置」。

**锚点申报**：未删除/改写任何被锚定字面串（`op_display_furigana` ✔、`缺口棘轮` ✔、`*(_DWORD *)(_this + 489988) |= 0x10000u;` 在 `.c` 里未动 ✔）。被删的整段是**轮 6 自己写的**「未建模」注释与那条「断言尚未建模」的断言，二者都不是锚点。

**未解（如实登记，不在本票）**
1. `sub_453B60` 的返回值在引擎里会被折算成**行泵步数**（raw 13860/13874 → `sub_404F80`）；emulator 没有「按 tick 数补步」的逐字/行泵模型（`msgwin.ts` 明写「不补拍」）⇒ 属既有 `RevealState` 口径，本票未引入。
2. **帧粒度**：`gates.sleep` 在帧首判定（`loop.ts:296-299`），释放后要到下一帧才派发 ⇒ 40ms 档实测 66.7ms/处（4 帧），引擎同条件约 50ms（3 帧）⇒ **每处多约 1 帧**。这是既有 sleep 门特征（`0x6E` 同样如此），本票未动；将来若要对齐需改所有 sleep 门，不宜在此做。
3. raw 29079/29085/29101 的 `sub_41B640(..., 4)`：Hex-Rays 把 `_this[97055]`（`textBaseGate`）错当脚本指针（真实操作数表是 97059）⇒ 反编译里 `op4`/`a5` 的取值链**不可信**；`opcodes.json` 与 `CONFIG1.BIN` 实读均为 **argc = 3**，且 `a5 >= 0` 时唯一消费者 `sub_4691A0` 在体外 ⇒ emulator 明确不建模（已写进注释）。
4. ADV 支（raw 29081 `sub_46CBF0`）的自旋未建模（emulator 无文本渲染）⇒ 与 `0x6E` 同口径，以「不装门」表达。
