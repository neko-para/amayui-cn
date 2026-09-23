# T-0128 · 变更记录

## 第 1 次变更（2026-09-23）：E4 闸门两侧都看 + 打开闸门后暴露的 4 处真失败 + replay 接 Live2D

### 1. 新增 `test/realSlots.ts`：真槽定位的**唯一实现**

本机 **base 不存在、真槽只在 overlay**（`SAVE78/79`，format=3，38/69 绘制项），
而 7~9 处 "E4" 闸门把路径写成 `resolveSystemPaths(REPO).baseDir/SAVE` ⇒ 这些"最硬一档"的用例
**在开发机上一次都没跑过**。`engine-slot` 的 E4b 是当时唯一两侧都看的写法 —— 抽成
`realSlotDirs` / `findRealFiles` / `firstRealFile` / `slotNumberOf` / `readReal`，7 个站点全部改用它。

**结果**：`test:corpus` 的 skipped **11 → 1**；全量 skipped **12 → 2**（剩下 2 条是本机确实没有的：
`%LOCALAPPDATA%` 下的真机 `SAVE.DAT` 与非 win32 平台的预编译产物断言）。

### 2. ★闸门一打开就抓到 4 处**真失败**（原来全被静默跳过）

| 站点 | 现象 | 真因 | 处置 |
|---|---|---|---|
| `slot-load-transfer.test.ts` | `e.cur = 2`（期望 0） | 我把"槽号"误传成"文件字节"；原 `firstRealSlot()` 返回的是**槽号**（本机 78，不是 0）⇒ 引擎去读不存在的 `SAVE00.DAT`，handler 提前返回 | 用 `slotNumberOf()` 传**槽号** |
| `slot-load-resume.test.ts` | `e.cur = 1`（期望 0） | 同上：调用方脚本里 `0x1A1` 的 op2 硬编码成 `0` | 改成真槽号 |
| `save-slot.test.ts`（E4 头） | `头 +272 = 时` 0 ≠ 13 | 逐字段断「头 == 文件 mtime」只在**文件自存档后没被重写**时成立：本机 `SAVE79` 逐秒一致、`SAVE78` 的 mtime 是后来重写的 | 改成两层：① 每个槽的头都是**合法 SYSTEMTIME**（范围 + format=3 + 游玩秒数>0）；② **至少一个**槽与 mtime 一致（保住"这个字段就是存档时刻"这条核心判据） |
| `save-slot-chain.test.ts`（缩略图 E3） | `setSlotPixels` 一次没调 | 探针实测 `readSlotThumb` 调用数 = **0**：本机只有 78/79 两个真槽（在第 8 页附近），**列表首页全是空槽 ⇒ 脚本根本不调 `0x1AF`** | 把真槽**复制到槽 0**（临时 overlay）⇒ 判据不变（真链路 + 真 `.STH` 解码），但**任何机器上都是确定性 E3** |

### 3. ★反例实验时又抓到一个真缺陷：`SLOT_FRAME_STRIDE_DWORDS` 是**死常量**

票里写的反例是「`SLOT_FRAME_STRIDE_DWORDS 261→260` ⇒ `engine-slot` 必红」。**第一次做时它全绿** ——
查下来：解码器里用的是**内联字面量** `1044`/`22296`，命名常量 `SLOT_FRAME_STRIDE_DWORDS` **没有任何读者**
⇒ 改它当然没有测试会红（"常量名存实亡"）。

**修**：解码器改用常量（并补 `SLOT_IMAGE_TAIL_BYTES`）。**重做反例** ⇒ `engine-slot` **3 例红** ✅。

### 4. `replay` 接上 Live2D（审计发现的"一字节未比"）

`scSnapshot(scene, nowMs, l2dHost?)` 一直**接受**第三个可选参数，而 `buildFrameDigest` 从来没传
⇒ 已经跑通的 **record/replay（G3）对 Live2D 一字节未比**。现在：

- `DigestEngine` 增 `l2d` 段（`SceneSnapshot['l2d']`：槽 + 节点 + 每节点这一帧的三角批次）；
- `buildFrameDigest` 传 `scene.l2dHost ?? null`；`diffEngineDigest` 增一段可读摘要（`slots/nodes/triangles`）；
- 因为 `hashEngine` 走 `canonicalize(engine)`，**该段自动参与 G1/G3 的哈希**；
- 新增守卫（`frame-digest.test.ts`）：无 `l2dHost` ⇒ 段为 `null`；挂上（哪怕空的）⇒ 段变对象且**哈希必变**、
  `diffEngineDigest` 指名 `l2d:`。**反例**：把 `l2d: snap.l2d` 改成 `null` ⇒ 该用例红。

★代价与收益要一起看：L2D 从此进入"逐帧等价"的比较面（`live2d-chain` / `live2d-render` / `l2d-node-compose`
这些 E3 的真资产用例因此有了机器判据），代价是 digest 体积略增。

### 5. 其余两处同类缺陷（顺手，同一病因：只盯 base）

- `engine-config.test.ts` 的真 INI：只查 `baseDir` ⇒ 改为 **overlay 优先 + base 兜底**（与产品
  `systemPaths.ts` 的读取口径一致）。打开后发现一条**越界断言**：`message:Font` 非空 ——
  那是**玩家取值**，与文件头自述的「不断言玩家取值」自相矛盾（本机真 INI 的 `Font=` 就是空的）
  ⇒ 改成结构判据（键在、是字符串）。
- `overlay.test.ts` 的「真实 base 目录」：改为 **base 或 overlay 至少一侧**，并对存在的那一侧校验结构。
- `gallery-bgm-list.test.ts` 的 `if (!merged) { …; return; }`（**裸 return**，node:test 记 pass、零断言）
  ⇒ 改 `t.skip(...)`。

### 6. 数字（本机 2026-09-23）

| 口径 | 前 | 后 |
|---|---|---|
| 全量 skipped | **12** | **2** |
| `test:corpus`（T1）skipped | 11 | **1** |
| 全量用例 | 1082 | **1083**（+1 = digest 的 l2d 守卫） |
| 全量失败 | 0 | **0**（打开闸门时先暴露 4 处真失败，已逐条修掉） |
| `npm run test:corpus` 墙钟 | 22.2 s | **56.5 s** |
| `npm run verify` 墙钟 | 32.9 s | **41.8 s** |
| `npm test`（T0 日常档） | 5.8 s | **6 s 量级（未变）** |

★**verify 变慢是"真的多跑了东西"**：E4 层第一次在本机实际执行（`save-slot-chain` 那种驱动 2 万帧的用例）。
为把代价压回来，本轮顺手做了两件事（**判据一字未改**）：

| 手段 | 效果 |
|---|---|
| `game-start-chain.test.ts` 加**按键 memo**（3 次启动链里有 2 次 opts 相同） | **16.7 s → 7.9 s** |
| `save-slot-chain.test.ts` 拆成两文件（两条重型 E3 各占一个进程） | T1 **116 s → 56.5 s** |

### 7. 锚点申报

`T-0036` 的「列表里的缩略图」锚点随文件拆分迁到 `test/save-slot-thumb.test.ts` ⇒ 按纪律 **retarget**（判据未改）。
