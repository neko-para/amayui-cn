/** @tier T0 @kind core @subsystem render */

/**
 * 守卫：**`Item.flags` bit2 = B 层（周期/循环动画层）** —— opcode `0x230`–`0x235` + `0x244`。
 *
 * 引擎唯一权威 = `engine/天结_unpacked.exe_utf8.c`（raw 行号）：
 *  - bit2 的**唯一读取点** = 渲染器 `sub_4AEEA0` raw 133390（`(flags & 4) == 0 ⇒ 跳过整层`）；
 *    命中时 raw 133395 强制"世界矩阵有效"（`Scene+46532 = 1`）；
 *  - 5 条通道的**求值器** = `sub_49BCC0`（raw 117944-118365），每通道各自 `if (周期 > 0)`；
 *  - 写入端 = `sub_4AD580`(0x230) / `sub_4AD690`(0x231) / `sub_4AD730`(0x232) /
 *    `sub_4AD7B0`(0x233) / `sub_4AD850`(0x234) / `sub_4AD900`(0x235)；
 *  - `0x244` = `sub_4AD9F0(Scene, 2)`（raw 132364-132503）：把 `flags & 2` 的**绘制项** `+52`
 *    （= `Item.animStart`）清 0。
 *
 * 规格文档：`docs-new/99-records/2026-09-b3/b3-bit2-model-spec-2026-09.md`。
 * ★本测试的 `0x234` 用例带**订正**：该条是**匀速旋转**（不是旧注/筛体文档写的"平移窗"）——
 *   依据 = raw 118225-118228 用 `+532/+552/+580/584/588` 做 `D3DXMatrixRotationAxis`，
 *   而平移往复用的是 `+536/+556/+656`（写它的是 `0x235`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scAnimationsPending, scPoolPending, sceneNeedsRender } from '../src/renderer/sceneModel.js';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative, assertFlags, type DrawItemLoopRequest } from '../src/vm/native.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { enc } from '../src/vm/bits.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import {
  ITEM_FLAG_ANIM_LOOP,
  ITEM_FLAG_ANIM_WIN,
  advanceWindows,
  applyDrawColor,
  applyFlipbook,
  applyScaleAnim,
  itemAnimationsPending,
  itemColor,
  itemLoopAnimationsPending,
  itemRotationRad,
  itemScale,
  itemSrcRect,
  itemTranslation,
  itemUsesWorld,
  loopTriangle,
  makeItem,
  type Item,
} from '../src/renderer/drawItem.js';
import { scriptDerived } from './harness.js';

const H = 0x18a9c;
/** 虚拟时钟起点（非 0：`start === 0` 是"未锁存"哨兵）。 */
const T0 = 1000;

/** 一个绘制项：源 16×16 @(32,48)、目标 (400,300)。 */
function newItem(): Item {
  return makeItem({ handle: H, layer: H, tex: 7, srcX: 32, srcY: 48, srcW: 16, srcH: 16, dstX: 400, dstY: 300 });
}

/** headless 宿主 + 一个已 draw-texture 的绘制项（一切写入都走真实 `sc*` 共享层）。 */
function scene(): { s: HeadlessScene; it: Item } {
  const s = new HeadlessScene({});
  s.configureDrawItem({ handle: H, layer: H, tex: 7, srcX: 32, srcY: 48, srcW: 16, srcH: 16, dstX: 400, dstY: 300 });
  const it = s.scene.drawItems.get(H);
  assert.ok(it, 'draw-texture 应建出项');
  return { s, it };
}

const near = (a: number, e: number, msg: string) => assert.ok(Math.abs(a - e) < 1e-6, `${msg}: got ${a}, want ${e}`);

/** 一帧的 5 通道求值（顺序与宿主 present 一致：先推进窗，再取结果）。 */
function frame(it: Item, clock: number) {
  advanceWindows(it, clock);
  return {
    color: itemColor(it, clock),
    scale: itemScale(it, clock),
    rotRad: itemRotationRad(it, clock),
    trans: itemTranslation(it, clock),
    src: itemSrcRect(it, clock),
    animWinPending: itemAnimationsPending(it, clock),
    loopPending: itemLoopAnimationsPending(it),
  };
}

// ---------------------------------------------------------------------------
// 1) 最强断言：同 handle 同 clock，`0x235` 后 ≠ 中性；紧跟 `0x230` 后 == 中性
// ---------------------------------------------------------------------------

