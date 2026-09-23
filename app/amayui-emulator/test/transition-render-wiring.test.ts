/** @tier T0 @kind core @subsystem transition */

/**
 * **转场的"指令 → 记录 → 窗口 → 离屏合成"整条链** —— `tickets/T-0084`。
 *
 * 两份守卫：
 *
 * ① **整合**：用**真 handler**（`0x223`/`0x24F`/`0x250`/`0x251`）写记录，交给共享窗口推进器
 *    `scTransitionTick`，再断言"记录 → 运行期窗 → 快照"这条链真的接上了
 *    （而不是只有手搓记录的单测通过）。
 *
 * ② **源码棘轮**（本工程对 canvas 路径的既有做法，见 `draw-string.test.ts`：像素本身只能在
 *    Electron 里验）：把"哪一层画什么"钉在源码上 —— 引擎的 `[4]` 是**离屏槽**不是屏幕，
 *    所以宿主必须走 `composeIntoSlot`；类别 1/3 必须**显式跳过**（不许假装画了）；
 *    转场活动帧不许被"留帧"早退（否则只画一帧）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr } from './harness.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scSnapshot } from '../src/renderer/scene/snapshot.js';
import {
  scTransitionRangeHandles,
  scTransitionTick,
  scTransitionsPending,
} from '../src/renderer/scene/transition.js';
import { Container, Sprite, Texture } from 'pixi.js';
import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scConfigureDrawItem, scTransitionDefaultRecord } from '../src/renderer/scene/ops.js';
import { VIEW_H, VIEW_W } from '../src/renderer/viewport.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMU = path.join(HERE, '..');

function run(native: HeadlessScene, op: number, args: BinArg[]): void {
  const e = new Engine(native);
  const f = new Frame();
  const h = OPS.get(op) ?? NATIVE_OPS.get(op);
  assert.ok(h, `0x${op.toString(16)} 未注册`);
  h!(makeCtx(e, f, instr(op, args), native, () => {}));
}

test('★整合：四条写端 → 记录 → `scTransitionTick` → 快照（类别 0/2/3 都接得上）', () => {
  const native = new HeadlessScene({});
  // 类别 0（0x223）：op1=键、op2=目标层、op3/4、op5/6 区间、op7=延迟、op8=时长
  run(native, 0x223, [im(9), im(3), im(0x100), im(1), im(0x200), im(1), im(0), im(600)]);
  // 类别 2（0x24F）：op1=键、op2=目标层、op3/4 区间、op5/6、op7=类型、op8=条宽、op9/10=延迟/时长
  run(native, 0x24f, [im(0xa), im(4), im(3), im(1), im(5), im(6), im(0), im(8), im(0), im(500)]);
  // 类别 3（0x250）：SlideBlur
  run(native, 0x250, [im(0xb), im(5), im(1), im(1), im(2), im(4), im(6), im(0), im(0), im(400)]);
  assert.equal(native.scene.render4.transitions.size, 3);

  scTransitionTick(native.scene, 1000);
  assert.equal(scTransitionsPending(native.scene), true);
  scTransitionTick(native.scene, 1200); // 300ms 后
  const snap = scSnapshot(native.scene, 1200, null);
  const byId = new Map(snap.render4.transitionProgress.map((p) => [p.id, p]));
  assert.equal(byId.get(9)!.cat, 0);
  assert.equal(byId.get(9)!.active, true);
  assert.equal(byId.get(9)!.t, 200 / 600, '类别 0 的 t = (clock - start) / dur');
  assert.equal(byId.get(9)!.targetSlot, 3);
  assert.equal(byId.get(0xa)!.cat, 2);
  assert.equal(byId.get(0xa)!.targetSlot, 4);
  assert.equal(byId.get(0xb)!.cat, 3);
  // `0x250`：op5→[16]=2、op6→[19]=4、op7→[20]=6、op8→[23]=0 ⇒ t=0.5 时 c0=(6-2)/2+2=4、c3=(0-4)/2+4=2
  assert.deepEqual(byId.get(0xb)!.channels, [4, 0, 0, 2], '类别 3 的 c0/c3 = 插值后的 Length/Angle');
  // 记录表仍是写端原样（运行期值不落回去）
  assert.equal(native.scene.render4.transitions.get(9)![1], 0);
  assert.equal(native.scene.render4.transitions.get(9)![3], 600);
});

test('★整合：三条各自到点后整张表被清空（引擎 raw 136840-136841）', () => {
  const native = new HeadlessScene({});
  run(native, 0x223, [im(9), im(3), im(0x100), im(1), im(0x200), im(1), im(0), im(300)]);
  run(native, 0x24f, [im(0xa), im(4), im(3), im(1), im(5), im(6), im(0), im(8), im(0), im(300)]);
  run(native, 0x251, [im(0xb), im(5), im(1), im(1), im(2), im(3), im(4), im(5), im(6), im(0), im(0), im(300)]);
  scTransitionTick(native.scene, 0);
  assert.equal(native.scene.render4.transitions.size, 3, '起点锁存那一帧仍活动');
  const r = scTransitionTick(native.scene, 300);
  assert.equal(r.cleared, true);
  assert.equal(native.scene.render4.transitions.size, 0);
  assert.equal(scTransitionsPending(native.scene), false);
});

test('★源码棘轮：`[4]` 是**离屏槽**，宿主必须 composeIntoSlot（不许画在屏幕上）', () => {
  const backend = fs.readFileSync(path.join(EMU, 'src', 'renderer', 'pixiBackend.ts'), 'utf8');
  assert.ok(
    /composeIntoSlot\(slot,/.test(backend),
    '宿主必须把转场结果画进记录 `[4]` 那个槽（引擎 sub_4A50C0(_this, v384[4])，raw 136174）',
  );
  assert.ok(
    backend.includes('类别 1') && backend.includes('U2'),
    '类别 1（分块淡入淡出）必须在注释里写明"为什么不画"（语料 0 处 + 可见效果未确证）',
  );
  assert.ok(
    /cat !== 0 && cat !== 2 && cat !== 3/.test(backend) && /continue;/.test(backend),
    '类别 1 必须**显式跳过**，不许静默假装画了',
  );
  // ★类别 3 必须**有真消费者**（不是只把参数算进快照）：累积模糊 + 引擎的中心权重常数
  assert.ok(
    backend.includes('scTransitionBlurPlan') && backend.includes('scTransitionBlurOffsets'),
    '类别 3 必须真的画（按 scTransitionBlurPlan 的采样几何做累积模糊）',
  );
  assert.ok(
    /TRANSITION_BLUR_CENTER_WEIGHT/.test(backend),
    '中心样本权重必须用引擎的常数 3（raw 126180-126183 的 `v34 = v65 == v33 ? 3 : 1`）',
  );
  // ★转场窗必须在 advanceModel 里推进（每帧一次，位于本帧 VM 步进之后、present 之前）
  const adv = backend.slice(backend.indexOf('advanceModel(nowMs: number)'), backend.indexOf('advanceModel(nowMs: number)') + 2000);
  assert.ok(adv.includes('scTransitionTick'), 'advanceModel 必须推进转场窗');
  // ★类别 0/2 的源必须是「记录那两条 item 区间的离屏子集」（引擎 36/37 = 那两组项）
  assert.ok(
    backend.includes('scTransitionRangeHandles') && backend.includes('#renderRangeCanvas'),
    '类别 0/2 必须用 renderItemSubset 现渲染那两条区间当源（引擎 36/37 就是它们，raw 136014-136176）',
  );
  assert.ok(
    !backend.includes('#transOld'),
    '★"上一帧整屏快照"那套概念必须已经删掉（转场的源是子集，不是整屏）',
  );
  assert.ok(
    backend.includes('renderItemSubset'),
    '子集渲染必须复用 presenter 的同一份画法（renderItemSubset）',
  );
  // 转场活动帧不许被留帧早退
  assert.ok(
    /#holdFrames > 0 && !transPending/.test(backend),
    '转场活动帧必须绕过 `#holdFrames` 早退，否则条带/淡入淡出只画一帧',
  );
  const headless = fs.readFileSync(path.join(EMU, 'src', 'renderer', 'headlessScene.ts'), 'utf8');
  assert.ok(headless.includes('scTransitionTick(this.scene, nowMs)'), 'headless 宿主必须推进同一个转场窗');
  // ★`T-0091`：两个宿主都必须把 G1（`freeze` = `Scene+46512`）与 G2（`poolPending` = 全场景
  //   `Scene+46516` 探针）一起传下去。headless 侧有行为级守卫（`test/wait-gate-timer.test.ts` 的
  //   "驱动级"一例 + `test/sc-transition-window.test.ts` 的 G2 一例），pixi 侧只能在源码上钉住。
  assert.ok(
    /scTransitionTick\(this\.scene, nowMs, freeze, \(\) => this\.poolPending\(\)\)/.test(headless),
    '★G1/G2：headless 必须转发 freeze + 池挂起探针',
  );
  assert.ok(
    /scTransitionTick\(this\.scene, nowMs, freeze, \(\) => this\.poolPending\(\)\)/.test(backend),
    '★G1/G2：pixi 必须转发 freeze + 池挂起探针（与 headless 同一份形参）',
  );
  assert.ok(
    /scAdvance\(this\.scene, nowMs, freeze\)/.test(backend),
    '★G1：pixi 的模型推进必须把 freeze 传给 scAdvance（否则冻结到不了窗模型）',
  );
  const cache = fs.readFileSync(path.join(EMU, 'src', 'renderer', 'pixi', 'textureCache.ts'), 'utf8');
  assert.ok(cache.includes('composeIntoSlot('), 'TextureCache 必须提供"把 2D 合成画进槽表面"的入口');
});

test('★源码棘轮：`render4.transitionRuntime` 只被 `scene/transition.ts` / `scClearTransitions` 改', () => {
  const files = [
    path.join(EMU, 'src', 'renderer', 'scene', 'ops.ts'),
    path.join(EMU, 'src', 'renderer', 'scene', 'state.ts'),
    path.join(EMU, 'src', 'renderer', 'scene', 'transition.ts'),
    path.join(EMU, 'src', 'renderer', 'scene', 'snapshot.ts'),
    path.join(EMU, 'src', 'renderer', 'pixiBackend.ts'),
    path.join(EMU, 'src', 'renderer', 'headlessScene.ts'),
  ];
  const writers: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // 写入点：`.set(` / `.clear()` / `= new Map`
    if (/transitionRuntime\.(set|clear)\(/.test(src) || /transitionRuntime[^\n]*new Map/.test(src)) {
      writers.push(path.basename(f));
    }
  }
  assert.deepEqual(
    writers.sort(),
    ['ops.ts', 'state.ts', 'transition.ts'],
    '运行期表只该由 state（初值）/ transition（推进）/ ops（0x224 清表）三处碰',
  );
});

test('★子集离屏合成：`renderItemSubset` 只画选中的项（引擎 36/37 = 记录那两条区间）', () => {
  const root = new Container();
  const cache = new TextureCache(() => {});
  // ★夹具必须**把槽绑上图**（`tickets/T-0102` 轮 20）：引擎里 `set-texture` 是**同步**的，
  //   所以"能画出来的项"该槽一定有纹理对象；而"槽没有纹理对象"的场合引擎**整笔不画**
  //   （`DrawTexture` 报错 + return 0，raw 122952-122963）⇒ emulator 也照此跳过，
  //   **不再**用 1×1 白占位块顶上。夹具原来靠占位块"画得出来"，那是假象。
  cache.slotTex.set(1, Texture.WHITE);
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, VIEW_W, VIEW_H);
  const scene = newSceneState();
  const mk = (h: number, layer: number, x: number, y: number, w: number, hh: number): void => {
    scConfigureDrawItem(scene, {
      handle: h, layer, tex: 1, srcX: 0, srcY: 0, srcW: w, srcH: hh, dstX: x, dstY: y,
    });
  };
  mk(0x100, 101000, 10, 20, 300, 200);
  mk(0x101, 101001, 40, 60, 100, 100);
  mk(0x200, 102000, 700, 400, 400, 300);
  mk(0x300, 103000, 0, 0, 50, 50);

  // 区间 A = [0x100, 0x103)、区间 B = [0x200, 0x201)
  const rec = scTransitionDefaultRecord();
  rec[5] = 0x100;
  rec[7] = 3;
  rec[6] = 0x200;
  rec[8] = 1;
  const handles = scTransitionRangeHandles(scene, rec);
  assert.deepEqual([...handles.a].sort((a, b) => a - b), [0x100, 0x101]);
  assert.deepEqual([...handles.b], [0x200], '区间外的 0x300 不许进任何一条');

  const into = new Container();
  const n = presenter.renderItemSubset(scene, 0, handles.a, into);
  assert.equal(n, 2, '区间 A 的两项都要画出来');
  assert.equal(into.children.length, 2);
  // 层序：按 layer 升序（0x100 在前）
  const xs = into.children.map((c) => (c as Sprite).position.x);
  assert.deepEqual(xs, [10, 40], '按 layer 升序画（且位置与项一致）');

  // 空集合 ⇒ 一个都不画（引擎那层就是 Clear 后的透明）
  const empty = new Container();
  assert.equal(presenter.renderItemSubset(scene, 0, new Set(), empty), 0);
  assert.equal(empty.children.length, 0);

  // ★同一份画法：主合成里的项数 = 全部可绘制项（4 项，槽 1 已绑图 ⇒ 都画得出来）
  presenter.present(scene, 0, 0);
  assert.equal(root.children.length, 4, '主合成仍画全部 4 项 ⇒ 子集渲染没有改动主路径');
});

test('★★写端 → 记录格 → 区间选择：`i223` 的 op3/op4/op5/op6 正好喂给那两条区间', () => {
  // 这是"引擎 36/37 到底是什么"这条结论的**端到端**棘轮：写端的哪一个操作数进哪一格、
  // 读端（`scTransitionRangeHandles`）按哪一格选项 —— 任一侧漂了这条就红。
  // 语料形态：`i223 (local-int 0) (local-ptr 2) (local-int 3) 1 (local-ptr 4) 1 (global-int f8042) (global-int f8043)`
  const native = new HeadlessScene({});
  const e = new Engine(native);
  const f = new Frame();
  const h = OPS.get(0x223) ?? NATIVE_OPS.get(0x223);
  assert.ok(h);
  h!(makeCtx(e, f, instr(0x223, [im(9), im(3), im(0x100), im(1), im(0x200), im(1), im(0), im(500)]), native, () => {}));
  const rec = native.scene.render4.transitions.get(9);
  assert.ok(rec);
  assert.equal(rec![5], 0x100, 'op3（a4）→ 区间 A 起点 = [5]');
  assert.equal(rec![7], 1, 'op4（a5）→ 区间 A 跨度 = [7]');
  assert.equal(rec![6], 0x200, 'op5（a6）→ 区间 B 起点 = [6]');
  assert.equal(rec![8], 1, 'op6（a7）→ 区间 B 跨度 = [8]');
  const mk = (handle: number): void => {
    scConfigureDrawItem(native.scene, {
      handle, layer: handle, tex: 1, srcX: 0, srcY: 0, srcW: 1280, srcH: 720, dstX: 0, dstY: 0,
    });
  };
  mk(0x100);
  mk(0x200);
  mk(0x999); // 区间外
  const hs = scTransitionRangeHandles(native.scene, rec!);
  assert.deepEqual([...hs.a], [0x100], '区间 A 只命中它自己');
  assert.deepEqual([...hs.b], [0x200], '区间 B 只命中它自己');
  // 快照（报告/回归）里也看得见
  scTransitionTick(native.scene, 0);
  const p = scSnapshot(native.scene, 0, null).render4.transitionProgress[0]!;
  assert.deepEqual(p.ranges, {
    a: { x: 0, y: 0, w: 1280, h: 720 },
    b: { x: 0, y: 0, w: 1280, h: 720 },
    countA: 1,
    countB: 1,
  });
});
