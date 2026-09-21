# T-0065 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

用真槽 79 复现：修复前帧循环 400 帧的轨迹是 SYSTEM4→INITCONFIG*→INIT2→SCINIT→CTINIT→…→TITLE#46；修复后 0xAE 六帧内走栈完成并收尾在 SN0000.BIN 落点 794（= 第一句话，与 emulator 槽的 lastMsgIp 一致）。
