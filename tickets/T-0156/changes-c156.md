# T-0156 变更记录 —— 指令实现缺口修复批：控制流 / 帧管理 / 脚本装载

> 范围：工作清单 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的 `## T-0156` 节（P2 7 / P3 28 = 35 条）。
> 权威 = `engine/天结_unpacked.exe_utf8.c`（只读）。raw 行号 = 该文件行号。
> 可写面（本票）：`src/vm/handlers/{control,frame}.ts`、`src/vm/engine.ts`、`test/t0156-*.test.ts` + 一处最小 retarget。

## 1. 一句话结论

**P2 七条全部落地**（每条一个能失败的具名守卫；最终 20 例守卫 vs 修前代码 = **红 7/20 → 绿 20/20**，
13 条红断言覆盖全部修点）；
其中 `0xc8` 的 P2 是**部分修（可复刻的那一半）+ 架构性近似如实登记**（读体 + 实测反例：把 `n<10` 支做成
"不装帧门"会让帧循环空转冻结，见 §2 行 5）。P3 中 3 条读体后发现**归属/前提错**（不是缺口）、
2 条同类廉价修复（`0x5` 的 `-1` 返回点、`0x6` 的深度门文案 + `caller`、`0x8` 的未预装文案），其余如实登记；
新增/订正 6 条引擎事实（见 §4）；**一处**最小 retarget（`op-132-134-queue.test.ts` 的容器规模）；
未做项与判断别人该接的在 §5。

## 2. 逐条处置表（35 条）

