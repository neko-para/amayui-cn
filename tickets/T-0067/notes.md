# T-0067 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

复现时请把控制面板里保存动作前后约 30 行日志发我（含 frame-hold / present / detachTexture 行）—— 那能直接定位是哪一步解除了留帧。

## 2026-09-21

## 2026-09-21

## 轮 10：代码面取证（本机可做的部分做完了）+ ★结论：**别打那个"明显"的补丁**

### 1. 事实（读码确证，逐条带行号）

| 事实 | 位置 |
|---|---|
| 留帧的**唯一置位**是"满屏 mesh 幕被 `detach-texture` 撤掉" | `pixiBackend.ts` 的 `detachTexture` → `#coversViewportMeshInRange` → `#holdFrameAfterCurtainDrop`（:780-793 / :828-831） |
| 留帧期间 present **整帧跳过**（不动舞台 ⇒ 屏上保留上一帧） | :1400-1402（上限 `HOLD_MAX_FRAMES = 60`，:128） |
| `clearDrawContainer` **续期**留帧（`Math.max`） | :1032-1033 |
| `createMesh` / `setVertexColor` 用**"新内容可见才解除"**（`state0` 的 alpha > 0） | :393 / :747 → `#releaseFrameHoldIfVisible`（:851-859） |
| ★`configureDrawItem`（每条 `draw-texture`）**无条件解除** | :359 |
| 新建绘制项的默认色 = **`from = 0xFFFFFFFF`**（alpha 255 ⇒ 天生"可见"） | `renderer/drawitem/model.ts`（`newItem` 的 `from`） |

### 2. ★为什么**不**把 `draw-texture` 换成"可见才解除"（看似一致的补丁）

- 表面上它和另两处不一致，改齐很自然；但**对新建项它是惰性的**（`from` alpha 恒 255 ⇒ 一律"可见"⇒ 行为不变）。
- 唯一会变的是"重新配置一个 **alpha 已被淡到 0** 的旧项"：那时留帧会**继续**保持 ⇒ 屏上会多留几帧
  **已经被撤掉的幕**。也就是说这个补丁的净效果是"把'露出半成品'换成'幕残留'"——
  正是 `plan-2026-09.md` §RF-C 警告的「hold 与 clear 互相救场、调参只会让症状搬家」。
- ⇒ **不打这个补丁**。票据保留"开放"，等真正的机制修（见下）。

### 3. 真正的机制（本票剩下的唯一问题）

引擎的 present **从不清后备缓冲**（`ClearTarget` 被恒 0 的 `Scene+46460 & 1` 守卫）⇒ 旧像素一直在，
新图元**画在它上面**；emulator 每帧从**模型**整屏重组 ⇒ "脚本撤掉 UI、稍后才重画"的中间帧被如实呈现。
⇒ 忠实等价物 = **留帧期间把上一帧当作底板合成**（模型叠在旧像素上），而不是"整帧跳过"。
这是一个**呈现层设计变更**（T-0083 RF-C 的那条线），要动 `present()` 的底图与截图基线。

### 4. 为什么本轮到此为止（**证据缺口在 E4，不在代码**）

- 判据 1 要求的"没有一帧展示 UI 缺失"只能在真界面（Pixi/Electron）上判定；
  **headless 宿主没有留帧机制**（`HeadlessScene` 不 present）⇒ 本机跑 `slot-load-*`/`save-slot-*` 那几条
  E3 链**拿不到 `[frame-hold]` 行**。这正是原始 notes 那句"请把控制面板保存动作前后约 30 行日志发我"的原因。
- ⇒ 需要的输入（二选一）：**①** 用户 GUI 复现时的 `[frame-hold]`/`present` 日志 30 行（能直接看出是哪一步解除的）；
  **②** 允许做 §3 的呈现层变更（底图合成）并接受用 E4 截图对照验收。
- ★不要再用"再调一下 hold 参数"的方式推进本票。

## 2026-09-21

## 轮 11：**输入 ① 拿到了**（真跑日志）+ 修掉"被一笔 256×128 贴片解除留帧"这个**已证的缺陷**

### 1. 证据（新归档，`.tmp/` 里按 T-0057 R6 纪律搬进票据）

`tickets/T-0067/evidence/transition-frame-hold.log`（来源 `.tmp/amayui-emulator.log`，2026-09-22 00:48 的一次完整
boot 会话；锚行 = 原日志第 2337 行）。**原文顺序**（`0x73 -> SC0000.BIN` 那一刻）：

```
[call-script] 0x73 -> SC0000.BIN (24501 instr)
clearSlotRecords：丢掉 1 条 槽→imgid 记录（保留纹理对象/画布）
[frame-hold] 满屏幕布 0x19258 被撤 → 留帧最多 60 帧（等新内容）      ← 留帧按设计启动
detachTexture h=0x19258 count=1 REMOVE (drawItems=0, meshes=1)
setDrawPivot h=0x18b00 (640,720,0) [建空项]
bindTexture imgid=0x76 slot=44
image 76 -> AE910AA.AGF (256x128)
[frame-hold] draw-texture → 解除留帧（剩 60 帧）                  ← ★元凶：这一笔只有 256×128
configureDrawItem h=0x18b00 layer=101120 (0,0,256x128)
…（此后才 createTexture slot=64 1280x720 + setTransition id=0x18b02 dur=1500）
```

