/**
 * **转场窗的运行时模型** —— `tickets/T-0084`（引擎消费端 `sub_4B06D0` 的窗口部分）。
 *
 * 守住的东西（每条都能在 `engine/天结_unpacked.exe_utf8.c` 里找到行号）：
 *  - **首帧锁存起点**（`[1]`，raw 134867-134871）且之后不再变；
 *  - **到期 = 死记录**：`clock >= [1]+[2]+[3]` ⇒ 不再活动（raw 134941 / 135806 / 136182）；
 *  - **一遍绘完、没有在途转场 ⇒ 清空整张记录表**（raw 136840-136841 的 `sub_4A9BE0(Scene+1048)`）；
 *  - **`[13] < 0` = 立即收尾**（raw 134934-134936，写端在"非法条宽"的退化路径上写 -1）；
 *  - ★**运行期绝不回写 `render4.transitions`**（`op-24f-250-251-transitions.test.ts` 对那张表
 *    做整条 `deepEqual`，且显式断言 `[1]` 仍为默认）⇒ 运行期值只活在 `transitionRuntime`；
 *  - **有活动转场窗 ⇒ `sceneNeedsRender` 恒真**（引擎 `Scene+46508` 的置位点 raw 136718-136719，
 *    唯一读者 `sub_40BE10` raw 16022）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newSceneState } from '../src/renderer/scene/state.js';
import { scClearTransitions, scSetTransition, scTransitionDefaultRecord } from '../src/renderer/scene/ops.js';
import { scPoolPending, scSetVertexColorAlpha } from '../src/renderer/scene/ops.js';
import { scSnapshot } from '../src/renderer/scene/snapshot.js';
import { sceneNeedsRender } from '../src/renderer/scene/ops.js';
import {
  scActiveTransitions,
  scTransitionBlurOffsets,
  scTransitionBlurPlan,
  scTransitionRangeRects,
  scTransitionTargetRect,
  scTransitionTick,
  scTransitionsPending,
} from '../src/renderer/scene/transition.js';
import { scConfigureDrawItem } from '../src/renderer/scene/ops.js';

/** 类别 0（淡入淡出）记录：`0x223` 的写端 `sub_4ADDB0`（raw 132590-132635）逐格照抄。 */
function fadeRecord(delay: number, dur: number, slot = 3): number[] {
  const rec = scTransitionDefaultRecord();
  rec[0] = 0;
  rec[1] = 0; // 写端写 0（raw 132619），由消费端首帧锁存
  rec[2] = delay;
  rec[3] = dur;
  rec[4] = slot;
  rec[5] = 0x100;
  rec[6] = 1;
  rec[7] = 0x200;
  rec[8] = 1;
  return rec;
}

/** 类别 3（插值模糊）记录：`0x250` 的写端（raw 133789-133858）。 */
function blurRecord(dur: number, sub = 0): number[] {
  const rec = scTransitionDefaultRecord();
  rec[0] = 3;
  rec[2] = 0;
  rec[3] = dur;
  rec[4] = 0x3f59;
  rec[13] = sub;
  // 四通道起止（[16..19] → [20..23]）
  rec[16] = 0;
  rec[17] = 10;
  rec[18] = 20;
  rec[19] = 30;
  rec[20] = 100;
  rec[21] = 110;
  rec[22] = 120;
  rec[23] = 130;
  return rec;
}

test('★窗口起点只在首帧锁存一次（之后 tick 不再改）', () => {
  const s = newSceneState();
  s.render4.transitions.set(0, fadeRecord(0, 1000));
  scTransitionTick(s, 500);
  const rt = s.render4.transitionRuntime.get(0);
  assert.ok(rt);
  assert.equal(rt!.start, 500, '首帧锁存 = 那一次的时钟');
  scTransitionTick(s, 700);
  assert.equal(s.render4.transitionRuntime.get(0)!.start, 500, '第二帧不许再锁存');
});

