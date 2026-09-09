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

## 2. 脚本帧 / 调用栈（字段真源见数据层）

每脚本一帧（`frames[40]`，帧基址 `0x5D894` 区，步长 0x78/0x1E）；`call-script` 压帧、`exit`/`ret` 弹回，涉及 `cur_script`(0x5D880)、`call_ret`(0x5D884)、帧内 `caller`/返回栈、`engine_bool_flag`(0xA30D4) 等。字段偏移与语义一律见 `analysis/fields.json`（`Engine`/`ScriptContext` 作用域）；跨帧流程见 `./flow-control.md`。

## 3. 定位 `this`

- 方案：dispatch 表 RVA 指纹扫描（内存分块读 → 匹配 dispatch 表签名）找到 `this`；或 hook ECX 捕获。
- 坑：打包壳、ASLR（地址不固定，需 RVA）、`DEC` 编码（读到的值需 DEC 解）。
- 落地：`app/amayui-inspector` 已实测（见 `../04-app/inspector.md`）。

## 4. 交叉引用

- opcode 分发概览见 `./vm-opcodes.md`（已归档）；**opcode 全表/语义见 `./opcode-table.md`**；操作数速记见 `./operands.md`；进程读取工具见 `../04-app/inspector.md`。
