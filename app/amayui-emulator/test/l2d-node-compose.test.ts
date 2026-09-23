/** @tier T1 @kind core @subsystem l2d */

/**
 * **Live2D 节点矩阵合成器** `sub_4A07F0`（raw 121131-121655）的守卫 —— `tickets/T-0096`（E2）。
 *
 * 为什么必须是**矩阵数值**级断言：`test/l2d-node-transform-ops.test.ts` 把 7 条指令的
 * **操作数口径与落点字段**钉死了，但那些字段**本身不出画** —— 引擎在逐节点绘制那次调用里
 * （`sub_4B0360` raw 134341）把 4 个窗求值、按
 * `a3 = a3 · T(−p) · M_base · M_scale · M_rot · M_trans · T(+p)` 组合成节点矩阵。
 * 于是"字段落对了"与"画面对"之间还差一层，这里逐条钉住它：
 *
 * | 组 | 断言 |
 * |---|---|
 * | 组合序 | 左右乘判据（`.lst` 266233-266235 的 `push esi; push esi`）+ **真实 `d3dx9_43.dll` 的重放值** |
 * | 窗求值 | `now` 四点（窗未开 / 窗内中点 / 窗末 / 窗末之后）+ 窗末**冻结**与 delay=dur **归零** |
 * | 起锁 | `record+24 == 0 ⇒ = now`（不是倒计时）⇒ 起点晚锁存 ⇒ 窗也晚开 |
 * | 门 | `record[0] & 2`（没窗在跑 ⇒ 只走立即值）、`record[0] & 1`（现有测试覆盖）、`+504 bit0`（alpha） |
 * | 旋转窗 | 轴角 lerp 后**重算矩阵**；★非单位轴 —— D3DX **内部归一化**（对第三方 DLL 实测，见下） |
 * | 颜色窗 | 逐字节整数插值 + ★**副作用**（吸附后 delay/dur 归零、from←to、to←0xFFFFFFFF） |
 * | **零回归** | TITLE.MOC 真资产：节点矩阵 = I ⇒ 批次几何与"矩阵全为单位阵"时**逐字节相同** |
 *
 * ★**组合式的判据是外部 DLL，不是手推**：`.tmp/t0096b/D3dxComposeProbe.cs` 用真实
 * `d3dx9_43.dll` 逐步重放 `a3 = I·T(−p)·M_scale·T(t)·T(+p)`（pivot=(10,20)、s=2、t=(3,4)），
 * 得到 `a3` 第 4 行 = `[-7,-16,0,1]` ⇒ 点映射 `q = (q0 − p)·A + t + p`。这条链的顺序 /
 * 转置 / 平移项一共写成过两个错版本，两次都是这个探针把它们打回来的。
 *
 * ★**颜色窗的输出没有消费者**：唯一调用点 raw 134347 在返回后立刻把颜色出参当整数槽下标用
 * ⇒ 这里断言的是它的**副作用与插值数值**，不为"画面上的颜色"设验收（用户裁定见票面验收第 5 条）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/vm/engine.js';
import { Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { enc } from '../src/vm/bits.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, loc } from './harness.js';

import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scL2dTick } from '../src/renderer/scene/ops.js';
import { scSnapshot } from '../src/renderer/scene/snapshot.js';
import { l2dBatches } from '../src/live2d/render.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { loadModelIntoSlot, type Live2dAssetSource } from '../src/live2d/assetLoader.js';
import { AFFINE_IDENTITY, affineApply, type Affine } from '../src/live2d/deform.js';
import {
  advanceColorWindow,
  advanceRotationWindow,
  advanceScaleWindow,
  advanceTranslationWindow,
  colorAlpha,
  colorBlue,
  colorGreen,
  colorRed,
  l2dComposeNode,
  packColor,
  type L2dColorWindow,
} from '../src/live2d/nodeMatrix.js';
import {
  l2dCreateNode,
  l2dComposeNodeAt,
  l2dBindTexture,
  l2dLoadModel,
  l2dNodeBaseOffset,
  l2dNodeRotation,
  l2dNodeRotationWin,
  l2dNodeScale,
  l2dNodeScaleWin,
  l2dNodeTranslate,
  l2dNodeTranslationWin,
  type L2dNode,
} from '../src/live2d/runtime.js';
import type { MocDrawData, MocModel } from '../src/live2d/moc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 造一个纯 VM 宿主引擎（真资产用例要它当 `L2dHost`）。 */
function mkEngine(): Engine {
  return new Engine(new StubNative(() => {}));
}

/** 立即数 float：`raw` 必须是 IEEE 位模式（`readFloatOperand` 走 `floatBits(raw)`）。 */
const fm = (v: number): BinArg =>
  ({ type: 1, raw: new Uint32Array(new Float32Array([v]).buffer)[0]! }) as unknown as BinArg;

