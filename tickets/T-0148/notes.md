# T-0148 · 过程文档（notes.md）

## 2026-09-25

2026-09-25（轮 42）主 agent 做掉「分诊表复核」这一前置：① 对 §4 的 36 条 tracked-open/unclassified 做**机械化复核**（拿每条 finding 自带的 emulator.file+emulator.quote 去当前工作树里找复现点）：**still-present 23 / quote-gone 13**；② 逐条核实 **8 条 stale-ledger 全部已由 A–F 波解决**（证据表见 changes-coverage.md §5），其中两条 lazy-3d-effect-20x 的 note 是悬空的「why: 同上」⇒ 本轮把 note 自足化（补管理器/帧推进 raw 锚点 + 静默原因 + 两条重开条件）并补 journal；③ 结论写进 changes-coverage.md §5（含 §5.2 复核表），⇒ 本票剩余面收敛为：23 条 still-present 里剔除已登记项后的**候选真缺口**（逐条读体后实现或登记）+ 80 个未登记 opcode 的裁决批。

## 2026-09-25

2026-09-25（轮 46）主 agent 做掉 **§3 那批（80 个'审计点名但不在缺口台账'的 opcode）的机械化裁决**：① 对当前运行时三张表逐个查表 ⇒ **76/76 都有归属**（registered-implemented 64 / registered-native 12 / unregistered **0**）⇒ 「不在缺口台账」是**覆盖口径**问题、不是能力缺失；另 4 个已由 T-0179 补进台账。② 加强复核：不在缺口台账、又有实质性 finding（missing-consumer/behavior/branch/operand-io）的 opcode 共 **58** 个，其中 **37** 个在能力台账里有痕迹、**21 个在六份真源里零痕迹**（口径：零痕迹 = 台账层面不可查，其处置可能只写在票面 changes/notes 或代码注释里，而票面文档不被机械检查覆盖）。全部证据表写进 changes-coverage.md 的 §8/§8.1/§8.2（含 76 行裁决表与 21 行零痕迹清单，带 severity/kind/handler）⇒ 下一轮的对这 21 条做'读体现状 → 落台账（登记/关掉）'的收口。
