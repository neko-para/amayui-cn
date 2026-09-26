# T-0103 段 1 · SN0000 结尾的「横向模糊」整段看不见、画面直接切成黑

> 轮 17（2026-09-26）：用户实测「SN0000 结尾渐变到黑屏的横向模糊丢失了，并且直接切换到黑色（没有预期的渐变）」。
> 本文是该段的**取证 + 根因 + 修法**（只针对段 1；后段另行处理）。

## 0. 脚本侧落点（真源）

| 行 | 指令 | 含义 |
|---|---|---|
| `src/SN0000.txt:3023-3024` | `i238 708` + `wait` | 切章前的 1800ms 空拍 |
| `src/SN0000.txt:3026` | `create-texture (global-int 3f5c) 500 2d0 1` | 工作槽（1280×720，运行期 = **槽 63**） |
| `src/SN0000.txt:3027-3028` | `add local0 (global f8025) 2` + `draw-texture local0 3f5c 0 0 500 2d0 0 0` | 目标项 **0x18AEE**（全屏，引用工作槽） |
| `src/SN0000.txt:3030-3035` | `local1=0 local2=0 local4=200 local6=0` | 四通道：`[16]=0→[20]=200`（Length）、其余 0 |
| `src/SN0000.txt:3036` | `i250 local0 3f5c f8025 1 … 0 9c4` | **类别 3 / SlideBlur**：key=0x18AEE、`[4]`=槽 3f5c、`[5]`=0x18AEC（**源区间 A**）、`[7]`=1、`[3]`=**2500ms** |
| `src/SN0000.txt:3045` | `set-draw-color-alpha (global f8025) 2 -1 -1` | 源项 0x18AEC：只把混合档设成 2（负值 → 取当前色） |
| `src/SN0000.txt:3051 / 3054` | `set-draw-color-alpha 0x18AEE 2 -255 0xffffff` + `set-draw-color 0x18AEE 0 9c4 0 0xffffff` | 目标项：FROM = 不透明白 → TO = **透明**白，2500ms ⇒ 模糊图**由不透明淡到透明** |
| `src/SN0000.txt:3058-3059` | `i238 9c4` + `wait` | 等满 2500ms |
| `src/SN0000.txt:3072` | `exit` | 交给 `SC0000.BIN`（黑幕在 `SC0000:1607-1621`） |

⇒ **设计意图**（脚本自身就能读出来）：目标项 = 工作槽里的**区间 A（云柱背景）的模糊副本**，
它一开始不透明（= 冻住当前画面）、随 Length 0→200 越来越糊、同时 α 255→0 淡出 ⇒
墨色底下的黑露出来 = 「云柱背景 + 横向模糊 + 向黑色渐变」。

## 1. 运行期实证（存档 78 → 点一下推进）

- 复现：`app/amayui-emulator/tools/load-slot.mjs --instance <id> --slot 78` → 点 `(640,360)`。
- 记录写端（日志原文）：
  ```
  createTexture slot=63 1280x720 mode=1 @1.5x class=normal (新建空白表面)
  configureDrawItem h=0x18aee layer=101102 (0,0,1280x720)
  setTransition id=0x18aee writes=[[0,3],[1,0],[2,0],[3,2500],[4,63],[5,101100],[7,1],[13,0],[16,0],…,[20,200],…]
  ```
- **修前**（`section1-blur-source-before.txt` + `section1-black-before-fix.png`）：
  整个 2500ms 窗口里 `[present]` 摘要是 `101100:a255 … 101102:a202→a41`（过渡项几乎不透明、正盖着屏幕），
  而窗口内的 capture 全是 **20,890~21,067B 的纯黑帧** ⇒ **槽 63 里是黑的**：
  过渡项盖住了屏幕，但它是全黑的 ⇒ 横向模糊整段看不见、画面从背景**直接切成黑**（用户口径完全吻合）。

## 2. 根因：类别 3 的模糊源取了「本帧屏幕」，而 D3 已把源区间排除出屏幕

```
记录： [5]=101100（= 0x18AEC 云柱背景项）, [7]=1   ⇒ 区间 A = {101100}
D3（T-0091 ⑥ / T-0103 轮 16）：活动转场把区间 A/B 的项排除出屏幕 pass
        scTransitionMarkedHandles() → presenter.present 的 skipped() → 不画 101100
类别 3 的源（修前）： pixiBackend #compositeTransitions 的 screenOnce() = #captureStageCanvas()
        = 抓"本帧屏幕合成" ⇒ 那张画面里**恰恰没有 101100**（被 D3 排除了）
⇒ 模糊一张没有云柱背景的画面 = 模糊黑底 ⇒ 槽 63 恒黑 ⇒ 过渡项（α≈1）显示为黑
```

