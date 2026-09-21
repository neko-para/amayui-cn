# T-0078 · 过程文档（notes.md）

## 2026-09-19

B6 第一批（目标轮 9）：按审计 audit-2026-09-capabilities.md 修正 5 条台账失真（2 条 P0 + 3 条 P1），全部走 capabilities.js --edit（真源 analysis/engine-capabilities.json）+ build-capabilities.mjs 重生成 md + --validate 自检：① l2d-node-draw-gate：note 自称「两宿主还没调用」不成立 —— Pixi（presenter.ts:265 每帧调用、:348 并入出画）与 headless（scene/snapshot.ts:230 同一函数）都在消费 ⇒ status 升 modeled-verified / E3 / guard=test/live2d-render.test.ts；② render-3d-layer-dual-commit：对象 sub_4B4460 就是 opcode 0x222 的体，emulator 三表全无 ⇒ 从 n/a-known 改 absent（语料 i222 10 处命中即硬停，指向 T-0076）；③ text-aa-config-gate：字段 21662 渲染侧无消费者（msgwin.ts:146 写死 antiAlias:true），note 的「从字段带到渲染侧」不成立 ⇒ partial；④ text-font-rebuild-cascade：7 条参数面 + 面名映射/竖排都已落地且有断言（msgwin.ts/fontSet.ts），原 absent/E0「完全没接」不成立 ⇒ partial/E2/guard=test/text-layout.test.ts；⑤ scene-flag-46528-bits：bit2 语义与进入门（MeshEntry flags&2 且 flags&1）写错 ⇒ trigger/whySilent/raw 订正。台账分布：已核验 47 / 已建模未核验 8→7 / 部分 27→29 / 缺失 22 / n/a 26→25。剩余：gfx-prim-mesh-and-render-state、renderer-state-reset-each-frame、scene-3d-effect-level-writer、single-field-timers-audio-device、scene-capture-target-flag-46680。

## 2026-09-19

B6 第二批（目标轮 10）：剩余 5 条 capabilities 失真全部修正 ⇒ 本票的 **11 条 P0/P1 全部完成**。① gfx-prim-mesh-and-render-state：trigger 改为「0x238 = 0x400 等待门计时器（起点清零/时长 op1，raw 32303-32312；读者 sub_407E20 + 主循环 21109）」，note 改为「除 0x207 已由 TextureCache.blitSlotToSlot 真转送外其余按宿主缝记录」；② renderer-state-reset-each-frame：whySilent 改为 ClearTarget（有错误串 + return 1/0，调用方不看返回值），trigger 改为帧头 bit1（raw 137026-137029）；③ scene-3d-effect-level-writer：status → partial，engine.raw=126552-126561，note 写明它是 2D 绘制循环 sub_4B06D0 的分支门（136517/136024/135518/136199）；④ single-field-timers-audio-device：evidence E3 → E2，note 写明 raw 只覆盖 4/14 fns、fillPanelRect 缝在实现里不存在（真实现 panel.ts:108 bindKeyBit）、guard 是合成单测；⑤ scene-capture-target-flag-46680：engine.fns → sub_4A4DC0、engine.raw=124960-124962，note 以 why: 前缀说明它是 3D 截图（不在重写范围）。台账分布：已核验 47 / 已建模未核验 7 / 部分 30 / 缺失 22 / n/a 24；capabilities.js --validate 通过；build-capabilities.mjs 已刷新。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

流程教训（写进报告的方法节）：台账的「已实现/未实现」必须与代码+守卫测试双向核对 —— 本次两侧都出现：既把「已接线」写成缺口（l2d-node-draw-gate / text-font-rebuild-cascade），也把「命中即停的缺口」写成 n/a-known（render-3d-layer-dual-commit / scene-3d-effect-level-writer）。另有 6 条待查（材料不足）与 4 条已排除误报，见报告末节。
