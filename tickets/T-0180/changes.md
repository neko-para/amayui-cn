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
  剩下的量级差异与窗口/DPR、该页真存档数与文本量有关 —— 见下一节，已查清。

## 7. 后续研究：那个"10000 步 / 4s"的帧查清了 —— 又是 `0x1a0`，这次量到了单价

用新落地的 agent tool `amayui_emulator`（不必再写脚本）复现并归因：

```
start → wait TITLE（8.5s）→ query [profile reset, profile on] → input click (1067,478) 进 LOAD → profile report
  帧 #961：工作 1065ms · steps 10000 · 最慢 0x1a0×120 1015ms  0x3×1 15ms  0x61×2221 2ms  0x50×1445 2ms
  帧 #962：工作  315ms · steps  5024
```

⇒ 那一帧 **95% 的时间是 `0x1a0` 被调用 120 次**（LOAD 画面一帧内把 100 个槽头全扫一遍），
其余所有 opcode 合计 < 5ms。

### 单价实测（直接打宿主的 `/api/read-save-slot`，热态中位数）

| 一次调用 | 成本 |
|---|---|
| 空槽（文件不存在） | **~5ms**（两次 ENOENT + 往返 = 地板价）|
| 真存档 1.05MB | **~84ms** |
| 真存档 1.48MB | **~116ms** |

⇒ 根因：**`0x1a0` 只取前 292 字节的头，实现却读整份 `.DAT`（1~1.5MB）并把 1MB 经 HTTP 搬一遍**。
引擎在同一格是 `CreateFileA` + 读头 —— 本工程自己的 `fileSource.ts` 注释里就写着
"调用方 = `0x1A0`（只取前 292 B 头）"，实现与这句话不一致。

⇒ 推论（与本票全部数字自洽）：整页扫描 ≈ `真存档数 × 100ms + 空槽数 × 5ms`。
用户那台有 85 个真存档 ⇒ **一次全表扫描就是秒级**，与他"切页卡 ~4s、真机瞬时"的观感一致。

### 修法（第 8 节已落地 ①；②③按决定不做/缓做）

1. **只读头** ✅ **已落地（见 §8）**
2. **（可选）槽头缓存** ❌ **决定不做**（用户判定：理论收益不高、容易出问题 —— 失效点散、一旦漏一处就喂旧头）
3. **不去改帧循环让它中途让帧**：引擎的批次语义就是"跑到门为止"，中途 `yield` 会改可观测帧数 ⇒ 不做

## 8. 只读头落地 + 红→绿（2026-09-25）

### 改了什么（10 个文件，全在"host 共享层 + 四条通道"上）

| 层 | 文件 | 改动 |
|---|---|---|
| 文件层 | `arch/overlay.ts` | 新增 `readPrefix(rel, maxBytes)`：`fs.open` + 读前 N 字节（overlay→base 同优先级；**短文件不补齐**） |
| 文件层 | `arch/fileSource.ts` | 声明可选缝 `readSaveSlotHead?(slot, maxBytes?)` |
| 文件层 | `arch/nodeFileSource.ts` | 实现 `readSaveSlotHead`（缺省 `SAVE_HEADER_BYTES` = 292） |
| 宿主 | `host/service.ts` | `readSaveSlotHead`（★**刻意不打日志**：一帧 120 次会刷爆日志） |
| 通道(w) | `web/host.ts` | 新路由 `read-save-slot-head` → `sendBin`（二进制，不走 SSE） |
| 通道(w) | `renderer/webBridge.ts` | `readSaveSlotHead` → `#bin` |
| 通道(e) | `electron/preload.ts` + `electron/ipc/files.ts` | 新 IPC 通道 `read-save-slot-head` |
| 通道 | `renderer/ipcProtocol.ts` + `renderer/ipcFileSource.ts` | 声明 + 实现（旧 preload 缺这条 ⇒ 返回 null ⇒ 退回整份读） |
| VM | `vm/handlers/save-slot.ts` | `0x1A0` **优先只读头**、没该缝时退回 `readSaveSlot` |
| 守卫 | `test/save-slot-head-read.test.ts` | 3 条行为（逐字节相同 / 短文件不补齐 / overlay 优先）+ 1 条**四条通道接线棘轮** |

### 红 → 绿（同一实例 `perf2`（base 有真存档 junction）、同一序列、同一测法）

```
起实例 → wait [bin=TITLE.BIN, frames_above=20] → profile reset+on → input click (1067,478) 进 LOAD → profile report
```

