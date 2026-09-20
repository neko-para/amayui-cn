/**
 * **GDI 区域命中测试族**（`0x147` 多边形 / `0x2F2` 椭圆）—— 纯几何、零宿主缝、只写 op1。
 *
 * 为什么单独一个模块：这两条**不改控制流、不读渲染状态、不需要任何宿主缝** —— 输入是脚本给的
 * 点与几何参数，输出只是 op1 里的 `PtInRegion` 布尔。它们唯一的难点是「GDI region 的语义」，
 * 而那是一套自成一体、必须逐条把判据写清的整数几何算法；塞进 `input.ts`（那里是光标/设备状态）
 * 或 `gfx-state.ts`（那里是渲染状态写入 + 宿主缝）都会让 `handlers/index.ts` 头部那条
 * 「一个模块 = 一个引擎子系统」的界线变模糊。同族的 GDI region 指令
 * （`0x2EF` `sub_431270` / `0x2F0` `sub_431460` / `0x2F1` `sub_4316E0` / `0x14A` `sub_42FEF0`，
 * 都还带 `CombineRgn`）仍在 `deferred`，将来落地时归这里。
 *
 * ## 一、引擎证据（逐行读过；行号 = `engine/天结_unpacked.exe_utf8.c` 的 raw 行）
 *
 * `0x147` = `sub_42FD60`（raw **39655-39702**，argc 6；体首 `95805 = 13` = `1+2*argc` ✓）：
 * ```
 * 39670  _this[30*cur + 95805] = 13;                  // arity 槽 ⇒ argc = 6（有据）
 * 39671  x   = sub_41BF50(_this, 2);                  // op2 = 点 x（**值**语义）
 * 39672  y   = sub_41BF50(_this, 3);                  // op3 = 点 y
 * 39673  v2  = sub_42AEA0(_this, 4);                  // op4 = **基址**（地址语义）
 * 39674  v12 = sub_42AEA0(_this, 5);                  // op5 = **基址**
 * 39675  v3  = sub_41BF50(_this, 6);                  // op6 = n（点数）
 * 39676  v4  = (POINT *)operator new[](8 * v3);       // n 个 POINT
 * 39681      v10 = v12 - v2;                          // ★两个基址之差
 * 39684      v4[i].x = __ROR4__(key ^ __ROL4__(*v2, 11), 25);            // DEC
 * 39685      v4[i].y = __ROR4__(key ^ __ROL4__(*(v2 + v10), 11), 25);    // ★v2++ 之后 +v10 ⇒ v12[i]
 * 39689  PolygonRgn = CreatePolygonRgn(v4, v3, 2);    // 2 = WINDING（ALTERNATE=1 / WINDING=2，wingdi.h）
 * 39692      v7 = PtInRegion(PolygonRgn, x, y);
 * 39693      sub_42B4B0(_this, 1, v7);                 // ★唯一的操作数写回：op1 = 命中(0/1)
 * 39694      DeleteObject(PolygonRgn);
 * 39698  else sub_4034C0(_this, asc_520808);           // "リージョン作成失敗しました"（raw 4451）
 * 39699       sub_42B4B0(_this, 1, 0);                // 建 region 失败 ⇒ op1 = 0
 * ```
 * ★**op4/op5 只读，不写回**（这一点推翻了筛体文档的「另按 op4/op5 顺带写回」）：
 *  - `v2` 只被解引用读与 `v2++` 自增，函数体里**没有任何** `*v2 = …`；
 *  - `sub_42AEA0`（raw 36756-36961）对 int 族（type 3/4/9/A…）是**纯读**，唯一的写回发生在
 *    **字符串/对象型**操作数的惰性构造上（raw 36825-36856：值 0 ⇒ `operator new(0x10)` 一个空
 *    `std::string` 并把 ENC 后的指针写回池槽；raw 36931-36959 同型）—— 与点数组无关。
 *  - 语料实证（`src/CONFIGCV.txt:380`）：
 *    `i147 (local-int 407) (local-int 3ed) (local-int 3ee) (local-int 41a) (local-int 41e) 4`
 *    ⇒ op1 = 结果槽 407、op2/op3 = 点 (3ed,3ee)、op4 = x 数组基址 41a、op5 = y 数组基址 41e
 *    （相差 4 格 = 4 个 int，正好是 n=4 的 x/y 两张表）、op6 = 4；紧接
 *    `eq (local-int 422) (local-int 407) 0` + `jcc` ⇒ op1 确有消费者。
 *
 * `0x2F2` = `sub_4318A0`（raw **40687-40721**，argc 6；体首 `95805 = 13` ✓）：
 * ```
 * 40699  _this[30*cur + 95805] = 13;                  // arity 槽 ⇒ argc = 6
 * 40700  x = sub_41BF50(_this, 2);   40701 y = sub_41BF50(_this, 3);
 * 40702  v2 = sub_42AEA0(_this, 4);                  // op4 = 基址：4 个 int = left/right/top/bottom
 * 40703  v3 = sub_41BF50(_this, 5);  40704 v4 = sub_41BF50(_this, 6);   // op5/op6 = x/y 偏移
 * 40705  rect.left   = v3 + DEC(v2[0]);
 * 40706  rect.right  = v3 + DEC(v2[1]);
 * 40707  rect.top    = v4 + DEC(v2[2]);
 * 40708  rect.bottom = v4 + DEC(v2[3]);              // ★偏移加在 DEC **之后**
 * 40709  v5 = CreateEllipticRgnIndirect(&rect);
 * 40712      v7 = PtInRegion(v5, x, y);
 * 40713      sub_42B4B0(_this, 1, v7);               // ★唯一的写回：op1 = 命中(0/1)
 * 40718  else sub_4034D0(_this, asc_520858);         // "楕円形リージョン作成に失敗しました．"（raw 4454）
 * 40719       sub_42B4B0(_this, 1, 0);
 * ```
 * 语料实证（`src/REIGN.txt:550`）：
 * `i2f2 (local-int 2e1) (local-int 2fe) (local-int 2ff) (local-int 1d10) (local-int 1d14) (local-int 1d15)`
 * ⇒ op4 = 基址 1d10（即 1d10..1d13 四个 int）、op5 = 偏移 1d14、op6 = 偏移 1d15；紧接
 * `jcc (local-int 2e1) 0xffffffff …` 消费 op1。
 *
 * ## 二、GDI 语义与判据（★凡不能静态确证处都写明"判据 / 不确定性"，不静默近似）
 *
 * 反编译只告诉我们**调了哪几个 API**；region 的内部语义由 GDI 决定。这里的判据是 wine 的
 * `dlls/win32u/region.c`（**与 NT GDI 同源**的 X11/MIT region 扫描转换代码：同一份
 * `EdgeTableEntry`/`WETE`/`bres_init_polygon` 结构，注释里就写着算法出处）与
 * `dlls/gdi32/objects.c`（`CreatePolygonRgn` = `CreatePolyPolygonRgn(pts,&count,1,mode)`、
 * `CreateEllipticRgnIndirect(rect)` = `NtGdiCreateEllipticRgn(rect->left,…,rect->bottom)` 直传）。
 * Windows 真机无法在本工程内验证，因此**凡有歧义处按下述口径实现并在报告里登记存疑**。
 *
 * ### ① `PtInRegion` 的边界口径：右/下边**不含**
 * wine `NtGdiPtInRegion` → `is_in_rect(RECT*,x,y) = (right > x && left <= x && bottom > y && top <= y)`
 * （region.c raw 同位）。多边形 region 由逐行 span `[xL,xR) × [y,y+1)` 组成，椭圆 region 亦同 ⇒
 * **左/上含、右/下不含**。
 *
 * ### ② `CreatePolygonRgn(pts, n, 2)`：WINDING 填充，且按**像素中心**取样
 * wine 的多边形扫描转换是「`.5` 偏置的 Bresenham」（region.c 顶部注释：*"we add .5 to the starting x
 * coordinate for both left and right edges … Draw the left pixel, but not the right"*；边表里
 * `ymax = bottom->y - 1` ⇒ 扫描线区间是 `[ymin, ymax)` 半开）。等价的可判定表述是：
 * **整数点 `(px,py)` 命中 ⟺ 采样点 `(px+0.5, py+0.5)` 严格位于多边形内部**（等价性在轴对齐
 * 矩形与整数坐标三角形上逐点核对过；`.5` 偏置在两处正负号互为镜像，正是"左/上含、右/下不含"）。
 * 实现用**倍化整数坐标**（`2x+1/2y+1`）做绕数，避免浮点：
 * `wn ≠ 0` ⇒ 命中（WINDING；**不是**奇偶 —— 奇偶会把绕数为 ±2 的区域挖空）。
 * ★不确定性：GDI 的 `.5` 偏置在**边恰好穿过像素中心**（半整数格点）时如何取舍，只能从
 * Bresenham 的错误项间接推，未能静态确证；本实现取"中心严格在内 ⇒ 命中"（即中心落在边上算**不**命中）。
 * 语料的两处用法（4 点四边形 / 椭圆）不涉及该退化情形。
 *
 * ### ③ `CreateEllipticRgnIndirect(rect)`：**逐行跨度**的整数算法（不是解析式椭圆）
 * `NtGdiCreateEllipticRgn(l,t,r,b)` = `NtGdiCreateRoundRectRgn(l,t,r,b, r-l, b-t)`；后者
 * （region.c 691-776）先 `left>right`/`top>bottom` 交换，再 **`right--; bottom--;`**，
 * `ellipse_width = min(right-left, |r-l|)`、`ellipse_height = min(bottom-top, |b-t|)`，
 * `ew<2 || eh<2` ⇒ 退化为 `CreateRectRgn(left,top,right,bottom)`；否则用 Alois Zingl 的
 * 整数椭圆算法生成 `eh` 行，每行是 `[left+x_i, right-x_i)`，并把下半部分镜像到上半部分。
 * ⇒ 本模块**照抄这条通路**（`gdiEllipticInset`），因此：
 *  - region 的包围盒是 `[l, r-1) × [t, b-1)`（比入参矩形小 1，源自那句 `right--; bottom--;`）；
 *  - 退化（0 宽/高）走 `CreateRectRgn` 分支，而 wine 的 `NtGdiSetRectRgn` 会把 `left>right`
 *    **交换**后再取 `[min,max)`（region.c 651-652）⇒ **0 宽矩形会得到 `x = l-1` 处的 1px 竖列**。
 *    ★这是一个**存疑**的边角（Windows 真机对 0 尺寸矩形是否也如此，无法静态确证），
 *    本实现照 wine 的 NT 血统实现（不自作主张改语义），守卫测试**只钉住"退化矩形的自身点位一律不命中"**，
 *    不把这个 1px 列写进断言；若将来拿到 Windows 实测与该分支不符，改这里 + 报告。
 *
 * ### ④ 只在数值安全范围内宣称精确
 * 倍化后的行列式用 JS double 计算：`|坐标| < 2^25`（约 3355 万）时乘积与差都在 2^53 内 ⇒ **精确**。
 * 语料给的是屏幕坐标（10^3 量级）。超出该范围时本实现不再精确（GDI 自己也只用 32 位整数扫描转换）。
 * 另：`n`（点数）过大会让扫描/取样循环空转 —— 引擎那边是 `operator new[](8n)`，这里用一条**显式报错**
 * 兜住异常输入（宁可响亮地失败，也不静默给个假命中）。
 *
 * ## 三、emulator 侧的四处取舍（都有先例可依）
 *
 * 1. **不写 `95805`（arity/步长槽）**：引擎 `95805 = 13 = 1 + 2*6` ⇒ 主循环 `ip += 4*13` 正好跨过
 *    "1 个指令字 + 6 组操作数"；emulator 由解释器**按指令粒度**推进（`interpreter.ts` 默认
 *    `curFrame.ip += 1`），两者等价。★先例：只有"步长与操作数个数不一致"的 handler 才显式写
 *    （`handlers/stubs.ts` 的 `0x1A8` 注释：写 `95805 = 1` 后 `ip += 4`），本族不属于那一类。
 * 2. **不重复 DEC**：`readRef` 内部已经走 `dec(key, raw)`（`ref.ts` 的 `case 'int'`），而引擎体里那两处
 *    `__ROR4__(key ^ __ROL4__(v, 11), 25)` 就是 DEC 本身 ⇒ handler 里**不再**手工 DEC（否则等于 DEC 两次）。
 * 3. **未写过的槽读 0**：由 `ref.ts` 的 `decIntSlot` 全局负责（`readSlot` 只是 `readRef` 的别名；
 *    见它的注释与 `test/operand-missing-slot-zero.test.ts`）。
 * 4. **引擎的"建区失败"分支不建模**：`asc_520808`（"リージョン作成失敗しました"，raw 4451）与
 *    `asc_520858`（"楕円形リージョン作成に失敗しました．\r\n"，raw 4454）只在 `CreatePolygonRgn` /
 *    `CreateEllipticRgnIndirect` 返回 NULL（GDI 分配失败）时走，且该分支的可观测结果仍是 `op1 = 0`。
 *    emulator 直接算几何、不存在分配失败 ⇒ 该分支**不可达**，因此不新造日志机制（既有先例是
 *    `c.log('… 按引擎走错误串分支 …')`，如 `0x132`/`0x133`/`0x134`）；将来若接入真 GDI/宿主 region，
 *    按同一先例补 `c.log` 即可。
 */
