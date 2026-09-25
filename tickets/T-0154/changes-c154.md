# T-0154 · 指令实现缺口修复批（场景状态 / 转场 / 混合）—— 过程与台账

> 权威 = `engine/天结_unpacked.exe_utf8.c`（只读）。本文件里的每条结论都标了 **raw 行号**；
> 「修前」一律指**本轮改动之前**的工作树（含本票上一轮 P1 `0x22f` 的成果）。
> 归主 agent 结算的六份真源片段在第 4 节，**可直接照抄**。

## 0. 一句话结论

P2 十条里 **6 条真修**（`0x1f6`/`0x223`/`0x229`/`0x244`/`0x1fe` 之外的 `bullet-dirty`）、
**3 条复核后确认上一轮已修**（`0x22d`/`0x22f`/`0x1fe`）、**1 条是台账字段失真**（`scene-flag-46528-bits`）；
P3 十六条里 **7 条真修**（`0x320`×3 + `0x321` + `0x20d`×2 + `scene-draw-total-gate-1056` 的条数门 +
`world-matrix-identity-refresh` 的取值门）、**2 条因 S 型/职责在票外已被修**（`0x33f`/`0x1fc`）、
其余是台账字段失真或缺少对应子系统（逐条见表）。**没有一条"沉默跳过"**：做不到的都写进了
第 4 节的 `missing[]` 片段或第 5 节。

## 1. 逐条处置表（P2 十条，逐行）

