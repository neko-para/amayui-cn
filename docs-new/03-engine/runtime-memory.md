# 03-engine · 引擎内部内存布局（this / 帧 / 调用栈）

> 本文件只列**引擎内部**（解释器/`this` 对象/脚本帧/调用栈）的布局。**游戏业务数据地址不在此**（见 `../02-data/`），
> 业务数据地址是**业务域常量**，与引擎内部无必然联系，除非有确切证据不与引擎混同。

## 1. `this` 对象模型（`engine/engine.hpp`）

`engine.hpp` 把已确认偏移落成 `struct Engine`（未知区 char 数组占位），含 `DEC/ENC`、`frames`、`script(cur)` 与读写访问器。

| 偏移 | 含义 |
|---|---|
| `this+0x5D800` | 全局 variant 数组基址（`global_int_base`） |
| `this+0x5EC8C` | `DEC/ENC` 的 key（DWORD 索引 `_this[97059]`） |
| `this+0xA509C` | opcode→handler 函数指针表基址 |
| `this+0x5D894` | `frames[40]`（脚本帧，每脚本一帧） |
| `this+0x5D880/5D884/5D888` | 调用栈链接字段（`callde/return` 压弹栈） |

> 注意：`engine.hpp` 用 **byte 偏移**，`_this[...]`（DWORD 索引）与字节偏移换算：DWORD 索引 ×4 = 字节偏移
> （如 `_this[97059] = 0x5EC8C/4`）。跨函数换算须按各自 `_this` 类型确认。

### 1.1 消息窗对象（台词显示子系统）

- **「消息系统」= AGE/System4 的台词/文本信息窗（メッセージウィンドウ）子系统**：位于 `this + 0x534C`（byte 21324）的一个大对象，负责剧情/系统文本的展示与渲染（几何、字体、文本度量、消息条目）。
- 证据（`engine/天结_unpacked.exe_utf8.c`）：
  - `show-text`(0x6E, `sub_41EB20`) 直接调 `(_this+0x534C)->sub_46BE30(消息id, 文本串, 0, _this[97055])` 送台词。
  - `end-text-line`(0x6F) / `wait-for-input`(0x72) 同样打在该对象。
  - 配置 opcode（boot→TITLE 必然执行）：`0x70`→`sub_45D660(_this+0x534C,…)` 设窗几何；`0x71`→`sub_45EC60`/`sub_48F000` 显示消息；`0x75–0x78`→写 `_this[21664..21667]` 等字段；`0x1A5`(`sub_4328F0`)/`0x2FE`(`sub_432DD0`)/`0x2BD`/`0x2DB`→设/重建字体；`0x1C1`/`0x1CA`/`0x197`/`0x2EE`/`0x303`→消息/自动消息/布局。
  - `sub_459F40`（该对象方法）体内全是 `LOGFONTA`/`HFONT`/`GetTextMetrics`(TEXTMETRICA)/GDI 字体创建——**重建字体并排版**，证明这是**文字渲染层**而非通知弹窗。
- 玩家可见表现：故事剧情场景底部半透明台词窗、逐句台词、字体/颜色/自动换行。它是文字描画的后台，故玩家「意识不到」其存在（不是可点功能，而是渲染台词文本的子系统）。
- ⚠️ 与**配置/接口对象** `_this[174405]`（DWORD 下标，byte 0xAA514）区分：后者走 vtable 虚函数，以 `"message"`/`"readtex"`/`"MessageAutomes_1"`/`"set:SaveVersion"` 等字符串派发——是引擎的**配置读写/对外接口分发**对象（`0xFE`/`0x25B`/`0x2EE`/`0x1CA`/`0xAE` 等经它），**不是**文字消息窗。两者勿混同。

## 2. 脚本帧 / 调用栈

- ✅ 每脚本一帧（`frames[40]`），帧含 `local_xxx`（局部池基址）、脚本头 `local_vars` 声明。
- ✅ `call-script`：把当前帧压栈 → 新帧；`callde/return` 压弹栈（`sub_41C6A0`/`sub_41C770`/`sub_40ED40`）；调用栈链接字段 `0x5D880/0x5D884/0x5D888`。
- ✅ **脚本上下文模型**（重写工程已实现）：`ScriptContext` 对象含局部变量、帧、当前脚本索引。

## 3. 定位 `this`

- 方案：dispatch 表 RVA 指纹扫描（内存分块读 → 匹配 dispatch 表签名）找到 `this`；或 hook ECX 捕获。
- 坑：打包壳、ASLR（地址不固定，需 RVA）、`DEC` 编码（读到的值需 DEC 解）。
- 落地：`app/amayui-inspector` 已实测（见 `../04-app/inspector.md`）。

## 4. 交叉引用

- opcode 分发见 `./vm-opcodes.md`；操作数原语见 `./operands.md`；进程读取工具见 `../04-app/inspector.md`。
