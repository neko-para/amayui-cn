/**
 * Live2D **Cubism 2.x 变形数学**（BDAffine / BDBoxGrid / pivot 组合求值）。
 *
 * ## 来源
 *  - **O** 反编译 oracle `engine/天结_unpacked.exe_utf8.c`（本作内嵌 SDK 2.0.06；行号标在各处）
 *  - **S1/S2/S3** 官方 Cubism 2.1 Web SDK / 其 Python 直译 / C# 独立实现 —— 仅作**交叉验证**
 *  - **E** 资产实证：`raw-parts` 下 335 个 `.MOC`（`src/tools/live2dMoc.ts`）
 *
 * ### 坐标与约定（务必先读）
 *  - `.moc` 的模型空间 **y 轴向下**（原点在画布左上，绘制时由投影/平移摆到画布中心——
 *    O: `D3DXMatrixOrthoLH(w, -h, -1, 1)` raw 134354 + 画布中心平移 raw 134376）。
 *    E 的旁证：BDAffine 的 `originY` 多为**负**几十~负几百（模型挂在画布中心上方）。
 *    ⇒ **不要**在变形层做 y 翻转；翻转/摆放是投影与节点平移的事（宿主负责）。
 *  - 旋转角单位 = **度**（O: raw 157048 乘 `0.017453292` = π/180；E：实测值域 ±180）。
 *  - `AffineEnt` 的 `reflectX/Y` 是**并入缩放符号**（O: raw 157053/157056），不是额外的镜像矩阵。
 *
 * ### pivot 组合（O: `sub_4CAB10` raw 155083 + `sub_4CAD50` raw 155267）
 *  - `pivots[]` 槽 **0 = 最快变化位**（raw 155298/155351 从 1 起逐参数累乘 `pivotCount`）；
 *  - `calcPivotValue` 返回的是"**落在两个关键值之间的参数个数 m**"（既不是组合索引也不是权重），
 *    SDK 据此查一张 `1 << m` 项的表（raw 155289）来枚举 `2^m` 个角点；
 *  - 插值是**分区间线性** `w = (x − V[k−1]) / (V[k] − V[k−1])`（raw 155228），端点用 ε=1e-4 吸附（raw 5442）；
 *    超界**不夹紧数值**，而是"钳到端点关键帧 + 置 changed 标志"（raw 155186/155193/155214）。
 *
 * ### ★多参数同时插值（`m ≥ 2`）**在本作是常态** —— 曾经的"不可达"结论是错的
 * 2026-09 实测纠正：先前只统计了**网格自身**的 `pivotManager`（那里确实最多 1 维），
 * 但多参数 manager 挂在**变形器**上。例：`B_MY_PARTS_ARM_LEFT.00` 有 3 个参数
 * `PARAM_KAO(3) / PARAM_KAKUSYUKU(3) / PARAM_ARM(3)`（∏=27），而 `PARAM_KAKUSYUKU` 的
 * `.MTN` 曲线**只有 1 个采样**（恒 −23），落在它自己的区间 `[−100, 0]` 内部 ⇒ `frac = 0.77` **恒定**。
 * ⇒ 任何时刻都至少有 2 个维度带插值权重。
 * 只为"第一个 frac>0 的维度"插值、其余维度取整档（旧实现）会让结果在
 * `PARAM_KAO` 的 frac 归零时**在两个近似之间跳变** —— 症状 = 用户实测的
 * **"翅膀与背手整体同步卡顿、而头眼流畅"**（它们共享同一个父变形器，所以同步）。
 * 现在按 SDK 的 `2^m` 角点做多线性混合：`weight = ∏_k (bit_k ? frac_k : 1 − frac_k)`
 * （raw 156321-156441），`m ≤ 1` 时与旧的"单维 lerp"**逐位一致**。
 */

import type {
  MocAffineEnt,
  MocBdAffine,
  MocBdBoxGrid,
  MocDeformer,
  MocDrawData,
  MocModel,
  MocParamPivots,
  MocPivotManager,
} from './moc.js';

