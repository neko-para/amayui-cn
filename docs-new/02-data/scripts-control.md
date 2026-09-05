# 02-data · 脚本控制流与调用（call-script / jcc / CFG）

> 本方向是**游戏业务数据**域：脚本字节码与静态数据表语义。其地址是**业务域常量**，与引擎内部无必然联系
> （引擎只负责执行脚本、消费业务数据）。引擎机制见 `../03-engine/`。

## 1. 分析对象

- `src/*.txt`（941 个）：反汇编脚本（`SC*` 剧情 / `SG*` 系统提示 / `*INIT` 数据表 / `$N$`=APPEND 追加包）。
- `data/*.txt`：静态数据表（只读日文基线）。
- `SYS4INI.BIN` / `APPENDnn.AAI`：脚本文件容器（LZSS）。容器逻辑见 `../03-engine/resource-loading.md`。

## 2. call-script 索引

- ✅ `call-script <index>`：`<index>` = `SYS4INI.BIN` 文件位置（base）或 `0xnn000000+pos`（`APPENDnn.AAI`）。
  实证：`0x2d→CHARMEDIT.BIN`、`0x5264→TITLE.BIN`、`0x1000174→$1$SCINIT.BIN`。

## 3. jcc 语义

- ✅ **`jcc`（opcode 0xA0）是两目标条件跳转，仅 3 个操作数**：`op1=条件`（非 0 为真）、`op2=真目标 A`、`op3=假目标 B`。
  - `op1≠0`(真)→跳 A（A==0xFFFFFFFF 则不跳/落下句）；`op1==0`(假)→跳 B；`0xFFFFFFFF`=「该分支不跳/落到下句」占位。
  - 三种写法：`jcc cond label ffffffff`（真才跳）/ `jcc cond ffffffff label`（假才跳，最常用）/ `jcc cond lab1 lab2`（if-else）。
  - 条件=布尔/标志（非零为真）；比较结果用 0xFFFFFFFF(真)/0(假)；查表返回 -1 表示「空/未找到」。
- ✅ 统计（全工程）：287,931 条；`(ffffffff,label)` 假跳 285,335、`(label,ffffffff)` 真跳 2,546、双分支 `(label,label)` 50、同标签 0。
- ⚠️ 勿读成「单目标比较 `jcc a b label`」——那只对 99.1% 单分支成立，遇 50 条双分支（label,label）会错。

## 4. 脚本控制流结构化与伪代码

- ✅ 流程：`src/*.txt` 反汇编 → CFG（基本块/边）→ 支配/自然循环 → `if/if-else/while` 递归结构化 → 无括号 Python 风格伪代码。
- ✅ 工具：`scripts/re/structured_cfg.js`；业界 structuring 算法调研含在内。

## 5. 交叉引用

- 引擎侧脚本帧/调用栈见 `../03-engine/runtime-memory.md`；数据表结构见 `./drops.md`、`./skills.md` 等。
