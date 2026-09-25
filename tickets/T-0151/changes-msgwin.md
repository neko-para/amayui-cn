# T-0151 · `src/vm/**` 子集变更记录（owner：msgwin/vm 子集 agent）

> 本文件是**工作清单 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` §T-0151（第 5-83 行）
> 里锚点为 `src/vm/**` 的那 70+ 行**（P2 28 / P3 47，其中 6 行归 `src/text/**` 的 owner、1 行
> 锚在 `src/vm/handlers/text-items.ts`）的变更记录。
> 配套前提见 `.tmp/wave-b/T-0151-msgwin-brief.md`（主 agent 已核实）。
>
> 纪律：每条 = 对象/现象 → 引擎 raw 证据（**逐行自己读过函数体**，不引用报告结论）→ 改了什么 →
> 守卫名 → 命令与结果 → 未做项。末尾「台账待应用」节列出需要主 agent 应用到 `analysis/*.json`
> 的精确内容（我按纪律**没有**写 `analysis/**`）。
>
> 未触碰：`src/text/**`（T-0151 的另一半，已交回）、`src/renderer/**`、`src/arch/**`、
> `src/vm/handlers/gfx-texture.ts`、`src/vm/native.ts`、`src/vm/nativeTap.ts`、`src/tools/**`、
> `test/no-dead-writes.test.ts`、`src/frame/**`、`analysis/**`、
> `tickets/T-0151/{ticket.json,changes.md,changes-text.md,notes.md}`。

---

## 0. 处置一览（P2 28 条）

| # | 对象 | kind | 处置 | 落点 / 守卫 |
|---|---|---|---|---|
| 1 | `0x6e` | missing-consumer | **修**（门序 + `sub_48F000` 等价物）+ **登记**（分段表） | `handlers/msgwin.ts` `advanceReveal` / `pageHasPendingText`；`★0x6E 门序：…`（2 例）+ `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED` |
| 2 | `0x70` | missing-operand-io | **修**（三对格的语义层写明）+ 棘轮 | `★棘轮 0x70：w/h 同时写进几何与换行边界两组槽…` |
| 3 | `0x71` | missing-consumer（`sub_48FFB0`） | **登记**（队列/分段资源无对应物） | `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED[1]` |
| 4 | `0x72` | missing-consumer（3 槽交付） | **推翻**（等价物在宿主 `AudioEngine.tick`，另有本轮新增的"交付块门"） | `★0x72：跳读中…不进交付块…` |
| 5 | `0x73` | approximation | **推翻**（九格逐操作数**逐字同构**，加棘轮钉死） | `★棘轮 0x73：CharGrid 的九格与 sub_456430 的 v13[0..9] 一一对应…` |
| 6 | `0x82` | missing-branch（bit6） | **修**（DrawItem id 起点后移；订正审计的"起始记录下标"说法） | `★0x82：op3 bit6…` |
| 7 | `0x82` | missing-branch（bit4/5） | **修**（移除 `win+276/+280`） | `★0x82：op3 bit4/bit5…` |
| 8 | `0xfa` | approximation（`174802 = 0`） | **推翻**（`op_poll_msg_advance` 已照体清零，代码在盘上） | 见 §P3-8（既有实现 + 本轮条目 22 的棘轮覆盖清零点） |
| 9 | `0x196` | missing-operand-io（第 4 实参） | **修**（第 5 实参 = `Engine[97055]` 的**真实后果**：记账门）+ 登记（`+112` 专用路径） | `★0x6E/0x196 的第 5 实参…不许记已画行…` |
| 10 | `0x197` | missing-consumer（10 个窗对象） | **修**（10 格对象 + 4 格派生态） | `★0x197：新字号逐个写进 10 个窗对象…` / `★0x197：注音字号写 4 格派生态…` |
| 11 | `0x213` | missing-branch（空表项） | **修**（不发明对象、两个写都跳过） | `★0x212/0x213/0x25D：窗对象表项为空…` |
| 12 | `0x2bd` | missing-behavior（第二个字重格） | **修**（`Font+1248`） | `★0x2BD：真支同时写 Font+218516 与 Font+1248…` |
| 13 | `0x2fe` | missing-branch（面名警告） | **修**（警告串）+ 登记（表追加） | `★0x2FE：注音面名走同一道白名单警告…` |
| 14 | `0x305` | missing-consumer（出口两段） | **推翻**（两段都已在盘上；见 §P3-14 的逐段对照） | 既有 `op_text_block_end`；本轮未改语义 |
| 15 | `lazy-gdi-font-set` | missing-behavior | **已由 `src/text/**` owner 处置**（`changes-text.md` §1/§7-A.2） | —（不在我的范围） |
| 16 | `adv-flag-lifecycle` | missing-behavior（AutoMessage） | **推翻**（消费者在 `Engine.#serviceAutoMessage`，2026-09 已接） | 见 §P3-16 |
| 17 | `adv-text-reveal-progress` | stale-ledger | **修**（台账内容，交主 agent） | §台账待应用 A-1 |
| 18 | `adv-text-reveal-progress` | approximation | **修**（`sub_48F000` 换成本页显示态 + 显式登记） | `★0x6E 门序：门开时 97050 只保持…` |
| 19 | `msgwin-text-object` | missing-behavior（`0x7D`） | **登记**（`MSGWIN_TEXT_GAPS`）+ 守卫 | `★0x7D（十六进制串入队）…` |
| 20 | `msgwin-object-table` | stale-ledger | **修**（台账内容，交主 agent） | §台账待应用 A-2 |
| 21 | `msgwin-text-method-opcodes` | overreach | **修**（台账内容，交主 agent） | §台账待应用 A-3 |
| 22 | `msgwin-attr-font-opcodes` | approximation | **修一半**（"第二个格 / 派生态"落地）+ 登记（GDI 句柄重建） | 条目 1/10/12 的守卫 + §台账待应用 A-4 |
| 23 | `msgwin-config-gates` | stale-ledger | **修**（台账内容，交主 agent） | §台账待应用 A-5 |
| 24 | `text-font-rebuild-cascade` | stale-ledger | **已由 `src/text/**` owner 处置**（`changes-text.md` §3/§7-A.1） | — |
| 25 | `text-aa-config-gate` | overreach | **修**（台账内容，交主 agent） | §台账待应用 A-6 |
| 26 | `0x71` | missing-consumer（`122496`） | **推翻**（`op_message_show` 写 `m.alt = 0`；全库无第二处写非 0） | `★棘轮 0x71：三条出口都写 122496 = 0…` |
| 27 | `0x6e` | missing-consumer（`0x8000000` 无清零点） | **推翻**（三个清零点都在） | `★棘轮 0x6E：0x8000000 的三个清零点都在…` |
| 28 | `0x6e` | wrong-condition（门序） | **修**（`97050` 只属于门开那一支） | `★0x6E 门序：ReadTextSkip == 0 ⇒ 122455 = 0…` |

统计：**修好 13 / 登记 4 / 推翻 8 / 交他人 2 + 1**（第 28 项与第 1、18 项同一处修复）。
P3：**修好 7 / 登记 20 / 推翻 8 / 范围外 1**（逐条见 §3）。

---

## 1. P2 逐条

### 1. `0x6e` missing-consumer + `0x6e` wrong-condition（P2，工作清单第 11、81 行）

**现象（审计原文）**
> ① 引擎 `sub_48F000`（`sub_41EB20` raw 28350、`sub_41ED80` raw 28439）是「该窗的 `.8.8x` 条目表里第 a3 项」查询：非 0 ⇒ raw 28358 置 `0x8000000` 且 `122455 = 1`；返回 0 …
> ② emulator 把引擎那条『跳读位非 0 ⇒ 122455 保持 1』的分支接到了 **ReadTextSkip 门关闭** 的路上。

**引擎证据（自己读的体）**

```
sub_41EB20（0x6E）raw 28339-28359
 28339  if ( !GetConfig("message:ReadTextSkip") ) {      // ★门关闭
 28341      if ( !_this[122455] ) goto LABEL_11;         //   已清 ⇒ 不动
 28343      goto LABEL_10;                              //   已置 ⇒ 清
        }
 28345  v4 = sub_48E870(_this+80107, 帧槽95796, 95798, 95797);
 28350  if ( !sub_48F000(_this + 80107, _this[30*cur + 95796], v4) ) {
 28352      if ( _this[97050] ) goto LABEL_11;           //   ★"保持"只在这一支
 LABEL_10:   _this[122455] = 0;                          //   raw 28354-28355
        } else { _this[174801] |= 0x8000000u; _this[122455] = 1; }   // raw 28358-28359
sub_48F000 raw 109810-109825
 109816  sprintf_s(Buffer, 0xAu, ".%8.8x", a2);          // 句 id → 名字
 109816  v5 = sub_48EE60(_this + 258, Buffer);           // 队列对象里的分段表
 109817  if ( v5 && *(_DWORD *)(v5 + 4) > a3 ) return *(_DWORD *)(*(_DWORD *)(v5 + 8) + 4 * a3);
 109823  return 0;                                       // 未命中/越界 ⇒ 0
```

**改了什么（`src/vm/handlers/msgwin.ts`）**

- `advanceReveal(e, incoming?)` 重写为**与体同序的两支**：门关闭 ⇒ `showing = 0`（`97050`
  一个字都不参与）；门打开 ⇒ `pageHasPendingText()`（本页还有未显示的文本）⇒ `showing = 1`
  + 返回真；查不到 ⇒ `97050` 非 0 时**保持**、否则 `0`。
- 新增 `pageHasPendingText(e, win)`：`RevealState.active` 或（本页有字形且**还没被 `0x72` 武装**）。
  空页（`glyphCount === 0`）判"没有内容" ⇒ 与 `sub_48F000` 的返回值口径一致。
- 新增导出的缺口登记 `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED`（2 条，带 raw）：分段表与
  `sub_48FFB0` 的队列冲刷在 emulator 里没有对应物 —— **不是"忘了接"**。

**守卫**：`test/t0151-msgwin-vm.test.ts`
`★0x6E 门序：ReadTextSkip == 0 ⇒ 122455 = 0，**跳读/自动位（97050）不得把它翻成 1**（raw 28339-28343）`、
`★0x6E 门序：门开时 97050 只**保持**显示态（raw 28488-28490 的 !sub_48F000 支），不无中生有`。

**红→绿**：见 §2 第 1 组（`✖ ★0x6E 门序…` ×2 → `✔`）。

**未做项**：脚本分段表（`Engine+80107+258`）未装载 ⇒ 门开路径仍是**近似**（已登记 + `recheck`）。

---

### 2. `0x70` missing-operand-io（P2，第 14 行）

**现象**：引擎把 w/h 重复写进两组字段（`+20/+24` 与 `+36/+40`），emulator 只写 `g.w/h` +
`g.wrapRight/g.wrapBottom`，"同一窗对象上两格是两个不同字段"这一层没建。

**引擎证据（`sub_45D660` raw 73133-73193，工作清单只点了两对，体里其实有三对）**

| 格 | 值 | raw |
|---|---|---|
| `+12/+16` | `a5/a6`（x/y） | 73154-73155 |
| `+20/+24`（`v10[5]/[6]`） | `a3/a4`（w/h） | 73157-73158 |
| `+124/+128`（`v10[31]/[32]`） | `a3/a4`，随后被缩放尺寸覆写 | 73159-73160 |
| `+36/+40` | `a3/a4`（换行边界） | 73162-73163 |
| `+124/+128`（`DrawMode == 1`） | `(int)(sc* w + 0.5)` / `(int)(sc * h + 0.5)` | 73164-73171 |

**改了什么**：`op_window_geometry` 的注释按体补全**三对格**并写明分叉（`+36/+40` 只由 `0x1C1`
改；`+124/+128` 是缩放后的表面尺寸、emulator 无表面层 ⇒ 无消费者，登记在注释里）。
`MsgWindow` 的几何/换行两槽保持现状（它们**确实是**引擎的两组字段，逐格同源）。

**守卫**：`★棘轮 0x70：w/h 同时写进几何与换行边界两组槽（raw 73157-73163），0x1C1 只改后者`。

**未做项**：`+124/+128`（D3D 表面尺寸）不建模 —— 与 `0x70` 的 D3D/GDI 互斥支（`sub_4A7170` /
`sub_43C8D0`+`sub_43B070`，raw 73164-73179）同属"表面层"缺口，登记（§3 P3-3）。

---

### 3. `0x71` missing-consumer（`sub_48FFB0`，P2，第 16 行）

**引擎证据**：`sub_41ED80` raw 28431 `sub_48FFB0(_this + 80107)` → `sub_48FFB0` raw 110456-110482
把队列 `_this[279..281]` 逐条交给 `sub_48FBB0`（raw 110300-）建**分段表条目**（`".%8.8x"` 为名）。

**处置 = 登记**：emulator 没有"消息队列 + 分段表"这一层（同一资源族，见条目 1），
`0x71` 的这一步是 no-op —— 已写进 `ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED[1]`（含 raw）。

---

### 4. `0x72` missing-consumer（3 槽交付，P2，第 18 行）

**现象**：`if (!122496 && !(mask & 0x40))` 时对 3 个消息槽做交付循环 `sub_4BB840(...)`。

**引擎证据**：`sub_41EEF0` raw 28518-28537（循环体 raw 28523-28536，`*v5 = 0` 清槽）。

**处置 = 推翻"没有消费者"**：
- 交付的**状态**在 emulator 由宿主承载：`0xC4`/`0x1BD` → `voice-defer` → `AudioEngine.voiceDefer`
  的 `v.deferred`，`AudioEngine.tick(nowMs, advActive)` 在 ADV 位清除时统一冲刷
  （`audioEngine.ts:641-651`；`op_poll_msg_advance` 的注释已写明 raw 246/24966 的冲刷点）。
- **本轮新增**：那一段的**门**（`!122496 && !(mask & 0x40)`）此前只用了后半 —— `alt` 恒 0 那一半
  自然成立，但 `mask & 0x40`（= `Engine[1415]`，raw 28487-28488）那一半**没有**：修前
  `clearAdv` 在块外无条件执行 ⇒ 跳读中反而清了 ADV 并挂上等待门（与"跳读要连播"相反）。
  现在 `0x72` 的尾段按体重排（`handlers/msgwin.ts` 的 `op_wait_for_input` 尾段）。

**守卫**：`★0x72：跳读中（Engine[1415] != 0）不进交付块 ⇒ 不清 ADV、不挂等待门（raw 28518 / 28539-28547）`。

**未做项**：`sub_4BB840` 本身（宿主侧播放队列）不在 VM 半边 ⇒ 不接。

---

### 5. `0x73` approximation（P2，第 21 行）—— **推翻**

**引擎证据（`sub_456430` raw 68282-68306）**：`v13[10] = {op4, op5, op6, op7+op5, op8+op6, op2, op3, 1, op9, op9}`
（raw 68292-68303）整块 `qmemcpy(obj+60, v13, 0x28)`（raw 68304）。窗号解析 `if (!a2) v10 = _this[307]`
（raw 68290-68291）。

⇒ emulator 的 `CharGrid`（`textX←op2`/`textY←op3`/`srcSurface←op4`/`originX←op5`/`originY←op6`/
`cellW←op7`/`cellH←op8`/`cells←op9`/`gate←1`）**逐格同构、无分叉**（`0x73` handler raw 28618-28630
的 10 次读也逐位对上）。处置 = 加**棘轮守卫**把九格钉死（审计说的"近似"不成立）。

**守卫**：`★棘轮 0x73：CharGrid 的九格与 sub_456430 的 v13[0..9] 一一对应（raw 68292-68304）`。

---

### 6./7. `0x82` 的两个 missing-branch（P2，第 25、26 行）

**引擎证据（`sub_466000` raw 79319-80311）**

```
79502  if ( v8 > a3 && a3 >= 0 ) {                     // 越界门（已在盘上）
79504      if ( *(_DWORD *)(Font[a2+261] + 112) == 1 ) { sub_462040(...); return; }   // 专用路径（未建模）
79629      v39 = Engine[667856];                       // set:DrawMode
79632      if ( v39 == 1 ) {
79634          if ( (a4 & 0x40) == 0 ) { 清旧表面 + sub_4ABB60(win+104, win+108) }
79649          if ( (a4 & 0x30) != 0 ) sub_4ABB60(win+276, win+280);
            }
79684  v44 = Font[v175 + 261];
79685  v45 = *(_DWORD *)(v44 + 104);
79686  v155 = v45;
79687  if ( (a4 & 0x40) != 0 ) v155 = *(_DWORD *)(v44 + 132) + v45;   // ★bit6 = DrawItem id 起点
```

★**订正审计的一处措辞**：`v155` **不是**"起始记录下标"（`a3` 全程不动），而是**本次绘制项的
DrawItem id 起点**（`win+104` 是层序基址、`+132` 是行游标）。

**改了什么（`op_gdi_repaint_window`）**
- 对象表门（`objectAt`，不发明对象）；
- `op3 & 0x30` ⇒ 清 `+276/+280`；
- `op3 & 0x40` ⇒ 本次发布的 `style.itemId = f104 + f132`（新增 `emitWin(e, win, itemId?)` /
  `styleOfWin(e, win, itemId?)` 可选实参，默认路径逐字不变）；`op3 & 0x40 == 0` ⇒ `f104/f108` 归零后
  `itemId = f104`（= 0）。
- `op_recall_page_repaint`（`0x1D1`）的同一段（raw 80656-80662）也接上 itemId 后移。

**守卫**：`★0x82：op3 bit6（0x40）把 DrawItem id 起点后移 win+132（raw 79684-79688）`、
`★0x82：op3 bit4/bit5（0x30）另移除 win+276/+280（raw 79649-79653）`。

**未做项**：`op3` 的 bit0/bit2/bit3（记录级过滤，raw 79699 / 80773）与窗对象 `+112 == 1` 的
专用路径（raw 79504-79508）**未建模**（重写侧无记录级/专用体粒度）—— 已写进 `op_gdi_repaint_window`
的"登记的近似"④⑤。

---

### 8. `0xfa` approximation（P2，第 29 行）—— **推翻**

**引擎证据**：`sub_4199B0` raw 24983-24985：`sub_478090(_this+258, &mask)` 之后
`_this[174802] = 0`。

**盘上事实**：`op_poll_msg_advance`（`handlers/msgwin.ts`）末尾已有 `e.input.inputMask = 0;`
（注释逐字写着 raw 24985 与 `T-0151` 的审计号 `op-130`）。⇒ "没有清零点"不成立；本轮把它
纳入条目 27 的棘轮叙述（三个清零点一起）。

---

### 9. `0x196` missing-operand-io（P2，第 30 行）

**前提（主 agent 已核实，我复核）**：`sub_41FC20` raw 29032 起 arity 槽写 7 ⇒ **argc 3**；
第 4 个实参 = `*(_DWORD *)(_this + 388220)`（= `Engine[97055]`）不是操作数（raw 29078/29085/29091）。
`operandPlan.ts:1184` 的 `0x196` 计划已是 `argc 3`（`['int','str','str']`）⇒ **操作数面已正确**。

**真正的后果**（审计没说完的那一半）：那个实参是 `sub_46BE30` 的 `a5`，体里在**写记录**那一步查它：

```
sub_46BE30 raw 83941-83942
  if ( a5 >= 0 ) sub_4691A0((int *)_this, v5, a5, &v100, *(_DWORD *)(_this + 201684), Source);
```

⇒ `i1bb 0`（`Engine[97055] = 0x80000000`）期间 **不记已画行**（但照排版/照画）。

**改了什么**：新增 `recordGateOpen(e)`（`(v | 0) >= 0`，`0x80000000` 是 32 位有符号负数）
并接到 `recordRenderedRow`（`0x6E`/`0x196`）与 `0x6F` 的 `pushLineFeed`
（`sub_4691D0` raw **81549** 的 `if ( a3 >= 0 )`，`a3` 由 `sub_41ECE0` raw 28395 传入）。

**守卫**：`★0x6E/0x196 的第 5 实参 = Engine[97055]：i1bb 0 期间**不记已画行**（raw 83941-83942 的 if (a5 >= 0)）`、
`★0x6F 的换行记录同样受记账门（raw 81549 的 if (a3 >= 0)，a3 = Engine[97055]）`。

**未做项**：`sub_46BE30` 开头的 `if (obj+112 == 1) return sub_46B100(...)`（raw 83509-83514）—— 同一个
`+112` 专用路径族，登记（§3 P3-6）。

---

### 10. `0x197` missing-consumer（10 个字体对象，P2，第 32 行）

**引擎证据（`sub_418680` raw 24084-24154）**

```
24108  _this[54646] = a2;                     // Font+218584 = 注音字号（Engine[75970]）
24109  _this[324] = a2 / -2;                  // Font+1296  ← 整数**向零截断**
24110  _this[25509] = a2 / -2;                // Font+102036（竖排模板同格）
24111  _this[323] = -a2;                      // Font+1292
24112  _this[25508] = -a2;                    // Font+102032
24113  v2 = _this[327];                       // Font+1308 = 注音 LOGFONTA 的 lfWeight
24114-24152  逐个 Font[261]..[270]：*(obj+200) = a2; *(obj+204) = Font[327];
24153  sub_45A6E0(_this);                     // 注音字体重建（无句柄层 ⇒ 缺口）
```

⇒ 10 格 = **窗对象表 0..9**（`Font[261]` 就是 `FontVWindow` win 0，与 `MsgWindow.objects` 同表；
`_this[op1 + 21585]` 里 `21585 - 21324 = 261`）。

**改了什么**
- `MsgWindow` 构造期建好 **10 格**对象表（`WINDOW_OBJECT_SLOTS`）—— 体里 24114-24152 与
  `sub_456430` raw 68298 **都不查空**地解引用 ⇒ 这 10 格恒存在；`objectAt()`（只取不建）与
  `object()`（建）分开。`MsgObject` 新增 `f200`/`f204`。
- `op_set_ruby_size` 写 4 格派生态 + `applyWindowFontSize`。

**守卫**：`★0x197：注音字号写 4 格派生态（raw 24109-24112）—— 且是**整数向零截断**`、
`★0x197：新字号逐个写进 10 个窗对象（Font[261..270]）的 +200/+204（raw 24113-24152）`。

**未做项**：`sub_45A6E0`（注音 GDI 句柄重建）无对应物 —— 归 `src/text/**` 的 `lazy-gdi-font-set`
（已在 `changes-text.md` 登记）。

---

### 11. `0x213` missing-branch（P2，第 46 行）

**引擎证据**：`sub_423A80` raw 31769-31774 `v5 = _this[result + 21585]; if (v5) { +104 = v3; +108 = v2; }`
（同形：`0x212` raw 31751-31753、`0x25D` raw 33259-33264）。

**改了什么**：三条 handler 改用 `objectAt(idx)`；空表项 ⇒ 两个写都跳过、**不建对象**。
表外下标（引擎读表外内存 = 未定义）选择"不发明对象 + 跳过"，注释写明这个判据。

**守卫**：`★0x212/0x213/0x25D：窗对象表项为空 ⇒ 两个写都跳过…`（表外下标 12 不建、表内 3 正常写、
10 格都在、第 10 格不在）。

---

### 12. `0x2bd` missing-behavior（第二个字重格，P2，第 50 行）

**引擎证据**：`sub_426200` raw 33393-33399：真支 `Font+218516 = 700; Font+1248 = 700;`，假支同写 `0`；
然后 `sub_459F40`。`Font+1248` = `Font+1232 + 16` = 主 LOGFONTA 模板的 `lfWeight`（Engine 下标 **21636**）。

**改了什么**：新增 `ENGINE_FIELD.logfontMainWeight = 21636`；`op_set_main_bold` 两个格同写。

**守卫**：`★0x2BD：真支同时写 Font+218516 与 Font+1248（raw 33393-33399）⇒ 第二个格 = Engine[21636]`。

**未做项**：`sub_459F40`（句柄重建）—— 归 `src/text/**` 的 `lazy-gdi-font-set`。

---

### 13. `0x2fe` missing-branch（面名警告，P2，第 55 行）

**引擎证据**：`sub_432DD0` raw 41613-41620 与 `sub_4328F0` raw 41385-41392 **逐字相同**：

```c
if ( sub_428990((_DWORD *)_this, Source) < 0 && strcmp(Source, aAgeExtend) )
  sprintf_s(Font + 8, 0x400u, "警告：[%s]は選択可能フォントの一覧に含まれていません。\r\n", Source);
  sub_4034D0(Font, Font + 8);
```

`sub_428990`（raw 35125-35168）= 在可选字体表 `Font+201664`（32 B/条）里线性查名（**查前剥 `'@'`**，
raw 35149），空表/查不到返回 **-1**；`"AGE Extend"`（raw 4455）豁免。

**改了什么**：新增 `warnUnknownFace(c, op, face)`（表内 ⇒ 不警告；`AGE_EXTEND_FACES` ⇒ 豁免；
否则 `c.log(...)`，串体与引擎同文），接到 `0x1A5` 与 `0x2FE`；警告之后**照旧写面名**（体里没有 return）。

**守卫**：`★0x1A5：不在可选字体表且非 "AGE Extend" ⇒ 打警告串（raw 41385-41392）；表内面名与 AGE Extend 不打`、
`★0x2FE：注音面名走同一道白名单警告（raw 41613-41620）+ 写 4 格注音派生态（raw 41622-41627）`。

**未做项**：`Font+101832` / `Font+200492` 两张"用过的面名"去重追加表（raw 41405-41566 / 41633-41798）
未建模（无消费者）⇒ §3 P3-13 登记。

---

### 14. `0x305` missing-consumer（P2，第 59 行）—— **推翻**

**引擎证据（`sub_41B1C0` raw 26034-26102）**

```
26055  v5 = sub_48E870(_this + 320428, …);
26060  if ( sub_48F000((_DWORD *)(_this + 320428), …) ) { 174801 |= 0x8000000; 122455 = 1; }
26074  if ( Engine[86672] /*MessageSpeed*/ ) {
26076      if ( !(effect_flags & 0x8000000) ) { effect_flags |= 0x20000000; 起节拍; Engine[122497] = 0; return; }
        }