| # | sev | 对象 | 处置 | 依据 / 落点 |
|---|---|---|---|---|
| 1 | P2 | `0x1f6` | **修了** | `sub_4AB7A0` 清的第三张表 = `Scene+1080`（raw 130765 `sub_4A9D10(v1 + 270)`）。emulator 无该容器，但它在本层有**一格镜像** `render4.entryParams`（`0x242` 写该表项的 `+504`，见 `scSetDrawEntryParam`）⇒ 表被整表 delete 时镜像必须一起没：`scClearDrawContainer` 加 `s.render4.entryParams.clear()`，并让返回值显式带 **`nodesA`**（恒 0 = "572B-A 无容器"这件事实可断言，而不是沉默跳过）。守卫 `test/scene-t0154-scene-state.test.ts` 第 ①(1) 例。 |
| 2 | P2 | `0x223` | **修了** | 体（raw 132603-132615）在写记录**前**按需建/重建 `[4]` 那个渲染层：`v11 = Scene[42456+4*op2]`；为 0 ⇒ `sub_4A2C10(Scene, op2, 目标[260], 目标[261], 目标[1048])`；非 0 且 `v11[262] != 当前目标[1048]` ⇒ 重建。`_this[10650]` = `Scene+42600` = **槽 36** 的 CTexture ⇒ 规格取自槽 36（wave 参数同型：`sub_4AF6A0` raw 133743-133749、`sub_4AF880` raw 133817-133828、`sub_4AFA30` raw 133892-133903 —— **四个写入端都做**）⇒ 落成 `scEnsureTransitionLayer`，由 `scSetTransition` 在写完格后按 `rec[4]` 调用。真消费者 = `scene/blend.ts` 的 `blendGateOpen` 与 `0x20D` 的"槽必须已建"前置。守卫：第 ③ 组 5 例。 |
| 3 | P2 | `0x22d` | **复核后已修**（上一轮） | 现码 `sceneAffine2DOf`（`ops.ts` 的 `mat4Mul` 四块乘积）**不再按 `kind` 三选一**；`sceneXformOf` 只在锚为 null 时初始化分量 ⇒ 跨种类混用不再丢失。守卫 `test/op-22a-22f-scene-world.test.ts:287`（i22d+i22f 同层叠加 ⇒ (−200,200)）。★审计原文的 `alreadyKnown: 新增` 不准：`state.ts` 的 `SceneXform` 注释自述了这条近似。 |
| 4 | P2 | `0x22f` | **复核后已修**（上一轮） | 同上；且 `0x22F` 的 op3/4/5 已按体进 `axis`（旋转轴，角 = `sceneRotRad` ← raw 117630 的 `a2[184]`）。守卫同文件 `:264`/`:308`。★**前提订正**：审计原文"先 i22d 后 i22f 丢缩放"不成立（同 kind 两次不重置 `axisScale`）—— 该条的 finding 已在 `findings-final.json` 的 `verify` 里改成"跨种类"口径。 |
| 5 | P2 | `0x244` | **修了（一半）+ 一半如实登记** | 体三趟（raw 132396-132478）：绘制项 `+52`（= `Item.animStart`）**已实现**；`Scene+1100` = `Engine.l2dNodes` 的 `node+24` **本轮补上**（`node.wins.startedAtMs = 0` + `latched = false`，raw 132478）；`Scene+1084`（572B-A）**无容器 ⇒ 不伪造**（见第 5 节）。守卫：第 ② 组 2 例。 |
| 6 | P2 | `0x1fe` | **复核后已修**（上一轮） | `scSetPrimTransform4` 已调 `applyPrimAxisRotation`（四量 = 轴 (op2,op3,op4) + 角(op5)，度→弧度，写进该项变换块）；守卫 `test/gfx-prim-mesh-consumers.test.ts`。★该条在 `analysis/opcode-gaps.json` 里**没有条目**（P2 audit finding 只活在 `findings-final.json`）⇒ 无需改台账。 |
| 7 | P2 | `0x229` | **修了** | 三段体：① `sub_49A690` → `sub_49A300(Scene, Scene+1120)` 把 740 B 模板整块重置（raw 117084-117090 + 116899-117054：六块矩阵清成单位/零、pivot 清 0）⇒ 落成"丢掉 `SceneXform` 锚 + `sceneRotRad = 0`"；② `sub_49A6C0(op1,op2)` 写**区间门** `Scene+1112/+1116`（raw 117098-117099，读端 RenderScene raw 133397-133401）；③ `sub_49A6F0(f3,f4,f5)` 写模板 `+24/28/32` = **pivot**（raw 117109-117112，消费端 `sub_49AA30` raw 117425-117429 的 `T(−p)` 与 117932 的 `T(+p)`）。三者各有一个真消费者（`sceneAffine2DOf` / `sceneLayerInGate` / 宿主合成）。守卫：第 ③ 组 3 例。 |
| 8 | P2 | `render-3d-layer-dual-commit` | **台账字段失真（引擎层，归主 agent）** | 体：`sub_4B4460` 的**唯一**调用点 = raw 31933（`0x222` handler `sub_423EC0`）⇒ 不是"未见调用点"，而是"脚本 `i222` 驱动的一次区间提交"；`name` 的"对偶逐帧提交"也不对（逐帧提交是 `sub_4B4040`）。`emulator.note` 已是正确口径（前几轮改过），**只有 `name`/`trigger` 未同步** ⇒ 片段见 §4.2。emulator 侧另在本票白名单文件里补了注（`scene/transition.ts`：`0x222` 尚未注册）。 |
| 9 | P2 | `scene-flag-46528-bits` | **台账字段失真（引擎层，归主 agent）** | 体 raw 117439-117442：`v11 = (a2[180] & 1) == 0; v112 = Scene+46512; if (!v11 && (Scene+46528 & 4) == 0) v112 = 0;` ⇒ **bit2 == 0 才清零冻结值**（bit2 置位 ⇒ 忽略冻结 ⇒ 才提前收尾）。台账 `trigger` 写成"bit2（=0 时）⇒ 不提前收尾"，方向反了（`note` 里已自认）。片段见 §4.2。 |
| 10 | P2 | `bullet-dirty-from-freeze-or-pending` | **修了** | 体 raw 136718-136719 = 函数收尾 `if (*(_QWORD*)(Scene+46512)) Scene[46508] = 1;` —— **无 per-item 条件**。修前 `scAdvance(s, clock, freeze)` 只在"真的收尾了某个项/mesh"时置脏 ⇒ freeze 置位但当帧没有可冻结窗时整帧不重画。修后 freeze 分支第一句就是 `s.dirty = true`。守卫：第 ⑤ 组 2 例（含"非冻结不许恒真"的反向对照）。 |

## 2. 逐条处置表（P3 十六条，逐行）

