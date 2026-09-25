---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `HISTORY`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `HISTORY.BIN`（真源 `src/HISTORY.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 回想（历史）画面：把 ADV 已经压进引擎记录表 `Font+3364` 的页按 5 行一屏列出来，逐行取字段画页码/图标/说话人名，**正文由 `i1d1`（`0x1D1`）让引擎重画**；自带列表游标、滚轮翻页与滑块。 |
| 怎么进/出 | 唯一入口 = ADV 侧边栏菜单的 action id 6：`$1$SC0330.txt:477-513` 里的 `call-script 31 // HISTORY`（callgraph 实测**335 个** `$n$SC*/SG*` 脚本都走这一格）。出口 = `ret`（`label_00000978` / `label_000056a8` / `label_00005710`）。它自己只 `call-script 46 // DRAWCHARM`（`src/HISTORY.txt:1586`），不调别的 BIN。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `109-131` | `label_000007c4` | 入口初始化：`call label_00003484`/`35a4`（建表/复位）→ 调 `3cd0`/`3d0c`/`14c4` 登记输入回调 → `read-mouse-pos` → 进 `label_000008e0` 的 `get-input-type` 轮询（`sleep 1`，直到 `local 85 == 1`） |
| `88-107` | `label_0000069c` | 给 5 个列表行窗（**窗号 = 3 + 行号**）逐个 `i071`（= 清该窗 + 压一条回看页 + 置组首，raw 74267-74276）+ 把该行的位置写进 `local 2c`（= `local 30` 起 5 格）与 `local 18`（5 格的 y 表） |
| `20-44` | `i1d0 (local-int 93) (local-int 94) (local-int 9a)` | ★**页收集**：`i1d0` 取页（op1 = 窗号 → `local 93`、op2 = 该页在记录表里的起始下标 → `local 94`、op3 = 步数 → `local 9a`，从 0 起递减 = 向旧翻）→ `sub 4a9 = -1` 后 `i1d3 (96) (97) (93) (94) (4a9)`（key = -1）判「该页有没有已画正文行」→ **`found != 0` 或 `win == 9`** 才把该步数写进 `local 9c[]`（`local 485` 计数） |
| `292-316` | `read-mouse-wheel (local-int 90)` | 右键 / 滚轮：`read-mouse-wheel (local 90)` 非 0 ⇒ `label_000027bc`；否则看 `local 82`（鼠标位）再 `i0ff`/`i100`（`local 8e` 作返回值 + `local 8f` 计时） |
| `318-336` | `joy-callback 0 label_00001614` | 输入回调登记：`joy-callback 0..c`（13 条，`label_00001614`…`label_00002794`）+ `mouse-callback 10 label_00000934`（右键 = 退出）；`local 8a = 1`、`local 8f = 0`、`read-mouse-wheel (local 90)` 作前置清账 |
| `752-831` | `label_00002be4` | 列表区（第 9..13 项）的字段收集：`i1d0` 取页 → `i1d3` 取 key `4`/`5`（`local 97`）→ 查 `global 52a49c`（→ `14acdb` 类别码）与 `14acdc`→`14b0c4`（→ `14acda`）→ `global 3b4e[14acda]` 判是否可点；命中后 `i1d3` key `7`/`8`（`local 4a3`）+ `i2f3`（语音选择器，`local 91`） |
| `1140-1214` | `label_00004980` | 逐行取字段（同样的两次 `i1d3`：key `10` → `local 49c`，key `4`/`5` → `local 97`）⇒ 决定 `global 14acda/14acdb`（列表项的类别码），再 `i1d3` key `0`（`local 4a5`）判有无；`label_00004d90` 用 `draw-texture 11 25a 55d ea 14 30c` 画选中标记 |
| `1240-1315` | `i1d1 (local-int 4a9) (local-int 94) 40 0 0` | ★**回看页正文重画**（全语料唯一调用点）：`i1d3` key `3`（`local 98`）取图标项 → `lookup-array-2d global 149d39` 命中则 `set-texture`+`draw-texture` 贴图标；`i1d3` key `0`/`1` 从 `global-string f612`/`f9fa` 取**说话人名** → `i07a (3+行号) 3c 4` + `show-text`（`label_00005488-1292`）；最后 `i07a (3+行号) (4b2) (4b3)` 设该行文本块原点，`i1d1 (3+行号) (local 94) 40 0 0` 让引擎把该页**正文**画进该窗 |
| `1338-1361` | `detach-texture (local-int 4a9) 1` | 逐行贴图收尾：`detach-texture` 卸旧图元 → 按 `local 88`（选中项）分支 `draw-texture 11 …` 画列表底/条纹/页码，并 `i217`（层序）/`i1fd`（滑块） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local-int 94` | ★当前页在**记录表** `Font+3364` 里的起始下标（`i1d0` 的 op2，也是 `i1d1` 的 op2） |
| `local-int 93` | 该页的窗号（`i1d0` 的 op1） |
| `local-int 9a` | 页步数（`i1d0` 的 op3）；从 0 起递减 = 向「旧」翻 |
| `local-ptr 0 / local-int 9c` | 收集到的**页步数数组**（`local 9c` 起；`local 485` = 收集到的页数） |
| `local-int 91` | 列表行号 0..4 ⇒ **窗号 = 3 + 91**（`label_0000069c` 与 `label_0000561c` 两处都是这个算法） |
| `local-int 88` | 当前选中项（列表游标，0..13；`label_0000576c` 起按它分支画） |
| `local-int 89` | 进入时记住的选中项（用于恢复） |
| `local-int 4a9` | ★**多义槽**：在页收集段是 `i1d0`/`i1d3` 的出参；在画正文段被复用成「目标窗号」=`3 + 91`（`src/HISTORY.txt:1311`） |
| `local-int 4b2 / 4b3` | 该行文本块的原点 (x, y)：`i07a <win> <4b2> <4b3>`（`label_0000561c`）；y 会按数据类型 `+28`/`+14` 累加（`1302`/`1308`） |
| `local-int 486 / 487 / 488` | 滑块/滚动条的分子/分母（`label_000003f8` 的 `div/mul/mod` 算出，喂 `i1fd`） |
| `local-int 7d/7e/7f/80/81/82` | 鼠标：当前位置（`7d`/`7e`）、上一帧位置（`7f`/`80`）、按键位（`81`）、拖拽态（`82`） |
| `local-int 4a3/49a/49b/49c/49d/4a5/4a6` | `i1d3`/`i2f3` 的输出槽（字段值/语音 id/循环位/类别码/布尔） |

## 不变量（拿它做回归断言）

- `i1d1` 的 op2 必须 `<` 记录表条数（引擎 `sub_4675A0` raw 80529 的越界门；不满足则整条指令什么都不做）
- `i1d1` 全脚本**只在 `label_0000561c` 一支被调用 1 次**（`src/HISTORY.txt:1314`），且在 `i07a <win> <4b2> <4b3>` 之后
- 列表行窗号恒 = `3 + local 91`（`91 ∈ 0..4` ⇒ 窗 3..7）
- 页收集的收页条件 = 「该页能查到 key = -1 的记录」**或**「该页窗号 == 9」（`label_000001b8` 的 `and (4ab) (4a9) (4aa)`）
- `i1d0` 的 op3 从 0 起逐轮 `sub …,1`（向旧翻），与 `local 485` 的步数数组下标同步递增

## 坑（踩过一次，别再踩）

- ★**`i1d1` 不是「页面渲染器」**：滚动位置、选中页高亮、翻页、页码全部由**本脚本**用 `i1d0`/`i1d3` + `draw-texture`/`i217`/`i1fd` 自己画；`0x1D1` 只负责「把从 op2 起的那一段**记录**重画进窗 op1」。引擎体 raw 81140-81522 全域搜索无 `FillRect`/`Rectangle`/`PatBlt`/区域填充（`tickets/T-0170` 实测）
- ★本脚本自己用 `i071` 给窗 3..7 清场（`src/HISTORY.txt:99`）⇒ **回看页表里会混进 7 条「本脚本压的页」**，而 `i1d0` 的步数是相对 `Font[860]` 游标走的，别假设页表只装 ADV 页
- ★`show-text`（`1292`）画的是**说话人名**（来自 `global-string f612`/`f9fa`），**不是正文**；正文只由 `i1d1` 画。两者必须在同一行窗上（先 `i07a` 设原点）
- ★`i1d3` 的 key 有 `-1/0/1/2/3/4/5/7/8/a` 多种，同一支里连续查两次是常态（先判布尔再取值）；key 由 ADV 脚本的 `i1d2` 压进记录
- ★`local 4a9` 在同一个函数里被复用成两种含义（i1d0/i1d3 的出参 → 目标窗号），读 `1311-1314` 那段时容易看错

## 缺口

- 未读：13 个 `joy-callback`（`label_00001614`..`label_00002794`）的体、`label_000028b8`..`label_00004694`、`label_0000576c` 之后的 1400-1703（含 `call-script 46 // DRAWCHARM` 那一支）
- 未读：它 `call` 的 9 个子例程（`3484`/`35a4`/`3cd0`/`3d0c`/`410c`/`4514`/`576c`/`64f4`/`16xxx`）的职责只按调用点推的
- `i1d1` 落点 `sub_4675A0` 的两处未实现（`missing[]`）：专用路径 `sub_4634B0`（窗对象 `+112 == 1`）与 `win[56]/[70]` 栏带四边形循环（raw 81498-81509）

