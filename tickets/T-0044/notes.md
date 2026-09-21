# T-0044 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

修法：把 data 里新增的**控制行**（全是 `label_*` 定义）按位置插回 src，**保留译文**；★不能用 `scripts/sync-data-to-src.js --apply` —— 它的策略是「骨架不一致就整文件用 data 重置」，会把这 6 个脚本的译文全丢掉（MENU 的「要返回标题画面吗？」等）。补齐这件事的工具是 `scripts/resync-control-lines.mjs`（`npm run resync-control-lines [-- --apply]`，默认只报告；前提是"src 控制行是 data 的子序列且缺的全是 label_*"，否则拒绝改）；长期棘轮是 `scripts/check-skeleton.mjs`。
