---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

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
| `597-614` | `i2eb (local-string 0)` | ★版本号显示：`i2da 0 4 54c 32b c f 2 (local 40d)` 登记 CG 数字条记录 0 → `i2eb` 取 `set:GameVersion` 到串 0 → 三次 `i2c7`（1／2／4 **字节** 段）+ `i2ec`(atoi) + `i23b`（CG 数字条，flags=1 补零）分别画「1」「07」「0019」；两个小数点由 `draw-texture 76/77` 贴在 (0x3c9,0xf7)/(0x3df,0xf7) |
| `601-603` | `i2c7 (local-string 1) (local-string 0) 2 2` | 第二段：字节 [2,2) →「07」→ atoi=7 → `i23b 70 0 <v> 3cf f7 2 1`（2 位、补零 ⇒ 屏幕上是「07」） |
| `604-606` | `i2c7 (local-string 1) (local-string 0) 5 4` | 第三段：字节 [5,4) →「0019」→ atoi=19 → `i23b 72 0 <v> 3e5 f7 4 1`（4 位、补零 ⇒「0019」） |
| `6-19` | `copy-local-array (local-int cd) [0 9c 0 9c]` | 菜单几何数据表：`25d/261/265/269/26d` 是 5 项的四邻接矩形表（`menu-bind` 的悬停导航），`cd`..`dd` 是 5 个 size 盒（`i12e` 用，全是 `[0,0x9c,0,0x9c]`），`5`/`69` 是 baseX/baseY 数组（每项的命中盒左上角） |
| `41-64` | `mouse-callback 10 label_00000460` | 手柄/鼠标回调注册（`0xFB` 一列 + `0xCC`）与主循环：`get-input-type` 后按 `local 3fc`（输入类型 1/2/3）分派到 0x388c / 0x184 / 0x154 |
| `304-315` | `menu-bind 0 label_00001184` | 菜单表重建 + 派发：`menu-bind -1/0/1/2/3/4` 分别绑「无悬停 / Game Start / Load Data / Room / Option / Quit」，`menu-dispatch (local 3f7)` 按当前悬停项跳转 |
| `316-330` | `call-script 526b` | ★第 0 项 = Game Start：`call-script 526b`(GAMESTART) → 回来按 `global 0`（1=已选开始游戏）决定继续进 INITGAME 还是留在标题 |
| `95-102` | `i12e (local-int 3f5) (local-int 1) (local-int 3f0) (local-int 3f1) (local-int cd) (local-int 5) (local-int 69) (local-int 0)` | 鼠标悬停命中：`0x12E` 用 `cd`(盒 156×156) + `5`/`69`(baseX/baseY) + `local 0`(count=5) 逐个判点在矩形内 ⇒ 写回 `local 3f5`/`3f7`（−1 = 无） |
| `526-557` | `mov (global-int f8c46) 4f9e` | ★标题立绘：`jcc (global-int a9d0)` 分叉 —— **!=0 走静态贴图回落**（`set-texture 5273 5` = SO004A，`i208 5` 取尺寸后按 (宽/2, 高) 摆位，526-530 / 581-587）；**==0 走 Live2D**：`mov f8c46 = 4f9e`（TITLE.MOC 文件 id）、`mov f8c47 = 0`（实例槽）→ 循环 20 次 `lookup-array (global 708ab6) (global f807f)` + 间接 `call-script`（544-548，表里是 SETL2DMOC 家族）→ 回来 `i352 0 0 0`（预置待绑纹理号 0）+ `i34e 5274 0 0 1`（装 TITLE.MTN：动作槽 0、实例槽 0、循环 1）→ `label_000024a4`（**只有 L2D 支会走到**）`i344 14 0` 建 572B 立绘节点（key 14、L2D 槽 0） |
| `552-556` | `i34e 5274 0 0 1` | L2D 装载收尾：`i352 0 0 0` = 预置"待绑纹理号 0"（`0x352` op2==0 ⇒ 纹理号）→ `i34e 5274 0 0 1` = 装 `.MTN`（文件 id 0x5274 = TITLE.MTN、动作槽 0、实例槽 0、循环位 1）；★**装载即入队**（引擎 `sub_4BCA20(queue, motion, 1)`），推进则绑在节点绘制那一次调用上。 |
| `589-590` | `i344 14 0` | ★L2D 支独有：`i344 14 0` = 在 `Scene+1096` 取/建 572B 立绘节点（key 14）、**`record[1] = 0` = L2D 实例槽号**（不是纹理槽号）。引擎 `sub_4B0360` 只在"该槽真有模型"时才画这个节点 ⇒ 这一条是"标题立绘出画"的最后一步。 |
| `520-530` | `set-texture 5272 4 (local-int 40d)` | ★★标题画面**全部美术都建在纹理槽 4 上**（图 0x5272；静态立绘分支另用槽 5 = 0x5273）⇒ 读档按存档重绑槽 4（`records[4].flag==1 ⇒ 0xB37`）时，这些项**整体改画成存档那张图** |
| `333-341` | `call-script 33  // SAVE` | ★Load Data 分支（`label_00001240`）：`play-sound-effect`/`i0b5`/两个全局 + `call-script 33`(SAVE.BIN) —— 前后**没有任何 detach/i1f6/release-texture** ⇒ 打开读档菜单时标题画面的绘制项全部活着 |
| `634-638` | `draw-texture 12c 4 5a0 0 9c 9c 44e 126` | 5 块菜单板（0x12C/0x12E/0x130/0x132/0x134，各 156×156、槽 4、源在 atlas 列 0x5A0）落成对角阶梯 (1102,294)/(992,402)/(869,485)/(729,543)/(1107,554)；悬停副本 0x12D/0x12F/0x131/0x133/0x135 用 atlas 列 0x502、按需建删（lines 770-800） |

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
| `mouse-callback 槽` | `mouse-callback 10 label_00000460`：槽操作数是十六进制 = 0x10 ⇒ `0xCD` 的推进间隔 16ms（tickets/T-0047） |
| `global f8c46` | 本次要装的 **MOC 文件 id**（TITLE = 0x4f9e = TITLE.MOC） |
| `global f8c47` | 本次要装的 **L2D 实例槽号**（TITLE = 0） |
| `global f807f / 708ab6` | 间接 call-script 的下标 / 脚本指针表（表里是 SETL2DMOC 家族） |
| `572B 立绘节点 key 14` | `i344 14 0` 建：node key 14 → L2D 槽 0 |

