# T-0082 · 过程文档（notes.md）

## 2026-09-19

B2 第二步（目标轮 7）：**arity 槽自动核验**落地。引擎每条 handler 体开头都写「本指令长度槽」_this[30*cur+95805] = N（dword 形）或 *(_DWORD*)(_this + 120*cur + 383220) = N（字节形），关系是 **N = 2*argc+1**（= 指令占用的 dword 数），而 **N = 0 表示控制流指令自己定 ip**（exit/jmp/jcc/call/ret/i199 等）。新增守卫 	est/opcode-arity.test.ts：从 dispatch 表（675996+4*op）取 handler、从体里解析 N、与 scripts/asm/opcodes.json 的 argc 逐条对照 ⇒ **解析 528 条，除 3 条控制流（0x2/0x84/0xd5，已白名单）外全部一致**。★机械收益：查出并补齐 **15 行文档 argc 空洞**（0x24b/0x24c/0x255/0x2ca/0x2cb/0x2ed/0x309/0x331/0x333/0x336/0x338/0x339/0x33a/0x33c/0x343，值取自引擎 arity 槽），重跑 scripts/asm/build-opcodes.js 后 **opcodes.json 的 argc 未知条目 0 个**；这 15 条在语料里 0 次出现 ⇒ 不影响既有 assemble。剩余：声明式操作数计划（handler 只消费计划结果）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

计划层不追求「一次性覆盖全部 574 条」，而是先覆盖：① 审计列出的 13 条错读；② 所有回写操作数的 getter 族；③ 新增实现。其余按批迁移（迁移期间允许两条路径并存，但**新写的 handler 必须走计划层**）。
