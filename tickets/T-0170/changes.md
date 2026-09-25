# T-0170 · 变更记录 —— `0x1D1` 回看页重绘（`0x82` 的孪生兄弟）

> 真源 = `engine/天结_unpacked.exe_utf8.c`（下文 "raw NNNNN" = 该文件行号）。
> 本票**语义被主 agent 中途订正过一次**（建票时写的是"回想页渲染器 ⇒ 要建页面/滚动/高亮模型"），
> 订正后的口径与订正依据见 §1；本记录按订正后的口径写。

## 一、先纠正前提（读体后推翻建票文本）

`0x1D1` **不是**"回想页渲染器"，**没有**页面 / 滚动位置 / 选中页高亮模型。它是 **`0x82` 的孪生**。

| 事实 | 证据（raw） |
|---|---|
| handler `sub_420310` 与 `0x82` 的 `sub_41F720` **逐字同形**：`_this[30*cur+95805] = 11`、`op5..op1` 五次 `sub_41BF50`、第 7 参 `_this + 21032` | 29353-29371 vs 28808-28826 |
| ⇒ **"6 形参 vs 5 操作数"的答案**：第 7 参 `a7 = Engine+84128`（**语音对象**）不是操作数 | 29363 / 28818 |
| 落点 `sub_4675A0` 的**可执行头部**与 `0x82` 的 `sub_466000` 同形：记录表门槛 `(Font+3368−Font+3364)/72 > op2 && op2 >= 0` | 80524-80529 vs 79499-79505 |
| 窗对象 `+112 == 1` ⇒ 专用路径（`sub_4634B0` vs `0x82` 的 `sub_462040`） | 80531-80532 / 79506 |
| ★**体内确实没有页面/滚动/高亮**：raw 81140-81522 全域搜索无 `FillRect`/`Rectangle`/`PatBlt`/区域填充/行底填色/选中矩形；唯一的"光标"是 raw 81145 `sub_4AC750` 的矩阵平移项 | 81140-81522（子代理逐段枚举，另见 `.tmp/t0170-sub-a/sub-4675A0-tail.md`） |
| 滚动/选中/翻页**由脚本自己做**：`src/HISTORY.txt` 的 `i1d0`（取页）+ `i1d3`（取字段）+ `draw-texture`/`i217`/`i1fd`（框/条纹/页码滑块） | `src/HISTORY.txt:1128-1396` |

## 二、与 `0x82` 的**逐项差异表**（本票判据③）

