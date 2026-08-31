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
| [`08-脚本上下文与调用栈.md`](./08-脚本上下文与调用栈.md) | **每脚本帧（`ScriptContext frames[40]`）与 `call-script` 叠加**：帧布局/`local_xxx`（局部池基址）、脚本头 `local_vars` 声明、callde/return 的压栈弹栈（`sub_41C6A0`/`sub_41C770`/`sub_40ED40`）、调用栈链接字段（`0x5D884/0x5D888`） |
| [`09-clang解析与重定型基座.md`](./09-clang解析与重定型基座.md) | **无 IDA 用 libclang 解析 Hex-Rays 输出**：`engine/hxclang_prelude.h`（Win32/CRT/`std::` 桩）+ `scripts/re/hexrays_prep.py`（`this`→`_this`）+ C++ 模式调用；剩余诊断分类与为何不阻塞 AST 重写 |
| [`10-成员函数识别.md`](./10-成员函数识别.md) | **识别操作 Engine 的成员函数**：高偏移定位基准 + 调用图双向传播（`detect_members.py`）；清单 `member_functions.detected.txt`（1239 个） |
| [`11-重定型管线与产物.md`](./11-重定型管线与产物.md) | **一键从 `_utf8.c` 生成成员化/语义化版**：`retarget.py`（签名替换 + 字段标记 + 调用点 `this->` + 语义命名）、`semantic_names.json` 替换表、产物 `engine/engine.cpp` |

> **复原产物**：[`engine/engine.hpp`](../../../engine/engine.hpp) —— 把上表已确认的偏移（`this+0x5D800..` 全局 variant 数组基址、`this+0x5EC8C` key、`this+0xA509C` dispatch 表、`0x5D894` 处 `frames[40]`、`0x5D880/0x5D884/0x5D888` 调用栈字段）落成一个 `struct Engine` 的 C++ 布局，未知区一律 char 数组占位；含 `DEC`/`ENC`、`frames`/`script(cur)` 与读写访问器（配合 `07` 文档的 `this` 定位方案使用）。
>
> **一键重定型版**：`scripts/re/retarget.py` 从 `engine/天结_unpacked.exe_utf8.c` 直接生成 `engine/engine.cpp`（成员函数化 + 语义命名 + 字段标记 + 调用点 `this->`），详见 [`11-重定型管线与产物.md`](./11-重定型管线与产物.md)。

## 核心结论速览

- **引擎是通用解释器**，不含任何「单位/掉落字段」语义 —— 字段语义全在 src 字节码。
- **opcode 分发 = 一维函数指针表**：`this + 0x0A509C + 4*opcode`，上限 0x400，默认 `sub_418E30`；在 `Command` 对象构造器 `sub_415640` 里初始化。
- **解释器主循环 = `sub_412290`**（`__noreturn`）：读 opcode → `dispatch_table[opcode](this)` → 按 arity 推进 IP。
- **`off_5530E0/5530E8` 是游戏对象/类型方法表，不是 opcode dispatch**（已排除）。
