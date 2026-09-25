# T-0158 变更记录（指令实现缺口修复批：面板 / 菜单 / 输入）

> 本文件是**给主 agent 照抄的台账片段 + 逐条处置表**。三层台账（`analysis/*.json`）与
> `src/vm/engineFieldIds.ts` 归主 agent 串行结算，本票只写这里。
> 一切结论以**读体**为准（行号 = `engine/天结_unpacked.exe_utf8.c` 的 raw 行）。

## 1. 逐条处置表（P2 9 行优先）

| sev | 对象 | kind | 处置 | 依据 / 落点 |
|---|---|---|---|---|
| P2 | `0x91` | missing-consumer | **已修** | `handlers/panel.ts` 新增 `servicePanelDisplayState()` ＝ `sub_4098E0`（raw 14055-14105：消费刷 → `sub_403E70` 悬停两段式 → 左键 `sub_404120` labelC+清表 / 无点击 ⇒ `[12961]` 回退 label）；在"显示态重入"时调用（主循环 raw 21205-21208 那一支）。守卫 `test/panel-display-state.test.ts` |
| P2 | `0x91` | missing-branch | **已修** | 显示分支 `c.jump(-1)` + `c.frame.operandCount = 0`（引擎 raw 29528 写 3 → raw 29540 写 **0** ⇒ 派发器 raw 20165 `ip += 4*0`）；close 支不写长度槽（raw 29529-29533）⇒ 仍正常前进 |
| P2 | `0x92` | missing-branch | **已修** | 同上（raw 29552 写 5 → raw 29565 写 **0**） |
| P2 | `0x92` | missing-consumer | **已修** | `RoutePanel.fallbackLabel`（`[7467]`/`[12961]`）由 `servicePanelDisplayState()` 读（raw 14084-14092）⇒ **不再是死写**（`check:dead-writes` 的"只写无读"前提消失） |
| P2 | `0x94` | missing-branch | **只登记（不动手）** | 引擎 `sub_4B8D50` raw 140827 `if (_this[12958] \|\| _this[12957]) sub_403C50(...)`；`12958` 全反编译**无置 1 点**（只有 raw 29532/29556 的复位写 0）⇒ 有效门 = `12957`（面板已显示）。emulator 的 `input.onCursorMove` 无条件跑 —— 落点 `src/vm/engine.ts`（**不归本票**，交主 agent 派工）。★读体补充：本条的**可观测性**存疑 —— 命中测试的结果 `[7468]` 只被等待泵（`serviceAdvanceWait`，那里自己按 `panel.shown` 重算）与 `sub_404120` 消费 ⇒ "面板关闭期间的移动"两边不可观测地一致（审计行 218 亦如此结论） |
| P2 | `0x100` | missing-behavior | **部分修 + 剩余登记** | 已修：两条派发出口写长度槽 **0**（raw 25064）、早退支保持 **1**（raw 25024）—— 这就是"handler 决定 ip 是否前进"的 emulator 落点（`StepTrace.operandCount` 在 handler **之后**读，`interpreter.ts:220`）。**未修**：扫描游标复位仍用 `keyScanLastMask !== mask ⇒ b = 0` 近似（引擎唯一复位点是 `0xFF`，raw 25005/25038）—— 删它会让 `test/op-a5.test.ts:161/169`（三次不同掩码、中间无 `0xFF`）红，**那份守卫不在本票可写文件集**里 ⇒ 见 §4 交接 |
| P2 | `0x101` | missing-behavior | **已修** | 补三条写（raw 25077-25080）：① `effect_flags &= ~0x8000000` ② `_this[122367] = 1` ③ `_this[122370] = 0`。**第三条（审计只写了两条）经读体确认为 `_this[122367] = 1`**（raw 25079，夹在 `174802 = 0` 与 `122370 = 0` 之间） |
| P2 | `0x10c` | missing-consumer | **复核后已修（T-0163）** | `src/vm/input.ts:287` `keycodeToVk` + `:296` `vkToBit` + `:305-310` `setKeyBinding` + `:321-327` `pressKey`（查**运行期**表）；`DEFAULT_KEYCODE_TO_VK`/`DEFAULT_VK_TO_BIT` 现在只是**默认值真源**。守卫 `test/input.test.ts` 的 0x10C ①②③④ + `test/keyboard-mask.test.ts` ⑤ |
| P2 | `scene-norender-mode` | overreach | **台账订正片段见 §3.1** | fns/raw 覆盖面错：现有 7 个 fns 里 `sub_41A1A0`/`sub_412290` **全篇没有 167990 读点**；真值 = **19 处读 / 14 个函数 / raw 11132-141165**。（审计写"5 个函数无读点、11 处落在 11120-40120 之外"——**复现不出来**：实测 2 个 / 6 个） |
| P3 | `0x94` | approximation | **已修** | `showPanel` 的首次命中测试改**无条件**（引擎 raw 10023-10026 无条件 `GetCursorPos`+`ScreenToClient`+`sub_403C50`）；无光标时 `readX/readY = -100000` ⇒ 必然落 `[7468] = -1` |
| P3 | `0x94` | missing-behavior | **已修** | 同上一行（同一根因） |
| P3 | `0x97` | missing-consumer | **复核后已修（T-0163）** | `src/vm/input.ts:619`（`m \|= this.keyEdge;`）与 `:651`（`m \|= this.keysHeld \| this.keyEdge;`）**已无 `& 0x7f`** ⇒ `0x10C` 可把键映射到 7/8 位，`pickByKey`（engine.ts 的等待泵）能命中。★残留（**非本票**）：手柄位 4+i 仍无产品注入者（`pressJoy` 只有 test 调用）|
| P3 | `0x97` | missing-branch | **前提被推翻** | `0x97` 的落点 `sub_403D10`（raw 9827-9844）`_this[v4 + 7361] = a3;` **没有任何值域检查**；`sub_403D70`（raw 9857）也直接 `1 << *i`。x86 `shl` 与 JS `<<` 都把移位量掩到 5 位 ⇒ **不是分歧**（审计报告 row 419/626 自己也如此订正）。⇒ **不得**在 `route.ts` 加自造的 `0x1F` 上限；已在 `pickByKey` 的 doc 里写明口径（引 raw） |
| P3 | `0x108` | host-invented | **如实登记为做不到（有意保留）** | 引擎 `0x108`＝`sub_42EDC0` raw 39046-39055：`v3 = 0; sub_477220(&v3); writeInt(1, v3)`，而 `sub_477220`（raw 91626-91642）是 `GetAsyncKeyState(1)/ (2) & 0xFF00` ⇒ **无任何保持位**。emulator 的 `pressLatch` 是**宿主时序补偿**（VM 一批可跨多帧，down+up 可能落在同一次轮询之间）。删它会让 **`test/title-exit.test.ts:107-122`**（明写"靠 `InputManager.pressLatch` 保证按下被读到一次"）红 ⇒ 本票不改（正确修法在**帧循环的输入采样**，见 §4） |
| P3 | `0x147` | approximation | **已修** | `polygonRegionFailure()`：`n < 2` 走引擎的 else 支（raw 39696-39700）——**打错误串**「リージョン作成失敗しました」（`asc_520808` raw 4451）+ `op1 = 0`（结果修前就对，缺的是那句串与"失败支可达"的登记）。守卫 `test/region-hittest-n.test.ts` |
| P3 | `0x147` | host-invented | **已修** | 删掉自造的 `n > MAX_POINTS(2^20) ⇒ throw`。引擎唯一的边界是 raw 39676 的 `operator new[](8*n)`（32 位宿主上 n > 0x0FFFFFFF 分配不出来）⇒ 现按 `ENGINE_POINT_ALLOC_MAX = 0x0FFFFFFF` 上界走 else 支（**不抛**）并记日志。★订正审计的口径：`operator new[]` 失败在 MSVC 下是**抛 bad_alloc → 终止**，不是"正常写 op1 = 0"；emulator 无法表示"进程终止"，故取"最接近的可表示行为"并写进注释 |
| P3 | `0xff` | missing-operand-io | **已修** | 补 `Engine[cur + 122327] = Engine[517]`（raw 25007）。★该格**有真读者**（`sub_419D20` raw 25096 读、raw 25134 回写），但**对应的指令（`0x10F` 一族）在 emulator 尚未实现** ⇒ 目前是"按体如实写 + 读者待接"（§4）。守卫 `test/input-field-mirror.test.ts` |
| P3 | `0x2fc` | missing-consumer | **如实登记为做不到** | 引擎 `sub_477980` raw 92162-92163：遍历触点缓冲后"没有任何合法项"⇒ `*(_DWORD *)(v4 + 6776) = 0`（= `Input[1694]`，触点项计数；构造 raw 92412 初值 0）。**emulator 完全没有触摸/手势触点缓冲**（`0x2FC` 恒走无触点路径）⇒ 该清的触发条件不存在，也无消费端读该计数。重开条件：宿主接入触摸/触控笔注入 + 触点缓冲（与 `0x308` 同批） |
| P3 | `0x308` | missing-behavior | **不归本票（交接）** | handler 在 `src/vm/handlers/stubs.ts`（`op_stub_unhandled`，审计 P2 行 180 有更完整的缺口描述：`LoadLibraryA`+`GetProcAddress` 的 `RegisterTouchWindow`/`UnregisterTouchWindow`、门 `op1 \|\| (GetConfig("system:limitTouch") & 1)`、`_this[1954] = op1`）。本票不可写该文件 |
| P3 | `0x10c` | missing-operand-io | **复核后已修（T-0163）** | 写出口 `Input[1176 + Input[1432+键码]]` 的两张表都在：`keycodeToVk`(:287) / `vkToBit`(:296)，写入端 `setKeyBinding`(:305) —— 见 P2 `0x10c` 行 |
| P3 | `adv-advance-route-table` | overreach | **台账订正片段见 §3.2** | `reads` 把 panelA 的**相对**字节偏移当成了 Engine 绝对偏移：`[7468]` 实际 = `21976 + 4*7468` = **51848**、`[7466]` = **51840**（现写 29872/29864，与同列表的 `Engine+21976(0x55D8)` 量纲不一致） |
| P3 | `0xa2` | missing-diagnostic | **有意保留（登记）** | 引擎 `sub_434D00`（raw 42832-42866）的容量/重排（raw 42858-42859 `(int)++_this[1] > (int)_this[4]` ⇒ `sub_434910`）与"命中 ⇒ 覆写槽值 + 重写键串"（raw 42863-42864）在 emulator 用 `Map.set` 表达：**覆写语义一致**，容量/装载因子**无语义可观测差**（查询结果只取决于键）。重开条件：真出现"表满/探针死循环"（raw 42854 的 `for (; …; v9 = (v9+1) % _this[2])`）或脚本依赖登记失败 |
| P3 | `0xa3` | missing-operand-io | **已修（范围收敛，见下）** | `handlers/menu.ts` 新增 `keyOf(c)`：**字符串族**操作数（tag `2`/`5`/`8`/`0xB`/`0xE`）走 `readStringOperand`（= 引擎 `sub_41B640(_this, 1)` raw 26249-26360 的字符串 case）；数值族保持原口径 `String(plan.int(1) ?? 0)`（半角十进制）。★**为什么不全用 `readStringOperand`**：`T-0165` 的在飞改动已把 `readStringOperand` 接上**全角化**（`sub_41A6C0`，raw 26331/26347 → `src/vm/operand.ts` 的 `toFullWidthNumber`）⇒ 数值键会变成 `０`/`－１`，而 `test/menu.test.ts:36-39` 直接以 ASCII `'0'`/`'-1'` 检查 `menuMap` ⇒ **会新增红**（该文件不在本票可写集）。登记与派发**两侧同源**，故半角口径在语料内不可观测（941 脚本里 `menu-bind` 87 处 / `menu-dispatch` 8 处的键**全是数值族**，0 处字符串族）。**不改 `operandPlan.ts`**（op1 仍声明为 `int`）⇒ 绕开计划层的类型拒绝。守卫 `test/menu-string-key.test.ts` |
| P3 | `0xa3` | missing-branch | **登记为已声明偏差（+ 补诊断）** | 引擎 raw 35752/35754 **无条件** `ip = ip_base + 4*目标`（不校验合法性）；目标不是指令边界时是**野跳**。emulator 的 ip 是**指令下标**、无地址空间可野跳 ⇒ 保留"什么都不做"（既有守卫 `test/menu.test.ts:50-53` 钉的就是这个口径），但**补 `c.log`** 让这件事不再静默。先例 = `Engine.#cancelRoute`（`engine.ts:1329-1334`，同一句 `ip = ip_base + 4*表项` 的登记口径）。重开条件：确认真机在"表值与脚本不一致"时的表现，再决定是否改硬错误 |
| P3 | `0xa2` | missing-operand-io | **已修** | 同 `0xa3`（`keyOf(c)` 一处修复服务两条） |
| P3 | `0x10d` | approximation | **复核后已修（T-0171）** | `src/vm/input.ts:500-518` `addWheel`：模式开（`Engine+699204 & 0x90100000`）⇒ 只在**位号 ≥ 0** 时 `\|= 1 << (bit & 31)` 然后**一律 return**；负位号什么都不做 ⇒ 不再回流到 `wheelDelta` 累加器（引擎累加支是模式门的 `else`，raw 141580-141583） |
| P3 | `0x2e5` | approximation | **复核后已修（T-0171）** | `src/vm/input.ts:525-539` `addHWheel`：同门同形（raw 141588-141611） |

