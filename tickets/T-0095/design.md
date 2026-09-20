# T-0095 实现规格报告 —— `0x1d0` 回看页索引表 + 写端 `0x70`/`0x71`

> 分析者：ANALYSIS-ONLY 子代理（只读）。权威 = `engine/天结_unpacked.exe_utf8.c`（184091 行版本），
> 行号全部用定义头 grep 定位后逐行读体（**没有**用邻近常量猜位置）。
> 语料 = `src/*.txt`；emulator 只作为「现状/集成点」描述对象，**不作为引擎语义判据**。
> 本报告不写仓库任何受保护目录；中间物只落 `.tmp/t0095/`。

---

## 0. 结论速览（先给主 agent 可执行的判断）

| 问题 | 结论 |
|---|---|
| `0x1d0` 能不能现在做 | **能，且是纯 VM 状态**（零 GDI、零宿主）。前置只有三件：页表 `Font+3380`、双游标 `Font+859/+860`、两个写端 push。 |
| `sub_45D660` / `sub_45EC60` 是什么 | **不是 handler**（分派表里没有它们的槽）。它们是 `0x70` / `0x71` 的**落点函数**：`sub_45D660` = 0x70 的体（含页 push），`sub_45EC60` = 0x71 的体（含页 push）。 |
| 写端与读端成对关系 | **1 次调用 = push 1 条**；两条写端 push 的**形状完全相同**（`{窗号, 当前记录条数}`）。不是「1 条写多槽」。 |
| 门 | 读端**无门**。写端只有 `0x71` 有门：`a3 = Engine[97055] >= 0`（即 `i1bb 1` 期间才记页）；`0x70` 的 `a7` 恒传 `0` ⇒ **不过门，永远 push**。 |
| 需要宿主缝吗 | **`0x1d0` + push + `0x85` 都不需要**（五处同步的宿主缝先例**不适用**）。只有「渲染层记录 push（`sub_45F090` 的 flags）」与 `0x1d1` 重绘才需要宿主等价物 —— 那两条**不在本票范围**。 |
| `0x1d0` / `0x1d1` 是不是读写两半 | **不是**。是同一个「回看页阅览器」的**导航读端**与**渲染端**；写端是 `0x70`/`0x71`（表）+ `0x1D2`/语音族（记录）+ `0x85`（清）+ `SaveTextBuf.dat`（持久化）。 |
| 本轮新发现的**既有缺陷** | ① `0x71` 的 SetTB 门在 emulator 里**没有实现**（`m.textSlotArg` 从未被赋值 ⇒ `>= 0` 恒真）；② `0x70` 在引擎里**也**置组首标记 + push 页，emulator 两件都没做；③ `0x85`（`i085`）的 gaps 台账理由**是错的**（说「GDI 文本对象的行/段容器」，实际是**清空记录表 + 页表**两张 vector），它是纯 VM、可实现。 |
| 本轮**新闭环**的不确定项 | 记录 flags **bit1（掩码 2）的写者已闭环**：`sub_4040A0` → `sub_46CC60`(raw 84047) → `sub_46CBF0(...,2)`(raw 84004) → `sub_46BE30(...,a5=2)` → `if (a5>=0) sub_4691A0(Font, win, a5, ...)`(raw 83634-83635 / 83941-83942) → `sub_45F090`(raw 81526) → 记录 `+40 |= 2`。 |

---

## 1. 分派表核对（handler 归属，双向确认）

分派表 = `_this + 675996` 起的函数指针数组（dword 下标 168999），**opcode n 的表项在 `_this + 675996 + 4n`**：

| opcode | 表项偏移 | 赋值行 (raw) | handler | handler 体定义头 (raw) |
|---|---|---|---|---|
| `0x70` (112) | 676444 | **22813** `*(_DWORD *)(_this + 676444) = sub_41ED20;` | `sub_41ED20` | 28400（体 28401-28416） |
| `0x71` (113) | 676448 | **22814** = `sub_41ED80` | `sub_41ED80` | 28418（体 28419-28462） |
| `0x83` (131) | 676520 | **22832** = `sub_42D220` | `sub_42D220` | 38017（体 38018-38028） |
| `0x84` (132) | 676524 | **22833** = `sub_41F790` | `sub_41F790` | 28828（体 28829-28942） |
| `0x85` (133) | 676528 | **22834** = `sub_418F50` | `sub_418F50` | 24471（体 24472-24476） |
| `0x1BB` (443) | 677768 | **22861** = `sub_420000` | `sub_420000` | 29223（体 29224-29242） |
| `0x1D0` (464) | 677852 | **22872** = `sub_42D440` | `sub_42D440` | 38098（体 38099-38110） |
| `0x1D1` (465) | 677856 | **22873** = `sub_420310` | `sub_420310` | 29353（体 29354-29371） |
| `0x1D2` (466) | 677860 | **22874** = `sub_420380` | `sub_420380` | 29373（体 29374-29386） |

`sub_45D660` / `sub_45EC60` / `sub_459860` / `sub_459770` / `sub_457B20` / `sub_45D240` **在分派表里没有槽**
（`grep '= sub_45D660;'` 零命中）⇒ 它们是内部落点，**不是 opcode handler**。这也解释了为什么
opcode-table 里 `0x70`/`0x71` 的 handler 列写 `sub_41ED20`/`sub_41ED80` 是对的。

---

## 2. Q1：`0x1d0` 到底做什么

### 2.1 handler 体（`sub_42D440` raw 38098-38110，逐行原文）

```c
38098: //----- (0042D440) --------------------------------------------------------
38099: int __thiscall sub_42D440(_DWORD *_this)
38100: {
38105:   _this[30 * _this[95776] + 95805] = 7;          // 帧状态槽 = 7
38106:   v2 = sub_41BF50(_this, 3);                     // ★只读 op3 一个操作数（int）
38107:   sub_459860(_this + 21324, &v5, &v4, v2, 2);    // Font = _this + 21324(dword) = Engine+85296 字节
38108:   sub_42B4B0((int)_this, 1, v5);                 // 写 op1
38109:   return sub_42B4B0((int)_this, 2, v4);          // 写 op2
38110: }
```

