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
import { scTransitionsPending, scTransitionTick } from '../src/renderer/scene/transition.js';

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
  // 旧帧抓取必须发生在 advanceModel（present 之前），否则拿到的不是"上一帧"
  const adv = backend.slice(backend.indexOf('advanceModel(nowMs: number)'), backend.indexOf('advanceModel(nowMs: number)') + 2000);
  assert.ok(adv.includes('scTransitionTick'), 'advanceModel 必须推进转场窗');
  assert.ok(adv.includes('#captureStageCanvas'), 'advanceModel 必须抓「旧帧」（即上一帧合成结果）');
  // 转场活动帧不许被留帧早退
  assert.ok(
    /#holdFrames > 0 && !transPending/.test(backend),
    '转场活动帧必须绕过 `#holdFrames` 早退，否则条带/淡入淡出只画一帧',
  );
  const headless = fs.readFileSync(path.join(EMU, 'src', 'renderer', 'headlessScene.ts'), 'utf8');
  assert.ok(headless.includes('scTransitionTick(this.scene, nowMs)'), 'headless 宿主必须推进同一个转场窗');
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
