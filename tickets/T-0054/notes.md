# T-0054 · 过程笔记（notes.md）

> ★**评估正文（Live2D 系统能力速查 / ★要不要引依赖库的三路线比对 / 工作量 / 分阶段计划 / 待拍板项）
> 已单独成文 → `docs-new/04-app/live2d-support-assessment.md`。**
> 本页只保留**这张单自己的东西**：范围与产出、决策记录（拍板后追加）、acceptance ↔ 阶段对照、复核命令。
> **不把评估正文抄回来**（会两处漂移）。

---

## 1. 本单范围与产出（M0，已完成）

- **范围**：先评估「支持 Live2D 要不要引入额外的依赖库、这套 Live2D 系统大概有什么能力」，再按 M1/M2/M3 落地（判据见 `ticket.json` 的 acceptance）。
- **产出**：
  - 评估正文：`docs-new/04-app/live2d-support-assessment.md`（系统能力 / 依赖路线 / 工作量 / 计划 / 待拍板）；
  - 引擎语义长文：`docs-new/03-engine/live2d.md`；
  - **格式长文（验收 #2 ①）**：`docs-new/03-engine/live2d-moc-format.md`（每条格式事实标 S1/S2/S3/O/E 来源）；
  - 数据层：`analysis/functions.json` 新增 **44 条** L2D 条目；`analysis/engine-capabilities.json` 的 5 条 Live2D 条目全部重评（见 §6）；
  - 变形语义报告（oracle 专项）：`docs-new/99-records/2026-09-live2d/live2d-deform-semantics.md`（856 行，逐条带 raw 行号）；
  - 本单（`ticket.json` + 本文件）。
- **结论一句话**：内嵌 SDK **2.0.06 for DirectX**（Cubism 2.x）；资产 `.MOC/.MTN/PNG`，**无需 `.model.json`、无需 moc3 转换**；**推荐自研移值**（无新依赖、可 headless）；唯一待拍板 = **是否接受把 `live2d.min.js`（专有运行时）随补丁再分发**。

---

## 2. 决策记录（拍板后在此追加，一条一次）

| 日期 | 决策 | 依据 / 影响 |
|---|---|---|
| 2026-09（评估） | 评估结论：**不引 Cubism 5**（只吃 moc3）；**B（`live2d.min.js`）仅作一次性对照 spike**；**主线走 C 自研移值** | 见评估文档 §3（四条判定标准 + 三路线表） |
| **2026-09-16** | **用户拍板：按 C（自研移值）实施**；参考源纪律 = **规范优先 / 资产实证兜底 / 反汇编只当 oracle**（`.moc` 字节布局无公开规范 ⇒ 用 335 个样本逼格式，反汇编降级为 oracle） | 评估文档 §3.3/§3.5；许可项（`live2d.min.js` 再分发）随之作废；本单转 `doing` |
|  |  |  |

> 追加格式：`\| YYYY-MM-DD \| 决策 \| 依据/影响 \|`。拍板后同时回写评估文档 §3.3/§6 与 `docs-new/03-engine/live2d.md` §7 的一句话结论。

---

## 3. acceptance ↔ 阶段对照

| acceptance | 阶段 | 状态 | 备注 |
|---|---|---|---|
| #1 | **M0 → M1 前置** | ✅ | 依赖路线定案（评估文档 §3） |
| #2 ① | **M1 格式长文** | ✅ | `docs-new/03-engine/live2d-moc-format.md`（S1/S2/S3/O/E 逐条标注） |
| #2 ② | **M1 解析不变量测试** | ✅ | `test/live2d-moc.test.ts`：**335/335** 逐字节 + 结构不变量全绿 |
| #2 ③ | **M1 资源直读 + 出画** | 🟡 部分 | 资源直读已通（`.MOC`/PNG/`.MTN` 按统一 id 从 `raw/` 直读，`test/live2d-chain.test.ts`）；**Pixi 侧三角网格已接**（第四类图元，见 §4.1）；**未做**：① E4 真界面截图（"真的出现在屏幕上"没有自动化断言）；② `0x346`–`0x34D` 对节点的控制（语料 0 次使用，节点矩阵恒单位阵） |
| #3 | **M2 装载/绑定/推进** | ✅ | 5 条 opcode 语义全落地 + `.MTN` 解析 + 入队 + **`scL2dTick` 已接进两个宿主的 `advanceModel`**（只在"这一帧真要画的节点"上推进，与引擎 raw 92578-92615 同口径） |
| #4 | **M3 集成/门控** | ❌ | `global a9d0` 未真读；`live2d-slot-probe` 未接进 `sceneNeedsRender` |
| #5 | **M3 验证** | 🟡 部分 | E3 已做（4 组守卫，共 15 条断言组）；**E4 已取得**（`.tmp/l2dfix-0-title.png` 角色完整出画 vs `.tmp/t0042d-0-title.png` 修前"没有角色"）⇒ 见 §4.2；**还差** `a9d0 != 0` 静图回落支的对照截图 |
| #6 | **M3 文档** | ✅ | `opcode-table.md` 的 `0x344/0x345/0x34E` 订正 + `0x34F/0x350/0x351` 转「已核对」；`stub-reaudit-2026-09.md` §1.2 加改判注记（Live2D 一行整条划掉 + 理由） |

