# T-0168 · ADV 滚轮上滚链：四项残留未验证项的查证结论

> 只读研究（2026-09-25，00:30–01:20 工作树快照）。**本文件是过程文档**：所有结论都带 `engine/天结_unpacked.exe_utf8.c`（下称 raw）行号或 `文件:行` 锚点；
> 凡未证实的都标 **候选**。中间产物（探针/日志/脚本）在 `.tmp/t0168-research/`（临时区，不作证据），关键数字都抄在本文里。

---

## 零、状态快照与本次查证的边界（★先读，否则 Q3 的结论会被误读）

1. **工作树当时正在被另一个 agent 改**：`tickets/T-0170`（`status: doing`，P1）正在实现 `0x1D1`，做法是 **红→绿**：
   `git status --porcelain` 当时显示 `M app/amayui-emulator/src/vm/{textItems.ts,engine.ts,handlers/msgwin.ts,…}`、`?? tickets/T-0170/`；
   `app/amayui-emulator/src/vm/handlers/msgwin.ts:2163` 那一行注册**被注释成** `// TEMP-RED-EVIDENCE [0x1d1, op_recall_page_repaint], …`（我实测到它**两次都读到注释态**，但 `probe-q4` 那一次运行期 `OPS` 里**有** `0x1d1`）。
   ⇒ 我的两次探针恰好落在两种状态：
   | 探针 | 运行期状态 | 结果 |
   |---|---|---|
   | `probe-q3.ts`（第 3 次运行 `probe-q3c.out.txt`） | `0x1d1` 未注册（红态） | 命中 1 次 ⇒ `NotImplementedOp` 硬停，打桩后继续；**唯一**未实现 opcode |
   | `probe-q4.ts` | `0x1d1` 已注册（绿态） | `0x1d1` 执行 **280** 次、全链**0 条**未实现 opcode |
   所以下文凡涉及 `0x1D1` 的"唯一/已实现/缺"必须带这个状态标注。**本文件不改任何代码/台账**（见 §四待办）。
2. 只读纪律：未 `git add`/`commit`/`stash`；未跑全量测试；未动 `changes.md`、`analysis/**`、`app/**`、`src/**`。
3. 复现命令（workdir = `app/amayui-emulator`）：
   ```powershell
   npx tsx ../../.tmp/t0168-research/probe-q4.ts    # 富状态链（先进 40 条文案再进 HISTORY），全量输出见 .tmp/t0168-research/probe-q4.out.txt
   npx tsx ../../.tmp/t0168-research/probe-q3.ts    # 短会话链（红态证据），.tmp/t0168-research/probe-q3c.out.txt
   npx tsx ../../.tmp/t0168-research/opcheck.ts     # 三张表注册情况 + 键码表条数
   node ../../.tmp/t0168-research/gapjoin.mjs <probe 输出>   # HISTORY 直方图 × 缺口台账对账
   node ../../.tmp/t0168-research/scan-wheelkey.mjs install data --max-mb 64   # 键名字面量字节扫描
   ```

---

## 一、结论速览

| 问题 | 结论 | 判定 |
|---|---|---|
| **(1) 谁写 `set:WheelKeyUp/Down`；随包默认 3/1 从哪来** | 默认值 = 引擎 `Reg` 构造函数 `sub_491880` **写死**（raw 111736-111739：`3` / `1`）；**唯一**的覆盖写者 = `Reg` vtable `+0x2C` 的 **ini 载入器 `sub_494220`**（读 `WHEELKEYUP=` 行，raw 112705-112718）。随包数据里没有这个键（字节扫描 1477 个文件只命中引擎自己的字符串池）；真机 `SYS4REG.INI` 里连 `[set]` 段都没有 ⇒ 真机跑的就是默认 3/1。**游戏内设置界面改不了它**（没有任何脚本通路：`src/**` 里 `set:` 字面串 0 命中，能写配置的 6 条 opcode 键名全是常量，键位类 opcode 只出现在 `SYSTEM4.txt`）。合法值**读端零校验**（只有 `v19 >= 0`），`i10c` 是 `>0x1F` 抛错。 | **证实** |
| **(2) `bit8 = PageUp`** | **证实，但机制不是"0xC9 是 VK"**：`0xC9` 是 **DirectInput 扫描码（DIK_PRIOR）**，引擎键码表 `sub_476AA0`（raw 91325-91423，**93 条**）把它映到 **`33 = VK_PRIOR = PageUp`**（raw 91413 `_this[1633] = 33;`）。`i10c 8 c9`（`src/SYSTEM4.txt:93`）经 `sub_4220B0` raw 30632 写 `Input[1176+33] = 8`；该表的两条消费者 = WM_KEYDOWN `sub_4B8DF0`（raw 140851-140862）与每帧轮询 `sub_4770A0`（raw 91551-91568）。emulator 的 93 条表逐条一致（含 `0xc9 → 33`）。 | **证实** |
| **(3) `0x1D1` 是否唯一缺口** | **证实（限定态）**：扩大链（记录表 6→72 条、页 18→24；进 HISTORY 后 4000 帧 + 周期喂输入；VM 45 步/帧、4000/4000 帧在跑）里**唯一的"未实现 opcode"就是 `0x1D1`**。但它**不等于"唯一缺口"**：同链还命中 7 条台账标 `partial` 的 opcode、2 条 engine-internal、2 类宿主静默丢弃；且 **`0x84`（`sub_41F790` 那一族）三张表都没有、缺口台账里也没条目**（语料 0 处）⇒ 命中即硬报错而台账看不见。 | **证实（带 4 条折扣，见 §二.3）** |
| **(4) 回想画面内的翻页/滚轮路径** | **证实**：ADV 等待泵里"翻页"**只**由 `1 << Conf(set:WheelKeyUp)` 这一位触发（raw 20343-20348；门 = `effect_flags & 0x40000000`），`set:WheelKeyDown` 位在翻页支**没有**单独判（raw 20355 走 else）；`0x84`（`sub_41F790`）**不读任何输入**，op1 本身就是方向（raw 28845/28855/28898/28908），语料 0 处。`HISTORY.BIN` 内部的翻页是**脚本自己**做的：`0x10D` 读滚轮 + `joy-callback` 位 + `0x100` 派发 → `0x1D0`（带符号步数读页表）→ `0x1D3`（取记录）→ `0x1D1`（重画那一条记录）。 | **证实** |

