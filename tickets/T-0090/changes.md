# T-0090 · 过程文档（changes.md）

## 2026-09-20

第 1 次变更（2026-09）：装载点清 L2D 运行态。

**改了什么**

- `src/live2d/runtime.ts` 新增 **`l2dResetHost(host)`**（清 `l2dSlots` + `l2dNodes` + `l2dMotionCache`，返回清掉的槽/节点数）—— 唯一的清空入口，注释里写了"为什么装载点必须清"的两条依据。
- `src/vm/handlers/save-slot.ts` 装载点调用它，并记一条 `[slot-load] 清掉上一个执行链的 L2D 运行态：实例槽 N 个 / 立绘节点 M 个`（**清了 0 个不记**，避免每次读档刷无意义日志）。

**判据（都已核）**

- 守卫 `test/slot-load-l2d-reset.test.ts`（2 条）：装载前造 TITLE 那种 node `0x14` + 一个实例槽 + 一条动作缓存 ⇒ 装载后三者都 0 且有一条日志；没有 L2D 时不记日志。
- **E4**（`npm run shot -- --load 79`）：presenter 摘要从 **`l2d={槽1 节点1 可画1 纹理3 缓存60} 批=60`** 变成 **`l2d=无 … 批=0`**；日志出现上面那行（实测"实例槽 1 个 / 立绘节点 1 个"）。截图对比见 `evidence/before-l2d-fix-load-right-after.png`（左上本来是 TITLE 立绘的脸）vs `evidence/after-l2d-fix-load-right-after.png`（脸没了，露出背景）。

**★同一次 E4 又排除了一条**：`after` 截图里**那条"天空碎片阶梯"仍在** ⇒ 它**不是** Live2D。实测依据：读档后绘制项里**一项背景都没有**（25 项全在 `x=1148..1224` = 右侧栏），却仍有大片旧画面 ⇒ 那条阶梯来自**装载点刻意保留的"祖先帧"绘制项**（GUI 日志里读档后仍在画的层 `10..308`，属 TITLE/SYSTEM4）与/或屏上残留像素 —— 也就是 `T-0066`/`T-0072`/`T-0083` 那条主线（帧保留 + 平面/离屏合成的近似），**不是本条**。已在该两票留 note 回链。
