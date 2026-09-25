# T-0180 过程记录：存档页 80→90 的 ~4s 同步阻塞

## 0. 用户给的两条关键线索（决定了怎么查）

1. 页面 80~89 **全空**、90~99 **全是真存档**（所以"切页"= 从"读不到"变成"读 10 个真文件"）；
2. 「日志里能看到**逐个扫过去**」。

## 1. 先排掉"文件 IO"这个嫌疑（实测，不是推理）

`.tmp/perf/probe-readslot.mts` 直接驱动真实文件层（`NodeFileSource` + 真 base = `%LOCALAPPDATA%`）：

```
 slot     字节   read(ms)  parse(ms)  头可解
   80         0      4.24      0.000  false      ← 该页确实全空
   90   1053821      2.38      0.248  true
   99   1478199      1.44      0.050  true
存在槽 10 个：read 合计 21.3ms（均值 2.1ms）· parse 合计 0.6ms · 读入 12.8MB
缩略图 10 个：7.0ms 共 1688KB
```

⇒ **整页的文件层只要 ~29ms**。4s 不在文件 IO 里。

## 2. 造定位工具（`profile` 计时器）

`.tmp/perf/` 下另写了驱动（`drive.mjs` 量单条命令往返；`repro.mjs` 复现固定序列）。
工具本体落在产品代码里（它是这个战役反复要用的东西）：

| 文件 | 作用 |
|---|---|
| `src/vm/profile.ts` | 帧看门狗（工作耗时 vs 距上帧间隔**分开报**）+ 可选的按 opcode 计时（关=零成本）+ 慢帧明细（带上限）|
| `src/frame/loop.ts` | 帧首 `beginFrame`、**`yield()` 之前** `endFrame`（★次序即判据：之后是"等帧"不是"占住主线程"）|
| `src/vm/interpreter.ts` | `stepOnce` 里把 handler 包起来计时（含它 await 的宿主 I/O）|
| `src/vm/debugCommand.ts` + `session.ts` | `profile on / off / reset / report [minMs] / watch on\|off / slow <ms>` |
| `test/profiler.test.ts` | 7 条守卫（含"关了必须零成本""两种慢必须分开报""每帧 top 不许串帧"）+ 源码棘轮 |

★一个必须记下的坑：**诊断不许把引擎搞坏**。第一版帧看门狗直接调 `native.log`，
而 headless 链路工具那条路的日志出口会抛（`HeadlessScene.log` 在那种构造下 `logs` 是 undefined）
⇒ 一次 `push` 打断整条帧循环、**28 条 E3/CONFIG1 测试全红**。现在出口包了 try/catch（只告警一次）。

## 3. 复现 + 归因（红）

TITLE→Load Data→右箭头×2（右箭头一次翻 10 格），量第 90 页那一帧：

```
帧 #12986：工作 1552ms · 距上帧 8ms · steps 8790
  0x204 draw-string ×80  = 582ms（均 7.28ms）
  0x205 draw-number ×110 = 669ms（均 6.09ms）
  0x1af 读 .STH     ×10  = 255ms（均 25.5ms）
```

⇒ 一帧里 **190 次直绘 + 10 张缩略图**，主线程被占住 1.55s。

（另一个有用的旁证：本机 INI 是**开着 AA** 的 —— 实例日志里 266 条 `drawString` **没有一条** `no-aa`
⇒ 走的就是下面这条"逐遍取覆盖率"的路径。）

## 4. 根因与修复

`src/renderer/text/raster.ts` 的 `drawGlyphPassesOnSurface`（AA 路径）**每个绘制遍**都：
`document.createElement('canvas')` → `getContext('2d')` → `fillText` → `getImageData`。
而 2D 画布默认留在 GPU 上 ⇒ **每次回读一次 GPU→CPU 同步**（~1.5ms）。
该屏每次直绘 1~4 遍 ⇒ 单次 6~7ms。

两处修复（**语义逐字不变**，只改"怎么拿到同一批像素"）：

1. **中间图层复用**：`scratchCtx(w,h)` + `scratchCanvases`（按物理尺寸缓存、用前 `clearRect`），
   绘遍循环里不再建画布；`drawAliasedLayer` / `thresholdAlpha` 同样复用。
2. **`getContext('2d', { willReadFrequently: true })`**：图层与**槽画布**两处都加
   （只加一处时实测只快一半：0x204 仍 1.78ms/次）。

守卫：`test/text-raster-perf.test.ts`（R1 允许的源码棘轮：池子必须在、绘遍循环里不许有
`createElement('canvas')`、两处都不许有裸 `getContext('2d')`）。

## 5. 绿（同一序列、同一测法）

| | 修复前 | 修复后 |
|---|---|---|
| 第 90 页那一帧 | **1552ms** | **308ms** |
| `0x204` 均 | 7.28ms | **0.94ms** |
| `0x205` 均 | 6.09ms | **0.20ms** |
| 190 次直绘合计 | 1251ms | **~19ms** |
| `0x1af` ×10 | 255ms | 210ms（未动，属另一条线）|

## 6. ★仍未收口（如实写进票面 acceptance，不许当成"修完了"）

* 同一序列那一步仍有 **308~654ms**，而**指令计时显示它不在 opcode 里**：有一次一帧只跑 **50 步、
  每条 0ms，却工作了 654ms** ⇒ 时间花在**帧循环自身的宿主工作**（`advanceModel` / `present` /
  纹理上传）上。下一步要把探针伸进这几个阶段（给 `profile` 加"阶段计时"）。
* 另有一个 **10000 步 / 4.5s** 的帧（10000 = 每帧步数上限）。它在**修复之前**的会话里同样出现
  （5103ms）⇒ 与本次修改无关、是独立缺陷，要单独查。
* 结论对"用户报的 ~4s"的解释：**1.55s 是这次的文本光栅化**（已修）；
  剩下的量级差异（用户 4s vs 我这台 headless 1.55s）与窗口/DPR、该页真存档数与文本量有关 ——
  要复现用户的确切数字，应在**他的实例**上再取一次同一步的帧报告（`profile` 已经就位，一条命令）。
