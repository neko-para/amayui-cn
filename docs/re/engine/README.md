# 引擎分析（docs/re/engine）

> **分析对象**：AGE 引擎二进制本体及其反汇编。
> - 加壳版：`raw/AGE.EXE`（1,007,104 B，ASProtect）；`raw/天结.exe`（同壳 + 汉化 overlay）。
> - 已脱壳干净版：`raw/天结_unpacked.exe`（1,746,944 B）—— **分析主对象**。
> - 反汇编：`engine/天结_unpacked.exe_utf8.c`（Hex-Rays 全量 C）、`engine/天结_unpacked.exe_utf8.lst`（IDA 清单，含数据区）。
>
> ⚠️ 原始 `engine/天结_unpacked.exe.c` 为 Shift-JIS、`.lst` 为 Shift-JIS+GBK 混编，`read` 工具读不了；一律改读 `*_utf8.*`。转换脚本 `.tmp/convert_to_utf8.py`。

## 目录

| 文档 | 主题 |
|---|---|
| [`01-加壳与拆壳.md`](./01-加壳与拆壳.md) | AGE.EXE / 天结.exe 的 ASProtect 判定；`天结_unpacked.exe` 脱壳干净判定；OEP 与「run+dump」可行性 |
| [`02-引擎架构.md`](./02-引擎架构.md) | 通用解释器架构；与业务(字段语义)的边界；`uXXXX` vs `sub_XXXXXX` 地址对齐问题；静态分析路线 |
| [`03-opcode分发与解释器.md`](./03-opcode分发与解释器.md) | **opcode→handler 分发机制的最终结论**（一维函数指针表 + 解释器主循环 + 操作数访问原语 + 算术簇对照） |

## 核心结论速览

- **引擎是通用解释器**，不含任何「单位/掉落字段」语义 —— 字段语义全在 src 字节码。
- **opcode 分发 = 一维函数指针表**：`this + 0x0A509C + 4*opcode`，上限 0x400，默认 `sub_418E30`；在 `Command` 对象构造器 `sub_415640` 里初始化。
- **解释器主循环 = `sub_412290`**（`__noreturn`）：读 opcode → `dispatch_table[opcode](this)` → 按 arity 推进 IP。
- **`off_5530E0/5530E8` 是游戏对象/类型方法表，不是 opcode dispatch**（已排除）。
