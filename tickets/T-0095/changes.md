# T-0095 · 过程文档（changes.md）

## 2026-09-20

## 轮 8 · 落地完成（IMPLEMENTATION 子代理 + 主 agent 结算）

**改动**（`0x1d0` 读端 + 两个写端 + 清表，纯 VM 零宿主缝）
- `src/vm/textItems.ts`（+228）：`pages: BacklogPage[]` + `cursor`(=Font[860]) / `baseCursor`(=Font[859])；`pushPage` / `pageAt`(`sub_459860` 逐分支移植，**不改游标**) / `moveCursor`(`sub_459770`) / `clearBacklog`(`sub_45EBE0`)；`reset()` = clearBacklog + 组首清空 + 游标归零（`0x9`）
- `src/vm/handlers/text-items.ts`（+45）：`[0x1d0, op_backlog_page_at]`（读 op3 → 写 op1/op2，末参常量 `ITEM_REFLOW = 2`）与 `[0x85, op_text_tables_clear]`，都进 `TEXT_ITEM_OPS` ⇒ 自动进 `OPS`
- `src/vm/handlers/msgwin.ts`（+32）：`0x70` 末尾 **无门** push + 组首（raw 73186-73187）；`0x71` 把**恒真的** `m.textSlotArg >= 0` 换成真门 `(engineValues.get(ENGINE_FIELD.textBaseGate) ?? 0) >= 0` 并在门内 push（raw 74267-74276）
- `src/vm/advState.ts`（+38）：快照加 `backlog{pages,cursor,baseCursor}`（可选字段，旧档兼容）
- 注释订正：`stubs.ts`（`0x1D0` 从"未实现"改"已转真实现"）、`index.ts`、`native.ts`、`renderer/scene/ops.ts`（把「清空消息窗（引擎 0x85 …）」订正为 `0x301`/`0x71`/`sub_404F80` —— **`0x85` 不碰绘制项**）、`vm/msgwin.ts`（`textSlotArg` 标为死字段）

**测试**：新增 `test/op-1d0-page-index.test.ts` **14/14**（11 条行为 + 3 条 E3）；改写 `op-1d0-1d1-text-metrics.test.ts` **5/5**（`0x1D0` 改真行为断言，`0x1D1` 仍钉 deferred）；相关族 73/73 + 20/20 + 28/28 + `config1-chain` 10/10；`tsc --noEmit` exit 0；无新增死写。★主 agent 独立复跑 `op-1d0-page-index` + `op-1d0-1d1` + `registry-tables` + `opcode-gaps` + `opcode-arity` + 票据守卫 = **31/31 绿**。

**E3（真做到了，非卡点）**：emulator 自己的解析器实测 `install/CONFIG.BIN` = **426 条**、`0x1d0` ×1 在**帧内下标 14**、实参 `[local-int 5, 6, 7]`（与 `src/CONFIG.txt:22` 逐字对应）；用一对断言把事实钉死：① 无前奏 ⇒ 合理 `-1/-1`（`pages.length === 0`）；② 合成前奏（全是真 opcode 走真分派）+ **真产物的那一条 `i1d0` 字节** ⇒ 返回真页（`op1=1`、`op2=5` 且是合法 `ITEM_TEXT` 记录）。★诚实披露：`i1d0` 在 CONFIG.BIN 的下标 14 早于 `i1bb 0`(27)/`i071`(132)/`i1d2`(267) ⇒ 页只能来自更早的主 ADV 场景，前奏是必需且诚实的。

**★订正规格（`design.md` 有 3 处错，实施者逐条回体核出）**
1. **D1（真错）**：§6.2 #10 要求「`i085` 后 `cursor === 0`」—— **引擎不复位游标**：`sub_45EBE0`（raw 74182-74194）只清两张表，`Font[859]`/`Font[860]` 一次都没出现，也不清 `Font[849+win]` 组首。⇒ 按体实现 `clearBacklog()`（**保留游标**），只有 `0x9 exit-script` 的 `reset()` 归零；测试 ⑩ 把这个**不对称**显式钉住（并证明它不可观测：表空后恒走 raw 70712 写 `-1/-1`）。★**别让后人"顺手补全"**。
2. **D2**：§6.2 #1 的注释与断言自相矛盾（注释说页 A `start=3`，断言要 `{1,0}`）⇒ 断言对、注释错。
3. **D3**：§6.2 #5 的「`-99` 越界 ⇒ `-1/-1`」实际走 raw **70657 的 `while (v6)` 0-哨兵**，不是「表底」；`-3` 与 `-99` 同一条路。
4. **D4**：向前分支几乎总先撞 raw **70689** 的 LIVE 页哨兵（= **末条目的 start**），raw 70686 的 `v5 >= v12` 只在「游标已在末页」时可复现。

**★新发现（规格未提，已登记，本票未修）**
- **D5 默认窗有两个真源**：`msgwin.defaultWin`（初值 **1**，与引擎 `Font[307]` 一致）与 `handlers/text-items.ts` 的 `defaultWin(e)`（读 `engineValues.get(21631) ?? 0`，初值 **0**）。`0x80` 同时写两者 ⇒ 任何 `i080` 之后一致；但**在 `i080` 之前** `i071 0`/`i070 0` push 的页 `win=1` 而 `i1d2` push 的记录 `win=0`。今天不可观测（无路径按 win 过滤记录），但属潜在静默分歧。
- **D6**：`MsgWindow.textSlotArg` 是死字段（两处初始化、零赋值、订正后零读取）⇒ 已注释标记为历史遗留，**未删**（避免影响按名快照的调用方）。

**结算（主 agent）**：`analysis/opcode-gaps.json` 的 `i1d0`(464) 与 `i85`(133) 双双 `deferred → implemented`（`0x85` 的**错误理由**「GDI 文本对象的行/段容器」已订正为「清本票的两张 vector」）⇒ `deferred 22 → 20`、`已实现 36 → 38`；`opcode-table.md` 四行（`0x70`/`0x71`/`0x85`/`0x1D0`）重写（`0x71` 的「读 op1 文本」**错**已订正为**窗口槽号**）；`build-opcode-gaps.mjs` + `build-opcodes.js` 重建；`T-0085 evidence[1].line` 刷到 1526（本轮 msgwin.ts 又加约 24 行）。