### 读体时**新发现**的条目（审计未列 / 与审计口径不同）

1. **`0x101` 的第三条写 = `_this[122367] = 1`**（raw 25079）—— 审计行 121 只写了 ①`&= ~0x8000000` ②`122370 = 0` 两条并列"三条引擎写"，第三条**没有点名**；读体确认是 `122367`（夹在 `174802 = 0` 与 `122370 = 0` 之间）。
2. **`sub_4098E0` 的三条出口里只有两条压返回点**（读体 raw 14073-14080 vs 14084-14093/14095-14103）：左键走 `sub_404120` 是**直接改 ip、不压返回点、不调 `sub_4083B0`**；回退 label 与悬停两条都 `sub_4083B0` + 压返回点（回退支经 `sub_405360(_this, 0)`）。审计未区分这一点。
3. **`sub_4098E0` 还有一个未建模子步 `sub_403DD0`**（raw 14065 → 体 raw 9865-9917）：方向键/翻页键按掩码位移动 `[7468]`（用 `[960]` 步长）并置 `[7466]`。emulator 的 `RoutePanel` 没有这条支 ⇒ 已写进 `servicePanelDisplayState()` 的注释（登记）。
4. **`scene-norender-mode` 的审计计数复现不出来**：审计 row 506 说"5 个函数在本区间内没有任何读点、19 处引用有 11 处落在 `engine.raw=11120-40120` 之外"；实测（`grep 167990` 逐行 → 归属函数）是 **19 处读 / 14 个函数 / raw 11132-141165**，其中现有 `fns` 里**只有 2 个**（`sub_41A1A0`/`sub_412290`）全篇无读点，**6 处**读落在 40120 之外（40804/40903/40986/42089/42142/141165）。
5. **`operator new[]` 失败不是"正常写 op1 = 0"**（P3 `0x147` host-invented 的口径订正）：MSVC 的 `operator new[]` 失败抛 `bad_alloc`（无 `nothrow` 时）⇒ 真机在 `CreatePolygonRgn` **之前**就终止。审计那条的结论（"不该 throw"）成立，但理由要改：emulator 不该 throw 是因为**引擎那里根本没有 emulator 自造的业务上限**，而引擎自己的分配边界不可表示。

