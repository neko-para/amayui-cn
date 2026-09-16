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
 *  ⚠**本作语料的多参数插值不可达**（E）：`params.length ≥ 2` 的网格只有 97 个，且这些参数的取值
 *  总是落在**端值**上 ⇒ 任何时刻至多一个参数处在区间内部（`m ≤ 1`，即只有 2 个角点）。
 *  因此本实现只处理"一个参数插值 + 其余取整档"，与 SDK 在 `m ≤ 1` 时**等价**；
 *  `m ≥ 2` 分支（`2^m` 角点混合）在本作不可达，未实现（写在各自函数注释里）。
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
 * 参数值 → 组合下标 + 各维插值权重。
 *
 * 下标口径：`idx = Σ i_k · stride_k`，`stride_0 = 1` ⇒ **`params[0]` 是最快变化的一位**
 * （O: `sub_4CAB10` raw 155298/155351 从 1 起逐参数累乘 `pivotCount`）。
 *
 * ★**与 SDK 的等价性（`m ≤ 1`）**：SDK 的 `calcPivotValue` 返回"落在两个关键值之间的参数个数 m"，
 * 然后枚举 `2^m` 个角点、权重 = `∏_k (bit_k ? frac_k : 1 − frac_k)`（通用分支 raw 156321-156441）。
 * 本函数只取**一个** frac ≠ 0 的维度做线性插值 ⇒ 当 `m ≤ 1` 时两者结果**逐位公式相同**；
 * 而 E 实测本作语料 `m ≥ 2` 不可达（`params.length ≥ 2` 的网格只有 97 个，其取值总是端值）⇒
 * 对本作全部资产**等价**。`m ≥ 2` 的多角点混合未实现（本作不可达，写在这里以免被误当"已支持"）。
 */
export interface PivotPick {
  /** 组合下标（第 A 个关键帧）。 */
  indexA: number;
  /** 插值目标（`t > 0` 时有效；否则等于 indexA）。 */
  indexB: number;
  /** 插值权重 0..1。 */
  t: number;
  /** 每维的档位下标（诊断/测试用）。 */
  dims: number[];
}

/**
 * 在一维关键值数组里找"落点"：返回**左端档位下标** `i` 与权重 `t ∈ [0,1)`，
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

/** 把每维档位下标折成组合下标（`params[0]` 最快变化）。 */
function flatten(params: MocParamPivots[], dims: number[]): number {
  let idx = 0;
  let stride = 1;
  for (let k = 0; k < params.length; k++) {
    idx += dims[k]! * stride;
    stride *= params[k]!.pivotCount;
  }
  return idx;
}

/** 按参数取值表挑出关键帧下标（见 `PivotPick` 的口径说明）。 */
export function pickPivot(
  pm: MocPivotManager | null | undefined,
  paramValue: (name: string) => number,
): PivotPick {
  const params = (pm?.params ?? []).filter((p) => !!p.paramId) as (MocParamPivots & {
    paramId: NonNullable<MocParamPivots['paramId']>;
  })[];
  if (params.length === 0) return { indexA: 0, indexB: 0, t: 0, dims: [] };

  const dims: number[] = [];
  let t = 0;
  let tDim = -1;
  for (let k = 0; k < params.length; k++) {
    const p = params[k]!;
    const v = paramValue(p.paramId.name);
    const hit = locate(p.pivotValues, v);
    dims.push(hit.i);
    if (hit.t > 0 && tDim < 0) {
      t = hit.t;
      tDim = k;
    }
  }
  const indexA = flatten(params, dims);
  if (tDim < 0) return { indexA, indexB: indexA, t: 0, dims };
  const next = dims.slice();
  next[tDim] = Math.min(next[tDim]! + 1, params[tDim]!.pivotCount - 1);
  return { indexA, indexB: flatten(params, next), t, dims };
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
  const n = pivotCombos(d.pivotManager);
  if (n <= 1 || d.affines.length === 1) return d.affines.length ? affineEntToMatrix(d.affines[0]!) : AFFINE_IDENTITY;
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  const a = d.affines[Math.min(pick.indexA, d.affines.length - 1)] ?? d.affines[0]!;
  if (pick.t === 0 || pick.indexA === pick.indexB) return affineEntToMatrix(a);
  const b = d.affines[Math.min(pick.indexB, d.affines.length - 1)] ?? a;
  return affineLerp(affineEntToMatrix(a), affineEntToMatrix(b), pick.t);
}

/** 取某变形器的关键帧不透明度（带插值）。 */
function bdOpacity(d: MocDeformer, state: ParamState): number {
  if (d.pivotOpacities.length === 0) return 1;
  if (d.pivotOpacities.length === 1) return d.pivotOpacities[0]!;
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  const a = d.pivotOpacities[Math.min(pick.indexA, d.pivotOpacities.length - 1)] ?? 1;
  const b = d.pivotOpacities[Math.min(pick.indexB, d.pivotOpacities.length - 1)] ?? a;
  return lerp(a, b, pick.t);
}

/** 取某变形器的关键帧网格（带插值）。 */
function bdBoxGridPoints(d: MocBdBoxGrid, state: ParamState): number[] {
  if (d.pivotPoints.length === 0) return [];
  if (d.pivotPoints.length === 1) return d.pivotPoints[0]!;
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  const a = d.pivotPoints[Math.min(pick.indexA, d.pivotPoints.length - 1)] ?? d.pivotPoints[0]!;
  const b = d.pivotPoints[Math.min(pick.indexB, d.pivotPoints.length - 1)] ?? a;
  if (pick.t === 0 || pick.indexA === pick.indexB || a === b) return a;
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = lerp(a[i]!, b[i] ?? a[i]!, pick.t);
  return out;
}

/** 取某网格的关键帧顶点（带插值）。 */
function drawDataPoints(d: MocDrawData, state: ParamState): number[] {
  if (d.pivotPoints.length === 0) return [];
  if (d.pivotPoints.length === 1) return d.pivotPoints[0]!;
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  const a = d.pivotPoints[Math.min(pick.indexA, d.pivotPoints.length - 1)] ?? d.pivotPoints[0]!;
  const b = d.pivotPoints[Math.min(pick.indexB, d.pivotPoints.length - 1)] ?? a;
  if (pick.t === 0 || pick.indexA === pick.indexB || a === b) return a;
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = lerp(a[i]!, b[i] ?? a[i]!, pick.t);
  return out;
}

/** 取某网格的关键帧绘制序 / 不透明度。 */
function drawDataOrder(d: MocDrawData, state: ParamState): { order: number; opacity: number } {
  const pick = pickPivot(d.pivotManager, (name) => state.get(name));
  const idxA = Math.min(pick.indexA, Math.max(0, d.pivotDrawOrders.length - 1));
  const idxB = Math.min(pick.indexB, Math.max(0, d.pivotDrawOrders.length - 1));
  const order =
    d.pivotDrawOrders.length === 0
      ? d.averageDrawOrder
      : lerp(d.pivotDrawOrders[idxA] ?? d.averageDrawOrder, d.pivotDrawOrders[idxB] ?? d.averageDrawOrder, pick.t);
  const opacity =
    d.pivotOpacities.length === 0 ? 1 : lerp(d.pivotOpacities[idxA] ?? 1, d.pivotOpacities[idxB] ?? 1, pick.t);
  return { order, opacity };
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
