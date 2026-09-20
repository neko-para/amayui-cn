# T-0084 · 过程文档（notes.md）

## 2026-09-20

### 引擎侧渲染规格已产出（2026-09，subagent 只读分析）

新文档 **`docs-new/03-engine/transition-render-spec-2026-09.md`**（8 节：速览 / 24 格全表 / 消费端算法 / 平面层序 / emulator 集成点 / 步骤+守卫 / 未读到 / raw 锚点表）。`sub_4B06D0` 的体**已全覆盖读过**（134417-136739，分 7 段）。

**★本票原来的两条line与实证不符，以此处为准**：
1. **窗口门不是 `0x400`**。规格复核**没找到**任何「窗口未到点 ⇒ `0x400` 门挂起」的证据；`0x400` 是**脚本等待门计时器**（`Scene+46520/46524`，全文只被 raw 12797-12798 清过）。转场应当接的是 **`Scene+46508` → `needsRender`**（引擎对应物 = `sub_40BE10` 读 `46508`，raw 16022）与 `46512`（动画冻结）/`46516`（在途）。
2. **消费端区间**：`sub_4B06D0` 的体是 **raw 134417-136734**；`134856-136321` 只是其中「记录遍历 + 转场窗」那一段。

**记录表（`Scene+1048`，`std::map<int, 96B>`）按 `[0]` 分四类**：0 = 全屏交叉淡化 / 1 = 分块淡化 / 2 = 盲帘（12 种条带，几何纯函数）/ 3 = 插值模糊（SlideBlur / ZoomBlur）。
- ★**类别 0 由 `0x223` 写**（语料 **178 处 / 178 文件**）、类别 1 由 `0x24D` 写（**语料 0 处**）—— 而 `0x223` 在 emulator 里**写进了错误的容器**（`Engine.itemRegions`，生产代码无人读）⇒ 见 **`T-0087`（P1，本票的前置）**：不先修它，本票的渲染端就看不见类别 0 的记录。
- 新查明的格：`[1]` = 窗口起点（消费端首帧锁存 raw 134867-134871）；`[3]` = 时长**且是活动位（0 = 死记录）**；`[8]` = key 区间 B 跨度（配 `[6]`；`[5]/[7]` = 区间 A）；`[9..12]` = 裁剪矩形；`[13]` 负数 = **立即收尾**；`[15]` = 记录键 op1 本身（`0x24f` 族显式写）；`[16..23]` = 四通道（c0=Length / c1=CenterU / c2=CenterV / c3=Angle）；默认记录只填 `[0..13]`（`[4] = -1`），`[14..23]` 不初始化。
- 窗口门判据 = `clock < [1] + [2] + [3] && Scene+46512 == 0`，否则 `[3] = 0` + `46516 = 1`；条带 `n = W/[14] + (1 或 2)`、`msPerBand = [3]/n`、`off = floor((clock − [1] − [2])/msPerBand) * [14]`（阶梯单调）；收尾 = `46512 → sub_4A6E70`、`[3] = 0`、清 `46516`、`if (46512 | 46516) 46508 = 1`。
- **画到哪**：层号 = **渲染目标**（`sub_4A50C0` SetTarget；`sub_4A2D50(源纹理 id, 子矩形)` 画进当前目标）。盲帘 = SetTarget(`[4]`) + Clear + 把 scratch 层 36/37 的互补条画进 `[4]`；模糊 = SetTarget(36) 跑 effect 后拷回 `[4]`。★**层 20..29 是另一条路**（只对 `(layer − 20) <= 9` 做世界矩阵分解），**与转场无关** —— 转场走屏幕像素坐标、单位矩阵。
- **emulator 集成点**（规格给的具体位置）：`scene/ops.ts` 加 `scTransitionTick`(锁存/到期/置脏) + 纯函数 `scTransitionBands`(12 case) → 接进 `scAnimationsPending` / `sceneNeedsRender` → 两宿主 `advanceModel` 各一行 → 首帧抓旧帧 → `pixi/presenter.present` 加第五路（高 key、最后画）→ `snapshot.ts` 导出**独立字段** `transitionProgress`（★**不要改 `render4.transitions` 原值**，否则现有差分/deepEqual 守卫会红）。
- **建议守卫**：窗口活动判据（纯函数）/ `[1]` 只锁存一次 / 窗末 `[3]=0` 且 `t=1` / `off(t)` 单调不减且端点正确 / 类别 3 通道端点等于 `[16..19]`、`[20..23]` 且取整 / 窗内 `needsRender() === true` / 同 SceneState 不同 clock 合成输出不同 / 窗末回中性 / 12 case 条带互补（并集 = 矩形、交集空）。
- **规格未读到**（6 项不确定，其中要紧的两条）：**U3** scratch 层 36/37 的内容由谁填（函数内只有 SetTarget + Clear，推测 = `Scene+42600/42604` 的副本）；**U6** 即上面第 1 条。其余见规格文档 §7。
- 工作量估计：4~6 天（规格作者的估计，含条带几何、旧帧快照、presenter 第五路、守卫）。

