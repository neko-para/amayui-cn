---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `SCJUMP`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SCJUMP.BIN`（真源 `src/SCJUMP.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 章节进度机：按 `global 3f3d`（目标章号）分派到各章段，再在章内**按「该节是否已演」逐个找出第一个没演过的节**（`13d7`/`13d8`/`13d9`…），选中它并进入 ADV 模式（`mov (global-int 0) 1`） |
| 怎么进/出 | 由 `ALLMAP.BIN` 的跳转表循环 `call-script (local-ptr 0)` 调起（`src/ALLMAP.txt:23/58/95/174/219`；表基址 `global 708996` 由 `INIT2.txt:106` 登记为 0x5224）；运行期帧栈实测 `SYSTEM4 → ALLMAP → SCJUMP → $5$READY`。★本工程有**两套同名脚本**：`SCJUMP.BIN`（= 本条目，16059 条指令）与包变体 `$1$SCJUMP.txt`（698 行，门读 `1dd7`）—— 运行的是前者。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-36` | `eq (local-int 1) (global-int 3f3d) 1` | 入口分派：一串 `eq local1, global 3f3d, N` + `jcc` 把章号路由到各章段（3f3d=1 ⇒ label_00000390） |
| `38-45` | `label_00000390` | ★`3f3d == 1` 章的**第一节选择**：`ne local1, global 13d7, 1`（13d7 = 「序章 G0000 已演」标志）⇒ 已演就跳 `label_0000043c`；没演就查闸值 `gr f8080, 10` ⇒ 置 `g0 = 1`（进 ADV 模式）、`3f3c = 0`、`f8080 = 10`（再入锁） |
| `47-54` | `label_0000043c` | ★下一节的同型块（`13d8` = G0001「序章：遺跡に入る」）：实测命中路径正是这里 —— `13d7 = 1`、`13d8 = 0` ⇒ 置 `g0 = 1`、`3f3c = 1`、`f8080 = 10`（`ip=43` = 写发生在 idx 42） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 3f3d` | 目标章号（分派键）；`ALLMAP` 在 `b22a == 0` 时置 1（`src/ALLMAP.txt:35-37`） |
| `global 13d7 / 13d8 / 13d9 …` | ★**逐节「已演过」标志**（不是 `1dd7`）：各节的段设置写自己那一格（`SC0000.txt:1282` 写 13d7、`:1297` 写 13d8）。`SCJUMP` 找**第一个 0** 的节 ⇒ 这就是"章节进度"的载体 |
| `global 0` | ★**SYSTEM4 的実行モード分派键**（`src/SYSTEM4.txt:170-171` g0==1 ⇒ 内联 ADV 管线；`:427-460` 2=ALLMAP/3=REIGN/4=FIELD/6=NOVEL/7=STUDIO/8=DEAL）。`SCJUMP` 把它写成 1 = "进入 ADV シナリオ"。**顺带**：窗口例程还有一个 `eq local0, g0, 6` 的判据 —— ★`== 6` ⇒ **落下句** ⇒ `create-mesh`+`set-vertex-color` = **半透明黑幕**；`!= 6` ⇒ 跳 `label_…348` ⇒ `draw-texture 19640 11 …` = **纸窗**（`SN0000.txt:3078-3098` / `SC0000.txt:32664-32684`；两份用途别混，也不要再读反极性） |
| `global 3f3c` | 被选中的**节号**（G0000 ⇒ 0、G0001 ⇒ 1…），供 `SC0000` 的节分派器 `label_000047c4`（`:1259-1279`）使用 |
| `global f8080 (=1015936)` | ★再入闸值：`gr f8080, 10` 才放行；选中一节后立刻写 `10` 当再入锁（`SETADVFLAG` 抬成 INT_MAX 来"重新武装"） |

## 不变量（拿它做回归断言）

- 选节块是**同型重复**的：每块 = `ne local, 13dX, 1` + `jcc → 跳过` + `gr local, f8080, 10` + `jcc → 跳过` + 三条写（g0=1 / 3f3c=N / f8080=10）
- `mov (global-int 0) 1` 与 `mov (global-int 3f3c) N` 与 `mov (global-int f8080) 10` **成组出现**，且只在 `13dX != 1 且 f8080 > 10` 时执行
- 一次调用最多选中**一节**（选中后 f8080 = 10 ⇒ 后面的块一律过不了 `gr f8080, 10`）
- 本文件是**纯分派 + 门控写**：没有 draw/纹理操作，画面变化只能来自它写下的全局量

## 坑（踩过一次，别再踩）

- ★★**两套同名脚本**：`src/SCJUMP.txt`（16059 条指令，运行的就是它）与 `src/$1$SCJUMP.txt`（698 行，包 1 变体，门读 `1dd7`）。T-0102 §E 曾按后者逐行解读、却拿前者的日志当证据 ⇒ 整段极性/变量名都错（订正见 tickets/T-0102/evidence/chapter-chain-runtime-trace.md）
- ★**`jcc` 极性**：`op1≠0 → 跳 op2`、`op1==0 → 跳 op3`，目标 `0xFFFFFFFF` = **落下句**（引擎 `sub_4209B0` raw 29615-29639）。所以 `ne local, 13d7, 1` 后跟 `jcc local, ffffffff, LABEL` 的意思是"**13d7 已演(≠1 为假 → local=0) 就跳过本块**" —— 读反一次就会得出"门没挡住"的错误结论
- ★`global f8080` **在保存池之外**（池长 1015792）⇒ 它是进程内裸量；但 `13d7/13d8/…` **在池里**（随存档持久化）⇒ "哪一节演过"是存档状态，"闸值"不是
- 本文件是「一个脚本装全部章」的巨型分派（各章支结构同型，改一处要防同型支漏改）

## 缺口

- 只精读了 `3f3d = 1` 那一章的**前三个节选择块**（行 38-63）；其余章/节（同型）未逐支读
- `13d7..13dX` 的**总格数与最后一个节**未枚举（由各章段设置写点反推的活）

## 相关

- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 守卫测试：`app/amayui-emulator/test/t0102-chapter-chain.test.ts`

## 证据与备注

- 证据：src/SCJUMP.txt:6-36（分派）、38-54（节选择块，实测命中 47-54）；运行期帧栈与门量见 tickets/T-0102/evidence/chapter-chain-runtime-trace.md（SCJUMP.BIN ip=43、13d7=1 / 13d8=0 / f8080=INT_MAX）；行为守卫 test/t0102-chapter-chain.test.ts
- 备注：2026-09-23 订正：file 从 `src/$1$SCJUMP.txt`（包变体，698 行）改为运行期真正执行的 `src/SCJUMP.txt`；门量 1dd7 → 13d7/13d8；"`mov global0 1` 是元凶" → 它是**选中下一节的正常动作**。未读：其余各章支。
