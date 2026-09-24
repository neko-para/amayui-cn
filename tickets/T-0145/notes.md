# T-0145 · 过程文档（notes.md）

## 2026-09-23

## 2026-09-24 · ③ 落地

`tickets/T-0144` 的 ⑥ 与 `T-0145` 的 ③ 是同一件事，已一并做掉：`app/amayui-emulator/src/live2d/runtime.ts`（`l2dResetHost` 的注释）与 `src/vm/handlers/save-slot.ts`（装载点注释）都改成「正确依据 = `sub_410160` raw 19385-19388」并注明旧的 `sub_403EF0` 是假依据。①（`3f90` 门极性的文档订正）与 ④（留帧注释）仍未做。
