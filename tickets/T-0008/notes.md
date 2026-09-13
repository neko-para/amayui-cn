# T-0008 · 过程文档（notes.md）

## 2026-09-13

D1 完成：① 删 PixiBackend/HeadlessScene 的 waitFlags 镜像（setWaitFlag 只标脏）；② 单一时间域（present/sceneAnimationsDone 都用引擎 nowMs）；③ 判据下沉 sceneNeedsRender（可测）；④ ★发现并修正 A2 的口径错误：门判据与合成判据拆开（scGateAnimationsDone / scAnimationsPending）——5 窗门口径会让序章 SN0000.txt:1043 的 80 000 ms 平移窗把门钉 80 s（E4 A/B 实测黑屏 20 s+），真值分析另立 T-0024。证据见 tickets/T-0008/changes.md（含 A/B 表：presents 66→68、gate 400 clear 11→11、[reveal] 323→316）。