---

## 二、逐问详证

### 2.1 问题（1）：`set:WheelKeyUp/Down` 的写者、默认值、可否在游戏内修改、合法值

#### (a) 默认值的**唯一**出处 = `Reg` 构造函数（写死）
`sub_491880`（`engine/天结_unpacked.exe_utf8.c` raw 111337-111765，`//----- (00491880)`，`*(_DWORD*)_this = &Reg___vftable_` raw 111354）：

```c
111735:   v13 = 1;   sub_434D00(v2, aSetDependmovie, &v13);
111736:   v13 = 3;
111737:   sub_434D00(v2, aSetWheelkeyup, &v13);     // set:WheelKeyUp   = 3     ← 默认值
111738:   v13 = 1;
111739:   sub_434D00(v2, aSetWheelkeydow, &v13);    // set:WheelKeyDown = 1     ← 默认值
111740:   v13 = -1; sub_434D00(v2, aSetHwheelkeyup, &v13);   // 横滚默认 -1 = 不映射
111742:   v13 = -1; sub_434D00(v2, aSetHwheelkeydo, &v13);
```
- vtable 侧证据：`.lst:432688-432703`（`??_7Reg@@6B@` @ `0x5297DC`，`sub_491880+3B` 写它）⇒ 这两个键是**类构造期注册**的，不来自文件。
- 顺带：同批注册的 `set:HWheelKeyUp/Down` 默认 `-1`（= 不映射，见 raw 141605 `if (v19 >= 0)` 才置位）。

#### (b) 唯一的**覆盖写者** = ini 载入器（`Reg` vtable `+0x2C`）
`sub_494220`（raw 112318-112854）是 `Reg` 的第 12 个虚函数：`.lst:432701` = `.data:00529808  dd offset sub_494220`。它的 `WHEELKEYUP` 分支：

```c
112705:  else if ( !_stricmp(aWheelkeyup, v6) )          // v6 = ini 行的 KEY（大写名字）
112707:    v37 = (void *)atoi(v7);                        // v7 = 值（无范围校验）
112708:    sub_434D00((unsigned int *)_this + 1, aSetWheelkeyup, &v37);
112710:    sub_434D00((unsigned int *)_this + 1, aMessageWheelke, &v37);   // 同时写 message:WheelKeyUpOnTW
112712:  else if ( !_stricmp(aWheelkeydown, v6) ) { … aSetWheelkeydow / aMessageWheelke_0 … }
```
- 键名字面量：`"WHEELKEYUP"` = raw 5060（`aWheelkeyup`）、`"WHEELKEYDOWN"` = raw 5058；写出的两个**副键** = `"message:WheelKeyUpOnTW"`（raw 5059）/`"message:WheelKeyDownOnTW"`（raw 5057）。
- ini 路径由 `sub_4900F0`（raw 110505-110623）拼：`…\SYS4REG.INI` 或 `SYS3REG.INI`（常量 raw 4936-4937；选择点 raw 110612-110615）。
- **`aWheelkeyup`/`aWheelkeydown` 在整份反编译里只被引用 4 处**（raw 112705/112712/112719/112724，全是这个 `_stricmp` 链）⇒ 连"配置 dump 到 ini"的函数都没有引用它（写侧按名反射 dump 的候选 = `sub_492CB0` raw 111847-112317，实测它读的是 **Windows 注册表**，`aWheelkeyup` 0 引用；注册表实测也只有 `ExePath/WinPosLeft/WinPosTop`，命令 `reg query "HKCU\Software\Eushully" /s`）。

#### (c) 随包数据里到底有没有这个键（字节扫描）
脚本 `.tmp/t0168-research/scan-wheelkey.mjs`（ASCII `WHEELKEYUP` / `WheelKeyUp` / `WHEELKEYDOWN` / `WheelKeyDown` / `HWHEELKEYUP`，含 `\0` 变体）：

```
roots=install,data  maxMb=64  scanned=1477  skipped=12  hits=40
命中的文件只有两个：install\AGE_dump.exe（20 处，如 @0x128740 "message:WheelKeyUpOnTW..WHEELKEYUP..Depend"）
                    install\AGE_free.EXE（20 处，如 @0x128730 "WHEELKEYDOWN....message:WheelKeyUpOnTW..WHEELKEYUP"）
跳过（>64MB 的资源档案，逐个列出）：APPEND01/03/04/05.ALF、DATA1..DATA8.ALF
⇒ 没有任何 .INI/.BIN/数据表里出现这个键名；命中的两个 exe 是引擎自己的字符串池。
```
- 真机那份配置（基线目录，**不是** emulator 的 overlay 写目标 —— `src/host/instance.ts:51`）：
  `C:\Users\liaoh\AppData\Local\Eushully\揤寢偄僉儍僢僗儖儅僀僗僞乕\SYS4REG.INI`（959 B，mtime 2026-09-25 0:08）**没有 `[set]` 段、也没有 WheelKey**（读取 + grep 均 0 命中）。
  **候选（未证）**：这份是 AGE.EXE（真机）写的（同目录有它的 `Error.log`，头两行 `ARCGameEngine Ver 4.60B`），且它的 `[message]` 段有 `Font=Amayui CN` ⇒ 本工程的中文补丁真机跑过。
