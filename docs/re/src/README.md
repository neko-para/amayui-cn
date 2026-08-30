# src 层面数据分析（docs/re/src）

> **分析对象**：游戏**脚本字节码**与**静态数据表**（属于 AGE 引擎「沙盒外」的业务语义层）。
> - 反汇编脚本：`src/*.txt`（如 `$1$AFINIT.txt`、`$1$AUTORUN.txt`、`SC*.txt`、`SG*.txt`、`EBINIT.txt`）。
> - 静态数据表：`data/*.txt`（如 `data/EBINIT.txt`）。
> - 脚本文件容器：`SYS4INI.BIN` / `APPENDnn.AAI`（LZSS → `scripts/alf/unpack_alf.mjs` + `lzss.mjs`）。
> - 调用图产出：`output/callgraph*.html/.gv/.json`（`scripts/build-callgraph.mjs`）。
>
> 说明：这些是**引擎通用解释器所消费的字节码/数据**，与引擎本体（`docs/re/engine/`）分开；字段语义在这里定，引擎只管「VM 核心 + 子系统 + 全局数组布局」。

## 目录

| 文档 | 主题 |
|---|---|
| [`01-call-script索引.md`](./01-call-script索引.md) | `call-script <index>` → 脚本文件名（SYS4INI/APPEND）解析 + 调用图/家族一致性 |
| [`02-jcc语义.md`](./02-jcc语义.md) | `jcc` 两目标条件跳转语义 + 统计 |
| [`03-掉落数据.md`](./03-掉落数据.md) | 单位掉落表结构（item/rate 连续数组）、`rate` 语义、1000 容量、drop 触发门控 |
| [`04-存档与内存.md`](./04-存档与内存.md) | 存档 ≠ BIN 快照；进程内存扫描结论 |

## 核心结论速览

- **`call-script <index>`**：`<index>` = `SYS4INI.BIN` 文件位置（base）或 `0xnn000000+pos`（APPENDnn.AAI）。`2d→CHARMEDIT.BIN`、`5264→TITLE.BIN`、`1000174→$1$SCINIT.BIN` 等已实证。
- **`jcc` 是两目标条件跳转**：`cond!=0`(真)→跳 A（A==0xFFFFFFFF 则不跳）；`cond==0`(假)→跳 B。`0xFFFFFFFF` = 「该分支不跳/落到下句」占位符。全工程 287,931 条；`(ffffffff,label)` 假跳 285,335、`(label,ffffffff)` 真跳 2,546、双分支 `(label,label)` 50。
- **掉落表是 1000 单位容量的连续数组**：`item[0x53cd7c,0x53e104)` + `rate[0x53e104,0x53f48c)`，各 1000×5 槽；`unitId×5+槽` 索引。
- **存档 ≠ BIN 快照**：`SAVE*.DAT` 是结构化动态状态流，**不持久化静态数据表**。
