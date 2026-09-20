# 03-engine · 交接文档（2026-09，目标轮 47+ 结束时）

> 用途：**新会话直接照此续跑**。真源与纪律都在这里；详细体实证在 `audit-2026-09.md` §6，
> 批次总账在 `repair-plan-2026-09.md` §2c（历史）、**§2d（轮 47+）与 §2e（轮 4）**。
> **唯一权威 = 引擎反编译** `engine/天结_unpacked.exe_utf8.c`。
>
> **★怎么交接（只需这一份）**：新会话的提示里给一句
> 「读 `docs-new/03-engine/handoff-2026-09.md`，按它继续推进；开工前先看 §3.0 的会话级前置」即可 ——
> 三层数据层（`analysis/*.json`）、四份台账、票据、规格文档**全在仓库里**，不需要另外搬。
> 但 **§3.0 那三条是会话级的（沙箱权限 / 点名加载技能 / 并发写纪律），文档本身保证不了**，必须一并交代。

---

## 0. 一句话目标

按 `docs-new/03-engine/repair-plan-2026-09.md` 的批次（B0…B7）推进 emulator 修复：
**每次只按引擎 raw 证据改 → 带守卫测试 → 同步 opcode-table/三层台账/票据 → `npm run verify` 全绿收口。**

**★本轮的里程碑：B3「语料用到但零注册的指令」的**未审视**缺口清零**（`unimplemented` 35 → **0**，语料 203 → 0）。

> ⚠ **这不是"都实现了"** —— `deferred`（31 条）**都不在任何注册表里** ⇒ 其语义**不会被执行**
> （严格模式命中即抛 `NotImplementedOp`；诊断模式跳过并计入"被跳过的未实现 opcode"）。
> `implemented` 与 `deferred` 的差别只是"已经从『没人看过』变成『看过、读过体、写清了扩展点』"。
> **★残留规模（按语料实测）：31 条 = 312 处调用点**，最大三档 `0x140`(181) / `0x28`(32) / `0x86`(16)，
> 本次新判定的 6 条 = `0x22a`(2)+`0x22c`(6)+`0x22d`(5)+`0x22f`(7)+`0x1c4`(1)+`0x23a`(1)。
> **下一步的重点 = 让这些 `deferred` 从"语义不执行"变成"有模型"**（见 §5；三条公共前置模型能一次解锁多条）。

## 1. 当前状态（可直接复核，勿凭记忆）

| 项 | 值 | 复核命令 |
|---|---|---|
| 测试 | **745 tests / 744 pass / 1 skip / 0 fail**（1 skip = 本机无真存档时才跑） | `cd app/amayui-emulator && npm run verify`（≈40s，含 typecheck + 死写检测） |
| 死写 | **0** | 同上（`check:dead-writes` 扫 `Item`/`MeshObj` 字段） |
| 缺口台账 | **未实现 0（语料 0）/ unjustified no-op 0 / 有据 no-op 8 / 已实现 34 / deferred 27**（共 69 条）★「未实现 0」= 语料用到的零注册指令**已全部定性**（不再有"没人看过"的）；`deferred` 27 条（**292 处语料**）**仍会硬停** | `node scripts/build-opcode-gaps.mjs`（写模式）／`--check`（CI 口径，exit 1 即漂移） |
| 能力台账（第二层） | **133 条**：已核验 48 / 已建模未核验 7 / 部分 33 / 缺失 21 / n/a 24 | `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . --validate` |
| 票据 | **88 张**（doing 4 / open 19 / done 64 / dropped 1） | `.agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --validate` + `node scripts/build-tickets.mjs` |
| 批次 | **B0 ✅ B1 ✅ B2 两步（剩计划层）B3 ✅（缺口清零）B4 剩 3（2 条为已披露偏差）B5 (A)(B)(C) ✅ B6 ✅ B7 未开始** | `repair-plan-2026-09.md` §2d |

## 2. 真源与生成物（**生成物一律手改禁止**）

