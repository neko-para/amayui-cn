# CONTEXT — Live2D（TITLE）实现进度快照

> **状态：暂停（2026-09-16）。** 本文件是"接着干"所需的全部上下文；写完后**未再继续任何分析/实现**。
> 任务归属：`tickets/T-0054`（`status=doing`）。最后一次提交：`c6de5067 feat: live2d research`（评估与台账已进仓）。

---

## 1. 目标与已定决策

**目标**：实现《天結いキャッスルマイスター》**TITLE 所需的 Live2D**（自研路线），使标题立绘按 `global a9d0` 门控正确出画。
判据见 `tickets/T-0054/ticket.json` 的 acceptance #2–#5。

**已定（用户拍板 2026-09-16）**：

| 项 | 决定 |
|---|---|
| 路线 | **C 自研移值**：不引 Cubism 5（只吃 `.moc3`）、不引 `live2d.min.js`（专有运行时再分发 + headless 无 WebGL 不可用） |
| 参考源纪律 | **规范优先**（有官方规范的部分）→ **资产实证兜底**（`.moc` 字节布局无公开规范 ⇒ 用 335 个真实模型逼不变量）→ **反汇编只当 oracle**；社区实现只作交叉验证、不逐行搬运 |
| 文档落点 | 评估正文 `docs-new/04-app/live2d-support-assessment.md`（§3.5 即纪律）；引擎语义 `docs-new/03-engine/live2d.md` |

**格式事实的来源标记**（贯穿 `moc.ts` 注释）：

- **S1** 官方 Cubism 2.1 Web SDK `live2d.min.js`（混淆；与本作内嵌的 2.0.06 同代）
- **S2** `EasyLive2D/live2d-v2`（S1 的 Python 直译，命名可读）
- **S3** `NiaBie/FreeLive`（C# 独立实现）
- **O** 反编译 oracle：`engine/天结_unpacked.exe_utf8.c`（本作真正用的那一版，行号已标进代码注释）
- **E** 资产实证：335 个真实 `.MOC`

---

## 2. 引擎侧关键结论（速查）

- 内嵌 **Live2D SDK 2.0.06 for DirectX**（`Live2D version %s for %s` raw 143532；常量 raw 5307-5308）⇒ Cubism **2.x**。
- 资产：`.MOC`（二进制，**version = 10**）/ `.MTN`（**文本** Animator）/ 纹理 **PNG**（引擎走 `D3DXCreateTextureFromFileInMemory`）。**没有 `.model.json`**，引擎按脚本逐文件装载。
- 接线：`Scene+55812` 起 **10 个实例槽**；每槽 76 字节实例（+0 模型 / +4,+8 两条动作 / +12 动作队列 / +16 眨眼 / +36..+76 十张纹理）；另有 **572 字节「立绘/变换节点」**表（`Scene+1096`）。
- **TITLE 的完整链路**（`src/TITLE.txt`）：
  1. `jcc (global-int a9d0)`：**a9d0 != 0 ⇒ 静态贴图**（`set-texture 5273 5` = `SO004A`）；**a9d0 == 0 ⇒ Live2D**（默认 0 = 默认开，`INITCONFIG0` raw 脚本 `src/INITCONFIG0.txt:12-13`）。
  2. L2D 支：`mov f8c46 = 4f9e`（MOC 文件 id）、`mov f8c47 = 0`（槽号）→ 循环 `lookup-array (global-int 708ab6) (global-int f807f)` **间接 call-script**（表里是脚本 id `5226..5236`，含 `SETL2DMOC`）→ `src/SETL2DMOC.txt` 按 `f8c46` 分支做 `i341 <moc> f8c47` + 若干 `i345 <纹理> f8c47 <纹理号>`。
  3. 回到 TITLE：`i352 0 0 0`（预置"待绑纹理号 0"）→ `i34e 5274 0 0 1`（装 `.MTN`：**动作槽 0、L2D 槽 0、循环 1**）。
  4. 静态支另有一处 `i344 14 0`；**Live2D 支在同位置也有 `i344 14 0`**（`src/TITLE.txt:590`，在 `label_000024a4`）。