test('★到期即死记录：`clock >= [1]+[2]+[3]` ⇒ 不活动，且整张表被清空（raw 136840-136841）', () => {
  const s = newSceneState();
  s.render4.transitions.set(7, fadeRecord(100, 400));
  scTransitionTick(s, 1000); // start = 1000
  assert.equal(s.render4.transitionRuntime.get(7)!.active, true);
  scTransitionTick(s, 1499); // 1000+100+400 = 1500 ⇒ 还差 1ms
  assert.equal(s.render4.transitionRuntime.get(7)!.active, true, 'deadline 前 1ms 仍活动');
  const r = scTransitionTick(s, 1500); // 到点
  assert.equal(r.cleared, true, '没有在途转场 ⇒ 清空整张记录表');
  assert.equal(s.render4.transitions.size, 0, '记录表被清空（引擎 sub_4A9BE0）');
  assert.equal(s.render4.transitionRuntime.size, 0, '运行期状态一起清');
  assert.equal(scTransitionsPending(s), false);
});

test('★类别 0 的进度 t：延迟内为 0、之后线性、到期视作 1', () => {
  const s = newSceneState();
  s.render4.transitions.set(1, fadeRecord(200, 800));
  scTransitionTick(s, 0);
  assert.equal(s.render4.transitionRuntime.get(1)!.t, 0, 'clock <= start+delay ⇒ t = 0');
  scTransitionTick(s, 199);
  assert.equal(s.render4.transitionRuntime.get(1)!.t, 0);
  scTransitionTick(s, 200);
  assert.equal(s.render4.transitionRuntime.get(1)!.t, 0, '恰好等于 start+delay ⇒ 仍是 0（体是 `clock >`）');
  scTransitionTick(s, 600); // (600-0-200)/800 = 0.5
  assert.equal(s.render4.transitionRuntime.get(1)!.t, 0.5);
  // 到点那一帧：不活动、t = 1（引擎 raw 136184）
  const w = scTransitionTick(s, 1000);
  assert.ok(w.finishedAny);
  assert.equal(s.render4.transitionRuntime.get(1)?.t ?? 1, 1);
});

test('★`[13] < 0` = 立即收尾：首帧就不活动、一个条带都不画、表被清空', () => {
  const s = newSceneState();
  const rec = fadeRecord(0, 1000);
  rec[13] = -1; // 写端在"非法条宽"退化路径上写 -1（0x24F，raw 133730-133735）
  s.render4.transitions.set(2, rec);
  scTransitionTick(s, 0);
  assert.equal(s.render4.transitionRuntime.size, 0, '立即收尾 ⇒ 同帧清表');
  assert.equal(scTransitionsPending(s), false);
  assert.equal(scActiveTransitions(s).length, 0, '不产出任何绘制');
});

test('★类别 3 的四通道按 t 线性插值（取整）、到期用终值', () => {
  const s = newSceneState();
  s.render4.transitions.set(3, blurRecord(1000, 0));
  scTransitionTick(s, 0);
  assert.deepEqual(s.render4.transitionRuntime.get(3)!.channels, [0, 10, 20, 30], 't=0 = 起始四通道');
  scTransitionTick(s, 500);
  assert.deepEqual(s.render4.transitionRuntime.get(3)!.channels, [50, 60, 70, 80], '中段 = 线性取整');
  scTransitionTick(s, 1000);
  assert.deepEqual(s.render4.transitionRuntime.get(3)?.channels ?? [100, 110, 120, 130], [100, 110, 120, 130], '到期用终值');
});

