# T-0173 变更记录 —— 删掉 `Engine.callFlag` / `Engine.callLink` 两个零读者字段

> 范围：`app/amayui-emulator/src/vm/engine.ts` + `src/vm/handlers/control.ts`（本票独占）
> ＋ `app/amayui-emulator/dead-writes.baseline.json`（收缩）＋ `test/op-6-05-step-slot.test.ts`（retarget + 新守卫）
> ＋ 本票目录。**未动** `analysis/*.json`（见 §4）。

## §1 读体复核（这是判"该不该删"的唯一依据；逐条带 raw）

复核对象不是"引擎里有没有这两格"，而是**两件事分开判**：
① emulator 侧那两格有没有读者（判"能不能删"）；
② 引擎侧对应的地址是不是死格（判"删了会不会丢能力 / 登记的 reason 该怎么写"）。

### 1.1 地址对齐（先钉住"emulator 的那两格 = 引擎的哪两格"）

| emulator 字段（删前） | 引擎地址 | `_this[]` 下标 | 引擎侧权威名 |
|---|---|---|---|
| `Engine.callRet`（**留**） | `0x5D884` = 383108 | `95777` | `call_ret` |
| **`Engine.callLink`（本票删）** | `0x5D888` = 383112 | `95778` | 引擎 200/201 行叫 `call_link`；**`analysis/fields.json` 已按体改名为 `dispatch_saved_cur`** |
| **`Engine.callFlag`（本票删）** | `0x5D88C` = 383116 | `95779` | 引擎 201 行叫 `call_flag`；**`fields.json` 记为 `dispatch_saved_effect_flags` / `dispatch_saved_flags`（两条同格）** |

依据：`engine/engine.hpp:199-201`（`{call_ret, call_link, call_flag}` 连续三格 + `static_assert(offsetof…)` 276-278 行）、
`analysis/fields.json:49-52`、`app/amayui-inspector/.../EngineOffsets.cs:21-23`（独立实现，同一个 0x5D88x 布局）。
★**这正是 T-0150 那条 reason 写错的地方**：它写"引擎侧调用链确实没有对应的第三格"—— 不对，见 §1.3。

### 1.2 emulator 侧：写点 4 处、读点 0 处（判据 = 删）

`grep -rn 'callFlag\|callLink' app/amayui-emulator/src`（删前，逐条）：

| # | 位置 | 性质 |
|---|---|---|
| 1 | `src/vm/engine.ts:272` `callLink = -1;` | 声明 + 初始化（**写**） |
| 2 | `src/vm/engine.ts:273` `callFlag = 0;` | 声明 + 初始化（**写**） |
| 3 | `src/vm/handlers/control.ts:557` `c.e.callLink = -1;` | `exit-script`(0x9) 复位（**写**） |
| 4 | `src/vm/handlers/control.ts:558` `c.e.callFlag = 0;` | `exit-script`(0x9) 复位（**写**） |
| — | 其余命中 | 只有注释（`engineFieldIds.ts` 提到的是 `callRet`；`fields.json`/票据不属 `src/`） |

★票面说写点在 `control.ts:508-509`，**实测是 557-558**（行号漂移）—— 已按"以实际代码为准"处理。
★`deadWrites.ts` 的读数一致：`Engine.callFlag(写2)` / `Engine.callLink(写2)`，**`reads` 为 0**（不是"扫描器认不出消费者"，
是消费者真的不存在：`grep` 全 `src/` 无 `.callFlag` / `.callLink` 取值）。

**唯一曾"碰"过它们的非写点**是 `test/op-6-05-step-slot.test.ts:35-36` 的 `vmState()` 快照（把两格抄进 deepEqual 里做
"一格都没动"的比对）—— 那是**验证面**不是消费面（T-0150 的 reason 自己也是这么写的）⇒ 我把两格从快照里去掉（见 §2.3），
快照**剩下的每一格仍逐格比对**，判据「除 ip 之外一格都不许动」一字未改。

### 1.3 引擎侧：两格**不是**死格（读点逐条）

| raw | 函数 | 代码 | 读/写 |
|---|---|---|---|
| 18978 | `sub_40FB60`（派发） | `*(_DWORD *)(_this + 383112) = *(_DWORD *)(_this + 383104);` | **写** `callLink`(383112) |
| 18982 | `sub_40FB60` | `*(_DWORD *)(_this + 383116) = v4;`（`v4 = _this[699204]`） | **写** `callFlag`(383116) |
| **25663** | `sub_41A820`（`exit`/`-10` 分支） | `v6 = 15 * *(_DWORD *)(_this + 383112);` | **读** `callLink` |
| **25664** | 同上 | `*(_DWORD *)(_this + 383104) = *(_DWORD *)(_this + 383112);` | **读** `callLink`（还原 `cur`） |
| **25666** | 同上 | `v7 = *(_DWORD *)(_this + 383116) \| *(_DWORD *)(_this + 699204) & 0x4000;` | **读** `callFlag`（还原 `effect_flags`） |

