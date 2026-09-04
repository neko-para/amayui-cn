# 07 · 指针操作数模型（lea / lookup-array / memcpy 的模拟隐患）

> 状态：**分析完成，结论已定并已实现**（见 [`02-architecture-decisions.md`](./02-architecture-decisions.md) ADR-011）。
> 结论：指针型操作数 = **带标记引用（Ref）**；读=解引用取所指值，写=写穿到所指处；地址**从不**作为数值参与普通运算。
> **实现**：`src/vm/ref.ts`、`operand.ts`（`refFromOperand`/`setRefOperand`/指针型读解引用写写穿）、`ops.ts`（`lea`/`lookup-array`/`lookup-array-2d`/`memcpy`/`copy-local-array`/`random`）、`engine.ts`（指针池存 `Ref|0`）；测试 `test/ptr.test.ts`。启动链已验证推进至 `INITCONFIG4`（下一阻塞 = 未实现 `0x6c copy-to-global`）。

---

## 1. 触发

在确认「简单指令」`lea(0x63)`/`lookup-array(0x61)`/`copy-local-array(0x64)` 语义时（见 `docs/re/engine/06` 具名表已核对行），发现它们都是**取地址/引用**指令。用户提出核心隐患：

> **取地址操作（lea 等）在 TS 模拟时需要通过某种形式体现——尤其是 BIN 中不排除将其作为数值进行操作。**

评估结论：该担忧**方向对，但需修正定性**——引擎**不对指针做地址算术**（读指针=解引用），所以真正要解决的不是"地址算术"，而是"**引用/解引用模型**"。下文给出证据。

---

## 2. 引擎事实（读 handler 体，raw `engine/天结_unpacked.exe_utf8.c`）

### 2.1 读指针操作数 = 双重解引用（`sub_41BF50` case 6/12，行 26555+）

```c
case 6:  // global-ptr
  return __ROR4__(_this[97059] ^ __ROL4__(**(_DWORD **)(_this[95750] + 4 * *(_DWORD *)v2), 11), 25);
case 12: // local-ptr
  return __ROR4__(_this[97059] ^ __ROL4__(**(_DWORD **)(_this[30*cur+95792] + 4 * *(_DWORD *)v2), 11), 25);
```

`**(_DWORD **)(ptr_base + 4*idx)` 分两步：
1. `*(_DWORD **)(ptr_base + 4*idx)` = 读 ptr 槽里存的**地址** `A`；
2. `*A` = 读**地址 A 处**的值。

=> 读指针操作数 = **所指处的值**（int 族再过 DEC）。**不是地址本身。**

### 2.2 写指针操作数 = 写穿（`sub_42B4B0` case 6/12，行 36965+）

```c
case 6:
  dword_55D530 = *(_DWORD *)(*(_DWORD *)(_this + 383000) + 4 * *v4);  // A = ptr槽存的地址
  result = __ROL4__(*(_DWORD*)(_this+388236) ^ __ROR4__(a3, 7), 21);  // ENC(value)
  *(_DWORD *)dword_55D530 = result;                                    // *A = ENC(value)  ← 写穿
```

=> 写指针操作数 = **写穿**到所指处（int 族再过 ENC）。**不是改指针槽本身。**

### 2.3 取址（`sub_42AEA0`，lea/lookup 的底座）

- 直接型（global-int 3 等）：返回 `base + stride*idx`（**内存地址**）。
- 指针型（global-ptr 6 等）：返回 `*(ptr_base + 4*idx)` = 指针槽存的地址 = **所指处地址**（即引用拷贝/别名）。
  => `lea (local-ptr 0) (local-ptr 2)`：`local-ptr0 = local-ptr2 所指处地址`，二者**别名**同一位置。

### 2.4 目标恒为指针操作数（数据实证）

| 指令 | 出现次数 | dest 类型 | 说明 |
|---|---|---|---|
| `lea` | 173 | `local-ptr` 100% | 无 `global-ptr`/`global-int` dest |
| `lookup-array` | 143,885 | `local-ptr` 139k / `local-string-ptr` 4.6k / `local-float-ptr` 7 | 全部为指针型 |
| `lookup-array-2d` | 10,234 | （样本）`ptr` 型 | 同上 |
| `local-ptr` 操作数**出现** | **298,783** | — | `global-ptr` 在本作 **0 次** |

=> 地址**只**落到指针操作数；`lea`/`lookup-array` 的 dest 不会是 `global-int` 等非指针型。

### 2.5 指针在值语境被广泛使用，且引擎解引用

- `gr (local-int 0) (local-ptr 0) 0` —— 判断 `*local-ptr0 > 0`（所指值），**非**地址比较。
- `lt (local-int 4f) (local-ptr 5) (local-ptr 4)`（`ADDEXP.txt`）—— 比较**所指值**。
- `jcc (local-ptr 1) …` —— 条件 = `*ptr1 ≠ 0`。

