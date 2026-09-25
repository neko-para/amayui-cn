/** @tier T1 @kind core @subsystem l2d */

/**
 * **`T-0160`（Live2D 修缺批，P2 14 / P3 5）的命名守卫。**
 *
 * 每一项一条 `test`，名字里带 opcode 与一句"引擎侧的判据"，失败时不用回读 changes 就知道红在哪。
 * 证据全部来自 `engine/天结_unpacked.exe_utf8.c`（每条断言上面写 raw 行），**不是**从 emulator 反推。
 *
 * ## 覆盖表（opcode / 台账条目 → 本文件用例）
 * | 审计行 | 对象 | 本文件的用例 |
 * |---|---|---|
 * | 87 | `0x341` missing-branch | `0x341：.MOC 取不到/解析失败 ⇒ 抛 ShowMessageError` |
 * | 88 | `0x346` approximation | `0x346：节点复位不碰旋转轴角` |
 * | 89 | `0x34a` missing-behavior | `0x34a：基础平移偏移置 Scene+46508 锁存` |
 * | 282 | `0x34c` host-invented | `0x34c：缺 op6 时轴 z 取 0` |
 * | 90 | `0x34e` missing-behavior | `0x34e：.MTN 取不到/不可用 ⇒ 抛 ShowMessageError` |
 * | 91 | `0x34e` missing-behavior | `0x34e：0x352 预置写进动作记录 +4/+8` |
 * | 92 | `0x34e` missing-branch | `0x34e：只有动作槽 0 消费循环位 op4` |
 * | 93/94 | `0x34e` missing-branch/behavior | `0x34e：解析失败留坏记录 + +21/+22 的推进入口门` |
 * | 95 | `0x34f` missing-behavior | `0x34f：打包乘色解码 + 逐纹理下发 + op2<0 回退` |
 * | 96 | `0x350` missing-behavior | `0x350：清 +20/+21/+22 且以模型非空为门` |
 * | 97 | `0x351` missing-branch | `0x351：op3 先钳到 [0,255] 再 /255` |
 * | 283 | `0x351` host-invented | 同上一条的后半（不建槽） |
 * | 98 | `0x352` missing-branch | `0x352：槽不存在时是 no-op（不建槽）` |
 * | 280/281 | `0x341` missing-behavior/consumer | `0x341：同一 id 重装必须真读文件 + 重建` |
 *
 * ## 未覆盖（有意）
 * - **`live2d-enabled-config-flag` 的 stale-ledger（P2）与 overreach（P3）**：条目字段/措辞订正，
 *   代码侧无改动 ⇒ 落在 `tickets/T-0160/changes-live2d.md` 的「台账待应用」，守卫仍是
 *   `test/live2d-enabled-flag.test.ts`（本票扩展了它的断言）；
 * - **`lazy-572b-node-map` 的 overreach（P2）**：同上（台账 name/reads 订正）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { im, instr, mkEngine } from './harness.js';
import { StubNative } from '../src/vm/stubNative.js';
import { ShowMessageError } from '../src/vm/native.js';
import type { BinArg } from '../src/script/bin.js';
import type { Engine } from '../src/vm/engine.js';
import type { FileSource } from '../src/arch/fileSource.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scL2dTick } from '../src/renderer/scene/ops.js';
import {
  decodeL2dMulColor,
  l2dAdvance,
  l2dBindTexture,
  l2dCreateNode,
  l2dLoadModel,
  l2dResetMotion,
  l2dSetNamedParam,
  l2dSetPending,
  l2dStartMotion,
  l2dTextureMulColor,
  l2dNodeBaseOffset,
} from '../src/live2d/runtime.js';
import { l2dBatches } from '../src/live2d/render.js';
import { loadModelIntoSlot, startMotionOnSlot, type Live2dAssetSource } from '../src/live2d/assetLoader.js';
import { parseMtn } from '../src/live2d/mtn.js';
import type { MocDrawData, MocModel, MocParts } from '../src/live2d/moc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 找一个含 `SYS4INI.BIN` 的资源根（`raw/` 优先，其次 `install/`）。 */
function findResourceRoot(): string | null {
  for (const cand of ['raw', 'install']) {
    const dir = path.join(ROOT, cand);
    if (fs.existsSync(path.join(dir, 'SYS4INI.BIN'))) return dir;
  }
  return null;
}

