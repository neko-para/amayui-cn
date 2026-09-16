# 脚本台账 · `SAVE`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SAVE.BIN`（真源 `src/SAVE.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 存档/读档界面（SAVE）：槽列表（每行用 `0x1A0` 读头拿状态/日期/游玩秒数）+ 存/读/删/复制与备注输入。 |
| 怎么进/出 | ADV 脚本 `call-script 33` 进入（`$1$SC0330.txt:590/600` 等；标题菜单也可进）⇒ 退出回调用者。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `67-81` | `lookup-array (local-ptr 2) (local-int 232) (local-int 21c6)` | ★槽列表行填充（f = 行号 0..13）：`232[0x3d4+f]` 取该行的**槽号** → `local 219`；再把七张字段数组的元素**引用**取进 `local-ptr 0/2/3/1/4/5/6`（`61d`=状态 / `a05`=年 / `ded`=月 / `11d5`=日 / `15bd`=时 / `19a5`=分 / `1d8d`=游玩秒）→ `i1a0 (local-ptr 0) (local-int 219) …`：`0x1A0` 的输出**穿引写进数组元素**（`op8` 秒丢进 `local-int 2175`） |
| `83-110` | `copy-local-array (local-int 148)` | 列表网格的方向键邻居表：14 行 × 每行 4 元组（`148`/`14c`/…/`1b0`），配合 `0x12E` 命中项做上下移动（与 CHARMEDIT 的 `145/149/14d` 同型） |
| `1643-1648` | `i0d4 10 1e label_000070c8 label_000070d4` | ★**存档动画的阶梯时间表**：`label_0000706c`（`SAVE.txt:928` 的 `call label_0000706c`，在「セーブしますか？」按"是"之后）= `i0d3`（清表）+ `i0d4 10 1e label_000070c8 label_000070d4`（30 条、每 16 ms 一条）+ `i0d4 1 2 label_000070d4 label_000070d4`（收尾哨兵）+ `i0d5 ffffffff` ⇒ 引擎按时间表**分 31 次**派发 `label_000070c8`（= `i20c` 帧刷新）与 `label_000070d4`（= `add (local-int 210) …1; ret`），整段约 481 ms；机制见 docs-new/03-engine/engine-reset-mainloop.md §B.6。 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local f` | 列表行号 0..13（`lt (local-int 21c6) (local-int f) 14`） |
| `local 21c6` | 记录下标 = `0x3d4 + f`（进 `232` 表取槽号） |
| `local 219` | 本行的**存档槽号**（来自 `232[0x3d4+f]`；也是 `i1a0` 的 op2） |
| `local-int 2175` | `i1a0` 的 op8（秒）丢弃处 —— 界面不显示秒 |
| `array 232 / 61d / a05 / ded / 11d5 / 15bd / 19a5 / 1d8d` | 槽号表 + 每槽的状态/年/月/日/时/分/游玩秒（按槽号索引） |
| `global 138e/138f/1390/1391` | `load-int` 进来的存档相关表（1390 在 ADV 侧与 `0x3de` 相加得槽号，见 SC0330） |

## 不变量（拿它做回归断言）

- 列表固定 14 行（`lt (local-int 21c6) (local-int f) 14`）
- `i1a0` 的槽号参数是 `232[0x3d4+f]` 里的**槽号**，不是行号 f

## 坑（踩过一次，别再踩）

- ★`i1a0` 的输出可以是**引用**操作数（`(local-ptr N)`）：写入端 `sub_42B4B0` 会**穿引写进数组元素** —— 这是本脚本一次调用填七张表的关键（`tickets`/台账见 analysis/functions.json 0x42DC70）
- `i1a0` 的写序是 op3..op9 先、op1 最后，且失败（1/2）时 op3..op9 **不动** ⇒ 必须先读 op1 再用日期
- 本界面不显示秒：op8 被丢进 `local-int 2175`
- ★`label_0000706c` 是 **0xD3/0xD4/0xD5 阶梯动画时间表**（不是普通循环）：`i0d5` **本条不前进**、由主循环的 `0x40` 门 + `sub_408F10` 调度，且 **派发次数 = 条目数 − 1**（30+2 条 ⇒ 31 次；最后一条只负责让 `i0d5` 的判据失效）。把这三条当 no-op 会**静默**跳过整段存档动画（脚本直接落到 `i0d5` 之后的 `ret`）。

## 缺口

- 只读了槽列表构建（67-110，含 `i1a0` 的两种形态）；存/读/删/复制、备注输入（AGERC 的 `SetNameLenMax`）与退出路径未读

## 相关

- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`stage-stepper-0x40-gate`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42DC70`（见 `analysis/functions.json`）
- 函数结论：`0x438120`（见 `analysis/functions.json`）
- 函数结论：`0x42D980`（见 `analysis/functions.json`）
- 函数结论：`0x42DDE0`（见 `analysis/functions.json`）
- 函数结论：`0x42AC40`（见 `analysis/functions.json`）
- 函数结论：`0x42E940`（见 `analysis/functions.json`）
- 函数结论：`0x42ACC0`（见 `analysis/functions.json`）
- 函数结论：`0x408F10`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/save-data.md`

## 证据与备注

- 证据：src/SAVE.txt:67-81（列表行填充 + `i1a0` 引用形态）/ 83-110（邻居表）；引擎侧见 analysis/functions.json 的 0x42DC70 与 0x438120
- 备注：未读：存/读/删/复制按钮的处理、备注输入（`i14b`/`set-agerc-export`）、退出与返回 ADV 的路径。