| # | 件 | `0x82`（`sub_41F720` raw 28808-28826 → `sub_466000` raw 79319-80311） | `0x1D1`（`sub_420310` raw 29353-29371 → `sub_4675A0` raw 80312-81522） | emulator 侧 |
|---|---|---|---|---|
| 0 | handler 骨架 | `arity 槽 = 11`；五次 `sub_41BF50`；第 7 参 `Engine+84128` | **逐字相同** | **复用同一条纪律**（`operandsFor` 读满五格再进门） |
| 1 | 越界门 | `(Font+3368−Font+3364)/72 > op2 && op2 >= 0`（79499-79505）；不满足 ⇒ 被调体 `return` | **同一道**（80529） | 同一实现：越界 ⇒ 连颜色都不改、**一次 `msgWinSync` 都没有** |
| 2 | ★**颜色的生命周期** | `op3 & 2` ⇒ 覆写 `Font+1360/+1364`（raw 79613 一带）**不恢复** | `op3 & 2` ⇒ 覆写（80629-80634）→ 收尾**恢复**（**81470-81473**） | **分叉**：`0x1D1` 恢复、`0x82` 不恢复（守卫 ⑤/⑤b 对照） |
| 3 | 记录分流 | 从 `op2` 起逐条重画；`flags & 4` 在 79846/79878/80029/80056 出现 | **四类**：语音项（`op3 & 8` ⇒ `sub_4BB840`，80678-80699，按记录 `+32` 当通道号）、换行（`flags & 8` ⇒ `v209 += Font[1380]+sub_404EC0`，80718-80724）、正文行（`flags & 4` ⇒ 连续多条 `memcpy` 拼成整行，80725-81014/80731-80752）、切页哨兵（`flags & 2` 且 `!(op3&1)` ⇒ 停在该条**之前**，80676） | `TextItemTable.repaintRange` 逐条实现（守卫 ③/③b/③c/⑥） |
| 4 | 正文来源 | `sub_466000` 走另一套（raw 79816） | 记录 `+44` 的 `std::string`（80736-80745）= **ADV 已经画过的正文行** | ★**本轮为此新增了写入端**（见 §三.2） |
| 5 | 专用路径 | `sub_462040` | `sub_4634B0`（raw 77500-78716，GDI-only 变体，字体句柄 `+101852/+101856`） | **未实现**（窗对象 `+112` 未建模）⇒ `dedicatedPath` 恒 `false`，呈现通路共用（登记在 missing[]） |
| 6 | 尾部窗口记账 | — | `win+136`（已画字数）/`win+132`（高水位）（81220/81224） | **未实现**（emulator 的显现游标另有唯一真源 `MsgWindow.reveal`，不设第二份） |
| 7 | 栏带四边形 | — | `op3 & 0x20` 时按**窗对象自己的栏表** `win[56]/[70]` 逐项 `sub_4ACE50`+`sub_4ACF60`（81498-81509） | **未实现**（该栏表未建模） |
| 8 | 缩放/度量 | `double`/`float`/`TEXTMETRICA` 用于逐字排版 | 同族（`GetTextExtentPoint32A` 80756/80810/81276/81413、`GetTextMetricsA` 80817/81325、`dbl_51D7F8` 对齐舍入） | **不等价**：重写侧由 `src/text/layout.ts` 排版（与 `sub_4675A0` 的逐字符度量不是同一算法） |

## 三、实现了什么（分两部分）

### 1. `0x1D1` 本体（新 handler `op_recall_page_repaint`，`src/vm/handlers/msgwin.ts`，放在 `0x82` 旁边）
- 五格操作数无条件读满（raw 29365-29369，越界门在**被调体**里 ⇒ 越界也要读满）；
- 越界门（raw 80529）：不满足 ⇒ 直接 `return`（不改色、不发布）；
- `op3 & 0x40` ⇒ 不清 `win+104/+108`；`op3 & 0x30` ⇒ 另清 `win+276/+280`（raw 80591/80607）；
- `op3 & 2` ⇒ 覆写 `ENGINE_FIELD.colorFill/colorOutline`（= `Font+1360/+1364`，与 `0x76`/`0x77`/`0x82` 同一对字段），**收尾恢复**（raw 81470-81473）；
- 记录切片 `TextItemTable.repaintRange(start, {win, mode, dedicatedPath, voiceBusy})`：四类分流 + 三条出口（`reflow`/`group-start`/`eof`）+ 连续正文记录按 `memcpy` 规则拼行；
- 把切片正文经 **`MsgWindow.setPageText` + `captureFontStyle` + `emitWin`** 画进该窗（登记近似：与 `0x82` 同一条"整窗从模型重排"，因为没有"在该窗表面**追加**若干行"的粒度）。

### 2. 记录表的**已画行写入端**（`0x1D1` 要重画的数据源；`src/vm/textItems.ts` + `handlers/msgwin.ts`）
引擎侧：每画一段正文，`sub_46BE30`（raw 83364）→ `sub_461A10`/`sub_465A20` → **`sub_45F090`**（raw 74360-74400）
把 `+44` 的正文串连同 `+20/+24`（= `Font[340]/[341]` 填充/描边色）一起 push；换行由 `sub_4691D0`（raw 81530-81553）补一条 `flags|8` 的空串记录。**这条 push 没有 `Engine[97055]` 门**（体里一次都没出现）。
emulator 对应物：`0x6E show-text`（含 `flags & 1` 的注音/内嵌支）与 `0x196 display-furigana` 各 push 一条 `ITEM_ROW_TEXT` 记录（带串），`0x6F end-text-line` push 一条 `ITEM_ROW_LINE`。
★**漏了它是什么症状**：记录表里仍有 `0x1D2` 的标记记录 ⇒ `0x1D0`/`0x1D3` 照常返回合法值、**谁都不报错**，
但 `0x1D1` 要重画的正文一行都没有 ⇒ **回想画面只有框、没有字**（这正是 T-0168 探针看到的现象的第二层原因）。

