# T-0093 · 过程文档（changes.md）

## 2026-09-20

## 轮 7 · 第②半（`0x147`/`0x2f2` 纯几何命中）—— 已落地

**实现**：新增 `app/amayui-emulator/src/vm/handlers/region-hittest.ts`（`REGION_HITTEST_OPS`），注册进 `OPS`（`handlers/index.ts` 一行 + 注释）。**零宿主缝**（纯几何 + 操作数读写）。
**守卫**：`app/amayui-emulator/test/op-147-2f2-region-hittest.test.ts`。

**体证（逐行读全）**
- `0x147` = `sub_42FD60`（raw **39655-39702**）：`x/y = readIntOperand(2/3)`；**op4/op5 = `sub_42AEA0(_this, 4/5)` = operandAddress**（不是普通值读！）⇒ 给的是**池中连续槽的起始**；`n = readIntOperand(6)`；n 个点按 `DEC(v) = ror32(key ^ rol32(v,11),25)` 解出（x 取 op4 那串槽、y 取 op5 那串槽）；`CreatePolygonRgn(pts, n, 2)`（**fill mode 2 = WINDING**）；`PtInRegion` → 写 op1；建区失败（含 n ≤ 0）⇒ 错误串 + op1 = 0。
- `0x2f2` = `sub_4318A0`（raw **40687-40721**）：op4 = 4 个 dword 的矩形数组（**operandAddress** ⇒ 池中连续槽），op5/op6 = **偏移**（不是坐标）；严格 `left = op5 + DEC(v[0])`、`right = op5 + DEC(v[1])`、`top = op6 + DEC(v[2])`、`bottom = op6 + DEC(v[3])`（偏移加在 DEC **之后**）→ `CreateEllipticRgnIndirect(&rect)`（rect **内切**椭圆）→ `PtInRegion` → 写 op1；失败 ⇒ op1 = 0。

**★两条独立订正（推翻了旧筛体/note）**
1. 旧 note 的「另按 op4/op5 **顺带写回**」是**错的** —— 体内对两张源数组**只读**，唯一的操作数写回是 op1（守卫里有一条专门钉这个）。
2. op4/op5 **不是点坐标也不是普通 int**，而是**池中连续槽的起始地址** —— 由全库仅有的两个真实调用点反证：
   - `src/CONFIGCV.txt:380`：`i147 (local-int 407) (local-int 3ed) (local-int 3ee) (local-int 41a) (local-int 41e) 4` ⇒ x 数组 = local 槽 `41a..41d`、y 数组 = `41e..421`、n = 4。
   - `src/REIGN.txt:550`：`i2f2 (local-int 2e1) (local-int 2fe) (local-int 2ff) (local-int 1d10) (local-int 1d14) (local-int 1d15)` ⇒ 矩形数组 = `1d10..1d13`，op5/op6 正好是紧随其后的 `1d14`/`1d15`。
   （主 agent 在派活时独立读全两具体 + 找到这两个调用点，把这条语义钉死后才让子代理动手；子代理据此实现并复证。）
3. GDI 语义：`CreatePolygonRgn(..., 2)` = **WINDING**（不是奇偶）；`CreateEllipticRgnIndirect` = rect 内切椭圆（宽或高为 0 ⇒ 建区失败 ⇒ op1 = 0）。守卫里有一条「奇偶与 WINDING 结论不同的多边形」判别用例。

**台账/生成物同步（主 agent，结算）**
- `analysis/opcode-gaps.json`：两条 `deferred` → **`implemented`**（`docStatus` 仅映射 → 已核对），note 重写为上述体证 + 语料反证；`node scripts/build-opcode-gaps.mjs` 回填 counts ⇒ **已实现 34 → 36、deferred 24 → 22**，`--check` ✓。
- `docs-new/03-engine/opcode-table.md`：`0x147`（原「仅映射」空行）与 `0x2F2`（同）两行补全语义 + emulator 现状；`scripts/asm/opcodes.json` 重建（仅两条 `status` 变化）。
- 守卫：`opcode-arity` / `opcode-gaps` / `opcode-operands`（★两条新注册指令的 1..argc 全被碰，**不需要**加 `ALLOW_UNDERRUN` 白名单）/ `registry-tables`（三表两两不相交）全部绿；新增测试与 `op-141-135-bitops-unsigned`/`op-2ee-message-fade` 一起跑 **21/21 pass**（主 agent 独立复跑）。

**本票的①半**（SETWEATHER 族 5 条 engine-internal no-op）已在轮 6 落地 —— 至此①②两半完成。