## 不变量（拿它做回归断言）

- 版本号三段 = `set:GameVersion` 的字节 [0,1) / [2,2) / [5,4) 各自 atoi 后按 1／2／4 位补零画出（例：1.07.0019 ⇒ 1 + 07 + 0019）
- 菜单 5 项的命中盒 = base `5[i]`/`69[i]` + 盒 156×156（`cd[i]`）⇒ 第 0 项（**右上角 Game Start**）中心 = (1102+78, 294+78) = **(1180, 372)**
- `a9d0 != 0` ⇒ **不建** 572B 节点、只 `set-texture 5273 5`（SO004A 静态图）；`a9d0 == 0` ⇒ 装 MOC+TEX+MTN 并建节点 14 → 槽 0
- L2D 支的立绘与静态支的 `draw-texture 14 5` 占**同一个归并槽 0x14**（572B 节点 key = `0x344` 的 op1 = 图元 handle）；TITLE.MOC 的画布恰好 1280×720 = 视口 ⇒ 画布居中平移为 (0,0)、**模型坐标即屏幕坐标**
- TITLE 的绘制项键 **max = 0x135**（309）；`src/CALLBACK_LOAD.txt` 的四个 detach 区间（`1adb0 7d0`/`19640 2`/`19834 19`/`19708 6`）**都不含**任何 TITLE 键（逐个区间核对为空）

## 坑（踩过一次，别再踩）

- ★三条指令缺一不可：`0x2EB`(取值) / `0x2C7`(字节切片) / `0x23B`(CG 数字条) —— 缺任一条片段为空 ⇒ `atoi(空串)=0` ⇒ 屏幕上出现占位值 `0.00.0000`（2026-09 实测：实现前截图就是它）
- `0x2C7` 的 op3/op4 是**字节**不是字符（SJIS 全角按 2 字节），且会做全角边界修正（丢首/末字节）
- ★`i12e` 的命中盒参数顺序是 `(out, ?, mx, my, size盒数组, baseX数组, baseY数组, count)` —— 盒是「相对 base 的 dx0/dx1/dy0/dy1」，不是「x/y/w/h」；把 base 当 w/h 会让整列命中区错位
- ★`i344` 的 op2 是 **L2D 实例槽号**（不是纹理槽号）；旧文档写"纹理槽变换"会让整套节点/槽接线对不上
- ★`i344 14 0` 在 `label_000024a4`，**只有 Live2D 支会执行到**（静态回落支在 581 的 `jcc` 处直接跳过）⇒ 用截图对照两支时别只看 `set-texture`
- ★`detach-texture 64 12c`（line 818，删 [100,400)）只在 **Game Start** 分支被调（line 320）；`i1f6`（line 810）只在 **Room** 分支（line 368）与退出路径（line 822）—— **Load Data 分支没有任何清理** ⇒ 不能假设「进菜单前标题项会被清」
- ★`0x5A0`/`0x502` 是 **atlas 源列**、`0x9E` 是 atlas 行距，不是屏幕坐标（曾据此误判「在屏外」；屏幕落点来自 line 16/17 的两张常量表）；同理 `0x64` 那条的源 y=1161 已越过 BG050ABL 的图高 1152