- emulator overlay 那份 2049 B 的 `SYS4REG.INI`（`.tmp/instances/wheel-a/overlay/SYS4REG.INI:111-114` = `WheelKeyUp=3 / WheelKeyDown=1 / HWheelKeyUp=-1 / HWheelKeyDown=-1`）**是 emulator 自己生成的全量键表**（`src/engineConfig.ts:136-156` 的 `renderIni` 按 `CONFIG_REGISTRY_KEYS` 全量输出，缺省取内建默认；emulator 的内建默认见 `src/configRegistry.ts:125-128` = 3/1/-1/-1，与 raw 111736-111743 逐值一致）⇒ **那不是"随包默认文件"**。

#### (d) 游戏内设置界面能不能改它 → **不能**（三条独立证据）
1. 能写配置注册表的 opcode 只有 6 条，键名全是**字面常量**（`analysis/opcodes.json` 里 `SetConfig(` 的全部命中）：`0x141 sub_4228C0`（message:MesWinAlpha）、`0x1B5 sub_41FED0`（message:MessageSpeed）、`0x2CD sub_426390`（message:AdvanceMesOnWheel）、`0x2E8 sub_4265E0`（message:AutoMessageOption）、`0x2ED sub_431230`（message:MessageFade）、`0x307 sub_426AE0`（system:EffectSkipOnClick）。**没有"按名写配置"的脚本指令**。
2. 反编译里 `Reg` 的 setter 槽（`+0x0C` = `sub_492AB0`）的 **29 个调用点**（`Select-String -Pattern '\) \+ 12\)\)\('`）全是字符串常量（`aSoundSe`/`aSetWinposleft`/`aDisplayScreenm`/… 例：raw 13562/21571/21575/21782/23581/91316），**没有一个把脚本操作数当键名**。
3. 语料侧：`src/**` 里 `set:` 字面串 **0 命中**；键位类指令（`i10c`×11 / `i107`×8 / `i10b` / `i30a` / `i0fe`）**只出现在 `src/SYSTEM4.txt`**（唯一其它命中是 `i10a` = 鼠标定位，5 处/脚本）⇒ 本作**没有"键位设置界面"脚本**，键位在启动脚本里硬写死。
- 结论：改它的**唯一**途径 = 手工在 `SYS4REG.INI` 的 `[set]` 段加 `WheelKeyUp=n`（下次启动被 `sub_494220` 读入）；emulator 侧对应 `app/amayui-emulator/src/arch/systemPaths.ts` 的 `INI_FILE` → 写者 `arch/nodeFileSource.ts:93` / IPC `write-config-ini`。

#### (e) 合法值范围与越界处理（读写两端的校验）
| 端 | 位置 | 校验 | 越界行为 |
|---|---|---|---|
| 读（WndProc） | raw 141563-141606（`case 0x20A` / `0x20E`） | **只有 `if (v19 >= 0)`** raw 141605 | 汇编 `.lst:004B9CAB js loc_4BA0C7`（只跳负数）+ `.lst:004B9CBE shl esi, cl`（**裸移位、无掩码**）+ `.lst:004B9CC0 or [edx+0AAB48h], esi`（= `Engine+699208`）⇒ 负数**什么都不做**（连累加器也不进：raw 141579-141583 的 `else` 只在模式关时走）；≥32 按 x86 语义 `count & 31` 回绕（候选：C 里 `1 << v19` 是 UB，实测汇编无钳位） |
| 写（ini 载入） | raw 112707 / 112714 | **无**（纯 `atoi`） | 任何 int 都写进 `set:WheelKeyUp` |
| `0x10C` SetKeyMulti | `sub_4220B0` raw 30617-30634（raw 30626-30631 抛） | op1 **unsigned** `> 0x1F` ⇒ `ShowMessage("SetKeyMultiの引数が不正です．")`（抛在写之前） | op2（键码）无校验，未列出的键码 ⇒ VK 0（不可观测） |
| `0x10B` SetKey | `sub_422070` raw 30608-30613 | `result <= 0x1F` 才写 `_this[op2+1383]` | 越界**静默不写** |
| `0x30A` SetGesKey | `sub_426B60`（raw 33819 处）| `op1>0x1F \|\| op2>7` ⇒ `ShowMessage` | 抛 |
- **emulator 侧偏差（真缺口，待办 §四.3）**：`src/vm/input.ts:500-512`（竖直）/`519-530`（水平）在 `bit >= 0 && bit < 32` **不成立时会落到累加器**（`wheelDelta += d`），而引擎那条 `else` 只在"没把滚轮当按键"时才走 ⇒ 引擎是"什么都不做"。现有守卫 `test/wheel-as-key.test.ts:94-102` 之所以过，是因为它连发 `+120` 与 `-120` 相互抵消（`WheelKeyUp=-1` 那次会漏进累加器），**换个断言就红**。

### 2.2 问题（2）：`bit8 = PageUp` 回引擎核对