| # | sev | 对象 | kind | 处置 |
|---|---|---|---|---|
| 1 | P3 | `0x1f5` | missing-operand-io | **复核后已修**（T-0157 已落到树里）：`handlers/frame.ts` 的 `op_frame_countdown` 三层门齐备 —— ② 停靠标志原值判据、③ `dispatchInProgress`、清位与派发同次进入（raw 25221-25235）。 |
| 2 | **P2** | `0x7c` | missing-branch | **修了**：深度校验改**无条件**（`handlers/frame.ts` `op_redisplay_return`）。守卫 `t0156-control-frame.test.ts`「深度校验无条件」。 |
| 3 | P3 | `0x7c` | missing-operand-io | **部分修 + 登记**：豁免注释按体收窄（`81776/81768/51840` 无读者 ⇒ 跳过；**`51848` 有读者** raw 20005/20013 ⇒ 记为"选择/列表框模型未建"的缺口）。 |
| 4 | P3 | `0x7c` | missing-consumer | **如实登记为做不到**：`387940` 在全反编译**无写者**（门恒假），实现它需要先有写者（选择/列表框子系统）⇒ 无消费者可接，不许编。 |
| 5 | **P2** | `0xc8` | approximation | **部分修（可复刻那一半）+ 架构性近似登记**：`sleepPath()` 判定 + `op_sleep` 让两支分开表达 —— 修掉旧实现的两处错（`Math.max(1,n)` 把 `Sleep(0)` 抬成 1ms；两支都不武装 `effect_flags |= 1`）。**`n<10` 不装帧门这一半做不到**：帧循环 `maxStepsPerFrame` 默认 `Infinity`（`frame/loop.ts:304`），TITLE 的 `sleep 1; jmp`（`src/TITLE.txt:63`）会**同帧内永不 yield**（实测反例：该版本让 T0+T1 批量跑挂死）⇒ 两支都装 `SLEEP_GATE` 是"阻塞当前线程"的架构等价物。守卫「两支分离」。 |
| 6 | **P2** | `0xae` | missing-branch | **修了（精确口径）**：版本门不再被 `direct`（记录带 `instr`）短路，但**也不能**无条件施加到本工程格式上（本工程槽头 `format = 0` ⇒ `sv1 = 0 ∉ {1,2,3}` ⇒ 无条件会让本工程槽续跑整体失效，实测 `slot-save-resume.test.ts` 3 条全红）。最终三条规则：① 槽头声明带 `sv2` 约束的版本（`sv1==1`）⇒ `sv2` 必须匹配；② `sv1 ∉ {1,2,3}` 且记录**无 `instr`**（引擎格式但无版本号）⇒ 不进；③ 其余 ⇒ 进。守卫 4 条（含正例与两条边界）。 |
| 7 | P3 | `0xae` | missing-operand-io | **有意保留**（等价实现）：`resume.sv1/sv2`（容器头 +284/+288）**优先于**注册表 —— 本工程槽的 `format` 恒 3/`aux` 20（`engineSlotFixtures.buildSlotFile` 的 284/288），是同一份槽自己声明的版本；既有守卫 `slot-load-resume.test.ts:212` 就钉这条设计。 |
| 8 | P3 | `0xae` | missing-operand-io | **等价实现，字段未具名**：引擎的 `97153`（深度）/`256*cur+97193+i`（返回栈数组）由 emulator 的 `resolveSlotRetStack` + `frame.retStack` 承接（口径同为 dword 偏移、`+3` 语义在 `0x8f` 侧一致）⇒ 不新增字段（无消费者会成死写）。 |
| 9 | P3 | `0x2` | missing-behavior | **如实登记为未做**：`v2 >= 0` 支的「目标帧没装脚本就逐级下退（`frames[cur][95781] == 0` 判据，raw 25683-25694），退到 <0 抛 Command_Exit」在 emulator 不存在（`op_exit` 直接 `cur = caller`）。 |
| 10 | P3 | `0x2` | missing-behavior | **如实登记为未做**：相邻返回（`v2 + 1 == cur`）时 `sub_40EA00(cur)` 释放被放弃帧（raw 25679-25680）未建模。 |
| 11 | P3 | `0x2` | unclear | **登记**：`667852` 与 `frames[v13][95779] = -1`（raw 25698-25700）在 emulator 无对应格；确义读者未定（unclear）。 |
| 12 | **P2** | `0x3` | missing-behavior | **修了**：深度越界 → `ShowMessageError('ファイルの階層が深すぎます．最大は40です．')`（异常码 65537）；装载失败 → `ExitScript`（Command_Exit 码 2）。守卫 3 条。 |
| 13 | P3 | `0x3` | missing-operand-io | **前提被推翻**：raw 26787-26788 `v5 = (ip-ip_base)>>2; frames[cur][95804] = v5;` 在 `sub_40ED40`（26793）**之前**，不是"装载成功之后"；调用点格的等价物是 `frame.curDwordOffset`（`interpreter.stepOnce` 每步写）。 |
| 14 | **P3** | `0x5` | missing-branch | **修了**（廉价）：栈顶 `-1` ⇒ 不跳（`op_ret`，raw 25714）。守卫 2 条。 |
| 15 | P3 | `0x5` | unclear | **登记**：`107437/107436` 的全局"末层栈"弹出写回 `effect_flags`（`174801`，raw 25718-25724）未建模；无 push 点 ⇒ 无消费者。 |
| 16 | P3 | `0x6` | approximation | **修了**：越界分支改用引擎同文 `ShowMessageError`（raw 26847-26853）。残余（`cur` 在 throw 前已被写成 op2）不可观测（异常终止执行）。 |
| 17 | P3 | `0x6` | approximation | **有意保留（已披露）**：`frameIdx < 0` 的拒绝分支是重写侧加严（引擎无校验 ⇒ UB），注释里写明。 |
| 18 | P3 | `0x6` | missing-operand-io | **修了**：装载后写目标帧 `caller = 发起装载的 cur`（`sub_40ED40` raw 18637 + `0x6` raw 26845）。守卫「caller = 发起装载的 cur」。 |
| 19 | P3 | `0x8` | approximation | **读体订正 + 修了（文案）**：`sub_41C900` 本体**没有**值域校验（raw 26886-26892）；它**唯一**的报错是「この階層にはファイルが読み込まれていません．Depth=%d」（码 **65541**）⇒ 改 `ShowMessageError`。`<0/≥40` 保留为披露的加严。 |
| 20 | P3 | `0x8` | missing-operand-io | **等价实现（口径差已披露）**：引擎用调用方步长槽 = 3（`ip += 4*3`）恢复调用方；emulator 直接 `ip += 1`（一条指令）——净效果相同，注释保留披露。 |
| 21 | **P2** | `0x9` | missing-behavior | **修了**：`exit-script` 的整体复位重建 **10** 个 `Queue_int` 队（raw 18080-18109）。守卫「整体复位重建 Queue_int 族」。 |
| 22 | P3 | `0x9` | missing-behavior | **部分覆盖 + 登记**：体首（raw 35206）经 handler 表（`_this + 676732` = 675996 + 4*0xB8）调 **`0xB8` 的 handler**（`sub_419720` raw 24817-24829：清 `effect_flags & 0x200` → `sub_489E50(Music,100)` → `sub_489B50`）。emulator 的 `op_exit_script` 用 `effectFlags = 0` 覆盖了位清除，**音乐那两步未复刻**（音频子系统属别票）。 |
| 23/24/25 | P3 | `0x8c`/`0x8f`/`0xa0` | approximation | **有意保留**：引擎对 label **不校验**（`ip = base + 4*op1` 可落非指令边界）；emulator 以 `labelMap`/`dwordToInstr` 为唯一边界真源并抛具名错误。语料上两者同结果（跳转目标都是真 label）。 |
| 26 | P3 | `0x133` | missing-behavior | **登记（缺宿主缝）**：引擎把 "ADDQ" 串经 `sub_408050`+`sub_4034D0` 送**引擎消息通道**（`sub_4034D0` 不抛、继续执行）；emulator 只有 `c.log`（宿主日志）。要接需要一条**非抛出**的宿主消息缝（`ShowMessageError` 是抛出的，语义不同）⇒ 登记为缺口。 |
| 27 | P3 | `0x134` | approximation | **有意保留（已披露）**：空队时引擎把未初始化栈残留写进 op3；emulator 取确定口径 0（`ATSEEK.txt:22-29` 只读 op2）。 |
| 28 | P3 | `0x134` | missing-behavior | **登记**：同 26（"GETQ" 串进引擎消息通道）。 |
| 29 | P3 | `0x9` | wrong-constant | **修了**：容器 = **10** 槽（`engine.ts` `QUEUE_INT_SLOTS`）；既有断言 11→10 属**最小 retarget**（见 §3）。 |
| 30 | **P2** | `0x9` | missing-consumer | **修了**：`op1 = 0xA` 显式识别为"越到 `Stack_int` 族第一格（byte 388292）"并拒绝执行（不再落到不存在的第 11 格）。守卫「op1 = 0xA 越到 Stack_int 族第一格」。 |
| 31 | P3 | `0x9` | missing-branch | **前提被推翻（归属错）**：`0x13E`/`0x13F` **不是** `Stack_int` 族的指令 —— `0x13E` = `sub_42FAC0`（TOTALQ，raw 39521-39546）、`0x13F` = `sub_42FB40`（check-bit，raw 39548-39568），两者都作用在 `Queue_int` 容器（`388252`）。`Stack_int` 族的真实指令是 **`0x137`**（ResetStack，`sub_4222B0` raw 30704-30730）+ **`0x138`**（Push，`sub_4223A0` raw 30733-30750），容器 = `_this + 4*i + 388292`（raw 30721/30726/30748）。 |
| 32 | P3 | `0x8c` | missing-branch | **前提被推翻（归属错）**：`sub_41C7C0`（含 `if (v4 >= 40)` 深度门、raw 26847-26853）是 **`0x6`**，不是 `0x8`（工作清单写成了 0x8）。该门 emulator 早已覆盖（`frameIdx >= 40`），本轮把文案改成引擎同文。 |
| 33 | P3 | `0x1f5` | missing-dispatch | **复核后已修**（T-0157）：`op_frame_countdown` 在清停靠标志后调 `dispatchNextRequest`（= `sub_40FB60`），见 `handlers/frame.ts`。 |
| 34 | P3 | `0x7c` | missing-writer | **如实登记为未做**：`_this[107678]`（= `redisplayScriptId`）的另两条写者是主循环的 `effect_flags & 0x20` 臂（raw 13997-14008）与 `0x4000000` 臂（raw 20870-20877）—— "玩家按键回退/重画"不从 `0x199` 进。属 `src/frame/loop.ts` 的范围（本票可写，但改动跨到主循环重画臂，未做）。 |
| 35 | **P2** | `0xc8` | missing-branch | **修了（同 5 的可复刻那一半）**：`n<10` 是硬阻塞（`Sleep(v3)` raw 30311）而非"帧节流"；`sleep 0` 不再被抬成 1ms；`effect_flags |= 1` 只在 `n>=10` 支（raw 30306）。语料 51 处 `n<10`（`sleep 1` 38 / `sleep 0` 12 / 1 处其它）现在走正确的**引擎状态**。 |