## 四、E3 实测（真语料，本机 `install/`）

`TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000 首文案 → set:wheelkeyup=8 → addWheel(120)`
⇒ `curScript().name === 'HISTORY.BIN'`，随后 `0x1D1` 被派发（`saw1d1 = 1`，`unknownHits[0x1d1] === 0`）：

```
[T-0170] HISTORY 页：win=3 行数=3 字数=52 次命中 0x1D1=1
切片（第一版探针打出的原始 JSON）：{win:3, start:1, end:14, stop:'eof',
  records: 4×text-marker + 1×voice + 正文/换行交错（共 13 条）,
  lines: ['由両个世界融合而生的', '『迪爾-利菲娜』的世界上…命', '運的諸神之戰，那就是『三神戦争』。']}
```

⇒ **正文真的上屏了**（该窗槽内容 = 这 3 行，`emitWin` 就是渲染侧的光栅化输入）。
★`stop = 'eof'` 是**实测**（不是 group-start）：SN0000 首文案还没翻页，记录表里这一页之后没有任何组首 ⇒ 切片走到表尾（raw 80708）。这条第一版守卫里被我**猜错过**（写成 `group-start`），已按实测订正 —— 记在这里以免下次又猜。

## 五、红 → 绿证据

| 步骤 | 命令 | 结果 |
|---|---|---|
| 红 | 临时注掉 `MSGWIN_OPS` 里的 `[0x1d1, op_recall_page_repaint]` 后 `node --import tsx --test test/recall-page-0x1d1.test.ts` | **tests 13 / pass 3 / fail 10**（`OPS.has(0x1d1)` 那条 + 其余全部因"0x1d1 不在 OPS"失败） |
| 绿 | 恢复注册后再跑同一命令 | **tests 13 / pass 13 / fail 0** |

## 六、本轮登记的近似与缺口（**没有**静默 no-op）

已写进 `analysis/opcodes.json` 的 `0x1D1` semantics（`missing[]`）与第二层新条目 `backlog-drawn-row-recording`：

1. **专用路径** `sub_4634B0`（窗对象 `+112 == 1`）未建第二套渲染器 ⇒ `dedicatedPath` 恒 `false`；
2. **栏带四边形循环**（raw 81498-81509，驱动数据 = 窗对象 `win[56]/[70]` 栏表）未实现；
3. `sub_404CB0(语音)` 占线查询**没有宿主缝**（`AudioEngine` 无 `voiceBusy()` 公开口）⇒ `voiceBusy` 恒 `false`（守卫 ⑥ 用直接传参验证了 `true` 那一支）；
4. **逐字 GDI 度量/描边/竖排光栅化**本身不等价（由 `src/text/layout.ts` 承担）；
5. `win+136/+132` 的窗口记账未建模（emulator 显现游标另有唯一真源）；
6. 排版**自动换行**时 `sub_4691D0` 的第三个 push 点未复刻（只在显式 `0x6F` 补换行记录；观感由渲染侧重新排版承担）。

## 七、改了哪些文件