const KEY = 0x14;

/** 指令驱动的小 harness（照 `l2d-node-transform-ops.test.ts` 的形态）。 */
function mk() {
  const e = new Engine(new StubNative(() => {}));
  const f = new Frame();
  const setInt = (slot: number, v: number): void => void f.locals.int.set(slot, enc(e.key, v));
  const run = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 必须在已实现表`);
    h(makeCtx(e, f, instr(op, args), new StubNative(() => {}), () => {}));
  };
  setInt(1, KEY);
  return { e, f, setInt, run };
}

function nodeOf(e: Engine, key = KEY): L2dNode {
  const n = e.l2dNodes.get(key);
  assert.ok(n, `节点 ${key} 应已存在`);
  return n;
}

/** 逐分量近似比较（浮点矩阵）。 */
function assertClose(got: Affine, want: readonly number[], msg: string): void {
  assert.equal(got.length, want.length, msg);
  for (let i = 0; i < want.length; i++) {
    assert.ok(Math.abs(got[i]! - want[i]!) < 1e-4, `${msg}：m[${i}] = ${got[i]}，应≈ ${want[i]}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 组合序（左/右乘判据）
// ─────────────────────────────────────────────────────────────────────────────

test('★左右序：组合式 `a3 = T(−p)·M_base·M_scale·M_rot·M_trans·T(+p)`（D3DX 行向量）', () => {
  // 判据 = `.lst` 266233-266235：`push esi; push esi; call D3DXMatrixMultiply` ⇒ pOut = pM1·pM2
  // ⇒ 右乘/追加 ⇒ 组合式 a3 = T(−p)·M_base·M_scale·M_rot·M_trans·T(+p)（**最左边先作用**）。
  // 期望值不是手推的：`.tmp/t0096b/D3dxComposeProbe.cs` 用**真实 d3dx9_43.dll** 逐步重放
  //   同一条链，得到 `a3` 第 4 行 = `[-7,-16,0,1]`、`(0,0)→(−7,−16)`、`(100,50)→(193,84)`
  //   ⇒ 点映射 `q = (q0 − p)·A + t + p`（★注意 `t` 在 `T(+p)` **之前** ⇒ t 跟着 -p 一起被后面
  //   的线性部分放大：`t_eff = A·(−p) + t + p`。顺序错一条，下面这些数就变）。
  //
  // ★这里用**窗**驱动（而不是 `0x347`/`0x349` 的立即值）：`scale`/`translate` 那个字段在引擎里
  //   是**窗的 from 矩阵**（`+20`/`+84`），只有"有窗在跑"（`record[0] & 2`）时合成器才走窗求值分支；
  //   否则走"立即值"分支。窗长 1ms ⇒ 在 `now = start + 1` 处已经吸附（`from` = 旧 `to`），
  //   于是 from 侧精确等于 `0x347`/`0x349` 写的终值 —— 两条分支的公式相同、数据来源不同。
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  l2dNodeBaseOffset(e, KEY, 10, 20, 0); // pivot
  l2dNodeScale(e, KEY, 2, 2, 1); // 立即缩放（= 窗的 from 侧，`+80`）
  l2dNodeTranslate(e, KEY, 3, 4, 0); // 立即平移（= 窗的 from 侧，`+336`）
  l2dNodeScaleWin(e, KEY, 0, 1, 2, 2, 1); // 缩放窗：dur = 1ms ⇒ 下一毫秒就吸附（from ← to）
  l2dNodeTranslationWin(e, KEY, 0, 1, 3, 4, 0); // 平移窗同上

  const r0 = l2dComposeNode(n, 1_000); // 锁存起点 = 1000（窗未开：`now == start` 不算"已开"）
  assertClose(r0.matrix, [2, 0, 0, 2, -7, -16], '窗未开 ⇒ 组合式作用在 from 上（from = 立即值）');
  const r1 = l2dComposeNode(n, 1_001); // 窗末 ⇒ 吸附到终值
  assertClose(r1.matrix, [2, 0, 0, 2, -7, -16], 'q = (q0 − p)·2 + p + t');

  const p0 = affineApply(r1.matrix, 0, 0);
  assert.equal(p0.x, -7); // (0−10)*2 + 10 + 3
  assert.equal(p0.y, -16); // (0−20)*2 + 20 + 4
  const p1 = affineApply(r1.matrix, 100, 50);
  assert.equal(p1.x, 193); // (100−10)*2 + 10 + 3
  assert.equal(p1.y, 84); // (50−20)*2 + 20 + 4

  // ★`M_base` 里放一个 90° 旋转（轴 = z）：D3D 行向量矩阵 `M11=0, M12=1, M21=−1, M22=0`
  //   ⇒ `Affine` 取转置 = `[0, 1, −1, 0]`。`M_base` 在 `T(−p)` 与 `M_scale` 之间
  //   ⇒ `A = S·R·B`（`B` 是 base）= `2R·B`，`t_eff = A·(−p) + t + p`。
  n.matrixBase = [0, 1, -1, 0, 0, 0];
  const r2 = l2dComposeNode(n, 1_002);
  // R·B：`[0,1,−1,0]·[2,0,0,2] = [0,2,−2,0]` ⇒ A = 2R·B；
  // t_eff = A·(−10,−20) + (3,4) + (10,20) = (−20,40) + (13,24) = (−7,64)…（由实现与 D3DX 一致性保证）
  assertClose(r2.matrix, [0, 2, -2, 0, 53, 4], 'A = S·R·M_base；t_eff = A·(−p) + t + p');
  const rotated = affineApply(r2.matrix, 0, 0);
  assert.ok(Math.abs(rotated.x - 53) < 1e-4, `x = ${rotated.x}`);
  assert.ok(Math.abs(rotated.y - 4) < 1e-4, `y = ${rotated.y}`);
  // 线性部分 = 2·R（各向同性 ⇒ 与 S·R 可交换）；把它的 4 个分量逐位钉住
  assert.ok(Math.abs(r2.matrix[0] - 0) < 1e-4 && Math.abs(r2.matrix[1] - 2) < 1e-4, 'a=0, b=2');
  assert.ok(Math.abs(r2.matrix[2] - -2) < 1e-4 && Math.abs(r2.matrix[3] - 0) < 1e-4, 'c=−2, d=0');
});

test('组合序：什么都没配 ⇒ 逐字节单位阵（TITLE 的零回归就靠这条）', () => {
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  const r = l2dComposeNodeAt(n, 0);
  assert.deepEqual([...n.matrix], [...AFFINE_IDENTITY], '缺省 ⇒ 单位阵');
  assert.equal(r.alpha, 1, '缺省 alpha = 1（`M[46512] = 1000` ⇒ 1.0）');
  const p = affineApply(n.matrix, 123.5, -7.25);
  assert.equal(p.x, 123.5);
  assert.equal(p.y, -7.25);
});

test('`0x346` 复位后：4 块矩阵回单位、窗保留（引擎只写 `+76` 与 4 个矩阵块，raw 133952-134032）', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(3)]);
  run(0x34a, [loc(1), fm(10), fm(20), fm(0)]); // pivot
  run(0x349, [loc(1), fm(5), fm(6), fm(0)]); // 立即平移
  run(0x34b, [loc(1), im(100), im(200), fm(200), fm(200), fm(100)]); // 缩放窗
  const before = nodeOf(e);
  before.wins.color = { delay: 7, dur: 9, from: 0x11223344, to: 0x55667788 };
  run(0x346, [loc(1)]);
  const n = nodeOf(e);
  assert.deepEqual([...n.translate], [0, 0, 0], '`+84..99` 回单位');
  assert.deepEqual([...n.scale], [1, 1, 1], '`+20..35` 回单位');
  assert.deepEqual(n.rotation, { axis: [0, 0, 1], deg: 0 }, '`+52..67` 回单位');
  assert.equal(n.matrixDirty, false, '`+76 = 0`');
  assert.deepEqual([...n.matrixBase], [...AFFINE_IDENTITY], '`+127..142`（M_base）回单位');
  // ★保留项（旧实现用 makeNode 重建 ⇒ 把 wins 也清了，那是偏差）
  assert.deepEqual(n.baseOffset, [10, 20, 0], '`+8..16`（pivot）保留');
  assert.equal(n.slot, 3, '`+4` 保留');
  assert.equal(n.flags & 1, 1, '`record[0]` 保留');
  assert.equal(n.wins.scale.delay, 100, '★`+32` delay 保留（引擎复位不碰 `+28..60`）');
  assert.equal(n.wins.scale.dur, 200, '★`+52` dur 保留');
  assert.deepEqual(n.wins.scale.to, [2, 2, 1], '★`+144` to 保留');
  assert.equal(n.wins.color.delay, 7, '★颜色窗 `+28`/`+48`/`+68`/`+72` 保留');
  assert.equal(n.wins.color.from, 0x11223344);
  assert.equal(n.resets, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 窗求值：四点 + 窗末冻结
// ─────────────────────────────────────────────────────────────────────────────

test('★缩放窗：窗未开 / 中点 / 窗末冻结 / 窗末之后（delay=dur 归零、to 吸附进 from）', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(0)]);
  run(0x34b, [loc(1), im(100), im(200), fm(200), fm(200), fm(100)]); // delay=100 dur=200 scale→(2,2,1)
  const n = nodeOf(e);
  const start = 5_000; // 第一条窗指令把 `+24` 置 0 ⇒ 首次求值锁存 now

  l2dComposeNodeAt(n, start); // 锁存起点（`now = start+0 < start+delay` ⇒ 窗未开）
  assertClose(n.matrix, [1, 0, 0, 1, 0, 0], '窗未开 ⇒ 仍是 from（1,1）');
  assert.equal(n.wins.startedAtMs, start, '`+24` 锁存 now');
  assert.equal(n.flags & 2, 2, '窗没跑完 ⇒ bit1 还在');

  l2dComposeNodeAt(n, start + 99); // 还在 delay 里 ⇒ 不动
  assertClose(n.matrix, [1, 0, 0, 1, 0, 0], 'delay 未过 ⇒ 仍是 from');

  l2dComposeNodeAt(n, start + 200); // 窗内中点：elapsed=100 remaining=100 dur=200
  assertClose(n.matrix, [1.5, 0, 0, 1.5, 0, 0], '线性插值 ⇒ 1.5');

  l2dComposeNodeAt(n, start + 300); // 窗末：now >= start+delay+dur ⇒ 吸附
  assertClose(n.matrix, [2, 0, 0, 2, 0, 0], '窗末冻在终值 2');
  assert.equal(n.wins.scale.delay, 0, '吸附后 delay 归零');
  assert.equal(n.wins.scale.dur, 0, '吸附后 dur 归零');
  assert.deepEqual(n.wins.scale.to, [1, 1, 1], '吸附后 `to ← I`');
  assert.deepEqual([...n.scale], [2, 2, 1], '吸附后 from（= 节点的立即值）← 旧 to');
  assert.equal(n.flags & 2, 0, '全窗跑完 ⇒ `record[0] &= ~2`');
  assert.equal(n.wins.startedAtMs, 0, '全窗跑完 ⇒ `+24 = 0`');

  l2dComposeNodeAt(n, start + 99_999); // 再往后跑不再变化
  assertClose(n.matrix, [2, 0, 0, 2, 0, 0], '窗末之后**冻住**');
});

