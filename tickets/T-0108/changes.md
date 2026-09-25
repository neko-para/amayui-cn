# T-0108 · 变更记录（数据层沿革话术 → 结论留原文、沿革落 `journal[]`）

> 口径：本票处理的是**被渲染的字段**（`opcodes.json.semantics`、`engine-capabilities.json` 的
> `name/trigger/whySilent/emulator.note`、`opcode-gaps.json.note`）与**数据层**（`functions.json` /
> `fields.json` / `scripts.json`）。沿革的**家**按 `docs-new/00-overview/authority.md` 附录 **A2/A4**：
> 各实体的 `journal[]`（**永不渲染**）、`tickets/<ID>/changes.md`（实现级）、`analysis/journal.jsonl`（会话级）。

## 1. 判定与计数（判据 ①）

### 1.1 改前 / 改后（journal 之外）

| 文件 | 改前（含沿革话术的字段数） | 改后 | 其中落 `journal[]` 的条数 |
|---|---|---|---|
| `analysis/opcodes.json` | 59（另 `statusEnum` 1 处措辞） | **0** | 90 |
| `analysis/engine-capabilities.json` | 44 | **0** | 80 |
| `analysis/opcode-gaps.json` | 26 | **0** | 71 |
| `analysis/functions.json` | 37 | **0** | 36 |
| `analysis/fields.json` | 5 | **0** | 3 |
| `analysis/scripts.json` | 10 | **0** | 6 |
| **合计** | **181** | **0** | **286 条 / 217 个实体** |

`grep -c 订正`（T-0105 的统计口径 = 行数）改前实测：`opcodes 53 / capabilities 48 / opcode-gaps 31 /
functions 24 / fields 4 / scripts 8` = **168** —— 比 T-0105 记的 146 多，差额来自 `T-0149`（缺口台账
`partial` 的一阶处置位）、`T-0151`/`T-0153`/`T-0166`/`T-0170` 这几轮新写进数据层的「改判 / 订正」行。
**改后：六份真源 `grep 订正` 的命中全部落在 `journal[]` 内（被渲染字段 0 处）。**

### 1.2 三类处置

| 类别 | 判定 | 处置 | 处数 |
|---|---|---|---|
| **B 结论级订正** | 某条**结论本身**被推翻/改正（旧语义、旧锚点、旧口径、旧处置） | 从被渲染字段移走，**原文逐字**落该实体 `journal[]`（`{at, field, what}`） | 286 |
| **A 纯沿革** | 旧措辞/旧名/错值，当前事实已在同句（如「名从旧注…改用」、`（旧句保留作历史）`） | 直接删，**不动**当前事实 | 15 |
| **C 非沿革（保留）** | ① 技术术语误命中（`还原表下标` 里的 `原表`）；② `0x00` 的 `ALLOW_UNDERRUN` 条目引用；③ **T-0149 的处置记录**（`本条的处置 = partial` —— 它是台账「为什么这条是 partial」的**现行说明**，不是沿革，见 `dispositions.partial` 的定义） | 保留 / 改写为直陈句 | 见 §3 |

★「结论级」的一律**没有丢事实**：被移走的原文（含 raw 行号、真锚点、审计条目号）逐字进 `journal[]`，
且 §4 抽查证明现行字段里**真锚点/新值仍在**。

## 2. 生成物（判据 ②）

四个生成器重跑（`build-opcode-table.mjs` / `build-capabilities.mjs` / `build-opcode-gaps.mjs` / `build-scripts.mjs`）：

| 生成物 | 改前 `订正` 行数 | 改后 |
|---|---|---|
| `docs-new/03-engine/opcode-table.md` | 49 | **0** |
| `docs-new/03-engine/engine-capabilities.md` | 8 | **0** |
| `docs-new/03-engine/opcode-gaps.md` | 1 | **0** |
| `docs-new/05-scripts/*.md`（ALLMAP 3 / AUTORUN1 1 / SCJUMP 2 / SETADVFLAG 2） | 8 | **0** |
| `docs-new/03-engine/*.md` 其它（手写叙述） | 0（T-0105 已清） | **0** |

另核：`journal[]` 的正文**没有**任何一段漏进生成物（用三条 journal 特征串在 `docs-new/03-engine/*.md`
里 grep ⇒ 全 False）。

## 3. 残留清扫（超出「订正」字面的同族沿革词）

`订正` 清零后，用一组更宽的沿革词（`旧文档 / 旧注 / 旧行 / 旧实现 / 旧结论 / 旧名 / 旧口径 / 曾按 /
原先 / 此前 / 已作废 / 原 note / 保留对照 / 未采纳 / 改判`…）扫被渲染字段：**69 个字段命中 → 24 → 1**。
处理三类：

1. **改写为直陈句**（`旧实现把 X 写成 Y` → `Y 会让 …`；`此前零注册 ⇒ 命中即硬停` → `零注册时命中即硬停`），
   共 49 处字段，沿革原文同样落 `journal[]`；
