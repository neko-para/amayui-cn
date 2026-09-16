# CONTEXT — Live2D（TITLE）实现进度快照

> **状态：M1（含渲染最后一公里）/ M2 已完成，标题立绘已在真界面出画（2026-09-17）。**
> 本文件是"接着干"所需的全部上下文。任务归属：`tickets/T-0054`（`status=doing`）；过程细节见 `tickets/T-0054/notes.md`。

---

## 0. ★真机联调抓到的两个"静默失败"（都已修 + 已加守卫）

上一轮改动在 Node 测试里全绿，但真界面**一片空白**。两个成因都不是"逻辑写错"，而是
**测试环境与渲染环境的分叉**：

| # | 症状 | 根因 | 修法 / 守卫 |
|---|---|---|---|
| 1 | 日志 `[l2d] 0x341：TITLE.MOC 解析失败（Buffer is not defined）⇒ 槽 0 保持为空` | `moc.ts` 用 Node 的 `Buffer.from(bytes).toString('utf8')` 解字符串。**渲染进程没有 Node 集成**，`Buffer` 未定义 ⇒ 解析抛异常 ⇒ 槽空 ⇒ 立绘不出画。而 tsx 下的 Node 测试**有** `Buffer` ⇒ 6 条守卫全绿 | 改用全局 `TextDecoder`；**源码棘轮**：`test/live2d-render.test.ts` 扫描 `src/live2d/**` + `src/renderer/**`，出现 `Buffer`/`process.`/`require(`/`__dirname`/`from 'node:…'` 即红灯 |
| 2 | 立绘"半透明、发虚"，角色**完全看不见**（只剩天空与特效） | 出画批次按**纹理号合并**、alpha 取批内**最小 opacity**。TITLE 的角色那张纹理（tex 0，3062 三角形）里恰好有 `D_EYE.09`/`D_EYE.10` 两个当前参数下 `opacity = 0` 的网格 ⇒ **整张角色纹理被压成 alpha 0** | 改成**一个网格一个批次**（= 引擎的一次 `DrawIndexedPrimitive`）。引擎把该网格的 opacity 写满它的每个顶点（`sub_4C88B0` raw 153207）⇒ 按网格切批次时每批一个 alpha 是**精确**的。回归断言钉在 `live2d-render.test.ts`（同纹理的 `op=0` 网格不得拖累 `op=1` 的） |
| 3 | 动作正确但**卡顿不均匀**（周期性长顿卡） | ★**上一行那个"一网格一批"改动把每帧新建的 `MeshGeometry` 从 3 个变成了 60 个**（TITLE 有 60 个网格）⇒ 3600 个/秒。而 Pixi v8 的 GPU 资源 GC 是 `gcMaxUnusedTime = 60s` / `gcFrequency = 30s`（`GCSystem.js`）⇒ 存活对象涨到十万量级（每个还带 VAO + 3 个 GL 缓冲），sweep 时才成批释放 ⇒ 周期性顿卡 + 显存膨胀 | **按 `节点 key:网格 id` 复用 `Mesh`/`MeshGeometry`**：每帧只 `TypedArray.set` + 重新赋值（`Buffer.data` setter 会 bump `_updateID` ⇒ 只上传数据、不重建缓冲）；批次消失时 `mesh.destroy()` + `geometry.destroy(true)` 确定性释放。守卫：`live2d-render.test.ts` 的"跨帧复用"一条（同一批次必须是**同一个 Mesh 实例**、顶点更新要生效、节点撤掉后重建是新对象）；诊断行加了 `缓存N` 与 `帧间隔 avg/max/丢帧` |
| 4 | ★**选择性**卡顿：**头/眼流畅，右侧翅膀与背手整体同步卡顿** | ★★**`m ≥ 2` 多参数同时插值**：`deform.ts` 只为"第一个 frac>0 的维度"插值、其余维度取整档。而语料里多参数 manager 挂在**变形器**上 —— `B_MY_PARTS_ARM_LEFT.00` 有 3 个参数 `PARAM_KAO(3)/PARAM_KAKUSYUKU(3)/PARAM_ARM(3)`（∏=27），其中 `PARAM_KAKUSYUKU` 的 `.MTN` 曲线**只有 1 个采样**（恒 −23）⇒ 落在它自己的区间 `[−100,0]` 内部、`frac = 0.77` **恒定** ⇒ **任何时刻 m ≥ 2**。结果在"另一维的 frac 归零"时于两个近似之间跳变；翅膀与背手共享这个父变形器 ⇒ **同步卡顿**，而头/眼不经过它 ⇒ 流畅。实测：`D_MY_PARTS_TE.00` 单帧最大位移 **18.38px → 0.66px**、`HANE.05` **11.92 → 0.40** | 按 SDK 的 **`2^m` 角点多线性混合**（`weight = ∏_k (bit_k ? frac_k : 1 − frac_k)`，raw 156321-156441）：`pickPivot` 返回 `corners[{index,weight}]`，点/矩阵逐分量、标量按权重和。`m ≤ 1` 与旧口径**逐位一致**。守卫：`live2d-deform.test.ts` 的"`m ≥ 2` 多线性混合"一条（二维 frac=0.25/0.75 ⇒ 顶点 x 必须是 175，旧口径会得 25）。★**先前的"本作 m ≥ 2 不可达"是错的**：只统计了网格自身的 pivots，没统计变形器的 |