| 真源（可改） | 生成物（改真源后重建） | 守卫（红了就是漂移） |
|---|---|---|
| `docs-new/03-engine/opcode-table.md` | `scripts/asm/opcodes.json`（`scripts/asm/build-opcodes.js`） | `app/amayui-emulator/test/opcode-arity.test.ts`（从体解析长度槽 `N=2*argc+1` 对照 574 条） |
| `analysis/opcode-gaps.json` | `docs-new/03-engine/opcode-gaps.md`（`scripts/build-opcode-gaps.mjs`） | `test/opcode-gaps.test.ts`（3 条：生成物最新 / 处置与注册表一致 / 量级不缩水） |
| `tickets/T-00NN/ticket.json` | `tickets/README.md`（`scripts/build-tickets.mjs`） | `test/ticket-ledger.test.ts`（**证据锚点棘轮**：anchor 消失即红） |
| `analysis/functions.json`·`fields.json`·`engine-capabilities.json`·`scripts.json` | `docs-new/03-engine/engine-capabilities.md`、`docs-new/05-scripts/*` | `capabilities.js --validate` / `scripts.js --validate` / `test/capability-ledger.test.ts`、`test/script-ledger.test.ts` |
| 实现 | — | `test/opcode-operands.test.ts`（操作数口径 + `ALLOW_UNDERRUN` 白名单棘轮） |

## 3. 起手命令（复制即用）

### 3.0 ★开工前置（**会话级，不在仓库里，必须口头交代或确认**）

1. **沙箱必须允许子进程管道**：本工程的 `npm run verify` 走 `node --test`，它会**为每个测试文件 spawn 子进程并捕获管道 stdio**。
   在受限沙箱下这会被拦成 `spawn EPERM`（表现为**每个测试文件都红**、错误栈是 `child_process.spawn`）——
   **那不是测试失败，是沙箱**。本会话实测：必须给到 `danger-full-access` 才能跑 `npm run verify`。
   ⇒ 新会话若一上来 `verify` 全红且错在 `spawn EPERM`，先解决权限，**不要**去改测试。
   （临时绕法：单文件直接用 `node --env-file=test/options.test.env --import tsx test/xxx.test.ts` 跑在进程内，不起子进程。）
2. **加载技能**：本仓库的技能是**按需加载**的（`.agents/skills/*`）。开工时在提示里点名它们，否则新会话不会读到纪律：
   `amayui-engine-analysis`（三层数据层 + 缺口/能力台账）、`amayui-script-analysis`（脚本台账流程）、
   `amayui-ticket-ledger`（票据台账）、`amayui-script-translate` / `amayui-script-update`（翻译相关）、
   `batch-task-runner`（批量）、`amayui-ui-text-render`（UI 图片文字）、`amayui-mnemonic-rename`（助记符改名）。
3. **并发写纪律（本轮踩过 3 次）**：`--set` 的**值里不要写 ASCII 逗号**（会被当数组分隔符）、
   note 里引用短语用「」而不是 ASCII 引号（会截断 JSON）；**多 agent 并行时对既有文件只用 `edit` 定点替换，绝不用 `write` 整文件重写**。

```bash
# ① 基线（必须全绿）
cd app/amayui-emulator && npm run verify
# ② 台账现状（写模式会顺带回填 counts；--check 是 CI 口径）
cd ../.. && node scripts/build-opcode-gaps.mjs
node scripts/build-opcode-gaps.mjs --check
# ③ 定位任一引擎函数的体（★先 grep 定义头，别猜位置）
#    Select-String -Path engine\天结_unpacked.exe_utf8.c -Pattern '//----- \(0042E8A0\)'
# ④ 真实界面回归（E4）：读档链
cd app/amayui-emulator && npm run shot -- --load 79 --name mycase --page 870,900
#    → 产物 .tmp/mycase-*.png + 日志 .tmp/amayui-emulator.log；GUI 改动需 npm run build:electron（`npm run shot` 已含）
```

## 4. 纪律（本段踩过的坑，**全部是实测教训**）

