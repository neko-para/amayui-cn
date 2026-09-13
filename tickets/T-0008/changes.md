# T-0008 · 变更记录（changes.md）

> 纪律：**第 N 批/次变更**一节写"改了哪些文件 / 行为怎么变 / 判据是什么 / 看了哪张截图"。
> `history[]`（ticket.json）只记状态与范围级事件，别在这里重复。

## 第 1 批（2026-09-14）—— D1：删掉宿主的 `waitFlags` 镜像、统一时钟、把"该不该合成"变成可测的共享判据

### ① 删除粘滞镜像：`PixiBackend.waitFlags` / `HeadlessScene.waitFlags`

**改了什么**
- `src/renderer/pixiBackend.ts`：删 `private waitFlags`（修前 `setWaitFlag()` 只 `|= mask`、**全文件没有清除点**
  —— 清的是 `Engine.waitFlags`，见 `session.#serviceAnimGate/#serviceSleepGate`）⇒ 只要发生过一次 `0x21C`，
  `needsRender()` 就**恒为真**。现在 `setWaitFlag()` 只 `#markDirty()` + 记日志。
- `src/renderer/headlessScene.ts`：删死字段 `waitFlags`（**没有任何读者**）；`setWaitFlag()` 变成有文档的 no-op。
- 判据只读引擎那份：`needsRender()` / `sceneAnimationsDone()` 都从 `this.scene` + 时钟算，
  门状态的真源是 `Engine.waitFlags`。

### ② D1 单一时间域：把引擎的 `nowMs` 交给宿主

**改了什么**
- `PixiBackend.sceneAnimationsDone(nowMs?)`：传入时把 `clockMs` 刷成它（判据与推进同源）；
- `PixiBackend.present(nowMs?, waitFlags = 0)`：`nowMs ?? performance.now() - wallStart`（`waitFlags` 只做诊断日志）；
- `session.#present()` → `this.#native.present(this.#e.nowMs, this.#e.waitFlags)`，
  `#serviceAnimGate()` → `sceneAnimationsDone(this.#e.nowMs)`；
- `src/vm/native.ts` 的 `present?()` 签名跟着改（可选参数，保持兼容）。

**为什么**：修前判据读的是"上一帧时钟"（`clockMs` 只在 `present()` 里刷新，而门在 present **之前**读它）。

### ③ 判据下沉到共享层：`sceneNeedsRender`

`src/renderer/scene/ops.ts` 新增 `sceneNeedsRender(s, clock, dirty) = dirty || scAnimationsPending(s, clock)`。
修前这条判据只活在 `PixiBackend.needsRender()` 里（要求 WebGL/DOM ⇒ **测不到**），
现在能在 Node 里断言，且两个宿主共用。

### ④ ★把"门判据"和"合成判据"拆开（A2 的口径改错了地方）

**怎么发现的**：D1 的证据要求"同一配置下 before/after 定点对照"，脚本
`.tmp/t8-ab.mjs` 用 `git checkout-index -f` 把 11 个 src 文件**按字节**还原成 HEAD（只读索引、不动索引）、
跑 `npm run shot -- --gamestart`、再用备份按字节还原（每次都 `sha256` 校验"字节相等"）。第一轮对照里
**after 侧卡死**：`gate 0x400 WAIT` 后 20 s 不放行、`[present …] meshes={0x19258:255/#000000…} wait=0x400`
三帧数字完全不动、日志停在第 7 张截图。于是临时给 `scAnimationsDone` 加 `TEMP-DIAG` 回调（跑完即删），
拿到真凶：`item 0x18a88(=101000 背景) flags=3 animStart=13580.6 w3:d0/80000` —— **平移窗 dur = 80 000 ms**。

**根因**：A2 把 `scAnimationsDone` 从"窗 0（颜色窗）"扩到"5 个窗"，而这条判据同时被
**门（`0x400`）**与**合成（needsRender）**复用。序章 `src/SN0000.txt:1043` 在 `wait`(`:1048`) 前一条装了
`i220 (global-int f8023) 0 13880 …` = **0x13880 = 80 000 ms** 的平移动画窗 ⇒ 门被钉 80 s（黑屏）。

**改了什么**（`src/renderer/scene/ops.ts`）
- `scAnimationsPending(s, clock)` = mesh 全窗 + draw item **5 个窗**（**合成**口径；`sceneNeedsRender` 用它）；
- `scGateAnimationsDone(s, clock)` = mesh 全窗 + draw item **颜色窗**（**门**口径；`session`/两份 chain 用它）；
- 两个宿主与两份 chain 的 `animationsDone`/`sceneAnimationsDone` 都改读门口径。

**为什么门口径保持"窗 0"而不是"5 窗"**：引擎的门真值不是"扫所有窗"——`sub_407E20`(raw 12762-12786)
返回池挂起位 `_this[11629]`（字节 369348）叠加一个**等待计时器**（起点 369352 / 时长 369356，由 `0x238` 装载）。
完整语义（含 `sub_407EA0` 的强制冻结位 `46512`）**是缺口**，已立 `tickets/T-0024`；
在它落地前保持**用户已验证**的旧口径，并把理由写成注释，不静默改行为。

### ⑤ 判据/负向验证

| 项 | 修前 | 修后 | 判据 |
|---|---|---|---|
| `T-0008` 源码棘轮（`this.waitFlags` 不得再现） | — | 绿 | `test/anim-window-done.test.ts`；**负向实测**：把 `private waitFlags = 0;` 注入 `pixiBackend.ts` ⇒ 守卫变红（`.tmp/neg-t8-ratchet.mjs`，注入后按字节还原） |
| `sceneNeedsRender` 语义 | 无法测（活在 Pixi 里） | 绿 | `test/anim-window-done.test.ts`（脏/动画/跑完后三种） |
| `0x400` 门 `'wait'` 档 | 无守卫 | 绿 | `test/frame-loop.test.ts`（宿主报"没跑完"⇒ 位留着；报了才清位放行） |
| **门 vs 合成两口径** | 同一函数被两处复用 | 绿 | `test/anim-window-done.test.ts` 的 `T-0024` 两条（80 000 ms 平移窗：合成要合成、门要放行） |
| `npm test` 全量 | — | **439 通过** | 见 `npm run verify` |

### ⑥ E4 定点对照（同一份 `emulator.config.json`，唯一变量 = 本轮改动）

`.tmp/t8-ab.mjs`，两次运行背靠背、每个文件按字节还原并校验：

| 指标 | before（HEAD 逐字节还原） | after（本轮） |
|---|---|---|
| `[present …]` 行数 | 66 | 68 |
| `[frame-hold]` 行数 | 82 | 82 |
| `gate 0x400 cleared` | 11 | 11 |
| `gate 0x400 WAIT` | 4 | 4 |
| 日志总行数 | 2395 | 2384 |
| `[reveal] win=8 n/58` 行数 | 323（末 38/58） | 316（末 31/58） |
| 运行状态 | 进 SN0000 正文逐字显现 | 同（差异只是 shot 固定墙钟预算下的抖动） |

★对照的关键证据不是"数字相同"，而是**上一轮 5 窗口径下 after 侧卡在 `wait=0x400` 20 s 不动**；
拆开后 after 侧重新出现"门清了 11 次 + 进正文"的序列，与 HEAD 等价。