## 2. 红→绿证据

**红**（把本票的 src 改动整体反向应用后再跑；`.tmp/c158/fix.patch` = 本票 5 个 src 文件的 `git diff`）：

```
cd E:\Games\Eushully\天結
git diff -- app/amayui-emulator/src/vm/handlers/panel.ts app/amayui-emulator/src/vm/handlers/input.ts ^
            app/amayui-emulator/src/vm/handlers/menu.ts app/amayui-emulator/src/vm/handlers/region-hittest.ts ^
            app/amayui-emulator/src/vm/route.ts > .tmp/c158/fix.patch
git apply -R .tmp/c158/fix.patch
cd app/amayui-emulator
node --import tsx --test test/panel-display-state.test.ts test/menu-string-key.test.ts ^
                          test/input-field-mirror.test.ts test/region-hittest-n.test.ts
  ⇒  ℹ tests 20   ℹ pass 3   ℹ fail 17
```

**绿**（`git apply .tmp/c158/fix.patch` 恢复后）：

```
  ⇒  ℹ tests 20   ℹ pass 20  ℹ fail 0
```

红→绿逐条（17 条红 / 3 条"不许改坏"的回归锁在两边都绿）：

| 守卫 | 红（修前） | 绿（修后） |
|---|---|---|
| `panel-display-state.test.ts` P2 `0x91`/`0x92` 长度槽 + ip 停在本条 | ✖（ip 前进到 1） | ✔ |
| 同上 `0x92` missing-consumer（回退 label 派发 + 返回点） | ✖（`fallbackLabel` 无读者） | ✔ |
| 同上 `0x91` missing-consumer（左键 ⇒ labelC + 清表） | ✖ | ✔ |
| 同上 `0x91` missing-consumer（悬停 enter/leave） | ✖ | ✔ |
| 同上 P3 `0x94`（无条件命中测试） | ✖（游标停在旧的 0） | ✔ |
| `input-field-mirror.test.ts` P3 `0xff`（镜像格） ×2 | ✖ | ✔ |
| 同上 P2 `0x101`（三条写） | ✖ | ✔ |
| 同上 P2 `0x100`（两条出口槽 = 0 / 早退 1） ×2 | ✖ | ✔ |
| `menu-string-key.test.ts` 字符串键（P3 `0xa2`/`0xa3`）×2 | ✖（`atoi` 退路 ⇒ 键错） | ✔ |
| 同上 P3 `0xa3` missing-branch（诊断日志） | ✖（静默） | ✔ |
| `region-hittest-n.test.ts` P3 `0x147` ×3（n=0/1 错误串、n>2^20 不抛） | ✖（无日志 / 抛异常） | ✔ |
| **回归锁**（两边都绿）：数值族键仍是半角十进制串、字符串键与数值键落同一格（已登记偏差）、`n=2` 仍走 geometry | ✔ | ✔ |