- ★**`0x344` 的真身已订正**：`i344 <key> <slot>` = **创建/绑定 572B 立绘节点**（`sub_427CB0` → `sub_4AFBF0` raw 133937-133947：在 `Scene+1096` 取/建记录、`record[0] |= 1`、**`record[1] = slot`**）。旧文档写的"纹理槽变换记录"是错的。
- 绘制：四路归并 → `sub_4B0360`（raw 134277-134406）只在该节点 +4 指向的 L2D 槽**真有模型**时出画（raw 134320）→ `sub_4783D0`（raw 92578-92615：提交待播动作 → `sub_4BCB50` 队列写参数 → update/draw）⇒ **动作推进与出画是同一次调用**（无独立逐帧 tick）。
- 眨眼是**死位**：唯一调用点被 `实例+23` 门控，而该位全代码无写入点 ⇒ 本作不眨眼（可先不实现）。
- 语料用到的指令仅 7 条：`0x341 / 0x342 / 0x344 / 0x345 / 0x349 / 0x34D / 0x34E / 0x352`（其中 TITLE 只用 `0x341 0x344 0x345 0x34E 0x352`）。

---

## 3. 已完成（可直接用）

| 产物 | 状态 |
|---|---|
| `tickets/T-0054/{ticket.json,notes.md}` | ✅ 已建单（`doing`），acceptance #1 已达成（路线 + 纪律留档） |
| `docs-new/04-app/live2d-support-assessment.md` | ✅ 评估正文：能力速查 / 依赖三路线比对 / 工作量 / 分阶段计划 / §3.5 参考源纪律 / §6 待拍板 |
| `docs-new/03-engine/live2d.md` | ✅ 引擎语义长文（版本/接线/opcode 面/能力缺失面/装载→推进→绘制链） |
| `analysis/functions.json` | ✅ +33 条 L2D 条目（含 SDK 入口、装载族、`0x34F/0x350/0x351` handler），并订正 `0x341/0x345` |
| `analysis/engine-capabilities.json` | ✅ 5 条 Live2D（新增 `live2d-enabled-config-flag` / `l2d-node-draw-gate` / `live2d-node-draw-advance`；两条旧条目升 E1）；渲染物已重建 |
| **`app/amayui-emulator/src/live2d/moc.ts`** | ✅ **`.moc` 解析器**：335/335 模型**逐字节成功**（magic/version/EOF `0x88888888`/无尾随字节全通过） |
| `app/amayui-emulator/src/tools/live2dMoc.ts` | ✅ 实证工具（全量解析 + 不变量体检 + `--sample N`） |
| `app/amayui-emulator/test/live2d-moc.test.ts` | ⚠️ **目前是红的**（见 §4.1：4 条不变量写得太紧，与实证不符） |

**实证数据（335 个模型，工具输出）**：

```
version 分布：v10×335      参数总计 2789（均 8.3/模型）      对象总计 160382
标签直方图：27:31844  15:29404  69:18490  66:10791  51/id:base:9651  67:8697
            60/id:param:6966  25:6686  50/id:draw:6686  70:6686  68:4085
            133/134/id:parts:3576  131:2789  136:335  137:335  65:20
            （无 33=引用、无 0=null ⇒ 本作语料比社区样本"干净"）
```

**`.moc` 格式要点**（详见 `moc.ts` 头注释；来源 S1/S2/S3 + O + E）：