import type { OpHandler } from '../step.js';
import type { Engine, Frame } from '../engine.js';
import { refFromOperand, readIntOperand, writeIntOperand } from '../operand.js';
import { readRef, refAt, type Ref } from '../ref.js';
import type { OpTable } from './shared.js';

/**
 * 读一个池槽 —— **未写过的槽读 0 由全局口径统一负责**（`ref.ts` 的 `decIntSlot`）：
 * 引擎装载脚本时把局部 int 池整块填成 `enc_zero`（`loadScriptFrame_40ED40` raw 18773-18781）
 * ⇒ 没被脚本写过的量读出来就是 0；而本族的两张源数组（op4/op5、op4 的 4 格矩形）正是
 * "脚本只登记基址、个别格未必写"的形状。
 *
 * ★这里**不再**用 `hasRefValue` 本地补 0（那与 `handlers/input.ts` 的 `0x12E` 是同一套多余的
 * 读口径 —— `tickets/T-0097` ③ 裁定"两个只能留一个"，全局口径落在 `ref.ts` 的 `decIntSlot`）：
 * 缺槽已由 `readRef` 给 0，本族直接用 `readRef` 即可。棘轮见 `test/operand-missing-slot-zero.test.ts`。
 */
function readSlot(e: Engine, frame: Frame, r: Ref): number {
  return readRef(e, frame, r);
}

