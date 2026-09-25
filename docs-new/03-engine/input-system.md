---
kind: narrative
state: live
---
# 鼠标/输入系统机制记录（已收敛）

> 本文档是《天結いキャッスルマイスター》引擎**输入子系统**的权威机制记录（反编译自 `engine/天结_unpacked.exe_utf8.c`，
> 模块基址 0x400000，引擎单例 `this`，**字节偏移**；`_this[N]` 为 **DWORD 下标**，换算 `N×4 = 字节偏移`）。
> 覆盖：输入位掩码语义、两次"设备刷子"、各设备轮询、回调注册模型（`mouse-callback`/`joy-callback`）、
> 输入派发子程序（`get-input-type`/`poll-input`）、鼠标位置/按钮读取指令、按键绑定指令、光标外观，以及 TITLE 等脚本的实际用法。
>
> 依赖与范围：`../03-engine/opcode-table.md`（opcode→handler 全表）、`runtime-memory.md`（this 布局）、
> `../04-app/emulator-copyright-effect.md`（渲染/驱动链）。**不带输入/光标的 emulator 现状见 §11。**

---

## 0. 结论摘要（TL;DR）

1. 输入状态统一汇集在一个 **32 位掩码**：主引擎 `_this[174802]`（字节 699208）。每位＝一个"按钮/输入态"；脚本用 `(1<<bit) & value` 判按下。
2. 掩码由**两种"刷子"**写入，用途不同：
   - `sub_4780D0`（帧循环、`sub_411900` 用）：**实时读**键盘+鼠标+手柄，每次覆盖/累加当前按住态。
   - `sub_478090`（VM 指令 `/ 消息推进` 用）：**吸取**累计/挂起事件（键按下、手柄按钮、POV/摇杆、鼠标），读后即清。
3. 鼠标按钮在**输入掩码**里占 **bit4=左 / bit5=右**（随 SM_SWAPBUTTON 互换）；而**鼠标按钮值读取指令（0x108）**走另一约定，把左/右放到 **bit0/bit1**。两者勿混。
4. 鼠标**位置**由 `GetCursorPos + ScreenToClient` 读成窗口客户区坐标，再经虚拟显示映射 `sub_403500` 换算；**0x109** 读 X/Y 到 op1/op2，**0x108** 读按钮态到 op1。
5. `mouse-callback`(0xCC) / `joy-callback`(0xFB) **不是 hook 函数指针**，而是给"某个输入槽"记一个**脚本跳转目标**（label）。鼠标走 `_this[107664]` + 节流对象 `_this+107447`；手柄走 `_this[33*cur+107725+btn]`。按下匹配时把当前脚本 IP 跳到该 label。
6. `get-input-type`(0xCD) 是**消息/ADV 的"点击推进"门**：按 `timeGetTime()` 节流；若注册过鼠标跳转目标（`_this[107664]≠-1`）则把脚本设到 `4*_this[107664]` 偏移处（即跳到 label），无则回退不跳。**它不"返回输入类型"**（旧描述不准确）。
7. `poll-input`(0x101) 做 `sub_478090` 刷掩码 → 清 `_this[174801]&0x8000000`、`_this[174802]=0`、`_this[122367]=1`、`_this[122370]=0`。脚本用它"空耗一帧"并把挂起输入转交给下一条逻辑。
8. **手柄 POV/摇杆方向**映射为输入掩码 bit1/2/4/8（上/右/下/左），由 `sub_4774F0` 维护**按下保持态** `_this[4*dev+4640]`（bitmask 记忆四向，边沿只在"新按下"那帧置入掩码）。
9. **按键绑定**通过 `0xFE`(SetKeyTotal→`_this[517]`)、`0x107`/`0x10B`/`0x10C`(SetKey 类→映射表)、`0x30A`(SetGesKey→`_this[op2+1969]`) 配置；键码→bit 映射主表在输入管理器 `_this[1176+键码]`（`sub_477DD0` 初始化，`GetAsyncKeyState` 轮询用它）。
10. 光标外观/坐标属**渲染子系统**（`SetCursor`/`ShowCursor`/`SetCursorPos`），不在脚本指令语义内。

---

## 1. 术语

| 术语 | 含义 |
|---|---|
| `_this[174802]` | 主引擎**输入状态位掩码**（byte 699208）。每位=一个输入态；`poll-input`/帧循环读取后**复位为 0**。 |
| `_this[174801]` | 主引擎 **effect_flags**（byte 699204）。含输入分发相关位：`0x8000000`（消息/ADV 激活，多数输入处理以此 gating）、`0x400`（动画等待门）、`0x2000`(movie)、`0x40`/`0x10`(消息跳读/取消) 等。 |
| 输入管理器对象 | 基址 `_this + 258`（主引擎 DWORD 下标 258=字节 1032）。所有设备轮询、按键表、手柄表都在它身上。`sub_477DD0` 构造。 |
| `_this[1157]` | 输入管理器内 1 个 flag：置位时刷掩码强制 `|= 0x40`（"确定/默认键"等）。 |
| `_this[1158]` | 输入管理器内 **手柄按钮挂起位**（bit 掩码，`sub_477280` 逐个消费后置 0）。 |
| `_this[1159]` | 输入管理器内 **键按挂起累加器**（`sub_477130` 消费后置 0）。 |
| `_this[1688]` | 输入管理器内 **键盘/鼠标轮询开关**（`sub_477080` 置）。为 1 才跑 `GetAsyncKeyState` 轮询。 |
| `_this[517]` | 主引擎 **SetKeyTotal**（`0xFE` 写）——"当前配置了多少个键/输入位"，也是消息跳读扫描的上限。 |
| `_this[107664]` | 鼠标回调的**跳转目标**（`mouse-callback` 的 op2）。`_this[430656]`（字节偏移）= 同一字段。 |
| `_this[107453]` | 鼠标回调节流对象的"槽/率"字段（`mouse-callback` 的 op1）。 |
| `_this[33*cur+107725+btn]` | 手柄回调映射表（`joy-callback` 的 op2），按下 btn 时跳到该 label。 |

> 注意区分两个 `_this` 尺度：**主引擎**（`sub_41ACD0` 等函数用 `int _this`，字节寻址，如 `*(_DWORD*)(_this+430656)`）
> 与**输入管理器**（`sub_478090/_this+258`，其内部 `_this[1157]` 是相对输入管理器基址 +1157*4）。
> 下文会标明每个字段的主/从对象，避免混算。

---

## 2. 数据流总览

```
OS 鼠标/键盘/手柄事件
  → 消息泵（WinMain: GetMessage/PeekMessage/DispatchMessage，见 opcode-table / WndProc 区）
  → sub_478090(_this+258, _this+174802)   // 消费刷：吸取**挂起事件**（键/手柄按钮/按钮累加器），读后清零（**不读实时按住态**）
  → _this[174802]                          // 输入状态位掩码
  → 脚本读：poll-input(0x101) 刷后复位 / get-input-type(0xCD) 消息推进
           / 位检查 check-bit(0x13F) 或 (1<<bit)&value / joy·mouse-callback 注册的跳转
```

关键分叉：**帧循环**（`sub_411900`，每帧执行）用 `sub_4780D0` 把当前按住态刷进掩码，**逐条派发 opcode**（dispatch 表 = `this+0xA509C`，`_this[opcode+168999]` 函数指针）。
**脚本 VM 指令**（`poll-input` 0x101 等）用 `sub_478090` 把"待处理"事件依次 OR 进掩码。

---

## 3. 输入管理器构造（sub_477DD0）与位分配

`sub_477DD0`（raw.c 92373）初始化输入管理器（`_this = 主引擎+258`）：

- `_this[259]=7; _this[260]=200(VK_UP); [261]=205(VK_RIGHT); [262]=208(VK_DOWN); [263]=203(VK_LEFT); [264]=28(VK_RETURN); [265]=57(VK_SPACE); [266]=14(VK_BACK)` —— 这是一组**默认键码**（方向/确认/取消/空格/退格）。
- 键码→bit 映射表 `_this[1176+键码]` 初始化全 255（无效），再映射：
  `_this[1632]→bit0`、`_this[1637]→bit1`、`_this[1640]→bit2`、`_this[1635]→bit3`、`_this[1460]→bit4`、`_this[1489]→bit5`、`_this[1446]→bit6`（这些 `_this[16xx]` 是配置好的"当前键码"）。
  ⇒ **2D 布局**：`sub_4770A0` 轮询时 `for v2 in 0..255: if (GetAsyncKeyState(v2)&0xFF00)  then mask|=1<<_this[1176+v2]`（`_this[1176+v2]` 为该键码映射到的输入位）。
- 手柄：`_this[1124]=2`（设备数）；`_this[1125..1125+0x20]=0..31`（手柄按钮虚拟位表，`sub_477000`）；`_this[1157]=0`(强制0x40 flag)、`_this[1158]=0`(按钮挂起)、`_this[1159]=0`(键挂起累加)。
- `_this[1688]=1`（键盘/鼠标轮询开）；`_this[1710]=0`（鼠标按钮累加器）；`_this[1711..1718]=-1`（触控手势按钮映射，`sub_477CE0` 依 `GetGestureInfo` 填）。

