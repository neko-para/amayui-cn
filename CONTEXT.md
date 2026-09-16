# CONTEXT — Live2D（TITLE）实现进度快照

> **状态：M1/M2 主体已落地（2026-09 续做）。** 本文件是"接着干"所需的全部上下文。
> 任务归属：`tickets/T-0054`（`status=doing`）；过程细节见 `tickets/T-0054/notes.md`。

---

## 1. 目标与已定决策

**目标**：实现《天結いキャッスルマイスター》**TITLE 所需的 Live2D**（自研路线），使标题立绘按 `global a9d0` 门控正确出画。
判据见 `tickets/T-0054/ticket.json` 的 acceptance #2–#5。

**已定（用户拍板 2026-09-16）**：

| 项 | 决定 |
|---|---|
| 路线 | **C 自研移值**：不引 Cubism 5（只吃 `.moc3`）、不引 `live2d.min.js`（专有运行时再分发 + headless 无 WebGL 不可用） |
| 参考源纪律 | **规范优先** → **资产实证兜底**（`.moc` 字节布局无公开规范 ⇒ 用 335 个真实模型逼不变量）→ **反汇编只当 oracle**；社区实现只作交叉验证 |
| 文档落点 | 评估正文 `docs-new/04-app/live2d-support-assessment.md`（§3.5 即纪律）；引擎语义 `docs-new/03-engine/live2d.md`；**格式 `docs-new/03-engine/live2d-moc-format.md`** |

**来源标记**（贯穿代码注释与文档）：**S1** 官方 Cubism 2.1 Web SDK / **S2** `EasyLive2D/live2d-v2` /
**S3** `NiaBie/FreeLive` / **O** 反编译 oracle（`engine/天结_unpacked.exe_utf8.c`，行号已标进代码）/
**E** 资产实证（335 个 `.MOC`、330 个 `.MTN`）。

---

## 2. 引擎侧关键结论（速查）

- 内嵌 **Live2D SDK 2.0.06 for DirectX**（raw 143532；常量 raw 5307-5308）⇒ Cubism **2.x**。
  **`.moc` 只接受 `version ≤ 10`**（raw 143882；越限 raw 143912 拒绝）⇒ 不存在 v11 字段（无 clipId）。
- 资产：`.MOC`（二进制 **v10**）/ `.MTN`（**文本** Animator）/ 纹理 **普通 PNG**（走 `D3DXCreateTextureFromFileInMemory`）。
  **没有 `.model.json`**，引擎按脚本逐文件装载。实测 id：`0x4f9e=TITLE.MOC` / `0x4f9f=TITLE00.PNG` / `0x5274=TITLE.MTN`。
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
- **坐标**：模型空间 **y 向下**、原点画布左上（投影 `D3DXMatrixOrthoLH(w,-h,-1,1)` raw 134354）；旋转角是**度**。
- 眨眼是**死位**（唯一调用点被 `实例+23` 门控，该位全代码无写入点）⇒ 本作不眨眼，可先不实现。
- 语料用到的指令仅 8 条：`0x341 0x342 0x344 0x345 0x349 0x34D 0x34E 0x352`（TITLE 只用 `0x341 0x344 0x345 0x34E 0x352`）。

---

## 3. 已完成（可直接用）