- **操作数面**：`argc = 3`；**只读 op3**（`sub_41BF50` = 操作数读，raw 26554-…：按 type 走立即数 / int 值池 /
  float 值池 / 引用池 / 数组等），**写 op1 与 op2**（`sub_42B4B0` = 操作数回写，raw 36964-…：`case 3:` 写 int 值池、
  `case 9:` 写本帧 int 槽、`case 6/12:` 写引用池……）。
- **没有数组批量**、没有字符串操作数、没有「读 op1/op2」。
- **返回值被忽略**（`sub_42D440` 不检查 `sub_459860` 的返回）。
- 末参 `2` 是**字面量常量掩码**（不是操作数）。

### 2.2 被调 `sub_459860`（raw 70629-70724）—— 零 GDI / 零字体，纯整数台账

三个容器（`Font` = `Engine + 85296` 字节 = `Engine[21324]` dword）：

| 字段（dword 写法） | 字节偏移（Font 内） | Engine 绝对偏移 | 元素 | 谁写 |
|---|---|---|---|---|
| `_this[841]` / `_this[842]` / `_this[843]` | `+3364` / `+3368` / `+3372` | `0x15A54/58/5C` | **文本项记录表** begin/end/cap，**72 B/条** | `sub_45EFA0`(0x1D2)、`sub_45EEA0`(语音族)、`sub_45F090`(渲染层)、`sub_45F1B0`(读档) |
| `_this[845]` / `_this[846]` / `_this[847]` | `+3380` / `+3384` / `+3388` | `0x15A64/68/6C` | **回看页索引表** begin/end/cap，**8 B/条** | **只有 3 处**：raw 73186(0x70) / 74271(0x71) / 74494(读档) |
| `_this[859]` / `_this[860]` | `+3436` / `+3440` | `0x15A9C/A0` | **末项下标** / **当前读游标** | 同上两个 push（raw 73189-73190 / 74273-74274） |
| `_this[849+win]` | `+3396+4*win`（win 0..9） | `0x15A74+4*win` | 每窗「下一条记录是组首」标记 | `sub_45EFA0`(消费清零)、**0x70 raw 73187**、0x71 raw 74275 |

`sub_45D240(Font+3380, pair)`（raw 72987-73011）= 8 B/条的 vector push_back（`_this[1] += 8;` raw 73000/73008；
容量不足时 `sub_42AA30(_this, 1)` 扩容）。**全库只有 3 个调用点**（见上表）⇒ 页表的写者是**有限且已穷举**的。

### 2.3 导航语义（raw 70630-70724 逐分支，**关键行原文**）

```c
70648:   *a3 = -1;            // a3 = &op2
70649:   *a2 = -1;            // a2 = &op1   ⇒ ★任何失败路径都留 -1/-1（初值即失败值）
70650:   v5 = _this[860];     // v5 = 当前游标（页表下标）
70651:   if ( a4 < 0 )        // ① 负步数：向"旧"走 -a4 格
70653:     v20 = -a4;
70654:     v6 = *(_DWORD *)(_this[845] + 8 * v5 + 4);      // 当前页的「起始记录下标」
70655: LABEL_3:
70656:     v18 = v6;
70657:     while ( v6 )
70658:     {
70659:       if ( v5 <= 0 ) break;                          // 走到第 0 页之前 ⇒ 失败
70661:       v6 = *(_DWORD *)(_this[845] + 8 * v5 - 4);     // ← 读 [v5-1] 的 second（注意：先用旧 v5 算地址）
70663:       --v5;                                          // 再减 v5 ⇒ 该条即第 v5 页
70664:       if ( v6 >= (_this[842] - v7) / 72 ) break;     // 起始下标 >= 记录条数 ⇒ 失败
70666:       if ( (a5 & *(_DWORD *)(v7 + 72 * v6 + 40)) == 0 && v6 != v18 )   // ★掩码门 + 去重
70668:         if ( --v20 > 0 ) goto LABEL_3;               // 还要再退 ⇒ 继续
70670:         goto LABEL_22;                               // 退够了 ⇒ 取该页
70673:     return 0;                                        // ⇒ op1/op2 保持 -1/-1
70675:   if ( a4 > 0 )        // ② 正步数：向"新"走 a4 格
70680:     v12 = (_this[846] - _this[845]) >> 3;            // 页条数
70681:     v19 = v10;                                      // = 当前页的起始记录下标（去重基准）
70682:     while ( 1 )
70684:       ++v5;
70685:       v11 += 2;                                      // 8 B/条 ⇒ 指针 +2 dword
70686:       if ( v5 >= v12 ) return 0;                     // 越过末页 ⇒ 失败
70689:       if ( *v11 == *(_DWORD *)(_this[846] - 4) ) return 0;   // ★走到"末条目的起始下标"= LIVE 页 ⇒ 停
70692:       if ( v15 >= (_this[842] - v16) / 72 ) return 0;
70694:       if ( (a5 & *(_DWORD *)(v16 + 72 * v15 + 40)) != 0 || v15 == v19 )  // 掩码命中 或 重复 ⇒ 不计格
70696:         v12 = (_this[846] - _this[845]) >> 3;        //    只刷新计数、继续找
70698:       else
70700:         if ( --a4 <= 0 ) break;                      // 计满 a4 格 ⇒ 取该页
70702:         ... v19 = 该页起始记录下标; v11 = 该条指针;  // 换去重基准
70709: LABEL_22:
70711:   v17 = (_this[846] - _this[845]) >> 3;
70712:   if ( v17 <= 0 || v17 <= v5 )   { *a3 = -1; *a2 = -1; return 1; }   // 表空 / 下标越界 ⇒ -1/-1
70718:   else {
70720:     *a2 = *(_DWORD *)(_this[845] + 8 * v5);        // ★op1 = 该页窗口号
70721:     *a3 = *(_DWORD *)(_this[845] + 8 * v5 + 4);    // ★op2 = 该页在 72B 记录表里的起始下标
70722:     return 1; }
```

**语义总结**：`op3` = **带符号相对步数**（相对当前游标 `Font[860]`）。
`0` ⇒ 直接落到 `LABEL_22` 输出**当前页**；`>0` ⇒ 向新走 n 格；`<0` ⇒ 向旧走 -n 格。
「格」的计数规则：页条目的 `start` 必须在记录表范围内、且 `(掩码 & 记录[start].flags) == 0`、
且与**上一条被计数的页**指向不同记录（去重）⇒ 才算一格。

