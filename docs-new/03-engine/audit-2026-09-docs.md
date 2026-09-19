# docs（docs-new/03-engine 十七份文档）审计报告 —— 2026-09

**审计范围**：`source=docs`。输入为 `.tmp/audit2/doc-1..doc-5.json`（原始 findings，共 102 条）与对抗性复核 `.tmp/audit3/doc-1..doc-5-verify.json`（逐条 verdict）。覆盖文件：adv-text-rendering、sound-system、message-config-gates、field-97058-timer-dialog、input-system、flow-control、rendering、copyright-effect、scene-start-flow、engine-reset-mainloop、save-data、stub-reaudit-2026-09、vm-opcodes、instruction-directions、runtime-memory、operands、opcode-table。

**方法一句话**：每条 finding 按其自带的 raw 行号打开 `engine/天结_unpacked.exe_utf8.c` 亲自读体，emulator 结论一律回 `app/amayui-emulator/src`／`test` 与 `src/*.txt` 语料核实，再由对抗性复核独立重判 verdict；本报告只落复核后的结论，宁可漏报不可误报。

**合并口径**：verdict=refuted 丢弃（见「已排除的误报」）；verdict=partial 采用 correctedKind / correctedSeverity；verdict=unclear 单列「待查」；confirmed 保留。同一根因的多条合并成一条（合并清单见文末「方法与覆盖」）。

## 结论速览

### 统计表（kind × severity，保留条目 67 条）

| kind \ severity | P0 | P1 | P2 | P3 | 小计 |
|---|---|---|---|---|---|
| contradiction | 2 | 7 | 10 | 13 | 32 |
| overreach | 0 | 0 | 3 | 12 | 15 |
| cross-source-mismatch | 0 | 0 | 2 | 7 | 9 |
| no-evidence | 0 | 0 | 1 | 5 | 6 |
| gap-as-noop | 0 | 0 | 3 | 0 | 3 |
| host-invented | 0 | 0 | 1 | 0 | 1 |
| name-inference | 0 | 0 | 0 | 1 | 1 |
| **合计** | **2** | **7** | **20** | **38** | **67** |

另：待查 2 条（P3）、已排除误报 13 条（其中 5 条是同根因去重条目）。

### 最严重条目摘要（P0/P1）

1. `flow-control.md:181`（P0）——§4 说 emulator 停在 `ScriptReset` / `[未建模]`，实际 `op_exit_script` 已重载根脚本 0 并 `jump(0)` 继续，且全 `src` 无该符号；同文档 §9.2/§9.3/§10.3/§8 早已写「不再停在 reset」。
2. `scene-start-flow.md:100`（P0）——把 `0x238` 与 `0x1B1` 同列「死写」，实际 `0x238` 装载 0x400 等待门计时器（369352/369356），读者 `sub_407E20` raw 12761-12786 与主循环 raw 21109。
3. `scene-start-flow.md:102`（P1）——称 `0xD9` 清的 0x1000 位「全工程无读者」，实际主循环 raw 20841 `if ( (v24 & 0x1000) != 0 )` 就是读者。
4. `scene-start-flow.md:96 / :105 / :170`（P1）——`ENGINE_INTERNAL_OPS` 只剩 9 条（16 条全转真实现）、测试里没有「16 条不写操作数」棘轮（只有 A5 的 7 条）、E2 行的三个数字全错。
5. `flow-control.md:422 / :427`（P1）——`i143` 已完整实现（`op_dispatch_script_requests` + `dispatchNextRequest`）、`exit` 的 `-11` 分支已实现，§8/§9.1/§11.7 三张表未同步。
6. `rendering.md:112`（P1）——解除帧保留的判据是 `state0` 高字节 alpha（`#meshVisible`），文档写成 `calcDiffuse` 输出，而该实现对同文件已被注释标记为废弃。

## P0 逐条

### `docs-new/03-engine/flow-control.md:181` — emulator 不停在 ScriptReset（文档陈旧且与同文档他节冲突）

**声明**：§4 语义/状态写「emulator 停在 `ScriptReset`（由上层 `run` 捕获停止）」并标 `[未建模]`。

**实际**：emulator 的 `op_exit_script` 已重载根脚本 INDEX0、清引擎字段后 `cur=0` 并 `jump(0)` 继续跑，从不抛 `ScriptReset`；整个 `app/amayui-emulator/src` 里没有 `ScriptReset` 这个符号。同文档 §9.2/§9.3（:327/:333）、§10.3（:366）、§8 表（:276）都写「已修正 / 不再停在 reset」。