> 结论：**键位→输入 bit 的映射是作者可配置的**（由 `0xFE/0x107/0x10B/0x10C/0x30A` 等 setup 与 `_this[1176+..]` 轴心表决定），不是写死 bit。鼠标左右恒为 bit4/5（可互换），手柄按钮走 `4+虚拟位`。

---

## 4. 两次刷子：sub_4780D0 vs sub_478090

### 4a. `sub_4780D0`（帧循环实时刷）— raw.c 92465
```c
sub_4770A0(_this, a2);   // 键盘 GetAsyncKeyState → 按 _this[1176+键码] 映射，OR 进 a2
sub_477150(_this, a2);   // 鼠标左右键 → bit4/5（SM_SWAPBUTTON 可互换）
sub_4772E0(_this, 0, a2);// 手柄
return sub_477C50(_this, a2);  // 若 _this[1688] 且 _this[1700] 有效：mask |= (1<<_this[1711+_this[1700]])
```
调用方 `sub_411900`（raw.c 20095，主循环每帧）：`sub_4780D0(主+258, 主+174802)`，再 `if(_this[1415]) mask|=0x40`（消息跳读强制位）、`sub_477280`(输入管理器, mask)（手柄按钮拉取）。**这一套确立"当前按住"的实时状态。**

### 4b. `sub_478090`（累计事件吸取刷）— raw.c 92449
```c
sub_477130(_this, a2);   // *a2 |= _this[1159]; _this[1159]=0   （键按下挂起累加器）
sub_477280(v3, a2);      // 手柄按钮挂起 → 4+虚拟位
sub_4774F0(_this, 0, a2);// 手柄 POV/摇杆 + 按钮（含按下保持态 _this[4*dev+4640]）
result = sub_477C30(_this, a2);  // *a2 |= _this[1710]; _this[1710]=0（鼠标按钮累加器）
if (_this[1157]) *a2 |= 0x40u;
```
调用方：`poll-input`(0x101, raw.c 25069)、`sub_419A70`、消息推进相关函数（raw.c 24983/27272/27457 等）。**这一套"吸取事件后清空挂起"，用于脚本控制流读取。**

> 差异一句话：`0D0`＝**此刻仍按着的**（帧循环主循环读，同一帧重复读会重复得到相同"按住"位）；
> `090`＝**自上次以来新发生、且脚本要消费的**（读一次即清挂起）。二者共用同一套位约定，但驱动来源（`GetAsyncKeyState` 实时 vs 消息泵累计）与生命周期不同。

---

## 5. 各设备轮询函数

| 函数 | raw.c | 设备 | 行为 |
|---|---|---|---|
| `sub_4770A0` | 91551 | 键盘 | `_this[1688]` 开：遍历 0..255，`GetAsyncKeyState(v2)&0xFF00` → `mask\|=1<<_this[1176+v2]`。 |
| `sub_477100` | 91572 | 键盘单键 | `_this[1688]` 开：返回 `GetAsyncKeyState(_this[a2+1432])`。 |
| `sub_477150` | 91591 | 鼠标 | `GetSystemMetrics(23)=SM_SWAPBUTTON`；左(GASK 1)→`mask\|=1<<(_this[1125+swap]+4)`；右(GASK 2)→`mask\|=1<<(_this[1126-swap]+4)`。默认左=bit4,右=bit5；互换时对调。 |
| `sub_477220` | 91625 | 鼠标按钮值 | `sub_42EDC0`(0x108) 用：左→`mask\|=1<<swap`，右→`mask\|=1<<(1-swap)`。**（注意：bit0/1 约定，非 bit4/5）** |
| `sub_4774F0` | 91798 | 手柄 POV/摇杆 | `joyGetPosEx`；POV==0xFFFF 时按轴比较 `_this[4*dev+4640]` 边沿；否则按 POV 角度；位置方向 bit1/2/4/8（上/右/下/左）。按钮：`_this[4*dev+4640]` 记忆，新增按下才 OR 进掩码，释放则清。 |
| `sub_4772E0` | 91670 | 手柄（`0D0` 用） | `joyGetPosEx` + POV 处理，与 `4774F0` 同源但用于实时读。 |
| `sub_477280` | 91644 | 手柄按钮 | 消费 `_this[1158]` 挂起位：`if(_this[1158]&(1<<i)) { _this[1158]&=~(1<<i); mask\|=1<<(_this[1125+i]+4); }`。 |
| `sub_477130` | 91580 | 键按下挂起 | `*a2\|=_this[1159]; _this[1159]=0`。 |
| `sub_477C30` | 92275 | 鼠标累加 | `*a2\|=_this[1710]; _this[1710]=0`。 |
| `sub_4771D0` | 91606 | 鼠标位置 | 若 `_this[6752]`：`GetCursorPos`+`ScreenToClient`；否则置 (-100000,-100000)。 |

---

## 6. 回调注册模型（不是函数指针！）

### 6a. `mouse-callback`（0xCC，sub_421980）— raw.c 30317
```c
_this[30*cur + 95805] = 5;                 // 设本脚本 arity=5（argc=2）
_this[107664] = sub_41BF50(_this, 2);      // op2 → 鼠标跳转目标(label 值)
_this[107674] = _this[30*cur + 95796];     // 当前脚本 depth
v2 = sub_41BF50(_this, 1);                 // op1 → 鼠标"槽/率"
return sub_453A60(_this + 107447, v2);     // 节流对象 [this+2]=1, [this+5]=timeGetTime(), [this+6]=op1
```
⇒ **一条 `mouse-callback <slot> <label>` 注册**：`op2`(label) 存进 `_this[107664]`，`op1`(slot) 存进节流对象 `_this+107447`（`_this[107453]`）。

> ★**`<slot>` 的真正身份 = `0xCD` 的节流间隔（ms）**（`tickets/T-0047`）：`sub_453A60` 把 `[6]` 写成 `a2 ? a2 : 1`，而 `_this+107447` 的 `[6]` = 字节 `429812` —— 正是 `sub_41ACD0`（0xCD）读的那一格。语料：**29 个脚本登记 `mouse-callback 10`（操作数是十六进制 = 0x10）⇒ 推进间隔 16ms**（≈一帧；TITLE/CHARMEDIT/SAVE/CONFIG1…），**22 个登记 `32` = 0x32 ⇒ 50ms**（≈20fps；GAMESTART/ROOM/MMODE/FIELD…）。`_this[107664]`（鼠标跳转目标）**只被 0xCC 写、只被 0xCD 读**；没有任何"按下才派发"的门 —— 派发完全由脚本自己的轮询决定。
>
> ★★**owner（`_this[107674]` = `430696`）是「最后登记的那个脚本」，不是「调用方的」**（`tickets/T-0056`）：每次 0xCC 都无条件改写它，而 `0xCD` 派发前要比对 `frames[cur][95796]`（raw 25861，不等即抛 `Depth が不正です`）。⇒ **子脚本一登记，父脚本原来的登记就作废**，父脚本回来后必须先**重新登记**才能再调 `0xCD`：
>  - **自己回来接着跑**的场合由脚本显式处理：`src/SAVE.txt:1153` 的 `mov (local-int e) 4` 让主循环跳回 `label_00000e60` 重登记（**存档**路径）；
>  - **不会回来**的场合靠引擎的**控制转移**：`0x1A1` 读档在 `sub_410160` 的 a6=1 段里 `cur = 0` + 装载存档记录的脚本 ⇒ 调用方脚本被放弃（`src/SAVE.txt:921-936` 的**读档**分支因此不需要 `e = 4`）。见 [`save-data.md`](./save-data.md) §7.1。
>  - 漏掉后者的症状（emulator 实测，`T-0056`）：父脚本带着子脚本（确认框 `SBUNKI.BIN`，id 54）留下的 owner 继续轮询 ⇒ `0xCD` 硬报错 `Depth が不正です 51 != 54`。

### 6b. `joy-callback`（0xFB，sub_421B80）— raw.c 30400
```c
_this[30*cur + 95805] = 5;
if (op1 < 0 || op1 >= 32) throw ShowMessage("set-keyjump");   // 校验 0..31
_this[33*cur + 107725 + op1] = op2;        // 手柄按钮 op1 → 跳转 label=op2（每脚本×每键）
```
⇒ **一条 `joy-callback <btn0..31> <label>`**：在**当前脚本帧**的把手表 `_this[33*cur+107725+btn]` 记 `label`。手柄按钮共 32 个（`sub_477000` 的 `_this[1125..]` 虚拟位）。

> ⚠️ **勘误（对旧 CONTEXT/表）**：`joy-callback`(0xFB) **不**做 `sub_453A60(_this+107454, op1)`。`sub_453A60(_this+107454, …)` 的写法属于 **0xCE（sub_4219E0）**——它注册的是另一组（`_this[107665]/[107666]` + `_this+107454`）节流。`0xFB` 实为"把手按 label 记到 `_this[33*cur+107725+btn]`"。

