# 03-engine · `_this[97058]` 全局时间阈值槽 与「光标贴顶/Alt → 弹系统对话框」触发链

> 本文件记录对引擎全局槽 `_this[97058]`（字节偏移 388232 = 4×0x5EC88）及其周边输入/计时/对话框机制的逆向分析。
> 数据层结论见 `analysis/fields.json` 的 `global_slot_97058`、`analysis/functions.json` 的 `sub_42FEC0/sub_4229A0/sub_4B9240/sub_477080/sub_408620/sub_48E730/sub_453870`；opcode 语义见 `opcode-table.md` 0x148/0x149。
> 标注：`[已确认]` 从 raw 读体确证；`[推断]` 由上下文推断、未逐行确证。

---

## 1. 一句话结论
`_this[97058]` 是一个**引擎全局时间阈值槽**（毫秒），由 `0x148`(读) / `0x149`(写) 这对 get/set 指令供脚本读写；引擎在 `sub_4B9240`(WM_TIMER 回调) 里把它当“**光标贴到屏幕顶边缘 / 松开 Alt 后、多久才拉出系统对话框**”的**去抖时长**使用。SYSTEM4 里 `i149 3e8`（=1000ms）设的就是这个默认去抖时长。**它不是一个通用的“1 秒挂机/AFK 超时”。**

---

## 2. 字段：`_this[97058]`（byte 388232 = 0x5EC88）
- **位置**：`engine + 388232`（= `dword_55E1BC + 388232`，全局引擎基址 `dword_55E1BC=0x55E1BC`）。
- **邻域**：`_this[97059]`(0x5EC8C)=DEC/ENC 密钥 `key`、`_this[97060]`(0x5EC90)=`enc_zero`(ENC(0))。（来自 `analysis/fields.json`。）
- **读写**：
  - `0x149` (sub_4229A0)：`_this[97058] = readIntOperand(op1)` —— **写**。`[已确认]` raw 31045-31051。
  - `0x148` (sub_42FEC0)：`writeIntOperand(op1, _this[97058])` —— **读**。`[已确认]` raw 39705-39708。
- **引擎内部**：
  - `sub_4B9240`（WM_TIMER）：`v2 = *(_DWORD*)(dword_55E1BC + 388232)`，与 `timeGetTime()-dword_55E1D8` 比较。`[已确认]` raw 141041-141043。
  - `sub_40DF10`（引擎初始化/复位）：`*(_DWORD*)(_this + 388232) = 0`。`[已确认]` raw 17978。
- **取值**：SYSTEM4.txt line12 `i149 3e8` → 1000。`[已确认]`

> 注：按“97058”字面搜会漏掉两处——`sub_4B9240` 用 `dword_55E1BC + 388232`、`sub_40DF10` 用 `_this + 388232`（都写字节偏移）。所以完整引用共 4 处（2 处 opcode + 2 处引擎内部）。

---

## 3. 触发链（连成的机制）
引擎主窗口过程（WndProc，含 `sub_4B92F0`/`sub_4B8DF0`）在三条消息路径上走到同一条“弹对话框 + 停输入”分支：

### 3a. WM_MOUSEMOVE（0x200） — 启动/复位定时器
```
case 0x200:
  if (HIWORD(lParam) >= 2) {            // 光标不在顶部 2 行 → 复位
    dword_55E1D8 = 0; KillTimer(hWnd,1);
  } else if (dword_55E1D8) {            // 已启动且光标贴顶
    sub_4B9240(hWnd);                   // 直接查一次
  } else {
    dword_55E1D8 = timeGetTime();       // 记录起始时间
    SetTimer(hWnd, 1u, 0x64u, 0);       // 启动 100ms 定时器
  }
```
`[已确认]`（`HIWORD(lParam)` 的“>=2”判定按光标 Y 贴顶 2 行理解，`[推断]`）

### 3b. WM_TIMER（0x113，每 100ms）→ `sub_4B9240`
```
if (timeGetTime() - dword_55E1D8 > _this[97058])      // 超过去抖阈值
  && (GetAsyncKeyState(1)&0xFF00)==0                   // 左键没按
  && (GetAsyncKeyState(2)&0xFF00)==0                   // 右键没按
  && engine[671960]==0                                 // 非锁定态
  && ShowDialog(-1, hWnd, 0) == 0                      // 无系统消息在显示（AGERC.DLL）
  → sub_477080(input, 1);     // ★ 停用输入（_this[1032+1688]=0）
    sub_408620(engine);       // ★ 弹系统对话框（ShowDialog(4,...) + 摆窗）
    dword_55E1D8 = 0;
    KillTimer(hWnd, 1u);
```
`[已确认]`

### 3c. WM_SYSKEYUP（0x104，wParam=18=Alt） — 松开 Alt 直接触发
```
if (engine[671960] || wParam != 18) return DefWindowProc(...);
sub_477080(input, 1); sub_408620(engine); dword_55E1D8 = 0; KillTimer(hWnd,1);
```
`[已确认]`