---

## 4. 本次（2026-09 续做）实际改了什么

**★解析器修了两个"字节流全对、语义全空"的静默 bug**（这是 M1 的真正突破点）：

1. **refno 表只登记了部分 kind**：`sub_4C7220` 在**每个**对象读完都写表（raw 152637），而实现只对 id/字符串/数组调 `reg()` ⇒ `AffineEnt(69)`/`ParamPivots(67)`/`PivotManager(66)`/`PartsData(133)`/`DrawData(70)`/`BDBoxGrid(65)` 在表里是空洞 ⇒ 指向它们的 refno 全解析成 `undefined`。
   **症状**：`BDAffine.affines` 恒为 0（4085/4085）、`PivotManager.params` 恒为空 —— 而**字节恰好读完**，所以字节级检查抓不到。
2. **复合对象缺 `kind` 判别字段**：`readAffineEnt()` 返回的对象没有 `kind`，而消费侧 `filter(kind === 'affineEnt')` ⇒ 全被滤掉（同一个症状）。

修完之后（E：335/335）：
```
BDAffine.affines.length == pivotOpacities.length == ∏pivotCount   （4085/4085）
DrawData.pivotPoints == pivotDrawOrders == pivotOpacities == ∏pivotCount （6686/6686）
pivotCount 取值 {2,3,4,5,21}；单对象最多 5 个参数（3^5 = 243 档）
```

**其余落地**：
- `live2d/deform.ts`：仿射（`T·R·S`，反射并入缩放符号）、**BDBoxGrid = 两轴各自 Bernstein 次数的张量积**（次数 = 控制点数−1，不是固定双三次）、pivot 组合下标（`params[0]` 最快变化）+ 分区间线性插值、`evaluateModel` 顶点生成。
- `live2d/mtn.ts`：`.MTN` 解析（`$fps/$fadein/$fadeout` + 等间隔曲线 + `VISIBLE:` + `LAYOUT:`）+ 播放态 + 淡入淡出权重 + `advanceMotion`。
- `live2d/runtime.ts`：10 实例槽 / 572B 节点 / 动作缓存三张表的纯逻辑（挂在 **`Engine`** 上，不是 `SceneState` —— 见 §5 的取舍）。
- `live2d/assetLoader.ts`：按统一文件 id 读 `.MOC`/PNG/`.MTN` 并接上运行态（两个宿主共用一份）。
- `vm/handlers/live2d.ts`：**18 条 opcode 全落地**（`LIVE2D_OPS` 14 条 + `LIVE2D_NATIVE_OPS` 3 条；`0x343` 不在本族）。
- 守卫：`test/live2d-moc.test.ts`（2 条）、`test/live2d-deform.test.ts`（5 条）、`test/live2d-chain.test.ts`（2 条，E3 真资产）。
- **接线（宿主侧）**：`SceneState.l2dHost` 挂 `Engine`（两个宿主各挂一次引用，读的是**同一份**运行态）；
  `scL2dTick(scene, nowMs)` 进两个宿主的 `advanceModel`；`scSnapshot(scene, clock, host)` 导出 `l2d` 段
  （槽 / 节点 / 可画节点的变形几何外接矩形）+ `snapshotToText` 的 `l2d-slot` / `l2d-node` 行。

**顺带订正的既有判断**：
- `0x344` 不是"纹理槽变换"而是**建/绑 572B 立绘节点**（`record[1] = L2D 实例槽号`）⇒ 从 `GFX_TEXTURE_OPS` 移出。
- `0x345` 不是"图形/3D 模型加载"而是 **L2D 纹理装载**。
- `0x346`–`0x34D`/`0x34F`–`0x352` 原先当 `ENGINE_INTERNAL_OPS` no-op；**"无模型时天然无输出 ⇒ no-op 安全"只对画面成立、对模型不成立**（它们写的是节点字段，跳过 ⇒ 节点表永远空）⇒ 全部转真实现。
- `version > 10` 被引擎**直接拒绝**（raw 143882/143912）⇒ 删掉按社区 SDK 写的 `version >= 11` 分支（clipId）。
- `deform.ts` 的坐标系注释订正为 **y 向下、原点画布左上**（投影 `OrthoLH(w,-h,-1,1)` raw 134354）。
- 顶点工作缓冲是 `{x,y,alpha,u,v}` **5 float/顶点**（O: raw 152897/153207），上传只取前 3 个做位置流。