#### (a) `0x10C` 的操作数语义（按体）
`sub_4220B0`（raw 30617-30634）：
```c
30623: _this[30 * _this[95776] + 95805] = 5;      // arity 槽 = 2*argc+1 ⇒ argc 2
30624: v2     = sub_41BF50(_this, 2);             // op2 = 键码
30625: result = sub_41BF50(_this, 1);             // op1 = 掩码位号
30626: if ( result > 0x1F ) throw ShowMessage("set-keymulti …");
30632: _this[_this[v2 + 1690] + 1434] = result;
```
`Input` 是 `Engine` 的内嵌对象（`sub_477DD0` raw 92374-92380 ⇒ `Engine[258]` = Input 的 vftable）⇒
`Engine[1690+k] ≡ Input[1432+k]`、`Engine[1434+VK] ≡ Input[1176+VK]`，于是 raw 30632 = **`Input[1176 + Input[1432+op2]] = op1`**。
⇒ **op1 = 掩码位号（不是 VK）；op2 = 引擎内部"键码"（查键码表得到 VK）**。

#### (b) 键码表本体 = **DirectInput 扫描码 → VK**（93 条，raw 91325-91423）
`sub_476AA0`（`//----- (00476AA0)` raw 91325-91423）是一串 `_this[1432+kc] = VK;`。逐条与 MSDN 的 scancode→VK 表吻合（例：`0x01→27 ESC`、`0x1C→13 RETURN`、`0x2A→16 SHIFT`、`0x2C→90 'Z'`、`0x39→32 SPACE`、`0x3B..0x44→112..121 F1..F10`、`0xC8→38 ↑`、`0xCB→37 ←`、`0xCD→39 →`、`0xD0→40 ↓`）。
- 实测统计（pwsh 数赋值）：**93 条**，最大下标 = `1653` ⇒ 键码最大 `0xDD`；emulator 的 `DEFAULT_KEYCODE_TO_VK` 也是 **93** 条（`opcheck.ts` 输出），逐条一致（连 `0xc7 → 18` 这个引擎自己的怪值都照抄）。
- ★**本题的关键一行**：raw 91413 `_this[1633] = 33;` ⇒ `1633 - 1432 = 201 = 0xC9` ⇒ **键码 `0xC9` → VK `33` = `VK_PRIOR` = PageUp**。
- 表的两侧初始化在构造体 `sub_477DD0`（raw 92373-92425）：raw 92381 `memset(_this+1176, 255, 0x400)`（256 个 VK→位全 `-1`）、raw 92382 `memset(_this+1432, 0, 0x400)`（256 个键码→VK 全 0）、raw 92386-92393 `SetKeyTotal=7` + 七条默认绑定键码 `200/205/208/203/28/57/14`（= `0xC8/0xCD/0xD0/0xCB/0x1C/0x39/0x0E`，与 emulator `input.ts:135` 的 `DEFAULT_BOUND_KEYCODES` 一致）、raw 92394-92400 那七条 `Input[1176+该VK] = 位`。

#### (c) VK→掩码位的两条消费者（题目问的"把 VK 转成 Input 下标"的地方）
```c
140851: sub_4B8DF0(_this, a2 /*= VK*/) {          // WM_KEYDOWN 路径
140858:   v3 = _this[a2 + 1434];                  // = Input[1176 + VK]
140859:   if ( v3 >= 0 ) result[1417] |= 1 << v3; // = Input[1159] |= 1<<位
140860: }
```
- 调用点：`case 0x100u`（WM_KEYDOWN）raw 141258-141272 → raw 141266 `sub_4B8DF0(dword_55E1BC, wParam)`。
- 轮询路径：`sub_4770A0`（raw 91551-91568）`v3 = _this + 1176;` 扫 `v2 = 0..255` 用 `GetAsyncKeyState(v2)`（参数就是 VK）⇒ `*a2 |= 1 << *v3`。
- 反向（键码→VK）消费者：`sub_477100`（raw 91572-91578）`GetAsyncKeyState(_this[a2 + 1432])`。
⇒ 两条路径都落在同一张 `Input[1176+VK]` 上，而 `0x10C` 写的就是这张表（经键码表折算）⇒ **`i10c 8 c9` ≡ "PageUp 置掩码 bit8"**，与 `src/SN0000.txt:94-114` 把 bit8 绑给 `label_00002f84 → call-script 31 // HISTORY` 完全自洽。

#### (d) 语料锚
`src/SYSTEM4.txt:86-97`：`i0fe c`（SetKeyTotal=12）后 11 条 `i10c`：`4 2c`、`4 1c`、`5 39`、`6 2e`、`6 1d`、`7 2d`、**`8 c9`（:93）**、`9 d1`、`a f`、`b 2a`、`b 36`。
- emulator 现状：`0x1D1` 之外，`0x10C`/`0x10B`/`0x100`/`0xFB` 都是 `OPS(implemented)`（`opcheck.ts` 输出），实现 = `handlers/input.ts:459-474` `op_set_key_multi` + `InputManager.setKeyBinding`（`input.ts:305-310`），守卫 `test/input.test.ts` / `test/keyboard-mask.test.ts`（台账 `opcode-gaps.json` 的 `0x10c` 处置 = `implemented`）。
- ★**顺带查出的另一条"静默跳过"**：`0x30A`（`SetGesKey`，`sub_426B60`，语料 `SYSTEM4.txt:110` 的 `i30a 6 5`）在 emulator 里是 `ENGINE_INTERNAL_OPS` 纯 no-op（`handlers/stubs.ts:261`）。引擎写的是 `Engine[5+1969] = 6`；我用 pwsh 在整份 .c 里搜 `1969]`/`+ 1969` **0 命中的读者** ⇒ "有据 no-op"成立（可作为该条 note 的补证）。

### 2.3 问题（3）：`0x1D1` 是否唯一缺口 —— 扩大复核 + 其余未建模/近似清单

