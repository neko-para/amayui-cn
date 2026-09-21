# T-0082 · 过程文档（notes.md）

## 2026-09-19

B2 第二步（目标轮 7）：**arity 槽自动核验**落地。引擎每条 handler 体开头都写「本指令长度槽」_this[30*cur+95805] = N（dword 形）或 *(_DWORD*)(_this + 120*cur + 383220) = N（字节形），关系是 **N = 2*argc+1**（= 指令占用的 dword 数），而 **N = 0 表示控制流指令自己定 ip**（exit/jmp/jcc/call/ret/i199 等）。新增守卫 	est/opcode-arity.test.ts：从 dispatch 表（675996+4*op）取 handler、从体里解析 N、与 scripts/asm/opcodes.json 的 argc 逐条对照 ⇒ **解析 528 条，除 3 条控制流（0x2/0x84/0xd5，已白名单）外全部一致**。★机械收益：查出并补齐 **15 行文档 argc 空洞**（0x24b/0x24c/0x255/0x2ca/0x2cb/0x2ed/0x309/0x331/0x333/0x336/0x338/0x339/0x33a/0x33c/0x343，值取自引擎 arity 槽），重跑 scripts/asm/build-opcodes.js 后 **opcodes.json 的 argc 未知条目 0 个**；这 15 条在语料里 0 次出现 ⇒ 不影响既有 assemble。剩余：声明式操作数计划（handler 只消费计划结果）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

计划层不追求「一次性覆盖全部 574 条」，而是先覆盖：① 审计列出的 13 条错读；② 所有回写操作数的 getter 族；③ 新增实现。其余按批迁移（迁移期间允许两条路径并存，但**新写的 handler 必须走计划层**）。

## 2026-09-21

## 2026-09 · 计划层落地（B2 第三步，目标轮 8）

**新增 `src/vm/operandPlan.ts`**（声明式操作数计划 + 共享执行器）：

- `OperandPlan = { argc, kinds[], io[], evidence }`，`declarePlan()` 注册（重复声明/长度不符/缺 evidence 都当场抛）；
  `operandsFor(ctx)` 按**声明**读/写，handler 只消费结果（`p.int(1)` / `p.float(4)` / `p.setInt(1,v)`）。
- 两条硬门（把审计的错**变成写不出来的代码**）：① 声明为 `float` 的位用 `int()` 读 ⇒ 当场抛
  （`0x34B`/`0x348` 那类"把 0x3F800000 当整数 1065353216 用"的位模式错）；② 方向 `r` 的位 `setInt()` ⇒ 抛。
- **操作数记数槽（引擎 `_this[30*cur+95805]`）建模为 `Frame.operandCount`**，由 `stepOnce` 按引擎公式写
  （`operandCountSlotValue(op,argc) = 2*argc+1`；**写 0 的只有 `0x2`/`0x84`/`0xd5`** —— 实测 `jmp`/`call`/`jcc`/`ret`
  照写 `2*argc+1`，审计里"控制流一律 0"的说法要按体订正），并经 `StepTrace.operandCount` 报给控制窗。
  ★**命名按数据层订正**：引擎里叫 `arity` 的是 `ScriptContext+0x60`（装载清零、**无读者**）；本槽的正式名是
  `ScriptContext/0x74 operand_count`（绝对 0x5D8F4）⇒ emulator 侧新字段叫 `operandCount`（旧 `Frame.arity` 字段
  的注释说对了语义、名字是错的，已一并订正）。
- **迁移批次 1（12 条）**：`0x347`/`0x348`/`0x349`/`0x34A`/`0x34B`/`0x34C`/`0x34D`（Live2D 节点变换，int/float 混排）、
  `0x32`（10 个 int）、`0x1F9`、`0x20F`、`0x202`、`0x203` —— 全部是审计点名或回写操作数的族。

**新增守卫 `test/operand-plan.test.ts`（4 条）**：
① 计划 argc ⟷ `scripts/asm/opcodes.json`（文档口径）+ kinds/io 长度/evidence 自洽；
② **模型 ⟷ 反编译体**：`operandCountSlotValue()` 逐条等于体里写的 N（528 条解析），且"体里写 0 的集合"必须**恰好**等于 `ZERO_LENGTH_OPS`；
③ **计划 ⟷ 实现**：已迁移 handler 碰过的位（args Proxy 观测）必须覆盖计划声明要读的位、且不越界；
④ 运行期：`0x32`（argc 10）⇒ `operandCount=21`、`0x2` exit ⇒ `0`（且帧字段与 trace 同源）。

**顺带**：扫描口径抽成 `test/arityScan.ts`（两个守卫共用一份 —— 原来 `opcode-arity.test.ts` 内联一份，再抄一份必漂移）。

**判据（本轮）**：`npm run typecheck` 3 配置绿；`npm test` **947 pass / 0 fail / 1 skip**（948 条）；`npm run check:dead-writes` 无新增死写。

**仍未做（票不能结的理由）**：判据 1 要求"覆盖审计 13 条 + 所有『已核对』行"（574 条）⇒ 现在是 **12/574**；
判据 5（`opcode-table.md` 的 argc 列全部有据）在上一轮已到位（15 行空洞补齐、`opcodes.json` 未知 argc = 0）。
后续按子系统分批迁移（每批一批 handler + 计划声明 + 全测试绿）。
