---
kind: narrative
state: live
---
# 03-engine · Live2D 子系统（Cubism 2.0.06 for DirectX）

> 状态：**引擎侧语义已钉死（raw 行号齐）；重写侧（emulator）完全没有建模**。
> 「要不要引入外部库、怎么分阶段做」的评估与决议在 `tickets/T-0054`（本页只写**引擎是什么**）。
> 相关数据层：`analysis/functions.json` 的 L2D 条目族（`report.js --find live2d`）、
> `analysis/engine-capabilities.json` 的 6 条 `subsystem=Live2D` 条目。

---

## 1. 版本与资产口径（先记住这一条）

| 事实 | 证据 |
|---|---|
| 内嵌的是 **Live2D SDK 2.0.06 for DirectX**（Cubism **2.x** 世代，D3D9 后端） | `sub_4BFDA0("Live2D version %s for %s", a2006, aDirectx_0)`（raw 143532）；常量 `a2006="2.0.06"` / `aDirectx_0="DirectX"`（raw 5307-5308）；初始化入口 `Live2D__init` = `sub_4BCDC0`（raw 143517-143541） |
| 模型 = `.MOC`（**二进制**，首 4 字节 `6d 6f 63 0a` = `"moc"`+格式字节；随后是 `0x81` 前缀变长编码） | 335 个 `raw-parts/**/*.MOC` 实测同头（如 `$1$BM900A.MOC`）；解析在 SDK 的 `sub_4BD560`（由 `sub_4BD0A0` 调用，raw 143648-143667） |
| 动作 = `.MTN`（**文本**：`# Live2D Animator Motion Data` / `$fps=30` / `$fadein=1000` / `$fadeout=1000` / `参数名=值,值,…`） | 330 个 `raw-parts/**/*.MTN` 实测同头（如 `$1$BM900A.MTN`）；解析在 `sub_4BE490`（raw 144631 起） |
| 纹理 = 普通图片（PNG），**不是**引擎的 AGF | 引擎走 `D3DXCreateTextureFromFileInMemory`（`sub_478370` raw 92566-92576）⇒ 内容必须是 D3DX 认得的格式；资产与 MOC 同前缀（`$1$BM900A.MOC` ↔ `$1$BM900A01.PNG`） |
| 没有 `.model.json` / `model3.json` / `.exp.json` / `physics.json` | 引擎是「脚本逐文件装载」（见 §3）；二进制里也没有物理/表情/姿势/口型同步的类（§4） |

> ⇒ 任何按 **moc3** 设计的现成 SDK（Cubism 3/4/5）都**吃不了**本作资产；任何按 `.model.json` 组织的包装库都要先自己补一份 manifest。

文件 id 口径（`resource-loading.md` 的统一 id 空间）：脚本里用十六进制文件 id（如 `4f9e` = 某个 MOC、`4f9f` = 它的第 1 张纹理、`5274` = 一个 MTN）。两个全局槽是这套装载的"参数"：

- `global f8c46` = 这次要装的 **MOC 文件 id**；
- `global f8c47` = 这次要装的 **L2D 实例槽号（0..9）**。

`src/SETL2DMOC.txt`（及 `$1$`–`$5$` 变体）就是这张对照表：按 `f8c46` 分支，先 `i341 <moc> (global-int f8c47)`，再若干个 `i345 <纹理> (global-int f8c47) <纹理号>`（`src/SETL2DMOC.txt:6-27`）。

---

## 2. 引擎接线：10 槽 + 76 字节实例 + 572 字节立绘节点

