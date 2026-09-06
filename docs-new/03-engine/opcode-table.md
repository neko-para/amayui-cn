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
> **效果相关指令已语义化命名**（版权页/淡入淡出等）：`create-mesh`(0x320)、`set-vertex-color`(0x322)、`set-vertex-color-alpha`(0x323)、`set-draw-color`(0x202)、`set-draw-color-alpha`(0x203)、`draw-texture`(0x1FB)、`set-texture`(0x1F9)、`create-texture`(0x1F8)、`release-texture`(0x1FA)、`play-movie`(0x20F)、`wait`(0x21C)、`float-mov`(0x2D5)、`poll-input`(0x101)、`texture-op`(0x1F7)。旧的 `u00xxxxxx` 保留为**别名**（汇编器同时接受），源脚本已批量替换为主标签。这些的完整机制见 `./copyright-effect.md`。

## 全部 544 个已映射 opcode

| opcode | argc | 名称（age-shared） | 引擎位置（handler） | 分析状态 | 已知语义 |
|---|---|---|---|---|---|
| 0x1 | 0 | u004149C0 | sub_418E60 | 已核对 | **抛 Exit 异常(程序退出)**：`_CxxThrowException(Command_Exit)`。handler=sub_418E60（raw .c 25682） |
| 0x2 | 0 | exit | sub_41A820 | 已核对 | 跨脚本**返回调用层**（`cur=frame.caller`；顶层 caller<0 才程序退出）。handler=sub_41A820（raw .c 25629） |
| 0x3 | 1 | call-script | sub_41C6A0 | 已核对 | 读 operand1=目标脚本索引 → 压帧（cur++）+ 装载新脚本帧。handler=sub_41C6A0（raw .c 26762） |
| 0x4 | 2 | u00417E30 | sub_41C770 | 仅映射 |  |
| 0x5 | 0 | ret | sub_41A9B0 | 已核对 | **同脚本**子程序返回（弹每帧返回栈 `256*cur+97193`；栈空 no-op）。handler=sub_41A9B0（raw .c 25704） |
| 0x6 | 2 | u00417E80 | sub_41C7C0 | 已核对 | **load-script-into-frame**：`op1=目标脚本索引, op2=帧编号`。备份/恢复 `cur`（`_this[383104]`↔`_this[383108]`），把脚本 `op1` 解析并装入帧 `op2`（`loadScriptFrame_40ED40`）；`op2≥40` 抛 ShowMessage「ファイルの階層が深すぎます．最大は%dです．」、装载失败抛 Exit。SYSTEM4 帧布局初始化用。handler=sub_41C7C0（raw .c 26549） |
| 0x7 | 1 | u00417F90 | sub_41C8D0 | 仅映射 |  |
| 0x8 | 1 | u00417FC0 | sub_41C900 | 仅映射 |  |
| 0x9 | 0 | exit-script | sub_428A60 | 已核对 | **全量 teardown**：清 40 帧 + 重置全局数组 → 回根态。handler=sub_428A60（raw .c 35171） |
| 0xA | 2 | u00424170 | sub_429460 | 仅映射 |  |
| 0xB | 11 | u00418090 | sub_41C9E0 | 仅映射 |  |
| 0xC | 0 | u004149E0 | sub_418E80 | 仅映射 |  |
| 0xD | 4 | u004181A0 | sub_41CAF0 | 仅映射 |  |
| 0xE | 12 | u00418200 | sub_41CB50 | 仅映射 |  |
| 0xF | 1 | u00418300 | sub_41CC50 | 仅映射 |  |
| 0x10 | 4 | u00414A00 | sub_418EB0 | 仅映射 |  |
| 0x11 | 9 | u00418330 | sub_41CC90 | 仅映射 |  |
| 0x12 | 1 | u004183F0 | sub_41CD60 | 仅映射 |  |
| 0x13 | 4 | u00418420 | sub_42C570 | 仅映射 |  |
| 0x14 | 0 | u00414A20 | sub_418ED0 | 仅映射 |  |
| 0x15 | 5 | u00418490 | sub_41CDA0 | 仅映射 |  |
| 0x16 | 2 | u00418520 | sub_41CE40 | 仅映射 |  |
| 0x17 | 2 | u00418560 | sub_41CE80 | 仅映射 |  |
| 0x1E | 8 | u004185B0 | sub_41CED0 | 仅映射 |  |
| 0x1F | 12 | u00418690 | sub_41CFB0 | 仅映射 |  |
| 0x20 | 6 | u004187C0 | sub_41D0E0 | 仅映射 |  |
| 0x21 | 2 | u00418860 | sub_41D180 | 仅映射 |  |
| 0x22 | 2 | u00418920 | sub_41D290 | 仅映射 |  |
| 0x23 | 2 | u004189D0 | sub_41D390 | 仅映射 |  |
| 0x24 | 2 | u00418A90 | sub_41D490 | 仅映射 |  |
| 0x25 | 3 | u00418B40 | sub_41D590 | 仅映射 |  |
| 0x26 | 4 | u00418C00 | sub_41D6A0 | 仅映射 |  |
| 0x27 | 4 | u00418CC0 | sub_41D780 | 仅映射 |  |
| 0x28 | 4 | u00418D90 | sub_41D860 | 仅映射 |  |
| 0x2A | 4 | u00418E60 | sub_41D940 | 仅映射 |  |
| 0x2B | 5 | u00418F30 | sub_41DA20 | 仅映射 |  |
| 0x2C | 5 | u00419010 | sub_41DB00 | 仅映射 |  |
| 0x2D | 12 | u004190A0 | sub_41DBA0 | 仅映射 |  |
| 0x2E | 5 | u004194B0 | sub_41DFA0 | 仅映射 |  |
| 0x2F | 4 | u004195A0 | sub_41E0A0 | 仅映射 |  |
| 0x30 | 5 | u00419670 | sub_41E180 | 仅映射 |  |
| 0x31 | 4 | u00419750 | sub_41E260 | 仅映射 |  |
| 0x32 | 10 | u004197C0 | sub_41E2D0 | 仅映射 |  |
| 0x33 | 6 | u00419900 | sub_41E420 | 仅映射 |  |
| 0x34 | 12 | u004199C0 | sub_41E540 | 仅映射 |  |
| 0x35 | 11 | u00419AF0 | sub_41E670 | 仅映射 |  |
| 0x36 | 3 | u00419C00 | sub_41E7E0 | 仅映射 |  |
| 0x37 | 11 | u00419C90 | sub_41E8C0 | 仅映射 |  |
| 0x38 | 12 | u00419DA0 | sub_41EA30 | 仅映射 |  |
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
| 0x60 | 2 | random | sub_42CA50 | 已核对 | `op1 = rand() % op2` |
| 0x61 | 3 | lookup-array | sub_42CB00 | 已核对 | `op1 = &op2[op3]`（取数组元素**地址**写入 op1 指针槽：sub_42AEA0 取 op2 基址 → sub_418CC0 写 `基址+4*op3`；与 lea 同底座）。handler=sub_42CB00（raw .c 37742）。⚠️ 修正旧「取值」——实际存的是元素**地址**（AGE 指针操作数后续读取时自动解引用即成值） |
| 0x62 | 3 | u0041A360 | sub_42CB50 | 仅映射 |  |
| 0x63 | 2 | lea | sub_42CBA0 | 已核对 | `op1 = &op2`（取 op2 的**内存地址**写入 op1 指针槽：`sub_42AEA0(this,2)` 取址 → `sub_418B90(this,1,addr)` 写指针/地址型操作数）。handler=sub_42CBA0（raw .c 37766） |
| 0x64 | 2 | copy-local-array | sub_42CBE0 | 已核对 | 把 op2 索引的字面数组（count=池`[4*op2]`；源=池`+4*op2+4`；每项经 `key ^ ROR` 解码后写入）拷入 op1 指向的数组 —— **数组/地板填充的底座**（MPINIT 地板用）。handler=sub_42CBE0（raw .c 37776） |
| 0x65 | 2 | u00414AA0 | sub_418F10 | 仅映射 |  |
| 0x66 | 3 | u00414AE0 | sub_42CC90 | 仅映射 |  |
| 0x67 | 3 | u00414B20 | sub_42CCE0 | 仅映射 |  |
| 0x68 | 3 | u00414B60 | sub_42CD30 | 仅映射 |  |
| 0x69 | 3 | u00414BA0 | sub_42CD80 | 仅映射 |  |
| 0x6A | 3 | u00414BE0 | sub_42CDD0 | 仅映射 |  |
| 0x6B | 3 | u00414C20 | sub_42CE20 | 仅映射 |  |
| 0x6C | 2 | copy-to-global | sub_42CE70 | 已核对 | `op1 起的 count 个槽置 0`（**非 mov 值拷贝**）：`v2=&op1; n=op2(count); while(n--) *v2++ = _this[97060]`；`_this[97060]`=**ENC(0)**（`ROL(x,11)==key` 反篡改校验在 3 处独立成立唯一确定）。handler=sub_42CE70（raw .c 37876）。⚠️ 修正旧「局部→全局循环拷贝」——实为 bulk 零初始化 |
| 0x6D | 0 | u00416960 | sub_41AA50 | 仅映射 |  |
| 0x6E | 2 | show-text | sub_41EB20 | 仅映射 | 显示文本。未读体 |
| 0x6F | 1 | end-text-line | sub_41ECE0 | 仅映射 | 结束当前文本行。未读体 |
| 0x70 | 5 | u0041A750 | sub_41ED20 | 已核对 | **消息窗口定位尺寸**：读 op1..op5 调 `sub_45D660(_this+21324, op1..op5, 0)` 设置文本消息窗口 x/y/宽/高坐标。fire-and-forget。handler=sub_41ED20（raw .c 28083） |
| 0x71 | 1 | u0041A7B0 | sub_41ED80 | 已核对 | **显示消息/推进文本**：读 op1 文本调 `sub_45EC60(msgobj, op1, _this[97055])`，经 `sub_48E870`/`sub_48F000` 渲染；置 flag `_this[174801]\|=0x8000000`、`_this[122455]=1`、`_this[122496]=0`。handler=sub_41ED80（raw .c 28100） |
| 0x72 | 1 | wait-for-input | sub_41EEF0 | 仅映射 | 等待输入。未读体 |
| 0x73 | 10 | u0041AB30 | sub_41F250 | 已核对 | **消息窗口全面配置**：读 op1..9 调 `sub_456430(msgobj, op1..9)` 拷 0x28 字节几何/布局结构进消息窗，读 op10 调 `sub_453AD0` 置节流标量。fire-and-forget。handler=sub_41F250（raw .c 28280） |
| 0x74 | 1 | u0041AC00 | sub_41F320 | 仅映射 |  |
| 0x75 | 1 | u0041AC30 | sub_41F350 | 已核对 | **设消息窗宽/反向偏移**：读 op1 调 `sub_4185F0(msgobj, op1)` 写 `_this[201684]=op1; _this[1232]=-op1; _this[101972]=-op1` 等，再 `sub_459F40()` 刷文本布局。fire-and-forget。handler=sub_41F350（raw .c 28330） |
| 0x76 | 1 | u0041AC60 | sub_41F390 | 已核对 | **设消息窗滚动类属性**：读 op1，字节序翻转后写 `_this[21664]`，调 `sub_459F40()` 刷消息/文本布局。handler=sub_41F390（raw .c 28339） |
| 0x77 | 1 | u0041ACB0 | sub_41F3F0 | 已核对 | **同 0x76**：读 op1 字节序翻转写 `_this[21665]`，调 `sub_459F40()` 刷布局。handler=sub_41F3F0（raw .c 28349） |
| 0x78 | 1 | u0041AD00 | sub_41F450 | 已核对 | **设消息窗属性并刷布局**：读 op1 写 `_this[21667]`，调消息/文本对象 `sub_459F40()`。handler=sub_41F450（raw .c 28359） |
| 0x79 | 3 | u0041AD30 | sub_41F490 | 已核对 | **消息项位置/尺寸参数**：读 op1..op3 调 `sub_4563A0(_this+21324, op1, op2, op3)`，把选中子项 `+28/+32` 两字段分别写 op3/op2。fire-and-forget。handler=sub_41F490（raw .c 28369） |
| 0x7A | 3 | u0041AD70 | sub_41F4E0 | 仅映射 |  |
| 0x7B | 2 | u0041ADB0 | sub_41F530 | 仅映射 |  |
| 0x7C | 0 | u00416A90 | sub_41AB80 | 仅映射 |  |
| 0x7D | 2 | u0041AE00 | sub_41F580 | 仅映射 |  |
| 0x7E | 1 | u0041AEA0 | sub_41F630 | 仅映射 |  |
| 0x7F | 1 | u00414C60 | sub_42D1F0 | 仅映射 |  |
| 0x80 | 1 | u0041AF00 | sub_41F690 | 仅映射 |  |
| 0x81 | 1 | u0041AF30 | sub_41F6C0 | 仅映射 |  |
| 0x82 | 5 | u0041AF80 | sub_41F720 | 仅映射 |  |
| 0x83 | 3 | u00414C90 | sub_42D220 | 仅映射 |  |
| 0x84 | 1 | u0041AFE0 | sub_41F790 | 仅映射 |  |
| 0x85 | 0 | u00414CF0 | sub_418F50 | 仅映射 |  |
| 0x86 | 1 | u0041B210 | sub_41FA20 | 仅映射 |  |
| 0x87 | 0 | u00414D10 | sub_418F80 | 仅映射 |  |
| 0x88 | 1 | u0041B290 | sub_41FAB0 | 已核对 | **消息显示/跳读模式**：读 op1，同时写引擎字段 `_this[1415]` 与全局数组槽 `_this[97050]`；非零置 `_this[122368]=1`，零则清 `_this[174801]` 的 0x8000000 位。（写全局数组故为 VM 可见）handler=sub_41FAB0（raw .c 28628） |
| 0x89 | 4 | u0041B2E0 | sub_41FB00 | 仅映射 |  |
| 0x8A | 6 | u0041B330 | sub_41FB50 | 仅映射 |  |
| 0x8B | 1 | u0041B3D0 | sub_41FBF0 | 已核对 | **消息窗字段**：读 op1 写 `_this[21669]`。handler=sub_41FBF0（raw .c 28681） |
| 0x8C | 1 | jmp | sub_4203D0 | 已核对 | 跳到 operand1 的 label（无条件，不入栈） |
| 0x8D | 2 | u0041BCE0 | sub_420450 | 仅映射 |  |
| 0x8E | 1 | u0041BD60 | sub_4204D0 | 仅映射 |  |
| 0x8F | 1 | call | sub_420560 | 已核对 | 同脚本子程序调用：push 下一指令到每帧返回栈，跳 label；operand==-1 则弹回不跳。handler=sub_420560（raw .c 29452） |
| 0x90 | 7 | u0041BEB0 | sub_420640 | 仅映射 |  |
| 0x91 | 1 | u0041BFB0 | sub_420740 | 仅映射 |  |
| 0x92 | 2 | u0041C030 | sub_4207D0 | 仅映射 |  |
| 0x93 | 0 | u00415040 | sub_4191D0 | 已核对 | **显示态切换**：`_this[174801]&=~0x800000`、`sub_403EF0`、toggle `_this[12957]/[12956]`。handler=sub_4191D0（raw .c 25044） |
| 0x94 | 0 | u00415090 | sub_419230 | 仅映射 |  |
| 0x95 | 2 | u0041C0C0 | sub_420870 | 仅映射 |  |
| 0x96 | 0 | u004150C0 | sub_419260 | 仅映射 |  |
| 0x97 | 5 | u0041C150 | sub_420910 | 仅映射 |  |
| 0xA0 | 3 | jcc | sub_4209B0 | 已核对 | **两目标条件跳转**（仅 3 个操作数）：`op1=条件`（非 0 为真）；`op1≠0`→跳 `op2`（若 `op2==0xFFFFFFFF` 则落下句）；`op1==0`→跳 `op3`（若 `op3==0xFFFFFFFF` 则落下句）。 |
| 0xA1 | 0 | u00427C00 | sub_433A40 | 仅映射 |  |
| 0xA2 | 2 | u00427FD0 | sub_434F10 | 仅映射 |  |
| 0xA3 | 2 | u004244D0 | sub_429830 | 仅映射 |  |
| 0xAA | 2 | u0041C270 | sub_42D580 | 仅映射 |  |
| 0xAB | 2 | u0041C330 | sub_42D650 | 仅映射 |  |
| 0xAC | 9 | u0041C3E0 | sub_42D700 | 仅映射 |  |
| 0xAD | 0 | u00415110 | sub_4192C0 | 仅映射 |  |
| 0xAE | 0 | u00415130 | sub_4192F0 | 已核对 | **存档版本分支指令**：经 `_this+174405` 对象 vtable 读存档版本（"set:SaveVersion1"/"set:SaveVersion2"），按版本(1/2/3/20)重算每脚本 ip（`_this[30*x+95782/95803/95804]`）、设 frame arity、切换 `cur` 或 `sub_40F750`→`loadScriptFrame_40ED40` 装载目标脚本帧；并置 `_this[95780]=0`、`_this[97054]=1`。handler=sub_4192F0（raw .c 24413） |
| 0xAF | 0 | u00415480 | sub_419690 | 仅映射 |  |
| 0xB0 | 1 | u0041C530 | sub_420A50 | 仅映射 |  |
| 0xB1 | 1 | u0041C560 | sub_420A80 | 仅映射 |  |
| 0xB2 | 2 | u0041C590 | sub_420AB0 | 仅映射 |  |
| 0xB3 | 0 | u004154B0 | sub_4196B0 | 仅映射 |  |
| 0xB4 | 2 | play-sound-effect | sub_420B00 | 仅映射 | 播放音效。未读体 |
| 0xB5 | 1 | u0041D050 | sub_420B40 | 仅映射 |  |
| 0xB6 | 1 | u0041D080 | sub_420B80 | 已核对 | **声音通道**：`sub_4B5050(_this+20719, op1)`(播/控音效)。handler=sub_420B80（raw .c 29327） |
| 0xB7 | 1 | u0041D0E0 | sub_420C00 | 仅映射 |  |
| 0xB8 | 0 | u00415520 | sub_419720 | 仅映射 |  |
| 0xB9 | 1 | u0041D140 | sub_420C60 | 仅映射 |  |
| 0xBA | 1 | u0041D0B0 | sub_420BC0 | 仅映射 |  |
| 0xBB | 1 | u0041D250 | sub_420D90 | 仅映射 |  |
| 0xBC | 1 | u0041D280 | sub_420DC0 | 仅映射 |  |
| 0xBD | 1 | u00415570 | sub_42E460 | 仅映射 |  |
| 0xBE | 1 | u004155E0 | sub_42E4D0 | 仅映射 |  |
| 0xBF | 1 | play-bgm | sub_420CC0 | 仅映射 | 播放 BGM。未读体 |
| 0xC0 | 1 | u00415620 | sub_42E510 | 仅映射 |  |
| 0xC1 | 0 | u00415650 | sub_419770 | 仅映射 |  |
| 0xC2 | 2 | u0041D2B0 | sub_420E00 | 仅映射 |  |
| 0xC3 | 1 | u0041D390 | sub_420F10 | 仅映射 |  |
| 0xC4 | 1 | play-voice | sub_420F70 | 仅映射 | 播放语音。未读体 |
| 0xC5 | 2 | u0041D4A0 | sub_42E540 | 仅映射 |  |
| 0xC6 | 2 | u0041D5D0 | sub_421070 | 仅映射 |  |
| 0xC7 | 2 | u0041D760 | sub_42E670 | 仅映射 |  |
| 0xC8 | 1 | sleep | sub_4218D0 | 仅映射 | 睡眠/延时。未读体 |
| 0xC9 | 0 | u00415770 | sub_4198A0 | 仅映射 |  |
| 0xCA | 0 | u004157A0 | sub_4198E0 | 仅映射 |  |
| 0xCB | 1 | u00415800 | sub_42E8E0 | 仅映射 |  |
| 0xCC | 2 | mouse_callback | sub_421980 | 仅映射 | 注册鼠标/键盘回调。未读体 |
| 0xCD | 0 | get-input-type | sub_41ACD0 | 仅映射 | 取输入类型。未读体 |
| 0xCE | 3 | u0041E0B0 | sub_4219E0 | 仅映射 |  |
| 0xCF | 0 | u00416D40 | sub_41AE40 | 仅映射 |  |
| 0xD0 | 1 | u00415830 | sub_42E910 | 仅映射 |  |
| 0xD1 | 0 | u00415860 | sub_419940 | 仅映射 |  |
| 0xD2 | 1 | u0041E110 | sub_421A50 | 仅映射 |  |
| 0xD3 | 0 | u00425960 | sub_42AC40 | 仅映射 |  |
| 0xD4 | 4 | u004266F0 | sub_42E940 | 仅映射 |  |
| 0xD5 | 1 | u004262C0 | sub_42ACC0 | 仅映射 |  |
| 0xD6 | 6 | u004267D0 | sub_42EB80 | 仅映射 |  |
| 0xD7 | 1 | u0041E1A0 | sub_421AF0 | 仅映射 |  |
| 0xD8 | 2 | u0041E150 | sub_421AA0 | 仅映射 |  |
| 0xD9 | 0 | u00415880 | sub_419970 | 已核对 | **清标志位**：`_this[174801]&=~0x1000`。handler=sub_419970（raw .c 25022） |
| 0xDA | 6 | u004158B0 | sub_42EAE0 | 仅映射 |  |
| 0xFA | 0 | u00415940 | sub_4199B0 | 仅映射 |  |
| 0xFB | 2 | joy_callback | sub_421B80 | 仅映射 | 注册手柄回调。未读体 |
| 0xFC | 0 | u004159F0 | sub_419A70 | 仅映射 |  |
| 0xFD | 2 | u0041E2D0 | sub_421C10 | 仅映射 |  |
| 0xFE | 1 | u0041E360 | sub_421CA0 | 已核对 | **SetKeyTotal**：读 op1；若 `op1>0x1F` 抛 ShowMessage「SetKeyTotalの引数が不正です．」，否则写引擎字段 `_this[517]`。handler=sub_421CA0（raw .c 30046） |
| 0xFF | 0 | u00415A10 | sub_419A90 | 仅映射 |  |
| 0x100 | 0 | u00415A60 | sub_419AF0 | 仅映射 |  |
| 0x101 | 0 | poll-input | sub_419CC0 | 已核对 | **读输入状态并重置**：读输入位掩码到 `_this[174802]` 后丢弃；清 `_this[174801]` 的 0x8000000 位，置 `_this[174802]=0`、`_this[122367]=1`、`_this[122370]=0`。handler=sub_419CC0（raw .c 24831）。旧 label `u00415BF0` |
| 0x102 | 3 | u0041E3C0 | sub_421D00 | 仅映射 |  |
| 0x103 | 1 | u0041E4A0 | sub_421DE0 | 仅映射 |  |
| 0x104 | 0 | u00415C50 | sub_419D20 | 仅映射 |  |
| 0x105 | 1 | u0041E4D0 | sub_421E20 | 仅映射 |  |
| 0x106 | 1 | u00415E40 | sub_42ED90 | 仅映射 |  |
| 0x107 | 2 | u0041E500 | sub_421E50 | 已核对 | **SetKey（按键绑定）**：读 op2=值、op1=键下标；`op1≤0x1F` 时写 `_this[551+op1]=op2`。handler=sub_421E50（raw .c 30114） |
| 0x108 | 1 | u00415E70 | sub_42EDC0 | 仅映射 |  |
| 0x109 | 2 | u00415EC0 | sub_42EE10 | 仅映射 |  |
| 0x10A | 2 | u0041E540 | sub_421EA0 | 仅映射 |  |
| 0x10B | 2 | u0041E5A0 | sub_422070 | 已核对 | **SetKey（另一按键表）**：读 op2=键下标、op1=值；`op1≤0x1F` 时写 `_this[op2+1383]=op1`。handler=sub_422070（raw .c 30200） |
| 0x10C | 2 | u0041E5E0 | sub_4220B0 | 已核对 | **SetKeyMulti**：读 op1=值、op2=键索引；`op1>0x1F` 抛 ShowMessage「set-keymulti 引数不正」，否则写 `_this[_this[op2+1690]+1434]=op1`。handler=sub_4220B0（raw .c 30213） |
| 0x10D | 1 | u00415F10 | sub_42EF50 | 仅映射 |  |
| 0x10E | 2 | u0041E650 | sub_42EF90 | 仅映射 |  |
| 0x10F | 1 | u0041E690 | sub_422120 | 已核对 | **引擎控制字段**：读 op1 写 `_this[122369]`。handler=sub_422120（raw .c 30232） |
| 0x12C | 5 | lookup-array-2d | sub_42EFD0 | 已核对 | **lookup-array-2d**（二维数组元素地址）：`v6=op3*op4+op5`（行×列宽+列），`operandAddress_42AEA0(2)` 取 op2 基址，`sub_418CC0(1, base, v6, -1, -1)` 把 `base+4*v6` 写入 op1 指针槽。handler=sub_42EFD0（raw .c 38462） |
| 0x12D | 7 | u0041E720 | sub_42F040 | 仅映射 |  |
| 0x12E | 8 | u0041E940 | sub_42F230 | 仅映射 |  |
| 0x12F | 4 | u0041ECB0 | sub_42F560 | 仅映射 |  |
| 0x130 | 1 | u00415F40 | sub_42F7A0 | 已核对 | **配置 getter**：`op1 = _this[96983]`（写回操作数 1；SYSTEM4 第 146 行据此判断是否 `call-script LOGO`）。handler=sub_42F7A0（raw .c 38662） |
| 0x131 | 1 | u00415F70 | sub_42F7D0 | 仅映射 |  |
| 0x132 | 1 | u0041EF00 | sub_422150 | 仅映射 |  |
| 0x133 | 2 | u0041EFF0 | sub_422240 | 仅映射 |  |
| 0x134 | 3 | u0041F050 | sub_42F810 | 仅映射 |  |
| 0x135 | 2 | bit-set | sub_42F8B0 | 已核对 | `op1 \|= (1<<op2)`（置位；op2=bit 位，>0x1F 报错 `setbit`）。handler=sub_42F8B0（raw .c 39402） |
| 0x136 | 2 | bit-reset | sub_42F920 | 已核对 | `op1 &= ~(1<<op2)`（复位；op2=bit 位，>0x1F 报错 `rembit`）。handler=sub_42F920（raw .c 39424） |
| 0x137 | 1 | u0041F1C0 | sub_4222B0 | 仅映射 |  |
| 0x138 | 2 | u0041F2B0 | sub_4223A0 | 仅映射 |  |
| 0x139 | 3 | u0041F310 | sub_42F990 | 仅映射 |  |
| 0x13A | 6 | u0041F3A0 | sub_422410 | 仅映射 |  |
| 0x13B | 7 | u0041F440 | sub_4224E0 | 仅映射 |  |
| 0x13C | 1 | u0041F7E0 | sub_422860 | 仅映射 |  |
| 0x13D | 3 | u0041F840 | sub_42FA20 | 仅映射 |  |
| 0x13E | 2 | u0041F8D0 | sub_42FAC0 | 仅映射 |  |
| 0x13F | 3 | check-bit | sub_42FB40 | 已核对 | `op1 = ((1<<op3) & op2) != 0`（op3=bit 位，op2=待测值，>0x1F 报错 `getbit`）。handler=sub_42FB40（raw .c 39549） |
| 0x140 | 4 | u0041F9C0 | sub_42FBC0 | 仅映射 |  |
| 0x141 | 1 | u0041FAA0 | sub_4228C0 | 仅映射 |  |
| 0x142 | 1 | u0041FB10 | sub_422930 | 仅映射 |  |
| 0x143 | 0 | u00415FB0 | sub_41A000 | 已核对 | **派发挂起脚本/事件请求**（dispatchScriptRequests）：置 `_this[124350]=1`，遍历 `_this+173106` 队列对每非零槽 `queueScript_40FC90(slot<<24)` 排队，`dispatchQueuedScripts_40FB60()` 派发；置 `_this[124350]=0`、`_this[30*cur+95805]=0`、`frames[cur].ip+=4`。handler=sub_41A000（raw .c 24928） |
| 0x144 | 2 | u004259D0 | sub_433AB0 | 仅映射 |  |
| 0x145 | 1 | u00416040 | sub_42FCF0 | 仅映射 |  |
| 0x146 | 1 | u0041FB40 | sub_422960 | 仅映射 |  |
| 0x147 | 6 | u0041FB80 | sub_42FD60 | 仅映射 |  |
| 0x148 | 1 | u004160A0 | sub_42FEC0 | 仅映射 |  |
| 0x149 | 1 | u0041FCE0 | sub_4229A0 | 已核对 | **写全局槽**：读 op1 写 `_this[97058]`（全局数组槽，紧邻 key `_this[97059]`/`ENC(0)` `_this[97060]`）。handler=sub_4229A0（raw .c 30629） |
| 0x14A | 7 | u0041FD10 | sub_42FEF0 | 仅映射 |  |
| 0x14B | 1 | u0041FF50 | sub_4229D0 | 仅映射 |  |
| 0x14C | 2 | set-agerc-export | sub_422AB0 | 推测 | 绑定 agerc 导出。未读体 |
| 0x14D | 6 | call-agerc-export | sub_430170 | 推测 | 调用 agerc 导出。未读体 |
| 0x190 | 2 | u0041C5E0 | sub_42D830 | 仅映射 |  |
| 0x191 | 2 | u0041A4A0 | sub_42CEC0 | 仅映射 |  |
| 0x192 | 2 | set-string | sub_433660 | 已核对 | `op1 = op2`（**汉化核心指令**：把字符串 op2 赋给 op1 串槽。`sub_42A420(this,&buf,2)` 读 op2 字符串对象 → `sub_433310(this,1,buf)` 写入 op1）。handler=sub_433660（raw .c 41936） |
| 0x193 | 3 | concat | sub_433710 | 已核对 | `op1 = op2 + op3`（字符串拼接：`sub_42A420` 读 op3/op2 → `sub_42AA90` 拼接（**op2 在前**）→ `sub_433310` 写入 op1）。handler=sub_433710（raw .c 41952） |
| 0x194 | 3 | u00425480 | sub_42CF10 | 仅映射 |  |
| 0x195 | 3 | u00425580 | sub_42D010 | 仅映射 |  |
| 0x196 | 3 | display-furigana | sub_41FC20 | 推测 | 显示注音。未读体 |
| 0x197 | 1 | u0041B510 | sub_41FDD0 | 已核对 | **配置显示/布局对象**：读 op1 调 `sub_418680(_this+21324, op1)`，写界面面板/窗口布局字段。fire-and-forget。handler=sub_41FDD0（raw .c 28775） |
| 0x198 | 3 | u0041B540 | sub_41FE10 | 仅映射 |  |
| 0x199 | 0 | u00414D50 | sub_418FC0 | 仅映射 |  |
| 0x19A | 1 | u00414E50 | sub_42D290 | 仅映射 |  |
| 0x19B | 0 | u00414E80 | sub_4190E0 | 已核对 | **退出消息/ADV**：清 `_this[174801]&~0x8000000`、`_this[1415]=0`。handler=sub_4190E0（raw .c 25031） |
| 0x19C | 0 | u00414EC0 | sub_419120 | 已核对 | **进入消息/ADV**：`_this[97051]=1`、`_this[174801]|=0x8000000`、`_this[122368]=1`。handler=sub_419120（raw .c 25076） |
| 0x19D | 2 | u0041C680 | sub_42D8E0 | 仅映射 |  |
| 0x19E | 2 | u0041C6E0 | sub_42D980 | 仅映射 |  |
| 0x19F | 2 | u0041C860 | sub_42DB10 | 仅映射 |  |
| 0x1A0 | 9 | u0041C9B0 | sub_42DC70 | 仅映射 |  |
| 0x1A1 | 2 | u0041CB40 | sub_42DDE0 | 仅映射 |  |
| 0x1A2 | 1 | u00428010 | sub_434F60 | 已核对 | **写引擎字符串→整型哈希表**：读 op1 得值+索引，`wsprintfA("%c%8.8x",3,idx)` 生成键，`sub_434D00(_this+5452, key, &val)` 插入（sub_429020 找槽、sub_40C210 存键）。handler=sub_434F60（raw .c 42140） |
| 0x1A3 | 1 | string-lookup-set | sub_42DF40 | 已核对 | **string-lookup-set**：`sub_418A30(1)` 读 op1 索引 → 键 `"%c%8.8x",3,idx` → `sub_428E00(key)` 全局字符串表查询（命中取 `*v3`、未命中=0）→ `writeIntOperand_42B4B0(1,val)` 写回 op1。（写操作数故 VM 可见）handler=sub_42DF40（raw .c 37793） |
| 0x1A4 | 2 | u0041B580 | sub_41FE60 | 已核对 | **消息窗字段**：读 op1/op2 写 `_this[21670]/[21671]`。handler=sub_41FE60（raw .c 28797） |
| 0x1A5 | 1 | set-font | sub_433290 | 已核对 | **set-font**：读 op1 字符串，调 `sub_4328F0(_this+21324, str)` 设字体。fire-and-forget。handler=sub_433290（raw .c 41043） |
| 0x1A6 | 2 | halve-strlen | sub_42D110 | 推测 | 字符串半长。未读体 |
| 0x1A7 | 1 | comment | sub_4191B0 | 已核对 | nop（dev 注释，无副作用） |
| 0x1A8 | 0 | dev_ukn | sub_419690 | 已核对 | nop（dev 未知指令，通常空实现） |
| 0x1A9 | 1 | u00428090 | sub_434FE0 | 已核对 | **写字符串哈希表**：`sub_42A420` 读 op1 字符串、`sub_418AE0(1)` 读值，键 `"%c%8.8x",5,val`，`sub_434E00(key, str)` 插入/更新（table 满 `sub_434AF0` 扩容）。handler=sub_434FE0（raw .c 42154） |
| 0x1AA | 1 | u00425920 | sub_433A70 | 仅映射 |  |
| 0x1AB | 2 | u0041CCA0 | sub_42DFC0 | 仅映射 |  |
| 0x1AC | 3 | u0041CD80 | sub_42E0A0 | 仅映射 |  |
| 0x1AD | 0 | u004154F0 | sub_4196F0 | 仅映射 |  |
| 0x1AE | 3 | u0041CED0 | sub_42E1F0 | 仅映射 |  |
| 0x1AF | 3 | u004245C0 | sub_42E320 | 仅映射 |  |
| 0x1B0 | 3 | memcpy | sub_42D150 | 推测 | `op1 = dest; op2 = src; size = 4*op3`。未读体（备注来自 age-shared 注释） |
| 0x1B1 | 1 | u0041B5C0 | sub_41FEA0 | 仅映射 |  |
| 0x1B2 | 1 | u00425790 | sub_42A9B0 | 已核对 | **字符串 append 日志缓冲**：`sub_40C660(_this+124336)`。handler=sub_42A9B0（raw .c 41442） |
| 0x1B3 | 0 | u004257D0 | sub_42AA00 | 已核对 | **append 2 字符换行**。handler=sub_42AA00（raw .c 41452） |
| 0x1B4 | 0 | u004237C0 | sub_428DB0 | 已核对 | **错误输出/中止**：`sub_40B420`。handler=sub_428DB0（raw .c 35482） |
| 0x1B5 | 1 | u0041B5F0 | sub_41FED0 | 仅映射 |  |
| 0x1B6 | 1 | u00414F60 | sub_42D2C0 | 仅映射 |  |
| 0x1B7 | 1 | u0041B640 | sub_41FF20 | 仅映射 |  |
| 0x1B8 | 2 | u0041B670 | sub_42D2F0 | 仅映射 |  |
| 0x1B9 | 2 | u0041B710 | sub_41FF60 | 仅映射 |  |
| 0x1BA | 2 | u0041D850 | sub_421200 | 仅映射 |  |
| 0x1BB | 1 | u0041B7B0 | sub_420000 | 仅映射 |  |
| 0x1BC | 0 | u00415670 | sub_4197A0 | 已核对 | **清理声音/消息字段**。handler=sub_4197A0（raw .c 25002） |
| 0x1BD | 1 | u0041D910 | sub_4212C0 | 仅映射 |  |
| 0x1BE | 2 | u0041D9D0 | sub_42E770 | 仅映射 |  |
| 0x1BF | 0 | u004156C0 | sub_419840 | 已核对 | **跳读态置**：按跳读态置 `_this[122503]=1`。handler=sub_419840（raw .c 25015） |
| 0x1C0 | 1 | u0041DB70 | sub_421450 | 仅映射 |  |
| 0x1C1 | 3 | u0041B820 | sub_420070 | 已核对 | **消息/UI 子系统方法**：读 op1..op3 调 `sub_4563D0(_this+21324, op1, op2, op3)`。fire-and-forget。handler=sub_420070（raw .c 28895） |
| 0x1C2 | 2 | u0041B860 | sub_4200C0 | 仅映射 |  |
| 0x1C3 | 2 | u0041B8A0 | sub_420110 | 仅映射 |  |
| 0x1C4 | 1 | u00415720 | sub_42E8A0 | 仅映射 |  |
| 0x1C5 | 4 | u00425800 | sub_433930 | 仅映射 |  |
| 0x1C6 | 2 | u0041DD80 | sub_421690 | 仅映射 |  |
| 0x1C7 | 1 | u00414F90 | sub_42D390 | 仅映射 |  |
| 0x1C8 | 2 | toString | sub_433820 | 推测 | 转字符串。未读体 |
| 0x1C9 | 3 | u0041B8E0 | sub_420160 | 仅映射 |  |
| 0x1CA | 1 | u0041B9B0 | sub_420240 | 已核对 | **配置 set-message-read-texture**：读 op1，经 `_this[174405]` 消息子系统对象 vtable+12 以 `"message"`/`readtex`+op1 派发。handler=sub_420240（raw .c 28961） |
| 0x1CB | 1 | u00414FD0 | sub_42D3D0 | 仅映射 |  |
| 0x1CC | 1 | u00415010 | sub_42D410 | 仅映射 |  |
| 0x1CD | 2 | u0041A560 | sub_42D1A0 | 仅映射 |  |
| 0x1CE | 1 | u0041B9F0 | sub_420280 | 已核对 | **消息/UI 点击-跳读状态机**：读 op1；非0→`_this[174801]|=0x40000000`、`_this[107704]=0`、`sub_453A90(_this+430600)`(重置轮播计时器)；0→清 0x40000000。handler=sub_420280（raw .c 28974） |
| 0x1CF | 1 | u0041DA10 | sub_4213C0 | 已核对 | **消息跳读态**：写 `_this[122504]=op1`。handler=sub_4213C0（raw .c 29445） |
| 0x1D0 | 3 | u0041BA80 | sub_42D440 | 仅映射 |  |
| 0x1D1 | 5 | u0041BAE0 | sub_420310 | 仅映射 |  |
| 0x1D2 | 2 | u0041BB40 | sub_420380 | 仅映射 |  |
| 0x1D3 | 5 | u0041BB90 | sub_42D4A0 | 仅映射 |  |
| 0x1D4 | 4 | u0041BC00 | sub_42D510 | 仅映射 |  |
| 0x1D5 | 0 | u00415700 | sub_419880 | 仅映射 |  |
| 0x1D6 | 2 | u0041DA40 | sub_42E7C0 | 仅映射 |  |
| 0x1D7 | 2 | u0041DA80 | sub_42E800 | 仅映射 |  |
| 0x1D8 | 3 | u0041DAD0 | sub_42E850 | 仅映射 |  |
| 0x1D9 | 2 | u0041DB20 | sub_4213F0 | 仅映射 |  |
| 0x1F4 | 0 | u004160D0 | sub_41A090 | 已核对 | **帧计时(等待底盘)**：`_this[107438]` 已置→`++_this[107439]`(累加帧计数)；否则 `_this[107438]=1`+`timeGetTime()` 写 `_this[92333]/[92334]`。handler=sub_41A090（raw .c 25194） |
| 0x1F5 | 0 | u00416120 | sub_41A0E0 | 已核对 | **帧倒计+派发(等待底盘)**：每帧递减 `_this[107439]`；到 0 清 `_this[107438]` 且 `_this[124350]==0` 时 `sub_40FB60()` 派发排队脚本(续跑)。handler=sub_41A0E0（raw .c 25215） |
| 0x1F6 | 0 | u00416170 | sub_41A130 | 已核对 | **清图形对象链**：`sub_4AB7A0`。handler=sub_41A130（raw .c 24986） |
| 0x1F7 | 2 | texture-op | sub_422BC0 | 已核对 | **纹理子系统方法**：读 op1/op2，按 op2 选调图形子系统 `sub_4AB950(_this+80708, op1)`（单参）或 `sub_4ABB60`（双参）。fire-and-forget。handler=sub_422BC0（raw .c 30717）。旧 label `u00420270` |
| 0x1F8 | 4 | create-texture | sub_422C20 | 已核对 | **create-texture**：读 op1=纹理槽、op2/3/4；先释放旧槽对象（`sub_488FB0`+vtable delete+置0），调 `sub_4A2C10(_this+80708, op1, op2, op3, op4)` 创建纹理；失败抛「CTexture エラー：テクスチャ作成に失敗」。fire-and-forget。handler=sub_422C20（raw .c 30739） |
| 0x1F9 | 3 | set-texture | sub_422CB0 | 已核对 | **set-texture**（唯一绑定）：`op1=imgid, op2=slot, op3=color`。清空 slot 旧纹理对象（`sub_488FB0`+置0），`sub_4559C0` imgid→路径 + `sub_455560` 开文件 → `sub_4A3800(_this+322832, imgid, hFile, slot, color, 0)` 载入纹理（`[5*slot+466]=imgid`）；失败抛「画像ファイル %s の読み込みに失敗しました」。handler=sub_422CB0（raw .c 30769） |
| 0x1FA | 1 | u00420480 | sub_422E00 | 已核对 | **release-texture**：读 op1=slot，释放 `_this[slot+94672]` 纹理对象（`sub_488FB0`+delete+置0），`sub_49E980(slot)` 释放该槽（`[5*slot+466]=-1`）。handler=sub_422E00（raw .c 30822） |
| 0x1FB | 8 | draw-texture | sub_422E70 | 已核对 | **draw-texture**（fire-and-forget 排队）：`op1=tex, op2=layer, op3=x, op4=y, op5=w, op6=h, op7=p, op8=q`。目标矩形 `(op3, op4, op3+op5, op4+op6)`（SetRect），p/q `(float)` 强转；`sub_4ACE50(_this+80708, tex, layer, x, y, x+w, y+h, p, q, 0.0)` 排绘制（置 `_this[11627]=1` 脏标记）。handler=sub_422E70（raw .c 30846） |
| 0x1FC | 1 | u004205F0 | sub_422F80 | 仅映射 |  |
| 0x1FD | 4 | u00420620 | sub_422FD0 | 已核对 | **缩放变换**：`sub_4AC5F0` 设 3D 缩放矩阵(D3DXMatrixScaling/256 格除)。handler=sub_422FD0（raw .c 30886） |
| 0x1FE | 5 | u004206C0 | sub_423060 | 仅映射 |  |
| 0x1FF | 4 | u00420770 | sub_4230F0 | 仅映射 |  |
| 0x200 | 1 | u00420800 | sub_423170 | 仅映射 |  |
| 0x201 | 1 | u00416190 | sub_4302B0 | 仅映射 |  |
| 0x202 | 5 | u00420880 | sub_4231F0 | 已核对 | **set-draw-color**：读 op4=alpha（>255 clamp 255，<0 取当前色 `sub_4ADD60>>24`）、op5=color（<0 取当前色）、op2/op3 参数、op1=图元；组装 ARGB → `sub_4AD0C0(_this+80708, op1, op2, op3, argb)`。handler=sub_4231F0（raw .c 30951） |
| 0x203 | 4 | u00420950 | sub_4232C0 | 已核对 | **set-draw-color-alpha**：读 op3=alpha（clamp/回退）、op4=color（回退），组装 ARGB → `sub_4ACF60(_this+80708, op1, op2, argb)`。handler=sub_4232C0（raw .c 30987） |
| 0x204 | 4 | draw-string | sub_423390 | 仅映射 | 绘制字符串。未读体 |
| 0x205 | 6 | u00420A60 | sub_4233E0 | 仅映射 |  |
| 0x206 | 7 | u004161C0 | sub_41A160 | 仅映射 |  |
| 0x207 | 8 | u00420B00 | sub_423480 | 仅映射 |  |
| 0x208 | 3 | u00420BF0 | sub_4302E0 | 仅映射 |  |
| 0x209 | 5 | u00420C50 | sub_423580 | 仅映射 |  |
| 0x20A | 1 | u00420CE0 | sub_423620 | 仅映射 |  |
| 0x20B | 7 | u00420D50 | sub_423690 | 已核对 | **纯色+α 填充(渐变/压黑覆盖原语)**：读 op1=纹理、op2..op5=矩形(op4=op2+宽,op5=op3+高)、op6=α(>255 钳 255)、op7=颜色；`sub_4A4C70` 走纹素 vtable(+24) 填充。handler=sub_423690（raw .c 31569） |
| 0x20C | 0 | u00416200 | sub_41A1A0 | 仅映射 |  |
| 0x20D | 1 | u00420E10 | sub_423770 | 仅映射 |  |
| 0x20E | 0 | u00416250 | sub_41A200 | 已核对 | **图形提交**：`sub_498B60`(条件清 layer 0x26) → 本帧落到屏。handler=sub_41A200（raw .c 25063） |
| 0x20F | 3 | u00420E40 | sub_4237B0 | 已核对 | **play-movie**：读 op1=movie资源id、op2=slot、op3=模式/音量；构造/复用 `[4*slot+378688]` movie 对象，`sub_454FA0` 取路径、`sub_488DC0` 装载（失败抛「…」）、`sub_489230` 绑定、`sub_4054D0` 求播放模式、`sub_408350` 求音量、`sub_4885A0` 设音量、`sub_4883A0` 启动；置 `_this[699204]\|=0x2000`、`_this[675972]=1`。handler=sub_4237B0（raw .c 31165） |
| 0x210 | 1 | u00420FF0 | sub_423980 | 仅映射 |  |
| 0x211 | 1 | u00421060 | sub_4239F0 | 仅映射 |  |
| 0x212 | 2 | u00421090 | sub_423A30 | 已核对 | **消息窗对象字段**：读 op1=对象下标、op2=值；`_this[op1+21585]` 对象非空则写其 `+100=op2`。handler=sub_423A30（raw .c 31299） |
| 0x213 | 3 | u004210D0 | sub_423A80 | 已核对 | **消息窗对象字段**：读 op1=对象下标、op2/op3；对象非空写 `+104=op2`、`+108=op3`。handler=sub_423A80（raw .c 31314） |
| 0x214 | 2 | u00421120 | sub_423AE0 | 仅映射 |  |
| 0x215 | 2 | u00421160 | sub_430340 | 已核对 | **图形状态 getter**。handler=sub_430340（raw .c 39337） |
| 0x216 | 2 | u004211A0 | sub_430380 | 已核对 | **纹理元数据 getter**：`_this[5*op2+81174]`。handler=sub_430380（raw .c 39351） |
| 0x217 | 4 | u004211E0 | sub_423B20 | 已核对 | **对象变换**：`sub_4ACF20` 设对象变换。handler=sub_423B20（raw .c 31101） |
| 0x218 | 4 | u00421270 | sub_4303C0 | 仅映射 |  |
| 0x219 | 4 | u004212E0 | sub_423BA0 | 仅映射 |  |
| 0x21A | 4 | u00421370 | sub_430450 | 仅映射 |  |
| 0x21B | 1 | u004213E0 | sub_423C20 | 已核对 | **引擎布尔标志**：读 op1，写 `_this[166965]=(op1!=0)`（成对读取方 sub_430810 回写操作数 1）。handler=sub_423C20（raw .c 31375） |
| 0x21C | 0 | wait | sub_41A260 | 已核对 | **每脚本引擎状态槽→0x400 动画等待**：读 cur，写 `_this[30*cur+95805]=1`、`_this[174801]\|=0x400`（版权页/淡入淡出的"等几秒"等待门）。handler=sub_41A260（raw .c 25043）。旧 label `u00416270` |
| 0x21D | 2 | u00421410 | sub_423C60 | 仅映射 |  |
| 0x21E | 6 | u00421450 | sub_423CA0 | 仅映射 |  |
| 0x21F | 7 | u00421510 | sub_423D40 | 仅映射 |  |
| 0x220 | 6 | u004215D0 | sub_423DE0 | 仅映射 |  |
| 0x221 | 4 | u00421670 | sub_423E70 | 仅映射 |  |
| 0x222 | 2 | u004216C0 | sub_423EC0 | 仅映射 |  |
| 0x223 | 8 | u00421700 | sub_423F00 | 仅映射 |  |
| 0x224 | 0 | u00416290 | sub_41A290 | 仅映射 |  |
| 0x225 | 2 | u00421780 | sub_423F80 | 仅映射 |  |
| 0x226 | 5 | u004217D0 | sub_4304E0 | 仅映射 |  |
| 0x227 | 6 | u00421880 | sub_4305A0 | 仅映射 |  |
| 0x228 | 5 | u00421940 | sub_430650 | 仅映射 |  |
| 0x229 | 5 | u004219E0 | sub_423FE0 | 已核对 | **绘制模式配置**：`sub_49A690/4AC/4AF0`。handler=sub_423FE0（raw .c 31502） |
| 0x22A | 3 | u00421A90 | sub_424080 | 仅映射 |  |
| 0x22B | 4 | u00421B30 | sub_424100 | 仅映射 |  |
| 0x22C | 3 | u00421BD0 | sub_424180 | 仅映射 |  |
| 0x22D | 5 | u00421C60 | sub_4241F0 | 仅映射 |  |
| 0x22E | 6 | u00421D10 | sub_424290 | 仅映射 |  |
| 0x22F | 5 | u00421DD0 | sub_424330 | 仅映射 |  |
| 0x230 | 1 | u00421E70 | sub_4243B0 | 仅映射 |  |
| 0x231 | 4 | u00421EA0 | sub_4243F0 | 仅映射 |  |
| 0x232 | 4 | u00421EF0 | sub_424440 | 仅映射 |  |
| 0x233 | 5 | u00421FB0 | sub_424510 | 仅映射 |  |
| 0x234 | 5 | u00422060 | sub_4245B0 | 仅映射 |  |
| 0x235 | 5 | u00422100 | sub_424630 | 仅映射 |  |
| 0x236 | 4 | u004221A0 | sub_4246B0 | 仅映射 |  |
| 0x237 | 2 | u00422350 | sub_424880 | 仅映射 |  |
| 0x238 | 1 | u00422390 | sub_4248C0 | 仅映射 |  |
| 0x239 | 6 | u004223C0 | sub_424900 | 仅映射 |  |
| 0x23A | 2 | u00422420 | sub_4306F0 | 仅映射 |  |
| 0x23B | 7 | u00422460 | sub_424970 | 仅映射 |  |
| 0x23C | 0 | u004162B0 | sub_41A2C0 | 仅映射 |  |
| 0x23D | 0 | u004162F0 | sub_41A300 | 已核对 | **释放纹理槽**：释放 42..999。handler=sub_41A300（raw .c 25099） |
| 0x23E | 2 | u004228C0 | sub_430750 | 仅映射 |  |
| 0x23F | 2 | u00422930 | sub_4307B0 | 仅映射 |  |
| 0x240 | 4 | u004229A0 | sub_424DA0 | 仅映射 |  |
| 0x241 | 5 | u00422B80 | sub_424FA0 | 仅映射 |  |
| 0x242 | 2 | u00422D60 | sub_4251A0 | 仅映射 |  |
| 0x243 | 0 | u00417070 | sub_41B180 | 仅映射 |  |
| 0x244 | 0 | u00416360 | sub_41A370 | 仅映射 |  |
| 0x245 | 2 | u00422DA0 | sub_4251E0 | 仅映射 |  |
| 0x246 | 2 | u00422E10 | sub_425250 | 仅映射 |  |
| 0x247 | 1 | u00416390 | sub_430810 | 仅映射 |  |
| 0x248 | 1 | u00422E80 | sub_4252E0 | 已核对 | **模块静态配置**：读 op1 写全局 `dword_55052C`（默认 256，图像缩放/坐标换算的格子除数）。handler=sub_4252E0（raw .c 32228） |
| 0x249 | 3 | u00422EB0 | sub_425310 | 仅映射 |  |
| 0x24A | 3 | u004163C0 | sub_430840 | 仅映射 |  |
| 0x24B | - | （age-shared 未收录） | sub_425460 | 仅映射 |  |
| 0x24C | - | （age-shared 未收录） | sub_425530 | 仅映射 |  |
| 0x24D | 12 | u00422E90 | sub_4255E0 | 仅映射 |  |
| 0x24E | 1 | u00422EA0 | sub_4258C0 | 仅映射 |  |
| 0x24F | 10 | u00422ED0 | sub_4258F0 | 仅映射 |  |
| 0x250 | 10 | u00422F60 | sub_425980 | 仅映射 |  |
| 0x251 | 12 | u00422FF0 | sub_425A10 | 仅映射 |  |
| 0x252 | 1 | u00423000 | sub_425AB0 | 已核对 | **消息/系统配置字段**：读 op1 写 `_this[92323]`。handler=sub_425AB0（raw .c 32573） |
| 0x253 | 2 | u00423019 | sub_425AE0 | 仅映射 |  |
| 0x254 | 5 | u00423049 | sub_425B20 | 仅映射 |  |
| 0x255 | - | （age-shared 未收录） | sub_425BC0 | 仅映射 |  |
| 0x256 | 5 | u00423050 | sub_425C30 | 仅映射 |  |
| 0x257 | 5 | 257 | sub_425CA0 | 仅映射 |  |
| 0x258 | 2 | u00422FE0 | sub_425D20 | 仅映射 |  |
| 0x259 | 0 | u00416410 | sub_41A3A0 | 已核对 | **清纹理元数据**：清纹理槽元数据数组。handler=sub_41A3A0（raw .c 25127） |
| 0x25A | 1 | u00423120 | sub_425DB0 | 仅映射 |  |
| 0x25B | 1 | 25B | sub_425E20 | 已核对 | **图像资源加载（消息态）**：读 op1，置 `_this[92379]=2`、`_this[92381]=op1`；标志 `_this[167990]==0` 时调 `sub_408440` 加载图像（失败抛「画像ファイル %s…」）。handler=sub_425E20（raw .c 32713） |
| 0x25C | 8 | u00423122 | sub_425E70 | 仅映射 |  |
| 0x25D | 3 | u00423123 | sub_425EF0 | 已核对 | **消息列表对象字段**：读 op1/op2/op3；`_this[op1+21585]` 对象非空写 `+276=op2`、`+280=op3`。handler=sub_425EF0（raw .c 32753） |
| 0x25E | 5 | u00423124 | sub_425F50 | 仅映射 |  |
| 0x25F | 4 | u00423125 | sub_425FF0 | 仅映射 |  |
| 0x260 | 4 | u00423126 | sub_426080 | 已核对 | **消息窗配置字段×4**：读 op1..op4 写 `_this[80102]/[80103]/[80104]/[80105]`。handler=sub_426080（raw .c 32813） |
| 0x261 | 1 | u00423127 | sub_4260F0 | 已核对 | **消息窗配置字段**：读 op1 写 `_this[80101]`。handler=sub_4260F0（raw .c 32832） |
| 0x2BC | 11 | u00423020 | sub_426120 | 仅映射 |  |
| 0x2BD | 1 | u00423100 | sub_426200 | 已核对 | **文本对象字段+字体重建**：读 op1；`op1≠0` 时置文本对象字段 `_this[75953]`/`_this[21636]` 为 700（否则 0），调 `sub_459F40()` 应用/重建字体。handler=sub_426200（raw .c 32884） |
| 0x2BE | 1 | u00423140 | sub_426260 | 仅映射 |  |
| 0x2BF | 3 | u00423180 | sub_4262C0 | 仅映射 |  |
| 0x2C0 | 3 | u004231C0 | sub_426310 | 仅映射 |  |
| 0x2C1 | 1 | u00425BC0 | sub_433CE0 | 仅映射 |  |
| 0x2C2 | 6 | u00425CD0 | sub_433DE0 | 仅映射 |  |
| 0x2C3 | 2 | u00423200 | sub_430890 | 仅映射 |  |
| 0x2C4 | 0 | u00416450 | sub_41A3F0 | 仅映射 |  |
| 0x2C5 | 2 | strlen | sub_430900 | 推测 | 字符串长度。未读体 |
| 0x2C6 | 2 | u0042B5E0 | sub_430940 | 仅映射 |  |
| 0x2C7 | 4 | u0042B5F0 | sub_433FD0 | 仅映射 |  |
| 0x2C8 | 4 | u0042B610 | sub_434260 | 仅映射 |  |
| 0x2C9 | 3 | 2C9 | sub_4344A0 | 仅映射 |  |
| 0x2CA | - | （age-shared 未收录） | sub_430990 | 仅映射 |  |
| 0x2CB | - | （age-shared 未收录） | sub_426360 | 仅映射 |  |
| 0x2CC | 1 | 2CC | sub_4309E0 | 仅映射 |  |
| 0x2CD | 1 | 2CD | sub_426390 | 仅映射 |  |
| 0x2CE | 1 | u0042B616 | sub_430A20 | 仅映射 |  |
| 0x2CF | 1 | u0042B617 | sub_4263D0 | 仅映射 |  |
| 0x2D0 | 3 | u0042B940 | sub_430A50 | 仅映射 |  |
| 0x2D1 | 3 | u0042B950 | sub_430AB0 | 仅映射 |  |
| 0x2D2 | 3 | u0042B960 | sub_430B10 | 仅映射 |  |
| 0x2D3 | 3 | u0042B970 | sub_430B70 | 仅映射 |  |
| 0x2D4 | - | （age-shared 未收录） | sub_430BD0 | 仅映射 |  |
| 0x2D5 | 2 | float-mov | sub_430C30 | 已核对 | **float mov**：`op1 = op2`（`readFloatOperand(2)` → `writeFloatOperand(1)`）。handler=sub_430C30（raw .c 39455）。旧 label `u0042B990` |
| 0x2D6 | - | （age-shared 未收录） | sub_430C70 | 仅映射 |  |
| 0x2D7 | 2 | u0042B9B0 | sub_430CB0 | 仅映射 |  |
| 0x2D8 | 3 | set-array-to | sub_430CF0 | 已核对 | `op1 起 count 个槽填 op2 值`（**脚本值 bulk 填充**；对比 copy-to-global 固定 0）：`v2=&op1; v5=ENC(op2); n=op3; memset32(v2,v5,n)`。handler=sub_430CF0（raw .c 40206） |
| 0x2D9 | 2 | u0042BA30 | sub_430D60 | 仅映射 |  |
| 0x2DA | 8 | u004234E0 | sub_426420 | 仅映射 |  |
| 0x2DB | 1 | u004235C0 | sub_426500 | 已核对 | **文本对象字段+字体重建**：读 op1 写 `_this[71744]`，调 `sub_459F40()` 重建字体。handler=sub_426500（raw .c 33015） |
| 0x2DC | 1 | u0042BA80 | sub_430DB0 | 仅映射 |  |
| 0x2DD | 2 | u0042D880 | sub_434720 | 仅映射 |  |
| 0x2DE | 2 | u0042BAC0 | sub_430DF0 | 已核对 | **字符串→索引查表**：`sub_41B640(2)` 读 op2 字符串 → `sub_428990(_this[50416] 表)` 查找（跳过前导 `@`，未命中=-1）→ `writeIntOperand_42B4B0(1, idx)` 写回 op1。handler=sub_430DF0（raw .c 39525） |
| 0x2DF | 3 | u0042BAC1 | sub_430E30 | 仅映射 |  |
| 0x2E0 | 3 | u0042CE0F | sub_430EA0 | 仅映射 |  |
| 0x2E1 | 3 | u0042CE10 | sub_430F10 | 仅映射 |  |
| 0x2E2 | 3 | u0042CE11 | sub_430F80 | 仅映射 |  |
| 0x2E3 | 3 | u0042CE30 | sub_430FF0 | 仅映射 |  |
| 0x2E4 | 3 | u0042CE31 | sub_431060 | 仅映射 |  |
| 0x2E5 | 1 | u0042CE50 | sub_4310D0 | 仅映射 |  |
| 0x2E6 | 2 | u0042CE60 | sub_431110 | 仅映射 |  |
| 0x2E7 | 2 | u0042CE70 | sub_426540 | 仅映射 |  |
| 0x2E8 | 1 | u0042CE80 | sub_4265E0 | 仅映射 |  |
| 0x2E9 | 1 | u0042CE90 | sub_426620 | 仅映射 |  |
| 0x2EA | 1 | u0042CEA0 | sub_4311B0 | 仅映射 |  |
| 0x2EB | 1 | u0042CEB0 | sub_434830 | 仅映射 |  |
| 0x2EC | 2 | u0042CEC0 | sub_4311F0 | 仅映射 |  |
| 0x2ED | - | （age-shared 未收录） | sub_431230 | 仅映射 |  |
| 0x2EE | 1 | u0042CEC2 | sub_426650 | 已核对 | **消息派发**：读 op1 写 `_this[80106]`，并经 `_this[174405]` 对象 vtable+12 以 `"message"`+op1 派发消息/自动消息。handler=sub_426650（raw .c 33078） |
| 0x2EF | 11 | u0042CEC3 | sub_431270 | 仅映射 |  |
| 0x2F0 | 9 | u0042CEC4 | sub_431460 | 仅映射 |  |
| 0x2F1 | 7 | u0042CEC5 | sub_4316E0 | 仅映射 |  |
| 0x2F2 | 6 | u0042CEC6 | sub_4318A0 | 仅映射 |  |
| 0x2F3 | 6 | 2F3 | sub_431A10 | 仅映射 |  |
| 0x2F4 | 3 | 2F4 | sub_4266A0 | 仅映射 |  |
| 0x2F5 | 4 | 2F5 | sub_4267D0 | 仅映射 |  |
| 0x2F6 | 1 | 2F6 | sub_426820 | 已核对 | **声音通道管理**：读 op1=通道；写 `_this[30*cur+95805]=3`；`sub_4BB9F0(_this+21032, op1)` 重置通道（`sub_4B6390`），清通道字段；`sub_404CB0()` 找空闲通道存 `_this[122501]` 返回。handler=sub_426820（raw .c 33161） |
| 0x2F7 | 1 | 2F7 | sub_426890 | 仅映射 |  |
| 0x2F8 | 2 | 2F8 | sub_4268D0 | 已核对 | **设声音通道音量**：读 op1=通道、op2=音量；`sub_4B6940(op1+12, op2)` 钳制 ±10000 写 `_this[op1+12+375]` 并应用；通道越界报错。handler=sub_4268D0（raw .c 33188） |
| 0x2F9 | 7 | 2F9 | sub_431AA0 | 仅映射 |  |
| 0x2FA | 1 | 2FA | sub_426910 | 仅映射 |  |
| 0x2FB | 1 | 2FB | sub_431B60 | 仅映射 |  |
| 0x2FC | 5 | 2FC | sub_431BA0 | 仅映射 |  |
| 0x2FD | 6 | 2FD | sub_431CF0 | 仅映射 |  |
| 0x2FE | 1 | 2FE | sub_4332D0 | 已核对 | **set-font（校验列表）**：读 op1 字体名，调 `sub_432DD0(_this+21324, font)` 校验在可选字体列表中、拷字体名字段、`sub_45A6E0` 重建；不在列表则警告。handler=sub_4332D0（raw .c 41052） |
| 0x2FF | 2 | 2FF | sub_426940 | 仅映射 |  |
| 0x300 | 3 | 300 | sub_426990 | 仅映射 |  |
| 0x301 | 1 | 301 | sub_4269F0 | 仅映射 |  |
| 0x302 | 2 | 302 | sub_426A30 | 仅映射 |  |
| 0x303 | 3 | 303 | sub_426A90 | 已核对 | **UI/消息对象字段**：读 op1/op2/op3 调 `sub_456600(_this+21324, op1, op2, op3)`，对选中对象写 `+288=op2`、`+292=op3`。handler=sub_426A90（raw .c 33256） |
| 0x304 | 0 | 304 | sub_41A420 | 仅映射 |  |
| 0x305 | 0 | 305 | sub_41B1C0 | 仅映射 |  |
| 0x306 | 1 | 306 | sub_431FC0 | 仅映射 |  |
| 0x307 | 1 | 307 | sub_426AE0 | 仅映射 |  |
| 0x308 | 1 | 308 | sub_426B20 | 已核对 | **输入触摸注册**：读 op1，调全局输入管理器 `sub_407B20(_this[96981], op1)`（LoadLibrary+GetProcAddress 注册/注销触摸），置 `_this[1954]`。handler=sub_426B20（raw .c 33282） |
| 0x309 | - | （age-shared 未收录） | sub_432000 | 仅映射 |  |
| 0x30A | 2 | 30A | sub_426B60 | 已核对 | **SetGesKey**：读 op1=值、op2=索引；`op1>0x1F` 或 `op2>7` 抛 ShowMessage「SetGesKey」，否则写 `_this[op2+1969]=op1`。handler=sub_426B60（raw .c 33292） |
| 0x320 | 10 | create-mesh | sub_432150 | 已核对 | **顶点网格配置**：读 op1/9/10 及多操作数；`op9>0` 时申请缓冲、用 key `_this[388236]`（ROL11^XOR^ROR25）解码顶点，`sub_4ADFE0(_this+322832, obj, …)` 配置网格（顶点+索引+材质）；`op9≤0` 报「頂点数%dは不正です．」。fire-and-forget。handler=sub_432150（raw .c 40262）。旧 label `u0043AA20` |
| 0x321 | 3 | u0043AA30 | sub_426BD0 | 仅映射 |  |
| 0x322 | 4 | u0043AA40 | sub_426C20 | 已核对 | **set-vertex-color**：读 op1=网格id、op2/3/4；op3/op4 作颜色分量（clamp/回退），组装 32 位色 → `sub_4AE2C0(_this+80708, op1, op2, color)` 写网格顶点色。handler=sub_426C20（raw .c 33324） |
| 0x323 | 5 | u0043AA50 | sub_426CF0 | 已核对 | **set-vertex-color-alpha**：读 op1=网格id、op2/3/4/5；组装色（含 alpha）→ `sub_4AE330(_this+80708, op1, op2, op3, color)` 写网格顶点色+alpha。handler=sub_426CF0（raw .c 33358） |
| 0x324 | 0 | u0043AA60 | sub_41A470 | 已核对 | **消息/文本子系统方法**：取 `_this[93384]` 对象指针调外部弱符号 `sub_453530`（本文件无实现；fire-and-forget）。handler=sub_41A470（raw .c 25148） |
| 0x325 | 2 | u0043AA70 | sub_426DC0 | 仅映射 |  |
| 0x326 | 4 | u0043AA80 | sub_426E10 | 仅映射 |  |
| 0x327 | 1 | u0043AA90 | sub_426E70 | 仅映射 |  |
| 0x328 | 3 | u0043AAA0 | sub_432300 | 仅映射 |  |
| 0x329 | 2 | u0043AAB0 | sub_426EB0 | 仅映射 |  |
| 0x32A | 1 | 32A | sub_426F80 | 仅映射 |  |
| 0x32B | 0 | u0043AAD0 | sub_41A4A0 | 仅映射 |  |
| 0x32C | 6 | u0043AAE0 | sub_426FC0 | 仅映射 |  |
| 0x32D | 2 | u0043AAF0 | sub_427040 | 仅映射 |  |
| 0x32E | 11 | u0043AB10 | sub_427110 | 仅映射 |  |
| 0x32F | 1 | u0043AB11 | sub_4272B0 | 已核对 | **网格项清除**：读 op1 调 `sub_49A150(_this+80708, op1)` 清 `_this[op1+13677]=0` 并 vtable+212 方法触发图形副作用。handler=sub_4272B0（raw .c 33579） |
| 0x330 | 2 | u0043AB12 | sub_4272F0 | 仅映射 |  |
| 0x331 | - | （age-shared 未收录） | sub_427330 | 仅映射 |  |
| 0x332 | 4 | u0043AB14 | sub_427380 | 仅映射 |  |
| 0x333 | - | （age-shared 未收录） | sub_427450 | 仅映射 |  |
| 0x334 | 1 | u0043AB16 | sub_427520 | 仅映射 |  |
| 0x335 | 4 | u0043AB17 | sub_427560 | 仅映射 |  |
| 0x336 | - | （age-shared 未收录） | sub_4275F0 | 仅映射 |  |
| 0x337 | 4 | u0043AB19 | sub_427680 | 仅映射 |  |
| 0x338 | - | （age-shared 未收录） | sub_427700 | 仅映射 |  |
| 0x339 | - | （age-shared 未收录） | sub_4277A0 | 仅映射 |  |
| 0x33A | - | （age-shared 未收录） | sub_427840 | 仅映射 |  |
| 0x33B | 4 | u0043AB1D | sub_4278D0 | 仅映射 |  |
| 0x33C | - | （age-shared 未收录） | sub_427950 | 仅映射 |  |
| 0x33D | 3 | u0043AB1E | sub_4279B0 | 仅映射 |  |
| 0x33E | 5 | u0043AB1F | sub_427A00 | 仅映射 |  |
| 0x33F | 3 | u0043AB20 | sub_427A90 | 仅映射 |  |
| 0x340 | 1 | 340 | sub_427B60 | 仅映射 |  |
| 0x341 | 2 | 341 | sub_427BA0 | 仅映射 |  |
| 0x342 | 1 | 342 | sub_427C70 | 仅映射 |  |
| 0x343 | - | （age-shared 未收录） | sub_41A4E0 | 仅映射 |  |
| 0x344 | 2 | 344 | sub_427CB0 | 仅映射 |  |
| 0x345 | 3 | 345 | sub_427CF0 | 仅映射 |  |
| 0x346 | - | （age-shared 未收录） | sub_427DD0 | 仅映射 |  |
| 0x347 | - | （age-shared 未收录） | sub_427E10 | 仅映射 |  |
| 0x348 | - | （age-shared 未收录） | sub_427EA0 | 仅映射 |  |
| 0x349 | 4 | 349 | sub_427F30 | 仅映射 |  |
| 0x34A | - | （age-shared 未收录） | sub_427FB0 | 仅映射 |  |
| 0x34B | - | （age-shared 未收录） | sub_428030 | 仅映射 |  |
| 0x34C | - | （age-shared 未收录） | sub_4280D0 | 仅映射 |  |
| 0x34D | 6 | 34D | sub_428170 | 仅映射 |  |
| 0x34E | 4 | 34E | sub_428200 | 仅映射 |  |
| 0x34F | - | （age-shared 未收录） | sub_428400 | 仅映射 |  |
| 0x350 | - | （age-shared 未收录） | sub_4282E0 | 仅映射 |  |
| 0x351 | - | （age-shared 未收录） | sub_428320 | 仅映射 |  |
| 0x352 | 3 | 352 | sub_4283B0 | 仅映射 |  |

