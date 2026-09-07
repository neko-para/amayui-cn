# 鼠标/输入系统机制记录（已收敛）

> 本文档是《天結いキャッスルマイスター》引擎**输入子系统**的权威机制记录（反编译自 `engine/天结_unpacked.exe_utf8.c`，
> 模块基址 0x400000，引擎单例 `this`，**字节偏移**；`_this[N]` 为 **DWORD 下标**，换算 `N×4 = 字节偏移`）。
> 覆盖：输入位掩码语义、两次"设备刷子"、各设备轮询、回调注册模型（`mouse_callback`/`joy_callback`）、
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
5. `mouse_callback`(0xCC) / `joy_callback`(0xFB) **不是 hook 函数指针**，而是给"某个输入槽"记一个**脚本跳转目标**（label）。鼠标走 `_this[107664]` + 节流对象 `_this+107447`；手柄走 `_this[33*cur+107725+btn]`。按下匹配时把当前脚本 IP 跳到该 label。
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
| `_this[107664]` | 鼠标回调的**跳转目标**（`mouse_callback` 的 op2）。`_this[430656]`（字节偏移）= 同一字段。 |
| `_this[107453]` | 鼠标回调节流对象的"槽/率"字段（`mouse_callback` 的 op1）。 |
| `_this[33*cur+107725+btn]` | 手柄回调映射表（`joy_callback` 的 op2），按下 btn 时跳到该 label。 |

> 注意区分两个 `_this` 尺度：**主引擎**（`sub_41ACD0` 等函数用 `int _this`，字节寻址，如 `*(_DWORD*)(_this+430656)`）
> 与**输入管理器**（`sub_478090/_this+258`，其内部 `_this[1157]` 是相对输入管理器基址 +1157*4）。
> 下文会标明每个字段的主/从对象，避免混算。

---

## 2. 数据流总览

```
OS 鼠标/键盘/手柄事件
  → 消息泵（WinMain: GetMessage/PeekMessage/DispatchMessage，见 opcode-table / WndProc 区）
  → sub_478090(_this+258, _this+174802)   // 实时刷：键盘 GetAsyncKeyState + 鼠标按钮 + 手柄 POV/摇杆/按钮
  → _this[174802]                          // 输入状态位掩码
  → 脚本读：poll-input(0x101) 刷后复位 / get-input-type(0xCD) 消息推进
           / 位检查 check-bit(0x13F) 或 (1<<bit)&value / joy·mouse_callback 注册的跳转
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

### 6a. `mouse_callback`（0xCC，sub_421980）— raw.c 30317
```c
_this[30*cur + 95805] = 5;                 // 设本脚本 arity=5（argc=2）
_this[107664] = sub_41BF50(_this, 2);      // op2 → 鼠标跳转目标(label 值)
_this[107674] = _this[30*cur + 95796];     // 当前脚本 depth
v2 = sub_41BF50(_this, 1);                 // op1 → 鼠标"槽/率"
return sub_453A60(_this + 107447, v2);     // 节流对象 [this+2]=1, [this+5]=timeGetTime(), [this+6]=op1
```
⇒ **一条 `mouse_callback <slot> <label>` 注册**：`op2`(label) 存进 `_this[107664]`，`op1`(slot) 存进节流对象 `_this+107447`（`_this[107453]`）。

### 6b. `joy_callback`（0xFB，sub_421B80）— raw.c 30400
```c
_this[30*cur + 95805] = 5;
if (op1 < 0 || op1 >= 32) throw ShowMessage("set-keyjump");   // 校验 0..31
_this[33*cur + 107725 + op1] = op2;        // 手柄按钮 op1 → 跳转 label=op2（每脚本×每键）
```
⇒ **一条 `joy_callback <btn0..31> <label>`**：在**当前脚本帧**的把手表 `_this[33*cur+107725+btn]` 记 `label`。手柄按钮共 32 个（`sub_477000` 的 `_this[1125..]` 虚拟位）。

> ⚠️ **勘误（对旧 CONTEXT/表）**：`joy_callback`(0xFB) **不**做 `sub_453A60(_this+107454, op1)`。`sub_453A60(_this+107454, …)` 的写法属于 **0xCE（sub_4219E0）**——它注册的是另一组（`_this[107665]/[107666]` + `_this+107454`）节流。`0xFB` 实为"把手按 label 记到 `_this[33*cur+107725+btn]`"。

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
⇒ **`get-input-type` = 消息/ADV 的"点击推进"门**。节流（`_this[429808]/[429812]`，间隔默认 200ms）或"adv 激活"（`0x8000000`）条件下，把脚本推进到**鼠标回调注册的跳转目标**（若注册过），否则原样返回。
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
} else {                                   // 无键：也检查默认键 SetKeyTotal
    ...同理检查 _this[33*cur+107725+cur+517]...
}
_this[30*cur + 95805] = 0;
```
⇒ **0x100 是"消息跳读/按键推进"派发器**：找掩码里最低按下位，按该位在**本脚本节**的 `_this[33*cur+107725+bit]` 跳到注册 label（`joy_callback` 登记）；未注册则回退。`_this[517]`(SetKeyTotal) 用它做"默认键/总键数"的扫描上限与默认检查。

