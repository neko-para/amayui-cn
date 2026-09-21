---
kind: record
state: consumed
superseded_by: analysis/engine-capabilities.json
---
# 常态能力台账审计（source = capabilities，2026-09）

审计范围：`analysis/engine-capabilities.json` 的 130 条**常态能力**条目（逐帧流程 / 门控标志 / 惰性创建 / 资源生命周期），按分片 cap-1…cap-5 全量核对。
方法：先由审计分片对每条条目开体核对引擎侧（`engine/天结_unpacked.exe_utf8.c` 的 raw 行号 + dispatch 表项 675996+4*op）与 emulator 侧（`app/amayui-emulator` 的 file:line、守卫测试逐个打开看断言），再由独立对抗性复核逐条给 verdict（confirmed / partial / refuted / unclear）；本报告合并两份结果，refuted 丢弃、partial 采用 `correctedKind`/`correctedSeverity`、同根因去重合并。
日期：2026-09。数据清单：`.tmp/audit-final-capabilities.json`。
原始输入：`.tmp/audit2/cap-1..5.json`（98 条 finding；分片自报 checked 合计 130 是重复计数）、`.tmp/audit3/cap-1..5-verify.json`（98 条 verdict，与 finding id 一一对应）。

## 结论速览

统计口径：原始 **98** 条 finding（唯一 id 98 个，与 98 条 verdict 一一对应）。其中保留 **83** 条、丢弃 9 条（refuted 4 + 同根因合并 5）、待查 6 条（3 条 verdict=unclear + 1 条复核 kind=unclear + 2 条 id 只出现在复核输出、无原始 finding 记录）。保留总数写作 **84** ＝ 83 条 root finding + 1 条无原始记录的待查 id（`live2d-offscreen-node-lifecycle`，按任务规则单列在「待查」）。severity 分布：P0 2 / P1 7 / P2 30 / P3 45。

| kind \ severity | P0 | P1 | P2 | P3 | 小计 |
|---|---|---|---|---|---|
| contradiction | 2 | 5 | 14 | 7 | 28 |
| overreach | — | 1 | 3 | 18 | 22 |
| no-evidence | — | — | 8 | 10 | 18 |
| cross-source-mismatch | — | 1 | 4 | 10 | 15 |
| gap-as-noop | — | — | 1 | — | 1 |
| **合计** | **2** | **7** | **30** | **45** | **84** |

（kind 一律采用复核后的 `correctedKind`：`scene-3d-effect-level-writer` 原记 `n-a-known wrong (rendering path gate)`，复核后归 contradiction；`lazy-gdi-font-set` 已并入 `text-font-rebuild-cascade`（P1/contradiction）；`lazy-3d-effect-202-snow` 保留 `gap-as-noop`；`adv-perframe-dispatch` 的复核 kind 为 unclear，故列在「待查」。）

最严重者（P0 / P1 共 9 条，最关键 6 条）：

1. **P0 `l2d-node-draw-gate`** —— 台账把已生效的 Live2D 出画能力自述为「合成路径还没调用它」，与 `presenter.ts:265/:348`、`snapshot.ts:230` 直接矛盾；会让后续 agent 重复做已完成的接线。
2. **P0 `render-3d-layer-dual-commit`** —— opcode `0x222` 被标成 `n/a-known`（3D 未建模），实际 emulator 根本没注册 0x222，而语料 `i222` 有 10 处 ⇒ `SETPOLYGON`/`INFOxx` 命中即硬报错，是可见缺口被 n/a 掩盖。
3. **P1 `renderer-state-reset-each-frame`** —— `sub_498B60` 被记成「纯状态复位、无返回值检查也无日志」，实际是 `IDirect3DDevice9::Clear`，有错误串与返回值检查；`whySilent` 与函数体相反。
4. **P1 `text-aa-config-gate`** —— note 说 antiAlias「从字段带到渲染侧」，实际 `msgwin.ts:146` 写死 `antiAlias: true`，字段 21662 全库 0 个使用点，且守卫反向断言了这个事实。
5. **P1 `scene-3d-effect-level-writer`** —— `Scene+46668` 被当「3D 未建模」标 `n/a-known`，实际它是 2D 绘制循环 `sub_4B06D0` 里的路径分支门（`136517`/`136199`）。
6. **P1 `single-field-timers-audio-device`** —— raw 只覆盖 14 个 fns 中的 4 个；note 里的 `native.fillPanelRect` 缝已被删除（`0x97` 真实现是 `panel.ts:108` 的 `bindKeyBit`）；自称 E3 的守卫是纯合成单测。

（另三条 P1 为 `gfx-prim-mesh-and-render-state`（`0x238` 旧说法与「11 条只记录」过期）、`text-font-rebuild-cascade`（字体参数面与面名映射已落地却记 absent）与 `scene-flag-46528-bits`（`Scene+46528` bit2 的条件极性写反：bit2=0 才清零 v112），逐条见下。）

## P0 逐条（2 条）

### l2d-node-draw-gate — Live2D 节点出画门其实已被两个宿主每帧消费，台账仍自称「没被调用」

- **声明**：台账 emulator.note 称「两个宿主（Pixi / headless 报告）的合成路径还没调用它 ⇒ 只是判据已实现、不是出画已生效」，status=modeled-unverified。
- **实际**：两个宿主的合成路径都在每帧消费该判据：Pixi 经 live2d/render.ts 的 l2dBatches()（:164 第一句即 l2dNodeDrawable 过滤），由 renderer/pixi/presenter.ts:265 每帧调用并把结果作第四路并入出画（:348）；headless 报告经 renderer/scene/snapshot.ts:230 调同一条函数（:210-212 注释自述与 Pixi 同路径）。⇒ 缺口语义不成立，status 应升 modeled-verified。引擎侧门控逐字核对无误。
- **证据**：raw 134316 `if ( (*(_BYTE *)sub_4AAEC0(a1 + 274, &a5) & 1) != 0 )`；raw 134320 `if ( LODWORD(v28[LODWORD(v29[1]) + 13953]) )`（13953*4=55812）；raw 134318 `qmemcpy(v29, ..., 0x23Cu)`（572B 节点）；verify 追加：presenter.ts:328 `this.drawRoot.addChild(e.mesh);`、test/live2d-render.test.ts:180/234/238/242/247/251 直接测 l2dBatches。
- **建议处置**：status 改 modeled-verified，evidence 提到 E2/E3（guard=test/live2d-render.test.ts），note 的「缺口」段删除或改写为「两宿主均已消费（pixi/presenter.ts:265 / scene/snapshot.ts:230）」。

### render-3d-layer-dual-commit — opcode 0x222 被标 n/a-known，实际是命中即停的可见缺口