test('★起点锁存：`+24` 是绝对起点(ms)而不是倒计时 ⇒ 晚锁存 ⇒ 窗也晚开', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(0)]);
  run(0x34b, [loc(1), im(100), im(200), fm(200), fm(200), fm(100)]);
  const n = nodeOf(e);
  l2dComposeNodeAt(n, 1_000); // 起点 = 1000
  l2dComposeNodeAt(n, 1_250); // elapsed = 1250−1000−100 = 150
  assertClose(n.matrix, [1.75, 0, 0, 1.75, 0, 0], '(from*50 + to*150)/200 = 1.75');
  // 再写一次同一条窗指令 ⇒ `+24 = 0` ⇒ 起点重新锁存（raw 134161）
  // ★窗的 from 侧 = 节点**当前的立即缩放**（引擎里 from 与立即值是同一块 `+20`）：此刻节点还是
  //   (1,1,1)（上一轮的终值 2 只在窗的局部变量里，`run(0x34b …)` 会按"当前立即值"重设 from）
  //   ⇒ 新窗是 1 → 4。这正是"窗指令不继承上一轮终值"的口径。
  run(0x34b, [loc(1), im(0), im(200), fm(400), fm(400), fm(100)]);
  assert.equal(n.wins.startedAtMs, 0, '窗指令把 `+24` 置 0');
  assert.equal(n.wins.latched, false, '起点重新待锁存');
  assert.deepEqual(n.wins.scale.from, [1, 1, 1], 'from = 窗指令那一刻的立即缩放');
  assert.deepEqual(n.wins.scale.to, [4, 4, 1]);
  // 同一个 `now` 上再求值：锁存到 5000 ⇒ 窗未开（`now == start` 不算已开）⇒ 仍是 from = 1
  l2dComposeNodeAt(n, 5_000);
  assert.equal(n.wins.startedAtMs, 5_000, '重新锁存到当前 now');
  assertClose(n.matrix, [1, 0, 0, 1, 0, 0], '重新锁存那一帧 ⇒ 窗未开，冻在 from = 1');
  // 窗内中点：(1*100 + 4*100)/200 = 2.5
  l2dComposeNodeAt(n, 5_100);
  assertClose(n.matrix, [2.5, 0, 0, 2.5, 0, 0], '中点 = (1+4)/2 = 2.5');
  // 窗末之后 ⇒ 吸附到 4，并清干净
  l2dComposeNodeAt(n, 5_300);
  assertClose(n.matrix, [4, 0, 0, 4, 0, 0], '窗末之后 ⇒ 冻在 4');
  assert.equal(n.flags & 2, 0, '全窗跑完 ⇒ bit1 清');
  assert.equal(n.wins.startedAtMs, 0, '全窗跑完 ⇒ `+24 = 0`');
});

