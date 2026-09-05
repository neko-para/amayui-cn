# 数据分析（docs/data）· 权威 README

> **地位**：这是「**游戏数据分析**」方向的**新版权威 README**，收敛并取代旧散篇（`docs/re/src/*`、
> `docs/re/README.md` 中属于数据/业务的部分、`app/amayui-inspector`、`app/amayui-toolkit` 的提取口径说明）。
> 旧散篇**保留为详细参考**，本文件用相对链接指向它们；口径不一致时以**本文件 + `docs/re/README.md` 地址表**为准。
> 与引擎 VM/opcode 机制相关的**字节码执行细节归 `docs/engine`**（交叉引用），本文件聚焦「引擎沙盒外」的业务语义层。

## 1. 分析对象与域划分

| 对象 | 说明 |
|---|---|
| `src/*.txt`（941 个） | 反汇编脚本（`SC*` 剧情 / `SG*` 系统提示 / `*INIT` 数据表 / `$N$`=APPEND 追加包）——**翻译域真值**（见 docs/translation） |
| `data/*.txt`（941 个） | 静态数据表（只读日文基线） |
| `SYS4INI.BIN` / `APPENDnn.AAI` | 脚本文件容器（LZSS → `scripts/alf/`） |
| `SAVE*.DAT` | 存档（≠ BIN 快照） |
| `output/*` | 提取/调用图产物（`callgraph*.html/.gv/.json`、`*.csv`） |

> 关键边界：引擎（docs/engine）是「VM 核心 + 子系统 + 全局数组布局」；字段语义、数据表结构在**这里**定。
> **游戏业务数据的地址（如 `0x53e104` 掉落、`0x1d4f4` 技能名、`0x5697a` 随机池等）是业务域常量，与引擎内部无必然联系**；
> 除非有确切证据（进程内实测读取并与脚本语义互证），**不要把业务数据地址与引擎机制混同**。

## 2. 核心结论（三级事实度：✅已确认 / 🟡推测 / ⬜未解）

### 2.1 脚本索引与调用
- ✅ **`call-script <index>`**：`<index>` = `SYS4INI.BIN` 文件位置（base）或 `0xnn000000+pos`（`APPENDnn.AAI`）。
  实证：`2d→CHARMEDIT.BIN`、`5264→TITLE.BIN`、`1000174→$1$SCINIT.BIN`。
- ✅ **`jcc` 是两目标条件跳转**：`cond!=0`(真)→跳 A（A==0xFFFFFFFF 则不跳）；`cond==0`(假)→跳 B；`0xFFFFFFFF`=「该分支不跳」占位。
  全工程 287,931 条：`(ffffffff,label)` 假跳 285,335、`(label,ffffffff)` 真跳 2,546、双分支 `(label,label)` 50。

### 2.2 掉落数据
- ✅ **1000 单位容量的连续数组**：`item[0x53cd7c,0x53e104)` + `rate[0x53e104,0x53f48c)`，各 1000×5 槽；`unitId×5+槽` 索引。
- ✅ **`rate` 是概率刻度（0–100），非单纯数量**：战斗掉落用 `RNG < rate + 0xa3578` 判定（RNG 取 FIELD 随机池 `0x5697a`，值 0–99）；`rate/100` 只在 UNITECH（单位加入）作保底数量；`rate≥100` 必掉。
- ✅ **掉落调用链（脚本级）**：`SYSTEM4→FIELD→BTL→COMMITBTL→REWARD→ADDITEM`。
- ✅ **`0x53f48c` 区段恒 0 / 项目未用**：`COMMITBTL` 中 `X=0x53f48c[b*5]`、`X<=Y` 是死判断，真实判定在 `RNG < rate+0xa3578`；`0x928a7` 的 Y 不影响掉落。
- ✅ **随机池 `0x5697a` 初始化**：FIELD 用嵌套循环 + `random 0x64` 指令逐项填 1000 项（=0x32×0x14=50 行×20 列），`random`=`rand()%param2`、值 0–99；读档/撤退用 `memcpy` 走 `0xeafe5`（1000 项）持久化，计数器 `0x5b8af`（`%0x14`=20）存于 `0xa8b85`。**src 字面量为 16 进制**（0x64=100）。