- **声明**：status=n/a-known，note=「why: 3D 层对偶提交，3D 未建模」；trigger=「其它子系统直接调用（本文件未见主循环调用点）」；对象 sub_4B4460 被当成与本重写无关。
- **实际**：sub_4B4460 就是 opcode 0x222 的 handler 体：dispatch 表 678180（=675996+4*546）注册 sub_423EC0，其体内读 op1/op2 后尾调用 sub_4B4460。emulator 三张表（OPS/NATIVE_OPS/ENGINE_INTERNAL_OPS）里 0x222 零命中 ⇒ 命中即 NotImplementedOp 硬报错；语料 i222 共 10 处（SETPOLYGON.txt:58 + INFOxx 9 处）⇒ 是可达的可见缺口，被 n/a-known 掩盖。 ‖ 补充：emulator 三张注册表里均无 0x222，命中即 `NotImplementedOp` 硬报错（interpreter.ts:166），而语料 `i222` 有 10 处 ⇒ 与 n/a 的前提矛盾。
- **证据**：raw 23073 `*(_DWORD *)(_this + 678180) = sub_423EC0;`；raw 31924 `//----- (00423EC0)`、31930-31933 `_this[30 * _this[95776] + 95805] = 5; v4 = sub_41BF50(_this, 2); v2 = sub_41BF50(_this, 1); return sub_4B4460((int)(_this + 80708), v2, v4);`；verify 追加：docs-new/03-engine/opcode-table.md:378 `| 0x222 | 2 |  | sub_423EC0 | 仅映射 |`；app/amayui-emulator/src/vm/interpreter.ts:62-67 三表查找、:166 `throw new NotImplementedOp(...)`；app/amayui-emulator/src 递归 grep `0x222` 零命中。；补充证据：app/amayui-emulator/src/vm/interpreter.ts:62-67、:166；src/SETPOLYGON.txt:58、src/INFOBA.txt:928 等 9 处。
- **建议处置**：status 改 absent（或 partial），note 写「= opcode 0x222（handler sub_423EC0）：emulator 未注册 ⇒ SETPOLYGON/INFOxx 命中即 NotImplementedOp」；是否登记显式桩须按 stubs.ts:150-152 的纪律决定（该处明写「登记成 no-op 反而把缺口藏起来」）。

## P1 逐条（7 条）

### gfx-prim-mesh-and-render-state — 0x238 的旧「画布尺寸对」说法与「11 条只记录」都已过期

- **声明**：trigger 写「0x238 画布尺寸对」；reads 写「Engine[92338]/[92339]（画布尺寸对）」；emulator.note 写这些项「目前只记录，Pixi 管线尚未逐条消费」。
- **实际**：① 0x238 在工程内已统一订正为「装载 0x400 等待门的计时器」（Engine[92338] 起点清零、Engine[92339] = op1 ms），只有本条目与它的生成物仍写「画布尺寸对」；② reads 的限定语同错；③ note 的「只记录」不成立：0x207 的落点 blitSlotToSlot 在真实转送像素。
- **证据**：raw 32303-32312（sub_4248C0：`_this[92338] = 0; _this[92339] = result;`，result = sub_41BF50(_this,1)）；analysis/engine-capabilities.json:3029/:3066；docs-new/03-engine/engine-capabilities.md:598/:601；docs-new/03-engine/opcode-table.md:400（★2026-09 订正）；app/amayui-emulator/src/vm/engineFieldIds.ts:184-187（waitTimerStart/waitTimerMs）；src/vm/handlers/gfx-state.ts:37-46（明写原注释「画布/视口尺寸对」没有依据）；src/renderer/pixiBackend.ts:450-458；src/renderer/pixi/textureCache.ts:398-444。
- **建议处置**：trigger/reads 里 0x238 与 Engine[92338]/[92339] 改标「等待门的等待计时器（见 scene-pending-flag-0x400-gate）」；note 的「只记录」改为「除 0x207 槽→槽 blit 已由 TextureCache 真转送外，其余只记录」。

### renderer-state-reset-each-frame — sub_498B60 是 ClearTarget，不是「纯状态复位」

- **声明**：name=「渲染态重置（sub_498B60）」；trigger=「Scene+46460 bit0 非零时在 sub_4B4040 帧头调用」；whySilent=「纯状态复位，无返回值检查也无日志」；confidence=confirmed。
- **实际**：sub_498B60 是 IDirect3DDevice9::Clear（ClearTarget）：调 device vtable+172，失败打「関数：ClearTarget エラー：レンダリングターゲットのクリアに失敗しました．%s」再 sub_4034C0，且有 `return 1`/`return 0` 返回值检查 ⇒ whySilent 与函数体相反。trigger 门极性也反：帧头读的是 bit1（137026-137029），bit0 的门在另一处 136785。
- **证据**：raw 115455-115478（115460-115467 调 `**(_DWORD **)(_this + 1040) + 172`；115468 `if ( !v2 ) return 1;`；115471-115476 错误串；115477 `return 0;`）；raw 137026-137029（`v4 = (*(_BYTE *)(_this + 46460) & 2) == 0; if ( !v4 ) sub_498B60(...)`，所在函数头 136741 sub_4B4040）；raw 136785（`& 1` 门）；46460 全库 3 处（130425 写 0 / 136785 读 bit0 / 137026 读 bit1）；sub_498B60 在 sub_4B06D0 内另有 6 处无门调用（134926/134938/135825/135831/136021/136513-136514）。
- **建议处置**：改名/改描述为 ClearTarget（渲染目标清空）+ trigger 修为 bit1（并补 bit0 的第二处调用点）；whySilent 改成「清失败只 sprintf+sub_4034C0，调用方不看返回值」，并据 6 处无门调用点复核 emulator #holdFrames（pixiBackend.ts:677-678/819-820）的依据。

### scene-3d-effect-level-writer — Scene+46668 是 2D 绘制路径门，不是「3D 未建模」

- **声明**：emulator.status=n/a-known，note=「why: 3D 效果档（0/1/2）决策，3D 未建模」。
- **实际**：Scene+46668 不只写端：它是 2D 绘制循环 sub_4B06D0 里的分支选择（136517/136024/135518 的 `< 2` 决定 2D 归并路径，136199 的 `>= 1` 才走 ID3DXEffect 管理器）。emulator 完全未建模（src 全库 grep 46668 只出现在 stubs.ts:107 注释），绘制侧等价于恒当 0。
- **证据**：raw 126552-126561（写端）、136517、136556、136024、135518、136199；46668 全库 13 处（134822/134850/135834/23917 等）；app/amayui-emulator/src/vm/handlers/stubs.ts:107（仅注释）、src/renderer/pixi/presenter.ts:157（只实现 bit0 门）。
- **建议处置**：status 改 partial：写端（126552-126561）与「2D 归并/特效路径门」（135518/136024/136517/136199）登记为缺口（level 2 的 ID3DXEffect 支路未建模），不得以 n-a-known 掩盖。

