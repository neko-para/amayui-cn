# T-0148 §5.2 `quote-gone` 半边的裁决（第 70 轮 goal round 3，2026-09-25）

> §5.2 那张机械复核表共 36 条：`still-present` 23（§5.3 + §5.4 已裁完）+ **`quote-gone` 13（本轮）**。
> `quote-gone` 的语义 = 「审计 finding 自带的 `emulator.file` + `emulator.quote` 在当前工作树里**已经找不到了**」
> —— 但这**只说明代码改了，不说明缺口修了**，所以要逐条重新裁决。
>
> **结论分布**：**① 真缺口 ×1**（#12）· **② 结构性不适用 ×4**（#1 #2 #4 #5）· **③ 早已补上没回台 ×8**（#3 #6 #7 #8 #9 #10 #11 #13）。
> ★其中**两条推翻了审计原文本身**（#9 的「队列恰剩 1 项」是审计记错、#10 的「每帧推进完全没有」与代码不符）。

## 本轮提交的代码/文档改动

### ★ ① #12 —— 右键「取消/跳读」路由：**通路早已在位，读错了格**（一行修复）

**审计只说「通路没实现」，实测比它更具体也更严重**：

- 通路**已在位**：`engine.ts` 的 `serviceAdvanceWait` ③ 段（`mask & 0x20` ⇒ `consumeEdges()` + `#cancelRoute()` + **返回 false**，因为 raw 20368/20374 都不落 `LABEL_44`）+ `#cancelRoute()` 本身（清**整个** `effect_flags`、`redisplayMode = saved | 0x6000000`、`redisplayScriptId = frame.scriptId`、`ip = labelMap.get(jump)`、不压返回点）。
- **缺陷 = 取值来源**：修前读 `this.input.mouseJump`（= `0xCC` 写的 `_this[107664]`，其读者是 `0xCD`，raw 25851），而体 **raw 20367** 读的是 `_this + 4*v6 + 489488`（`v6 = _this[383104]` = 本帧 `cur`）⇒ 绝对下标 **`122372 + cur` = `ENGINE_FIELD.rewindMainBase`**，写者是 **`0x7B`**（`sub_41F530` raw 28729 的 op1）。
- **后果（可复算）**：语料 **`i0cc` 0 处**、**`i07b` 1097 处 / 334 文件**（`$1$SC03xx`/`SC08xx` 一族的 ADV 现场）⇒ **修前 emulator 的右键取消在任何真脚本上都永不触发**（`mouseJump` 恒 -1 ⇒ `#cancelRoute` 直接 `return false`），而真机在同一现场会「取消/跳读」。
- **改动**：`src/vm/engine.ts` 的 `#cancelRoute()` 一行 —— `engineValues.get(ENGINE_FIELD.rewindMainBase + this.cur) ?? -1`；其余一字未动。
- **守卫**：`test/adv-right-click-cancel-route.test.ts` 改成用真实生产者 `0x7B` 造现场（`setRewindCursor`），并**新增负例**「只注 `i0cc` ⇒ 什么都不变」（= 本次口径差的分水岭）。
- **红→绿实测**：把取值改回 `input.mouseJump` ⇒ **1/4（3 红）**；恢复 ⇒ **4/4**。
- **台账**：能力条目 `adv-advance-route-table` 的 note 已追加订正段；`tickets/T-0169` §4「别人该接」#1 即此条（已落地）。

### 顺带产出：把体检脚本从 `.tmp/` 提升为常驻工具

`quote-gone` 的复核方式暴露了一个**结构性盲区**：**台账正文里的 `文件:行` 引用没有任何棘轮保护**
（三个校验器只查字段类型 / 枚举 / 守卫，从不看正文里的行号）⇒ 代码一重构就静默指到别的东西。

⇒ 提升为 **`.agents/skills/amayui-engine-analysis/scripts/check-ledger-refs.js`**（只读）：
扫 `opcode-gaps.json` 的 `note`/`missing[].what`（`--caps` 再加 `engine-capabilities.json`）里的 emulator `文件:NNN`，
按「区间 + 最近标识符」报**候选漂移**；`--check`（有候选 ⇒ exit 1）/ `--min-dist N`（滤掉"声明行落在函数体内"那类假阳）/
`--strict` / `--json`。守卫 = `test/agent-workflow.test.ts` 的「只读性 + `--check` 退出码 + `--min-dist` 过滤 + 修好后转 0」。
已写进两个技能的工具体表（`amayui-engine-analysis` / `amayui-script-analysis`）。

