# 03-engine · VM 与 opcode 分发

## 1. opcode 分发机制

- ✅ opcode 分发 = **一维函数指针表**：`this + 0x0A509C + 4*opcode`，表上限 0x400（opcode 0..0x3FF）。
- ✅ 默认 handler：`sub_418E30`；表在 `Command` 对象构造器 `sub_415640` 初始化。
- ✅ 解释器主循环 `sub_412290`（`__noreturn`）：读 opcode → `dispatch_table[opcode](this)` → 按 arity 推进 IP。
- ✅ `off_5530E0/5530E8` 是**游戏对象/类型方法表**，**不是** opcode dispatch（已排除）。

## 2. opcode→handler 全表

- ✅ 全量表 544 条：含已知名称（age-shared 助记符）→ 本引擎 handler；另列具名助记符清单与回退默认 `sub_418E30` 清单。
  **完整的 opcode→引擎位置 / 语义 / 分析状态表**见 [`./opcode-table.md`](./opcode-table.md)。
- 常见类别：`set-string`/`show-text`/`display-furigana`/`concat`/`draw-texture`/`set-texture`（0x1F9→sub_4A3800）/`call-script`/`jcc`/`lea`(0x63)/`memcpy`(0x1B0)/`mod`(0x54)/`random`（`rand()%param2`）/`end-text-line`。
- ✅ 数据载入 op（0xAB/0x190/0x19F/0x1A1）只在 APPEND(DLC) 脚本出现；启动→TITLE 路径不触发。
- ✅ 渲染/子系统 op（0x1F7–0x208）语义已逐条核对：**fire-and-forget**（只读操作数、排队绘制、不写 VM 状态）。
- ✅ **boot→TITLE 路径 opcode 已逐条确认**：实读启动链（`SYSTEM4`→`INITCONFIG{0..5}`→`INITCHARM`→`CHECKCONFIG`→`INIT2`→数据表 INIT（AMINIT2/WDINIT/ALINIT/EBINIT/ITINIT/SKINIT/CGINIT/BTANINIT2…）→`LOGO`→`INIT`）直至到达 `TITLE.BIN`，共执行 **88 个去重 opcode**（其中数据载入 op `0xAB/0x190/0x19F/0x1A1` 实测未触发）。此前为`仅映射`/`推测`的 **64 个**已逐条读 `engine/天结_unpacked.exe_utf8.c` handler 体确证为 `已核对`（语义 + raw .c 行号写入 `opcode-table.md`）。
  - **VM 可见（触碰解释器状态）仅 10 条**：`0x6`(load-script-into-frame)、`0x88`、`0xAE`(存档版本分支)、`0x12C`(lookup-array-2d)、`0x130`(配置 getter→`_this[96983]`，决定是否播 LOGO)、`0x143`(派发脚本请求)、`0x149`(写全局槽)、`0x1A3`(load-int 写回 op1)、`0x2D5`(float mov)、`0x2DE`(字符串→索引查表)。
  - **其余 54 条**为**子系统 fire-and-forget 或引擎字段写**：读操作数后调子系统（图形/消息/字体/声音/输入/视频：`0x1F7-1FB` 纹理、`0x202/203` 颜色、`0x20F` movie、`0x320/322/323/32F/324` 网格顶点、`0x70-79/1C1/1CA/197…` 消息窗/字体、`0x2F6/2F8` 声音、`0x308` 触摸输入、`0x2BD/2DB/2FE/303` 重排字体）或写引擎字段 `_this[offset]`（`0x8B/0xFE/0x101/0x107/0x10B/0x10C/0x10F/0x1A2/0x1A4/0x1A9/0x212/0x213/0x21B/0x21C/0x248/0x252/0x25D/0x260/0x261/0x2EE/0x30A` 为按键绑定/消息系统配置/字符串哈希/每脚本槽标记），**均不触碰解释器可见的全局数组/脚本帧/ip/cur**（对 boot→TITLE 良性）。

## 3. 32 位语义与可测性

- 引擎为 x86 32 位，未见 int64；JS `number` 配合显式 32 位位运算可安全操作 2^53 内整数。
- 重写工程（`../04-app/emulator.md`）的 `ops.ts` 未实现 opcode 则**硬报错**；启动→TITLE 路径不触发数据载入 op。

## 4. 交叉引用

- 操作数访问原语见 `./operands.md`；`this` 布局见 `./runtime-memory.md`。
