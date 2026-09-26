# ADV 侧栏排布的来源与"测试场景强制覆盖"的可行性（T-0189 取证 · 2026-09-26）

## 结论一句话

侧栏（"charm 表"）的**每格是什么动作**存在**一个脚本全局数组** `global 13b0[0..8]` 里，
**派发是点击时才读这张表**的 ⇒ **不需要动 SAVE.DAT、也不需要重启**：只要在点击前把这张表写成
想要的固定排布（如 `[d e 1 b c 2 3 4 5]`，`0xd = SAVE`、`0xe = LOAD`），排布就被定死了。

## 1. 侧栏的结构：位置写死、内容可配

| 事实 | 依据 |
|---|---|
| 9 个格子的**热点矩形写死在脚本里**（x=1180，y=114/164/214/…/514，w=80 h=47） | `src/SN0000.txt:54-62`（`i090 49c 72 50 2f …` 起，共 9 条） |
| 每格**是什么动作**由 `global 13b0` 这张表的第 i 项决定 | `src/SN0000.txt:401`：`lookup-array (local-ptr 0) (global-int 13b0) (global-int f8019)`（`f8019` = 格子 0..8） |
| 动作 id 语义（实测已见）：`1` = MENU、`0xd` = SAVE、`0xe` = LOAD | MENU：`SN0000.txt:415`（`eq (local-ptr 0) 1` → `call-script 2f // MENU`）；SAVE/LOAD：`SN0000.txt:586/596`（`eq … d` / `eq … e` 后分别 `mov (global-int f7ff0) 0` / `1` 再 `call-script 33 // SAVE`） |
| 侧栏的 hover 高亮项写 `global f7ffb`（4..12 对应格子 0..8） | `SN0000.txt:396`：`sub (global-int f8019) (global-int f7ffb) 4` |

## 2. 默认布局里**没有** SAVE/LOAD（这就是"不能写死格子序号"的原因）

`src/INITCHARM.txt:6`：

```
copy-local-array (global-int 13b0) [1 b c 2 3 4 5 6 7]     ← 9 项默认动作
… 循环 0..8：lookup-array (local-ptr 0) (global-int 13b0) i → save-int (local-ptr 0)
```

⇒ 默认 = `[1, 0xb, 0xc, 2, 3, 4, 5, 6, 7]`，**没有 0xd/0xe**（SAVE/LOAD）。用户口径与此一致：
「全默认的情况下侧边栏完全没有这两个按钮」——他是自己在游戏里把 SAVE/LOAD 配到高位的。

## 3. 玩家的排布从哪来 / 怎么持久化

| 环节 | 依据 |
|---|---|
| 默认值由 `INITCHARM` 填，并**逐项 `save-int`**（= 登记进 SAVE.DAT 的 str→int 表） | `src/INITCHARM.txt:6-18` |
| 玩家改排布 = `CHARMEDIT`（ADV 侧栏的"編集"项，`SN0000.txt:215` 的 `call-script 2d // CHARMEDIT`） | `docs-new/05-scripts/CHARMEDIT.md`：「两项交换（写 global 13b0 + save-int）」 |
| `save-int` 的键 = `%c%8.8x`（哨兵 3 + **操作数索引**），值 = 操作数**槽里的值** | 仿真侧 `app/amayui-emulator/src/vm/handlers/strings.ts:169-179`；引擎 `sub_434F60`（`analysis/opcodes.json` 的 0x1a2 evidence） |

⇒ 排布是**玩家数据**（SAVE.DAT）的一部分，默认布局"没有 SAVE/LOAD"是**引擎/脚本的正常语义**，
不是 bug。

## 4. 强制覆盖的可行位置（三层，推荐 H2 / H1）

| 方案 | 做法 | 优点 | 代价/风险 |
|---|---|---|---|
| **H1 环境开关** | 实例侧开关（如 `AMAYUI_FORCE_CHARM=d,e,1,b,c,2,3,4,5`）：在**配置装载之后**把 9 项写进 `global 13b0` 的数组对象 | ops 侧零改动；一开就有确定性排布 | 要找准确 hook 点（`INITCHARM` 之后 / 启动完成时）；要按**数组/Ref** 写，不能只改池里裸 dword |
| **H2 调试面写全局（推荐）** | `debug-query` 加写命令：`set-global <hex> <dec>`（可扩到 `set-array <hex> <idx> <dec>`）；ops 在点击前定死排布 | 通用（不只侧栏：任何"配置类"排障都能用，战斗/工房场景同理）；**完全不动玩家数据**；易加单测 | 要给 emulator 加一条命令（改 `debugCommand.ts` + `session.ts`，小） |
| **H3 纯 ops 层** | `snapshot` → 改 int 池里对应项 → `restore` | 今天就能用，不动 emulator | 笨重（帧边界时序）、且"数组对象"是否在快照里待确认（int 池 ≠ 数组对象） |
| ✗ 强制带 `cache/SAVE.DAT` | 起实例时把玩家的 `cache/SAVE.DAT` 放进 overlay | 立刻复现玩家排布 | **用户顾虑成立**：把玩家数据耦合进测试；默认布局被无声替换 ⇒ 失败模式难查；不同场景要求不同排布时无法表达。只应作为**显式 opt-in**（`--player-data cache`）的兜底，不作默认 |

## 5. 建议的落地顺序（写进 T-0189）

1. **H2**：`set-global`（+ `set-array`）调试命令 + 单测；`ops/load-from-adv.mjs` 用它把侧栏定死成
   `[d e 1 b c 2 3 4 5]`（SAVE/LOAD 在第 0/1 格），于是"从 ADV 读档"这条用例**不再依赖玩家配置**。
2. **H1**（可选，给不方便发命令的场景）：同一条覆盖逻辑包一个环境开关。
3. `ops/README.md` 的 ADV 用例前置从"要有带 SAVE/LOAD 的侧栏配置"改成"op 自己会把侧栏定死（H2）/ 或开 H1"。
4. 第二层 capability 的侧栏派发 note 补一句「排布来源 = charm 表 `global 13b0`；测试期可覆盖」。