> 另外清掉一处**假缺口**：`0x341`/`0x345`/`0x34E` 的 handler 里还在调 `native.l2dLoadModel?()` 之类的
> **宿主缝**，而装载其实已经在 VM 层 `await` 完成了 ⇒ 没有宿主实现 ⇒ 控制窗的**闸门 A** 报
> `l2dLoadModel`/`l2dStartMotion` 未实现（用户看到的正是这一条）。这些宿主缝连同 `gfx-misc.ts` 里
> 两条被 `LIVE2D_OPS` 覆盖的"影子 handler"（`0x342`/`0x352`）一并删除 —— 它们只产生误报。

---

## 1. 目标与已定决策

**目标**：实现《天結いキャッスルマイスター》**TITLE 所需的 Live2D**（自研路线），使标题立绘按 `global a9d0` 门控正确出画。
判据见 `tickets/T-0054/ticket.json` 的 acceptance #2–#5。

**已定（用户拍板 2026-09-16）**：

| 项 | 决定 |
|---|---|
| 路线 | **C 自研移值**：不引 Cubism 5（只吃 `.moc3`）、不引 `live2d.min.js`（专有运行时再分发 + headless 无 WebGL 不可用） |
| 参考源纪律 | **规范优先** → **资产实证兜底**（`.moc` 字节布局无公开规范 ⇒ 用 335 个真实模型逼不变量）→ **反汇编只当 oracle**；社区实现只作交叉验证 |
| 文档落点 | 评估正文 `docs-new/04-app/live2d-support-assessment.md`（§3.5 即纪律）；引擎语义 `docs-new/03-engine/live2d.md`（**§5.1 = 顶点流与摆放**）；**格式 `docs-new/03-engine/live2d-moc-format.md`** |

**来源标记**（贯穿代码注释与文档）：**S1** 官方 Cubism 2.1 Web SDK / **S2** `EasyLive2D/live2d-v2` /
**S3** `NiaBie/FreeLive` / **O** 反编译 oracle（`engine/天结_unpacked.exe_utf8.c`，行号已标进代码）/
**E** 资产实证（335 个 `.MOC`、330 个 `.MTN`）。

---

## 2. 引擎侧关键结论（速查）

- 内嵌 **Live2D SDK 2.0.06 for DirectX**（raw 143532；常量 raw 5307-5308）⇒ Cubism **2.x**。
  **`.moc` 只接受 `version ≤ 10`**（raw 143882；越限 raw 143912 拒绝）⇒ 不存在 v11 字段（无 clipId）。
