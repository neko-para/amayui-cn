---
kind: narrative
state: live
---
# 03-engine · 操作数访问原语（已瘦身）

> ⚠️ 本文件**不再重复**各原语函数/字段结论——它们已在数据层与技能操作数模型中，属唯一事实来源：
> - **读写原语函数结论**（`readIntOperand_41BF50`、`readFloatOperand_41C300`、`writeIntOperand_42B4B0`、`writeFloatOperand_42BA00`、`operandAddress_42AEA0`、`writePointerOperand_418B90`/`writePointerElement_418CC0`）→ `analysis/functions.json`。
> - **操作数池字段/偏移**（`pool_int/float/string`、`pool_*_count`、`local_*`、帧池）→ `analysis/fields.json`。
> - **操作数类型 tag → 池映射 / DEC / ENC / 读读原语** → 技能 `amayui-engine-analysis` §6「操作数模型」。
>
> 仅保留最常用的**速记**：

## DEC / ENC（去混淆）速记
- `DEC(x) = ror32(key ^ rol32(x, 11), 25)`
- `ENC(x) = rol32(key ^ ror32(x, 7), 21)`
- `key` = `_this[97059]`（byte `0x5EC8C`）；`enc_zero` = `_this[97060]` = `ENC(0)`。

## 指针 = 带标记引用（ADR-011）
- 指针不当数值，而是 `Ref = { scope, kind, index, stride }`：**读**按 `kind/index` 解引用取目标值；**写**写穿（写进最终目标，而非引用槽本身）。
- ⚠️ 隐患：`lea`/`lookup-array`/`memcpy` 若把指针当纯数值会出错——重写工程（`app/amayui-emulator/src/vm/operand.ts`）按「引用」模型实现。

## ★「操作数记数槽」= 指令长度 = 派发器的 ip 推进量（`tickets/T-0082`）

引擎**每条 handler 体**开头都写一次「本条指令占几个 dword」：

```
_this[30 * _this[95776] + 95805] = N;                     // dword 形式（多数）
*(_DWORD *)(_this + 120 * cur + 383220) = N;               // 字节形式（同一格的另一种写法）
```

- **`N = 2*argc + 1`**（每个操作数 2 dword：类型 tag + 载荷；`+1` 是 opcode 自己）。
  实证链：argc 0→1、1→3、2→5、5→11、7→15、8→17；`0x1A0`（argc 9）写 19。
- **派发器就用它前进**：`_this[30*cur + 95782] += 4 * _this[30*cur + 95805]`（raw **20165**）
  —— `+95782` 是本帧的 ip（字节地址），`×4` 是 dword→byte。
- **唯一的例外是写 0 的三条**：`0x2` exit（`sub_41A820`）、`0x84`（`sub_41F790`，op1 是控制流目标）、
  `0xd5`（`sub_42ACC0`，op1 = 输入打断 label）—— `N = 0` ⇒ 派发器**不前进**，ip 由 handler 自己改。
  ★**`jmp`/`call`/`jcc`/`ret` 不在此列**：它们照写 `2*argc+1`（`0x8c`→3、`0x8f`→3、`0xa0`→7、`0x5`→1）。
- 另有两条指令**专门写这一格**当"设定件"：`0xAF`/`0x1A8`（`sub_419690`，同一个 handler）
  = `_this[30*cur+95805] = 1`（raw 24775-24783）。

⚠️ **命名陷阱**：引擎里叫 **`arity`** 的是**另一格**（`ScriptContext+0x60`，装载时清零、**没有读者**）；
本格在数据层里的正式名是 **`ScriptContext/0x74 operand_count`**（绝对字节 `0x5D8F4`，
曾因帧基址误记 `0x5D894` 而把两者混为一谈 —— 见 `analysis/fields.json` 该条的 `meaning`）。
重写工程的 `Frame.operandCount` / `StepTrace.operandCount` 指的是**本格**。

> 为什么记在这里：`argc` 的**引擎真源**就是这一格，它让「文档 argc / 实现读了几个 / 引擎体写了几」
> 可以机械对照（守卫 `app/amayui-emulator/test/opcode-arity.test.ts` 与 `test/operand-plan.test.ts`）。
> 审计实证过文档与体不一致的例子：`0x1E` 文档写 8、体只读 7。

## ★读写方向速记（读 `src/*.txt` 时最容易读反的一处）

算术族（`0x50`–`0x59`）签名一律 **`<op> dst src1 src2`** ⇒ `dst = src1 (op) src2`：

| 写法 | 含义 | 例 |
|---|---|---|
| `sub dst a b` | `dst = a - b` | 一般减法 |
| **`sub dst 1 dst`** | **`dst = 1 - dst` = 取反（0↔1 开关）** | ADV 侧边栏 LOCK 开关：`SN0000.txt:232` 的 `sub (global-int 139a) 1 (global-int 139a)`。**别读成 `dst -= 1`**（dst 与 src2 同槽只是"就地更新"，不是自减） |
| `sub dst 0 1` | `dst = -1`（"置 -1"惯用法，常用来禁用某槽） | `SN0000.txt:1093`（`1397`） |

对照两种"开关"的持久化差别：
- **会话级**：`139a`（LOCK）只有上面那一条写入端，不落存档；场景启动据此决定侧边栏初始态（`$1$SC*.txt:1075-1077`）。
- **配置级**：`139d` 走 `i1cb`(读配置) → 取反 → `i1ca`(写配置)（`SN0000.txt:443-445`），另一处走 `i1b6`/`i1b7`（`:460-462`）。

> 教训（`tickets/T-0028`）：把 `sub dst 1 dst` 读成自减 ⇒ 结论会变成"开关打开后关不掉、`139a` 只减不增"，
> 进而误判"缺自增端"。**同槽即取反**这条要先用 `dst`/`src` 位置核对，再谈"缺失写入端"。

