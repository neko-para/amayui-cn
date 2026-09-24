# T-0103 · 交接链审计：`SN0000 → SC0000` 相关**指令**与**能力（capabilities）**的定义/实现核对

> 生成：`.tmp/t0103-audit/report.mjs`（窗口 × `analysis/opcodes.json` × `analysis/opcode-gaps.json` × `analysis/engine-capabilities.json`，全部机器读，非手抄）。
> 目的：回答「交接处所有相关指令/capabilities 的定义与实现是否一致；目前表现为什么和真机不一样」。
> 范围 = 下面 13 个窗口（含各自调用的整脚本 `SETCHARM`/`SETWEATHER`）；指令侧只统计**非注释、非 label、非 dev_unk** 的行。

## 1. 审计窗口

| 脚本 | 行区间 | 这一段做什么 | 不同助记符 |
|---|---|---|---|
| `SN0000` | 2994-3073 | 页尾 → 章切换块（i250 SlideBlur 2500ms）→ global 0=2 → exit | 21 |
| `SN0000` | 3075-3110 | label_0000b884（1397 门下的拆场：detach 19640/19834） | 15 |
| `NOVEL` | 148-267 | ADV 收场：i1f6 / i23d / i259 / release-texture / SETWEATHER | 38 |
| `SYSTEM4` | 170-181 | 主循环 mode 分派（global 0 == 1 ⇒ 内联 ADV） | 4 |
| `SYSTEM4` | 183-268 | 场景装配块（3f90 门内：i1f6 / i23d / 黑幕 19258 / SETCHARM） | 20 |
| `SYSTEM4` | 299-424 | 场景脚本返回后的收尾（i259 / detach / release / SETFATE） | 35 |
| `SYSTEM4` | 427-470 | global 0 == 2 ⇒ ALLMAP | 8 |
| `ALLMAP` | 31-58 | 章节点入口（3f3d=1 → 循环 call SCJUMP） | 10 |
| `SCJUMP` | 6-54 | 节选择（13d7/13d8 门 → 写 3f3c=1） | 6 |
| `SC0000` | 1008-1084 | 入口 label_00003b38（i1f6 / 满屏黑 mesh 19258 / 层→槽表 / SETCHARM） | 23 |
| `SC0000` | 1256-1705 | 节分派 + G0000/G0001 章头演出 → 第一句话 | 51 |
| `SETCHARM` | 1-40 | （整脚本）新游戏路径跑、读档路径跳过 | 9 |
| `SETWEATHER` | 1-80 | （整脚本）两条路径都跑（NOVEL:244） | 28 |

## 2. 指令侧结果：96 个不同助记符，**没有"未实现的指令"**

- 96 个助记符里：VM 基础/算术/字符串/控制流族（0x1/0x2/0x3/0x5/0x50-0x64/0x8C/0x8F/0xA0）约 40 个；其余为渲染/文本/输入/音频族。
- 台账状态：全部 `已核对`（读 handler 体确证）。
- 实现处置（`opcode-gaps.json` 的 `disposition`）：**没有一条是 `unimplemented`/硬停**；条目存在且处置非 `implemented` 的 8 条见下表（**没有条目 = 已实现**）。