```
Scene+55812 .. Scene+55848   10 个 L2D 实例槽（每个 4 字节指针，空 = 该槽没模型）
  └─ 实例（operator new(0x4C) = 76 字节，sub_478270 raw 92523-92553）
       +0  ALive2DModel*（Live2DModelD3D）
       +4  / +8   两条已载动作（Live2D Motion，动作槽 0 / 1）
       +12 MotionQueueManager（20 字节）
       +16 EyeBlinkMotion（104 字节）
       +20 循环位（本次动作是否循环）
       +21/+22 待播位（动作槽 0 / 1 已装载、等待提交）
       +23 眨眼门控位（★全代码无写入点 ⇒ 永不生效）
       +24/+28 待绑纹理号（标志 + 值）   +25/+32 待绑动作号（标志 + 值）
       +36+4*i  10 张 D3D 纹理指针（i=0..9）

Scene+1096   572 字节「立绘 / 变换节点」表（与 DrawItem / MeshEntry 并列的第三种节点）
       +0  flags（bit0 存在 / bit1 目标变换 pending / bit16 绘制中）
       +4  L2D 槽号（0..9）★ 这张表的绘制完全依赖它
```
（`sub_4A1860` raw 121664-121700、`sub_478270` raw 92523-92553、`sub_4B0360` raw 134277-134406；572B 节点的字段清单见 `opcode-table.md` 的 `0x346`–`0x34D` 行。）

两条容易踩的门：

1. ★**572B 节点只在 `节点+4` 指向的槽真有模型时出画**（`if (LODWORD(v28[LODWORD(v29[1]) + 13953]))`，raw 134320）。
   槽空 ⇒ 节点整块不出画，**无日志无错误**；而 `0x346`–`0x34D` 那族 setter 照样写节点与脏位 ⇒ 症状是"脚本在跑、变换在写，画面什么都没有"。
2. ★**动作推进与出画是同一次调用**（`sub_4B0360` → `sub_4783D0`，raw 92578-92615）：提交待播动作 → `sub_4BCB50` 推进队列并写参数 → model 的 update + draw。
   引擎**没有**独立的 L2D 逐帧 tick ⇒ 只画不推进 = 动作永不动（同样不报错）。

**开关**：`global a9d0` 是"Live2D 关"标志。TITLE / BTL / INFOEN 都先判它：**`== 0` 走 Live2D、`!= 0` 走静态贴图回落**（TITLE 的回落 = `set-texture 5273 5`，即 740×700 的 `SO004A`）。默认值 `INITCONFIG0` 写 0（= 默认开），由 `CONFIG1` 的设置项改写、`LOADCONFIG` 读回。
⇒ 这就是 `resource-loading.md` 里 `SO004A … Live2D（暂不管）` 那一行的真身：**它是 Live2D 关掉时的替身图**。

---

## 3. opcode 面（语料实际用量）

| opcode | 语义 | handler（raw） | 语料用量（`src/*.txt`） |
|---|---|---|---|
| `0x341` | 装 `.MOC`：op1=文件 id、**op2=实例槽** | `sub_427BA0` → `sub_4A1860`（34460） | 6 文件 |
| `0x342` | 销毁实例槽：op1=槽 | `sub_427C70` → `sub_4A1A60`（34496） | 3 文件 |
| `0x345` | 装纹理：op1=文件 id、**op2=槽**、**op3=模型内纹理号** | `sub_427CF0` → `sub_4A1970`（34518） | 6 文件 |
| `0x346` | 节点复位（全部变换 → 单位阵；**轴角那一路的缺省轴 = `(0,0,0)`**，raw 118487-118490） | `sub_427DD0`（34556） | 0 |
| `0x347` | 节点缩放（**三分量**，各 ÷100） | `sub_427E10`（34567） → `sub_4AFE20`（`D3DXMatrixScaling(rec+80)`） | 0 |
| `0x348` | ★**节点轴角旋转**（轴 `+464/+468/+472`、角 `+488` 度）—— **不是缩放** | `sub_427EA0`（34584） → `sub_4AFE90` | 0 |
| `0x349` | 节点平移（像素） | `sub_427F30`（34602） | 2 文件 |
| `0x34A` | 节点基础平移偏移（+8/+12/+16） | `sub_427FB0`（34618） | 0 |
| `0x34B` | 缩放目标矩阵（三分量）+ 窗1：op2/op3 = **int** delay/dur、op4..op6 = **float** 分量 | `sub_428030`（34634） → `sub_4B0030` | 0 |
| `0x34C` | 旋转目标矩阵 + 轴/角（度）+ 窗2 | `sub_4280D0`（34655） | 0 |
| `0x34D` | 平移目标矩阵 + 窗3 | `sub_428170`（34677） | 1 文件 |
| `0x34E` | 装 `.MTN`：op1=文件 id、**op2=动作槽(0/1)**、**op3=实例槽**、**op4=循环位** | `sub_428200` → `sub_4A19F0`（34697） | 3 文件 |
| `0x34F` | 纹理乘色：op1=槽、op2<0 ⇒ 取纹理色记录 | `sub_428400`（34793） | 0 |
| `0x350` | 复位动作队列 | `sub_4282E0`（34736） | 0 |
| `0x351` | 命名参数：op1=槽、op2=参数名串、op3=0..255 → 值/255 | `sub_428320`（34746） | 0 |
| `0x352` | 待绑定值：op1=槽、**op2==0 → 纹理号 / op2!=0 → 动作号**、op3=值 | `sub_4283B0` → `sub_4A1AC0`（34780） | 3 文件 |