- 容器：`"moc"` + u8 version + 对象图 +（v≥8）`0x88888888`；**数值全为大端**；变长整数是**大端 base-128**（首字节 = 高 7 位，最高位 1 = 继续，≤4 字节）。
- 对象图：`<varint 类型标签><载荷>`；每个对象（含 null/字符串/数组）**后序**进 refno 表；标签 33 = `u8 33 + i32 refno`。
- 标签表（本作用得到）：`10 颜色 / 11 RectD(4×f64) / 12 RectF(4×f32) / 13 PointD / 14 PointF / 15 对象数组 / 16,25 int 数组 / 26 double 数组 / 27 float 数组 / 50,51,60,134 四种 ID(字符串) / 65 BDBoxGrid / 66 PivotManager / 67 ParamPivots / 68 BDAffine / 69 AffineEnt / 70 DrawData / 131 ParamDefFloat / 133 PartsData / 136 ModelImpl / 137 ParamDefSet / 142 Avatar`。
- **70 DrawData 字段序**（v10）：`id(50)` → `targetId(51|0)` → `pivotManager(66)` → `averageDrawOrder(i32)` → `pivotDrawOrders(内联 i32[])` → `pivotOpacities(内联 f32[])` → *(v≥11: clipId)* → `textureNo(i32)` → `pointCount(i32)` → `polygonCount(i32)` → `indexArray(25)` → `pivotPoints(15 × 27)` → `uvs(27)` → *(v≥8: optionFlag(i32)，`&1` 时再读 colorGroupNo)*。
- **133 PartsData**：`locked/visible` 两个**位**（同一字节的 bit7/bit6，MSB 优先）→ `id(134)` → `baseDataList(15)` → `drawDataList(15)`。
- **68 BDAffine**：`id(51)` → `targetId(51)` → `pivotManager(66)` → `affines(15 × 69)` → *(v≥10: pivotOpacities 内联 f32[])*。
- **65 BDBoxGrid**：`id(51)` → `targetId(51)` → **columnCount(i32，先读)** → **rowCount(i32，后读)** → `pivotManager(66)` → `pivotPoints(15 × 27)` → *(v≥10: pivotOpacities)*；每组网格长度 `(rowCount+1)*(columnCount+1)*2`。
- **136 ModelImpl**：`paramDefSet(137)` → `partsDataList(15 × 133)` → `canvasWidth(i32)` → `canvasHeight(i32)`；**131 ParamDefFloat** = 3×f32(min/max/default) + `paramId(60)`。
- **`.MTN` 语法**（O: `sub_4BE490` raw 144631 起；实测 330 个文件）：`# Live2D Animator Motion Data` / `$fps=N` / `$fadein=ms` / `$fadeout=ms` / `<PARAM>=v0,v1,…`（等间隔采样曲线）/ `VISIBLE:<部件ID>=0|1` / `LAYOUT:{X,Y,ANCHOR_X,ANCHOR_Y,SCALE_X,SCALE_Y}=值`（**动作自带布局**，TITLE 的模型摆放就靠它）。

---

## 4. 未完成 / 下一步（从哪接着干）

### 4.1 第一优先：把 `test/live2d-moc.test.ts` 修正为"实证口径"

工具 `--invariants` 的体检结果显示 **4 条我写死的规则与实证不符**（测试因此红）：

| 规则 | 实测 |
|---|---|
| `drawData.pivotPoints.length == ∏pivots` | ✗ **4514 例不符**；实测"顶点组数 / ∏pivots"比值为 **1×2172、2×1802、3×2248、4×179、5×140、9×70** ⇒ ∏pivots 的口径可疑（可能还要乘上别的维度，或 `pivotCount` 不是组合数） |
| `drawData.pivotDrawOrders.length == ∏pivots`、`pivotOpacities.length == ∏pivots` | ✗ 各 4514 例（与上一条同源，三者长度一致） |
| `bdAffine.affines.length ∈ {0, ∏pivots}` | ✗ 实测 **4085 个 BDAffine 的 affines 全是 0**，但文件里共有 **18490 个 AffineEnt(69)** ⇒ **槽位/对象分配有疑点**（整文件字节数对得上，但"哪个对象是关键帧数组"需要复核） |
| `bdAffine.pivotOpacities.length == ∏pivots` | ✗ 3625 例 |
| `uvs ∈ [-0.01, 1.01]` | ✗ **30 个文件**越界 ⇒ 规则要放宽（Cubism 允许 UV 出界做平铺/裁切） |

> 处理建议：先用 `npx tsx src/tools/live2dMoc.ts` 的体检输出把**真实分布**看清（工具已带 `dist()`），再把测试改成"分布断言 + 无违例"；`affines 全 0` 需要在 s 级反汇编里复核 `sub_4CCB10`（raw 156973-156980）读的第三/第四个对象到底是什么。

### 4.2 M1 剩余（出画）