1. **只按引擎证据改**：改动注释必须给 raw 行号 + 体内真实分支；没有依据的"看起来能跑"的补丁不做。
2. **不静默跳过**：任何不实现/近似都要在 `analysis/opcode-gaps.json` 有一条（`unimplemented`/`deferred`/`engine-internal`/`implemented`）并写理由。**宁可有据 `deferred`，也不要造假实现。**
3. **★筛体/规格文档里的推断只是线索，不是结论**：本轮 13 处推断被逐行读体推翻，其中 **2 处是"归口对象整条错"**（`0x1c4` 被当成"场景层是否已挂项"，实为**语音总线占线查询**；`0x1d0`/`0x1d1` 被当成"GDI 文本度量族"）。**凡采纳前必须读体**。订正要写回文档（本轮落在 `b3-screening-2026-09.md` §6）。
4. **区分"死读"与"漏读"**：`0x1d3`/`0x1d4`/`0x2f3` 的操作数在引擎里**也是**死读（形参在全函数体不出现）⇒ 这不是 bug，写进白名单的"有据豁免"而不是硬补。
5. **不静默跳过 → 也不许用工具悄悄放过**：`--set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**；`capabilities.js --validate` 与守卫测试口径现已对齐（都报"必须是字符串"）。**JSON note 里引用短语用「」，不要用裸 ASCII 引号**（会截断字符串）。
6. **手写的"统计量"必然漂移**：`counts` 曾是手写 ⇒ 实测漂移过一次（声明 `deferred 25/unimplemented 6` vs 实际 `31/0`）且无人发现。现在由 `build-opcode-gaps.mjs` 重算回填，`--check` 漂移即 exit 1。**凡是"由工具维护"的字段，就别手写。**
7. **`--check` 必须真的失败**：早前 `gaps:check` 只打印 ✗ 仍 `exit 0`（假"通过"）。已修。
8. **编辑文件一律用 `edit`/`write` 工具**；不要用 PowerShell `Set-Content`/双引号字符串（会吞反引号、写出 NUL）。**对既有共享文件只用 `edit` 定点替换，不要 `write` 整文件**（并发会丢更新）。
9. **定位引擎函数先 grep `//----- (004xxxxx)` 定义头**（按邻近常量猜位置已实测读错函数）。
10. **判定台账内文看 JSON 原文**，不要看渲染后的 md（md 呈现会截断）。
11. **每批出口判据**：守卫测试 + 文档同步（opcode-table / 三层台账 / 审计 §6 / 修复计划 §2d / 票据）+ `npm run verify` 全绿。
12. **新增 opcode 的四件套**：raw 行号注释 → `opcode-table.md` 行 → 台账 disposition（+ 重建生成物）→ 守卫测试。
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
    ⇒ 排优先级时**必须**先 `Select-String` 看实参形态是否高度一致 + 追一下"进这条分支的门是什么"，
    否则会把力气花在只有开发者菜单才会走到的指令上。

## 5. 剩余工作（按性价比排序）

> **残留规模（先看这个再挑活）**：`deferred` **27 条 = 292 处语料调用点**（轮 4 把 `0x22a`/`0x22c`/`0x22d`/`0x22f`
> 四条转成 implemented ⇒ 从 31 条 / 312 处降下来），其语义目前都不执行。
> **★但语料量会误导 —— 要按「是否在关键路径」折算**：原先排在第一的 `0x140`(**181**)
> 经读体确证**全在 DEBUG 路径**（`global 708ad6 == 1` 才进，该全局唯一写点 = `TITLE.txt:462` 的 DEBUG 菜单）
> ⇒ **正常剧情零影响**（见 `T-0088`）。折算后真正值得先做的是：
> `0x28`(32) / `0x86`(16) / `0x222`(10) / `0x87`(9) / `0x236`(6) / `0x36`(5) / `0x1d0`(5) /
> `0x25`(4) / `0x2fd`(4) / `0x32c`(4)，其余 16 条各 ≤1。
> `0x140` 顺带被**推翻旧理由**：`dword_55E1B4` 不是"运行时解析、静态定不了"，它**就是 `AGERC.DLL!_ShowDialog@12`**
> 这个 `__stdcall` 函数指针（首参 = 请求码），静态可枚举调用方 `−1/2/3/4/8/9/10`；真正卡住它的
> 是"返回值只能由真人点选 + 两张运行时表未建模 + 无对话框宿主缝" ⇒ 处置见 `T-0088`（含一个**产品策略**待定）。

