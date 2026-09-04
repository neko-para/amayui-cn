# 04 · 启动链分析与 opcode 清点

> **本文档是「无界面跑到 TITLE.txt」这一里程碑的实证基础。** 说清：
> ① 启动链是什么（哪个脚本是入口、如何一路 call-script 到 TITLE）；
> ② 第一里程碑真正需要的 opcode 面（已实测统计）；
> ③ 进入 M2 时的逐条分类清单（VM 核心 vs 子系统可 stub vs 待深挖）。

---

## 1. 启动链：入口脚本与到 TITLE 的路径

### 1.1 引擎如何在解释器层启动（✅ 已确认，2026-xx 研究解开）

`engine/engine.cpp` 约 140720–140809（WinMain 内，装载后进入主循环）：
```
loadScriptFrame_40ED40(dword_55E1BC, v52, hWnd, 0)  == 1   // 装载首个脚本帧 (raw .c 142341)
  └─> dword_55E1BC->interpreterMainLoop_412290()          // 进入解释器主循环(__noreturn)
```
- `dword_55E1BC` = 引擎对象（`this`）。
- **`sub_40ED40(engine, a2, a3, a4)` 的真实参数（已确认）**：
  - `a1` = engine；`a3` = hWnd（透传给 `sub_4559C0`）；**`a4` = 脚本索引**；**`a2` = 未使用**（函数体内无 `a2` 引用；WinMain 的 `v52` 因此为 "possibly undefined" 残留）。
- **`a4`（脚本索引）的解析**：`sub_40ED40` 内 `sub_4559C0(engine+680092, hWnd, index, &size)` 在 **归档对象 `engine+680092`** 里把 index 解析成文件，再 `sub_455560` 打开并 `ReadFile` 读 BIN、初始化帧。归档对象由更早的 `sub_414AC0(engine, 0, "SYS4INI.BIN")` 装载。
- **首脚本 = SYS4INI 索引 0 = `SYSTEM4.BIN`（✅ 已确认）**：WinMain 首帧 `a4=0`，实测 `raw/SYS4INI.BIN` 文件表 `names[0] = "SYSTEM4.BIN"`（用 `scripts/annotate-call-script.js` 同款解析复算）。`index 0 = SYSTEM4.BIN`、`0x5261=INIT2`、`0x5262=LOGO`、`0x5263=INIT`、`0x5264=TITLE`、`0x5265=ALLMAP` 等已逐项核对（`call-script` 字面量为十六进制，如 `5264`=0x5264=21092）。

**结论（ADR-002 落地）**：模拟器启动 = **构造引擎态 → 解析索引 0 = SYSTEM4.BIN → 装载为 frame[0] → 进入主循环**。整个原生 WinMain（互斥/COM/窗口类/建窗/线程错误模式/comctl32）都被绕过。

> ⚠️ 普通 `call-script`（`sub_41C6A0`，见 `engine.cpp` 26548）也是同一机制：`readIntOperand(1)` 读出目标索引（如 `0x5264`=TITLE），`cur` 压栈后调 `sub_40ED40(engine, (ip-strtable)>>2, hwnd, 目标索引)`。

### 1.2 入口脚本与 TITLE 的调用链（已确认，来自脚本级分析）

`docs/re/src/01` 的入口根：**`SYSTEM4`**（主调度）、`TITLE→GAMESTART`、`$n$AUTORUN`（追加包）等。**`SYSTEM4` 是主入口**，不被任何脚本调用。

实测 `src/SYSTEM4.txt` 的 `call-script` 序列（前 150 行，index 已由 `annotate-call-script.js` 标成文件名）：
```
73  call-script 5258 // LOADCONFIG
74  call-script 51c3 // LOADCHARM
78  call-script 51dc // INITCONFIG
79  call-script 51c8 // INITCHARM
84  call-script 51db // CHECKCONFIG
124 call-script 5261 // INIT2
146 call-script 5262 // LOGO
149 call-script 5263 // INIT
150 call-script 5264 // TITLE   ← 第一里程碑目标点
...
239 call-script 3a   // SETCHARM
298 call-script (global-int 1394)
413 call-script 51e5 // SETFATE
429 call-script 5265 // ALLMAP
...
```
→ **到 TITLE 的路径**：`SYSTEM4` 做一段初始化（第 1–123 行，涉及大量 `uXXXX` 子系统/UI 调用 + 少量 VM 核心指令），然后 `call-script INIT2/LOGO/INIT`（各自返回后回到 SYSTEM4），最后 `call-script 5264 TITLE`（第 150 行）。