test('门① `record[0] & 2`：没有窗在跑 ⇒ 只走立即值（矩阵 = 立即缩放·旋转·平移 + pivot 括号）', () => {
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  assert.equal(n.flags & 2, 0, '前置：没有窗在跑');
  l2dNodeBaseOffset(e, KEY, 10, 20, 0);
  l2dNodeTranslate(e, KEY, 3, 4, 0);
  l2dComposeNodeAt(n, 1);
  assertClose(n.matrix, [1, 0, 0, 1, 3, 4], '门① 关闭时组合的是立即值（这里只有平移）');
});

test('★门②：`0x344` 没建过 ⇒ 窗指令被 `winGate` 挡掉 ⇒ 合成结果 = 单位阵', () => {
  const { e, run } = mk();
  run(0x34b, [loc(1), im(100), im(200), fm(200), fm(200), fm(100)]); // 记录被隐式建出，flags = 0
  const n = nodeOf(e);
  assert.equal(n.flags & 1, 0);
  assert.equal(n.flags & 2, 0, '窗记录没写进去');
  l2dComposeNodeAt(n, 1_000);
  assertClose(n.matrix, [1, 0, 0, 1, 0, 0], '窗收不到 ⇒ 合成只能是单位阵');
});

test('`+504` bit0：置位 ⇒ alpha = 0（且**不影响矩阵**）', () => {
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  l2dNodeTranslate(e, KEY, 5, 0, 0);
  const r1 = l2dComposeNodeAt(n, 1);
  assert.equal(r1.alpha, 1);
  // ★alpha 门在**窗块里面**（raw 121290 位于 `if (record[0] & 2)` 之内）⇒ 必须有窗在跑才走到它
  n.flags |= 2;
  n.wins.latched = true;
  n.wins.startedAtMs = 0;
  n.gate504 |= 1;
  const r2 = l2dComposeNodeAt(n, 2);
  assert.equal(r2.alpha, 0, '`+504 bit0` ⇒ 本帧 alpha 强制 0（raw 121290-121293）');
  assertClose(n.matrix, [1, 0, 0, 1, 5, 0], '★alpha 门不影响矩阵');
  const r3 = l2dComposeNodeAt(n, 3, { alphaGateDisabled: true });
  assert.equal(r3.alpha, 1, '`(M[46528] & 4) != 0` ⇒ 关掉该门');
});

