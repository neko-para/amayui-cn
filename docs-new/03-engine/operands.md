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
