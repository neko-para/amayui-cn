# T-0080 · B7（P2/P3 清尾 218 条）覆盖分类：结论与复核口径

> 出处：2026-09-22 一次**只读**分类作业（子代理执行，父代理逐条抽查关键结论）。
> 数据源（机器可读明细，`tickets/T-0075/evidence/`）：`audit-final-opcodes.json`（kept 95）、
> `audit-final-capabilities.json`（kept 84）、`audit-final-docs.json`（kept 67）—— 三份合计 246，
> 减去 P0/P1 的 28 条 = **B7 的 218 条**（与 `audit-2026-09.md` §6 的「218 条」精确吻合）。

## 1. 筛选口径（无歧义）

- `severity` 字段就是 `"P0"|"P1"|"P2"|"P3"` 字符串；B7 = `severity ∈ {P2,P3}` 的 kept 条目。
- 逐份：opcodes 85（P2 28 / P3 57）、capabilities 75（30 / 45）、docs 58（20 / 38）⇒ **218**。
- ★别把 `analysis/opcodes.json` 的 `status`（形如「已核对（2026-09）」）当成审计 severity —— 两者无关。

## 2. 四类判定计数（218 条）

| 现状判定 | opcodes | capabilities | docs | 合计 |
|---|---|---|---|---|
| 已修（stale） | 64 | 52 | 22 | **138** |
| 已修（部分） | 8 | 12 | 6 | **26** |
| 真缺口-已被票覆盖 | 0 | 2 | 1 | **3** |
| 真缺口-无人承接 | 5 | 7 | 21 | **33** |
| 纯记账（no-evidence/措辞/旧 `.tmp` 快照） | 5 | 2 | 0 | **7** |
| 无法判定 | 3 | 0 | 8 | **11** |

⇒ **204/218（93.6%）不需要动手**；真正要做的收窄成 **3 张票**（见下）。

## 3. 可以随 B7 关闭的结构性证据（可复算）

1. **opcode 侧零注册缺口已不存在**：`buildGapReport()` 现场值 `problems=[] corpusKinds=338 registeredCount=365
   internalCount=13 missing=0 unimpl=0 unjust=0`（守 `test/opcode-gaps.test.ts`）；
   `analysis/opcode-gaps.json` 的 `unimplemented=0`、`engine-internal-unjustified=0`。
   语料实测仍未注册的 opcode 只剩 **语料 0 处**的那批（0x83/0x1C5/0x2C2/0x105/0x2CA/0x309/0x339/0x14/0x1F/0x22E/0x860/0x904/0x923/0x353/0x361/0x391/0x517）。
2. **capabilities 侧的 `no-evidence` 已被 schema 守卫结构性消解**：`engine.raw` 必须形如 `NNN-MMM`、
   `E2/E3` 必须有真实存在的 `guard`（`test/capability-ledger.test.ts`）。
3. **审计引用的两份文档已消失**（`stub-reaudit-2026-09.md`、`vm-opcodes.md`，属 `T-0105` 的文档收尾）
   ⇒ 6 条 docs 条目随之失效。
4. **旧 `.tmp/opcode-index.json` 快照类条目**（op9-op137 / op3-009 / op-5-008 / op-9-op500 / op-10-007）：
   被引对象已不作真源 ⇒ 纯记账。
5. **审计条目本身会过期**（审计报告 §6 已自我声明）：本轮逐条核代码后，164 条已被后续轮次修掉。

## 4. 必须保留的真缺口（B7 不能掩盖的部分）

### A. 影响可见行为（→ 新票 `T-0109`）
| 条目 | 现状 |
|---|---|
| `engine-capabilities.json#msgwin-backlog-cursor` | `absent` / E0 / **无 guard**；`raw 70575-70627`。页表不建 ⇒ 回看滚轮无反应、0x84「翻到底」永不置位 ⇒ **脚本停在自旋里**（`whySilent` 原话） |
| `engine-capabilities.json#text-layout-wrap-ruby` | `absent` / E0 / **无 guard**；`raw 83363-83997`。逐字量宽/右边界硬断/注音配对与引擎不一致 ⇒ 行数/每行字数与 `0x83/0x1C5/0x2C2/0x2F3` 全部对不上（从像素层渗到 VM 层） |

### B. 机制文档残留订正（→ 新票 `T-0110`，纯机械）
- `scene-start-flow.md`：① GAMESTART 三按钮的 `count` 写 **3**，而 `src/GAMESTART.txt` **全文件只有 1 处**写
  `(local-int 0)`（第 69 行 = **17**）且 :115 把它作为 `i12e` 的 **op8 = count** 传入（签名见 `scene-start-flow.md:57`
  与 `input-system.md:288/365`）⇒ **文档数字错**；② `0x1AD`「唯一读者在存档序列化」；③ §5 把 `#serviceAnimGate`/`scAnimationsDone`
  写成 emulator 实现（这两个符号在 `src/` 里不存在，真源是 `Engine.waitFlags`/`gatePending`）。