> 即：**把光标停到屏幕顶边缘（Y<2）超过 `_this[97058]` 毫秒**，或**松开 Alt**，就会“停用输入 + 拉出一个系统对话框/菜单”。`_this[97058]`=1000 是前者的**去抖时长**（防光标快速扫过误弹）。

---

## 4. 关键函数

### 4a. `sub_4B9240`（WM_TIMER 回调）`[已确认]`
上面 §3b 的实现。核心是读 `_this[97058]` 作阈值、`GetAsyncKeyState(1)/(2)` 查鼠标按键、`dword_55E1B4(-1,hWnd,0)`(ShowDialog)作“是否有消息在显示”的门。

### 4b. `sub_477080`（输入激活位开关）`[已确认]` raw 91541-91548
```c
BOOL sub_477080(_this, a2){ _this[1688] = (a2==0); return _this[1688]; }
```
设输入子系统 `_this[1032+1688]` 的“激活”位：`a2==0→1(启用)`、`a2==1→0(停用)`。`sub_4770A0`(轮询所有键)/`sub_477100`(读单键) 都先看此位才 `GetAsyncKeyState`。
- `WM_ACTIVATE`：`sub_477080(input, wParam==0)`（有焦点启用/失焦停用）。
- 本触发链：`sub_477080(input, 1)` → 停用输入。

### 4c. `sub_408620`（弹系统对话框 + 摆窗）`[已确认]` raw 13238-13278
```c
if ((engine+699204 & 0x400000)==0) {         // 未显示过
  ...sub_406050(engine);
  v4 = dword_55E1B4(4, engine[387924], 0);   // ShowDialog(4, 主窗, 0) → 对话框句柄
  engine[387928] = v4;
  engine[699204] |= 0x400000;
  GetWindowRect(主窗); GetWindowRect(对话框); /* 摆位 */
}
```
用 `ShowDialog` **命令码 4** 新建系统对话框并定位。`[部分]`（具体弹哪种对话框/菜单未确证）。

### 4d. `sub_4770A0` / `sub_477100`（真正读键）`[已确认]`
受 `_this[1688]` 激活位门控；`sub_4770A0` 遍历 256 个虚拟键、`sub_477100` 读单键（`GetAsyncKeyState`）。

---

## 5. AGERC.DLL 运行时接口（`dword_55E1B4` / `dword_55E1B8`）
`WinMain` 里 `sub_48E730` 初始化：
```c
LoadLibraryA("AGERC.DLL");
v63[2] = GetProcAddress(h,"_GetInstance@0");
v63[3] = GetProcAddress(h,"_ShowDialog@12");   // → dword_55E1B4
v63[4] = GetProcAddress(h,"_OperateMenu@16");  // → dword_55E1B8
```
- `sub_453870(v63)` = `v63[3]` → **`dword_55E1B4` = `ShowDialog`**（3 参 `@12`）。`[已确认]` raw 65953-65955、WinMain 141984。
- `sub_48E630(v63)` = `v63[4]` → **`dword_55E1B8` = `OperateMenu`**（4 参 `@16`）。`[已确认]` raw 109330-109332。
- `dword_55E1B4` 调用点：命令码 `3`(传 fileSource)/`4`(弹框)/`8`/`10`/`-1`(查是否有系统消息)。`[已确认]`
- **作用**：AGERC.DLL 是引擎运行时库，提供 `GetInstance/ShowDialog/OperateMenu`。`ShowDialog` 是“系统对话框/消息”接口，不是鼠标函数。`[已确认]`

---

## 6. 时间戳 `dword_55E1D8`
表示“上一次活动/定时启动”的时间，由 `timeGetTime()` 置，触发/复位时清 0。与 `_this[97058]` 一起构成去抖死区。`[已确认]`（设置点 raw 141286/141310/141319/141517/141531，读取点 141042）。

---

## 7. 结论与边界
- **`_this[97058]` 的真实用途**：不是挂机 AFK 超时，而是“光标贴顶/Alt → 弹系统对话框”的**去抖时长**。所以 SYSTEM4 设一次 1000ms 是合理的（全局默认去抖），并非“太短”。
- **`0x148`/`0x149`**：对 `_this[97058]` 的 get/set 指令对。`0x148` 在 `opcode-table.md` 原标“仅映射”，已确证为读侧→升级“已核对”。
- **emulator 现状**：`0x149` 在 `ENGINE_INTERNAL_OPS`（no-op）；`0x148` 未映射（潜在 `NotImplementedOp`）。`0x149`/`0x148` 若要实现，可建模为对引擎字段 `_this[97058]` 的 get/set（`sub_408620` 依赖的 AGERC `ShowDialog` 是 native 子系统钩子，emulator 可 no-op/记录）。

## 8. 参考
- `analysis/fields.json`：`global_slot_97058`（0x5EC88）。
- `analysis/functions.json`：`sub_42FEC0`、`sub_4229A0`、`sub_4B9240`、`sub_477080`、`sub_408620`、`sub_48E730`、`sub_453870`。
- `docs-new/03-engine/opcode-table.md`：0x148/0x149。
- `docs-new/03-engine/input-system.md`：输入子系统总览（本文件是其交互/计时侧面）。