**证据**：`app/amayui-emulator/src/vm/handlers/control.ts:401-406` —— `const boot = await c.e.fileSource.readScript(0); … loadScriptIntoFrame(c.e.frames[0]!, script, boot.name, 0); c.e.cur = 0; c.jump(0);`；`grep -r ScriptReset app/amayui-emulator/src` 0 命中（唯一命中在 `app/amayui-emulator/docs/03-development-plan.md:60`，历史规划）；raw 侧无对应断言（本条为文档↔代码不一致）。

**建议处置**：删掉 §4 该句，或改为「emulator 已按引擎重载根脚本 0 并继续」；把 §4 的 `[未建模]` 改为 `[已实现]`。

### `docs-new/03-engine/scene-start-flow.md:100` — `0x238` 不是死写，它装载 0x400 等待门计时器

**声明**：§3.2 表「**死写**（写的字段全工程无读者）」把 `0x1B1`（`Engine[21672]`）与 `0x238`（`Engine[92338]/[92339]`）并列，理由「grep 全工程只写不读」。

**实际**：`0x1B1` 确是死写（写点 raw 29161、raw 18077，字段 86688 无读者）；但 `0x238` 写的是 0x400 等待门的起点/时长（92338/92339 = 字节 369352/369356），读者是 `sub_407E20`（raw 12761-12786，用 `_this[11631]`=369356 与 `_this[11625]` 判到期）与主循环 raw 21109 `if ( (v35 & 0x400) == 0 ) break;`。`SN0000.txt:1020` 的 `i238 157c`（5500ms）就是门时长。同文档 §4.3（:161-163）写的是对的。

**证据**：raw 12761/12768/12771/12775/12776/12783；raw 21109/21111；raw 23095 `*(_DWORD *)(_this + 678268) = sub_4248C0;`（678268 = 675996 + 4*0x238）；raw 32309-32310 `_this[92338] = 0; _this[92339] = result;`；raw 29161 `_this[21672] = result;` 与 `grep 21672|86688` 仅 2 处写、0 读；`src/SN0000.txt:1020-1021`；emulator 侧落点 `app/amayui-emulator/src/vm/handlers/gfx-state.ts:37`。

**建议处置**：把 `0x238` 从「死写」拆出，改注「装载 0x400 等待门计时器（起点/时长），读者 `sub_407E20` raw 12761-12786 + 主循环 raw 21109」。

## P1 逐条

### `docs-new/03-engine/scene-start-flow.md:102` — `0xD9` 清写的 0x1000 位有读者

**声明**：§3.2 表「**标志位清写，无人读** | `0xD9`（清 `effect_flags` bit 0x1000）| 全工程无 `& 0x1000` 的读者」。

**实际**：主派发循环有真实读者 —— raw 20841 `if ( (v24 & 0x1000) != 0 )`（`v24 = *(_DWORD *)(_this + 699204)`），随后 raw 20843 判 `& 0x800`、raw 20849 调 `sub_453B60((_DWORD *)(_this + 430096))`、raw 20852 置 `| 0x800`。置位端 raw 30368 `_this[174801] |= 0x1000u;`，清除端 raw 24945 `_this[174801] &= ~0x1000u;`。

**证据**：raw 20838-20852；raw 30368；raw 24945；文档锚点 `docs-new/03-engine/scene-start-flow.md:102`；emulator 落点 `app/amayui-emulator/src/vm/handlers/engine-fields.ts:252`。

**建议处置**：改成「有读者的门位清写（0x1000 = 等 `Scene+430096` 3D 效果就位，配对位 0x800）」，删掉「无人读」。

### `docs-new/03-engine/scene-start-flow.md:96` — §3.2 的 16 条早已转真实现，不在 ENGINE_INTERNAL_OPS

**声明**：§3.2 称该节 16 条「已连同依据登记进 `ENGINE_INTERNAL_OPS`（`handlers/stubs.ts`）」。

**实际**：`ENGINE_INTERNAL_OPS` 现只剩 `0x2fa/0x137/0x244/0x326/0x325/0x324/0x10c/0x30a/0xaf` 九条；§3.2 的 16 条（`0x1B1/0x238/0x93/0x94/0x97/0x224/0x229/0x256/0x258/0x242/0x32A/0x32D/0xD9/0x20E/0x1BC/0x1AD`）一条都不在其中，全部已转真实现（panel.ts / engine-fields.ts / audio.ts / gfx-state.ts）。

**证据**：`app/amayui-emulator/src/vm/handlers/stubs.ts:46-213`（条目 `:59/:72/:84/:107/:108/:149/:173/:174/:196`）、`:153-155`（A4 13 条）、`:161-165`（A5 已转真实现）、`:169-171`。

**建议处置**：改成「2026-09 当时按依据跳过、现已全部转真实现」，或直接引用 stubs.ts 现状。

### `docs-new/03-engine/scene-start-flow.md:105` — 该「16 条不写操作数」棘轮在测试里不存在

