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
| [`03-掉落数据.md`](./03-掉落数据.md) | 单位掉落表结构（item/rate 连续数组）、`rate` 语义（概率刻度 vs rate/100 保底）、1000 容量、掉落调用链 FIELD-BTL-COMMITBTL-REWARD、随机池 `0x5697a` |
| [`04-存档与内存.md`](./04-存档与内存.md) | 存档 ≠ BIN 快照；进程内存扫描结论 |

## 核心结论速览

- **`call-script <index>`**：`<index>` = `SYS4INI.BIN` 文件位置（base）或 `0xnn000000+pos`（APPENDnn.AAI）。`2d→CHARMEDIT.BIN`、`5264→TITLE.BIN`、`1000174→$1$SCINIT.BIN` 等已实证。
- **`jcc` 是两目标条件跳转**：`cond!=0`(真)→跳 A（A==0xFFFFFFFF 则不跳）；`cond==0`(假)→跳 B。`0xFFFFFFFF` = 「该分支不跳/落到下句」占位符。全工程 287,931 条；`(ffffffff,label)` 假跳 285,335、`(label,ffffffff)` 真跳 2,546、双分支 `(label,label)` 50。
- **掉落表是 1000 单位容量的连续数组**：`item[0x53cd7c,0x53e104)` + `rate[0x53e104,0x53f48c)`，各 1000×5 槽；`unitId×5+槽` 索引。
- **`rate` 是概率刻度（0–100），非单纯数量**：战斗掉落用 `RNG < rate + 0xa3578` 判定（RNG 取 FIELD 初始化的随机池 `0x5697a`，值 0–99）；`rate/100` 只在 UNITECH（单位加入）作保底数量。`rate≥100` 必掉。
- **掉落调用链（脚本级，已确认）**：`SYSTEM4→FIELD→BTL→COMMITBTL→REWARD→ADDITEM`。
- **`0x53f48c` 区段恒 0 / 项目未用**：`COMMITBTL` 中 `X=0x53f48c[b*5]`、`X<=Y` 是**死判断**（通用逻辑，本项目未写），真实判定在 `RNG < rate+0xa3578`；`0x928a7` 的 Y 因此不影响掉落。
- **随机池 `0x5697a` 的初始化**：FIELD 用**嵌套循环 + `random 0x64` 指令**逐项填 1000 项（=0x32×0x14 = 50 行×20 列），`random`=`rand()%param2`，值 0–99；读档/撤退用 `memcpy` 走 `0xeafe5`（1000 项）持久化；计数器 `0x5b8af`（`%0x14`=20）随存档存于 `0xa8b85`。**src 字面量为 16 进制**（0x64=100）。
- **存档 ≠ BIN 快照**：`SAVE*.DAT` 是结构化动态状态流，**不持久化静态数据表**。
