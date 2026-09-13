# T-0007 · 过程文档（notes.md）

## 2026-09-13

作为 T-0003 验收 3 的子票收口：① 新增共享模块 src/frame/scenario.ts（步骤=帧号或条件、顺序执行、执行日志）；② gameStartChain 默认 gates.advance:"pump"（真泵：命中测试+键命中+点击+悬停两段式），输入编排改由 Scenario 驱动，并新增观察者：dispatches[]（含 hover-enter/leave）与 cursorTrail[]（routes.cursor/shown 变化）；③ 实测 pump vs force 对照；④ 新守卫 test/scenario.test.ts（3 条）+ game-start-chain.test.ts 的判据⑥/⑦。
