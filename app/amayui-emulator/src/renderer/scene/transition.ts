/**
 * **转场（wipe / 淡入淡出 / 模糊）的窗口模型与条带几何** —— `tickets/T-0084`。
 *
 * 真源：`engine/天结_unpacked.exe_utf8.c`，**消费端 = `sub_4B06D0`（raw 134417-136734）**，
 * 写入端 = `0x223`/`0x24D`/`0x24F`/`0x250`/`0x251` 各自的 `sub_4ADDB0`/`sub_4ADEE0`/
 * `sub_4AF6A0`/`sub_4AF880`/`sub_4AFA30`（记录格式全表见
 * `docs-new/03-engine/transition-render-spec-2026-09.md` §2.3，本轮逐条与体复核过）。
 *
 * 为什么单独成文件（而不是塞进 `ops.ts`）：这里的东西**全是纯函数 + 一个逐帧推进器**，
 * 与 `SceneState` 的其它 setter 不同 —— 它有两套消费者（两个宿主的逐帧推进、presenter 的合成），
 * 且几何部分可以脱离渲染直接单测（12 个 case 表驱动）。
 *
 * ## 三条纪律（都是本层踩过/差点踩的坑）
 *
 * 1. **不许回写 `SceneState.render4.transitions`**。那张表是**脚本语义的真源**
 *    （写入端逐格照抄引擎的 `sub_4AAE10(Scene+1048, &id)[i] = v`），而引擎在消费时会**就地改**
 *    `[1]`（窗口起点锁存，raw 134867-134871）与 `[3]`（到点清 0 = 死记录）。
 *    `test/op-24f-250-251-transitions.test.ts` 对这张表做**整条 `deepEqual`**，并显式断言 `[1]` 仍为默认
 *    ⇒ 运行期的 `[1]`/`[3]` 一律存在 `render4.transitionRuntime` 里，绘制期从那里取。
 * 2. **记录表是"帧内瞬态"**（引擎 raw 136840-136841：一遍绘完若 `Scene+46516 == 0` 就
 *    `sub_4A9BE0(Scene+1048)` **清空整张表**）。所以 `scTransitionTick` 在"一条都不活动"时把
 *    `transitions` + `transitionRuntime` 一起清掉 —— 不清的话，下一次同 id 的写入会撞上上一轮的
 *    锁存起点（语料的 `op1` 恒为 `local-int 0`，必然撞）。
 *    ★**门不是"没有在途转场"**（`T-0091` G2 订正）：`Scene+46516` 是**全场景池挂起位**
 *    （转场 raw 134944/135822/136197、绘制项 raw 117844、mesh raw 133528 都置它）
 *    ⇒ 转场到期那一帧若**别的**窗还在跑，引擎**不清表**。判据由宿主**注入**（`poolPending`
 *    形参，见 `scTransitionTick` 的说明：本模块不能 import `ops.ts`，会成模块环）。
 * 3. **`[4]` 是渲染目标层，不是"屏幕"**。引擎 `sub_4A50C0(_this, v384[4])` 把渲染目标切到那一层
 *    （raw 136174 / 134937 / 135824），淡入淡出/条带都画进**那一层**，画完由脚本自己 `draw-texture`
 *    呈现（语料里紧随其后就是 `draw-texture … (local-ptr 2) …`）。所以本模块只产出**几何/参数**，
 *    "画到哪一层"由宿主决定（`tickets/T-0084` 的缺口：emulator 的离屏层合成尚未建模）。
 */
import type { SceneState } from './state.js';

/** `Scene+1048` 的一条记录 = 96 字节 = **24 个 dword**（写入端逐格写；顺序即 `[i]`）。 */
export type TransitionRecord = number[];

/** 屏幕坐标矩形（`[15]` 那张绘制项的描画矩形）。 */
export interface TransitionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 一条记录的**运行时**窗状态（引擎把它写在记录的 `[1]`/`[3]` 上；见文件头纪律 1）。
 */
export interface TransitionRuntime {
  /** 引擎 `[1]`：窗口起点（帧时钟 ms）。首帧锁存（raw 134867-134871）。 */
  start: number;
  /** 本帧窗口是否活动（引擎判据：`clock < [1]+[2]+[3]` 且 `Scene+46512 == 0`）。 */
  active: boolean;
  /** 本帧是否收尾（到期 / `[13] < 0` 的立即收尾；引擎把 `[3]` 清 0）。 */
  finished: boolean;
  /**
   * 类别 0/3 的进度 `t`（引擎 raw 136195 / 135815-135821）：
   * `clock <= [1]+[2]` ⇒ 0；否则 `(clock - [1] - [2]) / [3]`；到期 ⇒ 1。
   */
  t: number;
  /**
   * 类别 3 的四通道当前值 `c0..c3`（raw 135815-135821 的四个 `(int)((终-起)*t + 起)`）；
   * 语义随 `[13]` 互换：`c0`=Length、`c1`=CenterU(px)、`c2`=CenterV(px)、`c3`=Angle。
   */
  channels: [number, number, number, number];
}

/** 一条条带的画法来源：`old` = 引擎 scratch 层 36（旧帧）/ `new` = 37（新帧）。 */
export type TransitionBandSrc = 'old' | 'new';

/**
 * 一条条带。**矩形既是"从该层取的源区"也是"画回的目标区"**（同坐标 1:1）——
 * 依据：`sub_4A2D50(_this, 36, &rc, &pos, &uv, 2, -1)` 里 `pos`/`uv` 是**显示原点修正**
 * （raw 134903-134920 只在 `Scene+46676 == 0` 时算出非 0 的 `v379/v370`），
 * 正常路径下条带就是"把 36/37 的这块互补矩形搬到屏幕同一位置"（= 静态盲帘）。
 */