| opcode | 助记符 | 出现 | 处置 | 说明（note 摘要） |
|---|---|---|---|---|
| 0x140 | `i140` | 1 | deferred | **AGERC 对话框（外部 DLL）——目标已静态定位（★推翻旧结论「静态定不了目标服务／需真机动态调试」）**：`dword_55E1B4` = **`AGERC.DLL!_ShowDialog@12`**，不是函数表、不是对象指针、不是运行时装入的模块基址，而是**一个函数指针**，首参 = 请求码（cmd）。证据链：唯一写点 raw 141984 在 `sub_4BA890`（WinMai |
| 0x324 | `i324` | 1 | engine-internal | 体已读：`sub_41A470`（raw 25402-25407）只置 arity 槽 `frames[cur]+0x74=1` 并**尾调** `sub_453530(Engine[93384])`；`sub_453530` 是 thunk（`; Attributes: thunk` → `jmp sub_453150`，清单 135085-135093）⇒ 真身 `sub_453150`（ra |
| 0x325 | `i325` | 3 | engine-internal | 体已读（raw 33924-33938；汇编清单 61806-61820）：只置 arity 槽 `frames[cur]+0x74=5`，读 op1/op2 后写 `Engine[93384]`（= 字节 `0x5B320` = `Scene+50704` = **Effect3D 管理器**，由 `sub_4530B0` 构造、`operator new(0x4F4)`，在 Scene 初始化 |
| 0x326 | `i326` | 1 | engine-internal | 3D 效果·Snow：惰性建 ID3DXEffect(资源 202) 并重建 Snow 对象；emulator 无 3D 效果子系统 ⇒ 显式登记为缺口（不是无依据 no-op） |
| 0x327 | `i327` | 1 | engine-internal | **SETWEATHER 族（`tickets/T-0093`，轮 6 由 `deferred` 转 `engine-internal` 有据 no-op）** —— `0x327`（`sub_426E70` raw 33956-33964，argc 1）：读 op1 → `sub_453280(Engine[93384], op1)` = **释放 Effect3D 管理器旧对象并重建**（与  |
| 0x329 | `i329` | 1 | engine-internal | **SETWEATHER 族（`tickets/T-0093`）** —— `0x329`（`sub_426EB0` raw 33966-34000，argc 2）：读 op1=统一资源 id、op2=槽 → `sub_4559C0`（FileDB 解析，带 size）+ `sub_455560` 取字节 → `sub_4A0640(Engine+322832, …)` **装载 mesh**；失 |
| 0x32C | `i32c` | 4 | engine-internal | **SETWEATHER 族（`tickets/T-0093`）** —— `0x32C`（`sub_426FC0` raw 34012-34030，argc 6）：读 **6 个 float**（`sub_41C300` ×6）→ `sub_499CE0(Scene, …)` = **3D 相机/天气参数面**（`Scene+41960..41984` 一组 float + `D3DXMatri |
| 0x32E | `i32e` | 1 | engine-internal | **SETWEATHER 族（`tickets/T-0093`）** —— `0x32E`（`sub_427110` raw 34057-34113，argc 11）：op9=α（夹 255）、op10=RGB（拼 ARGB 后逐通道 `× dbl_51FA60` 归一化）、op1/op2=handle/槽、op3..op8=六个 float（位置/朝向等）、op11=时间参数 → `sub_49 |

★结论（指令侧）：**这条链上不存在"缺指令"造成的差异**。唯一与本次现象直接相关的是 **0x1F6/0x1F7 的语义在台账里没点名"四张表"** ⇒ 实现侧照"两张表"做了 —— 这是**定义不清**（已在轮 14 订正 `analysis/opcodes.json`，见 `tickets/T-0144`），不是"指令没实现"。

## 3. 能力（第二层）侧：与本链相关的 23 条