### scene-flag-46528-bits — Scene+46528 bit2 的条件极性写反：bit2=0 才清零 v112

- **声明**：trigger = 『bit1 非零 ⇒ 拒绝 sub_407EA0 置冻结；bit2 非零 ⇒ sub_49AA30 忽略已置的冻结』
- **实际**：两个函数确实各读一位 bit，但 bit2 那半的语义在体内不是『忽略冻结』而是『冻结已置时不提前收尾动画窗』：raw 117440 `v112 = *(_DWORD *)(v113 + 46512);`（冻结位）之后 raw 117441 `if ( !v11 && (*(_BYTE *)(v113 + 46528) & 4) == 0 ) v112 = 0;`，v112 只在 raw 117449 `if ( v16 >= v15 + v14 + v13 || v112 == 1 )`（提前结束动画窗）里用。另：进入该分支的门是 `(*(_BYTE *)a2 & 2) != 0`（raw 117430 / 117434）加 `a2[180] & 1`（raw 117439），即 MeshEntry flags&2 颜色动画挂起 与 flags&1 可见，条目 trigger 没写出来。bit1 那半没问题（raw 12793 `if ( (*(_BYTE *)(_this + 46528) & 2) == 0 )` ⇒ 置 46512=1 ⇒ 拒绝置冻结）。
- **证据**：engine/天结_unpacked.exe_utf8.c:12793（& 2 阻止置冻结）、:117430 / :117434 / :117439（进入门 flags&2 与 flags&1）、:117440-117442（& 4 与 46512 冻结位）、:117449（v112==1 ⇒ 提前收尾）
- **建议处置**：把 bit2 写成『冻结已置时忽略提前收尾，动画窗照常跑到窗末（raw 117440-117449）』，并补出进入门（MeshEntry flags&2 且 flags&1）。

### single-field-timers-audio-device — raw 只覆盖 4/14 fns，fillPanelRect 缝已删除，E3 无据

- **声明**：engine.raw=24589-24631 而 engine.fns 列 14 个函数；note=「0x97 经宿主缝 native.fillPanelRect 落 SceneState.render4.panelRects」；evidence=E3、guard=test/op-a5.test.ts；trigger 串把 0x94 写成「消息面开关与填矩形」。
- **实际**：(1) raw 只覆盖 14 个 fns 里的 4 个（24589/24604/24612/24627），其余 10 个在 24939/24806/24844/29155/29290/29595…45095；note 引的 45095-45103 完全在区间外。(2) fillPanelRect/panelRects 在实现里不存在：0x97 的真实现是 panel.ts:108-116 的 `e.routes.bindKeyBit(...)`，guard 还断言旧缝已删除。(3) E3 不成立：op-a5.test.ts 是合成单测（new Engine + OPS.get 直调 handler，无脚本装载）。(4) trigger 把 0x94 说成「填矩形」与 opcode-table.md:144-148 及语料不符。 ‖ 补充：guard 是纯合成单测（mk() 只 `new Engine` + `OPS/NATIVE_OPS` 直调 handler，无脚本装载）；「25 条已转真实现」只是注册表棘轮（test/game-start-chain.test.ts:84-105 断言成员），其 A5 名单 :78 为 `[0x93,0x94,0x97,0xd9,0x1ad,0x1b1,0x1bc]`（7 条、不含 0x1C9），而 :94-95 的注释却写「0x1BC/0x1C9 在 NATIVE_OPS」。
- **证据**：raw 24589/24604/24612/24627（区间内 4 个 handler）、24939/24806/24844/29155/29290/29595/45095（其余 handler 真实行）、45094-45103（sub_4380F0 秒计时器，区间外）、构造表 22884/22885/22888/22896；app/amayui-emulator/src/vm/handlers/panel.ts:108-116；test/op-a5.test.ts:26-35、:102-103（`assert.equal((e.native as …).fillPanelRect, undefined)`）；test/game-start-chain.test.ts:78（A5 名单 7 条、不含 0x1C9）、:84-105；docs-new/03-engine/opcode-table.md:144-148；src/SN0000.txt:94-117。；补充证据：test/op-a5.test.ts:26-35、:102-103；test/game-start-chain.test.ts:78、:84-105；app/amayui-emulator/src/vm/handlers/panel.ts:108-116。
- **建议处置**：raw 按每个 opcode 的 handler 分段；删掉 fillPanelRect/panelRects 的说法；E3 降 E2（或补真实脚本场景断言）；trigger 的 0x94 改回「消息面显示态开」。

### text-aa-config-gate — 字段 21662 在渲染侧没有消费者，note 却说「从字段带到渲染侧」

- **声明**：emulator.status=modeled-verified、evidence=E2、guard=test/text-aa.test.ts，note=「实现（tickets/T-0035）：applyConfigToEngine 里按引擎两键门算 Font+1352（= engineValues 21662）；…样式经 FontSpec.antiAlias 与 DrawStringStyle.antiAlias 从字段带到渲染侧」。
- **实际**：前半（两键门 + 阈值机具）为真；后半为假：21662 在渲染侧没有消费者（engineFieldIds.ts:131 定义 aaEnabled 后全库 0 使用点），msgwin.ts:143-146 在注释后直接写死 `antiAlias: true,` ⇒ AA-off 的 drawAliasedLayer 分支在产品路径不可达。guard 反向断言了这个事实。 ‖ 补充：该分支不可达：`msgwin.ts:146` 恒 true ⇒ `raster.ts:349-350` 的 `if (st.main.antiAlias) drawGlyphs(ctx); else drawAliasedLayer(...)` 永远走前一分支；`aaEnabled`（21662）全库 0 使用点。 ‖ 补充：该 guard 证明的是相反结论：`test/text-aa.test.ts:54-65` 标题即「main.antiAlias 恒 true —— 由像素判据定，不再跟随字段 21662（T-0042）」，:61-62 在 `engineValues.set(AA_FIELD, 0)` 之后仍断言 true；真正被该 guard 钉住的是 TEXT_FILL_ALPHA = 225/255 与 engineGlyphPixel。
- **证据**：app/amayui-emulator/src/engineConfig.ts:266-274（:269-271 写 21662）；src/vm/engineFieldIds.ts:131（aaEnabled 定义，全库唯一出现）；src/vm/handlers/msgwin.ts:143-146（写死 antiAlias: true）、:1300、:1369；src/renderer/text/raster.ts:111-125、:349-350；src/renderer/pixi/textureCache.ts:325；test/text-aa.test.ts:54-65（:61-62 在 `engineValues.set(AA_FIELD, 0)` 后仍断言 true）。；补充证据：app/amayui-emulator/src/renderer/text/raster.ts:143-165、:349-350；src/vm/engineFieldIds.ts:131；src/vm/handlers/msgwin.ts:146。；补充证据：test/text-aa.test.ts:54-65、:108-123、:133-160；src/engineConfig.ts:266-274。
- **建议处置**：note 改成「字段门 + 阈值机具已实现；渲染侧按 T-0042 的像素判据恒开 AA（msgwin.ts:146 写死），21662 无消费者 ⇒ 引擎『Font+1352==0 走 GDI 锯齿字形』这一半未实现」，status 降 partial。