/** 点数上限：引擎那边是 `operator new[](8*n)`；超过这个量级的 n 只可能是坏脚本。 */
const MAX_POINTS = 1 << 20;
/** 椭圆扫描转换的边长上限（逐行算法是 O(宽/2)，避免坏脚本把 VM 卡死）。 */
const MAX_EXTENT = 1 << 20;

/**
 * 半开矩形 region 的命中判定（`NtGdiCreateRectRgn` → `NtGdiSetRectRgn` 口径）：
 * 先把 `left>right`/`top>bottom` 各自**交换**，再判 `[left,right) × [top,bottom)`；
 * 交换后任一边为零 ⇒ 空 region（region.c 643-667）。
 */
export function gdiRectRegionHit(
  left: number,
  top: number,
  right: number,
  bottom: number,
  px: number,
  py: number,
): boolean {
  let l = left;
  let r = right;
  let t = top;
  let b = bottom;
  if (l > r) [l, r] = [r, l];
  if (t > b) [t, b] = [b, t];
  if (l === r || t === b) return false;
  return px >= l && px < r && py >= t && py < b;
}

/** 点 (tx,ty) 是否严格在**有向边** (x1,y1)→(x2,y2) 的左侧（倍化坐标下的叉积符号）。 */
function isLeft(x1: number, y1: number, x2: number, y2: number, tx: number, ty: number): number {
  return (x2 - x1) * (ty - y1) - (tx - x1) * (y2 - y1);
}