- 资产：`.MOC`（二进制 **v10**）/ `.MTN`（**文本** Animator）/ 纹理 **普通 PNG**（走 `D3DXCreateTextureFromFileInMemory`）。
  **没有 `.model.json`**，引擎按脚本逐文件装载。实测 id：`0x4f9e=TITLE.MOC` / `0x4f9f=TITLE00.PNG` / `0x4fa0` / `0x4fa1` / `0x5274=TITLE.MTN`。
- 接线：`Scene+55812` 起 **10 个实例槽**（76 字节实例：+0 模型 / +4,+8 两条动作 / +12 动作队列 /
  +16 眨眼 / +20 循环位 / +21,+22 待播位 / +23 眨眼门控 / +24,+28 待绑纹理号 / +25,+32 待绑动作号 / +36..+76 十张纹理）；
  另有 **572 字节「立绘/变换节点」** 表（`Scene+1096`）。
- **TITLE 的完整链路**（`src/TITLE.txt`）：
  1. `jcc (global-int a9d0)`：**a9d0 != 0 ⇒ 静态贴图**（`set-texture 5273 5` = `SO004A`）；**a9d0 == 0 ⇒ Live2D**（默认 0 = 默认开）。
  2. L2D 支：`mov f8c46 = 4f9e`、`mov f8c47 = 0` → 循环 `lookup-array (global-int 708ab6) (global-int f807f)` 间接 `call-script`（表里是 `SETL2DMOC` 家族）→ 回来 `i352 0 0 0`（预置待绑纹理号 0）→ `i34e 5274 0 0 1`（装 `.MTN`：动作槽 0、实例槽 0、循环 1）→ `label_000024a4` 的 `i344 14 0`（建 572B 节点：key 14 → 槽 0）。
  3. 静态支在 581 的 `jcc` 处直接跳过 `label_000024a4` ⇒ **`i344` 只有 L2D 支会执行**。
- ★**`0x344` = 建/绑 572B 立绘节点**（`record[0] |= 1`、**`record[1] = L2D 实例槽号`**）—— 旧文档的"纹理槽变换"是**误读**。
- ★**出画门控**：`sub_4B0360` 只在"节点 +4 指向的 L2D 槽**真有模型**"时才出画（raw 134320）⇒ 槽空 = 整块不出画、**无日志无错误**。
- ★**动作推进与出画是同一次调用**（`sub_4B0360` → `sub_4783D0` → `sub_4BCB50`，raw 92578-92615）；引擎**没有独立逐帧 tick**。
- **`DrawData` 的 pivot 数组长度 = `∏ pivotCount`**（E：335/335；`pivotPoints == pivotDrawOrders == pivotOpacities`；
  `BDAffine.affines == pivotOpacities == ∏pivotCount`）。
- **BDBoxGrid = 两轴各自 Bernstein 次数的张量积**（次数 = 控制点数 − 1，**不是**固定双三次）；
  语料全是 2×2 分段（3×3 控制点）⇒ 双二次。
- ★**多参数同时插值（`m ≥ 2`）是本作常态**：多参数 `pivotManager` 挂在**变形器**上
  （不是网格上），例如 `B_MY_PARTS_ARM_LEFT.00` 有 3 个参数 ∏=27，且其中 `PARAM_KAKUSYUKU`
  的 `.MTN` 曲线只有一个采样（恒定值，永远落在区间内部）⇒ 恒 `m ≥ 2`。
  实现 = SDK 的 `2^m` 角点多线性混合（见 §0 第 4 条）。
- **坐标**：模型空间 **y 向下**、原点画布左上（投影 `D3DXMatrixOrthoLH(w,-h,-1,1)` raw 134354）；旋转角是**度**。
- 眨眼是**死位**（唯一调用点被 `实例+23` 门控，该位全代码无写入点）⇒ 本作不眨眼，可先不实现。
- 语料用到的指令仅 8 条：`0x341 0x342 0x344 0x345 0x349 0x34D 0x34E 0x352`（TITLE 只用 `0x341 0x344 0x345 0x34E 0x352`）。

