# 03-engine · VM 与 opcode 分发（已归档）

> ⚠️ **已归档（deprecated）**：本文档曾记录 opcode 分发机制与 **boot→TITLE 路径审计**（88 个去重 opcode、64 个已核对、VM-可见 10 条、其余 54 条 fire-and-forget）。其内容已被下列**数据驱动工作流**取代，**不再更新**。
>
> - **opcode→handler / 语义 / 分析状态全表**（544 条）→ 真源 [`./opcode-table.md`](./opcode-table.md)。
> - **函数结论（含操作数原语 `readIntOperand_41BF50`/`writeIntOperand_42B4B0`/…）** → 数据层 `analysis/functions.json`（`scripts/report.js --index/--addr/--find` 查询）。
> - **字段/偏移模型（操作数池、帧、调用栈、`this` 布局）** → 数据层 `analysis/fields.json`。
> - **解释器主循环 `sub_412290` / 引擎复位 `sub_40DF10`** 深挖 → [`./engine-reset-mainloop.md`](./engine-reset-mainloop.md)。
> - **流程控制指令族**（exit / call-script / ret / exit-script / jmp / jcc / i143） → [`./flow-control.md`](./flow-control.md)。
>
> 仅保留一条快速回顾（如需入门）：
> - opcode 分发 = **一维函数指针表** `this + 0x0A509C + 4*opcode`，上限 `0x400`（越界落默认 `sub_418E30`）；表在 `Command` 构造器 `sub_415640` 初始化。
> - 解释器主循环 = `sub_412290`（`__noreturn`）：读 opcode → `dispatch_table[opcode](this)` → 按 arity 推进 IP。
> - `off_5530E0/5530E8` 是**游戏对象/类型方法表**，**不是** opcode dispatch（已排除）。
>
> 完整语义 / 每条 opcode 的实际行为一律以 `opcode-table.md` + 数据层为准。