**相邻既有守卫**（不改它们、证明没被弄坏）：

```
node --import tsx --test test/panel-display-state.test.ts test/menu-string-key.test.ts ^
       test/input-field-mirror.test.ts test/region-hittest-n.test.ts test/input.test.ts ^
       test/wheel-as-key.test.ts test/menu.test.ts test/op-a5.test.ts test/route-dispatch.test.ts ^
       test/op-147-2f2-region-hittest.test.ts test/keyboard-mask.test.ts ^
       test/adv-right-click-cancel-route.test.ts test/option-font-speed-menu.test.ts ^
       test/adv-msgwin.test.ts test/char-reveal.test.ts test/keyboard-scenario-menu.test.ts
  ⇒  ℹ tests 157   ℹ pass 156   ℹ fail 1
```

唯一那条红是 **`test/input.test.ts` 的 TITLE 端到端**：`0x34e`（`live2d.ts:365`）抛
`L2Dモーションファイル TITLE.MTN の読み込みに失敗しました` —— **不是本票**（T-0160 的在飞改动把
`0x34e` 从"记一条 log 后 return null"改成了抛异常）。**已实测证明**：把本票 patch 反向应用后再跑
`test/input.test.ts`，同一条**照样红**（13/14）⇒ 与本票无关。

类型检查：`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` ⇒ **无输出（干净）**；
`tsconfig.test.json` 有 5 条错，**全部**在 `test/config-t0161.test.ts` / `test/engine-fields-t0161.test.ts`
（T-0161 的文件），本票 4 个新测试文件不在其中。