**越界/失败**：`op1 = op2 = -1`（初值）。具体失败路径：表空或 `v17 <= v5`（70712）、
后退走到 `v5 <= 0` 之前（70659）、`v6 == 0`（70657 的 `while(v6)`）、`start >= 记录条数`（70664/70692）、
前进越过末页（70686）、前进撞上**末条目的 start**（70689）。

**门**：`sub_42D440` 与 `sub_459860` 体内**没有任何标志位/配置开关**（无 `Engine[97055]` 检查、无 INI 读）。
唯一的常量门是掩码 `a5 = 2`。

**两条分支的形状不对称（如实记录，意图未求证）**：后退分支用 `while (v6)` 且去重基准是「上一轮读到的 start」
（`v18`）；前进分支没有 `while(v6)`、去重基准是初始页的 start（`v19`），且额外用**末条目的 start**
（`*_DWORD*)(_this[846]-4)`）当哨兵。⇒ 见 §9 不确定项 2/3。

---

## 3. Q2：写端 `0x70` / `0x71`

### 3.1 `0x70` = `sub_41ED20`（体 raw 28401-28416）→ `sub_45D660`（体 raw 73133-73192）

```c
28409:   _this[30 * _this[95776] + 95805] = 11;
28410:   v7 = sub_41BF50(_this, 5);
28411:   v6 = sub_41BF50(_this, 4);
28412:   v5 = sub_41BF50(_this, 3);
28413:   v4 = sub_41BF50(_this, 2);
28414:   v2 = sub_41BF50(_this, 1);
28415:   return sub_45D660((int)(_this + 21324), v2, v4, v5, v6, v7, 0);
```
⇒ `sub_45D660(Font, a2=op1, a3=op2, a4=op3, a5=op4, a6=op5, **a7=0**)`。`a7 = 0 >= 0` ⇒ **push 恒执行**。

`sub_45D660` 体（关键行）：

```c
73147:   v7 = a2;
73148:   if ( !a2 ) { a2 = *(_DWORD *)(_this + 1228); v7 = a2; }   // win=0 ⇒ Font[307]（默认窗，初值 1）
73153:   v9 = *(_DWORD *)(_this + 4 * v7 + 1044);                  // 该窗对象指针数组 Font[261+win]（win 0..9）
73154:   *(_DWORD *)(v9 + 12) = a5;    // ← op4 → 窗+12
73155:   *(_DWORD *)(v9 + 16) = a6;    // ← op5 → 窗+16
73157:   v10[5] = a3;  v10[6] = a4;    // ← op2/op3 → 窗+20/+24
73159:   v10[31] = a3; v10[32] = a4;   //              → 窗+124/+128
73162:   *(_DWORD *)(v11 + 36) = a3;  // ← op2 → 窗+36
73163:   *(_DWORD *)(v11 + 40) = a4;  // ← op3 → 窗+40
73164:   if ( *(_DWORD *)(dword_55E1BC + 667856) == 1 ) { /* 缩放 a3/a4 → sub_4A7170(设备, 窗+20, x, y) */ }
73175:   else { sub_43C8D0(*(_DWORD *)(_this + 1032), _this, v7 + 20, a3, a4, 0); ... }
73181:   if ( a7 >= 0 )
73183:     v15 = (*(_DWORD *)(_this + 3368) - *(_DWORD *)(_this + 3364)) / 72;   // ★当前记录条数
73184:     v17[0] = v7;                       // 窗号
73185:     v17[1] = v15;                      // 起始记录下标
73186:     sub_45D240((_DWORD *)(_this + 3380), v17);        // ★★push 页表
73187:     *(_DWORD *)(_this + 4 * v7 + 3396) = 1;           // ★该窗「组首」标记置 1
73188:     result = ((*(_DWORD *)(_this + 3384) - *(_DWORD *)(_this + 3380)) >> 3) - 1;
73189:     *(_DWORD *)(_this + 3436) = result;               // Font[859] = 末项下标
73190:     *(_DWORD *)(_this + 3440) = result;               // Font[860] = 当前游标
```

**`0x70` 的操作数语义（用真语料反证，见 §8.3）**：`op1 = 窗号`、`op2 = 宽(w)`、`op3 = 高(h)`、`op4 = x`、`op5 = y`。
证据是「同一批槽的兄弟指令」：
- 窗 `+36/+40` 也由 `0x1C1`（`sub_4563D0` raw 68248-68261）写，而 `0x1C1` 的语料用法是**换行边界**；
- 窗 `+12/+16` 也由 `0x198`（`sub_456400` raw 68263-68279）写，语料是**屏幕位置 x/y**；
- 语料量纲（SYSTEM4.txt:23-30）给出 1280×720 屏下的自洽解：窗 1 = `880×148 @ (190,557)`（底部主消息框）、
  窗 2 = `430×40 @ (120,508)`（说话人名条）、窗 8 = `1280×720 @ (0,0)`（全屏）。
  ⇒ 只有 `op2=w, op3=h, op4=x, op5=y` 这一种读法自洽（另一种读法会把窗 2 变成 40 宽 430 高，与屏不符）。

### 3.2 `0x71` = `sub_41ED80`（体 raw 28419-28462）→ `sub_45EC60`（体 raw 74197-74281）

```c
28425:   _this[30 * _this[95776] + 95805] = 3;
28426:   v2 = sub_41BF50(_this, 1);                     // 只读 op1
28427:   sub_45EC60(_this + 21324, v2, _this[97055]);   // ★第 3 实参 = Engine[97055]（SetTB 字段）
```
`sub_45EC60` 体（关键行）：