2. **T-0149 的处置沿革**（20 条 `★T-0149：本条由 X 改判 Y`）→ 改写为 `本条的处置 = Y`（保留**当前处置**这个
   事实），撤下的「由 X 改判」原文落 `journal[]`（`at = "T-0149（处置改判）"`。改判语义由
   `dispositions.partial` 与本票 `journal` 承担，不再占用被渲染的 `note`）；
3. **唯一剩余命中是误报**：`analysis/opcodes.json` 的 0x02 语义里 `还原表下标` 含子串 `原表`（技术术语，非沿革）。

## 4. 抽查（判据 ④：各文件 ≥3 条，证明只删了沿革、现行事实仍在）

| # | 实体 | 移走了什么（→ `journal[]`） | 现行字段里**仍在**的事实 |
|---|---|---|---|
| 1 | `fields.json` `Engine/0x4ED10 scene` | 「本条旧 offset 曾写 `0x4ECD0`（=322768）是错的…别再按 `0x4ECD0` 反推」 | `_this + 80708` = byte **322832 = `0x4ED10`** + `Engine[i] = Scene[i − 80708]` 换算例（`Engine[92333]/[92338]/[92339]`） |
| 2 | `fields.json` `Scene/0xB5AC dirty_flag` | 「曾以『重建排序表/顶点缓冲』解释，是错的」 | 语义 =「有模型变更 ⇒ 下一轮主循环调 `sub_4B4040`」+ 唯一读者 `sub_40BE10` raw 16022 + 置 1 共 90 处 / 清 0 共 4 处的逐格清单 |
| 3 | `fields.json` `DrawItem/0x244 rot_win_axis` | 「此前记为『平移窗目标位移 XYZ』是误」 | 旋转轴 XYZ + 消费端 raw 118228 + 平移分量在 `0x290`（`0x235`） |
| 4 | `functions.json` `0x41FBF0`(0x8B) | 「旧口径把 `Font+1380` 当第四色是错的」 | 行间距 = `Font+1380` = `Engine[21669]`；换行步进 `sub_46AF90`（字号 + 本字段） |
| 5 | `functions.json` `0x42D980`(0x19E) | 「旧注把存档与 0x1A1 弄反」 | **存档** opcode = 本条 `0x19E`；`0x1A1` 不是 |
| 6 | `functions.json` `0x41ACD0` | 「`Engine[429812]` 恒 0、`0x8000000` 无额外影响」的判断被推翻 | `Engine[429812]` = 最后一次 `mouse-callback`(0xCC) 的 op1（`sub_453A60` 写）⇒ ADV 里这一位是**旁路节流** |
| 7 | `scripts.json` `ALLMAP` | 「原写 `b22a != 0` 时置 1」（读反） | 极性 = `eq local566, b22a, 0` + `jcc …` ⇒ **`b22a == 0` 才置 `3f3d = 1`** |
| 8 | `scripts.json` `SCJUMP` | 「file 原写 `$1$SCJUMP.txt`、门量 1dd7」 | file = `src/SCJUMP.txt`；门量 = `13d7`/`13d8`；`mov global0 1` 是选中下一节的正常动作 |
| 9 | `scripts.json` `SN0000` | 「原记录：菜单 mesh 被近似成全屏黑叠加块」等三处缺口描述 | ① mesh 按真实几何 + 真实颜色合成；② 文字块原点 = `i07a` 覆盖值；③ 字格路径一拍 = 一个**字格**（cells × op10） |
| 10 | `opcodes.json` `0x1D0` | 「本条此前的归口标签『GDI 文本度量族』是错的」+ 整段旧记录原文 + 两次筛体归口 | **`回看页索引表`·带步数读出**、`sub_459860`、`raw 70629-70724`、`route-c-text-metrics-2026-09.md`（守卫逐条钉着） |
| 11 | `opcodes.json` `0x1D1` | 「原 `deferred`、旧标签『GDI 文本写入侧』」+ 旧卡点段 | **`回看页重绘`**、`sub_4675A0`、`raw 80312-81522`、`route-c-text-metrics-2026-09.md`（守卫逐条钉着） |
| 12 | `engine-capabilities.json` `text-font-rebuild-cascade` | 「原 note 的 `msgwin.ts:1146-1189` 与 `test/text-layout.test.ts:248-264` 两个锚点都指错」 | **真锚点全留**：`op_set_main_size`(0x75):1816 / `op_set_ruby_size`(0x197):1825 / `op_set_main_font`… / 0x2DB 走 `operandPlan.declarePlan(0x2db,…):401` + `engineFieldIds.ts:209`；派发 `MSGWIN_OPS:2136`；断言 `test/config1-chain.test.ts:93-94`；`engine.raw 70940-71273` |
| 13 | `engine-capabilities.json` `scene-frame-commit` | 「原 `engine.raw = 136742-136966` 只覆盖 `sub_4B4040`」的锚点纠错段 + 「原 note 的『MeshEntry 黑罩』是已作废的旧近似」 | `engine.raw` = **134417-136966**（一趟覆盖 `sub_4B06D0` + `sub_4B4040`）+ `fns` 补 `sub_41A1A0`（派发表 raw 23051、体 25258-25275、其中 25271 `sub_4B4040`） |
| 14 | `engine-capabilities.json` `msgwin-backlog-cursor` | 「（原文见 git 历史）…已订正描述」+「滚轮位 0x8/0x2 的旧注」 | 引擎读 `1 << Conf(set:WheelKeyUp/Down)`（掩码位号，随包默认 3/1）+ `sub_411560`→`sub_455000`→`sub_40FC90(-1)` ⇒ 名字不在索引里整跳 no-op（raw 67420 / 19021-19026） |
| 15 | `opcode-gaps.json` `0x22F` | 「★以体订正筛体两处」的表述 | 体内 = `Scene+387` + **`D3DXMatrixTranslation`**（`sub_49A9C0` 里无 Scaling；+323/Scaling 属 0x22D 的 `sub_49A870`）—— 仍带 raw，守卫的「note 必须引 raw 地址」仍绿 |
| 16 | `opcode-gaps.json` `0x223` | 「原记为『给绘制项登记区域记录』是错标 + 旧实现写进 `Engine.itemRegions`」 | 真语义 = 转场记录表 `Scene+1048` 类别 0 的**写入端**（`[0]=0`、24 格、`sub_49A640` 默认记录、守卫 `test/op-223-transition-fade.test.ts`） |