### 2.1 ★出画几何（本批新增结论，全部逐行）

| 事实 | 内容 | 证据 |
|---|---|---|
| 净摆放 | **画布中心对齐屏幕中心**：`screen = model + ((viewW−canvasW)/2, (viewH−canvasH)/2)`；**画布尺寸只进平移、不进缩放**（投影用的是显示尺寸） | raw 134354 + raw 134374-134376 化简 |
| 画布宽高 | 来自 `.moc` 的 `canvasWidth/Height`（`ModelImpl+12/+16 ← sub_4C6080`），**不是** `.MTN` 的 `LAYOUT:` | raw 151211-151215；raw 92624/92636 |
| 位置流 | 每顶点 **12 字节 `{x,y,alpha}`**（工作元组 5 float `{x,y,alpha,u,v}` 只拷前 3 个） | raw 148038-148053；raw 152917-152979 |
| UV 流 | **直接从 `.moc` 的 `+60 uvs` 原样 memcpy**（不翻转） | raw 153065-153069 |
| 索引 | **三角形列表**（`6×polygonCount` 字节、`PrimitiveType=4`） | raw 153076-153087；raw 148068 |
| 归并键 | **`0x344` 的 op1**（= `sub_4AAEC0` 的查表键）；等键次序 item → mesh → 节点 | raw 135586-135614 |
| 节点矩阵 | `+508` 的 4×4 **初始化即单位阵**，只有 `0x346`–`0x34D` 会改 ⇒ 语料（只用 `0x344`）下恒单位阵 | raw 118508-118511；raw 134385 |
| `LAYOUT:` | 语料 237 个动作里 236 个是缺省 `X=1024/Y=512/SCALE=1`（2048×1024 参考画布正中）⇒ TITLE 不影响摆放 | `raw-parts/**/*.MTN` 直方图；raw 144942-144979 |

> ★**TITLE.MOC 的画布恰好 1280×720 = 视口 ⇒ 居中平移 `(0,0)`、模型坐标即屏幕坐标**（实测 dump + E3 守卫）。
> 因此"静态支 `draw-texture 14 5`"与"L2D 支 `i344 14 0`"**占同一个归并槽 0x14**，两支视觉位置也对得上。

---

## 3. 已完成（可直接用）