/**
 * **WINDING 绕数命中**（`CreatePolygonRgn(..., 2)`）：采样点是**像素中心** `(px+0.5, py+0.5)`，
 * 用倍化坐标（`2x+1`）保持整数精确；多边形按 GDI 的约定**自动闭合**（最后一点 → 首点）。
 *
 * 逐边的判据（与 GDI 的边表一致：水平边不入表、`ymax = bottom->y - 1` 即扫描线半开：
 * 只统计 `ymin <= ty < ymax` 的边）：向上穿（`y1 <= ty < y2`）时若点在边左侧 ⇒ `wn++`；
 * 向下穿（`y2 <= ty < y1`）时若点在边左侧 ⇒ `wn--`。中心的坐标是**奇数**，边的端点是**偶数**
 * ⇒ `ty` 永不等于任何端点 y ⇒ 顶点处不会重复计数。
 *
 * `points` 为 `[x0,y0,x1,y1,…]` 扁平数组（**原始整数坐标**，函数内部再倍化）；
 * `n < 2` 时 GDI 的 `REGION_CreateEdgeTable` 直接 `continue`（不加任何边）⇒ 空 region
 * ⇒ 恒不命中（本函数自然给出 `wn = 0`）。
 */
export function gdiPolygonWindingHit(points: readonly number[], n: number, px: number, py: number): boolean {
  const tx = 2 * px + 1;
  const ty = 2 * py + 1;
  let wn = 0;
  /** 一条边（入参是原始坐标；倍化后判 "向上穿 / 向下穿"）。 */
  const edge = (x1: number, y1: number, x2: number, y2: number): void => {
    const ax = 2 * x1;
    const ay = 2 * y1;
    const bx = 2 * x2;
    const by = 2 * y2;
    if (ay <= ty) {
      if (by > ty && isLeft(ax, ay, bx, by, tx, ty) > 0) wn += 1;
    } else if (by <= ty && isLeft(ax, ay, bx, by, tx, ty) < 0) {
      wn -= 1;
    }
  };
  if (n < 2) return false;
  for (let i = 0; i + 1 < n; i++) {
    edge(points[2 * i]!, points[2 * i + 1]!, points[2 * i + 2]!, points[2 * i + 3]!);
  }
  // 闭合边：最后一点 → 首点（Win32 文档：多边形被自动闭合）
  edge(points[2 * n - 2]!, points[2 * n - 1]!, points[0]!, points[1]!);
  return wn !== 0;
}