用到的脚本只有三处"界面"：**TITLE**（标题立绘，`src/TITLE.txt:533-554`）、**INFOEN**（角色资料页，`src/INFOEN.txt:1589-1606`）、**BTL**（战斗立绘，`src/BTL.txt:1635-1637, 2669-2671`），加上 `SETL2DMOC` 家族（MOC↔纹理对照表，被上述三处间接 `call-script`：它们把脚本指针放在数组 `global 708ab6` 里按下标调用，如 `src/TITLE.txt:544-548`）。

`0x346`–`0x351` 在语料里几乎不用，但**必须登记为能力面**——它们是「引擎能做什么」的边界（参数/纹理色/队列复位），写重实现时不能把它们当不存在。

**逐条核体后的三条口径**（`tickets/T-0160`）：

- **`0x346` 的"复位"包含轴角那一路**：`sub_49CA10`（raw 118487-118490）把 `+464/+468/+472` 三个分量写成 `0.0`
  ⇒ 缺省轴是 **`(0,0,0)`**（不是 `(0,0,1)`）；设过轴角的节点在 `0x346` 之后也回到 `(0,0,0)`。
- **`0x34F`（纹理乘色）在本工程里走的是宿主缝 `getDrawItemColor`**（与 `0x203` 同一条，见 `src/vm/native.ts` 的注释）：
  `op2 < 0` ⇒ 回退成"该项当前值"（`sub_4ADD60`，raw 34808 ⇒ 负值按 `(unsigned)−1` 处理）；`op2 ≥ 0` ⇒ 直接写乘色。
- **`0x352` 不建槽**：它只把 `op3` 分别落进 `motion+4`（纹理号）/`motion+8`（动作号）并清标志，
  等**下一次 `0x34E`** 绑定时经 `sub_478540`/`sub_478560` 消费；`sub_4A1AC0`（raw 34780）只置位，不 `ensureSlot`。

---

## 4. 运行时能力清单（SDK 里有什么、本作用了什么）

**有（对应类名可在 `engine/…_utf8.c` 的 weak vftable 常量里查到，raw 5295-5430）**：

