# 03-engine · opcode→handler 全表（引擎位置 / 语义 / 分析状态）

> 本文档列出**全部指令**在引擎中的位置、已知语义与分析状态。数据来自对引擎 dispatch 表（`this+0x0A509C`）的实读 + age-shared 助记符对照。
>
> - **opcode**：dispatch 表数组下标；`opcode = (offset − 0x0A509C) / 4`，上限 `0x400`（越界落默认 `sub_418E30`）。
> - **引擎位置**：该 opcode 在本引擎 dispatch 表中的 handler（`engine/天结_unpacked.exe_utf8.c` 的 `sub_XXXXXX`）。
> - **名称（age-shared）**：引擎家族另一构建的助记符/函数地址，`u00xxxxxx` 不含语义，跨构建交叉引用、与本引擎地址**不对齐**。
> - **分析状态**：`已核对`（读了 handler 体确证，附 raw .c 行号）/ `推测`（仅凭名称推断、handler 未读体、**可能失真**）/ `未解`（无表征）/ `仅映射`（仅知 opcode→handler，语义未读）。
> - **操作数编号**：语义列用 **op1 / op2 / op3…（1-based）= 该指令的第 1 / 第 2 / 第 3… 个参数**（等价 args[0]/args[1]/args[2]…），**不含 opcode**，个数与 `argc` 一致。
> ⚠️ AGE 助记符不可靠（`exit`≠程序退出，是跨脚本返回；`ret`≠跨脚本返回，是同脚本子程序返回）。凡`推测`/未读体一律不可当定论。
>
> **效果相关指令已语义化命名**（版权页/淡入淡出等）：`create-mesh`(0x320)、`set-vertex-color`(0x322)、`set-vertex-color-alpha`(0x323)、`set-draw-color`(0x202)、`set-draw-color-alpha`(0x203)、`draw-texture`(0x1FB)、`set-texture`(0x1F9)、`create-texture`(0x1F8)、`release-texture`(0x1FA)、`play-movie`(0x20F)、`wait`(0x21C)、`float-mov`(0x2D5)、`poll-input`(0x101)、`detach-texture`(0x1F7)。旧的 `u00xxxxxx` 保留为**别名**（汇编器同时接受），源脚本已批量替换为主标签。这些的完整机制见 `./copyright-effect.md`。
>
> **算术/字符串/内存指令接口（2025-09 确证）**：本表所列纯数值/字符串/内存指令均已**逐一读体、确认接口**，结论写入数据层 `analysis/functions.json`（`ANALYZED`/`PARTIAL` + `purpose`/`sub_behaviors`/`fields_used`/`evidence`）与 `analysis/fields.json`（操作数池基址 `pool_int/float/string/…`、`local_*`）。类别：运算 `0x50-0x5F`、位 `0x135-0x13F`、浮点 `0x2D5-0x2E4`、字符串 `0x192/193/1C8/2C5/1A6/1A3`、数组/索引/lea `0x61/63/64/6C/12C/1B0/2D8`。
>
> **状态判定走引擎分析技能规则**：`已核对` = 读 handler 体确证（附 raw .c 行号）；`推测`/`仅映射` = 未读体，不一定可靠。函数含未建模数值偏移或调用未分析函数的记 **`PARTIAL`**，否则 **`ANALYZED`**（如 `random`/0x60 的共用格式化助手 `sub_408050`→`StringFormat`（安全有界 sprintf）确证后转 ANALYZED）。
>
> **信息源**：本工程的分析结论**唯一数据层** = `analysis/` 下的三层（① `functions.json` + `fields.json` 函数/偏移「是什么」；② `engine-capabilities.json` 引擎**常态能力**；③ `scripts.json` **脚本台账**），原始只读基准 = `engine/天结_unpacked.exe_utf8.c`。`opcode-table.md` 只列**映射 / 语义**，分析结论以数据层为准。
>
> **参考**：`analysis/functions.json`、`analysis/fields.json`（+ `engine-capabilities.json` / `scripts.json`）；报表工具 `.agents/skills/amayui-engine-analysis/scripts/report.js`（读数据层打印进度/字段清单）、`sort-fields.js`（字段排序）、`capabilities.js`（第二层）、`scripts.js`（第三层）；跨脚本的脚本层结论见 `docs-new/05-scripts/`。
> **功能方向粗分类**（指令→声音/渲染/消息UI/输入/字符串/数据等簇）见 [`./instruction-directions.md`](./instruction-directions.md)。

## 全部 544 个已映射 opcode