## 5. 守卫扩展（判据 ③）+ 辨别力证明

`app/amayui-emulator/test/doc-model.test.ts` 的 **I9**（用例名仍为「★文档模型：沿革不进叙述文档」，
票据锚点 `沿革不进叙述文档` 未动）**扩到生成物**：新增 `GENERATED =
['03-engine/opcode-table.md','03-engine/engine-capabilities.md','03-engine/opcode-gaps.md']` 的 `订正` 扫描
（并断言三份文件行数 > 40，防"扫描失效"）。⇒ 数据层**再漏回被渲染字段**会立刻打红。

**辨别力证明（注入 → 红 → 还原 → 绿，含 sha256 自检）**：

```
改前（本票动作之前）实测：opcode-table.md 49 / engine-capabilities.md 8 / opcode-gaps.md 1 行带「订正」
注入一行 <!-- 临时注入：★2026-09 订正（原记 X，实为 Y） --> 到 opcode-table.md
  → npx tsx --test test/doc-model.test.ts ⇒ pass 8 / fail 2，报 `03-engine/opcode-table.md:623 「订正」（数据层沿革漏进生成物）`
还原：node scripts/build-opcode-table.mjs
  → sha256 = 47DADA8B2DF5636D2DABA35172DE5C5288B3282CEC3B27A4D6BAC1507F9D1271（与注入前**逐字节一致**）
  → doc-model.test.ts ⇒ pass 10 / fail 0
```

其它相关守卫（同一批跑）：`opcode-gaps.test.ts`（含 `partial` 棘轮 + md §7）、`capability-ledger.test.ts`、
`script-ledger.test.ts`、`op-1d0-1d1-text-metrics.test.ts`（0x1D0/0x1D1 的四个钉住字串）、
`op-22a-22f-scene-xform.test.ts`、`op-327-32e-setweather-noop.test.ts`、`ticket-ledger.test.ts`、
`operand-plan.test.ts` ⇒ **49/49 绿**。

四份台账自检：`tickets --validate` ✅（172 张）、`capabilities --validate` ✅（141 条）、
`scripts --validate` ✅（35 条）、`build-opcode-gaps.mjs --check` ✅（缺口 143 条 / partial 64）。

## 6. 未做 / 留给主 agent

1. **★25 条票据 `evidence[].line` 行号提示漂移**（16 条指 `engine-capabilities.json`、4 条 `opcodes.json`、
   3 条 `opcode-gaps.json`、2 条 `functions.json`）：原因是本票给实体**追加了 `journal[]`**（每条 5~15 行），
   后续条目的行号整体下移。**anchor 字符串仍然存在** ⇒ `tickets.js --validate` 仍绿（全库 77 条 ⚠ 中的 25 条；
   其余 52 条指 `app/amayui-emulator/src/**`，来自别的 agent 的在改改动，与本票无关）。
   修法 = 由那些票的 owner 用 `--edit … --set-json 'evidence[…]'` 刷新 `line`（本票**不许**改别人的票）。
2. **`docs-new/04-app/*.md` 仍有 5 份带「订正」**（`emulator-copyright-effect` / `emulator-frame-loop-design` /
   `emulator-refactor-plan` / `emulator` / `live2d-support-assessment`）与 `00-overview/{lessons,status}.md`、
   `99-records/**`（历史区，A4 允许）。本票范围是**数据层**（判据 ② 只点了 `03-engine/*.md`），
   这 5 份 04-app 叙述文档是否要按 A4① 清，需 owner 决定（T-0105 当时只覆盖 `03-engine/*.md`）。
3. `engine-capabilities.json` 里 `entries[0].emulator.note` 等长 note 的**语句顺序**仍是"现状 + 沿革"混排的历史形态
   （沿革段已删/移，但句子边界不动）—— 若要把它们整段重写成"结论优先"的形态，属新的排版工作，不在本票判据内。