#### (a) 怎么做扩大验证的
`probe-q4.ts`（在 `probe2.ts` 基础上改造：① 对**每一条执行过的指令**按表归类；② 统计**每帧实际执行步数**以区分"在跑"与"卡住"；③ 进 HISTORY 前**先推进 40 条文案**（让记录表/页表长起来）；④ 进 HISTORY 后 4000 帧 + 每 100 帧喂一次输入（滚轮上下、左键、回车）；⑤ 用 DropRecorder 差集区分"进 HISTORY 之后新增的宿主丢弃"）。帧循环设置：`gates = {anim:'wait', sleep:'wait', advance:'pump'}`，`advFrame = true`，`maxStepsPerFrame = 20000`。

实测（`.tmp/t0168-research/probe-q4.out.txt`）：
```
[advance] 推进后 records=64 pages=23 cursor=22
[snap C]  script=HISTORY.BIN ip=101 effectFlags=0x20000000 records=72 pages=24
[H] 之后 600 帧：有执行的帧数=600/600；每帧步数恒 45
[L] 长跑 4000 帧后：ip=101 有执行的帧数=4000/4000 桩种类 0->0 HISTORY opcode 种类=71
分类统计：implemented 629119 / native 12633 / engine-internal 3 / unknown 0 / user-stub 0
未实现/被桩掉的 opcode = []
0x1d1 x280 [implemented]        ← 绿态：脚本按行循环调用它 280 次
```
红态（`.tmp/t0168-research/probe-q3c.out.txt`，`0x1d1` 未注册）：
```
未实现/被桩掉的 opcode = [{"op":"0x1d1","count":1,"firstAt":"HISTORY.BIN:ip=945"}]
0x1d1 x2 [user-stub]
[H] 之后 600 帧：有执行的帧数=600/600（45 步/帧）⇒ 打桩后 VM 仍在跑，不是"卡住所以看不见别的"
```
⇒ **就"命中即 `NotImplementedOp`"这一类缺口而言，这条链上确实只有 `0x1D1`**；且我**先证伪了"卡在门里"这个可能**（600/600、4000/4000 帧都有 45 步执行）。

#### (b) 但"唯一缺口"有 4 条折扣
1. **`0x84`（`sub_41F790` 一族）三张表都没有、缺口台账里也没有条目**：`opcheck.ts` 输出 `0x084 … —— 四处皆无（命中即 NotImplementedOp）`；`analysis/opcode-gaps.json` 里按 `opcode == 132` 过滤 **0 条**（而 `counts.byDisposition.unimplemented = 0` 会让人以为"没有未实现指令"）。语料 **0 处**（`src/**` 里 `^i084 ` 0 命中），所以现在不会炸；但它与本题的"回看/翻页"同族（raw 28829-28942，写 `Engine[122454]` + `effect_flags |= 0x100000` + `sub_459770`），一旦某个版本/脚本用到就是硬停。**缺口台账里看不到它**这件事本身就是待办。
2. **同链命中 7 条台账标 `partial` 的 opcode**（= "已按语料级实现，但相对引擎体仍缺分支"，`gapjoin.mjs` 从 `opcode-gaps.json` 的 `missing[]` 取出）：

   | opcode | HISTORY 里执行次数 | 缺什么（摘要，raw 见括号） | 承接票 |
   |---|---|---|---|
   | `0x100` | 6349 | 引擎自己压返回点=本指令（无 +1）⇒ 一次执行沿掩码逐位派发；emulator 无"handler 返回后重跑本指令"闭环（raw 25038-25040） | T-0158 |
   | `0x8c` | 8810 | 同族 `0x8` 的深度越界门 `v4 >= 40`（raw 26843-26855）；label 越界在 emulator 抛错、引擎不校验（raw 29395-29399） | T-0156 |
   | `0xcd` | 5265 | 推进门槽只镜像成功那一步（raw 25838-25872） | T-0158 |
   | `0x101` | 2011 | 漏三条引擎写：清 `0x8000000`、`Engine[122370]=0`、`Engine[122367]=1`（raw 25077-25080） | T-0158 |
   | `0x71` | 285 | 队列冲刷 `sub_48FFB0`、`Engine[122496]=0`、`122455`/`0x8000000`（raw 28429-28457） | T-0151 |
   | `0x1f9` | 1 | `op3` 颜色被引擎消费（raw 31191-31244）；per-slot movie 播放器销毁未建模 | T-0153 |
   | `0x75` | 56 | 字号要同步写 3~5 格 + 重建 GDI HFONT 句柄（raw 24062-24070 / 70940-71273） | T-0151 |
3. **engine-internal 静默跳过 3 次**：`SYSTEM4.BIN:ip=11` → `0x324`（Effect3D 全销毁）、`SYSTEM4.BIN:ip=100` → `0x30A`（SetGesKey，见 §2.2(d)）、`SETWEATHER.BIN:ip=1` → `0x324`。三条都有据（no-op 对 VM 不可观测），列在这里是为了"清单完整"，不是缺陷。
4. **宿主静默丢弃（进 HISTORY 之后新增的部分）**：`sleep`（`0xc8`，帧让步，headless 的既有行为，+5265）、`setTextureObjectParam`（`0x1f9`，+1）、`unhandled i308`（`0x308` 输入触摸注册，+1）。**其余丢弃（`setLight`/`playMovie`/`releaseMovieSlots`/`setTextureObjectParam` 的另外 11 次）全发生在启动链，不在回想页**（差集法结论）。
5. **口径提醒（会让"次数"看错）**：`0x1D1` 在 HISTORY 里的**静态调用点只有 1 处**（`src/HISTORY.txt:1314`），但**运行期按行循环调用**——短会话（records=6）只 1 次，富会话（records=72）**280 次**。`tickets/T-0170/ticket.json` 的 why 与 `app/amayui-emulator/src/vm/textItems.ts:212` 都写着"`0x1D1` 只被它调 **1 次**" ⇒ 应改成"1 个调用点 / 每行一次"（否则实现容易只重画一次）。