| 产物 | 状态 |
|---|---|
| `tickets/T-0054/{ticket.json,notes.md}` | ✅ `doing`；notes §4.1 = 本次（渲染）改动清单 |
| `docs-new/03-engine/live2d-moc-format.md` | ✅ **格式长文**（§2 容器/对象图、§2.4 两个静默 bug、§3 字段读序与组合数；每条标来源） |
| `docs-new/03-engine/live2d.md` | ✅ 引擎语义长文（**§5.1 = 顶点流与摆放的事实表**） |
| `analysis/live2d-deform-semantics.md` | ✅ oracle 专项报告（856 行，逐条 raw 行号） |
| `analysis/functions.json` | ✅ +44 条 L2D 条目（含全部 handler） |
| `analysis/engine-capabilities.json` | ✅ **125 条**；Live2D 子系统 6 条（新增 `live2d-mesh-batches` = `modeled-verified`/E3） |
| `analysis/scripts.json` | ✅ TITLE 已回链 `live2d-mesh-batches` + `test/live2d-render.test.ts` |
| **`src/live2d/moc.ts`** | ✅ `.moc` 解析器：**335/335 逐字节成功**；修了两个静默 bug（refno 表只登记部分 kind、复合对象缺 `kind`） |
| **`src/live2d/deform.ts`** | ✅ 变形数学：仿射、BDBoxGrid 张量积 Bernstein、pivot 组合与插值、`evaluateModel` |
| **`src/live2d/render.ts`（本批新）** | ✅ **出画几何**：`l2dBatches` = 门控 + 求值 + `VISIBLE:` 覆盖 + 画布居中 + 按纹理号分组 ⇒ **快照与绘制的唯一同源** |
| **`src/live2d/mtn.ts`** | ✅ `.MTN` 解析 + 播放态 + 淡入淡出 + `advanceMotion` |
| **`src/live2d/runtime.ts`** | ✅ 10 实例槽 / 572B 节点 / 动作缓存三张表（挂 `Engine`）+ `l2dNodeDrawable` + `l2dAdvance` |
| **`src/live2d/assetLoader.ts`** | ✅ 按统一文件 id 读 `.MOC`/PNG/`.MTN` 并接上运行态（两宿主共用一份） |
| **`src/vm/handlers/live2d.ts`** | ✅ **18 条 opcode 全落地**（`LIVE2D_OPS` 14 + `LIVE2D_NATIVE_OPS` 3 + `0x343` 不在本族） |
| **宿主接线** | ✅ `SceneState.l2dHost`（引用 `Engine`）+ `scL2dTick` 进两宿主 `advanceModel` + `scSnapshot(…, host)` 导出 `l2d` 段 |
| **`src/renderer/pixi/l2dTextures.ts`（本批新）** | ✅ 统一文件 id → Pixi 纹理（**普通 PNG**，不经 AGF 解码器）；载入完成置脏；`ensure/waitIdle` |
| **`src/renderer/pixi/presenter.ts`（本批改）** | ✅ **第四类图元**：L2D 批次按节点 key 与 item/text/mesh **四路归并**，每批一个 Pixi `Mesh` |
| **Electron `readById` 通道（本批新）** | ✅ `electron/ipc/files.ts` + `preload.ts` + `ipcProtocol.ts` + `ipcFileSource.ts`（**没有它真实运行时装载链是断的**） |
| 守卫 | ✅ `test/live2d-moc.test.ts`（2）、`live2d-deform.test.ts`（5）、`live2d-chain.test.ts`（2，E3）、**`live2d-render.test.ts`（6，E3）**；全仓 **584 测试 / 583 通过 / 0 失败**（1 skip）、`npm run verify` 干净 |

**★最重要的一条（数据）**：修完 refno 表后，**335/335** 模型满足
`DrawData.pivotPoints == pivotDrawOrders == pivotOpacities == ∏pivotCount` 且
`BDAffine.affines == pivotOpacities == ∏pivotCount`（各 6686 / 4085 例）。
**这条恒等式就是"pivots 解析正确"的强证据** —— 两个 bug 中任意一个复发都会让 `∏` 退化成 1 而立刻变红。

---

## 4. 未完成 / 下一步（从哪接着干）

### 4.1 M3（门控与集成）—— 现在的主要缺口

1. **`global a9d0` 真读**：装载链已通，但没有任何地方把该开关映射成"跳过 L2D 装载"（能力条目 `live2d-enabled-config-flag` 现为 `partial`）。
2. **`live2d-slot-probe`**：把"10 槽里有没有活模型"接进 `sceneNeedsRender`（现在有 `SceneState.l2dHost` 这个引用就够）。
3. **E4 的第二个对照**：在 CONFIG 里关掉 Live2D（`a9d0 = 1`）截静图回落支（`SO004A`），与 `.tmp/l2dfix-0-title.png` 对照。
   ★对齐判据已就绪：快照 `l2d-node key=0x14 slot=0 可绘制=1 批次=N 三角=M rect=(…) tex=[0:0x4f9f/…]`
   给出这一帧的外接矩形与纹理来源 ⇒ 截图可逐项核对"画在哪、画了几个三角形、用的哪张图"。

### 4.2 已知近似 / 未建模（**都写在代码与能力条目 note 里，没有静默**）