| | 修前（§7） | 修后 |
|---|---|---|
| 那一帧 `0x1a0` ×120 | **4758ms**（均 39.65ms、最坏 **117.7ms**） | **1278ms**（均 10.65ms、最坏 35.5ms） |
| 该帧总工作 | **4832ms** | **2298ms** |

⇒ `0x1a0` **3.7×**、那一帧 **2.1×**。★剩下的 ~10.7ms/次**不是文件了，是"120 次 HTTP 往返"本身**
（孤立量地板价 ~3~5ms，一帧内串行 120 次会互相排队）—— 这正是被否掉的"宿主内部批量缓存(C)"要解决的，
按决定**不做**；要再降只能改帧循环批次语义（也决定不做）。

### 附带发现（记下，未动）

`profile` 报告里出现了一类 `steps 50 / gapMs 280~343ms` 的帧 —— 那不是"我们慢"，是 **TITLE 的 `sleep` 门**
在等（引擎同形：无输入时主循环 `Sleep`）。但这说明我那条看门狗的措辞 **"宿主没给帧"** 不够准：
它同时覆盖了"rAF 被节流"与"门让我们等"两种正当情况 ⇒ 措辞待改（不影响判据）。

## 9. 两条传输层优化（用户点名的 ①②，均已落地并实测）

### ① 读取路径上不再有 `number[]` 中间层

`Array.from(uint8)` 的实测代价（同一台机、同一份字节）：

| 资源大小 | `Array.from` | `Uint8Array.from` |
|---|---|---|
| 50 KB | 3.0ms / **+2.1MB** | 0.1ms |
| 1 MB | 40.0ms / **+33.9MB** | 1.1ms |
| 3.7MB（一张 AGF 解码后的 RGBA） | 131.1ms / **+89.7MB** | 3.6ms |

而**两条传输腿本来就能直接搬二进制**：web 侧是 `application/octet-stream` 的响应体 + `envelope.ts`
的 0 拷贝 `subarray`，Electron 侧是结构化克隆（typed array 直接就位）。所以 `number[]` 纯粹是白付的。

| 层 | 改动 |
|---|---|
| 宿主 | `host/service.ts`：`readScript`/`readScriptByName`/`readFile` 去掉 `Array.from`，返回 `Uint8Array` |
| web 宿主 | `web/host.ts`：三条路由不再 `Uint8Array.from(r.data)` 复制一遍，`r.data` 直接进信封 |
| 声明 | `renderer/ipcProtocol.ts`：`data: number[]` → `Uint8Array`、`readFile(path): Promise<Uint8Array>` |
| 注释 | `electron/preload.ts`：口径注释同步（行为零变更 —— 结构化克隆本来就是 typed array） |
| 守卫 | `test/binary-legs-t0180.test.ts`：行为 2 条 + 源码棘轮 1 条 |

★棘轮里对 `service.ts` 的判据用 `=\s*Array\.from\(`（**不是**裸 `Array.from(`）：那份文件里**注释**
需要保留"实测 131ms"这句话来解释为什么不能摊成数组 —— 只禁代码、不禁说明。

### ② `capture` 的 PNG 离开 JSON 腿（宿主直接落盘）

修前：渲染页 `bytesToBase64(png)` → 放进 `debug-query` 回执的 `png` 字段 → 经 SSE/JSON 配对回到宿主
→ 插件再 base64 解码写盘。实测一份 1280×720 的 PNG：base64 长 2,383,864（UTF-16 ≈4.5MB），
`stringify` 3.6ms + `parse` 1.7ms + 解码 0.6ms，而 base64 本身就是 33% 的膨胀。

修后：渲染页把**原始字节**按 `application/octet-stream`（单段信封，与 `writeSaveSlot` 同一条上行腿）
POST 给宿主 → 宿主 `HostService.writeDebugArtifact` 写盘 → 回执只带 `{path, dir, bytes}`。

**实测（实例 `t0180d`，TITLE 画面，同一个 `capture` 命令）**：

| | 修前（等长模拟） | 修后（真回执） |
|---|---|---|
| 回执 body | 2,389,044 字符（≈ UTF-16 **4.56MB**） | **237 字符** |
| 走线字节 | 2.39MB | **253 B** |
| 客户端 JSON.parse | 3.55ms | ≈0 |
| 落盘 | 插件侧 base64 解码 | 宿主直写 **1,788,606B**，头 `89 50 4e 47`、IHDR **1280×720** |