```c
74197: int __thiscall sub_45EC60(_DWORD *_this, int a2, int a3)   // a3 只被当门用（见 74267）
74221:   if ( !a2 ) { v19 = _this[307]; v3 = v19; }      // win=0 ⇒ 默认窗
74226:   v5 = (_DWORD *)_this[v3 + 261];                // 该窗对象
74238:   ... sub_457CA0 / sub_45D120(v5 + 11, v20) ...   // 清该窗"文本记录 vector"（win+44 族）
74240:   v5[33] = 0; v5[74] = 0; v5[71] = 1;             // 复位显现游标等
74248:   if ( mode == 1 ) { ... sub_4A3890(表面) / memset / sub_4ABB60(窗+104/108, 窗+276/280) ... }
74260:   else if ( _this[339] == 1 ) { ... sub_43E260(DD表面, 窗+20, ...) ... }
74267:   if ( a3 >= 0 )                                  // ★★SetTB 门（a3 = Engine[97055]）
74269:     HIDWORD(v22) = (_this[842] - _this[841]) / 72;   // ★当前记录条数
74270:     LODWORD(v22) = v3;                              // 窗号
74271:     sub_45D240(_this + 845, &v22);                  // ★★push 页表
74272:     v15 = ((_this[846] - _this[845]) >> 3) - 1;
74273:     _this[859] = v15;                               // Font[859]
74274:     _this[860] = v15;                               // Font[860]
74275:     _this[v3 + 849] = 1;                            // ★该窗「组首」标记
74277:   v16 = (_DWORD *)_this[v3 + 261];
74278:   sub_45D930(v16 + 52, &v19, v16[52], v16[53]);    // 清该窗"行/段"容器
74279:   result = sub_45E570(v16 + 52, 0);
74280:   v16[34] = 0;
```

### 3.3 成对关系（回答「1 条写 ↔ 1 条读？还是 1 条写多槽？」）

- **1 次调用 push 恰好 1 条**（`sub_45D240` 一次 `+= 8`），**两条写端形状完全相同**：
  `{ field0 = 窗号, field1 = (Font[842]-Font[841])/72 }`（即**推送时刻的记录条数**）。
- **不是**「1 条写多槽」；也不是「读端 1 条 ↔ 写端 1 条」的语义配对 —— 读端是**按相对步数在表上移动**，
  一次 `i1d0` 消费 1 条页条目（可能一跳跨多条，因为要去重/过滤）。
- **重复条目是常态**：`0x70` 恒 push，即使记录条数没变（`i1bb 0` 段里 0x71 不 push，但 0x70 仍 push）⇒
  表里会出现相邻的**同 `start`** 条目，读端的 `v6 != v18` / `v15 == v19` 就是为它们准备的去重。
- **两个写端都置「组首」标记 `Font[849+win]`**，而不仅 `0x71`（`0x70` raw 73187 也置）。
  该标记由 `sub_45EFA0`(0x1D2) 消费成记录 flags bit0（raw 74340-74345），是 `i1d3`/`i1d4` 扫描的**组边界**。
- **注意 `0x70` 的副作用不止 push**：它同时写窗几何（5 个槽）+ `Font[849+win]=1` + 复位两个游标。

### 3.4 表清空与持久化（写端的另外两个入口）

- **清表**：`0x85` = `sub_418F50`（raw 24471-24476）= `sub_45EBE0(Font)`：
  ```c
  74188:   sub_45DA10(_this + 841, &v4, (_DWORD *)_this[841], _this[842]);  // 逐个析构 72B 记录
  74189:   sub_45E730(_this + 841, 0);                                      // 记录表 resize(0)
  74190:   v2 = _this[845];  if ( v2 != _this[846] ) _this[846] = v2;        // 页表清空
  74193:   return sub_45D1B0(_this + 845, 0);                                // 页表 resize(0)
  ```
  ★gaps 台账说它是「GDI 文本对象的行/段容器」**是错的**：它清的就是本票的两张表。
- **存档**：`sub_457CE0`（raw 69504-69664）= `SaveTextBufData`：`v5 = 44*记录条数 + 8*页条数`（raw 69553），
  `*v9 = 页条数`（raw 69572）⇒ **缓冲区首 dword = 页条数，随后 8 B/条的页对**；压缩后写 12 字节头 + 数据。
- **读档**：`sub_45F1B0`（raw 74403-…）：读 12 字节头（74461），解压（74480），
  **先 `sub_45EBE0(Font)` 清两张表**（74482），再 `v6 = *v3`（页条数）后循环
  `sub_45D240(v5 + 845, &v42)` push 页对（**74490-74494**）⇒ 页表可持久化。错误串 `aLoadtextbufdat`（raw 74463）。

---

## 4. Q3：表的内存归属 + `analysis/fields.json` 核对（只读）

**对象**：`Font` = `Engine + 85296` 字节 = `Engine[21324]`（dword）；`fields.json` 里既有 `scope:"Font"`
也有把这同一对象写成 `Engine` 的条目（口径不一致，见下）。**win 索引范围 0..9**（10 个窗，
初始化参 `sub_465390` raw 78823-78962：`Font+1044..+1080` 窗对象 ×10、`Font+3396..+3432` 标记 ×10）。

| 语义 | Font 偏移 | Engine 绝对偏移 | 元素/stride | 类型 | 谁写 |
|---|---|---|---|---|---|
| 文本项记录表 begin | `+3364` | `0x15A54` | 72 B/条 | `vector` | `sub_45EFA0` / `sub_45EEA0` / `sub_45F090` / 读档 |
| 记录表 end / cap | `+3368` / `+3372` | `0x15A58` / `0x15A5C` | — | — | `sub_45E7E0` / `sub_45E730` |
| **回看页索引表 begin** | `+3380` | `0x15A64` | **8 B/条 = `{窗号@+0, 起始记录下标@+4}`** | `vector` | **仅 raw 73186 / 74271 / 74494** |
| 页表 end / cap | `+3384` / `+3388` | `0x15A68` / `0x15A6C` | — | — | `sub_45D240` / `sub_45D1B0` |
| 每窗「组首」标记（×10, win 0..9） | `+3396+4*win` | `0x15A74+4*win` | 4 B | `int32_t` | 0x70 raw 73187、0x71 raw 74275；`sub_45EFA0` 消费清零 |
| 页表末项下标（LIVE） | `+3436` | `0x15A9C` | 4 B | `int32_t` | push 时置 = 新末项；`sub_459770(a2==0)` 复制的源 |
| 页表当前游标 | `+3440` | `0x15AA0` | 4 B | `int32_t` | push 时置；`sub_459770` 移动 |
| 默认窗 | `+1228` | `0x151FC` | 4 B | `int32_t` | 0x80 / 初始化（初值 1） |
| 窗对象指针表 | `+1044+4*win` | `0x15144+4*win` | 4 B | `uaddr[]` | 构造 |

**`analysis/fields.json` 已核对条目**（原文名称/offset/scope）：

