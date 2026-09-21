# T-0098 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：`0x2ED` 读侧注册 + `0x107`/`0x10B`/`0xFE` 的无符号口径（三条全落地）

### ① `0x2ED` 读侧（`CFG_READ` 新增一条）

- 体核实（`sub_431230` raw 40401-40409）：arity 槽 `3` → `GetConfig("message:MessageFade")`
  （配置对象 `_this[174405]` 的 vtable+4；键名是**常量** `aMessageMessage_0` raw 4380）→ `sub_42B4B0(_this, 1, v2)` 写 op1。
- 实现：`handlers/config-read.ts` 的 `CFG_READ[0x2ed] = { operand: 1, key: CFG.messageMessageFade }`
  ⇒ 与写侧 `0x2EE` 走**同一个注册表键**，读→写闭环成立。
- 数据层：`analysis/opcodes.json` 的 0x2ED `仅映射` → `已核对（2026-09）` + semantics；重跑 `build-opcode-table.mjs`
  （生成行已更新）。

### ★② 一处**前提订正**（票面 acceptance 3 的一半不成立）

票面写「把 `analysis/opcode-gaps.json` 的 `0x2ED` 处置从 `unimplemented`/`deferred` 按实际改」——
**该文件里没有 0x2ED 条目**：那份台账只收「**语料用到**但未注册」的指令，而 0x2ED 在本作语料里 **0 处**
（`grep` 全 941 脚本）⇒ 它从来不是缺口登记项（这也解释了为什么"未注册却从未爆"）。
⇒ 只改了 `analysis/opcodes.json`；`build-opcode-gaps.mjs` 仍绿（未实现 0 / unjustified 0 / 有据 no-op 13 / 已实现 39 / deferred 19）。

### ③ `0x107`/`0x10B`：**无符号**比较（两条都不抛，只是不写）

体（`sub_421E50` raw 30516-30527 / `sub_422070` raw 30603-30613）：
```c
result = sub_41BF50(_this, 1);      // ★unsigned int
if ( result <= 0x1F ) _this[…+基址] = …;
```
⇒ `op1 = -1` 按无符号是 `0xFFFFFFFF` ⇒ **门不通过 ⇒ 不写表、不报错**。
旧实现 `key <= 0x1f` 是 **JS 有符号**比较 ⇒ 负数**通过**门并写进 `负数 + 基址` 那个**别的槽**（静默写错地方）。
修法：`(v >>> 0) <= 0x1f` + 越界时 `c.log` 一条（引擎此处无消息 ⇒ 日志只是诊断，不改 VM 态）。

### ④ `0xFE`：**真抛**（引擎 `ShowMessage`）+ 字段不写

体（`sub_421CA0` raw 30443-30459）：`result`（unsigned）`> 0x1F` ⇒
`_CxxThrowException(Command_ShowMessage("SetKeyTotalの引数が不正です．" /* aSetkeytotal raw 4418 */, 65541))`，
**抛在写之前**（raw 30451-30456 在 30457 之前）⇒ 越界时 `Engine[517]` **一格不动**。
- 旧实现把它挂在通用 `ENGINE_FIELD_STORE` 上"照存" ⇒ ① 负数既不抛也不报错、② 越界值照样写进 `Engine[517]`
  （而那格是 `0x100` 的默认键槽下标与掩码扫描上界 ⇒ 后面会被当数组下标用）。
- 修法：新增专属 handler `op_set_key_total`；越界抛**新错误类** `ShowMessageError`（`vm/native.ts`，
  与 `UnknownFlagError` 同一族：引擎在体里抛 ⇒ emulator 也硬中断），消息带**引擎原文** + opcode + 细节；
  走 `session.#onError` 的**既有**通路（粘住文本 → 控制窗横幅 → 停止）—— 不新造机制、不静默（用户轮 7 裁定）。

### 守卫 `test/op-2ed-and-bit-index.test.ts`（6 条）

① `i2ee 40` → `i2ed` 读回 **40**（真指令闭环；读局部槽用 `decIntSlot` 解码 —— 池里是 ENC 存的）；
② `0x107` 负数/0x20 ⇒ 表槽不存在且 `engineValues` 逐键不变；0..0x1F ⇒ 正常写；
③ `0x10B` 同型（值侧越界不写、键照用）；④ `0xFE` `-1`/`0x20`/`0x100` ⇒ 抛 `ShowMessageError`
（消息含引擎原文与 `0xfe`）+ 字段保持原值；⑤ 合法值 `i0fe c` ⇒ 写 12；⑥ 四条指令 argc 自检。

### 验证

`npm run verify` 全绿（typecheck ×3 + 全量测试 + 死写闸门）；`doc-model`/`opcode-gaps`/`opcode-operands` 守卫在列。
