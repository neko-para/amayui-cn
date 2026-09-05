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

- ✅ **`jcc` 是两目标条件跳转**：`cond!=0`(真)→跳 A（A==0xFFFFFFFF 则不跳）；`cond==0`(假)→跳 B；`0xFFFFFFFF`=「该分支不跳/落到下句」占位。
- ✅ 统计（全工程）：287,931 条；`(ffffffff,label)` 假跳 285,335、`(label,ffffffff)` 真跳 2,546、双分支 `(label,label)` 50。

## 4. 脚本控制流结构化与伪代码

- ✅ 流程：`src/*.txt` 反汇编 → CFG（基本块/边）→ 支配/自然循环 → `if/if-else/while` 递归结构化 → 无括号 Python 风格伪代码。
- ✅ 工具：`scripts/re/structured_cfg.js`；业界 structuring 算法调研含在内。

## 5. 交叉引用

- 引擎侧脚本帧/调用栈见 `../03-engine/runtime-memory.md`；数据表结构见 `./drops.md`、`./skills.md` 等。