### 6c. 节流/计时对象：`sub_453A60` / `sub_453AF0`（raw.c 66101 / 66148）
- `sub_453A60(this, a2)`: `this[2]=1; this[5]=timeGetTime(); this[6]=a2?a2:1;`（起一个"帧率/等待"计时器：帧数、起始时刻、步长）。
- `sub_453AF0(this)`: 按 `this[2]`/`this[6]`/`timeGetTime()` 计算 `Sleep(剩余)` 达到帧率节流，推进 `this[2]`。
- 这类对象挂在主引擎若干偏移上（`_this+107447`/`+107454`/`+107475`/`+107524`…），用于**控制"多久刷一次/多久重读一次输入"**。它们**不是可交互回调**，是**速率/节流状态**。

---

## 7. 输入派发子程序

### 7a. `poll-input`（0x101，sub_419CC0）— raw.c 25069
```c
_this[30*cur + 95805] = 1;                 // arity=1（argc=0）
v2 = _this + 174802;
sub_478090(_this + 258, _this + 174802);   // 刷累计事件进掩码
_this[174801] &= ~0x8000000u;              // 清"消息/ADV 激活"
*v2 = 0;                                   // 复位掩码 = 0
_this[122367] = 1; _this[122370] = 0;      // 置"已读"引擎标志
```
⇒ **`poll-input` 的意义**：把自上次以来的输入事件刷进 `_this[174802]` 供**同批后续指令位检查**（如 `check-bit`/`(1<<bit)&var`），并且清消息/adv 激活位、设"读了输入"引擎态。**修 mask 后即清零**——故它只对有 `sub_478090` 副作用的调用方（消息系统自身）有保留值，对脚本层面主要是"空耗一帧 + 清除待处理输入"。

### 7b. `get-input-type`（0xCD，sub_41ACD0）— raw.c 25827
```c
_this[120*cur + 383220] = 1;                // "推进中"标志
now = timeGetTime(); v3 = now - _this[429808];
if (_this[429812] <= v3 || (effect_flags & 0x8000000) != 0) {
    _this[429808] = now;                    // 节流：刷新时间戳
    // 推进"当前帧的指令指针寄存器"（_this[4*(frameIdx+..)+388612] 计数）
    v4 = _this[430656];                     // = _this[107664]（鼠标跳转目标）
    if (v4 == -1) { --counter; return; }    // 无注册目标 → 回退不跳
    // depth 校验（"Depth が不正です %s != %s"），然后
    _this[120*cur + 383128] = _this[120*cur + 383124] + 4*v4;   // 跳到 label
    _this[120*cur + 383220] = 0;
}
```
⇒ **`get-input-type` = 消息/ADV 的"点击推进"门**。`_this[429812]`（节流间隔）= **最后一次 `mouse-callback`(0xCC) 的 op1**（见 §6a；只有从未登记过回调时才是 bss 0）⇒ 登记 `mouse-callback 10` 的脚本每 **16ms** 才推进一次（登记 `32` 的每 50ms）；"adv 激活"（`0x8000000`）是 OR 兜底（ADV 中恒真 ⇒ 那条路径不节流）。在此条件下把脚本推进到**鼠标回调注册的跳转目标**（若注册过，**并先压返回点**），否则原样返回。
> ★**emulator 已建模（2026-09，`tickets/T-0047`）**：`op_mouse_callback` 把 op1 写进 `InputManager.advanceThrottle`（`slot > 0 ? slot : 1`，对齐 `sub_453A60`），`getInputType` 按它节流；守卫 `test/route-dispatch.test.ts`（0xCC 后 `advanceThrottle === 0x10`）与 `test/input.test.ts`。
> ⚠**headless 守卫的坑**：虚拟时钟必须真的走（`sleep n` = n ms、整帧 = 16ms）—— 冻结时钟会让相邻 `get-input-type` 落在同一窗口内、鼠标回调一次都不跑（T-0047 实测：title-exit ×2 + route-dispatch ⑦b + CHARMEDIT 用例就是被这个抓住的）。
**它不"返回输入类型值"** —— 旧表把它记为"取输入类型/判输入模式"仅据名称推断，未读体；实读体后确认其是**推进+跳转**，"无输入"对应"未注册跳转目标→原地不跳/回退"。

### 7c. 消息跳读派发：`sub_419AF0`（0x100）— raw.c 25011
```c
v2 = _this[174802];                        // 输入掩码
if (v2) {                                  // 有键按下
    v6 = _this[cur+122287];                // 扫描游标
    v7 = _this[517];                       // SetKeyTotal
    while (((1<<v6) & v2) == 0) if (++v6 >= v7) return;   // 找最低按下位
    push return-advance;
    v8 = cur;
    if (_this[32*v8 + 107725 + v8 + v6] == -1) { pop; return; }   // 未注册的键
    _this[30*v8 + 95782] = _this[30*v8 + 95781] + 4*_this[32*v8+107725+v8+v6];  // 跳到注册 label
} else {                                   // ★掩码 == 0：派发"默认键"
    push return-advance;                   //   两条分支都压返回点
    v4 = _this[517];                       //   ★SetKeyTotal **本身当下标**
    v5 = cur;
    if (_this[32*v5 + 107725 + v5 + v4] == -1) { pop; return; }   // 默认键槽未登记
    _this[30*v5 + 95782] = _this[30*v5 + 95781] + 4*_this[32*v5+107725+v5+v4];
}
_this[30*cur + 95805] = 0;
```
⇒ **0x100 是"按键 / 默认键"派发器**，两条分支**都先压返回点**（`((ip-ip_base)>>2)+1`，raw 25039-25040 / 25052 —— handler 末尾的 `ret` 靠它回到 `0x100` 之后，不压就会落进 handler 的下一句）：
1. **掩码非 0**：找掩码里最低按下位（扫描上界 = `_this[517]`，raw 25029-25037），按该位在**本脚本节**的 `_this[33*cur+107725+bit]` 跳到注册 label（`joy-callback` 登记）；未注册则弹栈回退。★下标 ≥ SetKeyTotal 的槽**不参与**扫描（它们只能作为默认键被取到）。
2. ★**掩码 == 0（"没有任何键按下"）**：取 `v4 = _this[517]`（SetKeyTotal）**当下标**查同一张表 ⇒ 跑「**默认键**」处理器。`_this[517]` 初值 7（Input 构造 `sub_477DD0` raw 92385），而本作全语料只有 `src/SYSTEM4.txt:86` 的 `i0fe c` ⇒ **12** —— 所以菜单/界面脚本一律登记 `joy-callback 0..c`（13 个槽），**最后一个（下标 12）不是任何物理键，而是"按键全部松开"时的默认处理器**（例：`src/TITLE.txt`/`src/CHARMEDIT.txt` 的 `joy-callback c`）。
   > ⚠**漏掉分支 2 会静默卡状态**（`tickets/T-0046`）：`CHARMEDIT` 的 `joy-callback c → label_000016f0` 把"有键按住"标志 `local b` 清 0，而鼠标右键关闭要过 `label_00001820` 的 `jcc (local b)` ⇒ 漏掉后 `b` 恒 1 ⇒ **右键无反应**（点底部「閉じる」仍正常）。

---

## 8. 鼠标位置/按钮读取指令（TITLE 菜单关键）

| opcode | handler | 语义 | TITLE 实例 |
|---|---|---|---|
| **0x108** (`u00415E70`, sub_42EDC0) | raw.c 39047 | `op1 = 鼠标按钮值`（`sub_477220`，左=bit0/右=bit1，随 SWAP） | L79/80 `u00415E70 (local 3f2)` |
| **0x109** (`u00415EC0`, sub_42EE10) | raw.c 39057 | `op1=虚屏X, op2=虚屏Y`（`sub_4771D0`→`GetCursorPos`+`ScreenToClient`→`sub_498350`/`sub_403500` 虚拟映射） | L39 `u00415EC0 (local 404)(local 405)`，L79 读 `(local 3f0)(local 3f1)` |
| **0x10A**（`i10a`, sub_421EA0） | raw.c 30530-30598 | **把光标移到虚拟屏坐标**：`op1=X, op2=Y`（与 `0x109` 读出的同一空间）→ 窗口模式下做虚拟→客户区映射 → `ClientToScreen` → **`SetCursorPos`** ⇒ `0x109` 的**逆**。★语料 1678 处：ADV 侧边栏用 `i10a 4c4 (global-int 13a0)`/`i10a 479 (global-int 13a0)`（x=1220 栏内 / 1145 栏外，y = 刚读到的当前 Y）把光标**钉进/钉出**侧栏、`SBUNKI`/`BUNKI` 用它实现「恢复上次光标位置」、`ALLMAP` 用它把拖出边界的拖动光标夹回来、`SELSTAGE:42` 用它把光标居中到对话框。emulator：`op_set_mouse_pos`（设引擎侧光标；★宿主无 `SetCursorPos` ⇒ 真实光标不动，见 `tickets/T-0053`） | — |

