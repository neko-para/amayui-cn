# Emulator：版权页「frame 效果」实现（架构性调整 + 已落地）

> 本文件先记录**引擎真实渲染模型**（§1-§6，反编译现场确认），再落地为实现。
> **文首为「已落地实现」状态**（改动文件、最终 present 模型、验证结果、日志）。

---

## 0. 实现状态（已完成，2024 已落地）

### 最终采用的引擎式 present 模型（关键）
- **脚本"一条一条跑到门控止"**：无门控时在 `SAFETY_PER_FRAME(=10000)` 内连续跑指令，命中 `0x400`（`0x21C` 置位）即停。`SAFETY` **只防无门控死循环**（如 TITLE 轮询），**不是 present 触发**（引擎没有每帧指令上限；主循环 `LABEL_216`(21041) 每迭代派发 1 条、循环到门控）。
- **present 由"场景脏 || 动画在播 || 0x400 门控"驱动**（`PixiBackend.needsRender()`，对应引擎 `0x2400 + 场景脏`）：配置类 op（draw-texture/set-texture/set-vertex-color(-alpha)/set-draw-color(-alpha)/create-mesh/release-texture/play-movie/set-wait-flag/scene-change）置 `sceneDirty`；`0x400` 动画等待时**每帧 present**（动画由墙钟 `performance.now()-wallStart` 单调推进）。
- **时钟 = 墙钟毫秒**（等价 `this[46500]` = 主循环每帧写入 `timeGetTime()`，非帧计数器）。
- **场景切换清图**：`#onSceneChange` 清空 drawItems/meshes 并置脏（确保新场景至少 present 一次）；`clockMs` 不归零（新对象各自 lock 起点）。

### 改动文件
| 文件 | 改动 |
|---|---|
| `src/vm/native.ts` | `NativeBridge` 加类型化方法（configureDrawItem/bindTexture/createMesh/setVertexColor(-Alpha)/setDrawColor(-Alpha)/setWaitFlag/releaseTexture/playMovie/present/startFrameLoop）；`KNOWN_DRAW_ITEM_FLAGS=0b011`、`KNOWN_MESH_FLAGS=0b011`、`UnknownFlagError`、`assertFlags`；`StubNative` 补齐 |
| `src/vm/engine.ts` | 加 `waitFlags`（门控条件） |
| `src/vm/ops.ts` | `0x320/0x202/0x203/0x322/0x323/0x1f8/0x1fa/0x20f/0x21c/0x1fb/0x1f9` 从 `stubSubsystem`/未实现 改为**类型化 handler**（`readIntOperand` 解析、`assertFlags`） |
| `src/renderer/pixiBackend.ts` | 持久场景图（drawItems/meshes）；逐帧 `present()` 合成；动画求值（`#calcDiffuse`/`#itemAlpha`）；墙钟；`sceneDirty`/`needsRender`；严格 flag |
| `src/renderer/renderer.ts` | 引擎式循环（跑到门控 + needsRender present）；文件日志（批次+同步兜底） |
| `electron/main.ts` / `electron/preload.ts` / `src/renderer/ipcFileSource.ts` | `log-line`/`log-line-sync` IPC → 追加 `E:\Games\Eushully\天結\.tmp\amayui-emulator.log` |

### 验证结果（用户实测）
- LOGO 版权页：**背景先渐显 → 文字稍后渐显（阴影随文字）→ 停留 ~5s → 整页渐隐纯黑**，正常。movie 未接，自动跳过。
- LOGO→TITLE：**不再"闪现→黑→淡入"**（修复 = 用「跑到门控 + needsRender present」替代固定 QUOTA，避免 scene 配置跨 burst 被 present 看到中间态）。
- TITLE 自身淡入正常。

