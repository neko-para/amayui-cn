# T-0175 · 过程文档（notes.md）

## 2026-09-24

## ④ 现状核对（2026-09-24 主 agent 亲自做）

T-0159 §4.2 报的「copySaveSlot 里 if (d) writeSaveSlot(...) ⇒ 源槽只有 .STH 时漏复制」**在现盘已不成立** —— 现在的实现是两条**独立**写（if (d) writeSaveSlot(to,d)、if (t) writeSlotThumb(to,t)，返回 {dat: d!==null, sth: t!==null}），与引擎

## 2026-09-24

## ⑤ 与 ⑫ 现状（2026-09-24 主 agent 亲自做）

### ⑫ 	oFullWidth 两份实现去重 —— ✅ 已落地
两份**逐字节相同**（`src/vm/handlers/msgwin.ts` 的 `toFullWidth`（`0x205` 逐字直绘用）与 `src/vm/operand.ts` 的 `toFullWidthNumber`（取串全角化用））⇒ 合并为唯一一份：`operand.ts` 里 `export function toFullWidthAscii`（按引擎符号名改名；注释写明「谁要过这道、谁不要由**取串原语**决定：`sub_41B640`/`sub_42A420` 都过、`sub_41B9B0`（只有 `0x1B2`）不过」），`msgwin.ts` 改为 `import { toFullWidthAscii as toFullWidth } from '../operand.js'` 并删掉本地副本（别名保留 ⇒ 调用点零改动）。实测 esbuild OK、`op-string-coercion`+`operand-string-primitive`+`adv-msgwin`+`t0151-msgwin-vm` **73/73 绿**。

### ⑤ `setSlotPixels` 静默忽略 + DestroyQueue 接线不可测
- **前半（静默忽略）保持