### text-font-rebuild-cascade — 字体参数面与面名映射已全部落地，台账仍写「完全没接」/absent（含 lazy-gdi-font-set）

- **声明**：text-font-rebuild-cascade：status=absent/evidence=E0，note「字号/面名/字重参数面**完全没接**（0x75/0x197/0x2BD/0x2BE/0x1A5/0x2FE/0x2DB 目前是 no-op）」；lazy-gdi-font-set：status=absent/evidence=E0/guard=""，note「缺失：字体系（面名/字号/粗体/竖排模板 → HFONT）完全未建模…仍需保留『面名→内嵌字族』映射与 0x75/0x197/0x1A5/0x2FE/0x2BD/0x2BE/0x2DB 的参数面」。
- **实际**：两条主张的实现都已存在并接线：7 条参数面全部是真 handler（msgwin.ts:1146/1154/1162/1169/1176/1184 的 op 体，注册 :1460/:1461/:1463/:1471/:1472/:1473；0x2DB→engine-fields.ts:117 映射 fontMetricsMode、:302 注册、被 msgwin.ts:1344 消费）；面名映射与竖排也已有（text/fontSet.ts:102 FACE_MAPS、:138-142 normalizeFace 剥 @ 前缀、:156-164 resolveFace、:215-225 ENGINE_FONT_LIST、:228-232 fontListIndex；engine-fields.ts:300 的 0x261 竖排在 msgwin.ts:223 被排版消费），并有真实断言（text-layout.test.ts:248-264、font-bold-face.test.ts:110-123、text-style-snapshot.test.ts:89-115）。真正缺的只有 GDI HFONT 句柄层。lazy-gdi-font-set 的 note 自己写着「仍需保留」，与 status=absent 同时冲突。
- **证据**：raw 70984（sub_459F40 入口守卫 `if (!*(_BYTE*)(_this + 1260)) return`）；raw 33385-33422（0x2BD/0x2BE 真身：写 Font+1248/Font+218516=700 与 Font+1308/Font+218588=700 后调 sub_459F40/sub_45A6E0）；analysis/engine-capabilities.json:2342-2345；app/amayui-emulator/src/vm/handlers/msgwin.ts:1146-1189/:1460-1473/:1344/:223；src/vm/handlers/engine-fields.ts:117/:300/:302；src/text/fontSet.ts:102/:138-142/:156-164/:215-225/:228-232；守卫 test/text-layout.test.ts:248-264、test/font-bold-face.test.ts:110-123、test/text-style-snapshot.test.ts:89-115。
- **建议处置**：两条合成一条，status 改 partial（参数面 + 面名映射那半可标 modeled-verified），evidence 升 E1/E2 并给出 guard，note 写明「面名→内嵌字族映射与 6-7 条参数面已实现；缺的是 HFONT 句柄层与字体级联」。

## P2/P3 汇总表

### P2（30 条）

