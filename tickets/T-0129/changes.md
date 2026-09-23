# T-0129 · 变更记录

## 第 1 次变更（2026-09-23）：注册表分类棘轮收成一张表（8 处 → 1 处）

### 做了什么

新增 `test/registry-classification.test.ts`（2 例，`@tier T0 @kind ratchet @subsystem vm`）：把散在
**8 个票文件**里的「这个 opcode 属于哪张表」的重复棘轮收成**一张数据表** `[opcode, 期望类别, 出处/理由]`：

| 原位置 | 覆盖的 opcode |
|---|---|
| `test/op-a4-a6.test.ts` | A6 ×3 + A4 ×13 |
| `test/op-a5.test.ts` | A5 ×11 |
| `test/op-a2-a3.test.ts` | A2/A3 ×13 + 读取端 4 条（更严：必须 `OPS`） |
| `test/op-1cb-2c8-2c9.test.ts` | 0x1CB / 0x2C8 / 0x2C9 |
| `test/op-327-32e-setweather-noop.test.ts` | SETWEATHER 族 ×5（`ENGINE_INTERNAL_OPS`） |
| `test/op-191-fabs.test.ts` | 0x191 |
| `test/op-d0-wallclock.test.ts` | 0xD0（整条用例只做分类） |
| `test/op-132-134-queue.test.ts` | 0x132/0x133/0x134 |

**判据没有降低，反而更严**：新表的每条同时断「**恰好在一张表里**」（三表两两不交由 `registry-tables.test.ts` 守）
**且就在它该在的那张**里，并给出**出处票号**；`op-132-134` 的循环里没有的「同 id 重复登记」也被第 2 条用例拦住。

- **删除 7 条重复用例**（上述文件里那 6 条纯分类用例 + 各处混在其它用例里的分类断言行），
  原地留下**指针注释**（指明去哪张表），不删任何行为断言。
- 顺便用自己写的新用例抓到一次**自己的错**：初版把 0x1D3/0x1D4/0x2F3/0x199 同时登记成
  「宽松集合」与「严格 `OPS`」⇒ 「表里没有重复登记」那条当场红。**这就是"去重"该有的自检。**

### 证伪（判别力实测）

把 `src/vm/handlers/engine-fields.ts` 里 `[0xd0, op_wall_clock_ms]` 那一行删掉（模拟"升级实现时忘了改分类"）：

```
✖ ★opcode 实现类别（一张表）：恰好在一张表里，且就在它该在的那张
   0xd0 三张表全无（命中即 NotImplementedOp）—— T-0093：墙钟毫秒（体里有真实效果：写 op1）
```

还原 ⇒ 绿。★原来那 8 处**各自**也能红，但改一处分类要改 9 个地方 —— 现在只改这一张表。

### 数字

| 口径 | 前 | 后 |
|---|---|---|
| 测试文件 | 165 | **166** |
| 用例 | 1086 | **1082**（−7 条重复、+2 条收编后的守卫，另有 `registry-classification` 的 2 条） |
| `npm run verify` | 31.3 s | **31.8 s**（全绿） |

★「用例变少」正是本票的目的：删掉的是**已被更强替身覆盖**的那一份，不是覆盖面。

---

## 仍未做（本票剩余范围）

1. **`adv-msgwin.test.ts:415-501/511-523` 的 5 组路由用例** → 让位给 `route-dispatch.test.ts`
   （后者用真 `stepOnce`、返回点精确到 `gateDword===17`）。预计 −5 例 / −90 行。**替身位置已核过**。
2. **存档族 10 文件 / 60 例 → 7 文件 / 51 例**：`save-slot-chain` → 并入 `slot-load-transfer`；
   `save-slot` 吃掉 `save-thumb` 的 2 例重复；`slot-load-screen` + `slot-load-l2d-reset` → `slot-load-presentation`。
   ★`save-slot-tdz` **必须保持独立**（import 顺序本身是被测对象）。