### 5.1 三条"公共前置模型"（做完能一次解锁多条）

| # | 前置模型 | 解锁 | 依据 / 起手 |
|---|---|---|---|
| **1** | **平面/离屏合成**（路线 D） | `T-0066`（冷启动层序，**用户已指示"后续再处理"**）、`T-0084`（转场扫描带，规格已在手）、让 (B) 的 `ownerFrame` 近似退役 | `0x20D`/`0x20E` 的"画进哪个平面"；`scene/ops.ts` + presenter |
| **2** | ✅ **已完成（轮 4）**：Scene 世界矩阵 + 层号 20..29 的合成级 | `0x22a`/`0x22c`/`0x22d`/`0x22f` **4 条已 implemented**（`op_scene_scale`/`op_scene_translation`/`op_scene_axis_scale`/`op_scene_axis_translation`；新宿主缝 4 条、五处同步；守卫 `test/op-22a-22f-scene-world.test.ts` 13 条 + `op-22a-22f-scene-xform.test.ts` 12 条；第二层新条目 `scene-layer-xform-compose-20-29`） | 消费端 = `sub_4A1E90`（raw 122130-122157）→ `sub_49AA30` → 合成 Scene 世界矩阵。★**层号门的读法（上一轮记反了，已订正）**：RenderScene raw 133403 的 `if` 判据是 `(unsigned)(layer − 20) > 9` ⇒ **落在区间外**的项拿**完整**世界矩阵；**真正只作用于 20..29 层的是同一处的 `else` 支**（raw 133411-133438：`D3DXMatrixDecompose` 后**只把 2D 缩放与平移**装回 work 矩阵）。左右序 = `work ← work · sceneWorld`（行向量约定）⇒ `屏幕点 ← 屏幕点 × (sx,sy) + (tx,ty)`（缩放绕屏幕原点、平移**不被**该项自身缩放放大 —— 写反会变成 `pos·sx + tx·sx`，已设棘轮） |
| **3** | **混合模式消费端**（`T-0017`） | `0x33f`、`Item.blend`/`MeshObj.blend`、以及"引擎状态泄漏"那条未收敛结论 | `Item.blend` 已有写入端、缺 Pixi `blendMode` 消费 |

### 5.2 单点但边界清晰

- **`T-0084` 转场扫描带**：★**规格已在手**（`docs-new/03-engine/transition-render-spec-2026-09.md`：`sub_4B06D0` 体全覆盖读过，24 格全表 + 窗口门 + 条带几何 + 四类别画法 + emulator 集成点 + 守卫方案；关键公式我已独立复核）。**这是当前"静默缺失"里最容易兑现的一条**（脚本已经在写记录，只是没人画）。✅ **前置 `T-0087` 已完成**（`0x223` 的类别 0 记录已写进 `Scene+1048` 记录表；此前写进无人读的 `Engine.itemRegions`，178 处语料的转场对渲染端不可见）。★另有两条已订正：窗口门**不是** `0x400`（那是脚本等待门计时器），应接 `Scene+46508 → needsRender`；消费端区间是 raw **134417-136734**。
- ✅ **`T-0085` `set:BlankExtentMode`（轮 4 已完成）**：门与公式接线，mode 0 与旧纯算术逐字等价；★仍缺**宿主字形度量来源**（GDI `GetTextExtentPoint32A` 的等价物）⇒ mode 1 显式回退并把 `blankExtentFallback` 置真（缺口可见）；两种候选来源写在 `text/layout.ts` 文件尾。`0x204` 直绘与绘制期"无轮廓字"两点未接。
- **`0x1c4`**：需要**音频侧对外回读缝**（"语音总线是否占线"）；`AudioEngine` 有内部判据但 `NativeBridge` 只有 intent 方向，且 VM/音频跨进程 ⇒ 先定缝的形状。
- **`0x23a`**：先确证 `Engine+91322` 表的元素类型（全反编译仅 2 处读、**无写点**；与 `94672` 的 L2D 实例槽表**不是**同一张），再建 `+1068` 状态格与其消费者。
- **`T-0088` `0x140`/AGERC 对话框**：★**181 处全在 DEBUG 路径**（`global 708ad6 == 1`，唯一写点 `TITLE.txt:462`）⇒ 正常剧情零影响。卡点是"返回值只能由真人点选 + 两张运行时表未建模 + 无宿主缝"，且**含一个待定产品策略**（无 GUI 时 cmd 8 返回什么）。