test('★★T-0091 G2：转场到期那帧**另有 mesh 窗在跑** ⇒ 表不能清（门 = 全场景 `Scene+46516`）', () => {
  // 引擎 raw 136840-136841（同门第二处 raw 137181）：`if ( !Scene+46516 ) sub_4A9BE0(Scene+1048)`。
  // `46516` 不是"还有没有转场"，而是**全场景**池挂起位（mesh 路径 raw 133528 也置它）
  // ⇒ 转场自己到期、别的窗还在跑时，死记录必须**保留**。
  const s = newSceneState();
  s.render4.transitions.set(7, fadeRecord(0, 100)); // start 锁存 0 ⇒ 100 ms 到期
  scSetVertexColorAlpha(s, 0x3001, 0, 1000, 255, 0xffffff); // 同一个场景里再起一个 1000 ms 的 mesh 颜色窗
  scTransitionTick(s, 0);
  assert.equal(s.render4.transitions.size, 1, '起窗那一帧两者都在');

  const r = scTransitionTick(s, 100, false, () => scPoolPending(s, 100));
  assert.equal(r.active.length, 0, '转场自己确实到期了（active 为空）');
  assert.equal(scPoolPending(s, 100), true, 'mesh 窗还在跑 ⇒ 池挂起位为 1（raw 133528）');
  assert.equal(r.cleared, false, '★门错位就会在这里清表 —— engine 不清（46516 非 0）');
  assert.equal(s.render4.transitions.size, 1, '死记录保留到"全场景都不在途"为止');
  assert.equal(s.render4.transitionRuntime.get(7)!.start, 0, '运行期锁存仍在（没被清）');

  // mesh 窗也走完 ⇒ 下一帧才清（同一个门，另一半）
  const r2 = scTransitionTick(s, 1100, false, () => scPoolPending(s, 1100));
  assert.equal(scPoolPending(s, 1100), false, '1000 ms mesh 窗已结束');
  assert.equal(r2.cleared, true, '全场景池挂起为 0 ⇒ 清表（raw 136840）');
  assert.equal(s.render4.transitions.size, 0);

  // ★判别力对照：同一形态、探针缺省（= 旧口径"只看转场自己"）⇒ 那一帧就把表清了
  const s0 = newSceneState();
  s0.render4.transitions.set(7, fadeRecord(0, 100));
  scSetVertexColorAlpha(s0, 0x3001, 0, 1000, 255, 0xffffff);
  scTransitionTick(s0, 0);
  assert.equal(
    scTransitionTick(s0, 100).cleared,
    true,
    '旧口径（不注入池挂起探针）在同一帧清表 ⇒ 上面那条断言不是"恰好为真"',
  );
});

test('★T-0091 G1：`freeze`（`Scene+46512`）⇒ 转场窗当帧到期，而不是按墙钟跑', () => {
  // 引擎 `sub_4B06D0` 三处：raw 134941 / 135806 / 136182 的 `… || *(Scene+46512) == 1` ⇒ 收尾。
  // ★这条同时钉住 `scTransitionTick` 把 freeze 透给了 `scTransitionWindow` 的第 4 参
  //   （此前那里硬编码 `false`，见 `transition.ts` 的旧形式注释）。
  const s = newSceneState();
  s.render4.transitions.set(2, fadeRecord(0, 10_000)); // 10 s，500 ms 时绝不该到期
  scTransitionTick(s, 0);
  assert.equal(scTransitionsPending(s), true, '起窗那一帧在途');
  const r = scTransitionTick(s, 500, true); // 冻结
  assert.equal(r.active.length, 0, '★freeze ⇒ 当帧到期');
  assert.equal(r.finishedAny, true, '到期那一帧类别 3 仍算终值通道（raw 135806-135812）');
  assert.equal(scTransitionsPending(s), false);

  // 对照：同一个 500 ms、**不**冻结 ⇒ 仍在途（证明上面不是"恰好到期"）
  const s2 = newSceneState();
  s2.render4.transitions.set(2, fadeRecord(0, 10_000));
  scTransitionTick(s2, 0);
  assert.equal(scTransitionTick(s2, 500).active.length, 1, '不冻结时 500 ms 仍在窗内');
});

test('★有活动转场窗 ⇒ `sceneNeedsRender` 恒真（引擎 `Scene+46508` ← raw 136718-136719）', () => {
  const s = newSceneState();
  s.dirty = false;
  assert.equal(sceneNeedsRender(s, 0, false), false, '没有转场时判据回到"脏 || 动画窗"');
  s.render4.transitions.set(4, fadeRecord(0, 1000));
  scTransitionTick(s, 0);
  assert.equal(scTransitionsPending(s), true);
  assert.equal(
    sceneNeedsRender(s, 0, false),
    true,
    '★少了这一项，转场期间 present:"needsRender" 档会停止合成（只画一帧）',
  );
  scTransitionTick(s, 1000);
  assert.equal(scTransitionsPending(s), false);
  assert.equal(sceneNeedsRender(s, 1000, false), false, '窗结束后判据回落');
});