---

## 3. 定性修正

- ❌ **误判**："BIN 会拿地址作为数值做算术/比较"。事实：引擎对指针操作数**一律解引用**，地址**从不**以数值形式进入 add/lt/eq/mov 等普通运算域。地址只在 `lea`/`lookup-array`/`lookup-array-2d`/`memcpy`/`copy-local-array` **内部**瞬态存在。
- ✅ **真问题**：模拟器需要正确的**引用/解引用模型**：
  1. 指针池**不能存裸 `number`**。引擎地址是 `base + stride*idx`（线性内存）；而 ADR-003 用**按类型分池**（`globals.int/float/str/ptr` 各自独立），无线性内存，故一个"地址"无法用单一 `number` 标识到正确的池+条目。
  2. `readIntOperand`/`writeIntOperand` 对指针型必须 **deref / write-through**。**当前 `operand.ts` 是错的**：
     - `readIntOperand`(ptr) 返回 `dec(key, pool.get(idx))` → 裸值（**地址**），非所指值。
     - `writeIntOperand`(ptr) 写 `pool.set(idx, enc(value))` → 改指针**槽**，非写穿。
     => 对全工程 29.8 万处指针值语境（`gr/eq/lt (ptr) …`、`jcc (ptr)`）会**全错**。

---

## 4. 修正规格（供 `operand.ts` / `ops.ts` 落地）

### 4.1 Ref 类型

```ts
type Ref = {
  scope: 'global' | 'local';       // 全局池 vs 帧局部池
  kind: 'int' | 'float' | 'str' | 'ptr' | 'fptr';  // 指向哪类池
  index: number;                    // 该池中条目下标
  stride: number;                   // 元素字节宽（int/float/ptr=4；string=28）
};
```
- 指针池存 `Ref | 0`（`0` = 空引用，仅用于"未 lea 前"）。
- **两套存取原语分离**（当前 `operand.ts` 混用）：
  - **读/写值**（普通 op 用）：`readValue(ptr)`=跟随 Ref 到 `pool[index]`（int 族过 DEC）；`writeValue(ptr, v)`=写穿（int 族过 ENC）。
  - **设引用**（`lea`/`lookup-array` 用）：`setRef(ptrSlot, Ref)`=把 Ref 对象写入指针池该槽。

### 4.2 各指令

| 指令 | 行为 |
|---|---|
| `lea op1 op2` | `setRef(op1, refFromOperand(op2))`——`refFromOperand` 对直接型返回 Ref(池,idx,stride)，对指针型返回"所指处 Ref"（别名拷贝）。 |
| `lookup-array op1 op2 op3` | `setRef(op1, baseRef(op2) + stride*op3)`（基址 Ref + 索引偏移）。 |
| `lookup-array-2d op1 op2 r c` | `setRef(op1, baseRef(op2) + (r*colStride + c)*stride)`。 |
| `random op1 op2` | 读 `op2` 得模数，`op1` 的 **Ref 指向处** = `rand()%mod`（写穿）。 |
| `copy-local-array op1 op2` | 按 `stride` 把 op2 索引的字面数组逐项解码拷入 op1 指向数组。 |
| `memcpy op1 op2 n` | `op1=dest, op2=src, size=4*n`；按元素宽搬运（跨池/类型不匹配硬报错）。 |

### 4.3 校验/风险

- **跨池/跨宽**：memcpy/copy 的目标与源 pool kind、stride 必须一致或可界定；不一致硬报错（ADR-005），不猜。
- **空引用**：`Ref | 0`；对 `0` 的 deref 硬报错（忠实复刻引擎对空指针解引用会崩）。**不得**把"指针 vs 数字"特判成地址比较。
- **ADR-010 联动**：`lookup-array`/`memcpy`/`copy-*` 是 §10.2 高危信号（数据/状态操作），**不得**标 `engine-internal` 跳过，必须精确实现。

---

## 5. 结论

- 模拟 `lea`/`lookup-array` 等取址指令时，**地址不能当作普通数值**——但原因不是"BIN 会拿地址做算术"，而是"指针操作数在引擎里是**引用**，读/写都作用于所指处"。
- 因此 TS 只需：**指针池存带标记的 Ref，读解释/写写穿，lea/lookup/memcpy 负责构造与搬运**。这比"实现通用指针算术"简单，但**必须在写操作数原语层面就分开"值存取"与"设引用"**，否则全工程的指针值语境都会错。
- 具体可见：`operand.ts`（两套原语 + Ref）、`ops.ts`（lea/lookup-array/lookup-array-2d/copy-local-array/memcpy/random）、`engine.ts`（`globals.ptr`/`locals.ptr` 存 `Ref|0`）。