export interface TransitionBand {
  src: TransitionBandSrc;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `scTransitionTick` 的结果（宿主据此决定"要不要继续合成"）。 */
/** 一帧要合成进记录 `[4]` 的一条（`rec`/`rt` 是**引用**：表清了它们也还在，宿主可以照它合成）。 */
export interface TransitionRenderItem {
  id: number;
  rec: TransitionRecord;
  rt: TransitionRuntime;
}

export interface TransitionTickResult {
  /** 本帧**在窗内**的记录 id（升序）—— 就是"在途"的口径（gate / `needsRender` 用这一份）。 */
  active: number[];
  /** 本帧是否**有记录收尾**（引擎把它的 `[3]` 清 0）。 */
  finishedAny: boolean;
  /** 是否因为"一条都不活动"而清空了整张记录表（引擎 raw 136840-136841）。 */
  cleared: boolean;
  /**
   * ★本帧要合成的那一批（含**到期帧的终值交付**；`tickets/T-0091` 的 D2）。
   * 宿主 `present()` 必须用**这一份**（而不是重查表）：到期帧按引擎会**同帧清表**，
   * 重查就再也拿不到 `t=1` 的那一帧。
   */
  render: TransitionRenderItem[];
}

const CAT_FADE = 0;
/** 类别 1（分块淡入淡出，`0x24D`）：**本模块不画** —— 它在 `sub_4B06D0` 里的可见效果未确证（规格 §3.5 U2）。 */
export const CAT_BLOCK_FADE = 1;
const CAT_BLIND = 2;
const CAT_BLUR = 3;

/** 记录里那一格的取法（越界/缺字段一律按 0；记录一定是 24 格，这里只是防御）。 */
function at(rec: TransitionRecord, i: number): number {
  const v = rec[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * **单条记录的窗口判定**（不推进状态，纯函数）—— 引擎三类共用的那一段：
 * `clock >= [1]+[2]+[3] || Scene+46512` ⇒ 到期（`[3] = 0`），否则 `Scene+46516 = 1`（在途）。
 *
 * @param start 运行时锁存的窗口起点（引擎写在记录 `[1]` 上）
 * @param immediateFinish 引擎的 `Scene+46512`（`sub_407EA0` raw 12796 的强制冻结；本模块用不到，
 *   但 `[13] < 0` 的"立即收尾"走的就是它 —— raw 134934-134936）
 */
export function scTransitionWindow(
  rec: TransitionRecord,
  clock: number,
  start: number,
  immediateFinish: boolean,
): { active: boolean; finished: boolean; t: number } {
  const delay = at(rec, 2);
  const dur = at(rec, 3);
  const cat = at(rec, 0);
  const sub = at(rec, 13);
  // `[13] < 0` = 立即收尾（写入端在"非法条宽"的退化路径上写 -1：raw 133730-133735）
  if (immediateFinish || sub < 0 || dur <= 0 || clock >= start + delay + dur) {
    // 到期那一帧引擎仍然算 t：类别 0/3 用 t = 1（raw 136184 / 135806-135812），类别 2 不画
    return { active: false, finished: true, t: cat === CAT_BLIND ? 0 : 1 };
  }
  // ★只有类别 0/3 在**这一段**里算 `t`：类别 1 的淡入淡出不在这里（`if (!v384[0])` 把它排除在外，
  //   raw 136178；它的可见效果见规格 §3.5 的 U2，尚未确证 ⇒ emulator 不画），类别 2 用的是 `off`。
  const t =
    cat === CAT_BLUR || cat === CAT_FADE
      ? clock > start + delay
        ? (clock - start - delay) / dur
        : 0
      : 0;
  return { active: true, finished: false, t };
}

/**
 * 类别 2 的**单边界位移**（raw 134953 那一家族）：`off = trunc(elapsed / (dur/n)) * b`。
 * ★`trunc` 是刻意的（引擎 `__ftol2_sse` 向零取整）；`elapsed < 0`（延迟还没到）时也照 engine 走。
 */
function blindOffset(elapsed: number, dur: number, n: number, b: number): number {
  const msPerBand = dur / n;
  if (!(msPerBand > 0)) return 0;
  return Math.trunc(elapsed / msPerBand) * b;
}

/** 同上但**先 +1.0 再取整**（case 1/3 的 `fadd dbl_51D860`；`dbl_51D860 = 1.0`）。 */
function blindOffsetPlusOne(elapsed: number, dur: number, n: number, b: number): number {
  const msPerBand = dur / n;
  if (!(msPerBand > 0)) return 0;
  return Math.trunc(elapsed / msPerBand + 1.0) * b;
}

/** 多带族（case 4-7/8-11）的**相位**：`trunc(elapsed / (dur/nTotal))`（`+1.0` 那两处除外）。 */
function bandPhase(elapsed: number, dur: number, nTotal: number): number {
  const ms = dur / nTotal;
  if (!(ms > 0)) return 0;
  return Math.trunc(elapsed / ms);
}

/**
 * 一条边界的 `[a,b]` → "起点 + 长度"。★**不做归一化**：引擎 `SetRect` 允许 `left > right`，
 * 那种矩形在 `sub_4A2D50` 里被 `if (v10 >= v11 || v17 >= v18) return 1;`（raw 123028-123029）
 * **直接丢弃** ⇒ 这里返回负长度，由调用方的 `n > 0` 过滤（归一化会凭空造出 1px 的条带）。
 */
function span(a: number, b: number): { p: number; n: number } {
  return { p: a, n: b - a };
}

/**
 * **类别 2（盲帘擦除）的条带几何** —— 12 个 case 逐个照抄 raw 134947-135510。
 *
 * 记 `b = [14]`（条宽）、`dur = [3]`、`delay = [2]`、`t0 = [1]+[2]`、`elapsed = clock - t0`。
 * 每个 case 的画法在源码里都是两条互补的 `sub_4A2D50`（36 与 37），**先 36 后 37**；
 * 本函数按同一顺序产出（`old` 对应 36、`new` 对应 37）。
 *
 * @param rect `[15]` 那张绘制项的屏幕矩形：`x = (int)DrawItem+36`、`y = DrawItem+40`、
 *   `w = +0x10 - +8`、`h = +0x14 - +0xC`（raw 134895-134902）
 */
export function scTransitionBands(
  rec: TransitionRecord,
  rt: TransitionRuntime,
  clock: number,
  rect: TransitionRect,
): TransitionBand[] {
  if (at(rec, 0) !== CAT_BLIND) return [];
  const b = at(rec, 14);
  const dur = at(rec, 3);
  const sub = at(rec, 13);
  if (b < 1 || dur <= 0 || sub < 0 || sub > 11) return []; // 写入端已夹过；防御 + `[13] < 0` 直通 default
  const elapsed = clock - (rt.start + at(rec, 2));
  const xL = rect.x;
  const yT = rect.y;
  const xR = rect.x + rect.w;
  const yB = rect.y + rect.h;
  const W = rect.w;
  const H = rect.h;
  const out: TransitionBand[] = [];
  const oldBand = (x: number, y: number, w: number, h: number): void => {
    if (w > 0 && h > 0) out.push({ src: 'old', x, y, w, h });
  };
  const newBand = (x: number, y: number, w: number, h: number): void => {
    if (w > 0 && h > 0) out.push({ src: 'new', x, y, w, h });
  };

  switch (sub) {
    // 0：横向左→右（36 在右、37 在左；n = W/b + 2）
    case 0: {
      const n = Math.floor(W / b) + 2;
      const off = blindOffset(elapsed, dur, n, b);
      const sOld = span(xL + off, xR);
      const sNew = span(xL, xL + off);
      oldBand(sOld.p, yT, sOld.n, H);
      newBand(sNew.p, yT, sNew.n, H);
      break;
    }
    // 1：横向右→左（与 case 0 镜像；`fadd 1.0` ⇒ off = (P+1)*b）
    case 1: {
      const n = Math.floor(W / b) + 2;
      const off = blindOffsetPlusOne(elapsed, dur, n, b);
      const sOld = span(xL, xR - off);
      const sNew = span(xR - off, xR);
      oldBand(sOld.p, yT, sOld.n, H);
      newBand(sNew.p, yT, sNew.n, H);
      break;
    }
    // 2：纵向上→下
    case 2: {
      const n = Math.floor(H / b) + 2;
      const off = blindOffset(elapsed, dur, n, b);
      const sOld = span(yT + off, yB);
      const sNew = span(yT, yT + off);
      oldBand(xL, sOld.p, W, sOld.n);
      newBand(xL, sNew.p, W, sNew.n);
      break;
    }
    // 3：纵向下→上（`fadd 1.0`）
    case 3: {
      const n = Math.floor(H / b) + 2;
      const off = blindOffsetPlusOne(elapsed, dur, n, b);
      const sOld = span(yT, yB - off);
      const sNew = span(yB - off, yB);
      oldBand(xL, sOld.p, W, sOld.n);
      newBand(xL, sNew.p, W, sNew.n);
      break;
    }
    // 4：多条横带，每带内部左→右（nTotal = b+1 ⇒ 每条带正好走完自己那一格宽）
    case 4: {
      const count = Math.floor(W / b) + 1;
      const r = b - (W % b);
      const P = bandPhase(elapsed, dur, b + 1);
      const shift = P - b;
      for (let i = 0; i < count; i++) {
        const xEnd = xL + (b - r) + i * b;
        const sOld = span(xEnd + shift, xEnd);
        const sNew = span(xEnd - b, Math.min(xEnd + shift, xEnd));
        oldBand(sOld.p, yT, sOld.n, H);
        newBand(sNew.p, yT, sNew.n, H);
      }
      break;
    }
    // 5：多条横带，每带内部右→左
    case 5: {
      const count = Math.floor(W / b) + 1;
      const r = b - (W % b);
      const P = bandPhase(elapsed, dur, b + 1);
      const shift = b - P;
      let x = xR - (b - r);
      for (let i = 0; i < count; i++) {
        const sOld = span(x, x + shift);
        const sNew = span(Math.max(x, x + shift), x + b);
        oldBand(sOld.p, yT, sOld.n, H);
        newBand(sNew.p, yT, sNew.n, H);
        x -= b;
      }
      break;
    }
    // 6：多条纵带，每带内部上→下
    case 6: {
      const count = Math.floor(H / b) + 1;
      const r = b - (H % b);
      const P = bandPhase(elapsed, dur, b + 1);
      const shift = P - b;
      let y = yT + (b - r);
      for (let i = 0; i < count; i++) {
        const sOld = span(y + shift, y);
        const sNew = span(y - b, Math.min(y + shift, y));
        oldBand(xL, sOld.p, W, sOld.n);
        newBand(xL, sNew.p, W, sNew.n);
        y += b;
      }
      break;
    }
    // 7：多条纵带，每带内部下→上
    case 7: {
      const count = Math.floor(H / b) + 1;
      const r = b - (H % b);
      const P = bandPhase(elapsed, dur, b + 1);
      let y = yB - (b - r);
      for (let i = 0; i < count; i++) {
        const sOld = span(y, y + (b - P));
        const sNew = span(Math.max(y, y + (b - P)), y + b);
        oldBand(xL, sOld.p, W, sOld.n);
        newBand(xL, sNew.p, W, sNew.n);
        y -= b;
      }
      break;
    }
    // 8：多横带 + **每带相位递增**（nTotal = W/b + 1 + b；第 i 带的分界再减 i）
    case 8: {
      const count = Math.floor(W / b) + 1;
      const r = b - (W % b);
      const P = bandPhase(elapsed, dur, count + b);
      let xStart = xL - r;
      for (let i = 0; i < count; i++) {
        const cut = xStart + P - i;
        const sOld = span(cut, xStart + b);
        const sNew = span(xStart, Math.min(cut, xStart + b));
        oldBand(sOld.p, yT, sOld.n, H);
        newBand(sNew.p, yT, sNew.n, H);
        xStart += b;
      }
      break;
    }
    // 9：case 8 的镜像（从右往左）
    case 9: {
      const count = Math.floor(W / b) + 1;
      const r = b - (W % b);
      const P = bandPhase(elapsed, dur, count + b);
      let x = xR - r;
      for (let i = 0; i < count; i++) {
        const cut = x + b - (P - i);
        const sOld = span(x, cut);
        const sNew = span(Math.max(x, cut), x + b);
        oldBand(sOld.p, yT, sOld.n, H);
        newBand(sNew.p, yT, sNew.n, H);
        x -= b;
      }
      break;
    }
    // 10：case 8 的纵向版
    case 10: {
      const count = Math.floor(H / b) + 1;
      const r = b - (H % b);
      const P = bandPhase(elapsed, dur, count + b);
      let y = yT - r;
      for (let i = 0; i < count; i++) {
        const cut = y + P - i;
        const sOld = span(cut, y + b);
        const sNew = span(y, Math.min(cut, y + b));
        oldBand(xL, sOld.p, W, sOld.n);
        newBand(xL, sNew.p, W, sNew.n);
        y += b;
      }
      break;
    }
    // 11：case 9 的纵向版
    case 11: {
      const count = Math.floor(H / b) + 1;
      const r = b - (H % b);
      const P = bandPhase(elapsed, dur, count + b);
      let y = yB - r;
      for (let i = 0; i < count; i++) {
        const cut = y + b - (P - i);
        const sOld = span(y, cut);
        const sNew = span(Math.max(y, cut), y + b);
        oldBand(xL, sOld.p, W, sOld.n);
        newBand(xL, sNew.p, W, sNew.n);
        y -= b;
      }
      break;
    }
    default:
      // `[13] > 11` 直通 `default:`（raw 135511-135512：什么都不画）
      break;
  }
  return out;
}

/** 类别 3 的四通道插值（raw 135815-135821；到期时直接用终值，raw 135806-135812）。 */
function blurChannels(rec: TransitionRecord, t: number, finished: boolean): [number, number, number, number] {
  const from = [at(rec, 16), at(rec, 17), at(rec, 18), at(rec, 19)];
  const to = [at(rec, 20), at(rec, 21), at(rec, 22), at(rec, 23)];
  const tt = finished ? 1 : t;
  return [0, 1, 2, 3].map((i) => Math.trunc((to[i]! - from[i]!) * tt + from[i]!)) as [number, number, number, number];
}

/**
 * **类别 3（插值模糊）的画法参数** —— 引擎 raw 135837-135881 的 `SetTechnique` + 四个 `SetFloat`
 * 逐条对应；`ZoomBlur` 的 `CenterU/CenterV` 是**像素 / 目标层尺寸**的归一化值（raw 135846 / 135850）。
 *
 * ★**偏差披露（2026-09-24 按 `tickets/T-0091` 的 D4 收口成一份口径，不再"两种说法并存"）**：
 *
 * **① 核的偏差（已知、有据、不打算在本轮复刻）**：emulator 没有 D3DX effect；引擎另外还有一条
 * **CPU 回退**卷积，本轮的体读（`sub_4A0120` raw 120773 起）把它钉成：
 * ```
 * 采样格 = a2×a2 的**旋转方格**（a2 = 33 ⇒ 中心 ±16 px；旋转角由 `a3 * dbl_526C98 / dbl_5263F0` 定，
 *          即"度 → 弧度"），每个采样点带**亚像素权重**（体里用 `v20 - (int)v20` / `v21 - (int)v21` 做双线性）
 * 权重   = 两档：`a1 == 0` ⇒ 全 1，**只有中心那一格是 3**（`if (!a1) v53[v8*(a2+1)] = 3;`）
 *                   `a1 != 0` ⇒ 沿一行的**三角斜坡**（`v13 = v11`，`v11 > v8+1` 之后取 0）
 * ```
 * ⇒ emulator 的模型是「33 个采样沿一条轴（slide 的 Angle / zoom 的径）累积 + 中心权重 3」，
 * **把 2D 旋转方格降成了 1D 采样、且只实现了 `a1 == 0` 那一档权重**。★**不复刻的理由**：这条 CPU 回退
 * 要 33×33 = **1089** 次全屏采样/帧（现实现 33 次）；而在**有 effect 的机器上**引擎走的是 D3DX 的
 * `ZoomBlur`/`SlideBlur` 着色器（raw 135837-135860），其 shader 内容不在二进制里可读 ⇒ 即使把 CPU
 * 回退逐点复刻，也**仍不是**真机（有 effect 时）的像素。⇒ 决策：保持参数语义 1:1、核按 1D 降级，
 * 并把它作为**已披露偏差**（`approximate: true` + 本段文字 + 台账 `clock-read-transition-window`）。
 *
 * **② 源的决策（不再是"未确证"）**：引擎把 `Tex0` 设成**层 36 的纹理**（raw 135883-135884，
 * `Scene+42600` = 层表 42456 + 4×36），而类别 3 的体**明确跳过**那两趟 item 重绘
 * （asm `0x4B3187: cmp eax,3 / jnz loc_4B379C`，即 `[13] == 3` 时不走 `for v60<2` 的填充），
 * 且它在本帧**刚把层 36 清过**（raw 135824-135825 的 `SetTarget(36)` + `Clear`）⇒ 逐字读体得到的
 * 结论是"模糊一张空/陈旧的 scratch"，这与真机可观测量（用户口径：真机能看见云柱背景被横向模糊）
 * **矛盾**。⇒ 决策：**保留"取本帧屏幕合成当源"**（`pixiBackend.ts` 的 `#compositeTransitions`），
 * 并在台账里登记为**有意的改正 + 待真机像素对照**（`tickets/T-0091` 的 U3；`T-0103` 轮 15 的 D4）。
 */
export interface TransitionBlurPlan {
  /** `[13]`：`1` = ZoomBlur（径向）/ 其余（含 0）= SlideBlur（角度）。 */
  zoom: boolean;
  /** `c0`（`[16]→[20]` 插值）= `Length`（px）。 */
  length: number;
  /** `c3`（`[19]→[23]`）= SlideBlur 的 `Angle`（度）。 */
  angle: number;
  /** `c1`（`[17]→[21]`）= ZoomBlur 中心 U（**像素**）。 */
  centerUPx: number;
  /** `c2`（`[18]→[22]`）= ZoomBlur 中心 V（**像素**）。 */
  centerVPx: number;
  /** 目标层 `[4]` 的尺寸（SlideBlur 把它当 `Width`/`Height` 喂给 effect，raw 135866-135874）。 */
  width: number;
  height: number;
  /** `CenterU`（归一化；raw 135846 `c1 / layer[[4]].width`）。 */
  centerU: number;
  /** `CenterV`（归一化；raw 135850）。 */
  centerV: number;
  /** 采样数（= 引擎 CPU 回退的 33；见上）。 */
  samples: number;
  /** ★恒 `true`：**核**是降级近似（引擎 CPU 回退的 33×33 旋转方格 + 双线性未复刻，
   * 见 `TransitionBlurPlan` 的偏差披露 ①）；**源**不是近似（是有意改正，见披露 ②）。 */
  approximate: true;
}

/**
 * 引擎 CPU 回退的模糊核事实（`sub_4A0120` raw 120773 起）—— 只作为**披露与判据**存在，
 * 不复刻（理由见 `TransitionBlurPlan` 的披露 ①：1089 采样/帧不可行，且真机有 effect 时走的是 shader）。
 * 常量口径：`a2 = 33`（= `(int)(16+16+1)`，raw 126180-126183 的 `dbl_51D7E8 = 16.0`）；
 * `a1 == 0` 时中心权重 3、其余 1；`a1 != 0` 时沿一行为三角斜坡。
 */
export const TRANSITION_BLUR_KERNEL = {
  /** 方格边长（33 ⇒ 中心 ±16 px）。 */
  grid: 33,
  /** `a1 == 0` 档：平坦权重的值。 */
  flatWeight: 1,
  /** `a1 == 0` 档：中心那一格的权重（`if (!a1) v53[v8*(a2+1)] = 3;`）。 */
  centerWeight: 3,
  /** 旋转角的单位换算（`dbl_526C98 / dbl_5263F0` = 弧度/度）。 */
  radiansPerDegree: Math.PI / 180,
} as const;

/** 模糊采样数：引擎 CPU 回退 `HIDWORD(v68) = (int)(dbl_51D7E8 + dbl_51D7E8 + 1.0)` = 33（`16+16+1`）。 */
export const TRANSITION_BLUR_SAMPLES = 33;

/** 采样权重：中心样本权重 3、其余 1（raw 126180-126183 的 `v34 = v65 == v33 ? 3 : 1`）。 */
export const TRANSITION_BLUR_CENTER_WEIGHT = 3;

/**
 * 类别 3 的画法参数（纯函数）。`size` = 目标层 `[4]` 的尺寸（引擎 `layer[[4]]+1040/+1044`）。
 * 非类别 3 ⇒ `null`。
 */
export function scTransitionBlurPlan(
  rec: TransitionRecord,
  rt: TransitionRuntime,
  size: { w: number; h: number },
): TransitionBlurPlan | null {
  if (at(rec, 0) !== CAT_BLUR) return null;
  const [length, c1, c2, c3] = rt.channels;
  const w = size.w;
  const h = size.h;
  return {
    zoom: at(rec, 13) === 1,
    length,
    angle: c3,
    centerUPx: c1,
    centerVPx: c2,
    width: w,
    height: h,
    centerU: w > 0 ? c1 / w : 0,
    centerV: h > 0 ? c2 / h : 0,
    samples: TRANSITION_BLUR_SAMPLES,
    approximate: true,
  };
}

/**
 * 类别 3 的**采样几何**（纯函数；宿主据此累积画 `plan.samples` 次）。
 *
 * - `zoom`（`[13] == 1`）：绕 `(centerUPx, centerVPx)` 的**均匀缩放**。引擎逐像素的径向位移是
 *   `off = (k - 16) * dist * Length / (|center| * 16)`（raw 126180-126190 的 `v63` + `v65 = 16.0`），
 *   而"位移 ∝ 到中心的距离"正是**绕中心的缩放**，所以第 k 个采样等价于把源按 `s_k` 缩放后再采样。
 *   `dist / |center|` 在 `|center| = 0` 时退化 ⇒ 用 `max(1, |center|)` 兜底。
 * - 其余（SlideBlur）：沿 `Angle`（度）的**平移**，`k` 的位移 = `(k - half) * (Length / half)`
 *   （总长度 = `2 * Length`；引擎核宽 `2L+1`，这里用同一总长度取 33 个样本 —— 见 `TransitionBlurPlan`
 *   的偏差披露）。
 *
 * 返回的 `scale` 是"画源时该用的缩放"（与引擎采样的方向互逆，见 `1/s`）。
 */
export function scTransitionBlurOffsets(
  plan: TransitionBlurPlan,
):
  | { kind: 'slide'; dx: number; dy: number }
  | { kind: 'zoom'; cx: number; cy: number; step: number } {
  const half = (plan.samples - 1) / 2;
  if (plan.zoom) {
    const mag = Math.max(1, Math.hypot(plan.centerUPx, plan.centerVPx));
    return {
      kind: 'zoom',
      cx: plan.centerUPx,
      cy: plan.centerVPx,
      step: plan.length / mag / 16, // `dbl_51D7E8 = 16.0`；采样 k 的比例 = 1 + (k-half)*step
    };
  }
  const rad = (plan.angle * Math.PI) / 180;
  const stepPx = half > 0 ? plan.length / half : 0;
  return { kind: 'slide', dx: Math.cos(rad) * stepPx, dy: Math.sin(rad) * stepPx };
}

/**
 * 类别 2 的**扫描位移**标量（诊断/快照用；raw 134953 那一族）。
 *
 * - case 0-3（单边界）：`trunc(elapsed/(dur/n)) * b`（case 1/3 先 `+1.0` 再取整），`n = 尺寸/b + 2`；
 * - case 4-7：`P - b`（case 5/7 的带内相位是 `b - P`，这里统一给 `P - b` 供"单调推进"判读）；
 * - case 8-11：`P`（每带再减带序号 `i`，见 `scTransitionBands`）。
 */
export function scTransitionOffset(
  rec: TransitionRecord,
  rt: TransitionRuntime,
  clock: number,
  rect: TransitionRect,
): number {
  if (at(rec, 0) !== CAT_BLIND) return 0;
  const b = at(rec, 14);
  const dur = at(rec, 3);
  const sub = at(rec, 13);
  if (b < 1 || dur <= 0 || sub < 0 || sub > 11) return 0;
  const elapsed = clock - (rt.start + at(rec, 2));
  const W = rect.w;
  const H = rect.h;
  switch (sub) {
    case 0:
      return blindOffset(elapsed, dur, Math.floor(W / b) + 2, b);
    case 1:
      return blindOffsetPlusOne(elapsed, dur, Math.floor(W / b) + 2, b);
    case 2:
      return blindOffset(elapsed, dur, Math.floor(H / b) + 2, b);
    case 3:
      return blindOffsetPlusOne(elapsed, dur, Math.floor(H / b) + 2, b);
    case 4:
    case 6:
      return bandPhase(elapsed, dur, b + 1) - b;
    case 5:
    case 7:
      return b - bandPhase(elapsed, dur, b + 1);
    case 8:
    case 10:
      return bandPhase(elapsed, dur, Math.floor(W / b) + 1 + b);
    default:
      return bandPhase(elapsed, dur, Math.floor(H / b) + 1 + b);
  }
}

/**
 * **逐帧推进所有转场窗**（引擎 `sub_4B06D0` 的窗口部分：锁存起点、算 t/off、到点杀记录、
 * 一遍绘完清空整张表）。两个宿主的 `advanceModel` 各调一次，**共用这一份**。
 *
 * 时序：帧驱动里 `advanceModel` 在"本帧 VM 步进之后、present 之前"（`src/frame/loop.ts`）
 * ⇒ 脚本本帧写的记录会被本帧这一次 tick 看到（不会出现"写了立刻被清掉"）。
 *
 * @param freeze 引擎 `Scene+46512`（强制冻结 / 立即收尾位；置位者 `sub_407EA0` raw 12796、
 *   转场非法条宽 raw 134936）。为真时**所有转场窗当帧到期**（`sub_4B06D0` 的
 *   `… || *(_DWORD *)(_this + 46512) == 1`，raw 134941 / 135806 / 136182）⇒ 透给
 *   `scTransitionWindow` 的第 4 参（`T-0091` G1：此前硬编码 false，冻结永远传不进来）。
 * @param poolPending **全场景池挂起位探针**（引擎 `Scene+46516`；见文件头纪律 2 的订正）。
 *   默认 `() => false` = 旧的"只看转场自己"口径 —— 两个宿主都注入 `scPoolPending`。
 *   ★为什么是注入而不是 import：`ops.ts` 已经 `import` 本模块（`ops.ts:51` 的
 *   `scTransitionsPending`），反向 import `ops.ts` 的 `scPoolPending` 会造出
 *   `ops.ts ↔ transition.ts` 的**模块环**（本工程前例 `T-0089` 的 TDZ 崩）。
 *   `T-0091` notes 给的另一条路（把 `scPoolPending` 移到中立模块）会新开文件，超出本票白名单 ⇒ 取注入。
 *   ★探针必须在 `scAdvance` **之后**求值（宿主里 `advanceModel` 先 `scAdvance` 再本函数）——
 *   与引擎"本帧绘制期置 46516、帧末读它"同序；否则会拿上一帧（或未收尾）的状态判。
 */
export function scTransitionTick(
  s: SceneState,
  clock: number,
  freeze = false,
  poolPending: () => boolean = () => false,
): TransitionTickResult {
  const r4 = s.render4;
  /** 在窗内（= "在途"，gate/`needsRender` 的口径；到期帧**不算**，与引擎"到期分支不置 `46516`"一致）。 */
  const active: number[] = [];
  /** 本帧要合成进记录 `[4]` 的那一批（含**到期帧的终值交付**；`tickets/T-0091` 的 D2）。 */
  const render: TransitionRenderItem[] = [];
  let finishedAny = false;
  for (const [id, rec] of r4.transitions) {
    let rt = r4.transitionRuntime.get(id);
    if (!rt) {
      // ★首帧锁存（引擎 `sub_4AAE10(Scene+1048, &key)[1] = Scene+46500`，raw 134869）：
      //   写入端每次都会把 `[1]` 写 0（raw 133753 等）⇒ 我们这里锁存的是"第一次被消费的时钟"。
      rt = { start: clock, active: false, finished: false, t: 0, channels: [0, 0, 0, 0] };
      r4.transitionRuntime.set(id, rt);
    }
    // 旧：scTransitionWindow(rec, clock, rt.start, false)（`T-0084` 的硬编码第 4 参 =
    //   `T-0091` evidence 锚点 `rt.start, false`；G1 起改传 `freeze`）。
    const w = scTransitionWindow(rec, clock, rt.start, freeze);
    if (!w.active) {
      // ★到期帧（`tickets/T-0091` 的 D2）：引擎**不跳过渲染** —— 四通道锁成终值（raw 135808-135811）后
      //   仍走 36→`[4]`，而记录要到**帧尾**才被 `sub_4A9BE0` 清（raw 136840-136841）。
      //   emulator 的合成在 `present()` 里、晚于本 tick ⇒ **不能只靠"表还在"来决定要不要合成**
      //   （否则同帧清表会让 `[4]` 永远收不到 t=1）。⇒ 这里把这一帧要画的东西**做成快照交出去**
      //   （`render`），宿主 `present()` 用它合成；表该清就照引擎清。
      rt.active = false;
      rt.finished = true;
      rt.t = w.t;
      rt.channels = blurChannels(rec, 1, true);
      finishedAny = true;
      render.push({ id, rec, rt });
      continue;
    }
    rt.active = true;
    rt.finished = w.finished;
    rt.t = w.t;
    const cat = at(rec, 0);
    if (cat === CAT_BLUR) {
      rt.channels = blurChannels(rec, w.t, false);
    }
    active.push(id);
    render.push({ id, rec, rt });
  }
  let cleared = false;
  if (r4.transitions.size > 0 && active.length === 0 && !poolPending()) {
    // ★引擎 raw 136840-136841：一遍绘完 `Scene+46516 == 0` ⇒ `sub_4A9BE0(Scene+1048)` 清空整表
    //   （同门第二处 raw 137181 用 `v35[11629]`）。**46516 是全场景**池挂起位，不只是转场
    //   （绘制项 raw 117844 / mesh raw 133528 / 离屏槽 raw 136695·136701 都置它）
    //   ⇒ 转场到期那帧另有 mesh/绘制项窗在跑时**必须保留**死记录（`T-0091` G2 的守卫就是这样判别的）。
    //   不清的话下一次同 id 写入会带着上一轮的 `transitionRuntime`（起点还是老的）。
    //   ★清表**不影响**本帧的 `render` 快照：宿主已经拿到 `{id, rec, rt}` 的引用（`rt` 只是从表里摘掉）。
    r4.transitions.clear();
    r4.transitionRuntime.clear();
    cleared = true;
  }
  // ★交付过终值的那一帧必须**再合成一次**：`scTransitionsPending` 在到期帧是假（与引擎一致），
  //   所以靠"置脏"让 `needsRender`/驱动把这一帧画出去（画完由 present/snapshot 消费掉这次脏）。
  if (finishedAny && render.length > 0) s.dirty = true;
  return { active, finishedAny, cleared, render };
}

/** 本帧是否有活动转场（`sceneNeedsRender` 的第三项；引擎 `Scene+46508` / `sub_40BE10` raw 16022）。 */
export function scTransitionsPending(s: SceneState): boolean {
  for (const rt of s.render4.transitionRuntime.values()) if (rt.active) return true;
  return false;
}

/** 本帧活动的转场（**按 id 升序** —— 引擎按 `std::map` 键升序遍历，raw 134856-134860 + 136710）。 */
export function scActiveTransitions(  s: SceneState,
): { id: number; rec: TransitionRecord; rt: TransitionRuntime }[] {
  const out: { id: number; rec: TransitionRecord; rt: TransitionRuntime }[] = [];
  for (const [id, rec] of s.render4.transitions) {
    const rt = s.render4.transitionRuntime.get(id);
    if (rt?.active) out.push({ id, rec, rt });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/**
 * 类别 2 的**目标绘制项矩形**（引擎 `Scene+1032` 按 `[15]` 查 `sub_459EA0`，raw 134889-134902）。
 * 查不到 ⇒ 引擎把该记录杀成死记录并**直接返回**（raw 134890-134893）⇒ 这里返回 `null`。
 */
export function scTransitionTargetRect(s: SceneState, rec: TransitionRecord): TransitionRect | null {
  const it = s.drawItems.get(at(rec, 15));
  if (!it) return null;
  return { x: Math.trunc(it.posX), y: Math.trunc(it.posY), w: it.srcW, h: it.srcH };
}

/** 两条 item 区间（写端 `[5]`/`[7]` 与 `[6]`/`[8]`）在**当前模型**里对应的屏幕矩形。 */
export interface TransitionRangeRects {
  /** 区间 A（`[5]` 起、`[7]` 跨度）覆盖的绘制项矩形并集；`null` = 一个都不在模型里。 */
  a: TransitionRect | null;
  /** 区间 B（`[6]` 起、`[8]` 跨度）。 */
  b: TransitionRect | null;
  /** 命中 A 的绘制项数 / 命中 B 的。 */
  countA: number;
  countB: number;
}

/**
 * ★**转场的两条 item 区间**（`[5]`/`[7]` 与 `[6]`/`[8]`）—— 引擎的 36/37 装的就是这两组项。
 *
 * 依据（`sub_4B06D0` 的**两趟 scratch 重绘**，raw 136014-136176 / asm `0x4B379C` 起）：
 * `for (v60 = 0; v60 < 2; ++v60) { SetTarget(36+v60); Clear; BeginScene; 把该趟的 item 画进去; EndScene; }`
 * —— 第 0 趟画区间 A（起点 `[5]`）、第 1 趟画区间 B（起点 `[6]`），两趟都**排除另一条区间**；
 * 两趟之前先 `SetTarget(36+v60)` + `Clear`，所以那一层上**只有这两组项**（其余是透明）。
 * ⇒ 转场的可见范围**只覆盖这两组项**，不是整屏（emulator 现在用整屏快照 ⇒ 见下面的缺口）。
 *
 * ★**为什么只导出、还没有拿它裁剪绘制**：①引擎那两趟的**上界**在体里不是 `[5]+[7]`
 * （判据是"键 ≥ 起点 且 不在另一条区间内"，raw 135577/135591/135605），本函数按**写端的声明**
 * （起点 + 跨度）取，属"按写端意图"的读法；②它要真正生效需要"只画子集项"的离屏合成
 * （= 路线 D / `T-0066`）。所以本轮先把它**量出来**（进快照），下一步再决定要不要据它裁剪。
 */
export function scTransitionRangeHandles(
  s: SceneState,
  rec: TransitionRecord,
): { a: Set<number>; b: Set<number> } {
  const pick = (start: number, span: number): Set<number> => {
    const out = new Set<number>();
    if (span <= 0) return out; // 写端没写这一条（如 0x250/0x251 不写 [6]/[8]）⇒ 该层是空白
    const end = start + span;
    for (const handle of s.drawItems.keys()) if (handle >= start && handle < end) out.add(handle);
    return out;
  };
  return { a: pick(at(rec, 5), at(rec, 7)), b: pick(at(rec, 6), at(rec, 8)) };
}

/**
 * 两条区间对应的屏幕矩形（**并集**）+ 命中项数。宿主拿它做离屏子集合成的尺寸参考/诊断；
 * 真正的合成用 `scTransitionRangeHandles`（要的是项集合，不是矩形）。
 */
export function scTransitionRangeRects(s: SceneState, rec: TransitionRecord): TransitionRangeRects {
  const { a, b } = scTransitionRangeHandles(s, rec);
  const box = (handles: Set<number>): TransitionRect | null => {
    if (handles.size === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const h of handles) {
      const it = s.drawItems.get(h);
      if (!it) continue;
      const x = Math.trunc(it.posX);
      const y = Math.trunc(it.posY);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + it.srcW);
      y1 = Math.max(y1, y + it.srcH);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  return { a: box(a), b: box(b), countA: a.size, countB: b.size };
}

/**
 * ★**本帧要从屏幕 pass 里排除的项**（`tickets/T-0091` 的 D3）—— 引擎的 `|0x10000`「已画进 scratch」标记。
 *
 * 引擎依据（这一条是本轮逐点核出来的，直接决定"转场期间屏上到底有没有原图"）：
 * - **打标记**：被画进 36/37 的那两组项，每画一个就 `*node |= 0x10000u`
 *   （raw 135766/135772/135798、135988/135995/136003、136294-136309、136367、136430、136489、136649-136669）；
 * - **屏幕 pass 读标记**：四路归并里每一项画之前都判 `(flags & 0x10001) == 1`（= **bit0 存在位 且 bit16 未置**）
 *   —— raw 136905 / 136915 / 136926 / 136936（`sub_4B4040`，主帧提交）与 137210 / 137220 / 137252（`0x222` 路径）；
 * - **画完就清**：同一批判断里紧跟 `*node &= ~0x10000u`（raw 136908/136918/136929/136939、137213/137224/137255）。
 * ⇒ **被转场占用（画进 36/37）的项在屏上不出现**，玩家看到的是通过记录 `[4]` 那个槽呈现的合成结果。
 *
 * emulator 的等价物 = 把「本帧活动转场的两条区间」并起来当排除集（标记/清标记都不必落库：
 * `present()` 每帧现算，转场一结束排除集自然为空 ⇒ 项立刻回到屏上；引擎那侧靠"画完清 bit"达到同一效果）。
 *
 * ★**已知未复刻的细节（如实登记，不许当已做）**：引擎的填充趟要求 `bit16 == 0`（raw 135580/135595/135609…），
 * 所以第 2 帧起那两组项**不再被重画进 36/37** ⇒ 引擎的 36/37 是**首帧冻结快照**；emulator 的
 * `#renderRangeCanvas` 是**每帧重渲**（`#rangeCache` 逐帧清）。⇒ 转场期间"被转场覆盖的内容会不会跟着动"
 * 这一条两边可能不同；归 `tickets/T-0091`（与本条的排除集分开记）。
 */
export function scTransitionMarkedHandles(s: SceneState, extra?: readonly TransitionRenderItem[]): Set<number> {
  const out = new Set<number>();
  for (const { rec } of scActiveTransitions(s)) {
    const { a, b } = scTransitionRangeHandles(s, rec);
    for (const h of a) out.add(h);
    for (const h of b) out.add(h);
  }
  // ★`extra` = tick 的 `render` 快照里那几条（含**到期帧**：引擎在到期帧仍走转场遍 ⇒ 同样要排除；
  //   而 emulator 的表在那一帧就被清了，光查表就漏掉这一帧的排除）。
  for (const { rec } of extra ?? []) {
    const { a, b } = scTransitionRangeHandles(s, rec);
    for (const h of a) out.add(h);
    for (const h of b) out.add(h);
  }
  return out;
}