/**
 * 椭圆 region 第 `j` 行（0 = 顶行）的 x 内缩量：该行的 span 是 `[left+inset, right-inset)`。
 * 返回 `null` = 该行**没有任何像素**（空行）或不属于 region。
 *
 * 逐字移植 wine `NtGdiCreateRoundRectRgn`（region.c 724-767，算法署名 Alois Zingl）：
 * 只生成下半部分的行（从 `eh/2` 往上走），上半部分按 `inset[j] = inset[eh-1-j]` 镜像
 * （对应 region.c 756-762 的 `rects[i] = rects[b-i]`）；中线行是整宽。
 *
 * ★**wine 的未定义区（本实现按算法不变量补完，不是"猜"）**：这个移植版的循环是 **x 驱动**的
 * （`while (x <= ew/2)`），每轮最多让 y 前进 1 ⇒ 椭圆**细高**时（`eh` 远大于 `ew`，例如
 * `ew=2, eh=9`）循环会在还没走到某些行时就结束，而 wine 那边这些 `rects[]` 是**未初始化的堆内存**
 * （`alloc_region(ellipse_height)` 只分配不初始化）⇒ wine 在该区间的行为**不可复现**。
 * 补完规则：循环退出时 `x = ⌊ew/2⌋+1` ⇒ 之后每行 `2x ≥ ew` ⇒ span `[left+x, right-x)` 必为空
 * ⇒ 这些行按"空行"处理（返回 `null`）。同一原因，`eh ≫ ew` 的极端长宽比下被跳过的行也按空行处理
 * —— 这是本端口**唯一**偏离几何椭圆的区域（真内切椭圆在这些行上还剩 1~2 px），已写进 T-0093 报告。
 */