const ID_TITLE_MOC = 0x4f9e;
const ID_TITLE_MTN = 0x5274;

/** 走真实 handler 表派发一条合成指令（与 `live2d-chain.test.ts` 同一路径）。 */
async function dispatch(e: Engine, op: number, args: BinArg[]): Promise<void> {
  const handler = OPS.get(op) ?? NATIVE_OPS.get(op);
  assert.ok(handler, `0x${op.toString(16)} 应有 handler（不该落到未实现）`);
  await handler(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
}

/** 一个**总是取不到**的资产源（引擎那条路 = `sub_4559C0`/`ReadFile` 失败 ⇒ 组串 + 抛）。 */
const missingSource = { readById: async () => null } as unknown as FileSource;

/** 合成模型：两个参数 + 一个部件一个网格（`0x34F` 的逐纹理下发要有纹理号可挂）。 */
function syntheticModel(): MocModel {
  const dd: MocDrawData = {
    kind: 'drawData',
    id: { kind: 'id', idClass: 'draw', name: 'D_A' },
    targetId: null,
    pivotManager: { params: [] },
    averageDrawOrder: 5,
    pivotDrawOrders: [5],
    pivotOpacities: [1],
    clipId: null,
    textureNo: 0,
    pointCount: 3,
    polygonCount: 1,
    indexArray: [0, 1, 2],
    pivotPoints: [[0, 0, 10, 0, 0, 10]],
    uvs: [0, 0, 0.1, 0.2, 0.2, 0.4],
    optionFlag: 0,
    colorGroupNo: null,
    colorCompositionType: 0,
    culling: true,
  };
  const part: MocParts = {
    kind: 'parts',
    locked: false,
    visible: true,
    id: { kind: 'id', idClass: 'parts', name: 'P_A' },
    deformers: [],
    drawables: [dd],
  };
  return {
    kind: 'model',
    params: [
      { kind: 'paramDef', min: 0, max: 1, defaultValue: 0.25, id: { kind: 'id', idClass: 'param', name: 'PARAM_A' } },
    ],
    parts: [part],
    canvasWidth: 100,
    canvasHeight: 50,
    stats: { version: 10, objects: 0, byTag: {}, bytesRead: 0, bytesTotal: 0, eofMarker: true },
  };
}

/** 一个只有 `drawables[0].textureNo = -1` 的模型（`0x34F` 的"无纹理网格"支）。 */
function noTextureModel(): MocModel {
  const m = syntheticModel();
  m.parts[0]!.drawables[0]!.textureNo = -1;
  return m;
}

// ─────────────────────────── 0x341 / 0x346 / 0x34a / 0x34c ───────────────────────────

test('★T-0160 0x341：.MOC 取不到/解析失败 ⇒ 抛 ShowMessageError（引擎 raw 34488 的「L2Dモデルファイル %s…」）', async () => {
  const e = mkEngine([]);
  e.fileSource = missingSource;
  await assert.rejects(
    () => dispatch(e, 0x341, [im(0x7ffff0), im(0)]),
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, `应抛 ShowMessageError（实际 ${String(err)}）`);
      assert.equal(err.engineText, 'L2Dモデルファイル 0x7ffff0 の読み込みに失敗しました');
      assert.equal(err.opcode, 0x341);
      return true;
    },
    '引擎 sub_427BA0 raw 34482-34491：取不到/解析失败 ⇒ 组错误串 + _CxxThrowException，不是"记一条 log 继续跑"',
  );
  assert.equal(e.l2dSlots.size, 0, '失败时槽保持为空（引擎此时槽里是解析失败半成品，节点整块不出画）');
});

