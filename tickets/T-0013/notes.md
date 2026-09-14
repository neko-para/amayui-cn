# T-0013 · 过程文档（notes.md）

## 2026-09-13

完成：① NativeBridge 增 needsRender?/animationsDone?(nowMs)/preloadImage?（都带"缺了会怎样"的说明）；② BRIDGE_METHODS 加三名并**导出**；③ PixiBackend.sceneAnimationsDone → animationsDone（与桥同名）；④ RendererSession.#native 类型由 PixiBackend 改为 NativeBridge（会话只能用桥声明过的能力，编译期保证），调用改可选式（needsRender 缺席 ⇒ 照常合成；animationsDone 缺席 ⇒ 门继续等）；⑤ 两条宿主能力面守卫（桥方法差异 = DECLARED_HOST_DIVERGENCE(16 项)；非桥方法 = NON_BRIDGE(pixi 3 / headless 7)），负向实测：给 HeadlessScene 注入 present() ⇒ 守卫变红（注入后按字节还原）。判据 npm run verify 441/441。

## 2026-09-13

能力面棘轮按设计生效了一次：headless 实现 needsRender 后，守卫报"宿主能力差异变了" ⇒ DECLARED_HOST_DIVERGENCE 由 16 项缩到 15 项（needsRender 移入"两个宿主都必须实现"的一组，与 animationsDone 并列）。这类"差异缩小"是 B3 的目标方向：每补一个能力，差异表就短一项。

## 2026-09-14

★2026-09（T-0024）：本票入桥的 \nimationsDone\ 已随 0x400 门真值建模**改名** \poolPending\（语义也变：宿主只报池挂起位 \Scene+46516\，门由 \Engine.gatePending\ = 池挂起位 + 0x238 计时器判）。改名与口径订正的实现记在 tickets/T-0024/changes.md；本票的 evidence 锚点已同步刷新。