test('★开关对称（最强断言）：0x235 后同 clock 求值 ≠ 中性；紧跟 0x230 后 == 中性且 bit2 清零', () => {
  const { s, it } = scene();
  s.setDrawItemLoop({ op: 'translate', handle: H, period: 50, tx: 0, ty: 10, tz: 0 }); // i235 h 50 0 a 0
  assert.equal(it.flags & ITEM_FLAG_ANIM_LOOP, ITEM_FLAG_ANIM_LOOP, '0x235 置 bit2（raw 132330）');
  assert.equal(it.loops[3]!.period, 50, 'op2 → +556 周期（raw 132335）');
  assert.equal(it.loops[3]!.start, 0, '+536 起点槽清零（raw 132331）');
  near(it.loopTrans.y, 10, 'op4（float，不除）→ +656');

  itemTranslation(it, T0); // 首帧锁存 start = T0（raw 118236-118237）
  assert.equal(it.loops[3]!.start, T0, '起点槽锁存 now');
  const moved = itemTranslation(it, T0 + 12);
  assert.notEqual(moved.y, 0, `0x235 之后必须离开中性位（got y=${moved.y}）`);
  near(moved.y, 4.8, '三角波 2·12/50·10');

  // 同 clock 下立刻关：i230（0x230）
  s.setDrawItemLoop({ op: 'reset', handle: H });
  assert.equal(it.flags & ITEM_FLAG_ANIM_LOOP, 0, '0x230 清 bit2（raw 132173）');
  assert.equal(itemTranslation(it, T0 + 12).y, 0, '★同 clock 求值必须回到中性（bit2 真被读）');
  assert.equal(itemTranslation(it, T0 + 12).y, 0, '再问一次仍是中性（5 个周期已清零）');
  // 周期清零可直接观察（引擎 raw 132174-132215 写 {540,544,548,552,556,560}）
  for (const l of it.loops) assert.equal(l.period, 0, '全部 B 层周期被清 0');
  assert.equal(it.loops[4]!.start, 0, '+540（flipbook 起点）也被清');
});

// ---------------------------------------------------------------------------
// 2) 三角波数值（周期 50 / 幅度 10）
// ---------------------------------------------------------------------------

test('平移往复（0x235）三角波：0 → 4.8(12ms) → 10(25ms 顶点) → 0(50ms 回零)', () => {
  const it = newItem();
  it.flags |= ITEM_FLAG_ANIM_LOOP;
  it.loops[3] = { start: T0, period: 50 };
  it.loopTrans = { x: 0, y: 10, z: 0 };

  near(itemTranslation(it, T0).y, 0, '相位 0 ⇒ 0');
  near(itemTranslation(it, T0 + 12).y, 4.8, '2·12/50·10');
  near(itemTranslation(it, T0 + 25).y, 10, '顶点（period/2）');
  near(itemTranslation(it, T0 + 37).y, 5.2, '下降半程 2·(50−37)/50·10');
  near(itemTranslation(it, T0 + 50).y, 0, '一个周期后回零（往复，不是锯齿）');

  // 三角波原语本身（整数 `period/2` 除法，raw 118107-118111）
  assert.equal(loopTriangle(0, 50), 0);
  assert.equal(loopTriangle(12, 50), 24);
  assert.equal(loopTriangle(25, 50), 50);
  assert.equal(loopTriangle(49, 50), 2);
});

// ---------------------------------------------------------------------------
// 3) 贴图换格循环（0x231）：250ms ⇒ 第 2 列；1650ms ⇒ 回第 0 格
// ---------------------------------------------------------------------------

test('贴图换格循环（0x231）：period=100/frames=16/cols=4 ⇒ 250ms 第 2 列、1650ms 回 0（证明是循环）', () => {
  const { s, it } = scene();
  s.setDrawItemLoop({ op: 'flipbook', handle: H, period: 100, frames: 16, cols: 4 });
  assert.equal(it.fbFrames, 16, 'op3 → +568（raw 132234）');
  assert.equal(it.fbCols, 4, 'op4 → +572（raw 132236）');
  assert.equal(it.loops[4]!.period, 100, 'op2 → +560（raw 132232）');
  assert.equal(it.loops[4]!.start, 0, '+540 起点槽清零（raw 132230）');

  itemSrcRect(it, T0); // 锁存 start = T0
  assert.deepEqual(itemSrcRect(it, T0 + 250), { x: 64, y: 48, w: 16, h: 16 }, 'frame=2 ⇒ col=2,row=0');
  assert.deepEqual(itemSrcRect(it, T0 + 450), { x: 32, y: 64, w: 16, h: 16 }, 'frame=4 ⇒ col=0,row=1');
  assert.deepEqual(itemSrcRect(it, T0 + 1650), { x: 32, y: 48, w: 16, h: 16 }, 'frame=16%16=0 ⇒ 回第一格（循环）');
});

