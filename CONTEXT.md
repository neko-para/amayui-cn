# CONTEXT.md — 天結 工程上下文（鼠标/输入架构）

> 本文件为**工程上下文备忘**（此前被删除，现重建）。当前重点记录**鼠标/输入系统的架构信息**。
> 其余已收敛结论见 `docs-new/03-engine/*`（版权页 frame 效果机制 `copyright-effect.md`、渲染实现 `../04-app/emulator-copyright-effect.md`、opcode 全表 `opcode-table.md`）。

---

## 鼠标/输入系统架构（松散梳理，非深度研究）

### 数据流总览（架构层）
```
OS 鼠标/键盘/手柄事件
   → 消息泵（WinMain: PeekMessage/GetMessage/DispatchMessage, 20408-20420 / 20604-20617；WndProc 139340+）
   → sub_478090(_this+258, _this+174802)   // 一次性把当前设备状态刷进位掩码
   → _this[174802]                          // 输入状态位掩码（byte 699208）
   → 脚本经 poll-input(0x101) 读取并复位 / get-input-type(0xCD) 判输入模式 / 位检查（(1<<bit)&[174802]）
```

### 关键字段 / 对象
| 项 | 位置 | 说明 |
|---|---|---|
| `_this[174802]` | byte 699208 | **输入状态位掩码**：每位=一个按钮/输入态；脚本用 `(1<<bit) & input` 判按下。poll-input 读取后**复位为 0**。 |
| `_this[174801]` | byte 699204 | effect_flags（含输入分发相关位 0x8000000 等）。 |
| `_this + 258` | — | 输入/绘制管理器对象基址（`sub_478090` 用它做设备轮询）。 |
| `_this + 107447` / `+107454` | — | 鼠标/手柄回调表（`sub_453A60` 注册）。 |
| `_this[699168]/[699172]` | — | 窗口内容宽/高（分辨率），`SetCursorPos` 居中用它。 |
| `_this[429808]/[429812]` | — | 输入节流计时（get-input-type 用的时间戳/间隔）。 |

### 指令（opcode 表）
| opcode | 名称 | handler | 位置（dispatch 槽） | 架构语义 |
|---|---|---|---|---|
| 0xCC | `mouse_callback` | sub_421980 | `_this+676812` | **注册鼠标/键盘回调**：读 op1/op2，写 `_this[107664]/[107674]`，`sub_453A60(_this+107447, op1)` 登记。 |
| 0xCD | `get-input-type` | sub_41ACD0 | `_this+676816` | **判输入模式/时序**：置 frame arity；`timeGetTime()` 与 `_this[429808/429812]` 做节流，`(effect_flags&0x8000000)` 触发键/输入分发。返回输入类型（0=无输入）。 |
| 0xFB | `joy_callback` | sub_421B80 | `_this+677000` | **注册手柄回调**：`sub_453A60(_this+107454, op1)`。 |
| 0x101 | `poll-input` | sub_419CC0 | `_this+677024` | **轮询并复位输入**：`sub_478090(_this+258, _this+174802)` 刷位掩码 → 清 `_this[174801]&0x8000000` → 复位 `_this[174802]=0`，置 `_this[122367]=1`、`_this[122370]=0`。 |

> 旧 label：`mouse_callback`/`get-input-type`/`joy_callback`/`poll-input` 已是语义名（具体旧名见 `docs-new/03-engine/opcode-table.md`）。这几条均被 emulator 的 `StubNative`/`PixiBackend.getInputType()` 以 "无输入"（返回 0）桩处理，TITLE 轮询据此停在菜单。

### 鼠标位置 / 光标
- **读位置**：`GetCursorPos(&Point)`（9992/10009）取光标屏幕坐标。
- **设位置**：`SetCursorPos(x,y)`（30194）；`SetCursorPos(_this[699168]/2, _this[699172]/2)`（11795，居中）。
- **光标外观/显隐**：`SetCursor`（138283/138295/138306/138320/138666/139106）；`ShowCursor`（139344）。
- 光标/坐标处理属于渲染子系统（`SetCursor` 常与 HCURSOR 句柄缓存一起），不在脚本指令语义内。

---

## 其它已收敛要点（简表，细节见 docs-new/03-engine/*）

- **版权页 frame 效果**：时间=`timeGetTime()` 墙钟 ms；背景(2a)=mesh#1 vertex-color(CalcDiffuse)、文字(2b)=draw-item diffuse-alpha（两组正交、逐像素相乘）；淡出=mesh#2 盖黑→硬切 movie；`wait`(0x21C) 置 0x400 等待门。→ `docs-new/03-engine/copyright-effect.md`。
- **Emulator 实现**：引擎式 present（跑到门控、`needsRender` 驱动）、场景图、严格 flag（未知位抛错）、文件日志。→ `docs-new/04-app/emulator-copyright-effect.md`。
- **opcode 命名**：效果指令已语义化（`create-mesh`/`set-vertex-color(-alpha)`/`set-draw-color(-alpha)`/`draw-texture`/`set-texture`/`create-texture`/`release-texture`/`play-movie`/`wait`/`float-mov`/`poll-input`/`texture-op`），旧 `u00xxxxxx` 为别名；src/data 已批量替换。→ `opcode-table.md`。