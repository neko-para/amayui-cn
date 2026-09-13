# 待编译翻译（PENDING）

> ⚠️ **本文件已并入票据台账**（2026-09）：待办一律开票，不要写在这里。

- 开票：`node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --add '{"type":"translation","area":"translation/compile","title":"…","why":"…","acceptance":["…"]}'`
- 看板（只看翻译域）：`node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --list --area translation`
- 手册：`docs-new/00-overview/tickets.md`；技能：`amayui-ticket-ledger`

原说明保留（背景）：macOS 环境只翻译文本、无法 assemble/安装 ⇒ "翻译完成但尚未编译"的脚本应当**开票**
（`type=translation`, `area=translation/compile`），待回到 Windows 后按票执行 assemble、
同步 `patch.config.json` / `PROGRESS.md`，然后把票置 `done`（带上 assemble 通过的判据）。