**声明**：§3.2 称 `test/game-start-chain.test.ts` 有一条棘轮：把这 16 条各跑一遍、断言两个全局量一个字都没变。

**实际**：不存在该用例。现存 `:84-105` 是方向相反的「25 条**全部已转真实现（OPS）**」棘轮（断言 `OPS.has(op)` 且 `!ENGINE_INTERNAL_OPS.has(op)`）；`:107-120` 只对 `A5_IMPLEMENTED` 的 **7** 条（`0x93/0x94/0x97/0xd9/0x1ad/0x1b1/0x1bc`）断言不回写操作数。

**证据**：`app/amayui-emulator/test/game-start-chain.test.ts:76`（A4_IMPLEMENTED 9 条）、`:78`（A5_IMPLEMENTED 7 条）、`:99-104`、`:107-120`。

**建议处置**：改成「25 条注册表棘轮 + A5 的 7 条不写操作数棘轮」。

### `docs-new/03-engine/scene-start-flow.md:170` — §6 表 E2 行的三个数字全错

**声明**：§6 表 E2 行写「`test/game-start-chain.test.ts`：25 条登录棘轮 + 16 条"不写操作数"棘轮 + 9 条语义用例」。

**实际**：「25 条」断言的是 25 条全部已转真实现（`OPS`），不是「登录」棘轮；「16 条不写操作数」不存在（只有 A5 的 7 条）；「9 条语义用例」实为 **7** 个 test 覆盖 9 条 opcode（`:125/:168/:178/:192/:206/:217/:227`）。

**证据**：`app/amayui-emulator/test/game-start-chain.test.ts:84`（用例名）、`:99-104`、`:107-120`、`:125/168/178/192/206/217/227`。

**建议处置**：按实际改写 E2 行。

### `docs-new/03-engine/flow-control.md:422` — `i143` 已完整实现，§8/§9.1 表未同步