## 3. 最小 retarget（保留其余断言，只改被体推翻的那条）

| 文件 | 旧断言（错前提） | 新断言（体证） | 依据 |
|---|---|---|---|
| `test/op-132-134-queue.test.ts`（3 处 `.length` + 2 处循环上界 + 用例名） | 「队列族规模 = 11（引擎 init/teardown 都按 11 个槽遍历）」 | **10** | 引擎三处 `v15 = 10; do { … } while (v8 = v15-- == 1);` ⇒ **恰好 10 次**（先比较后自减）：`sub_40DF10` raw 18081（Queue_int）、raw 18111（Stack_int）、构造 raw 22658。第 11 格 byte 388292 属 **Stack_int 族**（raw 18110）。 |

> 只改了容器规模与循环上界：队列语义/越界/FIFO/出参断言一字未动。
>
> ★**`test/input.test.ts` 最终没有 retarget**（初版实现"`n<10` 不装门"时曾改过，改用"两支都让出派发"后
> 原断言「sleep 应置 SLEEP_GATE / 应设 sleepUntil」**成立** ⇒ 已还原，只留一条解释性注释）。
> 这一处值得记下来：**"改动会让既有断言变红"不等于"断言前提被推翻"** —— 先确认是自己改错了还是体证错了。

## 4. 读体时发现的新事实（引擎层结论 → 供台账 owner 照抄）