| id | kind | 一句话 | 证据锚点 |
|---|---|---|---|
| `3d-effect-level-gate` | no-evidence | cited 区间只覆盖 trigger 第一句，且引出的是 effect 202 | raw 23917/23919/23922/23926/23935/23937-23945 |
| `adv-advance-opcodes` | contradiction | whySilent 用现在时描述 stub/no-op，与同条 modeled-verified 冲突 | app/amayui-emulator/src/vm/handlers/msgwin.ts:546、:1429 `[0x6e, op_show_text]`、:1430、:1434 `[0x072, op_wait_for_input]`、:1435 `[0x0fa, op_poll_msg_advance]`、:1441 `[0x1ca, op_set_read_text_skip]` |
| `audio-module-topology-and-volume-routing:object` | overreach | 被引的 sub_4BB810 只有 3 项赋值（纯绑定），对象由 sub_4BB700 构造 | raw 142476-142486（sub_4BB810 全体）、142443-142447、22469 `sub_4BB700((_DWORD *)(_this + 84128));`。 |
| `chained-3d-layer-commit` | contradiction | 本条对象是 Scene+1096 的 572B 立绘表（已建模），why 的「3D 未建模」不符 | raw 134277（sub_4B0360 头）、134313 `v5 = a1 + 274;`、134318 `qmemcpy(v29, (const void *)sub_4AAEC0(v5, &a5), 0x23Cu);`、136938、137254 |
| `clock-write-clock-freeze` | no-evidence | engine.raw=20750-20751 支撑 trigger「主循环每帧写 Engine+369332；opcode 0x20C / sub_41A090 / sub_41A2C0 也写；Engine+107438 非零时只递增 107439」与 reads「Engine+369332 \| Engine+369336 \| Engine+107438」 | raw 20750-20751（唯一被引的写） |
| `frame-pump-input-refresh` | no-evidence | raw 只覆盖 sub_4BBAB0 头与体一段，两次 read 在主循环 20646/20750-20751 | raw 142574/142586/142681（区间内三个函数头）、142599/142601-142640/142676（sub_4BBAB0 体）、20646（调用点）、20750-20751（帧时钟 read）、20465（sub_412290 头） |
| `lazy-3d-effect-202-snow` | gap-as-noop | 0x326 被登记成 no-op，却是主线可见天气（SETWEATHER + ≥5 个 SC call-script） | app/amayui-emulator/src/vm/handlers/stubs.ts:107、:149-152 |
| `lazy-d3d9-device-init` | no-evidence | sub_498B30 全库不存在；raw 115565-115674 实属 sub_498CC0（D3D9 建/放） | raw 115527 `int __thiscall sub_498CC0(`、115565（区间首行 = 局部声明 `BOOL v37`）、115573（第一条可执行语句）、115574-115583、115587、115590、115605-115609 |
| `lazy-mesh-slot` | no-evidence | reads 的 Scene+50704 与「1000 个槽」不在 cited 区间 | raw 121076-121101 |
| `live2d-enabled-config-flag` | no-evidence | sub_4209B0 是 0xA0(jcc) handler，体内无 a9d0/f8c46/f8c47 读取点 | raw 22889 `*(_DWORD *)(_this + 676636) = sub_4209B0;` |
| `live2d-mesh-batches` | contradiction | trigger「按纹理号分组」与同条 note「按网格一批」冲突，cited 区间无该代码 | raw 134316-134320（门控）、134389（每节点一次 sub_4783D0） |
| `mesh-vertex-quad-and-per-vertex-color:fn` | contradiction | sub_426BD0 是 0x321；0x320 真身是 sub_432150 | raw 23216 `*(_DWORD *)(_this + 679196) = sub_432150;`、23217 `*(_DWORD *)(_this + 679200) = sub_426BD0;`、41034-41042、41053 `*(float *)((char *)v6 + (_DWORD)v5) = 1.0;`、41054-41058、41069、33845-33849 |
| `msgwin-attr-font-opcodes:noop` | contradiction | 11 条「仍是 no-op」全部已是真 handler 且被消费 | app/amayui-emulator/src/vm/handlers/msgwin.ts:1146-1189、:1460-1473 |
| `msgwin-backlog-cursor` | cross-source-mismatch | reads 混用字节/下标；0x84 未注册（命中即报错，不是静默自旋） | raw 70575（sub_459770 头）、70588/70595-70598/70603/70609/70624（_this[845]/[846]/[859]/[860]）、73186/73188/73189-73190（+3380/+3384/+3436/+3440）、22833（0x84 → sub_41F790） |
| `msgwin-offscreen-surface-lifecycle:note` | contradiction | note 首句「无每窗离屏表面概念」与 textLayer.ts 相反（DD/D3D 两路混作一条） | app/amayui-emulator/src/renderer/pixi/textLayer.ts:5、:9、:68、:78 |
| `msgwin-window-reveal-gate-300:offset` | contradiction | 四个 Engine+1224xx 实为 dword 下标（122465 字面全库 0 命中） | raw 13835 `*(_DWORD *)(_this + 489860) = 0;`、13841、13837 `v3 = (int *)(_this + 489868);`、13851 `v3[10] = 0;`、13853 `v3[20] = result;`、13857、13892 |
| `render-3d-layer-dual-commit:range` | cross-source-mismatch | raw 尾端多 140 行别的函数；reads 漏 +46676/+46672/+46468 | raw 136968、137284、137285、137287、137033、137035-137036、137183 `v35[11628] = 0;`、137340、137347。 |
| `scene-capture-target-flag-46680` | contradiction | 引的是 FillTexture；Scene+46680 写点在 sub_4A4DC0(CaptureTexture) 124960-124962 | raw 124572-124573、124640-124650、124651-124652、124951、124960-124962、137590 |
| `scene-draw-total-gate-1056` | contradiction | note「emulator 总是画」与 #holdFrames / present:needsRender 相反 | raw 134418（sub_4B06D0 头）、134814 `v2 = *(_DWORD *)(_this + 1056) == 0;`、134817-134818 `if ( v2 ) return;` |
| `scene-frame-commit` | cross-source-mismatch | raw 136742-136966 只覆盖 sub_4B4040；reads 的 +46500/+1056/+46676 在 sub_4B06D0 | raw 136741/136742、136966、134417/134418、134814、136790、23051 `*(_DWORD *)(_this + 678092) = sub_41A1A0;`、25271 `result = sub_4B4040((int)(_this + 80708));`。 |
| `scene-frame-commit:guard` | no-evidence | guard 只断言槽绑定率 ≥0.95，与「四路归并/三路已接」无关 | app/amayui-emulator/test/draw-item-slot-coverage.test.ts:30-52（SlotRecorder）、:69（stepOnce）、:85-92（唯一两条断言） |
| `scene-freeze-flag:gate` | overreach | trigger 未写体内否定门：只有 (Scene+46528 & 2)==0 才置冻结 | raw 12788（定义）、12793 `if ( (*(_BYTE *)(_this + 46528) & 2) == 0 )`、12795-12798、12800 `return result;` |
| `scene-freeze-flag:raw` | no-evidence | raw 130427 在 Scene 构造函数 sub_4AAF90 内，非「每遍绘制清零」 | raw 130286-130287、130427、22473、136792-136793、136842、137035-137036、137183、130680（sub_4AB7A0 头）、130698、130768-130770 |
| `scene-render-3d-frame-request-46700` | contradiction | Scene+46700 只在 sub_4B4040(136832)/sub_4B4460(137173)，trigger 归属错（并并入 sprite-2d-draw-layer） | raw 136741 `//----- (004B4040)`、136832 `if ( (v22 < 0 \|\| v22 == 38) && *(_DWORD *)(_this + 46700) )`、136833 `sub_49FCD0(_this);` |
| `script-frame-refresh-opcode-20c` | overreach | guard 只断言注册分类（StubNative 空体），不断言时钟/frameTick | app/amayui-emulator/src/vm/handlers/frame.ts:73-80、:347 |
| `script-queue-dispatch` | contradiction | 队列与 0x143 都已实现；未接线的只是帧末 0x1F5 驱动点（T-0057） | app/amayui-emulator/src/vm/engine.ts:193/:195 |
| `text-drawmode-fork` | cross-source-mismatch | raw 与 fns 不配对（6 个 fns 只有 2 个在区间内） | raw 68010-68011、68037、68051/68053、68497-68498、23466-23467、31363-31364、31372、85933-85934、87102-87103 |
| `text-layout-wrap-ruby` | contradiction | 排版模型已在产品路径跑（19 条断言），note 却写「都未建模」+E0 | raw 83596（逐字量宽）、83601（sub_475CF0 边界判据）、83918（sub_45D120(win+44, …) 在逐字循环内） |
| `text-redisplay-rewind:table` | contradiction | 「0x199 不在任何表里」与 677632=sub_418FC0 及本条 fns 冲突 | raw 22844 `*(_DWORD *)(_this + 677632) = sub_418FC0;` |
| `text-white-level-on-composite` | contradiction | note 的 TEXT_WHITE_LEVEL=0.89 与三处守卫在实现里都不存在，现机制是覆盖率 α（225/255） | app/amayui-emulator/src/text/layout.ts:61 `export const TEXT_FILL_ALPHA = 225 / 255;` |

### P3（45 条）

