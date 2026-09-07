# CONTEXT.md — 天結 工程上下文（鼠标/输入架构）

> 本文件为**工程上下文备忘**（此前被删除，现重建）。当前重点记录**鼠标/输入系统的架构信息**。
> **鼠标/输入系统的权威机制记录见 `docs-new/03-engine/input-system.md`**（已读 handler 体收敛，含位掩码/刷子/回调/派发/位置读取/绑定指令全解）。
> 其余已收敛结论见 `docs-new/03-engine/*`（版权页 frame 效果机制 `copyright-effect.md`、渲染实现 `../04-app/emulator-copyright-effect.md`、opcode 全表 `opcode-table.md`）。

---

## 鼠标/输入系统架构（速览；权威记录见 input-system.md）

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
| `_this + 107447` / `+107454` | — | 鼠标/手柄**节流对象**（`sub_453A60` 置 `[2]`=帧数、`[5]`=timeGetTime、`[6]`=步长；`sub_453AF0` 做 Sleep 节流）。非回调表。 |
| `_this[699168]/[699172]` | — | 窗口内容宽/高（分辨率），`SetCursorPos` 居中用它。 |
| `_this[429808]/[429812]` | — | 输入节流计时（get-input-type 用的时间戳/间隔）。 |

### 指令（opcode 表）
| opcode | 名称 | handler | 位置（dispatch 槽） | 架构语义 |
|---|---|---|---|---|
| 0xCC | `mouse_callback` | sub_421980 | `_this+676812` | **注册鼠标跳转目标**：读 op2→`_this[107664]`（label），`_this[107674]=cur[]depth`；op1→`sub_453A60(_this+107447, op1)`（节流对象）。按下匹配时 0xCD 跳到 `_this[107664]`。 |
| 0xCD | `get-input-type` | sub_41ACD0 | `_this+676816` | **消息/ADV"点击推进"门**：`timeGetTime()` 与 `_this[429808/429812]` 节流（或 `effect_flags&0x8000000` 激活）；读到 `_this[430656]`(=鼠标目标)≠-1 则跳转，==-1 则原地/回退。**不返回输入类型**（旧述不准确）。 |
| 0xFB | `joy_callback` | sub_421B80 | `_this+677000` | **注册手柄跳转目标**：校验 op1∈[0,32)，`_this[33*cur+107725+op1]=op2`（把手表）。⚠️ 修正：非 `sub_453A60(_this+107454,op1)`（那属 0xCE）。 |
| 0x101 | `poll-input` | sub_419CC0 | `_this+677024` | **刷掩码并复位**：`sub_478090(_this+258, _this+174802)` 刷累计事件进掩码 → 清 `_this[174801]&0x8000000` → `_this[174802]=0`，置 `_this[122367]=1`、`_this[122370]=0`。供同批位检查读，随即清零。 |

> 旧 label：`mouse_callback`/`get-input-type`/`joy_callback`/`poll-input` 已是语义名（具体旧名见 `docs-new/03-engine/opcode-table.md`）。**emulator 已实现这些输入指令**（见下节「emulator 输入/hover 实现现状」）。

### 鼠标位置 / 光标
- **读位置**：`GetCursorPos(&Point)`（9992/10009）取光标屏幕坐标 → `ScreenToClient` 得客户区坐标（`sub_4771D0`）。
- **脚本内唯二可读**：**0x108**（`u00415E70`=sub_42EDC0）读鼠标**按钮值**到 op1（左=bit0/右=bit1，随 SM_SWAPBUTTON 互换）；**0x109**（`u00415EC0`=sub_42EE10）读鼠**标位置 X/Y** 到 op1/op2（虚拟显示映射，-100000=未初始化）。TITLE 菜单即靠它俩+0x2FC 命中测试做悬停/点击。
- **设位置**：`SetCursorPos(x,y)`（30194）；`SetCursorPos(_this[699168]/2, _this[699172]/2)`（11795，居中）。
- **光标外观/显隐**：`SetCursor`（138283/138295/138306/138320/138666/139106）；`ShowCursor`（139344）。
- 光标/坐标处理属于渲染子系统（`SetCursor` 常与 HCURSOR 句柄缓存一起），不在脚本指令语义内（除 0x108/0x109 读值）。

---

## emulator 输入/hover 实现现状（`app/amayui-emulator`）

