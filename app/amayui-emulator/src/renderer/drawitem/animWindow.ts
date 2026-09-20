/**
 * 动画窗（window）的状态机：相位计算、窗末收尾、逐帧推进、以及"是否还有窗在跑"。
 *
 * 窗下标见 `model.ts` 的 `W_COLOR/W_SCALE/W_ROT/W_TRANS/W_FLIPBOOK`（与引擎 5 个窗一一对应）。
 * ★注意：`winPhase` 在"首次跨过起点"时会写回 `it.animStart`（锁存起点）——
 * 这是引擎语义的一环（不是纯查询），调用方须按 `advanceWindows → 求值` 的顺序使用。
 */
import type { Item } from './model.js';
import { ITEM_FLAG_ANIM_LOOP, W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from './model.js';

/** 窗相位。 */
export type WinPhase = 'none' | 'before' | 'active' | 'after';

/**
 * 动画窗相位判定（**有副作用**：`+0x34` 起点为 0 时锁存当前 clock —— 引擎 raw 117437-117438
 * `if (!a2[13]) a2[13] = *(float*)(Scene+46500)`；起点是**全项共享**的一个字段）。
 *
 * - `none`   ：该窗从未被 setter 配置 ⇒ 不参与动画；
 * - `before` ：已锁存但仍在 delay 期 ⇒ 保持 `work`/`from`；
 * - `active` ：窗内 ⇒ `t = (clock − start − delay) / dur`（**无 clamp**；窗口条件已保证 0<t<1）；
 * - `after`  ：窗已结束（含 `dur = 0` 的"配置过但零时长"）⇒ 调用方做一次性收尾（`work ← target`）。
 */
export function winPhase(it: Item, idx: number, clock: number): { phase: WinPhase; t: number } {
  const w = it.wins[idx]!;
  if (!w.set) return { phase: 'none', t: 0 };
  if (it.animStart === 0) it.animStart = clock; // ★首帧锁存（引擎 raw 117438）
  const s = it.animStart + w.delay;
  if (clock < s) return { phase: 'before', t: 0 };
  if (w.dur <= 0) return { phase: 'after', t: 1 };
  if (clock >= s + w.dur) return { phase: 'after', t: 1 };
  return { phase: 'active', t: (clock - s) / w.dur };
}

/** 窗是否已结束（`none` 视为结束 —— 未配置 = 无动画可等）。 */
export function windowDone(it: Item, idx: number, clock: number): boolean {
  const p = winPhase(it, idx, clock);
  return p.phase === 'none' || p.phase === 'after';
}

/** 窗末收尾：`work ← target`（颜色窗则 `from ← to`），并清该窗（引擎 `a2[18]=0; a2[23]=0`）。 */
export function freezeWindow(it: Item, idx: number): void {
  if (idx === W_COLOR) it.from = it.to;
  else if (idx === W_SCALE) it.scaleWork = { ...it.scaleTarget };
  else if (idx === W_ROT) it.rotWork = { axis: { ...it.rotTarget.axis }, deg: it.rotTarget.deg };
  else if (idx === W_TRANS) it.transWork = { ...it.transTarget };
  // flipbook：把「末帧 / 复位」持久化（引擎每帧重算，见 `fbHold` 注释）
  else if (idx === W_FLIPBOOK) it.fbHold = (it.fbFlags & 1) !== 0 ? it.fbFrames - 1 : -1;
  const w = it.wins[idx]!;
  w.delay = 0;
  w.dur = 0;
  w.set = false;
}

/**
 * **逐帧驱动**（引擎 `sub_49AA30` / 元素驱动体的等价物）：把所有已配置动画窗按墙钟推进，
 * 窗末做一次性收尾 —— 引擎 raw 117496（缩放 `qmemcpy(a2+27, a2+43, 0x40)`）、
 * 117550（旋转 `a2+59 ← a2+75`）、117646（平移 `a2+91 ← a2+107`）、117831（flipbook 回写源矩形）。
 * 全部窗结束后清项级动画位 `flags &~ 2`（raw 117835）与共享起点 `+0x34 = 0`（raw 117837）。
 */
export function advanceWindows(it: Item, clock: number): boolean {
  if (!(it.flags & 2)) return false;
  let pending = false;
  let changed = false;
  for (let i = 0; i < 5; i++) {
    const p = winPhase(it, i, clock);
    if (p.phase === 'before' || p.phase === 'active') pending = true;
    else if (p.phase === 'after') {
      freezeWindow(it, i);
      changed = true; // 窗末收尾（`work ← target`）改了可见状态 ⇒ 这一帧必须重新合成
    }
  }
  if (!pending) {
    it.flags &= ~2;
    it.animStart = 0;
    changed = true;
  }
  return changed;
}
/** 该 item 是否还有窗没走完（供 0x400 卫门判断）。 */
export function itemAnimationsPending(it: Item, clock: number): boolean {
  if (!(it.flags & 2)) return false;
  for (let i = 0; i < 5; i++) if (!windowDone(it, i, clock)) return true;
  return false;
}

/**
 * **B 层（bit2）是否还在动** —— 用于"这一帧要不要继续合成"，**不是**等待门的判据。
 *
 * 为什么需要它：B 层是**无限周期**动画（`period > 0` 就一直动），而渲染侧只画被合成的那一帧
 * ⇒ 与 A 层一样必须让帧驱动持续合成，否则画面上只有一个静止的初相。
 *
 * ★★它**绝不进 `scPoolPending` / `itemAnimationsPending`**：引擎的池挂起位 `Scene+46516` 只在
 *   **A 层（bit1）** 路径置位（raw 117844、133528），`sub_49BCC0` 全程没有写它 ⇒ 把 B 层当
 *   "pending"接进等待门会引入引擎没有的**卡帧/死等**（B 层永远不会"结束"）。
 *   见 `docs-new/03-engine/b3-bit2-model-spec-2026-09.md` §4.6。
 */
export function itemLoopAnimationsPending(it: Item): boolean {
  if (!(it.flags & ITEM_FLAG_ANIM_LOOP)) return false;
  for (const l of it.loops) if (l.period > 0) return true;
  return false;
}