| capability | 是什么（与本链的关系） | emulator 判定 | 守卫 |
|---|---|---|---|
| `clock-read-transition-window` | 转场窗（类别 3 含）+ 清表门 | modeled-verified/E3 | test/transition-corpus-e3.test.ts |
| `transition-table-flush` | 转场表帧尾收尾 | modeled-verified/E2 | test/sc-transition-window.test.ts#T-0091 G2 |
| `render-range-clip-by-index` | 按索引区间的绘制范围裁剪 | absent/E0 |  |
| `render-merge-two-pass-reorder` | 四路归并 + |0x10000 两趟重排 | partial/E2 | test/draw-item-slot-coverage.test.ts |
| `scene-frame-commit` | 四路归并 + 绘制 | partial/E2 | test/draw-item-slot-coverage.test.ts |
| `scene-drawtable-flush-and-dirty` | 0x1F6/0x1F7 清容器（opcode 侧） | modeled-unverified/E1 | test/scene-report.test.ts |
| `scene-dirty-flag-lifecycle` | Scene+46508 脏位 | modeled-verified/E2 | test/headless-needs-render.test.ts |
| `scene-freeze-flag` | Scene+46512 冻结 | modeled-verified/E2 | test/wait-gate-timer.test.ts |
| `scene-pending-flag-0x400-gate` | Scene+46516 + 0x400 门 | modeled-verified/E3 | test/wait-gate-timer.test.ts |
| `clock-read-meshentry-color-window` | MeshEntry 颜色/α 窗（0x322/0x323） | modeled-verified/E3 | test/mesh-vertex-quad.test.ts |
| `clock-read-drawitem-5-windows` | DrawItem 5 窗（0x202/0x203 在内） | modeled-verified/E3 | test/draw-item-anim-window.test.ts |
| `mesh-vertex-quad-and-per-vertex-color` | mesh 顶点四边形 + 逐顶点色 | modeled-verified/E3 | test/mesh-vertex-quad.test.ts |
| `chained-3d-layer-commit` | 572B 层归并/提交 | modeled-verified/E3 | test/live2d-render.test.ts |
| `l2d-node-draw-gate` | 572B 出画门（槽有模型才画） | modeled-verified/E3 | test/live2d-render.test.ts |
| `live2d-node-draw-advance` | L2D 推进=出画同一次调用 | modeled-unverified/E3 | test/live2d-chain.test.ts |
| `lazy-572b-node-map` | 572B 节点表惰性插入 | partial/E3 | test/live2d-chain.test.ts |
| `scene-3d-weather-effects-rain-snow-leaf` | 3D 天气/粒子（SETWEATHER 用） | absent/E1 | — |
| `text-reveal-pump-409400` | 逐字显现泵 + MessageSpeed | modeled-verified/E3 | test/adv-msgwin.test.ts#★逐字显现速度定律：MessageSpeed = **每字**毫秒 |
| `msgwin-char-reveal-grid` | 字格 + 逐字泵 | modeled-verified/E2 | test/char-reveal.test.ts |
| `msgwin-window-reveal-gate-300` | 每窗逐行贴出闸门 | modeled-verified/E2 | test/char-reveal.test.ts |
| `hover-ret-reruns-gate-op` | 悬停 ret 回门指令重跑 | modeled-verified/E3 | test/game-start-chain.test.ts |
| `gfx-texture-load-sync` | set-texture 同步装载 | modeled-verified/E2 | test/texture-frame-barrier.test.ts |
| `scene-teardown-on-load-point` | 读档装载点清容器 + 还原清单 | partial/E4 | test/slot-load-resume.test.ts |

## 4. 分歧清单（为什么本机与真机不一样）—— 按证据强度排序

**D1 ·【已确证·本链可见】`0x1F6`/`0x1F7` 没擦 572B 立绘节点表 ⇒ TITLE 的 Live2D 残留**
- 引擎：`0x1F6` 清 4 张表（raw 130699/130764/**130765**/**130766**），`0x1F7` 单条/区间也擦 1080/1096（raw 130825-130837 / **131044** / **131077**）。
- emulator：`scClearDrawContainer` 只清 `drawItems + meshes + msgwin`（`src/renderer/scene/ops.ts:263-273`）；`scDetachTexture` 同（`ops.ts:123-148`）。
- 现象：新游戏路径 TITLE 的节点（key `0x14`）活过整条链（运行期 513 条 `[present …] l2d={槽1 节点1 可画1 …}`），读档路径靠 `save-slot.ts:321` 的补丁遮住 ⇒ `tickets/T-0144`。
- 定义侧：轮 14 已订正 `analysis/opcodes.json` 的 0x1F6/0x1F7 语义（点名四表）+ `scene-drawtable-flush-and-dirty` 的口径。

**D2 ·【已确证·可能少一帧】转场**到期那一帧不再合成** ⇒ 记录 `[4]` 收不到终帧**
- 引擎：到期帧仍渲一遍（raw 135808-135811 只锁终值，135824 之后无跳过），记录帧尾才清（raw 136840-136841）。
- emulator：`scTransitionWindow` 到期返回 `active:false`（`transition.ts:126-129`）→ `scTransitionsPending` 假（`:612-615`）→ 宿主跳过合成（`pixiBackend.ts:1470` + `:1494`）；`rt.channels` 算了没人用（`:588`）。
- 归属：`tickets/T-0091`（本轮新增；已在 `clock-read-transition-window` 的 note 里登记）。

**D3 ·【已确证·本链未必可见】区间项没有从屏幕 pass 排除（`|0x10000` 两趟重排未建模）**
- 引擎：被画进 36/37 的项置 `bit16`，屏幕 pass 只画 `(flags & 0x10001) == 1`（raw 135580/135595/135609）。
- emulator：全仓**无** `0x10000` 处理；`scTransitionRangeHandles` 只在 `#compositeTransitions` 用于取子集（`pixiBackend.ts:1300`），`renderItemSubset` 只用于离屏画布（`:1201`）⇒ 源项与转场结果同时在屏。
- 为什么本链上未必可见：本链记录的展示项恰是「源项 handle + 2」的全屏不透明项（101120→101122 / 101100→101102），把源项盖住。
- 归属：`tickets/T-0091`（台账 `render-merge-two-pass-reorder` 的 note 已登记缺口，本轮补了可见后果）。