// ---------------------------------------------------------------------------
// 4) A 层（0x239）零回归 + 两层共用的 +568/+572 各走各的分支
// ---------------------------------------------------------------------------

test('A 层 0x239 零回归：未挂 bit2 的项求值逐项不变；两层共用格时各走各的分支', () => {
  // 纯 A 层：与 draw-item-anim-window.test.ts 的既有断言同值
  const a = newItem();
  applyFlipbook(a, 0, 300, 6, 3, 1);
  advanceWindows(a, T0);
  assert.deepEqual(itemSrcRect(a, T0 + 150), { x: 32, y: 64, w: 16, h: 16 }, 'A 层 t=0.5 ⇒ frame=3 ⇒ row1col0');
  assert.deepEqual(itemSrcRect(a, T0 + 400), { x: 64, y: 64, w: 16, h: 16 }, 'A 层末帧保持（fbFlags bit0）');
  assert.equal(a.flags & ITEM_FLAG_ANIM_LOOP, 0, 'A 层不置 bit2');

  // 两层共用 `+568/+572`：引擎在 A 层结果之上**再叠加** B 层偏移（raw 118354/118357 改的是同一份 rect）
  const b = newItem();
  applyFlipbook(b, 0, 300, 6, 3, 1); // 共用格：frames=6, cols=3
  b.flags |= ITEM_FLAG_ANIM_LOOP;
  b.loops[4] = { start: T0, period: 100 };
  advanceWindows(b, T0);
  assert.deepEqual(
    itemSrcRect(b, T0 + 150),
    { x: 48, y: 64, w: 16, h: 16 },
    'A 层 frame=3(row1,col0) ⇒ (32,64)；B 层 frame=1(col1) ⇒ x+16',
  );
});

// ---------------------------------------------------------------------------
// 5) 颜色 / 缩放 / 旋转通道 + 负值回退
// ---------------------------------------------------------------------------

test('颜色往复（0x232）：op3=alpha、op4=rgb；负值回退当前色；>255 夹 255；整数插值', () => {
  // 负值回退：alpha/rgb 都取当前色 +96（`sub_4ADD60` raw 132583-132587）
  const { s, it } = scene();
  s.setDrawColorAlpha(H, 0x80112233);
  s.setDrawItemLoop({ op: 'color', handle: H, period: 100, alpha: -1, rgb: -1 });
  assert.equal(it.loopTo >>> 0, 0x80112233, '负值 ⇒ 当前色');
  assert.equal(it.loops[0]!.period, 100, 'op2 → +544（raw 132253）');
  assert.equal(it.loops[0]!.start, 0, '+524 起点槽清零（raw 132251）');

  // 真插值：from=白 → 目标=黑，周期 100 ⇒ 顶点全黑、半程 0x7f7f7f7f（整数除法 raw 118116-118129）
  const t2 = scene();
  t2.s.setDrawColorAlpha(H, 0xffffffff);
  t2.s.setDrawItemLoop({ op: 'color', handle: H, period: 100, alpha: 0, rgb: 0x000000 });
  assert.equal(t2.it.loopTo >>> 0, 0x00000000, 'alpha 0 + rgb 0');
  assert.equal(itemColor(t2.it, T0) >>> 0, 0xffffffff, '相位 0 ⇒ 基线 from');
  assert.equal(itemColor(t2.it, T0 + 25) >>> 0, 0x7f7f7f7f, '三角半程： (50·0 + 50·255)/100 = 127');
  assert.equal(itemColor(t2.it, T0 + 50) >>> 0, 0x00000000, '顶点 ⇒ 目标色');
  assert.equal(itemColor(t2.it, T0 + 100) >>> 0, 0xffffffff, '一个周期后回基线');

  // >255 夹 255（raw 32152-32155）
  const t3 = scene();
  t3.s.setDrawItemLoop({ op: 'color', handle: H, period: 100, alpha: 999, rgb: 0x000000 });
  assert.equal(t3.it.loopTo >>> 0, 0xff000000, 'alpha > 255 ⇒ 255');
});