## 缺口

- 菜单命中/派发（`i12e`/`0xa2`/`0xa3`）与背景演出未逐段读（layout 列出的只是版本号这一段）
- L2D 分支的 SETL2DMOC 家族（`src/SETL2DMOC.txt` 与 `$n$` 变体，560+ 处 `i34x`）未逐段读 —— 只需知道它是"MOC ↔ 纹理对照表"；`$n$` 变体是否只覆盖 `f8c46` 的 `$n$` 前缀 MOC 未核

## 相关

- 引擎常态能力：`engine-config-registry-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`texture-bind-synchronous-then-query`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`live2d-enabled-config-flag`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`lazy-live2d-slot`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`l2d-node-draw-gate`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`live2d-node-draw-advance`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`live2d-mesh-batches`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x434830`（见 `analysis/functions.json`）
- 函数结论：`0x433FD0`（见 `analysis/functions.json`）
- 函数结论：`0x4311F0`（见 `analysis/functions.json`）
- 函数结论：`0x424970`（见 `analysis/functions.json`）
- 函数结论：`0x426420`（见 `analysis/functions.json`）
- 函数结论：`0x427BA0`（见 `analysis/functions.json`）
- 函数结论：`0x427CB0`（见 `analysis/functions.json`）
- 函数结论：`0x427CF0`（见 `analysis/functions.json`）
- 函数结论：`0x428200`（见 `analysis/functions.json`）
- 函数结论：`0x4283B0`（见 `analysis/functions.json`）
- 函数结论：`0x4A1860`（见 `analysis/functions.json`）
- 函数结论：`0x4B0360`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 主题文档：`docs-new/03-engine/live2d.md`
- 主题文档：`docs-new/03-engine/live2d-moc-format.md`
- 守卫测试：`app/amayui-emulator/test/config-version-substr.test.ts`
- 守卫测试：`app/amayui-emulator/test/title-exit.test.ts`
- 守卫测试：`app/amayui-emulator/test/game-start-chain.test.ts`
- 守卫测试：`app/amayui-emulator/test/live2d-chain.test.ts`
- 守卫测试：`app/amayui-emulator/test/live2d-render.test.ts`

## 证据与备注

- 证据：src/TITLE.txt:579-596；E3 断言见 test/config-version-substr.test.ts（启动链跑到 TITLE 后，CG 数字条各项的源矩形还原出 1.07.0019）；E4 截图 .tmp/vercheck-0-title.png；Live2D 支：src/TITLE.txt:526-557（分叉 + 装载）、552-556（i352/i34e）、589-590（i344 建节点）；E3 断言见 test/live2d-chain.test.ts（用真实 TITLE.MOC/TITLE00.PNG/TITLE.MTN 走同一条 0x341/0x345/0x352/0x34E/0x344 链）；E3 断言见 test/live2d-render.test.ts（装载 TITLE.MOC + 绑 0x4f9f/0x4fa0/0x4fa1 + 建节点 0x14 后，`l2dBatches` 的几何自洽且与快照同源）
- 备注：版本号显示 + 菜单命中/派发（Game Start 一列）已读；Load Data / Room / Option / Quit 各自进去之后的路径未读。「进入游戏」的完整链路（TITLE → GAMESTART → INITGAME → SETFATE → SC0000 → SN0000）见 docs-new/03-engine/scene-start-flow.md。 Live2D 支（526-557 / 589-590）已读并落库：`a9d0` 门控、MOC/纹理/MTN 的统一文件 id 实测为 0x4f9e=TITLE.MOC / 0x4f9f=TITLE00.PNG / 0x5274=TITLE.MTN。未读：SETL2DMOC 家族正文、L2D 支的点击/演出细节。 出画（2026-09 收尾）：出画几何在 `app/amayui-emulator/src/live2d/render.ts` 一处实现（画布居中 + 按纹理号分组 + 第四路归并键 = 节点 key），Pixi 侧只把 positions/uvs/indices 塞进 MeshGeometry，快照导出的是同一份 ⇒ 报告与画面不可能漂移。