## 3. 给主 agent 的台账片段（可照抄）

### 3.1 `analysis/engine-capabilities.json` → `entries[id = "scene-norender-mode"]`

替换 `engine` 块（`name`/`reads`/`whySilent` 当前已订正，不动）：

```json
"engine": {
 "fns": [
  "sub_405530",
  "sub_4065F0",
  "sub_406650",
  "sub_40A4C0",
  "sub_425DB0",
  "sub_425E20",
  "sub_42EE10",
  "sub_42FBC0",
  "sub_430A20",
  "sub_431BA0",
  "sub_431CF0",
  "sub_432000",
  "sub_433AB0",
  "sub_4B92F0"
 ],
 "raw": "11132-141165"
}
```

要点：① `sub_41A1A0`/`sub_412290` **删掉**（全篇无 `167990` 读点）；② `raw` 从 `11120-40120` 扩到 `11132-141165`（19 处读的实测范围）；③ 9 个函数是**新增**的（`sub_425DB0`/`sub_425E20`/`sub_42EE10`/`sub_42FBC0`/`sub_431BA0`/`sub_431CF0`/`sub_432000`/`sub_433AB0`/`sub_4B92F0`）。逐处读点：

```
sub_405530 11132 · sub_4065F0 11749,11752 · sub_406650 11764,11767 · sub_40A4C0 14778,14912
sub_425DB0 33200 · sub_425E20 33215 · sub_42EE10 39090 · sub_42FBC0 39592,39635 · sub_430A20 40114
sub_431BA0 40804 · sub_431CF0 40903 · sub_432000 40986 · sub_433AB0 42089,42142 · sub_4B92F0 141165
```

`emulator.evidence` 的代码锚（审计 row 506 记的 `src/vm/handlers/input.ts:366` = `onCursorMove?:`）与 `167990` **无关**，建议改锚 `src/engineConfig.ts:235`（`display:ScreenMode` 的填充/绑定点，审计 row 465 已确认与体一致）+ `test/engine-config.test.ts`。

### 3.2 `analysis/engine-capabilities.json` → `entries[id = "adv-advance-route-table"]`

替换 `reads`（**只改量纲，语义不变**）：

```json
"reads": [
 "Engine+21976(表基址 0x55D8)",
 "Engine+51848(游标 panelA[7468])",
 "Engine+51840(推进标志 panelA[7466])"
]
```

