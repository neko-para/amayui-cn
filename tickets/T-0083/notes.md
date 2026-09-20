# T-0083 · 过程文档（notes.md）

## 2026-09-19

B5 (A) 步落地（目标轮 17）：**装载点释放留帧**。① 新宿主缝 native.releaseFrameHold?()（声明 + Pixi 实现【复用私有 #releaseFrameHold，带理由串「读档装载点（引擎复位显示态 ⇒ 不留旧像素）」】+ headless 显式 no-op + 桩留痕 + nativeTap 白名单）；② save-slot.ts 装载点（②c 之后）调用它，注释写明依据 = 引擎装载路径复位两个 仮想ディスプレイ（sub_403EF0 raw 19913-19915）⇒ 引擎没有『保留旧像素』的概念；③ 守卫：test/slot-load-resume.test.ts 的装载用例新增断言『装载点必须调用 releaseFrameHold』。★意义：读档瞬间屏上不再是上一屏（TITLE/菜单）的旧像素（你反馈的『背景是 TITLE 的』那一半成因）；(B)/(C)（撤销 clearDrawContainer + A/B 模型一致守卫）仍待做。

## 2026-09-19（B）(C) 步落地 —— 撤销装载点那一刀 + A/B 守卫

**(B) 装载点不再整批清容器**：删掉 `save-slot.ts` ②c 的 `clearDrawContainer()`+`clearMeshSlots()`（引擎 `sub_410160` 的 27 个被调函数里没有任何清容器 ⇒ 那一刀从来不是引擎行为），改为新宿主缝 **`native.dropFrameItems(callerFrame)`**：只丢掉**被放弃的调用方帧**画的绘制项，ADV 层保留。归属用新增的 `Item.ownerFrame` 记账（`0x1FB draw-texture` 写 `e.cur`；`Item`/`DrawItemConfig` 各加一格，`netiveTap` 白名单同步）。
★这一轮把 `sub_403EF0` 的体读通了（raw 9958-9971）：它**不是**"清合成"，而是把那个 UI 对象的**项数清零**（`_this[258] = 0`）+ 游标/矩形复位（`_this[959] = -1`、`_this[960] = 0`、构造侧 `SetRectEmpty`）⇒ 语义 = **上一屏那一层 UI 整体不再组成**，正是我们要的那一半。另订正：`CALLBACK_LOAD.txt:16` 的实参是 `detach-texture 1adb0 7d0`（= [0x1adb0, 0x1b580)，**立绘层**），实测它删不掉菜单的 120xxx 项（日志 `RANGE-REMOVE … drawItems=0`）。

**(C) A/B 守卫**：新增 `test/slot-load-screen.test.ts`（2 条）——① 装载点机械判据：不得调 `clearDrawContainer`/`clearMeshSlots`、只对 caller 帧调 `dropFrameItems`、菜单层消失而 ADV 层与存档声明的槽都在；② A/B：同一份脚本"正常跑到某句话"与"读档落到同一句话"在**绘制项集合 / 纹理槽表 / 宿主槽绑定 / 落点**上逐项相等。

**★E4 实测（未收口，如实记录）**：`npm run shot -- --load 79`（`b5B` → `b5B2` → `b5C`）。A 步后"TITLE 旧像素"消失；B 步后读档列表的 `draw-texture` 行消失，但仍有残留。加了归属分桶诊断后拿到硬数据：`dropFrameItems: 剩余绘制项按归属帧分桶 = {-1:82, 1:18}`，帧链 `0=SYSTEM4(-1) 1=TITLE(0) 2=SAVE(1) 3=SBUNKI(2) 4=SBUNKIMOVE(3)`。
- `1` = **TITLE.BIN** 那层（句柄 10..308；层序最低）。引擎里它被后画的序章背景盖住，而 emulator 这一路**没有背景项**：`NOVEL.txt:29` 的 `i0ae` 在背景绘制（`:55` 的 `draw-texture 186a0 48 …`）**之前** ⇒ 走栈收尾时它不会重跑 ⇒ 读档后的背景**只能来自载荷项**（在"从 TITLE 冷启动读档"这条路上根本没有载荷项）—— 这条与 `T-0066` 是同一件事。
- `-1` = **不走 `0x1FB` 的建项路径**（文本项 / `ensure` 建项）还没有归属记账 ⇒ caller 之外的那些菜单项（列表文字/缩略图框）丢不掉。

**下一步（已定，不在本轮做）**：给 `SceneState` 加"当前帧"（由 VM 每步下发），让**所有**建项路径都记 `ownerFrame`；再往后是平面/离屏（render-to-target）合成模型，那才是把这条链彻底做对的正解。

## 2026-09-19（第二轮）丢哪一层 → 扩到"被放弃的那条调用链"

按上面的帧链证据把判据从"caller 一帧"扩成 **caller + 它调用出来的帧**（`caller` 链里含 caller 的帧；祖先帧不碰 —— 读档前正在演的那场戏就是祖先）。实证就是 `2=SAVE(1) 3=SBUNKI(2) 4=SBUNKIMOVE(3)`：只丢 2 时列表文字/行框还在。

**★第二轮把"归属"补成完整的**（这是 b5C 诊断挖出来的真缺口）：分桶显示残留里 **82 项的 `ownerFrame = -1`**（其中 **56 项可绘制**）—— 也就是说**不走 `0x1FB` 的建项路径**（`scEnsureItem`、`scDrawCgNumber` 内部的 `scConfigureDrawItem`）从来没记过归属。修法：新增宿主缝 **`native.setCurrentFrame(frame)`**（`interpreter.ts` 每条指令派发前下发一次）+ `SceneState.currentFrame`，并在共享层统一取它（`scConfigureDrawItem` 的兜底、`scEnsureItem` 建项时）。★顺带把分桶诊断升级为"全部 / 可绘制"两栏（`ensure` 建出的项 `flags=0` 不进画面，不该被当成残留）。

**E4 结果（b5E）**：一次丢掉 **132** 项（b5B 时只有 83），剩余分桶 = **`{1:51/可绘制25}`** —— 残留**只剩 `TITLE.BIN` 那一层**，菜单的行框/页码/缩略图/文字全部消失。仍未收口的就是那一层：emulator 里没有东西盖它（引擎靠后画的序章背景盖住；而 `NOVEL.txt:29` 的 `i0ae` 早于背景绘制（`:55`）⇒ 走栈收尾不会重跑它，背景只能来自**载荷项**，而从 TITLE 冷启动读档时根本没有载荷项 ⇒ `T-0066`）。

**（目标轮 25-26）两处守卫补强**：① **冷/热启动分情形**（详见 `design.md` 的目标轮 25 节）：`NOVEL.txt:42-55` 那条 `jcc (global-int 708ad6/708ada)` 分支依赖**池外全局**（`T-0071`：真槽装不下）⇒ 冷启动读档时引擎自己就画**灰色占位背景**（`create-texture + i20b #808080`），b5E 实拍里那块橄榄灰板是引擎行为；用户可见的"背景是 TITLE 的"因此要分冷/热两条路判。② **（C）的 A/B 守卫补上网格**：此前的 A/B 只比 `drawItems`/`texSlots`/宿主绑定/落点，而 **ADV 的幕/遮罩就是 `MeshObj`**，且被撤销的那一刀里正有一条 `clearMeshSlots()` ⇒ 现在两边各种一块网格（`0x19640`）并断言**集合相等且非空**：旧实现会让 A 侧变空、这条立刻红。守卫：`test/slot-load-screen.test.ts`（2 条，verify 全绿 663/662/0fail）。