### 5.3 批次尾巴

- **B2 计划层**（`T-0082`）：handler 只消费 `c.args` 的声明式操作数计划。★第一层已备好 **`frames[].len_slot`（`Engine 0x5D8F4`，`N = 2*argc+1`）**，可直接用它自动核验 argc；两条守卫（`opcode-operands`/`opcode-arity`）已经把"口径漂移"挡住，计划层是进一步收敛。
- **B4 剩余**：`0x34B`/`0x348`（L2D 节点缩放由标量扩三分量；语料 **0 处** ⇒ 维持**已披露偏差**）、`0x323`（等 B2 计划层）。
- **B7 P2/P3（218 条）**：按 **影响可见行为 > 回写操作数 > 纯记账** 排序，分批。
- **`ALLOW_UNDERRUN` 最后一条真 bug**：`0x12e`（悬停命中：遍历 count 个矩形、op2 未按体读）。

### 5.4 已知的小尾巴

- `tickets/` 里 2 条 evidence 行号漂移警告（都在 `src/renderer/scene/ops.ts`）—— 刷新 `line` 字段即可，不影响红绿。
- `analysis/opcode-gaps.json` 的 `counts` 现在由工具维护：**改了 disposition 一定要跑写模式**（`node scripts/build-opcode-gaps.mjs`），否则 `--check` 与守卫测试都会红（这是刻意的）。

## 6. 本段（轮 47+）已完成的关键成果（可直接引用）

**★B3 缺口清零（未实现 35 → 0 / 语料 203 → 0）**，实现 14 → **34**，deferred 11 → **27**，unjustified 4 → 0。

### 6.1 落地为真实现的（按族）

- **bit2 动画窗族 6 条 + `0x244`**：`0x230`→`op_reset_draw_item_loop`、`0x231`→`op_set_flipbook_loop`、`0x232`→`op_set_color_loop`、`0x233`→`op_set_scale_loop`、`0x234`→`op_set_rotation_loop`、`0x235`→`op_set_translation_loop`、`0x244`→`op_clear_draw_item_anim_starts`。
  新宿主缝 2 个（`native.setDrawItemLoop` 判别联合 / `clearDrawItemAnimStarts`，五处同步）；`KNOWN_DRAW_ITEM_FLAGS` `0b011 → 0b111`；B 层五通道求值进 `drawitem/eval.ts`；bit2 **不进 wait 门**。语义规格 = `b3-bit2-model-spec-2026-09.md`；守卫 `test/draw-item-loop-anim.test.ts`(14)。
  **7 处以体订正筛体方案**（`b3-screening-2026-09.md` §6）：`0x234` 是**旋转**不是平移、`0x235` 是平移往复不是 flipbook、`0x231` 是换格循环不是旋转、`0x230` 只清 `{540,544,548,552,556,560}` 且**不置脏**、`0x232` 的 `+576` ≠ `0x202` 的 `+100`、`+524..+536` 是**起点锁存槽**不是 delay。