| 行 | offset | name | scope | 核对结论 |
|---|---|---|---|---|
| 403 | `0x15A54` | `backlog_items_begin` | `Font` | **正确**（72B/条布局、`+20/+24/+28/+32/+40/+44` 与 raw 74345-74353 一致） |
| 406 | `0x15A64` | `backlog_pages_begin` | `Font` | **正确**；evidence `raw 73183-73186` 命中 push 点，但**只举了 0x70**，应补 74271(0x71) 与 74494(读档) |
| 407 | `0x15A74` | `msg_item_group_start` | `Font` | **正确**；evidence 只有 `raw 74323-74357`（消费端）⇒ **应补写者 `raw 73187`(0x70) / `74275`(0x71)** |
| 408 | `0x15A9C` | `backlog_page_last` | `Font` | 名称/offset 正确；evidence `74272-74274` ⇒ 应补 `73189-73190`(0x70)。语义 = 「**最新页下标**」，每次 push 重置 |
| 409 | `0x15AA0` | `backlog_page_cur` | `Font` | **正确**（evidence `70589/70624` = `sub_459770`） |
| 361 | `0x151FC` | `default_window` | `Font` | **正确**（evidence 78899; 73150/74223） |
| 15 | `0x15144` | `msgwin_objects` | `Engine` | offset/含义正确，但 **scope 与同族的 `Font` 条目不一致**（同一对象）；建议统一或加注 `Font = Engine+0x14D30` |

**缺失条目**（建议本轮补）：页表 end/cap（`0x15A68`/`0x15A6C`）、记录表 end/cap（`0x15A58`/`0x15A5C`）、
以及「页表 = `SaveTextBuf.dat` 持久化」的锚点（`sub_457CE0` raw 69572 / `sub_45F1B0` raw 74494）。

---

## 5. Q4：emulator 侧现状与缺口

### 5.1 现状（读到的实现，不是判据）

| 位置 | 现状 |
|---|---|
| `src/vm/handlers/msgwin.ts:1115-1131` `op_window_geometry`（0x70，表项在 `:1633`） | 读 `op1=win`、`op2=w`、`op3=h`、`op4=x`、`op5=y` → 写 `geom` 的 `w/h/x/y` + `wrapRight/wrapBottom`。**与引擎一致**（见 §3.1）。**缺**：push 页、置组首标记、复位双游标 |
| `src/vm/handlers/msgwin.ts:479-505` `op_message_show`（0x71） | `m.beginNewMessage(w)` + `if (m.textSlotArg >= 0) e.textItems.markGroupStart(w)`。**缺**：页 push；**门写错**：`m.textSlotArg` 全库只被初始化（`vm/msgwin.ts:371`、`:795`），**从未被赋值** ⇒ 恒 `0` ⇒ 门恒真（引擎门 = `Engine[97055] >= 0`，`i1bb 0` 期间应为假） |
| `src/vm/textItems.ts` | 只建了 `records`（72B 记录的 `+0/+20/+24/+28/+32/+40`）+ `groupStart`；**没有 `pages`、没有游标**；`reset()`（`handlers/control.ts:400` 在 `0x9 exit-script` 调）只清 `records` |
| `src/vm/handlers/text-items.ts` | `0x1BB`/`0x1D2`/`0x1D3`/`0x1D4`/`0x2F3` 已真实现；`0x1d0`/`0x1d1` **不在任何表里**（`test/op-1d0-1d1-text-metrics.test.ts:60-70` 用断言钉住"不许静默上桩"） |
| `src/vm/advState.ts:42/59/85-87` | 快照只搬 `textItems.records`；**无 pages/游标** |
| `0x85`（`i085`） | `analysis/opcode-gaps.json` 里 `deferred`，理由「清 GDI 文本对象的行/段容器」—— **错**（见 §3.4） |
| 分派注册点 | `src/vm/handlers/index.ts`（`TEXT_ITEM_OPS` 已 spread 进 `OPS`）⇒ 加 0x1d0/0x85 到 `text-items.ts` **不必改 index.ts**；三张表必须两两不相交（`test/registry-tables.test.ts`） |

### 5.2 「可否纯 VM 状态实现，还是必须新增宿主缝？」

**纯 VM 状态，不需要任何新宿主缝。** 理由逐条：

1. `0x1d0` 的全部输入是 `Font+3364` 记录表的 `+40` flags 与 `Font+3380` 页表 —— 两者在 emulator 里
   都应是**自有数组**（记录表已存在）；
2. 它的输出是**两个操作数回写**（`sub_42B4B0(_this,1/2,...)`）⇒ 消费者是**脚本自己**（`i1d3` 的起始下标、
   `i1d1`/`i07a` 的窗号），全在同一 VM 内；
3. 两个写端（`0x70`/`0x71`）都是 `OPS` 里的真实现（不落宿主）；
4. `0x85` 清表同样是 VM 内部。

**五处同步的宿主缝先例存在但不适用于本票**（`src/vm/native.ts` + `src/renderer/headlessScene.ts` +
`src/renderer/pixiBackend.ts` + `src/vm/stubNative.ts` + `src/vm/nativeTap.ts` 五个文件都在，
但那是给 `native.*` 派发链用的）。**只有**下列两件（**不在本票范围**）才需要宿主缝：
渲染层记录 push（`sub_45F090` raw 74360-74400，带几何 + flags `|4`/`|8`）与 `0x1d1` 的离屏表面/DrawItem 重绘。

---

## 6. Q5：落地路径（文件 / 守卫 / E3）

### 6.1 要改的文件（按依赖顺序）

1. **`src/vm/textItems.ts`**：加
   - `pages: { win: number; start: number }[]`（`pushPage(win)`：`start = this.records.length`）；
   - 双游标 `cursor` / `baseCursor`（push 时两者 = `pages.length - 1`；`a2 == 0` 复位 ⇒ `cursor = baseCursor`）；
   - `pageAt(step, mask)`（`sub_459860` 语义，纯函数、不改游标）与 `moveCursor(dir, mask)`（`sub_459770`，改游标）；
   - `reset()` 里一并清 `pages`/游标（`control.ts` 的 `0x9` 与 `0x85` 复用；**不必改 control.ts**）。
   注释必须写 raw 70629-70724 / 73181-73191 / 74267-74276。