| id | kind | 一句话 | 证据锚点 |
|---|---|---|---|
| `adv-flag-lifecycle` | cross-source-mismatch | note 未给各清除点 handler 行号；且 0x6E 与 0x71 都有同一道门 | raw 24531、28339/28358、28432/28442 |
| `adv-input-pump-perframe:reads` | cross-source-mismatch | reads 未点名「跳读中掩码位」= Engine[174801] 的 0x8000000 | engine/天结_unpacked.exe_utf8.c:24961/24966/24967-24979/24981/24985 |
| `audio-module-topology-and-volume-routing:raw` | cross-source-mismatch | raw 只覆盖 1/7 fns；note「22 条」与 AUDIO_OPS 26 条不符 | raw 14918（sub_40A8A0 头）、14937、14939、14943、14946、23688/23692 |
| `chained-3d-layer-commit:callsites` | overreach | 「6 个调用点」与所列 7 个自相矛盾；另有 136937/137253 未登记 | grep `sub_4B0360\(`：134278（定义）+ 135610/135796/136001/136091/136307/136575/136647 + 136937 + 137253 |
| `clock-read-drawitem-5-windows:px` | no-evidence | guard 未写进 evidence；实现注释把 0x348 误读成 348px | test/config1-chain.test.ts:204、:208 |
| `engine-config-registry-persistence` | no-evidence | note 引的 sub_4900F0(110505)/sub_490590(110734) 在 raw 区间外 | engine/天结_unpacked.exe_utf8.c:111337-112851（区间）、112838（sub_490010）、110505/110734（note 引用但区间外） |
| `frame-pump-music-fade` | overreach | raw 12113-12140 是被门控的一次性 setup，逐帧推进方在 20827/20835 | raw 12112-12140（门 12120/12125、setup 12128-12136、闭括号 12140）、106269-106270、106322-106323、20464-20465（sub_412290 定义）、20646-20648、20827、20835 |
| `frame-render-gate-mainloop` | contradiction | note 被截断且 effect_flags 丢首字母；trigger 漏 675968 与 429752/0x400 两道门 | analysis/engine-capabilities.json:131（note 原文含 \u001b） |
| `hover-ret-reruns-gate-op` | overreach | raw 只覆盖 sub_405360；effect_flags 那半在 sub_41EEF0(28464-) | engine/天结_unpacked.exe_utf8.c:11030-11041（sub_405360 全体）、:28464（sub_41EEF0 定义）、:28339-28500（门与 sub_48F000 调用与置位） |
| `lazy-3d-effect-203` | no-evidence | whySilent 的「退出时无 Release」无 cited 证据（说法本身成立） | raw 134850-134855 |
| `lazy-572b-node-map` | contradiction | 「立绘」那半已建模且有 E3 守卫；note 把三张表当成一张 | app/amayui-emulator/src/vm/engine.ts:1228-1229 |
| `lazy-drawitem-map-node` | overreach | 「全 0/flags=0」的依据在 sub_4AAA50→sub_49A300，不在 sub_4AAD40 | 130164: `char v12[740]; // [esp+2F4h] [ebp-2E8h] BYREF` |
| `lazy-live2d-slot` | no-evidence | 「10 个槽」的依据在未列出的兄弟函数 sub_4A1AF0/sub_499C30/sub_4A1D50 | 121675: `v8 = (void *)_this[NumberOfBytesRead + 13953];` |
| `lazy-mesh-map-node:fnname` | cross-source-mismatch | emulator 走的是 scEnsureMesh，不是 scCreateMesh | app/amayui-emulator/src/renderer/scene/ops.ts:272-275（注释）、:277 `export function scEnsureMesh(`、:435、:452 |
| `lazy-mesh-map-node:reads` | no-evidence | cited 区间无 1064/1068，其依据在调用点 136917/137222 | raw 17763-17764、17776、17785、17798、17800 `memset(v11, 0, sizeof(v11));`、136917 `v20 = sub_40DC30((_DWORD *)(_this + 1064), &v34);`、137222 `v28 = sub_40DC30(v50 + 266, &v42);`（266*4 = 1064）。 |
| `lazy-movie-dll:whysilent` | overreach | whySilent 未回答「为什么缺失是静默的」（本条非静默） | engine/天结_unpacked.exe_utf8.c:31077-31086（LoadLibrary 失败 → sub_408050 错误串 + `_CxxThrowException`） |
| `lazy-movie-texture-slot` | overreach | fns 指向 CMovieToTexture 构造函数，惰性创建载体是 sub_4237B0 | 105607-105617: `//----- (00489040)` / `_DWORD *__thiscall sub_489040(_DWORD *_this)` / `sub_4034A0(_this);` / `*_this = &CMovieToTexture___vftable_;` |
| `lazy-sprite-recreate` | overreach | sub_4A2BA0 唯一调用点 126546 在 sub_4A6EE0（设备创建）内 | 126546: `if ( !sub_4A2BA0(_this) )` |
| `mesh-vertex-quad-and-per-vertex-color:literal` | cross-source-mismatch | 引用的 -1 -1 字面在 src 里不存在（是槽引用 + 运行期值） | raw 41034-41042、41053、41054-41058、41069 |
| `msgwin-attr-font-opcodes:raw` | cross-source-mismatch | raw 28652-29163 只覆盖 9/15 个 fns（6 个定义行在区间外） | raw 28652 `//----- (0041F350)`（定义行即区间起点，不存在「差 1 行」） |
| `msgwin-cancel-key-state` | no-evidence | stage 2 清 ADV + 复位 ReadTextSkip 无任何断言 | app/amayui-emulator/src/vm/engine.ts:625-640 |
| `msgwin-config-gates` | contradiction | 键名错（MessageSpeed 而非 MesWinAlpha）；滚轮/重绘已实现；guard 六键 0 命中 | app/amayui-emulator/src/vm/handlers/msgwin.ts:343-344、:353-355、:406-407、:410-414 |
| `msgwin-line-fade-window` | overreach | trigger=「**D3D 路径下** sub_45BE20 为每行建 DrawItem 之后」；reads=[「Font+1376(= message:MessageSpeed)」「Font+235128(= message:MessageFade)」…] | 72336: `if ( *(int *)(_this + 1376) > 0 && *(int *)(_this + 235128) > 0 )` |
| `msgwin-offscreen-surface-lifecycle:evidence` | contradiction | note 自称「均为 raw 反编译确证」却写 E0；raw 只覆盖 1/7 fns | docs-new/03-engine/engine-capabilities.md:8（E0 未读体 / E1 已读体） |
| `music-number-table-lifecycle` | no-evidence | 区间首行 106384 落在 sub_48A020 体内（fns 首项是 sub_48A0D0@106418） | engine/天结_unpacked.exe_utf8.c:106384（区间首行 = sub_48A020 体）、106419-106541（区间内 5 个函数）、106866（sub_48AA60，区间外）。 |
| `passive-camera-and-effect-render-state` | no-evidence | raw 只给调用点；「Manager[315]」与 body 的字节 +1260 不符 | engine/天结_unpacked.exe_utf8.c:136828-136829（调用点）、65792-65813（sub_453540 体：_this[312]/[313]/[314] + timeGetTime）、65842-65913（sub_4535F0 体：+1044 设备、+1260 分支、5 次 +228 调用=SetRenderState）。 |
| `reads-unit-notation:clock-write-clock-freeze,msgwin-text-object,msgwin-text-method-opcodes` | cross-source-mismatch | 同一格字段在 reads 里字节/dword 下标混用无标记（合并 5 处） | raw 28631、29380、13910、20690、20755、22461、92385/92386、25030、13835/13841、33750 |
| `render-endscene-and-2d-stack` | overreach | 「每帧 sub_4B4040 成对调用」在 cited 区间无调用点（应在 136794/136839） | engine/天结_unpacked.exe_utf8.c:119198（sub_49DFD0 定义）、:119202-119206（计数 ≤1 才 memcpy）、:119262-119272（sub_49E170 成对弹出）、:114845（sub_497F90 定义） |
| `render-range-clip-by-index` | overreach | 裁剪位 v372 在 134873-135093 无读取点 ⇒ 比较是死写，真实消费者在 sub_4AEEA0 | raw 134873 `v372 = 0;`、134874-134882、135094 `v372 = v114;`、135116（首次读） |
| `save-slot-chain:note` | contradiction | CALLBACK_LOAD.BIN 那一跳现已复现；note 与 saveSlot.ts:335 仍是旧文字 | app/amayui-emulator/src/vm/handlers/save-slot.ts:271-282 |
| `save-slot-chain:raw` | cross-source-mismatch | raw 38243-38594 只覆盖 9/15 fns（装载/写状态路径的证实行在区间外） | engine/天结_unpacked.exe_utf8.c 定义行 38242/38287/38334/38365/38407/38462/38485/38515/38552 与 16876/19276/44684/44854/45094/45105 |
| `scene-3d-weather-effects-rain-snow-leaf` | no-evidence | 未列 0x324-0x328 五个 handler 的地址与行号 | `app/amayui-emulator/src/vm/handlers/stubs.ts:107` `[0x326, op_engine_internal]`、:108 `[0x325, op_engine_internal]`、:149 `[0x324, op_engine_internal]`、:150-152「★同族的 `0x327`…与 `0x328`…**目前根本没注册** ⇒ 命中即 `NotImplementedOp`。 |
| `scene-drawtable-flush-and-dirty` | overreach | guard 指向不含该 opcode 的回归测试（真守卫是 adv-msgwin.test.ts） | `test/scene-report.test.ts` 全文（179 行）无 `0x1f6`/`0x1f7`/`scClearDrawContainer`/`scDetachTexture` |
| `scene-freeze-flag:guard` | no-evidence | 「池挂起位下次绘制归零」不是被测行为（手工置 false） | app/amayui-emulator/test/wait-gate-timer.test.ts:87-93 |
| `scene-render-freeze-46676:count` | overreach | 「105 处全为读」混了非 Scene 基址（52 处经 Engine[1040]）；E0 与读体结论不符 | raw 75615、56807、10559、118304、120115、126421、132783 |
| `scene-render-freeze-46676:switch` | contradiction | 「emulator 无对应开关」不实（BlendEnv.sceneFrozen 存在且有单测） | app/amayui-emulator/src/renderer/scene/blend.ts:66-67、:89 |
| `script-queue-dispatch:gate` | overreach | 497400 不应删、429752 应补列（整体出队还需调用方的 497400==0） | engine/天结_unpacked.exe_utf8.c:18966 `if ( !*(_DWORD *)(_this + 429752) )` |
| `stage-stepper-0x40-gate:raw` | cross-source-mismatch | raw 只覆盖 1/7 fns；reads 的 430688/95796 不在该体 | engine/天结_unpacked.exe_utf8.c:13630/13643/13655/13660/36719 |
| `text-glyph-coverage-alpha-composite:confidence` | cross-source-mismatch | confidence=confirmed-by-pixels 不在枚举内；注意与 :blend 两条同源 | raw 84891-84898、84918-84938 |
| `text-line-pitch-font-1380` | overreach | 「全库只读」不确（raw 78772 有一次写 0），结论「恒 0」仍成立 | engine/天结_unpacked.exe_utf8.c:78772 `*(_DWORD *)(_this + 218600) = 0;`、:78858 `*(_DWORD *)(_this + 1380) = 6;` |
| `text-redisplay-rewind:evidence` | contradiction | 守卫是纯合成单测，只能是 E2 不是 E3 | app/amayui-emulator/test/op-a2-a3.test.ts:14/:16/:17/:42/:94 |
| `texture-bind-synchronous-then-query:evidence` | overreach | guard 只覆盖 ①，②只有日志级证据，E2 口径不符 | raw 39866-39899（0x208/0x209 查询端与 imgid 表）、raw 67794 起 sub_4559C0（同步装载端） |
| `vertex-buffer-lock-scale` | overreach | 门在 cited 区间前一行；「脚本深度」命名与 fields.json 不一致 | raw 133547-133550（真门）、133588-133598（39 支缩放）、130434（初值 -1）、133559-133564（错误路径） |
| `world-matrix-identity-refresh` | overreach | reads 的 Scene+46536 不在 cited 区间；trigger 漏 Scene+1116 与 BeginScene 门控 | 122136: `if ( *(_DWORD *)(_this + 1116) )` |
| `world-matrix-identity-refresh:guard` | overreach | guard 只测纯模型层动画窗，证明不了「接入 Pixi」 | `test/draw-item-anim-window.test.ts:59/83/109/129/169` 全是 `makeItem`/`advanceWindows` 级断言（:44-55 的 `frame()` 助手指明「模拟 present 的顺序」），:200/:224 用 `new HeadlessScene()` 验空项 |