- **转场记录族** `0x24f`/`0x250`/`0x251`：`Scene+1048` 的 96B（24 dword）记录表写入端 + 宿主缝 `native.setTransition`（含两条**方向相反**的边界分支）；`scClearTransitions` 按 `sub_4A9BE0` 改为**真 clear()**；守卫 `test/op-24f-250-251-transitions.test.ts`(8)。渲染端扫描带仍缺 ⇒ `T-0084`（规格已在手）。
- **音频族** `0x1ba`/`0xc1`：按类别的声音开关 / **BGM 暂停继续翻转**。★订正两处旧读法（不是「音量档位」、不是「静音/启用开关」—— `a2` 统一是 0 关/非 0 开，`±3` 只是 `sound:Music` 音源槽的符号开关机制）。宿主侧**真**暂停/继续（流式走 `setPaused`，缓冲宿主走"停播 + `offsetSec` 续播"）。
- **队列族** `0x132`/`0x133`/`0x134` + `0xd0`：`Engine.dispatchQueues`（11 队；`op1 > 0xA` 走错误串分支且**不动队列**）、`op_wall_clock_ms`（★订正：`Engine.wallClockMs` **不存在**，用既有的 `Engine.nowMs`）。
- **Scene 级变换族 `0x22a`/`0x22c`/`0x22d`/`0x22f`（轮 4）**：`op_scene_scale`/`op_scene_translation`/`op_scene_axis_scale`/`op_scene_axis_translation` + **4 条新宿主缝**（五处同步）+ `SceneState.sceneXform` + `applySceneXformToPlacement`/`sceneLayerAffected`；消费端 = `pixi/presenter.ts` 归并循环（item/text/mesh 三路）；守卫 `test/op-22a-22f-scene-world.test.ts`(13) + `test/op-22a-22f-scene-xform.test.ts`(12)；第二层新条目 `scene-layer-xform-compose-20-29`。**3 处读体订正**：`0x22f` 确为 `D3DXMatrixTranslation(Scene+387)`；★**层号门（此前记反）** = `(unsigned)(layer − 20) > 9` ⇒ **区间外**拿完整矩阵、**20..29 走 `else` 支**（`D3DXMatrixDecompose` 后只装回 2D 缩放+平移）；`0x22f` 的轴分量对 20..29 **无净效果**（旋转矩阵在该支被置单位阵）。左右序 = `work ← work · sceneWorld`（行向量）⇒ `屏幕点 ← 屏幕点 × (sx,sy) + (tx,ty)`。
- **`engine-internal-unjustified` 清零**：`0x10c`（VK→掩码位表；无键码表 ⇒ 零消费者，**`T-0052` 落地后必须移进 `OPS`**）、`0x324`/`0x325`（Effect3D 释放/销毁判据 ⇒ 有据 no-op）、`0x244`（已实现）。

### 6.2 台账 / 数据层

- **第一层回填**：`Engine 0x5D8F4 frames[].len_slot`（`N = 2*argc+1`）+ 18 条函数（全 ANALYZED）+ 5 支撑 + 53 字段（新作用域 `Layer`/`TransitionRecord`）；★随后订正 `DrawItem 0x244..0x24C` = **旋转轴**（不是平移分量），字段/函数改名消除 `trans_win_*`；轮 4 又补 9 条函数 + 13 条 Scene 变换字段。
- **第二层**：新增 `drawitem-loop-anim-frame-drive`（partial/E2）、`text-blank-extent-mode-gate`（轮 4 由 absent → **partial/E2**）、`scene-layer-xform-compose-20-29`（modeled-verified/E2）；`clock-read-transition-window` 由 absent → **partial/E2**（记录表已建模、扫描带仍缺）。
- **漏读清尾**：`ALLOW_UNDERRUN` 27 → 26，「确认是 bug」6 → 1；`0x1f9` 修好并**删条目**（机械判据）；`0x1d3`/`0x1d4`/`0x2f3` 核体后是引擎**死读**（有据豁免）；`0x33f` 三格全读但缺消费端（回链 `T-0017`）；`0x249` 同病 ⇒ `T-0086`（done，抽共用 `normalizeTextureColor`，归一化 = i32 域负值落 0、否则强置 `A=0xFF`）。
- **`T-0060` 收口**：真槽续跑链从「`0x231@RESETREIGNAN` × 333434 次死循环」变为「被跳过的未实现 opcode **0 个**」，轨迹 `REIGN.BIN → SETADVFLAG.BIN → SETGARDEN.BIN`。
- **`T-0085` 收口（轮 4）**：`set:BlankExtentMode` 门与公式接线（`layout.ts` 的 `blankAdvance`/`numberCellExtent` + `msgwin.ts` 的 `blankExtentOf`），**mode 0 与旧纯算术逐字等价**（零回归）；缺的宿主字形度量来源降级为**可见** `blankExtentFallback`（只在该标志为真时出现）而不是编数；两种候选来源（宿主 `measureText` 缝 / 自建 TTF `hmtx` 表）写在 `layout.ts` 文件尾。