**声明**：§11.5 与 §8 表把 `i143`（0x143）记成 `op_engine_internal`（no-op）/**完全未实现**（排队+派发 + `_this[124350]` 重入）；§9.1 表同。同文档 §7（:258）、§9.3（:339）、§11.7 却写「emulator 已实现，2026-09」。

**实际**：emulator 的 `0x143` 是完整实现：`op_dispatch_script_requests` 按包号升序入队（`pack << 24`），`dispatchNextRequest` 把请求装进帧 37、`caller = DISPATCH_SENTINEL`（−10），exit 走 −10 分支继续派发，并清 `dispatching`（对应 `_this[124350]`）。

**证据**：`app/amayui-emulator/src/vm/handlers/control.ts:256-269`（`e.dispatching = true; for (const n of [...packs].sort(...)) e.scriptRequests.push(n << 24); … await dispatchNextRequest(c);`）、`:210-244`、注册 `:418`；`handlers/index.ts:50`；`handlers/stubs.ts:197-198`；文档 `flow-control.md:258/:279/:297` 对 `:339`。

**建议处置**：§8 表与 §9.1 表的 `i143` 行改为「`op_dispatch_script_requests`（已实现，守卫 `test/append-packs.test.ts`）」。

### `docs-new/03-engine/flow-control.md:427` — `exit` 的 `-11`（存档续档）分支已实现

**声明**：§11.7 写「`exit` 的 `-10` 只实现「派发哨兵」分支（`-11` 存档续档仍未建模）」；§8 表亦写 `op_exit`「**未区分 -10/-11**」。

**实际**：emulator 的 `op_exit` 有显式 −11 分支：`caller === -11 && c.e.saveResume?.pendingRecord0` 时装载存档记录 0 的脚本、`callRet = -1`、`jump(0)` 续跑，注释直接引引擎 raw 25649-25658。

**证据**：`app/amayui-emulator/src/vm/handlers/control.ts:122-141`；引擎侧 raw 25649-25658；文档 `flow-control.md:273`、`:427`。

**建议处置**：§8/§11.7 的 −11 标注改为「已实现（读档续跑，`saveResume.pendingRecord0`；见 `tickets/T-0072`）」；仅「−11 之外的负值 = 程序退出」保持不变。

### `docs-new/03-engine/rendering.md:112` — 解除帧保留的判据是 `state0` 高字节 alpha，不是 `calcDiffuse`

**声明**：§4.2 写「★2026-09 两处收紧…① **建项 ≠ 可见** —— 解除判据改成「`calcDiffuse` 出的颜色 alpha > 0」（`#releaseFrameHoldIfVisible`）」。

**实际**：判据是 `state0` 的高字节 alpha（`#meshVisible`）；`calcDiffuse(m, this.clockMs)` 恰恰是同文件注释明确记为**已废弃**的旧实现（会给共享模型的动画窗锁存错误起点）。同段其余三点（`0x1F6` 续期、`HOLD_MAX_FRAMES = 60`、旧上限 8）与文档一致。

**证据**：`app/amayui-emulator/src/renderer/pixiBackend.ts:727-729` —— `#meshVisible(m: MeshObj): boolean { return ((m.state0 >>> 24) & 0xff) > 0; }`；`:706-710`（旧实现注释）；调用点 `:356`（createMesh）、`:607`（setVertexColor）；`:823`；`:103`。

**建议处置**：把判据改写为「`state0` 高字节 alpha > 0（`#meshVisible`）」，并说明 `calcDiffuse` 版已弃用及原因。

## P2/P3 汇总表

| id | kind | severity | 一句话 | 证据锚点 |
|---|---|---|---|---|
| adv-text-rendering.md:450 | contradiction | P2 | §5.2 把 0x8B 当「第三个颜色位」，实为行间距（Font+1380） | raw 29020-29029（`_this[21669] = result;`）；21669×4=86676=85296+1380；同文档 :358/:398 已订正 |
| sound-system.md#§1 | contradiction | P2 | 通道表写「10/11 未分配」，11 实为 BGM 通道 | raw 108751-108752（`sub_4B6020(设备, 0xBu, PCM+1036)`）；同文件 :166-167 自相矛盾 |
| sound-system.md#§9 | gap-as-noop | P2 | §10 说「0x1D2 仍 no-op」，实际已实现且 pushVoiceRecord 已接 | raw 22874（0x1D2→677860）、:29374-29386；text-items.ts:120-126；audio.ts:300-304/:312-314 |
| message-config-gates.md#§1 | no-evidence | P2 | 0x6E else 分支的门是 MessageSpeed(21668)，不是 MesWinAlpha | raw 28361、:28370-28382、:23736-23738、:4381；MesWinAlpha 引用全在 31015/39355/110920/111472/112204 |
| scene-start-flow.md:103 | contradiction | P2 | 0x1AD「唯一读者在存档序列化」不成立，另有 raw 25698 读者 | raw 24805-24813、:17035/17059、:25695-25699；grep 166963\|667852 共 6 处（P1→P2） |
| scene-start-flow.md:60 | contradiction | P2 | GAMESTART 三按钮 count 写 3，实为 17（local 0 = 17） | src/GAMESTART.txt:69/:115；src/TITLE.txt:18（3 是 TITLE 的值） |
| scene-start-flow.md:161 | host-invented | P2 | 引用不存在的 `#serviceAnimGate` / `scAnimationsDone()` | grep 全仓 4 处均注释（pixiBackend.ts:746 等）；真源 engine.ts:497/:560 |
| rendering.md:10 | contradiction | P2 | draw-texture 的 op3–op6 是源裁剪，op7/op8 才是目标位置 | raw 31287-31299（SetRect）；raw 131824-131838（记录 [2..5] vs [9]/[10]/[11]） |
| rendering.md:22 | overreach | P2 | 0x20–0x2D「全部调 sub_441410」不成立，行号 49942 也失效 | raw 27236-27246（vtable+80 六实参）、:27260-27264/:27282、:50903（函数头） |
| rendering.md:80 | contradiction | P2 | sub_407E20「恒返回 11629 / 11631 从不设正」被双重证伪 | raw 12761-12786、:32303-32310、:23095、:131978；与 copyright-effect.md:141 冲突 |
| rendering.md:97 | contradiction | P2 | 逐帧动画求值属 sub_49AA30，不在 sub_49A300 | grep 46500 首命中 raw 117438；raw 117430-117482 对 :116878/:116899-116921 |
| rendering.md:14 | cross-source-mismatch | P2 | `this + 0x534C` 是 DWORD 下标，字节偏移应为 0x14D30(85296) | raw 31453/31466；.lst:55671-55672（`lea ecx,[esi+14D30h]`）；msgwin.ts:2 同错 |
| rendering.md:23 | contradiction | P2 | 「渐变来自 LOGO.MPG 视频」与同文档 :28/:82-84 互斥 | raw 132826-132845、:133458-133541、:122248/:122289；src/LOGO.txt:40/:44 |
| rendering.md:32 | gap-as-noop | P2 | 0x323「静态网格遮罩、无逐帧计时」与引擎相反 | raw 132836（`*v6 \|= 2u;`）、:132839/132841；0x20B 映射 raw 23050 正确 |
| rendering.md:74 | overreach | P2 | 「三路归并」只命名两路，第三张表 _this+1096 未列 | raw 135545-135546/135581/135596/135610；平手判序 raw 135586-135589 |
| rendering.md:77 | overreach | P2 | create-mesh 不写 [13]/[14]；它们由 0x322/0x323 写 | raw 132753-132794（:132788 只读 [13]）、:132820、:132843 |
| engine-reset-mainloop.md:122 | cross-source-mismatch | P2 | engine_bool_flag(166965) 已建模，Part D 建议项过期 | engineFieldIds.ts:89-90；engine-fields.ts:120/:152-155/:305/:313；raw 17982 |
| save-data.md:258 | contradiction | P2 | 0x1A1 失败路径会写 op1=1；「一个字节都不写」只对成功路径成立 | raw 38424-38425（`return sub_42B4B0(_this, 1, 1);`）、:38431；save-slot.ts:318-320、572-581 |
| input-system.md:282 | gap-as-noop | P2 | 「0xA1/A2/A3、0x20C/B5/23D/32B 仍是安全桩」——7 条全已实现 | menu.ts:43-47；frame.ts:347；audio.ts:431；gfx-misc.ts:73-74；index.ts:60/62/63/79（P3→P2） |
| scene-start-flow.md:103+rendering.md:80+:31+ce:141 | contradiction | P2 | 0x238/0x400 计时器三处表述互斥（同根因合并） | raw 23095、:32303-32310、:21109/21111/21134/21151、:12672-12684；copyright-effect.md:141 |
| adv-text-rendering.md:365 | contradiction | P3 | 0x204「GDI 一次性整串」与同文档 §9:622-623 互斥 | raw 68469-68495（出口仅 sub_471180 / sub_46F2D0）；grep TextOutA 11 处均在消息窗 |
| adv-text-rendering.md:488 | overreach | P3 | §7「这些早已是真实现」把 0x83/0x1C5/0x2C2 也包进去，那三条文档是对的 | emulator 全域 grep 零命中；interpreter.ts:61-67、165-166（NotImplementedOp）；引擎 raw 38017-38028 等 |
| adv-text-rendering.md:211 | contradiction | P3 | 「禁则表全文件不存在」被否定，但表恒空故观感结论成立 | raw 72112-72169（sub_45BCD0）、:83001/:83609 调用点、:78748-78750/:73767-73769 唯二写点（P2→P3） |
| adv-text-rendering.md:189 | overreach | P3 | 换行体在 `Font+1404 == 1`（set:AutoLineFeed）门内，§6 漏该键 | raw 83607/83609、:23660-23662、:111548-111549；configRegistry.ts:81（P2→P3） |
| adv-text-rendering.md:51 | no-evidence | P3 | 字段表四处证据行号差 1–5 行 | raw 90446/90447/90463-90464（对 90444/90445/90469）；raw 78861（对 78866） |
| adv-text-rendering.md:183 | overreach | P3 | 「grep 235108 的 16 个读点」实为 15 读 + 1 写 | raw 78773 是写（Font 构造）；读点 71587…82152 共 15 处 |
| sound-system.md#§7 | overreach | P3 | 「通道 11 缺口未登记」——§5:166/:179 已登记，emulator 也非无通道概念 | sound-system.md:316-318 对 :166-167/:179；audioEngine.ts:31/:35/:213-222 |
| message-config-gates.md#题头 | cross-source-mismatch | P3 | 「随包副本 SYS4REG.INI」在仓库不存在 | glob **/SYS4REG.INI = 0；.gitignore:47；configBoot.ts:37-53（P1→P3） |
| input-system.md:269 | contradiction | P3 | joy-callback 用「按钮序号/共 32 个」描述掩码位，措辞误导 | raw 30405-30419、:25042（读端）、:91519-91524（32 项恒等虚拟位表）；input.ts:119-124 |
| flow-control.md:155 | overreach | P3 | `_this+676732` 不是未知钩子，是 0x72 handler 指针 | raw 22922（= sub_419720）、:24817-24829、:35206 |
| flow-control.md:17 | name-inference | P3 | 「enc_zero」是自造名；local_int 预置的是字段 byte 388240 | grep enc_zero 零命中；raw 18777、:18782-18797（另三池真 memset） |
| flow-control.md:34 | contradiction | P3 | `_this[96983]`（下标）与 `_this[387932]`（字节）在同一体系混排 | raw 35207/:22589（字节写）、:25176-25177（下标写）；文档 :24/:34/:347 |
| flow-control.md:150 | no-evidence | P3 | exit-script 区间端点各偏 1–2 行 | raw 35170（注释）/35171（签名）/35319（`}`）/35320（附注） |
| rendering.md:159 | overreach | P3 | blend 选择子 0/≥4 缺「链外门控」前提说明 | raw 123117-123121（SetRenderState(19,2)/(20,1)）；present 侧 raw 136790（P2→P3） |
| scene-start-flow.md:144 | overreach | P3 | 引用 `set-vertex-color-alpha … -1 -1` 与源码不逐字 | src/SN0000.txt:3272（两个通道是槽引用）；raw 33877-33881 |
| scene-start-flow.md:29 | cross-source-mismatch | P3 | 文档 :1225 对，测试 :265/:5 自称 1224 | src/SN0000.txt:1224-1225；game-start-chain.test.ts:5/:265/:274/:277 |
| rendering.md:104 | overreach | P3 | 「版权页 frame 效果已实现」无可回归判据、~5s 无常量 | pixiBackend.ts:688-729；test/ 搜 frame-hold 等 0 命中；tickets/T-0024/notes.md:133 |
| rendering.md:117 | overreach | P3 | 「无界面光栅验证」实为 headless 坐标断言 + 人工看图 | config1-chain.test.ts:30-34；title-exit.test.ts:98-100；headlessScene.ts:553/:240 |
| rendering.md:148 | overreach | P3 | 「presenter 只用 itemRenderPlacement」只对 useWorld 项成立 | eval.ts:61-82；presenter.ts:177-192（2D 路径直接写 pos） |
| engine-reset-mainloop.md:94 | contradiction | P3 | Queue_int/Stack_int 尺寸写错 | raw 18086（`operator new(0x1Cu)`）、:18116（`operator new(0x14u)`） |
| engine-reset-mainloop.md:114 | overreach | P3 | 「忠实原始顺序」伪代码漏 6 处复位（含 430708） | raw 18150-18155；raw 13660-13661（430708 的用途） |
| engine-reset-mainloop.md:355 | contradiction | P3 | 675996 标成 0xA50CC（应为 0xA509C） | raw 21217；raw 23030（678008 = 675996+4*503） |
| engine-reset-mainloop.md:304 | contradiction | P3 | 「emulator 只用到 3 位」与同表 :312/:402 及代码冲突 | stageLoop.ts:60（`STAGE_GATE = 0x40`）；stage.ts:72；frame/loop.ts:262 |
| copyright-effect.md:29+80+133 | contradiction | P3 | 三处行号系统性偏低（+175 / +2020 / +1762–2039） | raw 20620/20640-20642/20746/20758；raw 131876-131881/131964-131979；函数头 133458/122248/116878/… |
| stub-reaudit-2026-09.md:219 | cross-source-mismatch | P3 | 表头称「当前运行时行为」，实为过期生成物（OPS 254/NATIVE 51/INTERNAL 9/STUB 1） | index.ts:44-68、:71-81；stubs.ts:46-213、:216-219；.tmp/stubStatusTable.err:2-3 |
| stub-reaudit-2026-09.md:311 | contradiction | P3 | §4 仍把 Live2D 11 条记成桩，§1.2 与代码都已转真实现 | live2d.ts:183-198、:252-256；index.ts:61/:78；.tmp/stubStatusTable.md:86-103 |
| stub-reaudit-2026-09.md:15 | overreach | P3 | 「574 = 引擎实际存在的 opcode」不成立（544 有 handler） | raw 22722（memset32 0x400）+ 544 处赋值；opcode-table.md:575-610（30 行回退小节） |
| vm-opcodes.md:5 | cross-source-mismatch | P3 | 同一 opcode-table.md 两个条目数（544 vs 574） | 机械统计 rows 574 / main 544 / fallback 30；vm-opcodes.md:3-5 对 stub-reaudit:15 |
| save-data.md:630 | cross-source-mismatch | P3 | 键名 `set:AutoFreeTexture` 应为 `set:AutoFreeTex`；两处行号也错 | raw 4343（字面量）、:111730-111731、:111744-111745；save-slot.ts:230-235 |
| save-data.md:60 | no-evidence | P3 | 0x1AA 行号指向 0x2C8 的尾部；语义（哨兵 5、空串、同表）正确 | raw 22912（偏移 677700）、:42052-42062、:35675-35679（5191+281=5472） |
| save-data.md:564 | no-evidence | P3 | `v99[60]` 唯一命中在 raw 19413，不是 19313 | grep v99\[60\] = raw 19413；raw 19313 是 `int v43; // edi` |
| save-data.md:193 | contradiction | P3 | §6「format 1..3 只读头」与 §7.2/SLOT_GAPS① 及代码冲突 | save-data.md:284、:332-360；saveSlot.ts:288-299；save-slot.ts:338-346；engineSlot.ts:459-465 |
| stub-reaudit-2026-09.md:126 | no-evidence | P3 | sub_430170 标注 (43038) 落在别的函数 | raw 39809-39810（函数块）、:39855、:43038（LoadLibraryA） |
| stub-reaudit-2026-09.md:109 | contradiction | P3 | 三块 16-dword 参数块只有 Snow 全读，Leaf/Rain 只读 [294..309] | raw 65642-65644（Snow）、:65591（Rain）、:65731（Leaf）、:65459-65465（更新端） |
| instruction-directions.md:73 | contradiction | P3 | 0x324 归「消息/文本」错，实为 3D 天气/粒子管理器销毁 | raw 23220、:25402-25407、:65366-65394；.lst:135088-135092（thunk） |
| instruction-directions.md:102 | cross-source-mismatch | P3 | 0xC0 归「消息/系统配置」错，实为 BGM 当前曲读取端 | raw 38618-38623、:29856-29857、:106353-106360、:19911；engine-fields.ts:65/:332 |
| instruction-directions.md:143 | contradiction | P3 | §8 的「渲染 10 / 声音 26」与 §2/§1 表（22 / 27）不符 | 机械统计 {1:27,2:22,3:33,4:9,5:5,6:6,7:1}；文档 :7/:38/:143/:145 |
| operands.md:27 | cross-source-mismatch | P3 | 例子里的槽号 1397 应为 3f37（SN0000.txt:1093） | src/SN0000.txt:1093/1096/1099；全语料 `sub (global-int 1397)` 0 命中 |