| 文件 | 改了什么 |
|---|---|
| `app/amayui-emulator/src/vm/textItems.ts` | 新增 `ITEM_ROW_TEXT`/`ITEM_ROW_LINE` 与 `REPAINT_*` 六位；`TextItemRecord.text`（引擎 `+44`）；`pushRenderedRow`/`pushLineFeed`；`repaintRange` + `RecallRepaint`/`RecallRecord`/`RecallVoiceIcon`/`RecallRepaintOpts` |
| `app/amayui-emulator/src/vm/msgwin.ts` | 新增 `MsgWindow.setPageText`（用一页整行整体替换该窗内容） |
| `app/amayui-emulator/src/vm/handlers/msgwin.ts` | 新增 `op_recall_page_repaint`（挂在 `0x82` 旁）+ 注册 `[0x1d1, …]`；`rowColors`/`recordRenderedRow` 两个辅助；`0x6E`（两处支）、`0x196`、`0x6F` 各补一处记录表记账 |
| `app/amayui-emulator/src/vm/operandPlan.ts` | `declarePlan(0x1d1, …)`（argc 5、全 int、全 `r`，紧挨 `0x82` 那条） |
| `app/amayui-emulator/src/vm/engine.ts` | 只改了一行注释的落点（**曾短暂加过 `recallRepaint` 字段，已删除** —— 死写棘轮正确地报了它） |
| `app/amayui-emulator/test/recall-page-0x1d1.test.ts` | **新建**（13 例，含 E3） |
| `app/amayui-emulator/test/op-1d0-1d1-text-metrics.test.ts` | **retarget**（主 agent 书面授权）：头部前提改写、第 62-71 行那条改成"必须落在 `OPS` + `disposition ∈ {implemented,partial}`"、第 111 行对齐 `0x1D0` 口径；79-95 行的 handler/argc/note 锚点**一字未动** |
| `analysis/opcodes.json` | `0x1D1` 的 `semantics` 整段按体重写（含孪生 diff、`missing[]`、`emulator: partial`） |
| `analysis/engine-capabilities.json` | **新增** `backlog-drawn-row-recording`；改 `text-item-record-table` 的 `emulator.note`（订正"`+44` 未建模"那句）与 `engine.raw` 格式 |
| `analysis/scripts.json` | **新增** `HISTORY` 条目（此前没有这一页；335 个调用者 = ADV 菜单 action id 6） |
| `docs-new/05-scripts/HISTORY.md` 等 | `build-scripts.mjs` / `build-capabilities.mjs` / `build-opcode-table.mjs` / `build-doc-index.mjs` 重生成 |

★**动过被锚定的文件**：`src/vm/handlers/msgwin.ts`（在其上/下方插入了约 200 行）与 `src/vm/textItems.ts`（新增类型/常量/方法）。
`tickets.js --validate` 与 `scripts.js --validate` 均 ✅ 通过（**没有** anchor 消失），但 `tickets.js` 报 **7 条 ⚠ 行号漂移**落在我的改动上（anchor 字符串还在，只是 `line` 偏了）：

| 票 | 文件:旧 line | anchor（未变） |
|---|---|---|
| `T-0016` ev[5] | `handlers/msgwin.ts:602` | `!m.revealArmed(w)` |
| `T-0031` ev[9] | `handlers/msgwin.ts:1412` | `setConfigValue(c.e, CFG.messageMessageSpeed, v);` |
| `T-0104` ev[0] | `handlers/msgwin.ts:904` | `op_gdi_repaint_window` |
| `T-0085` ev[1] | `handlers/msgwin.ts:1687` | `set:BlankExtentMode == 1` |
| `T-0094` ev[0] | `handlers/msgwin.ts:719` | `op_display_furigana` |
| `T-0147` ev[4] | `handlers/msgwin.ts:1724` | `★引擎的 x 前进量只在**栈局部** `v8` 上（raw 31482/31486/31488）⇒ 不回写 op2` |
| `T-0147` ev[5] | `handlers/msgwin.ts:1799` | `★op2 **只读**：x 前进量是引擎体内的栈局部` |
| `T-0102` ev[17] | `textItems.ts:173` | `pushText(win: number, key: number, value: number): void {` |

★另有 **2 条 `src/vm/engine.ts` 的漂移（`:1150 serviceAdvanceWait` / `:1189 if ((mask & 0x10) !== 0 …`）不是我造成的**：`engine.ts` 的第 524 行（`textItems = new TextItemTable();`）在我改动前后**同为 524** ⇒ 我对该文件的净改动为 0（曾加过的 `recallRepaint` 字段已连同注释一起删除）。