| opcode | argc | 名称（age-shared） | 引擎位置（handler） | 分析状态 | 已知语义 |
|---|---|---|---|---|---|
| 0x1 | 0 | abort | sub_418E60 | 已核对 | **程序中止**：`_CxxThrowException(&1, Command_Exit)` —— 立即退出整个程序。handler=sub_418E60（raw .c 25682）。emulator：`op_abort` → 抛 `ExitScript`（程序退出信号）；渲染窗捕获后经 IPC `close-window` 关闭主窗口，headless(run.ts) 捕获后停执行 |
| 0x2 | 0 | exit | sub_41A820 | 已核对 | 跨脚本**返回调用层**（`cur=frame.caller`；顶层 caller<0 才程序退出）。handler=sub_41A820（raw .c 25629） |
| 0x3 | 1 | call-script | sub_41C6A0 | 已核对 | 读 operand1=目标脚本索引 → 压帧（cur++）+ 装载新脚本帧。handler=sub_41C6A0（raw .c 26762） |
| 0x4 | 2 |  | sub_41C770 | 仅映射 |  |
| 0x5 | 0 | ret | sub_41A9B0 | 已核对 | **同脚本**子程序返回（弹每帧返回栈 `256*cur+97193`；栈空 no-op）。handler=sub_41A9B0（raw .c 25704） |
| 0x6 | 2 | load-frame | sub_41C7C0 | 已核对 | **load-frame**（曾名 `i006`，即 load-script-into-frame）：`op1=目标脚本索引, op2=帧编号`。备份/恢复 `cur`（`_this[383104]`↔`_this[383108]`），把脚本 `op1` 解析并装入帧 `op2`（`loadScriptFrame_40ED40`）；`op2≥40` 抛 ShowMessage「ファイルの階層が深すぎます．最大は%dです．」、装载失败抛 Exit。SYSTEM4 帧布局初始化（预装）用。handler=sub_41C7C0（raw .c 26549） |
| 0x7 | 1 |  | sub_41C8D0 | 仅映射 |  |
| 0x8 | 1 | call-frame | sub_41C900 | 已核对 | **调用/切换到预加载帧**：`op1=帧号`。save `cur→call_ret`；`cur=op1`（readIntOperand）；要求该帧已预装（`*(frame+383124)!=0`）否则抛「この階層にはファイルが読み込まれていません」(ShowMessage)；设目标帧 `caller=call_ret`、`ip=帧起始`、状态槽=0；返回新 cur。被调帧跑完 `exit(0x2)` 依其 caller 返回调用帧。SYSTEM4 `load-frame`(0x6) 预装的帧（DRAWTOOLTIP/DRAWORN/ATSEEK/SETROUTE/MVSEEK↔帧26/28/29/30/31）由游戏脚本 `call-frame <帧号>`(0x8, 曾名 `i008`) 启动。handler=sub_41C900（raw .c 26876）。**曾仅映射** |
| 0x9 | 0 | exit-script | sub_428A60 | 已核对 | **全量 teardown**：清 40 帧 + 重置全局数组 → 回根态。handler=sub_428A60（raw .c 35171） |
| 0xA | 2 |  | sub_429460 | 仅映射 |  |
| 0xB | 11 |  | sub_41C9E0 | 仅映射 |  |
| 0xC | 0 |  | sub_418E80 | 仅映射 |  |
| 0xD | 4 |  | sub_41CAF0 | 仅映射 |  |
| 0xE | 12 |  | sub_41CB50 | 仅映射 |  |
| 0xF | 1 |  | sub_41CC50 | 仅映射 |  |
| 0x10 | 4 |  | sub_418EB0 | 仅映射 |  |
| 0x11 | 9 |  | sub_41CC90 | 仅映射 |  |
| 0x12 | 1 |  | sub_41CD60 | 仅映射 |  |
| 0x13 | 4 |  | sub_42C570 | 仅映射 |  |
| 0x14 | 0 |  | sub_418ED0 | 仅映射 |  |
| 0x15 | 5 |  | sub_41CDA0 | 仅映射 |  |
| 0x16 | 2 |  | sub_41CE40 | 仅映射 |  |
| 0x17 | 2 |  | sub_41CE80 | 仅映射 |  |
| 0x1E | 8 |  | sub_41CED0 | 仅映射 |  |
| 0x1F | 12 |  | sub_41CFB0 | 仅映射 |  |
| 0x20 | 6 |  | sub_41D0E0 | 仅映射 |  |
| 0x21 | 2 |  | sub_41D180 | 仅映射 |  |
| 0x22 | 2 |  | sub_41D290 | 仅映射 |  |
| 0x23 | 2 |  | sub_41D390 | 仅映射 |  |
| 0x24 | 2 |  | sub_41D490 | 仅映射 |  |
| 0x25 | 3 |  | sub_41D590 | 仅映射 |  |
| 0x26 | 4 |  | sub_41D6A0 | 仅映射 |  |
| 0x27 | 4 |  | sub_41D780 | 仅映射 |  |
| 0x28 | 4 |  | sub_41D860 | 仅映射 |  |
| 0x2A | 4 |  | sub_41D940 | 仅映射 |  |
| 0x2B | 5 |  | sub_41DA20 | 仅映射 |  |
| 0x2C | 5 |  | sub_41DB00 | 仅映射 |  |
| 0x2D | 12 |  | sub_41DBA0 | 仅映射 |  |
| 0x2E | 5 |  | sub_41DFA0 | 仅映射 |  |
| 0x2F | 4 |  | sub_41E0A0 | 仅映射 |  |
| 0x30 | 5 |  | sub_41E180 | 仅映射 |  |
| 0x31 | 4 |  | sub_41E260 | 仅映射 |  |
| 0x32 | 10 |  | sub_41E2D0 | 仅映射 |  |
| 0x33 | 6 |  | sub_41E420 | 仅映射 |  |
| 0x34 | 12 |  | sub_41E540 | 仅映射 |  |
| 0x35 | 11 |  | sub_41E670 | 仅映射 |  |
| 0x36 | 3 |  | sub_41E7E0 | 仅映射 |  |
| 0x37 | 11 |  | sub_41E8C0 | 仅映射 |  |
| 0x38 | 12 |  | sub_41EA30 | 仅映射 |  |
| 0x50 | 3 | add | sub_42C5E0 | 已核对 | `op1 = op2 + op3`（read op2/op3 → write op1） |
| 0x51 | 3 | sub | sub_42C620 | 已核对 | `op1 = op2 - op3` |
| 0x52 | 3 | mul | sub_42C660 | 已核对 | `op1 = op2 * op3` |
| 0x53 | 3 | div | sub_42C6A0 | 已核对 | `op1 = op2 / op3` |
| 0x54 | 3 | mod | sub_42C6E0 | 已核对 | `op1 = op2 % op3` |
| 0x55 | 2 | mov | sub_42C720 | 已核对 | `op1 = op2` |
| 0x56 | 3 | and | sub_42C750 | 已核对 | `op1 = op2 & op3` |
| 0x57 | 3 | or | sub_42C790 | 已核对 | `op1 = op2 \| op3` |
| 0x58 | 3 | sar | sub_42C7D0 | 已核对 | `op1 = op2 >> op3` |
| 0x59 | 3 | shl | sub_42C820 | 已核对 | `op1 = op2 << op3` |
| 0x5A | 3 | eq | sub_42C870 | 已核对 | `op1 = (op2 == op3)` |
| 0x5B | 3 | ne | sub_42C8C0 | 已核对 | `op1 = (op2 != op3)` |
| 0x5C | 3 | lt | sub_42C910 | 已核对 | `op1 = (op2 < op3)` |
| 0x5D | 3 | lte | sub_42C960 | 已核对 | `op1 = (op2 <= op3)` |
| 0x5E | 3 | gr | sub_42C9B0 | 已核对 | `op1 = (op2 > op3)` |
| 0x5F | 3 | gre | sub_42CA00 | 已核对 | `op1 = (op2 >= op3)` |
| 0x60 | 2 | random | sub_42CA50 | 已核对 | `op1 = rand() % op2`；handler=sub_42CA50（raw .c 37715）。**已标注 ANALYZED**：读体后用 `StringFormat`（原 sub_408050，安全有界 sprintf）在 op2==0 时格式化 `aRandom0` 到 message_buf 并经 `_CxxThrowException` 抛 Command_ShowMessage；否则写 `op1=rand()%op2` |
| 0x61 | 3 | lookup-array | sub_42CB00 | 已核对 | `op1 = &op2[op3]`（取数组元素**地址**写入 op1 指针槽：sub_42AEA0 取 op2 基址 → sub_418CC0 写 `基址+4*op3`；与 lea 同底座）。handler=sub_42CB00（raw .c 37742）。⚠️ 修正旧「取值」——实际存的是元素**地址**（AGE 指针操作数后续读取时自动解引用即成值） |
| 0x62 | 3 |  | sub_42CB50 | 仅映射 |  |
| 0x63 | 2 | lea | sub_42CBA0 | 已核对 | `op1 = &op2`（取 op2 的**内存地址**写入 op1 指针槽：`sub_42AEA0(this,2)` 取址 → `sub_418B90(this,1,addr)` 写指针/地址型操作数）。handler=sub_42CBA0（raw .c 37766） |
| 0x64 | 2 | copy-local-array | sub_42CBE0 | 已核对 | 把 op2 索引的字面数组（count=池`[4*op2]`；源=池`+4*op2+4`；每项经 `key ^ ROR` 解码后写入）拷入 op1 指向的数组 —— **数组/地板填充的底座**（MPINIT 地板用）。handler=sub_42CBE0（raw .c 37776） |
| 0x65 | 2 |  | sub_418F10 | 仅映射 |  |
| 0x66 | 3 |  | sub_42CC90 | 仅映射 |  |
| 0x67 | 3 |  | sub_42CCE0 | 仅映射 |  |
| 0x68 | 3 |  | sub_42CD30 | 仅映射 |  |
| 0x69 | 3 |  | sub_42CD80 | 仅映射 |  |
| 0x6A | 3 |  | sub_42CDD0 | 仅映射 |  |
| 0x6B | 3 |  | sub_42CE20 | 仅映射 |  |
| 0x6C | 2 | fill-zero | sub_42CE70 | 已核对 | `op1 起的 count 个槽置 0`（**非 mov 值拷贝**）：`v2=&op1; n=op2(count); while(n--) *v2++ = _this[97060]`；`_this[97060]`=**ENC(0)**（`ROL(x,11)==key` 反篡改校验在 3 处独立成立唯一确定）。handler=sub_42CE70（raw .c 37876）。⚠️ 修正旧「局部→全局循环拷贝」——实为 bulk 零初始化 |
| 0x6D | 0 |  | sub_41AA50 | 仅映射 |  |
| 0x6E | 2 | show-text | sub_41EB20 | 已核对 | **show-text**：读 op1=槽、op2=字符串。① `Engine[122497]` bit0 置位 ⇒ 走注音/内嵌模式 `sub_46BE30(文本对象 Engine+85296, op1, 串op2, 0, Engine[97055])`，并置 `Engine[122497] |= 0x10000`、`Engine[122371] = op1`；② 否则按 `message:ReadTextSkip` 门决定是否置 `effect_flags |= 0x8000000`（ADV），文本经 `sub_46CBF0`（同步排空）或 `sub_46BE30`（逐段）写进文本对象。**PARTIAL**（`sub_46BE30`/`sub_46CBF0` 未建模）；handler=sub_41EB20（raw .c 28307） |
| 0x6F | 1 | end-text-line | sub_41ECE0 | 已核对 | **end-text-line**：读 op1=槽 → `sub_46AF90(文本对象, op1, Engine[97055])` 在文本对象里封口当前行（后续文本进下一行）；handler=sub_41ECE0（raw .c 28389） |
| 0x70 | 5 |  | sub_41ED20 | 已核对 | **消息窗口定位尺寸**：读 op1..op5 调 `sub_45D660(_this+21324, op1..op5, 0)` 设置文本消息窗口 x/y/宽/高坐标。fire-and-forget。handler=sub_41ED20（raw .c 28083） |
| 0x71 | 1 |  | sub_41ED80 | 已核对 | **显示消息/推进文本**：读 op1 文本调 `sub_45EC60(msgobj, op1, _this[97055])`，经 `sub_48E870`/`sub_48F000` 渲染；置 flag `_this[174801]\|=0x8000000`、`_this[122455]=1`、`_this[122496]=0`。handler=sub_41ED80（raw .c 28100） |
| 0x72 | 1 | wait-for-input | sub_41EEF0 | 已核对 | **wait-for-input**：ADV「等待推进」。刷输入掩码（bit 0x40 = 跳读中）→ 与 `0x71` 同构地按 `message:ReadTextSkip` 分支判 `sub_48E870`/`sub_48F000` → 置/清 `effect_flags` 的 `0x8000000`；未显示完时把 3 个消息回调槽交付 `sub_4BB840` 并清槽。**PARTIAL**（消息槽区未建模）；handler=sub_41EEF0（raw .c 28482） |
| 0x73 | 10 |  | sub_41F250 | 已核对 | **消息窗口全面配置**：读 op1..9 调 `sub_456430(msgobj, op1..9)` 拷 0x28 字节几何/布局结构进消息窗，读 op10 调 `sub_453AD0` 置节流标量。fire-and-forget。handler=sub_41F250（raw .c 28280） |
| 0x74 | 1 |  | sub_41F320 | 已核对 | **SetMessageSpeed（仅字段）**：`Engine[21668] = op1`（= `Font+1376` = `message:MessageSpeed`）。★**不写配置注册表**（写注册表的是 `0x1B5`）。脚本用它做「这一段立即显示」：`i07f<存>` → `i074 0` → … → `i074<还原>`（全库 206 处）；handler=sub_41F320（raw .c 28642） |
| 0x75 | 1 |  | sub_41F350 | 已核对 | **设消息窗宽/反向偏移**：读 op1 调 `sub_4185F0(msgobj, op1)` 写 `_this[201684]=op1; _this[1232]=-op1; _this[101972]=-op1` 等，再 `sub_459F40()` 刷文本布局。fire-and-forget。handler=sub_41F350（raw .c 28330） |
| 0x76 | 1 |  | sub_41F390 | 已核对 | **设消息窗滚动类属性**：读 op1，字节序翻转后写 `_this[21664]`，调 `sub_459F40()` 刷消息/文本布局。handler=sub_41F390（raw .c 28339） |
| 0x77 | 1 |  | sub_41F3F0 | 已核对 | **同 0x76**：读 op1 字节序翻转写 `_this[21665]`，调 `sub_459F40()` 刷布局。handler=sub_41F3F0（raw .c 28349） |
| 0x78 | 1 |  | sub_41F450 | 已核对 | **设消息窗属性并刷布局**：读 op1 写 `_this[21667]`，调消息/文本对象 `sub_459F40()`。handler=sub_41F450（raw .c 28359） |
| 0x79 | 3 |  | sub_41F490 | 已核对 | **文字起点（写窗对象 `+28/+32`）**：读 op1..op3 调 `sub_4563A0(_this+21324, op1, op2, op3)`；该函数取 `Font[win+261]`（win=0 时用 `Font[307]` 的默认窗；`Font+0x414+4*win` = `Engine[21585+win]` 对象表项）后 `obj+28 = op2; obj+32 = op1`（sub_4563A0 raw 68233-68246）。⚠️ 旧注「选中子项 +28/+32」有误：`+28/+32` 是**窗对象**字段。fire-and-forget。handler=sub_41F490（raw .c 28369） |
| 0x7A | 3 |  | sub_41F4E0 | 仅映射 |  |
| 0x7B | 2 |  | sub_41F530 | 仅映射 |  |
| 0x7C | 0 | local-ret | sub_41AB80 | 已核对 | **local-ret**（曾名 `i07c`；单帧"续点 ret"——wait→事件→恢复的协程返回，主循环 `0x4000000` jump/call-pending 的配对方）：要求 `_this[489808]&0x2000000` 置位（否则抛 EndHWl）；校验当前帧[95796]==`_this[430712]`（深度，否则抛「Depth が不正」）；恢复当前帧 `ip=帧起始+4*_this[489812]`、状态=0、`effect_flags=_this[489808]&0xFDFFFFFF`、清 `489808/81776/81768/51848/51840`；若 `_this[387940]` 置位则清之，且 `dispatch_queue` 恰有 1 个（`read<write && write-read==1`）时 `sub_40FB60` 一次性派发。handler=sub_41AB80（raw .c 25779）。**曾仅映射** |
| 0x7D | 2 |  | sub_41F580 | 仅映射 |  |
| 0x7E | 1 |  | sub_41F630 | 仅映射 |  |
| 0x7F | 1 |  | sub_42D1F0 | 已核对 | **GetMessageSpeed**：`op1 = Engine[21668]`（= `message:MessageSpeed`；**不是**消息窗 α）。全库 210 处；handler=sub_42D1F0（raw .c 38010） |
| 0x80 | 1 |  | sub_41F690 | 已核对 | **设消息窗口(メッセージウィンドウ)字段 `_this[21631] = op1`**：读 op1，写入 `_this[21631]`（消息窗当前窗格/部件索引；读取点用 `_this[21631]` 及 `_this[21631+21585]` 取部件对象，见 raw 13712/25395/28567/30096）。属 `_this+21324` 消息窗一族（0x81 设 `_this[21666]` 颜色字、0x82 sub_466000 设窗格）。handler=sub_41F690（raw .c 28786）。CONFIG.txt 用 `i080 9/8/1` 切换消息窗格 |
| 0x81 | 1 |  | sub_41F6C0 | 仅映射 |  |
| 0x82 | 5 |  | sub_41F720 | 仅映射 |  |
| 0x83 | 3 |  | sub_42D220 | 仅映射 |  |
| 0x84 | 1 |  | sub_41F790 | 已核对 | **文本回调状态机**：按 op1（<0 / 0 / >0）与 `Engine[122454]` 决定：显示消息（`sub_459770`）、置/清 `effect_flags` 的 `0x100000`、必要时 push/pop `Engine[0x68EA4]` 保存恢复 `effect_flags`（`0xFFEFFFFF` 清该位），并 `sub_411560` 派发回调。**PARTIAL**；handler=sub_41F790（raw .c 28829-28942） |
| 0x85 | 0 |  | sub_418F50 | 仅映射 |  |
| 0x86 | 1 |  | sub_41FA20 | 仅映射 |  |
| 0x87 | 0 |  | sub_418F80 | 仅映射 |  |
| 0x88 | 1 |  | sub_41FAB0 | 已核对 | **消息显示/跳读模式**：读 op1，同时写引擎字段 `_this[1415]` 与全局数组槽 `_this[97050]`；非零置 `_this[122368]=1`，零则清 `_this[174801]` 的 0x8000000 位。（写全局数组故为 VM 可见）handler=sub_41FAB0（raw .c 28628） |
| 0x89 | 4 |  | sub_41FB00 | 仅映射 |  |
| 0x8A | 6 |  | sub_41FB50 | 仅映射 |  |
| 0x8B | 1 |  | sub_41FBF0 | 已核对 | **消息窗字段**：读 op1 写 `_this[21669]`。handler=sub_41FBF0（raw .c 28681） |
| 0x8C | 1 | jmp | sub_4203D0 | 已核对 | 跳到 operand1 的 label（无条件，不入栈） |
| 0x8D | 2 |  | sub_420450 | 仅映射 |  |
| 0x8E | 1 |  | sub_4204D0 | 仅映射 |  |
| 0x8F | 1 | call | sub_420560 | 已核对 | 同脚本子程序调用：push 下一指令到每帧返回栈，跳 label；operand==-1 则弹回不跳。handler=sub_420560（raw .c 29452） |
| 0x90 | 7 |  | sub_420640 | 已核对 | **登记点击热点 / 路由项**：`i090 <x> <y> <w> <h> <labelA> <labelB> <labelC>` → `sub_403B30(Engine+0x55D8, x, y, x+w, y+h, labelA, labelB, labelC, 帧参数)`；入队失败（表满 100）抛 `Command_ShowMessage`；随后置游标 `Engine[7468] = -1`、推进标志 `Engine[7466] = 0`。**PARTIAL**；handler=sub_420640（raw .c 29477-29518） |
| 0x91 | 1 |  | sub_420740 | 仅映射 |  |
| 0x92 | 2 |  | sub_4207D0 | 仅映射 |  |
| 0x93 | 0 |  | sub_4191D0 | 已核对 | **显示态切换**：`_this[174801]&=~0x800000`、`sub_403EF0`、toggle `_this[12957]/[12956]`。handler=sub_4191D0（raw .c 25044） |
| 0x94 | 0 |  | sub_419230 | 仅映射 |  |
| 0x95 | 2 |  | sub_420870 | 仅映射 |  |
| 0x96 | 0 |  | sub_419260 | 仅映射 |  |
| 0x97 | 5 |  | sub_420910 | 仅映射 |  |
| 0xA0 | 3 | jcc | sub_4209B0 | 已核对 | **两目标条件跳转**（仅 3 个操作数）：`op1=条件`（非 0 为真）；`op1≠0`→跳 `op2`（若 `op2==0xFFFFFFFF` 则落下句）；`op1==0`→跳 `op3`（若 `op3==0xFFFFFFFF` 则落下句）。 |
| 0xA1 | 0 | menu-reset | sub_433A40 | 已核对 | **菜单派发表复位**：`sub_415530(_this+107679, 0xFFF)`（0xFFF=容量/上限）。清空菜单对象 `_this+107679` 的内存表（字符串哈希表）。handler=sub_433A40（raw .c 42046）。emulator：`op_menu_reset` → `engine.menuMap.clear()` |
| 0xA2 | 2 | menu-bind | sub_434F10 | 已核对 | **登记菜单项 key→label**：读 op1(字符串键,sub_41B640)+op2(值,sub_41BF50) → `sub_434D00(_this+107679, key, &value)` 插入内存表。TITLE：`i0a2 (local40d) 44f / 0 452 / 1 481 / 2 4a3 / 3 52d / 4 540`。handler=sub_434F10（raw .c 42908）。emulator：`op_menu_bind` key=String(DEC(op1))、value=DEC(op2) → `menuMap.set(key,value)`（**注意**：引擎 sub_41B640 读 string；TITLE 用菜单项序号(-1/0/1/2/3/4)为键，emulator 取 op1 的 DEC 值字符串化） |
| 0xA3 | 2 | menu-dispatch | sub_429830 | 已核对 | **按 key 查表派发**：读 op1(字符串键,sub_41B640) → `sub_428E00(_this+107679, key)` 查；命中 `ip = str_table + 4*值`（跳转），未命中跳 op2(回退 label)。handler=sub_429830（raw .c 35742）。emulator：`op_menu_dispatch` key=String(DEC(op1))，target=menuMap.get(key) ?? DEC(op2)，`labelPos(target)` 命中则 `jump` |
| 0xAA | 2 |  | sub_42D580 | 已核对 | **写文件（保存族）**：读 op2=字符串表下标 → `CreateFileA(名, GENERIC_WRITE, 0, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, 0)`；失败 ⇒ ShowMessage + 写 `op1 = 1`；成功 ⇒ 取注册表 `set:SaveVersion` 经 `sub_40CD10(this, 文件, 版本, "set:SaveVersion")` 写文件、CloseHandle、写 `op1 = 返回值`。★订正：数据层早期误标为「文本项记录查询」（那条是 `0x2F3`/sub_431A10）；handler=sub_42D580（raw .c 38148-38175） |
| 0xAB | 2 |  | sub_42D650 | 仅映射 |  |
| 0xAC | 9 |  | sub_42D700 | 仅映射 |  |
| 0xAD | 0 |  | sub_4192C0 | 仅映射 |  |
| 0xAE | 0 |  | sub_4192F0 | 已核对 | **存档版本分支指令**：经 `_this+174405` 对象 vtable 读存档版本（"set:SaveVersion1"/"set:SaveVersion2"），按版本(1/2/3/20)重算每脚本 ip（`_this[30*x+95782/95803/95804]`）、设 frame arity、切换 `cur` 或 `sub_40F750`→`loadScriptFrame_40ED40` 装载目标脚本帧；并置 `_this[95780]=0`、`_this[97054]=1`。handler=sub_4192F0（raw .c 24413） |
| 0xAF | 0 |  | sub_419690 | 仅映射 |  |
| 0xB0 | 1 |  | sub_420A50 | 仅映射 |  |
| 0xB1 | 1 |  | sub_420A80 | 仅映射 |  |
| 0xB2 | 2 |  | sub_420AB0 | 仅映射 |  |
| 0xB3 | 0 |  | sub_4196B0 | 仅映射 |  |
| 0xB4 | 2 | play-sound-effect | sub_420B00 | 已核对 | **play-sound-effect**：帧 arity=5；读 op1=音效 id、op2=通道指针 → `sub_4B4F60(Engine+20719, 通道, id)` 预载/起播音效。**PARTIAL**（`sub_4B4F60` 未分析）；handler=sub_420B00（raw .c 29680-29687） |
| 0xB5 | 1 |  | sub_420B40 | 已核对 | **声音通道控制**：读 op1=通道号 → `sub_4B5020(_this+20719, op1, 0)` →（设备在时）`sub_4B6020(设备, op1, 0)`：通道>0xE 或未分配→报错/返回；否则 `sub_4B73E0(通道,0)`。**纯声音侧、无 VM/渲染效果**。handler=sub_420B40（raw .c 29689）。emulator：**声音相关→忽略 no-op**（与 0xB4/0xB6 同族，TITLE 音效） |
| 0xB6 | 1 |  | sub_420B80 | 已核对 | **声音通道**：`sub_4B5050(_this+20719, op1)`(播/控音效)。handler=sub_420B80（raw .c 29327） |
| 0xB7 | 1 |  | sub_420C00 | 仅映射 |  |
| 0xB8 | 0 |  | sub_419720 | 仅映射 |  |
| 0xB9 | 1 |  | sub_420C60 | 仅映射 |  |
| 0xBA | 1 |  | sub_420BC0 | 仅映射 |  |
| 0xBB | 1 |  | sub_420D90 | 仅映射 |  |
| 0xBC | 1 |  | sub_420DC0 | 仅映射 |  |
| 0xBD | 1 |  | sub_42E460 | 仅映射 |  |
| 0xBE | 1 |  | sub_42E4D0 | 仅映射 |  |
| 0xBF | 1 | play-bgm | sub_420CC0 | 已核对 | **play-bgm**：清 `Engine[174801]` bit 0x200 并 `sub_489E50(Engine+174454, 100)`；读 op1=音乐 id → `sub_489C20(Engine+174454, id, 1)`；并按 `set:KeepMusicVoice` / `sound:MusicFadeOnVoicePlaying(Volume)` 决定 `sub_489C00` 渐隐。**PARTIAL**；handler=sub_420CC0（raw .c 29754-29780） |
| 0xC0 | 1 |  | sub_42E510 | 已核对 | **读引擎字段 `_this[174713]`→op1**（`sub_42B4B0(_this,1,_this[174713])` = writeIntOperand 写 op1）。`174713` 是**音乐/声音子系统**字段（被 0xC3/sub_420F10 `_this[174713]=op1` 写；与 174712/174715 及 `_this+174454` 音乐对象同用，见 sub_408CF0 保存/恢复它）。handler=sub_42E510（raw .c 38618）。CONFIG.txt 用 `i0c0 (local-int 2)` 读系统值到 local |
| 0xC1 | 0 |  | sub_419770 | 仅映射 |  |
| 0xC2 | 2 |  | sub_420E00 | 仅映射 |  |
| 0xC3 | 1 |  | sub_420F10 | 已核对 | **写引擎字段**：`Engine[174713] = op1`（音乐/声音子字段 setter），并清 `Engine[174801]` bit 0x200 + `sub_489E50(Engine+174454, 100)`；handler=sub_420F10（raw .c 29844-29859） |
| 0xC4 | 1 | play-voice | sub_420F70 | 已核对 | **play-voice**：读 op1=语音 id、op2=槽 → 经音乐/声音对象起播语音。**PARTIAL**（内部语音路径未分析）；handler=sub_420F70（raw .c 29861-29870） |
| 0xC5 | 2 |  | sub_42E540 | 已核对 | **读配置写操作数**：op1 = 0..4 ⇒ `GetConfig("sound:Volume0..4")` → **写 op2**；op1 越界走报错分支（`sprintf_s(aGetvolume)` + `sub_4034D0`），不写操作数；handler=sub_42E540（raw .c 38626-38667） |
| 0xC6 | 2 |  | sub_421070 | 仅映射 |  |
| 0xC7 | 2 |  | sub_42E670 | 已核对 | **读配置写操作数**：op1=1 ⇒ `sound:Music`（≥0 ⇒ 1）、2 ⇒ `sound:SE`、3 ⇒ `sound:Voice`、4 ⇒ `sound:Movie`（非 0 ⇒ 1）→ **写 op2**；handler=sub_42E670（raw .c 38671-38716） |
| 0xC8 | 1 | sleep | sub_4218D0 | 已核对 | **睡眠/帧让步**：读 op1=n。非 ADV 激活（`(effect_flags&0x8000000)==0`）时，n<10 → `Sleep(n)` ms；n>=10 → `sub_453A60(_this+107440,n)` 设帧率节流（`_this[6]=n` 帧间隔=n ms，`sub_453AF0` 按 `interval*frame_count-elapsed` 决定 Sleep(剩余)）——本质都**暂停≈n ms**；ADV 激活则跳过。handler=sub_4218D0（raw .c 30288）。emulator：`op_sleep` 置 `sleepUntil=nowMs+max(1,n)`、`waitFlags|=SLEEP_GATE`，渲染帧循环每帧 present 到点放行（帧让步；TITLE 菜单 `sleep 1`）。 |
| 0xC9 | 0 |  | sub_4198A0 | 仅映射 |  |
| 0xCA | 0 |  | sub_4198E0 | 仅映射 |  |
| 0xCB | 1 |  | sub_42E8E0 | 仅映射 |  |
| 0xCC | 2 | mouse-callback | sub_421980 | 已核对 | **注册鼠标跳转目标**（非函数指针）：读 op2→`_this[107664]`、`_this[107674]=cur[]depth`；op1→`sub_453A60(_this+107447, op1)`（节流对象[2]=1、[5]=timeGetTime、[6]=op1）。按下匹配时 get-input-type(0xCD) 跳到 `_this[107664]`。handler=sub_421980（raw .c 30317） |
| 0xCD | 0 | get-input-type | sub_41ACD0 | 已核对 | **消息/ADV"点击推进"门**：置 `_this[120*cur+383220]=1`；`timeGetTime()-_this[429808]` 与 `_this[429812]`（节流间隔，**全工程无写入 → bss 0 → 实际不节流**，或 `(effect_flags&0x8000000)` 激活即推进）；读 `_this[430656]`(=鼠标目标)。==-1 则回退不跳，否则 depth 校验后 `_this[120*cur+383128]=..+4*目标` 跳转。**不"返回输入类型"**。handler=sub_41ACD0（raw .c 25827）。emulator `advanceThrottle=0`（对齐引擎无节流） |
| 0xCE | 3 |  | sub_4219E0 | 仅映射 |  |
| 0xCF | 0 |  | sub_41AE40 | 仅映射 |  |
| 0xD0 | 1 |  | sub_42E910 | 仅映射 |  |
| 0xD1 | 0 |  | sub_419940 | 仅映射 |  |
| 0xD2 | 1 |  | sub_421A50 | 仅映射 |  |
| 0xD3 | 0 |  | sub_42AC40 | 仅映射 |  |
| 0xD4 | 4 |  | sub_42E940 | 仅映射 |  |
| 0xD5 | 1 |  | sub_42ACC0 | 仅映射 |  |
| 0xD6 | 6 |  | sub_42EB80 | 仅映射 |  |
| 0xD7 | 1 |  | sub_421AF0 | 仅映射 |  |
| 0xD8 | 2 |  | sub_421AA0 | 仅映射 |  |
| 0xD9 | 0 |  | sub_419970 | 已核对 | **清标志位**：`_this[174801]&=~0x1000`。handler=sub_419970（raw .c 25022） |
| 0xDA | 6 |  | sub_42EAE0 | 仅映射 |  |
| 0xFA | 0 |  | sub_4199B0 | 已核对 | **poll-msg-advance（输入 + ADV 状态机）**：清 `Engine[97054]`；`sub_4780D0` 读输入状态；若 `(v5 & 0x40) == 0` 则清 `Engine[174801]` 的 `0x8000000`（退出 ADV）、遍历 3 个回调槽（122505 区）经 `sub_4BB840` 处理并清空；若仍非 ADV 则 `sub_478090` flush 输入 → `Engine[174802]`、置负 `effect_flags`（`|= 0x80000000`，等待门）并清输入掩码 —— 即空闲时触发 `sub_411BC0` 空等待派发；handler=sub_4199B0（raw .c 24952-24988） |
| 0xFB | 2 | joy-callback | sub_421B80 | 已核对 | **注册手柄跳转目标**（非 `sub_453A60`！）：校验 op1∈[0,32)（越界抛 `set-keyjump`）、`_this[33*cur+107725+op1]=op2`（把手表）。`sub_419AF0`(0x100) 扫掩码最低位、按此表跳 label。handler=sub_421B80（raw .c 30400）。⚠️ 修正旧「sub_453A60(_this+107454, op1)」——该写法属 0xCE(sub_4219E0) |
| 0xFC | 0 |  | sub_419A70 | 仅映射 |  |
| 0xFD | 2 |  | sub_421C10 | 仅映射 |  |
| 0xFE | 1 |  | sub_421CA0 | 已核对 | **SetKeyTotal**：读 op1；若 `op1>0x1F` 抛 ShowMessage「SetKeyTotalの引数が不正です．」，否则写引擎字段 `_this[517]`。handler=sub_421CA0（raw .c 30046） |
| 0xFF | 0 |  | sub_419A90 | 已核对 | **复位输入/ADV 状态**：`Engine[174802] = 0` → `sub_4780D0(Engine+1032, Engine+174802)`（读输入态）；`Engine[cur+122287] = 0`；`Engine[cur+122327] = Engine[517]`（把字段灌进当前帧槽）。handler=sub_419A90（raw .c 24998） |
| 0x100 | 0 |  | sub_419AF0 | 已核对 | **消息跳读/按键推进派发**：`v2=_this[174802]`(输入掩码)；非 0→从 `_this[cur+122287]` 起扫最低按下位（上限 `_this[517]`=SetKeyTotal），push 推进量、查 `_this[33*cur+107725+bit]`，==-1 回退否则跳 `4*登记值`；掩码 0→检查默认键 `_this[517]`。handler=sub_419AF0（raw .c 25011） |
| 0x101 | 0 | poll-input | sub_419CC0 | 已核对 | **刷输入掩码并复位**：`sub_478090(_this+258,_this+174802)` 刷累计事件进掩码 → 清 `_this[174801]` 的 0x8000000 位 → `_this[174802]=0`、`_this[122367]=1`、`_this[122370]=0`。供同批 `check-bit`/位检查读，随即清零。handler=sub_419CC0（raw .c 25069）。旧 label `u00415BF0` |
| 0x102 | 3 |  | sub_421D00 | 仅映射 |  |
| 0x103 | 1 |  | sub_421DE0 | 仅映射 |  |
| 0x104 | 0 |  | sub_419D20 | 仅映射 |  |
| 0x105 | 1 |  | sub_421E20 | 仅映射 |  |
| 0x106 | 1 |  | sub_42ED90 | 已核对 | **配置 getter**：`op1 = Engine[550]`。handler=sub_42ED90（raw .c 39040） |
| 0x107 | 2 |  | sub_421E50 | 已核对 | **SetKey（按键绑定）**：读 op2=值、op1=键下标；`op1≤0x1F` 时写 `_this[551+op1]=op2`。handler=sub_421E50（raw .c 30114） |
| 0x108 | 1 | read-mouse-button | sub_42EDC0 | 已核对 | **读鼠标按钮值到 op1**（曾名 `i108`）：`sub_477220(_this+258,&v3)`（左=bit0/右=bit1，随 SM_SWAPBUTTON 互换）→ `sub_42B4B0(1,v3)`。handler=sub_42EDC0（raw .c 39047） |
| 0x109 | 2 | read-mouse-pos | sub_42EE10 | 已核对 | **读鼠标位置到 op1=X,op2=Y**（曾名 `i109`）：`sub_4771D0`(GetCursorPos+ScreenToClient) → `sub_498350`(坐标变换)+`sub_403500`(虚拟显示映射，用 `_this[699168/699172]` 分辨率) → 写 op1/op2。(-100000,-100000)=未初始化。handler=sub_42EE10（raw .c 39057） |
| 0x10A | 2 |  | sub_421EA0 | 仅映射 |  |
| 0x10B | 2 |  | sub_422070 | 已核对 | **SetKey（另一按键表）**：读 op2=键下标、op1=值；`op1≤0x1F` 时写 `_this[op2+1383]=op1`。handler=sub_422070（raw .c 30200） |
| 0x10C | 2 |  | sub_4220B0 | 已核对 | **SetKeyMulti**：读 op1=值、op2=键索引；`op1>0x1F` 抛 ShowMessage「set-keymulti 引数不正」，否则写 `_this[_this[op2+1690]+1434]=op1`。handler=sub_4220B0（raw .c 30213） |
| 0x10D | 1 | read-mouse-wheel | sub_42EF50 | 已核对 | **读鼠标滚轮增量（一次性消费）**（曾名 `i10d`）：`v2=mouse_wheel_residual(_this[1949]/+0x1E74)`；**随即清零**；`sub_42B4B0(1,v2)` 写 op1。值 = 自上次读取以来 WM_MOUSEWHEEL 的 `+= SHIWORD(wParam)` 累计（一格 ±120，上滚正/下滚负），清零点见 raw 141582 写入、raw 13938/21060 消息泵 ADV 推进门（仅 `<0` 即下滚才推进文本）。handler=sub_42EF50（raw .c 39114）。★脚本模式：菜单/列表进入时 `read-mouse-wheel (local 403)` 丢弃残量，主循环反复 `read-mouse-wheel (local 403)`+`jcc (local 403) <翻页label>` 实现滚轮翻页（AGENCY:258/283 等 40+ 脚本） |
| 0x10E | 2 |  | sub_42EF90 | 仅映射 |  |
| 0x10F | 1 |  | sub_422120 | 已核对 | **引擎控制字段**：读 op1 写 `_this[122369]`。handler=sub_422120（raw .c 30232） |
| 0x12C | 5 | lookup-array-2d | sub_42EFD0 | 已核对 | **lookup-array-2d**（二维数组元素地址）：`v6=op3*op4+op5`（行×列宽+列），`operandAddress_42AEA0(2)` 取 op2 基址，`sub_418CC0(1, base, v6, -1, -1)` 把 `base+4*v6` 写入 op1 指针槽。handler=sub_42EFD0（raw .c 38462） |
| 0x12D | 7 |  | sub_42F040 | 仅映射 |  |
| 0x12E | 8 |  | sub_42F230 | 已核对 | **悬停命中测试**：先用 `sub_42AEA0` 取 op2/op5/op6/op7 的**操作数地址**、`sub_41BF50` 取 op1/op3/op4/op8 的值并缓存进全局 `dword_55D5xx`；再从 `base + 16*(op1+1)` 起遍历矩形表（每项 16B，4 个 dword 经 DEC 去混淆作 x0/x1/y0/y1），命中 ⇒ **写 op1 = 项下标**，否则 -1。**PARTIAL**（全局缓存跨帧语义未定）。handler=sub_42F230（raw .c 39199） |
| 0x12F | 4 |  | sub_42F560 | 已核对 | **索引插入排序**：`op1/op2/op3` 经 `sub_42AEA0`（operandAddress）取三个数组基址 **A=索引数组 / B=主键 / C=次键**（三者同索引空间），`op4` = 元素数 `n`；`*A = 0`；对 `k=1..n-1`：`while (DEC(B[A[j]]) + DEC(C[A[j]]) > DEC(B[k]) + DEC(C[k])) { A[j+1]=A[j]; j-- }` 再 `A[j+1]=k`；末尾逐项 `A[i] = ENC(DEC(A[i]))`（净恒等）。★**比较键是 `B[A[j]] + C[A[j]]`**（用 A 里存的**索引**去查 B/C，raw 39299-39307 的下标嵌套就是它），**不是**"A 位置上的值"、也不是"C 的同位置值" —— 取错键会让顺序**依赖 A 的残留内容**（`CONFIG1` 首次进设置「字体系列」被前置、切 tab 回来又"看起来对"；实测已修）。★**DEC/ENC 只做一层**：数组里存 `ENC` 位模式，引擎的数组访问器（`sub_41BF50` 读 / `sub_42B4B0` 写）就是 `DEC` 读 / `ENC` 写；本条体内自带的 `DEC`（raw 39300 的 `__ROR4__(key ^ __ROL4__(x,11),25)`）是**同一层**，实现时不得再叠一次。handler=sub_42F560（raw 39269-39335）。实测用例：CONFIG2.txt:1044（n=1000）、CONFIG1.txt:1178 |
| 0x130 | 1 | load-show-logo | sub_42F7A0 | 已核对 | **LOGO/版权页开关 getter**（曾名 `i130`）：`op1 = _this[96983]`（写回操作数 1；SYSTEM4 第 146 行据此判断是否 `call-script LOGO`）。构造=1 播版权页、exit-script(0x9) 置 0 → GAMEOVER 回标题不再播。handler=sub_42F7A0（raw .c 38662） |
| 0x131 | 1 |  | sub_42F7D0 | 已核对 | **GetMesWinAlpha**：`op1 = GetConfig("message:MesWinAlpha")`（按名直读配置注册表，**不读任何 Engine 字段**）；handler=sub_42F7D0（raw .c 39350-39356） |
| 0x132 | 1 |  | sub_422150 | 仅映射 |  |
| 0x133 | 2 |  | sub_422240 | 仅映射 |  |
| 0x134 | 3 |  | sub_42F810 | 仅映射 |  |
| 0x135 | 2 | bit-set | sub_42F8B0 | 已核对 | `op1 \|= (1<<op2)`（置位；op2=bit 位，>0x1F 报错 `setbit`）。handler=sub_42F8B0（raw .c 39402） |
| 0x136 | 2 | bit-reset | sub_42F920 | 已核对 | `op1 &= ~(1<<op2)`（复位；op2=bit 位，>0x1F 报错 `rembit`）。handler=sub_42F920（raw .c 39424） |
| 0x137 | 1 |  | sub_4222B0 | 仅映射 |  |
| 0x138 | 2 |  | sub_4223A0 | 仅映射 |  |
| 0x139 | 3 |  | sub_42F990 | 仅映射 |  |
| 0x13A | 6 |  | sub_422410 | 仅映射 |  |
| 0x13B | 7 |  | sub_4224E0 | 仅映射 |  |
| 0x13C | 1 |  | sub_422860 | 仅映射 |  |
| 0x13D | 3 |  | sub_42FA20 | 仅映射 |  |
| 0x13E | 2 |  | sub_42FAC0 | 仅映射 |  |
| 0x13F | 3 | check-bit | sub_42FB40 | 已核对 | `op1 = ((1<<op3) & op2) != 0`（op3=bit 位，op2=待测值，>0x1F 报错 `getbit`）。handler=sub_42FB40（raw .c 39549） |
| 0x140 | 4 |  | sub_42FBC0 | 仅映射 |  |
| 0x141 | 1 |  | sub_4228C0 | 已核对 | **SetMesWinAlpha**：op1 > 0x10 时报错（`aGetmeswina`），否则 `SetConfig("message:MesWinAlpha", op1)`（直写配置注册表，**不进持久字段**）；handler=sub_4228C0（raw .c 30998-31016） |
| 0x142 | 1 |  | sub_422930 | 已核对 | **脚本写引擎运行开关**：`_this[174812] = readIntOperand(op1)`（字段=字节 `0xAAB70`）。构造 `sub_415640`(raw 22591)/复位 `sub_40DF10`(raw 17961) 都置 **1**；唯一读者是导出查询 `sub_4765C0(){ return _this[699248]!=0; }`(raw 91057，引擎内零调用)。脚本：`CONFIG.txt:40 i142 0` 进设置页挂起、`:354 i142 1` 离开恢复。handler=sub_422930（raw 31020） |
| 0x143 | 0 |  | sub_41A000 | 已核对 | **派发挂起脚本/事件请求**（dispatchScriptRequests）：置 `_this[124350]=1`，遍历 `_this+173106` 队列对每非零槽 `queueScript_40FC90(slot<<24)` 排队，`dispatchQueuedScripts_40FB60()` 派发；置 `_this[124350]=0`、`_this[30*cur+95805]=0`、`frames[cur].ip+=4`。handler=sub_41A000（raw .c 24928） |
| 0x144 | 2 |  | sub_433AB0 | 仅映射 |  |
| 0x145 | 1 |  | sub_42FCF0 | 仅映射 |  |
| 0x146 | 1 |  | sub_422960 | 仅映射 |  |
| 0x147 | 6 |  | sub_42FD60 | 仅映射 |  |
| 0x148 | 1 |  | sub_42FEC0 | 已核对 | **读全局时间阈值槽**：`sub_42B4B0(1, _this[97058])` 把引擎全局槽 `_this[97058]`（byte 388232，见 `analysis/fields.json` `global_slot_97058`）写回 op1（**get**；与 0x149 构成 get/set 对）。该槽是「光标贴屏幕顶边缘 / 松开 Alt → 弹系统对话框」的去抖时长：`sub_4B9240`(WM_TIMER) 读它并与 `timeGetTime()-dword_55E1D8` 比较，超时才弹框。handler=sub_42FEC0（raw .c 39705）。**曾仅映射，已读体确证** |
| 0x149 | 1 |  | sub_4229A0 | 已核对 | **写全局时间阈值槽**：读 op1 写 `_this[97058]`（byte 388232，紧邻 DEC/ENC 机制的 key `_this[97059]`/`enc_zero` `_this[97060]`；与 0x148 构成 get/set 对）。作用：设置「光标贴顶/Alt→弹系统对话框」的去抖时长（`sub_4B9240` 读、SYSTEM4 `i149 3e8`=1000ms）。handler=sub_4229A0（raw .c 30629） |
| 0x14A | 7 |  | sub_42FEF0 | 仅映射 |  |
| 0x14B | 1 |  | sub_4229D0 | 已核对 | **运行时插件/DLL 加载**：已有句柄先 `FreeLibrary(Engine+490072)` 并清 0；读 op1=字符串表下标 → `sub_454FA0` 取名 → `LoadLibraryA` 存回 `Engine+490072`；失败 ⇒ `GetLastError` + **抛异常**（会影响控制流，桩实现不得抛）。handler=sub_4229D0（raw .c 31056） |
| 0x14C | 2 | set-agerc-export | sub_422AB0 | 推测 | 绑定 agerc 导出。未读体 |
| 0x14D | 6 | call-agerc-export | sub_430170 | 推测 | 调用 agerc 导出。未读体 |
| 0x190 | 2 |  | sub_42D830 | 仅映射 |  |
| 0x191 | 2 |  | sub_42CEC0 | 仅映射 |  |
| 0x192 | 2 | set-string | sub_433660 | 已核对 | `op1 = op2`（**汉化核心指令**：把字符串 op2 赋给 op1 串槽。`sub_42A420(this,&buf,2)` 读 op2 字符串对象 → `sub_433310(this,1,buf)` 写入 op1）。handler=sub_433660（raw .c 41936） |
| 0x193 | 3 | concat | sub_433710 | 已核对 | `op1 = op2 + op3`（字符串拼接：`sub_42A420` 读 op3/op2 → `sub_42AA90` 拼接（**op2 在前**）→ `sub_433310` 写入 op1）。handler=sub_433710（raw .c 41952） |
| 0x194 | 3 |  | sub_42CF10 | 已核对 | **字符串相等判定**：取 op2/op3 两个字符串操作数（`sub_42A420`），经 `sub_401540`（`std::string::compare(pos,len,rhs,rhsLen)` 语义：先 memcmp 较短长度、相等再比长度）⇒ `op1 = (cmp == 0)`；handler=sub_42CF10（raw .c 37909-37938） |
| 0x195 | 3 |  | sub_42D010 | 仅映射 |  |
| 0x196 | 3 | display-furigana | sub_41FC20 | 已核对 | **display-furigana**：读 op1=槽、op2=本文词、op3=注音（先有界拷进 1024 栈缓冲）。分三路：① `MessageSpeed == 0` 或 ADV 位已置 ⇒ `sub_46CBF0(Font, op1, op2, op3, Engine[388220])`（同步排空）；② 否则 `sub_46BE30(...)`，返回非 0 时置 `effect_flags |= 0x20000000`、`Engine[489484] = op1` 并起节拍定时器 `sub_453A60(Engine+430572, MessageSpeed)`；③ `Engine[489988] & 1` 置位时纯 `sub_46BE30`。★op2（本文词）本身是正文的一部分（全库 6341 处用它把一句话从词中间切开）。**曾「推测」**；handler=sub_41FC20（raw .c 29032-29126） |
| 0x197 | 1 |  | sub_41FDD0 | 已核对 | **配置显示/布局对象**：读 op1 调 `sub_418680(_this+21324, op1)`，写界面面板/窗口布局字段。fire-and-forget。handler=sub_41FDD0（raw .c 28775） |
| 0x198 | 3 |  | sub_41FE10 | 已核对 | **窗屏幕位置**：读 op1=窗、op2=x、op3=y → `sub_456400(Font, op1, op2, op3)` 写窗对象 `+12 = x`、`+16 = y`（win=0 用默认窗 `Font[307]`；对象不存在则不写）；handler=sub_41FE10（raw .c 29127-29135） |
| 0x199 | 0 |  | sub_418FC0 | 仅映射 |  |
| 0x19A | 1 |  | sub_42D290 | 仅映射 |  |
| 0x19B | 0 |  | sub_4190E0 | 已核对 | **退出消息/ADV**：清 `_this[174801]&~0x8000000`、`_this[1415]=0`。handler=sub_4190E0（raw .c 25031） |
| 0x19C | 0 |  | sub_419120 | 已核对 | **进入消息/ADV**：`_this[97051]=1`、`_this[174801]|=0x8000000`、`_this[122368]=1`。handler=sub_419120（raw .c 25076） |
| 0x19D | 2 |  | sub_42D8E0 | 仅映射 |  |
| 0x19E | 2 |  | sub_42D980 | 仅映射 |  |
| 0x19F | 2 |  | sub_42DB10 | 仅映射 |  |
| 0x1A0 | 9 |  | sub_42DC70 | 仅映射 |  |
| 0x1A1 | 2 |  | sub_42DDE0 | 仅映射 |  |
| 0x1A2 | 1 | save-int | sub_434F60 | 已核对 | **save-int**：读 op1 得值+索引，`wsprintfA("%c%8.8x",3,idx)` 生成键，`sub_434D00(_this+5452, key, &val)` 插入（sub_429020 找槽、sub_40C210 存键）。handler=sub_434F60（raw .c 42140） |
| 0x1A3 | 1 | load-int | sub_42DF40 | 已核对 | **load-int**：`sub_418A30(1)` 读 op1 索引 → 键 `"%c%8.8x",3,idx` → `sub_428E00(key)` 全局字符串表查询（命中取 `*v3`、未命中=0）→ `writeIntOperand_42B4B0(1,val)` 写回 op1。（写操作数故 VM 可见）handler=sub_42DF40（raw .c 37793）。**曾名 `string-lookup-set`** |
| 0x1A4 | 2 |  | sub_41FE60 | 已核对 | **消息窗字段**：读 op1/op2 写 `_this[21670]/[21671]`。handler=sub_41FE60（raw .c 28797） |
| 0x1A5 | 1 | set-font | sub_433290 | 已核对 | **set-font**：读 op1 字符串，调 `sub_4328F0(_this+21324, str)` 设字体。fire-and-forget。handler=sub_433290（raw .c 41043） |
| 0x1A6 | 2 | halve-strlen | sub_42D110 | 已核对 | **halve-strlen**：`op1 = strlen(op2) >> 1`（`sub_41B640(2)` 读 op2 → `strlen` → `writeIntOperand_42B4B0(1, len>>1)`）。handler=sub_42D110（raw .c 37975），纯 |
| 0x1A7 | 1 | comment | sub_4191B0 | 已核对 | nop（dev 注释，无副作用） |
| 0x1A8 | 0 | dev_ukn | sub_419690 | 已核对 | nop（dev 未知指令，通常空实现） |
| 0x1A9 | 1 | save-string | sub_434FE0 | 已核对 | **save-string**：`sub_42A420` 读 op1 字符串、`sub_418AE0(1)` 读值（字符串索引），键 `"%c%8.8x",5,val`，`sub_434E00(key, str)` 插入/更新（table 满 `sub_434AF0` 扩容）。handler=sub_434FE0（raw .c 42154） |
| 0x1AA | 1 | load-string | sub_433A70 | 已核对 | **load-string**：`sub_418AE0(1)` 读 op1 字符串索引 → `sub_429390(_this+5191, 5, idx)`（键 `"%c%8.8x",5,idx`，查 `_this+5472`，未命中返静态默认 `dword_55D0FC`）→ `sub_433310(1, 结果串)` 写回 op1 的字符串。（写操作数故 VM 可见）handler=sub_433A70（raw .c 42053）。**0x1A9 的读侧** |
| 0x1AB | 2 |  | sub_42DFC0 | 仅映射 |  |
| 0x1AC | 3 |  | sub_42E0A0 | 仅映射 |  |
| 0x1AD | 0 |  | sub_4196F0 | 仅映射 |  |
| 0x1AE | 3 |  | sub_42E1F0 | 仅映射 |  |
| 0x1AF | 3 |  | sub_42E320 | 仅映射 |  |
| 0x1B0 | 3 | memcpy | sub_42D150 | 已核对 | **memcpy**：`memcpy(dest=op2, src=op1, n=4*op3)`（`operandAddress(1)` 取 op1 基址、`operandAddress(2)` 取 op2 基址、`4*op3` 为字节数）。handler=sub_42D150（raw .c 37985），纯内存拷贝 |
| 0x1B1 | 1 |  | sub_41FEA0 | 仅映射 |  |
| 0x1B2 | 1 |  | sub_42A9B0 | 已核对 | **字符串 append 日志缓冲**：`sub_40C660(_this+124336)`。handler=sub_42A9B0（raw .c 41442） |
| 0x1B3 | 0 |  | sub_42AA00 | 已核对 | **append 2 字符换行**。handler=sub_42AA00（raw .c 41452） |
| 0x1B4 | 0 |  | sub_428DB0 | 已核对 | **错误输出/中止**：`sub_40B420`。handler=sub_428DB0（raw .c 35482） |
| 0x1B5 | 1 |  | sub_41FED0 | 已核对 | **SetMessageSpeed（字段 + 注册表）**：`Engine[21668] = op1` 且 `SetConfig("message:MessageSpeed", op1)`。CONFIG1/CONFIG2 的速度滑条走这条（滑条 1..99，脚本 `sub 7f2 = 100 - 滑条值`）；`INITREGMES` 用 `i1b5 19`（= 25ms）设默认；handler=sub_41FED0（raw .c 29165-29178） |
| 0x1B6 | 1 |  | sub_42D2C0 | 仅映射 |  |
| 0x1B7 | 1 |  | sub_41FF20 | 仅映射 |  |
| 0x1B8 | 2 |  | sub_42D2F0 | 已核对 | **读配置写操作数**：op1=0 ⇒ `message:AutoMessageTime0`、1 ⇒ `AutoMessageTime1` → **写 op2**；其它值报错；handler=sub_42D2F0（raw .c CONFIG1 用法 i1b8 0/1） |
| 0x1B9 | 2 |  | sub_41FF60 | 已核对 | **设自动翻页基础时长**：读 op1=下标、op2=值；op1==1 ⇒ `SetConfig("message:AutoMessageTime1", op2)`、op1==0 ⇒ `…Time0`，其它值报错（`sub_4034D0`）。`INITREGMES` 用 `i1b9 0 5dc`（=1500ms）/ `i1b9 1 9c4`（=2500ms）设默认；handler=sub_41FF60（raw .c 29191-29220） |
| 0x1BA | 2 |  | sub_421200 | 仅映射 |  |
| 0x1BB | 1 |  | sub_420000 | 仅映射 |  |
| 0x1BC | 0 |  | sub_4197A0 | 已核对 | **清理声音/消息字段**。handler=sub_4197A0（raw .c 25002） |
| 0x1BD | 1 |  | sub_4212C0 | 仅映射 |  |
| 0x1BE | 2 |  | sub_42E770 | 仅映射 |  |
| 0x1BF | 0 |  | sub_419840 | 已核对 | **跳读态置**：按跳读态置 `_this[122503]=1`。handler=sub_419840（raw .c 25015） |
| 0x1C0 | 1 |  | sub_421450 | 仅映射 |  |
| 0x1C1 | 3 |  | sub_420070 | 已核对 | **消息/UI 子系统方法**：读 op1..op3 调 `sub_4563D0(_this+21324, op1, op2, op3)`。fire-and-forget。handler=sub_420070（raw .c 28895） |
| 0x1C2 | 2 |  | sub_4200C0 | 仅映射 |  |
| 0x1C3 | 2 |  | sub_420110 | 仅映射 |  |
| 0x1C4 | 1 |  | sub_42E8A0 | 仅映射 |  |
| 0x1C5 | 4 |  | sub_433930 | 仅映射 |  |
| 0x1C6 | 2 |  | sub_421690 | 仅映射 |  |
| 0x1C7 | 1 |  | sub_42D390 | 仅映射 |  |
| 0x1C8 | 2 | to-string | sub_433820 | 已核对 | **to-string**：`op1 = str(op2)`（`readIntOperand(2)` 读整数 → `sprintf("%d")` → 组装 SSO 字符串 → `sub_433310(1)` 写 op1）。handler=sub_433820（raw .c 41990），纯。**助记符改名 to-string**（原 toString 与 JS/Object 原型 key 冲突，曾反汇编成 `function toString() { [native code] }`） |
| 0x1C9 | 3 |  | sub_420160 | 仅映射 |  |
| 0x1CA | 1 |  | sub_420240 | 已核对 | **配置 set-message-read-texture**：读 op1，经 `_this[174405]` 消息子系统对象 vtable+12 以 `"message"`/`readtex`+op1 派发。handler=sub_420240（raw .c 28961） |
| 0x1CB | 1 |  | sub_42D3D0 | 仅映射 |  |
| 0x1CC | 1 |  | sub_42D410 | 仅映射 |  |
| 0x1CD | 2 |  | sub_42D1A0 | 仅映射 |  |
| 0x1CE | 1 |  | sub_420280 | 已核对 | **消息/UI 点击-跳读状态机**：读 op1；非0→`_this[174801]|=0x40000000`、`_this[107704]=0`、`sub_453A90(_this+430600)`(重置轮播计时器)；0→清 0x40000000。handler=sub_420280（raw .c 28974） |
| 0x1CF | 1 |  | sub_4213C0 | 已核对 | **消息跳读态**：写 `_this[122504]=op1`。handler=sub_4213C0（raw .c 29445） |
| 0x1D0 | 3 |  | sub_42D440 | 已核对 | **读回看页索引表（写回两个操作数）**：读 op3=页下标 → `sub_459860(Font, &v5, &v4, op3, 2)` ⇒ **写 op1 / op2**（页表 = `Font+3380`，8B/条 `{槽号, 回看下标}`）；handler=sub_42D440（raw .c 38099-38111） |
| 0x1D1 | 5 |  | sub_420310 | 仅映射 |  |
| 0x1D2 | 2 |  | sub_420380 | 已核对 | **文本项记录表 push**：读 op1/op2 → `sub_45EFA0(Font, 0, op1, op2)` 往 `Font+3364` 的 72B/条记录向量 push `{win=默认窗, +24=op1, +20=op2}`（`sub_45E7E0` raw 73986：传入指针落在向量内则按索引插入，否则尾插）；**不回写操作数**。读取端 = `0x1D3`/`0x1D4`/`0x2F3`（**会**回写操作数）。全库 42760 处（最高频未实现指令）。**PARTIAL**（记录表消费者未建模）；handler=sub_420380（raw .c 29373-29385） |
| 0x1D3 | 5 |  | sub_42D4A0 | 已核对 | **文本项记录查询（写回两个操作数）**：`sub_457960(Font, &v7, op3, op4, op5)`：从下标 op4 起扫 `flags & 0x20000000 && +24 == op5` 的记录取 `+20`，遇组首（下一记录 flags bit0）即停 ⇒ **写 op1 = 找到?1:0、op2 = 值**；op3 被调用方忽略；handler=sub_42D4A0（raw .c 38096-38113） |
| 0x1D4 | 4 |  | sub_42D510 | 已核对 | **文本项记录查询**：`sub_457A20(Font, &v7, &v6, &v5, op3, op4, 0)`：从 op4 起扫 `flags & 0x40000000 && +32 == 0`，输出 `+20/+24/+28` ⇒ **写 op1 / op2**（未找到 -1 / -1）；op3 被忽略；handler=sub_42D510（raw .c 38125-38149） |
| 0x1D5 | 0 |  | sub_419880 | 仅映射 |  |
| 0x1D6 | 2 |  | sub_42E7C0 | 仅映射 |  |
| 0x1D7 | 2 |  | sub_42E800 | 仅映射 |  |
| 0x1D8 | 3 |  | sub_42E850 | 仅映射 |  |
| 0x1D9 | 2 |  | sub_4213F0 | 仅映射 |  |
| 0x1F4 | 0 |  | sub_41A090 | 已核对 | **进入"停靠(dock)"锁**：`_this[107438]`(字节 429752)=停靠标志、`_this[107439]`(429756)=**深度 LockDepth**（引擎 debug 打印 "LockDepth" 自证，raw 43619）。首次进入才采样时钟（`92334=92333`、`92333=timeGetTime()`），此后只 `++深度`。**不阻塞、无 Sleep**；脚本 66510 处 i1f4 = 每帧轮询点。handler=sub_41A090（raw 25194） |
| 0x1F5 | 0 |  | sub_41A0E0 | 已核对 | **退出"停靠"锁**：`v1=_this[429756]`(LockDepth) >0 则 `--深度`；否则若 `_this[429752]` 置位 → 清标志，且 `_this[497400]`(==124350 dispatch_in_progress) 为 0 时 `sub_40FB60` 派发脚本队列（停靠期间只积累、解锁瞬间放行）。**不阻塞、无 Sleep**。handler=sub_41A0E0（raw 25214） |
| 0x1F6 | 0 |  | sub_41A130 | 已核对 | **清空绘制容器全部 4 张表**（`sub_4AB7A0(Scene)`；Scene = `_this[80708]`，字节 322832）+ 复位脏标志。这是引擎里**唯一**的整批清场；脚本侧删除只经 0x1F7/0x1FA。handler=sub_41A130（raw 25239） |
| 0x1F7 | 2 | detach-texture | sub_422BC0 | 已核对 | **纹理子系统方法**：读 op1=handle、op2=count，按 count 分派图形子系统（同一套容器：`sub_4AB950` 的 `_this+1032`(字节) 与 `sub_4ABB60` 的 `_this[258]`(DWORD 下标) 都是 byte 1032 = 同一 draw-item 容器）。`count≤1`→`sub_4AB950(handle)`：**移除该 handle 单图元**（`sub_459EA0` 找 + `sub_4A8AF0` std::map erase，置脏 `[46508]=1`；TITLE hover 回退用它删旧 normal）。`count>1`→`sub_4ABB60(handle,count)`：**按 handle 区间批量移除**——4 个容器 lower_bound `handle` 与 `handle+count`，对 `[begin,end)` 逐结点 `sub_4A8AF0`(erase，经 `sub_4AA1D0`/`sub_4AA330`/`sub_4AA3D0`)，并销毁 `+266/+267` 容器每项 record（vtable 删 `[1]` + `operator delete` `[2]/[3]/[4]`），置脏 `[11627]=1`。→ **删 handle∈[handle,handle+count) 的全部绘制项/网格**。SYSTEM4/LOGO/TITLE 开机大量用（count 2/3/4/6/0x19/0x64/0x12c/0x1f4，批量清特效段）。handler=sub_422BC0（raw .c 30717）。emulator：count≤1→`detachTexture` 删单；count>1→`detachTexture` 删 `[handle,handle+count)` 区间。旧 label `u00420270` |
| 0x1F8 | 4 | create-texture | sub_422C20 | 已核对 | **create-texture**：读 op1=槽、op2/3/4 → 先释放**该槽的 movie 播放器对象**（`_this[slot+94672]` = pool[13964+slot]，`sub_488FB0`+delete+置 0），再 `sub_4A2C10(Scene, slot, w, h, mode)` 建程序化纹理（`operator new(0x450)`+`sub_48AB20`）；失败抛「CTexture エラー：テクスチャ作成に失敗．TEXTURE=%d」。★建出来的是**一张空白离屏表面**（非文件图像）：`0x204` draw-string / `0x205` 数字文本就是往它上面画；`0x207` 在槽之间搬运它。★槽**重建 = 旧表面（含画上去的字）一起丢**。handler=sub_422C20（raw 31161） |
| 0x1F9 | 3 | set-texture | sub_422CB0 | 已核对 | **set-texture**（唯一绑定）：`op1=imgid, op2=slot, op3=color`。清空 slot 旧纹理对象（`sub_488FB0`+置0），`sub_4559C0` imgid→路径 + `sub_455560` 开文件 → `sub_4A3800(_this+322832, imgid, hFile, slot, color, 0)` 载入纹理（`[5*slot+466]=imgid`）；失败抛「画像ファイル %s の読み込みに失敗しました」。handler=sub_422CB0（raw .c 30769） |
| 0x1FA | 1 |  | sub_422E00 | 已核对 | **release-texture**：读 op1=slot，释放 `_this[slot+94672]` 纹理对象（`sub_488FB0`+delete+置0），`sub_49E980(slot)` 释放该槽（`[5*slot+466]=-1`）。handler=sub_422E00（raw .c 30822） |
| 0x1FB | 8 | draw-texture | sub_422E70 | 已核对 | **draw-texture**：**op1 = 图元 handle（= Scene map 的 key，同时是层序，越小越先画）**、**op2 = 纹理槽号**（存 DrawItem`+4`，渲染时 `Scene+4*slot+42456` 取 `CTexture*`）、op3/op4 = 源 x/y、op5/op6 = 源 w/h、op7/op8 目标位置。★**源矩形在元素里存成 left/top/right/bottom**：handler 先 `SetRect(&rc, op3, op4, op3+op5, op4+op6)`（raw 31287-31293）再 `sub_4ACE50(Scene, handle, slot, rc.left, rc.top, rc.right, rc.bottom, op7, op8, 0)`（raw 31299）→ 元素 `v13[2..5]` = `+8/+0xC/+0x10/+0x14`；所以**元素内"源宽" = `+0x10 − +8`**（flipbook 的格子尺寸就取这个，raw 117798）。Arity=17。handler=sub_422E70（raw 31271）。★2025 修正：op1 是 handle/key、op2 是纹理槽（旧文档把二者写反）；元素内部**不存 layer** |
| 0x1FC | 1 |  | sub_422F80 | 已核对 | **复位图元变换**：读 op1=handle → `sub_4AC470(Scene, handle)`：`sub_4AAA50` 保证项存在，并把该 DrawItem 的变换/动画字段复位（平移/旋转类清 0、缩放类置 1、`+104` 清 0）；返回值未写回操作数。handler=sub_422F80（raw .c 31303） |
| 0x1FD | 4 |  | sub_422FD0 | 已核对 | **绘制项「立即缩放」**（无动画窗；2D 唯一的"立刻设缩放"指令）：`op1`=handle、`op2/3/4` = sx/sy/sz（`sub_41C300(...) / dbl_5201F0`，**÷100** —— `dbl_5201F0 = 100.0`（raw 4430），脚本里 `64` = 100% = 1.0）→ `sub_4AC5F0`（raw 131333）：`sub_4AAA50` 缺失即建项 → `+0x68 = 1`（**用世界矩阵**）+ `D3DXMatrixScaling(元素+0x6C, …)`（缩放 **work** 矩阵）→ 置脏 `Scene+46508`。★渲染期用的就是这份 work 矩阵（`sub_49AA30` raw 117431 `qmemcpy(v118, a2+27, 64)`），故**立即生效**；写 target + 开窗的是 `0x21E`。★订正：旧文档记作「3D 缩放 / ÷256」，两处都错。handler=sub_422FD0（raw 31313） |
| 0x1FE | 5 |  | sub_423060 | 已核对 | **图元/纹理变换（4 浮点）**：读 op1=handle 与 op2..op5（float）→ `sub_4AC660(Scene, handle, f2, f3, f4, f5)`（内部未逐字段建模）。handler=sub_423060（raw .c 31330） |
| 0x1FF | 4 |  | sub_4230F0 | 已核对 | **DrawItem 像素平移**：`op1`=DrawItem id、`op2/op3/op4`=float x/y/z（**像素单位**，无 /100、无 /256）→ `sub_4AC750(Scene, id, x, y, z)`：`sub_4AAA50` 保证项存在 → DrawItem`+0x68 = 1`（**用世界矩阵**）→ `D3DXMatrixTranslation(元素+0x16C, x,y,z)` 写**平移 work 矩阵**，**立即生效、无动画窗**（与 0x220 写 target + 开窗不同）→ 置脏 `[11627]=1`。★对照 0x1FD：**平移用像素、缩放用百分数**（0x1FD 的 op2..op4 经 `/dbl_5201F0`）。handler=sub_4230F0（raw .c 31348） |
| 0x200 | 1 |  | sub_423170 | 仅映射 |  |
| 0x201 | 1 |  | sub_4302B0 | 已核对 | **配置 getter**：`op1 = Engine[166964]`。handler=sub_4302B0（raw .c 39859） |
| 0x202 | 5 | set-draw-color | sub_4231F0 | 已核对 | **set-draw-color**：读 op4=alpha（>255 clamp 255，<0 取当前色 `sub_4ADD60>>24`）、op5=color（<0 取当前色）、op2/op3 参数、op1=图元；组装 ARGB（`(color&0xFFFFFF) | ((alpha&0xFF)<<24)`）→ `sub_4AD0C0(Scene, handle, delay, dur, argb)`。引擎写入（raw 131957-131981）：**门控 `flags & 1`（元素必须已创建）** → `flags |= 2`（颜色动画启用）、`+0x34 = 0`（**全项共享的动画起点，此处清 0 表示"下一帧锁存"**）、`+0x38 = delay`、`+0x4C = dur`、`+0x64 = TO 色`；并置脏 `_this[11627]=1` 与图形池挂起 `_this[11629]=1`。**注意它不写 `+0x60`（工作色/FROM）** —— FROM 由 0x203 写。handler=sub_4231F0（raw .c 30951） | ★**逐帧求值器（2026 复核确证）**：在 `sub_49AA30` 内 raw 117434-117483 —— 由 DrawItem 渲染器 `sub_4AEEA0` 在 raw 133389 以 `a2 = 该 DrawItem` 调用（第 4 参 `COERCE_FLOAT(&v25)` 是**颜色变量的地址**，函数内 `v117 = a4`，插值结果写回 `*v117`），随后 raw 133443 把该值作 diffuse 交 `sub_4A2D50`。公式：`we = clock − start − delay`、`left = dur − we`、`ch = (left·from + we·to)/dur`（**整数截断**，通道序 B/G/R/A）；窗末 `+0x60 ← +0x64`、`+0x64 = NaN`、`+0x38/+0x4C` 清 0 并置 pending `Scene+46516`（raw 117844）。局部副本 raw 133447 `qmemcpy(元素, v26, 0x2E4)` **写回元素**。
| 0x203 | 4 | set-draw-color-alpha | sub_4232C0 | 已核对 | **set-draw-color-alpha**：读 op3=alpha（clamp/回退）、op4=color（回退），组装 ARGB → `sub_4ACF60(Scene, handle, op2, argb)`。引擎写入（raw 131871-131883）：`+0x30 = op2`（**混合模式**，0=默认）、`+0x60 = FROM 色（当前工作色）`；只置脏 `_this[11627]=1`（**不置挂起位、不清动画窗**）⇒ 可随时改工作色做 hover 高亮/回退，且正在跑的 0x202 窗会从新的 FROM 继续插值。handler=sub_4232C0（raw .c 30987） | ★该 FROM 就是颜色窗的插值起点：`sub_49AA30` 在窗内用 `(left·FROM + we·TO)/dur` 逐帧算 diffuse（raw 117470 写回调用方指针），所以 **0x203 可在窗内任意时刻改 FROM 并立即参与插值**。
| 0x204 | 4 | draw-string | sub_423390 | 已核对 | **draw-string（直绘，不入队）**：读 op1=纹理槽、op2=x、op3=y、op4=字符串 → `sub_456710(Font, op1, 串op4, op2, op3)`（raw 68470）。**三个门**（raw 68478-68480）：该槽的 `CTexture` 必须存在、vtable+32 可锁定、串非空 —— 否则整条**什么都不做**（不抛错）。落笔：按 `GetTextMetricsA` 的 ascent 定位（`Font+201680 == 1` 时再加 `Font+201712`），用当前字体（`Font+1084`）与全局颜色/描边（`Font+1360/+1364/+1372`）；带描边走 `sub_471180`，否则 `sub_46F2D0`。★**与消息窗文本是两条独立路径**（本指令不排版、不换行、不走窗）；`CONFIG1` 用它把每行"项目名 + 数值"写进 `create-texture 196 628 360` 出来的离屏槽，再按行裁贴到列表行上（`CONFIG1.txt:2760/2773` + `:3019-3022`）。handler=sub_423390（raw .c 31454） |
| 0x205 | 6 |  | sub_4233E0 | 已核对 | **消息子系统的 GDI 数字文本绘制**：`op1`=目标纹理槽、`op2`=x（in/out，`sub_4072F0` 会更新）、`op3`=y、`op4`=数值、`op5`=字段宽（字符数）、`op6`=格式标志（bit0x10000 全角、bit1 居中、bit2 左对齐、bit3 正数带 `+`）→ `sub_4072F0(_this, …, &x, 数值, 宽, 标志)` 把数值格式化成字符串，再 `sub_456710(_this+21324, 槽, 串, x, y)`（`GetTextMetricsA` 后写进 `*(Engine+21324+1040)+4*op1+42456` 的 1000 槽纹理表）。**旧注「仅映射」为误**。handler=sub_4233E0（raw .c 31470） |
| 0x206 | 7 |  | sub_41A160 | 仅映射 |  |
| 0x207 | 8 |  | sub_423480 | 已核对 | **纹理槽 → 纹理槽 的 StretchRect 拷贝**：`op1`=**源槽**、`op2`=**目标槽**（由错误串「コピー元/コピー先」判定，raw 5148-5149 + 123511/123520）；矩形语义是 **(x, y, w, h)**（内部 `R=x+w`、`B=y+h`，源与目标共用同一 w/h，raw 31506-31517）——★与 0x1FB 的「op3-6 源裁剪 / op7/8 目标位置」**不同构**。emulator 无 D3D 表面拷贝模型 → 真·忽略。handler=sub_423480（raw .c 31494） |
| 0x208 | 3 |  | sub_4302E0 | 已核对 | **纹理尺寸 getter（会写回脚本操作数）**：`op1`=纹理槽（合法 0..999）→ `sub_49ED60(Scene, slot, &w, &h)` 读该槽 `CTexture+1040`（宽）/`+1044`（高）→ 分别 **写回 op2 / op3**（`sub_42B4B0`）。★漏实现会让脚本拿到未初始化的宽高并引发**脚本层逻辑错误**（不只是画面问题）；槽越界/未创建时引擎写 0/0 且只记日志（`sub_4034C0`），**不改控制流**。handler=sub_4302E0（raw .c 39866；`sub_49ED60` raw 119774） |
| 0x209 | 5 |  | sub_423580 | 仅映射 |  |
| 0x20A | 1 |  | sub_423620 | 仅映射 |  |
| 0x20B | 7 |  | sub_423690 | 已核对 | **纯色+α 填充(渐变/压黑覆盖原语)**：读 op1=纹理、op2..op5=矩形(op4=op2+宽,op5=op3+高)、op6=α(>255 钳 255)、op7=颜色；`sub_4A4C70` 走纹素 vtable(+24) 填充。handler=sub_423690（raw .c 31569） |
| 0x20C | 0 |  | sub_41A1A0 | 已核对 | **绘图帧控制**：帧计时（timeGetTime 写 `_this[92333/92334]`）+ 调图形子系统 `sub_4B4040(_this+80708)`、`_this[168998]=0`。handler=sub_41A1A0（raw .c 25258）。方向：渲染/帧控制 |
| 0x20D | 1 |  | sub_423770 | 仅映射 |  |
| 0x20E | 0 |  | sub_41A200 | 已核对 | **图形提交**：`sub_498B60`(条件清 layer 0x26) → 本帧落到屏。handler=sub_41A200（raw .c 25063） |
| 0x20F | 3 |  | sub_4237B0 | 已核对 | **play-movie**：读 op1=movie资源id、op2=slot、op3=模式/音量；构造/复用 `[4*slot+378688]` movie 对象，`sub_454FA0` 取路径、`sub_488DC0` 装载（失败抛「…」）、`sub_489230` 绑定、`sub_4054D0` 求播放模式、`sub_408350` 求音量、`sub_4885A0` 设音量、`sub_4883A0` 启动；置 `_this[699204]\|=0x2000`、`_this[675972]=1`。handler=sub_4237B0（raw .c 31165） |
| 0x210 | 1 |  | sub_423980 | 仅映射 |  |
| 0x211 | 1 |  | sub_4239F0 | 仅映射 |  |
| 0x212 | 2 |  | sub_423A30 | 已核对 | **消息窗对象字段**：读 op1=对象下标、op2=值；`_this[op1+21585]` 对象非空则写其 `+100=op2`。handler=sub_423A30（raw .c 31299） |
| 0x213 | 3 |  | sub_423A80 | 已核对 | **消息窗对象字段**：读 op1=对象下标、op2/op3；对象非空写 `+104=op2`、`+108=op3`。handler=sub_423A80（raw .c 31314） |
| 0x214 | 2 |  | sub_423AE0 | 仅映射 |  |
| 0x215 | 2 |  | sub_430340 | 已核对 | **图形状态 getter**。handler=sub_430340（raw .c 39337） |
| 0x216 | 2 |  | sub_430380 | 已核对 | **纹理元数据 getter**：`_this[5*op2+81174]`。handler=sub_430380（raw .c 39351） |
| 0x217 | 4 |  | sub_423B20 | 已核对 | **绘制项「旋转/缩放中心 pivot」**：读 op1=handle、op2/3/4=3 float → DrawItem`+24/+28/+32`；绘制期 `sub_49AA30` 读 a2[6..8]（raw 117368），先 `T(-pivot)`（raw 117428，在缩放/旋转之前**最右乘**）后 `T(+pivot)`（raw 117932，最后**最右乘**）夹住 work 缩放/旋转/平移矩阵 ⇒ 世界旋转/缩放绕该点，**不改位置**。★★pivot 与描画位置（`0x219`）**同处一个坐标空间（都是绝对坐标）**：`sub_4A2D50` 把 `&v26[9]` 当目标位置交给纹理绘制（raw 133443 / 122974），故合成结果 = `v' = S·(v − pivot) + pivot`（v = 描画位置 + 局部偏移）⇒ 等价于"把项放在 pos、绕 pivot 缩放"。脚本里的实际用法：`CONFIG1.txt:2958-2962` 的滚动条拇指中段 `i217 <obj> <dstX> <dstY> 0`（pivot == 描画位置 ⇒ 以左上角为基准纵向拉伸）。handler=sub_423B20 → sub_4ACF20（raw 131857） |
| 0x218 | 4 |  | sub_4303C0 | 仅映射 |  |
| 0x219 | 4 |  | sub_423BA0 | 已核对 | **绘制项「描画位置 (x,y,z)」**：读 op1=handle、op2/3/4=3 float → DrawItem`+36/+40/+44`；绘制期 `sub_4AEEA0` 读 `&v26[9]` 交 `CTexture::Draw`（vtable+20）。★与 0x217 的 pivot 是**两个不同三元组**。handler=sub_423BA0 → sub_4ACEE0（raw 131843） |
| 0x21A | 4 |  | sub_430450 | 仅映射 |  |
| 0x21B | 1 |  | sub_423C20 | 已核对 | **引擎布尔标志**：读 op1，写 `_this[166965]=(op1!=0)`（成对读取方 sub_430810 回写操作数 1）。handler=sub_423C20（raw .c 31375） |
| 0x21C | 0 | wait | sub_41A260 | 已核对 | **每脚本引擎状态槽→0x400 动画等待**：读 cur，写 `_this[30*cur+95805]=1`、`_this[174801]\|=0x400`（版权页/淡入淡出的"等几秒"等待门）。handler=sub_41A260（raw .c 25043）。旧 label `u00416270` |
| 0x21D | 2 |  | sub_423C60 | 仅映射 |  |
| 0x21E | 6 |  | sub_423CA0 | 已核对 | **缩放动画窗（DrawItem 窗1）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4/5/6 = sx/sy/sz`（`sub_41C300(...) / dbl_5201F0`，**÷100** —— `dbl_5201F0 = 100.0`（raw 4430），脚本里 `64` = 100%）→ `sub_4AD170(Scene, handle, delay, dur, sx, sy, sz)`（raw 31846-31862）。引擎写入（raw 131984-132018）：门控 `flags & 1` → `|= 2`、`+0x34 = 0`（共享起点）、`+0x3C = delay`、`+0x50 = dur`、`+0x68(+104) = 1`、`D3DXMatrixScaling(元素+0xAC, sx,sy,sz)`（**目标**缩放矩阵；工作矩阵在 `+0x6C`）→ 置 `[11627]=1`、`[11629]=1`。★`dur` 是插值分母（ms）。★订正：旧文档写 `÷256`（把 `dbl_5201F0` 误记为 256.0）——它是 **100.0**，`0x12c`=300 ⇒ 3.0 倍。handler=sub_423CA0（raw .c 31846） |
| 0x21F | 7 |  | sub_423D40 | 已核对 | **旋转动画窗（DrawItem 窗2）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4/5/6 = 旋转轴 (x,y,z)`、`op7 = 角（度）` → `sub_4AD250(...)`（raw 31867-31885）。引擎写入（raw 132022-132075）：`|= 2`、`+0x34 = 0`、`+0x40 = delay`、`+0x54 = dur`、`+0x68 = 1`、轴存 `+0x1F8/+0x1FC/+0x200`、止角存 `+0x208`（起角在 `+0x204`），并 `D3DXMatrixRotationAxis(元素+0x12C, axis, θ·π/180)`（**目标**旋转矩阵）。度数→弧度换算常量 `dbl_526C98/dbl_5263F0`。handler=sub_423D40（raw .c 31867） |
| 0x220 | 6 |  | sub_423DE0 | 已核对 | **平移动画窗（DrawItem 窗3）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4/5/6 = 位移 (x,y,z)`（★**不除 256**，与 0x21E 不同）→ `sub_4AD3C0(...)`（raw 31889-31905）。引擎写入（raw 132081-132114）：`|= 2`、`+0x34 = 0`、`+0x44 = delay`、`+0x58 = dur`、`+0x68 = 1`、`D3DXMatrixTranslation(元素+0x1AC, x,y,z)`（**目标**平移矩阵）。handler=sub_423DE0（raw .c 31889） |
| 0x221 | 4 |  | sub_423E70 | 仅映射 |  |
| 0x222 | 2 |  | sub_423EC0 | 仅映射 |  |
| 0x223 | 8 |  | sub_423F00 | 仅映射 |  |
| 0x224 | 0 |  | sub_41A290 | 仅映射 |  |
| 0x225 | 2 |  | sub_423F80 | 仅映射 |  |
| 0x226 | 5 |  | sub_4304E0 | 仅映射 |  |
| 0x227 | 6 |  | sub_4305A0 | 仅映射 |  |
| 0x228 | 5 |  | sub_430650 | 仅映射 |  |
| 0x229 | 5 |  | sub_423FE0 | 已核对 | **绘制模式配置**：`sub_49A690/4AC/4AF0`。handler=sub_423FE0（raw .c 31502） |
| 0x22A | 3 |  | sub_424080 | 仅映射 |  |
| 0x22B | 4 |  | sub_424100 | 仅映射 |  |
| 0x22C | 3 |  | sub_424180 | 仅映射 |  |
| 0x22D | 5 |  | sub_4241F0 | 仅映射 |  |
| 0x22E | 6 |  | sub_424290 | 仅映射 |  |
| 0x22F | 5 |  | sub_424330 | 仅映射 |  |
| 0x230 | 1 |  | sub_4243B0 | 仅映射 |  |
| 0x231 | 4 |  | sub_4243F0 | 仅映射 |  |
| 0x232 | 4 |  | sub_424440 | 仅映射 |  |
| 0x233 | 5 |  | sub_424510 | 仅映射 |  |
| 0x234 | 5 |  | sub_4245B0 | 仅映射 |  |
| 0x235 | 5 |  | sub_424630 | 仅映射 |  |
| 0x236 | 4 |  | sub_4246B0 | 仅映射 |  |
| 0x237 | 2 |  | sub_424880 | 仅映射 |  |
| 0x238 | 1 |  | sub_4248C0 | 仅映射 |  |
| 0x239 | 6 |  | sub_424900 | 已核对 | **flipbook 动画窗（DrawItem 窗4）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4=总帧数`、`op5=每行列数`、`op6=标志` → `sub_4AD4A0(Scene, handle, delay, dur, frames, cols, flags)`（raw 32314-32331）。引擎写入（raw 132119-132145）：`|= 2`、`+0x34 = 0`、`+0x48 = delay`、`+0x5C = dur`、`+0x238 = frames`、`+0x23C = cols`、`+0x234 = flags`（**bit0 = 窗末保持末帧**）。★逐帧求值改的是**源矩形**而非 UV（raw 117797-117831）：`frame = frames·(clock−start−delay)/dur`、`col = frame % cols`、`row = frame / cols`，源矩形偏移 `(col·srcW, row·srcH)`；窗末 `flags&1` ⇒ 停在 `frames−1` 帧，否则复位到 draw-texture 给的源矩形。handler=sub_424900（raw .c 32315） |
| 0x23A | 2 |  | sub_4306F0 | 仅映射 |  |
| 0x23B | 7 |  | sub_424970 | 已核对 | **按 CG 数字条画数值**：`op1`=起始 DrawItem id、`op2`=CG 数字条记录号（0..0xA）、`op3`=数值、`op4/op5`=x/y 偏移、`op6`=位数、`op7`=对齐/补零标志（bit0 补前导零、bit1 居中、bit2 左对齐）。先 `sub_4ABB60(Scene, op1, op6)` **同时删 DrawItem(`Scene+1032`) 与 MeshEntry(`Scene+1064`) 的 `[op1, op1+op6)` 区间**（raw 130875/130909/130912-130971），再逐位 `sub_4ACE50(Scene, id, 记录[0], 源矩形, x, y, 0)` 建 DrawItem。记录 `rec`（Engine+388332+28*n）几何：`[0]` 纹理槽 / `[1]` x0 / `[2]` y0 / `[3]` 单字宽 / `[4]` 字高 / `[5]` 字内空隙 / `[6]` 字距；字源矩形 x = `rec[1] + (rec[3]+rec[5])·(value%10)`、右 = `+rec[3]`；y = `rec[2]`、下 = `+rec[4]`。三种 x（`k` 从 `op6−1` 递减到 0，同时 `value%=10` 取位 ⇒ **id = 个位、id+1 = 十位…自右向左**）：居中 `k·adv − adv·(last−数位+1)/2 + op4`、左对齐 `(数位−1−… )·adv + op4`、否则右对齐 `k·adv + op4`（`adv = rec[3]+rec[6]`）；前导零跳过，除非 `op7 & 1` 或是最高位那一轮。记录号非法或 `rec[0]==0` → 仅日志「CG番号…」。handler=sub_424970（raw .c 32335） |
| 0x23C | 0 |  | sub_41A2C0 | 已核对 | **帧毫秒时钟**（名字像空操作，其实是 `timeGetTime`）：`_this[92334] = _this[92333]; _this[92333] = timeGetTime();`（字节 369336 / 369332）。同一对字段在主循环里以同样两条赋值维护（raw 20750-20751，紧跟 `sub_4B4040` 渲染调用前），而 0x20C（`sub_41A1A0`）做同样的事**并追加渲染**（raw 25259）⇒ **0x23C = 只刷时钟、不渲染**。★与 0x1F4（停靠锁）不同：0x1F4 只在**未锁定**时刷时钟，0x23C 无条件刷（raw 25312-25315）。handler=sub_41A2C0（raw .c 25308） |
| 0x23D | 0 |  | sub_41A300 | 已核对 | **销毁 movie/纹理槽 42..999**（958 次）：对 `Engine+4*(94714+k)`（CMovieToTexture 族）调 `sub_488FB0`+vtable[0](obj,1) 析构，并对 Scene 调 `sub_49E980(Scene,i)` 卸槽 ⇒ 引用这些槽的图元不再绘制。handler=sub_41A300（raw 25320）。（旧注"停靠标志/纹理槽释放"为误） |
| 0x23E | 2 |  | sub_430750 | 仅映射 |  |
| 0x23F | 2 |  | sub_4307B0 | 仅映射 |  |
| 0x240 | 4 |  | sub_424DA0 | 仅映射 |  |
| 0x241 | 5 |  | sub_424FA0 | 仅映射 |  |
| 0x242 | 2 |  | sub_4251A0 | 仅映射 |  |
| 0x243 | 0 |  | sub_41B180 | 仅映射 |  |
| 0x244 | 0 |  | sub_41A370 | 仅映射 |  |
| 0x245 | 2 |  | sub_4251E0 | 仅映射 |  |
| 0x246 | 2 |  | sub_425250 | 仅映射 |  |
| 0x247 | 1 |  | sub_430810 | 已核对 | **读引擎布尔标志写回操作数**：`op1 = (Engine[166965] != 0)`（0/1）。与设置方 `0x21B`（sub_423C20）成对，构成脚本可读写的引擎级布尔寄存器；handler=sub_430810（raw .c 40034-40038） |
| 0x248 | 1 |  | sub_4252E0 | 已核对 | **模块静态配置**：读 op1 写全局 `dword_55052C`（默认 256，图像缩放/坐标换算的格子除数）。handler=sub_4252E0（raw .c 32228） |
| 0x249 | 3 |  | sub_425310 | 仅映射 |  |
| 0x24A | 3 |  | sub_430840 | 仅映射 |  |
| 0x24B | - |   | sub_425460 | 仅映射 |  |
| 0x24C | - |   | sub_425530 | 仅映射 |  |
| 0x24D | 12 |  | sub_4255E0 | 仅映射 |  |
| 0x24E | 1 |  | sub_4258C0 | 已核对 | **配置字段**：读 op1 写 `_this[92340]`。handler=sub_4258C0（raw .c 32958）。方向：配置字段 |
| 0x24F | 10 |  | sub_4258F0 | 仅映射 |  |
| 0x250 | 10 |  | sub_425980 | 仅映射 |  |
| 0x251 | 12 |  | sub_425A10 | 仅映射 |  |
| 0x252 | 1 |  | sub_425AB0 | 已核对 | **消息/系统配置字段**：读 op1 写 `_this[92323]`。handler=sub_425AB0（raw .c 32573） |
| 0x253 | 2 |  | sub_425AE0 | 仅映射 |  |
| 0x254 | 5 |  | sub_425B20 | 仅映射 |  |
| 0x255 | - |   | sub_425BC0 | 仅映射 |  |
| 0x256 | 5 |  | sub_425C30 | 仅映射 |  |
| 0x257 | 5 |  | sub_425CA0 | 仅映射 |  |
| 0x258 | 2 |  | sub_425D20 | 仅映射 |  |
| 0x259 | 0 |  | sub_41A3A0 | 已核对 | **清两张 1000×2 组 5-DWORD 槽记录表**（`Engine+86176` 起、步长 5 dword；主/影 +81176/+86176），每项写 +8/+12，共 4000 dword=16KB，**只清记录、不 delete 对象**。handler=sub_41A3A0（raw 25357）。（旧注"纹理槽释放"为误） |
| 0x25A | 1 |  | sub_425DB0 | 仅映射 |  |
| 0x25B | 1 |  | sub_425E20 | 已核对 | **图像资源加载（消息态）**：读 op1，置**模式** `_this[92379]=2`（1=影片 / 2=图像，同族 0x25A 用 92379=1 + 92380）、**图像 id** `_this[92381]=op1`；`_this[167990]==0`（全局「无渲染模式」开关）时调 `sub_408440` 加载（`sub_4A7210` ReadFrameTex → 渲染进固定帧纹理 `Scene+42452`），失败**抛 `Command_ShowMessage_Exception`「画像ファイル %s の読み込みに失敗しました」**（影响控制流）。★`sub_4A7210` 从不使用图像 id ⇒ `[推测]` op1 只用于消息态记录。emulator：真实现字段写入（92381=op1），不做图像解码（消息窗自绘）。handler=sub_425E20（raw .c 33206） |
| 0x25C | 8 |  | sub_425E70 | 仅映射 |  |
| 0x25D | 3 |  | sub_425EF0 | 已核对 | **消息列表对象字段**：读 op1/op2/op3；`_this[op1+21585]` 对象非空写 `+276=op2`、`+280=op3`。handler=sub_425EF0（raw .c 32753） |
| 0x25E | 5 |  | sub_425F50 | 仅映射 |  |
| 0x25F | 4 |  | sub_425FF0 | 仅映射 |  |
| 0x260 | 4 |  | sub_426080 | 已核对 | **消息窗配置字段×4**：读 op1..op4 写 `_this[80102]/[80103]/[80104]/[80105]`。handler=sub_426080（raw .c 32813） |
| 0x261 | 1 |  | sub_4260F0 | 已核对 | **消息窗配置字段**：读 op1 写 `_this[80101]`。handler=sub_4260F0（raw .c 32832） |
| 0x2BC | 11 |  | sub_426120 | 仅映射 |  |
| 0x2BD | 1 |  | sub_426200 | 已核对 | **文本对象字段+字体重建**：读 op1；`op1≠0` 时置文本对象字段 `_this[75953]`/`_this[21636]` 为 700（否则 0），调 `sub_459F40()` 应用/重建字体。handler=sub_426200（raw .c 32884） |
| 0x2BE | 1 |  | sub_426260 | 已核对 | **注音加粗**：读 op1；真 ⇒ `Font+218588 = 700` 且 `Font+1308 = 700`，假 ⇒ 两者 0；再 `sub_45A6E0(Font)` 重建注音字体句柄；handler=sub_426260（raw .c 33405-33422） |
| 0x2BF | 3 |  | sub_4262C0 | 仅映射 |  |
| 0x2C0 | 3 |  | sub_426310 | 仅映射 |  |
| 0x2C1 | 1 |  | sub_433CE0 | 仅映射 |  |
| 0x2C2 | 6 |  | sub_433DE0 | 仅映射 |  |
| 0x2C3 | 2 |  | sub_430890 | 仅映射 |  |
| 0x2C4 | 0 |  | sub_41A3F0 | 仅映射 |  |
| 0x2C5 | 2 | strlen | sub_430900 | 已核对 | **strlen**：`op1 = strlen(op2)`（`sub_41B640(2)` 读 op2 字符串 → `strlen` → `writeIntOperand_42B4B0(1)`）。handler=sub_430900（raw .c 40064），纯 |
| 0x2C6 | 2 |  | sub_430940 | 已核对 | **mbstrlen**：`setlocale(0, Locale)` 后 `op1 = _mbstrlen(串op2)`（多字节长度；与 `0x2C5` strlen 成对）。handler=sub_430940（raw .c 40074） |
| 0x2C7 | 4 |  | sub_433FD0 | 已核对 | **字符串处理**：读 op2 字符串（sub_41B640）+ op3/op4（strlen/长度约束），在字符串对象上做长度/索引类处理并写 op1。handler=sub_433FD0（raw .c 42259）。方向：字符串/查表 |
| 0x2C8 | 4 |  | sub_434260 | 仅映射 |  |
| 0x2C9 | 3 |  | sub_4344A0 | 仅映射 |  |
| 0x2CA | - |   | sub_430990 | 仅映射 |  |
| 0x2CB | - |   | sub_426360 | 仅映射 |  |
| 0x2CC | 1 |  | sub_4309E0 | 已核对 | **读配置**：`op1 = GetConfig("message:AdvanceMesOnWheel")`；handler=sub_4309E0（raw .c 40101-40107） |
| 0x2CD | 1 |  | sub_426390 | 已核对 | **SetConfig("message:AdvanceMesOnWheel", op1)**（只进配置注册表，不写任何 Engine 字段）；handler=sub_426390（raw .c 33464-33475） |
| 0x2CE | 1 |  | sub_430A20 | 已核对 | **显示模式 getter**：`op1 = (Engine[167990] != 0)`（由 `display:ScreenMode` 填充）。handler=sub_430A20（raw .c 40111） |
| 0x2CF | 1 |  | sub_4263D0 | 仅映射 |  |
| 0x2D0 | 3 |  | sub_430A50 | 已核对 | **浮点加**：写回 float `op1 = 浮点op2 + 浮点op3`。handler=sub_430A50（raw .c 40118） |
| 0x2D1 | 3 |  | sub_430AB0 | 已核对 | **浮点减**：写回 float `op1 = 浮点op2 - 浮点op3`。handler=sub_430AB0（raw .c 40129） |
| 0x2D2 | 3 |  | sub_430B10 | 已核对 | **浮点乘**：写回 float `op1 = 浮点op2 * 浮点op3`。handler=sub_430B10（raw .c 40140） |
| 0x2D3 | 3 |  | sub_430B70 | 已核对 | **浮点除**：写回 float `op1 = 浮点op2 / 浮点op3`。handler=sub_430B70（raw .c 40151） |
| 0x2D4 | 3 |  | sub_430BD0 | 已核对 | **浮点取余**：写回 float `op1 = fmod(浮点op2, 浮点op3)`。★argc 由 handler 体补全（旧表 `-`）：读 op2/op3、写 op1。handler=sub_430BD0（raw .c 40162） |
| 0x2D5 | 2 | float-mov | sub_430C30 | 已核对 | **float mov**：`op1 = op2`（`readFloatOperand(2)` → `writeFloatOperand(1)`）。handler=sub_430C30（raw .c 39455）。旧 label `u0042B990` |
| 0x2D6 | 2 |  | sub_430C70 | 已核对 | **整数→浮点**：写回 float `op1 = (float)整数op2`。★argc 由 handler 体补全（旧表 `-`）：读 op2、写 op1。handler=sub_430C70（raw .c 40186） |
| 0x2D7 | 2 |  | sub_430CB0 | 仅映射 |  |
| 0x2D8 | 3 | set-array-to | sub_430CF0 | 已核对 | `op1 起 count 个槽填 op2 值`（**脚本值 bulk 填充**；对比 copy-to-global 固定 0）：`v2=&op1; v5=ENC(op2); n=op3; memset32(v2,v5,n)`。handler=sub_430CF0（raw .c 40206） |
| 0x2D9 | 2 |  | sub_430D60 | 仅映射 |  |
| 0x2DA | 8 |  | sub_426420 | 已核对 | **CG 数字条记录登记**：`op1`=CG 番号（合法 0..0xA，越界只记日志不抛）+ `op2..op8` = **7 个 int** → 写进 `Engine+388332+28*cgno` 的 28 字节记录（`28*(n+13869)` 与 `4*97084+28*n` 是同一地址）。字段语义由消费方 0x23B 反推：`+0` 纹理槽 / `+4` x0 / `+8` y0 / `+12` 单字宽 / `+16` 字高 / `+20` 字内空隙 / `+24` 字距。★**是 7 个 dword（28 字节）**，旧文档「共 8 字段」把手写操作数 op1（编号）也算进去了。纯数据登记：不碰 Scene / 不置脏 / 不影响控制流。handler=sub_426420（raw .c 33498） |
| 0x2DB | 1 |  | sub_426500 | 已核对 | **文本对象字段+字体重建**：读 op1 写 `_this[71744]`，调 `sub_459F40()` 重建字体。handler=sub_426500（raw .c 33015） |
| 0x2DC | 1 |  | sub_430DB0 | 已核对 | **数组条数 getter**：`v1 = (Engine[71741] - Engine[71740]) >> 5`（32B/条，0 ⇒ -1）⇒ `op1 = v1`。handler=sub_430DB0（raw .c 40240） |
| 0x2DD | 2 |  | sub_434720 | 仅映射 |  |
| 0x2DE | 2 |  | sub_430DF0 | 已核对 | **字符串→索引查表**：`sub_41B640(2)` 读 op2 字符串 → `sub_428990(_this[50416] 表)` 查找（跳过前导 `@`，未命中=-1）→ `writeIntOperand_42B4B0(1, idx)` 写回 op1。handler=sub_430DF0（raw .c 39525） |
| 0x2DF | 3 |  | sub_430E30 | 仅映射 |  |
| 0x2E0 | 3 |  | sub_430EA0 | 仅映射 |  |
| 0x2E1 | 3 |  | sub_430F10 | 仅映射 |  |
| 0x2E2 | 3 |  | sub_430F80 | 仅映射 |  |
| 0x2E3 | 3 |  | sub_430FF0 | 仅映射 |  |
| 0x2E4 | 3 |  | sub_431060 | 仅映射 |  |
| 0x2E5 | 1 |  | sub_4310D0 | 仅映射 |  |
| 0x2E6 | 2 |  | sub_431110 | 已核对 | **读配置写操作数**：op1=0 ⇒ `message:AutoMessagePitch0`、1 ⇒ `AutoMessagePitch1` → **写 op2**；其它值报错；handler=sub_431110（raw .c 40353-40376） |
| 0x2E7 | 2 |  | sub_426540 | 已核对 | **设自动翻页每行附加时长**：读 op1=下标、op2=值；op1==1 ⇒ `SetConfig("message:AutoMessagePitch1", op2)`、0 ⇒ `…Pitch0`，其它值报错。`INITREGMES` 用 `i2e7 0 96` / `i2e7 1 96`（=150）；handler=sub_426540（raw .c 33534-33562） |
| 0x2E8 | 1 |  | sub_4265E0 | 已核对 | **SetConfig("message:AutoMessageOption", op1)**；handler=sub_4265E0（raw .c 33565-33577） |
| 0x2E9 | 1 |  | sub_426620 | 仅映射 |  |
| 0x2EA | 1 |  | sub_4311B0 | 已核对 | **读配置**：`op1 = GetConfig("message:AutoMessageOption")`；handler=sub_4311B0（raw .c 40380-40386） |
| 0x2EB | 1 |  | sub_434830 | 已核对 | **配置/版本字符串读取**：读 `set:GameVersion`（`_this[174405]` vtable+8）→ 组装字符串写 op1（sub_433310）。handler=sub_434830（raw .c 42574）。方向：配置/字符串 |
| 0x2EC | 2 |  | sub_4311F0 | 已核对 | **atoi**：`op1 = atoi(串op2)`（字符串→整数）。handler=sub_4311F0（raw .c 40390） |
| 0x2ED | - |   | sub_431230 | 仅映射 |  |
| 0x2EE | 1 |  | sub_426650 | 已核对 | **消息派发**：读 op1 写 `_this[80106]`，并经 `_this[174405]` 对象 vtable+12 以 `"message"`+op1 派发消息/自动消息。handler=sub_426650（raw .c 33078） |
| 0x2EF | 11 |  | sub_431270 | 仅映射 |  |
| 0x2F0 | 9 |  | sub_431460 | 仅映射 |  |
| 0x2F1 | 7 |  | sub_4316E0 | 仅映射 |  |
| 0x2F2 | 6 |  | sub_4318A0 | 仅映射 |  |
| 0x2F3 | 6 |  | sub_431A10 | 已核对 | **文本项记录查询（写回三个操作数）**：读 op4/op5/op6 → `sub_457A20(Font, &v8, &v7, &v6, op4, op5, op6)` ⇒ **写 op1 = `+20`、op2 = `+24`、op3 = `+28`**（未找到 -1/-1/0）；op5 = 起始下标、op6 = 选择器（匹配 `+32`，记录需含 `flags & 0x40000000`）。★订正：早期把这条的语义误记在 `0xAA` 上；handler=sub_431A10（raw .c 40724-40740） |
| 0x2F4 | 3 |  | sub_4266A0 | 仅映射 |  |
| 0x2F5 | 4 |  | sub_4267D0 | 仅映射 |  |
| 0x2F6 | 1 |  | sub_426820 | 已核对 | **声音通道管理**：读 op1=通道；写 `_this[30*cur+95805]=3`；`sub_4BB9F0(_this+21032, op1)` 重置通道（`sub_4B6390`），清通道字段；`sub_404CB0()` 找空闲通道存 `_this[122501]` 返回。handler=sub_426820（raw .c 33161） |
| 0x2F7 | 1 |  | sub_426890 | 仅映射 |  |
| 0x2F8 | 2 |  | sub_4268D0 | 已核对 | **设声音通道音量**：读 op1=通道、op2=音量；`sub_4B6940(op1+12, op2)` 钳制 ±10000 写 `_this[op1+12+375]` 并应用；通道越界报错。handler=sub_4268D0（raw .c 33188） |
| 0x2F9 | 7 |  | sub_431AA0 | 仅映射 |  |
| 0x2FA | 1 |  | sub_426910 | 仅映射 |  |
| 0x2FB | 1 |  | sub_431B60 | 仅映射 |  |
| 0x2FC | 5 |  | sub_431BA0 | 已核对 | **读 UI 触摸/触点**：`sub_477980` 从触摸事件缓冲（`Engine+6780`、条数 `Engine[6776]`、40B/项）取触点并 `ScreenToClient`；有触点写 op1=1/op2=X/op3=Y/op4=触点旗标/op5=项[3]，无触点写 op1=0。**PARTIAL**（缓冲填充来源未建模）；handler=sub_431BA0（raw .c 40776-40826） |
| 0x2FD | 6 |  | sub_431CF0 | 仅映射 |  |
| 0x2FE | 1 |  | sub_4332D0 | 已核对 | **set-font（校验列表）**：读 op1 字体名，调 `sub_432DD0(_this+21324, font)` 校验在可选字体列表中、拷字体名字段、`sub_45A6E0` 重建；不在列表则警告。handler=sub_4332D0（raw .c 41052） |
| 0x2FF | 2 |  | sub_426940 | 仅映射 |  |
| 0x300 | 3 |  | sub_426990 | 已核对 | **消息槽标志/取值**：读 op1=槽、op2=标志、op3=值 ⇒ `Engine[op1+122466] = op2 ｜ (旧值 & 0x10000)`（保留 bit16）、`Engine[op1+122476] = op3`；handler=sub_426990（raw .c 33743-33757） |
| 0x301 | 1 |  | sub_4269F0 | 已核对 | **清消息槽绘制项**：`Engine[op1+122486] = 0`，再 `sub_404F80(Font, op1)`：把窗对象 `+132`（显现游标）清 0，并按 id 区间删两组 DrawItem `[+104, +108)` 与 `[+276, +280)`；handler=sub_4269F0（raw .c 33759-33766） |
| 0x302 | 2 |  | sub_426A30 | 仅映射 |  |
| 0x303 | 3 |  | sub_426A90 | 已核对 | **UI/消息对象字段**：读 op1/op2/op3 调 `sub_456600(_this+21324, op1, op2, op3)`，对选中对象写 `+288=op2`、`+292=op3`。handler=sub_426A90（raw .c 33256） |
| 0x304 | 0 |  | sub_41A420 | 仅映射 |  |
| 0x305 | 0 |  | sub_41B1C0 | 仅映射 |  |
| 0x306 | 1 |  | sub_431FC0 | 已核对 | **纯配置 getter**：`op1 = GetConfig("system:EffectSkipOnClick")`（点击跳过特效开关；构造默认 1、配置文件可覆盖）。handler=sub_431FC0（raw 40948） |
| 0x307 | 1 |  | sub_426AE0 | 仅映射 |  |
| 0x308 | 1 |  | sub_426B20 | 已核对 | **输入触摸注册**：读 op1，调全局输入管理器 `sub_407B20(_this[96981], op1)`（LoadLibrary+GetProcAddress 注册/注销触摸），置 `_this[1954]`。handler=sub_426B20（raw .c 33282） |
| 0x309 | - |   | sub_432000 | 仅映射 |  |
| 0x30A | 2 |  | sub_426B60 | 已核对 | **SetGesKey**：读 op1=值、op2=索引；`op1>0x1F` 或 `op2>7` 抛 ShowMessage「SetGesKey」，否则写 `_this[op2+1969]=op1`。handler=sub_426B60（raw .c 33292） |
| 0x320 | 10 | create-mesh | sub_432150 | 已核对 | **顶点网格配置**：读 op1/9/10 及多操作数；`op9>0` 时申请缓冲、用 key `_this[388236]`（ROL11^XOR^ROR25）解码顶点，`sub_4ADFE0(_this+322832, obj, …)` 配置网格（顶点+索引+材质）；`op9≤0` 报「頂点数%dは不正です．」。fire-and-forget。handler=sub_432150（raw .c 40262）。旧 label `u0043AA20` |
| 0x321 | 3 |  | sub_426BD0 | 已核对 | **3D 网格元素属性写 setter**：`sub_4AE280` 把 `elem[op2+7] = op3`（op2 是字段选择子）→ 改 **3D 网格元素**（`Scene+1064` 表）的属性块（`+28 + 4·op2`）。★**本 op 原样写入、无 clamp 也无回退**（raw 33839-33850）；旧文档把它写成「op3<0 时回退取 `sub_4AE3C0(Scene,op1)>>24`」是**错的** —— 该回退逻辑属 **0x322（sub_426C20）/0x323（sub_426CF0）**（raw 33865-33884、33901-33917）。emulator：真·忽略（3D 网格属性无对应模型）。 |
| 0x322 | 4 |  | sub_426C20 | 已核对 | **set-vertex-color**：读 op1=网格id、op2/3/4；op3/op4 作颜色分量（clamp/回退），组装 32 位色 → `sub_4AE2C0(_this+80708, op1, op2, color)` 写网格顶点色。handler=sub_426C20（raw .c 33324） |
| 0x323 | 5 |  | sub_426CF0 | 已核对 | **set-vertex-color-alpha**：读 op1=网格id、op2/3/4/5；组装色（含 alpha）→ `sub_4AE330(_this+80708, op1, op2, op3, color)` 写网格顶点色+alpha。handler=sub_426CF0（raw .c 33358） |
| 0x324 | 0 |  | sub_41A470 | 已核对 | **消息/文本子系统方法**：取 `_this[93384]` 对象指针调外部弱符号 `sub_453530`（本文件无实现；fire-and-forget）。handler=sub_41A470（raw .c 25148） |
| 0x325 | 2 |  | sub_426DC0 | 仅映射 |  |
| 0x326 | 4 |  | sub_426E10 | 已核对 | **3D 特效雪花**：`sub_418340` 惰性建共享 `ID3DXEffect`（资源 ID 202，`Scene+46496`）并经 `sub_453330` 下发 (网格 op1, 参数 op3 浮点, op4, 纹理 op2)；**不做任何 RGBA 运算、不写元素色槽**。handler=sub_426E10（raw 33937） |
| 0x327 | 1 |  | sub_426E70 | 仅映射 |  |
| 0x328 | 3 |  | sub_432300 | 仅映射 |  |
| 0x329 | 2 |  | sub_426EB0 | 仅映射 |  |
| 0x32A | 1 |  | sub_426F80 | 仅映射 |  |
| 0x32B | 0 |  | sub_41A4A0 | 已核对 | **清 D3DX 网格层级槽表**（`Scene+50708` 区 1000 槽）：经 `sub_4A0750 → sub_479A50` + delete 逐项释放（与 0x23D、0x259 均不同族）。handler=sub_41A4A0（raw 25411）。TITLE.txt:800 与 0x1F6/0x23D 组成收尾序列 |
| 0x32C | 6 |  | sub_426FC0 | 仅映射 |  |
| 0x32D | 2 |  | sub_427040 | 仅映射 |  |
| 0x32E | 11 |  | sub_427110 | 仅映射 |  |
| 0x32F | 1 |  | sub_4272B0 | 已核对 | **D3D 灯光开关**：读 op1=**灯光索引 0..9** → `light_enabled[idx]=0`（Scene+54708+4·idx）+ 设备 vtable+212 = `IDirect3DDevice9::LightEnable(idx,FALSE)`；同族 `sub_49A080`=SetLight（vtable+204）。★op1 **不是**纹理槽/图元 id（旧注「网格项清除」为误）；★**无任何范围检查**（raw 116743 直接 `Scene+54708+4*op1`，越界即破坏 Scene 相邻数据）。handler=sub_4272B0（raw 34117） |
| 0x330 | 2 |  | sub_4272F0 | 仅映射 |  |
| 0x331 | - |   | sub_427330 | 仅映射 |  |
| 0x332 | 4 |  | sub_427380 | 仅映射 |  |
| 0x333 | - |   | sub_427450 | 仅映射 |  |
| 0x334 | 1 |  | sub_427520 | 仅映射 |  |
| 0x335 | 4 |  | sub_427560 | 仅映射 |  |
| 0x336 | - |   | sub_4275F0 | 仅映射 |  |
| 0x337 | 4 |  | sub_427680 | 仅映射 |  |
| 0x338 | - |   | sub_427700 | 仅映射 |  |
| 0x339 | - |   | sub_4277A0 | 仅映射 |  |
| 0x33A | - |   | sub_427840 | 仅映射 |  |
| 0x33B | 4 |  | sub_4278D0 | 仅映射 |  |
| 0x33C | - |   | sub_427950 | 仅映射 |  |
| 0x33D | 3 |  | sub_4279B0 | 仅映射 |  |
| 0x33E | 5 |  | sub_427A00 | 仅映射 |  |
| 0x33F | 3 |  | sub_427A90 | 仅映射 |  |
| 0x340 | 1 |  | sub_427B60 | 已核对 | **渲染状态下发**：写状态槽 `Scene+13948`（默认 3）并向设备 vtable+228 发 `(22, op1)`（渲染状态 #22，设备在 raw 122124 重放）。handler=sub_427B60 → sub_49A2D0（raw 116790） |
| 0x341 | 2 |  | sub_427BA0 | 已核对 | **Live2D 模型加载**：读 op1（文件名/资源 id）、op2 → `sub_4559C0(资源表, 主窗口, op1, &dwBytes)` 读文件进内存 → `sub_455560` 建句柄 → `sub_4A1860(Engine+322832, 资源表, op1, hFile, dwBytes, op2)`；失败 ⇒ `sub_455C60` 释放 + **抛异常**。**PARTIAL**（内部未建模；桩实现不得抛）。handler=sub_427BA0（raw .c 34461） |
| 0x342 | 1 |  | sub_427C70 | 已核对 | **销毁 Live2D 模型实例槽**：`objects[op1]`（`Scene+55812`+4·op1，**10 槽**）非空则 `sub_4785E0` 析构 + `operator delete` + 置 0。handler=sub_427C70 → sub_4A1A60（raw 121745）。（旧称"释放图形资源槽"为误） |
| 0x343 | - |   | sub_41A4E0 | 仅映射 |  |
| 0x344 | 2 |  | sub_427CB0 | 已核对 | **纹理槽变换记录**：读 op1=key、op2 → `sub_4AFBF0(Scene, op1, op2)`：在 `Scene+1096` 表建记录、记录[0]|=1、记录[1]=op2，并置脏 `Scene+46508`；记录[1] 用于索引 L2D 层。handler=sub_427CB0（raw 34507） |
| 0x345 | 3 |  | sub_427CF0 | 已核对 | **图形/3D 模型加载**（与 `0x341` 同族，多一个 op3）：读 op1/op2/op3 → `sub_4559C0` → `sub_455560` → `sub_4A1970(Engine+322832, 资源表, op1, hFile, dwBytes, op2, op3)`；返回值 != 1 ⇒ 释放 + **抛异常**。**PARTIAL**。handler=sub_427CF0（raw .c 34519） |
| 0x346 | 1 |  | sub_427DD0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：把全部变换复位为单位阵、+76 = 0；handler=sub_427DD0，raw .c 34557） |
| 0x347 | 4 |  | sub_427E10 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**缩放**，参数为**百分数 /100**；handler=sub_427E10，raw .c 34567） |
| 0x348 | 5 |  | sub_427EA0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：缩放 + 一个额外汇总参数；handler=sub_427EA0，raw .c 34584） |
| 0x349 | 4 |  | sub_427F30 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**平移，像素单位（无缩放）**；handler=sub_427F30，raw .c 34602） |
| 0x34A | 4 |  | sub_427FB0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：写 +8/+12/+16 基础平移偏移；handler=sub_427FB0，raw .c 34618） |
| 0x34B | 6 |  | sub_428030 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**缩放目标矩阵**（百分数 /100）+ 窗1 delay/dur = +32/+52，**置 pending**；handler=sub_428030，raw .c 34634） |
| 0x34C | 7 |  | sub_4280D0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**旋转目标矩阵** + 轴/角（度）+ 窗2 delay/dur = +36/+56，**置 pending**；handler=sub_4280D0，raw .c 34655） |
| 0x34D | 6 |  | sub_428170 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**平移目标矩阵**（像素）+ 窗3 delay/dur = +40/+60，**置 pending**；handler=sub_428170，raw .c 34677） |
| 0x34E | 4 |  | sub_428200 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**Live2D motion 加载**；可 no-op 但**实现不得抛异常**——引擎读文件失败会抛异常影响控制流；handler=sub_428200，raw .c 34697） |
| 0x34F | - |   | sub_428400 | 仅映射 |  |
| 0x350 | - |   | sub_4282E0 | 仅映射 |  |
| 0x351 | - |   | sub_428320 | 仅映射 |  |
| 0x352 | 3 |  | sub_4283B0 | 已核对 | **Live2D 槽参数设置**：读 op1=槽号(0..9)、op2、op3 → `sub_4A1AC0(Scene,…)`：`objects[op1]` 按 op2 选 `sub_478540`（置**待纹理 ID**：+24/+28）或 `sub_478560`（置**待动作 ID**：+25/+32）。handler=sub_4283B0（raw 34780） |