## 待查（证据不足）

- **`docs-new/03-engine/rendering.md:143`**（unclear，P3）——「而没有任何脚本把它复位（全语料无 `mov (global-int 707ffa) 0`）」。括号内字面断言成立：grep `707ffa` 全语料 93 处、确无 `mov (global-int 707ffa) 0`。但「没有任何脚本把它复位」这一较强结论存疑：`src/REIGN.txt:1022` `sub (global-int 707ffa) (local-int 1de7) (global-int a2052)`、`src/FELLOW.txt:3644` `add (global-int 707ffa) (local-int 536) 60`、`src/STALL.txt:898`、`src/FIELD.txt:14203`、`src/REACH.txt:2428` 都用 add/sub 改写（`src/CONFIG1.txt:1045` 是 `mov … 348`）。是否算「复位」取决于作者定义，故不判真伪。
- **`docs-new/03-engine/rendering.md:12`**（unclear，P3）——「分层队列：`graphics+258` 的绘制队列；`_this[11627]=1` 置脏标记」与同文档 §3.1:74 的「`_this+258` = +1032」写法不一致。脏标记正确（raw 131350/131838 等多处）；但「graphics+258」是否按字节读，文档内没有可指认的实例，`+258` 字节在引擎里对应什么亦无证据，故只记措辞不统一。