3. **`option-font-speed-menu.test.ts` 拆 3 主题**（字体表并入 `adv-msgwin`、菜单并入 `op-a2-a3`、注册表部分并入本表）⇒ 整文件可删。
4. **结构债**（与 `T-0020` 同源）：三份逐字重复的 Proxy `touched`、`RecordingNative` 2 份、WAV/OGG 合成件 2 份、
   `mkEngine(fsLike)` 2 份 ⇒ 上收 `test/harness.ts` 或新建 `test/operandHarness.ts`。

★纪律：每处去重都要在 changes.md 给出**被删断言的替身位置**（`file:line`）与**替身更强在哪里**，
并按本票 acceptance 用闸门 E 抽样复跑（删完仍必须被 ≥1 条测试抓到）。

---

## 第 2 次变更（2026-09-23）：删掉 `adv-msgwin` 里 3 组重复的「路由」用例（−87 行 / −3 例）

### 删了什么、替身是谁

| 删掉的（`test/adv-msgwin.test.ts`） | 替身（`test/route-dispatch.test.ts`） | 替身强在哪 |
|---|---|---|
| 点中热点 → 跳 **labelC**（`sub_404E00`） | 判据②（`:133`） | 用**真 `stepOnce`**；返回点精确到 `gateDword === 17`；还断 `cursor/enterPending/pages` 与"绝不是 labelA" |
| `0x93` 清空路由表 | 判据④（`:200`） | 多断 `hover` 复位与 `hitDone` **不**复位（raw 9958-9971） |
| 悬停派发两段式（enter/leave） | 判据①（`:111`） | 覆盖 h0→h1 的"先 leave 后 enter"、"一次只给一个 label"与稳定性 |

### ★保留了 `:556`（悬停**判定**阶段不改 ip）

它是 `pickHoverLabel` 的**纯判定**断言；`route-dispatch` 只测了**泵的派发**路径 ⇒ 这条没有替身，
删了会真丢覆盖。原地留了一段注释说明"哪三条被删、替身在哪、为什么这条留"。

### 证伪（删完必须证明替身真的扛得住）

闸门 E 新增 `M15_click_dispatches_enter_label`：把点击派发改成 **labelA（进入）** ——
那正是旧实现的错法。实测 **`route-dispatch.test.ts` 红 1/11**（判据②），即替身是承重的，不是摆设。

### 数字

| 口径 | 前 | 后 |
|---|---|---|
| `adv-msgwin.test.ts` | 45 例 | **42 例**（−3） |
| 全量用例 | 1088 | **1088**（同轮 T-0020 加了 3 条棘轮） |
| 闸门 E 清单 | 14 条 | **15 条**（全抓、0 登记缺口） |

---

## 第 3 次变更（2026-09-23，同会话续）：剩余①②③逐条核，④结构债上收

### 1. 先说结论：本票剩下三条标的中，**两条的前提经核对不成立**（替身更弱 ⇒ 不删）

| 标的（来自 §「仍未做」） | 核对结果 | 依据 |
|---|---|---|
| 存档族：`save-slot` "吃掉 `save-thumb` 的 2 例重复" | **不成立，保留** | `save-thumb.test.ts:190`（0x1AF 把 BMP 像素写进 **op3 指定的槽**、逐点一致）与 `:226`（0x1AE 写 .STH 再解码、往返逐点一致）↔ 替身 `save-slot.test.ts:272` 只断了 `0x1AF` 读**本工程自描述空块**返回 0（既不看 BMP、也不看 op3 槽）。**替身明显更弱** ⇒ 删了就真丢覆盖（T-0129 的纪律正是"替身必须更强"） |
| adv-msgwin 剩余路由用例（`0x090` 登记 / 热点表满 100） | **不成立，保留** | `route-dispatch.test.ts:319` 只覆盖 `0x090` 写 `ownerScriptId` 这一面；`adv-msgwin` 那两条断的是**矩形由 (x,y,w,h) 组装**与三个 label 的落位、以及"表满 100 抛错"——`route-dispatch` 完全没有这两条 |
| `option-font-speed-menu` "菜单并入 `op-a2-a3`" | **标的目标不存在** | `test/op-a2-a3.test.ts` 的 "A2/A3" 是**迁移阶段**（0x7B/0x7C/0x1BB/0xAE…），**不是 opcode 0xA1/0xA2/0xA3**；它一条菜单派发用例都没有。⇒ "整文件可删"不成立 |
| `option-font-speed-menu` 的消息速度族 | **成立，已删 2 例 / 保留 2 例** | 见下 §2 |

