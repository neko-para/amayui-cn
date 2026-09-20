# 新游戏开局链路：TITLE → Game Start → GAMESTART → SN0000 首文案

> 本文是**跨脚本的叙述**（引擎主题文档），回答「从标题画面点『Game Start』到序章第一句文案之间，
> 到底发生什么、用到哪些指令、哪些指令跳不得」。逐 opcode 的 handler 结论在 `opcode-table.md` 与
> 第一层 `analysis/functions.json`；逐脚本的结构/槽/坑在第三层 `analysis/scripts.json` 的
> `TITLE` / `GAMESTART` / `SETFATE` / `INITGAME` / `SN0000` 条目；本文不复制它们。
>
> 实证：`app/amayui-emulator` 的 `runGameStartChain()`（`src/tools/gameStartChain.ts`）
> + E3 回归 `test/game-start-chain.test.ts` + 指令盘点 `npm run op:inventory -- --path start`。

---

## 1. 链路与时序

```
SYSTEM4.BIN（启动链：INITCONFIG → CHECKCONFIG → 各 *INIT → 扩展包 $n$AUTORUN）
  └─ LOGO.BIN（版权页） → INIT.BIN → TITLE.BIN（标题菜单，622 条指令）
       ├─（鼠标悬停第 0 项 = 右上角 Game Start，命中盒见 §2）
       └─ call-script 526b → GAMESTART.BIN（946 条；新游戏配置界面）
            ├─ 左键点第 0 个按钮「ゲーム開始」 ⇒ local 3f4 = 1
            │    └─ label_000050b8：全屏淡出幕布 → wait → poll-input
            │         ├─ call-script 51e4 = INITGAME.BIN（写全局初值）
            │         ├─ call-script 51e5 = SETFATE.BIN（1000 项角色运命标志表）
            │         └─ mov (global-int 0) 1 → exit
            └─ 右键 / 第 1 个按钮「戻る」 ⇒ local 3f4 = 2 ⇒ label_000053c0（清场）→ exit（global 0 保持 0）
       └─ 回到 TITLE:320：按 global 0 分流（1 = 已选开始游戏 ⇒ 继续进 INITGAME → …）
            └─ INITGAME → UNITECH / CALCCC / *CCINIT / ADDITEM → SETFATE → SETCHARM
                 └─ SC0000.BIN（场景开场）→ SETWEATHER → NOVEL → **SN0000.BIN（序章）**
                      └─ ip = 901 = src/SN0000.txt:1225 = 第一条被汇编的 show-text（本次目标）
```

进入 SN0000 后开场序列（`src/SN0000.txt:1018-1049`）：

```
i238 0x157c(5500)          ; 写 Engine[92339]（全工程无读者的死写，见 §4）
wait                       ; 0x21C ⇒ effect_flags |= 0x400（动画等待门）
play-bgm d                 ; 曲号 0xd ⇒ BGM013（引擎音频链路见 sound-system.md）
call <子程序>              ; 建背景图元（set-texture BG050ABL → i208 取宽高 → draw-texture）
i21a / i218                ; ★取该图元的「描画位置」「pivot」→ 校正 → i219 / i217 写回
i1ff 0 0 0                 ; 平移 work 矩阵归零
i220 0 0x13880(80000) …    ; 80 秒背景横移（动画窗3）
i242 …                     ; 写 DrawItem+720（渲染侧）
wait                       ; 又一个 0x400 门
…（立绘 i215/i216 反查 imgid、i1c7/i1cc 组 ADV 等待循环）
show-text 0 @"由两个世界融合而生的"   ; ← ip = 901
```

## 2. 两个点击点的坐标从哪来（**不写死像素**）

`0x12E`（`sub_42F230`）是**几何完全来自脚本数据**的悬停命中：

```
i12e <out> <?> <mouseX> <mouseY> <size盒数组> <baseX数组> <baseY数组> <count>
判据： size[i] = [dx0, dx1, dy0, dy1]；命中 = dx0 ≤ mx−baseX[i] ≤ dx1 且 dy0 ≤ my−baseY[i] ≤ dy1
```

| 界面 | 脚本 | size 盒 | baseX | baseY | count | 第 0 项中心 |
|---|---|---|---|---|---|---|
| TITLE 菜单 | `TITLE.txt:11-17, 100` | `cd`…`dd` = `[0,0x9c,0,0x9c]`（156×156） | `5` = `[44e 3e0 365 2d9 453]` | `69` = `[126 192 1e5 21f 22a]` | `local 0` = 5 | **(1180, 372)** = 右上角 Game Start |
| GAMESTART 三按钮 | `GAMESTART.txt:64-68, 115` | `5` = `[0,0xc1,0,0x3b]`（193×59） | `195` = `[2cb 3a3 44d]` | `1f9` = `[240 240 240]` | `local 0` = 3 | **(811, 605)** = ゲーム開始 |

