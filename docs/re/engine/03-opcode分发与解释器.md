# opcode 分发机制与解释器主循环（engine）

> 级别：**已确认**（`.lst` 反查 + C 反编译实证）。
> **核心卡点的最终结论**：opcode 分发是**一维函数指针表**，非 switch、非两层表。
> 突破口 = 「模运算指令 ⇒ 找 `a % b` 且两操作数非立即数」 → 定位算术 opcode 簇 → 由 `.lst` 反查到 dispatch 表初始化 + 解释器分发点。

---

## 1. 操作数访问原语（每 opcode handler 的骨架）

每个 opcode handler 是无参形式 `void __thiscall sub_XXXX(_DWORD *this)`（`this` = `Command` VM 对象）。

- **读参数**：`sub_41BF50(this, N)` → 读第 N 个操作数（typed arg）。它内部按**参数类型** `switch(v3)` 分发：
  - `0`=立即 int、`1`=float、`2`=local-string→`atoi`、`3`=global-int、`4`=global-float、`5`=global-string、`6`=global-ptr、`7`=global-float-ptr、`9`=local-int、`10`=local-float、`11`=local-string、`12`=local-ptr、`13`=local-float-ptr；`32777`(0x8009)=整型数组批量、`32771`(0x8003)=…（未细究）。
  - 全局/局部整型都解码为 `__ROR4__(this[97059] ^ __ROL4__(v, 11), 25)`（**异或 + 循环移位混淆**，跨 `this[97059]` key）。对应 `age-shared.h` 的 arg.type（0..0xE、0x8003..0x800B）。
- **写结果**：`sub_42B4B0((int)this, N, val)` → 把 val 写入第 N 个操作数。
- **参数字节数**：`*(this + 120*cur_script + 383220)`（每 arg=4 bytes 的“长度/步长”）。

---

## 2. 算术/位运算 opcode 簇（handler 地址 → 语义，与 age-shared 完全对照）

| opcode | 名称 | handler (本文档引擎) | 反编译体 |
|---|---|---|---|
| 0x50 | add | `sub_42C5E0` | `ret sub_42B4B0(this,1, v3+v2)` |
| 0x51 | sub | `sub_42C620` | `v3 - v2` |
| 0x52 | mul | `sub_42C660` | `v3 * v2` |
| 0x53 | div | `sub_42C6A0` | `v3 / v2` |
| **0x54** | **mod** | **`sub_42C6E0`** | `v3 % v2` |
| 0x55 | mov | `sub_42C720` | `v2` |
| 0x56 | and | `sub_42C750` | `v3 & v2` |
| 0x57 | or | `sub_42C790` | `v3 \| v2` |
| 0x58 | sar | `sub_42C7D0` | `v3 >> v2` |
| 0x59 | shl | `sub_42C820` | `v3 << v2` |
| 0x5A | eq | `sub_42C870` | `v3 == v2` |
| 0x5B | ne | `sub_42C8C0` | `v3 != v2` |
| 0x5C | lt | `sub_42C910` | `v3 < v2` |
| 0x5D | lte | `sub_42C960` | `v3 <= v2` |
| 0x5E | gr | `sub_42C9B0` | `v3 > v2` |
| 0x5F | gre | `sub_42CA00` | `v3 >= v2` |

**统一模式**：`v2=sub_41BF50(this,3); v3=sub_41BF50(this,2); return sub_42B4B0(this,1, <op>);`（参数 1=目的，2=左操作数，3=右操作数）。

> 另（→ 已由 [`06-opcode到handler映射表.md`](./06-opcode到handler映射表.md) **确认**）：`sub_42CA50`(0x60) = `random`（`param1 = rand() % param2`）；`sub_42C570`(0x13) = 特殊；`sub_42CB00`/`sub_42CB50`/`sub_42CBA0`/`sub_42CBE0` = 数组/跳转类（`lookup-array`(0x61) / 0x62 / `lea`(0x63) / `copy-local-array`(0x64)，还调 `sub_418CC0`/`sub_418B90`/`sub_42CB...`）。

---

## 3. dispatch 表（opcode → handler）一维函数指针数组

