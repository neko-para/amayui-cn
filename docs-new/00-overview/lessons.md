---
kind: procedure
state: live
updated: 2026-09-21
---

# 工程纪律（踩过的坑，全部是实测教训）

> 这份清单是**跨子工程**的通行纪律（引擎分析 / emulator 实现 / 文档 / 票据 / 多 agent）。
> 每条都来自一次实测事故；新增一条时**必须**写清"哪一次实测"（出处）。
> 会话级前置（沙箱、技能加载、环境构造）在 `docs-new/03-engine/handoff.md` §1.0。

1. **只按引擎证据改**：改动注释必须给 raw 行号 + 体内真实分支；没有依据的"看起来能跑"的补丁不做。
2. **不静默跳过**：任何不实现/近似都要在 `analysis/opcode-gaps.json` 有一条（`unimplemented`/`deferred`/`engine-internal`/`engine-internal-unjustified`/`implemented`/**`partial`**）并写理由。**`partial`**（2026-09 `tickets/T-0149` 新增）= "已注册且语料级可用，但相对引擎体仍缺某条分支/消费端/写者，或某处是披露的近似"，**必须**带 `missing[{what,ticket,raw}]`（由 `test/opcode-gaps.test.ts` 棘轮守住）。**宁可有据 `deferred`，也不要造假实现。**
3. **★筛体/规格文档里的推断只是线索，不是结论**：本轮 13 处推断被逐行读体推翻，其中 **2 处是"归口对象整条错"**（`0x1c4` 被当成"场景层是否已挂项"，实为**语音总线占线查询**；`0x1d0`/`0x1d1` 被当成"GDI 文本度量族"）。**凡采纳前必须读体**。订正要写回文档（本轮落在 `b3-screening-2026-09.md` §6）。
4. **区分"死读"与"漏读"**：`0x1d3`/`0x1d4`/`0x2f3` 的操作数在引擎里**也是**死读（形参在全函数体不出现）⇒ 这不是 bug，写进白名单的"有据豁免"而不是硬补。
5. **不静默跳过 → 也不许用工具悄悄放过**：`--set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**；`capabilities.js --validate` 与守卫测试口径现已对齐（都报"必须是字符串"）。**JSON note 里引用短语用「」，不要用裸 ASCII 引号**（会截断字符串）。
6. **手写的"统计量"必然漂移**：`counts` 曾是手写 ⇒ 实测漂移过一次（声明 `deferred 25/unimplemented 6` vs 实际 `31/0`）且无人发现。现在由 `build-opcode-gaps.mjs` 重算回填，`--check` 漂移即 exit 1。**凡是"由工具维护"的字段，就别手写。**
7. **`--check` 必须真的失败**：早前 `gaps:check` 只打印 ✗ 仍 `exit 0`（假"通过"）。已修。
8. **编辑文件一律用 `edit`/`write` 工具**；不要用 PowerShell `Set-Content`/双引号字符串（会吞反引号、写出 NUL）。**对既有共享文件只用 `edit` 定点替换，不要 `write` 整文件**（并发会丢更新）。
9. **定位引擎函数先 grep `//----- (004xxxxx)` 定义头**（按邻近常量猜位置已实测读错函数）。
10. **判定台账内文看 JSON 原文**，不要看渲染后的 md（md 呈现会截断）。
11. **每批出口判据**：守卫测试 + 文档同步（opcode-table / 三层台账 / 审计 §6 / 修复计划 §2d / 票据）+ `npm run verify` 全绿。
12. **新增 opcode 的四件套**：raw 行号注释 → `analysis/opcodes.json` 的语义/状态 → 台账 disposition（+ 重建两份生成物：`opcode-table.md`、`scripts/asm/opcodes.json`）→ 守卫测试。
13. **写字段前先确认有消费端**：往 `Item`/`MeshObj` 加"只写不读"的字段会被 `check:dead-writes` 拦。**也别往"引擎没有的合成级"硬接**（Scene 级变换就是卡在这里 ⇒ 归 `deferred`）。
14. **改宿主行为两宿主对称**：`headlessScene.ts`（测试/报告）与 `pixiBackend.ts`（GUI）都要改；新缝按先例五处同步（`native.ts` + headless + pixi + `stubNative.ts` + `nativeTap` 白名单）。
15. **★会话被打断（休眠/中断）后，先验证"最后一次编辑真的落盘了"**：`edit`/`write` 走的是"临时目录 + 原子改名"，
    被中断时会在目标文件旁边留下 `<文件名>.<pid>.<uuid>.tmpdir/`。**实测踩过**：一次 `edit` 报告成功但改动只在 tmpdir 里
    （`handoff` 的 §5 残留规模段），文件本身没变 —— 只看工具返回值会以为已经写进去了。
    ⇒ 恢复动作：① `Get-ChildItem -Recurse -Filter '*.tmpdir'`；② 用标志串核对目标文件（本工程踩过的标志串 = `残留规模（先看这个再挑活）`）；
    ③ 若 tmpdir 里的内容 = 目标文件 + 那一次编辑，**重新应用该编辑**（不要直接覆盖，除非逐行严格比对为 0 差异）；④ 清理 tmpdir。
16. **★语料量 ≠ 重要性：先看那批命中是不是在「门后/DEBUG 路径」上**。实测教训：`0x140` 以 **181 处**排在
    `deferred` 榜首、连着两轮被列为"最值得先做的一条"，读体后发现它**全在 DEBUG 路径**（`global 708ad6 == 1`
    才进，该全局全语料唯一写点 = `TITLE.txt:462` 的 DEBUG 菜单）⇒ 正常剧情零影响。
    ⇒ 排优先级时**必须**先 `Select-String` 看实参形态是否高度一致 + 追一下「进这条分支的门是什么」，
    否则会把力气花在只有开发者菜单才会走到的指令上。
17. **★锚点不是注释，是跨文件/跨 agent 的 ABI**（轮 5 实测）：`ticket.json` 的 `evidence[].anchor` 与 `analysis/scripts.json` 的 `layout[].anchor`
    要求**别人正在改的文件**里存在那个字面串。改任何被锚定的文件（**源码注释、机制文档的表格行都算**）之前先跑
    `tickets.js --anchors-in <file>` 与 `scripts.js --anchors-in <file>`；能保留就把旧串留在标题/引用里，不能保留就**在报告里申报**（由台账 owner retarget）。
    ★**不许用「删证据 / 降 status / 删条目」来消红**。（实测收益：`--anchors-in save-slot.ts` 一次列出 17 条锚点 —— 此前只能人工列举「必须保留的 4 个串」；它还当场暴露了两条说明过时的证据。）
18. **★「不在被调函数里」≠「引擎没做」**（轮 5 最贵的一课）：`sub_410160` 的 27 个 callee 确实都不清绘制容器，但清容器是它**自己的行内语句**（raw 19810-19820）。
    ⇒ 结论必须落在**函数体文本**上（含行内循环/内联语句），不能只审调用图。
19. **`--validate` 绿 ≠ 数据层对**：直到轮 5，两个工具都在拿**刚重算过的副本**比 `counts` ⇒ 磁盘上的陈旧**检测不出来**（实测踩过 `partial 18→19`、`modeled-verified 48`）。
    现在改为比磁盘并提示 `--recount`。同理：**生成物（`*.md`）只在结算时由台账 owner build 一次**，别的 agent 不跑 build（会用陈旧输入覆盖别人的结果）。
20. **派子代理的三件套**（详见三个技能的同名节）：① 角色（ANALYSIS-ONLY / IMPLEMENTATION / LEDGER-OWNER）；② **路径白名单**（可写哪些、禁写 `analysis/`·`tickets/`·`docs-new/`）；
    ③ **必保字面串**（锚点）+ 退出判据（`npm run verify` + E4）。★ANALYSIS-ONLY 的 prompt **必须**写明「即使你加载了某技能，也**跳过**它的落库步骤」——
    否则子代理会在「技能要求落库」与「只读分析」之间自行取舍（实测原话如此）。