test('★T-0160 0x346：节点复位不碰旋转轴角（缺省轴 (0,0,0)/角 0），并置 Scene+46508 锁存', async () => {
  const e = mkEngine([]);
  // 缺省（`sub_49CA10` raw 118487-118490：`+464/+468/+472 = 0.0`、`+488 = 0`）
  const fresh = l2dCreateNode(e, 1, 0);
  assert.deepEqual(fresh.rotation, { axis: [0, 0, 0], deg: 0 }, '缺省旋转轴是 (0,0,0)、角 0（不是 (0,0,1)）');
  // `0x348` 设轴角后 `0x346` 复位：轴角必须**原样保留**（`sub_4AFC40` 的写点里没有 `+464..492`）
  await dispatch(e, 0x348, [im(1), im(1), im(0), im(0), im(90)]);
  const before = e.l2dNodes.get(1)!;
  assert.deepEqual(before.rotation, { axis: [1, 0, 0], deg: 90 }, '0x348 应写轴角');
  before.sceneDirty = false; // 只看 0x346 这一条的置脏
  await dispatch(e, 0x346, [im(1)]);
  const after = e.l2dNodes.get(1)!;
  assert.deepEqual(after.rotation, { axis: [1, 0, 0], deg: 90 }, '0x346 不得把轴角写回缺省（引擎不碰 +464..492）');
  assert.deepEqual(after.scale, [1, 1, 1], '0x346 仍要复位缩放 from');
  assert.deepEqual(after.translate, [0, 0, 0], '0x346 仍要复位平移 from');
  assert.equal(after.matrixDirty, false, '0x346 清 +76');
  assert.equal(after.sceneDirty, true, '0x346 置 Scene+46508（raw 134030 的 `_this[11627] = 1`）');
});

test('★T-0160 0x34a：基础平移偏移置 Scene+46508 锁存、且不置 record+76', async () => {
  const e = mkEngine([]);
  const node = l2dCreateNode(e, 7, 0);
  node.sceneDirty = false;
  node.matrixDirty = false;
  await dispatch(e, 0x34a, [im(7), im(3), im(4), im(0)]);
  const after = e.l2dNodes.get(7)!;
  assert.deepEqual(after.baseOffset, [3, 4, 0], '写 record[2..4]');
  assert.equal(after.sceneDirty, true, '★`sub_4AFFF0` raw 134138 置 `_this[11627] = 1`');
  assert.equal(after.matrixDirty, false, '★`sub_4AFFF0` **不写** `record+76`（别顺手置它）');
  // 共享模型侧：`scL2dTick` 把锁存转成 `SceneState.dirty`（= 引擎里那格的等价物）
  const scene = newSceneState();
  scene.l2dHost = e;
  scene.dirty = false;
  scL2dTick(scene, 16);
  assert.equal(scene.dirty, true, 'scL2dTick 必须消费 `Scene+46508` 锁存（否则这一笔在 needsRender 档下不重画）');
  assert.equal(after.sceneDirty, false, '锁存被消费后清掉（引擎里那格在每遍绘制开头清 0）');
});

test('★T-0160 0x34c：缺 op6 时轴 z 取 0（引擎无条件读 op6，宿主不得自造 1）', async () => {
  const e = mkEngine([]);
  await dispatch(e, 0x344, [im(9), im(0)]); // 窗指令的门是 `record[0] & 1`（0x344 建出来的记录才有）
  // argc 6（只有 op1..op5）⇒ `p.float(6)` 取不到
  await dispatch(e, 0x34c, [im(9), im(0), im(100), im(1), im(2)]);
  const node = e.l2dNodes.get(9)!;
  assert.deepEqual(
    node.wins.rotation.to.axis,
    [1, 2, 0],
    '引擎 sub_4280D0 raw 34668 对 op6 是无条件 `sub_41C300(_this, 6)`：缺位只能是"没写过" ⇒ 0（旧实现写 1）',
  );
});

// ─────────────────────────── 0x34e ───────────────────────────

test('★T-0160 0x34e：.MTN 取不到/不可用 ⇒ 抛 ShowMessageError（引擎 raw 34728 的「L2Dモーションファイル %s…」）', async () => {
  const e = mkEngine([]);
  e.fileSource = missingSource;
  await assert.rejects(
    () => dispatch(e, 0x34e, [im(0x5274), im(0), im(0), im(1)]),
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, `应抛 ShowMessageError（实际 ${String(err)}）`);
      assert.equal(err.engineText, 'L2Dモーションファイル 0x5274 の読み込みに失敗しました');
      assert.equal(err.opcode, 0x34e);
      return true;
    },
    '引擎 sub_428200 raw 34722-34731：ReadFile 失败或 sub_478640 返回 0 ⇒ 组串 + 抛，不是"记 log 后 return null"',
  );
});

