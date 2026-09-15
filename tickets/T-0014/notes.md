# T-0014 · 过程文档（notes.md）

## 2026-09-15


## 研究（2026-09，动手前）

### 结论：**票面已过期——四条里三条在 B1/T-0008 时已经落地**，只剩第 4 条（纯测试侧整理）。
（纪律提醒：已经做完的事不补票，所以这里只把"哪三条已完成、剩哪条"写清楚，然后**缩验收**。）

### 逐条核查
| # | 票面要求 | 实况 | 处置 |
|---|---|---|---|
| 1 | 删 `interpreter.run()` / `RunResult` | **已删**：`src/vm/interpreter.ts:208` 的注释记录了这次删除；`grep -rn "\.run(" src/` 无命中 | 销掉 |
| 2 | 删 `HeadlessScene.waitFlags` | **已删**：`src/renderer/headlessScene.ts:487-492` 的 `setWaitFlag(_mask)` 是空实现 + 注释"修前这里写 `this.waitFlags`，全文件**没有任何读者**" | 销掉 |
| 3 | 删 `PixiBackend` 的 `waitFlags` 镜像 | **已删**：`src/renderer/pixiBackend.ts:667-675` 只标脏 + 日志（`present(nowMs, waitFlags)` 的形参仅作诊断）。且**有源码棘轮守卫** `test/anim-window-done.test.ts`（禁 `this.waitFlags` 赋值/读取/字段声明） | 销掉（守卫已在） |
| 4 | 删 `Engine.pickHoverLabel()` | **仍在**：`src/vm/engine.ts:1097-1101`；全仓**只有测试**调它（`test/adv-msgwin.test.ts` 9 处 + `test/route-dispatch.test.ts` 6 处；`src/` 零调用者） | ★本票剩余工作 |

### 第 4 条的实况与做法
它与**产品路径逐字重复**两行：`engine.ts:994-995`（`serviceAdvanceWait` 内）就是
`if (!this.hoverDispatchAllowed()) …; panel.nextHoverLabel()`。
⇒ 删它**不是**纯死代码清理：那 15 条断言里有对 `hoverDispatchAllowed()` 门控与 `sub_403E70` 两段式
（先发旧项离开、下一帧发新项进入）的覆盖，必须保住。**推荐做法 = 把门面挪到测试侧**：
```ts
// test/harness.ts（新增，4 行）
export function pickHoverLabel(e: Engine): number {
  if (!e.hoverDispatchAllowed()) return -1;
  const l = e.routes.nextHoverLabel();
  return l === 0xffffffff ? -1 : l;
}
```
两个测试文件里 `e.pickHoverLabel()` → `pickHoverLabel(e)`（15 处机械替换，import 改到 harness）；
`engine.ts` 删掉该方法（22 行含注释），并把注释里"见 `pickHoverLabel` 的汇编核对"改指 `hoverDispatchAllowed`。
判据：`adv-msgwin`/`route-dispatch` 条数不变且全绿、`tsc` 干净、`src/` 里 `grep pickHoverLabel` 为 0。

### 建议的状态处理
- `acceptance` 缩到第 4 条（1–3 写成"已完成，见 notes"）；
- `why` 补一句"票面写于 B1 之前；1–3 已由 B1/`T-0008` 完成，本条只剩测试门面";
- `priority` 可降 **P3**（无行为风险、只在 test/ 里动）；`area` 保持 `emulator/deadcode` 或改 `emulator/test`。
- ★注意：动完第 4 条后，本票 evidence 里 `pickHoverLabel` 这个锚点会消失 ⇒ 必须同步改锚点（换 `hoverDispatchAllowed`）。