1. **变形与顶点生成**：BDAffine（origin/scale/rotation/reflect 的运算顺序）与 BDBoxGrid（贝塞尔曲面求值）→ 由 `pivotManager` 选关键帧并**线性/双线性/三线性插值**（S2 `pivot_manager.py` / `ut_interpolate.py`；`params[0]` 是最快变化的一位）。
2. 按 `textureNo` 绑定纹理、按 `averageDrawOrder`/`pivotDrawOrders` 排序，生成三角网格。
3. **接进 emulator**：走 Pixi 网格路径（`0x320 create-mesh` 那条已存在），产出与既有一致的场景层绘制（便于 headless 快照）。
4. **`.mtn` 解析器 + 动作队列**（fade in/out、循环；装载即入队；推进绑在"节点绘制"那一次调用上）。
5. **opcode 接线**（现状）：`0x341/0x345/0x34E` = `stubSubsystem`；`0x344` = `op_set_texture_transform` → `native.setTextureTransform`（**命名与语义都需按"创建 572B 节点 + 绑定 L2D 槽"重做**）；`0x346–0x34D` = no-op；`0x352` 待补。
6. **门控**：`global a9d0` 真读 + `sub_40BE10` 的 10 槽重画判据。

### 4.3 文档 / 收尾

- ❌ **`docs-new/03-engine/live2d-moc-format.md` 尚未创建**（acceptance #2 明确要求；目前格式知识只散在 `moc.ts` 头注释与评估文档里）——创建时每条格式事实要标来源（S1/S2/S3/O/E）。
- ❌ `opcode-table.md` 的 `0x345` 语义订正 + `0x34F/0x350/0x351` 转"已核对"、`0x344` 语义订正（acceptance #6）。
- ❌ `stub-reaudit-2026-09.md` 的 Live2D 排除项加改判注记。
- ❌ 未跑 `tsc --noEmit` / `npm run verify`（新文件尚未过类型检查；`test/live2d-moc.test.ts` 红）。
- 🧹 待删：`app/amayui-emulator/src/tools/_l2dtrace.ts`（一次性调试脚本）。

### 4.4 未收集的调研结果（**重要**）

后台子代理 **`f4f7d5f3-5d83-4e16-bf48-affae7b52239`**（"Derive Live2D deform/draw semantics"，任务 = 从反编译里给出各字段语义 + 顶点生成 + 每帧求值入口 + 纹理绑定 + v8/v10 差异）
**已完成但报告未取回**（其结论**不在本文件里**）。需要时用 `send_message` 取回或复跑。

另一个子代理 `7037ef91`（moc2 字节布局）的结论**已并入** `moc.ts` 与本文档。

---

## 5. 复现 / 自检命令

```bash
cd app/amayui-emulator

# 全量解析 + 不变量体检（当前输出即 §3/§4.1 的数据）
npx tsx src/tools/live2dMoc.ts --sample 2

# 单文件解析（调试）
npx tsx src/tools/_l2dtrace.ts "../../raw-parts/APPEND01/\$1\$BM901A.MOC"

# 解析守卫（当前红，见 §4.1）
npx tsx --test test/live2d-moc.test.ts
```

语料位置：`raw-parts/**/*.MOC`（335 个，gitignore 的本地抽取目录）；`raw/` 是日文原版 junction；`install/` 是汉化版（只有 `.ALF` 压缩档）。
测试对语料缺失的处理：找不到 `raw-parts/`/`raw/` 时 `skip` 并打诊断（与 `config-first` 类测试口径一致）。

---

## 6. 关键文件索引

| 文件 | 作用 |
|---|---|
| `tickets/T-0054/ticket.json` / `notes.md` | 工作单与判据（acceptance #2–#5 就是 M1–M3） |
| `docs-new/04-app/live2d-support-assessment.md` | **评估正文**（能力/依赖/工作量/计划/待拍板 + §3.5 来源纪律） |
| `docs-new/03-engine/live2d.md` | 引擎语义（版本/接线/opcode/链） |
| `app/amayui-emulator/src/live2d/moc.ts` | **`.moc` 解析器**（335/335 逐字节通过；注释带 O 行号） |
| `app/amayui-emulator/src/tools/live2dMoc.ts` | 实证工具（解析 + 不变量体检） |
| `app/amayui-emulator/test/live2d-moc.test.ts` | 解析守卫（**红**，按 §4.1 修） |
| `src/TITLE.txt:526-554` / `:590` | TITLE 的 Live2D 装载与节点创建（`i344 14 0`） |
| `src/SETL2DMOC.txt` | MOC ↔ 纹理对照表（238 个分支） |
| `engine/天结_unpacked.exe_utf8.c` | oracle（`sub_4BD560` / `sub_4C7220` / `sub_4CA280` / `sub_4CCB10` / `sub_4CEDF0` / `sub_4C8A60` / `sub_4B0360` …） |