export function gdiEllipticInset(ew: number, eh: number, j: number): number | null {
  if (j < 0 || j >= eh) return null;
  const half = Math.floor(eh / 2);
  const target = j >= half ? j : eh - 1 - j;
  if (target === half) return 0; // 中线行 = 整宽（region.c 737-738）
  const a = ew - 1;
  const b = eh - 1;
  const asq = 8 * a * a;
  const bsq = 8 * b * b;
  let dx = 4 * b * b * (1 - a);
  let dy = 4 * a * a * (1 + (b % 2));
  let err = dx + dy + a * a * (b % 2);
  let x = 0;
  let y = half;
  while (x <= Math.floor(ew / 2)) {
    const e2 = 2 * err;
    if (e2 >= dx) {
      x += 1;
      dx += bsq;
      err += dx;
    }
    if (e2 <= dy) {
      y += 1;
      dy += asq;
      err += dy;
      if (y >= target) return x; // 该行的内缩量（wine：`rects[y] = [left+x, right-x]`）
    }
  }
  return null; // ★见上：循环没生成这一行 ⇒ 该行必为空（wine 那边是未初始化内存）
}

/**
 * `CreateEllipticRgnIndirect(rect)` + `PtInRegion` 的命中判定（逐行 span + 半开区间）。
 * `left/top/right/bottom` 是**已加上 op5/op6 偏移、已 DEC** 的矩形四边（引擎 raw 40705-40708）。
 */
export function gdiEllipticRegionHit(
  left: number,
  top: number,
  right: number,
  bottom: number,
  px: number,
  py: number,
): boolean {
  const wid = Math.abs(right - left);
  const hei = Math.abs(bottom - top);
  let l = left;
  let r = right;
  let t = top;
  let b = bottom;
  if (l > r) [l, r] = [r, l];
  if (t > b) [t, b] = [b, t];
  r -= 1; // wine region.c 705-706：region 只覆盖矩形**内部**（右/下各减 1）
  b -= 1;
  const ew = Math.min(r - l, wid);
  const eh = Math.min(b - t, hei);
  if (ew < 2 || eh < 2) return gdiRectRegionHit(l, t, r, b, px, py); // region.c 713-714
  if (ew > MAX_EXTENT) {
    throw new Error(`椭圆 region 宽度异常（${ew}，高 ${eh}）—— 超过 emulator 的扫描转换上限 ${MAX_EXTENT}`);
  }
  const inset = gdiEllipticInset(ew, eh, py - t);
  if (inset === null) return false;
  return px >= l + inset && px < r - inset;
}