### 诊断日志
`.tmp\amayui-emulator.log`：逐行 step（opcode/ip/kind）、`[preload]`/`image` 结果、`configureDrawItem/createMesh/set*Color` 配置、`item 不存在（现有 item: ...）`、`=== gate 0x400 WAIT/cleared ===`、每 500ms `[present ...]` 场景快照（item/mesh alpha + slotTex）。主进程启动即建文件写头；renderer 批次落盘 + `pagehide`/`beforeunload` 同步兜底不丢尾。

---

## 1. 结论先行（架构判断）

当前 `PixiBackend` 是**按指令推测渲染**（`drawTexture` 一进来就 `addChild` 画 Sprite；`setTexture` 立即绑槽）。这**只对"静态布局"成立**（标题菜单一次性贴图），但**不匹配引擎真实渲染**：
- 引擎是 **"指令配置对象 + 每帧 present 合成"** 的**延迟/分帧**模型；
- 动画（mesh 渐显 / 文字 alpha 渐显）在**每帧 present 时**对 `this[46500]`（墙钟）求值，**与指令流并行**；
- 脚本推进被 **`effect_flags` 门控**（如 0x400 动画等待）**暂停**，由渲染循环按时间/挂起旗标放行。

⇒ 需要 **3 点架构性调整**（见 §3），且**必须严格拒绝未知 flag**（见 §7）。

---

## 2. 引擎真实渲染模型（现场确认，engine/天结_unpacked.exe_utf8.c）

### 2.1 配置 / 渲染解耦
- **配置**（指令）：`draw-texture`(0x1fb)、`set-texture`(0x1f9)、`create-mesh`(0x320)、`set-vertex-color(-alpha)`(0x322/0x323)、`set-draw-color(-alpha)`(0x202/0x203) **只改对象字段**（`sub_4ACE50`/`sub_4AD0C0`/`sub_4ACF60`/`sub_4AE2C0`/`sub_4AE330`），不立即出像素。
- **渲染**（present）：`sub_4B4040`(134702) → `sub_4B06D0`(132387) → `sub_4AF1C0`(mesh) / `sub_4AEEA0`(图像)，**逐帧对整个对象图合成**到 backbuffer。

### 2.2 动画在"每帧渲染"求值，不是指令求值
- mesh：`sub_4AF1C0`(131491-131501) 读 `this[46500]` 算 `(clock-start)/count` → `sub_4A2050`(CalcDiffuse)。
- 文字 draw-item：`sub_49A300`(115116) 读 `this[46500]` 算 `(clock-start-delay)/count` → 改 item+96。
- 脚本本身已执行完（ip 停在 0x400 等待），动画在后台逐帧播。

### 2.3 门控局部循环 = `effect_flags` 门控级联状态机（"奇怪"所在）
主循环（20422 起）是**嵌套 `while(1)` 级联**，每层检查 `effect_flags` 的一个位（20594-20633）：
```
v17 = effect_flags(_this+699204)
if (v17 == 0)                       → 无门控：默认相位 = 推进脚本下一帧/指令
if (v17 & 0x400000)                 → 等消息 GetMessage
if (v17 & 0x1000000)                → 处理 0x2000 相关
if (v17 & 0x2000)                   → 处理 0x2000 对象
if (v17 & 0x40)                     → sub_408F10
if (v17 & 0x400)  (20934)           → sub_407E20(pool) 挂起？→ 停脚本；动画完才清 0x400 放行
if (v17 & 0x8000000)                → sub_411900 + 清 scene + present(sub_4B4040)
默认（无 gate）                      → 派发脚本下一条
```
每层若命中：要么**等待**（消息/动画），要么**处理**；未命中则 `break` 落到下一层。⇒ 这是一个**按 effect_flags 挑选"该做哪件事"的状态机**，而不是"update→render→指令"的线性管线。

> "奇怪"因它**交织**了：时钟推进 + present + 门控挂起 + 脚本派发在同一循环里，且**present 是条件性**（如 `sub_40BE10(pool)==1 || v90==1` 才 present，20581）。这跟"每帧必 update+render"的常识不同。

---

## 3. 需要的 3 点架构性调整

将 `PixiBackend` 从"按指令推渲染"改为**引擎式的"配置→每帧合成 + 门控派发"**。