- `0x109` 若 `Point` 为 (-100000,-100000)（鼠标未初始化/出窗口），写 op1=-100000、op2=Point.y；否则 `sub_498350`(坐标变换)、`sub_403500`(虚拟显示映射，用 `_this[699168]/[699172]` 分辨率、`_this+697620` 显示对象、`_this[107707..107710]` 裁剪) 后写 op1=X、op2=Y。
- **TITLE 用法**（src/TITLE.txt）：
  - `mouse-callback 10 label_00000460`（L53）：鼠标"槽 10"按下 → 跳到悬停/点击菜单处理。
  - `label_0000047c`（L72 起）被点击时调用：`2FC (local 3fe)(local 3f0)(local 3f1)(local 3ff)(local 400)` 做 **UI 命中测试**（0x2FC，`sub_431BA0`——给定鼠标 X/Y，判定选中哪个菜单项）；随后 `u00415EC0` 重读位置、`u00415E70` 读按钮态，`and (local)(按钮态) 2` 判**右键**推进/取消。
  - 主轮询 `label_0000039c`（L56 起）：`get-input-type` → 按 `local 3fc`(当前菜单状态 1/2/3) 分支跳转；`sleep 1; jmp label_0000039c` 空转等待，直到手柄回调/鼠标回调把 `local 3fc` 改走。

> 0x2FC 属 UI/message 子系统（**点击/悬停命中**），不在本文输入掩码层；但它消费 0x109 的鼠标坐标，故一并点名。

---

## 9. 按键绑定指令

| opcode | handler(位置) | 语义 |
|---|---|---|
| **0xFE** (SetKeyTotal, sub_421CA0, raw.c ~300xx) | 主 `_this[517]` | 写"总键数/默认键"（`>0x1F` 抛 `SetKeyTotalの引数が不正`）。`sub_419AF0` 用它做扫描上限与默认检查。 |
| **0x107** (u00415F **SetKey**, sub_421E50, raw.c 30516-30527) | `_this[551+op1]=op2`（op1≤0x1F） | 键下标 op1 → 绑定值 op2。 |
| **0x10B** (sub_422070, raw.c 30603-30614) | `_this[op2+1383]=op1`（op1≤0x1F） | 键 index=op2，值=op1。 |
| **0x10C** (SetKeyMulti, sub_4220B0, raw.c 30616-30634) | `_this[_this[op2+1690]+1434]=op1`（op1=位 ≤0x1F；op2=**键码**） | 把掩码位 op1 绑到"键码 op2 当前对应的 VK"：`Input = Engine+1032` ⇒ 等价 `Input[1176+Input[1432+键码]] = 位`。目标 `Input[1176+VK]` 就是 `sub_4770A0` 每帧读的 VK→位表，`Input[1432+键码] = VK` 由 `sub_476AA0`（raw 91325-91423）填默认（`src/SYSTEM4.txt:87-97` 用 `i10c 4 1c`=RETURN、`i10c 4 2c`='Z'…）。★两个操作数别写反：**op1 是位、op2 是键码**（抛错判的是 `op1>0x1F` 那一格）。emulator 现状见 `analysis/opcode-gaps.json` 该条（deferred）。 |
| **0x30A** (SetGesKey, sub_426B60, raw.c 33819 起) | `_this[op2+1969]=op1`（op1≤0x1F、op2≤7） | 手势键绑定（`GetGestureInfo` 相关）。 |
| **0x109** (sub_42EE10) | 见 §8 | 读鼠标位置（非绑定）。 |
| **0x10F** (sub_422120, raw.c 30232) | `_this[122369]` | 引擎控制字段（`u00415F10`）。 |

> 这些绑定**只改"键码/位"对应**，不改变 `sub_4770A0` 的核心查询路径（`GetAsyncKeyState(键码)`→`_this[1176+键码]`→位）。真正的可配置键→位轴心是 `_this[1176+..]`（`sub_477DD0` 初始化）+ `_this[551+]`/`_this[1383+]` 等绑定槽。
>
> `Input` 对象是 Engine 的内嵌成员（`Engine[258]` = 其 vftable，字节 `Engine+1032`）⇒ Engine 视角的 `_this[1434+k]`/`_this[1690+k]` 就是 Input 视角的 `_this[1176+k]`/`_this[1432+k]`（换算差 258）。

---

## 10. 光标外观 / 位置（渲染子系统）

- **读位置**：`GetCursorPos(&Point)`（raw.c 10024/10041 等）→ `ScreenToClient(hwnd,&Point)` 得客户区坐标；`sub_4771D0` 封装。
- **设位置**：`SetCursorPos` 全库三处 —— ① `0x10A` 的那次（raw 30597，见 §8 的 0x10A 行）；② 11863 与 ③ 141138：`SetCursorPos(Engine[699168]/2, Engine[699172]/2)` = **把光标居中**（`Engine[699168]/[699172]` = 窗口客户区宽/高、即分辨率）。★**宿主侧已落地（`tickets/T-0053` 的缺口 → `T-0058` 的实现）**：浏览器/Electron 没有移动**真实系统光标**的 API，所以补了一个 N-API 原生模块 `native/host-input`（CMake + C++ + node-addon-api；Windows = `SetCursorPos`、macOS = `CGWarpMouseCursorPosition`），链路 = 渲染进程（虚拟→客户区，`pixi/inputAttach.ts` 的同一套 rect 的逆）→ IPC `set-system-cursor` → 主进程（内容区原点 `getContentBounds` + **DIP→物理** `screen.dipToScreenPoint`）→ `.node`。缺模块时**降级**成"只改引擎侧光标"（旧行为）。工程口径见 [`../04-app/native-addon.md`](../04-app/native-addon.md)。
- **光标外观/显隐**：`SetCursor` 常与 HCURSOR 句柄缓存一起（raw.c 5238/138283 等）；`ShowCursor`（raw.c 4108/139344）。
- 这些属**输入/渲染**管理器，**不进入脚本 opcode 语义**；脚本只能经 0x108/0x109 读到按钮/位置值。若要在 emulator 复现鼠标，需要在这层注入 `GetCursorPos`/`GetAsyncKeyState` 对应实现。

---

## 11. Emulator 输入子系统的实现现状

当前在 `app/amayui-emulator` 已实现**输入子系统**（新增 `src/vm/input.ts` 的 `InputManager`，并接入 `Engine`/`NativeBridge`/`PixiBackend`）：

- **`InputManager`**（emulator 侧重建模输入管理器）：光标位置（虚拟 1280×720）、鼠标按钮（bit0/1）、按下沿（mouse/joy/key）、回调跳转目标（`mouseJump`/`joyJump[]`）、输入掩码（鼠标=bit4/5、手把=bit4+i、**键盘=bit0..6**）。
  ★掩码有**两把刷子**（`T-0027`，对应 §4 的引擎两把）：`flushPending()` = `sub_478090`（消费刷：只并按下沿/手柄挂起，**不含按住态**）、`flushHeld()` = `sub_4780D0`（实时刷：含 `buttons` 按住态）。**谁是哪个消费者是硬约束**：等待推进泵/`0x101`/`0xFA` 后半/`eatAllInput`/悬停门控走消费刷；`serviceAdv`(ADV 分支)/`0x100`/`0xFF`/`0xFA` 前半走实时刷。把等待泵接到实时刷会让「按住左键」每帧翻一页（用户实测的"一次点击快进多页"）。
  按住态另有**真值重同步** `syncButtons(MouseEvent.buttons)`（引擎"每帧 `GetAsyncKeyState` 轮询"的 DOM 等价物）与失焦兜底 `releaseAllMouse()`。
- ★**键盘 → 掩码位 0..6（`T-0052`，2026-09 起接上）**：引擎 `sub_4770A0`（raw 91551-91570）每帧遍历 VK，`GetAsyncKeyState(vk)&0xFF00` 命中就 `mask |= 1 << _this[1176+vk]`，而那张 VK→位表由 Input 构造填成 **0..6**（raw 92394-92400）：
  | 位 | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
  |---|---|---|---|---|---|---|---|
  | VK | 38 ↑ | 39 → | 40 ↓ | 37 ← | 13 Enter | 32 Space | 8 BackSpace |
  emulator：`DEFAULT_VK_TO_BIT`（`src/vm/input.ts`）+ `pressKey/releaseKey/releaseAllKeys`（DOM 侧 `keydown`/`keyup`/`blur`/`visibilitychange` → `renderer/pixi/inputAttach.ts`；键码用 `KeyboardEvent.keyCode`，它在本作需要的 7 个键上就是 Windows VK，`key` 作兜底）。
  语义对齐：`flushPending` 只并**按下沿**（`keyEdge`，消费一次即清 ⇒ 一次按下 = 一次派发）、`flushHeld` 并**按住态 + 沿**（按住期间每帧为真 ⇒ 菜单可连续移动）；未映射的 VK **不动任何位**（引擎那格没映射时 `1<<0` 会污染 ↑ 位）。守卫 `test/keyboard-mask.test.ts`（6 条，含 `0x100` 真派发到 `joy-callback 0`）。
  **仍缺**：① `0x107`/`0x10B`/`0x10C` 那族"按键绑定"改写这张表（emulator 只实现默认值，`Engine.engineValues` 里 `keyTableBase`/`keyTable2Base` 是写进去了、但**没有读者**）；② 真 ADV 场景的键盘 E3（本轮只到合成脚本级）。两条都登记在 `tickets/T-0052`。