> ⚠盒是**相对 base 的 dx/dy**，不是 x/y/w/h。把 base 当宽高会让整列命中区错位。
> 这两个常量在 `src/tools/gameStartChain.ts`（`GAME_START_XY` / `START_GAME_XY`）、
> `tools/shot.cjs` 与 `src/tools/config1Chain.ts`（`CONFIG_XY` = 第 3 项 (807,621)）里各出现一次 —— 四者同源。

点击派发：`GAMESTART.txt:133-155` 用 `local 3f1`（`0x108 read-mouse-button`，bit0=左/bit1=右）与去抖位
`local 3f2` 做「按下置位 → 抬起派发」；抬起时 `3f7 == 0` ⇒ `local 3f4 = 1`（ゲーム開始），
`3f7 == 1` 或右键 ⇒ `3f4 = 2`（戻る）。主循环 `:84-91` 读 `3f4`：1 ⇒ `label_000050b8`、2 ⇒ `label_000053c0`。

## 3. 这条路径上的 25 条「缺失指令」与逐条的跳过评估

采集口径：`runGameStartChain({ unknownPolicy: 'stub' })`（未实现指令登记为运行时 no-op 后继续），
一次跑完枚举干净 —— 25 条。判据一律是**读 handler 体**（raw 行号见 `opcode-table.md` 与 `functions.json`）。

### 3.1 必须实现（handler **会回写脚本操作数**）—— 9 条

跳过它们不会报错，只会让 `op1`/`op2..4` 保留**上一条指令留下的旧值**，而脚本紧接着就拿它做
条件跳转或算术 ⇒ **静默的逻辑错误**。

| opcode | handler | 语义 | 写谁 | 跳过会怎样 |
|---|---|---|---|---|
| `0x195` | `sub_42D010` | 字符串**不等**判定 `op1 = (op2 != op3)`（`0x194` 的取反兄弟） | op1 | `SETFATE.txt:15-17` 的 1000 次循环靠它跳过空名条目；跳过 ⇒ `7d4` 留着上一行 `lt` 的 1 ⇒ 空名条目也被处理（对它们跑三张 `lookup-array-2d` 并置位） |
| `0x19A` | `sub_42D290` | `op1 = Engine[97050]`（跳读/自动模式镜像） | op1 | `DRAWCHARM.txt:1` 等直接读它 |
| `0x1B6` | `sub_42D2C0` | `op1 = (Engine[97052] != 0)`（共存消息状态） | op1 | ADV 循环状态判断失真 |
| `0x1C7` | `sub_42D390` | `op1 = (effect_flags & 0x8000000) != 0`（ADV 激活） | op1 | `SN0000.txt:1114` 的 `i1c7`/`i1cc`+`or`+`jcc` 等待循环按旧值走 |
| `0x1CC` | `sub_42D410` | `op1 = Engine[122455]`（本页显示中） | op1 | 同上 |
| `0x215` | `sub_430340` | `op1 = DrawItem(op2)+4`（纹理槽号）或 **−1** | op1 | `SN0000.txt:3125` 的反查失败 |
| `0x216` | `sub_430380` | `op1 = Scene[5*op2+466]`（槽绑定的 imgid） | op1 | `SN0000.txt:3128` 拿到 0 ⇒ 资源/语音取错 |
| `0x218` | `sub_4303C0` | `op2/3/4 =` DrawItem(op1)`+24/+28/+32`（pivot） | op2..4 | `SN0000.txt:1030/1040` 的 pivot 校正基于旧值 |
| `0x21A` | `sub_430450` | `op2/3/4 =` DrawItem(op1)`+36/+40/+44`（描画位置） | op2..4 | `SN0000.txt:1029` 的偏移基于旧值 ⇒ 立绘位置全错 |

顺带补上成对的 `0x1B7`（`Engine[97052] = (op1 != 0)`，`0x1B6` 的写入端，可往返验证）。

### 3.2 可以安全跳过（handler 体**既不回写操作数、也不改 ip/cur**）—— 16 条

已连同依据登记进 `ENGINE_INTERNAL_OPS`（`handlers/stubs.ts`）。★2026-09 订正：这里的 16 条**早已全部转真实现**，`ENGINE_INTERNAL_OPS` 现在只剩 9 条（见 `docs-new/03-engine/opcode-gaps.md`）；下表保留作为"当时为什么可以跳过"的历史判据，但 `0x238`/`0xD9` 两类结论已被推翻（见下方订正行）。四类理由：