---

## 8. 鼠标位置/按钮读取指令（TITLE 菜单关键）

| opcode | handler | 语义 | TITLE 实例 |
|---|---|---|---|
| **0x108** (`u00415E70`, sub_42EDC0) | raw.c 39047 | `op1 = 鼠标按钮值`（`sub_477220`，左=bit0/右=bit1，随 SWAP） | L79/80 `u00415E70 (local 3f2)` |
| **0x109** (`u00415EC0`, sub_42EE10) | raw.c 39057 | `op1=虚屏X, op2=虚屏Y`（`sub_4771D0`→`GetCursorPos`+`ScreenToClient`→`sub_498350`/`sub_403500` 虚拟映射） | L39 `u00415EC0 (local 404)(local 405)`，L79 读 `(local 3f0)(local 3f1)` |

- `0x109` 若 `Point` 为 (-100000,-100000)（鼠标未初始化/出窗口），写 op1=-100000、op2=Point.y；否则 `sub_498350`(坐标变换)、`sub_403500`(虚拟显示映射，用 `_this[699168]/[699172]` 分辨率、`_this+697620` 显示对象、`_this[107707..107710]` 裁剪) 后写 op1=X、op2=Y。
- **TITLE 用法**（src/TITLE.txt）：
  - `mouse_callback 10 label_00000460`（L53）：鼠标"槽 10"按下 → 跳到悬停/点击菜单处理。
  - `label_0000047c`（L72 起）被点击时调用：`2FC (local 3fe)(local 3f0)(local 3f1)(local 3ff)(local 400)` 做 **UI 命中测试**（0x2FC，`sub_431BA0`——给定鼠标 X/Y，判定选中哪个菜单项）；随后 `u00415EC0` 重读位置、`u00415E70` 读按钮态，`and (local)(按钮态) 2` 判**右键**推进/取消。
  - 主轮询 `label_0000039c`（L56 起）：`get-input-type` → 按 `local 3fc`(当前菜单状态 1/2/3) 分支跳转；`sleep 1; jmp label_0000039c` 空转等待，直到手柄回调/鼠标回调把 `local 3fc` 改走。

> 0x2FC 属 UI/message 子系统（**点击/悬停命中**），不在本文输入掩码层；但它消费 0x109 的鼠标坐标，故一并点名。

---

## 9. 按键绑定指令

| opcode | handler(位置) | 语义 |
|---|---|---|
| **0xFE** (SetKeyTotal, sub_421CA0, raw.c ~300xx) | 主 `_this[517]` | 写"总键数/默认键"（`>0x1F` 抛 `SetKeyTotalの引数が不正`）。`sub_419AF0` 用它做扫描上限与默认检查。 |
| **0x107** (u00415F **SetKey**, sub_421E50, raw.c 30114) | `_this[551+op1]=op2`（op1≤0x1F） | 键下标 op1 → 绑定值 op2。 |
| **0x10B** (sub_422070, raw.c 30200) | `_this[op2+1383]=op1`（op1≤0x1F） | 键 index=op2，值=op1。 |
| **0x10C** (SetKeyMulti, sub_4220B0, raw.c 30213) | `_this[_this[op1+1690]+1434]=op2`（op1≤0x1F） | 键群绑定。 |
| **0x30A** (SetGesKey, sub_426B60, raw.c 33292) | `_this[op2+1969]=op1`（op1≤0x1F、op2≤7） | 手势键绑定（`GetGestureInfo` 相关）。 |
| **0x109** (sub_42EE10) | 见 §8 | 读鼠标位置（非绑定）。 |
| **0x10F** (sub_422120, raw.c 30232) | `_this[122369]` | 引擎控制字段（`u00415F10`）。 |