- **已实现的输入 opcode**（`src/vm/ops.ts`，移入 `OPS` 表，读操作数/注册/跳转均真实生效）：
  - `0x108` 读鼠标按钮值→op1；`0x109` 读鼠标位置 X/Y→op1/op2（-100000=未初始化）。
  - `0xCC` mouse-callback：记 `input.mouseSlot=op1`、`input.mouseJump=op2`；`0xFB` joy-callback：记 `input.joyJump[btn]=op2`（校验 0..31）。
  - `0xCD` get-input-type：**已修复为引擎语义**（见 §7b）：**时间节流(≥200ms)或 ADV 激活(effect_flags&0x8000000)触发**→压返回地址 CALL 注册的 `mouseJump`；**不读/不消费鼠标移动或按下沿**；未注册目标则原地不跳。emulator 用 `InputManager.getInputType(nowMs, advActive)` + 引擎 `nowMs`（渲染帧注入 `performance.now()`）实现。
  - `0x12E` (u0041E940) 悬停命中：point-in-rect，**几何完全读取自脚本数据数组**（op5=size 盒数组逐项 4 值、op6=base X 数组、op7=base Y 数组、op8=count；判定 `dx0≤x-baseX[i]≤dx1 && dy0≤y-baseY[i]≤dy1`）。TITLE 实例用 `local cd/d1/d5/d9/dd`（size）+ `local 5`/`local 69`（base X/Y）+ `local 0`=count=5；**不在引擎里写死/模拟任何按钮坐标**。
  - `0x2FC` (sub_431BA0) 读触摸/触点：**已修复为引擎语义**：从**触摸/手势缓冲**(`_this+6780`,count `_this[6776]`, 40B/项) 取触点(非 GetCursorPos)，有触点写 `op1=1`、`op2=X`、`op3=Y`、**`op4=触点旗标(v9[4]=dwFlags)`、`op5=触点项[3](v9[3]=dwID)`（触点存在时非 0）**；无触点写 `op1=0`。emulator 以 `hasCursor` 代触点、`touchId` 作 op5。TITLE 紧随 `jcc(op1) … label_00000500` 据此走"聚焦/选中"分支。
  - `0x100` / `0xFF` / `0x101`：掩码派发扫描 / 重置重刷 / 刷后清零。★刷子归属：`0x100`/`0xFF` 用**实时刷**（引擎 raw 25009/25004），`0x101` 用**消费刷**（raw 25069）——见 §4 与 `T-0027`。
- **DOM 鼠标捕获**（`PixiBackend.create(status, input)` → `renderer/pixi/inputAttach.ts`）：在 `window` 上监听 `mousemove`/`mouseleave`/`mousedown`/`mouseup`/`wheel`/`contextmenu`，映射到虚拟坐标并写入 `InputManager`（左=bit0、右=bit1）。`mousemove`/`down`/`up` 都按 `e.buttons` 重同步按住态；`blur` 与 `visibilitychange(hidden)` 释放全部鼠标键（丢 mouseup 的自愈，`T-0027`）。HUD 顶部显示 `mouse=(x,y) btn=L/R`。
- **测试**：`test/input.test.ts` 覆盖 InputManager 单元 + TITLE 端到端（登记 mouse-callback → 首条 get-input-type → 注入**鼠标移动**/点击 → 派发跳到目标，hover handler 跑完回循环且不离开 TITLE）。

> ⚠️ **hover 高亮可随光标移动并可回退**：`0x2FC` 取鼠标（op1=触点?1:0、op2/3=坐标）、`0x12E` 按脚本数据命中、`detach-texture`(0x1F7) **删单/区间图元**（hover 回退删除旧 normal）；`0x203 set-draw-color-alpha` 按引擎读 **op3=alpha、op4=color → ARGB**（修正此前误把 op3 当整色），`PixiBackend` 在无动画窗时也尊重显式设色的 alpha（`colorSet`，供 hover 叠层淡入/淡出）。
> ⚠️ 剩余：`0xA1/0xA2/0xA3`（菜单派发表）与 `0x20C/0xB5/0x23D/0x32B`（图形/声音清理）仍是**安全桩**（no-op）。**点击选中菜单项**仍需完整菜单派发（`0xA1/0xA2/0xA3`）子系统。**未初始化菜单**（无 SYSTEM4）时点击可能退化进入 GAMESTART/游戏启动路径。

- 引擎侧 `getInputType()` 仍在 `StubNative`/`PixiBackend`/`canvasNative` 保留（恒 0，已不被 `0xCD` 路由，兼容遗留）。

---

## 12. 对既有文档的勘误（supersede）

| 文档 | 旧述 | 修正 |
|---|---|---|
| docs-new/99-records/2026-09-live2d/CONTEXT.md 0xFB 行 | "joy-callback（sub_421B80）：sub_453A60(_this+107454, op1)" | **错**。0xFB 实为 `_this[33*cur+107725+op1]=op2`（每脚本把手表）。`sub_453A60(_this+107454,…)` 属 **0xCE**(sub_4219E0)。 |
| docs-new/99-records/2026-09-live2d/CONTEXT.md 0xCD 行 | "判输入模式/时序……返回输入类型（0=无输入）" | **不准确**。0xCD 是消息"点击推进"门：节流 + 读到 `_this[107664]`(鼠标目标)≠-1 则跳转；未注册则原地/回退。无"返回输入类型值"这一语义。 |
| opcode-table.md | 0xCC/0xCD/0xFB/0x108/0x109/0x100/0x101 均为"仅映射/未读体" | 本文件已读体，语义如上；0xCC/0xCD/0xFB/0x101 已核实（见 opcode-table 对应行更新）。 |
| docs-new/99-records/2026-09-live2d/CONTEXT.md "poll-input 读取后复位为 0" | 概况 | 精确：`sub_478090` 刷掩码 → 清 `0x8000000` → `_this[174802]=0`、`_this[122367]=1`、`_this[122370]=0`；掩码供同批位检查，随即清零。 |
| docs-new/99-records/2026-09-live2d/CONTEXT.md 光标/坐标行 | "光标/坐标处理属于渲染子系统，不在脚本指令语义内" | **保留**，但补：0x108/0x109 是**唯二**读到鼠标按钮/位置的脚本指令；若 emulator 要支持鼠标需在此层注入。 |

---

## 13. 相关 opcode 速查（本文已核实）

| opcode | 名称 | handler | 语义类别 |
|---|---|---|---|
| 0xCC | mouse-callback | sub_421980 | 注册鼠标跳转目标（`_this[107664]`=label，`_this+107447`=节流） |
| 0xCD | get-input-type | sub_41ACD0 | 消息"点击推进"门（节流+跳转/回退） |
| 0xFB | joy-callback | sub_421B80 | 注册手柄跳转（`_this[33*cur+107725+btn]`=label） |
| 0x100 | （消息跳读派发） | sub_419AF0 | 扫掩码最低位→按键表跳转 |
| 0x101 | poll-input | sub_419CC0 | 刷掩码+清 act（`0x8000000`）+复位 |
| 0x108 | u00415E70 | sub_42EDC0 | 读鼠标按钮值（bit0/1）op1 |
| 0x109 | u00415EC0 | sub_42EE10 | 读鼠标位置 X/Y op1/op2 |
| 0xFE | SetKeyTotal | sub_421CA0 | 写 `_this[517]`（总键数/默认键） |
| 0x107/0x10B/0x10C | SetKey 类 | sub_421E50/sub_422070/sub_4220B0 | 键绑定 |
| 0x30A | SetGesKey | sub_426B60 | 手势键绑定 |
| 0x13F | check-bit | sub_42FB40 | `op1 = ((1<<op3) & op2)!=0`（位检查） |
| 0x135/0x136 | bit-set/bit-reset | sub_42F8B0/sub_42F920 | `op1\|=/\&= ~(1<<op2)` |
| 0x2FC | （UI 命中） | sub_431BA0 | 用鼠标坐标判定 UI 命中项 |
| 0x10D | read-mouse-wheel | sub_42EF50 | 读**竖直**滚轮增量（`_this[1949]`/byte 0x1E74）→ 立即清零 → op1（一格 ±120，上滚正） |
| 0x2E5 | （读水平滚轮） | sub_4310D0 | 读**水平**滚轮增量（`_this[1950]`/byte 0x1E78）→ 立即清零 → op1（一格 ±120，右滚正） |

## 14. 菜单派发与「hover 无法回退」的逆向分析（TITLE.txt）

> 本节是在「假设 TITLE.txt 逻辑正确」前提下，对 0xA1~0xA3（菜单派发）与 hover 回退链的 engine 核对结论。**先记录结论，不做 emulator 实现。**

