# T-0019 · 过程文档（notes.md）

## 2026-09-25

2026-09-25 主 agent 通报：一次拆分尝试被**停止并回滚**。单元在半成品状态下写出了 10 个 msgwin-*.ts（语法坏 + 缺导出，一度让所有 node --import tsx / npm test / verify 都跑不了，并阻塞了同波的 T-0169 单元）。处置：① 产出归档到 .tmp/t0019-split-wip/{handlers,vm}/（8 个文件，未丢失）；② git checkout HEAD -- src/vm/handlers/msgwin.ts src/vm/msgwin.ts ＋ 删除那 10 个新文件；③ 实测 typecheck 0 错、import('./src/vm/engine.js') ✓。★复做时的两条硬要求：a) 用**原文件留 barrel** 的手法，且**先**把 barrel 与所有 re-export 补齐再动搬运，中途每一次落盘后立刻 
pm run typecheck（不要把树留在坏态）；b) 被切开的 JSDoc 块要在两端各自补回注释边界（本次踩到：vm/msgwin.ts 的 reveal 段注释被切成两半，一半落在 handlers/，一半落在 vm/，两端都缺 /** 或 */），另 defaultWinGeom 的归属应跟 WinGeom 一起放 msgwin-style.ts（barrel 就是这么 import 的）。