**D4 ·【已确证·有意偏差】类别 3 的模糊源 = 本帧屏幕合成（引擎读的是陈旧 scratch 层 36）**
- 引擎：类别 3 被显式跳过"那两趟 item 重绘"（asm `0x4B318A: cmp eax,3 / jnz`），却仍把层 36 当 Tex0（raw 135883）⇒ 语义上读的是陈旧/已清黑的 scratch。
- emulator：取本帧屏幕（`pixiBackend.ts:1256-1266`，注释里写明是**有意的改正**），模糊核是累积近似（`transition.ts:392-435` 的三处 `approximate`）。
- 归属：`tickets/T-0091`（U3 未确证项）。

**D5 ·【已确证·台账过期】`transition-table-flush` 记「未建模」，实际已建模**
- emulator：`scTransitionTick` 的清表门 `active.length === 0 && !poolPending()`（`transition.ts:597-607`，探针两宿主注入），守卫 `test/sc-transition-window.test.ts` 的「T-0091 G2」。
- 已在轮 14 把该条 capability 订正为 `modeled-verified/E2` + 守卫。

**D6 ·【已确证·潜在】SETWEATHER 用的 3D 天气/粒子子系统整体缺失**
- 链上位置：`NOVEL.txt:244 call-script 47 SETWEATHER`（两条路径都跑）；脚本用 `0x324`(销毁全部)/`0x325`/`0x326`(Snow)/`0x327`(Rain)/`0x328`(Leaf)/`0x329`/`0x32A`/`0x32C`/`0x32D`/`0x32E`/`0x32F`/`0x33F`（`src/SETWEATHER.txt:6-84`）。
- emulator：`0x324/0x325/0x326` 是 no-op（`ENGINE_INTERNAL_OPS`），**`0x327`/`0x328` 根本没注册**（命中即硬报错）⇒ capability `scene-3d-weather-effects-rain-snow-leaf` 记 absent。
- 本链是否受影响：`SETWEATHER.txt:14` 的门 `jcc (global-int 4fdb) …`（`jcc` = 第一值为 0 才跳）⇒ **`4fdb == 0` 时整脚本直落 `i1f5/exit`，什么天气都不建**；`4fdb != 0` 才会走到 `i327`（Rain）⇒ 届时 emulator 会硬报错。★要判"真机在这段有没有雨雪"就只需读 `global 4fdb`（一次读数，不是模拟）。

**D7 ·【已确证·emulator 独有】撤幕留帧（`#holdFrames`）在能力台账里没有条目**
- 实现：`pixiBackend.ts:838-853`（撤幕 → 留帧最多 60 帧）与 `:1470-1476`（留帧期间跳过 present；转场 pending 时不跳过）、`:1064-1066`（`releaseFrameHold`，读档点 `save-slot.ts:339` 调）。
- 引擎对照：主 present **不清后缓冲**（`Scene+46460` 全库唯一写点 = Scene ctor 写 0，raw 130425；读点 raw 136785）⇒ 引擎天然"留着上一帧"；emulator 的留帧是它的**代理实现**，但多了"最多 60 帧 + 只有新内容可见才解除"这套规则 ⇒ 拆场到新内容之间**屏上内容的时间线**可能与引擎不同。
- 归属：`tickets/T-0103`（本轮登记为**未建模的能力**，建议单开票或并入 T-0091 的 E4 对照）。

## 5. 结论（一句话）

**这条链上指令不缺、能力大都已建模**；本机与真机的差异来自四处：①**拆场没清 572B 立绘节点表**（D1，已确证、已开 `T-0144`）；②**转场末帧不合成**（D2，新发现，归 `T-0091`）；③**类别 3 的模糊源/核是近似**（D4）与**区间项没被排除出屏幕 pass**（D3，本链上多半被盖住）；④**天气子系统缺失**（D6，`4fdb != 0` 时才暴露）与**留帧是 emulator 自有机制**（D7）。

⇒ 下一步该做的是：**先修 D1**（否则任何连拍对照都会被残留立绘污染），**再按 T-0091 收 D2/D3/D4**，最后才谈 D6/D7 与"章节演出的观感对照"。
