# T-0075 · 过程文档（notes.md）

## 2026-09-20

### 轮 7 复核：`op-1/0x100-push-return-point` = **stale（已修复），勿再当待办**

`docs-new/03-engine/audit-2026-09-opcodes.md` 的 `### op-1/0x100-push-return-point` 条在**审计当时**成立，但已在更早一轮落地（`tickets/T-0077/notes.md` §「B4 第三条」）：`app/amayui-emulator/src/vm/handlers/input.ts` 现在按两条分支**不对称**实现 —— `pushReturn(plusOne)`（现 `:163-167`），掩码分支 `pushReturn(false)`（现 `:186`，`ret` 回到 0x100 继续扫下一个键）、默认键分支 `pushReturn(true)`（现 `:196`）；扫描游标 `ENGINE_FIELD.keyScanCursor`（`Engine[cur+122287]`，写 `b+1`）也已建模（现 `:181`）。

已在审计正文该条下加 **★订正（轮 7 复核）** 段说明「已落地 + 旧行号已漂 + 残留近似是扫描游标复位没有帧泵钩子」。

⇒ 本票的剩余清单里**不要**再列这一条；同类「审计条已被后续轮次修掉」的条目应继续按此法逐条标注（这是本票 P1 的一部分价值：审计本身也会陈旧）。