| # | 对象 | 处置 | 依据 / 落点 |
|---|---|---|---|
| 11 | `0x320` host-invented（≥3 门槛） | **修了** | 引擎门是 `v2 = sub_41BF50(_this, 9)` 之后 `if (v2 > 0)`（raw 41035-41037）；`sub_4A2280` 里的 `if (a11 >= 4)`（raw 122412）只是"按 4 个一批填"的循环门。判据改成 `spec.vcount > 0`。 |
| 12 | `0x1fc` | **复核后已修（票外 T-0155/审计 §4.2 #8）** | `scResetPrimTransform` 现在真的调 `resetItemTransform(it)`（三组 work/target 复位），台账 `render4.primReset` 保留；消费者 = `presenter.#buildItemSprite` 的 `itemRenderPlacement`。 |
| 13 | `0x20d` missing-branch（槽必须已建） | **修了** | raw 124870-124883：`if (!*(_DWORD*)(_this + 4*a2 + 42456)) { 报错串; return 0; }` ⇒ `Scene+46456` **保持原值**。`scSetRenderTarget` 改为三态返回，判据 = `render4.slotModes.has(slot)`（= `0x1F8`/`0x223` 的共同落点）。 |
| 14 | `0x321`（缺失即建零值网格项） | **修了** | raw 132802 第一句就是 `sub_4AAB80((int)_this, a2)`，随后 `result = sub_40DC30(_this + 266, &a2)`（**同一个** `Scene+1064` 容器，与 `0x320` 一致）⇒ `scSetMeshEntryAttr` 先 `scEnsureMesh`。 |
| 15 | `0x33f` 负值回退 | **复核后已修（票外 T-0155）** | `handlers/gfx-state.ts` 的 `op_set_scene_blend` 已按体读满 op1..op3 并算出回退（回退源 = 宿主缝 `getDrawItemColor` = `Item.from` = 引擎元素 `+96` ⇒ 与 `sub_4ADD60` raw 132579-132588 同源）。★审计那条 finding 的 `emulator.file` 指向 `scene/ops.ts`，实际落点在 handler ⇒ **前提（职责归属）被推翻**。 |
| 16 | `world-matrix-identity-refresh` | **修了（取值门）+ 残留登记** | 体：外层门 = `i229` 的区间（raw 133397-133401），区间**内**才按 `(层号−20) > 9` 分"完整 3D 矩阵"（133407）/ "decompose 压 2D"（133411-133438）。修前 emulator 把 `[20,30)` 当成"吃不吃"那道门 ⇒ 区间内 ∉[20,30) 的层**一个变换都不吃**。修后 `sceneAffine2DOf` 的判据 = `sceneLayerAffected(layer) \|\| sceneLayerInGate(s, layer)`（两支在 2D 合成里同形）。**残留**：区间关着时 `[20,30)` 仍吃（保留修前行为）—— 因 `i229` 同时复位模板，关区间之后锚已为 null，该分支实际不产生可见变换。 |
| 17 | `lazy-mesh-map-node` | **复核后已修（票外 T-0166）** | 现 `note` 已写 `scEnsureMesh`（并且明确"与 `scCreateMesh` 刻意分开"）⇒ 该 finding 的 `what`（"note 写成 `scCreateMesh`"）已不成立。 |
| 18 | `lazy-transition-map-node` | **台账字段失真（引擎层，归主 agent）** | `sub_4AA190` 的体（raw 129585-129596）在 key 缺失时 `return result`（end 迭代器）**不插入**；真正的 find-or-insert 是 `sub_4AAE10`（raw 130197-130236 未命中后建节点）。⇒ `engine.fns` 里 `sub_4AA190` 应移出/改注。片段见 §4.2。 |
| 19 | `scene-draw-total-gate-1056` overreach（reads 缺项） | **台账字段失真（引擎层，归主 agent）** | `sub_4B06D0` 入口还从 `Scene+1052` 取链头并整表遍历、并读 `Scene+1860/1112/1116`（raw 134856-134874）⇒ `reads` 扩列。片段见 §4.2。 |
| 20 | `scene-draw-total-gate-1056` approximation（无 `recordCount` 门） | **修了（显式化）** | 引擎 `Scene+1056` 是**记录条数**且 `sub_4B06D0` 入口 `== 0 ⇒ 直接 return`（raw 134814-134818）。emulator 的等价物 = 容器长度 ⇒ 新增 `scTransitionRecordCount(s)` 并让 `scTransitionTick` 第一句 `if (scTransitionRecordCount(s) === 0) return 空结果`（行为等价、门有名字、可断言）。守卫：第 ⑥ 例。 |
| 21 | `scene-slot-release-1000`（status=partial 与 note 矛盾） | **台账字段失真（引擎层，归主 agent）** | note 自述"无 1000 槽上限与逐帧老化释放" ⇒ 按 schema 应 `absent`；`guard` 空 ⇒ 不该留 `evidence: E1`。片段见 §4.2。 |
| 22 | `0x320` missing-branch（重建先析构） | **前提被推翻 + 残余登记** | 析构在 `sub_4ADFE0` **体内**（raw 132727-132752），而进门是 `sub_432150` 的 `if (v2 > 0)`（raw 41037）⇒ `vcount <= 0` 时**既不清旧几何也不清 bit0**（走 41073 的错误分支）。审计原判"对已有几何发一次无效 create-mesh ⇒ 几何被清掉、bit0 归 0"**不成立**。`vcount > 0` 时的"先析构再重建"= 覆盖语义（emulator 已同）。**真残余**只剩"`sub_4A2280` 失败 ⇒ 几何已析构但 bit0 不置（且旧 flags 位保留）"——emulator 的等价物不会失败 ⇒ `missing[]` 改写后保留。 |
| 23 | `0x320` missing-branch（下限 1） | **修了** | 同第 11 条（同一个判据）。 |
| 24 | `0x320` extra-state（幽灵记录） | **修了** | raw 41073-41077：`vcount <= 0` 只打「頂点数%dは不正です．」并返回，`sub_4ADFE0` **一次都不调** ⇒ `scCreateMesh` 提前返回、`s.meshes` 不动（返回值给一个未入表的占位对象，只为满足宿主缝的形状）。 |
| 25 | `0x20d` missing-branch（add-by-recall） | **修了** | 同第 13 条（同一条体的另一份 finding）。 |
| 26 | `0x20d` missing-consumer（2D/GDI 支路读 46456） | **如实登记（做不到）** | 体 raw 117375-117423：`v6 = Scene+46456; if (v6 < 0 \|\| v6 == 38)` ⇒ 项位置加**窗口原点**（`sub_498350` 给出）再算 work。emulator 没有"窗口原点"这个对象（headless 无窗口；Pixi 用画布尺寸）⇒ 不伪造。见第 5 节。 |