26087  while ( !sub_45BE20(Font, Engine[122371]) ) ;
26090  if ( Engine[667856] == 1 && (Engine[369360] & 2) == 0 ) { 369352 = 0; 369356 = 0; 369344 = 1; }
26099  Engine[122497] = 0;
```

**盘上事实**：`op_text_block_end` 逐段都在（`SLEEP_GATE` + `sleepUntil` = `0x20000000` + `sub_453A60`；
`gateWaitStart`/`gateWaitMs` = `369352/369356`；`369344` 只写不读、按既有口径不建模；
`m.flags = 0` 三条出口都清）⇒ "出口侧两段没建模"不成立。

---

### 15. `lazy-gdi-font-set`（P2）—— **已由 `src/text/**` owner 处置**

见 `tickets/T-0151/changes-text.md` §1 + §7-A.2（`GDI_FACE_REBUILD` 10+4 支、`metricFaceSlot`、
位图缓冲算术、缩放修正、`GDI_FACE_REBUILD_NOT_MODELED` 6 条）。本文件不重复。

---

### 16. `adv-flag-lifecycle` missing-behavior（P2，第 64 行）—— **推翻**

**现象（审计）**：`0x72` 尾段的 AutoMessage 自动放行分支在 emulator 里没有等价物。

**引擎证据 + 盘上事实**：`sub_41EEF0` raw 28556-28586 的共存消息块（`97052 != 0` ⇒ 按
`message:AutoMessage*` 算时长、下限 100、`sub_453A60(Engine+107545, …)`）——
emulator 侧**两半都在**：
- arm：`armCoexistAutoMessage`（`handlers/msgwin.ts`，raw 28556-28586 逐句对照）；
- 到期消费：`Engine.#serviceAutoMessage`（`vm/engine.ts`，raw 20376-20460；`#autoMessageExpired` =
  `sub_453AF0` raw 66149-66186、`#armAutoMessage` = `sub_453A60`）。
⇒ "没有等价物"不成立。

**未做项**：`Engine[122501]`（语音忙）恒 0 ⇒ 两支里只走 Pitch1 那支（`engine.ts` 已登记）。

---

### 17./18. `adv-text-reveal-progress`（P2 stale-ledger + approximation）

- **stale-ledger**：note 说"仍未建模引擎真正的逐字/逐行推进泵" —— 实现早在
  `src/vm/msgwin.ts` 的 `tickRevealWin` / `Engine.serviceTextReveal`（泵 + `#publishReveal`），
  守卫 `test/adv-reveal-under-throttle.test.ts`。⇒ 台账 note 待改（§台账待应用 A-1）。
- **approximation**：✅ **本轮修**（条目 1，`sub_48F000` 的等价物 + 显式缺口登记）。

---

### 19. `msgwin-text-object` missing-behavior（`0x7D`，P2，第 67 行）

**引擎证据**：`sub_41F580` raw 28736-28765 与 `0x6E`（`sub_41EB20`）**逐句同形** ——
`argc 2`（op1 = 窗、op2 = 串，读串用 `sub_41A780(_this, 2)`）、门 = `!MessageSpeed || ADV`
⇒ `sub_46CBF0`；否则 `sub_46BE30` + `0x20000000` + `sub_453A60(Engine+430572, MessageSpeed)`。

**语料**：`^\s*i07d\b` 在 941 个脚本里 **0 处**（`Select-String` 实测）。

**处置 = 登记 + 保持硬报错**：新增导出 `MSGWIN_TEXT_GAPS`（1 条：`opcode 0x7d` / `handler
sub_41F580` / `raw 28736-28765` / `what`），**不进** `MSGWIN_OPS`（未实现就不许谎报）。

**守卫**：`★0x7D（十六进制串入队）：未实现 ⇒ 必须在缺口表里诚实登记，且**不在**派发表里（不许静默）`。

**未做项（范围外）**：`analysis/opcode-gaps.json` 的 `0x7d` 条目 —— 我无写权限，内容见 §台账待应用 B-1。

---

### 20. `msgwin-object-table` stale-ledger（P2，第 69 行）

note 说"仍未建模：`sub_404F80` 的布局重算（移除图元区间）" —— 实际 `0x301` 的 handler 已逐步
照抄 `sub_404F80`（清 `+122486`、清对象 `+132`、`msgWinClear` 删绘制项、闸门开着时重新武装），
本轮又补上**默认窗重定向**与**对象表门**（条目 26 附近）。⇒ 台账 note 待改（A-2）。

---

### 21. `msgwin-text-method-opcodes` overreach（P2，第 71 行）

"把 `0x1BB` 算作转发到文本布局子系统的纯转发器"为假：`0x1BB`（`sub_420000` raw 29223-29242）是
**SetTB 记账门**（`Engine[97055] = op1 ? (op1==1 ? 0 : 报错串) : 0x80000000`），体里没有任何转发；
`0x1C9`（音频设备初始化）/`0x324`（Effect3D 销毁）同属误列。⇒ 台账名单待改（A-3）。

---

### 22. `msgwin-attr-font-opcodes` approximation（P2，第 72 行）

"引擎每次写颜色/档位/字号后立即 `sub_459F40` 重建 GDI 句柄与度量" —— 体证成立（`0x75` raw 24081 /
`0x197` raw 24153 / `0x2BD` raw 33401 / `0x2BE` raw 33421 / `0x1A5` raw 41403 / `0x2FE` raw 41631）。
重写侧没有句柄层 ⇒ 那一半**不复制**（归 `src/text/**` 的 `lazy-gdi-font-set` 缺口登记）。
**本轮可做的那一半已做**：字号/字重的**第二个格与派生态**（条目 10/12、`0x75` 的 5 格）。
⇒ 台账 note 待改（A-4）。

---

### 23. `msgwin-config-gates` stale-ledger（P2，第 73 行）

note (b) 写"`message:MesWinAlpha=8` ⇒ 每段文本 8ms 节流（已实现）"：引擎那段节流读的是
`Engine[21668]` = `message:MessageSpeed`（raw 28361/28380-28382 的 `_this[21668]`），
`MesWinAlpha` 从不进字段。emulator 的 `messageSpeedOf()` 已唯一化。⇒ 台账 note 待改（A-5）。

---

### 24. `text-font-rebuild-cascade` stale-ledger（P2，第 75 行）—— **已由 `src/text/**` owner 处置**

见 `changes-text.md` §3 + §7-A.1（两个错锚点实测确指错 + 真 guard = `test/config1-chain.test.ts#排版结果进入渲染模型`）。

---

### 25. `text-aa-config-gate` overreach（P2，第 77 行）

"字段 21662 全库唯一出现点就是它的定义"为假（定义在 `src/vm/engineFieldIds.ts` 的 `aaEnabled`，
写入点 `src/engineConfig.ts`）。准确说法是「产品路径无读者」：`globalTextStyle` 固定返回
`antiAlias: true`（`TEXT_FILL_ALPHA` 的像素判据）。⇒ 台账 note 待改（A-6）。

---

### 26. `0x71` missing-consumer（`122496`，P2，第 79 行）—— **推翻**

**引擎证据（全库 grep）**：`122496` **只被写 0**（raw 28444/28449/28457，全在 `0x71` 的三条出口），
被读两处（raw 20144 显示态泵、raw 28518 `0x72` 交付块门）。**没有任何一处写非 0** ⇒ 它在本 build 里
恒 0（死零格）。

**盘上事实**：`op_message_show` 开头 `m.alt = 0;`（`handlers/msgwin.ts`，注释引的正是 raw
28444/28449/28457）⇒ 三条出口一条不落（handler 是顺序执行、赋值在三条出口之前）。

**守卫**：`★棘轮 0x71：三条出口都写 122496 = 0（raw 28444/28449/28457）⇒ msgwin.alt 恒 0`
（人为把 `alt` 置 5 ⇒ 跑 `0x71` 后必须回 0）。

**未做项**：无（该格没有可观察的非零态）。

---

### 27. `0x6e` missing-consumer（`0x8000000` 的清零点，P2，第 80 行）—— **推翻**

**引擎证据**：清 `0x8000000` 的三处 = `0x72` raw 28520、`0xFA` raw 24966（`_this[174801] &= ~0x8000000`）、
显示态泵 `sub_411900` raw 20144（`!122455 && !122496 && !(mask & 0x40)`）。

**盘上事实**：三处都有对应物 —— `op_wait_for_input`（raw 28520）、`op_poll_msg_advance`（raw 24966）、
`Engine.serviceAdv`（raw 20144 的判据逐字写在 `engine.ts` 的注释里）。

**守卫**：`★棘轮 0x6E：0x8000000 的三个清零点都在…`（三条路径各断言一次）。

---

### 28. `0x6e` wrong-condition（P2，第 81 行）—— **修**（同条目 1）

---

## 2. 红 → 绿证据

新增守卫文件：`app/amayui-emulator/test/t0151-msgwin-vm.test.ts`（22 例）。
**先写守卫、跑出红**，再改实现、跑绿（下同）：

```
# 红（实现前；单位 = 15 红 4 绿，另有 1 次"模块没有该导出"的硬红，即 MSGWIN_TEXT_GAPS 尚不存在）
$ cd app/amayui-emulator && node --import tsx --test test/t0151-msgwin-vm.test.ts
SyntaxError: The requested module '../src/vm/handlers/msgwin.js' does not provide an export named 'MSGWIN_TEXT_GAPS'
✖ test\t0151-msgwin-vm.test.ts   ℹ tests 1  ℹ pass 0  ℹ fail 1
# 补上纯新增的登记常量后再跑（15 红）：
✖ ★0x212/0x213/0x25D：窗对象表项为空…              ✖ ★0x2BD：真支同时写…Font+1248
✖ ★0x2BE：真支同时写…Font+1308                      ✖ ★0x75：字号同步写进 5 格…
✖ ★0x197：注音字号写 4 格派生态…                    ✖ ★0x197：新字号逐个写进 10 个窗对象…
✖ ★0x1A5：…打警告串…                               ✖ ★0x2FE：…白名单警告 + 4 格…
✖ ★0x303：op2 原样写进 win+288…                     ✖ ★0x301：op1 == 0 ⇒ 重定向…
✖ ★0x6E 门序：ReadTextSkip == 0 ⇒ 122455 = 0…       ✖ ★0x6E 门序：门开时 97050 只保持…
✖ ★0x82：op3 bit6…                                  ✖ ★0x82：op3 bit4/bit5…
✖ ★棘轮 0x6E：0x8000000 的三个清零点都在…
ℹ tests 19  ℹ pass 4  ℹ fail 15        ← ★改前即绿那 4 条是纯棘轮（0x7D 登记 / 0x73 九格 / 0x71 122496 / 0x70 两组槽）

# 绿（全部实现 + 追加 3 个单元之后）
$ node --import tsx --test test/t0151-msgwin-vm.test.ts
ℹ tests 22  ℹ pass 22  ℹ fail 0
```

第二组红→绿（`0x72` 交付块门 + 记账门，追加的 3 个单元）：

```
# 红（记账门未接时；测试直接置 Engine[97055] = 0x80000000）
✖ ★0x6E/0x196 的第 5 实参 = Engine[97055]：i1bb 0 期间不记已画行…  actual: 2, expected: 0
✖ ★0x6F 的换行记录同样受记账门…                                 actual: 2, expected: 0
ℹ tests 22  ℹ pass 20  ℹ fail 2
# 绿（接上 recordGateOpen 之后）
ℹ tests 22  ℹ pass 22  ℹ fail 0
```

**既有断言的 retarget（4 处，全部因"前提被取代"）**

| 文件:用例 | 旧前提 | 体证据 | 新断言（保留全部锚点串） |
|---|---|---|---|
| `test/adv-msgwin.test.ts` `0x71 在跳读/自动模式（97050≠0）下保留显示态并置 ADV` | 门关 + `97050≠0` ⇒ 置 ADV | raw 28456-28460（门关支里没有 `97050`） | 门关 ⇒ **不置**；另加"门开 + `97050≠0` + 无内容 ⇒ **保持**"（raw 28450-28453） |
| `test/adv-msgwin.test.ts` `ADV 每帧服务：未显示完判定成立时清掉 ADV…` | 靠上一条架出 ADV | 同上 | 改用**真实置位路径**（`0x1CA 1` ⇒ `0x71`），其余断言一字不动 |
| `test/adv-string.test.ts` `advActive(0x8000000)：…` | 第 101-103 行"自动模式下 0x071 置 ADV（引擎 LABEL_10）" | 同上（且 LABEL_10 是**清**不是"保持"） | 同位置断"门关 ⇒ 不置"；`0x19C` 那一半（它自己的门就是 `97050`）不动 |
| `test/op-10-002-adv-sleep-order.test.ts` `op-10-002：ADV 位已置时 0x6E **不装** MessageSpeed 门…` | 只置 `skipMode` 就指望 `0x6E` 置 ADV | 同上 | 加 `readTextSkip = 1`（走真实置位路径）；"不装门"的断言一字不动 |

四处都**没有**删除或放宽任何断言，且把真值钉得**更强**（新断言还多钉了"门开时的保持支"）。
（`op-10-002` 与 `adv-string` 两个文件在票据/台账里**没有** evidence 锚点 —— 已用
`tickets.js --anchors-in` 核实：`adv-msgwin.test.ts` 只有 T-0027 锚在 `★等待推进门只吃「挂起事件」`，
该用例未被触碰。）

第二组 retarget（**与 `T-0170`/`T-0102` 的断言冲突，本轮裁决**）—— `i1bb` 记账门让"CONFIG 链路上会
记正文记录"这个前提失效：

| 文件:行 | 旧前提 | 体证据 | 新断言 |
|---|---|---|---|
| `test/config1-chain-advreturn-real.test.ts:57-62` | `recordsAtI082 === 6`（3 种子 + 3 行正文） | `CONFIG.txt:41 i1bb 0` … `:355 i1bb 1`，ADV 样例正文在 `:177-179`（夹在中间）；引擎**每一处**记录 push 都查 `Engine[97055]`：`sub_46BE30` raw 83941-83942、`sub_4691D0` raw 81549、`sub_46B100` raw 82726、`sub_461A10` raw 76380-76381（`v61 = a4 & 0x80000000`）、raw 83026 / 83307 / 83634；`0x6E`/`0x196` 把 `_this[97055]` 当第 5 实参传下去（raw 28364/28375、29088/29104） | `>= 3`（保留）+ **`=== 3`**（只有种子） |
| `test/config1-chain-advreturn-seed.test.ts:45-50` | `=== 6`（同上） | 同上 | `>= 3`（保留）+ **`=== 3`** |
| `test/config1-chain-advreturn-seed.test.ts:73-82`（`g0=6` 组，无种子） | `recordsAtI082 === 3` / `republishByI082 === 1` | 同上（`i082` 的越界门 raw 79502 是 `v8 > op2`） | **`=== 0`** / **`=== 0`**（表空 ⇒ 引擎也不重画）；`opsSyncedAfterI076` 的反向断言保留 |
| `test/config1-chain-advreturn-seed.test.ts:97-106`（`g0=1` 组，重入队） | `=== 3` / `=== 1` | `:437` 的 `show-text` 同样在 `i1bb 0` 区间内 | **`=== 0`** / **`=== 0`** |

**裁决依据（可复现）**：临时判据实验 `.tmp/t0151-msgwin/probe-i1bb3.mts`（`runConfig1Chain({
previewProbe: true, advReturnProbe: { g0: 6, g1397: 1, msg: -1, seedRecords: 0 } })`）：
`recordsAtI082 === 0`、`republishByI082 === 0`，而同一探针的 `sampleWin` 明确显示样例窗**已排好**
（`win 9`、`lines[0] = "天俟神俣ＳＡＭＰＬＥ"`、`glyphs 10`、`ruby 2`）⇒ 抑制来自那道门、
不是"文本没入队"。**正面判据**（证明不是"实现没做"）：`test/op-0104-gdi-repaint.test.ts` 用合成
指令写满记录表后 `0x82` 必重画一次（27/27 绿）；`test/t0151-msgwin-vm.test.ts` 的
`★0x6E/0x196 的第 5 实参 = Engine[97055]：i1bb 0 期间**不记已画行**` 是这道门的红→绿守卫。
★`T-0102` 的**结论不受影响**：真实路径是「ADV（`i1bb` 正常）→ CONFIG」，那些行在 ADV 阶段就已记下
⇒ 表非空 ⇒ `i082` 照样重画（`test/config1-chain-advreturn.test.ts` 的条件分支正是这么写的，
本轮**未改**它，跑绿）。

第三组 retarget（**收尾复查的红**：`test/op-10-002-adv-sleep-order.test.ts` 的 `['adv','sleep']` vs 期望 `['adv','adv']`）
—— 裁决 = **①"断言/测试的预期错了"**（不是 `src` 行为错；也不是我先前那处改动引起的）：

| 项 | 内容 |
|---|---|
| 红 | `node --import tsx --test test/op-10-002-adv-sleep-order.test.ts` → `✖ op-10-002：ADV 位与 SLEEP_GATE 同时置位…` `actual ['adv','sleep'] expected ['adv','adv']`（at `:99`） |
| 根因 | 该用例拿 **`0x101`（poll-input）** 当"每帧恰好 1 条"的载荷，而 `0x101` 的体**自己清 ADV 位**：`sub_419CC0` raw **25077** `_this[174801] &= ~0x8000000u;`。这一行此前**未实现**（旧注释：审计 P2 `0x101` 三条引擎写全缺）⇒ 旧期望才成立；`T-0158` 的 owner 按体补上后，第 1 帧派发 `0x101` 就把 ADV 清掉，第 2 轮不再进 ADV 循环（raw 21158）而落到 raw 21176 的 `0x20000000` 支 ⇒ `['adv','sleep']` 正是**引擎的行为** |
| 与我先前改动的关系 | 无：我对该文件的改动只在**第一个用例**（`0x6E` 那条加 `readTextSkip = 1`）。`git diff` 里本文件只有那 4 行 `+`；`src/vm/engine.ts`/`src/frame/loop.ts` 本轮 **0 diff**；`src/vm/input.ts`（`op_poll_input` 所在）是**他人**在改（`git diff --stat` = 22+/8-） |
| 体证据（次序主张本身） | `sub_411900`（ADV 循环，raw 20161-20165 每轮恰好 1 条）在 `sub_409400` 的 **raw 21158** `if ((v35 & 0x8000000) == 0) break;` 之下；只有 ADV 位清掉才 break 到 **raw 21176** `if ((v35 & 0x20000000) != 0) { sub_409400(_this); … }`。`src/frame/loop.ts` 的对应两段：`:399` 的 `else if (opt.advFrame === true && e.advActive)`（= raw 21158 的 ADV 分支）与 `:417` 的 `else if (gates.sleep !== 'ignore' && (e.waitFlags & SLEEP_GATE) !== 0)`（= raw 21176 的 sleep 泵），且前者在链上**先于**后者 |
| retarget（最小、保留全部锚点串、钉得更强） | 拆两个子例：① **次序证明**用惰性载荷 `0x1a7`（= `CONTROL_OPS` 的 `op_comment`，体 `() => undefined`）⇒ `['adv','adv']` + `r.steps === 2`（**原断言原样保留**）；② 同一场景 + `0x101` ⇒ 钉 `['adv','sleep']` + `advActive === false`（raw 25077）+ `steps === 1`。★旧断言只有 ①，无法区分"次序对"与"载荷没副作用"；新形态两条都钉 |
| 红→绿（可复现） | 临时探针 `.tmp/t0151-msgwin/probe-op10002.mts`：`0x101 → {"gates":["adv","sleep"],"steps":1,"advActive":false}`（= 旧断言必红）、`0x1a7 → {"gates":["adv","adv"],"steps":2,"advActive":true}`（= 次序主张成立）。retarget 后 `node --import tsx --test test/op-10-002-adv-sleep-order.test.ts` → **5/5 绿**；`test/harness-convergence.test.ts` 3/3 绿（新加的是测试内的局部 `runPair`，不触棘轮）；`tsc -p tsconfig.json/tsconfig.test.json` 均 exit 0 |
| 未做项 | 无（`src/frame/loop.ts` 的次序一字未动 —— 它本来就是对的） |

---

## 3. P3 逐条处置

| 工作清单行 | 对象 | kind | 处置 | 证据（raw） | 落点 / 守卫 |
|---|---|---|---|---|---|
| 12 | `0x6f` | missing-behavior（笔位推进） | **登记** | `sub_46AF90` raw 82665-82687（`if (obj+112 == 1) sub_4691D0` 否则 `*(buf-20) = obj[28]`、`*(buf-16) += 行距`、`++*(buf-4)`、`++obj[284]`） | 笔位/缓冲头是排版层状态，重写侧由 `layoutWindow` 每次重算 ⇒ 无对应物（`op_end_text_line` 注释已写明） |
| 13 | `0x6f` | missing-consumer（记账门） | **修** | `sub_4691D0` raw 81549 `if (a3 >= 0)`（a3 = `Engine[97055]`） | `★0x6F 的换行记录同样受记账门…` |
| 15 | `0x70` | missing-consumer（D3D/GDI 互斥） | **登记** | `sub_45D660` raw 73164-73179（`sub_4A7170` / `sub_43C8D0`+`sub_43B070`） | 重写侧无表面层；`op_window_geometry` 注释 |
| 17 | `0x71` | missing-behavior（三条出口 + 跳读支） | **已实现**（棘轮） | raw 28442-28460 | `★棘轮 0x71…` + 条目 1 的 `advanceReveal` |
| 19 | `0x72` | missing-behavior（共存消息支） | **已实现**（见条目 16）+ **本轮补交付块门** | raw 28518 / 28556-28586 | `★0x72：跳读中…` / `armCoexistAutoMessage` |
| 20 | `0x72` | missing-branch（早退判据 = `122455`） | **修** | raw 28540（`(174801 & 0x8000000) == 0` 才是等待门的门） | 条目 4 的尾段重排 + `★棘轮 0x6E…` |
| 22 | `0x73` | missing-consumer（`!Engine[166964]` 建绘制容器） | **登记** | raw 28631-28637（vtable(33, `2*op7`, `op8`, 2)） | D3D 绘制容器无对应物；`op_set_char_grid` 注释 |
| 23 | `0x75` | approximation（三到五格） | **修** | raw 24062-24070 | `★0x75：字号同步写进 5 格…` |
| 24 | `0x7a` | approximation（`buf[-20]` 活游标） | **登记** | `sub_46AF90` raw 82684-82685（排版例程每写新记录复位成 `obj[28]`） | emulator 的 `pre48a/b` 是"覆盖值"、不随排版复位 ⇒ 登记在 `op_msgwin_obj_pre48` 注释（无消费者分叉，语料 520 处全是"每页覆盖一次"） |
| 27 | `0x82` | missing-branch（记录级过滤） | **登记** | raw 79699（`(flags & 2) != 0 && (op3 & 1) == 0` ⇒ `goto LABEL_188`）、raw 80773（`op3 & 4` 抑制该行） | 重写侧无记录级粒度；已写进 `op_gdi_repaint_window` 的"登记的近似"② |
| 28 | `0x82` | missing-branch（`+112 == 1` 专用路径） | **登记** | raw 79504-79508（`sub_462040` + `return`） | 窗对象 `+112` 未建模（与 `0x1D1` 的 `dedicatedPath` 同一条）；注释⑤ |
| 31 | `0x196` | approximation（第③路只在 `sub_46BE30` 返回非 0 时置 bit16） | **修** | raw 29104-29108（`result = sub_46BE30(...); if (result) { flags \|= 0x10000 }`；`sub_46BE30` 对空 `*a3` 返回 0，raw 83493-83497） | 见 §2 备注：本轮的实现改在 `advanceReveal`/记账门附近；`bit16` 仍按 bit0 置（**登记**为近似，见下） |
| 33 | `0x197` | approximation（4 格派生态 + 向零截断） | **修** | raw 24109-24112 | `★0x197：注音字号写 4 格派生态…` |
| 34 | `0x198` | missing-branch（窗对象不存在 ⇒ 静默跳过） | **修** | raw 68273（`if (result)`） | `op_window_pos` 加 `objectAt` 门（`★0x212/0x213/0x25D…` 同一张表门） |
| 35 | `0x198` | host-invented（只写 `+12/+16`、不重画） | **登记** | raw 68269-68277 | 新增 `MSGWIN_HOST_INTERFACE_DEVIATIONS`（"有意为之"护栏，说明删掉 `emitWin` 会让位置永不生效） |
| 37 | `0x1a5` | missing-branch（面名合法性） | **修** | raw 41385-41392 | `★0x1A5：…打警告串…` |
| 38 | `0x1a5` | missing-consumer（两张面名表 + `@` 变体） | **登记** | raw 41400-41402（`strcpy_s(Font+1260)` / `wsprintfA("@%s")` → `Font+102000`）、raw 41405+（`Font+101832` 表） | `resolveFace` 在**取用时**剥 `'@'` ⇒ 语义等价；去重追加表无消费者 ⇒ 登记 |
| 39 | `0x1b6` | stale-ledger（注释与代码相反） | **推翻** | 注释已在 `T-0095`/`T-0167` 订正为"清零点在 AGERC 系统命令层（`sub_4090F0`/`sub_4764F0`，`AGERC.DLL_utf8.c:2426/2441`）"；代码侧 `0x72` 已读 `97052` | `op_get_coexist_state` 的注释（盘上已一致，无需再改） |
| 40 | `0x1ce` | approximation（`_this[122371]` 原样交给 `sub_45A940`、无默认窗回退） | **推翻** | `sub_45A940` **自身** raw **71341-71345** 就是 `if (!a2) a2 = _this[307]`（审计点名的三个函数 `sub_4563D0` raw 68248 / `sub_456400` raw 68270 / `sub_456430` raw 68290 **也都有**这条回退） | 无需改代码；`m.resolveWin(m.lastArg)` 与引擎同义 |
| 42 | `0x205` | approximation（BlankExtentMode 度量来源） | **登记** | raw 12232-12235 + `sub_404EE0` raw 10716-10739 | 归 `src/text/**` 的 `changes-text.md` §6（宿主接线未做） |
| 43 | `0x20a` | missing-branch（`124350 ? 95779 : 174801`） | **登记** | raw 31556 | `op_window_relayout` 的"未建模"①（`124350` 语义未定 ⇒ 不猜） |
| 44 | `0x20a` | unclear（`set:DrawMode` 两条绘制路径） | **登记** | raw 31546-31566（重排 + 重贴两段） | 重写侧只有一条发布/光栅化通路 ⇒ 无法判定分流；已在注释登记 |
| 45 | `0x212` | missing-branch（空表项） | **修** | raw 31751-31753 | `★0x212/0x213/0x25D…` |
| 47 | `0x25c` | missing-consumer（`block224` 写完即弃） | **登记** | `sub_456510` raw 68347-68372（13 dword 文本项缓冲头） | 缓冲头由绘制路径消费，重写侧无对应物（`op_msgwin_obj_text_block` 的注释已写明"渲染层不消费"） |
| 48 | `0x25d` | missing-branch | **修** | raw 33259-33264 | `★0x212/0x213/0x25D…` |
| 49 | `0x260` | missing-operand-io（写入归属） | **推翻**（已在盘上修） | `sub_426080` raw 33310-33328（`Font+235112..+235124`）+ 消费端只在 `sub_45A940` 一族 | `MsgWindow.font.vPad`（Font 级）+ `op_vertical_rect_pad` 的长注释（T-0095/T-0102 的既有结论，本轮未改） |
| 51 | `0x2bd` | missing-branch（`sub_459F40` 首行早退门） | **推翻**（措辞） | `sub_459F40` raw 70984 的早退门只管**句柄重建**；两个字重格在 raw 33393-33399 **先于** `sub_459F40`（33401）写 | 门本身归 `src/text/**` 的 `GDI_FACE_REBUILD_NOT_MODELED`；"连两个字重格都不写"不成立 |
| 53 | `0x2be` | missing-branch（`Font+1320` 早退门） | **推翻**（同上） | raw 33413-33419 → 33421 | 同上 |
| 54 | `0x2dc` | approximation（编译期常量恒非空 ⇒ 永不返回 -1） | **登记** | `sub_430DB0` raw 40239-40249（`v = (Font[71741]-Font[71740])>>5; if (!v) v1 = -1`），表由 `EnumFontFamiliesExA` 填 | emulator 无字体枚举层 ⇒ `ENGINE_FONT_LIST` 恒 9 项；已在 `op_font_list_count` 注释登记（`recheck`：接枚举层时恢复 -1 支） |
| 56 | `0x2fe` | missing-behavior（注音位置字段按字号写死） | **修** | raw 41622-41627 | `★0x2FE：…+ 写 4 格注音派生态…` |
| 57 | `0x301` | missing-branch（`0` ⇒ 默认窗重定向） | **修** | raw 10748-10749 | `★0x301：op1 == 0 ⇒ 重定向…` |
| 58 | `0x303` | approximation（归一化） | **修** | raw 68415（原样写 `+288`） | `★0x303：op2 原样写进 win+288…` |
| 60 | `0x1bb` | missing-branch（非法实参） | **推翻** | `sub_420000` raw 29226-29241：`op1` 真 ⇒ `op1 == 1 ? 写 0 : (sprintf "SetTBの引数が不正です．" + sub_4034D0)`（**不写字段**）；`op1` 假 ⇒ 写 `0x80000000` | 盘上 `handlers/text-items.ts` 的 `op_set_text_base`（line 87-101）逐字一致（`1 → 0`、`0 → 0x80000000|0`、其它 ⇒ 抛同文错误）⇒ 无需改（该文件**不在我的范围**，仅核对） |
| 61 | `0x1d2` | missing-consumer（记录 `+4/+8/+12/+16`） | **登记** | `sub_45EFA0` raw 74348（`memset(&v7[1], 0, 16)`）、`sub_45F090` raw 74382-74389（填 `a4[0..3]`） | 那 4 格是"已画行的矩形/字形度量"，emulator 的 `TextItemRecord` 未建（`textItems.ts` 文件头"未建模"节已列；无消费者：`0x1D3`/`0x1D4` 不读它） |
| 63 | `lazy-gdi-font-set` | overreach（×8 vs 10） | **推翻**（已由 `src/text/**` owner 处置） | raw 71170-71187 | `changes-text.md` §1 |
| 68 | `msgwin-text-object` | overreach（reads 记错） | **修**（台账内容） | `Font+1032/+1036` 在 `0x6E`/`0x71`/`0x72` 体里**没有**读点；`+1040` 只在 `sub_404F80` raw 10754/10758 等绘制容器路径被读 | §台账待应用 A-7 |
| 70 | `msgwin-object-table` | overreach（trigger） | **修**（台账内容） | `0x300`（`sub_426990` raw 33757-33765）体里**没有** `sub_404F80`；只有 `0x301`（raw 33764）调它 | §台账待应用 A-2 |
| 74 | `text-layout-wrap-ruby` | overreach（reads） | **修**（台账内容） | `sub_46BE30` 体里排版度量只用 `psizl.cx/cy` + 24B 行记录；缩放只在绘制落点换算 | §台账待应用 A-8 |
| 78 | `text-blank-extent-mode-gate` | stale-ledger（字段名写错） | **推翻** | raw 12221-12225：`Engine[71744] ? Engine[71745] : -Engine[21632]`；而 `Font+201684 ÷ 4 = (85296+201684)/4 = 71745` **就是** `ENGINE_FIELD.fontSize`（`0x75` 写的那一格）⇒ `Engine[71745]` 与 `Font+201684` 是**同一格**，审计的"字段名写错"不成立 | 无需改台账数值；`numberCellExtent` 用的 `ENGINE_FIELD.fontSize` 正确 |

> 31 的补充：本轮**没有**把 `0x196` 第③路的 bit16 改成"只在 `sub_46BE30` 返回非 0 时置"。
> 判据：emulator 的 `addRuby` 没有"返回 0"的等价物（空串时 `appendText('')` 仍会产生段），
> 要忠实就得先给 `addRuby` 加"本行有内容吗"的返回值 —— 那会动 `vm/msgwin.ts` 的与
> `test/config1-chain.test.ts:93-94` 相邻的路径。**登记**为 `op_display_furigana` 的未做项（下方 B-3）。

---

## 4. 改了什么文件（全部在授权范围内）

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/vm/handlers/msgwin.ts` | `advanceReveal` 重写（门序 + `pageHasPendingText`）、`ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED`、`recordGateOpen` + 记账门、`0x301` 重定向/表门、`0x198` 表门 + 接口差登记、`0x303` 原样、`0x75`/`0x197`/`0x2BD`/`0x2BE`/`0x1A5`/`0x2FE` 的格与警告、`0x212`/`0x213`/`0x25D` 表门、`0x82` 的两个分支 + `itemId` 实参、`0x72` 尾段重排、`MSGWIN_TEXT_GAPS`、`MSGWIN_HOST_INTERFACE_DEVIATIONS` |
| `app/amayui-emulator/src/vm/msgwin.ts` | `WINDOW_OBJECT_SLOTS` + 构造期建 10 格对象表、`objectAt()`、`MsgObject.f200/f204`、`WinGeom.align` 注释（原样存） |
| `app/amayui-emulator/src/vm/engineFieldIds.ts` | 新增 9 个字段：`logfontMainWeight`(21636)、`logfontRubyWeight`(21651)、`mainLfHeightVertical`(46817)、`mainGlyphHalf`(21633)、`mainGlyphHalfVertical`(46818)、`rubyLfHeight`(21647)、`rubyGlyphHalf`(21648)、`rubyLfHeightVertical`(46832)、`rubyGlyphHalfVertical`(46833)（每个带 raw） |
| `app/amayui-emulator/src/vm/textItems.ts` | `pushRenderedRow` 的 doc 订正（记账门在**调用方** raw 83941-83942 / 81549） |
| `app/amayui-emulator/test/t0151-msgwin-vm.test.ts` | **新建**（22 例） |
| `app/amayui-emulator/test/adv-msgwin.test.ts` | 2 处 retarget（条目 1/28 的门序） |
| `app/amayui-emulator/test/adv-string.test.ts` | 1 处 retarget + doc 订正 |
| `app/amayui-emulator/test/op-10-002-adv-sleep-order.test.ts` | 1 处 retarget（改用真实置位路径） |
| `app/amayui-emulator/test/config1-chain-advreturn-real.test.ts` | 1 处 retarget（`recordsAtI082` 6 → 3） |
| `app/amayui-emulator/test/config1-chain-advreturn-seed.test.ts` | 3 处 retarget（6 → 3；两组的 `3`/`1` → `0`/`0`） |
| `tickets/T-0151/changes-msgwin.md` | 本文件 |

`git diff --stat`（本 agent 的文件，实测 —— ★这些数字是**相对 HEAD** 的：`handlers/msgwin.ts`、
`vm/msgwin.ts`、`vm/textItems.ts` 上还叠着 `T-0095`/`T-0170` 等**前序**改动，不是我一个人的量）：

```
 app/amayui-emulator/src/vm/engineFieldIds.ts                   |  70 +++
 app/amayui-emulator/src/vm/handlers/msgwin.ts                  | 561 +++++++++++++++++++--
 app/amayui-emulator/src/vm/msgwin.ts                           |  74 ++-
 app/amayui-emulator/src/vm/textItems.ts                        | 284 +++++++++++
 app/amayui-emulator/test/adv-msgwin.test.ts                    |  55 +-
 app/amayui-emulator/test/adv-string.test.ts                    |  21 +-
 app/amayui-emulator/test/config1-chain-advreturn-real.test.ts  |  20 +-
 app/amayui-emulator/test/config1-chain-advreturn-seed.test.ts  |  46 +-
 app/amayui-emulator/test/op-10-002-adv-sleep-order.test.ts     |   8 +-
 9 files changed, 1066 insertions(+), 73 deletions(-)
 app/amayui-emulator/test/t0151-msgwin-vm.test.ts               | 新建 384 行（未跟踪）
```

（未用 `Set-Content`；改动一律经编辑器工具，LF 保持 ⇒ diff 里没有整文件假变更。）

---

## 5. 验证（命令 + 实测结果，全部在本机实测）

| 命令 | 结果 |
|---|---|
| `node --import tsx --test test/t0151-msgwin-vm.test.ts` | `tests 22 / pass 22 / fail 0` |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | exit 0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.control.json --noEmit` | exit 0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit` | exit 0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | exit 0（期间他人文件的两条红已由各自 owner 修掉） |
| `node --import tsx --test test/adv-msgwin.test.ts test/adv-string.test.ts test/adv-reveal-under-throttle.test.ts` | `tests 44 / pass 44 / fail 0` |
| `node --import tsx --test test/op-10-002-adv-sleep-order.test.ts test/t0151-msgwin-vm.test.ts` | `tests 24 / pass 24 / fail 0` |
| `node --import tsx --test test/config1-chain.test.ts test/game-start-chain.test.ts test/adv-reveal-under-throttle.test.ts test/op-3-004-furigana-outer-gate.test.ts test/op-a2-a3.test.ts` | `tests 43 / pass 43 / fail 0` |
| `node --import tsx --test test/config1-chain-advreturn-real.test.ts test/op-0104-gdi-repaint.test.ts test/msg-text-range.test.ts test/recall-page-0x1d1.test.ts test/op-1d0-1d1-text-metrics.test.ts` | `tests 27 / pass 27 / fail 0` |
| `node --import tsx --test test/config1-chain-advreturn-seed.test.ts test/config1-chain-advreturn.test.ts` | `tests 2 / pass 2 / fail 0`（真语料，墙钟 ~209 s） |
| `node --import tsx --test test/adv-msgwin.test.ts test/adv-string.test.ts test/adv-reveal-under-throttle.test.ts test/msg-text-range.test.ts test/op-0104-gdi-repaint.test.ts test/op-3-004-furigana-outer-gate.test.ts test/engine-field-ids.test.ts test/text-style-snapshot.test.ts` | `tests 69 / pass 66 → 重跑后 69 / pass 69`（3 条先红后绿 = 上表四处 retarget 里的三处） |
| `node --import tsx --test test/harness-convergence.test.ts` | `tests 3 / pass 3 / fail 0`（新守卫文件不含 `mk()`/`mkEngine()`/`makeCtx()`/自造帧循环） |
| `npm run check:dead-writes` | `★ 无新增死写`（另有他人提交的一条"基线已过期"提示，非本票） |
| `npm run test:org` | `✅ 分类一致性：0 条问题`（新守卫的 pragma = `@tier T0 @kind core @subsystem adv`） |
| `node --import tsx test/run.ts all`（= `npm run test:all`） | `tests 1384 / pass 1359 / fail 23 / skipped 2`；其中 2 条 `T-0102` 已在本轮 retarget ⇒ **收尾后应为 21**；23 条红的归属见 §5.1 |
| `npm run test`（T0 快档，收尾实测） | `tests 1069 / pass 1065 / fail 3 / skipped 1` —— 3 条红全在 `test/l2d-node-transform-ops.test.ts`（他人正在改 `src/vm/handlers/live2d.ts`，mtime 01:15:11）；**本票范围内 0 条红** |
| `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate` | ✅ 172 张 / 77 条警告（其中 2 条 = `T-0147` 在我文件里的**行号漂移**，串仍在 ⇒ 见 §6.2） |
| `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . --validate` | `[ok] 141 条` |
| `node .agents/skills/amayui-engine-analysis/scripts/scripts.js --root . --validate` | `[ok] 35 条` |
| `node scripts/build-opcode-gaps.mjs --check` | `✓ md 是最新的`（117 条 / partial 64） |

### 5.1 `test:all` 的 23 条红 —— 逐条归因（本票**不新增红**）

| 组 | 条数 | 归属证据 |
|---|---|---|
| `★T-0102 判据 3 收尾` / `★T-0102 判决实验` | 2 | ★**本轮修好**（`i1bb` 记账门 ⇒ 记录表 3 而不是 6）—— 已在两处 retarget，重跑 `pass 2 / fail 0` |
| `★E4：本机真槽全部解出…`（engine-slot）、`E4：真存档槽的头…`（save-slot）、`场景执行报告…`（scene-report） | 3 | **基线 3 条红**（与 `CONTEXT.md` §6 列的一致） |
| `★0x320` / `` `0x346` 复位后 `` / `★0x347` / `★0x34B-34D` / `★0x34C` / `textureNo == -1` / `★T-0160 0x34c/0x34e/0x34f` / `A4 宿主缝` / `A5 0x1BC` / `★0x1D3/0x1D4/0x2F3/0x33F` / `TITLE: mouse_callback…` / `★E3 回归：Game Start…` | 12 | 他人**在改中**：`src/vm/handlers/live2d.ts`（mtime 01:15:11）、`src/renderer/**`、`src/vm/handlers/gfx-texture.ts`；本 agent 的 diff 不含这些文件 |
| `★帧泵：BGM 淡变按帧步进` | 1 | 他人**在改中**：`src/audio/audioEngine.ts`（mtime 01:12:26）、`src/vm/handlers/audio.ts`（01:14:49） |
| `★真进程 --idle-sec 1` | 1 | 环境（临时 overlay 里 `dist/web` 产物缺失 ⇒ 启动横幅断言失败），与本票无关 |
| 其它（T-0160 的若干条、`op-20xx` 族） | 4 | 同上（`src/renderer/**` 在改中） |

⇒ 本票范围内**0 条新红**；两条 `T-0102` 的红是"我修好之后**同一批断言**还没来得及跟"（已在本轮 retarget 掉）。

---

## 6. 台账待应用（需要主 agent 应用到 `analysis/*.json`）

> 我按纪律**没有**写 `analysis/**`（此刻归 `T-0108`）。下面每条 = 条目 id / 字段 / 新值 / raw 锚点 /
> guard 测试名。行号是"读时的磁盘状态"，稳定锚点一律用**标识符与字面串**。

### A. `analysis/engine-capabilities.json`

**A-1 `id = "adv-text-reveal-progress"`（P2 stale-ledger + P2 approximation）**

```jsonc
{
  "emulator.status": "modeled-verified",   // 不变
  "emulator.guard": "test/t0151-msgwin-vm.test.ts#★0x6E 门序",
  "emulator.note": "★T-0151 订正（P2 stale-ledger）：原 note 说『仍未建模引擎真正的逐字/逐行推进泵 —— 见 text-reveal-pump-409400』**已过期** —— 泵在 src/vm/msgwin.ts 的 tickRevealWin/tickReveal 与 src/vm/engine.ts 的 serviceTextReveal（+ #publishReveal），守卫 test/adv-reveal-under-throttle.test.ts。★T-0151 第二次订正（P2 approximation）：『显示完了吗』的判据此前用 `readTextSkipOf(e) !== 0` 伪造 sub_48F000 的返回值；现改为按体分两支（raw 28339-28343 门关闭支 / raw 28345-28359 门打开支）并用 pageHasPendingText（本页是否还有未显示的文本）近似 sub_48F000。★仍不复制：脚本分段表（Engine+80107+258，sub_48F000 raw 109810-109825 查 / sub_48FBB0 raw 110300- 建 / sub_48FFB0 raw 110456-110482 刷）与 0x71 的冲刷点 raw 28431 —— 见 src/vm/handlers/msgwin.ts 的 ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED（recheck：真机抓到门开时应当分段显示而 emulator 一段就完）。"
}
```

**A-2 `id = "msgwin-object-table"`（P2 stale-ledger + P3 overreach）**

```jsonc
{
  "note": "★T-0151 订正（P2 stale-ledger）：原 note 的『仍未建模：sub_404F80 的布局重算（移除图元区间）』**已过期** —— 0x301 的 handler（src/vm/handlers/msgwin.ts 的 op_msgwin_slot_clear）已逐步照抄 sub_404F80（raw 10741-10763）：清 `Engine[v+122486]`（raw 33763）、清对象 `+132`（raw 10752）、msgWinClear 删绘制项（raw 10753-10760）、闸门开着时重新武装显现；本轮再补两块：**默认窗重定向**（raw 10748-10749）与**对象表存在性门**（raw 10750）。守卫 test/t0151-msgwin-vm.test.ts#★0x301。★T-0151 第二次订正（P3 overreach）：原 trigger 写『0x300/0x301 写旗标/值并触发 sub_404F80 布局重算』—— 0x300（sub_426990 raw 33757-33765）体里**没有** sub_404F80 调用，只有 0x301（raw 33764）调它；trigger 应改为『0x300 写旗标/值；0x301 清该窗绘制项与 +132 并触发 sub_404F80』。",
  "emulator.guard": "test/t0151-msgwin-vm.test.ts#★0x301"
}
```

**A-3 `id = "msgwin-text-method-opcodes"`（P2 overreach）**

```jsonc
{
  "name": "消息窗文本方法族（0x6E show-text / 0x6F end-text-line / 0x71 message-show / 0x72 wait-for-input / 0x196 display-furigana）",
  "note": "★T-0151 订正（P2 overreach）：原名单把三个**不是**转发器的指令算了进来，逐条按体删：① `0x1BB`（sub_420000 raw 29223-29242）是 **SetTB 记账门** —— `Engine[97055] = op1==1 ? 0 : (op1==0 ? 0x80000000 : sprintf("SetTBの引数が不正です．")+sub_4034D0)`，体里没有任何转发，emulator 也已真实现（src/vm/handlers/text-items.ts 的 op_set_text_base）；② `0x1C9`（音频设备初始化）与 ③ `0x324`（Effect3D 销毁）同属误列（各自的体与文本布局无关）。"
}
```

**A-4 `id = "msgwin-attr-font-opcodes"`（P2 approximation）**

```jsonc
{
  "emulator.status": "partial",
  "emulator.guard": "test/t0151-msgwin-vm.test.ts#★0x75",
  "emulator.note": "★T-0151 处置（P2 approximation）：『引擎每次写颜色/档位/字号后立即 sub_459F40 重建 GDI 句柄与度量』**体证成立**（0x75 raw 24081 / 0x197 raw 24153 / 0x2BD raw 33401 / 0x2BE raw 33421 / 0x1A5 raw 41403 / 0x2FE raw 41631），但重写侧没有 GDI 句柄层 ⇒ 那一半**不复制**（归 lazy-gdi-font-set 的 GDI_FACE_REBUILD_NOT_MODELED，见 src/text/fontSet.ts）。本轮把**同构的那一半**落地：① 0x75 的 5 格（Font+201684 / +1232 / +101972 = −字号；+1236 / +101976 = 字号 / −2，**C 向零截断**，raw 24063-24070）；② 0x197 的 4 格派生态（Font+1296/+102036 = a2/−2、Font+1292/+102032 = −a2，raw 24109-24112）与**10 个窗对象**（Font[261..270] 的 +200/+204，raw 24114-24152）；③ 0x2BD/0x2BE 的第二个字重格（Font+1248 = Engine[21636] / Font+1308 = Engine[21651]，raw 33394/33414）。★审计把注音那格写成 `_this[21327]` 是**错的**（21327×4 = 85308 与 Font+1308 无关）；正确 Engine 下标 = (21324×4+1308)/4 = **21651**。守卫 test/t0151-msgwin-vm.test.ts（★0x75 / ★0x197 / ★0x2BD / ★0x2BE 四例）。"
}
```

**A-5 `id = "msgwin-config-gates"`（P2 stale-ledger）**

```jsonc
{
  "note": "……（前半保留）…… ★T-0151 订正（P2 stale-ledger）：原 note (b) 写『message:MesWinAlpha=8 ⇒ 每段文本 8ms 节流（已实现）』—— **键名错**：引擎那段节流读的是 `_this[21668]`（= Font+1376 = Engine+86672）= **`message:MessageSpeed`**（raw 28361 的 `if (!_this[21668] || …)`、raw 28380-28382 的 `sub_453A60(_this+430572, _this[21668])`、raw 23736-23738 的灌入点），`MesWinAlpha` 从不进任何字段（只被 0x131/0x141 按名直读直写）。emulator 的唯一解析处 = src/vm/handlers/msgwin.ts 的 messageSpeedOf()。"
}
```

**A-6 `id = "text-aa-config-gate"`（P2 overreach）**

```jsonc
{
  "note": "★T-0151 订正（P2 overreach）：原 note 的『字段 21662 全库唯一出现点就是它的定义』**为假** —— 定义在 src/vm/engineFieldIds.ts 的 `aaEnabled: 21662`，写入点在 src/engineConfig.ts，另有注释/测试多处。准确说法 = **产品路径无读者**：src/vm/handlers/msgwin.ts 的 globalTextStyle() 有意固定 `antiAlias: true`（判据 = 像素只可能来自覆盖率路径，见 TEXT_FILL_ALPHA 的推导），所以那一位目前只被记录。"
}
```

**A-7 `id = "msgwin-text-object"`（P2 missing-behavior + P3 overreach）**

```jsonc
{
  "reads": ["Font+218584", "Font+201684", "Font+3364", "Font+1360", "Font+1364"],
  "emulator.status": "partial",
  "emulator.guard": "test/t0151-msgwin-vm.test.ts#★0x7D",
  "emulator.note": "★T-0151 订正（P2 missing-behavior）：`0x7D`（十六进制串入队，sub_41F580 raw 28736-28765）与 0x6E **逐句同形**（argc 2；op1 = 窗、op2 = 串，读串用 sub_41A780 而非 sub_41B640；门 = !MessageSpeed || ADV ⇒ sub_46CBF0；否则 sub_46BE30 + 0x20000000 + sub_453A60(Engine+430572, MessageSpeed)），emulator **未注册**它（命中即 NotImplementedOp，不静默）—— 现登记在 src/vm/handlers/msgwin.ts 的导出常量 MSGWIN_TEXT_GAPS（opcode 0x7d / handler sub_41F580 / raw 28736-28765），守卫 test/t0151-msgwin-vm.test.ts#★0x7D。语料 src/*.txt 941 个脚本里 `^\\s*i07d\\b` 命中 **0** 处。★T-0151 第二次订正（P3 overreach）：原 reads 把 `Font+1032/+1036/+1040` 与 `Engine+667856` 记作『文本对象』的读点 —— 0x6E/0x71/0x72 体里**没有**这些读；`Font+1040` 是绘制容器，只在 sub_404F80（0x301 的落点）raw 10754/10758 一族的绘制路径上被读，不属于本条目 ⇒ 已从 reads 删除。"
}
```

**A-8 `id = "text-layout-wrap-ruby"`（P3 overreach）**

```jsonc
{
  "reads": ["Font+3364", "Font+3380", "Font+1380", "Font+1236"],
  "note": "……（原文保留）…… ★T-0151 订正（P3 overreach）：原 reads 里的『FontVWindow+36/+40（右/下边界）』『Font+1236（字宽）』『Font+218592/+218596（缩放）』在 sub_46BE30 体里**不是排版度量来源** —— 体只用 `GetTextMetricsA` 的 psizl.cx/cy + 24B 行记录（raw 83929-83940 读 `win+44/+48` 的 24B 记录向量）；缩放只在**绘制落点换算**出现（raw 71055-71090 / 71240-71254）。"
}
```

### B. `analysis/opcode-gaps.json`

**B-1 新增 `0x7d` 条目**（当前 117 条 / partial 64；加完 `node scripts/build-opcode-gaps.mjs` + `test/opcode-gaps.test.ts`）

```jsonc
{
  "opcode": 125,
  "mnemonic": "i07d",
  "name": "show-text-hex（十六进制串入队）",
  "handler": "sub_41F580",
  "handlerBodyLine": 28736,
  "argc": 2,
  "docStatus": "已核对",
  "source": "was-gap",
  "disposition": "deferred",
  "ticket": "T-0151",
  "note": "★T-0151：与 0x6E（sub_41EB20 raw 28307-28386）**逐句同形**，唯一差别是读串用 sub_41A780(_this, 2)（十六进制/转义形态）而不是 sub_41B640；门 = `!Engine[21668] || (effect_flags & 0x8000000)` ⇒ sub_46CBF0 同步排空，否则 sub_46BE30 + `0x20000000` + sub_453A60(Engine+430572, MessageSpeed)。emulator 未注册（命中即 NotImplementedOp），登记在 src/vm/handlers/msgwin.ts 的 MSGWIN_TEXT_GAPS，守卫 test/t0151-msgwin-vm.test.ts。语料 0 处（`^\\s*i07d\\b` 在 src/*.txt 941 个脚本里 0 命中）⇒ 扩展点 = 照 0x6E 的 handler 落地（把读串换成十六进制读取器）后注册进 MSGWIN_OPS 并从 MSGWIN_TEXT_GAPS 移除。",
  "missing": [
    {
      "what": "整条指令未实现（与 0x6E 同形的入队 + 节流），因语料 0 处而**保持硬报错**而不是猜实现",
      "ticket": "T-0151",
      "raw": "28736-28765"
    }
  ]
}
```

**B-2 `0x1f8` 等条目不动**（T-0153 的范围）。

**B-3 既有 `0x196` 条目（若存在）的 note 增补**：

```jsonc
{
  "disposition": "partial",
  "ticket": "T-0151",
  "note": "……（原文保留）…… ★T-0151：第 4 个实参 = `Engine[97055]`（**不是操作数**，raw 29078/29085/29091），它是 sub_46BE30 的第 5 实参，体里在**写记录**那一步才查：`if ( a5 >= 0 ) sub_4691A0(...)`（raw 83941-83942）⇒ `i1bb 0` 期间不记已画行。emulator 现已接上该门（src/vm/handlers/msgwin.ts 的 recordGateOpen），守卫 test/t0151-msgwin-vm.test.ts#★0x6E/0x196。★仍未做：第③路（文本块已置，raw 29104-29108）的 bit16 只在 `sub_46BE30` 返回非 0（本行有内容）时才置；emulator 的 addRuby 没有"返回 0"的等价物 ⇒ 按 bit0 无条件置（登记）。",
  "missing": [
    { "what": "第③路 bit16 的 '本行有内容' 判据未建模（addRuby 无返回值语义）；窗对象 +112 == 1 的专用路径（raw 83509-83514 的 sub_46B100）未建模", "ticket": "T-0151", "raw": "29104-29108" }
  ]
}
```

### C. 其余 opcode 语义行的 note 增补（供主 agent 按需应用）

| opcode | 字段 | 新值 / 增补（要点，raw 自带） |
|---|---|---|
| `0x6e` | `semantics`/note | 门的两支分开（raw 28339-28359）；`97050` 只在门开那一支；`sub_48F000` = 分段表查询（raw 109810-109825，emulator 用本页显示态近似） |
| `0x6f` | note | `sub_46AF90` raw 82630-82687：`obj+112 == 1` ⇒ `sub_4691D0`（笔位推进 + **受 `Engine[97055]` 门控**的换行记录 push，raw 81549）；否则另一套笔位推进（raw 82684-82687）且**不 push 记录** |
| `0x70` | note | 三对格：`+20/+24`（raw 73157-73158）、`+124/+128`（raw 73159-73160，DrawMode==1 时被缩放尺寸覆写）、`+36/+40`（raw 73162-73163）；末尾回看页 push **不过门**（raw 73181-73191） |
| `0x71` | note | 三条出口都写 `122496 = 0`（raw 28444/28449/28457）；`sub_48FFB0` 冲刷点 raw 28431；`Engine[97055]` 是 `sub_45EC60` 的**第 3 实参**（raw 28427）不是门（措辞订正） |
| `0x72` | note | 交付块门 `!122496 && !(mask & 0x40)`（raw 28518，mask bit6 = `Engine[1415]` raw 28487-28488）；等待门在 `ADV == 0` 时才置（raw 28540） |
| `0x75` | note | 5 格（raw 24063-24070）；`Font+201680 != 0` 时改走 `sub_459A20`/`sub_459C50` 重算（未建模） |
| `0x82` | note | bit6 = **DrawItem id 起点**后移 `win+132`（raw 79685-79688，**不是**起始记录下标）；bit4/5 ⇒ 移除 `+276/+280`（raw 79649-79653）；两段都在 `DrawMode == 1` 分支内（raw 79629-79632）；`+112 == 1` ⇒ `sub_462040` 专用路径（raw 79504-79508） |
| `0x198` | note | `if (result)` 表项门（raw 68273）；只写 `+12/+16`、不重画（emulator 为宿主接口而 `emitWin`，登记在 MSGWIN_HOST_INTERFACE_DEVIATIONS） |
| `0x1a5` / `0x2fe` | note | 白名单警告（raw 41385-41392 / 41613-41620，豁免 `"AGE Extend"`）；面名 setter 同时写模板格（41394-41399 / 41622-41627）；两张去重表（41405+ / 41633+）未建模 |
| `0x1bb` | note | 非法实参 ⇒ 错误串 + `sub_4034D0`，**不写字段**（raw 29226-29241） |
| `0x197` | note | 4 格派生态（向零截断）+ 10 个窗对象 `+200/+204`（raw 24109-24152） |
| `0x2bd`/`0x2be` | note | 第二个字重格 `Font+1248`（raw 33394）/ `Font+1308`（raw 33414）；Engine 下标 21636 / **21651**（**不是** 21327） |
| `0x212`/`0x213`/`0x25d` | note | 空表项 ⇒ 两个写都跳过（raw 31751-31753 / 31769-31774 / 33259-33264）；窗对象表 = `Font[261..270]` 共 10 格 |
| `0x301` | note | `op1 == 0` ⇒ 默认窗重定向（raw 10748-10749）+ 表项门（raw 10750）；`Engine[v+122486]` 用**未重定向**的 v（raw 33763） |
| `0x303` | note | `+288` 存**原值**（raw 68415）；消费者按 1 = 居中 / 2 = 右对齐 / 其它非 0 = 偏移 0（raw 69210-69225） |
| `0x2dc` | note | 空表返回 **-1**（raw 40239-40249）；emulator 的编译期表恒 9 项 ⇒ 该支不可达（登记） |
| `0x1ce` | note | 零支的目标窗 `Engine[122371]` 交给 `sub_45A940`，而 `sub_45A940` **自身**有默认窗回退（raw 71341-71345）⇒ emulator 的 `resolveWin(lastArg)` 同义 |
| `0x305` | note | 门 `(flags & 0x10001) == 0x10001`（raw 26045）+ 出口两段（raw 26074-26094）+ 三条出口都清 flags（raw 26083/26095/26099） |

### D. `tickets/*.json`（**不归我写**，请在结算时一并 retarget）

1. **`tickets/T-0102/ticket.json` → `evidence[17]`（anchor = `pushText(win: number, key: number, value: number): void {`，file = `app/amayui-emulator/src/vm/textItems.ts`）**：
   note 里的这段现在是**错的**（我按体接上了 `i1bb` 记账门之后）：
   > 「…所以本探针链路里 `records.length` **不是 0**：实测 **3**（= 那页样例正文的 3 行），`seedRecords`
   > 打开时 **6**（= 3 种子 + 3 行）；`i082` 的门因此过得去、会重画**一次**（`republishByI082` 由 0 变 1）。」
   
   **新值（建议原文）**：
   > 「★**T-0151 第三次订正**：本 note 的『实测 3 / 6』是**缺了 `i1bb` 记账门**时的数。引擎的每一处记录
   > push 都查 `Engine[97055]`（`sub_46BE30` raw 83941-83942 / `sub_4691D0` raw 81549 / `sub_46B100`
   > raw 82726 / `sub_461A10` raw 76380-76381 / raw 83026/83307/83634），而 `CONFIG.txt:41 i1bb 0` …
   > `:355 i1bb 1` 把整段 CONFIG 正文（含 `:177-179` 的 ADV 样例）罩住 ⇒ 本探针链路里正文**一条都不记**：
   > `seedRecords: 0` 时 `records.length === 0`、`seedRecords: 3` 时 `=== 3`；`i082` 的越界门
   > （raw 79502 的 `v8 > op2`）**在引擎里也**过不去 ⇒ `republishByI082 === 0`。真实路径
   > 「ADV（`i1bb` 正常）→ CONFIG」不受影响（那些行在 ADV 阶段就记下了）。守卫：
   > `test/t0151-msgwin-vm.test.ts#★0x6E/0x196 的第 5 实参 = Engine[97055]`、
   > `test/config1-chain-advreturn-{real,seed}.test.ts`（本轮 retarget）。」
   > ★anchor 串本身未动（`pushText` 的签名一字未改）⇒ 只改 note，`line` 无需动。
2. **`tickets/T-0147/ticket.json` → `evidence[4]`/`evidence[5]` 的 `line` 漂移**（`--validate` 只报 ⚠）：
   我按体改了 `src/vm/handlers/msgwin.ts` 的 `0x204`/`0x205` 附近行数，两个锚点串仍在：
   - anchor `★引擎的 x 前进量只在**栈局部** \`v8\` 上（raw 31482/31486/31488）⇒ 不回写 op2`：旧 `line 1724` → 新 **2326**；
   - anchor `★op2 **只读**：x 前进量是引擎体内的栈局部`：旧 `line 1799` → 新 **2452**。
3. **`tickets/T-0170`**：本轮**反向 retarget** 了它留下的 4 处断言（`config1-chain-advreturn-{real,seed}.test.ts`
   的 `6 → 3` 与 `3/1 → 0/0`），理由是 `i1bb` 门（见 §2 第二组表）。若 T-0170 的 owner 认为"SN0000 实测 6"
   要保留，那条实测属于 **SN0000 的 ADV 路径**（`i1bb` 正常），与 CONFIG 链路不是同一条 —— 建议在
   `tickets/T-0170/changes.md` 或 note 里写明这个区分（我**没有**改 `tickets/T-0170/**`）。
4. **`tickets/T-0151/ticket.json`**：状态 / `tests[]` / `history` 一律**未动**（跨两个 owner，由主 agent 结算）。
   若要把本轮守卫写进 `tests[]`：`app/amayui-emulator/test/t0151-msgwin-vm.test.ts`（22 例）。

---

## 7. 未做 / 受阻（具体到 文件:行）

1. **`src/vm/handlers/text-items.ts`**（**不在我的可写范围**）：本轮只**核对**、未改。该文件已正确
   实现 `0x1BB`（line 87-101，非法值抛同文错误）、`0x1D2` 的 `Engine[97055] === 0` 门（line 74）、
   语音 push 的同一道门（line 82）。**无需改动**。
2. **`0x196` 第③路的 bit16 判据**（`src/vm/handlers/msgwin.ts` 的 `op_display_furigana`）：
   未改成"只在 `sub_46BE30` 返回非 0 时置" —— 需要先给 `MsgWindow.addRuby`（`src/vm/msgwin.ts`）
   加"本行有内容吗"的返回值，而那会动 `test/config1-chain.test.ts:93-94` 相邻路径。**登记**（B-3）。
3. **`+112 == 1` 专用路径族**（`0x6E` raw 83509-83514 / `0x6F` raw 82665 / `0x82` raw 79504-79508 /
   `0x1D1` raw 80531-80532）：emulator 的窗对象没有 `+112` ⇒ 四条都未建模（**登记**，不猜）。
4. **`0x1d2` 记录的 `+4/+8/+12/+16`**（`src/vm/textItems.ts` 的 `TextItemRecord`）：未建字段
   （无消费者：`0x1D3`/`0x1D4` 不读它）⇒ 登记。
5. **脚本分段表 / 消息队列**（`Engine+80107+258`、`sub_48F000`/`sub_48FBB0`/`sub_48FFB0`）：
   不装载 ⇒ `0x6E`/`0x71`/`0x72` 门开路径是近似（`ADV_REVEAL_SEGMENT_TABLE_NOT_MODELED`）。
6. **GDI 句柄层**（`sub_459F40`/`sub_45A6E0`/`sub_459A20`/`sub_459C50`）：归 `src/text/**`
   （`changes-text.md` §1 + §7-A.2），本文件不重复。
7. **`0x75` 的 `Font+201680 != 0` 分支**（raw 24071-24079 的 `sub_459A20`/`sub_459C50` 重算）：
   未建模（`Font+201680` 全库只有两处写 = 0 ⇒ 该支在本 build 不可达，`changes-text.md` §1 已证）。

---

## 8. 与其它票的耦合点

- **`T-0169`（帧循环口径差）**：本轮**没有**动 `src/frame/**`。但 `0x72` 尾段的重排让
  "跳读中不清 ADV ⇒ 不挂等待门"成立，`frame/loop.ts` 的 `advance` 分支因此会在跳读期间
  继续每轮派发一条指令（与 T-0169 的结论**同向**）。若 T-0169 要改分支次序，注意本条的门。
- **`T-0019`（拆 `handlers/msgwin.ts`）**：本轮在该文件里新增了 3 个导出
  （`MSGWIN_TEXT_GAPS` / `MSGWIN_HOST_INTERFACE_DEVIATIONS` / 内部 `recordGateOpen`、`pageHasPendingText`）
  —— 拆分时请把它们与 `advanceReveal` 一起放到"文本状态判定"那一块。
- **`T-0150`（死写闸门）**：本轮新增的 `engineValues` 键全走 `ENGINE_FIELD.*` 常量（`engine-field-ids`
  的"不得裸数字"棘轮），且 `engineValues` 的数字键**不在** `deadWrites` 的 scope 内（该工具明说
  Map/数字键不统计）⇒ `check:dead-writes` 不应新增（实测见下表）。
- **`T-0153`（gfx-texture / audio）**：`src/vm/handlers/audio.ts`、`src/audio/audioEngine.ts`、
  `src/vm/handlers/live2d.ts` 此刻正被其它 agent 改（mtime 1:09-1:15），相关测试的红与本票无关。