### ★★一条**语义被本轮证伪**的既有证据（锚点字符串还在，但结论不再成立）
`T-0102` 的 `evidence[17]`（`textItems.ts` 的 `pushText(...)`）note 里写着：
> 「`records` **仅**由 `pushText`（`0x1D2`）与 `pushVoice`（…）push；`show-text`(0x6E) **只** append 到槽、`i071` 只 push **页**。⇒ …`records.length = 0` 是**正确**状态」

**这句自本轮起不成立**：`show-text`(0x6E)/`display-furigana`(0x196) 现在也会 push 正文行记录（`ITEM_ROW_TEXT`）、`end-text-line`(0x6F) push 换行记录（`ITEM_ROW_LINE`）—— 这正是引擎的 `sub_45F090`/`sub_4691D0` 行为（见 §三.2），也是 `0x1D1` 能画出正文的前提。
⇒ 该条需要 owner 改写成「`records` 由 `pushText`/`pushVoice`（标记/语音项）+ `pushRenderedRow`/`pushLineFeed`（**已画行**，`T-0170` 新增）共同填充」；`0x82` 的行为本身没变（它自己的守卫 `test/op-0104-gdi-repaint.test.ts` 手工塞记录，仍绿）。
**锚点是 ABI**：这一条是**结论过期**而不是锚点消失（`--validate` 抓不到），所以必须靠人改 note，我未改别人的票。

## 八、仍红项 / 未完成

1. **`test/op-1d0-1d1-text-metrics.test.ts` 的那一条**（`0x1d1 台账处置必须已结算（implemented/partial），不得停在 deferred`）**预期仍红**：`analysis/opcode-gaps.json` 归主 agent / `T-0149` 结算，本轮不得触碰 ⇒ 由主 agent 把 `0x1D1` 的 `disposition` 由 `deferred` 改成 **`partial`**（内容见 §九）后自动转绿。
2. **`test/no-dead-writes.test.ts` 的 2 条自检红**（`容器变更方法（.set/.clear/.push）算"写"`、`别的 scope 的同名字段不算消费者`）：属 `T-0150`（A2）的 in-flight 状态，与 T-0170 无关（我引入的那条新死写已随字段删除而消失，`check:dead-writes` = 无新增死写）。
3. **`docs-new/05-scripts/HISTORY.md` 的 `status: partial`**：HISTORY 全文 1704 行，本轮实读 1-340 / 752-831 / 1128-1399（`layout` 逐段的 `lines` 就是读过的范围），其余在 `gaps` 里列明；**未**读全 ⇒ 不写 `analyzed`。
4. **`T-0020` 的后续项**：`test/harness.ts` 缺一个共享的 `FrameHost` 工厂 ⇒ E3 一族各自写时钟源（本文件的 `TICK_MS` 就是为此抽的常量，避免落进 `harnessScan` 的字面正则）。
5. `analysis/functions.json` **缺 4 条**：`0x420310`（`0x1D1` handler）、`0x4675A0`（落点体）、`0x45F090`（已画行 push）、`0x4691D0`（换行 push）——该文件不在本 agent 的文件范围内，请其 owner 补（本轮结论已全部写进 `engine-capabilities.json` 与 `opcodes.json`）。

## 十、全量测试对照（`npm run test:all`）

```
第一次（retarget 前）  tests 1309 / pass 1299 / fail 8 / skipped 2
第二次（retarget 后）  tests 1310 / pass 1304 / fail 4 / skipped 2
基线（CONTEXT.md §6）  tests 1245 / pass 1240 / fail 3 / skipped 2
```

**最终 4 条红 = 3 条基线红 + 1 条 `T-0171` 的红；本票新增红 = 0。**