#### (c) `0x1D1` 的语义：我独立复核了 T-0170 的订正（结论一致）
`changes.md` 与旧台账把它写成"回想页渲染器"。T-0170（doing）读体后订正为"**`0x82` 的孪生：GDI 重画窗 op1 的第 op2 条 72B 文本项记录**"。我按 raw 复核，**同意**：
```
0x82  sub_466000 (raw 79320-…)   体首：79499: v8 = (_this[3368]-_this[3364]) / 72;
                                      79502: if ( v8 > a3 && a3 >= 0 ) {
                                      79504:   if ( Font[4*a2+1044]+112 == 1 ) { sub_462040(...); return; }
0x1D1 sub_4675A0 (raw 80313-81522) 体首：80525: v9 = _this[3368]-_this[3364];
                                      80529: if ( v9 / 72 > a3 && a3 >= 0 ) {
                                      80531:   if ( Font[4*a2+1044]+112 == 1 ) return sub_4634B0(...);
```
同签名 `(int this, int, int, char, int, int, int**)`（raw 80313 / 79320），同门、同专用路径结构 ⇒ 是"重画一条记录"，**不需要**页/滚动/高亮模型（页由 `HISTORY.txt` 自己用 `i1d0`/`draw-texture` 组），且 `0x1D1` 之后脚本继续跑（绿态 280 次 + 4000 帧无其它异常）。

### 2.4 问题（4）：回想画面内的翻页/滚轮路径与 emulator 缺口

#### (a) 引擎里"回看翻页"有两个入口，都不经过 opcode 分派
1. **ADV 等待泵 `sub_411BC0` 的 ④ 支**（raw 20341-20363，门 = `effect_flags & 0x40000000`）：
```c
20343: v7 = Conf(set:WheelKeyUp);   v8 = (_DWORD *)(_this + 85296);   // 85296 = 文本对象（Font 区）
20345: if ( ((1 << v7) & *v2) != 0 ) {            // ★只有"上滚位"被单独判
20347:   sub_459770(v8, -1, 2);  *(_DWORD *)(_this + 489816) = -1;      // 页游标 −1、回看方向 −1
20350:   *(_DWORD *)(_this + 699204) |= 0x100000u;                      // "跳读中"
20351:   sub_411560((_DWORD *)_this, aCallbackTextBi);                  // CALLBACK_TEXT.BIN（本树 no-op）
20352:   *v2 = 0; goto LABEL_44; }
20355: if ( sub_459770(v8, 1, 2) ) { *(_DWORD *)(_this + 489816) = 1; … } // ★下滚位**没有**前置判（走 else）
20360: *(_DWORD *)(_this + 489816) = 0;
```
   上游门（raw 20315-20321）：`(mask & 0x20) == 0`（右键位不置）且"滚轮键命中且 `Engine[388220] >= 0` 且 `Conf(set:ReDrawTextOnKey) == 1`"才进这#块；否则走悬停分支。
   ⇒ **触发翻页的输入位 = `1 << Conf(set:WheelKeyUp)`（配的是掩码位号）**；"翻页"本身**不是 opcode**，是引擎直接调 `sub_459770`（回看页游标，raw 70575-70627：`a2>0` 前进/`a2<0` 后退/`a2==0` 游标复位到 `Font[859]`，`a3=2` = 过滤 flags bit1）。
2. **脚本 opcode `0x84`（`sub_41F790` raw 28829-28942，argc 1）**：**不读输入掩码**，op1 就是方向（`<0` 后退 / `0` 快进到底 / `>0` 前进），同一 `sub_459770` 原语 + `Engine[122454]` 状态机 + `effect_flags |= 0x100000`（raw 28845-28916）。语料 **0 处**。
3. **`HISTORY.BIN`（回想画面）内部的翻页不走上面两条**，完全是脚本自己的：`read-mouse-wheel (local 90)`（`0x10D`，`HISTORY.txt:300/321`）+ `joy-callback` 注册的键位（`:322-331`：位 8 → `label_00002774`、位 9 → `label_00002794`，两者都汇进 `label_000027bc`，`:650-701`）⇒ 把方向写成 `local 48e = ±1` ⇒ `call label_00003798` ⇒ `lookup-array` 取该页步数写 `local 9a`（`:757-761`）⇒ **`i1d0`（`0x1D0`，带符号步数读页表）→ `i1d3`（`0x1D3` 取记录）→ `i1d1`（`0x1D1` 重画那一条记录，`:1311-1314`）**。