/** 2×3 仿射矩阵：`[a, b, c, d, tx, ty]` ⇒ `x' = a*x + c*y + tx`、`y' = b*x + d*y + ty`。 */
export type Affine = readonly [number, number, number, number, number, number];

export const AFFINE_IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `m2 ∘ m1`（先 m1 后 m2）。 */
export function affineMul(m2: Affine, m1: Affine): Affine {
  return [
    m2[0] * m1[0] + m2[2] * m1[1],
    m2[1] * m1[0] + m2[3] * m1[1],
    m2[0] * m1[2] + m2[2] * m1[3],
    m2[1] * m1[2] + m2[3] * m1[3],
    m2[0] * m1[4] + m2[2] * m1[5] + m2[4],
    m2[1] * m1[4] + m2[3] * m1[5] + m2[5],
  ];
}

/** 应用到一个点。 */
export function affineApply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** 逐分量线性插值（`t = 0` ⇒ a，`t = 1` ⇒ b）。 */
export function affineLerp(a: Affine, b: Affine, t: number): Affine {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
    a[4] + (b[4] - a[4]) * t,
    a[5] + (b[5] - a[5]) * t,
  ];
}

/**
 * `AffineEnt` → 矩阵。
 *
 * 顺序（O: 绘制期 `LDAffineTransform`；E: 数值量级自证）：
 * `T(origin) · R(rotDeg) · S(scaleX, scaleY)`，其中 `reflectX/Y` 在缩放里取负号。
 * 即点先缩放（含镜像）→ 再旋转 → 最后平移到 `origin`。
 *
 * ⚠ `reflectX/reflectY` 是 v≥10 才有的两个 u8；本作 335 个模型实测**全为 0**
 * （即本作不用镜像），因此镜像路径属于"按 SDK 语义实现但无语料"的一支。
 */
