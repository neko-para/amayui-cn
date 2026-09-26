# T-0182 · 调查笔记

## 1. 症状与复现

- 用户口径（2026-09-26）：路径 `TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000`，
  在切换到 SN0000 的过程中 **TITLE 界面在中间错误地闪烁了一帧**；预期是
  「GAMESTART 渐变到黑之后，**从黑**渐变到 SN0000」。
- 复现配方（本机可跑，电气部分见 `evidence/`）：
  ```
  cd app/amayui-emulator
  npm run record -- --scenario tools/scenarios/gamestart.json --out .tmp/flash/gamestart-before.jsonl.gz --centered
  ```
  逐帧 digest 落在 `.tmp/flash/*.jsonl.gz`，诊断日志落在 `.tmp/amayui-emulator.log`。

## 2. 判决链（先取证、后改码）

| # | 证据 | 结论 |
|---|---|---|
| ① | 轨迹 `evidence/transition-frames-before.md`：`f1170`/`f1171`（11820/12012ms）时幕 `0x30d40` **已不在**，而 29 个旧绘制项（含 TITLE 全屏背景 `0xa@L10`、TITLE 立绘节点 `key 0x14`、GAMESTART 配置界面 28 项）**全都还 `flags&1` 且 α>0** | 幕被撤之后确实存在"幕没、旧场景还在、新一屏没建"的中间态，且它**被呈现了** |
| ② | 同轨迹还显示：`f1172`（12038ms）才 `clearDrawContainer`（items/meshes 归 0），`f1173`（12094ms）才是 SN0000 的新黑幕 `0x19258` | 中间态窗口 ≈ 280ms；SC0000 的新幕是"新内容"，理应作为留帧的解除点 |
| ③ | before 日志 `evidence/curtain-drop-no-hold.log`：`detachTexture h=0x30d40 count=1 REMOVE (drawItems=0, meshes=1)` 前后**没有** `[frame-hold] 满屏幕布 … 被撤`；留帧只在 `clearDrawContainer`（`Math.max(hold,60)`）处才武装，即**整整晚了一帧** | 撤幕这条武装路径**没工作** |
| ④ | 静态：`#coversViewportMeshInRange` 要求 `max(xs) >= VIEW_W`，而 `T-0155`（2026-09-25，`HALF_PIXEL`）之后语料满屏幕布 = `(-0.5,-0.5)..(1279.5,719.5)` ⇒ `1279.5 >= 1280` 为假 | 判据**恒假**；这是 `T-0067`/`T-0155` 一族"撤幕那一帧露出下面的界面"的**回归**（`T-0067` 的 2026-09-22 证据日志里同一位置**有**武装行，可作前后对照） |

## 3. 修法（为什么不是"改回旧几何"）

- `T-0155` 的半像素偏移是**读体得到的真事实**（`sub_4A1F00` raw 122235-122238）⇒ 不能回退几何；要修的是**判据**。
- 判据搬进共享层（`drawitem/eval.ts`，与 `itemCoversView` 同族、同纪律：无时钟、无副作用）：
  - `meshFillsViewport`：几何口径 = **与视口的交集面积** ≥ `FRAME_HOLD_COVER_RATIO`（对半像素、对略大/略小的幕都成立）；
  - `meshCoversViewport`：几何 ∩ **此刻 α>0**（窗还开着时，只要任一端 α>0 就算"可能盖着"）；
  - `meshesCoverViewInRange`：`0x1F7` 的"单图元（count≤1）/ 区间（count>1）"分派口径，宿主侧只调它。
- ★**α>0 那半个判据不是顺手加的**：修完几何后重跑，发现 TITLE 的**入场渐显**
  （`TITLE.txt:731-748`：造满屏黑幕 → 300ms 淡到全透明 → `wait` 到窗末 → 撤幕）也武装了留帧 ——
  而撤一块**已经全透明**的幕在画面上什么都没改变（引擎那边也一样）⇒ 会在 TITLE 入场处白冻 60 帧
  （连标题立绘的 Live2D 动作一起冻）。加上 α 判据后，全流程只剩**一次**撤幕武装（就是本票那一次）。
- 宿主侧 `#coversViewportMeshInRange` 现在只有一行委托，并留源码棘轮禁止再手写几何判据。

## 4. after 实测

- 日志（`evidence/curtain-drop-hold-after.log`）：
  ```
  [frame-hold] 满屏幕布 0x30d40 被撤 → 留帧最多 60 帧（等新内容）
  detachTexture h=0x30d40 count=1 REMOVE (drawItems=0, meshes=1)
  … INITGAME / UNITECH / CALCCC / CCINIT / ADDITEM×7 / SETFATE …
  [frame-hold] 跳过本次 present（剩 59 帧）
  [frame-hold] 跳过本次 present（剩 58 帧）
  [frame-hold] clearDrawContainer → 继续留帧（最多 60 帧，等新内容）
  [frame-hold] createMesh 0x19258 → 新内容可见，解除留帧（剩 60 帧）
  ```
  ⇒ 中间那两帧**没有**被呈现；屏上一直是渐黑完成后的那一帧黑，随后交给 SC0000 的不透明黑幕
  （解除时刻的幕色 = `#ff000000`，与留帧中那帧黑完全相同 ⇒ 无缝），再走 SN0000 的 3.6s 淡入。
- 全流程留帧事件只有 3 次 `跳过本次 present`（本票 2 次 + NOVEL 入口 1 次，后者是既有的
  `clearDrawContainer` 路径），TITLE 入场渐显**不再**武装。

## 5. 未决 / 相关（不在本票内）

- `T-0067`（**仍 doing**）是同一族的另一半：脚本"先拆一屏 UI、后重画"时，
  **按区间删绘制项**（`detach-texture <区间>`）**不武装留帧**（只有"删掉满屏 mesh"才武装）⇒
  存档页消失一瞬那类症状在那边。本票只修"撤幕"这一半。
- `T-0057` 的 C13 早已指出：留帧是**宿主启发式**（"backbuffer 不清屏"的正确模型应是共享策略）。
  本票没有改变那个大方向，只是把启发式的**武装判据**从"手写几何"收进共享层并补上 α 半条。
- 撤幕留帧属 **emulator 侧补偿**，不是引擎 opcode 语义 ⇒ 本轮把**引擎那半**（"present 不清后缓冲"）
  补成第二层条目 `present-without-backbuffer-clear`（关掉 `T-0103` 的 D7：撤幕留帧此前在能力台账里没有条目）；
  emulator 侧策略的叙述落在 `docs-new/03-engine/rendering.md` §4（本轮补了 `T-0182` 那一节），
  跨子工程纪律落 `docs-new/00-overview/lessons.md` #24。
- ★**动过被锚定的文件**：`docs-new/03-engine/rendering.md` 插入了 11 行 ⇒ 同步刷新了
  `tickets/T-0172/evidence/anchors.json` 里 16 条文档行号（只改 `line`，`row`/`cites`/`raw` 一字未动），
  `check-anchors.mjs` 46 条全绿。