- `rendering.md`：`_this[11631]`=369356「**全文件只被清零、从不设正**」（已被 0x238 raw 32309-32310 证伪）、
  逐帧求值记 `sub_49A300`（与同文 `sub_49AA30` 并存）、`0x323` 写成「静态遮罩无逐帧计时」（与同文动画窗口径冲突）、
  「三路归并」只列两张表（漏 `_this+1096` 的 572B 节点路）。
- `engine-reset-mainloop.md`：三处把 `engine_bool_flag`(0xA30D4) 写成「未建模/建议增加」，而
  `app/amayui-emulator/src/vm/engineFieldIds.ts` 已有 `engineBool: 166965` 且 `0x21B/0x247` 已注册。
- `sound-system.md` §1：「10/11 未分配」与同文「走设备通道 11」自相矛盾。
- `adv-text-rendering.md`：§5.2 仍把 `0x8B` 记成「第三个颜色位」（同文其它三处已写对「行间距」）、
  §3.5 把 `0x204` 写成「GDI 一次性整串」、`AutoLineFeed`（`Font+1404` 门）未补、禁则表结论不完整。
- `save-data.md:262`（0x1A1「不写操作数」）、`flow-control.md:34`（`387932`/`383104` 混用）、
  `instruction-directions.md:102`（i0c0 归类依据）、`message-config-gates.md` 题头取值来源。
- 逐格待核（**不许当结论**）：`adv-text-rendering.md` 字段表 4 处行号、`copyright-effect.md` §6 索引表行号、
  `engine-reset-mainloop.md` 的 Queue/Stack 构造数、`save-data.md` 的 `set:CreateObject` 默认值。

### C. 低影响登记 / 派发接线（→ 新票 `T-0111`）
- `opcode-table.md` 行同步：`0x304` 仍 `仅映射`+空语义（`analysis/opcodes.json` 同；但运行时 `OPS` 已注册
  `op_text_block_begin`）⇒ 四方口径不一；同族 `0x105/0x2CA/0x309/0x339/0x026/0x144/0x2FD/0x22E`（**语料 0 处**）
  可补语义或转 `deferred`；`0x1D3` 的 handler 锚点（表里 `sub_42D4A0` vs `opcodes.json` 的 `sub_457960`）。
- `0x308`（输入触摸注册）：`app/amayui-emulator/src/vm/handlers/stubs.ts` 仍是
  `[0x308, op_stub_unhandled]`（记录后放行），语料 **31279 处** ⇒ 近似放行面。
- `0x1F5` → `sub_40FB60` 派发未接线（`src/frame/frame.ts` 自述「本条尚未接线（`T-0057` 记录）」）。
- 3D/Live2D 内部面（`passive-camera-and-effect-render-state`、`vertex-buffer-lock-scale`、`lazy-movie-*`）：
  `plan-2026-09.md` §1 RF-C 与审计 §4 已把 3D/Live2D 内部显式排除 ⇒ 记为**范围外**，不新开票。

## 5. 父代理抽查（子代理结论的可核对性）

| 抽查项 | 命令/读点 | 结果 |
|---|---|---|
| 4 条 absent 能力 | `node -e` 读 `analysis/engine-capabilities.json` 的 status/evidence/guard/raw | 4 条全 `absent`/E0/无 guard ✔ |
| GAMESTART count | `grep '(local-int 0)'` 的写点 + `src/GAMESTART.txt:115` | 全文件仅 1 处写（:69 = 17），且 :115 作 op8 传入 ✔ |
| engine_bool_flag | `engineFieldIds.ts` / `stubs.ts` | `engineBool: 166965` 在册；`[0x308, op_stub_unhandled]` 在册 ✔ |
| 误建文件 | `Test-Path .agents/tmp-t0080-probe.mjs` | `False`（子代理自述已删，确认已清）✔ |

## 6. 结论

B7 作为**批次**可以标记完成：218 条里 204 条已是「已修/纯记账/文档已改」，且这个"已消化"有**结构性守卫**
兜底（`opcode-gaps` 的 `missing=0`/`unjust=0` + capability schema 守卫 + 文档改写实证）。
剩下 14 条**不掩盖**：`T-0109`（可见行为，2 条）、`T-0110`（文档残留，~12 条）、`T-0111`（低影响登记，~10 条）。