> 这些绑定**只改"键码/位"对应**，不改变 `sub_4770A0` 的核心查询路径（`GetAsyncKeyState(键码)`→`_this[1176+键码]`→位）。真正的可配置键→位轴心是 `_this[1176+..]`（`sub_477DD0` 初始化）+ `_this[551+]`/`_this[1383+]` 等绑定槽。

---

## 10. 光标外观 / 位置（渲染子系统）

- **读位置**：`GetCursorPos(&Point)`（raw.c 10024/10041 等）→ `ScreenToClient(hwnd,&Point)` 得客户区坐标；`sub_4771D0` 封装。
- **设位置**：`SetCursorPos(x,y)`（raw.c 30194）；`SetCursorPos(_this[699168]/2, _this[699172]/2)`（raw.c 30597，中心化——`_this[699168]/[699172]` 为窗口客户区宽/高，分辨率）。`sub_477DD0` 之外另有初始化中把鼠标居中（11795 附近）。
- **光标外观/显隐**：`SetCursor` 常与 HCURSOR 句柄缓存一起（raw.c 5238/138283 等）；`ShowCursor`（raw.c 4108/139344）。
- 这些属**输入/渲染**管理器，**不进入脚本 opcode 语义**；脚本只能经 0x108/0x109 读到按钮/位置值。若要在 emulator 复现鼠标，需要在这层注入 `GetCursorPos`/`GetAsyncKeyState` 对应实现。

---

## 11. Emulator 输入子系统的实现现状

当前在 `app/amayui-emulator` 已实现**输入子系统**（新增 `src/vm/input.ts` 的 `InputManager`，并接入 `Engine`/`NativeBridge`/`PixiBackend`）：

- **`InputManager`**（emulator 侧重建模输入管理器）：光标位置（虚拟 1280×720）、鼠标按钮（bit0/1）、按下沿（mouse/joy）、回调跳转目标（`mouseJump`/`joyJump[]`）、输入掩码（`flush()` 生成，鼠标=bit4/5、手把=bit4+i）。
- **已实现的输入 opcode**（`src/vm/ops.ts`，移入 `OPS` 表，读操作数/注册/跳转均真实生效）：
  - `0x108` 读鼠标按钮值→op1；`0x109` 读鼠标位置 X/Y→op1/op2（-100000=未初始化）。
  - `0xCC` mouse_callback：记 `input.mouseSlot=op1`、`input.mouseJump=op2`；`0xFB` joy_callback：记 `input.joyJump[btn]=op2`（校验 0..31）。
  - `0xCD` get-input-type：有挂起鼠标活动（**移动** 或 按下沿）且注册过 `mouseJump` → **压返回地址**并派发跳到该 label（hover/点击；handler 的 `ret` 回到循环下一条）；否则扫手把沿、有注册目标则跳；都没有则吞活动落回。
  - `0x12E` (u0041E940) 悬停命中：point-in-rect，**几何完全读取自脚本数据数组**（op5=size 盒数组逐项 4 值、op6=base X 数组、op7=base Y 数组、op8=count；判定 `dx0≤x-baseX[i]≤dx1 && dy0≤y-baseY[i]≤dy1`）。TITLE 实例用 `local cd/d1/d5/d9/dd`（size）+ `local 5`/`local 69`（base X/Y）+ `local 0`=count=5；**不在引擎里写死/模拟任何按钮坐标**。
  - `0x2FC` (sub_431BA0) 读鼠标触点 + 虚拟坐标：有触点写 `op1=1`、`op2=X`、`op3=Y`、`op4≈按钮态`、`op5=0`；无触点写 `op1=0`。TITLE 紧随 `jcc(op1) … label_00000500` 据此走"聚焦/选中"分支。
  - `0x100` / `0xFF` / `0x101`：掩码派发扫描 / 重置重刷 / 刷后清零。
