---
kind: narrative
state: live
---
# 04-app · Live2D 支持评估（系统能力 / 依赖路线 / 落地计划）

> **这是什么**：把《天結》的 Live2D 立绘（标题画面 / 角色资料页 / 战斗立绘三处）在 `amayui-emulator` 里做出来**之前**的评估结论。
> 回答三个问题：① 引擎侧这套 Live2D 是什么、要 SDK 的哪一块；② ★**要不要引入额外的依赖库**；③ 怎么分阶段落地、每阶段判据是什么。
>
> **归属与边界**（避免两处漂移）：
>
> | 内容 | 唯一落点 |
> |---|---|
> | **引擎语义**（版本/资产/接线/opcode 面/装载→推进→绘制链/未读边界） | `docs-new/03-engine/live2d.md` |
> | **重写侧评估与决策**（依赖路线、许可、工作量、计划、待拍板） | **本页** |
> | **工作与判据**（状态、acceptance、证据锚点、守卫） | `tickets/T-0054`（ticket.json） |
> | **数据层事实** | `analysis/functions.json`（L2D 条目族）/ `analysis/engine-capabilities.json`（5 条 Live2D） |
>
> 评估日期：2026-09（本次）；评估依据：`engine/天结_unpacked.exe_utf8.c` 实读 + 脚本语料统计 + 外部 SDK 公开信息（§3.2 的外链）。

---

## 1. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| 引擎用的是哪个 Live2D？ | **Live2D SDK 2.0.06 for DirectX**（`Live2D version %s for %s` raw 143532；常量 `a2006="2.0.06"` / `aDirectx_0="DirectX"` raw 5307-5308）⇒ **Cubism 2.x 世代**，不是 moc3 那一代 |
| 资产形态？ | `.MOC`（二进制，magic `moc`）/ `.MTN`（**文本** Animator 格式）/ 纹理 **PNG**（`D3DXCreateTextureFromFileInMemory` 直读）；**没有 `.model.json`**，引擎靠脚本逐文件装载 |
| 要 SDK 的哪一块？ | 模型解析 + 部件变形 + 纹理 + 动作（队列 + fade in/out + 循环）+ 命名参数/纹理乘色**通道**（通道在、语料 0 用）。**不需要**物理 / 表情 / 姿势 / 口型（二进制里没有这些类），**不需要**眨眼（有类但触发位是死位，raw 92605 无写入点） |
| ★「支持 Live2D」要不要引额外的库？ | **不引也能做，而且推荐不引**（路线 C 自研移值）；**引 Cubism 5 没用**（只吃 moc3）；Cubism 2.1 的 web 运行时（`live2d.min.js`）能省事但有两个硬伤（专有运行时的再分发许可、headless 无 WebGL 不可用） |
| 资产侧有障碍吗？ | **零障碍**：MOC/MTN/PNG 都在游戏资源里（335 个 `.MOC` / 330 个 `.MTN`），不需要任何格式转换，也不需要造 `.model.json`（照抄引擎的装载链即可） |
| ★路线决策 | **2026-09-16 用户拍板：按 C（自研移值）实施**；`live2d.min.js` 不再作为候选（最多保留"必要时做一次性像素对照 spike"的可能，见 §3.4） |
| ★参考源纪律 | **规范优先 → 资产实证兜底 → 反汇编只当 oracle**：`.moc` 的**字节布局没有公开规范**，能查到公开规范的只有语义层与 `.mtn`/ID/参数（见 §3.5） |

---

## 2. 引擎侧口径速查（细节 → `docs-new/03-engine/live2d.md`）