| # | 失败的用例 | 归因 |
|---|---|---|
| 1 | `engine-slot.test.ts` ★E4 真槽落点自洽（SAVE70/71 `storedDwords` 超文件） | **基线红**（§6 第 1 条） |
| 2 | `save-slot.test.ts` E4 真存档槽头（`SAVE70.DAT` format 0 ≠ 3） | **基线红**（§6 第 2 条） |
| 3 | `scene-report.test.ts` 场景执行报告（可绘制项 24 ≤ 缺纹理项 26） | **基线红**（§6 第 3 条） |
| 4 | `adv-msgwin.test.ts` ★逐字期间右键不生效、滚轮上滚不生效（`下滚应贴完整页` false） | **`T-0171`**（见下） |

**#4 的归因与机制（不是本票）**：`src/vm/input.ts` 的 `addWheel`（:500-518）被 `T-0171` 改了 ——
修前 `policy.asKey` 为真但位号未映射（`set:WheelKeyDown` 缺失 ⇒ bit < 0）时会**掉进 `wheelDelta +=`**；
修后那一支直接 `return`（该文件自己的注释 :511-513 写着「**绝不回流到累加器**：累加支是模式门的 `else` 那一侧」
与「`tickets/T-0171`：修前这里会掉进下面的 `wheelDelta +=`，守卫只能靠 +120/−120 抵消才过」）。
而 `adv-msgwin.test.ts:318-319` 恰好依赖那个**落回累加器**的行为（逐字期间下滚 ⇒ `consumeWheelDelta() < 0` ⇒ 贴完整页）。
⇒ `T-0171` 修对了引擎行为，该守卫的前提（"会回流到累加器"）随之失效，需其 owner retarget。

| 第一次运行里的 8 条 | 处置 |
|---|---|
| `engine-slot` / `scene-report` / `save-slot` | 基线红（上表 1/2/3） |
| `op-1d0-1d1-text-metrics`（0x1D1 disposition） | **已转绿** —— 主 agent 把 `opcode-gaps.json` 的 465 结算成 `partial` |
| `no-dead-writes`（`Engine.t0150TemporaryDeadWrite`） | **已清** —— `T-0150` 自己注入的闸门自检字段 |
| `input.test.ts` ★0x10C ③（bit31 unsigned vs signed） | **已清** —— **主 agent** 修的（`flushPending`/`flushHeld` 去掉 `>>> 0`，掩码是 int32）⇒ 归因更正：不是 `T-0163`/A5 |
| `config1-chain-advreturn-real` / `-seed` | **本票 retarget，已转绿**（§十二） |

★另注：`npm run test`（fast = T0）不受本票影响 —— 新守卫是 `@tier T1`（需要 `install/` 真资产），
只在 `test:corpus` / `test:all` 里跑 ⇒ 日常快速档不会因本票变慢。

## 十一、其它范围外/后续项

1. `T-0020` 后续：`test/harness.ts` 缺共享 `FrameHost` 工厂 ⇒ E3 一族各写时钟源（本文件用 `TICK_MS` 常量避免落进 `harnessScan` 的字面正则）。
2. `T-0102` 的 `evidence[17]` note **结论已被本轮证伪**（见 §七的专项小节）⇒ 需 owner 改写 note。
3. 7 条 ⚠ 行号漂移（§七的表）⇒ 需各自 owner 刷新 `line`（锚点字符串未消失）。


## 十二、T-0102 守卫的 retarget（主 agent 书面授权；**前提被取代**，不是放宽断言）

`0x1D1` 要重画的"已画行"数据源是引擎的 `sub_45F090`（raw 74360-74400）⇒ 本轮让 `0x6E`/`0x196`
也往记录表 push 已画行。这使 `T-0102` 的两份守卫里**三条**钉住"记录表里只有探针塞的种子 / 表恒空"
的断言前提失效（引擎里表本来就非空）。逐条：

