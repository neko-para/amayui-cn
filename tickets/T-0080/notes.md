# T-0080 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

顺序理由：B0 先立「缺口可见」的机制（否则后续每批都可能再出现静默 no-op）；B1 只做两条 P0（0x2E9 / 0x228，语料 480 + 1097 处，直接卡 ADV 主流程）作为顺序修复的起点；B2 把操作数读取收进共享计划层，之后 B3/B4 才按计划改而不是逐条猜顺序；B5 动呈现路径，必须等指令语义打底（否则又是「修一处、坏一处」）。

## 2026-09-22 · B7 拆账（本票关闭）

### 为什么不用"逐条处理 218 条"来关 B7

B7 的定义是「P2/P3 清尾 218 条」，但审计条目**会过期**（报告 §6 自己声明过），而且这 218 条里绝大多数
是「审计当时的问题已被后续轮次修掉」。所以正确的收尾不是逐条重做，而是**先分类再拆账**：
把 218 条逐条对现行真源（`analysis/opcodes.json` / `opcode-gaps.json` / `engine-capabilities.json` /
运行时三张注册表 / 守卫文件 / 现行文档正文）判成六类，再按影响拆票。

### 做法（只读作业 + 父代理抽查）

- 数据源：`tickets/T-0075/evidence/audit-final-{opcodes,capabilities,docs}.json`（`kept` 95/84/67 = 246）。
- 筛选：`severity ∈ {P2,P3}` ⇒ 85 + 75 + 58 = **218**（与 `audit-2026-09.md` §6 的数字精确吻合，口径无歧义）。
- 判定六类：已修（stale）/ 已修（部分）/ 真缺口-已被票覆盖 / 真缺口-无人承接 / 纯记账 / 无法判定。
- **父代理抽查**（子代理的结论不能直接采信）：4 条 absent 能力的 status/evidence/guard/raw、
  `src/GAMESTART.txt` 的 `local 0` 写点、`engineFieldIds.ts` 的 `engineBool`、`stubs.ts` 的 `0x308`、
  子代理自述误建的文件是否真被删（`Test-Path` = False）—— 见 `evidence/b7-coverage.md` §5。

### 结果

- **204/218 不需要动手**（已修 138 + 部分 26 + 纯记账 7 + 无法判定 11 + 已覆盖 3），且"已消化"有结构性守卫兜底。
- **14 条真缺口**拆成三张票：`T-0109`（P2，可见行为）/ `T-0110`（P3，文档残留）/ `T-0111`（P3，低影响登记 + 接线）。
- 3D/Live2D 内部面（`passive-camera-…` / `vertex-buffer-lock-scale` / `lazy-movie-*`）按 `plan-2026-09.md` §1 RF-C
  与审计 §4 记为**范围外**，不新开票（继续留在台账的 `absent`/`n-a-known` + `why:` 里）。

### 顺手发现的两件值得单独记的事

1. **`scene-start-flow.md` 的 GAMESTART `count` 是硬数字错误**：文档写 3，而 `src/GAMESTART.txt` 全文件
   **只有 1 处**写 `(local-int 0)`（:69 = **17**），且 :115 把它作为 `0x12E` 的 op8 = count 传入
   （签名见 `scene-start-flow.md:57`、`input-system.md:288/365`）。⇒ 命中区/按钮数由该值直接决定，
   这条不是措辞问题。归 `T-0110` 判据①。
2. **审计引用的两份文档已消失**（`stub-reaudit-2026-09.md`、`vm-opcodes.md`，`T-0105` 的收尾删的）⇒
   6 条 docs 条目随之失效。这也说明"审计报告里的文件路径"本身会过期。

### 回写落点（按本票判据里预先写明的两处）

- `docs-new/03-engine/plan-2026-09.md` 的 B7 行 → ✅ 完成（带拆票与证据路径）。
- `docs-new/99-records/2026-09-audit/audit-2026-09.md` §6 的 B7 行 → ✅ 完成（同前）。
  该节是 record 区里**唯一**允许回写的「执行状态」节（节首自述："本节的唯一职责 = 让上面 §5 的建议可追踪"）。
