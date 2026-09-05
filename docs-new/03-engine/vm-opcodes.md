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

## 3. 32 位语义与可测性

- 引擎为 x86 32 位，未见 int64；JS `number` 配合显式 32 位位运算可安全操作 2^53 内整数。
- 重写工程（`../04-app/emulator.md`）的 `ops.ts` 未实现 opcode 则**硬报错**；启动→TITLE 路径不触发数据载入 op。

## 4. 交叉引用

- 操作数访问原语见 `./operands.md`；`this` 布局见 `./runtime-memory.md`。