## 已排除的误报

- `docs-new/03-engine/sound-system.md#§10（headless/设备重建缺口）` —— 缺口已被显式登记（`app/amayui-emulator/src/vm/saveSlot.ts:337` 的 SLOT_GAPS① 逐字「10 个 SE 通道重装仍不复现」、`app/amayui-emulator/docs/13-audio-plan.md:34`），文档那句是否定式且与 raw 137687-137718 一致。
- `docs-new/03-engine/field-97058-timer-dialog.md#§3b（冲刷点措辞）` —— 被驳的「三条件同构」引文在三份文档与 `analysis/engine-capabilities.json:2719` 里都不存在；`sound-system.md:125` 的「两处同构」指的是音乐 `sub_489F80`/`sub_489C20`。
- `docs-new/03-engine/input-system.md:243` —— 0x107 = `sub_421E50`（SetKey）由三份真源（`opcode-table.md:215`、`scripts/asm/opcodes.json` opcode 263、`instruction-directions.md`）与函数体 `_this[551+op1]` 自证；finding 的地址反解与项目公式 `opcode=(offset−0x0A509C)/4` 冲突。
- `docs-new/03-engine/input-system.md:245` —— 0x10B = `sub_422070`、0x10C = `sub_4220B0`（SetKeyMulti）、0x10D = `sub_42EF50`（read-mouse-wheel）由真源与函数体证实，finding 的对应关系整体错位。
- `docs-new/03-engine/input-system.md:243（cross-source-mismatch 条）` —— 重复条目；前提被证伪，emulator 的 `op_set_key`/`op_set_key2` 正是真源语义，唯一残留（无按键表消费者）已由 `engine-fields.ts:124` 注释自述。
- `docs-new/03-engine/input-system.md:116` —— finding 自己写明「不判错、无需改语义」；`sub_477220` 头 raw 91625、`0x108 = sub_42EDC0` 均由真源坐实，只剩变量命名建议。
- `docs-new/03-engine/input-system.md#14.3` —— 文档已列 `op2/op5/op6/op7/op8` 与扫描起点，emulator 也正用 op3/op4 作 x/y（`input.ts:236-238`）；「漏了 op3/op4」是把「未逐字列全部编号」当成「缺操作数」。
- `docs-new/03-engine/runtime-memory.md:16` —— 该行是「opcode → 它调用的函数」清单（同句 0x70→`sub_45D660`、0x71→`sub_45EC60`/`sub_48F000`），dispatch 里 0x1A5 = `sub_433290`、0x2FE = `sub_4332D0`；文档从未把被调函数称作 handler。
- `docs-new/03-engine/rendering.md:143（原 id）` —— verdict=unclear，改列「待查」，不计入误报。
- `docs-new/03-engine/rendering.md:12（原 id）` —— verdict=unclear，改列「待查」，不计入误报。
- `docs-new/03-engine/copyright-effect.md:67` —— 与 `rendering.md:97` 同根因（逐帧求值属 `sub_49AA30`），已去重合并。
- `docs-new/03-engine/copyright-effect.md:29` —— 与 `rendering.md:65` 同根因（主循环行号低 175 行），已去重合并进「copyright-effect.md:29+80+133」。
- `docs-new/03-engine/copyright-effect.md:141` —— 与 `rendering.md:31`、`rendering.md:80` 同根因（0x238/0x400 计时器），已去重合并。