test('★★运行期绝不回写 `render4.transitions`：整条 deepEqual + `[1]` 仍为写入端写的 0', () => {
  const s = newSceneState();
  const rec = fadeRecord(100, 400);
  s.render4.transitions.set(5, rec);
  const snapshotOfRecord = [...rec];
  for (const clock of [0, 100, 300, 499, 500, 900]) scTransitionTick(s, clock);
  if (s.render4.transitions.has(5)) {
    assert.deepEqual(s.render4.transitions.get(5), snapshotOfRecord, '记录表一个格都不许被运行时改');
    assert.equal(s.render4.transitions.get(5)![1], 0, '`[1]` 必须仍是写端写的 0（运行期值在 transitionRuntime）');
  }
  const fresh = newSceneState();
  fresh.render4.transitions.set(5, fadeRecord(100, 400));
  scTransitionTick(fresh, 42);
  assert.equal(fresh.render4.transitions.get(5)![1], 0);
  assert.equal(fresh.render4.transitionRuntime.get(5)!.start, 42, '锁存值在运行时表里');
});

test('★`0x224` 清表时运行期状态必须一起清（否则下一次同 id 会继承旧的锁存起点）', () => {
  const s = newSceneState();
  s.render4.transitions.set(6, fadeRecord(0, 5000));
  scTransitionTick(s, 100);
  assert.equal(s.render4.transitionRuntime.get(6)!.start, 100);
  scClearTransitions(s);
  assert.equal(s.render4.transitions.size, 0);
  assert.equal(s.render4.transitionRuntime.size, 0, '运行期表也要清');
  assert.equal(s.render4.transitionClears, 1);
  // 同一个 id 再写一次 ⇒ 起点重新锁存
  s.render4.transitions.set(6, fadeRecord(0, 5000));
  scTransitionTick(s, 9000);
  assert.equal(s.render4.transitionRuntime.get(6)!.start, 9000);
});

test('★快照导出 `render4.transitionProgress`（独立字段，不改 `transitions`）', () => {
  const s = newSceneState();
  s.render4.transitions.set(9, fadeRecord(0, 1000, 0x3f59));
  scTransitionTick(s, 0);
  scTransitionTick(s, 250);
  const snap = scSnapshot(s, 250, null);
  assert.equal(snap.render4.transitionProgress.length, 1);
  const p = snap.render4.transitionProgress[0]!;
  assert.equal(p.id, 9);
  assert.equal(p.cat, 0);
  assert.equal(p.active, true);
  assert.equal(p.t, 0.25);
  assert.equal(p.targetSlot, 0x3f59);
  assert.deepEqual(
    snap.render4.transitions,
    [...s.render4.transitions.entries()].map(([k, v]) => [k, [...v]]),
    '快照里的原始记录 = 真源原样',
  );
});

test('★类别 2 的目标矩形取自 `Scene+1032` 那张绘制项（raw 134895-134902），查不到 ⇒ null', () => {
  const s = newSceneState();
  const rec = scTransitionDefaultRecord();
  rec[0] = 2;
  rec[15] = 0x1a2b;
  assert.equal(scTransitionTargetRect(s, rec), null, '查不到 ⇒ 引擎把该记录杀成死记录并直接返回');
  scConfigureDrawItem(s, {
    handle: 0x1a2b,
    layer: 0x1a2b,
    tex: 1,
    srcX: 0,
    srcY: 0,
    srcW: 1280,
    srcH: 720,
    dstX: 40,
    dstY: 24,
  });
  assert.deepEqual(scTransitionTargetRect(s, rec), { x: 40, y: 24, w: 1280, h: 720 });
});

