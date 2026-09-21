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
