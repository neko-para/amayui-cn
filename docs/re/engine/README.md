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
| [`05-操作数访问原语.md`](./05-操作数访问原语.md) | **`sub_41BF50`/`sub_41C300`（读 int/float 操作数）**：全类型 switch、`DEC` 异或+循环移位去混淆、0x8003/0x8009 整型数组批量 |
| [`06-opcode到handler映射表.md`](./06-opcode到handler映射表.md) | **opcode→已知名称(age-shared)→本引擎 handler 全量表**（544 条）+ 具名助记符清单 + 回退默认 `sub_418E30` 清单 |
| [`07-提取全局数据与定位this.md`](./07-提取全局数据与定位this.md) | **从运行进程提取 global 数据**：数据路径（`global_int_base`/`key`/`DEC` 间接+编码）+ 定位 `this` 的方案（hook ECX / dispatch 表指纹扫描）+ 打包壳/ASLR/DEC 坑 |

## 核心结论速览

- **引擎是通用解释器**，不含任何「单位/掉落字段」语义 —— 字段语义全在 src 字节码。
- **opcode 分发 = 一维函数指针表**：`this + 0x0A509C + 4*opcode`，上限 0x400，默认 `sub_418E30`；在 `Command` 对象构造器 `sub_415640` 里初始化。
- **解释器主循环 = `sub_412290`**（`__noreturn`）：读 opcode → `dispatch_table[opcode](this)` → 按 arity 推进 IP。
- **`off_5530E0/5530E8` 是游戏对象/类型方法表，不是 opcode dispatch**（已排除）。