推导：panelA 基址 = `Engine+0x55D8` = `Engine+21976`（字节）；`[7468]` → `21976 + 4*7468 = 51848`；`[7466]` → `21976 + 4*7466 = 51840`（原值 29872/29864 正是 `4*7468`/`4*7466` 的**面板相对**偏移）。同列表里 `Engine+21976` 是按字节写的 ⇒ 修后量纲一致。

### 3.3 `analysis/opcode-gaps.json`：本票涉及条目的处置建议

| 对象 | kind | 建议 disposition |
|---|---|---|
| `0x91` | missing-consumer / missing-branch | **fixed**（guard `test/panel-display-state.test.ts`；残留子步 `sub_403DD0` 另开一条 partial） |
| `0x92` | missing-branch / missing-consumer | **fixed**（同上，`fallbackLabel` 已接读者） |
| `0x93`/`0x91`（`sub_403DD0`：方向键/翻页键移动游标） | missing-behavior（**新**） | `partial`：`servicePanelDisplayState()` 注释里已登记；扩展点 = `RoutePanel` 增加 `moveCursorByKey(mask)`（体 raw 9865-9917） |
| `0x94` | approximation / missing-behavior | **fixed**（`showPanel` 无条件命中测试） |
| `0x94` | missing-branch（`onCursorMove` 门） | 保持 open（**落点 `src/vm/engine.ts`，不归 T-0158**） |
| `0x100` | missing-behavior | `partial`：长度槽（= handler 决定 ip 是否前进）已实现；**扫描游标复位仍是掩码变化近似**（删它要同步改 `test/op-a5.test.ts`） |
| `0x101` | missing-behavior | **fixed**（三条写，含审计未点名的 `122367`） |
| `0xff` | missing-operand-io | **fixed（写端）** + 新 reader 缺口：`Engine[cur+122327]` 的读者 `sub_419D20`（`0x10F` 一族）在 emulator 未实现 |
| `0x108` | host-invented | `partial`：**有意保留的宿主时序补偿**，pin = `test/title-exit.test.ts:107-122`；正确修法 = 帧循环的输入采样（见 §4） |
| `0x147` | approximation / host-invented | **fixed** |
| `0x10c` | missing-consumer / missing-operand-io / missing-branch | **fixed**（T-0163，本票复核确认） |
| `0x97` | missing-consumer | **fixed**（T-0163 的 `& 0x7f` 删除 + 运行期 VK→位表）；残留：手柄位无产品注入者（host 侧） |
| `0x97` | missing-branch | **not-a-gap / 口径订正**（x86 与 JS 移位都模 32） |
| `0x2fc` | missing-consumer | `deferred`（无触摸缓冲；重开条件见 §1 该行） |
| `0x308` | missing-behavior | 保持 open（**落点 `src/vm/handlers/stubs.ts`，不归 T-0158**） |
| `0xa2` | missing-operand-io | **fixed**（字符串键） |
| `0xa2` | missing-diagnostic | `partial`（容量/重排无语义可观测差；重开条件见 §1） |
| `0xa3` | missing-operand-io | **fixed** |
| `0xa3` | missing-branch | `partial`（已声明偏差 + 新增 `c.log` 诊断；先例 `#cancelRoute`） |
| `0x10d` / `0x2e5` | approximation | **fixed**（T-0171，本票复核确认） |

### 3.4 建议新增的引擎字段（`analysis/fields.json` + `src/vm/engineFieldIds.ts`）

| 字段 | 体证 | emulator 现状 |
|---|---|---|
| `Engine/122327`（**逐帧**：`_this[cur + 122327]`）`key_scan_fallback` | 写：`0xFF` raw 25007（= `Engine[517]`）；读/回写：`sub_419D20` raw 25096/25134 | `handlers/input.ts` 的 const `FIELD_KEY_SCAN_FALLBACK`（本票新写） |
| `Engine/122367` `frame_field_122367` | `0x101` raw 25079 `= 1`。语义未定位（与 `122369` 同族，后者已是 `ENGINE_FIELD.frameField122369`） | `handlers/input.ts` 的 const `FIELD_FRAME_122367` |
| `Engine/122370` `cancel_message_key_state` | `0x101` raw 25080 `= 0`；三态机读写 raw 20119-20141（`sub_411900`） | `handlers/input.ts` 的 const `FIELD_CANCEL_MESSAGE_KEY` |
| `Engine/12961` `panel_fallback_label` | 写：`0x92` raw 29561；读：`sub_4098E0` raw 14084 | `RoutePanel.fallbackLabel`（route.ts） |

> ★主 agent 若把这几个常量搬进 `engineFieldIds.ts`，请把 `handlers/input.ts` 里的本地 const 一起换成 `ENGINE_FIELD.*`
> （本票不能改 `engineFieldIds.ts`，所以只放了带 raw 引用的本地 const）。

