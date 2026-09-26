/**
 * 求值：把 DrawItem/Mesh 的窗状态 + 时钟换算成"这一帧画成什么样"
 * （颜色 / 缩放 / 旋转角 / 平移 / 源矩形 / mesh 顶点色）。
 *
 * ★这些函数会**先锁存窗起点**（经 `winPhase`）再插值，因此不是纯函数：
 * 调用顺序必须是 `advanceWindows(it, clock)` → `itemColor/itemScale/...`，见 pixiBackend.present。
 */
import type { Item, MeshObj, Vec3 } from './model.js';
import { ITEM_FLAG_ANIM_LOOP, W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from './model.js';
import { freezeWindow, winPhase, windowDone } from './animWindow.js';
import { lerpArgbWindow, lerpArgbFloat, lerpVec3 } from './colorMath.js';

// ---------------------------------------------------------------------------
// **B 层（`Item.flags` bit2）周期/循环动画层** —— 消费端 = 引擎 `sub_49BCC0`（raw 117944-118365）
//
// **驱动点（对齐用）**：`sub_49BCC0` 的唯一调用者 = 渲染器 `sub_4AEEA0`（"逐 order 画一项"）
// 的 raw 133394，而 `sub_4AEEA0` 由场景渲染主循环 `sub_4B06D0`（raw 134417-1367xx）在 8 个点调用
// （raw 135581/135764/135986/136119/136292/136556/136660/136738）。两个时钟格都在 Scene 上：
//  - `Scene+46500`（= `+0xB5A4`，dword `[11625]`）= **now**（本模块的 `clock` 就是它）；
//  - `Scene+46504`（dword `[11626]`）= 换格通道判脏时用的另一个时间量（raw 118359-118360）。
// 第一层台账 `analysis/functions.json` 另记：主循环按 `rec[0] = 1/2/3` 分派绘制类别 ⇒ 与
// "绘图项/mesh/立绘节点三路归并"是同一段代码（见 `renderer/pixi/presenter.ts` 的归并说明）。
//
// 门（两级，缺一不可）：
//  ① **bit2**（raw 133390：`(flags & 4) == 0 ⇒ 整层跳过`；命中时 raw 133395 还要强制
//     `Scene+46532 = 1`（世界矩阵有效位）⇒ 见 `itemUsesWorld`）；
//  ② **每通道 `period > 0`**（raw 118103 / 118135 / 118223 / 118234 / 118344）。
//
// 5 条通道（raw 行区间 / 起点槽 / 周期槽 / 波形）：
//  | # | 通道 | 起点 | 周期 | 波形 | raw |
//  |---|---|---|---|---|---|
//  | 1 | 颜色往复 | `+524`(`+0x20C`) | `+544`(`+0x220`) | 三角 | 118102-118131（写**调用方局部** diffuse，不回写元素） |
//  | 2 | 缩放往复 | `+528`(`+0x210`) | `+548`(`+0x224`) | 三角 | 118133-118220（`lerp(单位阵, +592(=+0x250), r)`） |
//  | 3 | 匀速旋转 | `+532`(`+0x214`) | `+552`(`+0x228`) | **锯齿**（每周期一圈，raw 118227） | 118222-118230（轴 `+580/584/588`） |
//  | 4 | 平移往复 | `+536`(`+0x218`) | `+556`(`+0x22C`) | 三角 | 118232-118341（`lerp(单位阵, +656(=+0x290), r)`） |
//  | 5 | 贴图换格 | `+540`(`+0x21C`) | `+560`(`+0x230`) | **单调递增再取模**（不是三角） | 118343-118361（格数 `+568`、列数 `+572`） |
//
// 起点锁存：`if (!起点槽) 起点槽 = now`（raw 118105-118106 / 118137-118138 / 118225-118226 /
// 118236-118237 / 118346-118347）；锁存值经渲染期整块回写（raw 133448 `qmemcpy(result, v26, 0x2E4)`）
// 持久化到元素上 ⇒ **这里也把 `l.start` 写回模型**（不是纯查询）。
// ---------------------------------------------------------------------------

/**
 * B 层某通道的**已过时间**（**有副作用**：起点槽为 0 时锁存 `clock`）。
 * 返回 `null` = 该通道不跑（bit2 未置 / `period <= 0`）；否则返回 `clock − start`（≥ 0）。
 *
 * ★**不要在这里取模**：引擎对"往复/锯齿"通道取模（`raw 118107/118139/118227/118238` 的
 * `(now−start) % period`），但**换格通道是除法**（raw 118348 `(now−start) / period`，单调递增）
 * ⇒ 取模与分帧两件事各自在通道里做，共用一个"已过时间"才是忠实的。
 */
function loopElapsed(it: Item, idx: number, clock: number): number | null {
  if (!(it.flags & ITEM_FLAG_ANIM_LOOP)) return null;
  const l = it.loops[idx]!;
  if (l.period <= 0) return null;
  if (l.start === 0) l.start = clock; // raw 118105-118106 等：`if (!start) start = now`
  return clock - l.start;
}

/**
 * 三角波（**往复**通道颜色/缩放/平移共用）：`phase = (clock−start) % period`，
 * 返回 `tri = phase < period/2 ? 2·phase : 2·(period−phase)` ∈ [0, period]（引擎 raw 118107-118111 /
 * 118139-118143 / 118238-118242 的 `v19`；`period/2` 是整数除法，故用 `Math.floor`）。
 *
 * ★调用方必须传**已经取过模**的相位（引擎 `v18 = (now − start) % period`）。
 *
 * 浮点通道（缩放/平移）用 `tri/period` 作插值系数；**颜色通道是整数除法**
 * （raw 118116：`(tri·target + (period−tri)·cur) / period`）⇒ 两者必须分开用，别把颜色也走浮点。
 */
export function loopTriangle(phase: number, period: number): number {
  const half = Math.floor(period / 2);
  return phase >= half ? 2 * (period - phase) : 2 * phase;
}

/** 三角波比值 `tri/period` ∈ [0,1]（浮点通道的插值系数）。 */
export function loopTriangleRatio(phase: number, period: number): number {
  return loopTriangle(phase, period) / period;
}

/** 逐通道整数插值（引擎 raw 118116-118129：`(tri·target + (period−tri)·cur) / period`，整数除法截断）。 */
function loopArgb(base: number, target: number, tri: number, period: number): number {
  const ch = (s: number): number => {
    const cur = (base >>> s) & 0xff;
    const to = (target >>> s) & 0xff;
    return Math.trunc((tri * to + (period - tri) * cur) / period) & 0xff;
  };
  return (((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0) >>> 0;
}

/**
 * **世界矩阵有效位**（引擎 `Scene+46532`）的 emulator 等价物。
 *
 * `Scene+46532 ← DrawItem+0x68`（raw 133391）；但 bit2 命中时 raw 133395 **强制置 1**
 * （`sub_49BCC0` 算出的 B 层矩阵必须参与合成）⇒ 凡挂了 B 层的项一律走世界矩阵路径。
 * 读取者 = 绘制期 raw 119573（`if (Scene+46532) D3DXMatrixMultiply(…)`）；
 * emulator 侧的消费者 = `pixi/presenter.ts` 的 `if (it.useWorld)`（决定 pivot/缩放/旋转/平移是否参与合成）。
 */
export function itemUsesWorld(it: Item): boolean {
  return it.useWorld || (it.flags & ITEM_FLAG_ANIM_LOOP) !== 0;
}

/**
 * **撤幕留帧**的解除判据用的覆盖率（`tickets/T-0067`）：新内容按源矩形面积算，
 * 达到视口的这个比例才算"**又铺满一屏**"。
 *
 * 取 0.9 而不是 1.0：`draw-texture` 的源矩形常常是 1280×720 的满屏图，但也见过
 * 1216×720 / 1280×704 这类"几乎满屏"（历史遗留的边框留白）⇒ 卡在 1.0 会让留帧白白多扛几帧。
 */
export const FRAME_HOLD_COVER_RATIO = 0.9;

/**
 * 这一项**是否铺满一屏**（**无时钟、无副作用** —— 只看建项时定下的 `flags`/`srcW`/`srcH`）。
 *
 * ★为什么不能拿 `itemSrcRect(it, clock)` 判：那会求值 flipbook 窗（第 5 个窗）并**锁存窗起点**，
 * 而帧内的 `clockMs` 还是上一帧的值（`tickets/T-0004` 的 G3 实测就是这类"宿主渲染策略污染共享模型"）。
 * 留帧只是宿主侧的呈现近似 ⇒ 判据必须只读**建项那一刻的字段**。
 *
 * ★用途（`tickets/T-0067`，证据 = 真机日志 `[frame-hold] 满屏幕布 … 被撤` 后紧跟一条
 * `draw-texture → 解除留帧`，而那一笔只有 **256×128**）：满屏幕布被撤之后，脚本往往先画一小块
 * 转场用的贴片（`setTransition` 之前）⇒ 旧实现"任何 `draw-texture` 都解除留帧"会把**中间态**
 * （幕没了、新一屏还没铺）如实呈现出来 = 用户看到的"闪一帧、露出下面的界面"。
 */
export function itemCoversView(
  it: Item,
  viewW: number,
  viewH: number,
  ratio: number = FRAME_HOLD_COVER_RATIO,
): boolean {
  if ((it.flags & 1) === 0) return false; // 不可画（引擎渲染门 raw 133361）
  if (!(it.srcW > 0) || !(it.srcH > 0)) return false;
  if (!(viewW > 0) || !(viewH > 0)) return false;
  return it.srcW * it.srcH >= ratio * viewW * viewH;
}

/**
 * **几何口径**：这块 mesh 的外接矩形是否铺满视口（撤幕留帧武装判据的几何半边；`tickets/T-0182`）。
 *
 * 与 `itemCoversView` 同族、同纪律：**无时钟、无副作用**（只读 `flags` 与顶点几何），
 * 只用 `FRAME_HOLD_COVER_RATIO` 一个比例口径 —— 两处判据不许各写一套阈值。
 *
 * ★判据口径 = "**与视口的交集面积**"，而不是"外接矩形要 >= 1280×720"。
 * 后者是 `tickets/T-0182` 的缺陷成因：`tickets/T-0155` 给 `0x320` 的顶点加了引擎的半像素偏移
 * （`sub_4A1F00` raw 122235-122238：`x/y -= dbl_51D7F8(0.5)`，见 `handlers/gfx-item.ts` 的 `HALF_PIXEL`），
 * 于是语料里**每一块满屏幕布**的外接矩形都是 `(-0.5,-0.5)..(1279.5,719.5)` ——
 * `Math.max(xs) = 1279.5 < 1280` ⇒ 旧判据**恒假** ⇒ "满屏幕布被撤 → 留帧"整条路径静默失效
 * （症状：GAMESTART 渐黑之后、SN0000 渐入之前闪出一帧 TITLE/配置界面）。
 * 交集口径对半像素、对"比视口略大/略小"的幕都成立（`-0.5..1279.5` 的交集 =
 * `1279.5×719.5 = 99.96%` 视口 ≥ 0.9）。
 */
export function meshFillsViewport(
  m: MeshObj,
  viewW: number,
  viewH: number,
  ratio: number = FRAME_HOLD_COVER_RATIO,
): boolean {
  if ((m.flags & 1) === 0) return false; // 无几何（引擎绘制门 raw 133502 `flags & 1`）
  if (m.verts.length < 3) return false; // 少于三角形 ⇒ 铺不满（`0x320` 的 vcount 下限是 1，别假设 4）
  if (!(viewW > 0) || !(viewH > 0)) return false; // 视口未就绪 ⇒ 宁可不武装
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const v of m.verts) {
    if (v.x < x0) x0 = v.x;
    if (v.y < y0) y0 = v.y;
    if (v.x > x1) x1 = v.x;
    if (v.y > y1) y1 = v.y;
  }
  const ix = Math.min(viewW, x1) - Math.max(0, x0);
  const iy = Math.min(viewH, y1) - Math.max(0, y0);
  if (!(ix > 0) || !(iy > 0)) return false;
  return ix * iy >= ratio * viewW * viewH;
}

/**
 * 这块 mesh **此刻是否真的盖着屏幕**（= 几何铺满 **且** 当前端色 α>0；`tickets/T-0182`）。
 *
 * ★为什么"几何铺满"不够：撤掉一块**已经全透明**的满屏幕布在画面上什么都没改变
 * （典型站点：TITLE 的入场渐显 `TITLE.txt:731-748` —— 先 `create-mesh 30d40` 造满屏黑幕、
 * 再用 `0x323` 把它 300ms 淡到全透明、`wait` 到窗末、最后 `detach-texture 30d40 1` 撤掉；
 * 撤的那一刻 `state0` 已被窗末烘焙成 `0x00000000`）⇒ 在那里武装留帧只会白白冻结 60 帧
 * （把标题立绘的 Live2D 动作也冻住），而引擎那边撤一块透明幕本来就不改变任何像素。
 * 判据只读 `state0`/`state1`/`flags`（**无时钟、无副作用**；不调 `calcDiffuse`，那会锁存窗起点）。
 *
 * 两半的保守方向：
 *  - 无动画窗（bit1 清）⇒ 可见色**就是** `state0`（引擎语义，见 `#meshVisible`）⇒ 按它精确判；
 *  - 有动画窗（bit1 置）⇒ 可见色在两端之间插值 ⇒ **任一端 α>0 就算"可能盖着"**（宁可多留几帧，
 *    也不能因为"起点是透明的"就漏判一块正在淡入的幕）。
 */
export function meshCoversViewport(
  m: MeshObj,
  viewW: number,
  viewH: number,
  ratio: number = FRAME_HOLD_COVER_RATIO,
): boolean {
  if (!meshFillsViewport(m, viewW, viewH, ratio)) return false;
  if ((m.state0 >>> 24) & 0xff) return true;
  return (m.flags & 2) !== 0 && (((m.state1 >>> 24) & 0xff) > 0);
}

/**
 * **`[handle, handle+count)` 区间里有没有"此刻盖着屏幕的幕"**（撤幕留帧武装判据的区间版）。
 *
 * `count <= 1` = `0x1F7` 的单图元移除（`sub_4AB950`）；`count > 1` = 区间批量移除（`sub_4ABB60`）
 * —— 与 `scDetachTexture` 的分派口径一致。
 */
export function meshesCoverViewInRange(
  meshes: Iterable<MeshObj>,
  handle: number,
  count: number,
  viewW: number,
  viewH: number,
  ratio: number = FRAME_HOLD_COVER_RATIO,
): boolean {
  const hi = count <= 1 ? handle + 1 : handle + count;
  for (const m of meshes) {
    if (m.handle < handle || m.handle >= hi) continue;
    if (meshCoversViewport(m, viewW, viewH, ratio)) return true;
  }
  return false;
}

/**
 * draw-item 的 diffuse 色（full ARGB）。
 *
 * **求值器位置（实证，见文件头"逐帧求值器"一节）**：A 层 = `sub_49AA30` 内 raw 117434-117483
 * （由 DrawItem 渲染器 `sub_4AEEA0` 在 raw 133389 以 `a2 = 该 DrawItem` 调用，结果经 `a4`
 * （= 调用方 `&v25` 的指针）写回，再于 raw 133443 作为 diffuse 交给纹理绘制）；
 * **B 层颜色往复** = `sub_49BCC0` raw 118102-118131（同样写调用方局部 ⇒ **不回写 `Item.from`**，
 * 否则会污染 A 层基线色）。
 */
export function itemColor(it: Item, clock: number): number {
  let c = it.from >>> 0;
  if (it.flags & 2) {
    const p = winPhase(it, W_COLOR, clock);
    if (p.phase === 'active') {
      // we = clock − start − delay（winPhase 已保证 > 0）；dur > 0 由 winPhase 保证
      const w = it.wins[W_COLOR]!;
      c = lerpArgbWindow(it.from, it.to, clock - it.animStart - w.delay, w.dur);
    }
  }
  const elapsed = loopElapsed(it, W_COLOR, clock); // B 层（bit2）：颜色往复
  if (elapsed !== null) {
    const period = it.loops[W_COLOR]!.period;
    c = loopArgb(c, it.loopTo, loopTriangle(elapsed % period, period), period); // raw 118107：先 %period
  }
  return c >>> 0;
}

/**
 * 缩放（窗1 / `0x21E`）：延迟期保持 `scaleWork`，窗内 `scaleWork → scaleTarget` 逐分量插值。
 *
 * B 层（`0x233`）在此之上**相乘**：引擎把 A 层矩阵与 B 层矩阵依次右乘（raw 118215-118216
 * `D3DXMatrixMultiply(v79, v79, v88)`），两个都是缩放阵 ⇒ 分量相乘；B 层本身是
 * `lerp(单位阵, +592, tri/period)`（raw 118147-118214）⇒ `1 + (loopScale − 1)·r`。
 */
export function itemScale(it: Item, clock: number): Vec3 {
  let s: Vec3;
  if (it.flags & 2) {
    const p = winPhase(it, W_SCALE, clock);
    if (p.phase === 'active') s = lerpVec3(it.scaleWork, it.scaleTarget, p.t);
    else if (p.phase === 'before') s = { ...it.scaleWork };
    else s = it.scaleTarget;
  } else {
    s = it.scaleTarget;
  }
  const elapsed = loopElapsed(it, W_SCALE, clock); // B 层（bit2）：缩放往复
  if (elapsed === null) return s;
  const period = it.loops[W_SCALE]!.period;
  const r = loopTriangleRatio(elapsed % period, period); // raw 118139：`(now−start) % period`
  const L = it.loopScale;
  return { x: s.x * (1 + (L.x - 1) * r), y: s.y * (1 + (L.y - 1) * r), z: s.z * (1 + (L.z - 1) * r) };
}

/**
 * **pivot 的局部坐标**（引擎 `sub_49AA30` raw 117425-117429 与 117932-117933）。
 *
 * 引擎的世界矩阵按行向量序是 `T(-pivot)·S·R·Tt·T(+pivot)`，作用在**已建在描画位置上**的四边形上
 * ⇒ 合成结果 = `v' = S·R·(v − pivot) + t + pivot`（`v = pos + 局部偏移`）。
 * `pivot` 由 `0x217` **原样**写入 DrawItem`+24/+28/+32`（`sub_4ACF20`，新建项由 `sub_49A300`
 * 置 **0**），所以它是**绝对坐标**，不是局部量。
 *
 * Pixi 的语义是 `screen(l) = position + S·R·(l − sprite.pivot)`。要与上式逐项相等必须**同时**满足：
 * ```text
 * sprite.position = pivot + t          sprite.pivot = pivot − pos
 * ```
 * ⇒ 本函数给 `sprite.pivot`，位置走 `itemPivotPosition`。**两个必须成对使用**：
 * 只改 pivot 而位置仍用 `pos` 的话，只有 `pivot == pos` 时才等价（大多数项恰好如此，所以长期没暴露），
 * 一旦脚本给出偏离 `pos` 的绝对 pivot，缩放项就会整体平移 `(pivot − pos)` —— 2026-09 实测：
 * `CONFIG1` 滚动条中段的 pivot 是 `707ffa + 32e`（弹窗原点 + 轨道 x）而描画位置是 `32e`
 * ⇒ 打开过字体选择器（`707ffa` 被置 348 且脚本从不复位）之后一滚动，那条被 `0x1FD` 拉伸的中段
 * 就整体左移 348px（用户实测「滚动条中间 scale 出的区域漂到左边」）。
 */
export function itemPivotLocal(it: Item): Vec3 {
  return { x: it.pivotX - it.posX, y: it.pivotY - it.posY, z: it.pivotZ - it.posZ };
}

/** `sprite.position` = **pivot**（+ 平移动画偏移）；与 `itemPivotLocal` 成对使用（见其说明）。 */
export function itemPivotPosition(it: Item, clock: number): Vec3 {
  const t = itemTranslation(it, clock);
  return { x: it.pivotX + t.x, y: it.pivotY + t.y, z: it.pivotZ + t.z };
}

/** 该帧的完整渲染位姿（Pixi 语义）；两个宿主/测试共用同一份映射。 */
export function itemRenderPlacement(
  it: Item,
  clock: number,
): { position: Vec3; pivot: Vec3; scale: Vec3; rotRad: number } {
  return {
    position: itemPivotPosition(it, clock),
    pivot: itemPivotLocal(it),
    scale: itemScale(it, clock),
    rotRad: itemRotationRad(it, clock),
  };
}

/** 旋转（窗2 / `0x21F`）：延迟期保持 `rotWork`，窗内轴与角分别插值（引擎 raw 117587-117620 插值后 `D3DXMatrixRotationAxis`）。 */
export function itemRotationRad(it: Item, clock: number): number {
  let deg = it.rotTarget.deg;
  if (it.flags & 2) {
    const p = winPhase(it, W_ROT, clock);
    if (p.phase === 'before') deg = it.rotWork.deg;
    else if (p.phase === 'active') deg = it.rotWork.deg + (it.rotTarget.deg - it.rotWork.deg) * p.t;
  }
  deg += loopRotationDeg(it, clock); // B 层（bit2）：匀速旋转
  return (deg * Math.PI) / 180;
}

/**
 * B 层匀速旋转（`0x234`）的**角度增量**（度）。
 *
 * 引擎 raw 118222-118230：`if (+552 > 0) { 锁存 +532; angle = 360·((now−start) % +552)/+552;
 * D3DXMatrixRotationAxis(…, 轴 = +580/584/588, angle·π/180) }` —— **锯齿**（每周期整一圈，不是往复）。
 *
 * ★二维投影（**披露的近似**）：emulator 的 sprite 只有**一个**旋转角，没有轴的概念
 *   （A 层 `0x21F` 的 `rotTarget.axis` 也一直是"只存不用"，见 `itemRotationRad`）⇒ 这里用轴的 **z 分量符号**
 *   决定方向（`axis.z < 0 ⇒ −`），即"屏幕平面内、绕 Z 轴"的那一支。
 *   语料里 `i234 … 0 0 (local-int 2)` 的轴正是 `(0,0,±1)`（`src/SC0000.txt:16096/16192`、
 *   `src/SC1620.txt:16351/16355`）⇒ 该近似覆盖真实用法。
 *   ⚠D3D 左手系与 canvas 的手性差异**未逐项验证**：若实机方向相反，只需翻这里的符号（一处）。
 */
export function loopRotationDeg(it: Item, clock: number): number {
  const elapsed = loopElapsed(it, W_ROT, clock);
  if (elapsed === null) return 0;
  const period = it.loops[W_ROT]!.period;
  const dir = it.loopAxis.z < 0 ? -1 : 1;
  return dir * 360 * ((elapsed % period) / period); // raw 118227：`(now−start) % period` ⇒ 锯齿
}

/**
 * 平移（窗3 / `0x220`）：延迟期保持 `transWork`，窗内 `transWork → transTarget` 逐分量插值。
 *
 * B 层（`0x235`）在此之上**相加**：引擎的合成序是行向量右乘
 * `… · S_B · R_B · T_B · T(pos)`（raw 118338 的 `D3DXMatrixMultiply(v79, v79, v88)` 之后仍有
 * raw 118363 的 `T(pos)`）⇒ `T_B` 作用在"已经过 A 层/缩放/旋转的点"上、**不被缩放或旋转**
 * （行向量序下 `v·S·T = v·S + t`）⇒ 屏幕空间里就是一个纯加法偏移，`lerp(0, +656 的平移分量, tri/period)`。
 */
export function itemTranslation(it: Item, clock: number): Vec3 {
  let t: Vec3;
  if (it.flags & 2) {
    const p = winPhase(it, W_TRANS, clock);
    if (p.phase === 'active') t = lerpVec3(it.transWork, it.transTarget, p.t);
    else if (p.phase === 'before') t = { ...it.transWork };
    else t = it.transTarget;
  } else {
    t = it.transTarget;
  }
  const elapsed = loopElapsed(it, W_TRANS, clock); // B 层（bit2）：平移往复
  if (elapsed === null) return t;
  const period = it.loops[W_TRANS]!.period;
  const r = loopTriangleRatio(elapsed % period, period); // raw 118238：`(now−start) % period`
  const L = it.loopTrans;
  return { x: t.x + L.x * r, y: t.y + L.y * r, z: t.z + L.z * r };
}

/**
 * flipbook（窗4 / `0x239`）→ **源矩形**（不是 UV）。忠实复刻引擎 raw 117797-117831：
 * `frame = frames · (clock − start − delay) / dur`、`col = frame % cols`、`row = frame / cols`，
 * 源矩形偏移 `(col · srcW, row · srcH)`（引擎里源矩形存 left/top/right/bottom，
 * `a2[4] − a2[2]` = 源宽 = 脚本 op5，故偏移量就是 `srcW/srcH`）。
 * 窗结束后：`fbFlags & 1` ⇒ **保持末帧**（`frame = frames − 1`），否则**复位**。
 */
export function itemSrcRect(it: Item, clock: number): { x: number; y: number; w: number; h: number } {
  const base = { x: it.srcX, y: it.srcY, w: it.srcW, h: it.srcH };
  const rect = aWindowSrcRect(it, clock, base);
  return loopSrcRect(it, clock, rect);
}

/** A 层（bit1 / `0x239`）的 flipbook 结果（原 `itemSrcRect` 的体，逐字保留）。 */
function aWindowSrcRect(
  it: Item,
  clock: number,
  base: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (it.fbFrames <= 0 || it.fbCols <= 0) return base;
  const p = winPhase(it, W_FLIPBOOK, clock);
  // 窗未配置 / 延迟期：窗已结束过则继续用保持的末帧（`fbHold`），否则用原始矩形
  if (p.phase === 'none') return rectOfFrame(it, base, it.fbHold);
  if (p.phase === 'before') return base;
  const frame = p.phase === 'after' ? ((it.fbFlags & 1) !== 0 ? it.fbFrames - 1 : -1) : Math.floor(it.fbFrames * p.t);
  return rectOfFrame(it, base, frame); // frame < 0 ⇒ 复位
}

/**
 * B 层（bit2 / `0x231`）的贴图换格循环 —— 在 A 层结果**之上累加**偏移。
 *
 * 引擎 raw 118343-118361 逐字（`v6` = 源矩形指针，A 层刚改过同一份）：
 * ```
 * if (+560 > 0) {
 *   if (!(+540)) +540 = now;
 *   frame = ((now − +540) / +560) % +568;      // ★整数除法 + 取模 ⇒ 单调递增、循环（不是三角波）
 *   col = frame % +572;  row = frame / +572;
 *   *v6 += col·srcW; v6[2] += col·srcW;        // 左/右都加 ⇒ 平移矩形，不改尺寸
 *   v6[1] += row·srcH; v6[3] += row·srcH;
 * }
 * ```
 * ★`+568`（格数）与 `+572`（列数）和 A 层**共用**；模式靠 bit1/bit2 区分 ⇒ 两层各走各的分支。
 * ★若两层同时挂着，引擎就是**在 A 层的结果上再加一次偏移**（此处照做，不做"二选一"的猜测）。
 */
function loopSrcRect(
  it: Item,
  clock: number,
  rect: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const elapsed = loopElapsed(it, W_FLIPBOOK, clock);
  if (elapsed === null || it.fbFrames <= 0 || it.fbCols <= 0) return rect;
  const loops = Math.floor(elapsed / it.loops[W_FLIPBOOK]!.period); // raw 118348：(now−start)/period（★除法）
  const frame = loops % it.fbFrames; // raw 118350：% 格数
  const col = frame % it.fbCols; // raw 118352
  const row = Math.floor(frame / it.fbCols); // raw 118351
  return {
    x: rect.x + col * rect.w,
    y: rect.y + row * rect.h,
    w: rect.w,
    h: rect.h,
  };
}

/** 把帧序号换算成源矩形（`col = frame % cols`、`row = frame / cols`；`frame < 0` ⇒ 原始矩形）。 */
function rectOfFrame(
  it: Item,
  base: { x: number; y: number; w: number; h: number },
  frame: number,
): { x: number; y: number; w: number; h: number } {
  if (frame < 0) return base;
  return {
    x: base.x + (frame % it.fbCols) * base.w,
    y: base.y + Math.floor(frame / it.fbCols) * base.h,
    w: base.w,
    h: base.h,
  };
}

/** mesh 顶点色窗是否已结束（元素2 自己的起点，引擎 raw 133509-133517）。 */
export function meshWindowDone(m: MeshObj, clock: number): boolean {
  const w = m.anim;
  if (!w) return true;
  if (w.start === 0) w.start = clock;
  if (w.dur <= 0 && w.delay <= 0) return true;
  return clock >= w.start + w.delay + w.dur;
}

/**
 * `CalcDiffuse` 的**逐通道相乘**（引擎 raw 122317）：
 * `out.byte_i = trunc(blend.byte_i * base.byte_i / 0xFF)`。
 *
 * 引擎还有个等价快路径（raw 122294-122306）：`blend == 0xFFFFFFFF` 时**直接拷贝基础色**；
 * 本式在 blend=全 1 时逐字节等于 `base`（`x*255/255 = x`），两条路等价。
 */
export function mulArgb(base: number, blend: number): number {
  const ch = (s: number): number => {
    const b = ((base >>> s) & 0xff) * ((blend >>> s) & 0xff);
    return Math.trunc(b / 0xff) & 0xff;
  };
  return (((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0) >>> 0;
}

/**
 * **`0x321` 的逐顶点着色倍率**（引擎 `MeshEntry` 的 `[op2 + 7]` 槽；审计 §4.2 #8 的消费者）。
 *
 * 引擎里那个槽是顶点缓冲记录里的一个 dword（36 字节步长，`sub_4AF1C0` raw 133601 的 `v15 += 36`）
 * ⇒ 写它属于"网格条目的绘制参数"这一类。**下标语义的近似（披露）**：
 *  - `index 0/1` 在引擎里是内部记账（`SETPOLYGON.txt:53` 的 `i321 30d40 0 2a` 落在 index 0，
 *    而该 mesh 的 `create-mesh` 参数在 emulator 侧无从逐位对位），⇒ **不参与着色**（恒白）；
 *  - `index >= 2` = 逐顶点亮度倍率（低 8 位 ÷255）——这是 emulator 明确**消费**的语义。
 *
 * `null` = 没有可用的着色参数（不改变画面）。扩展点 = 逐位对齐顶点缓冲记录里那 4 个 dword
 * （需要真机 dump 或 `.lst` 逐指令跟 `sub_4A2280` 的填充）。
 */
export function meshAttrsTint(attrs: ReadonlyMap<number, number> | undefined): number | null {
  if (!attrs) return null;
  let tint: number | null = null;
  for (const [index, value] of attrs) {
    if (index < 2) continue;
    tint = (value & 0xff) / 255;
  }
  return tint;
}

/**
 * 单个顶点在这一帧的实际颜色 = 顶点基础色 × 插值态色。
 *
 * `attrs`/`color3D` 是本轮（审计 §4.2 #8）接上的两个额外倍率：
 *  - `attrs` = `0x321` 的 MeshEntry 属性（见 `meshAttrsTint`）；
 *  - `color3D` = `0x32D` 的 3D 颜色（`sub_499DF0` 的 `D3DRS_TEXTUREFACTOR`）。
 * 两者都缺省 ⇒ 与修前**逐字节相同**（不做任何乘法）。
 */
export function meshVertexColor(
  m: MeshObj,
  state: number,
  i: number,
  attrs?: ReadonlyMap<number, number>,
  color3D?: readonly number[],
): number {
  const base = m.baseColors[i] ?? 0xffffffff;
  let c = mulArgb(base, state);
  const tint = meshAttrsTint(attrs);
  if (tint !== null) c = scaleArgb(c, tint, tint, tint, tint);
  const c3 = color3DTint(color3D);
  if (c3) c = scaleArgb(c, c3[0] ?? 1, c3[1] ?? 1, c3[2] ?? 1, c3[3] ?? 1);
  return c;
}

/**
 * **逐通道浮点倍率**（每个分量 ∈ [0,1]，与引擎 `sub_499DF0` 把 0..1 折成 0..255 同一口径）。
 * 只用于 `meshVertexColor` 的两个附加倍率；缺省参数不参与 ⇒ 不改变既有结果。
 */
export function scaleArgb(c: number, kr: number, kg: number, kb: number, ka: number): number {
  const ch = (v: number): number => {
    const x = Math.round(v);
    return x < 0 ? 0 : x > 255 ? 255 : x;
  };
  // ★通道次序与 `mulArgb` 一致：ARGB（`>>>24` = α、`>>>16` = R、`>>>8` = G、`&0xff` = B）。
  //   ★每个分量显式 `& 0xff` 再位移：`ch()` 已夹到 0..255，但 `<< 24` 会把结果推成负数
  //   （JS 位运算是 **int32**）—— 多一道掩码让"写侧不越位"不依赖调用点的假设
  //   （实测过：漏了 `& 0xff` 时 `0xff | (0xff << 8)` 之类会叠出 `0xff00`，把绿色叠进红色）。
  return (
    ((ch(((c >>> 24) & 0xff) * ka) & 0xff) << 24) |
    (((ch(((c >>> 16) & 0xff) * kr) & 0xff) << 16) |
      (((ch(((c >>> 8) & 0xff) * kg) & 0xff) << 8) | (ch((c & 0xff) * kb) & 0xff))) >>>
    0
  );
}

/**
 * `0x32D` 的 3D 颜色倍率；`null` = **与未下发等价**（四个分量都是 1 = 恒等）。
 *
 * 为什么要有这一层判断：`render4.color3D` 的初值就是 `[1,1,1,1]`（= 引擎顶点缓冲里的
 * `0xFFFFFFFF`），恒等乘法不该改变任何像素 ⇒ 这里显式判掉，既保住"逐字节相同"的既有行为，
 * 又让"真的下发过 `0x32D`"这件事成为可断言的消费者（守卫：`test/gfx-prim-mesh-consumers.test.ts`）。
 */
export function color3DTint(color3D: readonly number[] | undefined): readonly number[] | null {
  if (!color3D) return null;
  const [r = 1, g = 1, b = 1, a = 1] = color3D;
  if (r === 1 && g === 1 && b === 1 && a === 1) return null;
  return color3D;
}

/**
 * 一个 mesh 在这一帧的**代表色**（渲染用）。
 *
 * 引擎的 mesh 是"逐顶点 diffuse"，各顶点可以不同（渐变幕布）；emulator 用一个颜色近似，
 * 取各顶点实际颜色的均值 —— 语料里所有 `0x320` 站点的基础色都是 `0xFFFFFFFF`（INIT2 的
 * `copy-local-array (global-int f8c48/f8c4c)` 全白），顶点间无差异 ⇒ 本例无损。
 * 逐顶点渐变的幕布会退化成均值色（已在第二层台账登记为残余近似）。
 *
 * ★`attrs`/`color3D` 透给 `meshVertexColor`（审计 §4.2 #8 的两个消费者接线）。
 */
export function meshColor(
  m: MeshObj,
  state: number,
  attrs?: ReadonlyMap<number, number>,
  color3D?: readonly number[],
): number {
  const n = Math.max(1, m.verts.length);
  if (m.baseColors.length === 0) {
    let c = mulArgb(0xffffffff, state);
    const tint = meshAttrsTint(attrs);
    if (tint !== null) c = scaleArgb(c, tint, tint, tint, tint);
    const c3 = color3DTint(color3D);
    if (c3) c = scaleArgb(c, c3[0] ?? 1, c3[1] ?? 1, c3[2] ?? 1, c3[3] ?? 1);
    return c;
  }
  let a = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const c = meshVertexColor(m, state, i, attrs, color3D);
    a += (c >>> 24) & 0xff;
    r += (c >>> 16) & 0xff;
    g += (c >>> 8) & 0xff;
    b += c & 0xff;
  }
  return (
    (((Math.round(a / n) & 0xff) << 24) |
      ((Math.round(r / n) & 0xff) << 16) |
      ((Math.round(g / n) & 0xff) << 8) |
      (Math.round(b / n) & 0xff)) >>>
    0
  );
}

/**
 * mesh 顶点色 CalcDiffuse：state0→state1 逐通道插值（黑覆盖层的 alpha 淡入淡出）。
 * 用**元素2 自己的浮点公式**（`sub_4A2050`，raw 122287-122294），与 DrawItem 的整数式不同。
 * 窗末一次性收尾（引擎 raw 133531-133538）：`delay/dur/start` 清 0、`state0 ← state1`、清 bit1。
 *
 * ★**没有动画窗时返回 `state0`，不是 `state1`** —— 引擎的可见色是**顶点缓冲里那份**：
 *  - `0x322`（`sub_426C20` → `sub_4AE2C0` raw 132816-132823）写 `entry[13] = state0` 后
 *    **立刻** `sub_4A2050(entry, 0.0)`（比例 0 = 纯 state0）刷进 VB ⇒ 设色当帧就可见；
 *  - `0x323`（sub_426CF0 → `sub_4AE330` raw 132834-132843）只置 bit1 / delay / dur / `entry[14]=state1`，
 *    **不碰 VB** ⇒ 延迟期看到的仍是 state0（本函数的 `clock <= start+delay` 分支）；
 *  - 窗末（raw 133531-133538）`state0 ← state1` 后再以比例 0 刷 VB ⇒ 之后看到的还是 state0。
 *  所以 state1 在任何时刻都只是"目标"，只有插值过程中才参与。
 *  此前这里返回 `state1`（初始 0 = 全透明）⇒ 新建幕在 `0x322` 与 `0x323` 之间渲染成**透明**，
 *  SN0000 进场的黑幕（state0=0xFF000000 全黑、state1=0 透明）就在那一帧闪出背景 ——
 *  用户实测"进 SN0000 时背景闪一下"。
 */
export function calcDiffuse(m: MeshObj, clock: number): number {
  if (!(m.flags & 2) || !m.anim) return m.state0;
  const w = m.anim;
  if (w.start === 0) w.start = clock; // raw 133511
  if (w.dur > 0 && clock < w.start + w.delay + w.dur) {
    if (clock <= w.start + w.delay) return m.state0; // 延迟期保持 state0
    return lerpArgbFloat(m.state0, m.state1, (clock - w.start - w.delay) / w.dur);
  }
  w.delay = 0;
  w.dur = 0;
  w.start = 0;
  m.state0 = m.state1;
  m.flags &= ~2;
  return m.state0;
}