| 能力 | 类 | 引擎是否用到 |
|---|---|---|
| 模型装载/绘制 | `ALive2DModel` / `Live2DModelD3D` / `ModelContext` / `ModelImpl` / `DrawParam_D3D` | ✅ 核心 |
| 部件/绘制数据/基数据/参数定义/枢轴 | `PartsData` / `DrawData*` / `BaseData*` / `ParamDefFloat` / `ParamDefSet` / `PivotManager` / `ParamPivots` | ✅（由 `sub_4BD560` 内部使用） |
| 变形（仿射 + 方格变形） | `AffineEnt` / `BDAffine` / `BDAffineContext` / `BDBoxGrid` / `LDAffineTransform` | ✅（绘制时内部使用） |
| SDK 内存持有 | `MemoryHolderFixed` / `MemoryHolderTmp` / `MemoryHolderSocket` / `MemoryParam` / `MHPageHeader*` | ✅（SDK 内部） |
| 动作（含 fade in/out、循环、队列） | `Live2DMotion` / `Motion` / `AMotion` / `MotionQueueManager` / `MotionQueueEnt` | ✅ 用（两条动作槽 + 队列） |
| 自动眨眼 | `EyeBlinkMotion`（写 `PARAM_EYE_L_OPEN` / `PARAM_EYE_R_OPEN`） | ❌ **实际不生效**（见下） |
| 命名参数 | `setParamFloat`（`sub_4BD4D0`） | ⚠️ 通道在（`0x351`），语料 0 次 |
| 纹理乘色 | `sub_4BD150` → `DrawParam_D3D` | ⚠️ 通道在（`0x34F`），语料 0 次 |

**没有（二进制里不存在该类/字符串）**：

- 物理（`Physics` 类 0 命中）——Cubism 2 的物理是可选源码，本作没编进去；
- 表情（`Expression` / `.exp.json`）、姿势（`Pose`）、口型同步（`LipSync`）——同样 0 命中；
- 任何 Cubism 3+ 的东西（moc3 / model3.json / motion3.json / `live2dcubismcore`）。

★**眨眼是"有类无触发"**：`EyeBlinkMotion` 实例在建模实例时就构造（raw 92542），但唯一调用点 `sub_4B0360`/`sub_4783D0` 的 `if (实例+23) sub_4BC550(...)`（raw 92605）里，**实例+23 全代码没有写入点**（ctor 只把 +20..+24 清 0）⇒ 该分支永不进入。静态结论（E1），真机对照未做。

---

## 5. 装载 → 绑定 → 推进 → 绘制（一次节点绘制的完整链）

```
装载（脚本指令驱动）
  0x341 ─▶ sub_4A1860(Scene, 资源表, 文件id, hFile, 字节数, 槽)
             ├ 槽非空 ⇒ sub_4785E0 析构旧实例 + delete（惰性重建）
             ├ GlobalAlloc+ReadFile 读文件字节（失败 return 0，无日志）
             ├ operator new(0x4C) + sub_478270 建实例（首调触发 Live2D__init）
             └ sub_478330 装模型：sub_4BD0A0(bytes,len) → 实例+0；把设备写进 model 的 ModelContext+144
        （失败 ⇒ 0x341 handler 抛 "L2Dモデルファイル %s の読み込みに失敗しました"，raw 34488）
  0x345 ─▶ sub_4A1970 ─▶ sub_478370：D3DXCreateTextureFromFileInMemory → 实例+36+4*纹理号 → sub_4BD070(model, 号, tex)
  0x34E ─▶ sub_4A19F0 ─▶ sub_478640：sub_4BE490 解析 .MTN → 动作槽 +4/+8
             ├ ★门 `if (!*_this) return 0`（raw 92817；`_this` = `Scene[13953+实例槽]`）⇒ **实例槽里还没
             │  模型**时直接 0 ⇒ sub_4A19F0 返回 0 ⇒ handler 落到**读文件失败那条同一个抛点**
             │  （raw 34722-34731）⇒ 「装 .MTN 之前实例槽先得有模型」是硬前提
             │  （`src/TITLE.txt:554` 的 `i34e` 就依赖 `SETL2DMOC` 先在 `src/TITLE.txt:533-547` 把
             │   `TITLE.MOC` 装进槽 0；`tickets/T-0176` 是这条前提在测试侧的落地记录）
             ├ 绑定 0x352 预置的纹理号/动作号（写进 motion+4/+8 后清标志）
             ├ sub_4BCA20(queue, motion, 1) ★装载即入队
             └ sub_4784D0(循环位 op4)：实例+20 与 motion+36
  0x352 ─▶ sub_4A1AC0 ─▶ sub_478540（待纹理号）/ sub_478560（待动作号）：只置位，等下一次 0x34E 绑
  0x342 ─▶ sub_4A1A60：析构 + delete + 槽置 0

绘制（每帧，走四路归并的 572B 节点这一路）
  sub_4B0360(节点)
    ├ 门控：节点+0 bit0 且 节点+4 指向的实例非空（否则整块跳过）
    ├ 正交矩阵（设备宽高）+ 平移（用模型画布宽/高 = ModelContext+12/+16 摆锚点）
    ├ 叠乘手工矩阵（节点+10610 存在时）/ 缩放 / 旋转 / 平移 目标矩阵
    └ sub_4783D0(实例, 设备)
         ├ +21/+22 待播位 ⇒ sub_4BCA20 提交（+20 循环位则重播）
         ├ sub_4BCB50(queue, model)：推进时间轴 → 写参数（fade in/out 混算）★"动作在动"的唯一来源
         ├ +23 ⇒ 眨眼（本作永不生效）
         └ model vtable +8 / +12（update / draw）
    └ sub_4A1D50(Scene)：恢复 D3D 渲染态
```

