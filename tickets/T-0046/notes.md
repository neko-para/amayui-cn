# T-0046 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

同一轮顺手查到、**本单不改**的一条偏差（已单独开单 **tickets/T-0047**）：`0xCD` 的节流间隔 `Engine[429812]` 被 `mouse-callback`(0xCC) 的 op1 写入（`sub_453A60` raw 66101-66113），TITLE/CHARMEDIT 的 `mouse-callback 10`（十六进制 = 0x10）⇒ 真机 16ms（`32`=0x32 ⇒ 50ms）；emulator 的 `advanceThrottle` 仍恒 0（旧注「全工程无写入」漏了 `sub_453A60`）。改它会让三处用冻结时钟驱动的 headless 测试（title-exit / route-dispatch ⑦b）失去输入派发，需要同步改它们的时钟模型 ⇒ 见 T-0047（含失败清单与落地顺序）。文档（opcode-table 0xCC/0xCD、input-system §6a/§7b）已按引擎事实改写并标注 emulator 现状。