---

### 4.1 本次（2026-09 续做·第二批）实际改了什么：渲染最后一公里

**背景**：上一批做到"判据 + 求值 + 可断言"，但屏幕上什么都不出现。本批把几何真的交给 Pixi。

**先钉死的事实（oracle，逐行，写进 `docs-new/03-engine/live2d.md` §5.1）**：

| 事实 | 证据 |
|---|---|
| 净摆放效果 = **画布中心对齐屏幕中心**：`screen = model + ((viewW−canvasW)/2, (viewH−canvasH)/2)`；**画布尺寸只进平移、不进缩放** | raw 134354（`OrthoLH(w, −h, −1, 1)`）+ raw 134374-134376（`T(−cw/2, viewH/2 − ch/2, 0)`）化简 |
| 画布宽高来自 `.moc` 的 `canvasWidth/Height`（`ModelImpl+12/+16 ← sub_4C6080`），**不是** `.MTN` 的 `LAYOUT:` | raw 151211-151215 |
| 位置流 = 每顶点 **12 字节 `{x,y,alpha}`**（工作元组 5 float 只拷前 3 个） | raw 148038-148053；raw 152917-152979 |
| UV 流 = **直接从 `.moc` 的 `+60 uvs` 原样 memcpy**（不翻转） | raw 153065-153069 |
| 索引 = **三角形列表**（`6×polygonCount` 字节、`PrimitiveType=4`） | raw 153076-153087；raw 148068 |
| 归并键 = **`0x344` 的 op1**（= `sub_4AAEC0` 的查表键）；TITLE 的静态立绘 `draw-texture 14 5` 与 L2D 支的 `i344 14 0` **占同一个槽 0x14** | raw 135586-135614；`src/TITLE.txt:586/590` |
| 节点 `+508` 的 4×4 **初始化即单位阵**，只有 `0x346`–`0x34D` 会改 ⇒ 语料（只用 `0x344`）下恒为单位阵 | raw 118508-118511；raw 134385 |
| `.MTN` 的 `LAYOUT:` 语料 237 个里 236 个是缺省 `X=1024/Y=512/SCALE=1`（2048×1024 参考画布正中）⇒ TITLE 不影响摆放 | `raw-parts/**/*.MTN` 直方图；raw 144942-144979 |

**改动**（★=关键）：

- ★**`src/live2d/render.ts`（新）**：`l2dBatches(host, viewW, viewH, keys?)` = **快照与绘制的唯一同源**。
  一次算完：门控（槽空/bit0）→ `evaluateModel` → `VISIBLE:` 覆盖 → 画布居中平移 →
  **按 textureNo 分组**（组序 = drawOrder 序）→ 每批 `{positions, uvs, indices, opacity, rect, textureFileId}`。
- ★**`presenter.ts` 第四类图元**：批次按**节点 key** 与 draw-item（`layer`）/文本（`layerOfFrame`）/
  mesh（`handle`）**四路归并**，等键次序 `item → text → mesh → L2D 节点`（引擎 raw 135586-135614）；
  每批一个 Pixi `Mesh` + `MeshGeometry`（`positions/uvs/indices` 直喂）。缺纹理时**不画也不糊占位块**（只记一次日志）。
- ★**`attachL2dHost` 顺带接 `Engine.fileSource`**，并新增 **`IpcFileSource.readById`** +
  主进程 `read-by-id` 通道 + preload 暴露（`ipcProtocol.ts` 声明）。**没有这一条，真实 Electron 里
  整条 L2D 装载链是断的**（`assetLoader` 直接调 `Engine.fileSource.readById`，而它此前在渲染进程不存在）。
- **`src/renderer/pixi/l2dTextures.ts`（新）**：统一文件 id → Pixi 纹理（PNG 走 `createImageBitmap`，
  **不经 AGF 解码器**）；载入完成回调置脏（下一帧补画）；`ensure()` 在 `advanceModel` 里发起 ⇒ 帧末
  `texturesIdle` 能等到（与引擎 `0x345` 同步装载同观感）。