---

## 回退默认 `sub_418E30` 的 opcode（age-shared 已定义，本引擎未实现）

> 这些条目在 dispatch 表里**没有被覆盖**（`rep stosd` 填充后保持默认 `sub_418E30`），多为引擎家族其它作品的专属 opcode。

| opcode | argc | 名称 | 归属作品（age-shared 注释） |
|---|---|---|---|
| 0x262 | 1 |  | Amayui 2 |
| 0x263 | 1 |  | Amayui 2 |
| 0x264 | 5 |  | Hyakusen |
| 0x30C | 1 |  | Tenmei no Conquista |
| 0x353 | 2 |  | Fuukan no Gransesta |
| 0x354 | 2 |  | Fuukan no Gransesta |
| 0x358 | 5 |  | Amayui 2 |
| 0x35A | 5 |  | Amayui 2 |
| 0x35B | 2 |  | Fuukan no Gransesta |
| 0x35C | 2 |  | Fuukan no Gransesta |
| 0x35D | 3 |  | Fuukan no Gransesta |
| 0x35F | 3 |  | Fuukan no Gransesta |
| 0x360 | 3 |  | Fuukan no Gransesta |
| 0x361 | 2 |  | Fuukan no Gransesta |
| 0x363 | 3 |  | Amayui 2 |
| 0x364 | 3 |  | Amayui 2 |
| 0x384 | 3 |  | Tenmei no Conquista |
| 0x386 | 11 |  | Tenmei no Conquista |
| 0x387 | 8 |  | Tenmei no Conquista |
| 0x388 | 3 |  | Tenmei no Conquista |
| 0x389 | 6 |  | Tenmei no Conquista |
| 0x38F | 6 |  | Tenmei no Conquista |
| 0x390 | 7 |  | Tenmei no Conquista |
| 0x391 | 2 |  | Amayui 2 |
| 0x392 | 1 |  | Tenmei no Conquista |
| 0x393 | 6 |  | Amayui 2 |
| 0x396 | 5 |  | Tenmei no Conquista |
| 0x398 | 3 |  | Amayui 2 |
| 0x399 | 7 |  | Tenmei no Conquista |
| 0x39B | 5 |  | Amayui 2 |