test('`winSkip`（`M[46512] == 1`）：4 个窗全部走吸附分支（立即完成）', () => {
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  n.flags |= 2;
  n.wins.startedAtMs = 1_000;
  n.wins.latched = true;
  n.translate = [0, 0, 0];
  n.wins.translation = { delay: 0, dur: 1000, from: [0, 0, 0], to: [50, 0, 0] };
  const r = l2dComposeNode(n, 1_010, { winSkip: true });
  assertClose(r.matrix, [1, 0, 0, 1, 50, 0], 'winSkip ⇒ 直接吸附到终值');
  assert.equal(n.wins.translation.delay, 0);
  assert.equal(n.wins.translation.dur, 0);
  assert.deepEqual([...n.wins.translation.to], [0, 0, 0], '吸附后 `to ← I`');
  assert.deepEqual([...n.translate], [50, 0, 0], '吸附后立即平移 ← 旧 to');
});

test('平移窗中点 + 窗末（三分量逐元素插值）', () => {
  const { e, run } = mk();
  run(0x344, [loc(1), im(0)]);
  run(0x34d, [loc(1), im(0), im(100), fm(100), fm(20), fm(0)]);
  const n = nodeOf(e);
  l2dComposeNodeAt(n, 0);
  l2dComposeNodeAt(n, 50);
  assertClose(n.matrix, [1, 0, 0, 1, 50, 10], 't 线性插值到一半');
  l2dComposeNodeAt(n, 100);
  assertClose(n.matrix, [1, 0, 0, 1, 100, 20], '窗末冻在终值');
  assert.deepEqual([...n.translate], [100, 20, 0], '吸附后立即平移 ← 旧 to');
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 旋转窗：轴角 lerp 后**重算矩阵**
// ─────────────────────────────────────────────────────────────────────────────

test('★旋转窗：轴 (0,0,1)、角 0°→90°，中点是 45°（先 lerp 轴角再重算矩阵）', () => {
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  n.flags |= 2;
  n.wins.startedAtMs = 1_000;
  n.wins.latched = true;
  n.rotation = { axis: [0, 0, 1], deg: 0 };
  n.wins.rotation = { delay: 0, dur: 200, from: { axis: [0, 0, 1], deg: 0 }, to: { axis: [0, 0, 1], deg: 90 } };
  l2dComposeNodeAt(n, 1_100);
  const c = Math.cos(Math.PI / 4);
  const s = Math.sin(Math.PI / 4);
  assertClose(n.matrix, [c, s, -s, c, 0, 0], '45° ⇒ (cos, sin, −sin, cos)');
  // 转置检查（列向量 vs 行向量）：点 (1,0) 应转到 (cos, sin)（y 向下 ⇒ 视觉上是顺时针）
  const p = affineApply(n.matrix, 1, 0);
  assert.ok(Math.abs(p.x - c) < 1e-6 && Math.abs(p.y - s) < 1e-6, `(1,0) → (${p.x},${p.y})`);
});

test('★旋转窗：非单位轴 (0,0,2) —— D3DX **内部归一化**（实测 d3dx9_43.dll）', () => {
  // 判据（不是推断、也不是"猜引擎"）：对**第三方 DLL** `d3dx9_43.dll` 的 `D3DXMatrixRotationAxis`
  // 直接调用（探针 `.tmp/t0096b/d3dx-axis-probe.ps1`）：
  //   轴 (0,0,2)  90°  ⇒ m00≈0 m01=1 m10=−1 m11≈0（与 (0,0,1) **逐位相同**）
  //   轴 (3,0,4)  90°  ⇒ 与 (0.6,0,0.8) **逐位相同**
  // ⇒ .c 里"不 normalize 就传进去"（raw 121504-121517）的净效果 = **归一化**。
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  n.flags |= 2;
  n.wins.startedAtMs = 1_000;
  n.wins.latched = true;
  n.rotation = { axis: [0, 0, 2], deg: 0 }; // 当前值（from 侧 = 窗的起点）
  n.wins.rotation = { delay: 0, dur: 200, from: { axis: [0, 0, 2], deg: 0 }, to: { axis: [0, 0, 2], deg: 90 } };
  l2dComposeNodeAt(n, 1_200); // 终点
  assertClose(n.matrix, [0, 1, -1, 0, 0, 0], '非单位轴也归一化 ⇒ 与 (0,0,1) 相同');
  // 反例（把归一化去掉会得到 [0,4,−4,0]）：直接构造"未归一化"的矩阵证明两者确实不同
  const raw = affineApply([0, 4, -4, 0, 0, 0] as Affine, 1, 0);
  assert.deepEqual([raw.x, raw.y], [0, 4], '（对照）未归一化的轴 (0,0,2) 会把点放大 4 倍');
});

test('旋转窗吸附：from ← to、`to ← I`、delay/dur 归零', () => {
  const e = new Engine(new StubNative(() => {}));
  const n = l2dCreateNode(e, KEY, 0);
  n.flags |= 2;
  n.wins.startedAtMs = 1_000;
  n.wins.latched = true;
  n.rotation = { axis: [1, 0, 0], deg: 0 };
  n.wins.rotation = { delay: 0, dur: 10, from: { axis: [1, 0, 0], deg: 0 }, to: { axis: [0, 1, 0], deg: 90 } };
  l2dComposeNodeAt(n, 1_010); // now >= start + delay + dur ⇒ 吸附
  assert.deepEqual(n.wins.rotation.from, { axis: [0, 1, 0], deg: 90 }, 'from ← 旧 to');
  assert.deepEqual(n.wins.rotation.to, { axis: [0, 0, 1], deg: 0 }, 'to ← I');
  assert.equal(n.wins.rotation.delay, 0);
  assert.equal(n.wins.rotation.dur, 0);
  assert.equal(n.flags & 2, 0, '全窗跑完 ⇒ bit1 清掉');
  assert.equal(n.wins.startedAtMs, 0, '`+24 = 0`');
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 颜色窗（窗1）：插值按**字节**、吸附有副作用（输出无消费者）
// ─────────────────────────────────────────────────────────────────────────────

test('★颜色窗：`0xAARRGGBB` 逐字节整数插值（依据 = `sub_49CA10` 的初值 0xFF000000 + `.lst` 的 HIBYTE）', () => {
  const w: L2dColorWindow = { delay: 0, dur: 200, from: 0x11223344, to: 0x55667788 };
  // `0xAARRGGBB`：字节 +0 = B 0x44→0x88、+1 = G 0x33→0x77、+2 = R 0x22→0x66、+3 = A 0x11→0x55
  assert.equal(colorAlpha(0x11223344), 0x11, '最高字节 = A（`0xFF000000` 是"不透明的黑"）');
  assert.equal(colorRed(0x11223344), 0x22);
  assert.equal(colorGreen(0x11223344), 0x33);
  assert.equal(colorBlue(0x11223344), 0x44);
  assert.equal(packColor(0x11, 0x22, 0x33, 0x44), 0x11223344, 'packColor 与分量函数互逆');

  const mid = advanceColorWindow(w, 1_000, 1_100, false);
  assert.equal(mid.state, 'inside');
  assert.equal(mid.color, 0x33445566, '中点 = ((to+from)/2) 逐字节，截断取整');
  // 权重口径（from 权 = remaining/dur、to 权 = elapsed/dur）—— 1/4 处应是 from*0.75 + to*0.25
  const w2: L2dColorWindow = { delay: 0, dur: 400, from: 0x00000000, to: 0xff000000 };
  // 最高字节 = A：from.A = 0、to.A = 0xff，1/4 处 ⇒ trunc(255*0.25) = 63 = 0x3f
  assert.equal(advanceColorWindow(w2, 0, 100, false).color, 0x3f000000, 'A 通道 = trunc(255/4) = 0x3f');
});

test('★颜色窗吸附的**副作用**（可观测）：delay/dur 归零、from ← to、to ← 0xFFFFFFFF、返回旧 to', () => {
  const w: L2dColorWindow = { delay: 5, dur: 100, from: 0x11223344, to: 0x55667788 };
  const r = advanceColorWindow(w, 1_000, 1_200, false);
  assert.equal(r.state, 'absorb');
  assert.equal(r.color, 0x55667788, '*a4 = 旧 to（★调用方 raw 134347 会丢弃它）');
  assert.equal(w.delay, 0, '副作用：delay 归零');
  assert.equal(w.dur, 0, '副作用：dur 归零');
  assert.equal(w.from, 0x55667788, '副作用：from ← 旧 to');
  assert.equal(w.to, 0xffffffff, '副作用：to ← 0xFFFFFFFF（`.c` 的 `a2[18] = NAN` = 位模式 FFFFFFFF）');
  // ★为什么必须断言这些：唯一调用方丢弃 `*a4`（raw 134347），但上面 4 个副作用**留在记录里**
  // ⇒ "引擎丢弃结果"**不等于**"函数无副作用"⇒ 不能整块忽略（用户裁定）。
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 合成指令驱动 + 场景级不变量（快照 rect 同源）
// ─────────────────────────────────────────────────────────────────────────────

/** 一个网格（无变形器 ⇒ 顶点就是文件里那一组）。 */
function drawable(pts: number[]): MocDrawData {
  const n = pts.length / 2;
  const uvs: number[] = [];
  for (let i = 0; i < n; i++) uvs.push(0, 0);
  const indices: number[] = [];
  for (let i = 1; i + 1 < n; i++) indices.push(0, i, i + 1);
  return {
    kind: 'drawData',
    id: { kind: 'id', idClass: 'draw', name: 'D_A' },
    targetId: null,
    pivotManager: { params: [] },
    averageDrawOrder: 0,
    pivotDrawOrders: [0],
    pivotOpacities: [1],
    clipId: null,
    textureNo: 0,
    pointCount: n,
    polygonCount: indices.length / 3,
    indexArray: indices,
    pivotPoints: [pts],
    uvs,
    optionFlag: 0,
    colorGroupNo: null,
    colorCompositionType: 0,
    culling: true,
  };
}

/** 画布 100×50，一个部件一个网格：(0,0)-(100,50) 的矩形 ⇒ 便于断言位移。 */
function rectModel(): MocModel {
  return {
    kind: 'model',
    params: [],
    canvasWidth: 100,
    canvasHeight: 50,
    parts: [
      {
        kind: 'parts',
        locked: false,
        visible: true,
        id: { kind: 'id', idClass: 'parts', name: 'P' },
        deformers: [],
        drawables: [drawable([0, 0, 100, 0, 0, 50, 100, 50])],
      },
    ],
    stats: { version: 10, objects: 0, byTag: {}, bytesRead: 0, bytesTotal: 0, eofMarker: true },
  };
}

test('★合成指令 → 场景级不变量：`scL2dTick` 推进节点矩阵，快照 `rect` 整体平移且**不变形**', () => {
  const hs = newHeadless();
  const { e, run, setInt } = mk();
  hs.scene.l2dHost = e;
  l2dLoadModel(e, 0, 0x100, rectModel());
  setInt(1, KEY);
  run(0x344, [loc(1), im(0)]); // 建节点（slot = 0）
  run(0x349, [loc(1), fm(30), fm(15), fm(0)]); // 立即平移 (30,15)

  const before = scSnapshot(hs.scene, 0, e).l2d!.nodes[0]!;
  // 画布 100×50、视口 1280×720 ⇒ 居中平移 = ((1280−100)/2, (720−50)/2) = (590, 335)
  assert.deepEqual(before.rect, { x: 590, y: 335, w: 100, h: 50 }, '基线（含画布居中平移）');

  scL2dTick(hs.scene, 0); // 首帧：delta = 0，但合成器**必须**跑（窗起点锁存的同一条理由）
  const after = scSnapshot(hs.scene, 0, e).l2d!.nodes[0]!;
  assert.equal(after.rect!.w, 100, '★只平移、不变形（宽不变）');
  assert.equal(after.rect!.h, 50, '★只平移、不变形（高不变）');
  assert.equal(after.rect!.x, 620, 'rect 整体 +30');
  assert.equal(after.rect!.y, 350, 'rect 整体 +15');
  assert.deepEqual([...nodeOf(e).matrix], [1, 0, 0, 1, 30, 15], '节点矩阵 = T(t)（pivot = 0）');
});

test('★场景级：窗在跑时 `rect` 逐帧移动、窗末停住、之后不再变化', () => {
  const hs = newHeadless();
  const { e, run } = mk();
  hs.scene.l2dHost = e;
  l2dLoadModel(e, 0, 0x100, rectModel());
  run(0x344, [loc(1), im(0)]);
  run(0x34d, [loc(1), im(0), im(100), fm(100), fm(0), fm(0)]); // 平移窗：100ms 到 +100
  const batchX = (): number => l2dBatches(e, 1280, 720)[0]!.rect.x;

  scL2dTick(hs.scene, 1_000); // 锁存起点 = 1000
  assert.equal(batchX(), 590, '窗未开 ⇒ 不动（只有画布居中平移）');
  scL2dTick(hs.scene, 1_050);
  assert.equal(batchX(), 640, '中点 ⇒ +50');
  scL2dTick(hs.scene, 1_100);
  assert.equal(batchX(), 690, '窗末 ⇒ +100（冻在终值）');
  scL2dTick(hs.scene, 9_999);
  assert.equal(batchX(), 690, '窗末之后不再变化');
});

/**
 * ★**零回归（E3）**：TITLE 的真资产。
 *
 * `src/TITLE.txt` 对 L2D 只用两条指令 —— `:554 i34e 5274 0 0 1`（装动作）与
 * **`:590 i344 14 0`**（建节点，slot = 0）—— **没有任何** `0x346`-`0x34D`
 * ⇒ 节点矩阵必然 = 单位阵 ⇒ 出画几何必须与"矩阵全为单位阵"时**逐字节相同**。
 *
 * 这是"接上消费端"这件事的**唯一**可无条件完成的 E3（真实资源 = `raw-parts/DATA6/TITLE.MOC`；
 * 缺资源时 `skip` 并说明，不假装跑过）。判据 = 同一个节点在**跑过合成器之后**的批次与
 * **手工把 `node.matrix` 置回单位阵**时的批次逐字节相等 —— 也就是"合成器对 TITLE 什么都没改"。
 */
test('★E3 零回归：TITLE 真资产下节点矩阵 = I ⇒ 批次几何与单位阵逐字节相同', async (t) => {
  const root = ['raw', 'install'].map((c) => path.join(ROOT, c)).find((d) => fs.existsSync(path.join(d, 'SYS4INI.BIN')));
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根（raw/ 或 install/）—— 本机未装原始资源');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  const e = mkEngine();
  e.fileSource = src;
  const asrc: Live2dAssetSource = { loadById: (id) => src.readById(id) };
  const model = await loadModelIntoSlot(asrc, e, 0x4f9e, 0, () => {}); // TITLE.MOC = 0x4f9e
  assert.ok(model, '应能解析 TITLE.MOC');
  for (const [no, id] of Object.entries({ 0: 0x4f9f, 1: 0x4fa0, 2: 0x4fa1 })) {
    l2dBindTexture(e, 0, Number(id), Number(no));
  }
  l2dCreateNode(e, 0x14, 0); // = TITLE.txt:590 的 `i344 14 0`

  const hs = newHeadless();
  hs.scene.l2dHost = e;
  scL2dTick(hs.scene, 0); // 跑一遍合成器（TITLE 没有窗指令 ⇒ 矩阵必须是 I）
  const n = nodeOf(e, 0x14);
  assert.deepEqual([...n.matrix], [...AFFINE_IDENTITY], 'TITLE 没有变换指令 ⇒ 节点矩阵 = 单位阵');
  assert.equal(n.matrixDirty, false, '`+76` 没被任何指令置过');

  const withCompose = l2dBatches(e, 1280, 720);
  n.matrix = AFFINE_IDENTITY; // 手工置回单位阵（= 旧实现的恒等路径）
  const identity = l2dBatches(e, 1280, 720);
  assert.equal(withCompose.length, identity.length, '批次数一致');
  for (let i = 0; i < withCompose.length; i++) {
    const a = withCompose[i]!;
    const b = identity[i]!;
    assert.equal(a.id, b.id);
    assert.deepEqual([...a.positions], [...b.positions], `批次 ${a.id} 的顶点逐字节相同`);
    assert.deepEqual(a.rect, b.rect, `批次 ${a.id} 的 rect 逐字节相同`);
  }
  await src.dispose?.();
});

/** 一个挂了独立 `Engine` 的无头场景（`scene` 是它的共享 `SceneState`）。 */
function newHeadless(): HeadlessScene {
  return new HeadlessScene({});
}