### 1.3 TITLE 入口（src/TITLE.txt 前 40 行）
```
copy-local-array (local-int ...) [...] x5   ; 初始化若干局部数组
mov (local-int 0) 5
play-sound-effect 39a3 1                    ; stub
play-bgm 1f                                 ; stub
call label_00001fc0 / label_000021a4 / label_00002b0c
label_00000154
play-sound-effect 39a3 2
mov (local-int 3fc..) ...                   ; 置状态
call label_00003340
u00415EC0 (local-int 404) (local-int 405)
joy_callback 0..c label_...                 ; 注册回调(子系统, stub)
mouse_callback 10 label_...                 ; 子系统, stub
label_0000039c
get-input-type                             ; 子系统, stub
eq (local-int 40d) (local-int 3fc) 1
jcc ...
sleep 1
jmp label_0000039c
```
→ TITLE 主循环是一个 `get-input-type` → 比较 → `jcc` → `sleep` → `jmp` 的轮询（等待玩家输入选择）。**无界面时 `get-input-type` stub 返回固定值即可让该循环运转**。

---

## 2. 第一里程碑的实际 opcode 面（已实测统计）

对「`SYSTEM4` 前 150 行 + `TITLE` 全量」去重共 **约 203 种指令 token**（含 label 与头部声明）。其中真正的**指令**（非 label/头）分两类：

### 2.1 具名（语义可读）指令 —— VM 核心为主
```
mov add sub mul div mod and or
eq ne lt gr gre
jmp call ret call-script
lookup-array copy-local-array
set-string set-texture set-font draw-texture string-lookup-set
play-sound-effect play-bgm sleep get-input-type
joy_callback mouse_callback
bit-set bit-reset check-bit
comment dev_ukn exit
```
> 这些是「已知语义」的，多数属 VM 核心，少数属子系统（`play-*`、`draw-texture`、`set-texture`、`set-font`、`get-input-type`、`*_callback`、`sleep`）。
> 需注意**具名 ≠ 一定 VM 核心**：`draw-texture`/`set-texture`/`set-font`/`play-*`/`*_callback`/`get-input-type` 是子系统，应走 `NativeBridge` stub。

### 2.2 未具名 `uXXXX` 指令 —— 需逐条分类（主战场）
约 **55–60 个不同的 `u0041xxxx`**，例如：
```
u00414EC0 u00415130 u00415A10 u00415A60 u00415BF0 u00415E70 u00415EC0 u00415F40
u00416170 u00416200 u00416270 u004162F0 u00417E80
u0041A750 u0041A7B0 u0041AB30 u0041AC30 u0041AC60 u0041ACB0 u0041AD00 u0041AD30
u0041B290 u0041B3D0 u0041B510 u0041B580 u0041B820 u0041B9B0 u0041D050
u0041E360 u0041E500 u0041E5A0 u0041E5E0 u0041E690 u0041E940 u0041F9C0 u0041FCE0
u00420270 u00420480 u00420770 u00420880 u00420950 u00420BF0 u00421090 u004210D0
u004213E0 u00422460 u00422E80 u00422EA0 u00423000 u00423100 u00423123 u00423126
u00423127 u004234E0 u004235C0 u004244D0 u00427C00 u00427FD0 u00428010
u0042B5F0 u0042B990 u0042CEB0 u0042CEC0
u0043AA20 u0043AA40 u0043AA50 u0043AA60 u0043AAD0 u0043AB11
```
（不含 label；这是「SYSTEM4 前 150 + TITLE」一阶并集。实际由于 INIT/LOGO/CONFIG 等被 `call-script` 的子脚本也会带入更多，**真正到 TITLE 需覆盖的 `uXXXX` 会更多**——M0/M1 阶段建议先跑通 SYSTEM4 本体，再随 call-script 递归展开。）

> **关键认知**：大量 `uXXXX` 在 SYSTEM4 前 150 行里出现的，是**窗口/UI/贴图/字体初始化类**（如 `u0041A750`/`u0041A7B0` 每组 8 个连续调用、见下面「判别线索」）。它们对 **VM 状态无影响**，可 stub。真正需要精确实现的，是那些**影响控制流或 VM 状态**的少数 `uXXXX`。

---

