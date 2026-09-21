# T-0060 · 过程文档（notes.md）

## 2026-09-19

2026-09（目标轮 52）：根因重分类 —— 原记「RESETREIGNAN 死循环」是**症状**（旧实现命中未实现指令）。现已定性：0x231（sub_4243F0，argc 4）属 Item.flags bit2 族（族共用 sub_4AD580，raw 132151 起：sub_4AAA50 建项 → sub_4AAD40 取元素 → *v4 &= ~4u 清 bit2），卡点是 bit2 的渲染消费端（引擎 +536/+556/+560/+568/+572，emulator 未建模）⇒ 台账已把 0x231/0x230/0x235 一起归 deferred（合计 299 处语料）。本票可据此收口或转挂「bit2 渲染语义」批次（见 docs-new/99-records/2026-09-audit/audit-2026-09.md §6 与 plan-2026-09.md §2c）。
