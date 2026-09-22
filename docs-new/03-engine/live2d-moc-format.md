---
kind: narrative
state: live
---
# 03-engine · Live2D `.MOC` 二进制格式（本作 Cubism 2.0.06 / version 10）

> **本页回答什么**：`.MOC` 文件**逐字节长什么样**、每个字段从哪来、哪些不变量被 335 个真实模型证实。
> **本页不回答什么**：怎么把参数变成顶点、怎么按 `.MTN` 动（那是 `live2d.md` §5 与 §3 的变形语义，见本页 §7 的回链）。
>
> 相关：`live2d.md`（引擎语义/接线/opcode 面）、`docs-new/04-app/live2d-support-assessment.md`（要不要引依赖的评估与决议）、
> `tickets/T-0054`（本页是 acceptance #2 的产出）。
> 实现：`app/amayui-emulator/src/live2d/moc.ts`（解析器）、`src/tools/live2dMoc.ts`（全量实证工具）、
> `test/live2d-moc.test.ts`（守卫：**全部 335 个**模型逐字节 + 结构不变量）。

---

## 1. 来源标记与参考源纪律

每条格式事实都标来源（纪律见评估文档 §3.5：**规范优先 → 资产实证兜底 → 反汇编只当 oracle**）：

| 标记 | 来源 | 说明 |
|---|---|---|
| **O** | 反编译 oracle `engine/天结_unpacked.exe_utf8.c` | 本作真正在用的那一版；**带 raw 行号** |
| **E** | 资产实证：`raw-parts/**/*.MOC`（**335 个**） | 用不变量逼格式（`.moc` 字节布局**没有公开规范**） |
| **S1** | 官方 Cubism 2.1 Web SDK `live2d.min.js`（混淆） | 与本作内嵌 2.0.06 同代 |
| **S2** | `EasyLive2D/live2d-v2`（S1 的 Python 直译，命名可读） | 交叉验证 |
| **S3** | `NiaBie/FreeLive`（C# 独立实现） | 交叉验证 |

> 纪律：**S1/S2/S3 只作交叉验证，不逐行搬运**；`.moc` 布局以 **O + E** 为准。

**语料**：`raw-parts/**/*.MOC`＝335 个（`node scripts/alf/unpack_alf.mjs --out raw-parts raw/SYS4INI.BIN` 与
`raw/APPEND0n.AAI` 解包所得，**gitignore 的本地目录**）。全部 335 个都是 `version = 10`（E）。
复现：`npx tsx src/tools/live2dMoc.ts`。

---

## 2. 容器与对象图

### 2.1 文件外壳

```
偏移 0: 6D 6F 63      "moc"（ASCII）
偏移 3: u8            version = 10（本作全量；解析器接受 ≤11）
偏移 4: 对象图        根对象 = ModelImpl(136)
末尾:   88 88 88 88   version ≥ 8 的结束标识（大端 u32，O: sub_4BD560 raw 143843-143945；E: 335/335）
```

★**字节恰好读完**是硬判据（E：335/335）：解析完根对象后必须正好落在结束标识上、之后不得有尾随字节。
这条把"字段顺序读错"和"长度读错"都钉死了 —— 但**它抓不到 refno 解析错**（见 §2.4）。

### 2.2 对象读写原语（O: `sub_4C7220` raw 152026-152322）

| 形态 | 编码 | O 依据 |
|---|---|---|
| 类型标签 | **大端 base-128 变长整数**（首字节 = 高 7 位；最高位 1 = 继续；≤4 字节） | `sub_4C1000` raw 147036-147116 |
| 定宽数值 | **大端**：i32 / f32 / f64 | 各 case |
| 字符串 | varint 字节长度 + 原始字节（实测全 ASCII） | `sub_4C6FF0` |
| 内联 i32 数组 | varint 元素数 + n×i32 | `sub_4C14E0` raw 147268-147337 |
| 内联 f32 数组 | varint 元素数 + n×f32 | `sub_4C1660` raw 147339-147404 |
| 对象数组 | varint 元素数 + n×`object()` | case 15 |
| 引用（refno） | `u8 33` + **大端 i32** 下标 | raw 152091-152101（越界 ⇒ `aIllegalRefnoBr` 异常） |
| 位读取 | 字节内 **MSB→LSB**；每次读对象前重置位游标 | `sub_4C6E30` raw 151829-151853 |