## 4. 交接：本票做不到 / 不归本票的（含判断别人该接什么）

| 对象 | 为什么不做 | 该谁接 / 怎么接 |
|---|---|---|
| P2 `0x94` `onCursorMove` 无 `[12957]` 门 | 落点 `src/vm/engine.ts`（`Engine` 构造函数把 `input.onCursorMove` 接到 `routes.hitTest`）——**本票禁写该文件** | B1（engine.ts 的 owner）：把回调改成 `if (this.routes.shown !== 0) this.routes.hitTest(x, y)`（或让 `Engine` 在回调里读 `panelShown`）。★先读体：`12958` 恒假（raw 140827 的 `\|\| _this[12958]` 是死项），**不要**照 `12958` 建门 |
| P2 `0x100` 的扫描游标近似 | 删 `keyScanLastMask` 近似会让 `test/op-a5.test.ts:161/169` 红（三次不同掩码、中间没有 `0xFF`）；该文件**不在本票可写集**（本票只能新建 `test/*.test.ts`） | 拥有 `test/op-a5.test.ts` 的 owner：在三次 dispatch 之间插一次"游标复位"（`e.engineValues.set(ENGINE_FIELD.keyScanCursor + e.cur, 0)` 或直接跑一条 `0xFF`），然后删 `handlers/input.ts` 里的近似块（注释里已写明）。★真机语义：引擎游标**只**由 `0xFF`（raw 25005）复位、由 `0x100`（raw 25038）前进 |
| P3 `0x308` 触摸注册 | handler 在 `src/vm/handlers/stubs.ts`（`op_stub_unhandled`）——**本票禁写** | stubs.ts 的 owner：按 `sub_407B20`（raw 12587-12616）实现 `LoadLibraryA("USER32.DLL")` + `GetProcAddress` 的 `RegisterTouchWindow(hwnd, 2)`/`UnregisterTouchWindow` + 门 `op1 \|\| (GetConfig("system:limitTouch") & 1)` + `_this[1954] = op1`（审计行 180/259/260/261 有全套材料） |
| P3 `0x2fc` 触点计数清零 | emulator **没有触摸/手势触点缓冲**（`0x2FC` 恒走无触点路径）⇒ 触发条件不存在，也无消费端 | 与 `0x308` 同批：先有触摸注入（宿主 → `InputManager` 的触点缓冲 `Input[6776]`/`Input[1694]`/`+-40` 字节项，raw 92117-92165），再谈这条清空 |
| P3 `0x108` `pressLatch` | 删它会红 `test/title-exit.test.ts:107-122`；且它补偿的是"VM 一批跨多帧"这一**帧循环**问题 | 帧循环 owner（`src/frame/loop.ts` / `engine.ts`）：正确修法是**在帧边界采样输入**（引擎每帧 `GetAsyncKeyState` 轮询真值，raw 91626-91642 / 91551-91568），然后删 `pressLatch` 并同步改 `title-exit.test.ts` 的时序期望 |
| P3 `0xff` 的新字段读者 | `Engine[cur+122327]` 的读者 `sub_419D20`（raw 25085-25160，审计称 `0x10F` 一族）在 emulator **未实现** | 拥有 `handlers/input.ts` 的 opcode 表的人（本票已按体写出该格；接 `sub_419D20` 时直接读 `e.engineValues.get(122327 + e.cur)`） |
| P3 `0x91`/`0x92` 的 `sub_403DD0` | 方向键/翻页键移动游标（raw 9865-9917）在本票范围外（属 `RoutePanel` 的新支） | `route.ts`/`panel.ts` 的 owner：新增 `RoutePanel.moveCursorByKey(mask)`（向上/向下按 `mask & 1`/`mask & 2`，左右按 `[960]` 步长），在 `servicePanelDisplayState()` 里替换注释里的"未建模" |
| 主循环那一支的"每轮一次"节流 | emulator 的帧循环**没有** `0x800000` 这一支；本票用"显示态重入时跑一轮泵"实现（与引擎的 `Sleep(0)`+`PeekMessage` 自旋同构） | 若将来 `src/frame/loop.ts` 要加 `panel-display` 分支（与 `'sleep'`/`'anim'` 平级），把 `servicePanelDisplayState` 从 `handlers/panel.ts` 导出并接上即可（函数已是 `StepCtx` 形状、可直接复用） |
| `0xA2`/`0xA3` 键的全角化统一 | 本票只修字符串族（见 §1 的 `0xa3 missing-operand-io` 行）；全角化在场的是 `operand.ts`（T-0165 在飞） | `operand.ts` 的 owner：把菜单键也统一成 `readStringOperand`（全角数值键）时，需**同时 retarget `test/menu.test.ts:36-39`**（ASCII `'0'`/`'-1'` → 全角 `'０'`/`'－１'`）与 `test/option-font-speed-menu.test.ts`；本票不越界改那两处 |

