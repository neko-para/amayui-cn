# T-0071 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

实证（本机 81 个真槽）：100 条纹理槽表**全是零**（flag 从不置 1）⇒ 那一段在本作里等价空操作；1000 条图像槽表每个槽有 0–3 条 `flag == 1 && id >= 0`，全是场景大图（`BG*`/`CS*`/`EV*`/`AE*` AGF）。槽 79 = 1 条：`rec4 = {id=2871, param=0, flag=1}` = `BG050ABL.AGF`。A/B 对照（headless）：同一句话「正常走到」= drawItems 26 / meshes 2（含 NOVEL 的背景四边形 103000）/ texSlots 9；「读档到」= drawItems 25 / meshes 1 / texSlots 5（修复后）。仍未复现引擎的那一格：`i0ae` 落在主循环里 ⇒ NOVEL 的 init（`create-mesh 103000` 那张全屏四边形）不会重跑 —— 引擎靠「后备缓冲从不清 + 上一个画面的绘制项还活着」兜住，emulator 的单模型做不到（见 T-0066）。