#### (b) emulator 现状与缺口清单（回想页/翻页相关）
| # | 现象 | 引擎锚点 | emulator 现状 |
|---|---|---|---|
| 1 | 回想页每行正文不出现 | `0x1D1` → `sub_4675A0` raw 80313-81522（记录门 raw 80529） | **缺**（`opcheck.ts`：四处皆无）。T-0170 正在实现；工作树里已有 `handlers/msgwin.ts` 的 `op_recall_page_repaint` 与 `operandPlan.ts:353 declarePlan(0x1d1, …)`，但 `msgwin.ts:2163` 的注册行**当时被注释**（红态证据）⇒ 我实测到红/绿两种状态 |
| 2 | 回看页游标回卷（ADV） | 泵 raw 20341-20363 + `sub_459770` raw 70575-70627 | **已实现**：`src/vm/engine.ts:1433-1455` `#textRewindWheel`（写 `ENGINE_FIELD.textRewind`(122454, 字节 489816) + `0x100000` + 消费输入），入口门 = `#advInputDropped`（`engine.ts:1371-1381`）；探针实测：清掉路由位后 `cursor 17→16`、`489816=-1`、`0x100000` 置位（`probe3.out.txt`） |
| 3 | `sub_411560(Engine,"CALLBACK_TEXT.BIN")` | 泵 raw 20351 / `0x84` raw 28852/28905 | **有意不建模**（`engine.ts:1421-1429` 已声明 + 重开条件）；本树资源索引里无此名 ⇒ 真机同为 no-op（`changes.md` §五 三步实测） |
| 4 | `0x84` 文本回调状态机 | raw 28829-28942 | **缺且未登记**（见 §2.3(b)#1；语料 0 处） |
| 5 | `0x1D0`/`0x1D3`（取页/取记录） | `sub_42D440` raw 38098-38110 / `sub_42D4A0` raw 38096-38113 | **已实现**（`handlers/text-items.ts:189/191`；T-0095）；台账注：`0x1D3` 的 op3 是引擎"死读"、`0x1D0` 的失败路径写 `-1/-1` |
| 6 | `0x1D1` 落到"窗对象 `+112 == 1`"的专用路径 | raw 80531-80532（0x82 那条是 `sub_462040`） | **缺窗对象模型**（`Font[4*win+1044]`；全库 grep 无对应结构）⇒ 要么建模、要么在 `missing[]` 如实登记（T-0170 的判据里已写"未建模就如实登记"） |
| 7 | 记录 `+44` 正文串（重画的数据源） | raw 80736-80745 / 81022-81036 | T-0170 已在工作树给 `textItems.ts` 加 `ITEM_ROW_TEXT`/`record.text`/`RecallRepaint`（`textItems.ts:68-130,169-230`）⇒ 这部分**正在补齐** |
| 8 | 记录重排掩码 bit1 / 清表 | `0x1D0` 末参常量 2、`0x85` | 已按 T-0095 落地（`text-items.ts` 的 `ITEM_REFLOW` 等） |
| 9 | 滚轮在 HISTORY 里的一次消费 | `0x10D` `sub_42EF50` raw 39114-39122 | **已实现**（`handlers/input.ts` `op_read_mouse_wheel`）；`HISTORY.txt:300-302` 用 `ne … 0` 判"这一轮有没有滚" |
- 台账侧归属：`analysis/engine-capabilities.json` 的 `msgwin-backlog-cursor`（`partial`，`emulator.guard = test/msgwin-backlog-wheel.test.ts`）已经承载了 §(a)1/(b)2 的结论，且 note 里已写明"重开条件"。**但它把 `0x1D1` 仍写作"回想页渲染器"** ⇒ 与 T-0170 的订正不一致（待办 §四.1）。

---

## 三、与 `changes.md` / 既有台账不一致的旧说法（订正清单）

| # | 旧说法（出处） | 新证据 | 处置建议 |
|---|---|---|---|
| 1 | "`0x1D1` = **回想页渲染器** `sub_4675A0`"（`changes.md:14/25`、`CONTEXT.md:42`、`engine-capabilities.json` 的 `msgwin-backlog-cursor` note、`opcode-gaps.json` 的 `0x1d1` note） | raw 79499-79508（0x82）与 raw 80525-80532（0x1D1）**逐句同形**：记录条数门 + 窗对象 `+112` 专用路径 ⇒ 是"重画窗 op1 的第 op2 条 72B 记录"（T-0170 的订正，我独立复核同意）。回想页的页/滚动/高亮全在 `HISTORY.txt`（`i1d0`/`draw-texture`） | 改措辞为"回看页**单条记录重绘**（0x82 的孪生）"；`0x1D1` 的语义/卡点重写（T-0170 acceptance 已要求） |
| 2 | "bit8 = PageUp 只依 emulator 的键码→VK 表（**未回引擎核对**）"（`changes.md:33`、`CONTEXT.md:165`） | raw 91413 `_this[1633] = 33`（键码 `0xC9` → `VK_PRIOR`）；93 条表 + 两条消费者（raw 140851-140862 / 91551-91568） | **该未验证项可销**；余下的只是"`0xC9` 是 DIK 扫描码而非 VK"这个口径要写清 |
| 3 | "谁写 `set:WheelKeyUp/Down`（`src` 里 0 命中，键位设置界面回写路径未追）"（`changes.md:32`） | §2.1：默认 = `sub_491880` raw 111736-111739；覆盖 = `sub_494220` raw 112705-112718；游戏内**无**写者 | **该未验证项可销**；结论落 `docs-new/03-engine/input-system.md` + capability note |
| 4 | "`0x1D1` 是否唯一缺口（只证 4000 帧内唯一未实现 opcode）"（`changes.md:34`） | §2.3：扩大链（records 72 / 4000 帧 / 周期输入）仍成立，但"缺口"清单要加 `0x84`、7 条 `partial`、2 条 engine-internal、2 类宿主丢弃；且"`0x1D1` 只调 1 次"是短会话假象 | 按 §2.3 的表补进 note/单据 |
| 5 | `app/amayui-emulator/src/vm/engine.ts:1427` "**真机上滚轮回看会弹出「回想/回看」画面**，emulator 里只回拨游标" | 同一台账 `msgwin-backlog-cursor` 的 note 自己写着"`sub_411560` 那一跳在真机上也是 no-op（本机索引无 CALLBACK_TEXT.BIN）" ⇒ 自相矛盾 | 措辞改为"引擎那一跳在本树是 no-op（`changes.md` §五）；画面要出现只能靠路由键 ① 派发 `call-script 31`" |
| 6 | `app/amayui-emulator/src/vm/handlers/input.ts:440-441` "本条的两处写入在 emulator 里**仍然零消费者**…越界实参被静默吞掉" | 同文件 `input.ts:305-327`（`setKeyBinding` 写运行期 `vkToBit`、`pressKey` 查运行期表）已是 T-0163 后的修好态 | 该段虽是"修前"叙述，但时态容易被误读 ⇒ 句首加"（修前）" |
| 7 | `tickets/T-0170/ticket.json` why 与 `textItems.ts:212`："`0x1D1` 只被它调 **1 次**" | 探针：同一会话 `0x1D1` 执行 **280** 次（records=72）；短会话才 1 次 | 改成"1 个静态调用点、按行循环调用" |
| 8 | `opcode-gaps.json` 的 `0x1d1` 处置仍 `deferred`、理由仍是"需要页模型/记录文本/窗对象模型" | 工作树已有 T-0170 的 handler 与记录文本模型（`textItems.ts` 的 `ITEM_ROW_TEXT`/`text`/`RecallRepaint`） | T-0170 结算时改处置（其 acceptance 已写"该文件归主 agent 结算"） |