test('缩放往复（0x233）：÷100 写 +592；求值 = lerp(1, 目标, 三角比)', () => {
  const { s, it } = scene();
  s.setDrawItemLoop({ op: 'scale', handle: H, period: 100, sx: 1.1, sy: 1.1, sz: 1 });
  near(it.loopScale.x, 1.1, 'op3 ÷100（raw 32176）');
  assert.equal(it.loops[1]!.period, 100, 'op2 → +548（raw 132279）');
  itemScale(it, T0);
  near(itemScale(it, T0 + 25).x, 1.05, '三角半程');
  near(itemScale(it, T0 + 50).x, 1.1, '顶点 = 目标');
  near(itemScale(it, T0 + 75).x, 1.05, '回落');
  near(itemScale(it, T0 + 25).z, 1, 'z 不变（目标 1）');
});

test('匀速旋转（0x234，★订正：是旋转，不是平移窗）：period=360 ⇒ 每周期一圈', () => {
  const { s, it } = scene();
  s.setDrawItemLoop({ op: 'rotate', handle: H, period: 360, ax: 0, ay: 0, az: 1 });
  near(it.loopAxis.z, 1, 'op5（float，不除）→ +588');
  assert.equal(it.loops[2]!.period, 360, '+552（raw 132306）');
  assert.equal(it.loops[2]!.start, 0, '+532 起点槽清零（raw 132302）');
  itemRotationRad(it, T0);
  near(itemRotationRad(it, T0 + 90), Math.PI / 2, '90ms ⇒ 90°（360°/周期，锯齿）');
  near(itemRotationRad(it, T0 + 270), (3 * Math.PI) / 2, '270ms ⇒ 270°');
  near(itemRotationRad(it, T0 + 360), 0, '下一周期归零');

  // 轴 z 的符号 = 二维方向（披露的近似，见 `loopRotationDeg` 注释）
  const r2 = scene();
  r2.s.setDrawItemLoop({ op: 'rotate', handle: H, period: 360, ax: 0, ay: 0, az: -1 });
  itemRotationRad(r2.it, T0);
  near(itemRotationRad(r2.it, T0 + 90), -Math.PI / 2, '轴 z < 0 ⇒ 反向');
});

// ---------------------------------------------------------------------------
// 6) 不卡帧：bit2 不进 `itemAnimationsPending`（等待门），但进合成判据
// ---------------------------------------------------------------------------

test('bit2 不进 A 层 pending（等待门不受影响），但合成判据必须持续为真', () => {
  const { s, it } = scene();
  s.snapshot(); // 消费脏位
  s.setDrawItemLoop({ op: 'translate', handle: H, period: 50, tx: 0, ty: 10, tz: 0 });

  assert.equal(itemAnimationsPending(it, T0), false, '★B 层绝不进 `itemAnimationsPending`（否则引入引擎没有的死等）');
  assert.equal(itemLoopAnimationsPending(it), true, '但"还有循环在动"是合成判据的一半');
  assert.equal(scAnimationsPending(s.scene, T0), true, '合成不能停，否则只有一个静止初相');
  assert.equal(scPoolPending(s.scene, T0), false, '★等待门（Scene+46516）不受 bit2 影响');
  assert.equal(sceneNeedsRender(s.scene, T0, s.scene.dirty), true, '这一帧要合成');

  s.setDrawItemLoop({ op: 'reset', handle: H });
  assert.equal(itemLoopAnimationsPending(it), false, '关掉之后循环判据转假');
  assert.equal(scAnimationsPending(s.scene, T0), false, '没有动画、且脏位已被上一步消费 ⇒ 可停');
  assert.equal(scPoolPending(s.scene, T0), false, '等待门始终不受影响');
});

// ---------------------------------------------------------------------------
// 7) flag 白名单 / 建项语义 / 0x244 / useWorld / 注册与 no-op 表的排他性
// ---------------------------------------------------------------------------

test('KNOWN_DRAW_ITEM_FLAGS 已扩到 0b111：置 bit2 的项过 assertFlags 不抛', () => {
  const { s, it } = scene();
  s.setDrawItemLoop({ op: 'flipbook', handle: H, period: 100, frames: 16, cols: 4 });
  assert.equal(it.flags & ITEM_FLAG_ANIM_LOOP, ITEM_FLAG_ANIM_LOOP);
  assert.doesNotThrow(() => assertFlags('drawitem', H, it.flags), 'bit2 必须已在白名单里');
  assert.throws(
    () => assertFlags('drawitem', H, 0b1000),
    /unknown drawitem flag/,
    '未解码的 bit3 仍须硬中断（严格校验不放宽）',
  );
});