test('★T-0160 0x34e：0x352 预置写进动作记录 +4/+8 并清标志（引擎 raw 92824-92835）', async () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  assert.equal(l2dSetPending(e, 0, 0, 7), true, '0x352 which=0 应落库（槽里有模型）');
  assert.equal(l2dSetPending(e, 0, 1, 9), true, '0x352 which!=0 应落库');
  const motion = parseMtn('$fps=30\nPARAM_A=0,1\n', 'X.MTN');
  assert.equal(l2dStartMotion(e, 0, 0x200, motion, 0, false), true, '槽 0 装载应成功');
  const inst = e.l2dSlots.get(0)!;
  const rec = inst.records.get(0)!;
  assert.equal(rec.textureNo, 7, '动作记录 +4 ← 实例 +28 的预置纹理号');
  assert.equal(rec.motionNo, 9, '动作记录 +8 ← 实例 +32 的预置动作号');
  assert.equal(inst.pendingTextureNo, null, '预置标志用后清（引擎 `+24 = 0` 且 `_this[7] = 0`）');
  assert.equal(inst.pendingMotionNo, null, '预置标志用后清（引擎 `+25 = 0` 且 `_this[8] = 0`）');
});

test('★T-0160 0x34e：只有动作槽 0 消费循环位 op4（槽 1 不消费，引擎 raw 92843-92860 无 sub_4784D0）', async () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  const motion = parseMtn('$fps=30\nPARAM_A=0,1\n', 'X.MTN');
  assert.equal(l2dStartMotion(e, 0, 0x200, motion, 1, true), true, '槽 1 装载');
  const inst = e.l2dSlots.get(0)!;
  assert.equal(inst.loop, false, '★槽 1 支线不写实例 +20（只有槽 0 调 sub_4784D0）');
  assert.equal(inst.records.get(1)!.loop, false, '★槽 1 的动作记录 +36 也不被写');
  assert.equal(inst.current!.loop, false, '槽 1 的动作按"不循环"播');
  assert.equal(l2dStartMotion(e, 0, 0x201, motion, 0, true), true, '槽 0 装载');
  assert.equal(inst.loop, true, '槽 0 消费 op4=1 ⇒ 实例 +20 = 1');
  assert.equal(inst.records.get(0)!.loop, true, '槽 0 的动作记录 +36 = 1（sub_4784D0 raw 92648）');
});

test('★T-0160 0x34e：解析失败 ⇒ 记录被换成坏对象、不入队；+21/+22 是唯一的推进入口门', async () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  const good = parseMtn('$fps=30\nPARAM_A=0,1\n', 'GOOD.MTN');
  const bad = parseMtn('# 只有注释，没有任何曲线\n', 'BAD.MTN');
  assert.equal(l2dStartMotion(e, 0, 0x200, good, 0, true), true, '先装一条好动作');
  const inst = e.l2dSlots.get(0)!;
  assert.ok(inst.current, '好动作应在播');
  // 坏动作：引擎 `_this[1] = sub_4BE490(...)` 已经赋值，随后 `sub_4BCE90()` 非 0 ⇒ return 0
  assert.equal(l2dStartMotion(e, 0, 0x201, bad, 0, true, { parseError: true }), false, '解析失败 ⇒ 返回 0');
  assert.equal(inst.records.get(0)!.motion, bad, '★记录里留的是**坏对象**（引擎先赋值再判错）');
  assert.equal(inst.records.get(0)!.parseError, true, '坏对象带解析错标记（sub_4BCE90 的等价物）');
  assert.equal(inst.current!.motion, good, '★解析失败**不入队** ⇒ 队列仍是上一条（`sub_4BCA20` 没被调到）');
  assert.equal(inst.loaded[0], true, '装载标志保持先前的值（失败支不置 +21）');
  // `+21`/`+22` 门：都没置 ⇒ 不推进（引擎 raw 92584-92589 的 `if (+21 == 1 || +22 == 1)`）
  const idle = mkEngine([]);
  l2dLoadModel(idle, 0, 0x100, syntheticModel());
  l2dCreateNode(idle, 5, 0);
  const adv0 = l2dAdvance(idle, 500, [5]);
  assert.equal(adv0.size, 0, '★没有任何动作装载过（+21/+22 全 0）⇒ 不推进');
});