### 14.1 菜单派发子系统 `0xA1/0xA2/0xA3`（本文件已读体确认）

引擎用 `_this+107679` 一张 **字符串哈希表** 承载「菜单项 key → handler label」：

| op | handler | raw.c | 语义 |
|---|---|---|---|
| `0xA1` | sub_433A40 | 42046 | `sub_415530(_this+107679, 0xFFF)` —— **复位**菜单对象（清表；0xFFF=容量/上限） |
| `0xA2` | sub_434F10 | 42908 | 读 `op1(字符串键,sub_41B640)` + `op2(值,sub_41BF50)` → `sub_434D00(_this+107679, key, &value)` —— **登记 key→label** |
| `0xA3` | sub_429830 | 35742 | `sub_428E00(_this+107679, key)` 查表：命中 `ip=str_table+4*值` 跳转；未命中跳 `op2`(回退 label) |

TITLE 出现两处：`label_000010b8`（**左键点击**：`i0a1 → i0a2(-1)→44f、0→452、1→481、2→4a3、3→52d、4→540 → i0a3(local3f7)→7df`，L304-315）与 L443-453（另一菜单态，同样 `i0a1+i0a2+i0a3`）。

> 由 `0xA2`/`0xA3` 定义可知：**key 是关键**。TITLE 用菜单项序号(-1/0/1/2/3/4)作 key；引擎以字符串（`sub_41B640`）读 key，故 emulator 需取 op1 的 DEC 值再字符串化，而不能用 `readStringOperand`（其对 local-int 会返回局部下标，是 emulator 既有 bug）。

### 14.2 「hover 无法回退」的逆向溯源（结论：脚本固有不回退，非 0xA1~0xA3）

hover 路径（`label_0000039c → label_00000460(mouse handler) → label_0000047c → label_00000778 → label_00003340`）**不含** 0xA1~0xA3。

- **恢复（de-highlight）逻辑** = `label_00003340` part 2（L749-788）：`set-draw-color-alpha <btn> 0 0 ffffff`（highlight→透明）+ `draw-texture <btn+1> 4 502 …`（画 normal 覆盖）。
- **触发器**（`call label_00003340`）：① 鼠标 hover 索引**变化**（`label_0000047c` L117-126：`3f5 != 3f6` 且 `3f5 > 0` → `3f6=3f7=3f5; call label_00003340`）；② 手柄（键盘导航）分支；③ 菜单进入 `label_00000184` L38（`(3f7)=-1`，guard 不满足→不恢复）。
- **为什么回退不了**：鼠标触发里 `L125 mov (3f7)(3f5)` 把 **(3f7)=新 hover**，`label_00003340` part 2 只对 **(3f7)** 恢复。因此鼠标从 b1→b2 时，part 2 只恢复 **b2**（新），**b1（旧 hover）从不被传入 part 2** —— b1 的 highlight 仍停留在上一轮 part 1 置的不透明，**没有任何指令去恢复它**。鼠标移出（`3f5=-1`）时 `3f5>0`/`0<-1<5` 均不成立，part 2 完全不执行 → 旧项永不回退。

> 即：TITLE 的「恢复」只作用于**当前 (3f7)**，而鼠标路径把 (3f7) 强制为新 hover；**旧 hover 在脚本里从无恢复指令**。这与 `0xB5`(音效)、`0xA1~0xA3`(点击派发) 均无因果。

### 14.3 已核对但 emulator 未建模/简化的 hover 路径指令（供后续按此实现）

| 指令 | engine | 结论 |
|---|---|---|
| `0x12E` | sub_42F230(39199) | **DEC 编码有向矩形**命中：读 `op2=S`(4×DEC 偏移) + `op5=P`(每索引 16B DEC) + `op6/op7=基准` + `op8=count`；判定 `dx∈[DEC(P0)-S1, DEC(P1)-S0]`, `dy∈[DEC(P2)-S3, DEC(P3)-S2]`；从 `op1+1` 起扫，命中返回索引否则 -1。对本 TITLE 数据等价于 AABB `[0,0x9c]x[0,0x9c]`（`(local 1)`=ENC(0)→DEC=0 → S=0；数组带 DEC 往返一致）→ **emulator 的 AABB 简化目前正确** |
| `0x2FC` | sub_431BA0(40776) | 读**触摸/手势缓冲**（`_this+6780`,count `_this[6776]`,40B/项）：有触点写 `op1=1,op2=X,op3=Y,op4=触点旗标(v9[4]),op5=触点项[3](v9[3]=dwID)`；**无触点写 op1=0** → handler 落回 `read-mouse-pos`/`read-mouse-button` 读光标。emulator 若把「光标存在」当「触点存在」为错（会误置 `local 3f2=1` 左键恒按） |
| `0xB5` | sub_420B40(29690) | `arity=3`；`sub_4B5020(_this+20719, op1, 0)` —— **声音通道控制**（与 0xB4 play-sound-effect/0xB6 同族）。hover 移动音效，**不影响高亮/回退** |
| `0x20C` | sub_41A1A0 | 时间戳+present（帧同步）；无界面 no-op |
| `0x1F7` | sub_422BC0 | 纹理子系统方法（`sub_4AB950`/`sub_4ABB60`）；**不清/不重置 item 颜色** |

### 14.4 渲染管线「自然重绘/清理」结论（**原结论被 §14.5/§14.6 修正**）

> 前面两轮的结论（§14.4 旧文本「不存在会重置高亮色的重绘/清理」；以及中途一度以为的「每帧清空绘制项表」）**均不成立**。真实机制见 §14.5/§14.6：引擎的绘制项容器**持久**，hover 回退靠 `detach-texture count=1` **按 handle 移除图元**，而非每帧清空。

### 14.5 `sub_403EF0` = 绘制子系统整体复位（非每帧；场景切换/消息用）

```c
int __thiscall sub_403EF0(_DWORD *_this) {
  _this[258] = 0;    // 清空绘制项容器（draw-item/mesh map 首字段 → 空表）
  _this[959] = -1;   // 复位「当前控件」→ 无；_this[7468]=-1（新控件）/7466=0（改变旗标）等
  ...（960/7464/7467/7468 复位）
}
```

- 调用点：`sub_403EF0(a1+51904)` + `sub_403EF0(a1+21976)` 两容器一起（19467/19560/19688/19914、35274），位于 `sub_410160`（19276，消息/模式处理，`switch case 0/10/20`）与 `sub_428A60` 附近。
- 语义：**整表清空 + 复位控件轨道** —— 用于**场景/模式切换**（旧的绘制项整体作废），**并非每帧执行**。**引擎的 draw-item 容器在帧间持久**，脚本用 `draw-texture`(add) 与 `detach-texture count=1`(remove) 增量维护。
- `sub_403E70`（9917）：控件 enter/leave 轨道跟踪器（`[959]`=当前、`[7468]`=新、`[7466]`=改变旗标），返回 `_this[old+359]`(leave 槽)/`_this[new+259]`(enter 槽)。这是系统级控件 UI 的 enter/leave 派发框架；**TITLE 菜单本身的 hover 高亮并不走它**，TITLE 用下面 §14.6 的脚本自维护。

### 14.5b ★派发 label 的返回点 = 门指令（`ret` 回到门指令重跑）—— 门指令必须幂等

`sub_405360`（raw 11030-11041）**压返回点**：`retStack[top] = a2 + ((ip - ip_base) >> 2)`。等待泵/主循环派发 label 时一律传 **`a2 = -3`**
（悬停 raw 20328-20332、键命中 20303-20308、坐标点击 20284-20292、面板显示态点击 13670/14045/14088/20180/20195），
而 `wait-for-input`(0x72) 长 **3 dword** ⇒ label 体末尾的 `ret` **正好回到门指令重跑**。

⇒ **凡是能被悬停/点击 label 的 `ret` 重跑的指令都必须幂等**。最容易踩的一处 = 逐字显现的"启动"：
`0x72` 的尾段（raw 28539-28555）只做三件事 —— `Engine[122371] = 窗`、`sub_45A940(..., -1, Engine+107705)` 查字格数、
置 bit31 等待门；bit30 未置时置 `0x40000000` + `Engine[107704] = 0` + 重启 **▼ 字格节拍**。
**文字的逐字游标 `FontVWindow+132` 由 `sub_45BE20` 泵推进、由 `0x71`/`sub_45EC60` 复位，`0x72` 一概不动**
⇒ 重跑门指令**不会**重放文字。emulator 曾把"启动逐字"放在 `0x72` 里、且只判"当前是否在显现" ⇒
**每次悬停都把整页文字从头重放**（`tickets/T-0016` 用户实测：ADV 页右侧悬停 ⇒ 中间文字不断重放、页不推进；
E3 实测 `revealRestarts = 2` → 修后 0）。常态行为条目见 `engine-capabilities.md` 的 `hover-ret-reruns-gate-op`。


### 14.6 「hover 回退」的真实机制（src/TITLE.txt + engine 双确认）

**TITLE 的 hover 高亮是脚本自维护的「滚动两态（3f8=旧 / 3f7=新）」机制，回退由 `detach-texture <old_normal> 1` 移除图元实现。**