### 4.1 新函数条目（`analysis/functions.json`，**均不在现有 605 条里**）

| 函数 | 地址/raw | 是什么 |
|---|---|---|
| `sub_4223A0` | `0x4223A0` / raw 30733-30750 | **`0x138`（argc 2）= `Stack_int` 族的 Push**：arity 槽 = 5；`v2 = readIntOperand(1)`，`v2 > 0xA` ⇒ 组 `aPush` 串 + `sub_4034D0`（不动容器）；否则 `sub_409D40(*(_DWORD *)(_this + 4*v2 + 388292), readIntOperand(2))`。 |
| `sub_407BD0` | `0x407BD0` / raw 12623-12631 | **`Stack_int` 构造函数**：`[1]=256`、`[2]=256`、`*[0]=&Stack_int__vftable_`、`[3]=new[](0x400)`（256 int）、`[4]=-1`。★与 `Queue_int` 的 `sub_407C50`（`[1]=buf`、`[2]=rd=0`、`[3]=wr=0`、`[4]=cap=256`、`[5]=step=256`、`[6]=0`，raw 12654-12663）**字段布局不同** ⇒ `0xA` 的类型混淆是实打实的。 |
| `sub_453A60` | `0x453A60` / raw 66101-66112 | **帧节流计时器置值**：`[2]=1`、`[5]=timeGetTime()`、`[6]=a2`（`a2==0` 抬成 1）。消费者 = `sub_453AF0`（raw 66149-66186）。 |
| `sub_42FAC0` | `0x42FAC0` / raw 39521-39546 | **`0x13E`（argc 2）= TOTALQ**：读 `Queue_int` 容器 `[2](rd)`/`[3](wr)`，`rd < wr` ⇒ op2 = `wr - rd`，否则 op2 = 0；`op1 > 0xA` ⇒ `aTotalq` 错误串。 |
| `sub_42FB40` | `0x42FB40` / raw 39548-39568 | **`0x13F`（argc 3）= check-bit**：`op3 > 0x1F` ⇒ `aGetbit` 错误串；否则 `op1 = ((1 << op3) & op2) != 0`。 |
| `sub_42F990` | `0x42F990` / raw 39446-39518 | **`0x139`（argc 3）= ACQUIREQ**：读 `Queue_int` 容器 `[6]`（**第三条游标**，与 `[2]=rd` 并列）与 `[3]=wr`；`[6] < [3]` ⇒ 取值 + `[6]++` + 成功位 1，否则成功位 0；`op1 > 0xA` ⇒ `aAcquireq`。 |
| `sub_422860` | `0x422860` / raw 30982-30997 | **`0x13C`（argc 1）= REWINDQ**：`*(_DWORD *)(queue + 24) = *(_DWORD *)(queue + 8)` ⇒ `[6] = [2]`（把 ACQUIRE 游标退回 rd）；错误串 `aRewindq`。 |
| `sub_40EA00` | `0x40EA00` / raw 18398-18480 | **帧释放**：`frames[a2]` 的脚本缓冲（`[95781]`）/变量区（`[95789]`/`+3193`）/三张表（`[95791..95794]`）释放，`[95782]=0`、`[95795]=-1`（caller）、`[95796]=-1`（脚本 id）、`[95803]=[95804]=-1`（消息点/调用点）、`_this[a2 + 122372] = -1`、`_this[a2 + 122412] = -1`（两个回退游标）。 |
| `sub_407C50` | `0x407C50` / raw 12654-12663 | **`Queue_int` 构造函数**（＝"空队"）：`vftable`、`[1]=new[](0x400)`、`[4]=[5]=256`、`[2]=[3]=[6]=0`。 |