test('★T-0160 0x34e：+21/+22 的结算 —— 非循环播完清标志、槽 1 先结算、循环重入队（引擎 raw 92588-92602）', async () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  l2dCreateNode(e, 6, 0);
  // 一段很短的**非循环**动作：durationMs = 2 帧 / 30fps ≈ 66.7ms
  const short = parseMtn('$fps=30\nPARAM_A=0,1,0\n', 'S.MTN');
  l2dStartMotion(e, 0, 0x300, short, 0, false);
  const inst = e.l2dSlots.get(0)!;
  assert.equal(inst.loop, false, 'op4=0 ⇒ 实例 +20 = 0');
  // 第 1 拍：查队列（此刻还没播完）⇒ 只推进；第 2 拍：队列报完 ⇒ `else +21 = 0`
  l2dAdvance(e, 1000, [6]);
  assert.equal(inst.loaded[0], true, '第一拍只推进（引擎 `sub_4783D0` 先查队列再 `sub_4BCB50`）');
  l2dAdvance(e, 1, [6]);
  assert.equal(inst.loaded[0], false, '★非循环动作播完 ⇒ `+21 = 0`（此后不再推进，引擎 raw 92600）');
  // 槽 1 支线：`if (+22) +22 = 0` 优先于 `else if (+20)`
  const e2 = mkEngine([]);
  l2dLoadModel(e2, 0, 0x100, syntheticModel());
  l2dCreateNode(e2, 6, 0);
  l2dStartMotion(e2, 0, 0x301, short, 0, true); // 槽 0 循环 ⇒ +20 = 1、records[0].loop = 1
  l2dStartMotion(e2, 0, 0x302, short, 1, true); // 槽 1 ⇒ +22 = 1（op4 不被消费）
  const inst2 = e2.l2dSlots.get(0)!;
  assert.equal(inst2.loop, true, '槽 0 的循环位在（槽 1 的装载不改 +20）');
  l2dAdvance(e2, 1000, [6]);
  l2dAdvance(e2, 1, [6]);
  assert.equal(inst2.loaded[1], false, '★队列报完时 `+22` 先结算（raw 92591-92593）');
  assert.equal(inst2.loaded[0], true, '同拍不动 +21（`+22` 支优先）');
  // 第 3 拍：+22 已清、+20 还在且队列仍"完" ⇒ `sub_4BCA20(_this[3], _this[1], 1)` 重入队槽 0 的动作
  l2dAdvance(e2, 1, [6]);
  assert.ok(inst2.current, '★循环 ⇒ 播完重入队（current 不为空，引擎 raw 92596）');
  assert.equal(inst2.current?.motion, inst2.records.get(0)!.motion, '重入队的是**动作记录 0** 的动作');
  assert.equal(inst2.current?.loop, true, '重入队后仍按循环播');
  assert.ok((inst2.current?.elapsedMs ?? 1e9) < 10, '重入队后时间轴从头开始');
});

// ─────────────────────────── 0x34f / 0x350 / 0x351 / 0x352 ───────────────────────────