## 待查（证据不足）

| id | 缺什么 | 现状 |
|---|---|---|
| `adv-perframe-dispatch` | 主循环 ADV 分支的正确锚点与帧驱动断言 | 复核 verdict=partial 且 `correctedKind=unclear`：方向对，但 finding 写的主循环调用点 20617/20643-20690 不是它（真实位置 raw 21158-21160），且自称的 guard 不 import runFrameLoop |
| `filesource-script-load` | reads 口径的明确约定 | raw 18978/18987 属实；verify 认定 reads 是「读/写合并列表」，故「名不副实」不成立，只剩字段语义标注不完整 |
| `frame-pump-sound-channels` | 字段口径（`Engine+82876+302` 读不出）与真实门控条件 | raw 20645/20646 可核；finding 的「grep 82876 = 0 命中」错（实测 12 命中），「必然执行」过强（受 Engine+429752 门控） |
| `lazy-3d-effect-202-snow:why` | 每条 n/a-known 自足的理由（「why: 同上」无法独立核对） | 全库同形「why: 同上」共 4 处（engine-capabilities.json:1201/1226/1355/1428）；守卫只要求 note 含 `why:` 字样（test/capability-ledger.test.ts:94-97） |
| `scene-teardown-on-load-point` | E4 的真机对照证据（现依据是 emulator 自己 GUI 实拍，应按 E3） | 实现存在（save-slot.ts:245-246）、guard 无该行为断言（test/slot-load-resume.test.ts grep 0 命中）、E4 依据是 emulator 自己的 `shot --load 79` GUI 实拍 |
| `live2d-offscreen-node-lifecycle` | 原始 finding 记录（该 id 只在复核输出里出现） | 该 id 只出现在对抗性复核的 id 清单，`.tmp/audit2/cap-1..5.json` 里 grep 无命中，无 claim 可比对 ⇒ 既不 confirmed 也不 refuted |

## 已排除的误报（refuted，4 条）