| 层 | 改动 |
|---|---|
| 宿主 | `host/service.ts` 新增 `writeDebugArtifact(name, data)` + `ARTIFACT_NAME_RE`（**纯文件名白名单**：`../`/绝对路径/非法扩展名一律拒绝且不落盘） |
| 布局 | `host/instance.ts` 新增 `InstanceLayout.debugArtifactDir`（缺省实例 = `<repo>/.tmp/emudbg`，与插件读的**同一处**；具名实例 = `<实例根>/emudbg`，与 base/overlay/log 同一份隔离） |
| web 宿主 | `web/host.ts` 新路由 `write-debug-artifact`（读 octet-stream body 里的单段信封） |
| web 桥 | `renderer/webBridge.ts`：`#sendBytes` 上行；宿主拒绝时回的是 `{error}`（不是抛错）⇒ 这里收窄成 `null` |
| Electron | `electron/preload.ts` + `electron/ipc/files.ts`：新 IPC 通道 `write-debug-artifact` |
| 渲染侧 | `app/session.ts`：`#writeDebugArtifact()`（名字 = `capture-<时间戳>-<步数>.png`）；**回退仍在** |
| 插件 | `plugins/amayui-emulator/lib/tools.js`：`hostWrote` 路只**读回**文件量尺寸，不再 base64 解码；`out` 改名用 `renameSync` 搬过去（不重复写） |
| 守卫 | `test/binary-legs-t0180.test.ts`（同一个文件里，接线棘轮含 ② 的四段） |

★**回退的判据写死了**：只有"宿主没有这条通道"（`!fn`）**或**"宿主那边抛了"才回 base64 ——
后者刻意保留：**抓到的帧不能因为落盘失败就丢**（那会让"抓帧失败"看起来像"这台宿主没有像素"）。
守卫里那条 `if (!fn) return null` 的棘轮就是钉这个的。

★**插件那侧要重起 DSH 才吃到新代码**（插件模块是 DSH 启动时 `require` 进内存的）：本轮实测时
`action=capture` 报的是旧码那句「capture 没拿到 png」，但**同一时刻 raw `debug-query` 已经是新形状**
（`png` 字段缺席、`path/dir/bytes` 在场）—— 也就是说"该做的改动已在运行中的宿主里生效，
只有插件那份 JS 还是旧的"。重启 DSH 后 `action=capture` 即走新路。

### ② 的**消费侧**：回执变形后，只认 `png` 的调用方会静默哑掉（逐个查了）

回执换形状不止影响"产生它的那一侧"——查了全库，**四处**调用方在读 `capture` 的 `png` 字段，
每一处的失败模式都是**静默哑掉**（报"渲染窗没给出 PNG"，看起来像渲染页坏了）：

| 调用方 | 处置 |
|---|---|
| `tools/debugsrv.cjs` 的 `rendererCapturePng()`（`dbg.cjs shot` / `screencap` / `capture <路径>` 的**唯一公共入口**） | **优先读宿主落盘的那份**（`r.path` + `r.dir` → `fs.readFileSync`），`png` 退回旧形状分支；报错信息区分"渲染窗没给图"与"报到某路径但读不回来" |
| `tools/bprime-shot.cjs`（B′ 多帧取证） | 加 `readCaptureBytes()`：新形状读文件 / 旧形状解码，两种都收 |
| `plugins/amayui-emulator/e2e-shot.cjs`（E2E） | 同上 |
| `plugins/amayui-emulator/README.md` 的 `jq -r .png \| base64 -d` 示例 | 改成打印 `{ok,path,dir,…}` 并说明 PNG 已由宿主写盘 |

★`rendererCapturePng` 的这条修正**有行为守卫**（不只是源码棘轮）：`test/binary-legs-t0180.test.ts`
把该函数**按花括号配平抠出来**（注释里就有 `{path,dir,bytes}` 这种花括号，找换行会切在中间）、
用注入的 `sendDebugQuery`/`fs`/`path` 跑四种回执 —— 新形状读回文件、旧形状解 base64、
`ok:false` 抛它给的那句话、报了路径但读不回来也要抛（**不许**静默回 0 字节的"图"）。

### 收口

`npm run verify` = **exit 0**（tests **1712** / pass 1710 / fail 0 / skipped 2；`check:dead-writes` 无新增死写）。
比上一轮多的 5 条就是 `test/binary-legs-t0180.test.ts`。




