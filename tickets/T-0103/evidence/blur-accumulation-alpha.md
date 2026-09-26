# T-0103 轮 18 · 横向模糊的「黑色遮罩」＝类别 3 采样累加用了 source-over（α 只累到 0.616）

> 用户口径（2026-09-26 第二轮）：
> 「1. 从 SN0000 结束（ADV 带来的黑色半透明遮罩清除）到横向模糊的过程中，**横向模糊引入的黑色遮罩导致背景颜色跳变**
>   （真机是同时向黑色渐变并引入模糊）；2. …**人物轮廓出现也存在跳变**；我怀疑这两个地方可能是同一个问题导致的。」
> ⇒ 本轮实证：**两处是同一个根因** —— 类别 3（插值模糊）把 33 个采样累加进记录 `[4]` 的槽时用了
> canvas 默认的 **source-over**，而权重表是**归一化加权平均**（Σw = 35）⇒ 累积 α = `1-(34/35)^33 ≈ 0.616`，
> 合成幕只有 **62% 不透明**，底下那张满屏黑透出 **38%** = 用户看到的「黑色遮罩 / 背景色跳变」。
> 段 1（SN0000 结尾的 2500ms 横向模糊）与段 4（`SC0000:1574` 的 3000ms 横向模糊，就在人物轮廓之前）**用同一段代码**。

## 1. 根因（代码 + 数学）

`app/amayui-emulator/src/renderer/pixiBackend.ts` 的 `#compositeTransitions` 类别 3 分支（修前）：

```ts
const total = (plan.samples - 1) + TRANSITION_BLUR_CENTER_WEIGHT;   // 32 + 3 = 35 = 权重之和
for (let k = 0; k < plan.samples; k++) {
  const weight = k === half ? TRANSITION_BLUR_CENTER_WEIGHT : 1;
  ctx.globalAlpha = weight / total;          // 1/35
  ctx.drawImage(src, …);                     // ← 默认 source-over 逐层覆盖
}
```

- 加权平均的**意图**：Σ(wᵢ/35)·cᵢ，α = Σwᵢ/35 = **1**；
- source-over 的**实际**：α = `1 - Π(1 - wᵢ/35) = 1 - (34/35)^33` = **0.6158**（每层只"留下"1/35，
  33 层后仍有 38.4% 的透明底）⇒ 幕不透明处也把底色（满屏黑 mesh / 黑幕）透出 38%。

## 2. 确定性测量（真 canvas，`npx electron .tmp/flash/canvas-alpha.cjs`）

源 = **不透明**中灰 128；跑与宿主同一段循环（33 个采样，中心权重 3），读中心像素（`getImageData`）：

| 变体 | RGBA（8bit） | α | 判读 |
|---|---|---|---|
| **source-over（修前）** | [126,126,126,**160**] | **0.627** | 37% 黑纱 ⇒ 用户症状 |
| `lighter` + 浮点 α（第一版修法） | [142,142,142,**246**] | 0.965 | 黑纱基本消失，但 8bit 量化仍留 3.5% |
| **`lighter` + 整数 α 且 Σα = 255（落地版）** | [137,137,137,**255**] | **1.000** | 无黑纱；残差 = 前乘色逐层四舍五入（中灰 +7%） |

（半透明源 α=0.5 的对照：source-over ⇒ α=0.376（错得更多）；`lighter` ⇒ α≈0.537 ✓ 保持半透明。）

## 3. 落地修法

1. `scene/transition.ts` 新增纯函数 **`transitionBlurAlphas(samples, centerWeight, centerIdx)`**：
   把权重按 `floor(255·w/Σw)` 量化成整数、余量按小数部分从大到小发完 ⇒ **Σα 恰好 255**（中心仍最重）。
2. `pixiBackend` 类别 3 分支：累加前 `ctx.globalCompositeOperation = 'lighter'`，用上面那张整数 α 表，
   累加完还原 `'source-over'`。
3. 披露的残差：8bit 前乘色逐层四舍五入 ⇒ 中灰 128 累到 ≈137（**+7%** 亮度）；
   精确解需要浮点累加（WebGL/Pixi pass），相对"38% 黑遮罩"已量级消失。

## 4. 运行期 before/after（同一条复现链 + 同一个抓帧驱动）

复现：`load-slot.mjs --instance <id> --slot 78` → 点 `(640,360)` → 盯日志 `setTransition id=0x18aee` → delay 250ms → 连拍。
`平均亮度` = 整屏 RGB 的加权均值（`.tmp/flash/pnglum.mjs`）。

| 抓帧（同一驱动、同一 delay ⇒ 窗口内位置可比） | 修前 | 修后 | 比值 |
|---|---|---|---|
| shot#1 | `section1-blur-after.png` = **77.8** | `section1-blur-after2.png` = **126.6** | **1.63×** |
| shot#2 | `section1-blur-after-late.png` = **22.7** | `section1-blur-after2-late.png` = **34.1** | **1.50×** |

★**1.63× 与理论值 `1/0.6158 = 1.62×` 吻合** ⇒ 修前那 38% 的黑纱就是这两个跳变的来源；
修后窗口内的亮度回到与"幕前那张背景"同量级（余下的 +7% 即上文披露的量化残差）。

## 5. 守卫

- `test/transition-render-wiring.test.ts`：
  ① **单元**（新）—— `transitionBlurAlphas(33,3)`：长度 33、**Σα = 255**、中心 > 两侧、各样本与理想值差 ≤ 1/255、
     每个采样非零；退化 1/2/0 采样也成立；
  ② 源码棘轮 —— 类别 3 必须出现 `globalCompositeOperation = 'lighter'` 且用完还原 `'source-over'`。
- 既有：D3 例（区间项不进屏幕 pass）、轮 17 的源棘轮（`#renderRangeCanvas(区间 A)`）。

## 6. 与段 2/3（白晕 + 章节卡 + 人物轮廓）的关系

段 4 的第二次横向模糊（`setTransition id=0x18a9e writes=…[4]=9,[5]=101020,[13]=0,[20]=100…`，3000ms）
与段 1 是**同一段代码**路径 ⇒ 修一处两处都好；这也解释了用户"两个地方可能是同一个问题"的直觉。
「人物轮廓突然出现」的观感 = 第二次模糊的暗纱盖住卡片后又撤掉的那一下（同一根因），
以及随后黑幕 2400ms 淡出（这一段的时序在模型上逐帧平滑：`0x19258` α 255→201→148→95→36→0，
证据 = `tickets/T-0103/evidence/trace-mesh19258-alpha.txt`）。

## 7. 未决（不在本轮）

- 8bit 前乘色的 +7% 亮度残差（要精确 ⇒ 走 Pixi/WebGL 浮点 pass；见上）。
- 类别 3 的**核**仍是 1D 降级（33 采样 + 中心权重 3；引擎 CPU 回退是 33×33 旋转方格，有 effect 的机器走 shader）——
  这条是 `TransitionBlurPlan` 早就披露的偏差，未变。