**它第一次跑就抓到两处真问题**（其余约 15 处是已知假阳，工具头写明了两类成因）：

| 发现 | 处置 |
|---|---|
| `0x142` 的 `missing` 把「字段注释已写实」指到 `engineFieldIds.ts:366-372`，而那三行是 `timerSecondsPrev/timerSeconds/timerMsDiv1000` | 订正为 **`153-165`**（`scriptEngineFlag` 的注释块，声明在第 166 行） |
| ★同一个注释块里写着「**emulator 未建模** ⇒ 在 `i142 1` 之前读到的会是 0」 | **代码早已两侧落地**（`vm/engine.ts` 的构造初值表 `[ENGINE_FIELD.scriptEngineFlag, 1]`、`handlers/control.ts` 的 `exit-script` 复位）⇒ **源码注释改写**为现行事实，旧话按沿革保留成一句"已作废" |

★**这条值得进 `lessons.md`**：`tickets` 的 `evidence[].line` 有 `fix-evidence-lines.js` + 守卫，
`scripts.json` 的 `layout[].lines` 有锚点棘轮，而**机制文档与台账正文里的 `文件:NNN` 什么都没有** —— 这个工具补的就是这一格。

## 13 条的逐条裁决

| # | kind | file | 判 | 依据与落点 |
|---|---|---|---|---|
| 1 | `approximation` | `config-read.ts`（`0x2eb`） | **②** | 三层口径里的第 ②③ 层（键值块 `sub_494220` / 注册表 `sub_490010`）处理对象是注册表数据块与 HKLM 键值 ⇒ 宿主里不存在；内建值取 `1.07.0019` 是**披露过的取舍**；P2「空串」那条已修（`:230`）。台账侧 `0x2eb` 无 opcode 条目（`implemented` 缺席合规） |
| 2 | `missing-consumer` | `audio.ts`（`0x1ba`） | **②** | 外层门**已落地**（`applyDependentMovie` 的归一 + `effect_flags & 0x2000` + `set:DependMovieSound` 匹配 + `{kind:'movie-dependent-audio'}` 意图）；未建模的是 1000 格 DShow 影片对象表的 `+1120/+1144` —— 宿主槽节点只有 `{kind,id,mode}` 三字段。已在 `opcode-gaps` 的 `0x1ba`/`0xbb`/`0xbc` 各 1 条 `missing`（承接 `T-0179`）；`op1=4`（影片类）语料 0 处 |
| 3 | `host-invented` | `msgwin.ts`（`0x205`） | **③ 可关** | `plan.setInt(2, nx)` 已删（x 前进量是引擎体内的栈局部），且**有专门守卫** `test/op-205-no-writeback.test.ts`；`tickets/T-0147` 是承接票。审计给的硬停红例（`AIM.txt:423`）已消 |
| 4 | `missing-behavior` | `stubs.ts`（`0x308`） | **②** | 门那一半**可求值**（`system:LimitTouch` 在册：`configRegistry.ts:68`），但副作用对象要 **HWND + 窗口级触摸注册面**，而 `native.ts`/`nativeTap.ts` 全库 `touch` **0 命中** ⇒ 补空缝只会造出假消费者。`opcode-gaps` 的 `0x308` note **本轮已改写**成完整三态判词 + 四条重开条件（修前那句「扩展点 = 加宿主缝」会诱发假接线） |
| 5 | `missing-operand-io` | `stubs.ts`（`0x308`） | **②** | `_this[1954]` **3 写（raw 12605/12610/12615）0 读**（全反编译穷举）⇒ 是「最后一次调用参数的墓碑」，属**有据豁免**而非待补缺口；建了就是 `check:dead-writes` 会亮的死写。同族：`0x2FA` 的 `Engine[1951]`、`0x30A` 的 `_this[1969..1976]`。**本轮已写进 `0x308` 的 note** |
| 6 | `stale-ledger` | `stubs.ts` | **③ 可关** | 「根本没注册 / 故意不上桩」字面串**已从文件消失**，删除说明留在 `:295-298`（不会被当成"当年忘了删"）；注册由 `test/op-327-32e-setweather-noop.test.ts` 钉住。§5.1 第 1 项已判「已改」 |
| 7 | `stale-ledger` | `stubs.ts`（`46668`） | **③ 可关** | 矛盾的两半都已消失：能力条目 `scene-3d-weather-effects-rain-snow-leaf` 现为精确表述（模型侧已就位 / opcode→模型未接线）；`Scene+46668` 已建模为 `SceneState.effect3DLevel`（`state.ts:440` / `scSetEffect3DLevel` / 守卫 `test/scene-3d-effect-level.test.ts`）。**本轮又把"推进已接线、审计原文错"写进该条目 note** |
| 8 | `stale-ledger` | `control.ts` | **③ 可关** | 三条指控全被推翻：`0x143` 在 `OPS` 真实现、`dispatchNextRequest` 在 `control.ts`、守卫与 E3 齐。能力条目 `script-queue-dispatch` = **`modeled-verified`/E3**（guard `test/op-1f5-dequeue.test.ts`）⇒ 审计建议的"升 partial"已被超越 |
| 9 | `missing-behavior` | `frame.ts`（`0x1f5`） | **③ 可关**（★审计原文不成立） | 三层门 + `dispatchNextRequest` **全在**（`frame.ts:104-112`），守卫 `test/op-1f5-dequeue.test.ts` **6 例**；`opcode-gaps` 的 `0x1f5` = `implemented`（无 `missing`）。★审计把 `0x7C`（raw 25819-25821）的「队列恰剩 1 项」错记到 `0x1F5` 头上，且 `suggestedGuard` 的极性写反。**本轮顺手修掉** `frame.ts:503` 的行内陈旧注释（它正是 §5.2 `still-present` 第 77 行引的那句） |
| 10 | `missing-behavior` | `stubs.ts`（`sub_453540`） | **③ 可关**（★审计原文事实错误） | 「每帧推进完全没有」**与代码不符**：`scWeatherAdvance`（`renderer/scene/ops.ts:1175-1182`）是 `sub_453540` 的逐字实现（墙钟量化 / 上限 100 / **三路各一次**），由 `renderer/scene/commit.ts:90-92` 每帧调、经两宿主 `advanceModel`（`headlessScene.ts:945-946` / `pixiBackend.ts:1546-1547`），守卫 `test/scene-3d-weather.test.ts:78/98/145`。真实成因是三路槽恒空 ⇒ **推进空转** = #7 的同一条。**本轮已写进能力条目 note** |
| 11 | `approximation` | `msgwin.ts`（`sub_48F000`） | **③ 可关** | 伪造式（`readTextSkipOf(e) !== 0 ? 1 : 0`）已换成 `pageHasPendingText`（返回值来自**本页显示态**，配置只当门）；未复制的分段表单点披露在 `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED`；`ReadTextSkip=0`（随包默认）下不可测。**本轮措辞收紧**（去掉容易被读成"伪造"的那句） |
| 12 | `missing-behavior` | `engine.ts` | **① 已实现** | 见上节（一行修复 + 守卫 + 红→绿 1/4→4/4） |
| 13 | `stale-ledger` | `agerc.ts`（`0x14b`） | **③ 可关** | 重载语义（先清句柄/导出再 Load）已按体落地（`agerc.ts:95-103`，引 raw 31068-31076）；能力条目 `lazy-movie-dll` 与 `agerc-module-interface-and-version-lock` 均 **`modeled-verified`/E2**（guard `test/op-a4-a6.test.ts`）。★建议 id 由 `lazy-movie-dll` 改为 `agerc-lazy-module-load`（现名正是审计 P1 的诱因，名字骗人） |

## 本轮之后 §5.2 还剩什么

- **`quote-gone` 13 条：全部裁完**（#12 已实现并带守卫；其余 12 条可关，其中 9 条纯关、3 条只差台账判词编辑 —— 本轮已落 3 条 note + 1 条缺口 note）。
- **`still-present` 23 条**：§5.3 / §5.4 已裁完，但**其中有 4 行与 §5.1 的「已改」同源（重复项）**，建议 owner 直接把 §5.2 的「复核」列标 `closed(dup)`：`src/renderer/scene/ops.ts`（`46528` bit2）、`src/vm/handlers/msgwin.ts`（排版锚点）、`test/mesh-vertex-quad.test.ts`、`test/op-327-32e-setweather-noop.test.ts`。
- ★**下一批建议**：`src/vm/input.ts` 的 `pressLatch`（`0x108` `host-invented`）—— 它是**被伪造的输入保持位**，与 #12 的右键/推进边沿时序强耦合（修 #12 时最好同批裁决，否则时序断言可能被它掩盖）。

## 2026-09-25

已落库：13 条全部裁完。
