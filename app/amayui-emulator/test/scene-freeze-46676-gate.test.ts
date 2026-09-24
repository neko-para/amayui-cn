/** @tier T0 @kind core @subsystem render */

/**
 * ★★**渲染冻结总闸 `Scene+46676`**（审计 §4.2 #24 `scene-render-freeze-46676`，P1）。
 *
 * 引擎里它是一个**只读帧级门**（全文件 105 处读、**0 处写**）：
 *  - `sub_4B06D0` raw 134898 / `sub_49AA30` raw 117375 ⇒ 非 0 时**整段 2D 提交/逐项提交被跳过**；
 *  - `sub_4AF1C0` raw 133547 ⇒ 网格的顶点锁定 + 缩放整段跳过；
 *  - 文本行绘制 raw 71833/72266、draw-item 混合覆盖 raw 123117 同为门；
 *  - `sub_4B4040` raw 136790 / `sub_4B4460` raw 137033 ⇒ 连"进 mode-38 渲染目标"都不做。
 *
 * emulator 修前只有**窗口级**的近似（`scAdvance` 的 `freeze` 形参 = `Scene+46512` 强制收尾），
 * 没有任何以 46676 为条件的帧级跳过 ⇒ "应该冻住的帧仍在动/仍在合成"（不报错，只在录屏比对时看得出）。
 *
 * 本文件钉四件事（全部按共享模型断言，两个宿主同一份实现）：
 *  1. 置位 ⇒ `sceneNeedsRender` 恒假（引擎那一帧确实不重画：`46508` 也不会被置位）；
 *  2. 置位 ⇒ `scAdvance` 不推进**任何窗**（引擎整段提交被跳过）；
 *  3. ★与 `46512`（立即收尾）**不是一回事**：46512 会收尾并置脏，46676 什么都不做；
 *  4. 清位 ⇒ 一切照旧（不会漏一帧：冻结期间的脚本改动照旧置脏）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scAdvance, sceneNeedsRender } from '../src/renderer/scene/ops.js';
import { scSetSceneFrozen } from '../src/renderer/scene/ops.js';

const H = 0x100;
const T0 = 16;

function sceneWithWindow(): HeadlessScene {
  const s = new HeadlessScene({});
  s.configureDrawItem({ handle: H, layer: 1, tex: 1, srcX: 0, srcY: 0, srcW: 10, srcH: 10, dstX: 0, dstY: 0 });
  s.setScaleAnim(H, 0, 1000, 2, 2, 2); // 窗1：delay=0、dur=1000
  return s;
}

test('★`Scene+46676` 置位 ⇒ `sceneNeedsRender` 恒假（即便脏、即便有窗在跑）', () => {
  const s = newSceneState();
  s.dirty = true;
  assert.equal(sceneNeedsRender(s, T0, true), true, '基线：脏 ⇒ 要合成');
  scSetSceneFrozen(s, true);
  assert.equal(sceneNeedsRender(s, T0, true), false, '★冻结 ⇒ 整趟提交被跳过 ⇒ 不合成');
  assert.equal(sceneNeedsRender(s, T0, false), false, '冻结时"不脏"当然也不合成');
  scSetSceneFrozen(s, false);
  assert.equal(sceneNeedsRender(s, T0, true), true, '清位 ⇒ 恢复（不置脏也不会漏：调用方传的是自己的脏位）');
});

test('★★`Scene+46676` 置位 ⇒ `scAdvance` 不推进任何窗（与 `46512` 的"立即收尾"不同）', () => {
  const s = sceneWithWindow();
  s.snapshot();
  scAdvance(s.scene, T0); // 锁存窗起点
  const it = s.scene.drawItems.get(H)!;
  const startBefore = it.animStart;
  const scaleBefore = { ...it.scaleWork };

  // ① 冻结总闸置位：**什么都不发生**（不收尾、不置脏、不改字段）
  scSetSceneFrozen(s.scene, true);
  s.scene.dirty = false;
  // 时钟推到窗**结束之后**（T0+1000 = 窗末）——若门不生效，这一帧会收尾（清 bit1）并置脏。
  scAdvance(s.scene, T0 + 1200);
  assert.equal(it.animStart, startBefore, '窗起点不动（冻结期间连锁存都不做）');
  assert.deepEqual({ ...it.scaleWork }, scaleBefore, 'work 矩阵不动（没收尾）');
  assert.equal((it.flags & 2) !== 0, true, '★动画位**仍挂着** —— 46676 不是"立即收尾"（那是 46512）');
  assert.equal(s.scene.dirty, false, '冻结帧不置脏（引擎 `46508` 也不会被置位）');

  // ② 清位之后**同一时刻**照常收尾（证明上一条不是"窗还没到点"）
  scSetSceneFrozen(s.scene, false);
  scAdvance(s.scene, T0 + 1200);
  assert.equal((it.flags & 2) === 0, true, '解冻后窗末收尾 ⇒ 清 bit1（冻结期间没有"吃掉"这一帧）');
  assert.equal(s.scene.dirty, true, '窗末那一帧置脏（终态与上一帧的插值不同）');
});

test('★对照：`46512`（`freeze` 形参）会收尾并置脏 —— 两个门不是一回事', () => {
  const s = sceneWithWindow();
  scAdvance(s.scene, T0);
  const it = s.scene.drawItems.get(H)!;
  s.scene.dirty = false;
  scAdvance(s.scene, T0 + 100, true); // 引擎语义：本遍照画、但窗跳到终态
  assert.equal((it.flags & 2) === 0, true, '46512 ⇒ 窗当帧收尾（清 bit1）');
  assert.equal(s.scene.dirty, true, '46512 ⇒ 置脏（raw 117839/133540 无条件）');
});

test('★`advanceModel` 每帧调用不会把冻结位清掉（门由宿主显式开关）', () => {
  const s = sceneWithWindow();
  s.setSceneFrozen(true);
  s.advanceModel(T0);
  assert.equal(s.sceneFrozen(), true, '门位不由帧推进复位');
  assert.equal(s.needsRender(), false, '冻结帧不合成');
  s.setSceneFrozen(false);
  assert.equal(s.sceneFrozen(), false);
});