### 4.2 新字段条目（`analysis/fields.json` 候选；`fields.json` 里目前查不到这些偏移）

| 字段（字节偏移） | 语义 | raw |
|---|---|---|
| `388252 + 4*i`（i=0..9） | **`Queue_int` 族容器**（**10** 个指针；`0x132`/`0x133`/`0x134`/`0x139`/`0x13C`/`0x13D`/`0x13E` 的 `_this + 4*op1 + 388252`） | 18081、18105、22655-22674；`sub_40DF10` 逐个重建 |
| `388292 + 4*i`（i=0..9） | **`Stack_int` 族容器**（10 个指针；`0x137`/`0x138` 的 `_this + 4*op1 + 388292`）；`op1 = 0xA` 在 Queue_int 算式下会落到这一族的 `i=0` | 18110-18137、30721、30748 |
| `97073 + n`（dword 下标） | `Stack_int` 族第 n 格（= 字节 `388292 + 4n`）—— `0x137` 的 ResetStack 直接写它 ⇒ 与上一条是同一处 | 30726 |
| `51848` | **选择/列表框的当前项游标**（有真读者：`>= 0 && < _this[23008]` 时当索引算跳转表落点）；`0x7C` 复位成 -1 | 25814、18071（写）；20005、20013、20286（读） |
| `387940` | 「列表收尾」门：置位时清 0，并在队列恰剩 1 项（`497380 < 497384 && 497384-497380 == 1`）时调 `sub_40FB60`。★**全反编译无写者** ⇒ emulator 不建模（门恒假） | 25816-25822 |
| `497380` / `497384` | **脚本请求队列的头/尾指针**（`end - begin == 1` = 恰 1 项；`> 0` = 非空）—— `sub_40DF10` 复位把两者都清 0 | 18145/18147、25669-25671、25819-25821 |
| `95804`（帧内 dword 下标） | **调用点格**：`0x3`(call-script) 装载前写「当前 ip 的 dword 偏移」；`0xAE` 读它当"记录命中 0x3 表"的下标 | 26787-26788、24675/24721 |
| `97153`（帧内）+ `256*cur+97193+i` | **每帧返回栈**（深度 + 项数组，项是 dword 偏移；`0xAE` 装载时按记录还原 +3） | 25711-25716、18942-18946 |
| `107436`/`107437` | **全局"末层栈"**（基址 + 深度）：`ret` 弹出并写回 `174801`（`effect_flags`） | 25718-25724 |
| `667852` | 帧号比较用的全局游标（`0x2` 里 `if (_this[667852] > v13) _this[667852] = -1;`；整块复位也置 -1） | 17955、25698-25699 |
| `95779`（帧内） | `0x2` 在下退落定帧上置 -1 的格（与 `667852` 成对） | 25700 |
| `676732` | **handler 表项 = 675996 + 4*0xB8**（`0xB8` 的 handler 指针）；`0x9`(exit-script) 体首经它调"停 BGM" | 35206 |

### 4.3 能力条目（`analysis/engine-capabilities.json`）

- **`queue-int-family-reset-on-exit-script`**：`sub_428A60`（exit-script）尾部 raw 35270 调 `sub_40DF10`，
  后者 raw 18080-18137 把 **10 个 `Queue_int`**（`388252..388288`）与 **10 个 `Stack_int`**（`388292..388328`）
  逐个「析构旧 + `new` + ctor（空容器）」**重建**（不是置 NULL）⇒ 脚本经 `0x132`/`0x133` 建过压过值的队
  在 `exit-script` 之后**全部回到空队**。读者：`0x9` 的 handler（本票已接）。raw 18080-18137 + 35270。
- **`script-request-queue-drain-dispatch`**：请求队列（`497380`/`497384`）在三个点被放行 ——
  `0x1F5`（raw 25229，停靠结束）、`0x7C`（raw 25822，列表恰剩 1 项）、`0x2` 的 `-10` 分支（raw 25672，非空即派发）。
  emulator 只在第 1、3 点有落点（`dispatchNextRequest`）；第 2 点缺 `387940` 的写者（见 4.2）。

### 4.4 `analysis/opcode-gaps.json` 处置片段（供照抄）