- **逐顶点 alpha**：引擎把该网格的 opacity 写满它的每个顶点（位置流第 3 个 float）⇒ 按**网格**切批次时每批一个 alpha 是**精确**的（见 §0 第 2 条，这是踩过的坑）；Pixi 默认 mesh 着色器没有逐顶点色，但本图层不需要。
- **背面剔除**：引擎默认剔除、`optionFlag & 0x20` 关剔除；Pixi 2D 管线不剔除 ⇒ 是**超集**（alpha 混合下无害）。
- **节点 `+508` 的 4×4**：按单位阵处理（语料只用 `0x344`）。要支持 `0x346`–`0x34D` 时改 `render.ts` 的 `l2dNodeTransform()` **一处**即可（但那族 setter 的矩阵组装顺序 `sub_4A07F0` 未逐行确证）。
- **`.MTN` 的 `LAYOUT:`**：按"不影响摆放"处理（参考画布口径是推断；5 个 `Y=1024` 的例外动作未对照）。
- **每帧重建 `Mesh`/`MeshGeometry`**（60 个网格 → 60 个 Mesh/帧）：与既有的每帧 `new Graphics()` 同一取舍；GPU 缓冲由 Pixi 的 `GCManagedHash` 回收（`Geometry.autoGarbageCollect = true`）。若将来要压帧开销，就在 presenter 里按 `(节点 key, 网格 id)` 缓存复用。
- **`0x348` 的 op3**（汇总参数）语义未逐行确证 ⇒ 该函数条目 `PARTIAL`。
- ~~多参数同时插值（`m ≥ 2`）未实现~~ **已实现（2026-09-17）**：见 §0 第 4 条 —— 先前的"本作不可达"结论是**错的**（只统计了网格自身的 pivots，没统计变形器上的）。现在按 SDK 的 `2^m` 角点做多线性混合，`m ≤ 1` 与旧口径逐位一致。
- **`0x350`/`0x346`–`0x351`**：已按语义实现，但**语料 0 次使用**、无真机对照。

### 4.2b E4 证据（已取得）

| 图 | 含义 |
|---|---|
| `.tmp/l2dfix-0-title.png`（2026-09-17，`npx electron tools/shot.cjs --centered --name l2dfix`） | **L2D 支出画**：白发蓝翼角色完整叠在背景上（`a9d0 == 0` 支） |
| `.tmp/t0042d-0-title.png`（2026-09-16，修前） | **同一场景的"没出画"对照**：只有背景与特效残影，角色完全不见（当时 `Buffer` 报错 ⇒ 槽空） |

> 这两张就是 acceptance #5 要的"真界面截图 + 与不可用状态对照"。真正的 `a9d0 != 0` 静图回落支
> （`SO004A`）仍需在 CONFIG 里关掉 Live2D 才能截（`a9d0` 是 `save-int` 持久量，`CONFIG1.txt:1741-1742` 写它），
> 留作后续。
> 日志侧的对应证据：`[l2d] 纹理 0x4f9f/0x4fa0/0x4fa1 → TITLE00/01/02.PNG` +
> `[present …] l2d={槽1 节点1 可画1 纹理3}`。

### 4.3 已收敛（不必再查）

- `DrawData.pivotPoints` 是**局部坐标**、由 `targetId` 链上的 `BDAffine`/`BDBoxGrid` 变换（`sub_4C8BC0` raw 153345-153424）⇒ `deform.ts` 的取法**已证实**（原先按 E4 待定的那一条已可关掉）。
- `analysis/live2d-deform-semantics.md` §2.2 关于 `affines` 恒为 0 的结论**已过时**（那是旧解析器的观测）。

### 4.4 脚本台账

- `SETL2DMOC` 家族（560+ 处 `i34x`）未登记 —— 只需知道它是"MOC ↔ 纹理对照表"。
- `INFOEN` / `BTL` 的 L2D 段未登记（`INFOIT` 1 处）。

---

