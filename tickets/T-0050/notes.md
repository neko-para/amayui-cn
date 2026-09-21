# T-0050 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

★与 `0x207` 的关系：`0x207`（`sub_4A3980`）是**同尺寸**槽→槽 StretchRect，`0x32` 是它的**缩放**兄弟；两者的宿主缝本来就是同一个 `blitSlotToSlot`，但此前 Pixi/headless 两侧都只记日志、**不做像素** ⇒ 本单顺手把这条缝补成真实现（画布间 drawImage），所以 `0x207` 的视觉效果也一并落地。★未做/待验：① GDI 分支（`Engine[166964] == 0`，文本/2D 对象 vtable+64）没建模（emulator 走 D3D 等价路径，与其余渲染一致）；② 缩放插值用的是「引擎采样器 = MINFILTER LINEAR」这一条证据（raw 93927），若真机缩略图明显更锐（point）再回来改；③ **E4 未做**：headless 无画布 ⇒ 端到端只能验到模型层；「存档缩略图真的变成截图」要在 Electron 里存一次档看 `.STH`（`getSlotPixels` 路径，T-0036 已有读回）。