- **10 个实例槽** `Scene+55812..55848`；每槽一个 **76 字节实例**（+0 模型 / +4,+8 两条动作 / +12 动作队列 / +16 眨眼 / +36..+76 十张纹理）；
- **572 字节「立绘 / 变换节点」**（`Scene+1096`）承载位置/缩放/旋转/颜色与 4 组窗口，绘制方 `sub_4B0360` **只在节点 +4 指向的槽真有模型时出画**（raw 134320）⇒ 缺 L2D 时症状是「脚本在跑、变换在写、画面什么都没有、不报错」；
- **动作推进与出画是同一次调用**（`sub_4B0360` → `sub_4783D0` → `sub_4BCB50`，raw 92603）—— 引擎**没有**独立逐帧 tick；
- **开关** `global a9d0`：TITLE / BTL / INFOEN 都先判它，`== 0` 走 Live2D、`!= 0` 走静态贴图回落（TITLE 回落 = `set-texture 5273 5` = 740×700 的 `SO004A`）；`INITCONFIG0` 默认 0 = **默认开**；
- 语料真正用到的指令只有 **7 条**：`0x341`（装 MOC，op2=槽）/ `0x342`（销毁槽）/ `0x345`（装纹理，op2=槽、op3=纹理号）/ `0x349`（平移）/ `0x34D`（平移目标+窗）/ `0x34E`（装 MTN，op2=动作槽、op3=槽、op4=循环）/ `0x352`（预置待绑定的纹理号/动作号）；
- 三处用例：**TITLE**（标题立绘，`src/TITLE.txt:533-554`）、**INFOEN**（角色资料页，`src/INFOEN.txt:1589-1606`）、**BTL**（战斗立绘，`src/BTL.txt:1635-1637`、`2669-2671`），都由 `SETL2DMOC` 家族（MOC↔纹理对照表）间接装载；
- emulator 现状：`0x341/0x345/0x34E` = `stubSubsystem`、`0x346`–`0x34D` = `op_engine_internal`（no-op）；`stub-reaudit-2026-09.md` §3 当时把 Live2D 归为「排除项」，**本评估改判为「要做」**。

---

## 3. ★依赖评估：要不要引入额外的库

### 3.1 判定用的四条硬约束（这个工程特有的）

1. **能不能吃 `.MOC / .MTN / PNG`** —— 吃不了就得先把 335 个模型转格式（人工、有损），直接排除；
2. **能不能在 headless（无 WebGL）下参与验证** —— 本工程的 E3 是 headless 的帧 digest / 快照断言（既有做法见 `docs-new/04-app/emulator-frame-loop-design.md` 一系），"只能靠 Electron 截图"会把验证面砍掉一大半；
3. **与现栈的耦合** —— 现役后端是 **PixiJS v8（WebGL）**、场景层是 `renderer/scene/*` + `pixiBackend`（DrawItem / MeshEntry / 纹理槽 + 帧 digest）；外部运行时若自带渲染上下文就得绕一圈；
4. **许可与可再分发** —— 汉化补丁是发给玩家的产物，引进来的东西必须能随补丁分发。

### 3.2 三条路线