| 产物 | 状态 |
|---|---|
| `tickets/T-0054/{ticket.json,notes.md}` | ✅ `doing`；notes 里有完整的本次改动清单与未完成项 |
| `docs-new/03-engine/live2d-moc-format.md` | ✅ **格式长文**（§2 容器/对象图、§2.4 两个静默 bug、§3 字段读序与组合数；每条标来源） |
| `docs-new/03-engine/live2d.md` | ✅ 引擎语义长文（版本/接线/opcode 面/装载→推进→绘制链） |
| `analysis/live2d-deform-semantics.md` | ✅ oracle 专项报告（856 行，逐条 raw 行号） |
| `analysis/functions.json` | ✅ +44 条 L2D 条目（含全部 handler） |
| `analysis/engine-capabilities.json` | ✅ 5 条 Live2D 全部重评（3 条 → `modeled-unverified`/E3、1 条 → `partial`、1 条仍 `absent`）；渲染物已重建 |
| `analysis/scripts.json` | ✅ TITLE 加 Live2D 段（`layout` 11 条含 `mov (global-int f8c46) 4f9e` / `i34e 5274 0 0 1` / `i344 14 0`） |
| **`src/live2d/moc.ts`** | ✅ `.moc` 解析器：**335/335 逐字节成功**；**修了两个静默 bug**（refno 表只登记部分 kind、复合对象缺 `kind`）⇒ `affines`/`pivots` 不再是空的 |
| **`src/live2d/deform.ts`** | ✅ 变形数学：仿射（`R·S`+origin、反射并入符号）、BDBoxGrid 张量积 Bernstein、pivot 组合下标与插值、`evaluateModel` |
| **`src/live2d/mtn.ts`** | ✅ `.MTN` 解析（`$fps/$fadein/$fadeout` + 等间隔曲线 + `VISIBLE:` + `LAYOUT:`）+ 播放态 + `advanceMotion` |
| **`src/live2d/runtime.ts`** | ✅ 10 实例槽 / 572B 节点 / 动作缓存三张表 + `l2dNodeDrawable` + `l2dAdvance`（挂 `Engine`） |
| **`src/live2d/assetLoader.ts`** | ✅ 按统一文件 id 读 `.MOC`/PNG/`.MTN` 并接上运行态（两宿主共用一份） |
| **`src/vm/handlers/live2d.ts`** | ✅ **18 条 opcode 全落地**（`LIVE2D_OPS` 14 + `LIVE2D_NATIVE_OPS` 3 + `0x343` 不在本族） |
| **宿主接线** | ✅ `SceneState.l2dHost`（引用 `Engine`）+ `scL2dTick` 进两宿主 `advanceModel` + `scSnapshot(…, host)` 导出 `l2d` 段与 `l2d-slot`/`l2d-node` 文本行 |
| 守卫 | ✅ `test/live2d-moc.test.ts`（2）、`test/live2d-deform.test.ts`（5）、`test/live2d-chain.test.ts`（2，E3 真资产）；**全仓 578 测试 / 577 通过 / 0 失败**，`tsc --noEmit` 干净 |

**★最重要的一条（数据）**：修完 refno 表后，**335/335** 模型满足
`DrawData.pivotPoints == pivotDrawOrders == pivotOpacities == ∏pivotCount` 且
`BDAffine.affines == pivotOpacities == ∏pivotCount`（各 6686 / 4085 例）。
**这条恒等式就是"pivots 解析正确"的强证据** —— 两个 bug 中任意一个复发都会让 `∏` 退化成 1 而立刻变红。

---

## 4. 未完成 / 下一步（从哪接着干）

### 4.1 ★还差"最后一段"：把变形几何画到 Pixi 上（M1 收尾）

已完成的是"**判据 + 求值 + 可断言**"；还差"**真的出现在屏幕上**"：

1. **Pixi 侧三角网格**：`engine.l2dNodes` → `l2dNodeDrawable` → `evaluateModel`（或直接用快照里的几何）
   → 每个 `textureNo` 一个 Pixi Mesh（顶点 = 画布坐标 + 572B 节点的平移/缩放；
   UV = `dd.uvs`；索引 = `dd.indices`；纹理按 `inst.textures.get(dd.textureNo)` 取 PNG）。
2. **层序**：`presenter.ts` 现在是"DrawItem / Mesh / 文本各画一遍"，L2D 是**第四类图元**，
   要与四路归并一致（引擎里 572B 节点也走同一次归并，见能力条目 `render-merge-two-pass-reorder`）。
3. 参考形状：`scSnapshot` 的 `l2d.nodes[].rect` 已经给出"这一帧该画在哪"（画布坐标的外接矩形），
   可以先用它对齐（先画一个矩形块验证位置/尺寸，再换真网格）。