/**
 * **`0x147`（`i147`，`sub_42FD60` raw 39655-39702，argc 6）**：WINDING 多边形命中 → `op1`。
 *
 * `op2/op3` = 点（值语义）、`op4` = x 数组基址、`op5` = y 数组基址、`op6` = 点数 n
 * （两个基址都走 `operandAddress`，即 `refFromOperand`：`local-int N` = 第 N 格起的连续 int）。
 * 逐点 DEC 后送 `CreatePolygonRgn(pts, n, 2)` → `PtInRegion` → **只写 op1**（命中 1 / 未命中 0；
 * 建 region 失败与空多边形的可观测结果都是 0）。
 *
 * ★操作数**恒读满 6 格**（引擎也是先把 op2..op6 全读出来才判 `n > 0`）—— 不因为 `n <= 0`
 * 就少读 op4/op5：那会让 `test/opcode-operands.test.ts` 的"漏读"棘轮报警，也不符合体。
 */
const op_polygon_region_hittest: OpHandler = (c) => {
  const { e, frame, instr } = c;
  const px = readIntOperand(e, frame, instr, 2);
  const py = readIntOperand(e, frame, instr, 3);
  const xs = refFromOperand(e, frame, instr, 4); // op4 = x 数组基址（**只读**）
  const ys = refFromOperand(e, frame, instr, 5); // op5 = y 数组基址（**只读**）
  const n = readIntOperand(e, frame, instr, 6);
  if (n > MAX_POINTS) {
    throw new Error(`i147 点数异常（n=${n}）—— 超过 emulator 上限 ${MAX_POINTS}（引擎此处 operator new[](8*${n})）`);
  }
  // 引擎：`if (v3 > 0) { … }` ⇒ n <= 0 时一个点都不读（region 为空）
  const flat: number[] = [];
  for (let i = 0; i < n; i++) {
    flat.push(readSlot(e, frame, refAt(xs, i)), readSlot(e, frame, refAt(ys, i)));
  }
  const hit = gdiPolygonWindingHit(flat, n, px, py);
  writeIntOperand(e, frame, instr, 1, hit ? 1 : 0);
};

/**
 * **`0x2F2`（`i2f2`，`sub_4318A0` raw 40687-40721，argc 6）**：内切椭圆命中 → `op1`。
 *
 * `op2/op3` = 点、`op4` = 基址（4 个 int：left/right/top/bottom，**只读**）、`op5` = x 偏移、
 * `op6` = y 偏移；`rect.left = op5 + DEC(v2[0])` 如此类推（★偏移加在 DEC 之后）→
 * `CreateEllipticRgnIndirect` → `PtInRegion` → **只写 op1**。
 *
 * ★操作数恒读满 6 格（同 `0x147` 的理由）。
 */
const op_elliptic_region_hittest: OpHandler = (c) => {
  const { e, frame, instr } = c;
  const px = readIntOperand(e, frame, instr, 2);
  const py = readIntOperand(e, frame, instr, 3);
  const rc = refFromOperand(e, frame, instr, 4); // op4 = 矩形四边的基址（**只读**）
  const offX = readIntOperand(e, frame, instr, 5);
  const offY = readIntOperand(e, frame, instr, 6);
  const left = offX + readSlot(e, frame, refAt(rc, 0)); // raw 40705：v3 + DEC(v2[0])
  const right = offX + readSlot(e, frame, refAt(rc, 1));
  const top = offY + readSlot(e, frame, refAt(rc, 2));
  const bottom = offY + readSlot(e, frame, refAt(rc, 3));
  const hit = gdiEllipticRegionHit(left, top, right, bottom, px, py);
  writeIntOperand(e, frame, instr, 1, hit ? 1 : 0);
};

/**
 * GDI region 命中测试族的注册表（`handlers/index.ts` 的静态扫描按 `[0xNN, name]` 认登记）。
 */
export const REGION_HITTEST_OPS: OpTable = [
  [0x147, op_polygon_region_hittest], // i147：WINDING 多边形 + PtInRegion → op1
  [0x2f2, op_elliptic_region_hittest], // i2f2：内切椭圆 + PtInRegion → op1
] as const;