---

## 回退默认 `sub_418E30` 的 opcode（age-shared 已定义，本引擎未实现）

> 这些条目在 dispatch 表里**没有被覆盖**（`rep stosd` 填充后保持默认 `sub_418E30`），多为引擎家族其它作品的专属 opcode。

| opcode | argc | 名称 | 归属作品（age-shared 注释） |
|---|---|---|---|
| 0x262 | 1 | 262 | Amayui 2 |
| 0x263 | 1 | 263 | Amayui 2 |
| 0x264 | 5 | 264 | Hyakusen |
| 0x30C | 1 | 30C | Tenmei no Conquista |
| 0x353 | 2 | 353 | Fuukan no Gransesta |
| 0x354 | 2 | 354 | Fuukan no Gransesta |
| 0x358 | 5 | 358 | Amayui 2 |
| 0x35A | 5 | 35A | Amayui 2 |
| 0x35B | 2 | 35B | Fuukan no Gransesta |
| 0x35C | 2 | 35C | Fuukan no Gransesta |
| 0x35D | 3 | 35D | Fuukan no Gransesta |
| 0x35F | 3 | 35F | Fuukan no Gransesta |
| 0x360 | 3 | 360 | Fuukan no Gransesta |
| 0x361 | 2 | 361 | Fuukan no Gransesta |
| 0x363 | 3 | 363 | Amayui 2 |
| 0x364 | 3 | 364 | Amayui 2 |
| 0x384 | 3 | 384 | Tenmei no Conquista |
| 0x386 | 11 | 386 | Tenmei no Conquista |
| 0x387 | 8 | 387 | Tenmei no Conquista |
| 0x388 | 3 | 388 | Tenmei no Conquista |
| 0x389 | 6 | 389 | Tenmei no Conquista |
| 0x38F | 6 | 38F | Tenmei no Conquista |
| 0x390 | 7 | 390 | Tenmei no Conquista |
| 0x391 | 2 | 391 | Amayui 2 |
| 0x392 | 1 | 392 | Tenmei no Conquista |
| 0x393 | 6 | 393 | Amayui 2 |
| 0x396 | 5 | 396 | Tenmei no Conquista |
| 0x398 | 3 | 398 | Amayui 2 |
| 0x399 | 7 | 399 | Tenmei no Conquista |
| 0x39B | 5 | 39B | Amayui 2 |