### 4.2 M3（门控与集成）

1. **`global a9d0` 真读**：现在装载链已通，但没有任何地方把该开关映射成"跳过 L2D 装载"（能力条目 `live2d-enabled-config-flag` 现为 `partial`）。
2. **`live2d-slot-probe`**：把"10 槽里有没有活模型"接进 `sceneNeedsRender`（现在有 `SceneState.l2dHost` 这个引用就够）。
3. **E4**：Electron 真界面截图（TITLE 的 L2D 支）并与 `a9d0 != 0` 的静图回落支对照。

### 4.3 已知未解 / 待复核

- **`DrawData.pivotPoints` 是否已含 BDAffine 变换**：当前按"点是局部坐标、BDAffine 再变换"；
  E4 对照后若发现双倍变换，改法是"不叠乘最内层"（`deform.ts` 的 `evaluateModel` 注释写了）。
- **`0x348` 的 op3**（汇总参数）语义未逐行确证 ⇒ 该函数条目 `PARTIAL`。
- **多参数同时插值（`m ≥ 2`）未实现**：E 实测本作不可达（`params.length ≥ 2` 的网格只有 97 个且取值总在端值），
  已在 `deform.ts` 写明等价性边界（`m ≤ 1` 与 SDK 逐位一致）。
- **`0x350` 的 `sub_4282E0`** 等语料 0 次的指令：已按"清队列"实现，但无真机对照。
- **`analysis/live2d-deform-semantics.md` §2.2 关于 `affines` 恒为 0 的结论已过时**：
  那是当时**旧解析器**的观测；现在 `affines` 与 `∏pivotCount` 逐例相等（见 §3 的数据）。

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

# Live2D 三组守卫（解析 / 变形 / 真资产装载链）
npx tsx --test test/live2d-moc.test.ts test/live2d-deform.test.ts test/live2d-chain.test.ts

# 全仓
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
| `tickets/T-0054/{ticket.json,notes.md}` | 工作单与判据（acceptance #2–#5 就是 M1–M3）；notes §4/§5 是本次改动与未完成清单 |
| `docs-new/03-engine/live2d-moc-format.md` | **`.moc` 格式长文**（含两个静默 bug 的记录） |
| `docs-new/03-engine/live2d.md` | 引擎语义（版本/接线/opcode/链） |
| `docs-new/04-app/live2d-support-assessment.md` | 评估正文（能力/依赖/工作量/计划 + §3.5 来源纪律） |
| `analysis/live2d-deform-semantics.md` | oracle 专项报告（注意 §2.2 的 affines 结论已过时） |
| `app/amayui-emulator/src/live2d/moc.ts` | `.moc` 解析器（335/335；注释带 O 行号） |
| `app/amayui-emulator/src/live2d/deform.ts` | 变形数学（仿射 / BDBoxGrid / pivot / `evaluateModel`） |
| `app/amayui-emulator/src/live2d/mtn.ts` | `.MTN` 解析 + 播放态 + 淡入淡出 |
| `app/amayui-emulator/src/live2d/runtime.ts` | 运行态三张表 + `l2dNodeDrawable` + `l2dAdvance` |
| `app/amayui-emulator/src/live2d/assetLoader.ts` | 按统一 id 装载并接上运行态 |
| `app/amayui-emulator/src/vm/handlers/live2d.ts` | 18 条 opcode 的 handler + 对照表 |
| `app/amayui-emulator/test/live2d-chain.test.ts` | E3 守卫（真实 TITLE 资产走完整链） |
| `src/TITLE.txt:526-557` / `:552-556` / `:589-590` | TITLE 的 Live2D 分叉 / 装载 / 建节点（台账已登记） |
| `src/SETL2DMOC.txt` | MOC ↔ 纹理对照表（238 个分支） |
| `engine/天结_unpacked.exe_utf8.c` | oracle（`sub_4BD560` / `sub_4C7220` / `sub_4CA9B0` / `sub_4CCB10` / `sub_4CEDF0` / `sub_4A1860` / `sub_4B0360` …） |
