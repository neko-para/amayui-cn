# 脚本台账 · `TITLE`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `TITLE.BIN`（真源 `src/TITLE.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 标题画面：背景/Logo/菜单（Game Start／Load Data／Eushly-chan Room／Option／Quit）+ 菜单悬停与点击派发 + **版本号显示**（「Version X.YY.ZZZZ」）。 |
| 怎么进/出 | 由启动链 call-script（LOGO 之后）进入；`i12e` 登记菜单命中区，点击经 `0x308/0x309` 命中项 → `0xa2/0xa3` 菜单派发表跳转（见 scripts 的 TITLE 菜单与 QUIT 路径）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `579-596` | `i2eb (local-string 0)` | ★版本号显示：`i2da 0 4 54c 32b c f 2 (local 40d)` 登记 CG 数字条记录 0 → `i2eb` 取 `set:GameVersion` 到串 0 → 三次 `i2c7`（1／2／4 **字节** 段）+ `i2ec`(atoi) + `i23b`（CG 数字条，flags=1 补零）分别画「1」「07」「0019」；两个小数点由 `draw-texture 76/77` 贴在 (0x3c9,0xf7)/(0x3df,0xf7) |
| `587-589` | `i2c7 (local-string 1) (local-string 0) 2 2` | 第二段：字节 [2,2) →「07」→ atoi=7 → `i23b 70 0 <v> 3cf f7 2 1`（2 位、补零 ⇒ 屏幕上是「07」） |
| `590-592` | `i2c7 (local-string 1) (local-string 0) 5 4` | 第三段：字节 [5,4) →「0019」→ atoi=19 → `i23b 72 0 <v> 3e5 f7 4 1`（4 位、补零 ⇒「0019」） |
| `6-19` | `copy-local-array (local-int cd) [0 9c 0 9c]` | 菜单几何数据表：`25d/261/265/269/26d` 是 5 项的四邻接矩形表（`menu-bind` 的悬停导航），`cd`..`dd` 是 5 个 size 盒（`i12e` 用，全是 `[0,0x9c,0,0x9c]`），`5`/`69` 是 baseX/baseY 数组（每项的命中盒左上角） |
| `41-64` | `mouse-callback 10 label_00000460` | 手柄/鼠标回调注册（`0xFB` 一列 + `0xCC`）与主循环：`get-input-type` 后按 `local 3fc`（输入类型 1/2/3）分派到 0x388c / 0x184 / 0x154 |
| `304-315` | `menu-bind 0 label_00001184` | 菜单表重建 + 派发：`menu-bind -1/0/1/2/3/4` 分别绑「无悬停 / Game Start / Load Data / Room / Option / Quit」，`menu-dispatch (local 3f7)` 按当前悬停项跳转 |
| `316-330` | `call-script 526b` | ★第 0 项 = Game Start：`call-script 526b`(GAMESTART) → 回来按 `global 0`（1=已选开始游戏）决定继续进 INITGAME 还是留在标题 |
| `95-102` | `i12e (local-int 3f5) (local-int 1) (local-int 3f0) (local-int 3f1) (local-int cd) (local-int 5) (local-int 69) (local-int 0)` | 鼠标悬停命中：`0x12E` 用 `cd`(盒 156×156) + `5`/`69`(baseX/baseY) + `local 0`(count=5) 逐个判点在矩形内 ⇒ 写回 `local 3f5`/`3f7`（−1 = 无） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local-string 0 / 1` | 版本串（来自 0x2EB）与它的切片（来自 0x2C7） |
| `local-int 3ed` | 切片经 0x2EC(atoi) 后的数值（交给 0x23B 画数字） |
| `local-int 40d` | CG 数字条记录 0 的**字距**（= 0−3 = −3；见 582 行的 `sub (local-int 40d) 0 3`） |
| `CG 数字条记录 0` | 纹理槽 4 / x0=0x54c / y0=0x32b / 字宽 0xc / 字高 0xf / 字内空隙 2（`i2da` 登记） |
| `菜单命中槽 3f7 / 3f3…` | `i12e` 命中区扫描结果与点击派发（见 TITLE 菜单相关测试） |
| `local-int cd/d1/d5/d9/dd` | `i12e` 的 5 个 size 盒（每项 4 值 dx0/dx1/dy0/dy1；TITLE 全是 `[0,0x9c,0,0x9c]`） |
| `local-int 5` | `i12e` 的 baseX 数组 = [0x44e, 0x3e0, 0x365, 0x2d9, 0x453]（1102/992/869/729/1107） |
| `local-int 69` | `i12e` 的 baseY 数组 = [0x126, 0x192, 0x1e5, 0x21f, 0x22a]（294/402/485/543/554） |
| `local-int 0` | `i12e` 的 count（= 5 个菜单项） |
| `local-int 3f7 / 3f5 / 3f6` | 当前/新/上次悬停项下标（3f7 是 `menu-dispatch` 的键） |

## 不变量（拿它做回归断言）

- 版本号三段 = `set:GameVersion` 的字节 [0,1) / [2,2) / [5,4) 各自 atoi 后按 1／2／4 位补零画出（例：1.07.0019 ⇒ 1 + 07 + 0019）
- 菜单 5 项的命中盒 = base `5[i]`/`69[i]` + 盒 156×156（`cd[i]`）⇒ 第 0 项（**右上角 Game Start**）中心 = (1102+78, 294+78) = **(1180, 372)**

## 坑（踩过一次，别再踩）

- ★三条指令缺一不可：`0x2EB`(取值) / `0x2C7`(字节切片) / `0x23B`(CG 数字条) —— 缺任一条片段为空 ⇒ `atoi(空串)=0` ⇒ 屏幕上出现占位值 `0.00.0000`（2026-09 实测：实现前截图就是它）
- `0x2C7` 的 op3/op4 是**字节**不是字符（SJIS 全角按 2 字节），且会做全角边界修正（丢首/末字节）
- ★`i12e` 的命中盒参数顺序是 `(out, ?, mx, my, size盒数组, baseX数组, baseY数组, count)` —— 盒是「相对 base 的 dx0/dx1/dy0/dy1」，不是「x/y/w/h」；把 base 当 w/h 会让整列命中区错位

## 缺口

- 菜单命中/派发（`i12e`/`0xa2`/`0xa3`）与背景演出未逐段读（layout 列出的只是版本号这一段）

## 相关

- 引擎常态能力：`engine-config-registry-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`texture-bind-synchronous-then-query`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x434830`（见 `analysis/functions.json`）
- 函数结论：`0x433FD0`（见 `analysis/functions.json`）
- 函数结论：`0x4311F0`（见 `analysis/functions.json`）
- 函数结论：`0x424970`（见 `analysis/functions.json`）
- 函数结论：`0x426420`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 守卫测试：`app/amayui-emulator/test/config-version-substr.test.ts`
- 守卫测试：`app/amayui-emulator/test/title-exit.test.ts`
- 守卫测试：`app/amayui-emulator/test/game-start-chain.test.ts`

## 证据与备注

- 证据：src/TITLE.txt:579-596；E3 断言见 test/config-version-substr.test.ts（启动链跑到 TITLE 后，CG 数字条各项的源矩形还原出 1.07.0019）；E4 截图 .tmp/vercheck-0-title.png
- 备注：版本号显示 + 菜单命中/派发（Game Start 一列）已读；Load Data / Room / Option / Quit 各自进去之后的路径未读。「进入游戏」的完整链路（TITLE → GAMESTART → INITGAME → SETFATE → SC0000 → SN0000）见 docs-new/03-engine/scene-start-flow.md。