### 已实现（输入链路通）
- `src/vm/input.ts` `InputManager`：光标位置（虚拟 1280×720）、鼠标按钮(bit0/1)、按下沿、**移动标记 `mouseMoved`（hover 派发用）**、回调跳转目标(`mouseJump`/`joyJump[]`)、`flush()` 掩码。
- opcodes（`src/vm/ops.ts`，移入 `OPS` 表，读操作数/跳转真实生效）：`0x108`(读按钮)、`0x109`(读位置)、`0xCC`(mouse_callback)、`0xFB`(joy_callback)、`0xCD`(get-input-type：**鼠标移动/点击皆派发，并压返回地址**回循环)、`0x12E`(悬停命中 point-in-rect，**几何来自脚本数据** local5/local69/local cd，不在引擎写死)、`0x2FC`(读鼠标触点+坐标)、`0x100/0xFF/0x101`、`0x1F7 texture-op`。
- DOM 捕获：`PixiBackend#attachMouseInput` 监听 **window** `mousemove/mousedown/mouseup/contextmenu`，用 `canvas.getBoundingClientRect()` 求虚拟坐标写入 `InputManager`。
- 交互运行（`renderer.ts`）：进入 TITLE 后**不再按 `titleSteps`/低 `MAX_STEPS` 自动截止**（脚本退出/重置/错误/关窗才收尾）；TITLE 后**停逐条步进日志**（只记 `[input]`/`[input-state]`/错误/切换）。`MAX_STEPS=1e8` 兜底。
- 诊断：日志里有 `[input] move/down`（DOM 事件）、`[input-state] hasCursor/pos/moved/edge/btn/mouseJump + items={…}`（VM 侧输入 + draw-item 实况，含 handle/layer/dst/alpha，按绘制顺序）。

### **尚未解决：hover 高亮不显示/不回落**（当前会话记录，待续）
- 现象：鼠标悬停标题菜单时高亮**不出现**或**出现后不回落**。
- 标题高亮机制（`TITLE label_00003340` 红绘）：叠层 handle `0x12c/12e/130/132/134`、正文 handle `0x12d/12f/131/133/135`（两两同位置，来自 local5/local69）。红绘用 `set-draw-color-alpha`(0x203) 设**叠层** alpha：选中项→`0xff ffffff`(不透明，高亮)，非选中→`0x0 ffffff`(透明)；并 `texture-op`/`draw-texture` 正（正文）。
- 诊断数据（`[input-state] items={...}`，光标不悬停时）：**`0x12c..0x135` 全部 `a255`（不透明）**，且顺序 `0x12c` 在 `0x12d` 之前（= 叠层画在正文**下方**）。
- 已修（但未解决）：
  1. `0x203` 读参修正：`op3=alpha, op4=color → ARGB`（此前误把 op3 当整色）。
  2. `#itemAlpha` 尊重 `colorSet`：无动画窗时按 `from` 色 alpha 渲染（此前恒 255）。
  3. `setDrawColorAlpha` 现 `it.anim=undefined`——引擎 `set-draw-color-alpha`＝设当前色，若沿用 `set-draw-color`(0x202) 的 `to=不透明` 动画窗，`#itemAlpha` 会在窗末恒返回 `to`(不透明)，导致叠层卡死。**注意：仍见叠层全部 `a255`，说明该固定未使 `0x12c` 变为透明。**
- **仍疑点（下一步）**：
  - **z 序**：`present()` 按 `layer→handle` 升序 → `0x12c`(叠层) 先画、`0x12d`(正文) 后画在上方。若叠层是高亮层，应画在正文之上；当前被正文盖住。**「高亮可见」可能来自正文/或 text-ure-op，非叠层。**
  - **标题选中态时序**：`label_00003340` 里「高亮 `3f8` → `3f8=3f7` → 回退 `3f7`」顺序与直觉不同；`3f7`(hover)/`3f8`(selected) 语义未完全逆清。
- 交叉参考：`docs-new/03-engine/input-system.md` §11。

---

## 其它已收敛要点（简表，细节见 docs-new/03-engine/*）

- **版权页 frame 效果**：时间=`timeGetTime()` 墙钟 ms；背景(2a)=mesh#1 vertex-color(CalcDiffuse)、文字(2b)=draw-item diffuse-alpha（两组正交、逐像素相乘）；淡出=mesh#2 盖黑→硬切 movie；`wait`(0x21C) 置 0x400 等待门。→ `docs-new/03-engine/copyright-effect.md`。
- **Emulator 实现**：引擎式 present（跑到门控、`needsRender` 驱动）、场景图、严格 flag（未知位抛错）、文件日志。→ `docs-new/04-app/emulator-copyright-effect.md`。
- **opcode 命名**：效果指令已语义化（`create-mesh`/`set-vertex-color(-alpha)`/`set-draw-color(-alpha)`/`draw-texture`/`set-texture`/`create-texture`/`release-texture`/`play-movie`/`wait`/`float-mov`/`poll-input`/`texture-op`），旧 `u00xxxxxx` 为别名；src/data 已批量替换。→ `opcode-table.md`。