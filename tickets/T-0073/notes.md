# T-0073 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

同类隐患：`opcode-table.md` 里标「仅映射」的其它 opcode 若被脚本用到，也会以同样方式卡死（不报错、只空转）。CALLBACK_LOAD 自己还剩 `0x137`（`i137 0`，ResetStack）与 `0x244`（`i244`，`sub_4AD9F0` 模式 2）两条未实现 —— 它们现在靠跳过策略绕过；要完全按引擎跑回调还得补这两条（已记在 `tickets/T-0072`）。