2. **`src/vm/handlers/text-items.ts`**：`TEXT_ITEM_OPS` 加 `[0x1d0, op_backlog_page_at]`（读 op3 → 写 op1/op2）
   与 `[0x85, op_text_tables_clear]`（清两张表）。**注意**：`0x1d0` 必须走 `OPS`（`implemented`），
   不能进 `ENGINE_INTERNAL_OPS`；且要**同时删掉/改写** `test/op-1d0-1d1-text-metrics.test.ts:60-70` 的
   「不许注册」断言（该文件已写明"有人实现了就改成真行为断言"）。
3. **`src/vm/handlers/msgwin.ts`**：
   - `op_window_geometry`（0x70）末尾加 `e.textItems.pushPage(win)` + `markGroupStart(win)`（raw 73186-73187，**无门**）；
   - `op_message_show`（0x71）把 `m.textSlotArg >= 0` 换成**引擎门**：`(e.engineValues.get(ENGINE_FIELD.textBaseGate) ?? 0) >= 0`，
     门内加 `pushPage(w)`（raw 74267-74276）。
4. **`src/vm/advState.ts`**：快照加 `pages`/`cursor`/`baseCursor`（引擎走 `SaveTextBuf.dat`；emulator 至少随帧状态走）。
5. **文档/台账**（主 agent 结算时做，本报告不改）：
   - `docs-new/03-engine/opcode-table.md`：`0x70` 行「op1..op5 设置 x/y/宽/高」应写明顺序 `win,w,h,x,y`；
     **`0x71` 行「读 op1 文本」是错的** ⇒ 改为「`op1` = 消息窗槽号（0 ⇒ 默认窗）」；
     `0x1D0` 行去掉 deferred、补「门在写端」；`0x85` 行理由订正；
   - `analysis/opcode-gaps.json`：464 → `implemented`；133(`i85`) 的 note 订正（清的是两张表，非 GDI 容器）；
   - `docs-new/03-engine/route-c-text-metrics-2026-09.md` §1.3 的 bit1 残余不确定：**本轮已闭环**（§9 引用证据链）。

### 6.2 守卫怎么写（合成指令 + 断言清单）

合成脚本（`test/op-1d0-page-index.test.ts`，或直接改写现有 `op-1d0-1d1-text-metrics.test.ts`）：

```ts
const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;
// 前置：i1bb 1（记账开）→ 3 条记录（i1d2）→ i071 1（push 页 A）→ 2 条记录 → i071 1（push 页 B）
```
断言（每条都指名 raw）：

| # | 断言 | 依据 |
|---|---|---|
| 1 | `pages` = `[{win:1,start:0},{win:1,start:3},{win:1,start:5}]`（push 时刻的 `records.length`） | raw 74269-74271 / 73183-73186 |
| 2 | push 后 `cursor === baseCursor === pages.length-1` | raw 73188-73190 / 74272-74274 |
| 3 | `i1d0 out1 out2 0` ⇒ `out1 = 窗号`、`out2 = 该页 start`（当前页） | raw 70720-70721（`a4==0` 直落 LABEL_22） |
| 4 | `i1d0 … -1` 退回上一页（`out2` 变小） | raw 70651-70670 |
| 5 | `i1d0 … -99`（越界）⇒ `out1 = out2 = -1` | raw 70659 / 70648-70649 |
| 6 | `i1d0 … +1` 前进一页；前进越过末页 ⇒ `-1/-1` | raw 70675-70693 |
| 7 | 相邻**同 start** 的重复页被跳过（去重） | raw 70666 `v6 != v18` / 70694 `v15 == v19` |
| 8 | 记录 `flags` 带 bit1 时该页被跳过（掩码 2） | raw 38107 常量 `2` + 70666/70694 |
| 9 | `i1bb 0` 期间 `i071` **不** push、**不**置组首；`i070` **仍然** push + 置组首 | raw 74267（门）/ 73181（`a7=0` 无门） |
| 10 | `i085` 后 `pages.length === 0 && records.length === 0 && cursor === 0` | raw 74188-74193 |
| 11 | `i1d0` 输出的 `op2` 直接喂给 `i1d3` 的第 4 操作数时能命中（真语料的用法闭环） | `src/CONFIG.txt:22/26`、`HISTORY.txt:31/33` |

★**注意 `0x1d0` 的写目标必须是池操作数**（`(local-int N)` / `(global-int X)`），立即数不能当写目标
（`harness.ts` 的 `loc()` 注释同此）。

### 6.3 E3（场景断言）用哪份真实脚本、怎么跑

**★`install/CONFIG.BIN` 就是本票的 E3 载体（已实测存在，非推断）** —— 用 emulator 的解析器实测：

```
install/CONFIG.BIN: 426 条指令
0x1d0 ×1（第 14 条，实参 = [type 0x9 raw 5, 0x9 raw 6, 0x9 raw 7]）★与 src/CONFIG.txt:22 逐字对应
0x70 ×1 / 0x71 ×3 / 0x1bb ×2 / 0x1d2 ×1 / 0x1d3 ×1 / 0x85 ×0
```
（`install/` 里**没有** `HISTORY.BIN`/`REPLAYVOICE.BIN`：`Get-ChildItem install -Filter '*HISTORY*'` 零命中
⇒ 本票的 E3 只能用 CONFIG。）

跑法（照抄 `test/op-3-004-furigana-outer-gate.test.ts` 的既有 E3 模式）：

```ts
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { chainResourceDir } from '../src/tools/config1Chain.js';
import { loadScriptData } from '../src/vm/interpreter.js';
const src = new NodeFileSource({ resourceDir: chainResourceDir() });
const boot = await src.readByName('CONFIG.BIN');           // 松散文件优先，与链路跑手同一读取路径
const e = mkEngine([]);
loadScriptData(e, boot.data, boot.name);
// 前置：先在**合成前奏帧**里 push 记录与页（引擎里这些页来自主 ADV 脚本，CONFIG 自己只读）
// 然后驱动到第 14 条（i1d0），断言 op1/op2 ≠ -1/-1 且 op2 是合法 records 下标
```
**诚实披露**：CONFIG 脚本自己只**读**页表（页由主 ADV 的 `i071` 填），所以在纯 CONFIG 场景里
必须先播一段带 `i1d2`/`i071` 的前奏，否则 `i1d0` 合理地返回 `-1/-1`。
若要求「全真实链路」，则要 boot `install/CONFIG1.BIN`（已存在于 `install/`）并走到设置画面
（`config1-chain.test.ts` / `op-3-004` 已有同链路的装载代码），成本更高但零合成。

---