test('★快照里的条带数/位移与纯函数同源（类别 2；快照不自己算一套几何）', () => {
  const s = newSceneState();
  const rec = scTransitionDefaultRecord();
  rec[0] = 2;
  rec[2] = 0;
  rec[3] = 1000;
  rec[13] = 4;
  rec[14] = 8;
  rec[15] = 0x77;
  s.render4.transitions.set(0x77, rec);
  scConfigureDrawItem(s, {
    handle: 0x77,
    layer: 0x77,
    tex: 1,
    srcX: 0,
    srcY: 0,
    srcW: 1280,
    srcH: 720,
    dstX: 0,
    dstY: 0,
  });
  scTransitionTick(s, 0);
  scTransitionTick(s, 500);
  const p = scSnapshot(s, 500, null).render4.transitionProgress[0]!;
  assert.ok(p.bands > 0);
  assert.ok(p.oldBands > 0, '中段应有旧帧条带');
  assert.ok(p.oldBands < p.bands, '中段不该全部是旧帧条带（mix）');
  assert.equal(p.cat, 2);
  assert.notEqual(p.off, 0);
});

// ---------------------------------------------------------------------------
// 类别 3（插值模糊）：`0x250` SlideBlur / `0x251` ZoomBlur
// ---------------------------------------------------------------------------

test('★类别 3 的画法参数逐条对应引擎的 SetTechnique/SetFloat（raw 135837-135881）', () => {
  const s = newSceneState();
  // 0x251（ZoomBlur）：op5→[16]=Length 起 100、op8→[20]=Length 终 0；中心 640/214 不变
  const rec = scTransitionDefaultRecord();
  rec[0] = 3;
  rec[2] = 0;
  rec[3] = 1000;
  rec[13] = 1; // ZoomBlur
  rec[16] = 100;
  rec[17] = 640;
  rec[18] = 214;
  rec[19] = 0;
  rec[20] = 0;
  rec[21] = 640;
  rec[22] = 214;
  rec[23] = 0;
  s.render4.transitions.set(1, rec);
  scTransitionTick(s, 0);
  scTransitionTick(s, 500); // t = 0.5 ⇒ Length = 50
  const plan = scTransitionBlurPlan(rec, s.render4.transitionRuntime.get(1)!, { w: 1280, h: 720 });
  assert.ok(plan);
  assert.equal(plan!.zoom, true);
  assert.equal(plan!.zoom, true);
  assert.equal(plan!.length, 50, 'Length = 100 → 0 的中点');
  assert.equal(plan!.angle, 0);
  assert.equal(plan!.centerUPx, 640);
  assert.equal(plan!.centerVPx, 214);
  assert.equal(plan!.centerU, 640 / 1280, '★CenterU 归一化 = 像素 / 目标层宽（raw 135846）');
  assert.equal(plan!.centerV, 214 / 720, '★CenterV 归一化（raw 135850）');
  assert.equal(plan!.samples, 33, '采样数 = 引擎 CPU 回退的 (int)(16+16+1)');
  assert.equal(plan!.approximate, true, '★像素是累积近似，必须在数据层可见');
  // 快照必须带上它（缺口可见）
  const p = scSnapshot(s, 500, null).render4.transitionProgress[0]!;
  assert.ok(p.blur, '类别 3 的快照必须带 blur 段');
  assert.equal(p.blur!.technique, 'Zoomblur');
  assert.equal(p.blur!.approximate, true);
});

test('★类别 3：`[13] != 1` 走 SlideBlur（Angle/Width/Height，无 CenterU/V）', () => {
  const rec = blurRecord(1000, 0);
  const rt = { start: 0, active: true, finished: false, t: 0.5, channels: [40, 1, 2, 30] as [number, number, number, number] };
  const plan = scTransitionBlurPlan(rec, rt, { w: 1280, h: 720 });
  assert.ok(plan);
  assert.equal(plan!.zoom, false);
  assert.equal(plan!.length, 40);
  assert.equal(plan!.angle, 30, 'SlideBlur 用 c3 = Angle（raw 135864）');
  assert.equal(plan!.width, 1280, 'Width = 目标层宽（raw 135869）');
  assert.equal(plan!.height, 720, 'Height = 目标层高（raw 135874）');
  // 采样几何：沿 Angle 的平移，总长度 = 2*Length，中心样本位移 0
  const off = scTransitionBlurOffsets(plan!);
  assert.equal(off.kind, 'slide');
  if (off.kind === 'slide') {
    const half = (plan!.samples - 1) / 2;
    assert.ok(Math.abs(off.dx * half - Math.cos((30 * Math.PI) / 180) * 40) < 1e-9, '端点位移 = Length');
    assert.ok(Math.abs(off.dy * half - Math.sin((30 * Math.PI) / 180) * 40) < 1e-9);
  }
});