test('★T-0160 0x34f：打包乘色解码成三分量 + 逐纹理下发 + op2<0 走 sub_4ADD60 工作色回退', async () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  l2dBindTexture(e, 0, 0x4f9f, 0); // 纹理号 0 有图
  l2dBindTexture(e, 0, 0x4fa0, 1); // 纹理号 1 有图
  // `0x00112233`（**正数**）：BYTE2 = 0x11、BYTE1 = 0x22、BYTE0 = 0x33（raw 34813-34818 的实参序）
  const packed = 0x00112233;
  const want = [0x11 / 255, 0x22 / 255, 0x33 / 255] as [number, number, number];
  l2dTextureMulColor(e, 0, packed);
  const inst = e.l2dSlots.get(0)!;
  assert.deepEqual(decodeL2dMulColor(packed), want, '解码口径 = [BYTE2/255, BYTE1/255, BYTE0/255]');
  assert.equal(inst.mulColorRaw, packed, '原始打包值仍可读（诊断/守卫）');
  assert.deepEqual(inst.mulColors.get(0), want, '★逐纹理下发（sub_478590 只对已有纹理槽）');
  assert.deepEqual(inst.mulColors.get(1), want, '★第二个纹理槽也下发');
  assert.equal(inst.mulColors.has(2), false, '没有纹理的槽不会被下发');
  // 渲染侧：批次按**自己的纹理号**取乘色
  l2dCreateNode(e, 0x14, 0);
  const bs = l2dBatches(e, 1280, 720);
  assert.deepEqual(bs[0]?.mulColor, want, '网格批次应带上它那个纹理槽的乘色（旧实现是原始 int 且不逐纹理）');
  // `op2 < 0` ⇒ 用同一个 op1 当绘制项 handle 查工作色（`sub_4ADD60` raw 132579-132588）
  const native = new StubNative(() => {});
  native.getDrawItemColor = (h: number) => (h === 0 ? 0x000a0b0c : -1);
  const e2 = mkEngine([], 'FAKE.BIN', native);
  l2dLoadModel(e2, 0, 0x100, syntheticModel());
  l2dBindTexture(e2, 0, 0x4f9f, 0);
  await dispatch(e2, 0x34f, [im(0), im(-1)]);
  assert.equal(
    e2.l2dSlots.get(0)!.mulColorRaw,
    0x000a0b0c,
    'op2<0 ⇒ 走宿主缝取绘制项工作色（引擎 raw 34808 的 sub_4ADD60(Scene, op1)）',
  );
  assert.deepEqual(decodeL2dMulColor(0x000a0b0c), [0x0a / 255, 0x0b / 255, 0x0c / 255]);
  // ★同一个回退支的第二个入口：**负数**的 op2（bit31 置位的打包值，例如带 α 的 ARGB）在引擎里
  //   也走 `v2 < 0` 这条路 ⇒ 直接给 `0x80ff00ff` 时读的是绘制项工作色，**不是**当颜色解码。
  await dispatch(e2, 0x34f, [im(0), im(0x80ff00ff)]);
  assert.equal(e2.l2dSlots.get(0)!.mulColorRaw, 0x000a0b0c, '0x80ff00ff 作为有符号 int 是负数 ⇒ 同样走回退');
  // 查不到（`-1`）⇒ 三分量全 1（无着色），与引擎 `sub_4ADD60` 缺项返回 -1 的口径一致
  const e3 = mkEngine([]);
  l2dLoadModel(e3, 0, 0x100, syntheticModel());
  await dispatch(e3, 0x34f, [im(0), im(-1)]);
  assert.deepEqual(e3.l2dSlots.get(0)!.mulColor, [1, 1, 1], '缝查不到 ⇒ packed = -1 ⇒ 全 1');
});

test('★T-0160 0x350：清 +20/+21/+22，且以"模型非空"为门（引擎 sub_478500 raw 92653-92664）', async () => {
  const e = mkEngine([]);
  // 槽不存在 ⇒ no-op（不得建槽）
  assert.equal(l2dResetMotion(e, 3), false, '槽不存在 ⇒ 门挡掉');
  assert.equal(e.l2dSlots.size, 0, '★`0x350` 不得凭空建槽');
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  const motion = parseMtn('$fps=30\nPARAM_A=0,1\n', 'X.MTN');
  l2dStartMotion(e, 0, 0x200, motion, 0, true);
  const inst = e.l2dSlots.get(0)!;
  assert.equal(inst.loop, true, '装载后 +20 = 1');
  assert.equal(inst.loaded[0], true, '装载后 +21 = 1');
  assert.equal(l2dResetMotion(e, 0), true, '槽里有模型 ⇒ 落库');
  assert.equal(inst.current, null, '复位队列（sub_4BCD40）');
  assert.equal(inst.loop, false, '★清 +20（`_this[20] = 0`，`_this` 是 char* ⇒ 字节 +20）');
  assert.deepEqual(inst.loaded, [false, false], '★清 +21/+22（`*(_WORD*)(_this+21) = 0`）');
});