## 3. 如何判定一个 `uXXXX` 属于哪一类（判别方法）

依据 `docs/re/engine/06`：每个 opcode 在本引擎都有 handler 地址（`sub_XXXXXX`）。判定方法：

1. 用 `docs/re/engine/06-opcode到handler映射表.md` 把 `uXXXX`（age-shared 名）→ 本引擎 `sub_XXXXXX`；
2. 读 `engine/engine.cpp` 中该 handler 体，判断其**副作用**：
   - **只读写 VM 状态**（全局/局部 int/float/string/ptr、帧、IP、cur）→ **VM 核心**。
   - **调到子系统/系统调用**（绘制/音频/字体/窗口/回调注册/文件/registry）→ **子系统**，可 stub。
   - **同时涉两/不清** → 标「待深挖」。

**几个可快速归类的高线索**（来自 age-shared 具名表 + 计数特征）：
- `u0041A750`/`u0041A7B0`：在 SYSTEM4 里每组 8 个连续、参数形如 `(x y w h)` → 疑似 **Windows 控件/面板/布局**，子系统。
- `u0041AD30`：形如 `(id x y w h)` → 疑似控件/贴图放置，子系统。
- `u0041AB30`/`u0041AC30/AC60/ACB0`/`u0041AD00`：连续小参 → 子系统（输入/界面）。
- `u00421090`/`u004210D0`/`u00423123`：参数形如 `(global-int 197d0)`（内存/表地址）→ 需细看，可能 VS 状态或数据表初始化。
- 高频出现在 TITLE 的 `u0042B990`/`u00427FD0`/`u00420950`/`u00420270` etc.：需逐条读 handler。

> ⚠️ **诚实提醒**：上述「线索」是**推测性的启发式**，不是定论。判定必须**以 handler 体为准**（M2 的核心工作）。文档只提供「先按哪些方向分」。

---

## 4. 到 TITLE 所需的口径（供 M3 收敛）

**第一里程碑「到 TITLE」的三种达成层次**（与 `03` 一致）：
- **D1**：构造 Engine → 装载 SYSTEM4.BIN → 主循环 → 执行到 `call-script 5264`，装载 TITLE.BIN 并切入其首条指令，**无一 opcode 硬报错**。
- **D2**：TITLE 内能执行首段纯 VM 指令（`copy-local-array`/`mov`/stub 的 `play-sound-effect`/`call label`），推进 IP 到首个 UI 强依赖点。
- **D3**：TITLE 主循环（`get-input-type`/`eq`/`jcc`/`sleep`/`jmp`）在无输入下运转若干轮不崩。

**要实现 D1 的关键缺口**：
1. `loadScriptFrame_40ED40` 的 `v52`（首脚本 id）来源 —— 待确认。
2. SYSTEM4 第 1–123 行的**全部 opcode 分类**（尤其那些影响链路的）。
3. `call-script` 装载的 BIN 文件路径解析口径（松散 `raw-parts`/`raw` vs 归档 `SYS4INI.BIN`）—— 见 ADR-008。

---

## 5. 已知 / 待办清单

### ✅ 已确认
- 入口根是 `SYSTEM4`，`call-script 5264 // TITLE` 在 SYSTEM4 第 150 行。
- 到 TITLE 路径 = SYSTEM4 前段初始化 → `INIT2/LOGO/INIT` → `TITLE`。
- 第一里程碑实际 opcode 面：**具名约 35 种 + `uXXXX` 约 55–60 种**（SYSTEM4 前 150 + TITLE 一阶并集）。
- 无界面下可强依赖 `NativeBridge` stub + `get-input-type` 返回固定值。

### ⏳ 待办（进入 M1/M2 前应补）
- [x] 确认 `loadScriptFrame_40ED40` 首脚本 id（`v52`）来源 —— **已解**：`a2`(v52) 未使用；真实首脚本由 `a4=0`（SYS4INI 索引 0 = `SYSTEM4.BIN`）决定 → 见 §1.1。
- [ ] 建立 BIN 读取器，并用 `src/SYSTEM4.txt` / `src/TITLE.txt` 做逐条黄金对照（M0）。
- [ ] 把启动链 opcode 全量导出成清单表（M2），逐条标分类。
- [ ] 复核 `call-script` index→文件路径 口径：**已确认**（`names[index]`，index 为十六进制字面量解释；`0x5264`→`TITLE.BIN` 等）→ 见 §1.1。