## 5. 复现 / 自检命令

```bash
cd app/amayui-emulator

# 全量解析 + 不变量体检（335 个模型）
npx tsx src/tools/live2dMoc.ts

# 单模型结构 dump（pivots / 关键帧组 / 绘制序 / 不透明度）
npx tsx src/tools/live2dStruct.ts TITLE.MOC

# Live2D 四组守卫（解析 / 变形 / 真资产装载链 / 出画几何）
npx tsx --test test/live2d-moc.test.ts test/live2d-deform.test.ts test/live2d-chain.test.ts test/live2d-render.test.ts

# 全仓（typecheck 三份 tsconfig + 全部测试 + dead-writes）
npm run verify
```

**语料位置**：`raw-parts/**/*.MOC`（335 个，gitignore 的本地解包目录）—— 由
`node scripts/alf/unpack_alf.mjs --out raw-parts raw/SYS4INI.BIN` 与 `… raw/APPEND0n.AAI` 生成。
**资源根**：`raw/`（日文原版，含 `SYS4INI.BIN` + `*.ALF`）优先，其次 `install/`；
Live2D 装载按**统一文件 id** 从 `FileSource.readById` 直读（不依赖 `raw-parts`）。
守卫对语料/资源缺失的处理：`skip` + 诊断（不假装通过）。

---

## 6. 关键文件索引

| 文件 | 作用 |
|---|---|
| `tickets/T-0054/{ticket.json,notes.md}` | 工作单与判据（acceptance #2–#5 就是 M1–M3）；notes §4.1 是本次改动、§5 是未完成项 |
| `docs-new/03-engine/live2d.md` | 引擎语义（版本/接线/opcode/链/**§5.1 顶点流与摆放**） |
| `docs-new/03-engine/live2d-moc-format.md` | **`.moc` 格式长文**（含两个静默 bug 的记录） |
| `docs-new/03-engine/rendering.md` | §4 的渲染后端现状（第四类图元 + 四路归并） |
| `docs-new/04-app/live2d-support-assessment.md` | 评估正文（能力/依赖/工作量/计划 + §3.5 来源纪律） |
| `app/amayui-emulator/src/live2d/moc.ts` | `.moc` 解析器（335/335；注释带 O 行号） |
| `app/amayui-emulator/src/live2d/deform.ts` | 变形数学（仿射 / BDBoxGrid / pivot / `evaluateModel`） |
| **`app/amayui-emulator/src/live2d/render.ts`** | **出画几何**（`l2dBatches`：门控 + 摆放 + 分组）—— 快照与绘制同源 |
| `app/amayui-emulator/src/live2d/mtn.ts` | `.MTN` 解析 + 播放态 + 淡入淡出 |
| `app/amayui-emulator/src/live2d/runtime.ts` | 运行态三张表 + `l2dNodeDrawable` + `l2dAdvance` |
| `app/amayui-emulator/src/live2d/assetLoader.ts` | 按统一 id 装载并接上运行态 |
| `app/amayui-emulator/src/vm/handlers/live2d.ts` | 18 条 opcode 的 handler + 对照表 |
| **`app/amayui-emulator/src/renderer/pixi/l2dTextures.ts`** | **L2D 纹理（普通 PNG）→ Pixi 纹理** |
| **`app/amayui-emulator/src/renderer/pixi/presenter.ts`** | 每帧合成（四路归并；L2D = 第四类图元） |
| `app/amayui-emulator/src/renderer/scene/snapshot.ts` | `l2d` 段（槽 / 节点 / 批次 / 三角形 / 纹理来源） |
| `app/amayui-emulator/test/live2d-render.test.ts` | **出画几何守卫（E3）** |
| `engine/天结_unpacked.exe_utf8.c` | oracle（`sub_4B0360` / `sub_4783D0` / `sub_4C8BC0` / `sub_4C8620` / `sub_4C1EA0` / `sub_49CA10` / `sub_4C6080` …） |