```jsonc
// 0x7c —— P2 missing-branch：已修（深度校验无条件）
{ "opcode": "0x7c", "kind": "missing-branch", "status": "fixed",
  "note": "深度校验在引擎里**无条件**（raw 25798-25807；430712 的初值/整块复位值都是 -1，raw 18155）⇒ emulator 去掉 `want !== -1` 哨兵分支。守卫 app/amayui-emulator/test/t0156-control-frame.test.ts。",
  "raw": "25798-25807" }
// 0xc8 —— P2 approximation + missing-branch：**部分修 + 架构性近似登记**
{ "opcode": "0xc8", "kind": "missing-branch", "status": "partial",
  "note": "可复刻那一半已修：`effect_flags |= 1` 只在 n>=10 支（raw 30306）、`Sleep(0)` 不再被 `Math.max(1,n)` 抬成 1ms。**做不到那一半**：n<10 的 `Sleep(v3)`（raw 30311，同次派发内的进程级硬阻塞）在单线程宿主里无法表达 —— 帧循环 `maxStepsPerFrame` 默认 `Infinity`（frame/loop.ts:304）⇒ 不装帧门时 TITLE 的 `sleep 1; jmp`（src/TITLE.txt:63）同帧内永不 yield（实测挂死）。扩展点 = 给宿主一条"同步阻塞/按 ms 预算推进"的缝（`renderer/pixiBackend.ts:373` 的 `native.sleep` 现在是 no-op，属渲染宿主票）；重新评估条件 = 需要与真机帧节奏对齐的 E4 判据（`sleep 1` 的轮询≈1000 次/秒 vs 现在 1 次/帧）。语料 385 处（`sleep 1f4` 334 / `sleep 1` 38 / `sleep 0` 12 / 其它 1）。",
  "raw": "30301-30312,66161-66179" }
// 0xae —— P2 missing-branch：已修（精确口径）
{ "opcode": "0xae", "kind": "missing-branch", "status": "fixed",
  "note": "sv1=1 时**只有** sv2==20 才进这一支（raw 24663 `if (v3 != 1)` + raw 24738 `if (result == 20)`）。修法**不是**无条件施加版本门：本工程槽头 `format = 0` ⇒ sv1=0 ∉ {1,2,3}（引擎里没有这种槽，也就没有对应版本号）⇒ 无条件会让本工程槽续跑整体失效（实测 slot-save-resume.test.ts 3 条红）。三条规则：① sv1=1 ⇒ sv2 必须 20；② sv1 ∉ {1,2,3} 且记录无 instr ⇒ 不进；③ 其余 ⇒ 进。守卫 test/t0156-control-frame.test.ts（4 条）。",
  "raw": "24663,24738" }
// 0x3 —— P2 missing-behavior：已修（两异常分型）
{ "opcode": "0x3", "kind": "missing-behavior", "status": "fixed",
  "note": "cur>=39 ⇒ ShowMessageError(引擎串, 码 65537, raw 26776-26783)；装载失败 ⇒ ExitScript（Command_Exit 码 2, raw 26794-26798）。抛出点在状态更新（[95804]、cur=cur+1）之后，与 raw 26787-26792 同序。",
  "raw": "26776-26798" }
// 0x9 —— P2 missing-behavior：已修（整体复位重建队族）
{ "opcode": "0x9", "kind": "missing-behavior", "status": "fixed",
  "note": "exit-script 链到尾部的 sub_40DF10 把 10 个 Queue_int 逐个析构+重建为空队（raw 18080-18109）⇒ emulator 的 op_exit_script 重建 dispatchQueues。",
  "raw": "18080-18109" }
// 0x9（队族容器）—— P2 missing-consumer / P3 wrong-constant：已修
{ "opcode": "0x132/0x133/0x134", "kind": "wrong-constant", "status": "fixed",
  "note": "容器是 **10** 个槽（raw 18081/18111/22658 的 `v15 = 10; do{…}while(v15-- == 1)` = 10 次），不是 11；`op1 = 0xA` 落在 `Stack_int` 族第一格（byte 388292，raw 18110）⇒ emulator 显式拒绝（不再落到不存在的第 11 格）。残余：`Stack_int` 族本身（0x137/0x138）未建模，扩展点 = 建该族 + 0x137/0x138 的实现（与 stubs.ts 的 0x137 缺口同批），重新评估条件 = 语料出现 `i132/i133/i134 10` 或 `i137/i138`。",
  "raw": "18080-18137,30704-30750" }
// 0x8 —— P3 approximation（读体订正归属 + 文案）：已修
{ "opcode": "0x8", "kind": "approximation", "status": "fixed",
  "note": "`sub_41C900` 本体**没有** op1 值域/深度校验（raw 26886-26892）；唯一的 ShowMessage 是「この階層にはファイルが読み込まれていません．Depth=%d」（码 65541，raw 26891-26904）⇒ 改用 ShowMessageError 同文；`<0/≥40` 保留为重写侧的下标边界（披露的加严）。★工作清单把 `sub_41C7C0`（含 `v4 >= 40` 深度门）记成了 0x8，实为 **0x6**。",
  "raw": "26886-26904" }
// 0x6 —— P3 approximation / missing-operand-io：已修
{ "opcode": "0x6", "kind": "approximation", "status": "fixed",
  "note": "越界（op2 >= 40）改用引擎同文 ShowMessageError（raw 26847-26853，码 65537）；装载后写目标帧 `caller = 发起装载的 cur`（sub_40ED40 raw 18637 + 0x6 体 raw 26845）。",
  "raw": "26845-26855,18635-18637" }
// 0x5 —— P3 missing-branch：已修
{ "opcode": "0x5", "kind": "missing-branch", "status": "fixed",
  "note": "返回栈顶 == -1 = **空槽哨兵**（raw 25713-25714 `if (v2 != -1)`）⇒ 不跳、落到下一句；旧实现只判 undefined ⇒ 会走 `dwordToInstr[-1]`（取不到就抛）。",
  "raw": "25710-25727" }
```

