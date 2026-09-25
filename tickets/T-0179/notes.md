# T-0179 · 过程文档（notes.md）

## 2026-09-25

2026-09-25 开场（主 agent）：**结构修复已完成**（acceptance ①）—— 实测 140/140 条 missing[].ticket 原先全部指向已 done 的票（登记账无 live owner）；现 84 条 partial 的 missing[].ticket 批量改指本票，原承接票逐条目写进 journal[]（对照表 = changes-t0179.md §3）；what/raw/disposition 一字未动，counts 不变（partial 84 / 缺口 140），build-opcode-gaps --check ✓、opcode-gaps.test.ts 6/6。**主体工作（acceptance ②：140 条逐条裁决）未开始** —— 建议分批：先 vm 层操作数-IO（注意 readStringOperand 的 int/float/ptr 强制转换已由 T-0162/T-0163 落地，登记前先复核）→ renderer → msgwin（与 T-0019 串行）。

## 2026-09-25

2026-09-25 第一条裁决完成：**0xA0（jcc）**。审计把它记成 approximation（emulator 在 labelMap 未命中时抛 jcc: unknown true/false label，而引擎 raw 29635 是 ip = ip_base + 4*目标、对目标不校验）。处置 = **实现**：op_jcc 改两级解析（labelMap → 未命中回落 script.dwordToInstr，与 ret 同一映射；只有越出脚本才抛，作为宿主侧护栏），并在 opcode-gaps 新登记 0x0a0 = implemented（note/journal 带 raw 29620-29636）。守卫 test/op-a0-jcc-unlabeled-target.test.ts 3 例；红→绿实测：摘掉回落 ⇒ 2/3（1 红：非标签合法偏移那条），恢复 ⇒ 3/3；控制流族回归 43/43；tsc 0 错。

## 2026-09-25

2026-09-25 第二条裁决：**0x8C（jmp）＋ 0x8F（call）**（同一类：分支目标两级解析）。修法抽到 shared.ts 的 branchTarget/branchTargetError，jmp/call/jcc 共用；守卫合并为 test/op-a0-8c-8f-branch-targets.test.ts（5 例，含 call 返回栈压 dword 偏移），红→绿 = 摘掉回落 ⇒ 2/5（3 红），恢复 ⇒ 5/5；台账 0x8c 删掉已修那条 missing（剩 call-frame 深度门 1 条）、新登记 0x8f = implemented ⇒ 缺口 140→139。控制流族回归 49/49、tsc 0 错。

## 2026-09-25

2026-09-25 第三批（§8.2 零痕迹清单的前两条）：**0x245 / 0x246 的两道门**。① 0x245：按体补上「该槽没有 CTexture 对象 ⇒ 连 op2 都不读、不下发」的门（raw 32663），用 T-0164 引入的可选缝 hasSlotTexture（undefined=宿主不建模 ⇒ 保持旧行为），守卫 test/op-245-246-texture-object-gate.test.ts 4 例、红→绿 = 摘掉门 ⇒ 3/4（1 红），恢复 ⇒ 4/4 ⇒ 新登记 0x245 = implemented；② 0x246：第一道门同样补上；第二道门（类型标记 obj[+1084]==0，raw 32693）收窄为 1 条 missing（宿主缝拿不到该字段）；其原有第二条 missing（『宿主三实现都没有 setTextureObjectParam，且该缝被 0x1F9/0x249 复用来传颜色』）**关掉** —— 由 T-0175 的 ③ 拆缝解决。缺口台账 158→159（implemented 41→42、missing 139→138）。

## 2026-09-25（第 70 轮）—— 逐条裁决**收口**

四波并行只读裁决（A 操作数/数组/字符串族、B renderer/scene/gfx 族、C msgwin/text/font/audio/save 族、D `T-0148` §5.2 剩余面）
+ 主 agent 串行落库。**起点 `missing` 104 条 / 80 opcode（其中 28 条无任何判词）⇒ 终点 95 条 / 72 opcode，
95/95 全部带「重开条件」（机械核过 0 条缺）**；累计（本票生命周期）`missing` 140 → 95（删 45 条）。

本轮：③ 删 9 条（`0x213`/`0x24f`/`0x223`/`0x61`/`0x8c`/`0x2f5`/`0xcd`/`0x75`(字号 5 格)/`0x208`）、
② 判词重写 23 条、① 实现 **1** 条（`0x208`：`session.ts` 的屏障门收窄回单条 opcode ⇒ `0x249` 等不到屏障，
语料 2 处 `i249 → i208 → draw-texture`）。

★两条**推翻前轮结论**的复核：`0x61` 由"有意分叉(②)"改判"③ 零缺口"（引擎 `sub_418CC0` 的 default 支**也抛**
`Command_Type_Exception`，与 emulator 同构）；`0x2f5` 的三处前提全被体推翻。

★**本轮顺带修掉一个真 bug**：`ledger.js` 的 `unset`/`set` 用 `indexOf('"key"')` 找**第一次出现**、
会穿透嵌套 —— 对 `text-layout-wrap-ruby` 的裸键 `note` 会**删掉 `emulator.note`**（被工具自己的"写盘后回读复核"拦下）。
已改为按「容器 + 局部深度 1」定位（`findDirectKey`），`unset` 因此也支持点路径。

★**为什么本票留在 `doing`**：acceptance ②（逐条三态、不许留空）已满足，但 95/95 条 `missing[].ticket` 仍指向本票 ⇒
置 `done` 会**原样重建**本票 §1 要修的那个结构问题（登记账失去 live owner）。故留在 `doing` 作为长尾的常驻 owner；
取舍的两种做法与理由见 `changes-round70.md` §22.4。

详见 `changes-round70.md`（含各波裁决表、数据卫生清单、收尾实测与 `T-0148` §5.2 的四处能力台账改动）。