## 7. Q6：`0x1d0` 与 `0x1d1` 的关系

**不是读写两半，是同一子系统的「导航读端」与「渲染端」**：

| | `0x1d0` (`sub_42D440`) | `0x1d1` (`sub_420310`) |
|---|---|---|
| 读操作数 | 只 op3（步数） | op1..op5 |
| 写操作数 | **op1 = 窗号、op2 = 记录表起始下标** | **不写任何操作数**（纯副作用） |
| 落点 | `sub_459860`(raw 70629-70724) —— 零 GDI、纯整数台账 | `sub_4675A0`(raw 80312-81522, 1210 行) —— GDI 文本页渲染器 |
| 语料 | 5 处（CONFIG 1 / HISTORY 3 / REPLAYVOICE 1） | 1 处（`HISTORY.txt:1314`） |

**三处脚本独立印证二者是流水线上下游**：`HISTORY.txt:1311-1314` = `4a9 = 3 + 91`（窗号）→ `i07a 4a9 …`
→ `i1d1 (local-int 4a9) (local-int 94) 40 0 0`，其中 `94` 就是上一条 `i1d0`（raw 1129-1130）写出来的 op2。
**两条的 `op1` 都是窗口号**（`i071`/`i1d1` 同一算法 `3 + i`，见 `HISTORY.txt:98-99` 与 `1311-1314`）。

⇒ 「GDI 文本度量族」的归口对**两条都错**：`0x1d0` 与度量无关（零 GDI）；`0x1d1` 是**渲染器**不是度量器。
路线 C 真正的 `GetTextExtent` 落点在 `set:BlankExtentMode`（`route-c-text-metrics-2026-09.md` §7）。

---

## 8. Q7：语料实证

### 8.1 计数口径（两种写法都数）

台账 `mnemonic` **不补零**，语料是 `i` + 三位补零；本票相关的两种写法实测：

| 台账写法 | 语料写法 | 语料命中 | 文件数 | 台账写法在语料的命中 |
|---|---|---|---|---|
| `i70` | `i070` | **10** | 3 | `i70` = **0** |
| `i71` | `i071` | **90713** | 340 | `i71` = **0** |
| `i1d0` | `i1d0` | **5** | 3 | （同一写法） |
| `i1d1` | `i1d1` | **1** | 1 | （同一写法） |
| `i85` | `i085` | **1** | 1 | `i85` = **0** ★这正是"两种写法都要数"的实例 |

参考：`i1bb` 470/220、`i1d2` 42760/333、`i1d3` 15/3、`i072` 0。

### 8.2 `i1d0` 的 5 处真实调用形态（原文）

`src/HISTORY.txt`（`local_vars = { 4b5 1 2 5 1 2 }`）：
```
21:  i1bb 0                                  ← 进 HISTORY 先停记账
22:  mov (local-int 9a) 0
31:  i1d0 (local-int 93) (local-int 94) (local-int 9a)     ← op1/op2 是出参、op3 = 9a（步数）
32:  sub (local-int 4a9) 0 1
33:  i1d3 (local-int 96) (local-int 97) (local-int 93) (local-int 94) (local-int 4a9)   ← ★94 直接当 i1d3 的"起始下标"
34:  eq (local-int 4a9) (local-int 96) 0
35:  ne (local-int 4aa) (local-int 93) 9                 ← ★op1（窗号）与常量 9 比较
36:  and (local-int 4ab) (local-int 4a9) (local-int 4aa)
37:  jcc (local-int 4ab) ffffffff label_00000348         ← found==0 且 win!=9 ⇒ 跳过
38:  lookup-array (local-ptr 0) (local-int 9c) (local-int 485)
39:  mov (local-ptr 0) (local-int 9a)
43:  sub (local-int 9a) (local-int 9a) 1                 ← ★步数每轮 -1
```
```
760:  mov (local-int 9a) (local-ptr 1)                    ← 步数从数组取（753-759：4aa = 486 + (88-9)）
761:  i1d0 (local-int 93) (local-int 94) (local-int 9a)
764:  i1d3 (local-int 96) (local-int 49c) (local-int 93) (local-int 94) a   ← 起始下标 94、键 0xa
1129: mov (local-int 9a) (local-ptr 3)
1130: i1d0 (local-int 93) (local-int 94) (local-int 9a)
1136: i1d3 (local-int 96) (local-int 49c) (local-int 93) (local-int 94) a
1311: add (local-int 4a9) 3 (local-int 91)                ← 窗号 = 3 + i
1312: i07a (local-int 4a9) (local-int 4b2) (local-int 4b3)
1314: i1d1 (local-int 4a9) (local-int 94) 40 0 0          ← ★用 i1d0 的 op2 重绘该页
1496: i1bb 1                                              ← 出 HISTORY 恢复记账
```
`src/CONFIG.txt`（`local 7` 是步数、`local 8/9` 是出参、哨兵键 = `-1`）：
```
17:  mov (local-int 7) 0
19:  label_0000015c
22:  i1d0 (local-int 5) (local-int 6) (local-int 7)
23:  gre (local-int c) (local-int 6) 0
24:  jcc (local-int c) ffffffff label_0000023c
25:  sub (local-int c) 0 1                             ← 键 = -1（哨兵）
26:  i1d3 (local-int 8) (local-int 9) (local-int 5) (local-int 6) (local-int c)
33:  sub (local-int 7) (local-int 7) 1                 ← ★步数每轮 -1
37:  i070 9 338 78 144 23a                            ← op1=9, op2=0x338(824), op3=0x78(120), op4=0x144(324), op5=0x23a(570)
41:  i1bb 0
172: i071 9         196: i071 9        265: i071 2
355: i1bb 1
```
`src/REPLAYVOICE.txt`（`local 4` 步数、`1/2` 出参、键 `d = -1`）：
```
6:   i1bb 0
8:   mov (local-int 4) 0
13:  i1d0 (local-int 5) (local-int 6) (local-int 4)
14:  gre (local-int d) (local-int 6) 0
16:  sub (local-int d) 0 1
17:  i1d3 (local-int 1) (local-int 2) (local-int 5) (local-int 6) (local-int d)
24:  sub (local-int 4) (local-int 4) 1                ← ★步数每轮 -1
122: i1bb 1
```

