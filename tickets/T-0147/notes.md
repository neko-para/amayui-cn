# T-0147 调查记录

## 1. 触发与现象（用户实测）

用户执行到**战斗界面**时命中：

```
AIM.BIN writeIntOperand: unsupported type 0x0 for opcode 0x205
```

对应站点 = `src/AIM.txt:423`：

```
i205 2a 23f (local-int 12) (local-int 47) 7 10000
```

op2 = `23f` 是**立即数**（操作数 type `0x0`）。

## 2. 三层定位（引擎 → 台账 → emulator）

### 2.1 引擎读体（唯一真源）

`engine/天结_unpacked.exe_utf8.c:31470-31491`（`sub_4233E0` = 0x205 的 handler）：

```c
int v8;   // [esp+4h] [ebp-28h] BYREF        ← 31478：局部变量
char v9[32];                                 // 31479：格式化后的数字串缓冲
_this[30 * _this[95776] + 95805] = 13;       // 31481
v8 = sub_41BF50(_this, 2);                   // 31482：op2（x）读进局部
v6 = sub_41BF50(_this, 6);                   // 31483：op6 flags
v4 = sub_41BF50(_this, 5);                   // 31484：op5 字段宽
v2 = sub_41BF50(_this, 4);                   // 31485：op4 数值
sub_4072F0(_this, v9, &v8, v2, v4, v6);      // 31486：★x 前进量写到 **&v8**（局部）
v7 = sub_41BF50(_this, 3);                   // 31487：op3（y）
v5 = v8;                                     // 31488：用更新后的局部 x
v3 = sub_41BF50(_this, 1);                   // 31489：op1 槽
sub_456710((int)(_this + 21324), v3, v9, v5, v7);  // 31490：绘制
```

**结论：引擎从头到尾没有回写 op2。** `sub_4072F0`（定义 raw 12198，签名 `(_DWORD*, _BYTE*, int *a3, int a4, int a5, int a6)`）
的第三参是**出参指针**，在这里指向栈上的 `v8`。也就是说「x 是 in/out」这句描述里的 out 是**引擎局部量**，
不是脚本操作数槽。

同一形状还有一个孪生函数 `sub_41FB50`（raw 28997-29018），逐行同构（局部 `int x; // BYREF` + `sub_4072F0(…, &x, …)`），
只是末尾调 `sub_4561E0` 而不是 `sub_456710`。查 handler 注册表偏移可算得它是 **0x8A**（`argc 6`），
在 `analysis/opcodes.json` 里状态仍是「仅映射」（未实现）⇒ 本票不动它，但**将来实现 0x8A 时必须照本票结论**（op2 只读）。

### 2.2 emulator 的偏差

`app/amayui-emulator/src/vm/handlers/msgwin.ts:1698-1738` 的 `op_draw_number_string`：

```ts
const nx = x + advance;
plan.setInt(2, nx); // ★op2 是 in/out        ← 1724：多余且有害
… c.native.drawString?.(slot, nx, y, …)     ← 1727：真正该用 nx 的地方
```

`plan.setInt` 最终走 `writeIntOperand`（`src/vm/operand.ts:358` 的 `default:` 抛
`unsupported type 0x…`），对立即数（type `0x0`）无槽可写 ⇒ 正是用户看到的报错。

### 2.3 台账/声明侧同一条误标

| 位置 | 现状 | 应为 |
|---|---|---|
| `analysis/opcodes.json` 0x205 semantics（line 2587） | `op2`=x（**in/out**，`sub_4072F0` 会更新） | op2 只读；更新的引擎局部 `v8` |
| `src/vm/operandPlan.ts:1191` 操作数方向表 | `['r', 'rw', 'r', 'r', 'r', 'r']` | `['r','r','r','r','r','r']` |
| `src/vm/operandPlan.ts:1150` 说明 | 「`0x205`(**op2 是 rw**：读原值再写回)」 | op2 只读，前进量只在引擎局部 |
| `src/vm/handlers/msgwin.ts:1724/1799` | 「op2 是 in/out」注释 + 回写调用 | 删回写、改注释 |