test('★T-0160 0x351：op3 先钳到 [0,255] 再 /255；槽/模型不存在时不建槽（raw 34756-34775）', async () => {
  const e = mkEngine([]);
  // 槽不存在 ⇒ 不建槽、不写参数
  assert.equal(l2dSetNamedParam(e, 1, 'PARAM_A', 300), false, '槽不存在 ⇒ 门挡掉');
  assert.equal(e.l2dSlots.size, 0, '★`0x351` 不得凭空建槽（引擎 sub_478520 的 `if (v3)`）');
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  const inst = e.l2dSlots.get(0)!;
  assert.equal(l2dSetNamedParam(e, 0, 'P1', 300), true, '槽里有模型 ⇒ 落库');
  assert.equal(inst.params.get('P1'), 1, '>255 ⇒ 钳到 255 ⇒ 1.0（旧实现 = 300/255 > 1）');
  l2dSetNamedParam(e, 0, 'P2', -5);
  assert.equal(inst.params.get('P2'), 0, '<0 ⇒ 钳到 0 ⇒ 0.0（旧实现 = -5/255 < 0）');
  l2dSetNamedParam(e, 0, 'P3', 128);
  assert.equal(inst.params.get('P3'), 128 / 255, '区间内原样 ÷255（dbl_520448 = 255.0）');
  l2dSetNamedParam(e, 0, 'P4', 128.9);
  assert.equal(inst.params.get('P4'), 128 / 255, '★非整数按引擎的 int 比较语义截断（`v2 <= 255` 比的是 int）');
});

test('★T-0160 0x352：槽不存在时是 no-op（不建槽，引擎 sub_478540/478560 的 `if (*(_DWORD*)_this)`）', async () => {
  const e = mkEngine([]);
  await dispatch(e, 0x352, [im(4), im(0), im(9)]);
  assert.equal(e.l2dSlots.size, 0, '★槽 4 不存在 ⇒ 引擎不产生任何表项，emulator 也不得建槽');
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  await dispatch(e, 0x352, [im(0), im(1), im(9)]);
  assert.equal(e.l2dSlots.get(0)!.pendingMotionNo, 9, '槽里有模型 ⇒ 正常落库');
  assert.equal(e.l2dSlots.get(0)!.pendingTextureNo, null, 'which != 0 ⇒ 写的是动作号那一格');
});

// ─────────────────────────── 0x341 的两条（重建 / 复位） ───────────────────────────