export function affineEntToMatrix(e: MocAffineEnt): Affine {
  const rad = (e.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let sx = e.scaleX;
  let sy = e.scaleY;
  if (e.reflectX) sx = -sx;
  if (e.reflectY) sy = -sy;
  // [sx,0, 0,sy, 0,0] → R → T
  return [cos * sx, sin * sx, -sin * sy, cos * sy, e.originX, e.originY];
}

/** 一个对象的 pivot 组合数（`∏ pivotCount`；空 ⇒ 1）。 */
export function pivotCombos(pm: MocPivotManager | null | undefined): number {
  let n = 1;
  for (const p of pm?.params ?? []) n *= p.pivotCount;
  return n;
}

/**
 * 参数值 → **`2^m` 个角点**（组合下标 + 权重）。
 *
 * 下标口径：`idx = Σ i_k · stride_k`，`stride_0 = 1` ⇒ **`params[0]` 是最快变化的一位**
 * （O: `sub_4CAB10` raw 155298/155351 从 1 起逐参数累乘 `pivotCount`）。
 *
 * ★**多线性混合（`m ≥ 2` 也correctly处理）**：SDK 的 `calcPivotValue` 给出"落在两个关键值之间的
 * 参数个数 m"，然后枚举 `2^m` 个角点、权重 = `∏_k (bit_k ? frac_k : 1 − frac_k)`
 * （通用分支 raw 156321-156441）。这里增量地构造这些角点：
 *
 * ```
 * corners ← [{0, 1}]
 * for k: corners ← { c + i_k·stride_k , w·(1−f_k) } ∪ (f_k > 0 ? { c + (i_k+1)·stride_k , w·f_k } : ∅)
 * ```
 *
 * `f_k = 0`（该参数正好落在关键帧上）时不产生第二个角点 ⇒ **`m ≤ 1` 时与本文件旧实现的
 * "单维 lerp"逐位一致**（旧实现只是把这条通用公式在 `m ≤ 1` 上的特例写死了）。
 */
export interface PivotCorner {
  /** 组合下标（`Σ (i_k + bit_k) · stride_k`）。 */
  index: number;
  /** 该角点的权重（所有角点之和 = 1）。 */
  weight: number;
}

export interface PivotPick {
  /** `2^m` 个角点（`Σ weight = 1`）；`m = 0` ⇒ 只有 1 个、权重 1。 */
  corners: PivotCorner[];
  /** 每维的档位下标（诊断/测试用）。 */
  dims: number[];
  /** 每维的插值分数（诊断/测试用）。 */
  fracs: number[];
  /** 有插值权重的维度数 = SDK 的 `m`（诊断/测试用）。 */
  m: number;
}

/**
 * 在一维关键值数组里找"落点"：返回**左端档位下标** `i` 与分数 `t ∈ [0,1)`，
 * 使 `v = lerp(values[i], values[i+1], t)`；`v` 夹在 `[values[0], values[last]]`。
 *
 * ★`v` 恰好落在某个关键值上时必须回到"该档的 `t = 0`"（否则 3 档以上会误插值：
 * 旧实现用 `values[i] <= v <= values[i+1]` 会让 `v = values[1]` 返回 `i=0, t=1`，
 * 等价于在 0/1 两档之间插值，`v = values[2]` 时 `indexA` 停在 0）。
 */
function locate(values: number[], v: number): { i: number; t: number } {
  const last = values.length - 1;
  if (last <= 0) return { i: 0, t: 0 };
  if (v <= values[0]!) return { i: 0, t: 0 };
  if (v >= values[last]!) return { i: last, t: 0 };
  let i = 0;
  for (let k = 1; k <= last; k++) if (values[k]! <= v) i = k;
  if (i >= last) return { i: last, t: 0 };
  const a = values[i]!;
  const b = values[i + 1]!;
  return { i, t: b > a ? (v - a) / (b - a) : 0 };
}

/** 每维的档位下标数组（旧口径；已被 `pickPivot` 的角点取代，仅作诊断保留）。 */
function flatten(params: MocParamPivots[], dims: number[]): number {
  let idx = 0;
  let stride = 1;
  for (let k = 0; k < params.length; k++) {
    idx += dims[k]! * stride;
    stride *= params[k]!.pivotCount;
  }
  return idx;
}

/** 把下标夹进数组范围（引擎不检查越界；本实现夹紧以免读到 `undefined`）。 */
function clampIdx(i: number, len: number): number {
  return i < 0 ? 0 : i >= len ? len - 1 : i;
}

/** 按角点权重做多线性混合（数组逐分量；`m = 0` 时原样返回）。 */
function blendPoints(arrs: number[][], corners: PivotCorner[]): number[] {
  if (arrs.length === 0) return [];
  if (corners.length === 1) return arrs[clampIdx(corners[0]!.index, arrs.length)] ?? [];
  const first = arrs[clampIdx(corners[0]!.index, arrs.length)]!;
  const out = new Array<number>(first.length).fill(0);
  for (const c of corners) {
    const a = arrs[clampIdx(c.index, arrs.length)];
    if (!a) continue;
    const w = c.weight;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + (a[i] ?? 0) * w;
  }
  return out;
}

/** 按角点权重混合标量（`m = 0` 时就是那一个值）。 */
function blendScalars(values: number[], corners: PivotCorner[], fallback: number): number {
  if (values.length === 0) return fallback;
  let s = 0;
  for (const c of corners) s += (values[clampIdx(c.index, values.length)] ?? fallback) * c.weight;
  return s;
}

/** 按角点权重混合关键帧矩阵（**逐元素**加权和；`m = 1` 时 = 旧的 `affineLerp`）。 */
function blendAffines(affines: MocAffineEnt[], corners: PivotCorner[]): Affine {
  if (affines.length === 0) return AFFINE_IDENTITY;
  if (corners.length === 1) return affineEntToMatrix(affines[clampIdx(corners[0]!.index, affines.length)]!);
  const out: number[] = [0, 0, 0, 0, 0, 0];
  for (const c of corners) {
    const m = affineEntToMatrix(affines[clampIdx(c.index, affines.length)]!);
    for (let i = 0; i < 6; i++) out[i] = out[i]! + m[i]! * c.weight;
  }
  return out as unknown as Affine;
}

/** 按参数取值表挑出 `2^m` 个角点（见 `PivotPick` 的口径说明）。 */
export function pickPivot(
  pm: MocPivotManager | null | undefined,
  paramValue: (name: string) => number,
): PivotPick {
  const params = (pm?.params ?? []).filter((p) => !!p.paramId) as (MocParamPivots & {
    paramId: NonNullable<MocParamPivots['paramId']>;
  })[];
  if (params.length === 0) return { corners: [{ index: 0, weight: 1 }], dims: [], fracs: [], m: 0 };

  const dims: number[] = [];
  const fracs: number[] = [];
  let m = 0;
  for (const p of params) {
    const hit = locate(p.pivotValues, paramValue(p.paramId.name));
    dims.push(hit.i);
    fracs.push(hit.t);
    if (hit.t > 0) m++;
  }
  let corners: PivotCorner[] = [{ index: 0, weight: 1 }];
  let stride = 1;
  for (let k = 0; k < params.length; k++) {
    const f = fracs[k]!;
    const base = dims[k]! * stride;
    const next: PivotCorner[] = [];
    for (const c of corners) {
      next.push({ index: c.index + base, weight: c.weight * (1 - f) });
      if (f > 0) next.push({ index: c.index + base + stride, weight: c.weight * f });
    }
    corners = next;
    stride *= params[k]!.pivotCount;
  }
  return { corners, dims, fracs, m };
}

// ───────────────────────────── BDBoxGrid（贝塞尔曲面） ─────────────────────────────

/**
 * `BDBoxGrid` 求值：把**单位方格内的局部坐标** `(u, v) ∈ [0,1]²` 映射到该网格控制点张成的曲面上。
 *
 * 控制点数组长度 `(rowCount+1)*(columnCount+1)*2`（x,y 交错），**快变方向 = 列**：
 * `P[r][c] = pts[2*(r*(columnCount+1) + c)]`。
 *
 * 求值 = **两轴各自 Bernstein 次数的张量积**（O: `sub_4CDFD0` raw 157915 →
 * `sub_4CEF60`/`sub_4CE040` 的 `switch (m)`；`m≤4` 是 1/2/3/4 次的**展开式**
 * raw 156133/156154/156188/156248，`m>4` 走通用 Bernstein 乘积 raw 156321-156441）：
 *
 * ```
 * point = Σ_r Σ_c  B_r^{rowCount}(v) · B_c^{columnCount}(u) · P[r][c]
 * ```
 *
 * ★**次数 = 该轴的控制点数 − 1**，不是固定 3 次（本作语料恰好是 2×2 分段 = 3×3 控制点 ⇒ 双二次；
 * 曾经写成"分片取 4×4 并夹紧"是把"控制点数"与"3 次 Bezier"混为一谈，端点会算错）。
 * E：`columnCount == rowCount == 2` 覆盖全部 20 个 BDBoxGrid。
 */
export function boxGridPoint(pts: number[], columnCount: number, rowCount: number, u: number, v: number): { x: number; y: number } {
  const cols = columnCount + 1;
  const cu = Math.min(Math.max(u, 0), 1);
  const cv = Math.min(Math.max(v, 0), 1);
  const bu = bernstein(columnCount, cu);
  const bv = bernstein(rowCount, cv);
  let x = 0;
  let y = 0;
  for (let r = 0; r <= rowCount; r++) {
    const wv = bv[r]!;
    if (wv === 0) continue;
    for (let c = 0; c <= columnCount; c++) {
      const w = wv * bu[c]!;
      if (w === 0) continue;
      const k = 2 * (r * cols + c);
      x += (pts[k] ?? 0) * w;
      y += (pts[k + 1] ?? 0) * w;
    }
  }
  return { x, y };
}

/** `n` 次 Bernstein 基函数在 `t` 处的 `n+1` 个权重。 */
export function bernstein(n: number, t: number): number[] {
  const out: number[] = new Array(n + 1);
  const s = 1 - t;
  // C(n,k) · t^k · s^(n-k)，递推求组合数避免大数
  let c = 1;
  for (let k = 0; k <= n; k++) {
    out[k] = c * t ** k * s ** (n - k);
    c = (c * (n - k)) / (k + 1);
  }
  return out;
}

// ───────────────────────────── 求值入口 ─────────────────────────────

/** 参数取值表：按参数名给值（缺省 ⇒ 用参数定义的 `defaultValue`）。 */
export interface ParamState {
  get(name: string): number;
}

/** 从模型的参数定义建一个可变参数表（初值 = 各参数 `defaultValue`）。 */
export function newParamState(model: MocModel): ParamState & { set(name: string, v: number): void; values: Map<string, number> } {
  const values = new Map<string, number>();
  for (const p of model.params) if (p.id) values.set(p.id.name, p.defaultValue);
  return {
    values,
    get: (name) => values.get(name) ?? 0,
    set(name, v) {
      values.set(name, v);
    },
  };
}

/** 一个网格求值后的结果（坐标已含 BDAffine 链的变换）。 */
export interface DrawDataFrame {
  /** 网格 id 名（诊断/测试用）。 */
  id: string;
  textureNo: number;
  /** 绘制序（越小越先画）。 */
  drawOrder: number;
  opacity: number;
  /** 顶点（**画布坐标**，y 向上；x,y 交错）。 */
  points: number[];
  /** UV（x,y 交错，与 `points` 同长）。 */
  uvs: number[];
  /** 三角索引。 */
  indices: number[];
  colorCompositionType: number;
  culling: boolean;
}

/** 每个部件的求值结果。 */
export interface PartFrame {
  id: string;
  visible: boolean;
  drawables: DrawDataFrame[];
}

/** 一帧模型的求值结果。 */
export interface ModelFrame {
  parts: PartFrame[];
  /** 画布尺寸（渲染层据此摆锚点）。 */
  canvasWidth: number;
  canvasHeight: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 取某变形器的关键帧矩阵（带插值）；`affines` 为空（无关键帧）⇒ 单位阵。 */
function bdAffineMatrix(d: MocBdAffine, state: ParamState): Affine {
  if (d.affines.length === 0) return AFFINE_IDENTITY;
  const n = pivotCombos(d.pivotManager);
  if (n <= 1 || d.affines.length === 1) return affineEntToMatrix(d.affines[0]!);
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  return blendAffines(d.affines, pick.corners);
}

/** 取某变形器的关键帧不透明度（带插值）。 */
function bdOpacity(d: MocDeformer, state: ParamState): number {
  if (d.pivotOpacities.length === 0) return 1;
  if (d.pivotOpacities.length === 1) return d.pivotOpacities[0]!;
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  return blendScalars(d.pivotOpacities, pick.corners, 1);
}

/** 取某变形器的关键帧网格（带插值）。 */
function bdBoxGridPoints(d: MocBdBoxGrid, state: ParamState): number[] {
  if (d.pivotPoints.length === 0) return [];
  if (d.pivotPoints.length === 1) return d.pivotPoints[0]!;
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  return blendPoints(d.pivotPoints, pick.corners);
}

/** 取某网格的关键帧顶点（带插值）。 */
function drawDataPoints(d: MocDrawData, state: ParamState): number[] {
  if (d.pivotPoints.length === 0) return [];
  if (d.pivotPoints.length === 1) return d.pivotPoints[0]!;
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  return blendPoints(d.pivotPoints, pick.corners);
}

/** 取某网格的关键帧绘制序 / 不透明度。 */
function drawDataOrder(d: MocDrawData, state: ParamState): { order: number; opacity: number } {
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  const order = blendScalars(d.pivotDrawOrders, pick.corners, d.averageDrawOrder);
  const opacity = blendScalars(d.pivotOpacities, pick.corners, 1);
  return { order: d.pivotDrawOrders.length === 0 ? d.averageDrawOrder : order, opacity };
}

/**
 * **求值一帧**：参数 → 每个部件的每个网格的最终顶点。
 *
 * 变换链（本作语料实测的 `targetId` 链）：网格 `targetId` → 变形器 `id`；变形器自身的 `targetId`
 * 继续往上（`D_FACE.00 → B_FACE.00 → B_BODY.00 → B_FOOT.00 → DST_BASE`）。矩阵按链**从外到内**复合：
 * `M = M_root ∘ … ∘ M_leaf`。
 *
 * ⚠ **未确认的一支**：`DrawData.pivotPoints` 到底是"已含本网格所属变形器变换的最终坐标"还是"局部坐标"。
 * E 的事实是 `pivotPoints` 随 pivot 档位变化（说明它**至少含参数驱动的形变**），但语料无法区分
 * "形变已烘焙进点"与"形变在 BDAffine 里"。当前实现按**后者**（点 = 局部，BDAffine 再变换），
 * 若与真机对照发现镜像/双倍变换，改为不叠乘最内层即可（TODO：E4 对照后钉死）。
 */
export function evaluateModel(model: MocModel, state: ParamState): ModelFrame {
  const deformerById = new Map<string, MocDeformer>();
  for (const part of model.parts) {
    for (const d of part.deformers) if (d.id) deformerById.set(d.id.name, d);
  }

  /** 从某个变形器 id 往上累积矩阵（含自身）。 */
  const chainMatrix = (targetId: string | null | undefined, depth = 0): Affine => {
    if (!targetId || depth > 16) return AFFINE_IDENTITY;
    const d = deformerById.get(targetId);
    if (!d) return AFFINE_IDENTITY;
    const own = d.kind === 'bdAffine' ? bdAffineMatrix(d, state) : AFFINE_IDENTITY;
    const parent = chainMatrix(d.targetId?.name ?? null, depth + 1);
    return affineMul(parent, own);
  };

  const parts: PartFrame[] = [];
  for (const part of model.parts) {
    const drawables: DrawDataFrame[] = [];
    for (const dd of part.drawables) {
      const pts = drawDataPoints(dd, state);
      if (pts.length === 0) continue;
      const m = chainMatrix(dd.targetId?.name ?? null);
      const out = new Array<number>(pts.length);
      for (let i = 0; i < pts.length; i += 2) {
        const p = affineApply(m, pts[i]!, pts[i + 1]!);
        out[i] = p.x;
        out[i + 1] = p.y;
      }
      const { order, opacity } = drawDataOrder(dd, state);
      drawables.push({
        id: dd.id?.name ?? '',
        textureNo: dd.textureNo,
        drawOrder: order,
        opacity: opacity * chainOpacity(dd.targetId?.name ?? null, deformerById, state),
        points: out,
        uvs: dd.uvs,
        indices: dd.indexArray,
        colorCompositionType: dd.colorCompositionType,
        culling: dd.culling,
      });
    }
    parts.push({ id: part.id?.name ?? '', visible: part.visible, drawables });
  }
  return { parts, canvasWidth: model.canvasWidth, canvasHeight: model.canvasHeight };
}

/** 沿 targetId 链把各变形器的关键帧不透明度相乘（E：语料里多为 1）。 */
function chainOpacity(
  targetId: string | null,
  byId: Map<string, MocDeformer>,
  state: ParamState,
  depth = 0,
): number {
  if (!targetId || depth > 16) return 1;
  const d = byId.get(targetId);
  if (!d) return 1;
  return bdOpacity(d, state) * chainOpacity(d.targetId?.name ?? null, byId, state, depth + 1);
}

/** 一帧里所有网格按绘制序排序后的扁平列表（渲染用）。 */
export function flattenDrawOrder(frame: ModelFrame): Array<{ partId: string; dd: DrawDataFrame }> {
  const out: Array<{ partId: string; dd: DrawDataFrame }> = [];
  for (const p of frame.parts) if (p.visible) for (const dd of p.drawables) out.push({ partId: p.id, dd });
  out.sort((a, b) => a.dd.drawOrder - b.dd.drawOrder);
  return out;
}