## 方法与覆盖

**怎么核的**：① 对每条 finding，用 read 按其自带的 raw 行号打开 `engine/天结_unpacked.exe_utf8.c` 的函数体逐字比对，必要时 grep 函数头（`^//----- (00XXXXXX)`）、字段读写点全集与键名字面量；② emulator 类断言一律亲自 open / grep `app/amayui-emulator/src` 与 `test/`，并按 `handlers/index.ts:44-68`、`:71-81` 的成员表拼装 `OPS`/`NATIVE_OPS`/`ENGINE_INTERNAL_OPS` 去重后计数（注意 `stubs.ts` 的 `]);` 收尾会骗过朴素行匹配）；③ 语料断言自己在 `src/*.txt`（941 个文件）上计数；④ 复核由 `.tmp/audit3` 独立重判 verdict，本报告只落复核后的结论。全程只读，未跑构建/测试。

**覆盖量与复核通过率**：

| 项 | 数量 |
|---|---|
| 原始 findings（doc-1..5） | 102 |
| confirmed | 90 |
| partial（采用 correctedKind/correctedSeverity 后保留） | 10 |
| unclear（改列待查） | 2 |
| refuted（丢弃，含 5 条去重条目） | 13 |
| 同根因去重（合并后减少的条目） | 8 |
| **保留条目** | **67** |
| 复核通过率（confirmed + partial） / 原始 | 100 / 102 = 98.0% |
| 误报率（refuted 里的实质条目 8 条） / 原始 | 8 / 102 = 7.8% |