★`ioOf(n) = plan.io?.[n-1] ?? 'r'`（`operandPlan.ts:185`）⇒ 方向表标 `'rw'` 正是这句错误回写**能通过方向门**的原因。
方向改成 `'r'` 后，若还有人写 op2，会被 `denyIo` 当场拦下（比现在静默污染好）。

## 3. 影响面（按语料实测，非估计）

`src/*.txt` 全部 `i205` 调用点 = **313**：

| op2 形态 | 数量 | 现状行为 |
|---|---|---|
| 立即数 | **273** | **必抛** `unsupported type 0x0`（要走到该脚本才炸；战斗 `AIM` 是其中一处） |
| `(local-int N)` | **39** | 不报错，但**静默把 x 写成 x+前进量** |
| `(local-ptr N)` | 1 | 同上（写穿指针） |

39 个可写槽站点里 **16 个在紧随 1~3 行内又读同一个槽**（脚本状态真被污染的实锤面），例如：

```
AIM.txt:453   i205 2a (local-int 11) 227 (local-ptr 2) 1 10000
AIM.txt:454   add (local-int 48) (local-int 11) 9          ← 读的已是 emulator 回写的脏值
CONFIG1.txt:2825  i205 … (local-int 57c3) …  → add (local-int 57c3) (local-int 57c3) (local-int 7fd) f
SAVE.txt:2018     i205 … (local-int 21c6) …  → add (local-int 21c6) (local-int 221) 294
```

⇒ 本缺陷是**两类症状**：立即数站点硬停 + 可写槽站点排版/状态漂移。后者不会报错，只会「看起来位置不对」。

## 4. 为什么迟至战斗界面才暴露

273/313 站点是立即数，理论上早该炸；但 emulator 只在**派发到那条指令**时才执行 handler ⇒
要走到具体脚本（战斗 `AIM.BIN`、道具/炼金等界面）才命中。此前没走到过含 `i205` 的脚本段。

## 5. 复现（已实测）

见 `repro.md`。两条用例的实测输出：

```
A) 抛出：writeIntOperand: unsupported type 0x0 for opcode 0x205
B) 运行后：(local-int 0x11)=346（引擎应为 256=只读） / (local-int 0x12)=346（引擎应为 256）；
   对 op2 槽的写入事件 2 次：256,346
```

B 的 346 = 256（x）+ 90（advance = `start×cy` = 3×30）⇒ 回写不仅发生，数值正是 emulator 自己算的前进量。

## 6. 修复时的锚点 retarget 清单（棘轮纪律）

本票 evidence 里**会因修复而消失**的锚点（改完必须 retarget，不许删证据）：

| evidence | 触发修改 | retarget 建议 |
|---|---|---|
| `analysis/opcodes.json`：`op2`=x（in/out，`sub_4072F0` 会更新） | 语义订正 | 改成新语义串里的稳定片段（如 `op2`=x（只读）） |
| `app/.../operandPlan.ts`：`['r', 'rw', 'r', 'r', 'r', 'r'], 'draw-number-string` | 方向改 r | `['r', 'r', 'r', 'r', 'r', 'r'], 'draw-number-string` |
| `app/.../operandPlan.ts`：`**op2 是 rw**：读原值再写回` | 说明订正 | 新说明串 |
| `app/.../msgwin.ts`：`plan.setInt(2, nx);` | 删回写 | 保留同义的「不回写」注释串，或改锚到 `const nx = x + advance;` |
| `app/.../msgwin.ts`：`op2 是 in/out：回写 x 前进量` | 注释订正 | 新注释串（如「op2 只读：前进量只在局部 nx」） |

引擎侧两条（`int v8; … BYREF`、`sub_4072F0(_this, v9, &v8, v2, v4, v6);`）与语料两条（`AIM.txt:423`/`453`）**不动**。

## 7. 未确认项

- 是否还有**其它 opcode** 在 emulator 里回写了引擎只更新局部的操作数（同类形态）。本票只按用户报告收敛到 0x205；
  若要普查，应逐条比对「handler 里 `setInt`/`setFloat` 的位」与引擎体中「该位是否出现为出参指针/是否回写」。建议另开票（口径：`operandPlan.ts` 里所有 `'rw'` 位）。
- `set:BlankExtentMode == 1` 的宿主字体度量缺口（`T-0085`）与本票无关，但同处一个 handler，改动时不要碰它的回退口径。
