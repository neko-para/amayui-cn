# T-0182 · 变更记录

## 第 1 次变更（2026-09-26）：撤幕留帧的**武装判据**搬进共享层并补上"此刻真的盖着"这半条

### 改了什么

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/renderer/drawitem/eval.ts` | 新增 `meshFillsViewport`（几何：与视口交集面积 ≥ `FRAME_HOLD_COVER_RATIO`）、`meshCoversViewport`（几何 ∩ 此刻 `state0` α>0；窗还开着时任一端 α>0 算"可能盖着"）、`meshesCoverViewInRange`（`0x1F7` 单图元/区间的分派口径）。三个都是**无时钟、无副作用**的纯函数 |
| `app/amayui-emulator/src/renderer/pixiBackend.ts` | `#coversViewportMeshInRange` 从"手写 `min(xs)<=0 && max(xs)>=VIEW_W`"改为一行委托 `meshesCoverViewInRange(this.scene.meshes.values(), handle, count, VIEW_W, VIEW_H)`；注释写明 T-0182 的成因与"不许在这里手写几何" |
| `app/amayui-emulator/test/frame-hold-cover.test.ts` | 新增 4 个用例：几何口径取值表（含**判决用例** `-0.5..1279.5` ⇒ 铺满）、"此刻盖着"取值表（全透明 ⇒ 不算）、区间分派口径、源码棘轮（必须委托共享层 + 不许再出现 `Math.max(...xs) >= VIEW_W`） |
| `app/amayui-emulator/test/mesh-vertex-quad.test.ts` | E3 里把"链路里那块幕的**真实 rect**"接进共享判据（`meshFillsViewport(quad,1280,720) === true`）⇒ 任一侧换口径即红 |
| `docs-new/03-engine/rendering.md` | §4 撤幕留帧那条补一子条：判据只留共享层一份、几何口径 = 交集面积、α 半条为什么必要、T-0182 的成因 |
| `docs-new/00-overview/lessons.md` | 新增 #24「硬写量纲/几何口径的判据会被相邻订正静默打成恒假」+ 三条纪律 |

### 行为怎么变（before → after）

- **before**：撤掉满屏幕布时 `#coversViewportMeshInRange` **恒假**（`1279.5 >= 1280`）⇒ 不武装留帧 ⇒
  批边界落在"幕已撤、旧图元未清、新一屏未建"中间时，把 **TITLE 背景 + GAMESTART 配置界面**如实画出
  （用户看到的闪帧）。留帧只在 `0x1F6 clearDrawContainer` 处才武装 —— 整整晚了一帧。
- **after**：撤掉**此刻真的盖着屏幕**（几何铺满 ∩ α>0）的幕 ⇒ 武装留帧 ⇒ 中间帧被跳过，
  直到 SC0000 的新幕 `0x19258`（`state0 = #ff000000`）可见才解除 ⇒ 屏上序列 = 渐黑完成的那帧黑 → 新黑幕 → SN0000 淡入。
- 撤一块**已全透明**的幕（TITLE 入场渐显）**不再**武装（before 的旧口径也不会武装，因为那时判据恒假；
  若只修几何不补 α，则会在那里白冻 60 帧 —— 本票的中间版本实测到过这一点，故补上）。

### 判据（本票 acceptance 的可核对形式）

1. 真跑日志出现 `[frame-hold] 满屏幕布 0x30d40 被撤 → 留帧最多 60 帧`（`evidence/curtain-drop-hold-after.log` L581）；
2. detach 之后紧跟 `[frame-hold] 跳过本次 present`，直到 `createMesh 0x19258 → 新内容可见，解除留帧`（同文件 L601/L604/L614）；
3. 单元/源码棘轮 7 个用例全绿（`npx tsx --test test/frame-hold-cover.test.ts`）；
4. 真语料 E3 断言通过（`npx tsx --test test/mesh-vertex-quad.test.ts`）；
5. `npm run verify` 全绿 = **typecheck ×3 + 1726 pass / 0 fail / 2 skipped + `check:dead-writes`（无新增死写）**（2026-09-26 收口轮实测；首轮曾因 `doc-model.test.ts` 的 T-0172 行号棘轮红 —— 那是"改文档没刷锚点表"，已按下表修好）。

### 辨别力（机械证明）

把 `meshFillsViewport` 的实体临时替换成旧口径（`x0<=0 && y0<=0 && x1>=viewW && y1>=viewH`）后：
`★T-0182：meshFillsViewport …` 与 `★T-0182：meshesCoverViewInRange …` **两条都红**（其余 4 条绿）；
还原后 7/7 绿。⇒ 新守卫对"这个回归"有辨别力，不是事后补的橡皮图章。

### 顺带的台账/文档同步（同一轮）

| 文件 | 改动 |
|---|---|
| `analysis/engine-capabilities.json` | 新增条目 `present-without-backbuffer-clear`（渲染；`sub_4B4040` raw 136785 / `sub_4AAF90` raw 137026 两处整屏 `ClearTarget` 都被恒 0 的 `Scene+46460` 位守卫，其余调用点先 `sub_4A50C0(层)` 切到离屏 scratch 层 ⇒ **引擎 present 不清后缓冲**）。`whySilent` = 撤掉的项留到被覆盖为止、宿主整帧重合成就会把引擎从未呈现的中间态画出来；`emulator` = `partial`/E3/guard=`test/frame-hold-cover.test.ts`。★这条正是 `T-0103` 的 **D7** 登记的"未建模能力"（撤幕留帧在能力台账里没有条目）⇒ 本轮补上 |
| `docs-new/03-engine/engine-capabilities.md` | 由 `build-capabilities.mjs` 重生成（145 条） |
| `tickets/T-0172/evidence/anchors.json` | ★**动过被锚定的文件**：`docs-new/03-engine/rendering.md` 插入 11 行 ⇒ 那张表里 `rendering-*` 的 16 条文档行号整体 +11（这是 T-0172 的"文档行号 ↔ 真源"契约，`doc-model.test.ts` 的 B7-B 棘轮读它）。只改 `line`、**没改任何 `row`/`cites`/`raw`**；`node tickets/T-0172/evidence/check-anchors.mjs --quiet` ⇒ 46 条 0 问题 |
| `tickets/T-0181/ticket.json` | **顺带副作用（申报）**：跑 `fix-evidence-lines.js --any --write` 时，工具按其唯一命中给 T-0181 的 3 条证据补了 `line`（该票本来没写行号）。**只加 `line`**，未改 `anchor`/`note`；`tickets.js --validate` 180 张全过 |

### 残余

- 撤幕留帧仍是**宿主启发式**（`HOLD_MAX_FRAMES=60` 上限、解除点只有"新内容可见"那一族），
  与"引擎 backbuffer 不清屏"的正确模型之间的差距见 `T-0057` 的 C13；本票不改变那个方向。
- 同一族的另一半（**按区间删一屏 UI 不武装**）在 `T-0067`（仍 doing）。
