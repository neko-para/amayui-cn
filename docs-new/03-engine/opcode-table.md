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
> **信息源**：本工程的分析结论**唯一数据层** = `analysis/functions.json` + `analysis/fields.json`（数据驱动方案），原始只读基准 = `engine/天结_unpacked.exe_utf8.c`。`opcode-table.md` 只列**映射 / 语义**，分析结论以数据层为准。
>
> **参考**：`analysis/functions.json`、`analysis/fields.json`；报表工具 `.agents/skills/amayui-engine-analysis/scripts/report.js`（读数据层打印进度/字段清单）与 `sort-fields.js`（字段排序）。

## 全部 544 个已映射 opcode

| opcode | argc | 名称（age-shared） | 引擎位置（handler） | 分析状态 | 已知语义 |
|---|---|---|---|---|---|
| 0x1 | 0 | abort | sub_418E60 | 已核对 | **程序中止**：`_CxxThrowException(&1, Command_Exit)` —— 立即退出整个程序。handler=sub_418E60（raw .c 25682）。emulator：`op_abort` → 抛 `ExitScript`（程序退出信号）；渲染窗捕获后经 IPC `close-window` 关闭主窗口，headless(run.ts) 捕获后停执行 |
| 0x2 | 0 | exit | sub_41A820 | 已核对 | 跨脚本**返回调用层**（`cur=frame.caller`；顶层 caller<0 才程序退出）。handler=sub_41A820（raw .c 25629） |
| 0x3 | 1 | call-script | sub_41C6A0 | 已核对 | 读 operand1=目标脚本索引 → 压帧（cur++）+ 装载新脚本帧。handler=sub_41C6A0（raw .c 26762） |
| 0x4 | 2 |  | sub_41C770 | 仅映射 |  |
| 0x5 | 0 | ret | sub_41A9B0 | 已核对 | **同脚本**子程序返回（弹每帧返回栈 `256*cur+97193`；栈空 no-op）。handler=sub_41A9B0（raw .c 25704） |
| 0x6 | 2 |  | sub_41C7C0 | 已核对 | **load-script-into-frame**：`op1=目标脚本索引, op2=帧编号`。备份/恢复 `cur`（`_this[383104]`↔`_this[383108]`），把脚本 `op1` 解析并装入帧 `op2`（`loadScriptFrame_40ED40`）；`op2≥40` 抛 ShowMessage「ファイルの階層が深すぎます．最大は%dです．」、装载失败抛 Exit。SYSTEM4 帧布局初始化用。handler=sub_41C7C0（raw .c 26549） |
| 0x7 | 1 |  | sub_41C8D0 | 仅映射 |  |
| 0x8 | 1 |  | sub_41C900 | 仅映射 |  |
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
| 0x6E | 2 | show-text | sub_41EB20 | 仅映射 | 显示文本。未读体 |
| 0x6F | 1 | end-text-line | sub_41ECE0 | 仅映射 | 结束当前文本行。未读体 |
| 0x70 | 5 |  | sub_41ED20 | 已核对 | **消息窗口定位尺寸**：读 op1..op5 调 `sub_45D660(_this+21324, op1..op5, 0)` 设置文本消息窗口 x/y/宽/高坐标。fire-and-forget。handler=sub_41ED20（raw .c 28083） |
| 0x71 | 1 |  | sub_41ED80 | 已核对 | **显示消息/推进文本**：读 op1 文本调 `sub_45EC60(msgobj, op1, _this[97055])`，经 `sub_48E870`/`sub_48F000` 渲染；置 flag `_this[174801]\|=0x8000000`、`_this[122455]=1`、`_this[122496]=0`。handler=sub_41ED80（raw .c 28100） |
| 0x72 | 1 | wait-for-input | sub_41EEF0 | 仅映射 | 等待输入。未读体 |
| 0x73 | 10 |  | sub_41F250 | 已核对 | **消息窗口全面配置**：读 op1..9 调 `sub_456430(msgobj, op1..9)` 拷 0x28 字节几何/布局结构进消息窗，读 op10 调 `sub_453AD0` 置节流标量。fire-and-forget。handler=sub_41F250（raw .c 28280） |
| 0x74 | 1 |  | sub_41F320 | 仅映射 |  |
| 0x75 | 1 |  | sub_41F350 | 已核对 | **设消息窗宽/反向偏移**：读 op1 调 `sub_4185F0(msgobj, op1)` 写 `_this[201684]=op1; _this[1232]=-op1; _this[101972]=-op1` 等，再 `sub_459F40()` 刷文本布局。fire-and-forget。handler=sub_41F350（raw .c 28330） |
| 0x76 | 1 |  | sub_41F390 | 已核对 | **设消息窗滚动类属性**：读 op1，字节序翻转后写 `_this[21664]`，调 `sub_459F40()` 刷消息/文本布局。handler=sub_41F390（raw .c 28339） |
| 0x77 | 1 |  | sub_41F3F0 | 已核对 | **同 0x76**：读 op1 字节序翻转写 `_this[21665]`，调 `sub_459F40()` 刷布局。handler=sub_41F3F0（raw .c 28349） |
| 0x78 | 1 |  | sub_41F450 | 已核对 | **设消息窗属性并刷布局**：读 op1 写 `_this[21667]`，调消息/文本对象 `sub_459F40()`。handler=sub_41F450（raw .c 28359） |
| 0x79 | 3 |  | sub_41F490 | 已核对 | **消息项位置/尺寸参数**：读 op1..op3 调 `sub_4563A0(_this+21324, op1, op2, op3)`，把选中子项 `+28/+32` 两字段分别写 op3/op2。fire-and-forget。handler=sub_41F490（raw .c 28369） |
| 0x7A | 3 |  | sub_41F4E0 | 仅映射 |  |
| 0x7B | 2 |  | sub_41F530 | 仅映射 |  |
| 0x7C | 0 |  | sub_41AB80 | 仅映射 |  |
| 0x7D | 2 |  | sub_41F580 | 仅映射 |  |
| 0x7E | 1 |  | sub_41F630 | 仅映射 |  |
| 0x7F | 1 |  | sub_42D1F0 | 仅映射 |  |
| 0x80 | 1 |  | sub_41F690 | 已核对 | **设消息窗口(メッセージウィンドウ)字段 `_this[21631] = op1`**：读 op1，写入 `_this[21631]`（消息窗当前窗格/部件索引；读取点用 `_this[21631]` 及 `_this[21631+21585]` 取部件对象，见 raw 13712/25395/28567/30096）。属 `_this+21324` 消息窗一族（0x81 设 `_this[21666]` 颜色字、0x82 sub_466000 设窗格）。handler=sub_41F690（raw .c 28786）。CONFIG.txt 用 `i080 9/8/1` 切换消息窗格 |
| 0x81 | 1 |  | sub_41F6C0 | 仅映射 |  |
| 0x82 | 5 |  | sub_41F720 | 仅映射 |  |
| 0x83 | 3 |  | sub_42D220 | 仅映射 |  |
| 0x84 | 1 |  | sub_41F790 | 仅映射 |  |
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
| 0x90 | 7 |  | sub_420640 | 仅映射 |  |
| 0x91 | 1 |  | sub_420740 | 仅映射 |  |
| 0x92 | 2 |  | sub_4207D0 | 仅映射 |  |
| 0x93 | 0 |  | sub_4191D0 | 已核对 | **显示态切换**：`_this[174801]&=~0x800000`、`sub_403EF0`、toggle `_this[12957]/[12956]`。handler=sub_4191D0（raw .c 25044） |
| 0x94 | 0 |  | sub_419230 | 仅映射 |  |
| 0x95 | 2 |  | sub_420870 | 仅映射 |  |
| 0x96 | 0 |  | sub_419260 | 仅映射 |  |
| 0x97 | 5 |  | sub_420910 | 仅映射 |  |
| 0xA0 | 3 | jcc | sub_4209B0 | 已核对 | **两目标条件跳转**（仅 3 个操作数）：`op1=条件`（非 0 为真）；`op1≠0`→跳 `op2`（若 `op2==0xFFFFFFFF` 则落下句）；`op1==0`→跳 `op3`（若 `op3==0xFFFFFFFF` 则落下句）。 |
| 0xA1 | 0 |  | sub_433A40 | 已核对 | **菜单派发表复位**：`sub_415530(_this+107679, 0xFFF)`（0xFFF=容量/上限）。清空菜单对象 `_this+107679` 的内存表（字符串哈希表）。handler=sub_433A40（raw .c 42046）。emulator：`op_menu_reset` → `engine.menuMap.clear()` |
| 0xA2 | 2 |  | sub_434F10 | 已核对 | **登记菜单项 key→label**：读 op1(字符串键,sub_41B640)+op2(值,sub_41BF50) → `sub_434D00(_this+107679, key, &value)` 插入内存表。TITLE：`i0a2 (local40d) 44f / 0 452 / 1 481 / 2 4a3 / 3 52d / 4 540`。handler=sub_434F10（raw .c 42908）。emulator：`op_menu_bind` key=String(DEC(op1))、value=DEC(op2) → `menuMap.set(key,value)`（**注意**：引擎 sub_41B640 读 string；TITLE 用菜单项序号(-1/0/1/2/3/4)为键，emulator 取 op1 的 DEC 值字符串化） |
| 0xA3 | 2 |  | sub_429830 | 已核对 | **按 key 查表派发**：读 op1(字符串键,sub_41B640) → `sub_428E00(_this+107679, key)` 查；命中 `ip = str_table + 4*值`（跳转），未命中跳 op2(回退 label)。handler=sub_429830（raw .c 35742）。emulator：`op_menu_dispatch` key=String(DEC(op1))，target=menuMap.get(key) ?? DEC(op2)，`labelPos(target)` 命中则 `jump` |
| 0xAA | 2 |  | sub_42D580 | 仅映射 |  |
| 0xAB | 2 |  | sub_42D650 | 仅映射 |  |
| 0xAC | 9 |  | sub_42D700 | 仅映射 |  |
| 0xAD | 0 |  | sub_4192C0 | 仅映射 |  |
| 0xAE | 0 |  | sub_4192F0 | 已核对 | **存档版本分支指令**：经 `_this+174405` 对象 vtable 读存档版本（"set:SaveVersion1"/"set:SaveVersion2"），按版本(1/2/3/20)重算每脚本 ip（`_this[30*x+95782/95803/95804]`）、设 frame arity、切换 `cur` 或 `sub_40F750`→`loadScriptFrame_40ED40` 装载目标脚本帧；并置 `_this[95780]=0`、`_this[97054]=1`。handler=sub_4192F0（raw .c 24413） |
| 0xAF | 0 |  | sub_419690 | 仅映射 |  |
| 0xB0 | 1 |  | sub_420A50 | 仅映射 |  |
| 0xB1 | 1 |  | sub_420A80 | 仅映射 |  |
| 0xB2 | 2 |  | sub_420AB0 | 仅映射 |  |
| 0xB3 | 0 |  | sub_4196B0 | 仅映射 |  |
| 0xB4 | 2 | play-sound-effect | sub_420B00 | 仅映射 | 播放音效。未读体 |
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
| 0xBF | 1 | play-bgm | sub_420CC0 | 仅映射 | 播放 BGM。未读体 |
| 0xC0 | 1 |  | sub_42E510 | 已核对 | **读引擎字段 `_this[174713]`→op1**（`sub_42B4B0(_this,1,_this[174713])` = writeIntOperand 写 op1）。`174713` 是**音乐/声音子系统**字段（被 0xC3/sub_420F10 `_this[174713]=op1` 写；与 174712/174715 及 `_this+174454` 音乐对象同用，见 sub_408CF0 保存/恢复它）。handler=sub_42E510（raw .c 38618）。CONFIG.txt 用 `i0c0 (local-int 2)` 读系统值到 local |
| 0xC1 | 0 |  | sub_419770 | 仅映射 |  |
| 0xC2 | 2 |  | sub_420E00 | 仅映射 |  |
| 0xC3 | 1 |  | sub_420F10 | 仅映射 |  |
| 0xC4 | 1 | play-voice | sub_420F70 | 仅映射 | 播放语音。未读体 |
| 0xC5 | 2 |  | sub_42E540 | 仅映射 |  |
| 0xC6 | 2 |  | sub_421070 | 仅映射 |  |
| 0xC7 | 2 |  | sub_42E670 | 仅映射 |  |
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
| 0xFA | 0 |  | sub_4199B0 | 仅映射 |  |
| 0xFB | 2 | joy-callback | sub_421B80 | 已核对 | **注册手柄跳转目标**（非 `sub_453A60`！）：校验 op1∈[0,32)（越界抛 `set-keyjump`）、`_this[33*cur+107725+op1]=op2`（把手表）。`sub_419AF0`(0x100) 扫掩码最低位、按此表跳 label。handler=sub_421B80（raw .c 30400）。⚠️ 修正旧「sub_453A60(_this+107454, op1)」——该写法属 0xCE(sub_4219E0) |
| 0xFC | 0 |  | sub_419A70 | 仅映射 |  |
| 0xFD | 2 |  | sub_421C10 | 仅映射 |  |
| 0xFE | 1 |  | sub_421CA0 | 已核对 | **SetKeyTotal**：读 op1；若 `op1>0x1F` 抛 ShowMessage「SetKeyTotalの引数が不正です．」，否则写引擎字段 `_this[517]`。handler=sub_421CA0（raw .c 30046） |
| 0xFF | 0 |  | sub_419A90 | 仅映射 |  |
| 0x100 | 0 |  | sub_419AF0 | 已核对 | **消息跳读/按键推进派发**：`v2=_this[174802]`(输入掩码)；非 0→从 `_this[cur+122287]` 起扫最低按下位（上限 `_this[517]`=SetKeyTotal），push 推进量、查 `_this[33*cur+107725+bit]`，==-1 回退否则跳 `4*登记值`；掩码 0→检查默认键 `_this[517]`。handler=sub_419AF0（raw .c 25011） |
| 0x101 | 0 | poll-input | sub_419CC0 | 已核对 | **刷输入掩码并复位**：`sub_478090(_this+258,_this+174802)` 刷累计事件进掩码 → 清 `_this[174801]` 的 0x8000000 位 → `_this[174802]=0`、`_this[122367]=1`、`_this[122370]=0`。供同批 `check-bit`/位检查读，随即清零。handler=sub_419CC0（raw .c 25069）。旧 label `u00415BF0` |
| 0x102 | 3 |  | sub_421D00 | 仅映射 |  |
| 0x103 | 1 |  | sub_421DE0 | 仅映射 |  |
| 0x104 | 0 |  | sub_419D20 | 仅映射 |  |
| 0x105 | 1 |  | sub_421E20 | 仅映射 |  |
| 0x106 | 1 |  | sub_42ED90 | 仅映射 |  |
| 0x107 | 2 |  | sub_421E50 | 已核对 | **SetKey（按键绑定）**：读 op2=值、op1=键下标；`op1≤0x1F` 时写 `_this[551+op1]=op2`。handler=sub_421E50（raw .c 30114） |
| 0x108 | 1 |  | sub_42EDC0 | 已核对 | **读鼠标按钮值到 op1**：`sub_477220(_this+258,&v3)`（左=bit0/右=bit1，随 SM_SWAPBUTTON 互换）→ `sub_42B4B0(1,v3)`。handler=sub_42EDC0（raw .c 39047） |
| 0x109 | 2 |  | sub_42EE10 | 已核对 | **读鼠标位置到 op1=X,op2=Y**：`sub_4771D0`(GetCursorPos+ScreenToClient) → `sub_498350`(坐标变换)+`sub_403500`(虚拟显示映射，用 `_this[699168/699172]` 分辨率) → 写 op1/op2。(-100000,-100000)=未初始化。handler=sub_42EE10（raw .c 39057） |
| 0x10A | 2 |  | sub_421EA0 | 仅映射 |  |
| 0x10B | 2 |  | sub_422070 | 已核对 | **SetKey（另一按键表）**：读 op2=键下标、op1=值；`op1≤0x1F` 时写 `_this[op2+1383]=op1`。handler=sub_422070（raw .c 30200） |
| 0x10C | 2 |  | sub_4220B0 | 已核对 | **SetKeyMulti**：读 op1=值、op2=键索引；`op1>0x1F` 抛 ShowMessage「set-keymulti 引数不正」，否则写 `_this[_this[op2+1690]+1434]=op1`。handler=sub_4220B0（raw .c 30213） |
| 0x10D | 1 |  | sub_42EF50 | 仅映射 |  |
| 0x10E | 2 |  | sub_42EF90 | 仅映射 |  |
| 0x10F | 1 |  | sub_422120 | 已核对 | **引擎控制字段**：读 op1 写 `_this[122369]`。handler=sub_422120（raw .c 30232） |
| 0x12C | 5 | lookup-array-2d | sub_42EFD0 | 已核对 | **lookup-array-2d**（二维数组元素地址）：`v6=op3*op4+op5`（行×列宽+列），`operandAddress_42AEA0(2)` 取 op2 基址，`sub_418CC0(1, base, v6, -1, -1)` 把 `base+4*v6` 写入 op1 指针槽。handler=sub_42EFD0（raw .c 38462） |
| 0x12D | 7 |  | sub_42F040 | 仅映射 |  |
| 0x12E | 8 |  | sub_42F230 | 仅映射 |  |
| 0x12F | 4 |  | sub_42F560 | 仅映射 |  |
| 0x130 | 1 |  | sub_42F7A0 | 已核对 | **配置 getter**：`op1 = _this[96983]`（写回操作数 1；SYSTEM4 第 146 行据此判断是否 `call-script LOGO`）。handler=sub_42F7A0（raw .c 38662） |
| 0x131 | 1 |  | sub_42F7D0 | 仅映射 |  |
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
| 0x141 | 1 |  | sub_4228C0 | 仅映射 |  |
| 0x142 | 1 |  | sub_422930 | 仅映射 |  |
| 0x143 | 0 |  | sub_41A000 | 已核对 | **派发挂起脚本/事件请求**（dispatchScriptRequests）：置 `_this[124350]=1`，遍历 `_this+173106` 队列对每非零槽 `queueScript_40FC90(slot<<24)` 排队，`dispatchQueuedScripts_40FB60()` 派发；置 `_this[124350]=0`、`_this[30*cur+95805]=0`、`frames[cur].ip+=4`。handler=sub_41A000（raw .c 24928） |
| 0x144 | 2 |  | sub_433AB0 | 仅映射 |  |
| 0x145 | 1 |  | sub_42FCF0 | 仅映射 |  |
| 0x146 | 1 |  | sub_422960 | 仅映射 |  |
| 0x147 | 6 |  | sub_42FD60 | 仅映射 |  |
| 0x148 | 1 |  | sub_42FEC0 | 仅映射 |  |
| 0x149 | 1 |  | sub_4229A0 | 已核对 | **写全局槽**：读 op1 写 `_this[97058]`（全局数组槽，紧邻 key `_this[97059]`/`ENC(0)` `_this[97060]`）。handler=sub_4229A0（raw .c 30629） |
| 0x14A | 7 |  | sub_42FEF0 | 仅映射 |  |
| 0x14B | 1 |  | sub_4229D0 | 仅映射 |  |
| 0x14C | 2 | set-agerc-export | sub_422AB0 | 推测 | 绑定 agerc 导出。未读体 |
| 0x14D | 6 | call-agerc-export | sub_430170 | 推测 | 调用 agerc 导出。未读体 |
| 0x190 | 2 |  | sub_42D830 | 仅映射 |  |
| 0x191 | 2 |  | sub_42CEC0 | 仅映射 |  |
| 0x192 | 2 | set-string | sub_433660 | 已核对 | `op1 = op2`（**汉化核心指令**：把字符串 op2 赋给 op1 串槽。`sub_42A420(this,&buf,2)` 读 op2 字符串对象 → `sub_433310(this,1,buf)` 写入 op1）。handler=sub_433660（raw .c 41936） |
| 0x193 | 3 | concat | sub_433710 | 已核对 | `op1 = op2 + op3`（字符串拼接：`sub_42A420` 读 op3/op2 → `sub_42AA90` 拼接（**op2 在前**）→ `sub_433310` 写入 op1）。handler=sub_433710（raw .c 41952） |
| 0x194 | 3 |  | sub_42CF10 | 仅映射 |  |
| 0x195 | 3 |  | sub_42D010 | 仅映射 |  |
| 0x196 | 3 | display-furigana | sub_41FC20 | 推测 | 显示注音。未读体 |
| 0x197 | 1 |  | sub_41FDD0 | 已核对 | **配置显示/布局对象**：读 op1 调 `sub_418680(_this+21324, op1)`，写界面面板/窗口布局字段。fire-and-forget。handler=sub_41FDD0（raw .c 28775） |
| 0x198 | 3 |  | sub_41FE10 | 仅映射 |  |
| 0x199 | 0 |  | sub_418FC0 | 仅映射 |  |
| 0x19A | 1 |  | sub_42D290 | 仅映射 |  |
| 0x19B | 0 |  | sub_4190E0 | 已核对 | **退出消息/ADV**：清 `_this[174801]&~0x8000000`、`_this[1415]=0`。handler=sub_4190E0（raw .c 25031） |
| 0x19C | 0 |  | sub_419120 | 已核对 | **进入消息/ADV**：`_this[97051]=1`、`_this[174801]|=0x8000000`、`_this[122368]=1`。handler=sub_419120（raw .c 25076） |
| 0x19D | 2 |  | sub_42D8E0 | 仅映射 |  |
| 0x19E | 2 |  | sub_42D980 | 仅映射 |  |
| 0x19F | 2 |  | sub_42DB10 | 仅映射 |  |
| 0x1A0 | 9 |  | sub_42DC70 | 仅映射 |  |
| 0x1A1 | 2 |  | sub_42DDE0 | 仅映射 |  |
| 0x1A2 | 1 |  | sub_434F60 | 已核对 | **写引擎字符串→整型哈希表**：读 op1 得值+索引，`wsprintfA("%c%8.8x",3,idx)` 生成键，`sub_434D00(_this+5452, key, &val)` 插入（sub_429020 找槽、sub_40C210 存键）。handler=sub_434F60（raw .c 42140） |
| 0x1A3 | 1 | string-lookup-set | sub_42DF40 | 已核对 | **string-lookup-set**：`sub_418A30(1)` 读 op1 索引 → 键 `"%c%8.8x",3,idx` → `sub_428E00(key)` 全局字符串表查询（命中取 `*v3`、未命中=0）→ `writeIntOperand_42B4B0(1,val)` 写回 op1。（写操作数故 VM 可见）handler=sub_42DF40（raw .c 37793） |
| 0x1A4 | 2 |  | sub_41FE60 | 已核对 | **消息窗字段**：读 op1/op2 写 `_this[21670]/[21671]`。handler=sub_41FE60（raw .c 28797） |
| 0x1A5 | 1 | set-font | sub_433290 | 已核对 | **set-font**：读 op1 字符串，调 `sub_4328F0(_this+21324, str)` 设字体。fire-and-forget。handler=sub_433290（raw .c 41043） |
| 0x1A6 | 2 | halve-strlen | sub_42D110 | 已核对 | **halve-strlen**：`op1 = strlen(op2) >> 1`（`sub_41B640(2)` 读 op2 → `strlen` → `writeIntOperand_42B4B0(1, len>>1)`）。handler=sub_42D110（raw .c 37975），纯 |
| 0x1A7 | 1 | comment | sub_4191B0 | 已核对 | nop（dev 注释，无副作用） |
| 0x1A8 | 0 | dev_ukn | sub_419690 | 已核对 | nop（dev 未知指令，通常空实现） |
| 0x1A9 | 1 |  | sub_434FE0 | 已核对 | **写字符串哈希表**：`sub_42A420` 读 op1 字符串、`sub_418AE0(1)` 读值，键 `"%c%8.8x",5,val`，`sub_434E00(key, str)` 插入/更新（table 满 `sub_434AF0` 扩容）。handler=sub_434FE0（raw .c 42154） |
| 0x1AA | 1 |  | sub_433A70 | 仅映射 |  |
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
| 0x1B5 | 1 |  | sub_41FED0 | 仅映射 |  |
| 0x1B6 | 1 |  | sub_42D2C0 | 仅映射 |  |
| 0x1B7 | 1 |  | sub_41FF20 | 仅映射 |  |
| 0x1B8 | 2 |  | sub_42D2F0 | 仅映射 |  |
| 0x1B9 | 2 |  | sub_41FF60 | 仅映射 |  |
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
| 0x1C8 | 2 | toString | sub_433820 | 已核对 | **toString**：`op1 = str(op2)`（`readIntOperand(2)` 读整数 → `sprintf("%d")` → 组装 SSO 字符串 → `sub_433310(1)` 写 op1）。handler=sub_433820（raw .c 41990），纯 |
| 0x1C9 | 3 |  | sub_420160 | 仅映射 |  |
| 0x1CA | 1 |  | sub_420240 | 已核对 | **配置 set-message-read-texture**：读 op1，经 `_this[174405]` 消息子系统对象 vtable+12 以 `"message"`/`readtex`+op1 派发。handler=sub_420240（raw .c 28961） |
| 0x1CB | 1 |  | sub_42D3D0 | 仅映射 |  |
| 0x1CC | 1 |  | sub_42D410 | 仅映射 |  |
| 0x1CD | 2 |  | sub_42D1A0 | 仅映射 |  |
| 0x1CE | 1 |  | sub_420280 | 已核对 | **消息/UI 点击-跳读状态机**：读 op1；非0→`_this[174801]|=0x40000000`、`_this[107704]=0`、`sub_453A90(_this+430600)`(重置轮播计时器)；0→清 0x40000000。handler=sub_420280（raw .c 28974） |
| 0x1CF | 1 |  | sub_4213C0 | 已核对 | **消息跳读态**：写 `_this[122504]=op1`。handler=sub_4213C0（raw .c 29445） |
| 0x1D0 | 3 |  | sub_42D440 | 仅映射 |  |
| 0x1D1 | 5 |  | sub_420310 | 仅映射 |  |
| 0x1D2 | 2 |  | sub_420380 | 仅映射 |  |
| 0x1D3 | 5 |  | sub_42D4A0 | 仅映射 |  |
| 0x1D4 | 4 |  | sub_42D510 | 仅映射 |  |
| 0x1D5 | 0 |  | sub_419880 | 仅映射 |  |
| 0x1D6 | 2 |  | sub_42E7C0 | 仅映射 |  |
| 0x1D7 | 2 |  | sub_42E800 | 仅映射 |  |
| 0x1D8 | 3 |  | sub_42E850 | 仅映射 |  |
| 0x1D9 | 2 |  | sub_4213F0 | 仅映射 |  |
| 0x1F4 | 0 |  | sub_41A090 | 已核对 | **帧计时(等待底盘)**：`_this[107438]` 已置→`++_this[107439]`(累加帧计数)；否则 `_this[107438]=1`+`timeGetTime()` 写 `_this[92333]/[92334]`。handler=sub_41A090（raw .c 25194） |
| 0x1F5 | 0 |  | sub_41A0E0 | 已核对 | **帧倒计+派发(等待底盘)**：每帧递减 `_this[107439]`；到 0 清 `_this[107438]` 且 `_this[124350]==0` 时 `sub_40FB60()` 派发排队脚本(续跑)。handler=sub_41A0E0（raw .c 25215） |
| 0x1F6 | 0 |  | sub_41A130 | 已核对 | **清图形对象链**：`sub_4AB7A0`。handler=sub_41A130（raw .c 24986） |
| 0x1F7 | 2 | detach-texture | sub_422BC0 | 已核对 | **纹理子系统方法**：读 op1=handle、op2=count，按 count 分派图形子系统（同一套容器：`sub_4AB950` 的 `_this+1032`(字节) 与 `sub_4ABB60` 的 `_this[258]`(DWORD 下标) 都是 byte 1032 = 同一 draw-item 容器）。`count≤1`→`sub_4AB950(handle)`：**移除该 handle 单图元**（`sub_459EA0` 找 + `sub_4A8AF0` std::map erase，置脏 `[46508]=1`；TITLE hover 回退用它删旧 normal）。`count>1`→`sub_4ABB60(handle,count)`：**按 handle 区间批量移除**——4 个容器 lower_bound `handle` 与 `handle+count`，对 `[begin,end)` 逐结点 `sub_4A8AF0`(erase，经 `sub_4AA1D0`/`sub_4AA330`/`sub_4AA3D0`)，并销毁 `+266/+267` 容器每项 record（vtable 删 `[1]` + `operator delete` `[2]/[3]/[4]`），置脏 `[11627]=1`。→ **删 handle∈[handle,handle+count) 的全部绘制项/网格**。SYSTEM4/LOGO/TITLE 开机大量用（count 2/3/4/6/0x19/0x64/0x12c/0x1f4，批量清特效段）。handler=sub_422BC0（raw .c 30717）。emulator：count≤1→`detachTexture` 删单；count>1→`detachTexture` 删 `[handle,handle+count)` 区间。旧 label `u00420270` |
| 0x1F8 | 4 | create-texture | sub_422C20 | 已核对 | **create-texture**：读 op1=纹理槽、op2/3/4；先释放旧槽对象（`sub_488FB0`+vtable delete+置0），调 `sub_4A2C10(_this+80708, op1, op2, op3, op4)` 创建纹理；失败抛「CTexture エラー：テクスチャ作成に失敗」。fire-and-forget。handler=sub_422C20（raw .c 30739） |
| 0x1F9 | 3 | set-texture | sub_422CB0 | 已核对 | **set-texture**（唯一绑定）：`op1=imgid, op2=slot, op3=color`。清空 slot 旧纹理对象（`sub_488FB0`+置0），`sub_4559C0` imgid→路径 + `sub_455560` 开文件 → `sub_4A3800(_this+322832, imgid, hFile, slot, color, 0)` 载入纹理（`[5*slot+466]=imgid`）；失败抛「画像ファイル %s の読み込みに失敗しました」。handler=sub_422CB0（raw .c 30769） |
| 0x1FA | 1 |  | sub_422E00 | 已核对 | **release-texture**：读 op1=slot，释放 `_this[slot+94672]` 纹理对象（`sub_488FB0`+delete+置0），`sub_49E980(slot)` 释放该槽（`[5*slot+466]=-1`）。handler=sub_422E00（raw .c 30822） |
| 0x1FB | 8 | draw-texture | sub_422E70 | 已核对 | **draw-texture**（fire-and-forget 排队）：`op1=tex, op2=layer, op3=x, op4=y, op5=w, op6=h, op7=p, op8=q`。目标矩形 `(op3, op4, op3+op5, op4+op6)`（SetRect），p/q `(float)` 强转；`sub_4ACE50(_this+80708, tex, layer, x, y, x+w, y+h, p, q, 0.0)` 排绘制（置 `_this[11627]=1` 脏标记）。handler=sub_422E70（raw .c 30846） |
| 0x1FC | 1 |  | sub_422F80 | 仅映射 |  |
| 0x1FD | 4 |  | sub_422FD0 | 已核对 | **缩放变换**：`sub_4AC5F0` 设 3D 缩放矩阵(D3DXMatrixScaling/256 格除)。handler=sub_422FD0（raw .c 30886） |
| 0x1FE | 5 |  | sub_423060 | 仅映射 |  |
| 0x1FF | 4 |  | sub_4230F0 | 仅映射 |  |
| 0x200 | 1 |  | sub_423170 | 仅映射 |  |
| 0x201 | 1 |  | sub_4302B0 | 仅映射 |  |
| 0x202 | 5 |  | sub_4231F0 | 已核对 | **set-draw-color**：读 op4=alpha（>255 clamp 255，<0 取当前色 `sub_4ADD60>>24`）、op5=color（<0 取当前色）、op2/op3 参数、op1=图元；组装 ARGB → `sub_4AD0C0(_this+80708, op1, op2, op3, argb)`。handler=sub_4231F0（raw .c 30951） |
| 0x203 | 4 |  | sub_4232C0 | 已核对 | **set-draw-color-alpha**：读 op3=alpha（clamp/回退）、op4=color（回退），组装 ARGB → `sub_4ACF60(_this+80708, op1, op2, argb)`。handler=sub_4232C0（raw .c 30987） |
| 0x204 | 4 | draw-string | sub_423390 | 仅映射 | 绘制字符串。未读体 |
| 0x205 | 6 |  | sub_4233E0 | 仅映射 |  |
| 0x206 | 7 |  | sub_41A160 | 仅映射 |  |
| 0x207 | 8 |  | sub_423480 | 仅映射 |  |
| 0x208 | 3 |  | sub_4302E0 | 仅映射 |  |
| 0x209 | 5 |  | sub_423580 | 仅映射 |  |
| 0x20A | 1 |  | sub_423620 | 仅映射 |  |
| 0x20B | 7 |  | sub_423690 | 已核对 | **纯色+α 填充(渐变/压黑覆盖原语)**：读 op1=纹理、op2..op5=矩形(op4=op2+宽,op5=op3+高)、op6=α(>255 钳 255)、op7=颜色；`sub_4A4C70` 走纹素 vtable(+24) 填充。handler=sub_423690（raw .c 31569） |
| 0x20C | 0 |  | sub_41A1A0 | 仅映射 |  |
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
| 0x217 | 4 |  | sub_423B20 | 已核对 | **对象变换**：`sub_4ACF20` 设对象变换。handler=sub_423B20（raw .c 31101） |
| 0x218 | 4 |  | sub_4303C0 | 仅映射 |  |
| 0x219 | 4 |  | sub_423BA0 | 仅映射 |  |
| 0x21A | 4 |  | sub_430450 | 仅映射 |  |
| 0x21B | 1 |  | sub_423C20 | 已核对 | **引擎布尔标志**：读 op1，写 `_this[166965]=(op1!=0)`（成对读取方 sub_430810 回写操作数 1）。handler=sub_423C20（raw .c 31375） |
| 0x21C | 0 | wait | sub_41A260 | 已核对 | **每脚本引擎状态槽→0x400 动画等待**：读 cur，写 `_this[30*cur+95805]=1`、`_this[174801]\|=0x400`（版权页/淡入淡出的"等几秒"等待门）。handler=sub_41A260（raw .c 25043）。旧 label `u00416270` |
| 0x21D | 2 |  | sub_423C60 | 仅映射 |  |
| 0x21E | 6 |  | sub_423CA0 | 仅映射 |  |
| 0x21F | 7 |  | sub_423D40 | 仅映射 |  |
| 0x220 | 6 |  | sub_423DE0 | 仅映射 |  |
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
| 0x239 | 6 |  | sub_424900 | 仅映射 |  |
| 0x23A | 2 |  | sub_4306F0 | 仅映射 |  |
| 0x23B | 7 |  | sub_424970 | 仅映射 |  |
| 0x23C | 0 |  | sub_41A2C0 | 仅映射 |  |
| 0x23D | 0 |  | sub_41A300 | 已核对 | **释放纹理槽**：释放 42..999。handler=sub_41A300（raw .c 25099） |
| 0x23E | 2 |  | sub_430750 | 仅映射 |  |
| 0x23F | 2 |  | sub_4307B0 | 仅映射 |  |
| 0x240 | 4 |  | sub_424DA0 | 仅映射 |  |
| 0x241 | 5 |  | sub_424FA0 | 仅映射 |  |
| 0x242 | 2 |  | sub_4251A0 | 仅映射 |  |
| 0x243 | 0 |  | sub_41B180 | 仅映射 |  |
| 0x244 | 0 |  | sub_41A370 | 仅映射 |  |
| 0x245 | 2 |  | sub_4251E0 | 仅映射 |  |
| 0x246 | 2 |  | sub_425250 | 仅映射 |  |
| 0x247 | 1 |  | sub_430810 | 仅映射 |  |
| 0x248 | 1 |  | sub_4252E0 | 已核对 | **模块静态配置**：读 op1 写全局 `dword_55052C`（默认 256，图像缩放/坐标换算的格子除数）。handler=sub_4252E0（raw .c 32228） |
| 0x249 | 3 |  | sub_425310 | 仅映射 |  |
| 0x24A | 3 |  | sub_430840 | 仅映射 |  |
| 0x24B | - |   | sub_425460 | 仅映射 |  |
| 0x24C | - |   | sub_425530 | 仅映射 |  |
| 0x24D | 12 |  | sub_4255E0 | 仅映射 |  |
| 0x24E | 1 |  | sub_4258C0 | 仅映射 |  |
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
| 0x259 | 0 |  | sub_41A3A0 | 已核对 | **清纹理元数据**：清纹理槽元数据数组。handler=sub_41A3A0（raw .c 25127） |
| 0x25A | 1 |  | sub_425DB0 | 仅映射 |  |
| 0x25B | 1 |  | sub_425E20 | 已核对 | **图像资源加载（消息态）**：读 op1，置 `_this[92379]=2`、`_this[92381]=op1`；标志 `_this[167990]==0` 时调 `sub_408440` 加载图像（失败抛「画像ファイル %s…」）。handler=sub_425E20（raw .c 32713） |
| 0x25C | 8 |  | sub_425E70 | 仅映射 |  |
| 0x25D | 3 |  | sub_425EF0 | 已核对 | **消息列表对象字段**：读 op1/op2/op3；`_this[op1+21585]` 对象非空写 `+276=op2`、`+280=op3`。handler=sub_425EF0（raw .c 32753） |
| 0x25E | 5 |  | sub_425F50 | 仅映射 |  |
| 0x25F | 4 |  | sub_425FF0 | 仅映射 |  |
| 0x260 | 4 |  | sub_426080 | 已核对 | **消息窗配置字段×4**：读 op1..op4 写 `_this[80102]/[80103]/[80104]/[80105]`。handler=sub_426080（raw .c 32813） |
| 0x261 | 1 |  | sub_4260F0 | 已核对 | **消息窗配置字段**：读 op1 写 `_this[80101]`。handler=sub_4260F0（raw .c 32832） |
| 0x2BC | 11 |  | sub_426120 | 仅映射 |  |
| 0x2BD | 1 |  | sub_426200 | 已核对 | **文本对象字段+字体重建**：读 op1；`op1≠0` 时置文本对象字段 `_this[75953]`/`_this[21636]` 为 700（否则 0），调 `sub_459F40()` 应用/重建字体。handler=sub_426200（raw .c 32884） |
| 0x2BE | 1 |  | sub_426260 | 仅映射 |  |
| 0x2BF | 3 |  | sub_4262C0 | 仅映射 |  |
| 0x2C0 | 3 |  | sub_426310 | 仅映射 |  |
| 0x2C1 | 1 |  | sub_433CE0 | 仅映射 |  |
| 0x2C2 | 6 |  | sub_433DE0 | 仅映射 |  |
| 0x2C3 | 2 |  | sub_430890 | 仅映射 |  |
| 0x2C4 | 0 |  | sub_41A3F0 | 仅映射 |  |
| 0x2C5 | 2 | strlen | sub_430900 | 已核对 | **strlen**：`op1 = strlen(op2)`（`sub_41B640(2)` 读 op2 字符串 → `strlen` → `writeIntOperand_42B4B0(1)`）。handler=sub_430900（raw .c 40064），纯 |
| 0x2C6 | 2 |  | sub_430940 | 仅映射 |  |
| 0x2C7 | 4 |  | sub_433FD0 | 仅映射 |  |
| 0x2C8 | 4 |  | sub_434260 | 仅映射 |  |
| 0x2C9 | 3 |  | sub_4344A0 | 仅映射 |  |
| 0x2CA | - |   | sub_430990 | 仅映射 |  |
| 0x2CB | - |   | sub_426360 | 仅映射 |  |
| 0x2CC | 1 |  | sub_4309E0 | 仅映射 |  |
| 0x2CD | 1 |  | sub_426390 | 仅映射 |  |
| 0x2CE | 1 |  | sub_430A20 | 仅映射 |  |
| 0x2CF | 1 |  | sub_4263D0 | 仅映射 |  |
| 0x2D0 | 3 |  | sub_430A50 | 仅映射 |  |
| 0x2D1 | 3 |  | sub_430AB0 | 仅映射 |  |
| 0x2D2 | 3 |  | sub_430B10 | 仅映射 |  |
| 0x2D3 | 3 |  | sub_430B70 | 仅映射 |  |
| 0x2D4 | - |   | sub_430BD0 | 仅映射 |  |
| 0x2D5 | 2 | float-mov | sub_430C30 | 已核对 | **float mov**：`op1 = op2`（`readFloatOperand(2)` → `writeFloatOperand(1)`）。handler=sub_430C30（raw .c 39455）。旧 label `u0042B990` |
| 0x2D6 | - |   | sub_430C70 | 仅映射 |  |
| 0x2D7 | 2 |  | sub_430CB0 | 仅映射 |  |
| 0x2D8 | 3 | set-array-to | sub_430CF0 | 已核对 | `op1 起 count 个槽填 op2 值`（**脚本值 bulk 填充**；对比 copy-to-global 固定 0）：`v2=&op1; v5=ENC(op2); n=op3; memset32(v2,v5,n)`。handler=sub_430CF0（raw .c 40206） |
| 0x2D9 | 2 |  | sub_430D60 | 仅映射 |  |
| 0x2DA | 8 |  | sub_426420 | 仅映射 |  |
| 0x2DB | 1 |  | sub_426500 | 已核对 | **文本对象字段+字体重建**：读 op1 写 `_this[71744]`，调 `sub_459F40()` 重建字体。handler=sub_426500（raw .c 33015） |
| 0x2DC | 1 |  | sub_430DB0 | 仅映射 |  |
| 0x2DD | 2 |  | sub_434720 | 仅映射 |  |
| 0x2DE | 2 |  | sub_430DF0 | 已核对 | **字符串→索引查表**：`sub_41B640(2)` 读 op2 字符串 → `sub_428990(_this[50416] 表)` 查找（跳过前导 `@`，未命中=-1）→ `writeIntOperand_42B4B0(1, idx)` 写回 op1。handler=sub_430DF0（raw .c 39525） |
| 0x2DF | 3 |  | sub_430E30 | 仅映射 |  |
| 0x2E0 | 3 |  | sub_430EA0 | 仅映射 |  |
| 0x2E1 | 3 |  | sub_430F10 | 仅映射 |  |
| 0x2E2 | 3 |  | sub_430F80 | 仅映射 |  |
| 0x2E3 | 3 |  | sub_430FF0 | 仅映射 |  |
| 0x2E4 | 3 |  | sub_431060 | 仅映射 |  |
| 0x2E5 | 1 |  | sub_4310D0 | 仅映射 |  |
| 0x2E6 | 2 |  | sub_431110 | 仅映射 |  |
| 0x2E7 | 2 |  | sub_426540 | 仅映射 |  |
| 0x2E8 | 1 |  | sub_4265E0 | 仅映射 |  |
| 0x2E9 | 1 |  | sub_426620 | 仅映射 |  |
| 0x2EA | 1 |  | sub_4311B0 | 仅映射 |  |
| 0x2EB | 1 |  | sub_434830 | 仅映射 |  |
| 0x2EC | 2 |  | sub_4311F0 | 仅映射 |  |
| 0x2ED | - |   | sub_431230 | 仅映射 |  |
| 0x2EE | 1 |  | sub_426650 | 已核对 | **消息派发**：读 op1 写 `_this[80106]`，并经 `_this[174405]` 对象 vtable+12 以 `"message"`+op1 派发消息/自动消息。handler=sub_426650（raw .c 33078） |
| 0x2EF | 11 |  | sub_431270 | 仅映射 |  |
| 0x2F0 | 9 |  | sub_431460 | 仅映射 |  |
| 0x2F1 | 7 |  | sub_4316E0 | 仅映射 |  |
| 0x2F2 | 6 |  | sub_4318A0 | 仅映射 |  |
| 0x2F3 | 6 |  | sub_431A10 | 仅映射 |  |
| 0x2F4 | 3 |  | sub_4266A0 | 仅映射 |  |
| 0x2F5 | 4 |  | sub_4267D0 | 仅映射 |  |
| 0x2F6 | 1 |  | sub_426820 | 已核对 | **声音通道管理**：读 op1=通道；写 `_this[30*cur+95805]=3`；`sub_4BB9F0(_this+21032, op1)` 重置通道（`sub_4B6390`），清通道字段；`sub_404CB0()` 找空闲通道存 `_this[122501]` 返回。handler=sub_426820（raw .c 33161） |
| 0x2F7 | 1 |  | sub_426890 | 仅映射 |  |
| 0x2F8 | 2 |  | sub_4268D0 | 已核对 | **设声音通道音量**：读 op1=通道、op2=音量；`sub_4B6940(op1+12, op2)` 钳制 ±10000 写 `_this[op1+12+375]` 并应用；通道越界报错。handler=sub_4268D0（raw .c 33188） |
| 0x2F9 | 7 |  | sub_431AA0 | 仅映射 |  |
| 0x2FA | 1 |  | sub_426910 | 仅映射 |  |
| 0x2FB | 1 |  | sub_431B60 | 仅映射 |  |
| 0x2FC | 5 |  | sub_431BA0 | 仅映射 |  |
| 0x2FD | 6 |  | sub_431CF0 | 仅映射 |  |
| 0x2FE | 1 |  | sub_4332D0 | 已核对 | **set-font（校验列表）**：读 op1 字体名，调 `sub_432DD0(_this+21324, font)` 校验在可选字体列表中、拷字体名字段、`sub_45A6E0` 重建；不在列表则警告。handler=sub_4332D0（raw .c 41052） |
| 0x2FF | 2 |  | sub_426940 | 仅映射 |  |
| 0x300 | 3 |  | sub_426990 | 仅映射 |  |
| 0x301 | 1 |  | sub_4269F0 | 仅映射 |  |
| 0x302 | 2 |  | sub_426A30 | 仅映射 |  |
| 0x303 | 3 |  | sub_426A90 | 已核对 | **UI/消息对象字段**：读 op1/op2/op3 调 `sub_456600(_this+21324, op1, op2, op3)`，对选中对象写 `+288=op2`、`+292=op3`。handler=sub_426A90（raw .c 33256） |
| 0x304 | 0 |  | sub_41A420 | 仅映射 |  |
| 0x305 | 0 |  | sub_41B1C0 | 仅映射 |  |
| 0x306 | 1 |  | sub_431FC0 | 仅映射 |  |
| 0x307 | 1 |  | sub_426AE0 | 仅映射 |  |
| 0x308 | 1 |  | sub_426B20 | 已核对 | **输入触摸注册**：读 op1，调全局输入管理器 `sub_407B20(_this[96981], op1)`（LoadLibrary+GetProcAddress 注册/注销触摸），置 `_this[1954]`。handler=sub_426B20（raw .c 33282） |
| 0x309 | - |   | sub_432000 | 仅映射 |  |
| 0x30A | 2 |  | sub_426B60 | 已核对 | **SetGesKey**：读 op1=值、op2=索引；`op1>0x1F` 或 `op2>7` 抛 ShowMessage「SetGesKey」，否则写 `_this[op2+1969]=op1`。handler=sub_426B60（raw .c 33292） |
| 0x320 | 10 | create-mesh | sub_432150 | 已核对 | **顶点网格配置**：读 op1/9/10 及多操作数；`op9>0` 时申请缓冲、用 key `_this[388236]`（ROL11^XOR^ROR25）解码顶点，`sub_4ADFE0(_this+322832, obj, …)` 配置网格（顶点+索引+材质）；`op9≤0` 报「頂点数%dは不正です．」。fire-and-forget。handler=sub_432150（raw .c 40262）。旧 label `u0043AA20` |
| 0x321 | 3 |  | sub_426BD0 | 仅映射 |  |
| 0x322 | 4 |  | sub_426C20 | 已核对 | **set-vertex-color**：读 op1=网格id、op2/3/4；op3/op4 作颜色分量（clamp/回退），组装 32 位色 → `sub_4AE2C0(_this+80708, op1, op2, color)` 写网格顶点色。handler=sub_426C20（raw .c 33324） |
| 0x323 | 5 |  | sub_426CF0 | 已核对 | **set-vertex-color-alpha**：读 op1=网格id、op2/3/4/5；组装色（含 alpha）→ `sub_4AE330(_this+80708, op1, op2, op3, color)` 写网格顶点色+alpha。handler=sub_426CF0（raw .c 33358） |
| 0x324 | 0 |  | sub_41A470 | 已核对 | **消息/文本子系统方法**：取 `_this[93384]` 对象指针调外部弱符号 `sub_453530`（本文件无实现；fire-and-forget）。handler=sub_41A470（raw .c 25148） |
| 0x325 | 2 |  | sub_426DC0 | 仅映射 |  |
| 0x326 | 4 |  | sub_426E10 | 仅映射 |  |
| 0x327 | 1 |  | sub_426E70 | 仅映射 |  |
| 0x328 | 3 |  | sub_432300 | 仅映射 |  |
| 0x329 | 2 |  | sub_426EB0 | 仅映射 |  |
| 0x32A | 1 |  | sub_426F80 | 仅映射 |  |
| 0x32B | 0 |  | sub_41A4A0 | 仅映射 |  |
| 0x32C | 6 |  | sub_426FC0 | 仅映射 |  |
| 0x32D | 2 |  | sub_427040 | 仅映射 |  |
| 0x32E | 11 |  | sub_427110 | 仅映射 |  |
| 0x32F | 1 |  | sub_4272B0 | 已核对 | **网格项清除**：读 op1 调 `sub_49A150(_this+80708, op1)` 清 `_this[op1+13677]=0` 并 vtable+212 方法触发图形副作用。handler=sub_4272B0（raw .c 33579） |
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
| 0x340 | 1 |  | sub_427B60 | 仅映射 |  |
| 0x341 | 2 |  | sub_427BA0 | 仅映射 |  |
| 0x342 | 1 |  | sub_427C70 | 仅映射 |  |
| 0x343 | - |   | sub_41A4E0 | 仅映射 |  |
| 0x344 | 2 |  | sub_427CB0 | 仅映射 |  |
| 0x345 | 3 |  | sub_427CF0 | 仅映射 |  |
| 0x346 | - |   | sub_427DD0 | 仅映射 |  |
| 0x347 | - |   | sub_427E10 | 仅映射 |  |
| 0x348 | - |   | sub_427EA0 | 仅映射 |  |
| 0x349 | 4 |  | sub_427F30 | 仅映射 |  |
| 0x34A | - |   | sub_427FB0 | 仅映射 |  |
| 0x34B | - |   | sub_428030 | 仅映射 |  |
| 0x34C | - |   | sub_4280D0 | 仅映射 |  |
| 0x34D | 6 |  | sub_428170 | 仅映射 |  |
| 0x34E | 4 |  | sub_428200 | 仅映射 |  |
| 0x34F | - |   | sub_428400 | 仅映射 |  |
| 0x350 | - |   | sub_4282E0 | 仅映射 |  |
| 0x351 | - |   | sub_428320 | 仅映射 |  |
| 0x352 | 3 |  | sub_4283B0 | 仅映射 |  |

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
