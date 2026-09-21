# T-0104 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 轮 10：`0x82` 转真实现（**不是**再"放行"）—— 判据 1/2/3 前半/4 落地

### 实现（`src/vm/handlers/msgwin.ts` 的 `op_gdi_repaint_window`，注册进 `MSGWIN_OPS`）

1. **按计划层读 op1..op5**（`operandPlan.ts` 新增 `0x82` 计划：5 个 int，evidence = handler 体 raw 28808-28826 的
   五格 `sub_41BF50`）；**先读完五格再进门** —— 与引擎同序（那道越界门在**被调**体 `sub_466000` 里）。
2. **越界门**（raw 79502 `if (v8 > a3 && a3 >= 0)`）：`op2` 不在 `Engine.textItems.records` 里 ⇒ **整条什么都不做
   （连颜色都不改）**。记录表 = 引擎 `Font[841..842]` 的 72 B 向量，与 `T-0095` 的 `textItems.ts` 是同一张表。
3. **设色**（`op3 & 2`，raw 79663-79669）：`op4`/`op5` 经 **`bgrToRgb`** 覆盖 `ENGINE_FIELD.colorFill` /
   `colorOutline`。★`bgrToRgb` 是新的**单一真源**：`0x76`/`0x77`（`ENGINE_FIELD_STORE` 的两条 `transform`）
   也改用同一个函数（原先那两段位运算与此处逐字相同，两处必漂移）。
4. **重发布该窗**（`emitWin(op1)`）：与 `0x20A`（`op_window_relayout`）**同一条发布通路** —— 这是
   "已排版的旧颜色文本被刷新"的唯一通路（`i082` 不写任何操作数、不改 VM 态 ⇒ 可见效果只有这一条）。
5. `STUB_NATIVE_OPS` 的 `[0x82, op_stub_unhandled]` 条目删除；`test/opcode-operands.test.ts` 的 `ALLOW_UNDERRUN['0x82']`
   条目删除（现在五格全读 ⇒ 守卫自然绿，删条目本身就是"修好了"的机械证明）。

### 数据层 / 生成物

- `analysis/opcodes.json` 的 `0x82` semantics 尾句改为实现现状；→ `node scripts/build-opcode-table.mjs`
  （`docs-new/03-engine/opcode-table.md` 的 `0x82` 行随之更新）。
- `analysis/opcode-gaps.json` 的 `0x82`：`disposition: deferred → **implemented**`、`docStatus → 已核对`，
  note 重写（含三条**登记的近似**）；→ `node scripts/build-opcode-gaps.mjs`
  （汇总：未实现 0 / unjustified 0 / 有据 no-op 13 / **已实现 39** / deferred 19）。

### 判据

- **守卫**：`test/op-0104-gdi-repaint.test.ts`（**6 条**，替换原来的 `op-0104-gdi-repaint-stub.test.ts`）：
  ① 静态表真实现（`handlerKind === 'implemented'`）；② `op3 & 2` ⇒ 两色被 `bgrToRgb` **覆盖**；
  ③ 无 bit1 ⇒ 一个颜色都不动；④ **越界门**（记录表 3 条、op2=6）⇒ 引擎字段**一格不动**；
  ⑤ 恰好重发布一次（宿主 `msgWinSync`）；⑥ 语料形状端到端不硬停、不写操作数。
- **场景级**（判据 3 后半）：`test/config1-chain.test.ts` 的「退出设置页重派生」用例新增
  `AdvReturnProbe.republishByI082` / `recordsAtI082` 两个观测位 + 断言。
  ★**实测结论（重要，别误读）**：这条链路里 `recordsAtI082 = 0`（CONFIG 页不 push 文本项记录）
  ⇒ 引擎那道门 `v8 > op2` 本身就不成立 ⇒ **引擎在这里也什么都不做**，emulator 的 0 次重发布是**一致**而非缺失。
  正向用例由合成记录表的单测覆盖；断言写成"两者必须一致"（记录表为空 ⇒ 0；非空 ⇒ ≥1）。
- `npm run verify` 全绿（typecheck ×3 + 全量 test + 死写闸门）。

### 仍未做（票不结的理由）

- 判据 5 的 **E4**（用户口径：ADV → 设置界面 → 右键退出、界面文字正确）需要真界面 ⇒ 本机 headless 不能替代。
- 判据 3 的"真实 CONFIG 路径上文本窗被重新发布"只在**记录表非空**时才可能为真；要造出非空记录表的
  场景级正向用例，需要在链路里先显示一条 ADV 消息（本轮未做，登记在此）。
- `mode == 1` 走 `sub_462040` 的专用路径、`op3` 其它位、`op2` 的重画粒度（emulator 整窗重排）仍是登记的近似。