### (a) 持久场景图（SceneGraph）
- 指令只**配置/改对象**（draw-item、mesh、纹理槽、颜色），**不立即出像素**。
- renderer 持有两张持久表：`drawItems`、`meshes`，以句柄为键。
- 原"每指令 addChild 一个 Sprite"改为"改图；present 时按 layer/handle 排序合成"。

### (b) 每帧 present（render loop）
- 新增**渲染帧循环**（Pixi `ticker`/`requestAnimationFrame`），每帧：
  1. `clockMs = now - t0`（单调墙钟，等价 `this[46500]`）；
  2. 对每个有动画窗的对象求值（`calcDiffuse`/`drawItemAlpha`）；
  3. `present()`：清空 `drawRoot` → 按 LAYER 升序画 draw-items（`spr.alpha = itemAlpha/255`）→ 按 handle 升序画 meshes（黑覆盖层 `alpha = calcDiffuse>>24 / 255`）。
- **与 VM 指令解耦**：不再"每指令渲一次"，而是"每帧重绘整个图"。

### (c) 门控派发（script dispatch gating）
- VM 脚本推进改为**帧循环驱动**：每帧该相位先看 `effect_flags`/场景状态。
  - `0x400` 动画等待：若仍有动画对象未完成（或 `_this[369348]` pending）→ **不推进脚本 ip**，但**继续 present**（让动画播）。
  - 等待对象完成（`clock >= start+delay+count` 全完成且 pending 清）→ **清 0x400、推进下一指令**。
- 其余门控（0x40/0x8000000 等）按需最小实现；版权页只关心 0x400。

---

## 4. 状态模型

```ts
interface AnimWindow { start: number; delay: number; count: number; started: boolean; }
interface DrawItem {
  handle: number; layer: number; src:{x,y,w,h}; dst:{x,y};
  flags: number;                 // 仅 bit0/bit1 被识别；其余必须抛错
  from: number; to: number;      // +96/+100 (ARGB)
  anim?: AnimWindow;             // +52(start)/+56(delay)/+76(count)
}
interface Mesh {
  handle: number; flags: number; // 仅 bit0/bit1
  state0: number; state1: number;
  anim?: AnimWindow;
}
```

---

## 5. 动画求值（每帧）

```ts
function calcDiffuse(m: Mesh, clock: number): number {
  const w = m.anim!;
  if (w.count <= 0) return m.state1;
  if (clock >= w.start + w.delay + w.count) return m.state1;
  if (clock <= w.start + w.delay) return m.state0;
  const a = (clock - w.start - w.delay) / w.count;
  return lerpArgb(m.state0, m.state1, a);
}
function drawItemAlpha(it: DrawItem, clock: number): number {
  if (!(it.flags & 2)) return 255;               // 无动画 → 不透明
  const w = it.anim!;
  if (!w.started) { w.start = clock; w.started = true; }
  if (clock >= w.start + w.delay + w.count) return (it.to >> 24) & 0xFF;
  if (clock <= w.start + w.delay) return (it.from >> 24) & 0xFF;
  const a = (clock - w.start - w.delay) / w.count;
  const fa = (it.from >> 24) & 0xFF, ta = (it.to >> 24) & 0xFF;
  return Math.round(fa + (ta - fa) * a);          // 只插 alpha（RGB 恒白）
}
```

---

## 6. 渲染合成（`PixiBackend.present()`）

```
clear drawRoot;
for (it of drawItems sorted by layer asc, handle asc)
   Sprite(裁剪 src)——spr.alpha = drawItemAlpha(it, clock)/255
for (m of meshes sorted by handle asc)
   黑覆盖层 Sprite(unit 全屏)——spr.tint=0x000000, spr.alpha=(calcDiffuse(m,clock)>>24)/255
```
mesh#1（state0 0xff→state1 0x00）alpha 1→0 淡出=揭示；mesh#2（0x00→0xff）alpha 0→1 淡入=整体淡出。文字层 image alpha（0→255）渐显，阴影随纹理自身 alpha 保留。