- **`scene/snapshot.ts`**：改用 `l2dBatches`（不再自己求值一遍）；导出
  `batches / triangles / tex[{no,fileId,vertices,triangles,alpha}]`；`l2d-node` 行加 `批次=/三角=/tex=[]`
  ⇒ "几何算出来了但一块都画不出"变成可诊断。
- **守卫 `test/live2d-render.test.ts`（新，6 条）**：摆放公式（含"画布==视口 ⇒ 零平移"）、
  顶点/UV/索引透传与分组序、三种门控、`VISIBLE:` 覆盖、`textureNo == -1` 不当纹理号、
  **真资产 E3**（TITLE.MOC + 三个纹理号 + 节点 0x14 ⇒ 几何自洽 + 与快照同源）。

**顺带收敛的旧悬案**：`DrawData.pivotPoints` 是**局部坐标**（变形器再变换）——
`sub_4C8BC0`（raw 153345-153424）把文件里的点放进自己的缓冲，再由 `targetId` 指向的
`BDAffine`/`BDBoxGrid` 变换进父缓冲（§4.3 of `docs-new/99-records/2026-09-live2d/live2d-deform-semantics.md`）⇒
`deform.ts` 当前"点 = 局部 + 链式矩阵"的取法**得到证实**（原按 E4 待定的那一条已可收敛）。

---

### 4.2 本批（2026-09-17 真机联调）：两个"只有真机才暴露"的静默失败 + 一处假缺口

上一批改动在 Node 测试里**全绿**，但用户在真界面上看到的是"什么都没有"，控制窗还报
`l2dLoadModel` / `l2dStartMotion` **未实现**。三个成因都不是"逻辑写错"，而是**环境分叉 / 设计残留**：

### ① `Buffer is not defined` —— 渲染进程没有 Node 全局

日志原话：

```
[l2d] 0x341：TITLE.MOC 解析失败（Buffer is not defined）⇒ 槽 0 保持为空
```

`moc.ts` 的 `str()` 用 `Buffer.from(bytes).toString('utf8')` 解字符串。**`src/live2d/**` 全部由
Electron 渲染进程加载（无 Node 集成）** ⇒ 解析在抛 `MocParseError` 之前就炸了 ⇒ 槽保持为空 ⇒
572B 节点按引擎门控整块不出画（**不报错**，只是什么都没有）。而 tsx 下的 Node 测试**有** `Buffer`
⇒ 4 组 Live2D 守卫全部通过。这就是"测试全绿、真机全白"的典型分叉。

- **修**：改用全局 `TextDecoder('utf-8')`（浏览器与 Node 都有）。
- **守卫（源码棘轮）**：`test/live2d-render.test.ts` 扫 `src/live2d/**` + `src/renderer/**`，
  出现 `Buffer` / `process.` / `require(` / `__dirname` / `__filename` / `from 'node:fs|path|…'`
  即红灯（大小写敏感 ⇒ `.buffer`、`ArrayBuffer` 这类正当用法不受影响）。

### ② 批次按纹理号合并 ⇒ 一个 `opacity = 0` 的网格把整张角色纹理压透明

修完 ① 后立绘"有了但不完整"：屏幕上只剩天空与特效残影，**角色完全看不见**。
逐网格体检（临时探针，已删）给出的关键数据：

```
400  PARTS_01_BODY   D_BODY.00      tex 0  438 顶点 772 三角形 bbox=(9,188)..(604,963)   op=1.00
605  PARTS_01_EYE_001 D_EYE.09      tex 0   10 顶点   8 三角形 bbox=(227,188)..(283,228) op=0.00
648  PARTS_01_EYE_001 D_EYE.10      tex 0    7 顶点   5 三角形                                   op=0.00
```

tex 0（= `TITLE00.PNG`）那一批里混着两个当前参数下 `opacity = 0` 的眼部网格，而旧实现
**按纹理号合并、alpha 取批内最小值** ⇒ 整批 alpha = 0 ⇒ **3062 个三角形的角色全被压成透明**。

- **修**：改成**一个网格一个批次**（= 引擎对每个 `DrawData` 的一次 `DrawIndexedPrimitive`）。
  这不是近似而是**精确**：引擎把该网格的 opacity **写满它的每个顶点**（`sub_4C88B0` raw 153207）。
- **为什么不按 `(纹理号, opacity)` 合并**：那会把同一纹理上 opacity 不同的网格拆成两组先后面，
  **破坏 drawOrder**。
- **守卫（回归断言）**：合成模型里放一个与 `D_FG` 同纹理、`opacity = 0` 的网格，断言
  `hidden.opacity === 0` **且** `fg.opacity === 1`（不并批 ⇒ 不被拖累）。