| 路线 | 能吃本作资产？ | headless | 与 PixiJS v8 | 许可 | 成本 | 结论 |
|---|---|---|---|---|---|---|
| **A. 官方 Cubism SDK for Web（Cubism 5）** | ❌ 只认 `.moc3` / `model3.json` / `motion3.json`（[官方手册](https://docs.live2d.com/cubism-sdk-manual/model-web/)） | ✅（Core 是 WASM） | 需自建渲染 | 官方许可 + Core 属专有 | 还要先把 335 个 `.moc` 用 Cubism Editor 逐个转 moc3（GUI、人工、原始工程已不可得） | ❌ **不可行** |
| **B. Cubism 2.1 web 运行时 `live2d.min.js` + MIT 包装** | ✅ `.moc/.mtn` 原生支持，但按 `.model.json` 组织 ⇒ 要么自造 manifest，要么直接用低层 API（`Live2DModelWebGL.loadModel` / `Live2DMotion.loadMotion` / `model.draw`） | ❌ 它自己开 WebGL 上下文 + 自带渲染（headless 无 GL 就跑不了） | ⚠️ 与 Pixi v8：`untitled-pixi-live2d-engine` 有 v8 的 `cubism-legacy` 入口（MIT 包装）；`pixi-live2d-display` 是 Pixi v6，版本不匹配 | ⚠️ **`live2d.min.js` 是专有 minified 运行时**（[Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)）；官方**2019-09-04 停止分发**（[help](https://help.live2d.com/en/other/other_20/)），现存途径是第三方镜像（[dylanNew/live2d](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib) / jsDelivr） | 低（把运行时喂进去即可） | ⚠️ **可做一次性对照 spike，不宜进主干** |
| **C. 自研移值：把反编译里的 2.0.06 移成 TS，渲染走 Pixi 变形网格** | ✅ 直接吃 `.MOC/.MTN/PNG`（不需要 `.model.json`，照抄引擎的装载链） | ✅（纯 TS + 场景层，天然可快照/digest） | ✅ 与既有 mesh/场景层同构（`0x320 create-mesh` 那条 Pixi 路径已存在） | ✅ 无新依赖、无第三方运行时再分发问题 | 高：参考语料 = 反编译 `0x4BC120`–`0x4C5FC0` 的 **273 个函数体 ≈ 40 KB 代码**（实际只需其中一小块，见 §4） | ✅ **推荐主线** |

### 3.3 推荐：**C 为主线**（B 只作一次性对照）

三条理由：

1. **验证方式决定的**：E3 是 headless 的 digest/快照断言。路线 B 自带 GL 上下文 ⇒ 保守只能"在 Electron 里截个图"，等于把 L2D 排除在自动化守门外；路线 C 能与现有场景层共用同一套 headless 快照。
2. **许可决定的**：把专有运行时塞进补丁这件事不该成为本工程的隐式决定；路线 C 没有这个问题。
3. **我们持有别人没有的东西**：完整的 SDK 2.0.06 反编译就在 `engine/…_utf8.c` 里（连同 vftable、类名、错误串），所以"自研"对我们是**移值**而不是**猜格式**——这是本路线相对一般重写项目的决定性优势。而且真正要用到的面很窄（物理/表情/姿势/眨眼都不需要）。

> **【已拍板 2026-09-16】** 用户决定**按 C 实施**。本节的 A/B 结论保留，作为决策依据与"将来若要做一次像素对照"的备查（B 的约束见 §3.4）。

### 3.4 如果仍要走 B（spike 或长期方案）的具体约束

- **不进主干**：单独分支/单独脚本，产物不进 `app/amayui-emulator` 主链，不进 E3 守卫；
- **许可**：先对"`live2d.min.js` 随补丁再分发"做判定（§6 待拍板第 1 条），判定结论要落到本页；
- **接法二选一**：
  - (a) 自造 `.model.json`（把 `0x341/0x345/0x34E` 的文件 id 翻译成 moc/纹理/动作列表）+ 用包装库：改动最小，但要在资源层与包装库的 loader 之间搭桥；
  - (b) 直接用运行时的低层 API（`Live2DModelWebGL.loadModel` / `Live2DMotion.loadMotion` / `model.draw`）自己驱动：与我们的装载链更贴合，但要自己管 GL 上下文与纹理上传；
- **headless**：无论 (a)/(b)，headless 下都不可用 ⇒ 必须另想办法（或明确"L2D 不参与 E3，只做 E4 截图对照"，并在能力台账的 `emulator.note` 里写明）。

---

### 3.5 ★参考源纪律：规范优先 / 资产实证兜底 / 反汇编只当 oracle
> 起因（用户提问，2026-09-16）：Live2D 有技术规范，自研时是不是应该**照规范实现**，而不是看反汇编（反汇编说到底也只是官方 SDK）？
> 结论：**分两层看，两层的最优来源不同** ——

#### 3.5.1 公开可得的东西（→ 规范优先）

| 层面 | 公开来源 | 我们要不要用 |
|---|---|---|
| 变形器 / 关键帧 / 插值的**语义**（旋转变形器 = `BDAffine`、曲面变形器 = `BDBoxGrid`、参数按关键帧线性/双线性/三线性插值、最多 3 个参数控制同一部件） | Live2D 官方 Editor 手册（[Deformer](https://docs.live2d.com/en/cubism-editor-manual/deformer/)、[Parameter](https://docs.live2d.com/en/cubism-editor-manual/parameter/)、[Keyform](https://docs.live2d.com/en/cubism-editor-manual/keyform-parent-chilid-relation/) 等）+ 社区解析综述（[Cubism 2.0/2.1 MOC 文件解析](https://arkueid.github.io/blog/Cubism-2-0-MOC-%E6%96%87%E4%BB%B6%E8%A7%A3%E6%9E%90/)） | ✅ **以此为准**（它定义"这套数据是什么意思"） |
| **ID 规格**（`PARAM_*` / `PARTS_*` / `D_*` / `B_*` 命名与转换规则） | 官方 [Handling of Cubism 2.1 data](https://docs.live2d.com/en/cubism-editor-manual/cubism2-handling-of-data/)（含 2.1 → 3 的 ID 转换表） | ✅ 引用（用于校验我们读出的字符串） |
| **`.mtn` 动作文件**（`# Live2D Animator Motion Data` / `$fps` / `$fadein` / `$fadeout` / `参数名=值,…`） | 文件**自述**（文本格式，可读性即规范）+ 官方 [About Fading](https://docs.live2d.com/en/cubism-editor-manual/about-fade/) 的 fade 语义 | ✅ **按文件自述解析**，不需要 oracle |
| 渲染（怎么把顶点画到屏幕） | 无规范（是 D3D9 时代的实现细节） | ❌ 不照抄：我们按 PixiJS v8 自己的渲染路径实现（只要视觉一致） |
| **`.moc` / `.cmox` 的字节布局** | **没有公开规范**：官方文档只讲"用 Editor 打开/导出"（[上面那页](https://docs.live2d.com/en/cubism-editor-manual/cubism2-handling-of-data/)）；社区文章给的是**语义结构**（Parts/Components/Deformers/Params），字节读法他们也是引用现成解析器（[FreeLive](https://github.com/NiaBie/FreeLive)、[live2d-py（`live2d.min.js` 的 Python 翻译）](https://github.com/EasyLive2D/live2d-v2)） | ⚠️ **没有规范可照** ⇒ 见 3.5.2 |

#### 3.5.2 `.moc` 没有规范，那用什么？（→ 实证优先，反汇编作 oracle）

1. **资产实证优先**：本作自带 **335 个 `.MOC`**，这是任何"猜格式"都换不来的样本量。我们自己的探查（2026-09-16）：
   全部 335 个文件 magic = `moc\n` 且第 4–7 字节**完全一致**（`81 08 81 09`）、`0x81` 前缀变长编码、长度前缀字符串（如 `PARAM_BODY`）、文件大小 349 B – 227 KB（中位 ≈ 31 KB）。
   ⇒ 可以用"**跨全量样本的不变量**"（节数/计数/偏移自洽、UV 落在 [0,1]、索引不越界、画布尺寸有限）把格式**逼出来**，而不是靠单点猜测。
2. **反汇编作 oracle**：`engine/…_utf8.c` 里就是**官方 SDK 2.0.06**（静态链接进 exe）——它确实是官方代码，但它是**参考实现**而不是规范。
   只在实证卡住的地方问它（如"这个 varint 的编码规则""字段顺序""fade 的数学式"），**不逐行搬运**：不照抄 SDK 的类划分/标识符/控制流，实现用我们自己的模块划分与命名，任何可疑处都用资产实证或社区实现交叉验证。
3. **社区实现只作交叉验证**：FreeLive / live2d-py / 各类博客可以用来"对答案"（它们的字节读法也多半来自官方运行时），但不作为唯一依据 —— 它们在版本与边界行为上未必等于 2.0.06。
4. **每条格式事实都要标来源**：M1 产出 `docs-new/03-engine/live2d-moc-format.md`（我们自己的格式页），每条写清 `官方规范 / 资产实证 / 反汇编 oracle / 社区交叉验证` 四种来源中的哪一种；来源不明的标"待证"。
5. **验证不依赖来源**：跨全量资产的解析不变量测试 + 真机截图对照（E4）。就算某一处是从反汇编学来的，只要测试与真机对上，它的正确性就是独立的。

> 一句话：**"照规范实现"在能查到规范的地方是正确姿势**（语义、ID、`.mtn`、概念），**但 `.moc` 的字节布局没有规范可照** ——
> 那里规范不存在，正确的替代品不是"随便看个解析器"，而是**我们自己的实证 + 全量样本不变量**，把反汇编降级为 oracle。

---

## 4. 工作量与参考面

| 项 | 估计 |
|---|---|
| 参考语料（SDK 段） | 反编译 `0x4BC120`–`0x4C5FC0`，**273 个函数体 ≈ 40 KB 代码** |
| 真正要移值的子集 | ① `.MOC` 解析（`BReader` / `ISerializableV2` / `ModelContext` / `PartsData` / `DrawData*` / `BaseData*` / `ParamDef*` / `PivotManager`）；② 变形（`AffineEnt` / `BDAffine` / `BDBoxGrid`）；③ 纹理绑定（10 槽索引 → 纹理表）；④ `.MTN` 文本解析 + 队列 fade/循环（`Live2DMotion` / `MotionQueueManager`）；⑤ 绘制（顶点生成 → 走 Pixi 变形网格） |
| 不用移的 | 物理 / 表情 / 姿势 / 口型 / 眨眼（后者虽然是 SDK 类，但本作触发位是死位）；`0x34F`/`0x350`/`0x351` 的通道可最后做 |
| 与现有实现复用的 | 场景层（`renderer/scene/*`）、纹理路径、Pixi mesh（`0x320 create-mesh`）；**不需要**新依赖、**不需要**新资源格式 |
| 知识来源与产出 | 按 §3.5 纪律：`.mtn`/ID/语义 → 官方文档；`.moc` 字节布局 → **资产实证（335 个样本）** + 反汇编 oracle；产出**我们自己的**格式页 `docs-new/03-engine/live2d-moc-format.md`（每条标来源）——**不逐行搬运 SDK 的代码结构** |

> ⚠️ 上述"要移值的子集"是按调用面推断的**范围估计**，不是已核实的清单：moc 解析与变形的内部（`sub_4BD560` 及 0x4C5xxx 一带）**尚未读**（见 §7）。

---

## 5. 分阶段计划与判据

| 阶段 | 目标 | 判据（详见 `tickets/T-0054` 的 acceptance） |
|---|---|---|
| **M0（已完成）** | 评估 + 落台账 + 落文档 | 本页 + `docs-new/03-engine/live2d.md` + `tickets/T-0054`；functions.json 33 条 L2D 条目；capabilities 5 条 Live2D（3 条新增 E1） |
| **M1 静态姿态** | ① 格式实证 → 产出 `docs-new/03-engine/live2d-moc-format.md`（每条标来源，§3.5.2 第 4 条）；② raw 直读 + `.MOC` 解析 + 变形 + 纹理 + 572B 节点变换 → 标题立绘出画 | acceptance #1/#2；**全量 335 个 `.MOC` 的解析不变量测试**；可对照真机截图（E4） |
| **M2 动作** | `.MTN` 解析 + 队列 fade/循环 + `0x34E`/`0x352` 绑定语义 + `0x350` 复位 | acceptance #3 |
| **M3 集成** | 10 槽重画判据 + `a9d0` 门控 + 静图回落对照 + headless E3 + 文档订正 | acceptance #4/#5/#6 |

> **进度（2026-09-17）**：**M1（含"渲染最后一公里"）与 M2 已完成**，**M3 与 E4 未做**。
> 落点：出画几何 `app/amayui-emulator/src/live2d/render.ts`（快照与绘制同源）；
> L2D 纹理 `src/renderer/pixi/l2dTextures.ts`（普通 PNG）；`presenter.ts` 第四类图元（四路归并）；
> Electron `readById` 通道；守卫 `test/live2d-render.test.ts`。当前进度快照见仓库根 `docs-new/99-records/2026-09-live2d/CONTEXT.md`，
> 细节见 `tickets/T-0054/notes.md`。

---

## 6. 待拍板 / 待确认

**已决**：

- ✅ **路线 = C（自研移值）**（用户拍板 2026-09-16）⇒ §3.2 的 B 不再是候选；"是否再分发 `live2d.min.js`"这一许可项随之作废（只有将来要做一次性像素对照 spike 时才需重新提）。
- ✅ **参考源纪律 = 规范优先 / 资产实证兜底 / 反汇编只当 oracle**（§3.5）。

**仍待确认**：

- **[优先级]** 三处用例先做哪个？建议 **TITLE → INFOEN → BTL**：TITLE 的槽/动作最固定（`src/TITLE.txt:533-554`），INFOEN 多一条 `i349` 平移，BTL 槽号是动态局部量、动作切换最频繁（最难）；
- **[眨眼]** 要不要实现？引擎实际不眨眼（`sub_4783D0` 的唯一调用点被 `实例+23` 门控，而该位全代码无写入点）⇒ **建议先不做**（保持"和真机一样"，避免多一个无法对照的自由度）；
- **[`a9d0` 语义]** 它到底是"关闭 Live2D"还是"不用 Live2D 立绘"？脚本层只看到 `jcc` 判定与静态回落，建议 M1 的 E4 对照时一并确认；
- **[解析产物的落点]** 自研解析器/渲染器的代码位置（建议 `app/amayui-emulator/src/live2d/`，与 `renderer/` 解耦成纯函数 + 场景层适配）——M1 开工前定。

---

## 7. 开放问题（未读 / 未解）

- `.MOC` 二进制解析细节：`sub_4BD560` 及其调用的 `BReader` / `ISerializableV2` / `ModelContext` / `PartsData` / `DrawData` / `ParamDef` / `PivotManager` 的读法（**未读**）；
- 变形与绘制语义：`DrawParam_D3D` / `DDTexture` / `BDAffine` / `BDBoxGrid` 的顶点生成与 D3D 状态（**未读**）；
- 572B 节点的 4 组窗口（`+28/+48`、`+32/+52`、`+36/+56`、`+40/+60`）与颜色（`+68`）的插值推进细节（`opcode-table.md` 只登记了字段）；
- `AvatarPartsItem`（SDK 里的另一个类，raw 5429）在本作是否可达（**未查**）；
- E4（真机/真界面截图对照）**未做**；`a9d0` 的真实语义待确认（§6）；
- `0x34F` / `0x350` / `0x351` 语料 0 次使用：建议实现但排在最后（它们是"引擎能力面"，不是用例需求）。

---

## 8. 复核命令与数据层入口

```bash
# 引擎侧：L2D 条目族 / 常态能力
node .agents/skills/amayui-engine-analysis/scripts/report.js --find live2d
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --subsystem Live2D
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --id live2d-node-draw-advance

# 脚本语料用量（opcode 出现次数）
grep -rlE "i(341|342|345|349|34d|34e|352) " src/*.txt

# 工作单
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --show T-0054
```

- 引擎语义长文：`docs-new/03-engine/live2d.md`
- 相关既有文档：`docs-new/03-engine/resource-loading.md`（`SO004A` = 静态回落贴图）、`docs-new/03-engine/rendering.md`（四路归并层序）、`docs-new/99-records/2026-09-audit/stub-reaudit-2026-09.md`（其"排除项"判断由本评估改判）
- 数据层：`analysis/functions.json`（L2D 条目族）、`analysis/engine-capabilities.json`（`live2d-slot-probe` / `lazy-live2d-slot` / `live2d-enabled-config-flag` / `l2d-node-draw-gate` / `live2d-node-draw-advance`）
- 相关票：**T-0051**（E4 真界面待验证清单）—— 本评估的 E4 项可挂在那里