### 2.3 refno 表：**后序**，且**每个对象都进表**

- 表是**后序**：一个对象的**载荷全部读完**（含其子对象）之后，才把**它自己**写进表尾（O: raw 152637-152639 / 152319）。
  ⇒ 引用只能指向"已经读完的对象"，且下标 = 该对象在**遍历顺序里的完成序号**。
- ★**不分类型，全部进表**：`sub_4C7220` 在每个 case 之后都会 `table[count++] = obj`。
  调用方还会临时切换"表"（例如标题立绘那一族用 `_this[19..21]` 的第二张表），但**口径一致**。

### 2.4 ★两个真实踩过的坑（同一症状：字节流全对、语义全空）

这两个 bug 都**不违反字节恰好读完**，只在语义上静默失效 —— 记在这里是因为它们各花了很长定位时间：

| 坑 | 症状 | 根因 | 判别信号 |
|---|---|---|---|
| **① refno 表只登记了部分 kind** | `BDAffine.affines` **恒为空**（4085 个全是 0）、`PivotManager.params` **恒为空**；而 `pivotOpacities` 却有正确的长度 | 解析器只对 id/字符串/数组等少数 kind 调 `reg()`，`AffineEnt(69)`/`ParamPivots(67)`/`PivotManager(66)`/`PartsData(133)`/`DrawData(70)`/`BDBoxGrid(65)` 都没进表 ⇒ 指向它们的 refno 解析成 `undefined` | **数组长度 vs `∏ pivotCount` 对不上**（见 §3.2）；"A 数组非空但同族的 B 数组恒空" |
| **② 复合对象缺 `kind` 判别字段** | 同上（`filter(kind === 'affineEnt')` 全滤掉） | `readAffineEnt()` 返回了没有 `kind` 的对象，而消费侧用 `kind` 做判别 | 元素"读出来了但被过滤掉"；`JSON.stringify` 里结构是**裸数值对象** |

> **纪律**：凡进 refno 表的复合结构**必须**自带 `kind`；凡新增一种对象类型，都要问一句"它进表了吗"。
> **守卫**：`test/live2d-moc.test.ts` 断言 `pivotPoints.length == pivotDrawOrders.length == pivotOpacities.length == ∏pivots`
> 且 `affines.length == ∏pivots` —— 这两个 bug 中任意一个复发都会立刻变红。

---

## 3. 对象类型与字段读序

### 3.1 标签表

工厂 `sub_4CA280`（raw 154663-154764）负责 ≥48 的标签；块类型（≤33）由 `sub_4C7220` 的 switch 直接处理。
**本作语料实际出现**的标签（E：全量直方图）：

| 标签 | 类 | 出现次数（335 模型合计） | 备注 |
|---|---|---|---|
| 27 | `floatArray` | 31844 | 最外层：点集/UV/关键值 |
| 15 | `objectArray` | 29404 | |
| 69 | `AffineEnt` | 18490 | = 所有 BDAffine 的关键帧总数 |
| 66 | `PivotManager` | 10791 | = 网格 6686 + 变形器 4105 |
| 51 / `id:base` | `BaseDataID` | 9651 | |
| 67 | `ParamPivots` | 8697 | ⇒ 每 PivotManager 0..5 个 |
| 60 / `id:param` | `ParamID` | 6966 | |
| 25 | `intArray` | 6686 | = 网格数（每网格一个 `indexArray`） |
| 50 / `id:draw` | `DrawDataID` | 6686 | |
| 70 | `DrawData` | 6686 | |
| 68 | `BDAffine` | 4085 | |
| 133 / `id:parts` | `PartsData` | 3576 / 3576 | |
| 131 | `ParamDefFloat` | 2789 | |
| 136 / 137 | `ModelImpl` / `ParamDefSet` | 335 / 335 | 每文件一个 |
| 65 | `BDBoxGrid` | **20** | 语料里极少 |
| 0（null）/ 33（引用）/ 1（字符串） | | | 存在但不在直方图桶内 |

★**语料比社区样本"干净"**（E）：**没有** 0=null 与 33=引用之外的花样；没有 `intArray2(25)` 与 `objectRef` 之外的变体；
没有 16（另一种 int 数组标签）出现的必要。

### 3.2 字段读序（v10）