两条各自都"有据"的改动（D3 与 D4）在**同一帧**里互相抵消 —— 这正是"改一处、另一处静默失效"的形态。

引擎侧对照（`engine/天结_unpacked.exe_utf8.c`）：
- effect 的输入纹理 = **层 36**：`v173 = (*(…)(*(_DWORD *)(_this + 42600) + 32))(*(_DWORD *)(_this + 42600));`
  + `SetTexture(aTex0, v173)`（raw **135883-135884**；`42600 = 42456 + 4*36` ⇒ 层 36）。
- 层 36 里的内容 = 那两趟 item 重绘写的**区间项**（raw **136014-136176**）⇒ 被模糊的是**区间项本身**。
- ⇒ emulator 的正确取源 = "**区间 A 的离屏副本**"（`#renderRangeCanvas(handles.a)`，与类别 0/2 同一份机制），
  而不是屏幕。轮 15 的 D4 曾据"类别 3 跳过填充趟 + 本帧刚清过层 36"改取屏幕 —— 那条推理的**结论被本轮实测否定**
  （取屏幕 ⇒ 与 D3 冲突 ⇒ 恒黑；真机可观测量也不是黑的）。

## 3. 修法（`app/amayui-emulator/src/renderer/pixiBackend.ts`）

```ts
const rangeA = scTransitionRangeHandles(this.scene, rec).a;   // 记录 [5]/[7]
const ra = this.#renderRangeCanvas(rangeA);                    // = 引擎层 36 的等价物（同类别 0/2 的机制）
const src = ra.canvas ?? screenOnce();                         // 区间 A 空时才退回屏幕（退化路径，日志写明）
```
日志口径随之改为 `源=区间A(N项，引擎层 36）` / `源=本帧屏幕（区间 A 空：N 项）`。

## 4. after 实测（`section1-blur-source-after.txt`）

| 截图 | 窗口位置 | 内容 |
|---|---|---|
| `section1-blur-after.png` | t≈0.25（Length≈40） | 云柱背景被**横向拉花** ⇒ 横向模糊回来了 |
| `section1-blur-after-late.png` | 窗口末段 | 同一张模糊图**整体压暗**（α 窗 255→0）⇒ 「向黑色渐变」 |
| `section1-black-after-window.png` | 窗口之后 | 黑（区间 A 仍被排除 + 底色 mesh 0x0），随后接 SC0000 |

- 日志：`[transition] id=0x18aee cat=3 t=0.000/0.075/…/0.997 → 槽 63（Slideblur Length=0/15/…/199 … 源=区间A(1项，引擎层 36））`
- 窗口内 capture 大小：1,322,392B（模糊图）→ 772,573B（压暗）→ 20,890B（黑）。

## 5. 守卫

- `app/amayui-emulator/test/transition-render-wiring.test.ts`：
  ① 源码棘轮 —— 类别 3 的源必须是 `#renderRangeCanvas(区间 A)`，`screenOnce()` 只许作空区间退化；
  ② 口径棘轮 —— 不许再出现 `采样=…（近似；源=本帧屏幕）` 这个"恒黑口径"。
- 既有守卫继续覆盖前提：同文件 D3 例（区间项不进屏幕 pass）、`test/sc-transition-window.test.ts`（窗模型）、
  `test/op-24f-250-251-transitions.test.ts`（写端记录格）。

## 6. 未决（不在本段内）

- **段 2/3（白晕 + 章节卡）与段 4（第二次横向模糊 + 人物轮廓）** 仍按 T-0103 的原计划（用户要求"先按顺序"）。
- 类别 3 的像素仍是**累积近似**（33 采样 1D 降级 + 中心权重 3，见 `TransitionBlurPlan` 的披露①）——
  本轮只修"源"，没有改核。
- ★工具坑（本轮踩到）：debug 实例的**渲染页加载的是构建产物** `dist/renderer.js` ⇒
  改了 `src/renderer/**` 必须先 `npm run build:electron` 再重启实例，否则实例仍在跑旧代码
  （症状：日志口径依然是旧文案）。已记进 `docs-new/00-overview/lessons.md` 与
  `.agents/skills/amayui-remote-debug/SKILL.md`。
