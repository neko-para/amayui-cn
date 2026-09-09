# amayui-mnemonic-rename — 指令助记符（mnemonic）改名流程

> 目标：把某个 opcode 的助记符从一个名字改成另一个名字，并保证**文档、指令集 JSON、emulator 实现、src/data 脚本**四者端到端一致。
> 关键原则：**助记符的唯一真源是 `docs-new/03-engine/opcode-table.md` 的「名称（age-shared）」列**；`scripts/asm/opcodes.json` 由 `build-opcodes.js` 从它**生成**；emulator 的汇编/反汇编都经 `opcodes.json` 的 `name` 工作。所以改名的顺序必须是**先改文档，再生成 JSON，再改实现，最后机械替换脚本**。

---

## 0. 数据流（看懂它就不会改错）
```
docs-new/03-engine/opcode-table.md  ← 唯一的 name/handler/argc 真源
        │  node scripts/asm/build-opcodes.js
        ▼
scripts/asm/opcodes.json            ← { opcode, argc, name, handler, status, aliases[] }
        │  app/amayui-emulator/src/opcodes.ts  (import .../scripts/asm/opcodes.json)
        ▼
emulator 汇编/反汇编（reassembler/disassembler、bin.ts）
```
- opcodes.json 里 `name` 为**空**的 opcode，反汇编/汇编用 `iXXXX`（如 `i1a2`、`i1a9`）作为标签；`name` 非空则直接用 `name`（如 `concat`、`load-int`）。**这就是为什么改名会改变脚本里出现的名字。**
- `src/` 与 `data/` 下的 `.txt` 是**同一批脚本的拷贝**（工作副本），都要同步；`dist/opcodes.json` 是打包用副本，也要同步。

---

## 1. 前置检查
1. 确认要改的 opcode 与**新旧名**，以及旧的**实际出现形式**（空名→`iXXXX`；有名→名字本身）。
2. `grep -rnE "旧名" src data docs-new docs` 摸清所有引用位置（脚本、指令集、文档）。

## 2. 步骤

### ① 改文档真源
`docs-new/03-engine/opcode-table.md`：把该行「名称」列（第 3 列 `| opcode | argc | 名称 | handler | ... |`）改成新名。
- 可在语义列末尾补一句「**曾名 `旧名`**」记录历史（不影响 name 列取值）。

### ② 重生成指令集 JSON
```bash
node scripts/asm/build-opcodes.js
```
确认 `scripts/asm/opcodes.json` 中该 opcode 的 `name` 已变为新名（`build-opcodes.js` 优先取文档 name 列的无意义名之外的第一个有意义名）。

### ③ 改 emulator 实现名
`app/amayui-emulator/src/vm/ops.ts`：把对应 handler 名与 `OPS`/`NATIVE_OPS` 映射注释改用新名（**逻辑不变，只改名/注释**）。例如 `op_string_bind → op_save_int`、注释里的 `string-lookup-set → load-int`。

### ④ 机械替换 src/data 引用
用本技能的 `scripts/rename-mnemonics.mjs`（词边界，安全）：
```bash
node .agents/skills/amayui-mnemonic-rename/scripts/rename-mnemonics.mjs \
  --from 旧名 --to 新名 [--from 旧名2 --to 新名2 ...] [--roots src,data]
```
- 按 token 精确匹配，不会子串误伤；只改 `*.txt`。
- 改名前的 token 若为**空名 opcode**，旧形式是 `iXXXX`（如 `i1a2`）；若**有名**，旧形式是名字本身（如 `string-lookup-set`）。

### ⑤ 重建 + 测试（真实验证）
```bash
cd app/amayui-emulator && npm run build && npm test
```
- 重点看 xval 的 `SYSTEM4/TITLE/INIT2/LOGO … 逐条一致` 测试：它把 **BIN 反汇编名**（来自 opcodes.json 的 name）与 **src txt 名**逐条比对。改名后若 src 未同步或 opcodes.json 没重生成，这里立刻失败。**通过即视为改名端到端一致。**

### ⑥ 更新其它文档 + 打包副本
- 若 `docs-new/03-engine/instruction-directions.md`、`vm-opcodes.md`、`docs/re/engine/06-opcode到handler映射表.md` 等引用旧名，一并替换为新的（保留历史注记可选）。
- 同步打包副本：`cp scripts/asm/opcodes.json app/amayui-emulator/dist/opcodes.json`。

## 3. 验证清单
```bash
# 旧名应归零（src+data）
grep -roE "\b旧名\b" src data | wc -l            # → 0
# 新名数量应等于旧名数量 × 涉及的目录数（通常 src 与 data 各一份）
grep -roE "\b新名\b" src data | wc -l
# 命令名层面：xval 逐条一致全绿
cd app/amayui-emulator && npm test
```
计数自洽：总替换数(脚本打印) == 旧名命中数 × 目录数 说明没多替换（无 false positive）。

---

## 4. 已执行示例：save-int / load-int / save-string / load-string（2025）
| opcode | 旧 | 新 | 说明 |
|---|---|---|---|
| 0x1A2 | `i1a2`（空名） | `save-int` | 写 `_this+5452` str→int 表 |
| 0x1A3 | `string-lookup-set` | `load-int` | 查 `_this+5452` 写回 op1 |
| 0x1A9 | `i1a9`（空名） | `save-string` | 写 `_this+5472` str→str 表 |
| 0x1AA | `i1aa`（空名） | `load-string` | 查 `_this+5472` 写回 op1 |

执行：改 `opcode-table.md` name 列 → `build-opcodes.js` → 改 `ops.ts` handler 名 → rename-mnemonics.mjs 替换（`string-lookup-set→load-int`、`i1a2→save-int`、`i1a9→save-string`、`i1aa→load-string`）→ 重建+测试全绿。

## 5. 相关文件
- `docs-new/03-engine/opcode-table.md`（真源）
- `scripts/asm/opcodes.json`、`scripts/asm/build-opcodes.js`
- `app/amayui-emulator/src/opcodes.ts`、`src/vm/ops.ts`
- `.agents/skills/amayui-mnemonic-rename/scripts/rename-mnemonics.mjs`（可复用替换脚本）