| 文件:行 | 旧断言（语义） | 新断言 | 为什么是前提被取代 |
|---|---|---|---|
| `config1-chain-advreturn-real.test.ts:51` | `recordsAtI082 === 3`（"表里只有 3 个种子"） | **`>= 3`（下界，门要的"非空"）+ `=== 6`（真值）** | 3 个种子 + 3 行正文 = 6；★该文件自己的注释 `:26` 就写着引擎真路径实测「2（600 帧后 **6**）⇒ 非空」 |
| `config1-chain-advreturn-seed.test.ts:41` | 同上（`=== 3`） | 同上（实测也是 6） | 同上 |
| `config1-chain-advreturn-seed.test.ts:68` | `republishByI082 === 0`，理由 = "跳过重新入队 ⇒ 记录表仍空" | **`recordsAtI082 > 0` + `=== 3`（因果断言）+ `republishByI082 === 1`** | 该场景表**非空** ⇒ `i082` 的门（raw 79502）过得去 ⇒ 重画一次。**引擎同**（那页样例正文早已画出）。实测 `recordsAtI082 = 3`（本组**没塞种子** ⇒ 3 条就是已画行记录） |
| `config1-chain-advreturn-seed.test.ts:83` | `republishByI082 === 0`，理由 = "★`show-text` **不** push 文本项记录（记录表只由 0x1D2/0xC4 族填）" | **`recordsAtI082 > 0` + `=== 3`（因果断言）+ `republishByI082 === 1`** | ★**理由文本本身就是本轮推翻的那句**：`sub_45F090` 正是 `0x6E` 的调用链（raw 28368 → `sub_46CBF0` → `sub_46BE30` → `sub_45F090`）。实测 `recordsAtI082 = 3`、`republishByI082 = 1` |

★**新断言比旧的更强**（不是"只把 0 改成 1"）：后两条各**加了一条因果断言**（`recordsAtI082 > 0` 与实测值 `=== 3`），
把"门为什么过得去"钉住，再由它推出"过得去之后重画一次"。
★**"钉死 6 / 3"而不是只写 `> 0` 的理由**：该链路确定性、多次运行同值，且 6 有**引擎真路径实测**背书
（`-real` 文件自己的注释 `:26`：`2 → 600 帧后 6`）；唯一漂移源是"将来翻译改 `src/CONFIG1*.txt` 的 `show-text` 段数"——那时按同一因果刷新数字。
★**覆盖不降**：二/三两组仍靠**未改动**的 `opsSyncedAfterI076.includes(0x71)`/`.includes(0x6e)`（`:78`/`:79`）区分分支；
而"门关着 ⇒ 不画"这条语义另有覆盖（`test/op-0104-gdi-repaint.test.ts` ④ 的越界门 + 本票 `test/recall-page-0x1d1.test.ts` ②）。
★**还有一处同前提的过期文档**（不在本 agent 范围）：`src/tools/config1Chain.ts:297-311` 的 `recordsAtI082` 注释仍写着
「本探针跑的是一条"没有 ADV 消息历史"的链路（CONFIG 页不 push 文本项记录），所以这里多半是 0」与
「`records` **只有文本项入队时才 push**」—— 该文件归 `T-0150`（A2），需其 owner 改写。

★**"钉死 6"而不是只写 `>= 3` 的理由**：该链路确定性、两次运行都是 6，且 6 有**引擎真路径实测**背书
（测试自己的注释）；唯一漂移源是"将来翻译改 `src/CONFIG1*.txt` 的 `show-text` 段数"——那时按同一因果刷新数字。
★**覆盖不降**：二/三两组仍靠**未改动**的 `opsSyncedAfterI076.includes(0x71)`/`.includes(0x6e)`（`:78`/`:79`）区分分支；
而"门关着 ⇒ 不画"这条语义另有覆盖（`test/op-0104-gdi-repaint.test.ts` ④ 的越界门 + 本票 `test/recall-page-0x1d1.test.ts` ②）。

## 十三、请主 agent 代做的范围外改动