### ③ 假缺口：Live2D 的**宿主缝**残留

`0x341`/`0x345`/`0x34E` 的 handler 里还留着 `c.native.l2dLoadModel?.()` 之类的调用，而装载其实
已经在 VM 层的 handler 里 `await` 完成了（两个宿主同一份实现）。这些方法**没有宿主实现** ⇒
**闸门 A** 把它们记成「意图被丢弃」⇒ 控制窗显示 `l2dLoadModel` / `l2dStartMotion` **未实现**
（用户看到的正是这一条，而模型其实已经装好了）。

- 删除：`native.l2dLoadModel?` / `l2dBindTexture?` / `l2dStartMotion?`（及 `nativeTap.BRIDGE_METHODS`
  与 `WHY` 对应项）。
- 顺带删掉两处**被覆盖的死 handler**：`gfx-misc.ts` 的 `0x342`/`0x352`（`LIVE2D_OPS` 后注册、
  早已生效）与 `gfx-texture.ts` 的 0x344 旧解 `op_set_texture_transform`（上一批已从表里移出、
  只剩函数体），以及它们调的 `destroyL2DSlot?` / `l2dSlotSet?` / `setTextureTransform?` 三个缝。
  它们同样只会产生假缺口。

### ③ 卡顿不均匀（周期性长顿卡）—— 上一行那个改动引起的

用户报："动作是正确的，但卡顿明显且不均匀"。**先量再改**：给合成诊断行加了一组帧间隔统计
（`帧间隔 avg/max/丢帧%(n=240)` + `最慢帧 间隔/合成/批`），单机跑一次 TITLE：

```
帧间隔 avg=17.3ms max=203ms 丢帧=2%(n=240)      ← 平均 60fps，但周期性出现 170-203ms 的长顿卡
```

**根因**：②里的"一网格一批"把**每帧新建的 `MeshGeometry` 从 3 个变成 60 个**（TITLE 有 60 个网格）
= **3600 个/秒**。而 Pixi v8 的 GPU 资源 GC 默认是
`gcMaxUnusedTime = 60_000ms` / `gcFrequency = 30_000ms`（`GCSystem.js`，`runOnResource` 只在
"60 秒没被用过"时才 `unload()`）⇒ 存活几何体涨到 **十万量级**（每个还带 1 个 VAO + 2 个 VBO + 1 个 IBO），
每 30 秒才扫一次、一次要扫十万条 ⇒ 周期性长顿卡 + 显存膨胀。**②把这个问题放大了 20 倍**，
所以是"这轮才感觉到卡"。

**修法**：按 `节点 key:网格 id` **复用 `Mesh`/`MeshGeometry`**（`presenter.#l2dMeshes`）：

- 命中缓存 ⇒ `positions.set(...)`／`uvs.set(...)`／`indices.set(...)` 就地写，然后**重新赋值同一个
  数组**给 `geom.positions/uvs/indices`（走 `Buffer.data` setter，bump `_updateID` ⇒ 只上传数据、
  不重建 GL 缓冲）。`.moc` 里每个网格的 `pointCount`/`polygonCount`/UV 数都是常量 ⇒ 永远命中；
- 批次消失（节点被撤/网格隐藏）⇒ `mesh.destroy({texture:false,textureSource:false})` +
  `geometry.destroy(true)`（★`Mesh.destroy` **不**销毁 geometry，不显式销毁就只能等 60 秒的 GC）；
- 复用后缓存规模**稳定在 60**（诊断行的 `l2d={… 缓存60}` 就是这条的现场指标）。

**守卫**（`test/live2d-render.test.ts` 新增一条，8 条总数）：用真实 Pixi `Container` + 假纹理库跑
`present()` 两帧，断言 ①同一批次跨帧是**同一个 Mesh 实例**；②改了 `pivotPoints` 之后复用对象的
顶点缓冲**确实更新了**（否则画面会冻在第一帧）；③节点撤掉后缓存回收、重建是新对象。

> ⚠️ 测这件事时**必须只有一个实例在跑**：我这轮 A/B 的第一份数据就废了 —— 机器上有一个
> `electron .` 实例（用户自己的窗口）在同时跑 60fps 的立绘，两个 renderer 抢 GPU ⇒
> `avg` 从 17ms 变 43ms、丢帧 38%、出现 1-2 秒的长顿卡。`最慢帧 合成=1.2-4.1ms` 说明那批数据里
> 卡的不是合成代码。→ **现场凡是"卡"，先看是不是开了两个实例。**

