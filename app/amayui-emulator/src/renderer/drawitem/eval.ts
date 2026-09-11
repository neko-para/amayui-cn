/**
 * 求值：把 DrawItem/Mesh 的窗状态 + 时钟换算成"这一帧画成什么样"
 * （颜色 / 缩放 / 旋转角 / 平移 / 源矩形 / mesh 顶点色）。
 *
 * ★这些函数会**先锁存窗起点**（经 `winPhase`）再插值，因此不是纯函数：
 * 调用顺序必须是 `advanceWindows(it, clock)` → `itemColor/itemScale/...`，见 pixiBackend.present。
 */
import type { Item, MeshObj, Vec3 } from './model.js';
import { W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from './model.js';
import { freezeWindow, winPhase, windowDone } from './animWindow.js';
import { lerpArgbWindow, lerpArgbFloat, lerpVec3 } from './colorMath.js';

/**
 * draw-item 的 diffuse 色（full ARGB）。
 *
 * **求值器位置（实证，见文件头"逐帧求值器"一节）**：`sub_49AA30` 内 raw 117434-117483；
 * 由 DrawItem 渲染器 `sub_4AEEA0` 在 raw 133389 以 `a2 = 该 DrawItem` 调用，结果经
 * `a4`（= 调用方 `&v25` 的指针）写回，再于 raw 133443 作为 diffuse 交给纹理绘制。
 */
export function itemColor(it: Item, clock: number): number {
  if (it.flags & 2) {
    const p = winPhase(it, W_COLOR, clock);
    if (p.phase === 'active') {
      // we = clock − start − delay（winPhase 已保证 > 0）；dur > 0 由 winPhase 保证
      const w = it.wins[W_COLOR]!;
      return lerpArgbWindow(it.from, it.to, clock - it.animStart - w.delay, w.dur);
    }
  }
  return it.from >>> 0;
}

/** 缩放（窗1 / `0x21E`）：延迟期保持 `scaleWork`，窗内 `scaleWork → scaleTarget` 逐分量插值。 */
export function itemScale(it: Item, clock: number): Vec3 {
  if (it.flags & 2) {
    const p = winPhase(it, W_SCALE, clock);
    if (p.phase === 'active') return lerpVec3(it.scaleWork, it.scaleTarget, p.t);
    if (p.phase === 'before') return { ...it.scaleWork };
  }
  return it.scaleTarget;
}

/** 旋转（窗2 / `0x21F`）：延迟期保持 `rotWork`，窗内轴与角分别插值（引擎 raw 117587-117620 插值后 `D3DXMatrixRotationAxis`）。 */
export function itemRotationRad(it: Item, clock: number): number {
  let deg = it.rotTarget.deg;
  if (it.flags & 2) {
    const p = winPhase(it, W_ROT, clock);
    if (p.phase === 'before') deg = it.rotWork.deg;
    else if (p.phase === 'active') deg = it.rotWork.deg + (it.rotTarget.deg - it.rotWork.deg) * p.t;
  }
  return (deg * Math.PI) / 180;
}

/** 平移（窗3 / `0x220`）：延迟期保持 `transWork`，窗内 `transWork → transTarget` 逐分量插值。 */
export function itemTranslation(it: Item, clock: number): Vec3 {
  if (it.flags & 2) {
    const p = winPhase(it, W_TRANS, clock);
    if (p.phase === 'active') return lerpVec3(it.transWork, it.transTarget, p.t);
    if (p.phase === 'before') return { ...it.transWork };
  }
  return it.transTarget;
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
  if (it.fbFrames <= 0 || it.fbCols <= 0) return base;
  const p = winPhase(it, W_FLIPBOOK, clock);
  // 窗未配置 / 延迟期：窗已结束过则继续用保持的末帧（`fbHold`），否则用原始矩形
  if (p.phase === 'none') return rectOfFrame(it, base, it.fbHold);
  if (p.phase === 'before') return base;
  const frame = p.phase === 'after' ? ((it.fbFlags & 1) !== 0 ? it.fbFrames - 1 : -1) : Math.floor(it.fbFrames * p.t);
  return rectOfFrame(it, base, frame); // frame < 0 ⇒ 复位
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
 * mesh 顶点色 CalcDiffuse：state0→state1 逐通道插值（黑覆盖层的 alpha 淡入淡出）。
 * 用**元素2 自己的浮点公式**（`sub_4A2050`，raw 122287-122294），与 DrawItem 的整数式不同。
 * 窗末一次性收尾（引擎 raw 133531-133538）：`delay/dur/start` 清 0、`state0 ← state1`、清 bit1。
 */
export function calcDiffuse(m: MeshObj, clock: number): number {
  if (!(m.flags & 2) || !m.anim) return m.state1;
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
  return m.state1;
}