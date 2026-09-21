---
kind: narrative
state: live
---
# 03-engine · 引擎内部内存布局（this / 帧 / 调用栈）

> 本文件只列**引擎内部**（解释器/`this` 对象/脚本帧/调用栈）的布局说明。**游戏业务数据地址不在此**（见 `../02-data/`）。
> ⚠️ **字段/偏移的真源是数据层 `analysis/fields.json`**（`this` 布局、帧、调用栈、操作数池均以它为准），`scripts/report.js --field` 可查；本文件只保留**未入数据层**的叙事与定位方法。

## 1. `this` 对象模型（字段真源见数据层）

`analysis/fields.json` 的 `Engine` 作用域逐条列出：操作数池基址/计数（`pool_*`）、`cur_script`、`call_ret`、`key`/`enc_zero`、`logo_enabled`、`frames` 区等。字节偏移约定：`_this[K]`（DWORD 索引）×4 = 字节偏移。

### 1.1 消息窗对象（台词显示子系统）—— 未入数据层，此处记录

- **「消息系统」= AGE/System4 的台词/文本信息窗（メッセージウィンドウ）子系统**：位于 `this + 0x534C`（byte 21324）的一个大对象，负责剧情/系统文本的展示与渲染（几何、字体、文本度量、消息条目）。
- 证据（`engine/天结_unpacked.exe_utf8.c`）：
  - `show-text`(0x6E, `sub_41EB20`) 直接调 `(_this+0x534C)->sub_46BE30(消息id, 文本串, 0, _this[97055])` 送台词。
  - `end-text-line`(0x6F) / `wait-for-input`(0x72) 同样打在该对象。
  - 配置 opcode（boot→TITLE 必然执行）：`0x70`→`sub_45D660(_this+0x534C,…)` 设窗几何；`0x71`→`sub_45EC60`/`sub_48F000` 显示消息；`0x75–0x78`→写 `_this[21664..21667]` 等字段；`0x1A5`(`sub_4328F0`)/`0x2FE`(`sub_432DD0`)/`0x2BD`/`0x2DB`→设/重建字体；`0x1C1`/`0x1CA`/`0x197`/`0x2EE`/`0x303`→消息/自动消息/布局。
  - `sub_459F40`（该对象方法）体内全是 `LOGFONTA`/`HFONT`/`GetTextMetrics`(TEXTMETRICA)/GDI 字体创建——**重建字体并排版**，证明这是**文字渲染层**而非通知弹窗。
- 玩家可见表现：故事剧情场景底部半透明台词窗、逐句台词、字体/颜色/自动换行。它是文字描画的后台，故玩家「意识不到」其存在（不是可点功能，而是渲染台词文本的子系统）。
- ⚠️ 与**配置/接口对象** `_this[174405]`（DWORD 下标，byte `0xAA514`）区分：后者走 vtable 虚函数，以 `"message"`/`"readtex"`/`"MessageAutomes_1"`/`"set:SaveVersion"` 等字符串派发——是引擎的**配置读写/对外接口分发**对象（`0xFE`/`0x25B`/`0x2EE`/`0x1CA`/`0xAE` 等经它），**不是**文字消息窗。两者勿混同。

### 1.2 内嵌子对象基址（★同偏移不同 scope —— 轮 7 订正）

`Engine` 里嵌着若干**子对象**，它们**各自从 0 起算**，所以「同一个偏移」在不同 `scope` 下含义完全不同。查字段一律按 `analysis/fields.json` 的 **`scope + offset`** 定位（`report.js --field`），不要只按偏移找。

| 对象 | 基址（Engine 域） | `+0x408`（byte 1032）是什么 |
|---|---|---|
| `Engine` | `0x0` | **Input(DInput) 管理器对象** —— `sub_477DD0(_this + 1032)` 构造（raw 22461）；复位路径 `sub_478090/sub_477220(_this + 1032, …)`（raw 18058/18060）；`GetAsyncKeyState` 轮询（raw 91575）、`[259]` = `set_key_total` 默认 7（raw 92386）、`[a2+1432]` = 键位→VK 表、`[1176]` = VK→掩码位表 |
| `Scene`（内嵌在 `Engine+0x4ED10`，dword `_this[80708]`） | `0x4ED10`（byte 322832） | **绘制项容器** `std::map<uint32_t,DrawItem>`（= `Scene/0x408 draw_item_map`）；同族 **`Scene+0x428`** 是 mesh 容器（dword `[266]`） |

- ★**轮 7 订正（T-0097④）**：`fields.json` 曾有 `Engine/0x408 draw_item_container` 与 `Engine/0x428 mesh_container` 两条 **scope 错的重复条目** —— 两者都落在 **Scene** 而不是 Engine。已改为 `Engine/0x408 input_manager` + `Scene/0x428 mesh_container`；`0x408` 那条的绘制项语义由本来就存在的 `Scene/0x408 draw_item_map` 承担。
- ★**推论（scope 判据）**：凡「体内 `_this + 258`（dword）/`_this + 1032`（byte）是绘制项 map、或 `_this + 266` 是 mesh 表」的函数，它的首参就是 **Scene** —— 因为 opcode 侧一律以 `Engine + 80708`（dword）= **byte 322832 = `Engine+0x4ED10`** 传入（raw 31415 `sub_4AD0C0(_this + 80708,…)`、raw 31450 `sub_4ACF60(_this + 80708,…)`）。据此已订正 `sub_4AEEA0`/`sub_4ACF60`/`sub_4AD0C0` 的 `param0`（`Engine*` → `Scene*`）与 `sub_4AAD40`（→ 容器指针本身）。
- ★**轮 7 订正（基址 hex）**：本节初版把 Scene 基址写成 `Engine+0x4ECD0` —— **偏 64 字节**（0x4ECD0 = 322768；`Eng+80708` dword = **322832 = 0x4ED10**）。`fields.json` 里 12 处 `this->scene(+0x4ECD0)` 与 1 处 `0x4ECE0` 同类写法一并改为 `0x4ED10`。换算规则：**`Engine[i] = Scene[i − 80708]`**（例：`Engine[92333] = Scene[11625] = Scene+46500` 动画时钟 ms、`Engine[92338]/[92339] = Scene+46520/46524` 等待计时器开始/时长）。

## 2. 脚本帧 / 调用栈（字段真源见数据层）

每脚本一帧（`frames[40]`，**帧基址 `0x5D880`**、步长 0x78；★曾误记 0x5D894 —— 那只是 frame0 的 `str_table` 槽 = 帧+0x14）；`call-script` 压帧、`exit`/`ret` 弹回，涉及 `cur_script`(0x5D880)、`call_ret`(0x5D884)、帧内 `caller`(帧+0x4C)/返回栈、`engine_bool_flag`(0xA30D4) 等。字段偏移与语义一律见 `analysis/fields.json`（`Engine`/`ScriptContext` 作用域）；跨帧流程见 `./flow-control.md`。

## 3. 定位 `this`

- 方案：dispatch 表 RVA 指纹扫描（内存分块读 → 匹配 dispatch 表签名）找到 `this`；或 hook ECX 捕获。
- 坑：打包壳、ASLR（地址不固定，需 RVA）、`DEC` 编码（读到的值需 DEC 解）。
- 落地：`app/amayui-inspector` 已实测（见 `../04-app/inspector.md`）。

## 4. 交叉引用

- **opcode 全表/语义见 `./opcode-table.md`**；操作数速记见 `./operands.md`；进程读取工具见 `../04-app/inspector.md`。
