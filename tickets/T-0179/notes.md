# T-0179 · 过程文档（notes.md）

## 2026-09-25

2026-09-25 开场（主 agent）：**结构修复已完成**（acceptance ①）—— 实测 140/140 条 missing[].ticket 原先全部指向已 done 的票（登记账无 live owner）；现 84 条 partial 的 missing[].ticket 批量改指本票，原承接票逐条目写进 journal[]（对照表 = changes-t0179.md §3）；what/raw/disposition 一字未动，counts 不变（partial 84 / 缺口 140），build-opcode-gaps --check ✓、opcode-gaps.test.ts 6/6。**主体工作（acceptance ②：140 条逐条裁决）未开始** —— 建议分批：先 vm 层操作数-IO（注意 readStringOperand 的 int/float/ptr 强制转换已由 T-0162/T-0163 落地，登记前先复核）→ renderer → msgwin（与 T-0019 串行）。

## 2026-09-25

2026-09-25 第一条裁决完成：**0xA0（jcc）**。审计把它记成 approximation（emulator 在 labelMap 未命中时抛 jcc: unknown true/false label，而引擎 raw 29635 是 ip = ip_base + 4*目标、对目标不校验）。处置 = **实现**：op_jcc 改两级解析（labelMap → 未命中回落 script.dwordToInstr，与 ret 同一映射；只有越出脚本才抛，作为宿主侧护栏），并在 opcode-gaps 新登记 0x0a0 = implemented（note/journal 带 raw 29620-29636）。守卫 test/op-a0-jcc-unlabeled-target.test.ts 3 例；红→绿实测：摘掉回落 ⇒ 2/3（1 红：非标签合法偏移那条），恢复 ⇒ 3/3；控制流族回归 43/43；tsc 0 错。

## 2026-09-25

2026-09-25 第二条裁决：**0x8C（jmp）＋ 0x8F（call）**（同一类：分支目标两级解析）。修法抽到 shared.ts 的 branchTarget/branchTargetError，jmp/call/jcc 共用；守卫合并为 test/op-a0-8c-8f-branch-targets.test.ts（5 例，含 call 返回栈压 dword 偏移），红→绿 = 摘掉回落 ⇒ 2/5（3 红），恢复 ⇒ 5/5；台账 0x8c 删掉已修那条 missing（剩 call-frame 深度门 1 条）、新登记 0x8f = implemented ⇒ 缺口 140→139。控制流族回归 49/49、tsc 0 错。

## 2026-09-25

2026-09-25 第三批（§8.2 零痕迹清单的前两条）：**0x245 / 0x246 的两道门**。① 0x245：按体补上「该槽没有 CTexture 对象 ⇒ 连 op2 都不读、不下发」的门（raw 32663），用 T-0164 引入的可选缝 hasSlotTexture（undefined=宿主不建模 ⇒ 保持旧行为），守卫 test/op-245-246-texture-object-gate.test.ts 4 例、红→绿 = 摘掉门 ⇒ 3/4（1 红），恢复 ⇒ 4/4 ⇒ 新登记 0x245 = implemented；② 0x246：第一道门同样补上；第二道门（类型标记 obj[+1084]==0，raw 32693）收窄为 1 条 missing（宿主缝拿不到该字段）；其原有第二条 missing（『宿主三实现都没有 setTextureObjectParam，且该缝被 0x1F9/0x249 复用来传颜色』）**关掉** —— 由 T-0175 的 ③ 拆缝解决。缺口台账 158→159（implemented 41→42、missing 139→138）。