## 5. 未做 / 做不到 + 该谁接

| 项 | 为什么没做 | 该谁接 |
|---|---|---|
| `0x2` 的逐级下退 + 被放弃帧释放 + `667852`/`frame[95779]`（P3 行 9/10/11） | 是**帧管理**的独立一块（要按 `frames[cur].ipBase == 0` 判"整帧无脚本"并可能 `ExitScript`）；改动面比 P2 七条大，且会与调用链上的既有断言互动 | 新票（`emulator/vm`，可写面含 `handlers/control.ts`） |
| `0x7c` 的另两条写者（主循环 `effect_flags & 0x20` / `0x4000000` 臂，P3 行 34） | 属"玩家按键回退/重画"的主循环臂（`src/frame/loop.ts`），与 `0x199` 的脚本入口是两条路 | 新票（`emulator/frame-loop`） |
| `387940` 的列表收尾派发（P3 行 4） | **引擎内无写者**（门恒假）⇒ 无法接线；先要有选择/列表框子系统 | 选择/列表框票（`emulator/menu`） |
| `51848` 的读者（P3 行 3 的一半） | 选择/列表框模型未建（`< _this[23008]` 的界） | 同上 |
| `0x9` 体首的"停 BGM"（P3 行 22 的一半） | `0xB8`（`sub_419720`）属音频子系统；`effect_flags & 0x200` 已由 `effectFlags = 0` 覆盖 | 音频票（`emulator/audio`） |
| `0x133`/`0x134` 错误串进宿主消息通道（P3 行 26/28） | 引擎的 `sub_4034D0` 是**不抛**的消息投递；本仓只有 `c.log` 与**抛出**的 `ShowMessageError`（语义不同）⇒ 需要一条非抛出的宿主消息缝 | 宿主/诊断票（`emulator/native`） |
| `0xc8` 的"n<10 不消耗真实时间"（P2 行 5 的残余） | `native.sleep` 在 `src/renderer/pixiBackend.ts:373` 是 no-op（我**不能改** `src/renderer/**`） | 渲染宿主票（`emulator/renderer`）；本票已把可观测的那一半（不装门、不抬高 0ms、不碰 effect_flags）做对 |
| `Stack_int` 族（`0x137`/`0x138`）本身 | 本票只修"Queue_int 是 10 格 + 0xA 越族"这一层 | 指令实现票（与 `stubs.ts` 的 0x137 no-op 同批） |

## 6. 红 → 绿证据（确切命令 + 数字）