### ④ ★选择性卡顿（头/眼流畅，翅膀与背手**整体同步**卡顿）—— `m ≥ 2` 多参数插值

复用修复后用户仍报卡，并给了一条**极高价值**的观测：**头与眼是流畅的，右侧翅膀与背手是同步卡顿的**。
"选择性 + 同步"直接把嫌疑锁定到**变形数学**（渲染路径对所有网格一视同仁，不可能只影响两组网格）。

先用探针量化"每个网格逐帧的质心位移"（临时工具，已删）：

| 网格 | 平均位移 | 变异系数 | 单帧最大位移 |
|---|---|---|---|
| `D_MY_PARTS_HANE.05`（翅膀） | 0.177 | **7.09** | **11.92** |
| `D_MY_PARTS_HANE.00` | 0.184 | 6.56 | 11.51 |
| `D_MY_PARTS_TE.00`（背手） | 0.301 | **6.41** | **18.38** |
| `D_MY_PARTS_ARM_RIGHT/LEFT.*` | 0.17–0.48 | 3.7–5.5 | 6.5–23.3 |
| `D_EYE.*`（眼） | 0.14–0.69 | 0.5–2.3 | 0.5–7.6 |
| `D_HAIR_*` / `D_BODY.00` | 0.1–0.4 | **0.45–0.6** | 0.2–0.8 |

⇒ 翅膀/手臂的位移**忽大忽小（最大 18px 的突跳）**，而头发/身体均匀。与用户描述完全吻合。

**根因**：追变形链（`D_MY_PARTS_TE.00 → B_MY_PARTS_TE.00 → B_MY_PARTS_ARM_LEFT.00`）：

```
B_MY_PARTS_ARM_LEFT.00  kind=bdAffine affines=27
  params = PARAM_KAO(3)[0,5,10]  PARAM_KAKUSYUKU(3)[-100,0,100]  PARAM_ARM(3)[0,5,10]
  被驱动: PARAM_KAO 0..10 平滑 / PARAM_ARM 0..10 平滑 / PARAM_KAKUSYUKU **恒 -23（.MTN 只有 1 个采样）**
```

`PARAM_KAKUSYUKU = −23` 落在它自己的区间 `[−100, 0]` **内部** ⇒ `frac = 0.77` **恒定**。
而 `deform.ts` 只给"第一个 frac>0 的维度"插值、其余维度取整档 ⇒
**永远 m ≥ 2，但只有一维被插值** ⇒ 结果在"另一维 frac 归零"时于两个近似之间跳变。
翅膀与背手**共享同一个父变形器** ⇒ 同步卡顿；头/眼不经过它 ⇒ 流畅。**这就是那条观测的全部解释。**

★**先前的结论"本作 `m ≥ 2` 不可达"是错的**：当时只统计了**网格自身**的 `pivotManager`
（那里确实最多 1 维），而多参数 manager 挂在**变形器**上。这条错误写进了 `deform.ts` 的头注释
与 CONTEXT，现已订正。

**修法**：实现 SDK 的通用分支 —— **`2^m` 角点多线性混合**
（`weight = ∏_k (bit_k ? frac_k : 1 − frac_k)`，raw 156321-156441）：

- `pickPivot` 改为返回 `corners: {index, weight}[]`（增量构造：`f_k = 0` 时不产生第二个角点
  ⇒ **`m ≤ 1` 与旧口径逐位一致**）+ `dims/fracs/m`（诊断）；
- 新增 `blendPoints`（逐分量）/ `blendAffines`（**逐元素**加权和，`m=1` 时 = 旧的 `affineLerp`）/
  `blendScalars`；四个消费点（`bdAffineMatrix`/`bdOpacity`/`bdBoxGridPoints`/`drawDataPoints`/
  `drawDataOrder`）全部改走角点。

**修后实测**（同窗口同参数）：

| 网格 | 单帧最大位移（前 → 后） |
|---|---|
| `D_MY_PARTS_TE.00`（背手） | **18.38 → 0.66** |
| `D_MY_PARTS_ARM_RIGHT_2.00` | 12.05 → 0.48 |
| `D_MY_PARTS_HANE.05`（翅膀） | **11.92 → 0.40** |
| `D_MY_PARTS_HANE.00` | 11.51 → 0.43 |
| 眼/眉（本就不受影响） | 不变 |

**守卫**：`test/live2d-deform.test.ts` 新增"`m ≥ 2` 多线性混合"一条 —— 二维 frac = 0.25/0.75、
四个角点 `originX = 0/100/200/300` ⇒ 顶点 x 必须 = 175（旧口径会得 25，差 150px）；
`pickPivot` 的角点下标/权重也逐项断言。原"组合下标口径"一条改为走 `corners`。