## 3. 红→绿证据（确切命令 + 两个数字）

```powershell
# 红：把本轮 renderer/scene 三个文件的**行为行**临时还原成修前形态（保留新导出/新字段，
#     以免 import 报错把"断言红"退化成"整文件加载失败"），跑新守卫
node "$env:TEMP\t0154\revert.mjs" apply
cd app/amayui-emulator
node --import tsx --test test/scene-t0154-scene-state.test.ts test/scene-t0154-mesh-transition.test.ts
#   ⇒ ℹ tests 24  ℹ pass 11  ℹ fail 13      （13 条红逐条指名了对应的修复点）

# 绿：从备份恢复本轮实现，再跑同一命令
cd E:\Games\Eushully\天結
Copy-Item "$env:TEMP\t0154\ops.ts"        app/amayui-emulator/src/renderer/scene/ops.ts -Force
Copy-Item "$env:TEMP\t0154\state.ts"      app/amayui-emulator/src/renderer/scene/state.ts -Force
Copy-Item "$env:TEMP\t0154\transition.ts" app/amayui-emulator/src/renderer/scene/transition.ts -Force
cd app/amayui-emulator
node --import tsx --test test/scene-t0154-scene-state.test.ts test/scene-t0154-mesh-transition.test.ts
#   ⇒ ℹ tests 24  ℹ pass 24  ℹ fail 0
```