```text
# ★红→绿（同一份**最终**守卫 vs 修前实现；脚本用 `git show HEAD:` 取修前版本 + 只补 sleepPath 脚手架）
cd app/amayui-emulator && node .tmp/t0156/red-green.mjs
   → RED   pass=7  / 20   （13 条红：0x7c 无条件校验、0xc8 两支、0xae 版本门、0x3×3、0x9×3、0x5 的 -1、0x6×2、0x8 未预装）
   → GREEN pass=20 / 20

# 绿（直接跑最终守卫）
cd app/amayui-emulator && node --import tsx --test test/t0156-control-frame.test.ts
   → ℹ tests 20 / ℹ pass 20 / ℹ fail 0

# 官方全量（`npm run test:all` 的等价命令）
cd app/amayui-emulator && node --import tsx test/run.ts all
   → ▶ 222 个文件 / ℹ tests 1544 / ℹ pass 1538 / ℹ fail 4
     （4 条红 = 3 条**父票给的已知基线**：engine-slot SAVE70/71 storedDwords、save-slot 真槽 format、
       scene-report「可绘制项 24 ≤ 缺纹理项 26」 + 1 条**本工作区新观察到的既有红**：input.test.ts 的
       TITLE 例 L2D 0x34e，A/B 证据：HEAD 源码与修后**逐字同一条报错**）

# T1（真资产档）逐文件跑（每个文件一个子进程 + 120s 超时）
node --import tsx .tmp/t0156/per-file.mjs T1 120000
   → 49 个文件中 4 红（同上四条），其余全 OK（含 config1-chain*、draw-item-slot-coverage、append-packs、
     slot-load-resume、slot-load-transfer…）

# 类型（4 套）
node node_modules/typescript/bin/tsc -p tsconfig.json        --noEmit   → exit 0
node node_modules/typescript/bin/tsc -p tsconfig.test.json   --noEmit   → exit 0
node node_modules/typescript/bin/tsc -p tsconfig.control.json --noEmit  → exit 0
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit → exit 0

# 死写棘轮
node --import tsx src/tools/deadWrites.ts → 基线 13 / 当前 13 / ★无新增死写（exit 0）

# 锚点棘轮（改注释后）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate → ✅ 票据自检通过（173 张 / 0 警告）
```

> ★**`npm run verify` / `npm run test:all` 此刻在本工作区跑不出结论**（与本票无关）：
> 另一个并行单元新建的 `app/amayui-emulator/test/arch-copy-slot-sth-only.test.ts` **没有分类头**
> ⇒ `test/run.ts` 的 `pick()` 在 `f.pragma!.tier` 上 TypeError 直接崩（`test/run.ts:51`）。
> 本票的等价验证 = **T0 全量**（`run-tiers.mjs T0`，173 文件 / 1209 例：**1207 绿 / 1 红 = `host-registry.test.ts`
> 的「真进程 --idle-sec 1」**，A/B 证据：同一文件在**修前 HEAD 源码**下同样红、在本票实现下**单跑绿** ⇒ 该例是
> 起真进程等横幅的**固有 flaky**，与本票无关）
> + **T1 逐文件**（`per-file.mjs`，48 文件各一个子进程 + 120s 超时）
> + 4 套 tsc + dead-writes + 锚点自检。
> ★T1 逐文件的结果：3 个**已知基线红**（`save-slot` 真槽 format、`engine-slot` SAVE70/71 storedDwords、
> `scene-report`「可绘制项 24 ≤ 缺纹理项 26」）+ 1 个**本工作区新观察到的既有红**
> （`input.test.ts` 的 TITLE 例：`ShowMessageError: L2Dモーションファイル TITLE.MTN…（opcode 0x34e）`；
> A/B 证据：修前 HEAD 源码与修后**逐字同一条报错** 13 绿/1 红 ⇒ 属 live2d 那边的进行中改动，
> **不在**父票给的已知基线清单里，建议主 agent 追一张票）。
>
> ★**实测反例（写进代码注释）**：`0xc8` 的 `n<10` 支若"不装帧门"（= 忠实复刻 `Sleep(n)` 的字面语义），
> 帧循环 `maxStepsPerFrame` 默认 `Number.POSITIVE_INFINITY`（`frame/loop.ts:304`）⇒ TITLE 的
> `sleep 1; jmp`（`src/TITLE.txt:63`）在同一帧内永不 yield，`T0+T1` 合并跑 15 分钟无进展、无终止（挂死）。
> 改成"两支都让出派发"后 T1 逐文件全绿。⇒ 这一支的"硬阻塞"在单线程宿主里只能表达成"让出一帧"。
>
> ★**并行自查的两次假红**（记下来免得下次误判）：① 我自己的 `.tmp/t0156/red-green.mjs` / `ab.mjs` 会把
> `frame.ts`/`control.ts`/`engine.ts` 临时换成 HEAD 版本 —— 若此时另一个测试进程正在跑，会看到"混合代码"
> 的红（实测：`op-132-134-queue.test.ts` 在那次 T0 里红，单独跑绿）；② 两个 scribe 在改 `analysis/*.json`
> 时，`op-22a-22f-scene-xform.test.ts` 的「unimplemented 清零」会瞬时红。**换源码的取证脚本必须串行跑**。

## 2026-09-24

见本文件：35 条逐条处置表 + 红绿证据 + 引擎层结论片段（供台账 owner 照抄）。