体上下文（raw 25661-25673）：`if ( v2 == -10 ) { … 还原 cur … v7 = <callFlag> | <effect_flags & 0x4000>; … }`
—— 即**派发脚本跑完后的现场还原**。写侧 `sub_40FB60`（raw 18978/18982）同时把 `383108` 置 `-10`（raw 18981）
= `callRet` 的派发哨兵。⇒ 引擎的 `callLink`/`callFlag` = **派发前保存的 `cur` 与 `effect_flags`**。

### 1.4 结论：删的是**重复表示**，不是能力

emulator **已经**用另外两个名字建模了同一条通路：

| 引擎格 | emulator 的活建模 | 写 | 读 |
|---|---|---|---|
| 383112（`dispatch_saved_cur`） | **`Engine.dispatchSavedCur`** | `control.ts:421`(存) / `:568`(exit-script 复位) | `control.ts:411-412`（`-10` 还原） |
| 383116（`dispatch_saved_effect_flags`） | **`Engine.dispatchSavedFlags`** | `control.ts:422`(存) | `control.ts:413`（`-10` 还原）、`engine-fields.ts:539-541`（`0xD9` 清 0x1000 位） |

守卫：`test/append-packs.test.ts:281/373`（现场还原后清空）、`test/engine-fields-t0161.test.ts:115`（`0xD9` 清位）、
`test/op-1f5-dequeue.test.ts:186`。

⇒ **判据④的条件不成立**（不是"其实有读者"），字段**删除**；但 §1.3 的体证必须写进 `_removed` 记档，
免得下一个人照 T-0150 那条错 reason 又以为"引擎里根本没有这两格"。

## §2 改动清单

| 文件 | 改动 | 规模 |
|---|---|---|
| `app/amayui-emulator/src/vm/engine.ts` | 删 `callLink = -1;` / `callFlag = 0;` 两行；原处留一段 `★tickets/T-0173` 注释（写明两格已删 + 引擎侧同格是活字段 + 活建模在 `dispatchSaved*` + 守卫位置）。`callRet = -1;` 保留 | −2 行 / +6 行注释 |
| `app/amayui-emulator/src/vm/handlers/control.ts` | `op_exit_script` 里删 `c.e.callLink = -1;` / `c.e.callFlag = 0;` 两行；原处留 `★tickets/T-0173` 注释（该处是**复位写点**，已经 `grep` 到实际行号 557-558，不是票面写的 508-509） | −2 行 / +3 行注释 |
| `app/amayui-emulator/dead-writes.baseline.json` | `known` 数组去掉两条；`reason` / `tickets` 两个 map 各去掉两条；`_removed` 补两条（逐条写清"为何删 + 引擎侧同格是活字段 + 活建模是谁 + 守卫"）；`_comment` 追加一句"T-0173 已从 known 移除并在 `_removed` 记档（基线只许收缩）" | 13 → 11 条 |
| `app/amayui-emulator/test/op-6-05-step-slot.test.ts` | ① `vmState()` 去掉 `callLink`/`callFlag` 两格（**其余格逐格比对不变**，注释写明不是放宽断言）；② 新增一例 `T-0173：…（同名格只留 dispatchSaved*）`：正向钉死两格已删 + **反向**钉住 `dispatchSavedCur`/`dispatchSavedFlags` 不许被顺手删 | +1 例（5 → 6 例） |
| `tickets/T-0173/ticket.json` | `tests[]` / `doneWhy` / status=done（见 §5） | — |

★文件行尾：`engine.ts` / `control.ts` 原文是 **CRLF**，行尾已实测保持（CRLF 数 = LF 数，无混行）；
`dead-writes.baseline.json` / 测试文件是 **LF**，保持 LF。全程未用 `Set-Content`/`Out-File` 写任何被跟踪文件。

## §3 死写基线前后数字（`npm run check:dead-writes`）

| | 前（本票开工时实测） | 后（实测） |
|---|---|---|
| 扫描面 | 142 个文件 / **157** 个字段 | 142 个文件 / **155** 个字段（−2 = 删掉的字段不再存在） |
| 已登记死写（基线） | **13** | **11** |
| 当前死写 | **13** | **11** |
| `Engine.callFlag` / `Engine.callLink` | `callFlag(写2)` / `callLink(写2)` | 不再出现（字段已删） |
| 判定 | `★ 无新增死写`，exit 0 | `★ 无新增死写`，exit 0 |
| 基线体检（`auditBaseline`） | 合格（13 条 reason/tickets 齐全） | 合格（11 条 reason/tickets 齐全） |

当前 11 条（逐条有 `reason` + `tickets`）：
`Engine.dispatching`(T-0157)、`Engine.texSlotFlags`(T-0154)、`SceneState.render4.{commits,entryParams,primReset,primTransform,released3D,slotParams,transitionClears}`(T-0154)、`SceneXform.{maskA,maskB}`(T-0154)。

**红→绿证据（两段）**：
1. **新守卫先红**：先只改测试（字段还在）⇒ `node --import tsx --test test/op-6-05-step-slot.test.ts`
   = **4 pass / 1 fail**，红的那条逐字是 `AssertionError: Engine.callLink 应已删除（T-0173：零读者镜像；引擎的对应格由 dispatchSaved* 建模）`。