`label_00003340`（L736-789）：
- **part1（读 3f8 = 上一轮 hover）** L738-747：guard `0<3f8<5` → `set-draw-color-alpha (0x12c+2·3f8) 0 ff ffffff`（旧项 highlight→**opaque**）+ `detach-texture (0x12d+2·3f8) 1`（**移除旧项 normal 图元**）→ **旧按钮回退为 highlight**。
- **part2（读 3f7 = 当前 hover）** L750-787：guard `0<3f7<5` → `set-draw-color-alpha (0x12c+2·3f7) 0 0 ffffff`（新项 highlight→**透明**）+ `draw-texture (0x12d+2·3f7) 4 502 …`（**画新项 normal 覆盖**）→ **新按钮显示为 normal**。
- **滚动延续**：part2 尾部 `mov (3f8)(3f7)`（L754）把 3f8 记为本轮新 hover，于是**下一次** hover 变化时,part1 的 3f8 = 刚刚的旧按钮 → 被回退。鼠标路径（`label_0000047c` L117-126）设 `3f6=3f7=3f5`（新），**不改 3f8**；3f8 延续上一轮 `mov(3f8)(3f7)` 的值。⇒ **上一轮（旧）按钮一定被回退**。

**engine 侧对应：`detach-texture … 1`（`sub_422BC0` `count≤1`）→ `sub_4AB950(_this+80708, handle)`：`sub_459EA0(find)` + `sub_4A8AF0(erase)` = 把 handle 从 draw-item/mesh 容器里移除。** （关于 `count>1` 的语义与 emulator 处理，见 §14.8。）

**（关键）引擎绘制项容器持久**：`draw-texture`(add) + `detach-texture count=1`(remove) 增量维护；不存在「每帧清空」。

**⇒ emulator 的 bug 与修复：** `pixiBackend.detachTexture` 先前是 **no-op**，导致 `detach-texture <old_normal> 1` **不移除**上一轮 hover 画出的 normal 图元 → 旧按钮一直显示 normal → 「hover 过后始终 hover」。已按 `sub_4AB950` 语义改为：`count≤1` 时 `drawItems.delete(handle)` + `meshes.delete(handle)`（移除图元）。`count>1`＝`sub_4ABB60` **按 handle 区间批量移除**（见 §14.8），emulator 同样实现区间删除。`input.test.ts` 通过；`xval.test.ts` 的失败是**既有** opcode 别名（bin `u00415EC0` vs txt `i109`）不匹配,与本修复无关。

### 14.8 `detach-texture` count≠0（count>1）的区间移除研究（SYSTEM4/LOGO/TITLE 开机命中）

**问题**：`0x1F7 detach-texture`（`sub_422BC0`）在 `count>1` 时走 `sub_4ABB60(_this+80708, handle, count)`。SYSTEM4/LOGO/TITLE 开机有大量 `detach-texture <h> <count>` 调用（count＝`2/3/4/6/0x19/0x64/0x12c/0x1f4`，如 `19640 2`、`19834 19`、`19708 6`、`1976c 3`、`19a28 1f4`、`1a9c8 64`、`30d40 4`、TITLE `64 12c`）。若 `count>1` 抛错，则 **LOGO→TITLE 开机即崩**。

**研究结论**（raw .c 分别读过 `sub_422BC0`(31137)/`sub_4ABB60`(130841)/`sub_4AA1D0`(129598)/`sub_4AA3D0`(129763)/`sub_4A8AF0`(128132)）：
- `sub_422BC0`：`op2≤1`→`sub_4AB950(_this+80708, op1)`（**按 handle 移除**）；`op2>1`→`sub_4ABB60(_this+80708, op1, op2)`。
- **容器对齐确认**：`sub_4AB950` 里 `_this+1032`(字节偏移) 与 `sub_4ABB60` 里 `_this[258]`(DWORD 下标) 的字节地址相同（258×4=1032）→ 两者操作**同一组容器**（`byte 1032`=draw-item、`1064`=网格+每项 record、`1080`/`1096`=附属列表）。
- `sub_4ABB60(handle, count)`：对 4 个容器各做 `begin=lower_bound(handle)`、`end=lower_bound(handle+count)`；若 `[begin,end)` 非空，则逐结点调 **`sub_4A8AF0`（std::map erase）**（经 `sub_4AA1D0`/`sub_4AA330`/`sub_4AA3D0`），并销毁 `+266/+267` 容器每项 record（vtable 调 delete `[1]` + `operator delete` `[2]/[3]/[4]`），置脏 `_this[11627]=1`。
- `sub_4A8AF0`（128132）确认是 **std::map::erase**（结点重连 + `std___X_out_of_range` 守卫）。

**⇒ 语义与 emulator 处理**：`count>1` 就是**按 handle 区间批量移除**——删掉 handle∈`[handle, handle+count)` 的全部绘制项/网格（引擎对 4 个容器该区间逐结点 erase；区间内无对应项时循环体不执行，等价 no-op）。因此不能当「无渲染改动」忽略：它会让一段特效/网格消失。emulator `detachTexture` 对 `count>1` **删 `[handle, handle+count)` 区间的 drawItems+meshes**（非 no-op、非抛错）。`count≤1` 的「移除单图元」是 TITLE hover 回退所依赖的语义。

### 14.7 未打通缺口

菜单点击链在 `0xA1~0xA3` 之后还会命中**未实现的 `0x80`（u0041AF00, sub_41F690）** 等指令（诊断：点击后 cur 变化前在 `@0x280` 处 `unimplemented opcode 0x80`）。「点击选中」要真正走通需继续补这些后续 opcode。

> ★2026-09 更新：`0x80` 早已实现（`handlers/msgwin.ts` 的 `op_set_default_window` = 默认窗索引，
> `0x6E/0x6F/0x196` 的 `op1=0` 指它），上面那条诊断是当时的状态。同一条实测方法现在用来验**存档槽**
> 菜单链：`SYSTEM4 → LOGO → TITLE →（菜单第 1 项 Load Data）→ SAVE.BIN`，路径上零未实现 opcode
> （唯一缺的 `0x2E5` 已补，见 §15），守卫 `test/save-slot-chain.test.ts`（`tickets/T-0018`）。

## 15. 两个滚轮累加器：`0x10D`（竖直）与 `0x2E5`（水平）

`WM_MOUSEWHEEL`(`0x20A`) 与 `WM_MOUSEHWHEEL`(`0x20E`) 在 WndProc 里写**两个不同的累加器**
（raw 141582 与 raw 141610），读端也是两条指令 —— 不能合成一个：

```text
0x20A → _this[1949] (byte 0x1E74)   ── 0x10D (sub_42EF50, raw 39114-39122)  读并清零 → op1
0x20E → _this[1950] (byte 0x1E78)   ── 0x2E5 (sub_4310D0, raw 40342-40350)  读并清零 → op1
```

- 两条都是 **`v2 = _this[N]; _this[N] = 0; writeIntOperand(1, v2);`** 的形状（一次性消费）。
- 值语义：自上次读取以来该轴的 `+= (short)HIWORD(wParam)` 累计；**一格 = ±120**（`WHEEL_DELTA`）。
  方向：竖直**上滚正/下滚负**（`0x10D`，脚本 `gr (local 403) 0` 判上滚）；水平**右滚正/左滚负**（`0x2E5`）。
- ★**两个轴都有"当按键"分支**（竖直 raw 141572-141583、水平 raw 141588-141611），判据同一句
  `(Engine+699204 & 0x90100000) != 0`：为真时**不累加**，而是取键位配置
  （竖直 `set:WheelKeyUp` 上滚 / `set:WheelKeyDown` 下滚；水平 `set:HWheelKeyUp/Down`），
  若该值 `>= 0` 就把它当**掩码位号**执行 `Engine[699208] |= 1 << 位`（`Engine[699208]` 就是输入掩码）。
  - 为什么必须建模：ADV 的回看/推进判据读的全是**掩码位**（等待泵 `sub_411BC0` raw 20345/20355、
    `sub_411590` raw 20047-20055、ADV 分支 `sub_411900` raw 20264 的 `set:WheelKeyDown`），
    缺失时"滚轮在 ADV 里"表现为**完全没有反应**（不是"回看不完整"）。
  - emulator 落点：`InputManager.wheelKeyBits` + `wheelKeyPolicy`（`Engine` 构造时注入的活值闭包，
    `asKey` 读的就是 `effect_flags & 0x90100000`），`flushPending`/`flushHeld` 把这一位并进掩码、
    `consumeEdges` 随掩码一起消费（引擎每轮收尾 `*v9 = 0`）、`snapshot`/`restore` 带上它。
    守卫 `test/wheel-as-key.test.ts`（两条路分岔 / 方向 / 横滚 / 位号非法 / 消费 / 回放 /
    "一次真实滚轮事件 ⇒ 等待泵回看分支"端到端）。
  - ★掩码位对应的**可见后果**在 ADV 侧是"回看光标移动 + `effect_flags |= 0x100000`"；
    引擎里那三处还会调 `sub_411560(Engine, "CALLBACK_TEXT.BIN")`，但本机数据索引
    （`install/SYS4INI.BIN` 的 21109 条）里**没有**这个名字，而 `sub_455000` 找不到返回 `-1`、
    `sub_40FC90(Engine, -1)` 体首即早退（raw 19021-19026）⇒ 该跳在真机与 emulator 上**同样是 no-op**。