> 全部按**文件里的顺序**列出；"先读/后读"标注是有意的（曾经把 BDBoxGrid 的行列读反）。

| 对象 | 字段序 | O 依据 |
|---|---|---|
| `ModelImpl(136)` | `paramDefSet(137)` → `partsDataList(15×133)` → `canvasWidth(i32)` → `canvasHeight(i32)` | raw 153283-153324（`sub_4C8A60` 复合） |
| `ParamDefSet(137)` | `objectArray` | case 137 → `sub_4CA180` |
| `ParamDefFloat(131)` | `min(f32)` → `max(f32)` → `default(f32)` → `paramId(60)` | `sub_4CC800`/raw 154663 区 |
| `PartsData(133)` | **两个位**（同一字节 bit7=`locked`、bit6=`visible`，MSB 优先）→ `id(134)` → `baseDataList(15)` → `drawDataList(15)` | `sub_4C9E20` raw 154439-154458 + `sub_4C8A60` raw 153283-153342 |
| `PivotManager(66)` | **一个对象**（`objectArray(15×67)` = ParamPivots 列表） | `sub_4CA9B0` raw 155011-155019（`_this[1] = sub_4C7220(...)`） |
| `ParamPivots(67)` | `paramId(60)` → `pivotCount(i32)` → `pivotValues(27\|26)` | `sub_4CDE00` raw 157837-157849（`_this[2]`/`_this[1]`/`_this[3]`） |
| `DrawData(70)` | `id(50)` → `targetId(51\|0)` → `pivotManager(66)` → `averageDrawOrder(i32)` → `pivotDrawOrders(内联 i32[])` → `pivotOpacities(内联 f32[])` → *(v≥11: clipId)* → `textureNo(i32)` → `pointCount(i32)` → `polygonCount(i32)` → `indexArray(25)` → `pivotPoints(15×27)` → `uvs(27)` → *(v≥8: optionFlag(i32)，`&1` 时再读 colorGroupNo)* | `sub_4C9E20` raw 154439-154458 + `sub_4C9EF0` raw 154476-154489 |
| `BDAffine(68)` | `id(51)` → `targetId(51)` → `pivotManager(66)` → `affines(15×69)` → *(v≥10: pivotOpacities 内联 f32[])* | `sub_4CCB10` raw 156973-156980 + `sub_4CF010`/`sub_4CF0C0` |
| `BDBoxGrid(65)` | `id(51)` → `targetId(51)` → **`columnCount`(i32，先)** → **`rowCount`(i32，后)** → `pivotManager(66)` → `pivotPoints(15×27)` → *(v≥10: pivotOpacities)* | `sub_4CEDF0` raw 158689-158702 |
| `AffineEnt(69)` | `originX,originY,scaleX,scaleY,rotationDeg`（5×f32）→ *(v≥10)* `reflectX(u8)`、`reflectY(u8)` | 工厂 `sub_4CA280` + E（22 字节/个） |
| `Avatar(142)` | `id` → `drawDataList` → `baseDataList` | `sub_4CC670` |

**`optionFlag`（`DrawData`）位义**（O: 绘制侧；S1 交叉）：`bit0` ⇒ 后随 `colorGroupNo`；
`(flag & 30) >> 1` = 颜色合成类型（0 正常 / 1 加算 / 2 乘算）；`bit5` ⇒ 不剔除。

### 3.3 ★关键帧组合数：`∏ pivotCount`

`DrawData` / `BDAffine` / `BDBoxGrid` **各自**持有一个 `PivotManager`（每对象一个，O: §3.2），
其 `params` 是该对象关心的参数档位表。组合数：

```
n = ∏ (params[i].pivotCount)        // params 为空 ⇒ n = 1
```

**E（335/335 全量实测，`test/live2d-moc.test.ts`）**：下列数组的长度**恒等于** `n`：

| 对象 | 长度 = n 的数组 |
|---|---|
| `DrawData` | `pivotPoints`、`pivotDrawOrders`、`pivotOpacities` |
| `BDAffine` | `affines`、`pivotOpacities` |
| `BDBoxGrid` | `pivotPoints` |

实测 `n` 的分布（网格侧）：`1×2172  2×1802  3×2248  4×179  5×140  6×18  9×70  15×3  21×40  25×1  63×13`；
`pivotCount` 只会是 `{2,3,4,5,21}`，单对象 `params` 最多 5 个（`3^5 = 243` 档，见 BDAffine）。