2. 删字段 + 收缩基线后再跑 ⇒ **12/12 绿**（`no-dead-writes.test.ts` 7 + `op-6-05-step-slot.test.ts` 6 里的 5，
   含新增的 `T-0173` 那一例），`check:dead-writes` exit 0。

★中间态注意：本票**不允许**在"字段已删、基线未收缩"之间跑闸门（那会报 `基线已过期`）；两处是同一次改动，
交付态是 11/11。

## §4 台账待应用（`analysis/*.json` 归主 agent，本票未动）

1. **无需改**：`analysis/fields.json:49-52` 已经是对的 —— `0x5D888` = `dispatch_saved_cur`、`0x5D88C` =
   `dispatch_saved_effect_flags`/`dispatch_saved_flags`（两条同格，`T-0161` 已发现），
   `0x5D884` = `call_ret`。**本票的复核结论与 `fields.json` 一致**（这正是"引擎侧同格是活字段"的台账依据）。
2. **待主 agent 裁决（不是本票能改的）**：`analysis/fields.json` 的 `0x5D88C` **两条同格**（
   `dispatch_saved_effect_flags` 与 `dispatch_saved_flags`）是 `T-0161` 遗留的重复登记，建议合并或改名 —— 本票只申报，不改。
3. **无需改**：`analysis/functions.json` 里 `sub_40FB60` / `sub_41A820` 的条目与 §1.3 的读点一致（本票没有新函数）。

## §5 别人该接（越界观察；本票不扩大范围）

1. **`docs-new/03-engine/flow-control.md:334`** 的代码示例注释里还列着 `cur/callRet/callLink/callFlag` ——
   它是"说明 `op_exit_script` 清了什么"的**叙述**，现在与代码不一致。本票不动 `docs-new/`（不在 range），
   交主 agent 顺手改（改前先 `tickets.js --anchors-in docs-new/03-engine/flow-control.md`）。
   同段 `:377` 的字段清单也只列 `call_ret`（本来就对）。
2. **`app/amayui-emulator/docs/01-background.md:80`** 同样把 `call_link`(0x5D888) / `call_flag`(0x5D88C) 称作
   "控制流目标深度寄存器" —— 按 §1.3 应写作"派发前保存的 `cur`/`effect_flags`"。同样不在本票 range。
3. **`app/amayui-inspector/**` 是独立实现**（`EngineReader.cs:30-31` 读真进程的 0x5D888/0x5D88C、
   `EngineOffsets.cs:22-23`、`Program.cs:90`、`EnginePanelVm.cs:46-47`）—— 与 emulator 的字段**无关**，
   且它读到的是引擎真值（`callLink` 那份是活的）⇒ **不要**跟着删。
4. **`src/vm/engine.ts` 里同族的零读者字段**（本票只登记不删）：
   `Engine.dispatching`（基线挂着，`T-0157` 承接）、`Engine.texSlotFlags`（`T-0154`）、
   `Engine.dispatchSavedFlags` 的**双表示**（`engineValues[95779]` 与字段各一份，`T-0161` 已记账：
   "若要把 `engineValues[95779]` 撤掉，本常量成为唯一存储，`Engine.dispatchSavedFlags` 撤掉"）
   —— 后者是 `T-0161` 已经披露的**有意双表示**，本票复核时确认它**有读者**（`engine-fields.ts:539-541`），不是死写。
5. **5 条 `tickets.js --validate` 的行号漂移警告**（本票跑 `--validate` 时可见，**不在本票范围**）：
   `T-0027`(engine.ts:819/760)、`T-0033`(engine.ts:816)、`T-0100`(engine.ts:816)、`T-0133`(engine.ts:731)
   四条证据的 `line` 已过期（串仍在文件里，只是行号漂了）。原因是**本轮 `engine.ts` 由 4 个单元并行修改**
   （本票也在其中），此刻刷新只会被下一次编辑再打漂 ⇒ 建议**本轮全部交回后**由主 agent 跑一次
   `.tmp/settle/fix-lines.mjs --any` 统一刷新（本票的 `T-0173` 锚点已自行 retarget，未留漂移）。

## §6 一个工具链坑（值得记，可能坑到别人）

`esbuild`（tsx 的转译器）**不接受** JSDoc 里**相邻**的"加粗数字段"写法：`raw **18978**/**18982**`
会被报成 `Transform failed … ERROR: Unexpected "**"`（行列号还指向下一行，极易误判成代码错）。
实测最小复现（`esbuild.transformSync(loader:'ts')`）：

| 输入（注释体内） | 结果 |
|---|---|
| `raw **18978**` | OK |
| `raw **18978**/**18982**` | **FAIL `Unexpected "**"`** |
| `**活字段**，…（raw **18978** 与 **18982**）` | OK |

⇒ 本票把注释改成 `raw **18978** 与 **18982**`（加分隔符）后即通过。写 JSDoc 时 **`**x**/**y**` 这种相邻写法要避开**。