- **真实用例**（`src/SAVE.txt:204-205`，存档/读档列表）：同一次轮询里先 `read-mouse-wheel (local 14)`
  再 `i2e5 (local 15)`，之后分别按这两个局部量翻页 ⇒ **只实现竖直那个会让列表横向翻页失效**（旧状态：
  `0x2E5` 是"仅映射"、命中即硬报错）。emulator 侧 `InputManager` 有 `wheelDelta` / `hwheelDelta`
  两个累加器（`addWheel` / `addHWheel`，都进 `snapshot()`/`restore()` 回放），渲染侧 `wheel` 事件把
  `deltaY` 取负喂第一个、`deltaX` 原样喂第二个。守卫：`test/wheel.test.ts`（两条互不消费）+ 真语料链路
  `test/save-slot-chain.test.ts`（TITLE → Load Data → SAVE.BIN，零未实现 opcode）。
- 竖直滚轮与消息泵的耦合（ADV 推进分支只认 `<0`，raw 13938）见本文档前面章节；水平滚轮在引擎里
  **没有**泵侧读者（只有 `0x2E5` 自己）。

### 15.1 配置键的来源与位号出处（2026-09-24 只读查证；全文 `tickets/T-0168/notes.md`）

- **默认值 `3` / `1` 是引擎写死的**：`Reg` 构造函数 `sub_491880`（raw 111736-111739）。**唯一**的覆盖写者是
  `Reg` vtable+0x2C 的 ini 载入器 `sub_494220`（读 `WHEELKEYUP=` 行，raw 112705-112718，同时写
  `message:WheelKeyUpOnTW`）；`aWheelkeyup` / `aWheelkeydown` 两个常量在整份反编译里**只被引用 4 处**（全在该
  `_stricmp` 链上）。`.lst:432701` = `.data:00529808 dd offset sub_494220`（就是那个 vtable 槽）。
- **游戏内设置界面改不了它**：`src/**` 里 `set:` 键名 0 命中；6 条 `SetConfig` opcode 的键名全是常量；键位类
  opcode 只出现在 `SYSTEM4.txt`。随包数据、真机 `SYS4REG.INI`（959 B，连 `[set]` 段都没有）与注册表里都没有
  这个键 ⇒ overlay 里那行 `WheelKeyUp=3` 是本工程 `renderIni` **全量输出**的产物，不是随包默认。
- **读端零上界校验**：位号只做 `>= 0` 判定（`.lst:004B9CAB` 的 `js`），随后 `shl cl`（`.lst:004B9CBE`）**没有钳位**
  ⇒ 负位号被整条跳过（什么都不做）；**`>= 32` 会按 x86 的移位量掩码取模成 `位 & 31`**（即落到某个低位掩码上，
  而**不是**"什么都不做"）。emulator 侧 `addWheel` / `addHWheel` 现在的越界行为与修法见 `tickets/T-0171`
  （关键结论：**模式开时一律不该进累加器** —— 引擎那个累加支 raw 141580-141583 与模式门
  `Engine+699204 & 0x90100000` 的 `if` 是配对的，模式开时它不可达）。
- **掩码位号来自脚本，且 `0xC9` 是扫描码不是 VK**：`SYSTEM4.txt:93` 的 `i10c 8 c9` 经 `sub_4220B0`（raw 30632）
  写 `Input[1176 + 33] = 8`；引擎键码表 `sub_476AA0`（raw **91413**）把 `_this[1633]` 置成 `33`
  ⇒ `Input[1432 + 0xC9] = 33 = VK_PRIOR`（PageUp）。消费者 = WM_KEYDOWN `sub_4B8DF0`（raw 140851-140862）与
  轮询 `sub_4770A0`（raw 91551-91568）；emulator 的键码→VK 表（93 条）与该表逐条一致。
- **ADV 泵里的翻页只由"上滚位"触发**：raw 20343-20348 读 `1 << Conf(set:WheelKeyUp)`，门 `effect_flags & 0x40000000`；
  **下滚位没有单独判**（raw 20355 落进 `else` ⇒ 上滚没命中时试着前进一格）；翻页**本身不是 opcode**（直接
  `sub_459770`）。`0x84` 与 `sub_41F790` **不读输入**（op1 就是方向），语料 0 处。
- **`0x84` 的登记缺口**：它既不在运行时三张表、也没有 `analysis/opcode-gaps.json` 条目 ⇒ 语料为 0 时棘轮看不见它，
  一旦被命中就是硬停（`opcode-gaps.json` 的 `unimplemented: 0` 掩盖了这件事）。HISTORY.BIN 自己的翻页链是
  `0x10D` / `joy-callback` → `0x1D0`（带符号步数）→ `0x1D3` → `0x1D1`。
- 受限态补充（供后续核对，别当普遍结论）：进 HISTORY 后 4000 帧、VM 45 步/帧的探针里，`0x1D1` 是**唯一**的
  "未实现 opcode"；同链另有 7 条 `partial`、2 条 engine-internal 与 2 类宿主丢弃（`0x1F9` 的
  `setTextureObjectParam`、`0x308` 的 unhandled）。

## 16. 「滚轮上滚在 ADV 里做什么」——默认是**打开侧边栏**，不是回看（`tickets/T-0168`）

判据全部在体里读过、并用**真语料 E3** 实测过（守卫 `app/amayui-emulator/test/t0168-wheel-adv-input.test.ts`，5 例）：

```text
默认 set:WheelKeyUp = 3（= ← 键的掩码位）
WM_MOUSEWHEEL(0x20A) 「当按键」分支：Engine[699208] |= 1 << 3        （WndProc case 0x20A，raw 141560-141606）
  → 等待泵第一出口 sub_403D70（raw 9847-9863，调用点 raw 20242）
      · ADV 用 0x97 绑好的路由表里命中 src/SN0000.txt:88 那一项（位 3 → label 0x2c40）
      → 派发 label_00002c40（src/SN0000.txt:770）→ call label_00000e78 摆出 22 个侧栏按钮
      → label_00002fc0 把光标定位到第一个可选中按钮
```

- ⇒ **「上滚 = 打开侧边栏并停在第一个按钮」是引擎默认行为**（`set:WheelKeyUp = 3`），不是 emulator 的分叉。
- **回看（`HISTORY.BIN`）要先把位号配成 8**：`src/SN0000.txt:106` 把位 8 绑给 `label_00002f84`，它的体里
  才是 `call-script 31 // HISTORY`。引擎里**没有**"滚轮 ⇒ HISTORY"的内链。
- ★**次序事实**：键位命中（`sub_403D70`，raw 20242）发生在回看块（`sub_411BC0` raw 20341-20363）**之前**，
  而 ADV 把位 0/1/2/3/7/8 都绑给了路由项 ⇒ 即便把位 8 配上，"滚轮 ⇒ 回看游标"那一支在产品路径上**仍不可达**
  （实测 `textRewind = 0`、`effect_flags & 0x100000 == 0`）。回看块本身还被 `effect_flags & 0x40000000` 门控。
- **`sub_411590`（`0x100000` 自旋里的输入泵）不建模**（有据登记）：① 产品路径进不去（该位两个置位端都属于回看，
  ADV 里恒 0）；② 照抄会把门条件变成永不终止（唯一清位点在它自己体内 raw 20041/20061，且要等
  `CALLBACK_TEXT.BIN` 跑完 ⇒ 5ms 一圈死循环）；③ 它的可观测后果各有落点。重开条件写在
  `tickets/T-0168/changes-wheel.md` §3.3。
- **`sub_411560(Engine, "CALLBACK_TEXT.BIN")` 在本树是 no-op**：索引 **25080** 条（base `SYS4INI.BIN` 21109 +
  5 个扩展包 `APPEND0{1..5}.AAI` 3971）里 `*TEXT*` **0 命中** ⇒ `sub_455000`（raw 67400-67439）返回 -1 ⇒
  `sub_40FC90`（raw 19019-19027）体首 `if (a2 != -1)` 早退 ⇒ **真机与 emulator 都不会弹「回想/回看」画面**。
- ★**`i24e` 的两个位互为反相、不能只引一半**（`tickets/T-0157`）：语料 `/i24e` 共 **422** 处，取值分布
  `0x10001` **413** / `0` 3 / `1` 3 / `0x10003` 3。`0x10001` 的 **bit1 = 0** 而 **bit0 = 1** ⇒
  「bit1 = 0 ⇒ 真机走到 raw 13923 支」成立的同时，raw 21114 的 `0x400` **动画等待门在近全部语料上被挡住**
  （引擎只 `break`：不清池计时器、不重提交、不清 `effect_flags & 0x400`）。引这一格时必须两个位一起引。