### E4（真界面截图）

```bash
npm run build:electron && npx electron tools/shot.cjs --centered --name l2dfix
```

| 图 | 内容 |
|---|---|
| `.tmp/l2dfix-0-title.png` | **修后**：白发蓝翼角色完整叠在背景上（`l2d={槽1 节点1 可画1 纹理3}`） |
| `.tmp/t0042d-0-title.png` | **修前**（2026-09-16）：同场景只有背景 + 特效残影，**角色完全不见** |

> ★注：`tools/shot.cjs` 只等 `app.whenReady()` 后 2s 就找窗口；**默认贴边开窗**时那次会报
> `[shot] 未找到游戏窗口`，加 `--centered` 即可（两次都试过，结论一致）。

---

## 5. 未完成 / 下一步（按优先级）

### 5.1 渲染链本身已闭环（E4 已取），仍缺的是"自动化覆盖合成提交"

- **已完成**：`live2d/render.ts` 出画几何 + `presenter.ts` 第四类图元（Pixi `Mesh`）+ PNG 纹理库
  + Electron `readById` 通道 + 快照同源导出 + **7 条守卫**（含渲染器安全棘轮、批次粒度回归）。
- **仍缺**：自动化测试覆盖不到"Pixi 真的提交了 Mesh"（需要 WebGL/DOM）⇒ 这一层目前靠 **E4 截图**
  （`.tmp/l2dfix-0-title.png`）把关；将来若要自动化，方向是 Electron 里跑一次并把
  `drawRoot.children` 的类型/数量导出来断言（属于 `tools/shot.cjs` 的扩展，不在本轮范围）。
- **已知近似**（都写在 `live2d/render.ts` 文件头与能力条目 note 里，没有静默）：
  背面剔除 → 不剔除（alpha 混合下是超集）；`LAYOUT:` → 不影响摆放；
  节点 `+508` 矩阵 → 单位阵；每帧重建 Mesh/Geometry（靠 Pixi 的 GCManagedHash 回收）。

### 5.2 其余

1. **M3 门控**：`global a9d0` 真读 + 把"10 槽里有没有活模型"接进 `sceneNeedsRender`（能力条目 `live2d-slot-probe`）。
   - 注意 `sceneNeedsRender` 是**共享场景层**函数，而槽表在 VM 层 ⇒ 现在通过 `SceneState.l2dHost` 这个引用够了。
2. **E4 的第二个对照**：在 CONFIG 里关掉 Live2D（`a9d0 = 1`，`CONFIG1.txt:1741-1742` 写它）截静图回落支
   （`SO004A`）与 `.tmp/l2dfix-0-title.png` 对照。★对齐判据已经就绪：快照给出这一帧的外接矩形与纹理来源。
3. **脚本台账**：`SETL2DMOC` 家族未登记（560+ 处 `i34x`）；`INFOEN` / `BTL` 的 L2D 段未登记（`INFOIT` 1 处）。
4. **`0x348` 的 op3**（汇总参数）语义未逐行确证 ⇒ `PARTIAL`。
5. ~~**多参数同时插值（`m ≥ 2`）未实现**~~ **已实现（2026-09-17，见 §4.2 ④）**：
   先前的"本作不可达"结论是**错的**（只统计了网格自身的 pivots，没统计变形器上的）。
   现在按 SDK 的 `2^m` 角点多线性混合，`m ≤ 1` 与旧口径逐位一致。
6. ~~**`DrawData.pivotPoints` 是否已含 BDAffine 变换**~~ **已收敛（本批）**：是局部坐标、变形器再变换
   （`sub_4C8BC0` raw 153345-153424）⇒ 当前实现正确，见 §4.1 末段。
7. **`0x346`–`0x34D` 的节点矩阵组装顺序**（`sub_4A07F0` 的四组窗口）未逐行确证 ⇒ 现在按单位阵出画
   （语料只用 `0x344`，不触发）。将来要用它，改 `render.ts` 的 `l2dNodeTransform()` 一处即可。

---

## 6. 能力条目（第二层）本次的重评