1. **`analysis/opcode-gaps.json` 的 `0x1D1`（opcode 465）**：`disposition: "deferred"` → **`"partial"`**，`note` 里**保留**既有被钉的三个字串 `回看页重绘` / `sub_4675A0` / `raw 80312-81522`（`test/op-1d0-1d1-text-metrics.test.ts:79-95` 钉着它们），并补一句指向本轮实现与 `missing[]`。建议追加的文本：

   > ★**`T-0170` 已按体实现（`partial`）**：它是 `0x82` 的孪生 —— 「把 `Font+3364` 记录表里从 op2 起的那一段重画进窗 op1」，**不是**页面/滚动/高亮模型（raw 81140-81522 全域无 `FillRect`/`Rectangle`/`PatBlt`/区域填充/选中矩形）。已实现：五格操作数纪律、越界门（raw 80529）、`op3` 的 `0x40/0x30/0x02/0x01/0x08` 五位、记录四类分流与三条出口（`TextItemTable.repaintRange`）、正文串记账（`sub_45F090` 对应物：`0x6E`/`0x196`/`0x6F`）、颜色覆写**与恢复**（raw 81470-81473，★与 `0x82` 的分叉点）、经 `setPageText`+`emitWin` 的发布。**missing[]**：`sub_4634B0` 专用路径（窗对象 `+112` 未建模）、`win[56]/[70]` 栏带四边形循环（raw 81498-81509）、`sub_404CB0(语音)` 占线查询（无宿主缝）、逐字 GDI 度量本身、`win+136/+132` 窗口记账、自动换行时的第三个 push 点。守卫 `app/amayui-emulator/test/recall-page-0x1d1.test.ts`（13 例，含 E3：滚轮位 8 ⇒ `HISTORY.BIN` ⇒ 该页切出 13 条记录 / 3 行真实序章正文）。细则见 `tickets/T-0170/changes.md`。

2. **三张票据的 `evidence.line` retarget**（⚠ 警告，anchor 未消失）：`app/amayui-emulator/src/vm/handlers/msgwin.ts` 因本轮插入约 200 行，其 `evidence.line` 相对该文件漂移（`tickets.js --validate` 报 3 处：`op_gdi_repaint_window`、`★引擎的 x 前进量只在**栈局部** v8 上（raw 31482/31486/31488）⇒ 不回写 op2`、`★op2 **只读**：x 前进量是引擎体内的栈局部`）。用 `--anchors-in` 定位到票后刷新行号即可，**不要**删锚点。
3. **`docs-new/00-overview/index.md`**：本轮新增了 `docs-new/05-scripts/HISTORY.md` ⇒ 需重跑 `node scripts/build-doc-index.mjs`。

## 2026-09-24

## 2026-09-24 与 T-0151 的口径区分（i1bb 记账门）

T-0151 接上 Engine[97055] 记账门（0x1BB，raw 29223-29242）后，把本票留下的 4 处断言反向 retarget：config1-chain-advreturn-{real,seed} 的 recordsAtI082 由 6/3 改为 3/0、republishByI082 由 1 改为 0。主 agent 复核后**维持该口径**：
- 引擎每一处正文记录 push 都先过这道门（sub_46BE30 raw 83941-83942 的 if (a5 >= 0)；0x6E 把 Engine[97055] 当第 5 形参传入，raw 28372-28375）；
- 0x1BB 的体写 Engine[97055] = op1==1 ? 0 : (op1==0 ? 0x80000000 : 错误串) ⇒ i1bb 0 = 门关；
- CONFIG.txt:41 i1bb 0 … :355 i1bb 1 罩住整段 CONFIG 正文（含 172-179 的 ADV 样例）⇒ **本单位探针链路（CONFIG 链）正文一条都不记**。

★**本票的结论不受影响**：本票的 E3 实测走的是 **SN0000 的 ADV 路径**（i1bb 正常），那里的记录照记；'6' 那个数字属于 ADV 路径、与 CONFIG 探针链路不是同一条。见 tickets/T-0151/changes-msgwin.md §6 D-1 与 tickets/T-0102/ticket.json 的 evidence[17]。