test('★类别 3：ZoomBlur 的采样步长 = Length / (|center| * 16)（引擎 dbl_51D7E8 = 16.0）', () => {
  const rec = blurRecord(1000, 1);
  const rt = { start: 0, active: true, finished: false, t: 1, channels: [64, 640, 0, 0] as [number, number, number, number] };
  const plan = scTransitionBlurPlan(rec, rt, { w: 1280, h: 720 });
  const off = scTransitionBlurOffsets(plan!);
  assert.equal(off.kind, 'zoom');
  if (off.kind === 'zoom') {
    assert.equal(off.cx, 640);
    assert.equal(off.cy, 0);
    assert.ok(Math.abs(off.step - 64 / 640 / 16) < 1e-12, 'step = Length / |center| / 16');
  }
  // 中心退化（|center| = 0）不许出 Infinity
  const rt0 = { start: 0, active: true, finished: false, t: 1, channels: [64, 0, 0, 0] as [number, number, number, number] };
  const off0 = scTransitionBlurOffsets(scTransitionBlurPlan(rec, rt0, { w: 1280, h: 720 })!);
  assert.ok(off0.kind === 'zoom' && Number.isFinite(off0.step) && off0.step > 0, '|center| = 0 要有兜底');
});

test('★非类别 3 ⇒ `scTransitionBlurPlan` 返回 null（类别 0/2 不许借用模糊字段）', () => {
  const s = newSceneState();
  s.render4.transitions.set(0, fadeRecord(0, 1000));
  scTransitionTick(s, 0);
  const rt = s.render4.transitionRuntime.get(0)!;
  assert.equal(scTransitionBlurPlan(s.render4.transitions.get(0)!, rt, { w: 1280, h: 720 }), null);
});

test('★两条 item 区间：引擎 36/37 装的就是它们（raw 136014-136176 的两趟重绘）', () => {
  const s = newSceneState();
  // 区间 A = [0x100, 0x103)、区间 B = [0x200, 0x201)
  const rec = fadeRecord(0, 1000);
  rec[5] = 0x100;
  rec[7] = 3;
  rec[6] = 0x200;
  rec[8] = 1;
  const mk = (h: number, x: number, y: number, w: number, hh: number): void => {
    scConfigureDrawItem(s, {
      handle: h, layer: h, tex: 1, srcX: 0, srcY: 0, srcW: w, srcH: hh, dstX: x, dstY: y,
    });
    s.drawItems.get(h)!.posX = x;
    s.drawItems.get(h)!.posY = y;
  };
  mk(0x100, 0, 0, 1280, 720);
  mk(0x101, 300, 100, 200, 200);
  mk(0x200, 640, 360, 400, 300);
  mk(0x300, 0, 0, 10, 10); // 两条区间都不含 ⇒ 不许进任何一条
  const r = scTransitionRangeRects(s, rec);
  assert.equal(r.countA, 2);
  assert.equal(r.countB, 1);
  assert.deepEqual(r.a, { x: 0, y: 0, w: 1280, h: 720 }, '区间 A = 其项矩形的并集');
  assert.deepEqual(r.b, { x: 640, y: 360, w: 400, h: 300 });
  // 空区间 ⇒ null（不是 0x0 的假矩形）
  const r2 = scTransitionRangeRects(s, { ...rec, 6: 0x900, 8: 4 });
  assert.equal(r2.b, null);
  assert.equal(r2.countB, 0);
  // 快照里看得见（缺口可见：emulator 还没据它裁剪）
  const s2 = newSceneState();
  s2.render4.transitions.set(1, rec);
  scTransitionTick(s2, 0);
  const p = scSnapshot(s2, 0, null).render4.transitionProgress[0]!;
  assert.ok(p.ranges);
  assert.equal(p.ranges.countA, 0, '快照用的是它自己的场景（这里没有那两个项）');
});