| id | 之前 | 现在 | 依据 |
|---|---|---|---|
| `lazy-live2d-slot` | absent / E1 | **modeled-unverified / E3** | `Engine.l2dSlots` = 10 槽表；`attachModel` 做"槽非空先析构再建"；守卫 `test/live2d-chain.test.ts` |
| `l2d-node-draw-gate` | absent / E1 | **modeled-unverified / E3** | `l2dNodeDrawable` 逐字复刻 raw 134320；守卫同上 |
| `live2d-node-draw-advance` | absent / E1 | **modeled-unverified / E3** | `l2dAdvance` 只由节点绘制驱动；`.MTN` 的 `$fps/$fadein/$fadeout` 生效；守卫同上 |
| `live2d-enabled-config-flag` | absent / E1 | **partial / E1** | 装载链已通（`i341/i345/i34E` 真实现），但 `a9d0` 仍未被真读（M3） |
| `live2d-slot-probe` | absent / E1 | absent / E1（**未动**） | 运行态有了，判据还没接进 `sceneNeedsRender` |
| **`live2d-mesh-batches`（新）** | — | **modeled-verified / E4** | 出画几何（顶点/UV/索引流 + 画布居中摆放 + **一网格一批** + 归并键）；守卫 `test/live2d-render.test.ts`（7 条）；**E4**：`.tmp/l2dfix-0-title.png`（角色完整出画）vs `.tmp/t0042d-0-title.png`（修前没有角色） |
| `render-merge-two-pass-reorder` | partial / E2 | partial / E2（**note 更新**） | 四路归并里的 **Live2D 那一路（Scene+1096）已接**；另一张 572B 节点表（特效/精灵层）仍未建模 |
| `scene-frame-commit` | partial / E2 | partial / E2（**note 更新**） | 同上：四路里的三路已接 |

> 三条 `modeled-unverified` 而非 `modeled-verified` 的理由（上一批的判定）：**判据已实现且有 E3 守卫，
> 但两个宿主的合成路径还没调用它们**。本批之后**合成路径已经调用**（`presenter.ts` 读 `l2dNodeDrawable`
> 的同一条门控、`scL2dTick` 在两个 `advanceModel` 里），且真机截图证明角色确实出画 ⇒ 新条目
> `live2d-mesh-batches` 记 `modeled-verified`/**E4**；那三条的 `note` 未改（保守放着）。

---

## 7. 复核命令（改数据层/文档后必跑）

```bash
node scripts/build-capabilities.mjs                                            # 第二层渲染物
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --validate
node scripts/build-scripts.mjs                                                 # 第三层渲染物
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --validate
node scripts/build-tickets.mjs                                                 # 看板
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate
cd app/amayui-emulator && npm run verify
```

---

## 8. 互链

- **评估正文**：`docs-new/04-app/live2d-support-assessment.md`（本单的"要不要引依赖库 / 系统大致能力"都在那里）
- 引擎语义长文：`docs-new/03-engine/live2d.md`
- **格式长文**：`docs-new/03-engine/live2d-moc-format.md`
- 变形语义报告（oracle 专项）：`docs-new/99-records/2026-09-live2d/live2d-deform-semantics.md`
- 数据层：`analysis/functions.json`（`report.js --find live2d`）、`analysis/engine-capabilities.json`（`capabilities.js --subsystem Live2D`）、`analysis/scripts.json`（`scripts.js --id TITLE`）
- 相关票：**T-0051**（E4 真界面待验证清单 —— 本单的 E4 项可挂在那里）
- 被本单改判的旧结论：`docs-new/99-records/2026-09-audit/stub-reaudit-2026-09.md` §1.2（Live2D 一行已划掉并注明改判理由）

## E4 记录（2026-09-17；★证据不放 `.tmp/`，见 T-0057 R6）

`.tmp/l2dfix-0-title.png` 是临时产物（gitignore，会被清理）⇒ T-0054 的 E4 证据改为锚在本文件：

> **TITLE 的 Live2D 支在真界面出画** —— 白发蓝翼角色完整叠在背景之上（`a9d0 == 0`）。
> 同一轮日志：`[l2d] 纹理 0x4f9f/0x4fa0/0x4fa1 → TITLE00/01/02.PNG`、
> `[present …] l2d={槽1 节点1 可画1 纹理3}`。
> 复现：`npm run build:electron && npx electron tools/shot.cjs --centered --name l2dfix`（产物落 `.tmp/`，只作一次性目视，不进证据）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

评估已完成并单独成文：**docs-new/04-app/live2d-support-assessment.md**（系统能力 / 要不要引依赖库 / 工作量 / 分阶段计划 / 待拍板）；引擎语义长文见 docs-new/03-engine/live2d.md；本单的过程笔记只留决策记录与 acceptance 对照。
★待用户决策：是否接受把 Live2D 专有运行时（Cubism 2.1 的 `live2d.min.js`）随补丁再分发 —— 路线 B 的可行性取决于此；路线 C（自研移值）没有这个许可问题但工作量最大。