## 2026-09-20

### 2026-09 轮 5：窗口模型 + 条带几何 + 类别 0/2 的离屏合成落地

**先订正原票里三处读错**（都以体为准）：

1. **类别号在记录 `[0]`**，不是 `[13]`。`[13]` 是**子类型**（类别 2 = 盲帘类型 0..11；类别 3 = 0 SlideBlur / 1 ZoomBlur；**负数 = 立即收尾**）。四个类别：0 = 淡入淡出（`0x223`）、1 = 分块淡入淡出（`0x24D`）、2 = 盲帘（`0x24F`）、3 = 插值模糊（`0x250`/`0x251`）。
2. **消费端区间 = raw 134417-136734**（旧票写的 134856-136321 只是「记录遍历 + 转场窗」那一段；函数头在 134417）。
3. ★**`[4]` 是渲染目标层，不是屏幕**：`sub_4A50C0(_this, v384[4])` 把渲染目标切到那一层、Clear 后才作画（raw 136174 / 134937 / 135824）。语料实证 `src/SC0000.txt:1337-1339`：`create-texture (global-int 3f5f) 500 2d0 1` → `draw-texture … (global-int 3f5f) …` → `i251 … (global-int 3f5f) …` ⇒ 转场画进脚本自己 `create-texture` 出来的 1280x720 **离屏槽**，随后由引用该槽的绘制项呈现。**`transition-render-spec-2026-09.md` §6.1 S4 的「目标层视为整屏」是错的近似**，本轮订正为「画进那个槽」。

**本轮落地**

- `src/renderer/scene/transition.ts`（新）：窗口模型（首帧锁存 `[1]`、算 t/off、到点杀记录、一遍绘完没有在途转场就清空整表 = 引擎 raw 134867-134871 / 136840-136841）+ 12 种盲帘条带几何 + 类别 0 的 alpha + 类别 3 的四通道插值（全纯函数）。
- `SceneState.render4.transitionRuntime`（**与写入端记录分开**）：引擎就地改 `[1]`/`[3]`，而 `render4.transitions` 是写入端的 deepEqual 对象 ⇒ 运行期值不许回写。
- 两个宿主的 `advanceModel` 共用 `scTransitionTick`；`sceneNeedsRender` 加第三项「有活动转场窗」（引擎 `Scene+46508` ← raw 136718-136719，读者 `sub_40BE10` raw 16022）。
- 快照新增 `render4.transitionProgress`（t / off / bands / channels / targetSlot）。
- 渲染端（pixi）：类别 0（交叉淡化）与类别 2（盲帘）画进记录 `[4]` 的槽（`TextureCache.composeIntoSlot`）。旧帧 = 本帧 `present` **之前**的舞台快照、新帧 = `present` 之后的快照；转场活动帧绕过 `#holdFrames` 早退（否则只画一帧）。

**守卫**：`test/sc-transition-window.test.ts`(11) / `test/sc-transition-geometry.test.ts`(10) / `test/transition-render-wiring.test.ts`(4)。

**仍缺（有据，不许沉默）**：类别 1（`0x24D`，可见效果与「分块/随机」参数来源未确证 —— 规格 §3.5 U2）；类别 3（`0x250`/`0x251` 需要真模糊，emulator 没有 filter ⇒ **不画假近似**）；`[4]` 指向非 `create-texture` 槽的情形（没有画布表面）；`Scene+46508/46512/46516` 三个标志本身未建模（只等价折进 `sceneNeedsRender`）。

## 2026-09-20

### 轮 5 续：类别 3（模糊）落地 + 类别 1 转为有据 deferred

**先订正规格里两处错读（都以体为准，已在 `transition-render-spec-2026-09.md` 顶部订正）**