**结论（语料侧硬证据）**：
1. `op1` = **窗口号**（被与常量 `9` 比较、被当 `i071`/`i1d1` 的窗号）；
2. `op2` = **记录表起始下标**（三处脚本都把它直接当 `i1d3` 的第 4 操作数）；
3. `op3` = **≤ 0 的递减步数**（三处都有 `sub …,1` 的循环；HISTORY 另有从数组取值的路径）；
4. 三个回看画面的公共形状 = `i1bb 0` 包住 + 循环 `i1d0` → `i1d3`（+HISTORY 的 `i1d1` 重绘）+ `i1bb 1` 收尾。

### 8.3 `i070` 的 10 处（量纲反证，见 §3.1）

```
src/CONFIG.txt:37        i070 9 338 78 144 23a          → 824×120 @ (324,570)
src/GAMESTART.txt:34     i070 9 1ec 5c 0 0               → 492×92  @ (0,0)
src/SYSTEM4.txt:23       i070 1 370 94 be 22d            → 880×148 @ (190,557)  ← 底部主消息框
src/SYSTEM4.txt:24       i070 2 1ae 28 78 1fc            → 430×40  @ (120,508)  ← 说话人名条
src/SYSTEM4.txt:25..29   i070 3..7 320 2d0 fa 0          → 800×720 @ (250,0)
src/SYSTEM4.txt:30       i070 8 500 2d0 0 0              → 1280×720 @ (0,0)     ← 全屏
```

### 8.4 `i071` 的操作数（订正 opcode-table 的错误说法）

`HISTORY.txt:98-99`：`add (local-int 4a9) 3 (local-int 91)` → `i071 (local-int 4a9)`（循环 91 = 0..4）
≡ `HISTORY.txt:1418-1422` 的 `i071 3` … `i071 7`；`CONFIG.txt:42` 的 `i080 9`（设默认窗 = 9）后
`CONFIG.txt:172/196` 是 `i071 9`。
⇒ **`0x71` 的 `op1 = 消息窗槽号`（3..7 / 9 / 2），绝不是"文本"**。
opcode-table.md 第 110 行「读 op1 文本调 `sub_45EC60(msgobj, op1, _this[97055])`」需要订正。

---

## 9. 不确定项（如实披露，未求证的不编）

1. **★已闭环（本轮新增）**：记录 flags **bit1（掩码 2）的写者**。链条：
   `sub_4040A0`（`sub_46CC60` 的唯一调用者，raw 10044）→ `sub_46CC60`（raw 84018-84083）
   `sub_46CBF0(_this, a2, v14, 0, 2)`（raw 84047）→ `sub_46CBF0`（raw 83999-84010）
   `sub_46BE30((int)_this, a2, a3, a4, a5)`（raw 84004，`a5=2` 原样透传）→ `sub_46BE30` 内
   `if ( a5 >= 0 ) sub_4691A0((int *)_this, v5, a5, &v100, ...)`（raw **83634-83635**；同型 raw **83941-83942**）
   → `sub_4691A0`（raw 81524-81527）`sub_45F090(_this, a2, a3, ...)` → 记录 `+40 = a3 | (组首?1)`。
   ⇒ **bit1 = 「这条记录是"重排/重贴已有行"路径（`sub_46CC60`）产出的」**，页导航跳过它是有意义的
   （它不是一条新消息的首记录）。**残留**：`sub_46BE30`（raw 83363-83995，630 行）**未逐行读完**，
   我只核了 "a5 下传 + `a5 >= 0` 门" 的调用点；另有 `a3|8` 的旁路（raw 81552/82729）与读档路径
   （`sub_45F1B0` 直接把文件里的 flags 填回）也可能带 bit1。
2. **后退/前进两分支的**形状不对称**（raw 70657 的 `while (v6)`、后退用 `v18` 去重 vs 前进用 `v19` + 末条目哨兵）
   —— 代码事实清楚，**意图未求证**。
3. **`while (v6)`（v6 == 0 就退出）的语义未求证**：记录下标 0 是合法下标（表里确实有第 0 条），
   把它当"空/结束"哨兵看着像引擎的防御性写法。照抄即可，但不要在注释里编一个理由。
4. **`0x70` 恒定 push（且不过 SetTB 门）的意图未求证**：它会在 `i1bb 0` 段里插一条与上一条同 `start`
   的页条目；读端的去重（`v6 != v18` / `v15 == v19`）恰好能消化它 —— 这像是**故意**的设计（"窗口重设 = 新页边界"），
   但**未求证**。落地时按体照抄（`0x70` 无门、`0x71` 有门），不要"对称化"。
5. **`op3 > 0`（前进）在语料里的真实用法未穷举**：5 处实测全是 `0` 或递减的负值
   （HISTORY 有从数组取值的路径，值域未穷举）。前进分支照体实现，但 E3 断言里不要假装有语料覆盖。
6. **`i070` 的 op2/op3 命名**：我判为 `w/h`（wrap 边界）而非 `x/y`，依据是语料量纲自洽 + 兄弟指令槽位
   （`0x1C1` → `+36/+40`）＋ `sub_45EC60` 里 `v11[32] * v11[5]`（高 × pitch = 缓冲字节数）。
   **不是**逐字节反汇编推的 ⇒ 若实现里要写注释，请标注"由语料量纲 + 槽位复用推得"。
7. `sub_41BF50`（操作数读）/ `sub_42B4B0`（回写）只读到"类型分派"层（raw 26554-26598 / 36964-37089），
   未穷举全部 type 分支；对 `0x1d0` 只需要「op3 是 int（含池/立即数）+ op1/op2 可写 int」这一层。
8. `0x1d1` 的 `sub_4675A0` 1210 行**本轮未重读**（沿用前一轮 route-c 文档的结论，只复核了定义头 80312
   与它的第 7 实参 `Engine+84128` 的存在）；本票不依赖它。

---

## 10. 给主 agent 的一句话建议

`0x1d0` 已经是「读体闭环、零宿主缝、语料可证、E3 载体（`install/CONFIG.BIN`）实测存在」的状态
⇒ **建议 T-0095 按 implemented 落地**（不要降级 deferred）；同时把三个连带项一起修：
`0x71` 的 SetTB 门（用 `ENGINE_FIELD.textBaseGate`，别再用恒真的 `textSlotArg`）、
`0x70` 的 push + 组首标记、`0x85` 的清表（并订正它在 gaps 台账里的错误理由）。