补充：`0x34B/0x34C/0x34D` 那族 setter 只写节点里的"目标矩阵 + 窗(delay/dur)"并置 `Scene+46516` pending；真正的矩阵叠乘发生在 `sub_4B0360` 里（raw 134378-134387）。

★**节点矩阵合成器的机制与全部逐字段/常量口径**（`0x347`–`0x34D` 七条、`sub_4A07F0` 的真身体区间
`121131-121655`、D3DX **行向量** vs 本工程 `Affine` **列向量**的转置、`T(−p)·M_base·M_scale·M_rot·M_trans·T(+p)`
的左右序判据、`pivot` 不是不动点、`dbl_51FB50 = 1000.0` / `0xFFFFFFFF` 立即数 / 轴归一化 / `+24 == 0` 哨兵
这四条实测口径、emulator 侧实现与守卫）**全部在台账 `engine-capabilities.json#live2d-node-matrix-compose`**
（其 `narrative` 指回本文件）—— 本文件不再重复。

**本文件只保留整体机制**：4 个窗（缩放/旋转/平移/颜色）在**每帧绘制的那一次调用**里求值并组合成节点矩阵
（`Scene+46536`），再由 `sub_4B0360` 右乘进世界矩阵；组合链对 z≡0 的模型点等价于
`q = (q0 − p)·A + p + t`（行向量序，`T(t)` 在 `T(+p)` 之前作用）。

**emulator 侧的实现/守卫与四条实测口径**（`src/live2d/nodeMatrix.ts` + `scL2dTick` + `render.ts` 的
`l2dNodeTransform → Affine → affineApply`、`wins.latched` 专有位、`dbl_51FB50 = 1000.0`、
`0xFFFFFFFF` 立即数、轴归一化、`+24 == 0` 不能当哨兵）同样见该台账条目，本文件不重复。

### 5.1 顶点流与摆放（出画几何的最后一公里）

出画几何（**逐行确证**，实现落在 `app/amayui-emulator/src/live2d/render.ts`）：