**去重说明**（同根因合并，保留下来的条目里含具体证据）：`copyright-effect.md:67` → 并入 `rendering.md:97`；`copyright-effect.md:29` → 并入「copyright-effect.md:29+80+133（行号系统性偏低）」；`copyright-effect.md:141` → 并入「scene-start-flow.md:103+rendering.md:80+rendering.md:31+rendering.md:141（0x238/0x400 计时器）」；`scene-start-flow.md:103`、`rendering.md:80`、`rendering.md:31` 三条 0x238/0x400 相关条目合成一条（其余 4 条为 `copyright-effect.md:67`/`:29`/`:141` 与前三条的重叠计数）。

**严重度改判记录**（partial 条目）：`adv-text-rendering.md:211` P2→P3（禁则表恒空，观感结论成立）；`adv-text-rendering.md:189` P2→P3（缺省下文档描述成立，缺的是门与一行键）；`adv-text-rendering.md:488` P2→P3 且 kind→overreach（0x83/0x1C5/0x2C2 文档那三格是对的）；`scene-start-flow.md:103` P1→P2（读者存在但不影响 emulator 行为，属「唯一」二字失实）；`rendering.md:159` P2→P3 且 kind→overreach（门控在选择子 if 链之外，属精度问题）；`message-config-gates.md#题头` P1→P3（归属错成立，但数字多数可由 `configRegistry.ts` 复核）；`input-system.md:282` P3→P2 且 kind→gap-as-noop（把 7 条已实现记成安全桩）；`input-system.md:269` P1→P3（恒等虚拟位表下写端不可区分，属措辞）；`flow-control.md:155` P1→P3 且 kind→overreach（只影响文档记账）；`rendering.md:12` P3 且 kind→unclear。

**审计边界**：`opcode-table.md` 574 行的逐行语义（本次只核 handler 与存在性）、`save-data.md` §5 的真存档实测数字、`engine-capabilities.json` / `scripts.json` 台账、以及文档里「方向/簇」描述中未抽查的部分均未覆盖。另需提请上游注意：`.tmp/audit3/doc-3-verify.json` 的 notes 记录了一处**未列入本清单**的方法论风险 —— 反编译文件里 handler 槽的字节偏移与 `675996 + 4*op` 公式在 0xFB/0x104–0x10F 一带出现 1–2 位漂移（`676992` 在构造函数里没有任何赋值），任何「按构造期地址反解 opcode」的分析都可能得出互斥结论，建议按 `opcode-table.md:5` 的口径单独开一条记账 finding。