test('建项语义：从未 draw-texture 过的 handle 调 0x231/0x235 ⇒ 建出不可见项、不报错', () => {
  const s = new HeadlessScene({});
  s.setDrawItemLoop({ op: 'flipbook', handle: 0x777, period: 100, frames: 4, cols: 2 });
  const it = s.scene.drawItems.get(0x777);
  assert.ok(it, '缺项即建项（引擎 sub_4AAA50）');
  assert.equal(it.flags & 1, 0, 'bit0 未置 ⇒ 不可见（渲染门 raw 133361）');
  assert.equal(it.flags & ITEM_FLAG_ANIM_LOOP, ITEM_FLAG_ANIM_LOOP, '动画照样配上（六条 setter 都无 bit0 门控）');

  s.setDrawItemLoop({ op: 'translate', handle: 0x778, period: 50, tx: 0, ty: 10, tz: 0 });
  assert.equal(s.scene.drawItems.get(0x778)!.flags & 1, 0, '0x235 同样建出不可见项');
  assert.equal(scAnimationsPending(s.scene, T0), true, '不可见的循环项仍让帧驱动继续（引擎每帧都求值）');
});

test('0x244：把 flags&2 的绘制项的 animStart 清 0（A 层窗起点 ⇒ 重新计时）', () => {
  const { s, it } = scene();
  applyScaleAnim(it, 0, 1000, 2, 2, 2);
  advanceWindows(it, T0);
  assert.equal(it.animStart, T0, 'A 层窗起点已锁存');
  const n = s.clearDrawItemAnimStarts(2);
  assert.equal(n, 1, '命中 1 项（flags & 2）');
  assert.equal(it.animStart, 0, 'raw 132403：`*(elem + 52) = 0`');
  frame(it, T0 + 500);
  assert.equal(it.animStart, T0 + 500, '下一帧重新锁存 ⇒ 窗从头跑');

  const s2 = scene();
  assert.equal(s2.s.clearDrawItemAnimStarts(2), 0, '没有 bit1 的项不命中');
  assert.equal(s2.it.animStart, 0, '未被碰到');
  assert.equal(s2.it.flags & ITEM_FLAG_ANIM_WIN, 0, 'bit1 也未被改');
});

test('bit2 命中 ⇒ 强制"世界矩阵有效"（raw 133395）；颜色通道不污染 A 层基线色', () => {
  const it = newItem();
  assert.equal(itemUsesWorld(it), false, '普通项走纯 2D 路径');
  it.flags |= ITEM_FLAG_ANIM_LOOP;
  assert.equal(itemUsesWorld(it), true, 'B 层矩阵必须参与合成');

  const { s, it: it2 } = scene();
  s.setDrawColorAlpha(H, 0x80112233);
  applyDrawColor(it2, 0, 100, 0xffffffff); // A 层颜色窗（to = 白）
  s.setDrawItemLoop({ op: 'color', handle: H, period: 10, alpha: 0, rgb: 0xffffff });
  itemColor(it2, T0 + 5); // B 层求值（写的是调用方局部，raw 118129）
  assert.equal(it2.from >>> 0, 0x80112233, 'from 不变（A 层基线色不被 B 层改写）');
  assert.notEqual(it2.to >>> 0, 0x00ffffff, 'to 也不被 B 层覆盖（+576 是另一格）');
  assert.equal(it2.loopTo >>> 0, 0x00ffffff, 'B 层目标色在自己的格子里');
});

test('注册：7 条都在已实现表里，且不在 no-op / native 表里（三表两两不相交）', () => {
  for (const op of [0x230, 0x231, 0x232, 0x233, 0x234, 0x235, 0x244]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须在 OPS（implemented）`);
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不得还是 no-op`);
    assert.ok(!NATIVE_OPS.has(op), `0x${op.toString(16)} 不得同时进 native 表`);
  }
});

// ---------------------------------------------------------------------------
// 8) 端到端：操作数 → handler → native（口径 = 引擎体：谁 ÷100、谁是 float、谁不除）
// ---------------------------------------------------------------------------

/** 只记录 `setDrawItemLoop` 请求的 native（其余照 StubNative）。 */
class LoopRecorder extends StubNative {
  readonly reqs: DrawItemLoopRequest[] = [];
  readonly clearMasks: number[] = [];
  constructor() {
    super(() => {});
  }
  override setDrawItemLoop(req: DrawItemLoopRequest): void {
    this.reqs.push(req);
  }
  override clearDrawItemAnimStarts(mask: number): number {
    this.clearMasks.push(mask);
    return 0;
  }
}