### 2.3 存档与内存
- ✅ **存档 ≠ BIN 快照**：`SAVE*.DAT` 是结构化动态状态流，**不持久化静态数据表**。

### 2.4 技能表
- ✅ **三段并列定长数组**（`skillId = 名串地址 − 0x1d4f4`，段间 stride `0x3e8`=1000）：名 `0x1d4f4+id`、简述 `0x1d8dc+id`、题头/详述 `0x1dcc4+2id` 与 `+1`（**2 槽/技能**）。
- ✅ **450 技能**、id 稀疏于 1..803，六文件零冲突；`set-string` 汉化覆盖 100%；唯一 #40「進行不可」只有名字无描述。
- 🟡 数值字段 `mov`（`0x6c65a2`：字段主序 1000-stride 数组 + 多槽二维子数组）已解释 89.6%，**语义未定**。

### 2.5 其它数据域
- ✅ **训练所（DRINIT）**：训练者块 + TID + 「K−TID」字段列模型；base/追加合并；条件/奖励字段语义。
- ✅ **单位字段**：种族（`0x52a0b4+id`）/ 性别（`0x52a49c+id`）/ 属性（`0x52b054+id`）/ 星级（`0x5461ec+id`，0-based）。
- ✅ **地图地板（MPINIT）**：`(b228=地点id, b229=序号)` 联合地图 id；大小参数 `5cd85`=列数 / `5cd86`=行数；`copy-local-array` 每块 `2×行` 条、每条 `2×列` 元素，起点 `0x5bd46`、步长 `0x41`；填值基础集 `{0,1,2}` + 可选地形码。
- ✅ **地图内单位（STINIT/STINIT2）**：`eq … b222 <mapNo>` 关卡 id + `0x121e2+mapNo` 关名 + 单位槽寄存器区间；STINIT2 场景（loc/seq）；特殊点位（采集/挖掘/刷怪旋涡）坐标/类型。
- ✅ **物品/建筑/配方（ITINIT/PLINIT/ALINIT）**：ITINIT 物品（id=`名称串−0x18e40`、并行数组字段）、PLINIT 建筑（`0x1f5ba`）、ALINIT 配方表（标记 1 物品/2 建筑 + 材料）。
- ✅ **说话人 id ↔ EBINIT（CNINIT 缺席补名、记录序+1=说话人 id、0x132 重复问题）**。
- 🟡 **脚本控制流结构化**：CFG（基本块/边）→ 支配/自然循环 → `if/if-else/while` 递归结构化 → 无括号 Python 风格伪代码；工具 `scripts/re/structured_cfg.js`。

## 3. 数据提取口径（两套，以 toolkit 为准）

历史上有两套提取口径（旧主工程多文件 JSON vs `amayui-toolkit` 单一 `metadata.json`），**以 toolkit 统一 schema 为准**：

| | 旧主工程 | amayui-toolkit（现行，推荐） |
|---|---|---|
| 产物 | `scripts/extract-recipes.js`/`extract-unit-drops.js` → 多文件、两任务 JSON | `app/amayui-toolkit/scripts/extract-metadata.mjs` → 单一 `public/data/metadata.json`（统一 schema + 中文名，`public/` gitignored，CI 在 deploy 分支生成） |
| 数据源 | — | `src/`（唯一权威源），中文名取 `set-string "日文|中文"` 的 `|` 后半段 |
| 计数 | 旧 | `items=923`、`buildings=113`、`recipes=458`（物品 356/建筑 102）、`units=373`（带掉落 214）、`dropEntries=671`、去重掉落物品 254、`maps=145`、`locations=34`、`skills=450`（带描述 449）、`trainings[]`（DRINIT） |

