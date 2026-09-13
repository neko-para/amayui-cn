# T-0009 · 过程文档（notes.md）

## 2026-09-13

本轮（T-0008/D1）兑现全部验收：1) scAnimationsDone 复用 itemAnimationsPending（逐 5 窗，A2 已落）；2) PixiBackend.sceneAnimationsDone(nowMs) 用引擎时钟刷新 clockMs，session 传 e.nowMs；3) 新增 frame-loop 守卫（0x400 门 wait 档：宿主报"动画没跑完"不放行、报了才清位放行）。

## 2026-09-13

D1 复核时发现"门判据该覆盖哪些窗"不是本单能拍的问题（序章 80 000 ms 平移窗 ⇒ 门被钉 80 s），已把该问题拆到 T-0024；本单保留"时钟同源 + 合成口径与推进共用实现"两项。
