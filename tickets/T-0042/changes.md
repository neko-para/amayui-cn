# T-0042 · 过程文档（changes.md）

## 2026-09-15

## 第 1 次变更（2026-09-15）：按实测「文字白电平 0.89」对齐 emulator 的文字取色

### 改了什么

| 位置 | 改动 |
|---|---|
| `src/vm/handlers/msgwin.ts` | 新增 `TEXT_WHITE_LEVEL = 0.89` + `dimTextColor()`；`globalTextStyle()` 的 `main.fill` / `main.outline` 走它（注音复用 `core.main.fill` ⇒ 一起生效）；`0x204/0x205` 直绘也走 `globalTextStyle()` ⇒ 一并生效 |
| `test/draw-string.test.ts`、`test/adv-msgwin.test.ts` | 期望色 `#ffffff` → `#e3e3e3`（0.89×255 = 227），并注明理由 |
| `test/text-style-snapshot.test.ts` | 期望色助手 `rgbOf()` 用同一口径压一档（断言仍只比较**颜色的相对变化**：入队钉住 / 不回溯 / 直绘立即消费） |

### 判据（都实测；同屏"美术图不变"是对照组）

| 场景 | 改前 | 改后 | **引擎实测** |
|---|---|---|---|
| OPTION·字体样例预览文字（核心众数） | 255（1101 px 纯白） | **230-232** | 228-230（整段 **0** 个 255） |
| OPTION·行标签文字 | 255 | 233-237 | ~223-238 |
| OPTION·美术面（米白按钮面 + 纯白高光） | 287 px 纯白 | **287 px 纯白（未变）** | 378 px（同一批美术像素两边逐点一致） |
| ADV 正文（SN0000 序章） | 255（9852 px） | **227**（4929 px） | 229-232 |

残余：ADV 上 emulator 227 vs 引擎 229-232（约 3 级）—— 引擎那侧还有轻微暖色/软化（另案，不在本票）。

```text
npx tsc -p tsconfig.json --noEmit   → 干净
npm test                            → 553/553 绿（含本变更更新的 4 处填色断言）
npm run shot -- --centered          → .tmp/t0042b-1-config1.png（OPTION 屏）
npm run shot -- --gamestart --centered → .tmp/t0042badv-9-sn0000-hover-out.png（ADV）
```

### 为什么现在就这样改（而不是等机制）

机制仍未定位（acceptance 第 1 条继续挂着）：已确证**取色链给的是 0xFFFFFF、这一档发生在 GDI 画完之后**，并逐条排除了
`MesWinAlpha`（用户实测 0/32 无变化）/ 配置色 `adcd` / AA 门 / `set:DrawMode` / 缩放与滤波 / 调色板 / 窗对象颜色对 op。
但**效果是稳定常数、判据清晰**（同屏美术图逐像素一致 ⇒ 差异只在"引擎画的文字"），所以先按实测值对齐：
一旦机制定下来，只需改 `TEXT_WHITE_LEVEL` 这一处（或换成真实来源），不会散在别处。

## 第 2 次变更（2026-09-16）：按**引擎的字形覆盖率 α 合成**重做（替换第 1 次变更的常数乘色）

**动机**：第 1 次是"照症状对齐"（把颜色乘 0.89），机制未知；本轮把机制读出来了：

- `sub_46F2D0` raw 86146 用 `GetGlyphOutline` 取**覆盖率位图**（`v62 = 5`/`6` = `GGO_GRAY4/GRAY8`，
  raw 86028-86038 按 `Font+1352` 选；关时 `1` = 1bpp）；
- `sub_46D9F0` raw 84893-84898 / **84956-85011（32bpp 分支）**逐像素合成
  `dst = (C·α + dst·(255−α))/255`，**`α = 255·cov/17` ≤ 240**（cov 满 16 ⇒ 240；实测平台对应 cov=15 ⇒ 225）
  ⇒ **填充永不不透明**，"白字"必然落在 `α·255 + (1−α)·描边色` 上（这同时解释了"偏灰"与"偏粗"）。

**改动**（`app/amayui-emulator`）：

| 文件 | 改动 |
|---|---|
| `src/vm/handlers/msgwin.ts` | 删掉 `TEXT_WHITE_LEVEL`/`dimTextColor`（不再按常数压颜色）；`globalTextStyle()` 返回**脚本/config 原色**；`antiAlias: true`（判据见下） |
| `src/text/layout.ts` | 新增 `TEXT_FILL_ALPHA = 225/255`（= 255·15/17 / 255，带 raw 锚点）；`FontSpec.antiAlias` 注释改写为"像素判据优先" |
| `src/renderer/text/raster.ts` | 描边副本照旧不透明；**填充那一遍用 `ctx.globalAlpha = fillAlpha`**（覆盖率路径才压），即 canvas 的 `dst = α·C + (1−α)·dst` |
| `test/adv-msgwin.test.ts`、`test/draw-string.test.ts`、`test/text-style-snapshot.test.ts` | 期望色回到脚本原色（`#ffffff` / `#123456`），并注明偏灰由 raster 的合成负责 |
| `test/text-aa.test.ts` | ①配置门语义不变（字段仍按配置推导）；②样式侧 `antiAlias` 恒 true 并写明"配置推导 vs 像素判据"的冲突；③新增"覆盖率 α 落在实测 (233,230,228)"的守卫 |
| `src/tools/t0042c-colors.ts` | 新增（本轮取证工具：在真机 SAVE.DAT 里找实测色值，结论 = 都不在 ⇒ 不是配置色） |

**真机/模拟器同屏对照（OPTION 屏；真机 `opt-engine.png` 1602x958 = 客户区 1600x902 + 1px 边框 + 56px 标题栏）**：

| 量 | 第 1 次（常数乘色） | **第 2 次（α 合成）** | 真机 |
|---|---|---|---|
| OPTION·字体样例大字平台色 | 227（中性） | **225**（994 px 众数） | 226-228（中性） |
| **ADV 正文（SN0000 序章）** | 255（9852 px 纯白） | **225**（10633 px 众数，**纯白 0 px**） | 229-232 |
| 同屏美术面 | 逐像素一致 | 逐像素一致 | — |
| 行标签 | 227 | 252-255 | 226-234（暖） |

（ADV 用例：`npm run shot -- --gamestart --centered --name t0042e` 的 `-9-sn0000-hover-out.png`。）

**残留（写进 acceptance）**：设置界**行标签**在模拟器里仍偏亮（252 vs 真机 ~230）。机制侧解释：
`CONFIG1.txt:2747-2748` 把该元素的填充与描边都设成 `ffffff` ⇒ α 合成的 backdrop 是**白描边**
⇒ `225 + 0.118·255 ≈ 255`；真机落点 ~230（暖）⇒ 真机该元素的**描边实际是暗色**（或该元素不走那两行）。
下一步：读"设置界行标签的描边真源"（`CONFIG1.txt:2740-2790` 的元素归属）。

```text
npx tsc --noEmit            → 干净
npm test                    → 554/554 绿（含新增的覆盖率 α 守卫）
npm run shot -- --centered --name t0042d → .tmp/t0042d-1-config1.png（1600x902 纯客户区）
```