---

## 四、待办清单（**本 agent 未改任何代码/台账**，请主 agent 分派）

1. **`analysis/opcode-gaps.json`（主 agent owner）· `0x1D1`**：等 T-0170 结算后把 `deferred` → `implemented`（或 `partial` + `missing[]` 列出"窗对象 `+112` 专用路径 `sub_4634B0` raw 77500-78716 未建模"），并把 note 里"回想页渲染器/需要页模型"整段按 §三.1 重写（保留字串 `回看页重绘` / `sub_4675A0` / `raw 80312-81522` 以喂既有守卫）。
2. **`analysis/opcode-gaps.json` · 新增 `0x84` 条目**（当前 **0 条**，而 `counts.byDisposition.unimplemented = 0` 掩盖了它）：`sub_41F790` raw 28829-28942、语料 0 处、emulator 三表皆无 ⇒ 建议 `deferred` + `why`（"语料 0 处；与回看泵同族，`functions.json` 里状态是 PARTIAL"）。
3. **`app/amayui-emulator/src/vm/input.ts`（唯一滚轮输入写者）· 越界位号的行为分叉**（§2.1(e)）：`addWheel`/`addHWheel` 在 `bit < 0 || bit >= 32` 时应像引擎一样**什么都不做并 return**，现在会落到累加器。修 `input.ts:500-512` / `519-530`；守卫改 `app/amayui-emulator/test/wheel-as-key.test.ts#⑤`（现断言靠 `+120/-120` 抵消才过）。← **这是本次唯一发现的"代码级"缺口，建议单开一张 P2/P3 票。**
4. **`app/amayui-emulator/src/vm/engine.ts:1427` 注释**（§三.5）与 **`handlers/input.ts:440-441` 时态**（§三.6）：纯措辞。
5. **`tickets/T-0170/ticket.json` 与 `src/vm/textItems.ts:212` 的"只调 1 次"**（§三.7）：改成"1 个静态调用点 / 按行调用（实测 280 次）"。
6. **`docs-new/03-engine/input-system.md`（§15 附近）**：补 Q1 的结论（默认 3/1 = `sub_491880` raw 111736-111739；唯一覆盖写者 = ini 载入器 raw 112705-112718；游戏内无写者；读端零上界校验 + `.lst:004B9CAB/004B9CBE`）与 Q2 的口径（键码 = DIK 扫描码，`0xC9→VK 33 = PageUp`，raw 91413）。
7. **`analysis/engine-capabilities.json` 的 `msgwin-backlog-cursor`**：`0x1D1` 的措辞（§三.1）、把 §2.4(b) 的缺口清单（窗对象模型 / `0x84`）补进 `note`，并（若要）新增一条"ADV 回看泵滚轮键→页游标"的独立能力条目（trigger 写清门 = `effect_flags & 0x40000000` + `Engine[388220] >= 0` + `set:ReDrawTextOnKey == 1` + `mask & 0x20 == 0`）。
8. **（可选）键位设置界面的存在性**：本作 `src/**` 里没有任何键位设置脚本、也没有"按名写配置"的 opcode ⇒ 若产品/用户手册声称"可改滚轮键"，那是**配置 ini 层**的能力，不是游戏内 UI。建议写进用户可见说明。

---

## 五、本次产出的脚本与日志（均在 `.tmp/t0168-research/`，临时区、**不作证据**）

| 文件 | 用途 |
|---|---|
| `probe-q3.ts` / `probe-q3c.out.txt` | 短会话链（红态）：`0x1D1` 打桩/唯一未实现 opcode 证据 |
| `probe-q4.ts` / `probe-q4.out.txt` | 富状态链（records=72）：绿态 280 次 `0x1D1`、0 未实现、`partial` 清单、宿主丢弃差集 |
| `opcheck.ts` / `opcheck*.out.txt` | 任意 opcode 在 `OPS`/`NATIVE_OPS`/`ENGINE_INTERNAL_OPS` 的注册情况；键码表 93 条 / `0xc9→33` |
| `gapjoin.mjs` / `gapjoin*.out.txt` | HISTORY 执行直方图 × `analysis/opcode-gaps.json` 的 `missing[]` 对账 |
| `scan-wheelkey.mjs` / `scan-install-data.out.txt` | `WHEELKEYUP` 等键名的字节扫描（install/ + data/，逐个报跳过的大 `.ALF`） |
| `funcidx.ps1` | 在 `engine/*.c` 里建 `sub_XXXXXX → raw 行号` 索引（本次定位函数体用） |