| 理由 | opcode | 依据 |
|---|---|---|
| **死写**（写的字段全工程无读者） | 仅 `0x1B1`（`Engine[21672]`） | grep 全工程只写不读（写点 raw 29161/18077） |
| **等待门计时器加载**（**不是**死写；2026-09 订正） | `0x238`（`Engine[92338]/[92339]` = 等待门起点/时长） | raw 32303-32312；读者 `sub_407E20`（raw 12761-12786）与主循环 `0x400` 分支（raw 21109）；`SN0000.txt:1020` 的 `i238 157c` = 5500ms |
| **引擎做了事，但 emulator 没有对应子系统**（消息面/转场表/3D） | `0x93` `0x94` `0x97`（消息窗面显示态与填矩形）、`0x224`（清 Scene 转场表）、`0x229`（绘制模式）、`0x256` `0x258` `0x242`（渲染侧字段）、`0x32A`（释放 3D 模型槽）、`0x32D`（3D 颜色） | 都是写渲染/3D 子系统状态，VM 不可观测 |
| **标志位清除**（**有读者**；2026-09 订正） | `0xD9`（清 `effect_flags` bit 0x1000） | 主派发循环 raw 20841 `if ((v24 & 0x1000) != 0)` 就是读者（随后判 `& 0x800` 并调 `sub_453B60`）；置位端 raw 30368、清除端 raw 24945 |
| **emulator 的帧循环自己做了 / 无消费者** | `0x20E`（图形提交）、`0x1BC`（清消息/声音字段）、`0x1AD`（`Engine[166963] = cur`，唯一读者在存档序列化，emulator 不序列化该字段） | — |

**机械闸门（2026-09 订正）**：`test/game-start-chain.test.ts` 里现有的是 **A5 的 7 条**名单棘轮（`A5_IMPLEMENTED` = `0x93/0x94/0x97/0xd9/0x1ad/0x1b1/0x1bc`）+ 注册表断言，**没有**"16 条不写操作数"的棘轮（那 16 条已不在 stub 表里）；"语料用到却未注册"的棘轮在 `test/opcode-gaps.test.ts`。

## 4. 该路径暴露的两个**渲染侧**缺口（与本任务的 opcode 工作正交）

### 4.1 `set-texture` 的同步性（**已修**）

引擎的 `0x1F9 set-texture`（`sub_422CB0` → `sub_4559C0`）是**同步**读文件 + 解码 ⇒ 同一条不可分割的
指令序列里 `set-texture` → `0x208`(纹理尺寸) → `0x1FB`(draw-texture) 必然一致。emulator 走异步 IPC，
原先只在 `#present()` 前补屏障 ⇒ **`0x208` 读到 0×0** 并被脚本写进绘制项的源矩形 ⇒ 图元永远画不出来：

```
（修前日志）
bindTexture imgid=0xb37 slot=4
getTextureSize slot=4 → 0x0（纹理尚未载入，imgid=0xb37）
configureDrawItem h=0x18a88 layer=101000 (0,0,0x0)      ← 源矩形 0×0 = 不可见
image b37 -> BG050ABL.AGF (2048x1152)                   ← 图其实载入了，只是晚了一步
```

修法：`renderer/app/session.ts` 的 `#awaitTextureBound` —— 在 `0x1F9` 之后立刻 `await texturesIdle()`
（绑定是稀有事件，不影响常规帧率；headless 不实现 `texturesIdle` ⇒ 自动跳过）。
详见第二层台账 `texture-bind-synchronous-then-query`。

### 4.2 mesh 被近似成「全屏黑叠加块」（**已修，2026-09**）

**修前**：`presenter.ts` 把**每个** mesh 画成 `width=VIEW_W; tint=0x000000; alpha=diffuseA/255` 的全屏覆盖块，
而 `0x320 create-mesh` 的顶点几何与 `0x322 set-vertex-color` 的**顶点下标**都没建模
（`handlers/gfx-item.ts` 里 `verts` 用"默认满屏四边形"、`state0` 只存一个 ARGB）。
菜单条 mesh `0x19640`（同 handle 在 mode 6 下是 `draw-texture 19640 11 0 0 43e 95 5d 22c` —— 底部一条 1086×149 的贴片）
的 diffuse α 被动画推到 255 后，emulator 就画出一整屏不透明黑：

```
[present …] items={101000:a255 …} meshes={8:a0 0:a255} slotTex=7 wait=0x400
```

⇒ **VM 一切正常、日志空白，但屏幕全黑**（`.tmp/gs2-7-sn0000-first-text.png`）。

**修法（两个成因都补掉）**：
1. `0x322`/`0x323` 补齐引擎语义（`sub_426C20` raw 33865-33884）：**α>255 夹 255、α/rgb 为负 = 取当前 state0 的对应通道**。
   SN0000 的暗幕正是 `set-vertex-color-alpha 19640 0 f8043 -1 -1` ⇒ 目标色 = 当前 `0x80000000`（50% 黑），
   修前按无符号位模式读成 `0xFFFFFFFF`（不透明）。