- `metadata.json` 已含 `trainings[]`（训练所，DRINIT；`skillId` 100% 命中 `skills[]`）、`units[].{race,gender,attribute}`（枚举见 `app/amayui-toolkit/src/types/metadata.ts` 的 `RACE_NAME/GENDER_NAME/ATTR_NAME`）。
- 特例：`0xcb 系留员神殿兵` 属性为 null（模板占位）；「未汉化项」`nameZh===name` 物品 40/建筑 8/单位 6，前端按「未汉化」回退展示。

## 4. app 工具对本方向的验证

- **app/amayui-inspector**（进程内存查看器）：用 dispatch 表 RVA 指纹定位 `this`（实测 `0x2FDC020`，模块基址 `0x400000`），
  读 `key` + `DEC` 校验——单位 140/141 掉落样本 `item=2813/rate=100`，与 `docs/re/engine/07` 实测一致；
  控制流/帧模型（`cur_script=1`、帧 37 `caller=0xFFFFFFF6(-10)`、`frame_arg=0x05000000`）与引擎侧结论吻合。详见 `app/amayui-inspector/README.md`、`app/amayui-inspector/docs/技术方案.md`。

## 5. 旧散篇导航

| 主题 | 详细出处 |
|---|---|
| call-script 索引 | [`../re/src/01-call-script索引.md`](../re/src/01-call-script索引.md) |
| jcc 语义 | [`../re/src/02-jcc语义.md`](../re/src/02-jcc语义.md) |
| 掉落数据 | [`../re/src/03-掉落数据.md`](../re/src/03-掉落数据.md) |
| 存档与内存 | [`../re/src/04-存档与内存.md`](../re/src/04-存档与内存.md) |
| 技能数据 | [`../re/src/05-技能数据.md`](../re/src/05-技能数据.md) |
| 训练所数据 | [`../re/src/06-训练所数据.md`](../re/src/06-训练所数据.md) |
| 单位种族与性别字段 | [`../re/src/07-单位种族与性别字段.md`](../re/src/07-单位种族与性别字段.md) |
| 地图地板数据 / 地图内单位 | [`08`](../re/src/08-地图地板数据.md) · [`09`](../re/src/09-地图内单位.md) |
| 物品与配方数据 | [`../re/src/10-物品与配方数据.md`](../re/src/10-物品与配方数据.md) |
| 说话人 id 与 EBINIT | [`../re/src/11-说话人id与EBINIT.md`](../re/src/11-说话人id与EBINIT.md) |
| 脚本控制流结构化与伪代码 | [`../re/src/12-脚本控制流结构化与伪代码.md`](../re/src/12-脚本控制流结构化与伪代码.md) |

## 6. 冲突与取舍（本轮收敛）

| 冲突点 | 采纳结论 |
|---|---|
| `rate` 是数量还是概率 | 概率刻度（0–100）；`rate/100` 只在 UNITECH 保底；`rate≥100` 必掉 |
| 掉落是否用 `0x53f48c` 的 `X<=Y` 判定 | 否（死判断恒真）；真实判定 `RNG < rate+0xa3578` |
| 随机池 `0x5697a` 语义 | 战斗随机池（值 0–99），FIELD 填充、读取经 `0xeafe5` 持久化 |
| `rate` 字面量进制 | **16 进制**（0x64=100） |
| 数据提取口径 | 以 `amayui-toolkit` 单一 `metadata.json` 统一 schema 为准；旧多文件 JSON 作废 |
| 数据真值来源 | `src/*.txt`（翻译真值）；数据提取以 `src/` 为权威源，不依赖 `docs/translate` |

## 7. 待确认 / 未解

- 🟡 技能数值字段 `0x6c65a2` 的语义（字段主序 + 多槽二维数组，仅 89.6% 解释）。
- 🟡 单位「副标题」地址在 `src` 多落 `17e` 区间，与旧提取脚本判据（`17f-181`）表面不一致；本工程沿用已验证判据。
- ⬜ 部分数据表字段（如地图点数/特殊点位类型）的完整枚举仍在补充。
