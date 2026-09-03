# src 层面数据分析（docs/re/src）

> **分析对象**：游戏**脚本字节码**与**静态数据表**（属于 AGE 引擎「沙盒外」的业务语义层）。
> - 反汇编脚本：`src/*.txt`（如 `$1$AFINIT.txt`、`$1$AUTORUN.txt`、`SC*.txt`、`SG*.txt`、`EBINIT.txt`、`SKINIT.txt`）。
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
| [`03-掉落数据.md`](./03-掉落数据.md) | 单位掉落表结构（item/rate 连续数组）、`rate` 语义（概率刻度 vs rate/100 保底）、1000 容量、掉落调用链 FIELD-BTL-COMMITBTL-REWARD、随机池 `0x5697a`；§5 另含 `extract-unit-drops.js` 的文件扫描提取法与统计（合并自 `docs/单位掉落物.md`） |
| [`04-存档与内存.md`](./04-存档与内存.md) | 存档 ≠ BIN 快照；进程内存扫描结论 |
| [`05-技能数据.md`](./05-技能数据.md) | 技能表结构（名/简述/题头+详述 三段并列数组，stride 0x3e8）、题头文法与分类、数值字段骨架 |
| [`06-训练所数据.md`](./06-训练所数据.md) | DRINIT 训练所结构（训练者块 + TID + 「K−TID」字段列模型）、base/追加合并、条件/奖励字段语义 |
| [`07-单位种族与性别字段.md`](./07-单位种族与性别字段.md) | EBINIT 单位种族（`0x52a0b4+id`）/ 性别（`0x52a49c+id`）/ 属性（`0x52b054+id`）/ 星级（`0x5461ec+id`，0-based）字段及枚举 |
| [`08-地图地板数据.md`](./08-地图地板数据.md) | MPINIT 地图地板：`(b228=地点id, b229=序号)` 联合地图 id；大小参数 `5cd85`=列数 / `5cd86`=行数；`copy-local-array` 每块 `2×行` 条、每条 `2×列` 元素，起点 `0x5bd46`、步长 `0x41`；填值基础集 `{0,1,2}` + 可选地形码 |
| [`09-地图内单位.md`](./09-地图内单位.md) | STINIT 单位摆放（`eq … b222 <mapNo>` 关卡 id + `0x121e2+mapNo` 关名 + 单位槽寄存器区间）、STINIT2 场景（loc/seq）、特殊点位（采集/挖掘/刷怪旋涡）坐标/类型（原 `docs/地图内单位.md`） |
| [`10-物品与配方数据.md`](./10-物品与配方数据.md) | ITINIT 物品（id=`名称串−0x18e40`、并行数组字段）、PLINIT 建筑（`0x1f5ba`）、ALINIT 配方表（标记 1 物品/2 建筑 + 材料）；合并自 `docs/物品建筑配方.md` + 旧 `AGE脚本语言与物品数据结构.md` §4/§5 |
| [`11-说话人id与EBINIT.md`](./11-说话人id与EBINIT.md) | 说话人 id ↔ EBINIT（CNINIT 缺席补名、记录序+1=说话人 id、0x132 重复问题）；承接旧 `AGE脚本语言与物品数据结构.md` §7 |
| [`12-脚本控制流结构化与伪代码.md`](./12-脚本控制流结构化与伪代码.md) | 把 `src/*.txt` 反汇编还原为结构伪代码：CFG（基本块/边）→ 支配/自然循环 → `if/if-else/while` 递归结构化 → 无括号 Python 风格输出；含业界 structuring 算法调研；工具 `scripts/re/structured_cfg.js` |

## 核心结论速览

- **`call-script <index>`**：`<index>` = `SYS4INI.BIN` 文件位置（base）或 `0xnn000000+pos`（APPENDnn.AAI）。`2d→CHARMEDIT.BIN`、`5264→TITLE.BIN`、`1000174→$1$SCINIT.BIN` 等已实证。
- **`jcc` 是两目标条件跳转**：`cond!=0`(真)→跳 A（A==0xFFFFFFFF 则不跳）；`cond==0`(假)→跳 B。`0xFFFFFFFF` = 「该分支不跳/落到下句」占位符。全工程 287,931 条；`(ffffffff,label)` 假跳 285,335、`(label,ffffffff)` 真跳 2,546、双分支 `(label,label)` 50。
- **掉落表是 1000 单位容量的连续数组**：`item[0x53cd7c,0x53e104)` + `rate[0x53e104,0x53f48c)`，各 1000×5 槽；`unitId×5+槽` 索引。
- **`rate` 是概率刻度（0–100），非单纯数量**：战斗掉落用 `RNG < rate + 0xa3578` 判定（RNG 取 FIELD 初始化的随机池 `0x5697a`，值 0–99）；`rate/100` 只在 UNITECH（单位加入）作保底数量。`rate≥100` 必掉。
- **掉落调用链（脚本级，已确认）**：`SYSTEM4→FIELD→BTL→COMMITBTL→REWARD→ADDITEM`。
- **`0x53f48c` 区段恒 0 / 项目未用**：`COMMITBTL` 中 `X=0x53f48c[b*5]`、`X<=Y` 是**死判断**（通用逻辑，本项目未写），真实判定在 `RNG < rate+0xa3578`；`0x928a7` 的 Y 因此不影响掉落。
- **随机池 `0x5697a` 的初始化**：FIELD 用**嵌套循环 + `random 0x64` 指令**逐项填 1000 项（=0x32×0x14 = 50 行×20 列），`random`=`rand()%param2`，值 0–99；读档/撤退用 `memcpy` 走 `0xeafe5`（1000 项）持久化；计数器 `0x5b8af`（`%0x14`=20）随存档存于 `0xa8b85`。**src 字面量为 16 进制**（0x64=100）。
- **存档 ≠ BIN 快照**：`SAVE*.DAT` 是结构化动态状态流，**不持久化静态数据表**。
- **技能表是「三段并列定长数组」**（`skillId = 名串地址 − 0x1d4f4`，段间 stride `0x3e8`=1000）：名 `0x1d4f4+id`、简述 `0x1d8dc+id`、题头/详述 `0x1dcc4+2id` 与 `+1`（**2 槽/技能**）。450 技能、id 稀疏于 1..803，六文件零冲突；`set-string` 汉化覆盖 100%；唯一 #40「進行不可」只有名字无描述。数值字段 `mov` 为「字段主序 1000-stride 数组 + 多槽二维子数组」，已解释 89.6%，语义未定。
