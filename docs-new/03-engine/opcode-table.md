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
> **音频族**（`0xB4`..`0xC7`、`0x1BD`、`0x2BF`/`0x2C0`、`0x2F4`..`0x302`）的整体机制——设备 / SE / Voice / Music 三模块、15 条通道、`sound:Volume0..4` 路由、ADV 文本↔语音联动——见 [`./sound-system.md`](./sound-system.md)。

## 全部 544 个已映射 opcode

| opcode | argc | 名称（age-shared） | 引擎位置（handler） | 分析状态 | 已知语义 |
|---|---|---|---|---|---|
| 0x1 | 0 | abort | sub_418E60 | 已核对 | **程序中止**：`_CxxThrowException(&1, Command_Exit)` —— 立即退出整个程序。handler=sub_418E60（raw .c 24419）。emulator：`op_abort` → 抛 `ExitScript`（程序退出信号）；渲染窗捕获后经 IPC `close-window` 关闭主窗口，headless(run.ts) 捕获后停执行 |
| 0x2 | 0 | exit | sub_41A820 | 已核对 | 跨脚本**返回调用层**（`cur=frame.caller`；顶层 caller<0 才程序退出）。handler=sub_41A820（raw .c 25629） |
| 0x3 | 1 | call-script | sub_41C6A0 | 已核对 | 读 operand1=目标脚本索引 → 压帧（cur++）+ 装载新脚本帧。handler=sub_41C6A0（raw .c 26762） |
| 0x4 | 2 |  | sub_41C770 | 仅映射 |  |
| 0x5 | 0 | ret | sub_41A9B0 | 已核对 | **同脚本**子程序返回（弹每帧返回栈 `256*cur+97193`；栈空 no-op）。handler=sub_41A9B0（raw .c 25704） |
| 0x6 | 2 | load-frame | sub_41C7C0 | 已核对 | **load-frame**（曾名 `i006`，即 load-script-into-frame）：`op1=目标脚本索引, op2=帧编号`。备份/恢复 `cur`（`_this[383104]`↔`_this[383108]`），把脚本 `op1` 解析并装入帧 `op2`（`loadScriptFrame_40ED40`）；`op2≥40` 抛 ShowMessage「ファイルの階層が深すぎます．最大は%dです．」、装载失败抛 Exit。SYSTEM4 帧布局初始化（预装）用。handler=sub_41C7C0（raw .c 26823） |
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
| 0x32 | 10 |  | sub_41E2D0 | 已核对 | **槽→槽的缩放转送**（引擎名 **StretchTexture**）：op1=源槽、op2=目标槽、op3..6=源矩形 `(x,y,w,h)`、op7..10=目标矩形；引擎把两对化开成 `[x1,y1,x2,y2]`（raw 27974-27983）后按 `set:DrawMode`（`Engine[166964]`）分路：`==0`（GDI）→ 文本/2D 对象的同名转送；`!=0`（D3D）→ `sub_4A87A0(Scene, 源槽, 目标槽, &源, &目标)`（raw 127933-128129）——**两个矩形各自按所在 surface 的边界夹取、一侧被夹时另一侧按比例跟随**（位移量 `(int)` 截断），再缩放转送（`sub_4A7990` → `sub_4A42C0`）；源/目标 surface 不存在 ⇒ 打「コピー元/コピー先テクスチャが作成されていません． TEXTURE=%d」返回 0。★语料 **337 处、形态完全一致**：`i032 2 e 0 0 500 2d0 0 0 140 b4`（全屏槽 2 的 (0,0,1280,720) → 槽 0xe 的 (0,0,320,180)），上下文 = `create-texture 2 500 2d0 2` → `i20d 2` → `i20e` → `i20c` → 还原渲染目标 → `create-texture e 140 b4 2` → **本指令** → `i1ae … e`（写 `.STH`）⇒ **存档缩略图的『缩屏』这一步**（`src/SN0000.txt:3171-3184`、`src/SC5450.txt:3009-3021` 等）。handler=sub_41E2D0（raw .c 27955）。emulator：`GFX_STATE_OPS` 的 `op_stretch_texture`，与 `0x207` 共用宿主缝 `blitSlotToSlot`（Pixi 在两张画布间 `drawImage`；headless 只记 `scene.render4.blits`），守卫 `test/op-032-stretch-texture.test.ts` |
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
| 0x54 | 3 | mod | sub_42C6E0 | 已核对 | `op1 = op2 % op3`（**C 截断语义**：符号跟随被除数，`-5 % 3 = -2`；除数为 0 ⇒ 引擎抛除零异常。★T-0057 订正：重写侧曾用 floored 版 `((l%r)+r)%r`） |
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
| 0x70 | 5 |  | sub_41ED20 | 已核对 | **消息窗口定位尺寸**：读 op1..op5 调 `sub_45D660(_this+21324, op1..op5, 0)` 设置文本消息窗口 x/y/宽/高坐标。fire-and-forget。handler=sub_41ED20（raw .c 28401） |
| 0x71 | 1 |  | sub_41ED80 | 已核对 | **显示消息/推进文本**：读 op1 文本调 `sub_45EC60(msgobj, op1, _this[97055])`，经 `sub_48E870`/`sub_48F000` 渲染；置 flag `_this[174801]\|=0x8000000`、`_this[122455]=1`、`_this[122496]=0`。handler=sub_41ED80（raw .c 28419） |
| 0x72 | 1 | wait-for-input | sub_41EEF0 | 已核对 | **wait-for-input**：ADV「等待推进」。刷输入掩码（bit 0x40 = 跳读中）→ 与 `0x71` 同构地按 `message:ReadTextSkip` 分支判 `sub_48E870`/`sub_48F000` → 置/清 `effect_flags` 的 `0x8000000`；未显示完时把 3 个消息回调槽交付 `sub_4BB840` 并清槽。**PARTIAL**（消息槽区未建模）；handler=sub_41EEF0（raw .c 28482） |
| 0x73 | 10 |  | sub_41F250 | 已核对 | **消息窗口全面配置**：读 op1..9 调 `sub_456430(msgobj, op1..9)` 拷 0x28 字节几何/布局结构进消息窗，读 op10 调 `sub_453AD0` 置节流标量。fire-and-forget。handler=sub_41F250（raw .c 28601） |
| 0x74 | 1 |  | sub_41F320 | 已核对 | **SetMessageSpeed（仅字段）**：`Engine[21668] = op1`（= `Font+1376` = `message:MessageSpeed`）。★**不写配置注册表**（写注册表的是 `0x1B5`）。脚本用它做「这一段立即显示」：`i07f<存>` → `i074 0` → … → `i074<还原>`（全库 206 处）；handler=sub_41F320（raw .c 28642） |
| 0x75 | 1 |  | sub_41F350 | 已核对 | **主字号（全局）**：读 op1 调 `sub_4185F0(Font, op1)`（raw 24057-24071）= 写 `Font+201684 = op1`（字号）、`+1232 = -op1`（主 LOGFONT.lfHeight）、`+101972 = -op1`（注音 LOGFONT 高度），再 `sub_459F40()` **重建 GDI 字体对象/字宽**。★**不重绘任何已排版的窗**（作用域规则见 `adv-text-rendering.md` §3.5 / 台账 `text-style-scope-queue-time`）。handler=sub_41F350（raw .c 28653） |
| 0x76 | 1 |  | sub_41F390 | 已核对 | **主填充色（全局）**：读 op1（COLORREF，BGR），字节序翻转成 RGB 写 `Font+1360`（= `_this[21664]`），再 `sub_459F40()` 重建字体对象。★**不是"滚动类属性"、"写字段≠重绘"**：已排版的窗保持入队时的颜色，否则会跨窗溢色（2026-09 实测：角色设定页逐行设色把 ADV 样例窗染色）。handler=sub_41F390（raw .c 28662-28671） |
| 0x77 | 1 |  | sub_41F3F0 | 已核对 | **主描边/阴影色（全局）**：同 0x76 的字节序翻转后写 `Font+1364`（= `_this[21665]`），再 `sub_459F40()`。作用域同 0x76（入队时消费）。handler=sub_41F3F0（raw .c 28673-28682） |
| 0x78 | 1 |  | sub_41F450 | 已核对 | **描边/阴影档位（全局）**：读 op1 写 `Font+1372`（= `_this[21667]`：0 无 / 1 单向投影 / 2 同位置 1/4 副本 / 3 多向描边），调 `sub_459F40()`。作用域同 0x76。handler=sub_41F450（raw .c 28685） |
| 0x79 | 3 |  | sub_41F490 | 已核对 | **文字起点（写窗对象 `+28/+32`）**：读 op1..op3 调 `sub_4563A0(_this+21324, op1, op2, op3)`；该函数取 `Font[win+261]`（win=0 时用 `Font[307]` 的默认窗；`Font+0x414+4*win` = `Engine[21585+win]` 对象表项）后 `obj+28 = op2; obj+32 = op1`（sub_4563A0 raw 68233-68246）。⚠️ 旧注「选中子项 +28/+32」有误：`+28/+32` 是**窗对象**字段。fire-and-forget。handler=sub_41F490（raw .c 28696） |
| 0x7A | 3 |  | sub_41F4E0 | 已核对 | **消息窗对象的文本项缓冲写游标参数**：`sub_45A910(Font, op1, op2, op3)` —— `win = op1 ?: Font[307]`、`obj = Font[win+261]`，写 `*(obj[48]-20)=op2`、`*(obj[48]-16)=op3`。handler=sub_41F4E0（raw 28710-28721）。语料 0 处。emulator：`OPS` 的 `op_msgwin_obj_pre48`（写 `MsgObject.pre48a/pre48b`）。 |
| 0x7B | 2 |  | sub_41F530 | 已核对 | **设本帧「重显示」回退游标**：`_this[cur+122372]=op1`、`[cur+122412]=op2`（值 = **指令下标**，缺省 -1）。读者 = `0x199`（raw 24506/24520）与主循环 raw 14001-14008。handler=sub_41F530（raw 28724-28733）。语料 0 处。emulator：`OPS` 的 `op_set_rewind_cursor`。★原表把读者记成「点击路由游标」是误（路由表是 `0x090` → `Engine.routes`）。 |
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
| 0x88 | 1 |  | sub_41FAB0 | 已核对 | **消息显示/跳读模式**：读 op1，同时写引擎字段 `_this[1415]` 与全局数组槽 `_this[97050]`；非零置 `_this[122368]=1`，零则清 `_this[174801]` 的 0x8000000 位。（写全局数组故为 VM 可见）handler=sub_41FAB0（raw .c 28965） |
| 0x89 | 4 |  | sub_41FB00 | 仅映射 |  |
| 0x8A | 6 |  | sub_41FB50 | 仅映射 |  |
| 0x8B | 1 |  | sub_41FBF0 | 已核对 | **行间距（`Font+1380` = `Engine[21669]`）**：读 op1 写该字段。★**不是颜色**（旧口径误记成「第四色」）；换行步进 = 字号 + 本字段（`sub_46AF90` raw 82674-82690 `v7 = v8 + *(this+1380)`），初值 6（raw 78858）。ADV 标准样式前导写 `i08b 10`（=16）⇒ 行距 30+16 = 46px；漏了它注音（画在行顶上方一个注音字高）会压到上一行（`tickets/T-0038`）。handler=sub_41FBF0（raw .c 29021-29030） |
| 0x8C | 1 | jmp | sub_4203D0 | 已核对 | 跳到 operand1 的 label（无条件，不入栈） |
| 0x8D | 2 |  | sub_420450 | 仅映射 |  |
| 0x8E | 1 |  | sub_4204D0 | 仅映射 |  |
| 0x8F | 1 | call | sub_420560 | 已核对 | 同脚本子程序调用：push 下一指令到每帧返回栈，跳 label；operand==-1 则弹回不跳。handler=sub_420560（raw .c 29452） |
| 0x90 | 7 |  | sub_420640 | 已核对 | **登记点击热点 / 路由项**：`i090 <x> <y> <w> <h> <labelA> <labelB> <labelC>` → `sub_403B30(Engine+0x55D8, x, y, x+w, y+h, labelA, labelB, labelC, 帧参数)`；入队失败（表满 100）抛 `Command_ShowMessage`；随后置游标 `Engine[7468] = -1`、推进标志 `Engine[7466] = 0`。**PARTIAL**；handler=sub_420640（raw .c 29477-29518） |
| 0x91 | 1 |  | sub_420740 | 已核对 | **消息面显示态开**：`Engine[12956]`（关闭已发生）非 0 ⇒ 只清 `12956`/`12958`；否则 `effect_flags = (flags & 0xF77FFFFF) \| 0x800000` + `sub_404020(panelA, op1)`（首次显示时按当前鼠标做一次命中测试 + 写步长/待填充）。handler=sub_420740（raw 29522-29543）。★`0x800000` 的读取端是 `sub_4098E0`（raw 14055-14105：左键 → `sub_404120` = 取游标 labelC **并清整表**；否则派发 `[7467]` 回退 label）—— **emulator 未实现该通路**（`i091` 语料 0 处，已登记缺口）。emulator：`OPS` 的 `op_panel_show`。 |
| 0x92 | 2 |  | sub_4207D0 | 已核对 | 同 `0x91`，但**先**写回退 label `Engine[12961] = op2`（`sub_4098E0` 在"没有 enter/leave 也没有点击"时派发它），再 `sub_404020(panelA, op1)`。handler=sub_4207D0（raw 29546-29568）。emulator：`op_panel_show_fallback`。 |
| 0x93 | 0 |  | sub_4191D0 | 已核对 | **消息面显示态关**：`effect_flags &= ~0x800000`；`sub_403EF0(面板)` 复位面板状态（`[258]=0`、`[959]=-1`、`[960]=0`、`[7464]=0`、`[7466]=0`、`[7467]=-1`、`[7468]=-1`）；再 toggle：`Engine[12957] ? =0 : Engine[12956]=1`。handler=sub_4191D0（raw 24589-24601）。★面板对象 = `Engine+0x55D8`（`_this + 5494`，也是点击热点/路由表的宿主）。★**订正（2026-09）**：`[258]` **就是路由表的条目数**（命中测试 `sub_403C50` raw 9819 读的就是它）⇒ `[258]=0` = **清空整张路由表**（旧行写的"不清路由条目表"是错的：那样 UI 例程每次 `i093` + 重登记都会累积热点，实测 14→33→40）。★`[7465]` **不**被 `sub_403EF0` 复位（raw 9958-9971 里没有它）。`i093` 语料 334 处。emulator：`OPS` 的 `op_message_surface_off`（调 `routes.reset()`）。 |
| 0x94 | 0 |  | sub_419230 | 已核对 | **消息面显示态开**：`Engine[12957] = 1`；`sub_404020(面板, 10000)` —— 已初始化（`[7465]`）则置步长 `[960]=10000` + 待填充 `[7464]=1`，否则置初始化标记并**按当前鼠标坐标重做一次命中测试**（`GetCursorPos`→`sub_403C50`）。handler=sub_419230（raw 24604-24609）。★**这是命中测试的两个时机之一**（另一个是 WM_MOUSEMOVE 的 `sub_4B8D50` raw 140825-140836）；**等待泵里没有命中测试**。`i094` 语料 334 处。emulator：`op_message_surface_fill`（`Engine.routes.hitTest` + `RoutePanel.pageStep/fillPending`）。 |
| 0x95 | 2 |  | sub_420870 | 仅映射 | **未实现（panelB 通路）**：`sub_420870` raw 29570-29590 = panelB（`Engine+0x32B0`）的 `0x92` 同型（`[20438]` toggle + `effect_flags \| 0x10000000` + `[20443] = op2` + `sub_4040A0(panelB, op1)`）。`i095` 语料 **0 处**，emulator 未建模 panelB（缺口已登记）。 |
| 0x96 | 0 |  | sub_419260 | 仅映射 | **未实现（panelB 通路）**：`sub_419260` raw 24612-24624 = `effect_flags &= ~0x10000000` + `sub_403EF0(panelB)` + `[20439]/[20438]` toggle。`i096` 语料 **0 处**（缺口已登记）。 |
| 0x97 | 5 |  | sub_420910 | 已核对 | **把输入掩码位绑到某个热点（键位绑定）**：矩形 `{op1, op2, op1+op3, op2+op4}` + 掩码位 `op5` → `sub_403D10(panelA, rect, op5)`：逐项比较矩形**四字段全等**，全等的那一项写 `[7361+i] = op5`（**没有全等项则静默什么都不做**）。handler=sub_420910（raw 29596-29612）；`sub_403D10` raw 9827-9844。★**订正（2026-09）**：旧行写的"面板填矩形"是**错的** —— `[7361+i]` 的唯一读者是 `sub_403D70`（raw 9847-9862：按下掩码位命中 → 取 `[459+i]` = **labelC**），即 `0x97` 是**键位绑定表**的写入端。★语料实证（`SN0000.txt:79-114`，334 个 ADV 脚本同型）：先 `i090 x y 1 1 ffffffff ffffffff <labelC>` 登记一个**屏幕外**（`y = 0-0x3e8`）的 1×1 热点，紧接 `i097 x y 1 1 <bit>` 绑位 ⇒ **这就是 ADV「键盘推进」的入口**。`i097` 语料 6 处。emulator：`OPS` 的 `op_message_surface_rect` → `routes.bindKeyBit`（旧的 `native.fillPanelRect` 直通链路**已删**）。 |
| 0xA0 | 3 | jcc | sub_4209B0 | 已核对 | **两目标条件跳转**（仅 3 个操作数）：`op1=条件`（非 0 为真）；`op1≠0`→跳 `op2`（若 `op2==0xFFFFFFFF` 则落下句）；`op1==0`→跳 `op3`（若 `op3==0xFFFFFFFF` 则落下句）。 |
| 0xA1 | 0 | menu-reset | sub_433A40 | 已核对 | **菜单派发表复位**：`sub_415530(_this+107679, 0xFFF)`（0xFFF=容量/上限）。清空菜单对象 `_this+107679` 的内存表（字符串哈希表）。handler=sub_433A40（raw .c 42046）。emulator：`op_menu_reset` → `engine.menuMap.clear()` |
| 0xA2 | 2 | menu-bind | sub_434F10 | 已核对 | **登记菜单项 key→label**：读 op1(字符串键,sub_41B640)+op2(值,sub_41BF50) → `sub_434D00(_this+107679, key, &value)` 插入内存表。TITLE：`i0a2 (local40d) 44f / 0 452 / 1 481 / 2 4a3 / 3 52d / 4 540`。handler=sub_434F10（raw .c 42908）。emulator：`op_menu_bind` key=String(DEC(op1))、value=DEC(op2) → `menuMap.set(key,value)`（**注意**：引擎 sub_41B640 读 string；TITLE 用菜单项序号(-1/0/1/2/3/4)为键，emulator 取 op1 的 DEC 值字符串化） |
| 0xA3 | 2 | menu-dispatch | sub_429830 | 已核对 | **按 key 查表派发**：读 op1(字符串键,sub_41B640) → `sub_428E00(_this+107679, key)` 查；命中 `ip = str_table + 4*值`（跳转），未命中跳 op2(回退 label)。handler=sub_429830（raw .c 35742）。emulator：`op_menu_dispatch` key=String(DEC(op1))，target=menuMap.get(key) ?? DEC(op2)，`labelPos(target)` 命中则 `jump` |
| 0xAA | 2 |  | sub_42D580 | 已核对 | **写文件（保存族）**：读 op2=字符串表下标 → `CreateFileA(名, GENERIC_WRITE, 0, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, 0)`；失败 ⇒ ShowMessage + 写 `op1 = 1`；成功 ⇒ 取注册表 `set:SaveVersion` 经 `sub_40CD10(this, 文件, 版本, "set:SaveVersion")` 写文件、CloseHandle、写 `op1 = 返回值`。★订正：数据层早期误标为「文本项记录查询」（那条是 `0x2F3`/sub_431A10）；handler=sub_42D580（raw .c 38148-38175） |
| 0xAB | 2 |  | sub_42D650 | 仅映射 |  |
| 0xAC | 9 |  | sub_42D700 | 仅映射 |  |
| 0xAD | 0 |  | sub_4192C0 | 已核对 | **秒计时器推进**（`sub_4380F0` raw 45095-45103）：`obj[259] = obj[260]`、`obj[258] = (274877907i64 * timeGetTime()) >> 38`（≈ ms/1000，定点近似）⇒ `_this[5450] ← _this[5451]`、`_this[5449] ← timeGetTime()/1000`。handler=sub_4192C0（raw 24627-24631）。语料 0 处。emulator：`op_seconds_timer`（`BigInt` 复刻同一算术，避免 JS 双精度在 2^59 丢位）。 |
| 0xAE | 0 |  | sub_4192F0 | 已核对 | **存档版本分支指令（读档续跑）**：经 `_this+174405` 对象 vtable 读存档版本（"set:SaveVersion1"/"set:SaveVersion2"），按版本(1/2/3/20)重算每脚本 ip（`_this[30*x+95782/95803/95804]`）、设 frame arity、切换 `cur` 或 `sub_40F750`→`loadScriptFrame_40ED40` 装载目标脚本帧；并置 `_this[95780]=0`、`_this[97054]=1`。handler=sub_4192F0（raw .c 24634）。★**两条落点分支的步长不同**（raw 24706-24723）：记录命中 `0x3` call-script 表 ⇒ `95805 = 3`（落到**调用点的下一条**），命中 `0x71` 消息表 ⇒ `95805 = 0`（**重放这条消息**）。emulator：`OPS` 的 `op_save_version_branch` 已按同一形状实现（门控 `Engine[95780] == 0` 直接返回；置位后按 `set:SaveVersion1/2` 选组 → 用**帧里那份脚本自己的**两张表落 ip → `cur < savedCur` 时装载记录[cur+1] 的脚本并切帧 → `cur == savedCur` 收尾写 `95777 = savedRet`）。帧记录来源见 `save-data.md` §7.2（`Engine.saveResume`，`tickets/T-0059`）。★订正：早期文档写"语料 0 处"是**漏计** —— `i0ae` 实际 **339 处**（脚本入口都有它，例 `src/SYSTEM4.txt:143`、`src/$1$SC0330.txt:1003`）。 |
| 0xAF | 0 |  | sub_419690 | 仅映射 |  |
| 0xB0 | 1 |  | sub_420A50 | 仅映射 |  |
| 0xB1 | 1 |  | sub_420A80 | 仅映射 |  |
| 0xB2 | 2 |  | sub_420AB0 | 仅映射 |  |
| 0xB3 | 0 |  | sub_4196B0 | 仅映射 |  |
| 0xB4 | 2 | play-sound-effect | sub_420B00 | 已核对 | **play-sound-effect（SE 装载）**：读 op1=音效 id、op2=**SE 通道号（0..9）** → `sub_4B4F60(Engine+20719, 通道, id)`：从资源库取 WAV → `sub_4B6570` 建解码缓冲并绑到设备通道 → 记 `SE[1212+通道]=id`；失败抛 `WAVファイル %s の読み込みに失敗しました`（raw 137649）。★只装载+绑缓冲，**起播要另发 0xB5（播一次）/0xBA（循环）**。★订正：早期把 op2 记作「通道指针」，实为通道号。全库 2170 处（`SP2563.txt:409 play-sound-effect 2e 1`）。handler=sub_420B00（raw .c 29678-29687） |
| 0xB5 | 1 |  | sub_420B40 | 已核对 | **SE 通道起播（播一次）**：读 op1=通道 → `sub_4B5020(Engine+20719, 通道, 0)` →（设备在 且 `SE[261]`=`sound:SE` 开关开）`sub_4B6020(设备, 通道, 0)` → 先应用待定 seek、释放在播的循环缓冲、`sub_4B73E0(缓冲, 0)`。★第 3 参就是 SoundBuffer 的**循环标志**（`+9296`，raw 139322：非 0 循环、0 播完补静音）⇒ 0xB5 播一次、0xBA 循环。通道 >0xE 报 `dsPlaySound(%d)`、通道未绑缓冲报 `dsPlay(%d)`。**纯声音侧**。全库 **2155** 处（惯用法 `play-sound-effect 2e 1` + `i0b5 1`，`SP2563.txt:409-410`）。handler=sub_420B40（raw .c 29689-29697）。emulator：`op_engine_internal` 空操作。★别与 0x5B `ne` 混（助记符缺失 ⇒ 反汇编显示 `i0b5`，2026-09 曾把 `i0b5 1` 读成 `i05b`） |
| 0xB6 | 1 |  | sub_420B80 | 已核对 | **SE 通道停止/释放**：`sub_4B5050(SE, 通道)` → `sub_4B6390(设备, 通道)`（临界区 + 引用计数 + 释放缓冲）并清 `SE[303+通道]`/`SE[262+通道]`。全库 **1732** 处（ADV 场景收尾）。handler=sub_420B80（raw .c 29699-29707） |
| 0xB7 | 1 |  | sub_420C00 | 已核对 | **BGM 当前槽起播（循环=1）**：清 `Engine[174801]` bit 0x200 + `sub_489E50(Engine+174454,100)`（推进淡出）→ `sub_489F80(Music, op1, 1)`。★**`i0b7 0` 不是"播曲号 0"，而是「重播当前曲」**（`sub_489F80` raw 106357-106369：`a2 == 0 && Music[259] != 0` ⇒ 用 `Music[259]` 起播；`Music[259] == 0` 才 `sub_489B50` 停）—— 语料 30 处里 **29 处是 `i0b7 0`**：① `CALLBACK_LOAD.txt:20`（读档还原 BGM，见 `save-data.md` §7.7）；② 换曲习语 `i0b8`（停并清 id）→ `i0b7 0`（置循环位）→ `i0c3 <曲号>`（登记新曲）→ `i0c2 <音量> <步长>`（淡入起播），例 `SC0010.txt:1648-1652`。★**op1 = 曲号**（不是统一文件 id）：引擎 `MusicBase` 查「曲号 → 文件 id」表（`sub_48DB80` raw 108738：索引 = 曲号 − 2），本作等价于 `BGM%03d.OGG`（脚本侧 `MUINIT.txt` 的 A/B 两表逐条吻合；`play-bgm 1f` = 曲号 31 = `BGM031.OGG`）。全库 30 处（另一处 `CONFIG1.txt:2465 i0b7 …` = 设置界面里预览 BGM）。handler=sub_420C00（raw .c 29719-29734） |
| 0xB8 | 0 |  | sub_419720 | 已核对 | **停 BGM**（0 操作数）：清 `effect_flags` bit0x200（在则 `sub_489E50(Music,100)` 推进淡出）→ `sub_489B50(Music)` 停播；**不动 `sound:Music` 配置**（与 0xBC 的"关模式"不同）。★`sub_489B50` 的第一件事是 `Music[259] = 0` ⇒ 它**同时清掉运行态「当前曲 id」**：此后 `0xC0` 读到 0、`i0b7 0` 也不再重播 —— 这正是"读档 BGM 必须靠存档里的 id 补回来"的那一半（`src/SAVE.txt:934` 在 `i1a1` 前一条就是 `i0b8`）。语料：`MMODE.txt:63/462/552`（BGM 鉴赏进界面/换曲试听先停上一首）。handler=sub_419720（raw 24817-24829）；emulator：`NATIVE_OPS` 的 `bgm-stop` + 清 `engineValues[174713]` |
| 0xB9 | 1 |  | sub_420C60 | 已核对 | **BGM 当前槽起播（循环=0）**：同 0xB7 的淡出清理，但 `sub_489F80(Music, op1, 0)`（不循环）；op1 == 0 同样 = **重播当前曲**（只是把 `Music[261]` 写成 0）。op1 同为**曲号**（→ `BGM%03d.OGG`）。全库 1 处（`GAMEOVER.txt:51 i0b9 20`）。handler=sub_420C60（raw .c 29736-29751） |
| 0xBA | 1 |  | sub_420BC0 | 已核对 | **SE 通道起播（循环）**：同 0xB5，但 `sub_4B5020(SE, 通道, 1)` ⇒ 循环标志 1。全库 154 处（环境音/持续音）。handler=sub_420BC0（raw .c 29709-29717） |
| 0xBB | 1 |  | sub_420D90 | 已核对 | **SE 总开关**：读 op1 → `sub_408D90`（raw 13545）：与配置 `sound:SE` 现值比较（相同则不动）→ 关时把设备 0..9 通道全 `sub_4B60C0` 停掉并写 0，开时写 1；再 `sub_406DF0(_this,2,op1)`。全库 0 处。handler=sub_420D90（raw .c 29782-29790） |
| 0xBC | 1 |  | sub_420DC0 | 已核对 | **BGM 开关/模式**：读 op1 → `if (op1 <= 2) sub_408CF0(_this, op1-1)`（raw 13515/29792-29802；★旧写的"op1 = 1..3"与 raw 的 `result <= 2` 不一致 —— op1 = 1 → a2 = 0 = **关**、op1 = 2 → a2 = 1 = **开**、op1 = 0 → a2 = −1 = 开，op1 > 2 不动作）：把配置 `sound:Music` 的值 ±3 写回（<0 视为关）→ `sub_489B50` 停（**顺手清 `Music[259]`**）→ `Music[259] = v6`（把运行态当前曲 id **装回**）→ `sub_489F80(Music, 0, Music[261])`（用当前循环位**重播该曲**）并把 `Engine[174712]` 记为新模式值 ⇒ 开关切换 = "停一次再重播"，不是静默切换。全库 0 处。handler=sub_420DC0（raw .c 29792-29802） |
| 0xBD | 1 |  | sub_42E460 | 已核对 | **读「SE 可用」→ 写 op1**：`sound:SE`==0 ⇒ 0；否则 `sound:UseDirect`==1 ⇒ 1，否则 2（DirectSound / 兜底）。handler=sub_42E460（raw .c 38597-38606） |
| 0xBE | 1 |  | sub_42E4D0 | 已核对 | **读 BGM 模式 → 写 op1**：`sound:Music` + 1。handler=sub_42E4D0（raw .c 38608-38616） |
| 0xBF | 1 | play-bgm | sub_420CC0 | 已核对 | **play-bgm**：清 `Engine[174801]` bit 0x200 并 `sub_489E50(Engine+174454, 100)`；读 op1=音乐 id → `sub_489C20(Engine+174454, id, 1)`（**幂等**：同曲同循环已在播 ⇒ 直接返回不重启）；op1 == 0 时与 `i0b7 0` 同义（重播 `Music[259]`，为 0 才停）。并按 `set:KeepMusicVoice` / `sound:MusicFadeOnVoicePlaying(Volume)` 决定 `sub_489C00` 渐隐。**PARTIAL**；handler=sub_420CC0（raw .c 29754-29780） |
| 0xC0 | 1 |  | sub_42E510 | 已核对 | **读运行态「当前曲 id」`Music[259]` → op1**（`sub_42B4B0(_this,1,_this[174713])` = writeIntOperand 写 op1）。★`174713` 就是 Music 模块（内联在 `Engine+174454`）的 `[259]`：由 `0xB7/0xB9/0xBF/0xC3` 写、`0xB8` 清 0、存档镜像 `[2]` 带走、读档装回后由 `i0b7 0` 重播（raw 17469-17471 / 19911）；**不是**配置 `sound:Music`（那个落字节 0xAAB10 = 下标 174810，raw 23676-23678）。handler=sub_42E510（raw .c 38618）。CONFIG.txt 用 `i0c0 (local-int 2)` 读"现在放的是哪首" |
| 0xC1 | 0 |  | sub_419770 | 仅映射 |  |
| 0xC2 | 2 |  | sub_420E00 | 已核对 | **BGM 淡变（双路径）**：ADV 激活（`Engine[174801]&0x8000000`）⇒ `sub_489D10(Music, op1, op2)` + `sub_489E50(Music,100)`；否则先按 `set:TransferMusic` 经 `sub_418580` 切换、置 bit 0x200、按 op2（<1000 走 ÷10、否则 ÷1000）经 `sub_453A60(Engine+107503,…)` 设节流，再 `sub_489D10(Music, op1, op2<1000?10:1)`。★`sub_489D10`（raw 106269-106320）有两个**改运行态**的副作用：① **目标 op1 == 0 ⇒ 立刻 `Music[259] = 0`**（清当前曲 id）；② 目标非 0 且（`Music[264]` 当前音量为 0 或槽未在播）且 `Music[259] != 0` ⇒ **用 `Music[259]` 起播该曲** —— 这就是换曲习语 `i0c3 <曲号>` + `i0c2 <音量> <步长>` 里真正把曲子放起来的那一步。handler=sub_420E00（raw .c 29804-29841） |
| 0xC3 | 1 |  | sub_420F10 | 已核对 | **写运行态「当前曲 id」**：`Music[259] = op1`（`Engine[174713] = op1`，**只登记、不起播**），并清 `Engine[174801]` bit 0x200 + `sub_489E50(Engine+174454, 100)`。语料 30 处，**全部紧跟 `i0b7 0`**（`SC0010.txt:1649-1650`）—— 即换曲习语的第 3 步（置循环位 → 登记新曲 → `i0c2` 淡入起播）。handler=sub_420F10（raw .c 29844-29859） |
| 0xC4 | 1 | play-voice | sub_420F70 | 已核对 | **play-voice（通道 0，播一次）**：切 `Engine[21315]`/`[21318]` 状态位；`sub_407120` 推进淡出；ADV 激活位 `0x8000000` 置位 ⇒ **只寄存**（`Engine[122505]=op1`、`Engine[122508]=0`，ADV 位清除时统一冲刷，raw 20146-20159 / 24966-24979），否则 `sub_4BB840(Voice, 0, op1, 0, Engine[5053])`（第 5 参 = 通道 pan）；再 `sub_45EEA0(Font,0,op1,0,0,pan)` 往文本项记录表登记「该文本带语音」；末尾若 `Engine[21293]`（`sound:Voice`）则 `Engine[122501]=1`。全库 **14088** 处（`play-voice (global-int f8007)` 是常态写法）。handler=sub_420F70（raw .c 29861-29912） |
| 0xC5 | 2 |  | sub_42E540 | 已核对 | **读配置写操作数**：op1 = 0..4 ⇒ `GetConfig("sound:Volume0..4")` → **写 op2**；op1 越界走报错分支（`sprintf_s(aGetvolume)` + `sub_4034D0`），不写操作数；handler=sub_42E540（raw .c 38626-38667） |
| 0xC6 | 2 |  | sub_421070 | 已核对 | **设音量**：读 op1=类别（0..4）、op2=值 → 写配置 `sound:Volume0..4` 并应用：0 ⇒ `sub_4092C0`（主音量，含设备 `[342]`）；1 ⇒ `sub_409290`（BGM：`sub_4071D0(...,1)` + `sub_489B80(Music,值)`）；2 ⇒ `sub_408260`（SE：设备 0..9 通道 `sub_4B68E0`）；3 ⇒ `sub_4082A0`（语音：设备 12..14）；4 ⇒ `sub_4071D0(...,4)` + `Engine[490000]`（影片）。越界报 `setVolume`。handler=sub_421070（raw .c 29915-29983） |
| 0xC7 | 2 |  | sub_42E670 | 已核对 | **读配置写操作数**：op1=1 ⇒ `sound:Music`（≥0 ⇒ 1）、2 ⇒ `sound:SE`、3 ⇒ `sound:Voice`、4 ⇒ `sound:Movie`（非 0 ⇒ 1）→ **写 op2**；handler=sub_42E670（raw .c 38671-38716） |
| 0xC8 | 1 | sleep | sub_4218D0 | 已核对 | **睡眠/帧让步**：读 op1=n。非 ADV 激活（`(effect_flags&0x8000000)==0`）时，n<10 → `Sleep(n)` ms；n>=10 → `sub_453A60(_this+107440,n)` 设帧率节流（`_this[6]=n` 帧间隔=n ms，`sub_453AF0` 按 `interval*frame_count-elapsed` 决定 Sleep(剩余)）——本质都**暂停≈n ms**；ADV 激活则跳过。handler=sub_4218D0（raw .c 30288）。emulator：`op_sleep` 置 `sleepUntil=nowMs+max(1,n)`、`waitFlags|=SLEEP_GATE`，渲染帧循环每帧 present 到点放行（帧让步；TITLE 菜单 `sleep 1`）。 |
| 0xC9 | 0 |  | sub_4198A0 | 仅映射 |  |
| 0xCA | 0 |  | sub_4198E0 | 仅映射 |  |
| 0xCB | 1 |  | sub_42E8E0 | 仅映射 |  |
| 0xCC | 2 | mouse-callback | sub_421980 | 已核对 | **注册鼠标跳转目标**（非函数指针）：读 op2→`_this[107664]`、`_this[107674]=cur[]depth`；op1→`sub_453A60(_this+107447, op1)`（节流对象[2]=1、[5]=timeGetTime、**[6]=op1 ? op1 : 1**）。★`[6]` = 字节 `429812` —— **就是 `0xCD` 读的节流间隔**（`sub_453A60` raw 66101-66113）⇒ TITLE/CHARMEDIT/SAVE/CONFIG1 的 `mouse-callback 10`（**十六进制** = 0x10）= **16ms**，GAMESTART/ROOM/MMODE/FIELD 等的 `32` = 0x32 = **50ms**。脚本主循环每次 `get-input-type`(0xCD) 就跳到 `_this[107664]`（与「是否按下」无关：`[107664]` 只被 0xCC 写、只被 0xCD 读）。handler=sub_421980（raw .c 30317） |
| 0xCD | 0 | get-input-type | sub_41ACD0 | 已核对 | **消息/ADV"点击推进"门**：置 `_this[120*cur+383220]=1`；`timeGetTime()-_this[429808]` 与 `_this[429812]`（**节流间隔 = 最后一次 `mouse-callback`(0xCC) 的 op1**，见 0xCC；只有从未登记过回调时才是 bss 0）比较，或 `(effect_flags&0x8000000)` 激活即推进；读 `_this[430656]`(=鼠标目标)。==-1 则回退不跳，否则 depth 校验后 `_this[120*cur+383128]=..+4*目标` 跳转（**先压返回点**）。**不"返回输入类型"**。handler=sub_41ACD0（raw .c 25827）。★emulator 已按此建模（`tickets/T-0047`：`op_mouse_callback` 写 `advanceThrottle`；守卫 `test/route-dispatch.test.ts`/`test/input.test.ts`） |
| 0xCE | 3 |  | sub_4219E0 | 仅映射 |  |
| 0xCF | 0 |  | sub_41AE40 | 仅映射 |  |
| 0xD0 | 1 |  | sub_42E910 | 仅映射 |  |
| 0xD1 | 0 |  | sub_419940 | 仅映射 |  |
| 0xD2 | 1 |  | sub_421A50 | 仅映射 |  |
| 0xD3 | 0 |  | sub_42AC40 | 已核对 | **阶梯动画时间表：清空**（机制长文见 [engine-reset-mainloop.md](./engine-reset-mainloop.md) §B.6）。`_this[107672] = -1`（写游标）、`_this[107667] = -1`（输入打断 label）、`_this[107673] = 0`（当前下标）、`begin == end`（清 16 字节记录的 vector）。`95805 = 1` ⇒ 本条只前进自己。handler=sub_42AC40（raw 36668-36685）。语料 **7 处**（`SAVE` / `HISTORY` / `ADDEXP` / `BTL`×4，形态全同）。emulator：`OPS` 的 `op_stage_reset`（`vm/stageLoop.ts` + `vm/handlers/stage.ts`），守卫 `test/stage-loop.test.ts` |
| 0xD4 | 4 |  | sub_42E940 | 已核对 | **阶梯动画时间表：追加条目**。op1 = 与**上一条**的间隔 ms（第一条相对起表时刻）、op2 = 条目数、op3 = 到点入口 label、**op4 = "已落后于时间表"时改用的入口 label**。★操作数 3/4 是 label（反汇编器一侧 `scripts/asm/age-shared.mjs` 的 `isLabelArgument` 早已按 `opcode===0xD4 && x>=2` 渲染；`script/bin.ts` 的 `labelTargets` 也随之修正为 `[2,3]`）。每条 16B 记录 `{t = 上一条 t + op1, 100, op3, op4}`，时刻**跨多次 `i0d4` 继续累计**（raw 38838-38845）⇒ 语料靠它把"重活 N 次 + 收尾 2 次"拼成一条时间轴。`op2 <= 0` ⇒ 不追加。handler=sub_42E940（raw 38801-38905）。语料 **20 处**：`SAVE.txt:1645-1646`、`HISTORY.txt:956-958`、`ADDEXP.txt:107-109`、`BTL.txt:3432-3434 / 3964-3966 / 4436-4438 / 4817-4819`。emulator：`op_stage_add`，守卫 `test/stage-loop.test.ts` |
| 0xD5 | 1 |  | sub_42ACC0 | 已核对 | **阶梯动画时间表：起表 + 置 `0x40` 门**。op1 = 输入打断 label（**全语料 7/7 处 = `ffffffff`**，即不打断）。三段：① `95805 = 0` ⇒ **本条不前进** —— `i0d5` 就是时间表的**循环回边**（脚本体 `ret` 回到它）；② **只在 `index == 0` 时**：刷输入（`sub_478090` 消费刷 + `sub_477220`）、记 op1 与 `frames[cur][95796]`（脚本身份，供 `sub_408F10` 的 `Depth が不正です` 校验）、`sub_453A90` 起 ms 计时器、`sub_42A180` 按时刻排序；③ `index < 写游标` ⇒ `effect_flags \|= 0x40`（调度器接管），否则 `95805 = 3` 让脚本往下走。★**派发次数 = 条目数 − 1**（最后一条是"收尾哨兵"，只负责让 ③ 在正确时刻失效 —— `HISTORY` 写 `4+1+2=7` 条而实际派发 6 次，正好对应 `local 492` 从 0 数到 5 的缓动取样点）。handler=sub_42ACC0（raw 36689-36727）；**消费者** `sub_408F10`（raw 13612-13684，主循环 raw 21154-21156 在 `flags & 0x40` 时每遍调它）。emulator：`op_stage_run` + `frame/loop.ts` 的 `stage` 门分支，守卫 `test/stage-loop.test.ts`（含真语料 E3：SAVE.BIN 实测 31 次派发 / 481 ms） |
| 0xD6 | 6 |  | sub_42EB80 | 仅映射 |  |
| 0xD7 | 1 |  | sub_421AF0 | 仅映射 |  |
| 0xD8 | 2 |  | sub_421AA0 | 仅映射 |  |
| 0xD9 | 0 |  | sub_419970 | 已核对 | **清 `effect_flags` 的 0x1000 位**：`effect_flags &= ~0x1000`；若 `Engine[124350]`（脚本派发中）非零，则同清 `Engine[95779] &= ~0x1000`。handler=sub_419970（raw 24939-24949）。语料 0 处。emulator：`OPS` 的 `op_clear_flag_1000`（`handlers/engine-fields.ts`）。 |
| 0xDA | 6 |  | sub_42EAE0 | 仅映射 |  |
| 0xFA | 0 |  | sub_4199B0 | 已核对 | **poll-msg-advance（输入 + ADV 状态机）**：清 `Engine[97054]`；`sub_4780D0` 读输入状态；若 `(v5 & 0x40) == 0` 则清 `Engine[174801]` 的 `0x8000000`（退出 ADV）、遍历 3 个回调槽（122505 区）经 `sub_4BB840` 处理并清空；若仍非 ADV 则 `sub_478090` flush 输入 → `Engine[174802]`、置负 `effect_flags`（`|= 0x80000000`，等待门）并清输入掩码 —— 即空闲时触发 `sub_411BC0` 空等待派发；handler=sub_4199B0（raw .c 24952-24988） |
| 0xFB | 2 | joy-callback | sub_421B80 | 已核对 | **注册手柄跳转目标**（非 `sub_453A60`！）：校验 op1∈[0,32)（越界抛 `set-keyjump`）、`_this[33*cur+107725+op1]=op2`（把手表）。`sub_419AF0`(0x100) 扫掩码最低位、按此表跳 label。handler=sub_421B80（raw .c 30400）。⚠️ 修正旧「sub_453A60(_this+107454, op1)」——该写法属 0xCE(sub_4219E0) |
| 0xFC | 0 |  | sub_419A70 | 仅映射 |  |
| 0xFD | 2 |  | sub_421C10 | 仅映射 |  |
| 0xFE | 1 |  | sub_421CA0 | 已核对 | **SetKeyTotal**：读 op1；若 `op1>0x1F` 抛 ShowMessage「SetKeyTotalの引数が不正です．」，否则写引擎字段 `_this[517]`。★该字段**同时是 `0x100` 在掩码为空时派发的「默认键」槽下标**（raw 25054 取 `v4 = _this[517]` 查 `joy-callback` 表），也是掩码扫描的上界（raw 25029-25037）。Input 构造默认 7（`sub_477DD0` raw 92385），本作全语料只有 `src/SYSTEM4.txt:86` 的 `i0fe c` ⇒ **12**。handler=sub_421CA0（raw .c 30444） |
| 0xFF | 0 |  | sub_419A90 | 已核对 | **复位输入/ADV 状态**：`Engine[174802] = 0` → `sub_4780D0(Engine+1032, Engine+174802)`（读输入态）；`Engine[cur+122287] = 0`；`Engine[cur+122327] = Engine[517]`（把字段灌进当前帧槽）。handler=sub_419A90（raw .c 24998） |
| 0x100 | 0 |  | sub_419AF0 | 已核对 | **按键/默认键派发**：`v2=_this[174802]`(输入掩码)，**两条分支都先压返回点** `((ip-ip_base)>>2)+1`（raw 25039-25040 / 25052）：① **掩码非 0** → 从游标 `_this[cur+122287]` 起扫**最低**置位（**上界 `_this[517]`=SetKeyTotal**，raw 25029-25037），查 `_this[33*cur+107725+bit]`（`joy-callback` 表），==-1 则弹栈回退、否则跳 `4*登记值`；② ★**掩码 == 0** → 取 `v4 = _this[517]`（SetKeyTotal **本身当下标**，不是上界）查同一张表 ⇒ 派发「**默认键**」处理器（raw 25050-25062）。handler=sub_419AF0（raw .c 25012）。★②长期被漏实现 ⇒ 依赖它的界面**静默卡住**（`CHARMEDIT` 右键关闭被 `jcc (local b)` 挡回；tickets/T-0046，emulator 已修，守卫 `test/input.test.ts`） |
| 0x101 | 0 | poll-input | sub_419CC0 | 已核对 | **刷输入掩码并复位**：`sub_478090(_this+258,_this+174802)` 刷累计事件进掩码 → 清 `_this[174801]` 的 0x8000000 位 → `_this[174802]=0`、`_this[122367]=1`、`_this[122370]=0`。供同批 `check-bit`/位检查读，随即清零。handler=sub_419CC0（raw .c 25069）。旧 label `u00415BF0` |
| 0x102 | 3 |  | sub_421D00 | 仅映射 |  |
| 0x103 | 1 |  | sub_421DE0 | 仅映射 |  |
| 0x104 | 0 |  | sub_419D20 | 仅映射 |  |
| 0x105 | 1 |  | sub_421E20 | 仅映射 |  |
| 0x106 | 1 |  | sub_42ED90 | 已核对 | **配置 getter**：`op1 = Engine[550]`。handler=sub_42ED90（raw .c 39040） |
| 0x107 | 2 |  | sub_421E50 | 已核对 | **SetKey（按键绑定）**：读 op2=值、op1=键下标；`op1≤0x1F` 时写 `_this[551+op1]=op2`。handler=sub_421E50（raw .c 30516） |
| 0x108 | 1 | read-mouse-button | sub_42EDC0 | 已核对 | **读鼠标按钮值到 op1**（曾名 `i108`）：`sub_477220(_this+258,&v3)`（左=bit0/右=bit1，随 SM_SWAPBUTTON 互换）→ `sub_42B4B0(1,v3)`。handler=sub_42EDC0（raw .c 39047） |
| 0x109 | 2 | read-mouse-pos | sub_42EE10 | 已核对 | **读鼠标位置到 op1=X,op2=Y**（曾名 `i109`）：`sub_4771D0`(GetCursorPos+ScreenToClient) → `sub_498350`(坐标变换)+`sub_403500`(虚拟显示映射，用 `_this[699168/699172]` 分辨率) → 写 op1/op2。(-100000,-100000)=未初始化。handler=sub_42EE10（raw .c 39057） |
| 0x10A | 2 |  | sub_421EA0 | 已核对 | **把光标移到虚拟屏坐标（op1 = X, op2 = Y）** —— `0x109` 的**逆**：`Point=(op1,op2)` → `sub_498350` 取显示对象偏移 → `if (!Engine[167990] = display:ScreenMode)` 才做虚拟→客户区映射（缩放只在 `display:VirtualFullScreenType == 2` 时生效，随包 INI 无此键 ⇒ 1:1）→ `ClientToScreen` → **`SetCursorPos`**（raw 30546-30597）。★语料 **1678 处**，四种用途（都不是存档）：① **ADV 侧边栏钉住/放出**（1470 处）`i10a 4c4 (global-int 13a0)` / `i10a 479 (global-int 13a0)` —— x = 0x4c4 = 1220（栏内）/ 0x479 = 1145（栏外），y = `global 13a0` = 上一行 `read-mouse-pos` 读到的**当前 Y**；侧栏出现/收起时把光标钉进/钉出侧栏，免得 hover 状态机（`f7ffb`）在边界抖动（`src/SC5450.txt:713-793`、`$1$SC0330.txt:711-793`、SN0000 等 330+ 个脚本同型）；② **光标位置记忆**（`SBUNKI.txt:129-139` / `BUNKI.txt:149-159`，配置位 `global a9cd` bit0 决定「恢复上次位置」还是 `read-mouse-pos`）；③ **拖动越界回夹**（`ALLMAP.txt:531/558/583/610`）；④ **对话框居中**（`SELSTAGE.txt:42` 的 `i10a 388 d3`）。handler=sub_421EA0（raw .c 30530-30598）。emulator：`INPUT_OPS` 的 `op_set_mouse_pos`（= 设**引擎侧**光标 + 触发 `onCursorMove` 命中测试）**＋ 宿主侧的 `SetCursorPos`**：渲染进程把同一对虚拟坐标经 IPC 交给主进程，主进程用 `native/win32-input`（CMake + C++ + node-addon-api）真移动系统光标，DIP→物理由 `screen.dipToScreenPoint()` 负责（缺口票 `tickets/T-0053` / 落地票 `T-0058`；headless 宿主是显式 no-op），守卫 `test/input.test.ts` + `test/native-win32.test.ts` |
| 0x10B | 2 |  | sub_422070 | 已核对 | **SetKey（另一按键表）**：读 op2=键下标、op1=值；`op1≤0x1F` 时写 `_this[op2+1383]=op1`。handler=sub_422070（raw .c 30603） |
| 0x10C | 2 |  | sub_4220B0 | 已核对 | **SetKeyMulti**：读 op1=值、op2=键索引；`op1>0x1F` 抛 ShowMessage「set-keymulti 引数不正」，否则写 `_this[_this[op2+1690]+1434]=op1`。handler=sub_4220B0（raw .c 30617） |
| 0x10D | 1 | read-mouse-wheel | sub_42EF50 | 已核对 | **读鼠标滚轮增量（一次性消费）**（曾名 `i10d`）：`v2=mouse_wheel_residual(_this[1949]/+0x1E74)`；**随即清零**；`sub_42B4B0(1,v2)` 写 op1。值 = 自上次读取以来 WM_MOUSEWHEEL 的 `+= SHIWORD(wParam)` 累计（一格 ±120，上滚正/下滚负），清零点见 raw 141582 写入、raw 13938/21060 消息泵 ADV 推进门（仅 `<0` 即下滚才推进文本）。handler=sub_42EF50（raw .c 39114）。★脚本模式：菜单/列表进入时 `read-mouse-wheel (local 403)` 丢弃残量，主循环反复 `read-mouse-wheel (local 403)`+`jcc (local 403) <翻页label>` 实现滚轮翻页（AGENCY:258/283 等 40+ 脚本） |
| 0x10E | 2 |  | sub_42EF90 | 仅映射 |  |
| 0x10F | 1 |  | sub_422120 | 已核对 | **引擎控制字段**：读 op1 写 `_this[122369]`。handler=sub_422120（raw .c 30637） |
| 0x12C | 5 | lookup-array-2d | sub_42EFD0 | 已核对 | **lookup-array-2d**（二维数组元素地址）：`v6=op3*op4+op5`（行×列宽+列），`operandAddress_42AEA0(2)` 取 op2 基址，`sub_418CC0(1, base, v6, -1, -1)` 把 `base+4*v6` 写入 op1 指针槽。handler=sub_42EFD0（raw .c 39137） |
| 0x12D | 7 |  | sub_42F040 | 仅映射 |  |
| 0x12E | 8 |  | sub_42F230 | 已核对 | **悬停命中测试**：先用 `sub_42AEA0` 取 op2/op5/op6/op7 的**操作数地址**、`sub_41BF50` 取 op1/op3/op4/op8 的值并缓存进全局 `dword_55D5xx`；再从 `base + 16*(op1+1)` 起遍历矩形表（每项 16B，4 个 dword 经 DEC 去混淆作 x0/x1/y0/y1），命中 ⇒ **写 op1 = 项下标**，否则 -1。**PARTIAL**（全局缓存跨帧语义未定）。handler=sub_42F230（raw .c 39199） |
| 0x12F | 4 |  | sub_42F560 | 已核对 | **索引插入排序**：`op1/op2/op3` 经 `sub_42AEA0`（operandAddress）取三个数组基址 **A=索引数组 / B=主键 / C=次键**（三者同索引空间），`op4` = 元素数 `n`；`*A = 0`；对 `k=1..n-1`：`while (DEC(B[A[j]]) + DEC(C[A[j]]) > DEC(B[k]) + DEC(C[k])) { A[j+1]=A[j]; j-- }` 再 `A[j+1]=k`；末尾逐项 `A[i] = ENC(DEC(A[i]))`（净恒等）。★**比较键是 `B[A[j]] + C[A[j]]`**（用 A 里存的**索引**去查 B/C，raw 39299-39307 的下标嵌套就是它），**不是**"A 位置上的值"、也不是"C 的同位置值" —— 取错键会让顺序**依赖 A 的残留内容**（`CONFIG1` 首次进设置「字体系列」被前置、切 tab 回来又"看起来对"；实测已修）。★**DEC/ENC 只做一层**：数组里存 `ENC` 位模式，引擎的数组访问器（`sub_41BF50` 读 / `sub_42B4B0` 写）就是 `DEC` 读 / `ENC` 写；本条体内自带的 `DEC`（raw 39300 的 `__ROR4__(key ^ __ROL4__(x,11),25)`）是**同一层**，实现时不得再叠一次。handler=sub_42F560（raw 39269-39335）。实测用例：CONFIG2.txt:1044（n=1000）、CONFIG1.txt:1178 |
| 0x130 | 1 | load-show-logo | sub_42F7A0 | 已核对 | **LOGO/版权页开关 getter**（曾名 `i130`）：`op1 = _this[96983]`（写回操作数 1；SYSTEM4 第 146 行据此判断是否 `call-script LOGO`）。构造=1 播版权页、exit-script(0x9) 置 0 → GAMEOVER 回标题不再播。handler=sub_42F7A0（raw .c 39343） |
| 0x131 | 1 |  | sub_42F7D0 | 已核对 | **GetMesWinAlpha**：`op1 = GetConfig("message:MesWinAlpha")`（按名直读配置注册表，**不读任何 Engine 字段**）；handler=sub_42F7D0（raw .c 39350-39356） |
| 0x132 | 1 |  | sub_422150 | 仅映射 |  |
| 0x133 | 2 |  | sub_422240 | 仅映射 |  |
| 0x134 | 3 |  | sub_42F810 | 仅映射 |  |
| 0x135 | 2 | bit-set | sub_42F8B0 | 已核对 | `op1 \|= (1<<op2)`（置位；op2=bit 位，>0x1F 报错 `setbit`）。handler=sub_42F8B0（raw .c 39402） |
| 0x136 | 2 | bit-reset | sub_42F920 | 已核对 | `op1 &= ~(1<<op2)`（复位；op2=bit 位，>0x1F 报错 `rembit`）。handler=sub_42F920（raw .c 39424） |
| 0x137 | 1 |  | sub_4222B0 | 已核对 | **ResetStack(n)**：`Engine+388292[n]`（= `_this[97073+n]`）上的 **int 栈对象**删掉再 `new(0x14)`+`sub_407BD0` 建一个空栈（`{vftable, cap=256, step=256, buf=new[](0x400), top=-1}`；push = `0x138`→`sub_409D40`、pop = `sub_41A520`）。★本作可当 no-op：整个 int 栈家族在 941 个脚本里**只有 `i137` 1 处**（`src/CALLBACK_LOAD.txt:18`），`i138`/`i13b`/`i13c`/`i13d` 全 0 处 ⇒ 没人压过栈，"删空栈+建空栈" ≡ 不做。emulator：`ENGINE_INTERNAL_OPS`（`tickets/T-0072`） |
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
| 0x143 | 0 |  | sub_41A000 | 已核对 | **派发扩展包的 `$n$AUTORUN`**（dispatchScriptRequests）：置 `_this[124350]=1` 防重入 → 遍历 **FileDB 扩展包表槽 1..255**（`_this+173106` = DWORD 下标 ⇒ 字节 692424 = FileDB(680092)+0x3028+4 = 槽 1）→ 对每个**非零槽**（该包已装载）`queueScript_40FC90(slot<<24)` 入队（`slot<<24` = 该包文件 #0 = `$slot$AUTORUN.BIN` 的统一 id）→ 置 `_this[124350]=0`、`_this[30*cur+95805]=0`、`frames[cur].ip+=4` → `dispatchQueuedScripts_40FB60()` 派发。唯一脚本调用点 = `INIT2.txt:140`（在本体 40 张 INIT 之后）。包未装载 ⇒ 槽为 NULL ⇒ **静默跳过**。handler=sub_41A000（raw 25168-25191） |
| 0x144 | 2 |  | sub_433AB0 | 仅映射 |  |
| 0x145 | 1 |  | sub_42FCF0 | 仅映射 |  |
| 0x146 | 1 |  | sub_422960 | 仅映射 |  |
| 0x147 | 6 |  | sub_42FD60 | 仅映射 |  |
| 0x148 | 1 |  | sub_42FEC0 | 已核对 | **读全局时间阈值槽**：`sub_42B4B0(1, _this[97058])` 把引擎全局槽 `_this[97058]`（byte 388232，见 `analysis/fields.json` `global_slot_97058`）写回 op1（**get**；与 0x149 构成 get/set 对）。该槽是「光标贴屏幕顶边缘 / 松开 Alt → 弹系统对话框」的去抖时长：`sub_4B9240`(WM_TIMER) 读它并与 `timeGetTime()-dword_55E1D8` 比较，超时才弹框。handler=sub_42FEC0（raw .c 39705）。**曾仅映射，已读体确证** |
| 0x149 | 1 |  | sub_4229A0 | 已核对 | **写全局时间阈值槽**：读 op1 写 `_this[97058]`（byte 388232，紧邻 DEC/ENC 机制的 key `_this[97059]`/`enc_zero` `_this[97060]`；与 0x148 构成 get/set 对）。作用：设置「光标贴顶/Alt→弹系统对话框」的去抖时长（`sub_4B9240` 读、SYSTEM4 `i149 3e8`=1000ms）。handler=sub_4229A0（raw .c 31045） |
| 0x14A | 7 |  | sub_42FEF0 | 仅映射 |  |
| 0x14B | 1 |  | sub_4229D0 | 已核对 | **加载 AGERC 模块**（脚本侧）：若 `Engine+490072` 已有句柄 ⇒ `FreeLibrary` + 清 0；`id = op1` → `FileDB.name(id)`（`fileDbIdToName_454FA0`）→ `LoadLibraryA(名)` → 存回；失败 ⇒ `GetLastError` + 抛 ShowMessage「`%sを読み込み出来ません．ERRORCODE = %d`」。handler=sub_4229D0（raw 31056-31088）。语料**唯一 1 处**：`src/SAVE.txt:7 i14b 5250`（`0x5250`=21072=`AGERC.DLL`）。★不是通用 DLL 加载器。emulator：`OPS` 的 `op_agerc_load`（`handlers/agerc.ts`）——**只接受 AGERC.DLL**，其余 id 按引擎同文报错；模型 `Engine.agerc`。 |
| 0x14C | 2 | set-agerc-export | sub_422AB0 | 已核对 | **set-agerc-export**：`name = op2`（字符串）→ `GetProcAddress(模块, name)`（失败 ⇒「`%sのアドレス取得に失敗しました．`」）→ `slot = op1`，`slot > 99` ⇒「`%sの関数インデックスが不正です．0から99までを指定してください．`」→ `Engine[4*slot + 490076] = proc`（**100 槽导出表**）。handler=sub_422AB0（raw 31091-31135）。语料 1 处（同上）。emulator：`OPS` 的 `op_agerc_bind_export` —— 导出名按 PE 实读的 **21 个**校验，槽号越界抛引擎同文。★此前**根本没注册** ⇒ 一进「Load Data」就硬报错。 |
| 0x14D | 6 | call-agerc-export | sub_430170 | 已核对 | **call-agerc-export**：`len = op4`；把 op3 的数组**逐元素 DEC** 到临时缓冲 → `ret = (*槽表[op1])(Engine[96981], buf, len, op5 数组, op6)` → 把缓冲 **ENC 回写** op3 → **写 op2 = ret**。handler=sub_430170（raw 39810-39855）。语料 1 处（同上；`SAVE.txt:9` 的槽 1 = `_SetNameLenMax@20`，传 12）。emulator：`OPS` 的 `op_agerc_call_export` —— DEC/ENC 由 `readRef`/`writeRef` 承担；内置导出表里只有 `_SetNameLenMax@20` 有行为（写 `Engine.agerc.nameLenMax`），其余**调用即抛**明确错误。★此前**根本没注册**。 |
| 0x190 | 2 |  | sub_42D830 | 已核对 | **读档（任意路径版）**：op2 → `sub_454FA0` 拼路径 → `CreateFileA(GENERIC_READ, OPEN_EXISTING)`（打不开 ⇒ `op1 = 1`）→ `sub_410160(...,1,1)`（全量：含字体/额外块）。成功路径**不写 op1**（`return CloseHandle`）。与 `0x1A1` 共用同一装载内核，差别只在"路径从哪来"。handler=sub_42D830（raw .c 38243-38264）。★emulator 只实现槽版（`0x1A1`）；本指令语料 0 次出现（见 [`save-data.md`](./save-data.md) 的语料统计） |
| 0x191 | 2 |  | sub_42CEC0 | 仅映射 |  |
| 0x192 | 2 | set-string | sub_433660 | 已核对 | `op1 = op2`（**汉化核心指令**：把字符串 op2 赋给 op1 串槽。`sub_42A420(this,&buf,2)` 读 op2 字符串对象 → `sub_433310(this,1,buf)` 写入 op1）。handler=sub_433660（raw .c 41936） |
| 0x193 | 3 | concat | sub_433710 | 已核对 | `op1 = op2 + op3`（字符串拼接：`sub_42A420` 读 op3/op2 → `sub_42AA90` 拼接（**op2 在前**）→ `sub_433310` 写入 op1）。handler=sub_433710（raw .c 41952） |
| 0x194 | 3 |  | sub_42CF10 | 已核对 | **字符串相等判定**：取 op2/op3 两个字符串操作数（`sub_42A420`），经 `sub_401540`（`std::string::compare(pos,len,rhs,rhsLen)` 语义：先 memcmp 较短长度、相等再比长度）⇒ `op1 = (cmp == 0)`；handler=sub_42CF10（raw .c 37909-37938） |
| 0x195 | 3 |  | sub_42D010 | 已核对 | **字符串不等判定（0x194 的取反兄弟）**：`op1 = (op2 != op3)`（`sub_401540` 的 compare ≠ 0 ⇒ 写 1）。★**会回写 op1**：`src/SETFATE.txt:15-17` 的 1000 次循环靠它跳过空名条目，跳过会让空名条目也被处理。emulator：`OPS` 的 `op_string_not_equal`。handler=sub_42D010（raw .c 37942） |
| 0x196 | 3 | display-furigana | sub_41FC20 | 已核对 | **display-furigana**：读 op1=槽、op2=本文词、op3=注音（先有界拷进 1024 栈缓冲）。分三路：① `MessageSpeed == 0` 或 ADV 位已置 ⇒ `sub_46CBF0(Font, op1, op2, op3, Engine[388220])`（同步排空）；② 否则 `sub_46BE30(...)`，返回非 0 时置 `effect_flags |= 0x20000000`、`Engine[489484] = op1` 并起节拍定时器 `sub_453A60(Engine+430572, MessageSpeed)`；③ `Engine[489988] & 1` 置位时纯 `sub_46BE30`。★op2（本文词）本身是正文的一部分（全库 6341 处用它把一句话从词中间切开）。**曾「推测」**；handler=sub_41FC20（raw .c 29032-29126） |
| 0x197 | 1 |  | sub_41FDD0 | 已核对 | **注音（ルビ）字号（全局）**：读 op1 调 `sub_418680(Font, op1)` 写 `Font+218584`（= `_this[75970]`，注音 LOGFONT 尺寸），再 `sub_459F40()` 重建字体对象。作用域同 0x76（入队时消费，不回溯）。handler=sub_41FDD0（raw .c 29117） |
| 0x198 | 3 |  | sub_41FE10 | 已核对 | **窗屏幕位置**：读 op1=窗、op2=x、op3=y → `sub_456400(Font, op1, op2, op3)` 写窗对象 `+12 = x`、`+16 = y`（win=0 用默认窗 `Font[307]`；对象不存在则不写）；handler=sub_41FE10（raw .c 29127-29135） |
| 0x199 | 0 |  | sub_418FC0 | 已核对 | **重显示文本（`0x7B` 的读取端）**：`if ((Engine[122452] & 0x4000000) == 0)` 用主游标否则用备用游标；`frame.ip = base + 4*游标`（= 直接回退到该指令）、旧 `effect_flags` 存进 `122452`（并置 `0x6000000`）、`122453 = 当前指令下标+1`、`Engine[174802]=0`；游标为 -1 时什么都不做。handler=sub_418FC0（raw 24492-24529，argc 0）。语料 **668 处 / 334 个脚本**（**此前不在任何表里 ⇒ 命中即硬报错**）。emulator：`OPS` 的 `op_redisplay_text`（`c.jump(游标)`）。 |
| 0x19A | 1 |  | sub_42D290 | 已核对 | **跳读/自动模式查询**：`op1 = Engine[97050]`（由 `0x88` 写入）。★会回写 op1。emulator：`OPS` 的 `op_get_skip_mode`。handler=sub_42D290（raw .c 38031） |
| 0x19B | 0 |  | sub_4190E0 | 已核对 | **退出消息/ADV**：清 `_this[174801]&~0x8000000`、`_this[1415]=0`。handler=sub_4190E0（raw .c 24532） |
| 0x19C | 0 |  | sub_419120 | 已核对 | **进入消息/ADV**：`_this[97051]=1`、`_this[174801]|=0x8000000`、`_this[122368]=1`。handler=sub_419120（raw .c 24546） |
| 0x19D | 2 |  | sub_42D8E0 | 已核对 | **已使用文件查询**：`op1 ← sub_4181F0(FileDB, op2)` = 「统一文件 id op2 是否**已被打开过**」(0/1)。`sub_4181F0`（raw 23838）读 `FileDB+1052`（本体）/ `FileDB+14404+4*包号`（扩展包）这张按 id 索引的哈希表，判据 `(u16)槽值 == (u16)(28569*id − 20304)`；写这张表的**只有** `sub_4559C0`（按 id 打开文件，raw 67832/67882 两处调 `sub_454960`）⇒ 语义 = 「该文件曾被打过」。★高字节 ≠ 0（扩展包资源）且 `set:SaveVersion1 < 3`（或 `==3` 且 `SaveVersion2 < 10`）⇒ 恒 0。**用途**：`SETMEMOIR.BIN` 靠它把「已播放过的 BGM / 看过的 CG / 看过的场景」标成已收集（回想界面 4 个按钮的 `回収数`/`回収率` 与 BGM 鉴赏列表都由它决定）——跳过它会让列表整片空白。见 `docs-new/03-engine/gallery-and-unlock-flags.md`。handler=sub_42D8E0（raw 38267-38285）；emulator：`OPS` 的 `op_file_used_query` |
| 0x19E | 2 |  | sub_42D980 | 已核对 | **存档（SAVE）**：op2 = 槽号 → `sub_408A40` 取存档目录、拼 `%s\SAVE%2.2d.DAT` → 文件已存在则先 `sub_438120` 读头（★头**读不出**时才弹 `sub_406650(...,0x34)` 确认框，选"否" ⇒ `op1 = 1` 中止；头能读出 ⇒ 直接覆盖、不弹框）→ `CreateFileA(CREATE_ALWAYS)`（失败弹 `aE` 错框 ⇒ `op1 = 1`）→ `sub_40CD10` 写整份状态（含 `set:SaveVersion2`）→ `op1` = 写入结果。handler=sub_42D980（raw .c 38287-38331）。★emulator 已实现（`handlers/save-slot.ts`）：宿主无对话框 ⇒ 恒走"玩家点了是"，见 `SLOT_GAPS` |
| 0x19F | 2 |  | sub_42DB10 | 已核对 | **读档（短版）**：同 `0x1A1`，但 `sub_410160(...,a6=0,a7=0)`（**不还原字体/额外块**）；成功/失败都写 `op1` = `sub_410160` 的结果（打不开 = 1）。写完同样把 `pool_int` 重新 ENC（raw 38360-38361）。handler=sub_42DB10（raw .c 38334-38363）。★emulator 已实现（与 `0x1A1` 同一实现；`a6/a7` 那两层未单独建模 ⇒ `SLOT_GAPS`）；语料 0 次出现 |
| 0x1A0 | 9 |  | sub_42DC70 | 已核对 | **读槽头（292 B，不装载状态）**：唯一输入 `op2` = 槽号 ⇒ `%s\SAVE%2.2d.DAT`（`sub_408A40` 取存档目录）→ `CreateFileA` RO：打不开 ⇒ **`op1 = 1`**；`sub_438120` 读并校验 292 B 头：成功 ⇒ **`op1 = 0`** + `op3..op8` = 年/月/日/时/分/秒（头 `+264` 的 SYSTEMTIME，★**跳过 `+268` 的 `wDayOfWeek`**，也不取 `wMilliseconds`）+ `op9` = 游玩秒数（`+280` 的 i32）；头坏（魔数/游戏名/读错误/长度≠292 **四因合并**）⇒ **`op1 = 2`**。★写序 `op3..op9` 先、`op1` 最后；失败时 `op3..op9` **不动**（脚本必须先读 op1）。★**无 `pool_int` re-ENC**（不装载状态；对照 0x1A1/0x19F）。输出走 `sub_42B4B0` ⇒ 传**引用**操作数时**写进数组元素**（语料 `src/SAVE.txt:80` 按槽填七张表）。`_this[30*cur+95805] = 19` = 指令 dword 长度 ⇒ argc = 9。handler=sub_42DC70（raw .c 38365-38404）。★emulator 已实现（`handlers/save-slot.ts`） |
| 0x1A1 | 2 |  | sub_42DDE0 | 已核对 | **读档（LOAD，全量）**：op2 = 槽号 → `CreateFileA` RO（打不开 ⇒ `return 1`，**不写 op1**）→ `sub_410160(...,1,1)` 装载整份状态（两张表 + 全局池 + 帧；含字体/额外块）→ 把 `pool_int` 起 `_this[95738]+1` 个 dword **重新 ENC**（⇒ 运行时池必须是 ENC 态；raw 38433-38438，文件那侧随 `set:SaveVersion1` 分支而不同 ⇒ `SLOT_GAPS`）。★**不写任何操作数**：函数体里没有 `sub_42B4B0`（对照 `0x1A0`/`0x19E`/`0x19F`），且调度器 `(*(void (**)(int))(_this + 4*opcode + 675996))(_this)`（raw 21217）**丢弃 C 返回值** ⇒ 真脚本给的 `(global-int f7ffd)` 只是占位（语料 335 次，如 `src/$1$SC0330.txt:579`，前一行 `comment "savemesskip q-load"`）。handler=sub_42DDE0（raw .c 38407-38440）。★旧注"存档到槽位"是**误**（存档是 `0x19E`）。★emulator 已实现（`handlers/save-slot.ts`） |
| 0x1A2 | 1 | save-int | sub_434F60 | 已核对 | **save-int**：读 op1 得值+索引，`wsprintfA("%c%8.8x",3,idx)` 生成键，`sub_434D00(_this+5452, key, &val)` 插入（sub_429020 找槽、sub_40C210 存键）。handler=sub_434F60（raw .c 42920）。★**设置界面的开关就是靠它持久化**：`INITCONFIG0..5` 逐个 `save-int (global a9ce)`，引擎再把这张表写进 `SAVE.DAT`（见 [`save-data.md`](./save-data.md)） |
| 0x1A3 | 1 | load-int | sub_42DF40 | 已核对 | **load-int**：`sub_418A30(1)` 读 op1 索引 → 键 `"%c%8.8x",3,idx` → `sub_428E00(key)` 全局字符串表查询（命中取 `*v3`、未命中=0）→ `writeIntOperand_42B4B0(1,val)` 写回 op1。（写操作数故 VM 可见）handler=sub_42DF40（raw .c 38442）。★`LOADCONFIG` 用 29 次 load-int/load-string 把 `SAVE.DAT` 里的用户设置读回全局（见 [`save-data.md`](./save-data.md)） |
| 0x1A4 | 2 |  | sub_41FE60 | 已核对 | **消息窗字段**：读 op1/op2 写 `_this[21670]/[21671]`。handler=sub_41FE60（raw .c 29141） |
| 0x1A5 | 1 | set-font | sub_433290 | 已核对 | **set-font**：读 op1 字符串，调 `sub_4328F0(_this+21324, str)` 设字体。fire-and-forget。★**只换「字体面名」**（+ 由当前主字号 `Font+201684` 推 lfHeight/lfWidth、维护可选面名列表、`sub_459F40` 重建字形缓存），**不碰 `Font+1360/+1364/+1372`（填充色/描边色/描边档）** —— 所以样式块里 `i076/i077` 先于它执行也不会被覆盖（`T-0042` 排查；函数条目 0x433290，raw 41345-41560）。handler=sub_433290（raw .c 41802） |
| 0x1A6 | 2 | halve-strlen | sub_42D110 | 已核对 | **halve-strlen**：`op1 = strlen(op2) >> 1`（`sub_41B640(2)` 读 op2 → `strlen` → `writeIntOperand_42B4B0(1, len>>1)`）。handler=sub_42D110（raw .c 37975），纯 |
| 0x1A7 | 1 | comment | sub_4191B0 | 已核对 | nop（dev 注释，无副作用） |
| 0x1A8 | 0 | dev_ukn | sub_419690 | 已核对 | nop（dev 未知指令，通常空实现） |
| 0x1A9 | 1 | save-string | sub_434FE0 | 已核对 | **save-string**：`sub_42A420` 读 op1 字符串、`sub_418AE0(1)` 读值（字符串索引），键 `"%c%8.8x",5,val`，`sub_434E00(key, str)` 插入/更新（table 满 `sub_434AF0` 扩容）。handler=sub_434FE0（raw .c 42935） |
| 0x1AA | 1 | load-string | sub_433A70 | 已核对 | **load-string**：`sub_418AE0(1)` 读 op1 字符串索引 → `sub_429390(_this+5191, 5, idx)`（键 `"%c%8.8x",5,idx`，查 `_this+5472`，未命中返静态默认 `dword_55D0FC`）→ `sub_433310(1, 结果串)` 写回 op1 的字符串。（写操作数故 VM 可见）handler=sub_433A70（raw .c 42053）。**0x1A9 的读侧** |
| 0x1AB | 2 |  | sub_42DFC0 | 已核对 | **删槽**（`.DAT` + `.STH`）：`DeleteFileA(DAT)` 失败 ⇒ `op1 = 1`；`DeleteFileA(STH)` 失败 ⇒ `op1 = 2`；都成功 ⇒ 0。handler=sub_42DFC0（raw .c 38463-38483）。★emulator 已实现（宿主层只删 overlay，见 `arch/nodeFileSource.ts`）；语料 1 处 |
| 0x1AC | 3 |  | sub_42E0A0 | 已核对 | **复制槽**（op2 → op3）：`CopyFileA(DAT)` 失败 ⇒ `op1 = 1`；`CopyFileA(STH)` 失败 ⇒ `op1 = 2`；都成功 ⇒ 0（★"只第二份失败"是 **2**，不是 1 —— raw 38505-38511）。handler=sub_42E0A0（raw .c 38486-38513）。★emulator 已实现；语料 2 处 |
| 0x1AD | 0 |  | sub_4196F0 | 已核对 | **`Engine[166963] = cur`**（存档序列化用的「当前帧」记忆）。handler=sub_4196F0（raw 24806-24814）。语料 **1100 处 / 337 个脚本**。emulator：`op_store_cur_166963`（写 `engineValues`）。 |
| 0x1AE | 3 |  | sub_42E1F0 | 已核对 | **写 `.STH`（存档缩略图）**：`op2` = 槽号、**`op3` = 纹理槽** → `CreateFileA(SAVE%2.2d.STH, CREATE_ALWAYS)`（失败 ⇒ `op1 = 1`）→ 内容 = **该纹理槽的位图**：`Engine[166964] == 1`（DrawMode=D3D）时 `sub_4A5260(Engine+322832, FileName, op3)`，否则 `sub_43BF20(Engine+7912, op3, h)`（raw 47838，ddWriteBmp）——两者产物都是 **BMP**（`"BM"` + 40 字节 DIB + 24bpp，行按 32 bit 对齐；E4：真槽 `.STH` 恒 172,854 字节 = 54 + 320×180×3）⇒ 失败 `op1 = 2`、成功 0。真实调用面 [`src/$1$SC0330.txt:17590-17595`](../../src/$1$SC0330.txt)：先 `create-texture e 140 b4 2` 造 320×180 离屏纹理，存完槽再 `i1ae … e` 写缩略图。语料 337 处（与 `0x19E` 配对） |
| 0x1AF | 3 |  | sub_42E320 | 已核对 | **读 `.STH`（存档缩略图）**：`op2` = 槽号、**`op3` = 纹理槽**（要装进哪个槽）→ `CreateFileA(GENERIC_READ, OPEN_EXISTING)` 失败 ⇒ `op1 = 1`；`sub_40BF20(Engine+7912, op3, -1, h, GetFileSize)`（raw 16072 → `sub_43E9F0` raw 49926 = **ddReadBmp**，先校验魔数 `19778` = `"BM"`；`Engine[166964]==1` 时走 `sub_49E9D0`）失败 ⇒ 2、成功 0。真实用例 [`src/SAVE.txt:2086-2095`](../../src/SAVE.txt)：`create-texture (local 21c6) 140 b4 0` → `i1af (local 12) (local 219) (local 21c6)` → `eq … (local 12) 0` 判成功 → `draw-texture … 140 b4 452 …` 画到列表右侧。★emulator 已按 BMP 解出并写进 `op3` 槽（`src/vm/bmp.ts`，`tickets/T-0036`）；语料 1 处
| 0x1B0 | 3 | memcpy | sub_42D150 | 已核对 | **memcpy**：`memcpy(dest=op2, src=op1, n=4*op3)`（`operandAddress(1)` 取 op1 基址、`operandAddress(2)` 取 op2 基址、`4*op3` 为字节数）。handler=sub_42D150（raw .c 37985），纯内存拷贝 |
| 0x1B1 | 1 |  | sub_41FEA0 | 已核对 | **`Engine[21672] = op1`**。handler=sub_41FEA0（raw 29155-29163）。语料 2 处 / 1 个脚本。emulator：`op_set_field_21672`。（同类 `0x74`/`0x1B5` 写的是 21668 = `message:MessageSpeed`，本槽是另一个。） |
| 0x1B2 | 1 |  | sub_42A9B0 | 已核对 | **字符串 append 日志缓冲**：`sub_40C660(_this+124336)`。handler=sub_42A9B0（raw .c 36551） |
| 0x1B3 | 0 |  | sub_42AA00 | 已核对 | **append 2 字符换行**。handler=sub_42AA00（raw .c 36561） |
| 0x1B4 | 0 |  | sub_428DB0 | 已核对 | **错误输出/中止**：`sub_40B420`。handler=sub_428DB0（raw .c 35323） |
| 0x1B5 | 1 |  | sub_41FED0 | 已核对 | **SetMessageSpeed（字段 + 注册表）**：`Engine[21668] = op1` 且 `SetConfig("message:MessageSpeed", op1)`。CONFIG1/CONFIG2 的速度滑条走这条（滑条 1..99，脚本 `sub 7f2 = 100 - 滑条值`）；`INITREGMES` 用 `i1b5 19`（= 25ms）设默认；handler=sub_41FED0（raw .c 29165-29178） |
| 0x1B6 | 1 |  | sub_42D2C0 | 已核对 | **共存消息状态查询**：`op1 = (Engine[97052] != 0)`。★会回写 op1（写入端 = 0x1B7）。emulator：`OPS` 的 `op_get_coexist_state`。handler=sub_42D2C0（raw .c 38038） |
| 0x1B7 | 1 |  | sub_41FF20 | 已核对 | **置共存消息状态**：`Engine[97052] = (op1 != 0)`（`0x1B6` 的写入端；引擎帧循环 raw 13699-13707 看到它就清 0 并按压跳读）。emulator：`OPS` 的 `op_set_coexist_state`。handler=sub_41FF20（raw .c 29181） |
| 0x1B8 | 2 |  | sub_42D2F0 | 已核对 | **读配置写操作数**：op1=0 ⇒ `message:AutoMessageTime0`、1 ⇒ `AutoMessageTime1` → **写 op2**；其它值报错；handler=sub_42D2F0（raw .c CONFIG1 用法 i1b8 0/1） |
| 0x1B9 | 2 |  | sub_41FF60 | 已核对 | **设自动翻页基础时长**：读 op1=下标、op2=值；op1==1 ⇒ `SetConfig("message:AutoMessageTime1", op2)`、op1==0 ⇒ `…Time0`，其它值报错（`sub_4034D0`）。`INITREGMES` 用 `i1b9 0 5dc`（=1500ms）/ `i1b9 1 9c4`（=2500ms）设默认；handler=sub_41FF60（raw .c 29191-29220） |
| 0x1BA | 2 |  | sub_421200 | 仅映射 |  |
| 0x1BB | 1 |  | sub_420000 | 已核对 | **SetTB（文本项记账开关）**：op1==1 ⇒ `Engine[97055]=0`；op1==0 ⇒ `Engine[97055]=0x80000000`；其它 ⇒ `sprintf("SetTBの引数が不正です．\r\n")` + 抛 ShowMessage。`Engine[97055]` 同一字段兼两职：**记账门**（`0x1D2`/`0xC4`/`0x1BD`/`0x2F4` 的 `if (!Engine[97055])`）与**文本对象槽参数**（`0x71` 传给 `sub_45EC60`）。handler=sub_420000（raw 29223-29242）。语料 470 处 / 220 文件（`i1bb 0` … `i1bb 1` 成对）。emulator：`OPS` 的 `op_set_text_base`。 |
| 0x1BC | 0 |  | sub_4197A0 | 已核对 | **清消息/声音字段**：若 `Engine[21290]` 非空 ⇒ 对 i=0..2 调 `sub_4B60C0(voiceObj, i + 12)`（释放 3 个语音通道对象）；再清零 `Engine[21315..21320]`（语音通道状态位，`0x2F7` 写的那组）与 `Engine[122501]`、`Engine[122505..122510]`（寄存语音槽，`0xC4` 的 ADV 分支写）。handler=sub_4197A0（raw 24845-24871）。语料 **213 处 / 184 个脚本**。emulator：`NATIVE_OPS` 的 `op_clear_message_sound_fields`（`handlers/audio.ts`：清字段 + 对 3 个通道发 `voice-reset`）。 |
| 0x1BD | 1 |  | sub_4212C0 | 已核对 | **play-voice（通道 0，循环位=1）**：同 0xC4 的寄存/起播/登记三件套，但循环标志传 1（`Engine[122508]=1`、`sub_4BB840(Voice,0,op1,1,Engine[5053])`（第 5 参 = pan）、`sub_45EEA0(…,1,0,pan)`），且 `Engine[21315]` 状态位的清 0 条件是 `(v&0x10000)||(v&1)`。全库 0 处。handler=sub_4212C0（raw .c 30021-30066） |
| 0x1BE | 2 |  | sub_42E770 | 仅映射 |  |
| 0x1BF | 0 |  | sub_419840 | 已核对 | **跳读态置**（0 操作数）：`if (122504 & 0x10000) 122504 = 0; if ((122504 & 1) == 0) 122503 = 1;` —— `122504` 由 0x1CF 写入（消息跳读态），`122503` 的**唯一读者是 `0xBF` play-bgm**（raw 29773）：`set:KeepMusicVoice && sound:MusicFadeOnVoicePlaying && !122503` ⇒ 暂停 BGM 给语音让路（= 快进/跳读时不要压低音乐）。★不是脚本全局槽（`global-int 122503` 是另一个地址）。handler=sub_419840（raw 24874-24885）；emulator：`OPS` 的 `op_set_skip_read_state` |
| 0x1C0 | 1 |  | sub_421450 | 仅映射 |  |
| 0x1C1 | 3 |  | sub_420070 | 已核对 | **消息/UI 子系统方法**：读 op1..op3 调 `sub_4563D0(_this+21324, op1, op2, op3)`。fire-and-forget。handler=sub_420070（raw .c 29245） |
| 0x1C2 | 2 |  | sub_4200C0 | 仅映射 |  |
| 0x1C3 | 2 |  | sub_420110 | 仅映射 |  |
| 0x1C4 | 1 |  | sub_42E8A0 | 仅映射 |  |
| 0x1C5 | 4 |  | sub_433930 | 仅映射 |  |
| 0x1C6 | 2 |  | sub_421690 | 仅映射 |  |
| 0x1C7 | 1 |  | sub_42D390 | 已核对 | **ADV 激活查询**：`op1 = (effect_flags & 0x8000000) != 0`。★会回写 op1；语料 `src/SN0000.txt:1114` 的 `i1c7 f7ff5` / `i1cc f7ff6` → `or` → `jcc` 是 ADV 等待循环的判据。emulator：`OPS` 的 `op_get_adv_active`。handler=sub_42D390（raw .c 38072） |
| 0x1C8 | 2 | to-string | sub_433820 | 已核对 | **to-string**：`op1 = str(op2)`（`readIntOperand(2)` 读整数 → `sprintf("%d")` → 组装 SSO 字符串 → `sub_433310(1)` 写 op1）。handler=sub_433820（raw .c 41990），纯。**助记符改名 to-string**（原 toString 与 JS/Object 原型 key 冲突，曾反汇编成 `function toString() { [native code] }`） |
| 0x1C9 | 3 |  | sub_420160 | 已核对 | **音频设备 / 驱动初始化**：按 id（op1）打开音频驱动文件 → `sub_4B8490(Engine+7912, id, data, size)` → `sub_4B86E0(Engine+696548, hInstance)` → `Engine[18656] = op2`、`Engine[18660] = op3` → 取窗口坐标（`sub_4771D0`）→ `sub_4B7B70(设备, x, y)`。handler=sub_420160（raw 29291-29312）。语料 0 处。emulator：`op_audio_device_init` —— 两个参数照写字段；**驱动装载与窗口坐标下发无宿主等价物**（重写侧用 Web Audio，声部按需惰性创建）⇒ 已登记缺口。 |
| 0x1CA | 1 |  | sub_420240 | 已核对 | **配置 set-message-read-texture**：读 op1，经 `_this[174405]` 消息子系统对象 vtable+12 以 `"message"`/`readtex`+op1 派发。handler=sub_420240（raw .c 29315） |
| 0x1CB | 1 |  | sub_42D3D0 | 已核对 | **读配置写操作数**：`op1 = GetConfig("message:ReadTextSkip")`（键名 raw 4277；`0x1CA` 的**读取端**）。★会回写 op1 —— 当 no-op 时脚本读到的是旧槽值（静默逻辑错误）；语料 30+ 个场景脚本 + 本体 `SC0000:443`/`DRAWCHARM:8`/`CHARMEDIT:751` 都有 `i1cb (global-int 139d)`。emulator：`OPS` 的 `op_get_read_text_skip`（走 `readTextSkipOf`，运行期覆盖优先）。handler=sub_42D3D0（raw .c 38082） |
| 0x1CC | 1 |  | sub_42D410 | 已核对 | **本页文本显示中查询**：`op1 = Engine[122455]`。★会回写 op1（与 0x1C7 一起构成等待判据）。emulator：`OPS` 的 `op_get_msg_showing`。handler=sub_42D410（raw .c 38092） |
| 0x1CD | 2 |  | sub_42D1A0 | 仅映射 |  |
| 0x1CE | 1 |  | sub_420280 | 已核对 | **消息/UI 点击-跳读状态机**：读 op1；非0→`_this[174801]|=0x40000000`、`_this[107704]=0`、`sub_453A90(_this+430600)`(重置轮播计时器)；0→清 0x40000000。handler=sub_420280（raw .c 29329） |
| 0x1CF | 1 |  | sub_4213C0 | 已核对 | **消息跳读态**：写 `_this[122504]=op1`。handler=sub_4213C0（raw .c 30069） |
| 0x1D0 | 3 |  | sub_42D440 | 已核对 | **读回看页索引表（写回两个操作数）**：读 op3=页下标 → `sub_459860(Font, &v5, &v4, op3, 2)` ⇒ **写 op1 / op2**（页表 = `Font+3380`，8B/条 `{槽号, 回看下标}`）；handler=sub_42D440（raw .c 38099-38111） |
| 0x1D1 | 5 |  | sub_420310 | 仅映射 |  |
| 0x1D2 | 2 |  | sub_420380 | 已核对 | **文本项记录表 push**（引擎 `Font+3364` 的 72B/条 vector）：`if (!Engine[97055]) sub_45EFA0(Font, 0, op1, op2)` ⇒ 记录 `{win=Font[307], +24=op1, +20=op2, +28=0, +32=0, flags=0x20000000(|1=组首)}`；**不回写操作数**。读取端 = `0x1D3`/`0x1D4`/`0x2F3`。语料 **42760 处 / 333 个脚本**（最高频的原本未实现指令）。emulator：`OPS` 的 `op_text_item_push`（表模型 `vm/textItems.ts`；与读取端**同进同出**）。 |
| 0x1D3 | 5 |  | sub_42D4A0 | 已核对 | **文本项记录查询（写回两个操作数）**：`sub_457960(Font, &v7, op3, op4, op5)`：从下标 op4 起扫 `flags & 0x20000000 && +24 == op5` 的记录取 `+20`，遇组首（下一记录 flags bit0）即停 ⇒ **写 op1 = 找到?1:0、op2 = 值**；op3 被调用方忽略；handler=sub_42D4A0（raw .c 38096-38113） emulator：`OPS` 的 `op_text_item_query`（从下标 op4 起扫、key = op5；「组内最后一次命中」与「下一条是组首即停」照抄引擎；越界时 op1=0、op2 保持 0）。 |
| 0x1D4 | 4 |  | sub_42D510 | 已核对 | **文本项记录查询**：`sub_457A20(Font, &v7, &v6, &v5, op3, op4, 0)`：从 op4 起扫 `flags & 0x40000000 && +32 == 0`，输出 `+20/+24/+28` ⇒ **写 op1 / op2**（未找到 -1 / -1）；op3 被忽略；handler=sub_42D510（raw .c 38125-38149） emulator：`OPS` 的 `op_voice_item_query0`（选择器恒 0；未命中写 -1/-1）。 |
| 0x1D5 | 0 |  | sub_419880 | 仅映射 |  |
| 0x1D6 | 2 |  | sub_42E7C0 | 已核对 | **音乐表·追加扁平表**：`op1 ← sub_48A140(Engine[698900], op2)`（帧状态槽=5）。`Engine[698900]` = `Music[271]` = **PCM 播放器**（`Music` ctor `sub_489970` raw 106127-106132 → `sub_48D970` raw 108570-108578，vtable 0x5291FC）：op2 = 统一文件 id，追加进 `PCM+1304` 的「曲号 − 2 → 文件 id」表，返回**新曲号**（= 元素个数 + 1）。**全语料无调用点**。emulator 已真实现（`MUSIC_TABLE_OPS`）。handler=sub_42E7C0（raw 38731-38741） |
| 0x1D7 | 2 |  | sub_42E800 | 已核对 | **音乐表·确保组数**：`op1 ← (*(PCM->vtable+44))(PCM, op2)`（帧状态槽=5）= `sub_48AA60`（raw 106865-106914）。op2<0 ⇒ −1；组数 ≥ op2 ⇒ 把第 op2 组（1-based）截成**恰好 1 个元素**（下标 0 = 占位槽）并返回 0；组数 < op2 ⇒ 扩到 op2 组（每个空组补一个 0）再重置最后一组，返回**新组数 − 1**。★唯一调用点 `$3$AUTORUN.txt:67 i1d7 (global-int 1396) 1` ⇒ 组表为空 ⇒ 建「组 1 = [占位 0]」、global 1396 = 0。曾按 no-op 处理（理由「结果随即被丢弃」）—— **错**：写全局表本身是副作用，且该组表随后被 0x1D8 与 play-bgm 的曲号解析（vtable+8 = `sub_48DB80`）读取。emulator 已真实现。handler=sub_42E800（raw 38743-38755） |
| 0x1D8 | 3 |  | sub_42E850 | 已核对 | **音乐表·组内登记**：`op1 ← (*(PCM->vtable+60))(PCM, op2, op3)`（帧状态槽=7；取值顺序先 op3 后 op2）= `sub_48A1B0`（raw 106467-106506）。op2 = 组号（1-based）、op3 = 值（统一文件 id）；组越界（<1 或 > 组数）⇒ −1；组内元素 ≤1 ⇒ 追加 ⇒ `(组号<<24)|(新长度−1)`；组内 >1 ⇒ 从下标 **1** 起填第一个 0 槽 ⇒ 返回槽下标。★唯一调用点 `$3$AUTORUN.txt:68 i1d8 (global-int 70801e) 1 30003b2`（op3 = 包 3 的文件 id）⇒ global 70801e = `0x1000001`（该 global **无人读取**，但按「写全局表即副作用」照样实现）。emulator 已真实现。handler=sub_42E850（raw 38757-38771） |
| 0x1D9 | 2 |  | sub_4213F0 | 仅映射 |  |
| 0x1F4 | 0 |  | sub_41A090 | 已核对 | **进入"停靠(dock)"锁**：`_this[107438]`(字节 429752)=停靠标志、`_this[107439]`(429756)=**深度 LockDepth**（引擎 debug 打印 "LockDepth" 自证，raw 43619）。首次进入才采样时钟（`92334=92333`、`92333=timeGetTime()`），此后只 `++深度`。**不阻塞、无 Sleep**；脚本 66510 处 i1f4 = 每帧轮询点。handler=sub_41A090（raw 25194）。★T-0057：重写侧字段下标 = `107438/107439`（= 字节 429752/429756 ÷ 4） |
| 0x1F5 | 0 |  | sub_41A0E0 | 已核对 | **退出"停靠"锁**：`v1=_this[429756]`(LockDepth) >0 则 `--深度`；否则若 `_this[429752]` 置位 → 清标志，且 `_this[497400]`(==124350 dispatch_in_progress) 为 0 时 `sub_40FB60` 派发脚本队列（停靠期间只积累、解锁瞬间放行）。**不阻塞、无 Sleep**。handler=sub_41A0E0（raw 25214）。★T-0057 订正：raw 的 `*(_DWORD *)(_this + 429756)` 是**字节**寻址 ⇒ 下标 `107439/107438`，与 0x1F4 同一对格（重写侧曾把字节当键 ⇒ 停靠锁永不释放、时钟冻在第一帧） |
| 0x1F6 | 0 |  | sub_41A130 | 已核对 | **清空绘制容器全部 4 张表**（`sub_4AB7A0(Scene)`；Scene = `_this[80708]`，字节 322832）+ 复位脏标志。这是引擎里**唯一**的整批清场；脚本侧删除只经 0x1F7/0x1FA。handler=sub_41A130（raw 25239） |
| 0x1F7 | 2 | detach-texture | sub_422BC0 | 已核对 | **纹理子系统方法**：读 op1=handle、op2=count，按 count 分派图形子系统（同一套容器：`sub_4AB950` 的 `_this+1032`(字节) 与 `sub_4ABB60` 的 `_this[258]`(DWORD 下标) 都是 byte 1032 = 同一 draw-item 容器）。`count≤1`→`sub_4AB950(handle)`：**移除该 handle 单图元**（`sub_459EA0` 找 + `sub_4A8AF0` std::map erase，置脏 `[46508]=1`；TITLE hover 回退用它删旧 normal）。`count>1`→`sub_4ABB60(handle,count)`：**按 handle 区间批量移除**——4 个容器 lower_bound `handle` 与 `handle+count`，对 `[begin,end)` 逐结点 `sub_4A8AF0`(erase，经 `sub_4AA1D0`/`sub_4AA330`/`sub_4AA3D0`)，并销毁 `+266/+267` 容器每项 record（vtable 删 `[1]` + `operator delete` `[2]/[3]/[4]`），置脏 `[11627]=1`。→ **删 handle∈[handle,handle+count) 的全部绘制项/网格**。SYSTEM4/LOGO/TITLE 开机大量用（count 2/3/4/6/0x19/0x64/0x12c/0x1f4，批量清特效段）。handler=sub_422BC0（raw .c 31138）。emulator：count≤1→`detachTexture` 删单；count>1→`detachTexture` 删 `[handle,handle+count)` 区间。旧 label `u00420270` |
| 0x1F8 | 4 | create-texture | sub_422C20 | 已核对 | **create-texture**：读 op1=槽、op2/3/4 → 先释放**该槽的 movie 播放器对象**（`_this[slot+94672]` = pool[13964+slot]，`sub_488FB0`+delete+置 0），再 `sub_4A2C10(Scene, slot, w, h, mode)` 建程序化纹理（`operator new(0x450)`+`sub_48AB20`）；失败抛「CTexture エラー：テクスチャ作成に失敗．TEXTURE=%d」。★建出来的是**一张空白离屏表面**（非文件图像）：`0x204` draw-string / `0x205` 数字文本就是往它上面画；`0x207` 在槽之间搬运它。★槽**重建 = 旧表面（含画上去的字）一起丢**。handler=sub_422C20（raw 31161） |
| 0x1F9 | 3 | set-texture | sub_422CB0 | 已核对 | **set-texture**（唯一绑定）：`op1=imgid, op2=slot, op3=color`。清空 slot 旧纹理对象（`sub_488FB0`+置0），`sub_4559C0` imgid→路径 + `sub_455560` 开文件 → `sub_4A3800(_this+322832, imgid, hFile, slot, color, 0)` 载入纹理（`[5*slot+466]=imgid`）；失败抛「画像ファイル %s の読み込みに失敗しました」。handler=sub_422CB0（raw .c 31192） |
| 0x1FA | 1 |  | sub_422E00 | 已核对 | **release-texture**：读 op1=slot，释放 `_this[slot+94672]` 纹理对象（`sub_488FB0`+delete+置0），`sub_49E980(slot)` 释放该槽（`[5*slot+466]=-1`）。handler=sub_422E00（raw .c 31246） |
| 0x1FB | 8 | draw-texture | sub_422E70 | 已核对 | **draw-texture**：**op1 = 图元 handle（= Scene map 的 key，同时是层序，越小越先画）**、**op2 = 纹理槽号**（存 DrawItem`+4`，渲染时 `Scene+4*slot+42456` 取 `CTexture*`）、op3/op4 = 源 x/y、op5/op6 = 源 w/h、op7/op8 目标位置。★**源矩形在元素里存成 left/top/right/bottom**：handler 先 `SetRect(&rc, op3, op4, op3+op5, op4+op6)`（raw 31287-31293）再 `sub_4ACE50(Scene, handle, slot, rc.left, rc.top, rc.right, rc.bottom, op7, op8, 0)`（raw 31299）→ 元素 `v13[2..5]` = `+8/+0xC/+0x10/+0x14`；所以**元素内"源宽" = `+0x10 − +8`**（flipbook 的格子尺寸就取这个，raw 117798）。Arity=17。handler=sub_422E70（raw 31271）。★2025 修正：op1 是 handle/key、op2 是纹理槽（旧文档把二者写反）；元素内部**不存 layer** |
| 0x1FC | 1 |  | sub_422F80 | 已核对 | **复位图元变换**：`sub_4AC470(Scene, op1)` —— 清该 DrawItem 的变换字段（`+104`、`+132..+164` 等批量清零）。handler=sub_422F80（raw 31303-31310）。语料 0 处。emulator：`OPS` 的 `op_reset_prim_transform` → 宿主缝 `native.resetPrimTransform`（记录进 `SceneState.render4`）。 |
| 0x1FD | 4 |  | sub_422FD0 | 已核对 | **绘制项「立即缩放」**（无动画窗；2D 唯一的"立刻设缩放"指令）：`op1`=handle、`op2/3/4` = sx/sy/sz（`sub_41C300(...) / dbl_5201F0`，**÷100** —— `dbl_5201F0 = 100.0`（raw 4430），脚本里 `64` = 100% = 1.0）→ `sub_4AC5F0`（raw 131333）：`sub_4AAA50` 缺失即建项 → `+0x68 = 1`（**用世界矩阵**）+ `D3DXMatrixScaling(元素+0x6C, …)`（缩放 **work** 矩阵）→ 置脏 `Scene+46508`。★渲染期用的就是这份 work 矩阵（`sub_49AA30` raw 117431 `qmemcpy(v118, a2+27, 64)`），故**立即生效**；写 target + 开窗的是 `0x21E`。★订正：旧文档记作「3D 缩放 / ÷256」，两处都错。handler=sub_422FD0（raw 31313） |
| 0x1FE | 5 |  | sub_423060 | 已核对 | **图元变换 4 浮点**：读 op2..op5 **四个 float（原样，不除 100）** → `sub_4AC660(Scene, op1, …)`（把 4 个值写进该 DrawItem 的变换字段）。★与 `0x1FD` 的区别：**0x1FD 是缩放且 ÷100**、本条不缩放。handler=sub_423060（raw 31330-31345）。语料 7 处 / 5 个脚本。emulator：`OPS` 的 `op_prim_transform4` → `native.setPrimTransform4`。 |
| 0x1FF | 4 |  | sub_4230F0 | 已核对 | **DrawItem 像素平移**：`op1`=DrawItem id、`op2/op3/op4`=float x/y/z（**像素单位**，无 /100、无 /256）→ `sub_4AC750(Scene, id, x, y, z)`：`sub_4AAA50` 保证项存在 → DrawItem`+0x68 = 1`（**用世界矩阵**）→ `D3DXMatrixTranslation(元素+0x16C, x,y,z)` 写**平移 work 矩阵**，**立即生效、无动画窗**（与 0x220 写 target + 开窗不同）→ 置脏 `[11627]=1`。★对照 0x1FD：**平移用像素、缩放用百分数**（0x1FD 的 op2..op4 经 `/dbl_5201F0`）。handler=sub_4230F0（raw .c 31348） |
| 0x200 | 1 |  | sub_423170 | 仅映射 |  |
| 0x201 | 1 |  | sub_4302B0 | 已核对 | **配置 getter**：`op1 = Engine[166964]`（= DrawMode）。★T-0057：重写侧曾恒写 0，现按字段读回 |handler=sub_4302B0（raw .c 39859） |
| 0x202 | 5 | set-draw-color | sub_4231F0 | 已核对 | **set-draw-color**：读 op4=alpha（>255 clamp 255，<0 取当前色 `sub_4ADD60>>24`）、op5=color（<0 取当前色）、op2/op3 参数、op1=图元；组装 ARGB（`(color&0xFFFFFF) | ((alpha&0xFF)<<24)`）→ `sub_4AD0C0(Scene, handle, delay, dur, argb)`。引擎写入（raw 131957-131981）：**门控 `flags & 1`（元素必须已创建）** → `flags |= 2`（颜色动画启用）、`+0x34 = 0`（**全项共享的动画起点，此处清 0 表示"下一帧锁存"**）、`+0x38 = delay`、`+0x4C = dur`、`+0x64 = TO 色`；并置脏 `_this[11627]=1` 与图形池挂起 `_this[11629]=1`。**注意它不写 `+0x60`（工作色/FROM）** —— FROM 由 0x203 写。handler=sub_4231F0（raw .c 31382） | ★**逐帧求值器（2026 复核确证）**：在 `sub_49AA30` 内 raw 117434-117483 —— 由 DrawItem 渲染器 `sub_4AEEA0` 在 raw 133389 以 `a2 = 该 DrawItem` 调用（第 4 参 `COERCE_FLOAT(&v25)` 是**颜色变量的地址**，函数内 `v117 = a4`，插值结果写回 `*v117`），随后 raw 133443 把该值作 diffuse 交 `sub_4A2D50`。公式：`we = clock − start − delay`、`left = dur − we`、`ch = (left·from + we·to)/dur`（**整数截断**，通道序 B/G/R/A）；窗末 `+0x60 ← +0x64`、`+0x64 = NaN`、`+0x38/+0x4C` 清 0 并置 pending `Scene+46516`（raw 117844）。局部副本 raw 133447 `qmemcpy(元素, v26, 0x2E4)` **写回元素**。
| 0x203 | 4 | set-draw-color-alpha | sub_4232C0 | 已核对 | **set-draw-color-alpha**：读 op3=alpha（clamp/回退）、op4=color（回退），组装 ARGB → `sub_4ACF60(Scene, handle, op2, argb)`。引擎写入（raw 131871-131883）：`+0x30 = op2`（**混合模式**，0=默认）、`+0x60 = FROM 色（当前工作色）`；只置脏 `_this[11627]=1`（**不置挂起位、不清动画窗**）⇒ 可随时改工作色做 hover 高亮/回退，且正在跑的 0x202 窗会从新的 FROM 继续插值。handler=sub_4232C0（raw .c 31419） | ★该 FROM 就是颜色窗的插值起点：`sub_49AA30` 在窗内用 `(left·FROM + we·TO)/dur` 逐帧算 diffuse（raw 117470 写回调用方指针），所以 **0x203 可在窗内任意时刻改 FROM 并立即参与插值**。
| 0x204 | 4 | draw-string | sub_423390 | 已核对 | **draw-string（直绘，不入队）**：读 op1=纹理槽、op2=x、op3=y、op4=字符串 → `sub_456710(Font, op1, 串op4, op2, op3)`（raw 68470）。**三个门**（raw 68478-68480）：该槽的 `CTexture` 必须存在、vtable+32 可锁定、串非空 —— 否则整条**什么都不做**（不抛错）。落笔：按 `GetTextMetricsA` 的 ascent 定位（`Font+201680 == 1` 时再加 `Font+201712`），用当前字体（`Font+1084`）与全局颜色/描边（`Font+1360/+1364/+1372`）；带描边走 `sub_471180`，否则 `sub_46F2D0`。★**与消息窗文本是两条独立路径**（本指令不排版、不换行、不走窗）；`CONFIG1` 用它把每行"项目名 + 数值"写进 `create-texture 196 628 360` 出来的离屏槽，再按行裁贴到列表行上（`CONFIG1.txt:2760/2773` + `:3019-3022`）。handler=sub_423390（raw .c 31454） |
| 0x205 | 6 |  | sub_4233E0 | 已核对 | **消息子系统的 GDI 数字文本绘制**：`op1`=目标纹理槽、`op2`=x（in/out，`sub_4072F0` 会更新）、`op3`=y、`op4`=数值、`op5`=字段宽（字符数）、`op6`=格式标志（bit0x10000 全角、bit1 居中、bit2 左对齐、bit3 正数带 `+`）→ `sub_4072F0(_this, …, &x, 数值, 宽, 标志)` 把数值格式化成字符串，再 `sub_456710(_this+21324, 槽, 串, x, y)`（`GetTextMetricsA` 后写进 `*(Engine+21324+1040)+4*op1+42456` 的 1000 槽纹理表）。**旧注「仅映射」为误**。handler=sub_4233E0（raw .c 31470） emulator：`OPS` 的 `op_draw_number_string` —— 格式化纯函数 `formatNumberCell`（补零/符号/溢出 `#` 逐条照抄）、**回写 op2 = x + 前进量**（居中 `start*cy/4`|`/2`、左对齐 0、右对齐 `start*cy`|`/2`）、非半角时按 `sub_41A6C0` 转全角后交 `native.drawString`。★**订正**：op6 的 `bit16` 是**半角**而非「全角」——`(flags & 0x10000) == 0` 时才把 ASCII 转 SJIS 全角。缺口：`set:BlankExtentMode == 1` 的 GDI 字宽量测未建模（统一用字号当格宽）。 |
| 0x206 | 7 |  | sub_41A160 | 仅映射 |  |
| 0x207 | 8 |  | sub_423480 | 已核对 | **槽→槽 StretchRect**：`src = {op3, op4, op3+op5, op4+op6}`、`dst = {op7, op8, op7+op5, op8+op6}` → `sub_4A3980(Scene, op1 源槽, op2 目标槽, src, dst)`（源/目标同尺寸）。handler=sub_423480（raw 31494-31521）。语料 24 处 / 3 个脚本。emulator：`OPS` 的 `op_blit_slot_to_slot` → `native.blitSlotToSlot`。 |
| 0x208 | 3 |  | sub_4302E0 | 已核对 | **纹理尺寸 getter（会写回脚本操作数）**：`op1`=纹理槽（合法 0..999）→ `sub_49ED60(Scene, slot, &w, &h)` 读该槽 `CTexture+1040`（宽）/`+1044`（高）→ 分别 **写回 op2 / op3**（`sub_42B4B0`）。★漏实现会让脚本拿到未初始化的宽高并引发**脚本层逻辑错误**（不只是画面问题）；槽越界/未创建时引擎写 0/0 且只记日志（`sub_4034C0`），**不改控制流**。handler=sub_4302E0（raw .c 39866；`sub_49ED60` raw 119774） |
| 0x209 | 5 |  | sub_423580 | 仅映射 |  |
| 0x20A | 1 |  | sub_423620 | 仅映射 |  |
| 0x20B | 7 |  | sub_423690 | 已核对 | **纯色+α 填充(渐变/压黑覆盖原语)**：读 op1=纹理、op2..op5=矩形(op4=op2+宽,op5=op3+高)、op6=α(>255 钳 255)、op7=颜色；`sub_4A4C70` 走纹素 vtable(+24) 填充。handler=sub_423690（raw .c 31569） |
| 0x20C | 0 |  | sub_41A1A0 | 已核对 | **绘图帧控制**：帧计时（timeGetTime 写 `_this[92333/92334]`）+ 调图形子系统 `sub_4B4040(_this+80708)`、`_this[168998]=0`。handler=sub_41A1A0（raw .c 25258）。方向：渲染/帧控制 |
| 0x20D | 1 | set-render-target | sub_423770 | 已核对 | **设置渲染目标**：读 op1=纹理槽 → `sub_4A50C0(Scene, op1)`（raw 124819-124912；`-1`/`0xFFFFFFFF` = 回到后台缓冲，同函数 raw 127911/25284 的用法）。★**它有读者**：`0x203`/`0x322` 混合选择子的**值 2 是门控的** —— 只有「当前渲染目标槽（`Scene+46456`）指向的纹理创建模式 == 1」时才设 `(ONE,ZERO)` 覆盖（`sub_4A2D50` raw 123110-123115 / `sub_49E390` raw 119381-119386；模式由 `0x1F8` 的 op4 写进 `CTexture+1048`）。语料 841 处（`i20d 2` / `i20d (local-int 0)`）。emulator：`op_set_render_target` → `scene.render4.renderTargetSlot`（`tickets/T-0017`） |
| 0x20E | 0 |  | sub_41A200 | 已核对 | **图形提交**：`sub_41A200` —— `if (Engine[80684]==1 && Engine[92322]==-1)` 时 `sub_4A50C0(Scene, 0x26)`（压渲染状态 38）+ `sub_498B60(Engine+321572)`（设备 `Clear(0,0,3,0,1.0,0)` = 清 target+z）+ `sub_4A50C0(Scene,-1)`；**两条路径最后都会**再调一次 `sub_498B60`。handler=sub_41A200（raw 25277-25287）。语料 **786 处 / 342 个脚本**。emulator：`OPS` 的 `op_commit_graphics` → `native.commitGraphics`（记录次数；重写侧每帧自绘，不需要 Clear）。 |
| 0x20F | 3 |  | sub_4237B0 | 已核对 | **play-movie**：读 op1=movie资源id、op2=slot、op3=模式/音量；构造/复用 `[4*slot+378688]` movie 对象，`sub_454FA0` 取路径、`sub_488DC0` 装载（失败抛「…」）、`sub_489230` 绑定、`sub_4054D0` 求播放模式、`sub_408350` 求音量、`sub_4885A0` 设音量、`sub_4883A0` 启动；置 `_this[699204]\|=0x2000`、`_this[675972]=1`。handler=sub_4237B0（raw .c 31605） |
| 0x210 | 1 |  | sub_423980 | 仅映射 |  |
| 0x211 | 1 |  | sub_4239F0 | 仅映射 |  |
| 0x212 | 2 |  | sub_423A30 | 已核对 | **消息窗对象字段**：读 op1=对象下标、op2=值；`_this[op1+21585]` 对象非空则写其 `+100=op2`。handler=sub_423A30（raw .c 31742） |
| 0x213 | 3 |  | sub_423A80 | 已核对 | **消息窗对象字段**：读 op1=对象下标、op2/op3；对象非空写 `+104=op2`、`+108=op3`。handler=sub_423A80（raw .c 31758） |
| 0x214 | 2 |  | sub_423AE0 | 已核对 | **交换两条绘图项记录**：op1/op2 = 两个 **handle**（都是输入、无输出）→ `sub_4ABEF0(Scene, op1, op2)`（raw 131084-131143）：在**绘图项表**（Scene+1032）里把两条 **740 字节（0x2E4）** 记录**整块互换**（`qmemcpy` ×2，raw 131135-131139）+ 置脏位 `Scene[11627]=1`。⇒ **键(handle)不动**：纹理槽 `+4` / 源矩形 `+8..+20` / 描画位置 `+36..+44` / pivot / 5 个动画窗 / 颜色 / 矩阵 / flipbook 全换，而**绘制次序不变**（层序 = map key，见 0x1F8/0x1FB 的说明）。一侧缺键 ⇒ 先建一条全 0 记录（`sub_40C910`，flags 无 bit0 ⇒ 不画）再搬；两侧都缺 ⇒ 只置脏位，**引擎无错误串** ⇒ 是合法无操作。★只碰绘图项表；网格表（Scene+1064）**不动** —— 与 0x21D CopyScene（两张表都拷）不同。语料 **229 处**：ADV 章节脚本的收场块把两套立绘句柄基址里的第 i 个互换、随后把脚本自己的记账表 `3f54` 两列也换掉（`src/SC0000.txt:6324-6336`、`6885-6895`）；`src/BUNKIMOVE.txt:43-77` 是 10 个一组、按 `0x64` 步长的批量搬运。handler=sub_423AE0（raw .c 31779）。emulator：`GFX_ITEM_OPS` 的 `op_swap_items` → `native.swapItems` → `scSwapItems`（原地交换、保留对象身份），守卫 `test/op-214-swap-items.test.ts` |
| 0x215 | 2 |  | sub_430340 | 已核对 | **绘制项 → 纹理槽号（getter）**：`op1 = sub_4ADC20(Scene, op2)`（DrawItem`+4`；项不存在或 `flags&1==0` ⇒ **−1**）。★会回写 op1；语料 `src/SN0000.txt:3125`。emulator：`OPS` 的 `op_get_draw_texture_slot` + `native.getDrawItemTexSlot`。handler=sub_430340（raw .c 39880） |
| 0x216 | 2 |  | sub_430380 | 已核对 | **纹理槽 → imgid（getter）**：`op1 = Engine[5*op2+81174]` ＝ `Scene[5*slot+466]` ＝ `set-texture` 写的唯一槽↔图像绑定表。★会回写 op1；语料 `src/SN0000.txt:3128`。emulator：`OPS` 的 `op_get_slot_imgid`（读 `Engine.texSlots`）。handler=sub_430380（raw .c 39891） |
| 0x217 | 4 |  | sub_423B20 | 已核对 | **绘制项「旋转/缩放中心 pivot」**：读 op1=handle、op2/3/4=3 float → DrawItem`+24/+28/+32`；绘制期 `sub_49AA30` 读 a2[6..8]（raw 117368），先 `T(-pivot)`（raw 117428，在缩放/旋转之前**最右乘**）后 `T(+pivot)`（raw 117932，最后**最右乘**）夹住 work 缩放/旋转/平移矩阵 ⇒ 世界旋转/缩放绕该点，**不改位置**。★★pivot 与描画位置（`0x219`）**同处一个坐标空间（都是绝对坐标）**：`sub_4A2D50` 把 `&v26[9]` 当目标位置交给纹理绘制（raw 133443 / 122974），故合成结果 = `v' = S·(v − pivot) + pivot`（v = 描画位置 + 局部偏移）⇒ 等价于"把项放在 pos、绕 pivot 缩放"。脚本里的实际用法：`CONFIG1.txt:2958-2962` 的滚动条拇指中段 `i217 <obj> <dstX> <dstY> 0`（pivot == 描画位置 ⇒ 以左上角为基准纵向拉伸）。handler=sub_423B20 → sub_4ACF20（raw 131857） |
| 0x218 | 4 |  | sub_4303C0 | 已核对 | **绘制项 pivot 三元组（getter）**：`op2/op3/op4 =` DrawItem`+24/+28/+32`（`sub_4ADCF0`；项不存在 ⇒ 全 0）。★会回写 op2/3/4（float）；与 0x21A 是两个不同的三元组。emulator：`OPS` 的 `op_get_draw_pivot` + `native.getDrawItemPivot`。handler=sub_4303C0（raw .c 39902） |
| 0x219 | 4 |  | sub_423BA0 | 已核对 | **绘制项「描画位置 (x,y,z)」**：读 op1=handle、op2/3/4=3 float → DrawItem`+36/+40/+44`；绘制期 `sub_4AEEA0` 读 `&v26[9]` 交 `CTexture::Draw`（vtable+20）。★与 0x217 的 pivot 是**两个不同三元组**。handler=sub_423BA0 → sub_4ACEE0（raw 131843） |
| 0x21A | 4 |  | sub_430450 | 已核对 | **绘制项描画位置三元组（getter）**：`op2/op3/op4 =` DrawItem`+36/+40/+44`（`sub_4ADC80`；项不存在 ⇒ 全 0）。★会回写 op2/3/4（float）；语料 `src/SN0000.txt:1029` 取当前位置加偏移后 `i219` 写回。emulator：`OPS` 的 `op_get_draw_pos` + `native.getDrawItemPos`。handler=sub_430450（raw .c 39916） |
| 0x21B | 1 |  | sub_423C20 | 已核对 | **引擎布尔标志**：读 op1，写 `_this[166965]=(op1!=0)`（成对读取方 sub_430810 回写操作数 1）。handler=sub_423C20（raw .c 31823） |
| 0x21C | 0 | wait | sub_41A260 | 已核对 | **每脚本引擎状态槽→0x400 动画等待**：读 cur，写 `_this[30*cur+95805]=1`、`_this[174801]\|=0x400`（版权页/淡入淡出的"等几秒"等待门）。handler=sub_41A260（raw .c 25290）。旧 label `u00416270` |
| 0x21D | 2 |  | sub_423C60 | 已核对 | **CopyScene**：`op1` = 源 handle、`op2` = 目标 handle（取值顺序先 op2 后 op1）→ `sub_4AC0D0(Scene, op1, op2)`（raw 131146）= 把源绘图项（+同 key 的网格）**整块复制**到目标 handle（引擎 `qmemcpy` 0x2E4/0x3C/0x23C；三张 map 都没命中 ⇒ 打「関数：CopyScene エラー：コピー元のシーンが存在しません」串并返回 0）。语料：`ROOM.txt:83/391`、`MMODE.txt:71/763`（把预置的全屏过渡幕布 handle 0 复制成临时项 `0x1f4`/`0x7d0` 再单独改色做淡入淡出）、`$1$SC0330.txt:17564`（复制 CG 图元做缩放绘制）。handler=sub_423C60（raw 31834-31843）；emulator：`scene/ops.ts` 的 `scCopyItem` + `OPS` 的 `op_copy_scene` |
| 0x21E | 6 |  | sub_423CA0 | 已核对 | **缩放动画窗（DrawItem 窗1）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4/5/6 = sx/sy/sz`（`sub_41C300(...) / dbl_5201F0`，**÷100** —— `dbl_5201F0 = 100.0`（raw 4430），脚本里 `64` = 100%）→ `sub_4AD170(Scene, handle, delay, dur, sx, sy, sz)`（raw 31846-31862）。引擎写入（raw 131984-132018）：门控 `flags & 1` → `|= 2`、`+0x34 = 0`（共享起点）、`+0x3C = delay`、`+0x50 = dur`、`+0x68(+104) = 1`、`D3DXMatrixScaling(元素+0xAC, sx,sy,sz)`（**目标**缩放矩阵；工作矩阵在 `+0x6C`）→ 置 `[11627]=1`、`[11629]=1`。★`dur` 是插值分母（ms）。★订正：旧文档写 `÷256`（把 `dbl_5201F0` 误记为 256.0）——它是 **100.0**，`0x12c`=300 ⇒ 3.0 倍。handler=sub_423CA0（raw .c 31846） |
| 0x21F | 7 |  | sub_423D40 | 已核对 | **旋转动画窗（DrawItem 窗2）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4/5/6 = 旋转轴 (x,y,z)`、`op7 = 角（度）` → `sub_4AD250(...)`（raw 31867-31885）。引擎写入（raw 132022-132075）：`|= 2`、`+0x34 = 0`、`+0x40 = delay`、`+0x54 = dur`、`+0x68 = 1`、轴存 `+0x1F8/+0x1FC/+0x200`、止角存 `+0x208`（起角在 `+0x204`），并 `D3DXMatrixRotationAxis(元素+0x12C, axis, θ·π/180)`（**目标**旋转矩阵）。度数→弧度换算常量 `dbl_526C98/dbl_5263F0`。handler=sub_423D40（raw .c 31867） |
| 0x220 | 6 |  | sub_423DE0 | 已核对 | **平移动画窗（DrawItem 窗3）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4/5/6 = 位移 (x,y,z)`（★**不除 256**，与 0x21E 不同）→ `sub_4AD3C0(...)`（raw 31889-31905）。引擎写入（raw 132081-132114）：`|= 2`、`+0x34 = 0`、`+0x44 = delay`、`+0x58 = dur`、`+0x68 = 1`、`D3DXMatrixTranslation(元素+0x1AC, x,y,z)`（**目标**平移矩阵）。handler=sub_423DE0（raw .c 31889） |
| 0x221 | 4 |  | sub_423E70 | 仅映射 |  |
| 0x222 | 2 |  | sub_423EC0 | 仅映射 |  |
| 0x223 | 8 |  | sub_423F00 | 仅映射 |  |
| 0x224 | 0 |  | sub_41A290 | 已核对 | **清转场表**：`sub_41A290` → `sub_4AA180(Scene)` → `sub_4A9BE0(Scene+1048)`（清空转场容器）。handler=sub_41A290（raw 25301-25305）。语料 **334 处 / 334 个脚本**。emulator：`OPS` 的 `op_clear_transitions` → `native.clearTransitions`。 |
| 0x225 | 2 |  | sub_423F80 | 仅映射 |  |
| 0x226 | 5 |  | sub_4304E0 | 仅映射 |  |
| 0x227 | 6 |  | sub_4305A0 | 仅映射 |  |
| 0x228 | 5 |  | sub_430650 | 仅映射 |  |
| 0x229 | 5 |  | sub_423FE0 | 已核对 | **绘制模式 5 元组**：`sub_423FE0` → `sub_49A690(Scene)`（复位）+ `sub_49A6C0(Scene, op1, op2)`（写 `Scene[278]/[279]`）+ `sub_49A6F0(Scene, f3, f4, f5)`（写 `Scene[286..288]`）；三者都置 `Scene[11627]=1`（脏标记）。handler=sub_423FE0（raw 31984-32001）。语料 **716 处 / 346 个脚本**。emulator：`OPS` 的 `op_set_draw_mode` → `native.setDrawModeBlock`。 |
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
| 0x238 | 1 |  | sub_4248C0 | 已核对 | **装载 `0x400` 等待门的时长**：`Engine[92338] = 0`、`Engine[92339] = op1`（字节 369352/369356）。★2026-09 订正（原记"画布尺寸对"，无依据）：这两格就是 `sub_407E20`（raw 12762-12786）读的**等待计时器起点/时长**（池基别名 `_this[11630]`/`_this[11631]`，现在值取 `_this[11625]` = `Engine[92333]` = `timeGetTime()`）：计时器未到点 ⇒ `sub_407E20` 直接返回 1 ⇒ 主循环 `0x400` 分支（raw 21109-21153）不放行。⇒ 脚本的 **`i238 N` + `wait`（`0x21C`）就是"等 N 毫秒"**；语料 2056 处、取值全是整毫秒（`0xC8/0x1F4/0x3E8/0x7D0/0x9C4…`）与"画布尺寸"不符。handler=sub_4248C0（raw 32303-32312）。**emulator：已建模**（`Engine.gateWaitStart/gateWaitMs`，`tickets/T-0024`）：`0x238 v` ⇒ 起点清零、时长 = v；`0x21C wait` 置门后由 `Engine.gatePending`（= `sub_407E20`）决定放行 —— 计时器未到点一律不放行、到点清两格再看池挂起位（`Scene+46516`）。E3 实测（真实语料链路的门驻留）：`SN0000` 的 `i238 0x157C/0x64/0x7D0/0xC8` 四道门 waited 分别为 5500/100/2000/200 ms = 脚本值。 |
| 0x239 | 6 |  | sub_424900 | 已核对 | **flipbook 动画窗（DrawItem 窗4）**：`op1=handle`、`op2=delay`、`op3=dur`、`op4=总帧数`、`op5=每行列数`、`op6=标志` → `sub_4AD4A0(Scene, handle, delay, dur, frames, cols, flags)`（raw 32314-32331）。引擎写入（raw 132119-132145）：`|= 2`、`+0x34 = 0`、`+0x48 = delay`、`+0x5C = dur`、`+0x238 = frames`、`+0x23C = cols`、`+0x234 = flags`（**bit0 = 窗末保持末帧**）。★逐帧求值改的是**源矩形**而非 UV（raw 117797-117831）：`frame = frames·(clock−start−delay)/dur`、`col = frame % cols`、`row = frame / cols`，源矩形偏移 `(col·srcW, row·srcH)`；窗末 `flags&1` ⇒ 停在 `frames−1` 帧，否则复位到 draw-texture 给的源矩形。handler=sub_424900（raw .c 32315） |
| 0x23A | 2 |  | sub_4306F0 | 仅映射 |  |
| 0x23B | 7 |  | sub_424970 | 已核对 | **按 CG 数字条画数值**：`op1`=起始 DrawItem id、`op2`=CG 数字条记录号（0..0xA）、`op3`=数值、`op4/op5`=x/y 偏移、`op6`=位数、`op7`=对齐/补零标志（bit0 补前导零、bit1 居中、bit2 左对齐）。先 `sub_4ABB60(Scene, op1, op6)` **同时删 DrawItem(`Scene+1032`) 与 MeshEntry(`Scene+1064`) 的 `[op1, op1+op6)` 区间**（raw 130875/130909/130912-130971），再逐位 `sub_4ACE50(Scene, id, 记录[0], 源矩形, x, y, 0)` 建 DrawItem。记录 `rec`（Engine+388332+28*n）几何：`[0]` 纹理槽 / `[1]` x0 / `[2]` y0 / `[3]` 单字宽 / `[4]` 字高 / `[5]` 字内空隙 / `[6]` 字距；字源矩形 x = `rec[1] + (rec[3]+rec[5])·(value%10)`、右 = `+rec[3]`；y = `rec[2]`、下 = `+rec[4]`。三种 x（`k` 从 `op6−1` 递减到 0，同时 `value%=10` 取位 ⇒ **id = 个位、id+1 = 十位…自右向左**）：居中 `k·adv − adv·(last−数位+1)/2 + op4`、左对齐 `(数位−1−… )·adv + op4`、否则右对齐 `k·adv + op4`（`adv = rec[3]+rec[6]`）；前导零跳过，除非 `op7 & 1` 或是最高位那一轮。记录号非法或 `rec[0]==0` → 仅日志「CG番号…」。handler=sub_424970（raw .c 32335） |
| 0x23C | 0 |  | sub_41A2C0 | 已核对 | **帧毫秒时钟**（名字像空操作，其实是 `timeGetTime`）：`_this[92334] = _this[92333]; _this[92333] = timeGetTime();`（字节 369336 / 369332）。同一对字段在主循环里以同样两条赋值维护（raw 20750-20751，紧跟 `sub_4B4040` 渲染调用前），而 0x20C（`sub_41A1A0`）做同样的事**并追加渲染**（raw 25259）⇒ **0x23C = 只刷时钟、不渲染**。★与 0x1F4（停靠锁）不同：0x1F4 只在**未锁定**时刷时钟，0x23C 无条件刷（raw 25312-25315）。handler=sub_41A2C0（raw .c 25308） |
| 0x23D | 0 |  | sub_41A300 | 已核对 | **销毁 movie/纹理槽 42..999**（958 次）：对 `Engine+4*(94714+k)`（CMovieToTexture 族）调 `sub_488FB0`+vtable[0](obj,1) 析构，并对 Scene 调 `sub_49E980(Scene,i)` 卸槽 ⇒ 引用这些槽的图元不再绘制。handler=sub_41A300（raw 25320）。（旧注"停靠标志/纹理槽释放"为误） |
| 0x23E | 2 |  | sub_430750 | 仅映射 |  |
| 0x23F | 2 |  | sub_4307B0 | 仅映射 |  |
| 0x240 | 4 |  | sub_424DA0 | 仅映射 |  |
| 0x241 | 5 |  | sub_424FA0 | 仅映射 |  |
| 0x242 | 2 |  | sub_4251A0 | 已核对 | **写 DrawItem `+720`**：`sub_4AD9A0(Scene, op1, op2)` —— 经 `sub_4AAD40(Scene+258)` 取该 DrawItem 写 `+720`，并 `sub_4AAEC0(Scene+270)` 取相邻对象写 `+504`。handler=sub_4251A0（raw 32649-32658）。语料 **350 处 / 205 个脚本**。emulator：`OPS` 的 `op_set_draw_entry_param` → `native.setDrawEntryParam`。 |
| 0x243 | 0 |  | sub_41B180 | 仅映射 |  |
| 0x244 | 0 |  | sub_41A370 | 已核对 | **批量清绘制项的动画窗起点**：`sub_4AD9F0(Engine+322832, 2)` 遍历 Scene 的三张绘制项链表（`+1036`/`+1084`/`+1100`），对 `flags & 2` 的项把 `anim_start`(`+52`) 或 `+24` 清 0（raw 132364-132503）。语料 1 处（`CALLBACK_LOAD.txt` 的 `i244`）。emulator：`ENGINE_INTERNAL_OPS` no-op（我们的 `animStart` 窗推进语义不完全同构，如实记缺口，`tickets/T-0072`） |
| 0x245 | 2 |  | sub_4251E0 | 已核对 | **纹理对象的浮点参数**：`obj = Engine[op1+94672]`（CTexture 表），存在则 `sub_4081B0(obj, op2 / dbl_51FB50)`。handler=sub_4251E0（raw 32661-32676）。语料 0 处。emulator：`OPS` 的 `op_texture_obj_float` → 宿主缝 `native.setTextureObjectFloat`。 |
| 0x246 | 2 |  | sub_425250 | 已核对 | **纹理对象子对象的 `vtable+56` 调用**：`obj = Engine[op1+94672]`，若 `*(obj+1084) == dword_52839C`（类型判定）则用 `op2 / dbl_5201F0`（÷100）调用 `(*(obj+1044))+56`。handler=sub_425250（raw 32680-32700）。语料 0 处。emulator：`OPS` 的 `op_texture_obj_param` → 宿主缝 `native.setTextureObjectParam`。 |
| 0x247 | 1 |  | sub_430810 | 已核对 | **读引擎布尔标志写回操作数**：`op1 = (Engine[166965] != 0)`（0/1）。与设置方 `0x21B`（sub_423C20）成对，构成脚本可读写的引擎级布尔寄存器；handler=sub_430810（raw .c 40034-40038） |
| 0x248 | 1 |  | sub_4252E0 | 已核对 | **模块静态配置**：读 op1 写全局 `dword_55052C`（默认 256，图像缩放/坐标换算的格子除数）。handler=sub_4252E0（raw .c 32705） |
| 0x249 | 3 |  | sub_425310 | 已核对 | **按统一 id 载纹理进槽（带颜色）**：先释放 `Engine[op2+94672]` 旧对象 → `sub_4559C0` 按 id 打开文件（写 FileDB「已使用」表）→ 颜色 = `op3 < 0 ? 0 : (0xFF000000|op3 低 3 字节)` → `sub_4A3800(Scene, id, hFile, op2, color, 1)`；**失败抛 `画像ファイル %s の読み込みに失敗しました`**。handler=sub_425310（raw 32717-32768）。语料 20 处 / 8 个脚本（BTL/ALLMAP/MOVERUIN/SHOWALLMAP…）。emulator：`OPS` 的 `op_load_texture_by_id`（槽绑定 + 已使用标记 + `native.bindTexture`；文件缺失归宿主）。 |
| 0x24A | 3 |  | sub_430840 | 仅映射 |  |
| 0x24B | - |   | sub_425460 | 仅映射 |  |
| 0x24C | - |   | sub_425530 | 仅映射 |  |
| 0x24D | 12 |  | sub_4255E0 | 仅映射 |  |
| 0x24E | 1 |  | sub_4258C0 | 已核对 | **配置字段**：读 op1 写 `_this[92340]`。handler=sub_4258C0（raw .c 32958）。方向：配置字段 |
| 0x24F | 10 |  | sub_4258F0 | 仅映射 |  |
| 0x250 | 10 |  | sub_425980 | 仅映射 |  |
| 0x251 | 12 |  | sub_425A10 | 仅映射 |  |
| 0x252 | 1 |  | sub_425AB0 | 已核对 | **消息/系统配置字段**：读 op1 写 `_this[92323]`。handler=sub_425AB0（raw .c 33058） |
| 0x253 | 2 |  | sub_425AE0 | 仅映射 |  |
| 0x254 | 5 |  | sub_425B20 | 仅映射 |  |
| 0x255 | - |   | sub_425BC0 | 仅映射 |  |
| 0x256 | 5 |  | sub_425C30 | 已核对 | **按 id 找 DrawItem 并写参数**：`sub_4ACD10(Scene, op1, op2, f3, f4, f5)` —— 遍历 DrawItem 表按 id（`+12`）匹配后写字段。handler=sub_425C30（raw 33120-33135）。语料 5 处 / 3 个脚本。emulator：`OPS` 的 `op_set_slot_params` → `native.setSlotParams`。 |
| 0x257 | 5 |  | sub_425CA0 | 仅映射 |  |
| 0x258 | 2 |  | sub_425D20 | 已核对 | **纹理槽标志对**：按 `op2` 的 bit0/bit1 把 `1/0` 写进**两张镜像表**（`Scene+1872+20*op1` 与 `Scene+21872+20*op1` 的 `[+0]/[+4]`）。handler=sub_425D20（raw 33156-33185）。语料 **11356 处 / 334 个脚本**（本批用量最大）。emulator：**建模** —— `OPS` 的 `op_set_slot_flags` 写 `Engine.texSlotFlags`（值 = `bit0|bit1<<1`）。 |
| 0x259 | 0 |  | sub_41A3A0 | 已核对 | **清两张 1000×2 组 5-DWORD 槽记录表**（`Engine+86176` 起、步长 5 dword；主/影 +81176/+86176），每项写 +8/+12，共 4000 dword=16KB，**只清记录、不 delete 对象**。handler=sub_41A3A0（raw 25357）。（旧注"纹理槽释放"为误） |
| 0x25A | 1 |  | sub_425DB0 | 已核对 | **消息态影片（模式 1）**：`Engine[92379] = 1`、`[92380] = op1`；模式变化（`Engine[92377] == 0`）或非全屏（`!Engine[167990]` = `display:ScreenMode`）时 `sub_4A5470(Scene, id)` 下发。同族 `0x25B`（sub_425E20）是**模式 2（图像）**并写 `[92381]`。handler=sub_425DB0（raw 33188-33203）。语料 0 处。emulator：`OPS` 的 `op_set_media_movie`（两个字段精确；Scene 下发属**排除**的影片子系统 ⇒ 已登记缺口）。 |
| 0x25B | 1 |  | sub_425E20 | 已核对 | **图像资源加载（消息态）**：读 op1，置**模式** `_this[92379]=2`（1=影片 / 2=图像，同族 0x25A 用 92379=1 + 92380）、**图像 id** `_this[92381]=op1`；`_this[167990]==0`（全局「无渲染模式」开关）时调 `sub_408440` 加载（`sub_4A7210` ReadFrameTex → 渲染进固定帧纹理 `Scene+42452`），失败**抛 `Command_ShowMessage_Exception`「画像ファイル %s の読み込みに失敗しました」**（影响控制流）。★`sub_4A7210` 从不使用图像 id ⇒ `[推测]` op1 只用于消息态记录。emulator：真实现字段写入（92381=op1），不做图像解码（消息窗自绘）。handler=sub_425E20（raw .c 33206） |
| 0x25C | 8 |  | sub_425E70 | 已核对 | **消息窗对象「文本块」参数（13 dword）**：`sub_456510` 整块 `qmemcpy` 到 `Font[win+261]+224`：`[0]=1, [1..3]=op4..op6, [4]=op7+op5, [5]=op8+op6, [6..7]=op2/op3, [8..10]=0, [11..12]=-1`。handler=sub_425E70（raw 33224-33245）。语料 0 处。emulator：`OPS` 的 `op_msgwin_obj_text_block`（`MsgObject.block224`）。 |
| 0x25D | 3 |  | sub_425EF0 | 已核对 | **消息列表对象字段**：读 op1/op2/op3；`_this[op1+21585]` 对象非空写 `+276=op2`、`+280=op3`。handler=sub_425EF0（raw .c 33248） |
| 0x25E | 5 |  | sub_425F50 | 已核对 | **消息窗对象颜色三件**：`+256=op2`、`+260=op3`、`+272=ARGB`，其中 ARGB = `(min(op4,255)<<24) | op5 的低 3 字节`（引擎 `sub_456590`）。handler=sub_425F50（raw 33269-33288）。语料 0 处。emulator：`OPS` 的 `op_msgwin_obj_colors`。 |
| 0x25F | 4 |  | sub_425FF0 | 已核对 | **消息窗对象颜色对**：`+264=op2`、`+268=ARGB`（alpha = op3 截断、RGB = op4 低 3 字节；引擎 `sub_4565D0`）。handler=sub_425FF0（raw 33291-33308）。语料 0 处。emulator：`OPS` 的 `op_msgwin_obj_colors2`。 |
| 0x260 | 4 |  | sub_426080 | 已核对 | **消息窗配置字段×4**：读 op1..op4 写 `_this[80102]/[80103]/[80104]/[80105]`。handler=sub_426080（raw .c 33311） |
| 0x261 | 1 |  | sub_4260F0 | 已核对 | **消息窗配置字段**：读 op1 写 `_this[80101]`。handler=sub_4260F0（raw .c 33331） |
| 0x2BC | 11 |  | sub_426120 | 仅映射 |  |
| 0x2BD | 1 |  | sub_426200 | 已核对 | **文本对象字段+字体重建**：读 op1；`op1≠0` 时置文本对象字段 `_this[75953]`/`_this[21636]` 为 700（否则 0），调 `sub_459F40()` 应用/重建字体。handler=sub_426200（raw .c 33385） |
| 0x2BE | 1 |  | sub_426260 | 已核对 | **注音加粗**：读 op1；真 ⇒ `Font+218588 = 700` 且 `Font+1308 = 700`，假 ⇒ 两者 0；再 `sub_45A6E0(Font)` 重建注音字体句柄；handler=sub_426260（raw .c 33405-33422） |
| 0x2BF | 3 |  | sub_4262C0 | 已核对 | **延迟播 SE**：读 op1=通道、op2=循环标志、op3=延迟毫秒 → `sub_4B5170(SE, op1, op2, op3)`（raw 137720：`SE[262+ch]=1` 武装、`[272+ch]=0` 起始时刻、`[282+ch]=延迟`、`[292+ch]=循环标志`、`SE[302]=1`）；每帧 `sub_4B5230(SE, 当前时刻)`（raw 137763、调用点 raw 20645）到期即 `sub_4B5020` 起播。全库 30 处。handler=sub_4262C0（raw .c 33424-33436） |
| 0x2C0 | 3 |  | sub_426310 | 已核对 | **语音排队到通道 0（带延迟）**：读 op1=语音 id、op2=附带值、op3=延迟毫秒 → `sub_4BBA40(Voice, op1, op2, op3, 0)`（raw 142563：`Voice[265+ch]=1`、`[268+ch]=0`、`[271+ch]=延迟`、`[274+ch]=id`、`[277+ch]=附带值`）；每帧 `sub_4BBAB0(Voice, 当前时刻)`（raw 142585、调用点 raw 20646）到期起播。全库 0 处。handler=sub_426310（raw .c 33438-33450） |
| 0x2C1 | 1 |  | sub_433CE0 | 仅映射 |  |
| 0x2C2 | 6 |  | sub_433DE0 | 仅映射 |  |
| 0x2C3 | 2 |  | sub_430890 | 仅映射 |  |
| 0x2C4 | 0 |  | sub_41A3F0 | 仅映射 |  |
| 0x2C5 | 2 | strlen | sub_430900 | 已核对 | **strlen**：`op1 = strlen(op2)`（`sub_41B640(2)` 读 op2 字符串 → `strlen` → `writeIntOperand_42B4B0(1)`）。handler=sub_430900（raw .c 40064），纯 |
| 0x2C6 | 2 |  | sub_430940 | 已核对 | **mbstrlen**：`setlocale(0, Locale)` 后 `op1 = _mbstrlen(串op2)`（多字节长度；与 `0x2C5` strlen 成对）。handler=sub_430940（raw .c 40074） |
| 0x2C7 | 4 |  | sub_433FD0 | 已核对 | **SBSubstr（子串，SJIS 字节语义）**：`op1 = substr(op2, op3, op4)` —— **op3 是起始字节、op4 是字节长度**（与 `strlen` 比较，raw 42298-42299），并按全角边界修正：起点落在 2 字节字的**第二**字节 ⇒ `start++`/`len--`（日志 raw 4458）、最后一个被包含的字节是 2 字节字的**首**字节 ⇒ `len--`（raw 4457）；越界或 `op4<=0` ⇒ **写空串**；再 `sub_429F60` 取子串 → `sub_433310` 写 op1。handler=sub_433FD0（raw 42259-42376）。★`TITLE.txt:584/587/590` 用它切 `set:GameVersion` 的三段 |
| 0x2C8 | 4 |  | sub_434260 | 已核对 | **按「字符」取子串**（`0x2C7` 的字符版）：`op1 = substr_chars(op2, op3, op4)` —— `op2` 的字符数由 `_mbstrlen` 给出，`op3`/`op4` 是**字符**下标与**字符**长度，逐字节用 `_mbbtype` 认 SJIS 双字节；结果经 `sub_433310(this,1,…)` **写回 op1 字符串**。★会回写操作数；★`op4 <= 0` 时"双字节只看起点、单字节还看钳制前终点"的**不对称**是引擎真实行为（已逐条复刻）。语料 0 处调用。emulator：`STRING_OPS` 的 `op_substr_chars` + `text/sjis.ts` 的 `sjisSubstrChars`。handler=sub_434260（raw .c 42379） |
| 0x2C9 | 3 |  | sub_4344A0 | 已核对 | **可变数组元素引用**：`op1 = &op2[op3]`（**写指针操作数** `sub_418CC0`，不是元素值）。按 `op2` 的数组 tag 分派：`0x8003`/`0x8009` = int 数组（4 字节元素，按需 `sub_40C880` 扩容并把新槽写 `ENC(0)`）、`0x8005`/`0x800B` = 字符串数组（28 字节元素 = `std::string`，`sub_4149D0` 扩容）、其余 tag ⇒ 抛 `Command_Type_Exception`；`op3 < 0` ⇒ 抛 ShowMessage「可変配列のインデックス %d は不正です」（raw 42488）。★会回写 op1 引用 ⇒ 当 no-op 时后续读写会落到**别的元素**上（静默串数据）。语料 0 处调用。emulator：`MEMORY_OPS` 的 `op_array_element_ref`（`operand.ts` 的 `refFromOperand` 新增 6 个数组标签）。handler=sub_4344A0（raw .c 42460） |
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
| 0x2D5 | 2 | float-mov | sub_430C30 | 已核对 | **float mov**：`op1 = op2`（`readFloatOperand(2)` → `writeFloatOperand(1)`）。handler=sub_430C30（raw .c 40176）。旧 label `u0042B990` |
| 0x2D6 | 2 |  | sub_430C70 | 已核对 | **整数→浮点**：写回 float `op1 = (float)整数op2`。★argc 由 handler 体补全（旧表 `-`）：读 op2、写 op1。handler=sub_430C70（raw .c 40186） |
| 0x2D7 | 2 |  | sub_430CB0 | 仅映射 |  |
| 0x2D8 | 3 | set-array-to | sub_430CF0 | 已核对 | `op1 起 count 个槽填 op2 值`（**脚本值 bulk 填充**；对比 copy-to-global 固定 0）：`v2=&op1; v5=ENC(op2); n=op3; memset32(v2,v5,n)`。handler=sub_430CF0（raw .c 40206） |
| 0x2D9 | 2 |  | sub_430D60 | 仅映射 |  |
| 0x2DA | 8 |  | sub_426420 | 已核对 | **CG 数字条记录登记**：`op1`=CG 番号（合法 0..0xA，越界只记日志不抛）+ `op2..op8` = **7 个 int** → 写进 `Engine+388332+28*cgno` 的 28 字节记录（`28*(n+13869)` 与 `4*97084+28*n` 是同一地址）。字段语义由消费方 0x23B 反推：`+0` 纹理槽 / `+4` x0 / `+8` y0 / `+12` 单字宽 / `+16` 字高 / `+20` 字内空隙 / `+24` 字距。★**是 7 个 dword（28 字节）**，旧文档「共 8 字段」把手写操作数 op1（编号）也算进去了。纯数据登记：不碰 Scene / 不置脏 / 不影响控制流。handler=sub_426420（raw .c 33498） |
| 0x2DB | 1 |  | sub_426500 | 已核对 | **文本对象字段+字体重建**：读 op1 写 `_this[71744]`，调 `sub_459F40()` 重建字体。handler=sub_426500（raw .c 33524） |
| 0x2DC | 1 |  | sub_430DB0 | 已核对 | **可选字体数量 → op1**：`v1 = (Font[71741] - Font[71740]) >> 5`（`Font+201664` 的 **32B/条**字体名向量长度，由 `EnumFontFamilies` 填充；**空表 ⇒ -1，绝不返回 0**）⇒ `op1 = v1`。脚本 `$1$SELFONT.txt:34` 用它做分页（每页 9 项）与滚动条分母（`:78 div` 拿它当**除数**）⇒ 返回 0 会让字体选择器直接退出并除零。handler=sub_430DB0（raw .c 40239-40249）。emulator：`op_font_list_count`（`ENGINE_FONT_LIST`，与 0x2DD/0x2DE 同一张表） |
| 0x2DD | 2 |  | sub_434720 | 已核对 | **字体表第 op2 项的名字 → op1（字符串）**：`v2 = read(2)`；越界（`<0` 或 `>= count`）⇒ 写**空串**（`byte_51EA3C`），否则把 `Font+201664 + 32*v2` 那条 `std::string` 拷进 op1（`sub_433310(_this,1,串)`）。脚本 `$1$SELFONT.txt:567/:644` 用它逐行画候选字体名（`:644` → `set-font` → `draw-string`）。handler=sub_434720（raw .c 42541-42575）。emulator：`op_font_list_name` |
| 0x2DE | 2 |  | sub_430DF0 | 已核对 | **字符串→索引查表**：`sub_41B640(2)` 读 op2 字符串 → `sub_428990(_this[50416] 表)` 查找（跳过前导 `@`，未命中=-1）→ `writeIntOperand_42B4B0(1, idx)` 写回 op1。handler=sub_430DF0（raw .c 40252） |
| 0x2DF | 3 |  | sub_430E30 | 仅映射 |  |
| 0x2E0 | 3 |  | sub_430EA0 | 仅映射 |  |
| 0x2E1 | 3 |  | sub_430F10 | 仅映射 |  |
| 0x2E2 | 3 |  | sub_430F80 | 仅映射 |  |
| 0x2E3 | 3 |  | sub_430FF0 | 仅映射 |  |
| 0x2E4 | 3 |  | sub_431060 | 仅映射 |  |
| 0x2E5 | 1 |  | sub_4310D0 | 已核对 | **读水平滚轮增量（一次性消费）→ op1**：`v2 = _this[1950]`（byte 7800）→ `_this[1950] = 0` → `writeIntOperand(1, v2)`；handler=sub_4310D0（raw .c 40342-40350）。累加侧 = WndProc 的 `case 0x20E`（WM_MOUSEHWHEEL，raw 141585-141611）：只有 `(Engine+699204 & 0x90100000) == 0`（没把横滚当按键）才 `+= (short)HIWORD(wParam)`（一格 ±120）。★与 `0x10D`（竖直滚轮 `_this[1949]` / byte 7796）是**两个独立累加器**：`src/SAVE.txt:204-205` 先 `read-mouse-wheel (local 14)` 再 `i2e5 (local 15)`、随后按 `local 15` 横向翻页（存档/读档列表）。★emulator 已实现（`handlers/input.ts` 的 `op_read_mouse_hwheel` + `InputManager.consumeHWheelDelta`；守卫 `test/wheel.test.ts`、链路守卫 `test/save-slot-chain.test.ts`） |
| 0x2E6 | 2 |  | sub_431110 | 已核对 | **读配置写操作数**：op1=0 ⇒ `message:AutoMessagePitch0`、1 ⇒ `AutoMessagePitch1` → **写 op2**；其它值报错；handler=sub_431110（raw .c 40353-40376）。与 0x2E7 构成 set/get 对 |
| 0x2E7 | 2 |  | sub_426540 | 已核对 | **设自动翻页每行附加时长**：读 op1=下标、op2=值；op1==1 ⇒ `SetConfig("message:AutoMessagePitch1", op2)`、0 ⇒ `…Pitch0`，其它值报错。`INITREGMES` 用 `i2e7 0 96` / `i2e7 1 96`（=150）；handler=sub_426540（raw .c 33534-33562）。★写的是**内存注册表**；落盘见 `engine-config-registry-persistence`（emulator：`NodeFileSource.saveConfig` / Electron IPC `save-config-ini`） |
| 0x2E8 | 1 |  | sub_4265E0 | 已核对 | **SetConfig("message:AutoMessageOption", op1)**；handler=sub_4265E0（raw .c 33565-33577） |
| 0x2E9 | 1 |  | sub_426620 | 仅映射 |  |
| 0x2EA | 1 |  | sub_4311B0 | 已核对 | **读配置**：`op1 = GetConfig("message:AutoMessageOption")`；handler=sub_4311B0（raw .c 40380-40386） |
| 0x2EB | 1 |  | sub_434830 | 已核对 | **读配置字符串 `set:GameVersion` → op1**：走配置对象 vtable+8 的查询（raw 42583）→ `sub_40C210` 拷串 → `sub_433310(this,1,串)`。键值来源：引擎内建 `"1.00"`（raw 111627-111629）→ INI `[set] GameVersion` 覆盖（raw 112426-112433）→ 若 `set:VerRegPos` 非空再用注册表 `DisplayVersion` 覆盖（raw 112835-112851 + sub_490010，缺省 `"1.00.0000"`）。★`TITLE.txt:583` 取它画 "Version X.YY.ZZZZ"（经 0x2C7/0x2EC/0x23B）；不实现 ⇒ 屏幕上是占位值 `0.00.0000`（2026-09 实测）。handler=sub_434830（raw 42575-42593） |
| 0x2EC | 2 |  | sub_4311F0 | 已核对 | **atoi**：`op1 = atoi(串op2)`（字符串→整数）。handler=sub_4311F0（raw .c 40390） |
| 0x2ED | - |   | sub_431230 | 仅映射 |  |
| 0x2EE | 1 |  | sub_426650 | 已核对 | **消息派发**：读 op1 写 `_this[80106]`，并经 `_this[174405]` 对象 vtable+12 以 `"message"`+op1 派发消息/自动消息。handler=sub_426650（raw .c 33591） |
| 0x2EF | 11 |  | sub_431270 | 仅映射 |  |
| 0x2F0 | 9 |  | sub_431460 | 仅映射 |  |
| 0x2F1 | 7 |  | sub_4316E0 | 仅映射 |  |
| 0x2F2 | 6 |  | sub_4318A0 | 仅映射 |  |
| 0x2F3 | 6 |  | sub_431A10 | 已核对 | **文本项记录查询（写回三个操作数）**：读 op4/op5/op6 → `sub_457A20(Font, &v8, &v7, &v6, op4, op5, op6)` ⇒ **写 op1 = `+20`、op2 = `+24`、op3 = `+28`**（未找到 -1/-1/0）；op5 = 起始下标、op6 = 选择器（匹配 `+32`，记录需含 `flags & 0x40000000`）。★订正：早期把这条的语义误记在 `0xAA` 上；handler=sub_431A10（raw .c 40724-40740） emulator：`OPS` 的 `op_voice_item_query`（选择器 = op6；未命中写 -1/-1/0）。 |
| 0x2F4 | 3 |  | sub_4266A0 | 已核对 | **播语音（id, 附带, 通道）+ 登记文本项记录**：读 op1/op2/op3=通道；切 `Engine[21315+ch]`/`[21318+ch]` 状态位 + `sub_407120`；ADV 激活位 ⇒ 寄存到 `Engine[122505+ch]`/`[122508+ch]`，否则 `sub_4BB840(Voice, ch, op1, op2, Engine[5053+ch])`（第 5 参 = pan）；再 `sub_45EEA0(Font, 0, op1, 0, ch, pan)` 登记「该文本带语音」；末尾按 `sound:Voice` 置 `Engine[122501]=1`。全库 8 处（`BTL.txt`/`HISTORY.txt`/`REPLAYVOICE.txt`）。handler=sub_4266A0（raw .c 33605-33658） |
| 0x2F5 | 4 |  | sub_4267D0 | 已核对 | **语音排队到指定通道（带延迟）**：读 op1=id、op2=附带值、op3=延迟、op4=通道槽 → `sub_4BBA40(Voice, op1, op2, op3, op4)`（字段见 0x2C0）。全库 30 处。handler=sub_4267D0（raw .c 33660-33674） |
| 0x2F6 | 1 |  | sub_426820 | 已核对 | **复位语音通道**：读 op1=语音通道（0..2）→ `sub_4BB9F0(Voice, op1)`（raw 142546：`sub_4B6390(设备, op1+12)` 释放设备通道 + 清 `Voice[op1+280/262/265/277]`）→ 清 `Engine[21315+op1]`/`[21318+op1]`/`[122505+op1]`/`[122508+op1]` → `Engine[122501] = sub_404CB0(Voice)`（3 路语音中是否有正忙的）。**纯声音侧**。全库 **86687** 处（ADV 每页语音收尾/换页；惯用法 `i2f6 2` 紧接 `i2f8 2 0`，`SP2563.txt:17025-17028`）。handler=sub_426820（raw .c 33677-33692）。emulator：`op_engine_internal` 空操作。★订正：早期台账写成「清消息回调槽/消息文本回调」，实为**语音通道** |
| 0x2F7 | 1 |  | sub_426890 | 已核对 | **置语音通道状态位**：`Engine[21315+op1] = 1`（Voice 模块 `[283+ch]`；0x2F6 清、0x2F4/0xC4/0x1BD 按 bit0/bit16 二态切换）。全库 **28122** 处。handler=sub_426890（raw .c 33694-33703） |
| 0x2F8 | 2 |  | sub_4268D0 | 已核对 | **设语音通道 pan（左右平衡）**：读 op1=语音通道（0..2，映射设备通道 op1+12）、op2=pan（±10000，0=中央） → `sub_4B6940(Engine+18664, op1+12, op2)`：**对称钳制 ±10000** 写 `设备[375+op1+12]`，`sub_4B6350`→`sub_4B7110` 下发到 `IDirectSoundBuffer::SetPan`（>14 报 `dsSetPan`）。★判据：`sub_4B7110` 的错误串是「左右相対ボリューム変更に失敗しました」(vtable+64=SetPan)，且 SetVolume 的值域是 [-10000,0] 而非对称。★`SYSTEM4.txt:476-480` 的子程序 `i2f8 0 0 / 1 0 / 2 0` = 把三路语音 pan 复位到中央；全库 op2 **14642/14642 恒为 0**（全库 14644 处）。handler=sub_4268D0（raw .c 33705-33715）。emulator：`op_engine_internal` 空操作 |
| 0x2F9 | 7 |  | sub_431AA0 | 仅映射 |  |
| 0x2FA | 1 |  | sub_426910 | 已核对 | **写 `Engine[1951]`**（byte 7804）：`_this[1951] = op1`（raw 33722-33725）。★全库只出现 **1 次**——`src/CALLBACK_LOAD.txt:18` 的 `i2fa 0`；而该字段在反编译里**没有任何读取点** ⇒ 观测等价 no-op。emulator：`ENGINE_INTERNAL_OPS` 的 `op_engine_internal`（`tickets/T-0073`）。★**这条当初缺失的后果不是"少一个 no-op"，而是脚本被解析错位**：`i2fa` 在 `scripts/asm/opcodes.json` 里 argc=1，但 emulator 侧三张 handler 表都查不到它 ⇒ 命中即 `NotImplementedOp` ⇒ 在 `CALLBACK_LOAD.BIN` 里卡死（ip 停在同一格、帧循环空转） |
| 0x2FB | 1 |  | sub_431B60 | 仅映射 |  |
| 0x2FC | 5 |  | sub_431BA0 | 已核对 | **读 UI 触摸/触点**：`sub_477980` 从触摸事件缓冲（`Engine+6780`、条数 `Engine[6776]`、40B/项）取触点并 `ScreenToClient`；有触点写 op1=1/op2=X/op3=Y/op4=触点旗标/op5=项[3]，无触点写 op1=0。**PARTIAL**（缓冲填充来源未建模）；handler=sub_431BA0（raw .c 40776-40826） |
| 0x2FD | 6 |  | sub_431CF0 | 仅映射 |  |
| 0x2FE | 1 |  | sub_4332D0 | 已核对 | **set-font（校验列表）**：读 op1 字体名，调 `sub_432DD0(_this+21324, font)` 校验在可选字体列表中、拷字体名字段、`sub_45A6E0` 重建；不在列表则警告。handler=sub_4332D0（raw .c 41812） |
| 0x2FF | 2 |  | sub_426940 | 已核对 | **置语音通道音量因子预备位**：`Engine[21318+op1] = 1`（Voice `[286+ch]` 低位置 1）、`Engine[21321+op1] = op2`（`[289+ch]` 音量因子；`0x2710`=10000=100%）。全库 **14124** 处；与 0x302 配对（0x302 置 `0x10000` 并真正下发）。handler=sub_426940（raw .c 33728-33740） |
| 0x300 | 3 |  | sub_426990 | 已核对 | **消息槽标志/取值**：读 op1=槽、op2=标志、op3=值 ⇒ `Engine[op1+122466] = op2 ｜ (旧值 & 0x10000)`（保留 bit16）、`Engine[op1+122476] = op3`；handler=sub_426990（raw .c 33743-33757） |
| 0x301 | 1 |  | sub_4269F0 | 已核对 | **清消息槽绘制项**：`Engine[op1+122486] = 0`，再 `sub_404F80(Font, op1)`：把窗对象 `+132`（显现游标）清 0，并按 id 区间删两组 DrawItem `[+104, +108)` 与 `[+276, +280)`；handler=sub_4269F0（raw .c 33759-33766） |
| 0x302 | 2 |  | sub_426A30 | 已核对 | **设语音通道音量因子 + 应用语音音量**：读 op1=通道、op2=音量因子（0..10000） → `Engine[21318+op1] = 0x10000`（Voice `[286+ch]` 置「有因子值」）、`Engine[21321+op1] = op2`；再 `sub_4BBC30(Voice, op1, Engine[489996])`（raw 142681）：`设备[402+op1] = (Voice[286+op1]&0x10000) ? Voice[289+op1] : -1`，`sub_4B6210(设备, op1+12, 语音音量)` 下发。`Engine[489996]` = `sound:Volume3`（全局语音音量，`sub_4763D0` raw 90852）；因子最终在 `sub_4B6210` 里与通道音量、主音量相乘（raw 138711-138718）。用法：`CONFIGCV.txt:396-402/607`（CV 设定页按角色调音量，值 0x2710=100%）。全库 2 处。handler=sub_426A30（raw .c 33767-33777） |
| 0x303 | 3 |  | sub_426A90 | 已核对 | **UI/消息对象字段**：读 op1/op2/op3 调 `sub_456600(_this+21324, op1, op2, op3)`，对选中对象写 `+288=op2`、`+292=op3`。handler=sub_426A90（raw .c 33780） |
| 0x304 | 0 |  | sub_41A420 | 仅映射 |  |
| 0x305 | 0 |  | sub_41B1C0 | 仅映射 |  |
| 0x306 | 1 |  | sub_431FC0 | 已核对 | **纯配置 getter**：`op1 = GetConfig("system:EffectSkipOnClick")`（点击跳过特效开关；构造默认 1、配置文件可覆盖）。handler=sub_431FC0（raw 40948） |
| 0x307 | 1 |  | sub_426AE0 | 仅映射 |  |
| 0x308 | 1 |  | sub_426B20 | 已核对 | **输入触摸注册**：读 op1，调全局输入管理器 `sub_407B20(_this[96981], op1)`（LoadLibrary+GetProcAddress 注册/注销触摸），置 `_this[1954]`。handler=sub_426B20（raw .c 33808） |
| 0x309 | - |   | sub_432000 | 仅映射 |  |
| 0x30A | 2 |  | sub_426B60 | 已核对 | **SetGesKey**：读 op1=值、op2=索引；`op1>0x1F` 或 `op2>7` 抛 ShowMessage「SetGesKey」，否则写 `_this[op2+1969]=op1`。handler=sub_426B60（raw .c 33819） |
| 0x320 | 10 | create-mesh | sub_432150 | 已核对 | **顶点网格配置**：读 op1/9/10 及多操作数；`op9>0` 时申请缓冲、用 key `_this[388236]`（ROL11^XOR^ROR25）解码顶点，`sub_4ADFE0(_this+322832, obj, …)` 配置网格（顶点+索引+材质）；`op9≤0` 报「頂点数%dは不正です．」。fire-and-forget。handler=sub_432150（raw .c 41012）。旧 label `u0043AA20` |
| 0x321 | 3 |  | sub_426BD0 | 已核对 | **MeshEntry 属性**：`sub_4AE280(Scene, op1, op2, op3)` → `sub_40DC30(Scene+1064, &op1)` 取网格项后 `entry[op2 + 7] = op3`。handler=sub_426BD0（raw 33839-33850）。语料 1 处。emulator：`OPS` 的 `op_set_mesh_entry_attr` → `native.setMeshEntryAttr`。 |
| 0x322 | 4 |  | sub_426C20 | 已核对 | **set-vertex-color**：读 op1=网格id、op2/3/4；op3/op4 作颜色分量（clamp/回退），组装 32 位色 → `sub_4AE2C0(_this+80708, op1, op2, color)` 写网格顶点色。handler=sub_426C20（raw .c 33853） |
| 0x323 | 5 |  | sub_426CF0 | 已核对 | **set-vertex-color-alpha**：读 op1=网格id、op2/3/4/5；组装色（含 alpha）→ `sub_4AE330(_this+80708, op1, op2, op3, color)` 写网格顶点色+alpha。handler=sub_426CF0（raw .c 33888） |
| 0x324 | 0 |  | sub_41A470 | 已核对 | **销毁 3D 天气/粒子效果**：`sub_41A470` 取 `Engine[93384]`（= 字节 `0x5B320` = `Scene+50704`）= **3D 效果管理器**，尾调到 `sub_453530` → **thunk** `jmp sub_453150`（IDA 清单 135090-135093 标注 `Attributes: thunk`）⇒ `sub_453150`(raw 65366) **释放管理器的三个效果对象** `[258]`=Rain / `[259]`=Snow / `[260]`=Leaf（各自 `(**v)(v,1)` 析构 + 置 0）并把 `[312]`（字节 `+0x4E0`）清零。★**订正**：旧注"消息/文本子系统方法；调外部弱符号 `sub_453530`（本文件无实现）"是**误判** —— 它是可跟到底的 thunk，且属 **3D 效果族**（与 `0x325`/`0x326`/`0x327`/`0x328` 同一对象），**不是影片族**。无操作数回写。emulator：`ENGINE_INTERNAL_OPS`（待实现，见 `stub-reaudit-2026-09.md`）。handler=sub_41A470（raw .c 25403） |
| 0x325 | 2 |  | sub_426DC0 | 已核对 | **3D 效果管理器字段写入**：`Engine[93384]` 的 `[+0x4D8] = op1`、`[+0x4DC] = op2`（`sub_426DC0` raw 33925，汇编 `mov [esi+4D8h], eax` / `mov [esi+4DCh], edi`，清单 61815-618FD）。不写操作数；emulator：`ENGINE_INTERNAL_OPS`（待实现）。handler=sub_426DC0 |
| 0x326 | 4 |  | sub_426E10 | 已核对 | **Set3DEffect_snow_**：`sub_418340(Scene, op1, f2, op3, op4)` —— 错误串「関数：Set3DEffectSnow エラー：テクスチャが作成されていません．TEXTURE=%d」（raw 23942）。`Scene+46668 >= 1` 门槛内：对纹理槽 `op4` 惰性建**共享** `ID3DXEffect`（`D3DXCreateEffectFromResourceA` 资源 202，存 `Scene+46496`），再 `sub_453330(管理器, op1, f2, op3, 纹理对象, effect)` **重建 Snow 对象**（`operator new(0xE4)` + `sub_4B58C0`，`_this[0] = &Snow___vftable_`）。不写操作数。emulator：`ENGINE_INTERNAL_OPS`（待实现）。handler=sub_426E10（raw .c 33941） |
| 0x327 | 1 |  | sub_426E70 | 已核对 | **Set3DEffect_rain_**：`sub_426E70` → `sub_453280(Engine[93384], op1)` = 先释放管理器 `[258]` 旧对象，再 `operator new(0x29C)` + `sub_48E370`（`_this[0] = &Rain___vftable_`，参数块取管理器 `[294..309]`）**重建 Rain**。★**当前根本没注册 handler** ⇒ 命中即 `NotImplementedOp`（故意不上桩，见 `stub-reaudit-2026-09.md`）。handler=sub_426E70（raw .c 33956） |
| 0x328 | 3 |  | sub_432300 | 已核对 | **Set3DEffect_leaf_**：`sub_432300` → 先把 op2（网格 id **数组地址**，`sub_42AEA0`）里的每个元素 **DEC** 到临时数组，再 `sub_4183F0(Scene, op1, 临时数组, op3=数量)`（错误串「関数：Set3DEffectLeaf エラー：メッシュが作成されていません．MESH=%d」raw 23969）⇒ `sub_453410(管理器, op1)` **重建 Leaf**（`operator new(0xA0)` + `sub_478CC0`，`_this[0] = &Leaf___vftable_`）并对数组里每个网格槽 `sub_4534F0(管理器, 槽)` 挂上。★**当前根本没注册 handler** ⇒ 命中即 `NotImplementedOp`。handler=sub_432300（raw .c 41081） |
| 0x329 | 2 |  | sub_426EB0 | 仅映射 |  |
| 0x32A | 1 |  | sub_426F80 | 已核对 | **释放 3D 模型槽**：`sub_4A0750(Scene, op1)` —— `Scene[op1 + 12677]` 非空则析构（`sub_479A50`）+ `operator delete` + 置 0。handler=sub_426F80（raw 34003-34010）。语料 3 处 / 1 个脚本。emulator：`OPS` 的 `op_release_3d_slot` → `native.release3DSlot`（同时从场景模型删掉该 mesh）。 |
| 0x32B | 0 |  | sub_41A4A0 | 已核对 | **清 D3DX 网格层级槽表**（`Scene+50708` 区 1000 槽）：经 `sub_4A0750 → sub_479A50` + delete 逐项释放（与 0x23D、0x259 均不同族）。handler=sub_41A4A0（raw 25411）。TITLE.txt:800 与 0x1F6/0x23D 组成收尾序列 |
| 0x32C | 6 |  | sub_426FC0 | 仅映射 |  |
| 0x32D | 2 |  | sub_427040 | 已核对 | **3D 颜色**：`v2 = min(op1, 255)`（alpha）、`v3 = op2`（RGB 低 3 字节）→ 四分量各 ÷255（`dbl_51FA60`）→ `sub_499DF0(Scene, r, g, b, a)`。handler=sub_427040（raw 34033-34054）。语料 1 处。emulator：`OPS` 的 `op_set_3d_color` → `native.set3DColor`。 |
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
| 0x33F | 3 | set-scene-blend | sub_427A90 | 已核对 | **设置场景默认混合/颜色**：读 op1 → `Scene+1260`（**场景默认混合选择子**，消费点 `sub_4535F0` raw 65858-65889，注意那里 `== 2` 时**没有门控**、无条件 `(ONE,ZERO)`）；op2 = α（>255 钳 255；<0 ⇒ 取 op1 所指绘制项当前 α）、op3 = 颜色（<0 ⇒ 取该项当前色）→ `Scene+1264` = `(α<<24)|(rgb&0xFFFFFF)`（raw 65904-65907 下发给效果对象的 shader 常量）。★emulator 只建模混合选择子（`scene.render4.sceneBlend`，`tickets/T-0017`）；**颜色那半的效果通路未建模**（登记在该票）。语料 1 处（`src/SETWEATHER.txt:80 i33f 1 ff ffffff`） |
| 0x340 | 1 |  | sub_427B60 | 已核对 | **渲染状态下发**：写状态槽 `Scene+13948`（默认 3）并向设备 vtable+228 发 `(22, op1)`（渲染状态 #22，设备在 raw 122124 重放）。handler=sub_427B60 → sub_49A2D0（raw 116869） |
| 0x341 | 2 |  | sub_427BA0 | 已核对 | **Live2D 模型加载**：读 op1（文件名/资源 id）、op2 → `sub_4559C0(资源表, 主窗口, op1, &dwBytes)` 读文件进内存 → `sub_455560` 建句柄 → `sub_4A1860(Engine+322832, 资源表, op1, hFile, dwBytes, op2)`；失败 ⇒ `sub_455C60` 释放 + **抛异常**。**PARTIAL**（内部未建模；桩实现不得抛）。handler=sub_427BA0（raw .c 34461） |
| 0x342 | 1 |  | sub_427C70 | 已核对 | **销毁 Live2D 模型实例槽**：`objects[op1]`（`Scene+55812`+4·op1，**10 槽**）非空则 `sub_4785E0` 析构 + `operator delete` + 置 0。handler=sub_427C70 → sub_4A1A60（raw 121745）。（旧称"释放图形资源槽"为误） |
| 0x343 | - |   | sub_41A4E0 | 仅映射 |  |
| 0x344 | 2 |  | sub_427CB0 | 已核对 | **建/绑 572B「立绘 / 变换节点」**：读 op1=key、op2 → `sub_4AFBF0(Scene, op1, op2)`：在 `Scene+1096` 取/建记录、**`记录[0] |= 1`、`记录[1] = op2`**，并置脏 `Scene+46508`。★**`记录[1]` 是 Live2D 实例槽号（0..9）、不是纹理槽号**——这一格正是 `sub_4B0360` 的出画门控所查（raw 134320）。（旧称"纹理槽变换记录"是**误读**，2026-09 订正；TITLE 的 `i344 14 0` = key 14 绑槽 0。）handler=sub_427CB0（raw 34507）→ `handlers/live2d.ts` 的 `op_l2d_create_node` |
| 0x345 | 3 |  | sub_427CF0 | 已核对 | **Live2D 纹理装载**（与 `0x341` 同族，多一个 op3）：读 op1（纹理**文件 id**）/op2（实例槽）/op3（**模型内纹理号**）→ `sub_4559C0` → `sub_455560` → `sub_4A1970(Engine+322832, 资源表, op1, hFile, dwBytes, op2, op3)`；返回值 != 1 ⇒ 释放 + **抛异常**。纹理走 `D3DXCreateTextureFromFileInMemory`（`sub_478370` raw 92566-92576）⇒ 资产是普通 PNG。（旧称"图形/3D 模型加载"是**误读**，2026-09 订正。）handler=sub_427CF0（raw 34519）→ `handlers/live2d.ts` 的 `op_l2d_bind_texture` |
| 0x346 | 1 |  | sub_427DD0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：把全部变换复位为单位阵、+76 = 0；handler=sub_427DD0，raw .c 34557） |
| 0x347 | 4 |  | sub_427E10 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**缩放**，参数为**百分数 /100**；handler=sub_427E10，raw .c 34567） |
| 0x348 | 5 |  | sub_427EA0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：缩放 + 一个额外汇总参数；handler=sub_427EA0，raw .c 34584） |
| 0x349 | 4 |  | sub_427F30 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**平移，像素单位（无缩放）**；handler=sub_427F30，raw .c 34602） |
| 0x34A | 4 |  | sub_427FB0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：写 +8/+12/+16 基础平移偏移；handler=sub_427FB0，raw .c 34618） |
| 0x34B | 6 |  | sub_428030 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**缩放目标矩阵**（百分数 /100）+ 窗1 delay/dur = +32/+52，**置 pending**；handler=sub_428030，raw .c 34634） |
| 0x34C | 7 |  | sub_4280D0 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**旋转目标矩阵** + 轴/角（度）+ 窗2 delay/dur = +36/+56，**置 pending**；handler=sub_4280D0，raw .c 34655） |
| 0x34D | 6 |  | sub_428170 | 已核对 | **Scene+1096 的 572 字节「变换 / Live2D 立绘节点」setter**（与 DrawItem/MeshEntry/纹理槽都不同）：`op1` = map key（图元 id）；元素内：`+0` flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）、**`+4` Live2D 模型槽 0..9**（`Scene+4*slot+55812`）、`+8/12/16` 基础平移偏移、`+24` 动画计数、4 个窗 delay/dur 在 `+28/+48`（颜色）、`+32/+52`（缩放）、`+36/+56`（旋转）、`+40/+60`（平移）、`+68` 颜色（RGBA）、`+76` 启用手工变换矩阵、缩放 work/target `+80/+144`、旋转 `+208/+272`（轴 `+464/+476`，角 `+488/+492` 度）、平移 work/target `+336/+400`、`+508` 第 4 个矩阵。**消费方 `sub_4B0360` 只在 `元素+4` 指向的 Live2D 槽真有模型时才出画**（raw 134310-134346）⇒ 整套属 Live2D/3D 立绘演出；只置脏 `Scene+46508`（0x34B/34C/34D 另置 pending `Scene+46516`）。（本条：**平移目标矩阵**（像素）+ 窗3 delay/dur = +40/+60，**置 pending**；handler=sub_428170，raw .c 34677） |
| 0x34E | 4 |  | sub_428200 | 已核对 | **装 `.MTN` 动作**：读 op1（动作**文件 id**）、op2=**动作槽(0/1)**、op3=**实例槽**、op4=**循环位** → `sub_478640`：`sub_4BE490` 解析文本 → 写动作槽 `+4`/`+8` → **`sub_4BCA20(queue, motion, 1)` 装载即入队** → `sub_4784D0(op4)` 写实例 `+20`/动作 `+36`。**`$fadein/$fadeout`（毫秒）与 `$fps` 决定淡入淡出与采样速度**；推进**只在"节点绘制"那一次调用**里发生（`sub_4B0360` → `sub_4783D0` → `sub_4BCB50`），引擎**没有**独立逐帧 tick。handler=sub_428200（raw .c 34697）→ `handlers/live2d.ts` 的 `op_l2d_start_motion` |
| 0x34F | 2 |  | sub_428400 | 已核对（2026-09） | **Live2D 纹理乘色**：读 op1=实例槽、op2=颜色（`op2 < 0` ⇒ 取该槽的纹理色记录）→ 写该实例的纹理乘色项。语料 **0 次**，但登记为能力面。handler=sub_428400（raw 34793）→ `op_l2d_texture_mul_color` |
| 0x350 | 1 |  | sub_4282E0 | 已核对（2026-09） | **复位 Live2D 动作队列**：读 op1=实例槽 → 清该槽的 MotionQueueManager（`+12`）。语料 **0 次**。handler=sub_4282E0（raw 34736）→ `op_l2d_reset_motion` |
| 0x351 | 3 |  | sub_428320 | 已核对（2026-09） | **Live2D 命名参数**：读 op1=实例槽、op2=**参数名串**、op3=0..255 → `sub_4BD4D0` `setParamFloat(name, op3/255)`。语料 **0 次**（本作用 `.MTN` 曲线而非直接设参数）。handler=sub_428320（raw 34746）→ `op_l2d_named_param` |
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