> 这条恒等式是**解析正确性的强证据**：`params` 一旦解析失败（§2.4 的两个坑），`n` 会退化成 1，
> 而三个数组长度其实是 2/3/4… ⇒ 立刻红。

### 3.4 实测分布（供对照/回归）

- **画布**：非零、有界（≤8192）；每模型参数 `2789/335 ≈ 8.3` 个。
- **`textureNo`**：`0×6256  1×383  2×47`（本作只用到 0–2；`-1` 表示无纹理）。
- **`polygonCount`**：`indexArray.length == polygonCount*3`（E：6686/6686，三角网格）。
- **`uvs.length == pointCount*2`**（E：6686/6686）。
- ★**UV 允许出界**：30 个文件里存在超出 `[0,1]` 的 UV（Cubism 用出界 UV 做**平铺/裁切**）
  ⇒ 断言口径是"**有限且有界**"（允许出界），**不是** `[0,1]`。
- **顶点坐标**：有限、量级在画布像素尺度（`|v| < 1e6` 作为解析错位的兜底判据）。

---

## 4. `.MTN`（动作，文本）—— 格式速记

> 完整语义（fade/队列/推进）见 `live2d.md` §5；这里只记**文本形态**（O: `sub_4BE490` raw 144631 起；E: 330 个文件）。

```
# Live2D Animator Motion Data
$fps=30
$fadein=1000
$fadeout=1000
<PARAM>=v0,v1,v2,…      # 等间隔采样曲线（值序列）
VISIBLE:<部件ID>=0|1
LAYOUT:{X,Y,ANCHOR_X,ANCHOR_Y,SCALE_X,SCALE_Y}=值   # ★动作自带布局：TITLE 的模型摆放就靠它
```

---

## 5. 资产对照与装载口径

| 资产 | 形态 | 实证 |
|---|---|---|
| 模型 | `$n$BM****.MOC`（二进制，§2） | 335 个，全 `version=10` |
| 动作 | 同名 `.MTN`（文本，§4） | 330 个 |
| 纹理 | 同前缀 PNG（`$1$BM900A.MOC` ↔ `$1$BM900A01.PNG`） | 走 `D3DXCreateTextureFromFileInMemory`（`sub_478370` raw 92566-92576）⇒ 必须是 D3DX 认得的图片 |
| **没有** | `.model.json` / `model3.json` / `.exp.json` / `physics.json` | 引擎按脚本逐文件装载（`live2d.md` §3） |

---

## 6. 尾部识别细节（读了才知道的边角）

- `version` 字段在 `"moc"` 之后的**第 4 字节**（上表），**不是** varint；解析器按 `u8` 读。
- `RectD(11)` 是 4×**f64**、`RectF(12)` 是 4×**f32**（别混）；`Matrix2x3(17)` 是 6×f64。
- `PartsData` 的两个位在**同一字节**里，且**先 MSB**（bit7=locked、bit6=visible）——
  这是位游标"每对象重置"的直接后果：一个字节只服务这一个对象。
- `DrawData` 的 `pivotDrawOrders` / `pivotOpacities` 是**内联**数组（跟在 `averageDrawOrder` 后面），
  而 `pivotPoints`/`uvs`/`indexArray` 是**独立对象**（可被 refno 共享）—— 读序混用两种形态是本格式最容易读错的地方。

---

## 7. 未解 / 回链

- **变形求值**（`BDAffine` 的 origin/scale/rotation/reflect 运算顺序、`BDBoxGrid` 的贝塞尔求值、
  `params[0]` 最快变化的组合下标与插值）→ 结论在 `docs-new/99-records/2026-09-live2d/live2d-deform-semantics.md`，叙述在 `live2d.md`。
- **每帧调用序列**（`sub_4783D0` → `sub_4BCB50` → update/draw）→ `live2d.md` §5。
- **`0x346`–`0x351`**（572B 节点 setter / 纹理乘色 / 命名参数 / 队列复位）在本作语料里 **0 次**，
  但登记在 `opcode-table.md` 与 `live2d.md` §3（引擎能力边界，不能当不存在）。
- 数据层：`analysis/functions.json`（L2D 条目族）、`analysis/engine-capabilities.json`（6 条 Live2D 能力）。
