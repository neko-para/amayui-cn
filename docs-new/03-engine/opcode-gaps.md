---
kind: generated
state: live
home: analysis/opcode-gaps.json
generated_by: scripts/build-opcode-gaps.mjs
---

# 03-engine · opcode 缺口台账（生成物，勿手改）

> 真源 = `analysis/opcode-gaps.json`（人工登记 `disposition`/备注/票）；本文件由 `scripts/build-opcode-gaps.mjs` 渲染。
> 语料命中数与注册状态**实时计算**：`^\s*iXX\b` 扫 `src/*.txt`（941 个脚本），注册表扫 `app/amayui-emulator/src/vm/handlers/*.ts`。
> 纪律（审计 `docs-new/99-records/2026-09-audit/audit-2026-09.md` §1「不静默跳过」）：**任何不实现/近似都必须在这里有一条**，
> 否则 `test/opcode-gaps.test.ts` 会红。
>
> ★**本表只给一句话**（从真源 `note` 裁到 120 字）：`note` 是审计轨（体证叙事 + 逐轮沿革，71 条 ≈ 80 KB），
> 逐字铺进 md 会让生成物 92.8% 的字节都是它，而对"现在该怎么处置"没有导航价值。**全文取法**：
> `node .agents/skills/amayui-engine-analysis/scripts/gaps.js --show 0x140`（或直接读 `analysis/opcode-gaps.json`）。

## 1. 结论速览

- 语料出现的 opcode：**338** 种；handler 表注册：**364** 种（其中 no-op 插桩 13 种）
- **语料用到但未注册**（命中即 `NotImplementedOp`）：**0** 条，合计 **0** 次调用
- **已注册为 no-op 但体内有真实效果**（待改）：**0** 条
- 已实现（曾为缺口，保留记录）：**38** 条
- **已评估、按当前范围不实现（`deferred`，每条必须写扩展点）**：**20** 条（语料合计 276 次调用）—— 明细见 §6

## 2. 未实现（按语料命中数排序）

| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 文档状态 | 票 | 一句话（全文见 JSON） |
|---|---|---|---|---|---|---|---|---|---|

## 3. 已注册为 no-op，但体内有真实效果（必须改：补实现或显式缺口）

| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 体内真实效果（一句话） |
|---|---|---|---|---|---|---|

## 4. 已注册为 no-op，且已读体确认对 VM 不可观测（有据跳过）

| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 依据（一句话） |
|---|---|---|---|---|---|
| 0xaf | iaf | 0 | sub_419690 | 24775 | 唯一一条体里只写 arity 槽、不写任何引擎字段/操作数的指令（raw 24775-24783） |
| 0x10c | i10c | 11 | sub_4220B0 | 30616 | 体已读（raw 30616-30634；汇编 天结_unpacked.exe_utf8.lst 53610-53659）：arity 槽 `Engine[30*cur+95805]=5` → op1=掩码位（>0x1F 抛 ShowMess… |
| 0x137 | i137 | 1 | sub_4222B0 | 30703 | ResetStack(n)：删+建空栈；int 栈家族语料仅 1 处且无压栈 ⇒ 观测等价（T-0072） |
| 0x2fa | i2fa | 1 | sub_426910 | 33717 | 只写 Engine[1951]，全反编译无读取点 ⇒ 观测等价 no-op（T-0073） |
| 0x30a | i30a | 1 | sub_426B60 | 33818 | 键位注册（op1≤0x1F 且 op2≤7）；emulator 无按键表 ⇒ 不可观测（设计如此） |
| 0x324 | i324 | 3 | sub_41A470 | 25402 | 体已读：`sub_41A470`（raw 25402-25407）只置 arity 槽 `frames[cur]+0x74=1` 并尾调 `sub_453530(Engine[93384])`；`sub_453530` 是 thunk（`;… |
| 0x325 | i325 | 3 | sub_426DC0 | 33924 | 体已读（raw 33924-33938；汇编清单 61806-61820）：只置 arity 槽 `frames[cur]+0x74=5`，读 op1/op2 后写 `Engine[93384]`（= 字节 `0x5B320` = `Sce… |
| 0x326 | i326 | 1 | sub_426E10 | 33940 | 3D 效果·Snow：惰性建 ID3DXEffect(资源 202) 并重建 Snow 对象；emulator 无 3D 效果子系统 ⇒ 显式登记为缺口（不是无依据 no-op） |
| 0x327 | i327 | 1 | sub_426E70 | 33956 | SETWEATHER 族（`tickets/T-0093`，轮 6 由 `deferred` 转 `engine-internal` 有据 no-op） —— `0x327`（`sub_426E70` raw 33956-33964，arg… |
| 0x328 | i328 | 1 | sub_432300 | 41080 | SETWEATHER 族（`tickets/T-0093`） —— `0x328`（`sub_432300` raw 41080-41113，argc 3）：读 op1=handle、op2=网格 id 数组基址、op3=数量；把数组元素逐… |
| 0x329 | i329 | 1 | sub_426EB0 | 33966 | SETWEATHER 族（`tickets/T-0093`） —— `0x329`（`sub_426EB0` raw 33966-34000，argc 2）：读 op1=统一资源 id、op2=槽 → `sub_4559C0`（FileDB… |
| 0x32c | i32c | 4 | sub_426FC0 | 34012 | SETWEATHER 族（`tickets/T-0093`） —— `0x32C`（`sub_426FC0` raw 34012-34030，argc 6）：读 6 个 float（`sub_41C300` ×6）→ `sub_499CE0… |
| 0x32e | i32e | 1 | sub_427110 | 34057 | SETWEATHER 族（`tickets/T-0093`） —— `0x32E`（`sub_427110` raw 34057-34113，argc 11）：op9=α（夹 255）、op10=RGB（拼 ARGB 后逐通道 `× dbl… |

## 5. 已实现（曾登记为缺口）

| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 说明（一句话） |
|---|---|---|---|---|---|---|
| 0x7c | i7c local-ret | 668 | sub_41AB80 | 25778 | T-0076 | local-ret = 「重显示调用」的返回端：与 0x199 严格成对（回到 redisplayReturn、按 redisplayScriptId 做深度校验、还原 effect_flags、清 redisplayMode）；B3 已实… |
| 0x85 | i85 | 1 | sub_418F50 | 24471 | T-0076 | sub_418F50（raw 24471-24476）→ sub_45EBE0（raw 74182-74194）清的是本票的两张 vector（Font+3364 的 72B 记录表 + Font+3380 的 8B 回看页表），不是 GD… |
| 0xc1 | ic1 | 1 | sub_419770 | 24831 | T-0076 | 音频子系统对象上的标志翻转（不是未读体）：体 raw 24831-24841 = `v1 = _this + 174454`（同族 raw 24828 就是 sub_489B50＝停 BGM/清当前曲 id ⇒ 这是音乐子系统对象）、`v1… |
| 0xd0 | id0 | 6 | sub_42E910 | 38790 | T-0076 | 引擎 handler sub_42E910（体起始 raw 38790）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 38790-38798）= arity 槽 3、`sub… |
| 0x132 | i132 | 5 | sub_422150 | 30647 | T-0076 | raw 30647-30699；审计 P1。★筛体(2026-09)：体已读（raw 30647-30680）= 通用 `Queue_int` 重建：`op1 > 0xA` ⇒ 打「RESETQ」错误串、不动队列；否则析构旧队列（`(v4)… |
| 0x133 | i133 | 10 | sub_422240 | 30683 | T-0076 | raw 30647-30699；审计 P1。★筛体(2026-09)：体已读（raw 30683-30701）= 通用 `Queue_int` push：`op1 > 0xA` ⇒ 打「ADDQ」错误串；否则 `sub_409E10(Eng… |
| 0x134 | i134 | 5 | sub_42F810 | 39359 | T-0076 | 引擎 handler sub_42F810（体起始 raw 39359）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 39359-39398）= 通用 `Queue_int`… |
| 0x147 | i147 | 1 | sub_42FD60 | 39655 | T-0076 | 轮 7（tickets/T-0093 第②半）已实现：`src/vm/handlers/region-hittest.ts` + 注册进 `OPS`（`handlers/index.ts`）；守卫 `app/amayui-emulator/… |
| 0x191 | i191 | 13 | sub_42CEC0 | 37896 | T-0076 | fabs：op1=\|op2\|（浮点）；B3 已实现（ARITHMETIC_OPS 的 op_fabs），守卫 test/op-191-fabs.test.ts |
| 0x1a6 | i1a6 halve-strlen | 217 | sub_42D110 | 37974 | T-0076 | halve-strlen：strlen(op2)>>1（字节口径）；B3 已实现（STRING_OPS 的 op_halve_strlen），守卫 test/op-string-len.test.ts。★同时订正 0x2C5（strlen）… |
| 0x1b2 | i1b2 | 3 | sub_42A9B0 | 36550 | T-0076 | 文本累加缓冲追加字符串：arity 槽 = 3；v2 = sub_41B9B0(_this, 1)；sub_40C660(_this + 124336, v2, strlen(v2))。B3 已实现（STRING_OPS 的 op_text… |
| 0x1b3 | i1b3 | 2 | sub_42AA00 | 36560 | T-0076 | 文本累加缓冲追加 CRLF：arity 槽 = 1；sub_40C660(_this + 124336, asc_51EE84, 2u)，asc_51EE84（raw 4320）= "\r\n"。B3 已实现（STRING_OPS 的 op… |
| 0x1b4 | i1b4 | 1 | sub_428DB0 | 35322 | T-0076 | 文本累加缓冲取出整段并清空：*(_DWORD *)(_this + 120*cur + 383220) = 1；sub_4034F0(_this)；sub_40B420(_this + 497344, 0, 0xFFFFFFFF)。B3 已… |
| 0x1ba | i1ba | 11 | sub_421200 | 29985 | T-0076 | 体已读 ⇒ 音频属性档位菜单（卡模型）：`0x1BA` 本体是按 op1 分派（`1→sub_408CF0`、`2→sub_408D90`、`3→sub_408E20`、`4→sub_408EB0`，raw 29994-30012+）；读第… |
| 0x1c8 | i1c8 to-string | 11 | sub_433820 | 41989 | T-0076 | to-string：op1 = "%d" 的十进制字符串(op2)。体 raw 41989-42010 全文 = arity 槽 5、v2 = sub_41BF50(_this,2)、sub_408050(Buffer,256,"%d",v… |
| 0x1d0 | i1d0 | 5 | sub_42D440 | 38098 | T-0076 | 页表 Font+3380（8B/条 {窗号, 起始记录下标}）+ 双游标 Font+859/[860] 已建在 src/vm/textItems.ts（pages/cursor/baseCursor）；读端 = handlers/text-… |
| 0x20b | i20b | 204 | sub_423690 | 31568 | T-0076 | FillTexture：往纹理槽表面填纯色矩形（op4/op5=宽/高、op6 α 夹 255、op7 → 0xFFRRGGBB）；B3 已实现（GFX_TEXTURE_NATIVE_OPS + TextureCache.fillSlotR… |
| 0x223 | i223 | 178 | sub_423F00 | 31936 | T-0076 | 给绘制项登记区域记录（9 dword，键=handle）：按引擎 sub_4ADDB0 逐格原样存进 Engine.itemRegions（[2]=op7 [3]=op8 [4]=op2槽 [5]=op3 [6]=op5 [7]=op4 [… |
| 0x228 | i228 | 1097 | sub_430650 | 39972 | T-0076 | 绘制项当前平移 getter（+0x16C work 矩阵）；B1 已实现（GFX_ITEM_OPS + 宿主缝 getDrawItemTranslation） |
| 0x22a | i22a | 2 | sub_424080 | 32003 | T-0076 | Scene 级「立即缩放」（tickets/T-0076；体 raw 32003-32016 → sub_49A720 raw 117117-117126）：三条操作数全是 float（sub_41C300），op1 不是 handle（体… |
| 0x22c | i22c | 6 | sub_424180 | 32034 | T-0076 | Scene 级「立即平移」（tickets/T-0076；体 raw 32034-32046 → sub_49A820 raw 117153-117162）：三条操作数全是 float（sub_41C300，没有 handle 查表）、不除… |
| 0x22d | i22d | 5 | sub_4241F0 | 32048 | T-0076 | Scene 级「带轴缩放」（tickets/T-0076；体 raw 32048-32064 → sub_49A870 raw 117165-117179）：op1/op2 走 int 池（sub_41BF50）落 Scene[295]/[… |
| 0x22f | i22f | 7 | sub_424330 | 32087 | T-0076 | Scene 级「带轴平移」（tickets/T-0076；体 raw 32087-32103 → sub_49A9C0 raw 117222-117236）：op1/op2 走 int 池（sub_41BF50）落 Scene[297]/[… |
| 0x230 | i230 | 116 | sub_4243B0 | 32105 | T-0076 | 体极短但卡渲染消费端：`v2 = op1` → `sub_4AD580(_this + 80708, v2)`（Scene API）；读 `sub_4AD580`（raw 132151 起）确认整族语义 = `Item.flags` 清 b… |
| 0x231 | i231 | 25 | sub_4243F0 | 32115 | T-0060 | 与 `0x230`/`0x235` 同族（`Item.flags` bit2）⇒ 卡渲染消费端：族共用 `sub_4AD580`（raw 132151 起：`sub_4AAA50` 缺失即建项 → `sub_4AAD40` 取元素 → `*… |
| 0x232 | i232 | 8 | sub_424440 | 32131 | T-0076 | 引擎 handler sub_424440（体起始 raw 32131）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 32131-32164 → sub_4AD730 raw… |
| 0x233 | i233 | 5 | sub_424510 | 32166 | T-0076 | 图元尺寸动画（raw 32166-32182，读 op3/4/5 float）；审计 P1 op-3-002。★筛体(2026-09)：体已读（raw 32166-32182 → sub_4AD7B0 raw 132260-132286）—… |
| 0x234 | i234 | 4 | sub_4245B0 | 32185 | T-0076 | 引擎 handler sub_4245B0（体起始 raw 32185）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 32185-32201 → sub_4AD850 raw… |
| 0x235 | i235 | 158 | sub_424630 | 32203 | T-0076 | 与 `0x230` 同族（`Item.flags` bit2）⇒ 卡渲染消费端：族共用的 `sub_4AD580`（raw 132151 起）= `sub_4AAA50`（缺失即建项）→ `sub_4AAD40` 取元素 → `*v4 &=… |
| 0x23f | i23f | 3 | sub_4307B0 | 40018 | T-0076 | ★2026-09（目标轮 33-34）改判：`op2` 是纹理槽号而不是节点键 —— `src/FIELD.txt:13718-13721` 是 `create-texture 2a 78 78 0` → `i236 …` → `i23f … |
| 0x243 | i243 | 341 | sub_41B180 | 26016 | T-0076 | 复位 0x400 等待门计时器（Engine[92338]/[92339] 清零，门控 Engine[92340] bit1）；B3 已实现（GFX_STATE_OPS 的 op_reset_wait_timer），守卫 test/op-a… |
| 0x244 | i244 | 1 | sub_41A370 | 25349 | T-0077 | 体有真实效果：遍历绘制项把 flags&2 者的动画窗起点清 0（raw 25349-25355 → sub_4AD9F0）⇒ 需按体实现。★B3 已实现（GFX_ITEM_OPS 的 op_clear_draw_item_anim_sta… |
| 0x24f | i24f | 6 | sub_4258F0 | 32969 | T-0076 | 引擎 handler sub_4258F0（体起始 raw 32969）；★B3 已实现（handler op_set_blind_wipe；宿主缝 native.setTransition → SceneState.render4.tra… |
| 0x250 | i250 | 34 | sub_425980 | 32997 | T-0076 | 语料 34 处/20 文件 ★B3 已实现（handler op_set_transition_slide_blur；宿主缝 native.setTransition → SceneState.render4.transitions），守卫… |
| 0x251 | i251 | 44 | sub_425A10 | 33025 | T-0076 | 语料 44 处/21 文件 ★B3 已实现（handler op_set_transition_zoom_blur；宿主缝 native.setTransition → SceneState.render4.transitions），守卫 … |
| 0x2e9 | i2e9 | 480 | sub_426620 | 33579 | T-0076 | ADV 自动翻页行基准（_this[122464]）；B1 已实现（ENGINE_FIELD_STORE）；消费端（自动翻页）仍是缺口 |
| 0x2f2 | i2f2 | 1 | sub_4318A0 | 40687 | T-0076 | 轮 7（tickets/T-0093 第②半）已实现：与 `0x147` 同一个新模块 `src/vm/handlers/region-hittest.ts`、同一个守卫文件。体已逐行读全（raw 40687-40721）＝椭圆命中测试：4… |
| 0x307 | i307 | 3 | sub_426AE0 | 33793 | T-0076 | SetConfig(system:EffectSkipOnClick)：0x306 getter 的唯一写入端（setConfigValue 同一注册表）；B3 已实现（ENGINE_FIELD_OPS 的 op_set_effect_sk… |

## 6. 已评估、按当前范围不实现（`deferred`：每条都必须写清扩展点）

> 这些**不是"没做"**，而是「按当前重写范围不做 / 需要先建某个模型」—— 每条 note 里都写了扩展点。
> 编号排在最后是为了不打乱 §2–§5 的既有引用（审计报告引用过 §5）。

| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 票 | 扩展点 / 理由（一句话） |
|---|---|---|---|---|---|---|---|---|
| 0x140 | i140 | 181 | 181 | 4 | sub_42FBC0 | 39570 | T-0076 | AGERC 对话框（外部 DLL）——目标已静态定位（★推翻旧结论「静态定不了目标服务／需真机动态调试」）：`dword_55E1B4` = `AGERC.DLL!_ShowDialog@12`，不是函数表、不是对象指针、不是运行时装入的模… |
| 0x28 | i28 | 32 | 15 | 4 | sub_41D860 | 27500 | T-0076 | 体已读开头（raw 27500-27519）⇒ 卡子系统：长度槽 = 9（argc 4）；`op4 < 0 \|\| op4 > 4` ⇒ `sprintf(_this+8, aComefbl2Type01)` + `sub_4034D0`（打… |
| 0x86 | i86 | 16 | 5 | 1 | sub_41FA20 | 28944 | T-0076 | 体已读（raw 28944-28961）⇒ 卡子系统：`v2 = op1` → `sub_4559C0(FileDB, …, v2, &v6)`（按统一 id 解析记录、带 size 出参）→ `sub_455560` 取字节 → `sub… |
| 0x222 | i222 | 10 | 10 | 2 | sub_423EC0 | 31924 | T-0076 | SETPOLYGON/INFOxx 10 处（handler sub_423EC0 → sub_4B4460）；capabilities 台账曾误标 n/a-known；审计 P0 render-3d-layer-dual-commit。★… |
| 0x87 | i87 | 9 | 5 | 0 | sub_418F80 | 24478 | T-0076 | 引擎 handler sub_418F80（体起始 raw 24478）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 24478-24488）= arity 槽 1；`res… |
| 0x236 | i236 | 6 | 3 | 4 | sub_4246B0 | 32221 | T-0076 | 引擎 handler sub_4246B0（体起始 raw 32221）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 32221-32288）⇒ 不是消息窗/文本族，而是网格… |
| 0x36 | i36 | 5 | 3 | 3 | sub_41E7E0 | 28168 | T-0076 | 引擎 handler sub_41E7E0（体起始 raw 28168）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 28168-28200）= 非 ADV 时 `effec… |
| 0x25 | i25 | 4 | 1 | 3 | sub_41D590 | 27393 | T-0076 | STAGERAID 4 处（raw 27393-27430，含刷输入）；审计 P1 op-4-04。★筛体(2026-09)：体已读（raw 27393-27430）= 非 ADV 时 `effect_flags \|= 8` → `sub_… |
| 0x2fd | i2fd | 4 | 4 | 6 | sub_431CF0 | 40829 | T-0076 | 引擎 handler sub_431CF0（体起始 raw 40829）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 40829-40900+）= 读鼠标点击队列：`n = … |
| 0x26 | i26 | 1 | 1 | 4 | sub_41D6A0 | 27432 | T-0076 | 引擎 handler sub_41D6A0（体起始 raw 27432）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 27432-27464）= arity 槽 9；`op4… |
| 0x2b | i2b | 1 | 1 | 5 | sub_41DA20 | 27567 | T-0076 | 引擎 handler sub_41DA20（体起始 raw 27567）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 27567-27601）= arity 槽 11；`op… |
| 0x82 | i82 | 1 | 1 | 5 | sub_41F720 | 28808 | T-0076 | 轮 8 现状订正（用户实测）：ADV → 设置界面 → 右键退出时命中 `i082` 硬停（`source: corpus-unregistered` 的那条路）。体已读（raw 28808-28826）：只读 op1..op5 → `su… |
| 0x144 | i144 | 1 | 1 | 2 | sub_433AB0 | 42064 | T-0076 | 引擎 handler sub_433AB0（体起始 raw 42064）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 42064-42153）= op1/op2 各作有界 1… |
| 0x1c4 | i1c4 | 1 | 1 | 1 | sub_42E8A0 | 38773 | T-0076 | 引擎 handler sub_42E8A0（体起始 raw 38773）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 38773-38781）= arity 槽 3；`v2 … |
| 0x1d1 | i1d1 | 1 | 1 | 5 | sub_420310 | 29353 | T-0076 | 订正（2026-09 路线 C）：本条不是「度量」，而是「回看页重绘」的脚本入口；旧标签「GDI 文本写入侧」与旧卡点「度量/字体口径未建模」都不准确。体已读，raw 29353-29371（argc 5）：op1 = 窗口号、op2 = … |
| 0x23a | i23a | 1 | 1 | 2 | sub_4306F0 | 39990 | T-0076 | 体已读（raw 39990-40001）：arity 槽 = 5；`v2 = _this[sub_41BF50(_this, 2) + 91322]`；`v2 == 0` ⇒ op1 = 0，否则 op1 = (`*(_DWORD *)(v… |
| 0x241 | i241 | 1 | 1 | 5 | sub_424FA0 | 32576 | T-0076 | 引擎 handler sub_424FA0（体起始 raw 32576）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 32576-32645）⇒ 音频播放对象族：惰性建 `E… |
| 0x2cf | i2cf | 1 | 1 | 1 | sub_4263D0 | 33477 | T-0076 | 宿主窗口缺口（不是未读体）：体 raw 33477-33493 = 读 op1 → 只接受 0/1（其余什么都不做）→ `sub_413DD0(_this, v)`；而 sub_413DD0（raw 21438 起，体里有 HMONITOR… |
| 0x24d | i24d | 0 | 0 | 12 | sub_4255E0 | 32840 | T-0084 | 语料 0 处（`grep -c i24d src/*.txt` = 0）⇒ 现在实现它没有任何可见收益。体内真实行为：`sub_4255E0`（raw 32840-32957）读 op1..op12 → `sub_4ADEE0`（raw 1… |
| 0x337 | i337 | 0 | 0 | 4 | sub_427680 | 34271 | T-0076 | 语料 0 处（`grep -c 'i337 ' src/*.txt` = 0）⇒ 现在实现它没有任何可见收益；登记它是为了消掉 `T-0076` 列表里最后一条「无注册也无登记」的静默项（审计 P1 `op-3-002` 曾把它与 `0x2… |
