# T-0090 · 过程文档（notes.md）

## 2026-09-20


## 2026-09-20 收口

- **实现**：`l2dResetHost(host)`（清 `l2dSlots`/`l2dNodes`/`l2dMotionCache`）+ 装载点调用 + 日志 `[slot-load] 清掉上一个执行链的 L2D 运行态：实例槽 N 个 / 立绘节点 M 个`。
- **守卫**：`test/slot-load-l2d-reset.test.ts`（2 条：造出 TITLE 那种 node 0x14 + 一个实例槽 + 一条动作缓存 ⇒ 装载后全为 0 且有日志；无 L2D 时不误报）。
- **E4**：`npm run shot -- --load 79` 的读档画面不再出现上一个画面的立绘/天空件；对照截图归档在 `evidence/`（`before-l2d-fix-load-right-after.png` / `after-l2d-fix-load-right-after.png`）。
- ★**如实登记的副作用**：对「存档时场景本来就有立绘」的槽，立绘同样会没 —— 但引擎也救不回来（L2D 运行态不在存档 body 里，body 只有帧镜像/三池/三张 ip 表/槽记录/绘制项清单），属既有 `SLOT_GAPS` 缺口，不是本条引入的。
- ★**同一次实测排除一条**：修完 L2D 后那条「天空碎片阶梯」**仍在** ⇒ 它不是 Live2D，而是**上一屏绘制项残留**（已由 `T-0083` 的 `restoreDrawItems` 解决，见该票 `changes.md`）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

同族的 T-0072/T-0083 是**绘制项**那条路；本条是**Live2D**那条路（同一类泄漏、不同容器）。