## 相关

- 引擎常态能力：`backlog-drawn-row-recording`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`text-item-record-table`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`msgwin-backlog-cursor`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x41F720`（见 `analysis/functions.json`）
- 函数结论：`0x466000`（见 `analysis/functions.json`）
- 函数结论：`0x45D660`（见 `analysis/functions.json`）
- 函数结论：`0x45EC60`（见 `analysis/functions.json`）
- 函数结论：`0x45EFA0`（见 `analysis/functions.json`）
- 函数结论：`0x42D4A0`（见 `analysis/functions.json`）
- 函数结论：`0x45EBE0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 守卫测试：`app/amayui-emulator/test/recall-page-0x1d1.test.ts`
- 守卫测试：`app/amayui-emulator/test/op-1d0-page-index.test.ts`

## 证据与备注

- 证据：`src/HISTORY.txt` 实测读过 1-340 / 752-831 / 1128-1399（layout 逐段的 lines 就是读过的范围）；运行期断言见 `app/amayui-emulator/test/recall-page-0x1d1.test.ts` 的 ⑧（E3：滚轮位 8 ⇒ `HISTORY.BIN` ⇒ 该页切出 13 条记录 / 3 行真实序章正文）；入口见 `output/callgraph.json`（335 个调用者）
- 备注：★本页由 `tickets/T-0170` 新建（此前 `docs-new/05-scripts/` 没有 HISTORY 页，T-0168 的台账里已注明这一空缺）。`role` 里的「正文由 `i1d1` 让引擎重画」是本轮实测的关键：记录表里 13 条记录中只有 4 类，正文行来自渲染层 `sub_45F090` 的记账（见第二层 `backlog-drawn-row-recording`）。未读部分见 `gaps`。
