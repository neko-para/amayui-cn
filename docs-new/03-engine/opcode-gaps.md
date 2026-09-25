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
> ★**「注册了没有」与「做全了没有」是两件事**：`implemented` 只回答前者（写上就再没人回头核对），
> 「已注册、但相对引擎体还缺分支/消费端/写者」一律 `partial` + `missing[]`（§7，`tickets/T-0149`）。
>
> ★**本表只给一句话**（从真源 `note` 裁到 120 字）：`note` 是审计轨（体证叙事 + 逐轮沿革，71 条 ≈ 80 KB），
> 逐字铺进 md 会让生成物 92.8% 的字节都是它，而对"现在该怎么处置"没有导航价值。**全文取法**：
> `node .agents/skills/amayui-engine-analysis/scripts/gaps.js --show 0x140`（或直接读 `analysis/opcode-gaps.json`）。

## 1. 结论速览

- 语料出现的 opcode：**338** 种；handler 表注册：**367** 种（其中 no-op 插桩 13 种）
- **语料用到但未注册**（命中即 `NotImplementedOp`）：**5** 条，合计 **0** 次调用
- **已注册为 no-op 但体内有真实效果**（待改）：**0** 条
- 已实现（曾为缺口，保留记录）：**37** 条
- **已评估、按当前范围不实现（`deferred`，每条必须写扩展点）**：**19** 条（语料合计 264 次调用）—— 明细见 §6
- **部分实现（`partial`：handler 已达语料级可用，但相对引擎体仍缺分支/消费端）**：**83** 条 opcode / **140** 条缺口 —— 明细见 §7

## 2. 未实现（按语料命中数排序）

| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 文档状态 | 票 | 一句话（全文见 JSON） |
|---|---|---|---|---|---|---|---|---|---|
| 0x105 |  | 0 | 0 | 1 | sub_421E20 | 30504 | 已核对 | T-0111 | 引擎 handler sub_421E20（定义 raw 30503-30512；派发表槽 raw 22982）= 置步长槽 `_this[30*_this[95776]+95805] = 3` 后 `op1 = _this[122246]… |
| 0x22e |  | 0 | 0 | 6 | sub_424290 | 32067 | 已核对 | T-0111 | 引擎 handler sub_424290（定义 raw 32066-32084；派发表槽 raw 23085）= Scene 级「立即旋转」：`f3..f6 = sub_41C300(_this, 3..6)`（float）、`op2/o… |
| 0x2ca |  | 0 | 0 | 1 | sub_430990 | 40086 | 已核对 | T-0111 | 引擎 handler sub_430990（定义 raw 40085-40097；派发表槽 raw 23151）= 置步长槽 `= 3`；`v2 = _this[5082]`（显示对象/DrawItem 容器）—— 空 ⇒ `sub_42B… |
| 0x309 |  | 0 | 0 | 5 | sub_432000 | 40957 | 已核对 | T-0111 | 引擎 handler sub_432000（定义 raw 40956-41007；派发表槽 raw 23214）= 鼠标指针位置 → 虚拟显示坐标换算，写回 5 个操作数：`sub_477C80(Input = _this+258, &Po… |
| 0x339 |  | 0 | 0 | 7 | sub_4277A0 | 34308 | 已核对 | T-0111 | 引擎 handler sub_4277A0（定义 raw 34307-34327；派发表槽 raw 23241）= 3D 层节点「立即旋转轴/角」：`f4..f7 = sub_41C300(_this, 4..7)`（float）、`op3… |

## 3. 已注册为 no-op，但体内有真实效果（必须改：补实现或显式缺口）

| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 体内真实效果（一句话） |
|---|---|---|---|---|---|---|

## 4. 已注册为 no-op，且已读体确认对 VM 不可观测（有据跳过）

| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 依据（一句话） |
|---|---|---|---|---|---|
| 0xaf | iaf | 0 | sub_419690 | 24775 | 唯一一条体里只写 arity 槽、不写任何引擎字段/操作数的指令（raw 24775-24783） |
| 0x137 | i137 | 1 | sub_4222B0 | 30703 | ResetStack(n)：删+建空栈；int 栈家族语料仅 1 处且无压栈 ⇒ 观测等价（T-0072） |
| 0x2fa | i2fa | 1 | sub_426910 | 33717 | 只写 Engine[1951]，全反编译无读取点 ⇒ 观测等价 no-op（T-0073） |
| 0x308 | i308 | 31279 | sub_426B20 | 33807 | T-0163（T-0111 判据② 的落地形状）：体 = `sub_426B20`（raw 33808-33815 是派发表槽 / 定义 raw 12579）读 op1 → `sub_407B20(_this[96981], op1)`（r… |
| 0x30a | i30a | 1 | sub_426B60 | 33818 | 键位注册（op1≤0x1F 且 op2≤7）；emulator 无按键表 ⇒ 不可观测（设计如此） |
| 0x324 | i324 | 3 | sub_41A470 | 25402 | 体已读：`sub_41A470`（raw 25402-25407）只置 arity 槽 `frames[cur]+0x74=1` 并尾调 `sub_453530(Engine[93384])`；`sub_453530` 是 thunk（`;… |
| 0x325 | i325 | 3 | sub_426DC0 | 33924 | 体已读（raw 33924-33938；汇编清单 61806-61820）：只置 arity 槽 `frames[cur]+0x74=5`，读 op1/op2 后写 `Engine[93384]`（= 字节 `0x5B320` = `Sce… |
| 0x326 | i326 | 1 | sub_426E10 | 33940 | 3D 效果·Snow：惰性建 ID3DXEffect(资源 202) 并重建 Snow 对象；emulator 无 3D 效果子系统 ⇒ 显式登记为缺口（不是无依据 no-op） |
| 0x32c | i32c | 4 | sub_426FC0 | 34012 | SETWEATHER 族（`tickets/T-0093`） —— `0x32C`（`sub_426FC0` raw 34012-34030，argc 6）：读 6 个 float（`sub_41C300` ×6）→ `sub_499CE0… |

## 5. 已实现（曾登记为缺口）

| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 说明（一句话） |
|---|---|---|---|---|---|---|
| 0x3 | i3 call-script | 8111 | sub_41C6A0 | 26761 | T-0156 | handler sub_41C6A0（体 raw 26761-26800）：`cur >= 39` ⇒ `ShowMessageError(「ファイルの階層が深すぎます．最大は%dです．」, 40，码 65537)`（raw 26776-2… |
| 0x6 | load-frame load-frame | 5 | sub_41C7C0 | 26822 | T-0156 | 0x6 = sub_41C7C0（体 raw 26822-26863）＝把脚本装进指定帧：入口把长度槽写成 5；v3 = readIntOperand(1)（脚本身份）、v4 = readIntOperand(2)（目标帧号）；先 `383… |
| 0x8 | call-frame call-frame | 116 | sub_41C900 | 26876 | T-0156 | 0x8 = sub_41C900（体 raw 26876-26913）＝进入一个已装载的帧：入口把长度槽写成 3；保存 cur 到 383108（call_ret）；v2 = readIntOperand(1)、`cur = v2`；若目标… |
| 0x85 | i85 | 1 | sub_418F50 | 24471 | T-0076 | sub_418F50（raw 24471-24476）→ sub_45EBE0（raw 74182-74194）清的是本票的两张 vector（Font+3364 的 72B 记录表 + Font+3380 的 8B 回看页表），不是 GD… |
| 0xae |  | 339 | sub_4192F0 | 24633 | T-0156 | 0xae = sub_4192F0（体 raw 24633 起）：`frames[cur][95780]`（本帧带存档版本记录）为 0 直接返回；否则读两个版本号 v3 / v4（经 `_this+174405` 对象 vtable 的 `… |
| 0xbf | ibf play-bgm | 790 | sub_420CC0 | 29753 | T-0152 | T-0149 迁入（审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4 的逐条 finding）：handler 已达语料级可用，但相对引擎体仍缺 1 条… |
| 0xc1 | ic1 | 1 | sub_419770 | 24831 | T-0076 | 体 raw 24831-24841 = `v1 = _this + 174454`（同族 raw 24828 就是 sub_489B50＝停 BGM/清当前曲 id ⇒ 这是音乐子系统对象）、`v1[260] = v1[260] == 0`… |
| 0xd0 | id0 | 6 | sub_42E910 | 38790 | T-0076 | 引擎 handler sub_42E910（体起始 raw 38790）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 38790-38798）= arity 槽 3、`sub… |
| 0x101 | i101 poll-input | 1498 | sub_419CC0 | 25068 | T-0158 | T-0149 迁入（审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4 的逐条 finding）：handler 已达语料级可用，但相对引擎体仍缺 1 条… |
| 0x10c | i10c | 11 | sub_4220B0 | 30616 | T-0163 | 已真实现（T-0163；原判 engine-internal 的豁免理由随 T-0052/T-0163 落地而失效）。按体 raw 30616-30634：arity 槽 5 ⇒ op1=掩码位、op2=键码；op1 unsigned > … |
| 0x132 | i132 | 5 | sub_422150 | 30647 | T-0076 | raw 30647-30681；审计 P1。体已读 = 通用 `Queue_int` 重建：`op1 > 0xA` ⇒ 打「RESETQ」错误串、不动队列；否则析构旧队列 → `new(0x1C)` → `sub_407C50`（`new[… |
| 0x191 | i191 | 13 | sub_42CEC0 | 37896 | T-0076 | fabs：op1=\|op2\|（浮点）；B3 已实现（ARITHMETIC_OPS 的 op_fabs），守卫 test/op-191-fabs.test.ts |
| 0x1a6 | i1a6 halve-strlen | 217 | sub_42D110 | 37974 | T-0076 | halve-strlen：strlen(op2)>>1（字节口径）；B3 已实现（STRING_OPS 的 op_halve_strlen），守卫 test/op-string-len.test.ts。 |
| 0x1ab | i1ab | 1 | sub_42DFC0 | 38462 | T-0153 | T-0149 迁入（审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4 的逐条 finding）：handler 已达语料级可用，但相对引擎体仍缺 0 条… |
| 0x1b3 | i1b3 | 2 | sub_42AA00 | 36560 | T-0076 | 文本累加缓冲追加 CRLF：arity 槽 = 1；sub_40C660(_this + 124336, asc_51EE84, 2u)，asc_51EE84（raw 4320）= "\r\n"。B3 已实现（STRING_OPS 的 op… |
| 0x1b4 | i1b4 | 1 | sub_428DB0 | 35322 | T-0076 | 文本累加缓冲取出整段并清空：*(_DWORD *)(_this + 120*cur + 383220) = 1；sub_4034F0(_this)；sub_40B420(_this + 497344, 0, 0xFFFFFFFF)。B3 已… |
| 0x1c8 | i1c8 to-string | 11 | sub_433820 | 41989 | T-0076 | to-string：op1 = "%d" 的十进制字符串(op2)。体 raw 41989-42010 全文 = arity 槽 5、v2 = sub_41BF50(_this,2)、sub_408050(Buffer,256,"%d",v… |
| 0x1d0 | i1d0 | 5 | sub_42D440 | 38098 | T-0076 | 页表 Font+3380（8B/条 {窗号, 起始记录下标}）+ 双游标 Font+859/[860] 已建在 src/vm/textItems.ts（pages/cursor/baseCursor）；读端 = handlers/text-… |
| 0x201 | i201 | 0 | sub_4302B0 | 39858 | T-0161 | T-0149 迁入（审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4 的逐条 finding）：handler 已达语料级可用，但相对引擎体仍缺 1 条… |
| 0x20b | i20b | 204 | sub_423690 | 31568 | T-0076 | FillTexture：往纹理槽表面填纯色矩形（op4/op5=宽/高、op6 α 夹 255、op7 → 0xFFRRGGBB）；B3 已实现（GFX_TEXTURE_NATIVE_OPS + TextureCache.fillSlotR… |
| 0x222 | i222 | 10 | sub_423EC0 | 31924 | T-0167 | SETPOLYGON/INFOxx 10 处（handler `sub_423EC0` raw 31924-31934 → 真身 `sub_4B4460` raw 136968-137285）。★2026-09-24 已真实现（T-0167… |
| 0x223 | i223 | 178 | sub_423F00 | 31936 | T-0076 | 转场记录表 Scene+1048 · 类别 0（全屏交叉淡化）的写入端：按引擎 `sub_4ADDB0` 把 op1..op8 逐格存进该表（键 = op1）；所有写入都经 `sub_4AAE10(_this + 262, &key)` —… |
| 0x228 | i228 | 1097 | sub_430650 | 39972 | T-0076 | 绘制项当前平移 getter（+0x16C work 矩阵）；B1 已实现（GFX_ITEM_OPS + 宿主缝 getDrawItemTranslation） |
| 0x22a | i22a | 2 | sub_424080 | 32003 | T-0076 | Scene 级「立即缩放」（tickets/T-0076；体 raw 32003-32016 → sub_49A720 raw 117117-117126）：三条操作数全是 float（sub_41C300），op1 不是 handle（体… |
| 0x22c | i22c | 6 | sub_424180 | 32034 | T-0076 | Scene 级「立即平移」（tickets/T-0076；体 raw 32034-32046 → sub_49A820 raw 117153-117162）：三条操作数全是 float（sub_41C300，没有 handle 查表）、不除… |
| 0x230 | i230 | 116 | sub_4243B0 | 32105 | T-0076 | 体极短：`v2 = op1` → `sub_4AD580(_this + 80708, v2)`（Scene API）；读 `sub_4AD580`（raw 132151 起）确认整族语义 = `Item.flags` 清 bit2（`su… |
| 0x231 | i231 | 25 | sub_4243F0 | 32115 | T-0060 | 与 `0x230`/`0x235` 同族（`Item.flags` bit2）：族共用 `sub_4AD580`（raw 132151 起：`sub_4AAA50` 缺失即建项 → `sub_4AAD40` 取元素 → `*v4 &= ~4… |
| 0x232 | i232 | 8 | sub_424440 | 32131 | T-0076 | 引擎 handler sub_424440（体起始 raw 32131）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 32131-32164 → sub_4AD730 raw… |
| 0x233 | i233 | 5 | sub_424510 | 32166 | T-0076 | 图元尺寸动画（raw 32166-32182，读 op3/4/5 float）；审计 P1 op-3-002。★筛体(2026-09)：体已读（raw 32166-32182 → sub_4AD7B0 raw 132260-132286）—… |
| 0x235 | i235 | 158 | sub_424630 | 32203 | T-0076 | 与 `0x230` 同族（`Item.flags` bit2）：族共用的 `sub_4AD580`（raw 132151 起）= `sub_4AAA50`（缺失即建项）→ `sub_4AAD40` 取元素 → `*v4 &= ~4u`（清 … |
| 0x243 | i243 | 341 | sub_41B180 | 26016 | T-0076 | 复位 0x400 等待门计时器（Engine[92338]/[92339] 清零，门控 Engine[92340] bit1）；B3 已实现（GFX_STATE_OPS 的 op_reset_wait_timer），守卫 test/op-a… |
| 0x250 | i250 | 34 | sub_425980 | 32997 | T-0076 | 语料 34 处/20 文件 ★B3 已实现（handler op_set_transition_slide_blur；宿主缝 native.setTransition → SceneState.render4.transitions），守卫… |
| 0x251 | i251 | 44 | sub_425A10 | 33025 | T-0076 | 语料 44 处/21 文件 ★B3 已实现（handler op_set_transition_zoom_blur；宿主缝 native.setTransition → SceneState.render4.transitions），守卫 … |
| 0x2f2 | i2f2 | 1 | sub_4318A0 | 40687 | T-0076 | 轮 7（tickets/T-0093 第②半）已实现：与 `0x147` 同一个新模块 `src/vm/handlers/region-hittest.ts`、同一个守卫文件。体已逐行读全（raw 40687-40721）＝椭圆命中测试：4… |
| 0x307 | i307 | 3 | sub_426AE0 | 33793 | T-0076 | SetConfig(system:EffectSkipOnClick)：0x306 getter 的唯一写入端（setConfigValue 同一注册表）；B3 已实现（ENGINE_FIELD_OPS 的 op_set_effect_sk… |
| 0x341 | i341 | 335 | sub_427BA0 | 34460 | T-0160 | T-0149 迁入（审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4 的逐条 finding）：handler 已达语料级可用，但相对引擎体仍缺 4 条… |
| 0x34e | i34e | 4 | sub_428200 | 34696 | T-0160 | T-0149 迁入（审计 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4 的逐条 finding）：handler 已达语料级可用，但相对引擎体仍缺 5 条… |

## 6. 已评估、按当前范围不实现（`deferred`：每条都必须写清扩展点）

> 这些**不是"没做"**，而是「按当前重写范围不做 / 需要先建某个模型」—— 每条 note 里都写了扩展点。
> 编号排在最后是为了不打乱 §2–§5 的既有引用（审计报告引用过 §5）。

| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 票 | 扩展点 / 理由（一句话） |
|---|---|---|---|---|---|---|---|---|
| 0x140 | i140 | 181 | 181 | 4 | sub_42FBC0 | 39570 | T-0076 | AGERC 对话框（外部 DLL）——目标已静态定位（不是「静态定不了目标服务／需真机动态调试」）：`dword_55E1B4` = `AGERC.DLL!_ShowDialog@12`，不是函数表、不是对象指针、不是运行时装入的模块基址，… |
| 0x28 | i28 | 32 | 15 | 4 | sub_41D860 | 27500 | T-0076 | 体已读开头（raw 27500-27519）⇒ 卡子系统：长度槽 = 9（argc 4）；`op4 < 0 \|\| op4 > 4` ⇒ `sprintf(_this+8, aComefbl2Type01)` + `sub_4034D0`（打… |
| 0x86 | i86 | 16 | 5 | 1 | sub_41FA20 | 28944 | T-0076 | 体已读（raw 28944-28961）⇒ 卡子系统：`v2 = op1` → `sub_4559C0(FileDB, …, v2, &v6)`（按统一 id 解析记录、带 size 出参）→ `sub_455560` 取字节 → `sub… |
| 0x87 | i87 | 9 | 5 | 0 | sub_418F80 | 24478 | T-0076 | 引擎 handler sub_418F80（体起始 raw 24478）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 24478-24488）= arity 槽 1；`res… |
| 0x236 | i236 | 6 | 3 | 4 | sub_4246B0 | 32221 | T-0076 | 引擎 handler sub_4246B0（体起始 raw 32221）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 32221-32288）⇒ 不是消息窗/文本族，而是网格… |
| 0x36 | i36 | 5 | 3 | 3 | sub_41E7E0 | 28168 | T-0076 | 引擎 handler sub_41E7E0（体起始 raw 28168）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 28168-28200）= 非 ADV 时 `effec… |
| 0x25 | i25 | 4 | 1 | 3 | sub_41D590 | 27393 | T-0076 | STAGERAID 4 处（raw 27393-27430，含刷输入）；审计 P1 op-4-04。★筛体(2026-09)：体已读（raw 27393-27430）= 非 ADV 时 `effect_flags \|= 8` → `sub_… |
| 0x2fd | i2fd | 4 | 4 | 6 | sub_431CF0 | 40829 | T-0076 | 引擎 handler sub_431CF0（体起始 raw 40829）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 40829-40900+）= 读鼠标点击队列：`n = … |
| 0x26 | i26 | 1 | 1 | 4 | sub_41D6A0 | 27432 | T-0076 | 引擎 handler sub_41D6A0（体起始 raw 27432）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 27432-27464）= arity 槽 9；`op4… |
| 0x2b | i2b | 1 | 1 | 5 | sub_41DA20 | 27567 | T-0076 | 引擎 handler sub_41DA20（体起始 raw 27567）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 27567-27601）= arity 槽 11；`op… |
| 0x144 | i144 | 1 | 1 | 2 | sub_433AB0 | 42064 | T-0076 | 引擎 handler sub_433AB0（体起始 raw 42064）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 42064-42153）= op1/op2 各作有界 1… |
| 0x1c4 | i1c4 | 1 | 1 | 1 | sub_42E8A0 | 38773 | T-0076 | 引擎 handler sub_42E8A0（体起始 raw 38773）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。体已读（raw 38773-38781）= 语音总线「有通道在响」查询：arity 槽 3；`v2… |
| 0x23a | i23a | 1 | 1 | 2 | sub_4306F0 | 39990 | T-0076 | 体已读（raw 39990-40001）：arity 槽 = 5；`v2 = _this[sub_41BF50(_this, 2) + 91322]`；`v2 == 0` ⇒ op1 = 0，否则 op1 = (`*(_DWORD *)(v… |
| 0x241 | i241 | 1 | 1 | 5 | sub_424FA0 | 32576 | T-0076 | 引擎 handler sub_424FA0（体起始 raw 32576）；文档状态「仅映射」；未读体 ⇒ 实现前必须先读体（审计未逐条覆盖）。★筛体(2026-09)：体已读（raw 32576-32645）⇒ 音频播放对象族：惰性建 `E… |
| 0x2cf | i2cf | 1 | 1 | 1 | sub_4263D0 | 33477 | T-0076 | 宿主窗口缺口（不是未读体）：体 raw 33477-33493 = 读 op1 → 只接受 0/1（其余什么都不做）→ `sub_413DD0(_this, v)`；而 sub_413DD0（raw 21438 起，体里有 HMONITOR… |
| 0x7d | i07d | 0 | 0 | 2 | sub_41F580 | 28735 | T-0151 | T-0151：与 0x6E（sub_41EB20 raw 28307-28386）逐句同形，唯一差别是读串用 sub_41A780(_this, 2)（十六进制/转义形态）而不是 sub_41B640；门 = `!Engine[21668]… |
| 0x84 | undefined | 0 | 0 | 1 | sub_41F790 | 28828 | T-0168 | 回看/跳读泵的 opcode 形态（置位 `0x100000`）：派发表项 `_this + 676524`（= `675996 + 4*0x84`，raw 22833）指向 `sub_41F790`（定义 raw 28829-28942）… |
| 0x24d | i24d | 0 | 0 | 12 | sub_4255E0 | 32840 | T-0084 | 语料 0 处（`grep -c i24d src/*.txt` = 0）⇒ 现在实现它没有任何可见收益。体内真实行为：`sub_4255E0`（raw 32840-32957）读 op1..op12 → `sub_4ADEE0`（raw 1… |
| 0x337 | i337 | 0 | 0 | 4 | sub_427680 | 34271 | T-0076 | 语料 0 处（`grep -c 'i337 ' src/*.txt` = 0）⇒ 现在实现它没有任何可见收益；登记它是为了消掉 `T-0076` 列表里最后一条「无注册也无登记」的静默项（审计 P1 `op-3-002` 曾把它与 `0x2… |

## 7. 部分实现（`partial`：已注册、已达语料级可用，但相对引擎体仍缺分支 / 消费端 / 写者）

> **口径（`tickets/T-0149`）**：`partial` = handler **已达语料级可用**（语料跑得通、不是硬停也不是纯 no-op），
> 但**相对引擎体仍缺**某条分支 / 某个消费端 / 某个写者，或某处只是**披露近似**。
> 它与邻居的分工：`implemented` = 已读完体且不缺东西；`engine-internal` = 有据 no-op；
> `deferred` = 按当前范围整个不做；`partial` = **做了，但没做全**。
>
> ★**每条 `partial` 必须带 `missing[]`**（真源里逐条 `{what, ticket, raw}`）：`what` = 缺哪条分支/能力（一句话，带引擎行为描述）、
> `ticket` = 承接它的票（必须在 `tickets/` 下真实存在）、`raw` = 引擎行号或**单一段**行区间。
> `test/opcode-gaps.test.ts` 是棘轮：`missing[]` 空/缺字段、票号不存在、`raw` 不合规、或把 `missing[]` 挂在非 `partial` 上，一律红。
> **本段按承接票分组**（下表把每条缺口摊成一行，便于各票逐条销账；销完即从 `missing[]` 删掉，全空则处置改回 `implemented`）。

### 7.1 T-0082（3 条 opcode / 3 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x192 | i192 set-string | 17747 | 36825-36888 | 引擎的 int 数组操作数语义是「该池槽存一个指向 `vector<int>` 的指针」（`sub_42AEA0` case `0x8003` raw 36825-36856 在槽为空时 `operator new(0x10)` 自动建向量、`ENC` 后把指针写回池槽并登记进 `_this+95768`）；emulator 的数组模型（`T-0082` 的 `0x2C9` / `refFromOperand`）是「元素从基址槽起连续排」。两者在**元素 0** 上重合（`readStringOperand` 就取首元素），但「扩容 / 自动建数组」这一层不对应。扩展点 = 按 `sub_42AEA0` 的指针模型重做数组操作数。 |
| 0x193 | i193 concat | 123 | 36825-36888 | 引擎的 int 数组操作数语义是「该池槽存一个指向 `vector<int>` 的指针」（`sub_42AEA0` case `0x8003` raw 36825-36856 在槽为空时 `operator new(0x10)` 自动建向量、`ENC` 后把指针写回池槽并登记进 `_this+95768`）；emulator 的数组模型（`T-0082` 的 `0x2C9` / `refFromOperand`）是「元素从基址槽起连续排」。两者在**元素 0** 上重合（`readStringOperand` 就取首元素），但「扩容 / 自动建数组」这一层不对应。扩展点 = 按 `sub_42AEA0` 的指针模型重做数组操作数。 |
| 0x1b2 | i1b2 | 3 | 36825-36888 | 引擎的 int 数组操作数语义是「该池槽存一个指向 `vector<int>` 的指针」（`sub_42AEA0` case `0x8003` raw 36825-36856 在槽为空时 `operator new(0x10)` 自动建向量、`ENC` 后把指针写回池槽并登记进 `_this+95768`）；emulator 的数组模型（`T-0082` 的 `0x2C9` / `refFromOperand`）是「元素从基址槽起连续排」。两者在**元素 0** 上重合（`readStringOperand` 就取首元素），但「扩容 / 自动建数组」这一层不对应。扩展点 = 按 `sub_42AEA0` 的指针模型重做数组操作数。 |

### 7.2 T-0093（4 条 opcode / 4 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x327 | i327 | 1 | 126552-126572 | 引擎的天气/场景管理器初始化 `sub_4A6EE0`（raw 126522-126574；A1 指为 SETWEATHER 族的残余落点）真会建/改两个天气绘制对象（`sub_4A2C10(Engine, 36\|37, …)`）并按 `a3` 写 `Engine+46668`（0/1/2 质量档）、置 `+46848 = 1`；emulator 没有天气对象模型 ⇒ 现在是有据 no-op，缺的正是这层模型 |
| 0x328 | i328 | 1 | 126552-126572 | 引擎的天气/场景管理器初始化 `sub_4A6EE0`（raw 126522-126574；A1 指为 SETWEATHER 族的残余落点）真会建/改两个天气绘制对象（`sub_4A2C10(Engine, 36\|37, …)`）并按 `a3` 写 `Engine+46668`（0/1/2 质量档）、置 `+46848 = 1`；emulator 没有天气对象模型 ⇒ 现在是有据 no-op，缺的正是这层模型 |
| 0x329 | i329 | 1 | 126552-126572 | 引擎的天气/场景管理器初始化 `sub_4A6EE0`（raw 126522-126574；A1 指为 SETWEATHER 族的残余落点）真会建/改两个天气绘制对象（`sub_4A2C10(Engine, 36\|37, …)`）并按 `a3` 写 `Engine+46668`（0/1/2 质量档）、置 `+46848 = 1`；emulator 没有天气对象模型 ⇒ 现在是有据 no-op，缺的正是这层模型 |
| 0x32e | i32e | 1 | 126552-126572 | 引擎的天气/场景管理器初始化 `sub_4A6EE0`（raw 126522-126574；A1 指为 SETWEATHER 族的残余落点）真会建/改两个天气绘制对象（`sub_4A2C10(Engine, 36\|37, …)`）并按 `a3` 写 `Engine+46668`（0/1/2 质量档）、置 `+46848 = 1`；emulator 没有天气对象模型 ⇒ 现在是有据 no-op，缺的正是这层模型 |

### 7.3 T-0151（12 条 opcode / 28 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x6e | i6e show-text | 80983 | 28339-28343 | emulator 把引擎那条『跳读位非 0 ⇒ 122455 保持 1』的分支接到了 ReadTextSkip 门关闭 的路上：advanceReveal（handlers/msgwin.ts:440-441）先按 readTextSkipOf(e) 置 0，再 if (m.skipMode !== 0) m.showing = 1; 无条件顶成 1 |
| 0x6e | i6e show-text | 80983 | 28358-28361 | 0x6e 的 0x8000000 置位后没有明确的清零点：引擎只在 0x72（raw 28520）、0xFA（raw 24966）与 ADV 分支 sub_411900 的「未显示完判定」里清它；emulator 里 advanceReveal 为真时置位，清位只有 serviceAdv 的一拍… |
| 0x6e | i6e show-text | 80983 | 28361-28368 | 引擎 sub_48F000（sub_41EB20 raw 28350、sub_41ED80 raw 28439）是「该窗的 .8.8x 条目表里第 a3 项」查询：非 0 ⇒ raw 28358 置 0x8000000 且 122455 = 1；返回 0 且 97050 == 0 ⇒ raw 28355/28451/28459 只清 122455，从不置 ADV |
| 0x70 | i70 | 10 | 73132-73193 | 每窗离屏表面（0x70 重建 / 0x71 清底 / sub_45BE20 逐行贴出）未建模：重写侧以纯排版模型 + canvas2D 光栅化替代，无 DC 取/还与源色键贴出 |
| 0x70 | i70 | 10 | 73156-73163 | 引擎把 w/h 重复写进两组字段：obj+20/+24（v10[5]/v10[6]）与 obj+36/+40（换行边界）；emulator 只写 g.w/h + g.wrapRight/wrapBottom 两组语义槽，引擎的「同一窗对象上 +20/+24 与 +36/+40 分别被不同读者取用… |
| 0x70 | i70 | 10 | 73164-73175 | 落点 sub_45D660 的 D3D/GDI 互斥支（sub_4A7170 重建表面 / sub_43C8D0+sub_43B070 提交铺排）在 emulator 完全缺席：几何写完后不发任何「表面尺寸变化」意图，只发 emitWin 的文本载荷 |
| 0x71 | i71 | 90713 | 28429-28431 | sub_41ED80 尾部 sub_48FFB0(_this + 80107) 是消息窗队列的冲刷点（与 0x72 raw 28529 的 sub_4BB840 三槽交付同属「待显消息槽」这一层），emulator 的 op_message_show 只清本窗文本 + 重排显现，没有任何队列冲刷/交付 |
| 0x71 | i71 | 90713 | 28440-28457 | sub_41ED80 在三条出口上都把 Engine[122496] = 0（raw 28444/28449/28457），emulator 从不动这个格子：122496 是 0x72 raw 28518 交付门的第一项（!_this[122496]）与 0xFA 之外的「待显消息」标志，emulator 全库无对应字段 ⇒ 「0x71 清标记」这一步在 emulator 不… |
| 0x71 | i71 | 90713 | 28442-28444 | 引擎在本条必然写 _this[122496] = 0（三条出口都写，raw 28444/28449/28457）并在跳读支写 _this[122455] = 1、_this[174801] \|= 0x8000000；emulator 的 handler 只经 advanceReveal 间接动 effect_flags，122496 一格完全不写，122455 只在 adva… |
| 0x72 | i72 wait-for-input | 30204 | 28506-28509 | 引擎的早退判据是 _this[122455]（本页文本显示中），emulator 用的是 advanceReveal(e)（readTextSkipOf(e) !== 0 的等价物）；两者在「门关（ReadTextSkip = 0）但 122455 = 1」时不重合：引擎跳到 LABEL_17 武装但不消费输入，emulator 会 clearAdv 后继续走 consume… |
| 0x72 | i72 wait-for-input | 30204 | 28526-28532 | 引擎在 !122496 && !(mask & 0x40) 时对 3 个消息槽做交付循环：sub_4BB840(Voice, i, _this[122505+i], _this[122508+i], *(int*)((char*)_this + 4*i - 469808)) 并把槽清 0，emulator 只做 input.consumeEdges()，122505..122… |
| 0x72 | i72 wait-for-input | 30204 | 28556-28558 | 共存消息支（v7 = _this[97052] == 0; _this[97053] = 0; if (!v7) { …按 122501 选 message:AutoMessage*/MessagePitch 系数… if (v10 <= 100) v10 = 100; sub_453A60(_this+107545, v10); }）在 emulator 的 handler… |
| 0x75 | i75 | 1492 | 24062-24070 | 引擎把字号同步写进三到五格：Font+201684 = op1、Font+1232 = -op1（主 lfHeight）、Font+101972 = -op1（注音 lfHeight），并在 Font+201680 == 0 时补 Font+1236 = Font+101976 = op1 / -2（半高）；emulator 只写 ENGINE_FIELD.fontSize… |
| 0x75 | i75 | 1492 | 70940-71273 | 字体参数 → GDI HFONT 句柄重建级联（sub_459F40 / sub_45A6E0）缺失：只写字段不重建句柄，量宽与缩放修正整块未建模 |
| 0x82 | i82 | 1 | 79504-79508 | *(_DWORD *)(*(_DWORD *)(_this + 4 * a2 + 1044) + 112) == 1 时引擎走专用路径 sub_462040 并直接 return（不进后面的 GDI 重画与设色）；emulator 无这条路径，任何窗都走同一条 emitWin |
| 0x82 | i82 | 1 | 79649-79653 | op3 & 0x30（bit4/bit5）时引擎额外调 sub_4ABB60(Engine[1040], win+276, win+280)；emulator 没有 sub_4ABB60 这一步（不做宿主侧 DrawItem 释放/重登记），但它并不是不碰 itemRanges：emitWin 每次都把 itemRanges: itemRangesOf(e, w) 发进宿主载… |
| 0x82 | i82 | 1 | 79687-79688 | op3 & 0x40（bit6）会把起始记录下标整体后移窗的 +132（行游标）：引擎 if ( (a4 & 0x40) != 0 ) v155 = *(_DWORD *)(v44 + 132) + v45;；emulator 的 start 只用 op2 原值过越界门，bit6 完全未建模 ⇒ 带 bit6 的调用会从错误的记录起重画… |
| 0x82 | i82 | 1 | 79699-79700 | op3 & 1（bit0）参与记录过滤：引擎 if ( (v49 & 2) != 0 && (a4 & 1) == 0 ) goto LABEL_188;（该记录自带 bit1 且 op3 未置 bit0 ⇒ 跳过这条记录）；emulator 无记录级过滤，emitWin 整窗重排 |
| 0x196 | i196 display-furigana | 6341 | 29104-29110 | 第③路（文本块已置）的 bit16 只在 `sub_46BE30` 返回非 0（= 本行有内容，`*a3 != 0`）时才置；emulator 的 `addRuby` 没有「本行有内容吗」的返回值语义 ⇒ 现按 bit0 无条件置 |
| 0x196 | i196 display-furigana | 6341 | 83509-83514 | 窗对象 `+112 == 1` 的专用路径（`sub_46B100`，raw 83509-83514）未建模 |
| 0x205 | i205 | 313 | 10716-10739 | set:BlankExtentMode==1 的空白字前进量缺宿主字体度量来源（GDI GetTextExtentPoint32A 的等价物）⇒ 按 measured=false 显式回退成网格 |
| 0x205 | i205 | 313 | 12228-12236 | set:BlankExtentMode == 1 时引擎把整个 cy 换成逐字 GDI 量宽（半角 2 × 量宽(0x20)、全角 量宽(0x8140)），emulator 只接了门与公式、没有度量来源 ⇒ numberCellExtent 按 measured: false 返回原 gridCy，于是 x 前进量与串落点和引擎在 mode 1 下不同 |
| 0x213 | i213 | 10 | 31769-31774 | 对象表项为空（引擎 _this[op1 + 21585] == 0，raw 31769-31774）时引擎的 +104/+108 两个写都跳过，而 emulator 的 op_msgwin_obj_range 走 object(idx)，MsgWindow.object()（vm/msgwin.ts:761-784）在缺项时新建对象并把 (op2,op3) 写进 f104/f… |
| 0x2be | i2be | 0 | 33411-33420 | 漏掉同步写的第二个注音字重格：引擎 op1≠0 时把 _this[75971]（Font+218588）与 _this[21327]（Font+1308，注音 LOGFONTA 模板的 lfWeight）同时写 700；emulator 只写第一个 |
| 0x2be | i2be | 0 | 33411-33420 | 0x2BE 的第二个字重格同样漏写：引擎 sub_426260 在真支同时写 *(_DWORD *)(v1 + 218588) = 700; 与 *(_DWORD *)(v1 + 1308) = 700;（假支同写 0；v1 = Font 基址），emulator 只写 ENGINE_FIELD.rubyWeight（Font+218588）与 m.font.rubyBold… |
| 0x2be | i2be | 0 | 71212-71213 | sub_45A6E0 的首行早退门（Font+1320 字节为 0 则注音字体重建整体 no-op）在 emulator 无对应物，字号/字重变更始终即时生效 |
| 0x2c8 | undefined | 0 | 42420 | 引擎那 256 字节栈缓冲的**下界外读**不复制：`strcpy_s(Destination, 0x100u, …)`（raw 42401）之后逐字节循环的第一步就对 `Destination[-1]` 调 `_mbbtype`（raw **42420**）——那是**未初始化栈字节**，无确定行为可照抄；emulator 以 `SJIS_SUBSTR_CHARS_NOT_COPIED` 有据登记（含判据与 recheck 条件） |
| 0x301 | i301 | 3 | 10747-10750 | 引擎 sub_404F80 对传入窗号做 0⇒默认窗 的重定向（if ( !a2 ) v2 = *(_DWORD *)(_this + 1228);，raw 10748-10749），emulator 的 op_msgwin_slot_clear 把 op1 直接当窗号用（e.msgwin.object(v)），没有把 0 映射到 defaultWin |

### 7.4 T-0152（13 条 opcode / 17 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0xb4 | ib4 play-sound-effect | 2170 | 137638-137654 | 装载不写 FileDB 的『已使用文件』表（SE id 与 0x19D 的查询集不相交 ⇒ 接了观测不到） |
| 0xb5 | ib5 | 2155 | 138605-138612 | 值域内但该通道无缓冲 ⇒ dsPlay(%d) 并拒绝起播（与『装载未完成⇒挂起』这条异步近似冲突，故未建模） |
| 0xba | iba | 154 | 138605-138612 | 值域内但该通道无缓冲 ⇒ dsPlay(%d) 并拒绝起播（与『装载未完成⇒挂起』这条异步近似冲突，故未建模） |
| 0xbb | ibb | 0 | 12041-12110 | sub_406DF0 的 1000 格影片播放器表（对象 +1120/+1144 两格）未建模；只做了外层门（set:DependMovieSound + movie 位） |
| 0xbc | ibc | 0 | 12041-12110 | sub_406DF0 的 1000 格影片播放器表（对象 +1120/+1144 两格）未建模；只做了外层门（set:DependMovieSound + movie 位） |
| 0xc2 | ic2 | 943 | 106287-106291 | 起播前提的另一半：Music[264]（当前音量运行态）== 0（宿主无该运行态，等价物只有『无播放句柄』） |
| 0x1ba | i1ba | 11 | 12041-12110 | sub_406DF0 的 1000 格影片播放器表（对象 +1120/+1144 两格）未建模；只做了外层门（set:DependMovieSound + movie 位） |
| 0x1bc | i1bc | 213 | 24851-24855 | Engine[21290]（Engine+85160，语音子系统对象指针）恒 0 ⇒ 释放通道那半是死代码；本工程按『宿主语音对象始终存在』建模，不复制那个假分支 |
| 0x1c9 | i1c9 | 0 | 138380-139100 | DirectSound 设备丢失 ⇒ 设备/对象重建 + 按 SE[1212+ch] 重载 10 通道（sub_4B5090）与错误重试未实现 |
| 0x2f4 | i2f4 | 8 | 33638 | sub_407120（帧内文本收尾）未建模 —— 重写侧由帧循环统一收尾 |
| 0x2f5 | i2f5 | 30 | 142661-142667 | ADV 位已置时引擎对 0x2F5 是「写槽」（op2 落 Voice[5053+op4]，起播时由 sub_4BB840 当 pan/延迟参数消费），emulator 的 op_voice_queue 直接发 voice-queue（宿主按 delayMs 到期就播、不看 ADV 位） |
| 0x2f6 | i2f6 | 86687 | 33676-33693 | 0x2F6 的引擎字段回写全缺：Engine[21315+ch]=0、[21318+ch]=0、[122505+ch]=0、[122508+ch]=0 与 [122501] = 三路语音是否有正忙的 在 emulator 全部不做，导致同一条复位指令在 engineValues 里无痕（0x1BC 会写、0x2F6 不写） |
| 0x2f6 | i2f6 | 86687 | 33676-33693 | sub_426820 写的是 _this[v2 + 21315] = 0; _this[v2 + 21318] = 0; _this[v2 + 122505] = 0; _this[v2 + 122508] = 0;（同一基址 v2=op1 下的 4 格）；emulator 的 op_voice_reset 只发 voice-reset{ch}，宿主 voiceReset 清… |
| 0x2f6 | i2f6 | 86687 | 33683-33687 | 0x2F6 在 emulator 里不写它应当清零的三个引擎字段：引擎体逐字清零 Engine[21315+ch]（语音通道状态位，0x2F7 写的那格）、Engine[21318+ch]（音量因子状态位）、Engine[122505+ch]/Engine[122508+ch]（寄存语音槽 id/标志），并把 sub_404CB0 的返回值写回 Engine[122501]；… |
| 0x2f8 | i2f8 | 14644 | 139063-139089 | 引擎的通道上界是「设备通道号 < 15」（即语音通道 ch ≤ 2 之外还覆盖 3..14 的直通通道），emulator 的 #voiceChannel 只认 0..2 ⇒ ch=3..14 时引擎会写 Sound[ch+375] 并下发 SetPan，emulator 只打一条越界日志、什么都不做 |
| 0x2f8 | i2f8 | 14644 | 139064-139089 | sub_4268D0 把 op2 交给 sub_4B6940 后会写设备格 _this[a2 + 375] = v5;（钳制后的值）再下发；emulator 的 voicePan 只把钳制值放进宿主通道对象（v.pan）并 setPan，没有对应的引擎字段写 —— 侧车的 voice[].pan 是宿主私有量，engineValues 里没有设备 pan 格 |
| 0x2f8 | i2f8 | 14644 | 33638-33648 | 0x2F5/0x2F4/0xC4/0x1BD 一族的 ADV 寄存分支：ADV 激活位在场时引擎把语音寄存进 _this[v3 + 122505]/[v3 + 122508]（raw 33639-33648 是 0x2F4 的形状），等 ADV 位清除后的冲刷点统一起播；emulator 的 voicePlayOrDefer 分叉判据与体一致，但寄存槽落在宿主通道对象… |

### 7.5 T-0153（7 条 opcode / 11 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x1f8 | i1f8 create-texture | 1305 | 122847-122848 | `0x1F8` 的这条路径（`sub_4A2C10` raw 122847-122848）只写**两格**：槽→imgid 记录 `Scene[5*slot+466] = -1`（raw 122847 的 `*(_DWORD *)(_this + 20 * a2 + 1864)`，= `5*slot + 466`）与槽状态 `Scene[5*slot+470] = 1`（raw 122848）。**槽记录那一格已落地**（T-0153 的 VM 半边：`op_create_texture` 写 `Engine.texSlots`，守卫 `test/op-15xx-gfx-texture-vm.test.ts`）；**槽状态那一格在 emulator 仍没有落点**。★颜色那一格 `Scene[5*slot+467]` 不由这条路径写（写它的是 `0x249` 路的 `sub_4A3800` raw 123380 `v7[467] = a5`）；它与 `0x1F9`/`0x249` 同属一张数组，消费端仍缺（`tickets/T-0153/changes-texvm.md` §4 的 C3） |
| 0x1f8 | i1f8 create-texture | 1305 | 31171-31188 | 引擎 create-texture 在建设定表面之前会先销毁该槽已有的对象（_this[op1 + 94672]＝对象表的 op1 格，不是先转槽号；与 0x20F play-movie、0x236 sub_4246B0 建 entry 的是同一张 1000 槽表：sub_488FB0 + vtable 析构 + 置 0）；emulator 的 createTexture 只… |
| 0x1f9 | i1f9 set-texture | 1096 | 31191-31244 | op3（颜色）在引擎里是被消费的：归一化后作 a5 传 sub_4A3800 → sub_49E9D0，最终作为第 4 实参进表面对象 vtable+28 的装载调用（raw 119762-119766），并写进与 CTexture 表面表并列的第二个数组 Scene[5*slot+467]（raw 123380；注意它不是『槽记录』，0x1F8 建表面时不重置它） |
| 0x1f9 | i1f9 set-texture | 1096 | 31191-31244 | 引擎 set-texture 在按 op1 开文件之前先销毁该槽的 movie 播放器对象（_this[op2 + 94672]，与 0x20F play-movie 同一张 1000 槽表：sub_488FB0 + vtable 析构 + 置 0，raw 31211-31221）；emulator 只有 bindTexture，没有 per-slot movie 记录可清 |
| 0x1fa | i1fa | 10051 | 31245-31269 | 该槽 movie/对象（`Engine[slot + 94672]`）在**宿主侧**已建模（T-0153 的 renderer 子集：`TextureCache.noteSlotNode` / `HeadlessScene.slotNodes`，且 `0x1F8`/`0x1F9`/`0x1FA` 的宿主路径都清它）；**VM 侧仍没有这张表** —— `0x236`（`sub_4246B0` raw 32245-32264）的 handler 未注册，`0x20F` 只经 `native.playMovie` 在宿主侧建对象 ⇒ `0x23F` 的「对象存在」判据只能问宿主（`native.slotNodeSize`） |
| 0x208 | i208 | 1173 | 39865-39878 | 近似：图像经 IPC 异步到货，同一批指令里的 0x208 只能答 0×0（引擎此时已是真宽高）；唯一自愈是脚本再发一次 set-texture 或帧屏障之后 |
| 0x23f | i23f | 3 | 40018-40032 | **两张表已分开**（T-0153 的 VM 半边）：`0x23F` 的取值来源已从 `Engine.texSizes`（`0x1F8` 记的表面尺寸镜像）改为**宿主的对象表** `native.slotNodeSize(slot)`（= `Engine[slot + 94672]` 的投影，raw 40025-40029）；`0x208` 仍读表面表（`Scene + 4*slot + 42456`）。★仍披露的近似：宿主 `slotNodeSizeOf` 在「有对象」时答**该槽表面**的尺寸（`src/FIELD.txt:13718-13721` 是唯一语料现场），不是 `obj[+1044]` 那个子对象 —— 引擎那条链在 `sub_4080B0` 未分派类型时返回 `0.0`（raw 12967/12979），宿主同码答 0 |
| 0x246 | i246 | 0 | 32679-32703 | 引擎有两道门：if ( _this[result + 94672] )（该槽没有对象 ⇒ 不读 op2、不调用）与 if ( *(_DWORD *)(v4 + 1084) == dword_52839C )（对象类型标记不符 ⇒ 不调用）；emulator 两道都没有，无条件读 op2 并把调用送给宿主缝  ★T-0153 复核（扩展点）：两道门都需要 VM 侧的槽对象表，或把宿主缝扩成 `(slot, kind, value)`；`tickets/T-0153/changes-texvm.md` §4 的 C4 是扩展点。 |
| 0x249 | i249 | 20 | 123375-123380 | `0x249` 的槽记录语义仍与引擎**相反**（T-0153 复核、**未修**）：引擎传 `a6 = 1` ⇒ callee（raw 123377）写 `v7[466] = -1`，而 emulator 的 `op_load_texture_by_id` 写 `imgid`。要精确复刻需要 `NativeBridge.bindTexture` 多一位「记录策略/类」（跨 renderer 半边），见 `tickets/T-0153/changes-texvm.md` §4 的 C2；`0x249` 语料 20 处/8 脚本，是否可观测待 renderer owner 一并判 |
| 0x249 | i249 | 20 | 32716-32769 | 引擎 0x249 在按 op1 开文件前先销毁该槽的 movie 播放器对象（_this[op2 + 94672]，与 0x20F play-movie 同一张 1000 槽表：sub_488FB0 + vtable 析构 + 置 0）；emulator 没有 per-slot movie 记录可清 |
| 0x249 | i249 | 20 | 32716-32769 | op3（颜色）在引擎里被真正消费（进表面对象 vtable+28 的装载调用 raw 119762-119766，并写 Scene[5*slot+467]）；emulator 交给 native.setTextureObjectParam，而该缝在 PixiBackend/HeadlessScene/StubNative 都没有实现（只有 nativeTap 记丢弃）⇒ 颜色…  ★T-0153 复核：`setTextureObjectParam` 两个宿主（`PixiBackend`/`HeadlessScene`）都没有实现 ⇒ 颜色目前只落进闸门 A；且这条缝现在同时承载 `0x246` 的浮点参数，需要拆分成 `(slot, kind, value)`。 |

### 7.6 T-0154（7 条 opcode / 8 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x1f6 | i1f6 | 391 | 130763-130766 | Scene+1080（572B-A）在 emulator 无容器：0x1f6 的 sub_4A9D10(v1 + 270)（raw 130765）整表释放它，而本层只有它的单格镜像 render4.entryParams（0x242 写该项 +504）。本轮已让 scClearDrawContainer 连这个镜像一起清、并在返回值里显式给出 nodesA = 0（= 「无容器」这件事实可断言）。真扩展点 = 建 572B-A 项容器 + 找出它的写入端（反编译里当前只见 0x242 的 +504 一格与 0x244 的 node+24 清扫）。 |
| 0x1f6 | i1f6 | 391 | 20660-20738 | 1000 个场景对象槽的逐帧老化释放（raw 20660-20738）未建模：drawItems/meshes 是 Map，无槽上限与老化 |
| 0x20d | i20d set-render-target | 841 | 117375-117423 | Scene+46456 的第二消费端（2D/GDI 变换支路）未建模：sub_49AA30 raw 117375-117423 在 v6 = Scene+46456 满足 v6 < 0 \|\| v6 == 38 时把项位置加上**窗口原点**（sub_498350 给出）再算 work。emulator 没有「窗口原点」对象（headless 无窗口、Pixi 用画布尺寸）⇒ 如实登记，不伪造。 |
| 0x229 | i229 | 716 | 117080-117112 | 三段体已全部落地（本轮）：① 复位模板 ⇒ 丢掉 SceneXform 锚 + sceneRotRad = 0（raw 117084-117090，sub_49A300 的重置区间 = 116899-117054，含六块矩阵与 pivot）；② 区间门 Scene+1112/+1116（raw 117098-117099，消费端 RenderScene raw 133397-133401 ⇒ sceneLayerInGate）；③ pivot = 模板 +24/28/32（raw 117109-117112，消费端 sub_49AA30 raw 117425-117429 + 117932 的 T(−p)·M·T(+p) 共轭 ⇒ scenePivot）。★残留（如实记）：sub_49A300 还写 +720/+576/+724..732 等格，那些格的 emulator 对应物挂在绘制项上，而 Scene+1120 这个模板对象在 emulator 里没有独立载体 ⇒ 不复刻；另：区间关着时 [20,30) 仍吃变换（保留修前行为，见 sceneLayerInGate 的说明）。 |
| 0x22d | i22d | 5 | 117927-117933 | 非 [20,30) 层的完整 3D 世界矩阵支路未建（raw 117927-117933 的三个 `j_D3DXMatrixMultiply` + `j_D3DXMatrixTranslation` 合成；emulator 只做 2D 缩放与平移），动画窗也未建 |
| 0x22f | i22f | 7 | 117927-117933 | 非 [20,30) 层的完整 3D 世界矩阵支路未建（raw 117927-117933 的三个 `j_D3DXMatrixMultiply` + `j_D3DXMatrixTranslation` 合成；emulator 只做 2D 缩放与平移），动画窗也未建 |
| 0x244 | i244 | 1 | 132428-132501 | 三趟体：绘制项 +52（已实现）、Scene+1100 = Engine.l2dNodes 的 node+24（本轮已实现 —— L2dNode.wins.startedAtMs = 0 + latched = false，raw 132478）、Scene+1084（572B-A）**仍未建模**（无容器，与 0x1f6 同一条缺口）。另：引擎这一段**不置脏**（sub_4AD9F0 体内无 Scene[11627]），emulator 置脏是有意偏差（清窗起点后不重画就看不到那一帧）。 |
| 0x320 | i320 create-mesh | 1691 | 132727-132758 | 残余（原判已推翻）：raw 132727-132752 的析构在 sub_4ADFE0 **体内**，而进门是 sub_432150 的 if (v2 > 0)（raw 41037）⇒ vcount <= 0 时既不析构也不清 bit0（原判「无效 create-mesh ⇒ 几何被清掉、bit0 归 0」不成立）。vcount > 0 时的「先析构再重建」= 覆盖语义（emulator 已同）。真残余只剩「sub_4A2280 失败 ⇒ 几何已析构但 bit0 不置且旧 flags 位保留」——emulator 的等价物不会失败 ⇒ 无从复现。 |

### 7.7 T-0155（10 条 opcode / 12 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x32 | i32 | 337 | 27984-28000 | GDI 支（`set:DrawMode == 0`，本机 INI 实测缺省值）的 2D 对象转送未建模：引擎走 `(*(vtable+64))(Scene+7912, …)`（raw 27984-28000），emulator 两条路共用 `blitSlotToSlot`（矩形相同 ⇒ 无画面差异） |
| 0x202 | i202 set-draw-color | 8123 | 117443-117461 | sub_49AA30 的颜色窗不是无条件跑的：raw 117443-117444 的 v13 = *((_DWORD *)a2 + 19); if ( v13 > 0 )（+0x4C = 本窗 dur）是整块的入口门 —— dur <= 0 时引擎完全不碰颜色（+0x60/+0x64 都留原值），而 emulator 的 applyDrawColor 无条件 it.flags… |
| 0x202 | i202 set-draw-color | 8123 | 117454-117479 | 0x202/0x203/0x232 共用的回退源 sub_4ADD60 读 DrawItem+0x60（工作色 FROM，raw 132587），而引擎在 A 层颜色窗窗内就把逐帧插值结果写回该格… |
| 0x20e | i20e | 786 | 25280-25286 | 门 `Engine[80684]==1 && Engine[92322]==-1` 成立时设备被 Clear 两次（raw 25282-25284 一次 + raw 25286 无条件一次；门假时一次）；两格在 emulator 侧都没有定位到置位点 ⇒ 无法照体实现 |
| 0x234 | i234 | 4 | 118225-118229 | 引擎 sub_49BCC0 raw 118222-118228 用 D3DXMatrixRotationAxis（轴 = +580/584/588 = op3/op4/op5 原样，角度 = 360·((now−start) % period) / period 的整数除法结果再转弧度）建三维旋转阵并右乘进项自身 work（raw 118228）；emulator 只保留「绕… |
| 0x24f | i24f | 6 | 133743-133783 | 写记录**之前**按 op2（工作纹理槽）检查 `Scene+42456` 槽表：槽不存在、或该纹理对象 `[262]`（字节 +1048）与当前渲染目标 id 不符 ⇒ 调 `sub_4A2C10(Scene, op2, 宽, 高, 当前 id)` 重建/换绑工作纹理（raw 133743-133783）；emulator 没有纹理对象层 ⇒ 缺 `ensureWorkingTexture(slot, w, h, renderTargetId)` 这类宿主缝 + 宿主侧槽对象表（`op2` 现在只是被写进记录 `[4]`）。★记录那一半**不受影响**：体里两支都汇到 `LABEL_8` 照写（raw 133750/133783）。★只有 `0x24F` 有这段检查（`0x250`/`0x251` 的下落函数里没有） |
| 0x258 | i258 | 11356 | 33163-33183 | 镜像表 `Scene+21872/+21876` 在 emulator 无对应物（只有一张 `Engine.texSlotFlags`）；且引擎这四格（raw 33166-33183）**只写不读** ⇒ 建第二张表会立刻新增一条死写 |
| 0x320 | i320 create-mesh | 1691 | 118396-118397 | 引擎新建 mesh 记录时把两格态色都初始化成 -1（= 0xFFFFFFFF，白不透明白），emulator 的 makeMesh 初始化成 0（全透明）⇒ "有几何但从未发过 0x322/0x323" 的 mesh，引擎按基础色绘制、emulator 因 alpha = 0 整块不画 |
| 0x320 | i320 create-mesh | 1691 | 122424-122425 | 引擎把顶点位置写成 x - 0.5 / y - 0.5（dbl_51D7F8 = 0.5，raw 4197），emulator 直接取 op2/op3 的数组值当屏幕像素 ⇒ 整块几何相对真机偏移 (+0.5, +0.5) |
| 0x321 | i321 | 1 | 132803-132805 | 引擎对 op2（项内槽号）没有任何范围校验，result[op2 + 7] = op3 是直接派生地址写；emulator 把它当任意 Map 键收下，没有任何「越界槽号」的守卫或报错口径，双方谁也没有把「合法槽号范围」写清楚 |
| 0x32d | i32d | 1 | 34048-34052 | op2 的字节→颜色通道映射写反：引擎把 op2 的最低字节当蓝（(unsigned __int8)v3）、第三字节当红（BYTE2(v3)），emulator 把最低字节当红（(rgb & 0xff)/255）、第三字节当蓝，于是所有 0x32d 下发的颜色整体发生 R/B 交换 |
| 0x33f | i33f set-scene-blend | 1 | 34446 | `Scene+1264` 的效果常量通路未建模（op2/op3 现已按体读满并算出回退值，但装配结果无处安放；raw 34446 写该格，消费点在效果对象的 shader 常量） |

### 7.8 T-0156（7 条 opcode / 11 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x5 | ret ret | 30699 | 25718-25724 | ret 在返回栈顶非 -1 之后还会弹**全局「消息回调 effect_flags 保存栈」**：`_this[107437]`（栈顶，-1 = 空）>= 0 ⇒ 取 `_this[107436][顶]` 写回 `effect_flags`（174801）并把顶减一（raw 25718-25724）；该栈对象在 byte 429732（0x68EA4，vftable/容量 256/增量 256/base=107436/top=107437），压入点是 0x71 消息回调派发路径（raw 20022/20082）与 raw 28868/28885/28938（带 0xFFEFFFFF 掩码的弹出）。emulator 的 `op_ret` 只做帧返回栈跳转、既不压也不弹这条栈 ⇒ 消息回调期间的 effect_flags 保存/恢复缺失。 |
| 0x9 | i9 exit-script | 339 | 24817-24829 | 体首无条件虚调用 0xB8 的 handler（经 handler 表项 byte 676732 = 675996 + 4*0xB8）：清 `_this[174801]` 的 0x200 位，并对音乐子系统调 `sub_489E50(音乐对象, 100)`（按 100 推进淡出/停播）与 `sub_489B50`（复位播放游标）；emulator 的 `effectFlags = 0` 只覆盖了位清除，音乐那两步未复刻（音频子系统属别票）。 |
| 0x9 | i9 exit-script | 339 | 30704-30750 | 同一容器区的第二族 `Stack_int`（388292 + 4*i，i=0..9，布局 [1]=256/[2]=256/[3]=buf/[4]=-1 顶下标）及其指令 0x137 ResetStack（删+建空栈，raw 30704-30730）与 0x138 Push（raw 30733-30750）在 emulator 未建模（0x137 是 no-op、0x138 未注册）；而 Queue_int 三族 handler 的下标门 `v2 > 0xA` 放行 0xA ⇒ `i132/i133/i134 10` 在引擎里会越到该族第一格，emulator 只能显式拒绝。 |
| 0x7c | i7c local-ret | 668 | 14001-14008 | 引擎里 `_this[107678]`（430712，= redisplayScriptId）的写者除 0x199 外还有：主循环 `effect_flags & 0x20` 臂（raw 14001-14008：置 122452、清 effect_flags、写 122453、写 107678、回退 ip）与 `0x4000000` 臂（raw 20372/20876）—— 即玩家按键回退/重画那条路；emulator 只复刻了 0x199 那一条，另两条在 src/frame/loop.ts 的范围内未做。 |
| 0x7c | i7c local-ret | 668 | 25812-25815 | 0x7C 末尾复位的四格里 `51848` 有真读者：它是**虚拟显示器 A 的鼠标游标**（= `Engine+21976 + 4*7468`，与显示器 B 的同位游标 `Engine+81776` 成对），读者 raw 20005/20013/20286（界 = `_this[23008]` = 显示器 A 的条目数 `[258]`）与 raw 20175 都把它当点击热点/路由表的索引 ⇒ 鼠标热点路由未建模时该复位没有落点；另三格（81776/81768/51840）无读者，观测等价。 |
| 0x8c | i8c jmp | 160687 | 26843-26855 | 同族的 call-frame（0x8 / sub_41C7C0）也有一条深度越界门，而且阈值与 0x3 不同：引擎用 if ( v4 >= 40 )（v4 = op1，即目标帧号），越界同样是 sub_408050(错误串) + _CxxThrowException(&v8, &_TI1_AVCommand_ShowMessage_Exception__)… |
| 0x8c | i8c jmp | 160687 | 29395-29399 | emulator 要求 op1 必须命中 labelMap（否则抛 jmp: unknown label）；引擎不校验——ip = base + 4*op1 可以指向任意 dword 偏移（包括非指令边界或脚本外），不会报错 |
| 0xc8 | sleep sleep | 385 | 30301-30312 | n < 10 分支的 `Sleep(n)`（raw 30311）是同次派发内的**进程级硬阻塞**，单线程宿主表达不出：帧循环 `maxStepsPerFrame` 默认 `Number.POSITIVE_INFINITY`（frame/loop.ts）⇒ 不装帧门时 TITLE 的 `sleep 1; jmp`（src/TITLE.txt:63）在同一帧内永不 yield（实测挂死）⇒ emulator 让两支都让出派发，作为架构等价物；宿主侧 `native.sleep`（renderer/pixiBackend.ts）目前是 no-op，要按 ms 真阻塞需要渲染宿主票。重新评估条件 = 需要与真机帧节奏对齐的 E4 判据。 |
| 0x133 | i133 | 10 | 30691-30695 | 越界（op1>0xA）分支里引擎是把「ADDQ」错误串送进宿主消息通道（sub_408050 组串 + sub_4034D0 打印，会画到引擎的错误提示层）；emulator 只写一行 c.log，宿主侧不可见 |
| 0x134 | i134 | 5 | 39372-39376 | 越界（op1>0xA）分支里引擎把「GETQ」错误串送进宿主消息通道（sub_408050 + sub_4034D0）；emulator 只写一行 c.log |
| 0x134 | i134 | 5 | 39390-39394 | 空队分支里引擎的取值变量是未初始化局部 v8（把一段栈残留写进 op3，值不确定）；emulator 取确定口径「空队 ⇒ op3 = 0」，在真实硬件上可能与引擎写出不同的 op3 |

### 7.9 T-0158（6 条 opcode / 6 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x93 |  | 4954 | 9866-9915 | 显示态的**游标移动子步** `sub_403DD0`（`sub_4098E0` raw 14065 调它，体 raw 9866-9915）未建模：掩码 bit0（`& 1`）向上 ⇒ `--_this[7468]` 且 `< 0 ⇒ 0`；bit2（`& 4`）向下 ⇒ `_this[7468] < _this[258] - 1` 才 `++`；bit3（`& 8`）左翻 ⇒ `_this[7468] >= _this[960]` 才 `-= _this[960]`；bit1（`& 2`）右翻 ⇒ `< _this[258] - _this[960]` 才 `+= _this[960]`（步长 = `[960]`）；命中即清掉对应掩码位。emulator 的 `RoutePanel` 没有这条支（`handlers/panel.ts` 的 `servicePanelDisplayState()` 注释里已登记）。扩展点 = 新增 `RoutePanel.moveCursorByKey(mask)`。 |
| 0x97 | i97 | 2004 | 91753-91763 | 语料里 6 条 i097 有 2 条把 ADV 推进绑到掩码位 7/8（src/SN0000.txt:106 bit 8、:114 bit 7；334 个 ADV 脚本同型 ⇒ 全部 2004 处只用到 {0,1,2,3,8,7}） |
| 0xcd | icd get-input-type | 50 | 25838-25872 | 0xCD 的推进门槽只镜像了成功那一步：引擎体首（raw 25838）先写 1、真正推进后 raw 25872 落回 0，而 emulator 入口仍是静态 `2*argc+1`；引擎用 `383128 += 4*gate` 的 dword 步进消费这一格，emulator 的派发器是指令下标制 ⇒ 该槽在 emulator 无行为消费者（只有追踪值差） |
| 0xff |  | 53 | 25085-25160 | `Engine[cur + 122327]` 的**读者**未实现：`sub_419D20`（raw 25085-25160，`0x10F` 一族）在 emulator 未实现 —— 它取 `v2 = _this[_this[95776] + 122327] - 1`（raw 25096）从最高位往下扫掩码，命中时回写 `_this[v4 + 122327] = v2`（raw 25134）。emulator 已按体写出该格（`0xFF` 的 `Engine[517]` 镜像）⇒ 目前是"按体如实写 + 读者待接"。 |
| 0x100 | i100 | 53 | 25038-25040 | 0x100 的**扫描游标复位**在 emulator 仍是近似：引擎唯一复位点是 `0xFF`（raw 25005 `_this[_this[95776] + 122287] = 0`）、推进点是本条自己（raw 25038 `result[result[95776] + 122287] = v6 + 1`，并把 ret 压到本指令 ⇒ 一次执行逐个派发掩码里所有置位）；emulator 用 `keyScanLastMask !== mask ⇒ b = 0` 代替。删这条近似要同步改 `test/op-a5.test.ts:161/169`（三次不同掩码、中间没有 `0xFF`），该文件不在 T-0158 可写集 ⇒ 已交接。★已实现的部分：两条派发出口写长度槽 0（raw 25064）、早退支保持 1（raw 25024）—— 就是「handler 决定 ip 是否前进」的 emulator 落点。守卫 `test/input-field-mirror.test.ts`。 |
| 0x147 | i147 | 1 | 39676 | emulator 自造的 `n > MAX_POINTS(2^20) ⇒ throw` 已删；引擎唯一的边界是 raw 39676 的 `operator new[](8*n)`（32 位宿主上 n > 0x0FFFFFFF 分配不出来）⇒ 现按 `ENGINE_POINT_ALLOC_MAX = 0x0FFFFFFF` 上界走 else 支（**不抛**）并记日志。★口径：`operator new[]` 失败在 MSVC 下是抛 `bad_alloc` → 终止（不是「正常写 op1 = 0」），emulator 无法表示「进程终止」⇒ 取最接近的可表示行为。扩展点：若要表示终止语义，需先定义 emulator 的「宿主级致命错误」出口（当前没有这种出口）。 |

### 7.10 T-0159（2 条 opcode / 7 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x19e | i19e | 337 | 38303-38304 | ALLOW_UNDERRUN 的 save-slot 族 8 条（0x19e/0x19f/0x1a0/0x1a1/0x1ab/0x1ac/0x1ae/0x1af）措辞应改为实测口径：「op2..op3 已读（planFor 之后立刻 plan.int(2)/plan.int(3)，与引擎 raw 38303/38530 的先读槽号一致）；缺的是写侧输出格 op1 —— 合成指… |
| 0x19e | i19e | 337 | 38307-38316 | 引擎在「只读打开打不开（文件不存在）或读不出 292 B 合法头」时会弹 MB_YESNO\|MB_ICONQUESTION 覆盖确认框，玩家选「否」⇒ op1 = 1 中止覆盖、原文件保持不动；emulator 无宿主对话框，恒按「玩家点了是」直接覆盖 —— 于是「覆盖一个空槽/坏档」在两边返回码相同（0），但「玩家拒绝覆盖」这条路径不存在… |
| 0x19e | i19e | 337 | 38317-38322 | 宿主没有 system 目录时 writeSaveSlot 已改为**抛**（不再静默 no-op，见 T-0153 的 renderer/arch 子集），但结果码仍是 `saveSlotFromEngine` catch 里写死的 **2**，而引擎在写打开失败那一格是 `sub_42B4B0(_this, 1, 1)` ⇒ **1**（raw 38320-38321） |
| 0x19e | i19e | 337 | 38317-38322 | 写侧失败时引擎先弹一条错误串… |
| 0x1ae | i1ae | 337 | 124944-124955 | 「op3 指向的纹理槽没有创建」时引擎返回 2、且 .STH 里留下的是空文件（CreateFileA 在调用前已经建好、两条路都不会写任何字节）；emulator 这格返回 0 并把一段自造的空块 AMYTH1\n{"slot":…} 当缩略图写进 .STH |
| 0x1ae | i1ae | 337 | 38537-38546 | Engine[166964]（DrawMode）的 D3D 分支没有建模：引擎在 DrawMode = 1 时走 CloseHandle(FileA) + sub_4A5260(Scene, FileName, op3)（纹理截图，产物 BMP 由截图函数自己写），非 D3D 才走 sub_43BF20(Engine+7912, op3, hFile)；emulator 只有… |
| 0x1ae | i1ae | 337 | 38545-38546 | 取不到纹理槽像素时（headless、或该槽不是 create-texture 出来的画布槽）emulator 写一个 4 字节长度前缀 + AMYTH1\n{...} JSON 的非 BMP 块并报 op1 = 0（成功）；引擎在同一情形下走 sub_43BF20 写的是真 BMP（槽为空时 sub_43BF20 内部返回 0 ⇒ 引擎 op1 = 2 失败），或 D3D … |

### 7.11 T-0161（5 条 opcode / 6 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x142 |  | 2 | 17961 | 初值/复位值 = 1 未建模：构造 sub_415640（raw 22591）与整体复位 sub_40DF10（raw 17961）都写 `*(_DWORD *)(_this + 699248) = 1;`，emulator 的 `Engine` 构造/复位都不种这一格 ⇒ `i142 1`（CONFIG.txt:354）之前读到 0。落点 = `src/vm/engine.ts`（构造与 reset 路径各一行）；守卫形态 = 构造后断言 `engineValues.get(ENGINE_FIELD.scriptEngineFlag) === 1`。 |
| 0x142 |  | 2 | 91057-91061 | 导出查询消费者缺失：该槽唯一读者是 `sub_4765C0`（raw 91057-91061 `return *(_DWORD *)(dword_55E1BC + 699248) != 0;`），它是**导出给脚本/宿主的 API**（工程内零调用），emulator 没有这一层也没有对应 opcode ⇒ 不编消费者。 |
| 0x148 |  | 0 | 141038-141043 | 该槽的读者是宿主窗口过程，emulator 无该子系统：sub_4B9240 用 `timeGetTime() - dword_55E1D8 > *(_DWORD *)(dword_55E1BC + 388232)`（即 _this[97058]）决定是否继续走「光标贴屏幕顶 / 松开 Alt ⇒ 弹系统对话框」那一支（raw 141038-141043）。0x148/0x149 的读写往返本身已实现（test/engine-fields-t0161.test.ts），缺的是消费端（点击去抖 + 系统对话框）。 |
| 0x25a |  | 0 | 33198-33201 | 两条媒体下发门整段未建模：`if (v3 /* _this[92377] == 0，上一次模式镜像 */) sub_4A5470(Scene+80708, id);`（raw 33198-33199）与 `if (!_this[167990] /* display:ScreenMode */) sub_4A5470(Scene+80708, _this[92380]);`（raw 33200-33201）。emulator 只写 mediaMode/mediaId 两个字段，**两个门的输入之一（92377 模式镜像）没有任何维护者**，且没有宿主媒体层。重开条件：接入"消息态媒体层"（图/影片叠加）时。 |
| 0x25b |  | 1 | 33215-33219 | 图像加载分支 `if (!_this[167990]) { v3 = sub_41BF50(_this, 1); return sub_408440((int)_this, v3); }`（raw 33215-33219）整段未建模：sub_408440（raw 13147-13155）真解码资源、渲进 Scene 的固定帧纹理，失败时 `_CxxThrowException(Command_ShowMessage_Exception)` ⇒ **影响控制流**（脚本侧会弹消息窗并中断）。emulator 无对应宿主缝（`native.playMovie` 是影片、语义不同）。★字段侧已修（92379=2 + 92381=op1）。 |
| 0x2e9 | i2e9 | 480 | 20416-20425 | 自动翻页的**第二个计算点**（等待泵 sub_411BC0 的另一支，raw 20416-20426）：`if ((GetConfig("message:AutoMessageOption") & 1) == 0) { if (!_this[490004 /* 下标 122501 */]) { v20 = sub_407F20(Font, _this[489484]) - _this[489856]; … sub_453A60(…) } return; }` —— 与 raw 28569/28579 的公式**不同**：这里用 `(该窗行数 − 基准)`（**不减 1**），且整段被 `122501`（语音忙碌）门控。emulator 的 `#serviceAutoMessage`（vm/engine.ts）复刻了总门与 LABEL_58 的 `if (122501) return`，但**这一支的 Pitch0/Time0 武装没有落点**（122501 在 emulator 恒 0 ⇒ 当前不可达）。guard：`test/engine-fields-t0161.test.ts` 的"生产读者棘轮"只钉住第一个计算点。 |

### 7.12 T-0162（4 条 opcode / 7 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x192 | i192 set-string | 17747 | 25574-25576 | `sub_41A6C0` 对 `.`（0x2E）落的是 `{0x81,0x48}`（raw 25574-25576）—— 该码位在 GBK 里不是全角句点（`A3AE`）而是 CJK 扩展区的怪字。emulator 的实现只转 `[0-9A-Za-z+-#]`、`.` 留半角（与既有 `handlers/msgwin.ts` 的 `toFullWidth` 同一口径）。受影响面 = 只含 float 族转串（`%lf`/`toFixed(6)` 的输出含 `.`）。 |
| 0x192 | i192 set-string | 17747 | 36394-36411 | 字符串数组 tag `0x8005`/`0x800B` 的转串**结构上无法复现**：引擎把「数组地址」以**十进制字符串**存在该串槽里（`sub_42AEA0` raw 36858-36887 的自动建数组分支：`operator new(0x10)` 建向量后 `_itoa_s((int)ptr, Buffer, 10)` 写回串槽），转串时 `atoi` 解回指针再取 `vector<string>[0]`；emulator 的串池里没有「指针型字符串」这种值 ⇒ 显式抛错。扩展点 = 若将来建模「串槽里存地址」这种值；重新评估条件 = 语料出现 `0x8005`/`0x800B` 操作数（当前 0 处）。 |
| 0x193 | i193 concat | 123 | 25574-25576 | `sub_41A6C0` 对 `.`（0x2E）落的是 `{0x81,0x48}`（raw 25574-25576）—— 该码位在 GBK 里不是全角句点（`A3AE`）而是 CJK 扩展区的怪字。emulator 的实现只转 `[0-9A-Za-z+-#]`、`.` 留半角（与既有 `handlers/msgwin.ts` 的 `toFullWidth` 同一口径）。受影响面 = 只含 float 族转串（`%lf`/`toFixed(6)` 的输出含 `.`）。 |
| 0x193 | i193 concat | 123 | 36394-36411 | 字符串数组 tag `0x8005`/`0x800B` 的转串**结构上无法复现**：引擎把「数组地址」以**十进制字符串**存在该串槽里（`sub_42AEA0` raw 36858-36887 的自动建数组分支：`operator new(0x10)` 建向量后 `_itoa_s((int)ptr, Buffer, 10)` 写回串槽），转串时 `atoi` 解回指针再取 `vector<string>[0]`；emulator 的串池里没有「指针型字符串」这种值 ⇒ 显式抛错。扩展点 = 若将来建模「串槽里存地址」这种值；重新评估条件 = 语料出现 `0x8005`/`0x800B` 操作数（当前 0 处）。 |
| 0x1b0 | i1b0 memcpy | 255 | 37991-37995 | 引擎的 memcpy 是**裸 4*n 字节拷贝、不看边类型**（`sub_42D150` 只调 `sub_42AEA0` 取两个基址）；emulator 的池是带类型的（int 池存 ENC 值、float 池存 JS number、str 池 step 28）⇒ 跨 kind 的裸拷贝**没有可表达的值** ⇒ 显式抛错。扩展点 = 引入「按 dword 视图」的池访问器；重新评估条件 = 语料出现跨 kind 的 `i1b0`（当前 0 处）。 |
| 0x1b2 | i1b2 | 3 | 25574-25576 | `sub_41A6C0` 对 `.`（0x2E）落的是 `{0x81,0x48}`（raw 25574-25576）—— 该码位在 GBK 里不是全角句点（`A3AE`）而是 CJK 扩展区的怪字。emulator 的实现只转 `[0-9A-Za-z+-#]`、`.` 留半角（与既有 `handlers/msgwin.ts` 的 `toFullWidth` 同一口径）。受影响面 = 只含 float 族转串（`%lf`/`toFixed(6)` 的输出含 `.`）。 |
| 0x1b2 | i1b2 | 3 | 26538-26547 | 字符串数组 tag `0x8005`/`0x800B` 的转串**结构上无法复现**：引擎把「数组地址」以**十进制字符串**存在该串槽里（`sub_42AEA0` raw 36858-36887 的自动建数组分支：`operator new(0x10)` 建向量后 `_itoa_s((int)ptr, Buffer, 10)` 写回串槽），转串时 `atoi` 解回指针再取 `vector<string>[0]`；emulator 的串池里没有「指针型字符串」这种值 ⇒ 显式抛错。扩展点 = 若将来建模「串槽里存地址」这种值；重新评估条件 = 语料出现 `0x8005`/`0x800B` 操作数（当前 0 处）。 |

### 7.13 T-0163（3 条 opcode / 7 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x14c | i14c set-agerc-export | 1 | 31105-31111 | 「模块未加载」分支的报错文案不同：引擎在句柄槽为 0 时直接 GetProcAddress(NULL, op2)（31106），失败后走 31111 的地址取得失败串（"%sのアドレス取得に失敗しました．\r\n\r\nERRORCODE = %d"，带 \r\n\r\n 与 GetLastError() 的 ERRORCODE=126），emulator 是自造的「模块未加… |
| 0x14c | i14c set-agerc-export | 1 | 31106-31120 | 两个校验的先后次序与引擎相反：引擎是先 GetProcAddress（31106，失败即抛地址取得失败）再判 slot > 0x63（31117）；emulator 是 !EXPORT_SET.has(name)（101）先于 slot < 0 \|\| slot > 99（104）——两侧同为「先地址后槽号」，但引擎在 slot 非法时已经取到（或已抛）地址，而 emulato… |
| 0x14c | i14c set-agerc-export | 1 | 31117-31120 | 引擎对 0x14C 的 op3 只在 slot > 0x63 的越界分支里 sub_41B640(_this, 3) 取一次（作 %sの関数インデックスが不正です…ERRORCODE = %d 的第一个实参）；合法槽路径上不碰 op3 |
| 0x14c | i14c set-agerc-export | 1 | 31117-31128 | 越界错误串的第一个实参来源不同：引擎 31120 用 sub_41B640(_this, 3)（op3 的字符串）填 "%sの関数インデックスが不正です…"，emulator 用的是导出名 name（= op2）拼「（槽 N）」（agerc.ts:104-106） |
| 0x14d | i14d call-agerc-export | 1 | 39828-39843 | len<=0 时两侧的不可观测性论证不完整：引擎在 39843 把 NULL（v3 保持 0）当第 2 实参传给导出，而 docs-new/03-engine/agerc-internals.md:163 记 _SetNameLenMax@20 是 dword_100A9000 = *a2 无条件解引用 ⇒ 真机在 len<=0 时是「对 NULL 解引用」（崩溃/UB），e… |
| 0x14d | i14d call-agerc-export | 1 | 39839-39843 | 引擎对槽表函数指针不做任何校验：v14 = (…)&_this[sub_41BF50(_this, 1) + 122519] 之后直接 (*v14)(...)（raw 39839/39843），槽未绑定（该项 = 0）或 op1 越界（0..99 之外）就是跳 NULL / 跳到表外（真机 = 访问违例崩溃）；emulator 改成 if (!name) throw …… |
| 0x246 | i246 | 0 | 32679-32703 | 宿主三实现都没有 setTextureObjectParam（native.ts 只声明为可选缝）⇒ 引擎里真实的 vtable+56 调用在 emulator 消失；且该缝被 0x1F9/0x249 复用来传颜色（0xFFRRGGBB），与这里的「op2÷100 的参数值」语义冲突，任何单一实现都无法同时正确 |

### 7.14 T-0164（5 条 opcode / 7 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x60 | i60 random | 78 | 37725-37736 | 已实现（T-0164）：引擎的判据只有「恰好 0 才抛」——`if ( !v2 )`（raw 37727），负模数照走 `dword_55D54C % v2`（C 的有符号取模，结果符号跟随被除数）。emulator 同形（`(r % mod) \| 0` + 仅 `mod === 0` 抛）。 |
| 0x60 | i60 random | 78 | 37727-37736 | 模数为 0 时，引擎在 _CxxThrowException 之前先写了一次 op1=0（sub_42B4B0 case 3 走全局 int 持久池：值 ENC 后写进 _this+382976），emulator 直接 throw 一格不写 ⇒ 少一次可观测的写序；若宿主或后续通路捕获该异常，random (global-int X) 0 在引擎里 X 已变 0、在 emu… |
| 0x20f |  | 5 | 20660-20694 | `_this[675972]`（「有影片在放」总门）在 emulator 侧无生产读者：引擎的读者是主循环影片泵（raw 20660 的总门 + raw 20687-20694 逐槽重算），而 emulator 没有影片泵 ⇒ 该格只能由 `0x20F` 写入、由观测面断言。重开条件 = `src/frame/loop.ts` 建影片泵（`tickets/T-0164` 的 §4-③）。 |
| 0x20f |  | 5 | 31638-31643 | `sub_488DC0`（CMovieToTexture 装载）返回 0 的那条失败支未建模：引擎在 raw 31638-31643 打 `asc_51F560`（「ムービーの初期化に失敗しました．／ムービーを再生できません．」）并抛 Command_ShowMessage（错误码 65541）。它的失败语义在 DirectShow/DLL 内部 ⇒ emulator 没有影片解码器，**没有任何可判定的输入**能让这条分支成立（与 asc_520248 那条不同：那条的门是「该槽有没有图像/纹理对象」，可判定）。重开条件 = emulator 接影片解码器。 |
| 0x21d | i21d | 553 | 131184-131206 | CopyScene 的网格顶点缓冲失败两条错误路径未建模：引擎在「源网格命中」后还有顶点缓冲**创建失败**（`vtable+104`，raw 131175-131192，打「VertexBufferの作成に失敗しました」+ return 0）与**加锁失败**（`vtable+44`，raw 131193-131206，打「VertexBufferに対してのロックに失敗しました」+ 释放缓冲 + return 0）两条分支，`36 * v15[9]` 顶点全依赖真 D3D 顶点缓冲；emulator 的网格是纯 JS 模型（`MeshObj.verts`）⇒ 没有可失败的对应物，故如实登记。 |
| 0x2d4 |  | 0 | 40168-40172 | 被除数为负时与体不等价：emulator 用 JS 的 `l % r`（结果符号跟随被除数），引擎是 C 库 `fmod(浮点op2, 浮点op3)`（结果符号跟随除数，raw 40171）——例如 op2 = −7.5 / op3 = 2 时引擎得 0.5、emulator 得 −1.5。现有守卫 `test/t0164-misc-batch.test.ts` 只钉 `fmod(7.5, 0) = NaN` 与 `fmod(7.5, 2) = 1.5`（都不涉及负被除数）⇒ 偏差未被覆盖。修法 = 换成真正的 fmod（`l - r * Math.trunc(l / r)`），属 `src/vm/handlers/arithmetic.ts`；语料 0 处 ⇒ 本轮未改。 |
| 0x2f6 | i2f6 | 86687 | 33676-33693 | Engine[122501]（三路语音是否有正忙的）在 emulator 连字段都没登记读取/写入；引擎每次 0x2F6 都刷新它，emulator 没有对应可观测状态 |

### 7.15 T-0170（1 条 opcode / 6 条缺口）

| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |
|---|---|---|---|---|
| 0x1d1 | i1d1 | 1 | 77500-78716 | 窗对象 `+112 == 1` 的**专用路径 `sub_4634B0`**（GDI-only 变体，字体句柄 `+101852/+101856`；`0x82` 那条是 `sub_462040`）未建第二套渲染器 ⇒ emulator 的 `dedicatedPath` 恒 `false` |
| 0x1d1 | i1d1 | 1 | 80683 | `sub_404CB0(语音对象)` 的**占线查询没有宿主缝**（`AudioEngine` 无 `voiceBusy()` 公开口）⇒ `voiceBusy` 恒 `false`（守卫用直接传参验证了 `true` 那一支） |
| 0x1d1 | i1d1 | 1 | 80725-81014 | **逐字 GDI 度量/描边/竖排光栅化**本身不等价（emulator 这一层由 `src/text/layout.ts` 的软件光栅化承担） |
| 0x1d1 | i1d1 | 1 | 81220-81224 | `win+136`（已画字数）/`win+132`（高水位）的**窗口记账**未建模（emulator 的显现游标另有唯一真源） |
| 0x1d1 | i1d1 | 1 | 81498-81509 | `op3 & 0x20` 的**栏带四边形循环**未实现（驱动数据 = 窗对象自己的 `win[56]/[70]` 栏表） |
| 0x1d1 | i1d1 | 1 | 81530-81553 | 排版**自动换行**时 `sub_4691D0` 的**第三个 push 点**未复刻（现在只在显式 `0x6F` 补换行记录；观感由渲染侧重新排版承担） |
