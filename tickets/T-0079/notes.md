# T-0079 · 过程文档（notes.md）

## 2026-09-19

B6 文档侧第一批（目标轮 11）：修掉两处 P0 文档陈旧 + 顺带三处同源订正。① **flow-control.md:181-183**（P0）：原文说 emulator 停在 ScriptReset/[未建模]，实际 op_exit_script（control.ts:401-406）已重载根脚本 INDEX0、装帧 0、cur=0、jump(0)，全 src 已无 ScriptReset 符号 ⇒ 改为「emulator 现状（2026-09 订正）：已实现」。② **scene-start-flow.md:100**（P0）：原文把 0x238 与 0x1B1 并列为「死写」—— 0x238 其实是**等待门计时器加载**（raw 32303-32312；读者 sub_407E20 raw 12761-12786 + 主循环 0x400 分支 raw 21109；SN0000.txt:1020 的 i238 157c = 5500ms）⇒ 拆成两行并标注订正。③ 同文件 :102（P1）：0xD9 清的 0x1000 位**有读者**（主循环 raw 20841）⇒ 改「标志位清除（有读者）」。④ 同文件 :96/:105（P1）：16 条早已全部转真实现、ENGINE_INTERNAL_OPS 只剩 9 条；现有棘轮是 A5 的 7 条（A5_IMPLEMENTED），不存在「16 条不写操作数」棘轮；『未登记缺口即红』的棘轮在 test/opcode-gaps.test.ts ⇒ 段落已加订正说明。剩余 P1：scene-start-flow.md:170（§6 E2 行三个数字）、flow-control.md:422（i143 已实现）、flow-control.md:427（exit -11 已实现）、rendering.md:112（帧保留解除判据 = state0 高字节 alpha / #meshVisible）。