| 事实 | 内容 | 证据 |
|---|---|---|
| 投影 | `D3DXMatrixOrthoLH(proj, 显示宽, **−显示高**, −1.0, 1.0)` | raw 134354（`flt_52CAC4 = -1.0`） |
| 视图 | 单位阵（每帧重建，raw 134356-134372） | raw 134372 |
| 世界 | `T(−0.5·画布宽, 0.5·显示高 − 0.5·画布高, 0)`，再叠 3 个手工矩阵（`Scene+42440` 门）与节点矩阵 | raw 134374-134387 |
| ★净效果 | **画布中心对齐屏幕中心**：`screen = model + ((viewW−canvasW)/2, (viewH−canvasH)/2)`；**画布尺寸只进平移、不进缩放**（投影用的是显示尺寸） | 上式化简 |
| 画布尺寸来源 | `ModelImpl+12/+16 ← sub_4C6080` 从 `.moc` 读的 `canvasWidth/Height`（**不是** `.MTN` 的 `LAYOUT:`） | raw 151211-151215；`sub_478490/4784B0` raw 92624/92636 |
| 坐标朝向 | 模型空间 **y 向下**、原点在画布左上（`sy = (1−ndc_y)·H/2` 与 `h = −H` 相消） | raw 134354 + 视口公式 |
| 位置流 | 每顶点 **12 字节** `{x, y, alpha}`（工作元组 5 float `{x,y,alpha,u,v}` 只拷前 3 个） | raw 148038-148053；raw 152917-152979 |
| UV 流 | 每顶点 8 字节，**直接从 `.moc` 的 `+60 uvs` 原样 memcpy**（不做任何翻转） | raw 153065-153069（`SetStreamSource(1, …, stride 8)` raw 148062） |
| 索引 | **三角形列表**（`D3DPT_TRIANGLELIST`），`6×polygonCount` 字节 | raw 153076-153087；raw 148068 |
| 纹理 | 按 DrawData 的 `textureNo` 取（`sub_4C85A0` 用它做"纹理是否已绑定"的门控） | raw 153010-153017 |
| ★提交粒度 | **一个 DrawData 一次** `DrawIndexedPrimitive`；该网格的 **opacity 写满它的每个顶点**（位置流第 3 个 float）⇒ 按网格切批时"每批一个 alpha"是**精确**的；按纹理号并批会把 `opacity = 0` 的网格的透明性扩散给整批 | 提交 raw 148068；alpha raw 153207 |
| 混合/剔除 | `+64` 选 blend、`optionFlag & 32` ⇒ `D3DRS_CULLMODE = NONE` | raw 147934-147975 / 147824-147828 |
| ★节点的 `+508` 4×4 | `sub_49CA10` 初始化成**单位阵**，只有 `0x346`-`0x34D` 会改它。**TITLE 只用 `0x344`** ⇒ 那条路径的节点矩阵恒为单位阵（= 零回归的判据）；但 `0x349`/`0x34D` 在 BTL/INFOEN 有真语料 ⇒ 合成器（`T-0096`，见 §5）**不是**可以省掉的一步 | raw 118508-118511（`+508/+528/+548/+568 = 1.0`）；raw 134385（`Scene+46532` "有节点矩阵"位）；语料 `INFOEN.txt:1593/1596`、`BTL.txt` 多处 |
| `.MTN` 的 `LAYOUT:` | 语料 237 个动作里 236 个是缺省 `X=1024 / Y=512 / SCALE=1`（= 2048×1024 参考画布正中）；5 个 `Y=1024` 会下移半个参考高 | `raw-parts/**/*.MTN` 直方图；`LAYOUT:` 解析 raw 144942-144979 |

> ★**"`LAYOUT:` 当前按不影响摆放处理"这一条只对语料成立**（TITLE 用缺省值 `X=1024/Y=512/SCALE=1`）；
> 参考画布口径未逐行确证 ⇒ 见 §6 的未读项。

---

## 6. 未读 / 未解（本页的边界）

- `.MOC` 二进制解析细节（`sub_4BD560` 及 0x4C5xxx 一带的 `BReader`/`ISerializableV2` 读法）——只读到"入口 + 失败语义"；
- `.MTN` 解析细节（`sub_4BE490`）：只确证了文本头与"参数曲线"这一层；
- **逐像素**语义（`DrawParam_D3D` 的像素着色器、`DDTexture` 采样/寻址模式）——**没有读**；
  §5.1 读的是**顶点/UV/索引生成与摆放**这一层（顶点的最终几何到此已经闭合）；
- `.MTN` 的 `LAYOUT:` **参考画布口径**（1024/512 是 2048×1024 的中点，这一步是推断；
  5 个 `Y=1024` 的例外动作在真机上到底怎么偏，未对照）；