## 5. 命令与结果

见 §2（红 20/3/17 → 绿 20/20/0；相邻既有守卫 157/156/1，唯一红是 T-0160 的 `0x34e`，已实测与本票无关）。

本票**没有**动 `analysis/*.json`、`tickets/*`（除本文件）、`engineFieldIds.ts`、`operandPlan.ts`、
`operand.ts`、`engine.ts`、`frame/loop.ts`、`stubs.ts` 与任何 `src/` 其它文件 —— 可写集只有
`handlers/{menu,panel,input,region-hittest}.ts`、`interpreter.ts`（本票最终**未改**：`0x91`/`0x92` 的
"ip 停在本条"用 `panel.ts` 里的 `c.jump(-1)` 实现，`stepOnce` 的既有 `next === -1` 支就够了）、
`input.ts`（vm，本票**未改**：`0x10c` 的两张表已是 T-0163 的成果）、`route.ts`。

`git diff --stat`（本票 5 个 src 文件，2026-09-25 实测）：

```
 app/amayui-emulator/src/vm/handlers/input.ts       |  96 +++++++++++++--
 app/amayui-emulator/src/vm/handlers/menu.ts        |  76 ++++++++++--
 app/amayui-emulator/src/vm/handlers/panel.ts       | 129 ++++++++++++++++++++-
 app/amayui-emulator/src/vm/handlers/region-hittest.ts | 40 ++++++-
 app/amayui-emulator/src/vm/route.ts                |  16 ++-
 5 files changed, 329 insertions(+), 28 deletions(-)
```

新增测试 4 个文件（`test/panel-display-state.test.ts` 6 例 / `test/menu-string-key.test.ts` 5 例 /
`test/input-field-mirror.test.ts` 5 例 / `test/region-hittest-n.test.ts` 4 例 = **20 例**；其中 3 例是
"两端都绿"的回归锁 —— 数值族键仍是半角十进制串、字符串键与数值键落同一格、`n = 2` 仍走 geometry）。

**锚点棘轮**：改动前对 6 个文件跑过 `tickets.js --anchors-in`，涉及本票可写文件的锚点是
T-0028（`function showPanel`）、T-0046（`e.input.joyJump[keyTotal]`）、T-0047（`c.e.input.mouseSlot = slot;`）、
T-0048/T-0053（`const op_set_mouse_pos: OpHandler`）、T-0058（`c.native.setSystemCursor?.(x, y);`）、
T-0077/T-0081/T-0163（`[0x10c, op_set_key_multi]`）、T-0082（`输入族走操作数计划层`）、
T-0133（`sub_403C50`（raw 9787-9824）：**按坐标命中测试**）、T-0014（`loadScriptData`）——
**全部逐字保留**（只在其周围追加/重写别的句子），未删任何一条。

## 6. 变更清单

| 文件 | 改了什么 |
|---|---|
| `src/vm/handlers/panel.ts` | `showPanel` 无条件命中测试；新增 `servicePanelDisplayState()`（`sub_4098E0`）；`0x91`/`0x92` 显示分支 `jump(-1)` + 长度槽 0；文档订正 |
| `src/vm/handlers/input.ts` | `0x101` 三条写；`0xFF` 镜像；`0x100` 长度槽镜像（两条出口 0 / 早退 1）；`0x100` 游标近似加偏差注释 |
| `src/vm/handlers/menu.ts` | `keyOf()`：op1 走 `readStringOperand`（字符串键）；`0xa3` 目标不可解析时补 `c.log` |
| `src/vm/handlers/region-hittest.ts` | 删 `MAX_POINTS` throw；`ENGINE_POINT_ALLOC_MAX` 边界 + `polygonRegionFailure()`（错误串 + `op1 = 0`） |
| `src/vm/route.ts` | `fallbackLabel` 的读者说明；`pickByKey` 的"无 0x1F 上限、移位模 32"口径（引 raw） |
| `test/panel-display-state.test.ts` | 新（7 例） |
| `test/menu-string-key.test.ts` | 新（4 例） |
| `test/input-field-mirror.test.ts` | 新（6 例） |
| `test/region-hittest-n.test.ts` | 新（4 例） |