### 6.3 工具修复（都用"注入漂移"反证过）

- `counts` 工具化：`build-opcode-gaps.mjs` 重算并**回填**真源（此前手写 ⇒ 实测漂移 `deferred 25/未实现 6` vs 实际 `31/0` 且无人发现）。
- `--check` 真失败：此前只打印 ✗ 仍 `exit 0`（假"通过"）；现在 md 陈旧与 counts 漂移都 exit 1。
- md 新增 **§6 deferred 段**：此前 31 条 deferred 在生成物里**完全不可见**。
- `capabilities.js --validate` 补 `emulator.note` 类型检查：`--set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**而旧 validate 放行。
- ★**踩坑记录（同一个坑被踩了三次）**：`--set` 的 ASCII 逗号 / 裸 ASCII 引号**会写坏 JSON**（`engine-capabilities.json` 因此一度整文件非法，靠人工最小修复救回）。
  ⇒ 结论：**note 里引用短语一律用「」，值里不要写 ASCII 逗号；改完立刻 `--validate`。**

### 6.4 未实现 → 有据 `deferred` 的收尾（不是"都实现了"）

- 最后 6 条（`0x22a`/`0x22c`/`0x22d`/`0x22f` 轮 4 已转 implemented；`0x1c4`/`0x23a` 仍 deferred）。
  - `0x1c4`：★筛体**归口整条错** —— 实为**语音总线占线查询**（`Engine+84128` = 语音对象），需音频侧对外回读缝。
  - `0x23a`：`Engine+91322` 表元素类型**未确证**（仅 2 处读、无写点；与 `94672` 的 L2D 槽表**不是**同一张）+ `+1068` 无消费者。
- `0x140`（181 处）：旧理由（"静态定不了目标"）被**推翻** —— `dword_55E1B4` = `AGERC.DLL!_ShowDialog@12`；且 181 处**全在 DEBUG 路径** ⇒ 正常剧情零影响 ⇒ `T-0088`（含一个待定**产品策略**）。

### 6.5 `T-0087`：`0x223` 容器错位（轮 4 发现并修复，**转场渲染的前置**）

- **错在哪**：`0x223` 是 `Scene+1048` 转场记录表·**类别 0（全屏交叉淡化）**的写入端（`sub_423F00` → `sub_4ADDB0`，`sub_4AAE10(_this + 262, &a2)` 的 `_this + 262` dword = 字节 **1048**，`[0] = 0`），emulator 却把逐格**正确**的 9 个数写进 `Engine.itemRegions` —— **数据对、容器错**，且那是个生产代码**零读者**的死模型（`check:dead-writes` 只扫 `Item`/`MeshObj`，覆盖不到）。后果：语料 **178 处 / 178 文件**的类别 0 转场对渲染端**完全不可见**；连"引擎先建 24 格默认记录再覆盖前 9 格"的行为也丢了（记录只有 9 格）。
- **怎么修**：handler 改名 `op_set_transition_fade`，改走 `native.setTransition`（= `0x24F`/`0x250`/`0x251` 同一条缝、同一张表）；删掉 `Engine.itemRegions`；旧测试删除、新守卫 `test/op-223-transition-fade.test.ts`（4 条：`length === 24`、`[0] === 0`、前 9 格逐格 deepEqual、`[9..13]` 默认、`itemRegions === undefined`、与 `0x24F` 同表不串格）；`op-24f-250-251-transitions` 保持 8/8 绿。
- ★**实现坑（已写进注释）**：8 个操作数**必须先读进局部量**再调用 —— 内联进 `setTransition?.(…)` 的实参表时，**可选调用在宿主无该缝时不求值实参**（`StubNative` 没有它）⇒ 8 格一个都不读，`opcode-operands` 直接红。
- ★**顺带订正**：`transition-render-spec` §2.3 曾把**类别 0** 的 `[13]` 来源记为 `a10`；实为 `a10` 只属**类别 1 的写入端 `sub_4ADEE0`**（12 参，raw 132679），类别 0 的 `sub_4ADDB0`（`a2..a9`）**不写 `[13]`**。已订正。
- **仍记缺口**：`sub_4ADDB0` 头部的惰性（重）建纹理层分支（`sub_4A2C10` 的 `0x460` 对象内部）未读完 ⇒ 未建模（属渲染端缺口）。

## 7. `T-0066`（读档画面残留）—— 状态：**用户已指示"后续再处理"**

- 已知：冷启动从 TITLE 读档时那块**橄榄灰大板是引擎自身行为** —— `NOVEL.txt:42-55` 的背景分支依赖**池外全局** `708ad6`/`708ada`（`T-0071`），全局为 0 时引擎走 `create-texture + i20b #808080` 的占位分支；`NOVEL.txt:29` 的 `i0ae` 又**早于**背景绘制（`:55`）⇒ 走栈收尾不会重跑它，背景只能来自**载荷项**。
- **待办**：热路径复验（进 SN0000 首句 → 菜单存档 → 从菜单读回该槽）—— 正确 ⇒ 走路线 D（平面/层序）；不正确 ⇒ 把 `slot-load-screen` 的 A/B 从合成脚本升级为**真脚本版**（同一份 SN0000：正常跑到第 794 句 vs 从槽 79 读档到它，比 `drawItems`/`meshes`/`msgWins`/`texSlots`）。