- **DOM 鼠标捕获**（`PixiBackend.create(status, input)`）：监听 canvas 的 `mousemove`/`mousedown`/`mouseup`/`mouseleave`，映射到虚拟坐标并写入 `InputManager`（左=bit0、右=bit1；`contextmenu` 阻止默认）。HUD 顶部显示 `mouse=(x,y) btn=L/R`。
- **测试**：`test/input.test.ts` 覆盖 InputManager 单元 + TITLE 端到端（登记 mouse_callback → 首条 get-input-type → 注入**鼠标移动**/点击 → 派发跳到目标，hover handler 跑完回循环且不离开 TITLE）。

> ⚠️ **hover 高亮可随光标移动并可回退**：`0x2FC` 取鼠标（op1=触点?1:0、op2/3=坐标）、`0x12E` 按脚本数据命中、`texture-op`(0x1F7) 标记图元重渲染；`0x203 set-draw-color-alpha` 按引擎读 **op3=alpha、op4=color → ARGB**（修正此前误把 op3 当整色），`PixiBackend` 在无动画窗时也尊重显式设色的 alpha（`colorSet`，供 hover 叠层淡入/淡出）。
> ⚠️ 剩余：`0xA1/0xA2/0xA3`（菜单派发表）与 `0x20C/0xB5/0x23D/0x32B`（图形/声音清理）仍是**安全桩**（no-op）。**点击选中菜单项**仍需完整菜单派发（`0xA1/0xA2/0xA3`）子系统。**未初始化菜单**（无 SYSTEM4）时点击可能退化进入 GAMESTART/游戏启动路径。

- 引擎侧 `getInputType()` 仍在 `StubNative`/`PixiBackend`/`canvasNative` 保留（恒 0，已不被 `0xCD` 路由，兼容遗留）。

---

## 12. 对既有文档的勘误（supersede）

| 文档 | 旧述 | 修正 |
|---|---|---|
| CONTEXT.md 0xFB 行 | "joy_callback（sub_421B80）：sub_453A60(_this+107454, op1)" | **错**。0xFB 实为 `_this[33*cur+107725+op1]=op2`（每脚本把手表）。`sub_453A60(_this+107454,…)` 属 **0xCE**(sub_4219E0)。 |
| CONTEXT.md 0xCD 行 | "判输入模式/时序……返回输入类型（0=无输入）" | **不准确**。0xCD 是消息"点击推进"门：节流 + 读到 `_this[107664]`(鼠标目标)≠-1 则跳转；未注册则原地/回退。无"返回输入类型值"这一语义。 |
| opcode-table.md | 0xCC/0xCD/0xFB/0x108/0x109/0x100/0x101 均为"仅映射/未读体" | 本文件已读体，语义如上；0xCC/0xCD/0xFB/0x101 已核实（见 opcode-table 对应行更新）。 |
| CONTEXT.md "poll-input 读取后复位为 0" | 概况 | 精确：`sub_478090` 刷掩码 → 清 `0x8000000` → `_this[174802]=0`、`_this[122367]=1`、`_this[122370]=0`；掩码供同批位检查，随即清零。 |
| CONTEXT.md 光标/坐标行 | "光标/坐标处理属于渲染子系统，不在脚本指令语义内" | **保留**，但补：0x108/0x109 是**唯二**读到鼠标按钮/位置的脚本指令；若 emulator 要支持鼠标需在此层注入。 |

---

## 13. 相关 opcode 速查（本文已核实）

| opcode | 名称 | handler | 语义类别 |
|---|---|---|---|
| 0xCC | mouse_callback | sub_421980 | 注册鼠标跳转目标（`_this[107664]`=label，`_this+107447`=节流） |
| 0xCD | get-input-type | sub_41ACD0 | 消息"点击推进"门（节流+跳转/回退） |
| 0xFB | joy_callback | sub_421B80 | 注册手柄跳转（`_this[33*cur+107725+btn]`=label） |
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