2. mesh 真实建模：`0x320` 的 op2..op8 是**数组基址**（全局 float/int 槽号，第 i 顶点取 `slot+i`）——
   x/y/z 与 u/v 都是屏幕像素坐标的浮点数组，op5/op6 是逐顶点色数组（DEC 后 `(α<<24)|(rgb&0xFFFFFF)`）；
   最终像素色 = 逐顶点基础色 × CalcDiffuse 插值态色（`mulArgb` 逐通道 `/255`）。
   presenter 按 `flags & 1`（几何存在位）决定是否绘制，并用真实几何 + 真实颜色合成。

**语料事实**：所有 `0x320` 站点都是同一个**轴对齐满屏四边形**（`x=(0,1280,0,1280)`、`y=(0,0,720,720)`；
源码里的 `500`/`2d0` 是**十六进制**），基础色数组来自 INIT2 的 `copy-local-array (global-int f8c48/f8c4c)` = 全白，
所以"幕布颜色"完全由 `0x322/0x323` 的两端色决定，**不存在"局部贴片"形态**（1086×149 那条是 mode 6 的 draw-item 分支）。
守卫：`app/amayui-emulator/test/mesh-vertex-quad.test.ts`（含真实链路的 E3 断言）。
残余近似：逐顶点渐变取三角形均值；mesh 的 z 序仍统一叠在 draw-item 之上（引擎按 handle 三路归并）。

### 4.3 `0x400` 动画等待门是**引擎本来的语义**（不是缺陷）

`0x21C wait` 置 `effect_flags |= 0x400`（= `_this[174801]`；主循环用字节指针写作 `*(_DWORD*)(_this+699204)`，
两者是同一个字段）。主循环在该位下**不派发脚本指令**，直到 `sub_407E20(Scene)`（转场/动画 pending）为假，
或玩家按 `system:EffectSkipOnClick` 的跳过键（raw 21109-21152）。emulator 的 `#serviceAnimGate` +
`scAnimationsDone()` 与之同口径（见第二层 `scene-pending-flag-0x400-gate`）。
SN0000 开场有一条 **80 秒**的背景横移动画窗，所以这个门会真的等 —— 这与真机行为一致。

## 5. 验证

| 层 | 证据 |
|---|---|
| E1 | 25 条 handler 体逐条读过（raw 行号见 `opcode-table.md` / `functions.json`） |
| E2 | `test/game-start-chain.test.ts`：**三张名单棘轮**（`IMPLEMENTED_9` 9 条 + `A4_IMPLEMENTED` 9 条 + `A5_IMPLEMENTED` 7 条，各断言"已进 `OPS` 且不在 no-op 表"）+ 9 条语义用例（含 `0x1B6↔0x1B7` 往返、`0x215/0x218/0x21A` 与场景模型往返）★2026-09 订正：原文"16 条不写操作数棘轮"不存在（那 16 条早已转真实现）。 |
| E3 | 同文件的 E3 用例：真实语料跑完整链路 ⇒ `titleHover=0`、进入 `GAMESTART`、`gameStartHover=0`、`gameStartResult=1`、`reachedInitGame`、进入 `SN0000`、**首文案 ip=901 且页面文本含该串**、路径上 `unknown=[]` |
| E4 | `npm run shot -- --gamestart`：**2026-09 现状 = TITLE / GAMESTART / SN0000 序章都正常出图**（`.tmp/gsLayout-7-sn0000-first-text.png`）。它抓到的两个缺陷都已修：§4.1 纹理同步屏障、§4.2 mesh 全屏黑叠加块；另有"撤幕过渡帧闪一下"由 `pixiBackend.#holdFrameAfterCurtainDrop` 处理 |
| 工具 | `npm run op:inventory -- --path start`（表 0 = 路径上未实现指令，表 1/2/3 同既有口径） |

`npm run verify` = **380/380**（2026-09 实测；本条写于修复 §4.1/§4.2 之前，当时 326/326。测试数会随功能增长，**以实测为准**）。

## 6. 现状与缺口

- ✅ 「启动 → 右上角 Game Start → ゲーム開始 → SN0000 首文案」整条链路**零未实现指令**，
  VM 侧到达并组出第一页（3 行 58 字，窗 8）。
- ⚠ **观感**：SN0000 场景整屏黑 —— 根因是 §4.2 的 mesh 近似（不是本任务的 opcode 缺口）。
- ⚠ 序章正文其余页、`SC0000`/`NOVEL`/`DRAWCHARM`/`CHARMEDIT` 已跑到但未逐段读（第三层只登记了用到的片段）。
- ⚠ `SETFATE` 三条子路径（`label_290`/`5c4`/`920`）内部的表语义未逐条读。
- ⚠ `GAMESTART` 配置界面每一行控件的读写路径未读。