1. **`Scene+42600` 就是层 36、`Scene+42604` 就是层 37**（层表基址 `Scene+42456`、按 `4*n` 索引，
   `42456 + 4*36 = 42600`；索引循环 raw 10993 坐实）。规格 §1.2 把它们记成「另设的双缓冲屏幕层」是错的 ——
   36/37 就是那两个 scratch 层，`sub_4A50C0(_this, 0x24)` 与 `Scene+42600` 是同一个对象。
2. **类别 3 的 `Tex0` 是层 36 的纹理**（raw 135883 `(**(_DWORD **)(_this + 42600) + 32)`），不是 `layer[[4]]`
   （规格 §3.4 写错）。而层 36 只在**类别 0/1 的 item 重绘**（raw 136014-136176，被 `Scene+46668 < 2` 门住）
   里被填、那段还在类别 3 **之后**执行 ⇒ 类别 3 的源到底是什么仍未收敛（§7 U3）。
   另有：CPU 回退 `sub_4A62A0(this, 36, [4], …)` 的**源是 36、目标是 [4]**（raw 125960-126010 的
   `v85 = a2` 就是「転送元サーフェイス」），而调用点之前刚 `SetTarget(36)` + `Clear` 过 36
   ⇒ 这条回退等价于「把空白模糊进 [4]」，与 effect 路径**方向相反**；`if (!BeginScene(36))` 那个
   「成功反而什么都不做」的分支结构属 §7 的 U4。

**类别 3（`0x250`/`0x251`，78 处语料）—— 落地为「参数确证 + 像素累积近似」**

- 新增 `scTransitionBlurPlan(rec, rt, size)`：逐条对应引擎的 `SetTechnique` + 四个 `SetFloat`
  （raw 135837-135881），含 `CenterU/CenterV` 的**归一化**（像素 / 目标层尺寸，raw 135846/135850）。
- 新增 `scTransitionBlurOffsets(plan)`：采样几何（ZoomBlur = 绕中心的均匀缩放，步长
  `Length / (|center| * 16)`（`dbl_51D7E8 = 16.0`）；SlideBlur = 沿 `Angle` 的平移，总长度 `2*Length`）。
- 宿主：类别 3 现在真的画 —— `composeIntoSlot` 里按 33 个采样累积（中心样本权重 3，raw 126180-126183），
  源取**本帧屏幕合成**。
- **★已披露偏差（不许静默）**：引擎走 D3DX effect 或逐像素 CPU 卷积（`sub_4A62A0` + `sub_4A0120`
  造 `(2L+1)²` 核，要锁 D3D surface 逐点算），emulator 两者都没有 ⇒ 核权重未逐点复刻、
  SlideBlur 的采样密度按同一总长度均分。这个偏差**写进类型**（`approximate: true`）、
  **进快照**（`transitionProgress[].blur.approximate`）、**进注释**、**进本票**。
- 快照新增 `transitionProgress[].blur = { technique, length, angle, centerU, centerV, samples, approximate }`。
- 守卫：`test/sc-transition-window.test.ts` 新增 4 条（参数逐条对照 / SlideBlur 走 Angle+Width+Height /
  ZoomBlur 步长与 `|center| = 0` 兜底 / 非类别 3 返回 null）；`transition-render-wiring.test.ts` 的源码棘轮
  改成「类别 3 必须有真消费者 + 中心权重必须用引擎常数」。

**类别 1（`0x24D`）—— 有据 deferred（新增台账条目）**

`grep -c i24d src/*.txt` = **0 处** ⇒ 现在实现它没有任何可见收益；体内真实行为已读清
（`sub_4255E0` raw 32840-32957 → `sub_4ADEE0` raw 132637-132683 = 类别 1 写入端，写 `[0]=1`/`[13]=a10`/
`[9..12]=a6..a9`）。**为什么仍然不实现**：消费端可见效果未确证（§3.5 U2，「分块/随机」参数来自
`SetRandomFade` 族、不在 `sub_4B06D0` 内）。已按 `deferred` 登记进 `analysis/opcode-gaps.json`
（此前它**在台账里根本没有条目** —— 那本身就是一处「静默」），扩展点写在该条 note 里。

**仍缺（诚实记账）**：类别 3 的**源层**（U3）与 `sub_4B06D0` 的控制流嵌套（U4）；
`[4]` 指向非 `create-texture` 槽；`Scene+46508/46512/46516` 三个标志本身。