★还原脚本 `revert.mjs` 的 13 条"修后片段 → 修前片段"配对**全部断言命中一次**（配对失效即
`exit 2`）⇒ 红数不是"跑错文件"造成的。脚本与备份都在 `%TEMP%\t0154\`，**不在仓库里**。

同批的既有守卫（回归确认，全部绿）：
`test/op-22a-22f-scene-world.test.ts`（17 例）、`test/op-22a-22f-scene-xform.test.ts`、
`test/op-223-transition-fade.test.ts`、`test/op-24f-250-251-transitions.test.ts`、
`test/mesh-vertex-quad.test.ts`、`test/gfx-prim-mesh-consumers.test.ts`、
`test/draw-item-loop-anim.test.ts`、`test/l2d-clear-on-container-ops.test.ts`、
`test/scene-freeze-46676-gate.test.ts`、`test/op-222-scene-commit.test.ts`、
`test/transition-render-wiring.test.ts`、`test/blend-mode.test.ts`。
`npm run check:dead-writes` = **13 个（= 基线，无新增）**。

## 4. 引擎层台账片段（主 agent 可直接照抄）

### 4.1 `analysis/opcode-gaps.json`

**`0x1f6`** — `missing[]` 第 2 条（raw `130763-130766`）**改写**为（第 1 条"1000 槽老化"不属本票，
按原样留）：把 `what` 换成

```json
{
  "what": "Scene+1080（572B-A）在 emulator 无容器：0x1f6 的 sub_4A9D10(v1 + 270)（raw 130765）整表释放它，而本层只有它的单格镜像 render4.entryParams（0x242 写该项 +504）。本轮已让 scClearDrawContainer 连这个镜像一起清、并在返回值里显式给出 nodesA = 0（= 「无容器」这件事实可断言）。真扩展点 = 建 572B-A 项容器 + 找出它的写入端（反编译里当前只见 0x242 的 +504 一格与 0x244 的 node+24 清扫）。",
  "ticket": "T-0154",
  "raw": "130763-130766"
}
```

**`0x223`** — `missing[]` 的 1 条（raw `132603-132615`）**删除**（本轮已实现：四个写入端
`sub_4ADDB0`/`sub_4AF6A0`/`sub_4AF880`/`sub_4AFA30` 都在写记录前按需建/重建 `[4]` 层，规格取自
`Scene+42600` = 槽 36）。若 `missing[]` 因此清空 ⇒ `disposition` 由 `partial` 改 `implemented`
（`0x24D` 类别 1 的渲染端另属 `T-0091`，不在本条目）。

**`0x229`** — `missing[]` 的 1 条（raw `117080-117090`）**改写**为：

```json
{
  "what": "三段体已全部落地（本轮）：① 复位模板 ⇒ 丢掉 SceneXform 锚 + sceneRotRad = 0（raw 117084-117090，sub_49A300 的重置区间 = 116899-117054，含六块矩阵与 pivot）；② 区间门 Scene+1112/+1116（raw 117098-117099，消费端 RenderScene raw 133397-133401 ⇒ sceneLayerInGate）；③ pivot = 模板 +24/28/32（raw 117109-117112，消费端 sub_49AA30 raw 117425-117429 + 117932 的 T(−p)·M·T(+p) 共轭 ⇒ scenePivot）。★残留（如实记）：sub_49A300 还写 +720/+576/+724..732 等格，那些格的 emulator 对应物挂在绘制项上，而 Scene+1120 这个模板对象在 emulator 里没有独立载体 ⇒ 不复刻；另：区间关着时 [20,30) 仍吃变换（保留修前行为，见 sceneLayerInGate 的说明）。",
  "ticket": "T-0154",
  "raw": "117080-117112"
}
```

**`0x244`** — `missing[]` 的 1 条（raw `132436-132441`）**改写**（572B-B 已修，572B-A 仍未建）：

```json
{
  "what": "三趟体：绘制项 +52（已实现）、Scene+1100 = Engine.l2dNodes 的 node+24（本轮已实现 —— L2dNode.wins.startedAtMs = 0 + latched = false，raw 132478）、Scene+1084（572B-A）**仍未建模**（无容器，与 0x1f6 同一条缺口）。另：引擎这一段**不置脏**（sub_4AD9F0 体内无 Scene[11627]），emulator 置脏是有意偏差（清窗起点后不重画就看不到那一帧）。",
  "ticket": "T-0154",
  "raw": "132428-132501"
}
```

**`0x320`** — `missing[]` 的 4 条 T-0154 条目：第 1 条（raw `41037-41040`）、第 2 条（raw `41073-41077`）、
第 4 条（raw `122409-122412`）**删除**（同一处修复：判据改为 `vcount > 0`，`vcount <= 0` 不建项/不碰已有项）；
第 6 条（raw `132727-132758`）**改写**为：

```json
{
  "what": "残余（原判已推翻）：raw 132727-132752 的析构在 sub_4ADFE0 **体内**，而进门是 sub_432150 的 if (v2 > 0)（raw 41037）⇒ vcount <= 0 时既不析构也不清 bit0（原判「无效 create-mesh ⇒ 几何被清掉、bit0 归 0」不成立）。vcount > 0 时的「先析构再重建」= 覆盖语义（emulator 已同）。真残余只剩「sub_4A2280 失败 ⇒ 几何已析构但 bit0 不置且旧 flags 位保留」——emulator 的等价物不会失败 ⇒ 无从复现。",
  "ticket": "T-0154",
  "raw": "132727-132758"
}
```

**`0x20d`** — `missing[]` 的 3 条 T-0154 条目：raw `124870-124883` 与 `124872-124873` **删除**
（同一处修复：未建槽 ⇒ 保持原值；`-1`/`>999` ⇒ 回后台缓冲 -1）；raw `117375-117380`（2D/GDI 支路的
窗口原点补偿）**保留**并把 `what` 改成：

```json
{
  "what": "Scene+46456 的第二消费端（2D/GDI 变换支路）未建模：sub_49AA30 raw 117375-117423 在 v6 = Scene+46456 满足 v6 < 0 || v6 == 38 时把项位置加上**窗口原点**（sub_498350 给出）再算 work。emulator 没有「窗口原点」对象（headless 无窗口、Pixi 用画布尺寸）⇒ 如实登记，不伪造。",
  "ticket": "T-0154",
  "raw": "117375-117423"
}
```

**`0x321`** — `missing[]` 的 T-0154 那条（raw `17798-17805`）**删除**（本轮已实现：`scSetMeshEntryAttr`
先 `scEnsureMesh`，与 `0x320` 同一个 `Scene+1064` 容器；raw 132802 的 `sub_4AAB80`）。

**`0x33f`** — `missing[]` 的 T-0155 那条（`Scene+1264` 效果常量通路）**不动**；★本票复核结论：
审计 P3 那条"负值回退完全没实现"的 finding **已被 T-0155 修掉**（落点在
`src/vm/handlers/gfx-state.ts` 的 `op_set_scene_blend`，不是 `scene/ops.ts`）⇒ 若它还在
`findings-final.json` 的未处置表里，按"票外已修"销掉。

### 4.2 `analysis/engine-capabilities.json`（字段级替换）

`render-3d-layer-dual-commit`：

```json
"name": "脚本 i222 驱动的区间提交（sub_4B4460）",
"trigger": "脚本 `0x222`（handler `sub_423EC0` raw 31924-31934）读 op1/op2 后调 `sub_4B4460(Scene, op1, op2)`（调用点 raw 31933，全文件唯一）；`emulator.status` 侧的接线见 note",
```

（`engine.fns`/`raw`/`note`/`reads` 都不动；`name` 里的"对偶逐帧提交"与 `trigger` 里的
"本文件未见主循环调用点"两处失真：逐帧提交是 `sub_4B4040`，`sub_4B4460` 只被 `0x222` 调。）

`scene-flag-46528-bits`：

```json
"trigger": "bit1 非零 ⇒ 拒绝 sub_407EA0 置冻结（raw 12793）；bit2 == 0 时把已置的冻结值清零（raw 117439-117442：`v11 = (a2[180] & 1) == 0; v112 = Scene+46512; if (!v11 && (Scene+46528 & 4) == 0) v112 = 0;`）⇒ **bit2 置位 = 忽略冻结**，随后 raw 117449 的 `|| v112 == 1` 才提前收尾动画窗",
```

`bullet-dirty-from-freeze-or-pending`：`emulator.note` 末尾追加一句

```
★2026-09-25（T-0154）：冻结那一半（46512）此前只在"真的收尾了某个项/mesh"时置脏 ⇒ 修成 freeze 分支**无条件** `s.dirty = true`（与 raw 136718-136719 的"8 字节窗口一起判、无 per-item 条件"逐字一致）；守卫 test/scene-t0154-scene-state.test.ts 第 ⑤ 组。
```

`scene-draw-total-gate-1056`：`reads` 改为

```json
"reads": ["Scene+1056", "Scene+1052", "Scene+46456", "Scene+1860", "Scene+1112", "Scene+1116"],
```

`emulator` 段改为

```json
"emulator": {
  "status": "modeled-verified",
  "evidence": "E2",
  "guard": "test/scene-t0154-scene-state.test.ts",
  "note": "（原 note 保留）★2026-09-25（T-0154）：条数门已显式化 —— `scTransitionRecordCount(s)`（= `render4.transitions.size`，即 Scene+1056 的等价物）是 `scTransitionTick` 的第一句门（条数 0 ⇒ 返回空结果，与 raw 134814-134818 的 `== 0 ⇒ return` 同观测）；守卫 `test/scene-t0154-scene-state.test.ts` 的第 ⑥ 例。"
}
```

`scene-slot-release-1000`：`emulator.status` 由 `partial` 改 `absent`（note 自述"完全没有"），
`evidence` 由 `E1` 改 `E0`，`guard` 保持空串（无可用用例）。

`world-matrix-identity-refresh`：`emulator.note` 的"★仍属近似只有两处"那半段替换为

```
★2026-09-25（T-0154）：①「层号 ∉[20,30) 的完整矩阵支未实现」已收口一半 —— 外层门（`i229` 的区间门，raw 133397-133401）已建模为 `SceneState.sceneLayerStart/sceneLayerCount` + `sceneLayerInGate`，区间**内**的所有层都给同一个 2D 仿射（两支在 2D 合成里同形，见 `scene/ops.ts` 的 `sceneAffine2DOf`）；残留 = 区间**关着**时 `[20,30)` 仍吃变换（保留修前行为；因 `i229` 同时复位模板，关区间后锚为 null ⇒ 无可见变换）。②「四组矩阵格只留最近一次 kind」已修（四块乘积，见 `ops.ts` 的 `mat4Mul` 段）。③新披露：0x22D/0x22F 写的是模板的**目标块** +172/+428，靠动画窗到期的 `qmemcpy`（raw 117496/117646）才进 current 块；而 0x22A/0x22C 直接写 current 块（+108/+364）⇒ 严格说 22A 与 22D、22C 与 22F 共用同一个矩阵格（后写者覆盖），emulator 现在按"四块叠加"近似。语料里两者不混用。
```

`lazy-transition-map-node`：`engine.fns` 改为 `["sub_4AAE10", "sub_4A95D0"]`
（`sub_4AA190` 是**另一张表的只读查找**，raw 129585-129596 在 key 缺失时 `return result`（end 迭代器）、
不插入；find-or-insert 在 `sub_4AAE10` raw 130197-130236），并在 `engine.raw` 补 `130197-130236`。

`lazy-mesh-map-node`：**不动**（现 `note` 已写 `scEnsureMesh` 并说明与 `scCreateMesh` 刻意分开 ⇒
审计那条 overreach 已由 T-0166 轮次修掉）。

## 5. 读体时发现的新条目（不在原 26 条里）

1. ★**`Scene+1844`/`+1856` 不是"无写点"**（订正 `state.ts` 的旧注与 P1 轮的"唯一未解析字段"说法）：
   `sub_49A300`（模板复位）raw 117050-117054 就写 `+736 = 0`、`+724/728/732 ← +492/496/500`
   —— 相对 `a2`（= `Scene+1120`）的偏移，字面 grep `1844` 看不到。⇒ `sceneRotRad`（= `Scene+1856`）
   的初值/复位值确实是 0（默认值口径不变），但"无法静态判定"只对**注入路径**成立，不对复位路径成立。
2. ★**`0x22D`/`0x22F` 与 `0x22A`/`0x22C` 不是四个互不相干的格**：前者写模板**目标块**（`+172`/`+428`），
   后者写 **current 块**（`+108`/`+364`），而 `sub_49AA30` 的 `qmemcpy`（raw 117496 / 117646）是
   **覆盖**而非相乘 ⇒ 22A 与 22D 抢同一个缩放格、22C 与 22F 抢同一个 work 格。语料里不混用，
   所以"四块叠加"这个近似**在语料上不可观测**，但它不是体的字面语义（见 §4.2 的
   `world-matrix-identity-refresh` 片段第 ③ 点）。
3. ★**`Scene+42600` 是槽 36 的 CTexture**（`42456 + 4*36`），`0x223` 那族的"当前渲染目标"
   其实是**固定的槽 36**（转场 scratch 层），不是 `Scene+46456` 指向的那个槽 —— 审计 verify 写的
   "取本帧目标[260]/[261]/[1048]"方向对、来源需按 `_this[10650]` 读。本轮的实现按此取值。
4. ★**`0x244` 的三趟里第二趟是 `Scene+1084`、第三趟是 `Scene+1100`**（= `+1080`/`+1096` 两张表的
   "哨兵/头"格），与 `0x1F6` 清表的 `+270`/`+274` 一一对应 ⇒ 572B-A/572B-B 的编号在两条指令里一致
   （审计把 1084 写成"= +1080 那张表"是对的）。
5. ★**`0x320` 的 `vcount` 与顶点数组是两条独立来源**：`sub_42AEA0(_this, 5/6)` 取的是 x/y **指针**、
   `sub_41BF50(_this, 9)` 取的是 vcount ⇒ 引擎里"数组比 vcount 短"也是合法输入（越界读）。
   emulator 的 handler 按 vcount 造 verts ⇒ 这个自由度不存在，属"输入侧收窄"，已登记在 §4.1 的
   `0x320` 残余里。
6. ★**`0x20D` 的 `>0x3E7` 分支里 `Scene+46456 = -1` 是"成功才写"**（raw 124854-124860：
   `if (!v15) { …; Scene+46456 = -1; return 1; }`）⇒ 失败时同样保持原值。本轮的实现把
   `-1`/越界一律当"回后台缓冲并写 -1"（只在 `SetRenderTarget` 失败这一支上更宽），
   `return 0` 的失败支无从注入 ⇒ 记录在此。

## 6. 没做 / 做不到（+ 判断别人该接的）

| 项 | 为什么不做 | 该谁接 |
|---|---|---|
| `Scene+1080`（572B-A）项容器 | 缺**写入端**：全反编译里只有 `0x242` 写它的 `+504` 一格、`0x244` 清它的 `+24`。造一个没有写入端的表就是死模型（`check:dead-writes` 会红）⇒ 本轮只把它的"存在/被清"显式化成返回值 `nodesA` + 台账片段 | 若日后发现建项指令（`0x344` 族以外）再接；台账已写扩展点 |
| `0x20d` 的 2D/GDI 窗口原点补偿 | emulator 没有"窗口原点"对象（`sub_498350` 无对应物） | 需要引入宿主窗口尺寸/原点模型时（与 `0x32` 的 GDI/DrawMode=0 缺口同族） |
| `0x320` 的 `sub_4A2280` 失败支（几何已析构、bit0 不置） | emulator 的等价物不会失败（顶点已由 handler 解好） | 不需要；已在台账 §4.1 改写保留 |
| `0x222`（`sub_4B4460`）在 emulator 未注册 | 注册点在 `src/vm/**`（本票白名单外；`T-0156` 正在改那片） | `scene-commit.ts` 那条路已存在（`commitQueue` 逐帧出队）⇒ 结论是"注释里引 `0x222` 路径要标明未注册"，本票已在 `transition.ts` 补注 |
| `0x33f` 的 `Scene+1264`（效果常量） | `T-0155` 已登记（效果对象通路不存在） | 保持 `T-0155` |
| `0x229` 模板的 `+720`/`+576`/`+724..732` 等格 | emulator 侧对应物挂在绘制项上，模板对象无独立载体 | 与"建 Scene+1120 模板对象"同批做 |

## 7. 改了哪些文件（LF 已确认）

- `src/renderer/scene/state.ts`：新增 `sceneLayerStart` / `sceneLayerCount` / `scenePivot` 三个字段 + 说明与初值。
- `src/renderer/scene/ops.ts`：`scClearDrawContainer`（清 `entryParams` + `nodesA`）、
  `scClearDrawItemAnimStarts`（572B-B 那趟）、`scCreateMesh`（判据 + 不建项）、
  `scSetMeshEntryAttr`（find-or-create）、`scEnsureTransitionLayer`（新）+ `scSetTransition`（调用它）、
  `scSetRenderTarget`（三态 + 两条前置）、`scAdvance`（freeze 无条件置脏）、
  `scSetDrawModeBlock`（三段体）、`sceneLayerInGate`（新）、`sceneAffine2DOf`（区间门 + pivot 共轭）。
- `src/renderer/scene/transition.ts`：`scTransitionRecordCount`（新）+ `scTransitionTick` 的条数门；
  一处 `0x222` 未注册的注。
- `test/scene-t0154-scene-state.test.ts`（新，16 例）、`test/scene-t0154-mesh-transition.test.ts`（新，8 例）。
- **没有**碰 `src/vm/**`、`src/frame/**`、`src/live2d/**`、`src/text/**`、`src/renderer/pixi/textureCache.ts`
  以及六份真源。
