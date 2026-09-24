# T-0165 · 字符串族"int/ptr/float 不转十进制"根因 · 变更记录

## 第 1 次变更（P1 修复，本次）

### 缺口（审计 `docs-new/99-records/2026-09-impl-audit/` §4.1 的 P1，`0x193` 两条）
引擎的「取字符串」原语 `sub_41B640`（raw 26248-26359）/ `sub_42A420`（raw 36317-36544）/
`sub_41B9B0`（raw 26365-26470）**三条同构**，都对数值族操作数做转换：

| operand tag | 引擎 | 修前 emulator |
|---|---|---|
| `0` 立即 int | `_itoa_s(*v8, buf, 0x400, 10)` | `String(a.raw)`（槽号） |
| `1` 立即 float | `sub_408050(…, "%lf", …)` | 同上 |
| `3`/`9` int 值池 | `_itoa_s(DEC(池值), …, 10)` | 同上 |
| `4`/`10` float 值池 | `%lf` | 同上 |
| `6`/`12` int 指针 | `_itoa_s(DEC(*指针), …, 10)` | 同上 |
| `7`/`13` float 指针 | `default:` ⇒ 抛 `Command_Type_Exception` | 同上（静默） |
| `2/5/8/11/14` 字符串族 | 原样取串 | 一致 ✓ |

⇒ `0x192 set-string` / `0x193 concat` / `0x1B2 text-append` 在真实语料上产出错串。语料锚点：
`COMMITDR.txt:9`、`FIELD.txt:8595/8710/9416/9365`、`ALCHEMY.txt:1063`、`REACH.txt:2243/2264`、
`SYSTEM4.txt:463-464`。

### 落地
`src/vm/operand.ts` 的 `readStringOperand` 按上表补齐（新增 `intToDecimal` / `floatToLf` 两个纯函数；
`%lf` 用 C 的默认精度 6，非有限值按 `nan`/`inf`）。字符串族与未建模的数组族保持原口径（数组族语料 0 处触发）。

### 守卫
`test/op-string-coercion.test.ts`（新，T0/core/text，5 条）：
- `0x192` 的 int 值池 / 局部 int / 立即数 / int 指针（含 DEC）四种转十进制；
- `0x193` 复刻 `COMMITDR.txt:9` 形态（`"…提升为" + 3`；修前会得到槽号 `26510`）；
- `0x1B2` 的 `(global-int 0)`：用「值 = 0、槽 = 200」组合证明修前会追加 `"200"`；
- float 族 `%lf`（`3.14 ⇒ "3.140000"`、`0x40490fdb ⇒ "3.141593"`）+ float 指针族抛错；
- 字符串族未受影响（含 tag 8 指针解引用）。

### 备注
- 该测试刻意用 `test/harness.ts` 的 `instr`（不新造 `mk()` 变体），以过 `T-0020` 的结构棘轮。
- 同源缺口中的数组族（`0x8003`/`0x8009` 首元素 + 空容器哨兵串）语料 0 处触发，
  仍按 `unclear`/未建模留在报告 §4 的 P3 段（本票不涉及）。