### 2. `option-font-speed-menu.test.ts`：删 2 例（消息速度族），其余 9 例是真覆盖

| 删除的 | 替身（更强在哪） |
|---|---|
| `0x1B5 设消息速度：写字段 + 写配置` | `adv-msgwin.test.ts:629`：同样断字段与注册表，**多**断"显现节拍立刻读新值"与"`0x74` 只写字段、不得改注册表" |
| `速度 1..99ms/字 的整段时长比值 > 5` | `adv-msgwin.test.ts:543` ②③：用**真脚本路径**断"越大越慢"与 `MessageSpeed=0 ⇒ 立即显示完`，比"比值 > 5"精确 |

**保留**（并已在原地留注说明为什么）：`beginReveal` 的具体数（`speed=99 ⇒ 99ms/字`、`speed=1` 被"一帧"地板住、`speed=0 ⇒ 不激活`）
与 `tickRevealWin` 的"每次 tick 最多推进一个字（不补拍）"—— 这两条是**直接模型层**的细判据，`adv-msgwin` 那侧当时写的是
`st.intervalMs === revealInterval(5)` + `× n === × n`（**镜像 + 恒真**）。⇒ **顺带把那处同义反复改成具体数**
（`1000 / 60` 与 `(1000/60) × 5`，`adv-msgwin.test.ts:606`），这也是 `T-0125` 的一处剩余。

其余 9 例（0x2DC/0x2DD/0x2DE 字体表 + `Amayui CN` 在表里、`0x5B ne` 的两条、`0xA1/0xA2/A3` 菜单派发 + 假缺口计数）
经核**没有替身**（`0x2DC` 族只在本文件与 `operand-plan` 的计划检查里出现）⇒ 文件保留，不再改名/拆分（那是纯组织，
本票的目的是"删冗余不损失检出"）。

### 3. 剩余④ 结构债：三处逐字重复上收 `test/harness.ts`（并缓解 `T-0020`）

| 上收物 | 原先 | 现在 |
|---|---|---|
| `RecordingAudioNative`（音频意图录制宿主） | `audio-opcodes` 与 `gallery-bgm-list` **逐字相同的两份**（含 `last` 的 getter） | `harness.ts` 一份；两文件 import。★`draw-item-loop-anim` 里那个同名但记的是 `setDrawItemLoop` 的类改名 **`LoopRecorder`**（同名不同物才是真隐患） |
| `trackArgs(args)`（操作数触碰观测 Proxy） | **4 处**各写一遍同样的 Proxy（`op-203`、`op-underun-fixups`、`opcode-operands`、`operand-plan`） | `harness.ts` 一份（`{ args, hits() }`）。★抽它的理由不是"少写几行"：口径（**读数字属性即记 `下标+1`**，1-based）原先有 4 份实现，任何一处漂移都会让同一批断言在不同文件里用不同口径 |
| `synthSlotScript()`（`SYS4450 ` + 3 张空表 + `i0x1a7` 的合成槽脚本） | `save-slot` 与 `save-thumb` 的 `mkEngine(fsLike)` 各一份 12 行字面量 | `harness.ts` 一份 |

**没上收的一处**：两处 WAV 合成件（`audio-node-host` 的 `wavBytes(byteRate,dataSize)` 与 `audio-silent-option` 的最小 RIFF）。
核对结果：**不是重复** —— 前者要 `byteRate` 精确以验算时长，后者只要一个能过解析的 RIFF 头（连 `channels/bits` 字段都不写）。
强行合一会让"最小件"被迫长出一个它不需要的参数面 ⇒ 记在此处，**不合并**。

### 4. 用例数 / 判据

- T0 用例：**799 → 797**（−2 = §2 的两条重复；其余全是"搬位置"，断言一字未改）。
- `npm run typecheck:test` 干净；`npm test` / `test:all` 全绿；闸门 E 复跑见下（本票 acceptance 要求：
  去重后对应的变异**仍须被 ≥1 条测试抓到**）。