## 8. 工具速查

| 目的 | 命令 / 路径 |
|---|---|
| 全量验证 | `cd app/amayui-emulator && npm run verify` |
| 单文件测试 | `node --env-file=test/options.test.env --import tsx --test test/xxx.test.ts`（在 `app/amayui-emulator` 下） |
| 注册表分两张 | `OPS`（VM 核心）与 `NATIVE_OPS`（子系统）；测试里取 handler 要 `OPS.get(op) ?? NATIVE_OPS.get(op)` |
| 缺口台账 | `node scripts/build-opcode-gaps.mjs`（写模式，回填 counts）/ `--check`（CI，漂移 exit 1）；真源 `analysis/opcode-gaps.json` |
| 能力台账（第二层） | `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . [--validate|--attention|--id X]` + `node scripts/build-capabilities.mjs` |
| 脚本台账（第三层） | `.agents/skills/amayui-engine-analysis/scripts/scripts.js --root . [--validate|--coverage]` + `node scripts/build-scripts.mjs` |
| 开工前一页纸（脚本） | `node .agents/skills/amayui-script-analysis/scripts/brief.js <ID>` |
| 真机截图回归 | `npm run shot -- --load 79 --name X --page 870,900`；日志 `.tmp/amayui-emulator.log` |
| 引擎反编译 | `engine/天结_unpacked.exe_utf8.c`（**唯一权威**；函数头 `//----- (0040xxxx)`）；thunk 查 `…utf8.lst` |
| 票据 | `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --show T-00NN` / `--note` / `--set-status` / `--validate` |
| 两宿主对称 | 改宿主行为必须同时改 `headlessScene.ts`（测试/报告用）与 `pixiBackend.ts`（Electron GUI 用） |

## 9. 不要做的事

- 不手改生成物（`opcode-gaps.md` / `engine-capabilities.md` / `docs-new/05-scripts/*` / `tickets/README.md` / `scripts/asm/opcodes.json`）；
- 不为"看起来正常"新增启发式（尤其不要给 `#holdFrames` 打补丁）；
- 不把缺口塞进 `ENGINE_INTERNAL_OPS` 静默跳过（`gaps:check` 现在拦得住）；
- **不照抄筛体/规格文档的推断当结论**（先读体；本轮已实证 13 处错，含 2 处整条归口错）；
- 不改真实游戏数据（base `SAVE.DAT` / AGF 等只读；写入只落 `.overlay`）；
- 不在没有消费者的情况下往 `Item`/`MeshObj` 加字段，也不往"引擎没有的合成级"硬接；
- 做 git 提交（只写文件）。