- `clock-read-transition-window` — 把第二层 schema 的定义边界当缺陷：schema 明确 reads 是「读/写的字段」，台账同族条目同样只写不读，无引擎语义错也无 emulator 影响（verify: refuted）。
- `msgwin-line-fade-window:guard` — 把 evidence 等级定义（E2 本就是「已实现、无 E3 守卫」）当缺陷；note 已自述缺口，逐字对照无不符（verify: refuted）。
- `scene-pending-flag-0x400-gate:scene46528` — 核心证据表错：raw 117441 是位测试 `(*(_BYTE *)(v113 + 46528) & 4) == 0`，不是 finding 说的「整 dword 写 0」，据此推出的结论不可复核（verify: refuted）。
- `script-frame-local-pool-lifecycle:raw-boundary` — 函数边界认错：sub_40ED40 体止于 18874，下一函数头是 18876 的 sub_40F750（不是 18953），raw 18577-18874 恰是「体首行~闭括号」无截断（verify: refuted）。

## 已合并的同根因条目（5 条，不计入 kept）

- `key-dispatch-default-slot:scale` — 属「reads 尺度口径混用」的同一根因，已并入 reads-unit-notation（P3/cross-source-mismatch）。
- `lazy-gdi-font-set` — 与 text-font-rebuild-cascade 同根因（同一「字体参数面/面名映射已实现却记 absent」的 stale-absent），已并入后者（P1/contradiction）。
- `msgwin-text-method-opcodes` — 与 msgwin-attr-font-opcodes:noop 同根因（同一份过期 no-op 清单），已并入后者（P1/contradiction）。
- `render-merge-two-pass-reorder:guard` — 与 scene-frame-commit:guard 同根因（同一 guard 文件与 note 不相干），已并入后者（P2/no-evidence）。
- `sprite-2d-draw-layer` — 与 scene-render-3d-frame-request-46700 同一次复核的同一 raw 站点（136832-136833）；cap-5 复核判 confirmed，但按「同一根因的多条 finding 合并成一条」已并入后者（P2/contradiction），保留后者里更具体的 sub_49FCD0 是 3D 帧渲染器的反证。

## 方法与覆盖

**覆盖**：输入为 `.tmp/audit2/cap-1..5.json` 的 **98 条 finding**（分片自报 checked 分别 25/26/26/27/26，但 cap-5 自报 26 而实际 findings 39，故自报合计 130 是重复计数）；`.tmp/audit3/cap-1..5-verify.json` 共 **98 条 verdict**，与 finding 的 98 个唯一 id 一一对应、无缺项无多余。98 条里：保留 84、丢弃 9（refuted 4 + 同根因合并 5）、待查 6（其中 2 条无原始 finding 记录）。台账 130 条条目中被 finding 触及的是其中一部分；约 25 处「已逐条确证、无 finding」的条目要点留在各分片 `notes`（如 `scene-beginscene-recursion-gate` 的 sub_497F50 递归计数与 114839 的 BeginScene 返回值门、`transition-table-flush` 的 sub_4A9BE0 129283-129302、`gfx-texture-load-sync` 的 sub_422CB0 31192-31240、`host-cursor-warp` 的 sub_421EA0 30530-30598 等），本报告未逐条列出。

**复核分布（可复算）**：confirmed 71 / partial 23 / refuted 4 / unclear 0（verdict 字段口径），合计 98。即 94 条（95.9%）经对抗性复核后保留（保留时可能降级或改 kind），4 条（4.1%）判为误报。

**引擎侧怎么核**：全部按 `engine/天结_unpacked.exe_utf8.c`（184091 行）的 raw 行号开体自读；opcode↔handler 的映射用 dispatch 表（表项 = 字节 675996 + 4*op，赋值块 22723 起）与 `.tmp/audit2/dispatch.json`、`docs-new/03-engine/opcode-table.md` 交叉；字段出现次数用 word-boundary 正则全库计数；尺度按约定区分 `_this[N]`（字节 4N）与 `*(_DWORD *)(_this + N)`（字节 N）。本报告写作时另抽样独立复核了 4 个表项：678180(=0x222)、679196(=0x320)、679200(=0x321)、676636(=0xA0) 均与 `opcode-table.md:378/521/522` 及 `0x238` 的 ★2026-09 订正一致。

**emulator 侧怎么核**：按 finding 引用的 file:line 逐个打开 `app/amayui-emulator/src` 与 `test`，并对关键点（0x97 / 0x84 / 0x20C / 0x75 / 21662 / 0x222 / sceneFrozen / AUDIO_OPS 条数）做全 `src+test` grep 而非只看被引文件；守卫测试只查「断言是否覆盖所述行为」，不把文件存在当证明。

**系统性结论（可复核的横切断面）**：
1. `engine.raw` 与 `engine.fns` 普遍不配对：分片独立统计「raw 覆盖全部 fns 定义行的只有 7 条、覆盖 0 个的 73 条」；而守卫强制 `engine.raw` 匹配 `/^(\d+)-(\d+)$/`（`test/capability-ledger.test.ts:61-63`）⇒ 多区间修法不可落地，只能在台账 `_doc` 里写明「raw = 本条主证据区间」。
2. reads 的字节/下标两种口径长期混用且无标记（`reads-unit-notation:...` 一条合并了 5 处）。
3. evidence 等级与 note 自述不符：E0 却在 note 里给读体行号（`scene-render-freeze-46676:count`、`msgwin-offscreen-surface-lifecycle:evidence`）、E3 的守卫其实是纯合成单测（`text-redisplay-rewind:evidence`、`single-field-timers-audio-device`）。
4. `absent` / `n/a-known` 多处 stale：字体参数面与面名映射已实现（`text-font-rebuild-cascade`，原 `lazy-gdi-font-set` 已并入）、572B 立绘那半已实现（`lazy-572b-node-map`）、0x143 队列已实现（`script-queue-dispatch`）、`Scene+46668` 是 2D 路径门（`scene-3d-effect-level-writer`）、0x326 是可见天气（`lazy-3d-effect-202-snow`）。
5. 台账守卫只校验 guard 指向的文件**存在**（`test/capability-ledger.test.ts:76-92`），不校验其中是否有证明该行为的断言 ⇒ 上述 (3)(4) 全部能通过自检，这是本批 finding 的根本来源。

**未做**：未跑任何构建/测试（只读纪律），故「守卫是否真绿」未验证，只看断言文本是否存在与是否覆盖所述行为；E4 类真机对照证据（`.tmp/*.png` 截图内容）无法人眼判读；真源 `.c` 的行号已由复核方逐行双重核对，未发现整体偏移一位。

**产出**：本报告 + `.tmp/audit-final-capabilities.json`（机器可读：rawFindings 98 / kept 84 / dropped 9 / unclear 6）。台账本身（`analysis/engine-capabilities.json`）与 emulator 代码未做任何修改。