⇒ 原 §4 的输入缺口 ① 补齐：**解除留帧的就是 `configureDrawItem` 里那条无条件的 `#releaseFrameHold`**，
而触发它的图元只有 **256×128**（转场贴片，且 `setTransition` 还没执行）。

### 2. 为什么这次不是 §2 里被打回的那个补丁

- §2 打回的是"**可见才解除**"：对新建项**惰性**（`from = 0xFFFFFFFF` ⇒ 恒可见 ⇒ 行为不变），
  只会把"露出半成品"换成"幕残留"。
- 本轮改的是"**铺满一屏才解除**"（判据 = `itemCoversView`：`flags&1` 且 **源矩形面积 ≥ 0.9×视口**）。
  它不是惰性的 —— 判决实验就是日志里那一笔：256×128 = 视口的 **3.6%** ⇒ 继续留帧 ✔。
  这正是"按证据改判据"，不是 §4 警告的"再调 hold 参数"。
- ★**它不是 §3 的完整修**（底图合成），残余差异已写明（见 §4）。

### 3. 实现

- `renderer/drawitem/eval.ts` 新增 **`itemCoversView(it, viewW, viewH, ratio = FRAME_HOLD_COVER_RATIO)`**
  + 常量 `FRAME_HOLD_COVER_RATIO = 0.9`：判据**无时钟、无副作用**（只读建项时的 `flags`/`srcW`/`srcH`）
  —— 不能拿 `itemSrcRect(it, clock)`（那会求值 flipbook 窗并**锁存窗起点**，`T-0004` 的 G3 实测教训）。
- `renderer/pixiBackend.ts`：`configureDrawItem` 的无条件 `#releaseFrameHold('draw-texture')`
  → **`#releaseFrameHoldIfCovers(...)`**（只在"铺满一屏"时解除，并打印覆盖面便于 E4 归因）；
  `HOLD_MAX_FRAMES = 60` 的上限**保留**（防"新内容一直铺不满"永久冻帧）；
  `createMesh`/`setVertexColor`（幕那一路，本来就用 `#releaseFrameHoldIfVisible`）与 `copyScene` 的路径**不动**。
- 为什么幕用"可见"、`draw-texture` 用"覆盖面"：幕是**一整块盖住屏幕**的东西（颜色一落地即新内容建立），
  而 `draw-texture` 可能是**任何大小的贴片**（转场贴片/图标/数字条）⇒ 必须看面积。

### 4. 守卫与残余（**诚实边界**）

- 新增 `app/amayui-emulator/test/frame-hold-cover.test.ts`（3 条）：①判据取值表（满屏真 /
  **256×128 假** / 阈值 1152×720 恰好真 / flags=0 假 / 零宽·负高假 / 视口未就绪假）；
  ②**无时钟无副作用**（跑一次后 flipbook 窗字段逐字不变）；③**源码棘轮**（`configureDrawItem` 不许再出现
  无条件的 `#releaseFrameHold('draw-texture')`、必须走 `#releaseFrameHoldIfCovers` 且判据是
  `itemCoversView(it, VIEW_W, VIEW_H)`、`HOLD_MAX_FRAMES` 保留）。
  辨别力两次机械证明：①改回无条件解除 ⇒ 源码棘轮红（点名"T-0067 的元凶就是它"）；
  ②把判据改成恒真 ⇒ 取值表红（点名"256×128 的转场贴片不算铺满一屏"）；两次都还原后 3/3 绿。
- ★**残余（本票不结的原因，两条都要写清）**：
  ① 与 §3"底图合成"的差异 —— 现在留帧期间是**跳过 present**（屏上保留上一帧），而引擎是"旧像素 +
  新图元叠上去"⇒ 留帧窗口里**小于 90% 的贴片会被推迟**（最多 60 帧）而不是叠在旧画面之上。
  完整的忠实等价物仍是 RF-C 那条线（把上一帧当底板合成，要动 `present()` 与截图基线）。
  ② 判据 1（"存档全流程没有一帧 UI 缺失"）只能在 **真界面**判定：headless 宿主没有留帧机制
  （`HeadlessScene` 不 present）⇒ 需要 Electron 界面复跑存档流程并取 `[frame-hold]` 日志/截图。

### 5. ★残余 ② 的通道已打通（2026-09-22，`T-0029` 轮 12 的副产物）

本机能真跑 Electron：`npm run shot -- --gamestart --name t0067-save`（分段截图）与
`npm run record -- --scenario <spec> --out .tmp/x.jsonl --centered` + `npm run replay -- ../../.tmp/x.jsonl`
（headless 逐帧相等）都验证可用。★`record` **必须加 `--centered`**（默认贴边档把窗口挪到屏幕外 ⇒
`record.cjs` 报"未找到游戏窗口"）；`--out` 按仓库根解析、`replay` 的轨迹路径按包目录 cwd 解析。
⇒ 缺的只剩"**存档流程的输入编排**"：现有 `tools/scenarios/gamestart.json` 只到 SN0000 第一页，
需要一条能走到存档页 → 选槽 → 确认的 spec（`T-0061`/`T-0063` 的点击坐标可复用），拿到那一路的
`[frame-hold]` 日志即可判定"是 `configureDrawItem` 之外的哪一笔解除留帧"。