- 572B 节点的**帧首 alpha 分支**（`+64`/`+124`，raw 121266-121288）需要模型对象 vtable（`sub_499B60`/`sub_499A70`）⇒ 未建模（本作语料无写者；单位 = alpha×1000，见 §5）；
- 合成结果的 `alpha` **当前没有消费端**（`render.ts` 的批次 opacity 来自模型自己的 `pivotOpacities`）；
- `+504 bit0` 的语义（只确证它对 `0x342`-`0x352` 族**恒 0**：唯一写者 `sub_4AD9A0` 写的是 `+1080` 族；★且该 alpha 强制 0 的门在**窗块内部**，raw 121290 ⇒ 没有窗在跑时根本走不到）；
- `+20`/`+44`/`+500` 的含义；`M[11625]`（毫秒时钟）**无写点**（"毫秒"是从窗时长推断）；
- 轴反向（`axisFrom ∥ axisTo`）时 `len == 0`：emulator 取单位阵（D3DX 那头是 0 除、无定义）；
- `wins.latched` 是**emulator 专有位**（引擎用 `+24 == 0` 当哨兵，与合法时钟值 0 冲突，见 §5）；
- 颜色窗（`+68..75`）在本作**无设置端指令**且输出被唯一调用方丢弃（raw 134347 立刻把颜色出参改写成槽下标）⇒ 只实现**记录副作用**（`colorFrom←colorTo`、`delay=dur=0`），不设验收（`T-0096` 的"记录被忽略的情况"裁定）；
- `AvatarPartsItem`（SDK 里的另一个类，raw 5429）在本作是否可达，未查；
- E4（真机/真界面截图对照）未做。

> 参考语料规模：Live2D SDK 段在反编译里是 `0x4BC120`–`0x4C5FC0`、**273 个函数体（≈40 KB 代码）**。若走"自研移值"路线，这就是要读/要译的参考面（我们实际只需要其中一小块：moc 解析 + 变形 + 纹理 + .mtn + 队列 fade）。

---

## 7. 重写侧：要不要引外部库（只留结论，评估正文在别处）

> ★**评估正文（四条判定标准 / 三条路线比对 / 许可与 headless 取舍 / 工作量 / 分阶段计划）在
> `docs-new/04-app/live2d-support-assessment.md`** —— 本页只写"引擎是什么"，不重复重写侧的论证。

一句话结论：**Cubism 5 不可行**（只吃 `.moc3`，要先把 335 个 `.moc` 人工转格式）；
**Cubism 2.1 的 `live2d.min.js` 可做一次性对照**但不宜进主干（专有运行时再分发 + headless 不可用）；
**推荐自研移值**（直接吃 `.MOC/.MTN/PNG`、无新依赖、可 headless、与既有场景层同构，且反编译里就有 2.0.06 的完整参考）。

> **【已拍板 2026-09-16】按自研（C）实施**；参考源纪律 = **规范优先**（`.mtn`/ID/变形器语义查官方文档）/ **资产实证兜底**（`.moc` 字节布局**没有公开规范** ⇒ 用 335 个样本逼出不变量）/ **反汇编只当 oracle**（不逐行搬运 SDK 结构）。详见评估文档 §3.5。

---

## 8. 相关

- `docs-new/04-app/live2d-support-assessment.md`：**重写侧评估正文**（依赖路线 / 工作量 / 计划 / 待拍板）；
- `resource-loading.md`：统一文件 id、`SO004A` = Live2D 关时的静态替身图；
- `rendering.md`：四路归并（DrawItem / MeshEntry / 572B 节点 / …）的层序口径；
- `opcode-table.md` 的 `0x341`–`0x352` 行（`0x345` = "L2D 纹理装载"；`0x34F`/`0x350`/`0x351` = 纹理乘色 / 复位动作队列 / 命名参数，均已核对）；
- `stub-reaudit-2026-09.md` §3（历史快照，把 Live2D 归为"排除项"）—— 本页与 `tickets/T-0054`：Live2D **要做**；
- 数据层：`analysis/functions.json`（L2D 条目族）、`analysis/engine-capabilities.json`（`live2d-slot-probe` / `lazy-live2d-slot` / `live2d-enabled-config-flag` / `l2d-node-draw-gate` / `live2d-node-draw-advance`）。