- `.lst` 里在 `Command` 构造器 `sub_415640` 内**连续 `mov dword ptr [esi+off], offset sub_XXXX`** 初始化（`.lst` 行 ~35840-36000）。
- 数组基址 = **`this + 0x0A509C`**（C 里数值 675996 = 0xA509C）。先 `rep stosd` 用默认 `sub_418E30` 填 **0x400** 项，再按 opcode 覆盖。
- 索引 = `base + 4*opcode`。**验证**：`op 0x50 → this+0xA51DC = offset sub_42C5E0`（add），与 C 完全一致。
- **数组下标上限 = 0x400**（`cmp eax, 400h; jge error`），即支持 opcode 0..0x3FF。opcode≥0x400 落到 `sub_418E30`（报错/默认 handler）。
- `dword_53D4…`/`off_XXXX` 表（旧文档说的 `off_5530E0/5530E8`）是**游戏对象/类型方法表**，**不是** opcode dispatch（已排除）。

---

## 4. 真正的解释器主循环（核心指令迭代循环）

- 函数 **`sub_412290`**（`.text:00412290`，`void __thiscall __noreturn sub_412290(int this)`），C 行 ~20465 起，`__noreturn`（永不返回的循环）。
- 源码片段（C 行 20772、21214-21221）：
```c
v18 = **(_DWORD **)(this + 120 * this[383104] + 383128);   // 读当前 opcode（本条指令第 1 个 dword）
if ( v18 > 0x3FF ) goto LABEL_229;                          // opcode 越界 → 默认 handler
// LABEL_229: sub_418E30(this);
// LABEL_216:
(*(void (__thiscall **)(int))(this + 4 * v18 + 675996))(this);      // dispatch_table[opcode](this)
*(this + 120 * this[383104] + 383128) += 4 * *(this + 120*this[383104] + 383220);  // IP += 4*arity
```
- 机理：按「当前脚本上下文 `this[383104]`」取指令指针 `[383128]` → 读 opcode → 经 `this+0xA509C+4*opcode` 调 handler → 按该 opcode 的参数个数（存在 `[383220]`，单位=1 个 arg 占 4×?）推进指令指针，回到循环头。**jcc/分支 = 把后继指令指针改成 label 地址**（`is_label_argument` 语义）。
- 注意：`5D880/5D898`（.lst 里的帧结构）是消息泵/调用栈结构，**不是** bytecode 指针；bytecode 指针在 `[383128]`（120×cur_script + 383128）。

---

## 5. 如何复现 / 继续

1. **解释器**：在 `.lst` 搜 `0A509Ch`（行 30014/31169/32083），全在 `sub_412290` 内；`call edx/eax` 即 dispatch。
2. **表格实体**：直接在 `.lst` 的 `sub_415640` 区域内读全部 `[esi+0A50XXh], offset sub_XXXX`，即得完整 `[opcode(0..0x3FF)]→handler` 映射。可与 `age-shared.cpp` 的 548 条 opcode 定义对照命名。
3. **给 opcode 命名 handler**：把每条 `sub_XXXX` 反编译体去掉 `sub_41BF50/sub_42B4B0` 包装，看核心运算/副作用（如 `mod`=`%`、`show-text`=`sub_41C6xx`、`call-script`=`sub_41A8xx`）。
4. **回到业务**：找出写 `0x53f48c`/`0x928a7` 的 opcode（可能是某条「数组/全局」op，如 `copy-to-global`(0x6C)、`lookup-array`(0x61)、`copy-local-array`(0x64)）在 dispatch 表里的 handler，再顺着 handler 反编译体定位到实际内存写。

---

## 6. Todo（engine 域）

- [x] opcode→handler 对照表（**544 条**，按 §5-2 读 `.lst` `sub_415640` 区域全量导出）——见 [`06-opcode到handler映射表.md`](./06-opcode到handler映射表.md)。
- [ ] `global_int` 数组基址（`[base+index*4]`）→ 索引→地址映射（§5-4）。
- [x] 字节码 opcode dispatch 载体 —— **一维函数指针表 `this+0xA509C + 4*opcode`，上限 0x400，默认 `sub_418E30`**；主循环在 `sub_412290`。（本次已解）
- [x] `off_5530E0/5530E8` 实体结构 —— **游戏对象/类型方法表（非 opcode dispatch）**，已排除。