---

## 7. 严格 flag 校验（关键）

**准则**：配置了**未逐字段解码**的 flag 位 → **立即抛错中断**，绝不静默忽略。

```ts
const KNOWN_DRAW_ITEM_FLAGS = 0b011;  // 仅 bit0 存在 | bit1 颜色动画
const KNOWN_MESH_FLAGS       = 0b011;  // 仅 bit0 存在 | bit1 颜色动画
class UnknownFlagError extends Error {
  constructor(kind: string, handle: number, flags: number, unknown: number) {
    super(`unknown ${kind} flag 0x${flags.toString(16)} @ ${handle.toString(16)} (bit 0x${unknown.toString(16)}) — abort`);
  }
}
function assertFlags(kind, handle, flags): void {
  const mask = kind==='drawitem' ? KNOWN_DRAW_ITEM_FLAGS : KNOWN_MESH_FLAGS;
  const unknown = flags & ~mask;
  if (unknown !== 0) throw new UnknownFlagError(kind, handle, flags, unknown);
}
```

- **写路径**（draw-texture/ set-draw-color / set-vertex-color-alpha / create-mesh setter）：先 `assertFlags`，只允许置已知位。
- **读路径**（`drawItemAlpha` / `calcDiffuse` / present 前）：`assertFlags`。
- **bit2（draw-item `&4`）**：引擎有检查（`sub_4AEEA0` 131368 → 调 `sub_49BCC0` 额外分支），但我们**未逐字解码 `sub_49BCC0` 语义** ⇒ 按"不认识的 flag"**拒绝**（版权页指令只置 bit0/bit1，故不会误伤）。若日后确需，再解码 bit2 并纳入掩码。
- 与 `NotImplementedOp`（未实现 opcode 硬报错）互补：**opcode 未实现** 与 **flag 未识别** 两级中断，杜绝静默误渲染。

---

## 8. 落地入口（已完成；实现见上 §0，以下为原始规划）

1. **M5-arch 场景图 + 帧循环**：Pixi 加 `drawItems/meshes` 表 + `ticker` 帧循环（clock++、`present()`）。
2. **M5-configure 类型化 handler**：`ops.ts` 把 0x320/0x202/0x203/0x322/0x323/0x1fa/0x20f/0x21c 从 `stubSubsystem` 改为"读 op → `assertFlags` → 建/改对象 → 画到图"。
3. **M5-anim 动画求值**：`calcDiffuse`/`drawItemAlpha` 接入 present。
4. **M5-gate 门控派发**：帧循环按 `0x400` + 动画完成度决定是否推进脚本 ip。
5. **M5-strict**：`assertFlags` 全路径 + `UnknownFlagError` 单测。
6. **验证**：`LOGO.txt` 应现"背景先渐显→文字稍后(阴影随文字)→停留→整页渐隐纯黑→切影片"；对 `drawItemAlpha(300,300,...)` 与 mesh#1 `[0,500]` 数值断言。

---

## 9. 备注：此处"保守建议"已被实际实现取代
> 原始建议是"保留静态路径 + 新增动画路径"（减少侵入）；**实际采用统一模型**：所有 draw-item/mesh 都进同一场景图、走同一 `present()`（静态对象 alpha 恒 255），渲染与 VM 彻底解耦（VM 配置 + 门控；渲染帧循环独立跑）。故不再区分静态/动画两条路径。

架构调整是**有一定侵入性**的：现有"按指令推渲染"也用于标题菜单等静态场景。若一次性全改可能影响现有 M0–M3。建议：
- 保留 **静态 draw-texture 兼容**（无动画窗的对象仍可按"配置+每帧画"处理，结果等价）；
- **新增**动画对象路径（flags&1？&2 → 进动画求值）；
- 先只在版权页/动画场景启用"帧驱动 present"，静态场景走同一 present（只是 alpha 恒定 255）——统一模型，减少特例。
