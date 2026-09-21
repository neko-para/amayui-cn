# T-0045 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

工作流现在是：`cd scripts && node translate.js assemble`（全量）→ `npm run prune-install -- --apply --restore-agf`（收口）。★清单本身有两处**已知陈旧**：内容 md5 不符 5 个（`$1$IMINIT/$1$SCINIT/$1$SCJUMP` 是 opcode 改名后工具链重编的产物；`AGERC.DLL` 是菜单汉化补丁；`SO025.AGF` 与本机这份不同）—— 需要时由人跑根目录 `npm run manifest` 刷新，工具只报告不改清单。
