# 03-engine · 操作数访问原语

## 1. 读写 int/float

- ✅ 读 int 操作数：`sub_41BF50`；读 float：`sub_41C300`。按 type 分支 + `DEC` 去混淆，含 `0x8003/0x8009` 整型数组批量。
- ✅ 写 int：`sub_42B4B0`；写 float：`sub_42BA00`（`ENC` 为 `DEC` 逆运算）。

## 2. 地址/指针原语

- ✅ `sub_42AEA0` = 取操作数内存地址/指针（`operandAddress_42AEA0`）。
- ✅ `sub_418B90` = 把值写入指针型操作数槽（`writePointerOperand_418B90`）。
- 两者为 `lea`(0x63) / `memcpy`(0x1B0) 的底座。

## 3. DEC / ENC（去混淆）

- ✅ `DEC(x) = ror32(key ^ rol32(x,11), 25)`
- ✅ `ENC(x) = rol32(key ^ ror32(x,7), 21)`
- `this + 0x5EC8C`（DWORD 索引 `_this[97059]`）= `key`；`_this[97060] = ENC(0)`。

## 4. 指针 = 带标记引用（ADR-011 指针模型）

- ✅ **指针不当数值**，而是带标记的引用 `Ref = { scope, kind, index, stride }`：
  - **读**：按 `kind/index` 解引用取目标值；
  - **写**：写穿（写进引用的最终目标，而非引用槽本身）。
- ⚠️ 隐患：`lea`/`lookup-array`/`memcpy` 若把指针当纯数值处理会出错——这是重写工程必须按「引用」模型实现的原因。
- 相关：`app/amayui-emulator` 的 `operand.ts` 中把 `DEC/ENC` 与 `readInt/Float/writeInt/Float` 归一为带标记引用的读写（见 `../04-app/emulator.md`）。

## 5. 交叉引用

- `this` 布局/帧/调用栈见 `./runtime-memory.md`。