/** 走**真实** handler：把一条指令喂给解释器（骨架照 `op-223-transition-fade.test.ts`）。 */
async function step(op: number, vals: { v: number; float?: boolean }[]): Promise<LoopRecorder> {
  const n = new LoopRecorder();
  const e = new Engine(n, new InputManager());
  e.key = 0x12345678;
  const slots = vals.map((_, i) => 0x40 + i);
  const instr: BinInstruction = {
    opcode: op,
    name: `i${op.toString(16)}`,
    argc: vals.length,
    args: slots.map((raw, i) => ({
      type: vals[i]!.float ? 0x1 /* TYPE_IMMEDIATE_FLOAT */ : 0x3 /* TYPE_GLOBAL_INT */,
      raw: vals[i]!.float ? f32bits(vals[i]!.v) : raw,
    })) as unknown as BinArg[],
    byteOffset: 0x3c,
    index: 0,
  };
  const sc: ScriptBinary = {
    ...scriptDerived(),
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN');
  vals.forEach((x, i) => {
    if (!x.float) e.globals.int.set(slots[i]!, enc(e.key, x.v));
  });
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', `0x${op.toString(16)} 应已实现`);
  assert.equal(e.curScript().ip, 1, '应推进 ip');
  return n;
}

/** JS number → float32 位模式（`TYPE_IMMEDIATE_FLOAT` 的 raw 就是位模式）。 */
function f32bits(v: number): number {
  return new Uint32Array(new Float32Array([v]).buffer)[0]!;
}

test('端到端操作数口径：0x231/0x232 全 int；0x233 的 op3..5 ÷100；0x234/0x235 的 float 不除', async () => {
  const h = 0x18a9c;
  // i231 <h> c8 8 8 ⇒ 周期 200 / 格数 8 / 列数 8
  const a = await step(0x231, [{ v: h }, { v: 0xc8 }, { v: 8 }, { v: 8 }]);
  assert.deepEqual(a.reqs, [{ op: 'flipbook', handle: h, period: 200, frames: 8, cols: 8 }]);

  // i232 <h> 3e8 aa ffffff ⇒ 周期 1000、alpha=0xaa、rgb=0xffffff
  const b = await step(0x232, [{ v: h }, { v: 0x3e8 }, { v: 0xaa }, { v: 0xffffff }]);
  assert.deepEqual(b.reqs, [{ op: 'color', handle: h, period: 1000, alpha: 0xaa, rgb: 0xffffff }]);

  // i233 <h> 2d0 6e 6e 64 ⇒ 缩放 1.1/1.1/1（÷100 在 handler 里做，raw 32176-32178）
  const c = await step(0x233, [{ v: h }, { v: 0x2d0 }, { v: 110, float: true }, { v: 110, float: true }, { v: 100, float: true }]);
  assert.equal(c.reqs.length, 1);
  const sc = c.reqs[0]!;
  assert.equal(sc.op, 'scale');
  assert.equal(sc.op === 'scale' ? sc.period : 0, 0x2d0);
  near(sc.op === 'scale' ? sc.sx : 0, 1.1, '÷100');
  near(sc.op === 'scale' ? sc.sy : 0, 1.1, '÷100');

  // i234 <h> 168 0 0 1 ⇒ 旋转轴（float，**不除**，raw 32195-32199）
  const d = await step(0x234, [{ v: h }, { v: 0x168 }, { v: 0, float: true }, { v: 0, float: true }, { v: 1, float: true }]);
  assert.deepEqual(d.reqs, [{ op: 'rotate', handle: h, period: 360, ax: 0, ay: 0, az: 1 }]);

  // i235 <h> 32 0 a 0 ⇒ 平移（float，**不除**，raw 32213-32216）
  const f = await step(0x235, [{ v: h }, { v: 0x32 }, { v: 0, float: true }, { v: 10, float: true }, { v: 0, float: true }]);
  assert.deepEqual(f.reqs, [{ op: 'translate', handle: h, period: 50, tx: 0, ty: 10, tz: 0 }]);

  // i230 <h> ⇒ reset（argc=1）
  const g = await step(0x230, [{ v: h }]);
  assert.deepEqual(g.reqs, [{ op: 'reset', handle: h }]);

  // i244 ⇒ mask 固定 2（引擎立即数，raw 25353）
  const k = await step(0x244, []);
  assert.deepEqual(k.clearMasks, [2]);
});