test('★T-0160 0x341：同一 id 重装必须真读文件 + 重建（旧实例的动作队列/预置/乘色全复位）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过（真资产用例）');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  let reads = 0;
  let present = true;
  const counting: Live2dAssetSource = {
    loadById: async (id) => {
      reads++;
      if (!present) return null;
      return src.readById(id);
    },
  };
  const e = mkEngine([]);
  const m1 = await loadModelIntoSlot(counting, e, ID_TITLE_MOC, 0, () => {});
  assert.ok(m1, '第一次装 TITLE.MOC 应成功');
  const inst1 = e.l2dSlots.get(0)!;
  // 制造"上一个执行链的残留"：装动作、预置、乘色、改参数
  const motion = parseMtn('$fps=30\nPARAM_A=0,1\n', 'X.MTN');
  l2dStartMotion(e, 0, 0x200, motion, 0, true);
  l2dSetPending(e, 0, 0, 5);
  l2dTextureMulColor(e, 0, 0x80ff00ff);
  inst1.params.set('PARAM_ANGLE_X', 0.9);
  assert.equal(e.l2dSlots.get(0)!.records.size, 1, '重装前记录里有动作');
  // 第二次装**同一个 id**：引擎 sub_4A1860 raw 121674-121681 先析构旧实例（sub_4785E0 里还有
  //   `sub_478500`：清 +20/+21/+22、销毁动作队列）再 new ⇒ 全部回缺省
  reads = 0;
  const m2 = await loadModelIntoSlot(counting, e, ID_TITLE_MOC, 0, () => {});
  assert.ok(m2, '第二次装同一 id 仍应成功');
  assert.equal(reads, 1, '★`mocCache` 只能短路**解析**，不能短路读文件（引擎每次都 ReadFile）');
  const inst2 = e.l2dSlots.get(0)!;
  assert.notEqual(inst1, inst2, '★旧实例对象被丢弃（引擎 operator delete 旧实例）⇒ 换成一个新实例');
  assert.equal(inst2.records.size, 0, '★动作记录复位（sub_4785E0 → sub_478500 销毁队列）');
  assert.equal(inst2.current, null, '★动作队列复位');
  assert.deepEqual(inst2.loaded, [false, false], '★`+21/+22` 复位');
  assert.equal(inst2.loop, false, '★`+20` 复位');
  assert.equal(inst2.pendingTextureNo, null, '★`0x352` 预置复位');
  assert.equal(inst2.mulColor, null, '★乘色（`0x34F`）复位');
  assert.equal(inst2.params.get('PARAM_ANGLE_X') ?? 0, 0, '★参数回到模型缺省（不是上一次改过的值）');
  // 文件**已经**取不到、而同一 id 之前装过：必须失败（旧实现拿缓存直接装成功、连日志都没有）
  present = false;
  await assert.rejects(
    () => loadModelIntoSlot(counting, e, ID_TITLE_MOC, 0, () => {}, (f) => {
      throw new ShowMessageError(f.engineText, 0x341, f.detail);
    }),
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, '文件消失 ⇒ 必须报错（不是静默用缓存顶过去）');
      return true;
    },
    '引擎这条路的后果是"旧模型已销毁、新模型装不上 + 抛 ShowMessage"',
  );
  assert.equal(e.l2dSlots.has(0), false, '失败后槽为空（旧模型已销毁）');
  await src.dispose?.();
});

test('★T-0160 0x341/0x34e 真资产：TITLE 的装载链在改动后仍然跑得通（回归）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过（真资产用例）');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  const e = mkEngine([]);
  e.fileSource = src;
  await dispatch(e, 0x341, [im(ID_TITLE_MOC), im(0)]);
  await dispatch(e, 0x34e, [im(ID_TITLE_MTN), im(0), im(0), im(1)]);
  const inst = e.l2dSlots.get(0)!;
  assert.equal(inst.modelId, ID_TITLE_MOC, '0x341 后槽 0 应有 TITLE.MOC');
  assert.ok(inst.current, '0x34e 后应有动作在播');
  assert.equal(inst.loop, true, 'op2=0 ⇒ 槽 0 消费 op4=1');
  // `0x352` 预置的应用（`i352 0 0 0` 那种语料形状）
  await dispatch(e, 0x352, [im(0), im(0), im(0)]);
  await dispatch(e, 0x34e, [im(ID_TITLE_MTN), im(0), im(0), im(1)]);
  assert.equal(e.l2dSlots.get(0)!.records.get(0)!.textureNo, 0, '预置纹理号应落到动作记录 +4');
  await src.dispose?.();
});

test('★T-0160 0x34f 无纹理网格：`textureNo == -1` 的批次取实例级解码值，不当纹理文件 id', () => {
  const e = mkEngine([]);
  l2dLoadModel(e, 0, 0x100, noTextureModel());
  const packed = 0x00112233; // 正数 ⇒ 走解码支（负数是 `sub_4ADD60` 回退支，见上一条）
  l2dTextureMulColor(e, 0, packed);
  l2dCreateNode(e, 0x15, 0);
  const bs = l2dBatches(e, 1280, 720);
  const none = bs.find((b) => b.textureNo === -1);
  assert.ok(none, '应有 textureNo = -1 的那一批');
  assert.equal(none.textureFileId, null, '★不能把乘色当成纹理文件 id');
  assert.deepEqual(none.mulColor, [0x11 / 255, 0x22 / 255, 0x33 / 255], '无纹理网格退到实例级解码值（诊断口径）');
});
