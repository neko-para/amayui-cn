# T-0111 · 判据② 专档（changes-c163.md）

> 本轮只做**判据②**（`0x308` 触摸注册的处置）。判据① 由别人负责、判据③ 已由 `T-0157` 完成（票面已写明），
> **未动**。本票保持 `doing`。

## 1. 处置 = 有据 no-op 登记（票面路线，本轮执行完毕）

| 项 | 内容 |
|---|---|
| 体 | `sub_426B20`（raw **33808-33815**）：arity 槽 3 ⇒ argc 1；`v2 = sub_41BF50(_this, 1)`（读 op1）→ `sub_407B20(dword_55E1BC, _this[96981], v2)` |
| 被调体 | `sub_407B20`（raw **12579-12618**）：`LoadLibraryA("USER32.DLL")`（字面量 raw 4292）→ 门 `a3 \|\| (GetConfig("system:LimitTouch") & 1)`（raw 12590；字面量 raw 4291，只取 bit0）⇒ 真取 `GetProcAddress(h, "UnregisterTouchWindow")`（raw 4289）调 `(hwnd)`；假取 `"RegisterTouchWindow"`（raw 4290）调 `(hwnd, 2)`；随后 `FreeLibrary` |
| 字段 | `_this[1954] = op1`：三条出边都写（raw 12605/12610/12615）；`grep '1954]'` 全反编译 **3 命中、0 读** ⇒ 对 VM 不可观测，且不建模（死写） |
| 语料 | **31279 处 / 345 个文件**（本机 `^i308 ` 实测，与审计一致） |
| 为什么 no-op | 唯一真实副作用是 USER32 的**窗口级**触摸注册；emulator 无 HWND（`_this[96981]` 无对应物）、无窗口级触摸注册面（触屏/指针输入由 Electron/DOM 层持有）⇒ **无宿主触点源可复现**；造空实现只是把"无触点"换地方写，还会给 `_this[1954]` 造假消费者 |
| 代码落点 | `src/vm/handlers/stubs.ts`：`[0x308, op_stub_unhandled]` **移出** `STUB_NATIVE_OPS` ⇒ 改登记 `[0x308, op_engine_internal]`（带 why + raw 锚点）；`op_stub_unhandled` handler 与其 `unhandled` 日志点**删除**；`STUB_NATIVE_OPS` 现为空数组（导出保留，被 `handlers/index.ts` 展开） |
| 守卫 | `app/amayui-emulator/test/stub-308-touch-register.test.ts`（3 例）：① 登记位置（`ENGINE_INTERNAL_OPS` 有、`OPS`/`NATIVE_OPS` 无、`STUB_NATIVE_OPS` 空）；② 跑一步 = `handlerKind='engine-internal'`、`native.unhandled` 零调用、`engineValues.has(1954)===false`、ip 前进；③ 源文棘轮（旧登记串消失 + 文档含 USER32 两侧导出名/门/字段/raw 锚点/语料量） |
| 锚点棘轮 | `evidence[2]` 的原锚点 `[0x308, op_stub_unhandled]` 随改写消失 ⇒ 已 **retarget** 到 `[0x308, op_engine_internal]`（`stubs.ts` 现第 355 行）；`tickets.js --validate` = ✅ 172 张 |
| 红→绿 | 新守卫（含 T-0163 的另 3 个文件）**红 5/14 → 绿 19/0**；既有 11 个相关守卫文件 **48/0** |

## 2. 台账片段（与 `tickets/T-0163/changes-c163.md` §3 同源，此处只给 (a) 与 (b) 的要点）

- **(a) `analysis/opcode-gaps.json` 新增 `0x308` 条目**（`disposition: "engine-internal"`、
  `handlerBodyLine: 33807`、`ticket: "T-0111"`、note 写「语料 31279 处 / 345 文件；体只调 USER32
  （`RegisterTouchWindow`/`UnregisterTouchWindow`，门 `op1 \|\| GetConfig("system:LimitTouch")&1`）
  + 写 `_this[1954]`（3 写 0 读）⇒ 无宿主触点源可复现，登记为有据 no-op」）——完整 JSON 见
  `tickets/T-0163/changes-c163.md` §3(a)。
- **(b) `analysis/opcodes.json` / `opcode-table.md` 的 `0x308` 行**：**已存在**（`opcode:776, argc:1,
  handler:"sub_426B20", status:"已核对"`；`opcode-table.md:528` 已渲染）⇒ 票面"表行缺失"的前提**不成立**；
  建议只把 `semantics` 换成带门/两个导出名/字段写/语料量的版本（片段见 §3(b) 同处）。
- **(b′) `0xDD`**：**前提被推翻** —— 派发槽 `675996 + 4*221 = 676880` 在整份反编译里**零赋值**
  （`grep 676880` 0 命中；邻槽 676872..676888 同），只被 `memset32(..., sub_418E30, 0x400)`（raw 22722）
  填成默认 handler；`analysis/opcodes.json` 的 `entries` 与 `fallbackDefault.entries` 都不含 221；
  `scripts/asm/opcodes.json` 不含 221；语料 `^idd ` 0 处 ⇒ **不是本作指令，表行本就不该有**。
  建议把票面那句改成"已核：`0xDD` 非本作指令，无需表行"。
- **(c) `analysis/engine-capabilities.json`**：**建议不为 `0x308` 新增能力条目**（单条指令的宿主副作用，
  不属"跨指令常态能力"）；若坚持要，形状见 `tickets/T-0163/changes-c163.md` §3(c)。

## 3. 交接（不在本票文件范围）

- `src/vm/operandPlan.ts:1421` 的注释仍写「emulator 是 `op_stub_unhandled`」⇒ 需改指 `op_engine_internal`
  （本票未动该文件）。
- `test/opcode-operands.test.ts:53` 的白名单文本（「STUB_NATIVE_OPS 的 unhandled 桩」）措辞过期；
  该白名单**条目本身仍需要**（0x308 是 argc=1 但不读操作数的有据豁免）。
- 若将来要做真接线：宿主缝 `registerTouchWindow(hwnd, unregister: boolean)` + 配置读
  `system:LimitTouch` bit0，落在 `src/vm/native.ts` / `src/vm/nativeTap.ts`（归 B2）。
