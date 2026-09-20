/**
 * **引擎 740 B DrawItem 记录 → emulator `Item` 的逐字段守卫**（`tickets/T-0083`）。
 *
 * 为什么要有它：读档画面的正确性全靠这一层 —— 引擎存档里带的是**场景自己的绘制项清单**
 * （`sub_410160` raw 19806-19832），解错一个偏移就会静默画错（不会报错）。这里用一条**手写得处处不同**
 * 的 740 B 记录，把每个映射到的字段逐个钉住；并且**故意在对角线/平移分量旁边放"诱饵值"**，
 * 用来钉住两处容易读错的地方：
 *
 *  1. 4×4 矩阵要按 D3DX 语义取分量（缩放取**对角线** `+0/+20/+40`、平移取**第 4 行** `+48/+52/+56`），
 *     不是"从基址起连续 3 个 f32"；
 *  2. B 层 5 条通道的 `start`/`period` 是 `+524+4i` / `+544+4i`（**步长 4**），不是 8。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ENGINE_DRAW_ITEM_BYTES, decodeEngineDrawItem } from '../src/vm/engineDrawItem.js';
import { W_COLOR, W_FLIPBOOK, W_ROT, W_SCALE, W_TRANS } from '../src/renderer/drawItem.js';
import { newDrawItemRecord } from './engineSlotFixtures.js';

/** 手写一条 740 B 记录：每个映射字段都取互不相同的值，两个"陷阱位"放诱饵。 */
function handWrittenRecord(): Uint8Array {
  const rec = newDrawItemRecord();
  const dv = new DataView(rec.buffer);
  const i = (at: number, v: number): void => dv.setInt32(at, v, true);
  const u = (at: number, v: number): void => dv.setUint32(at, v >>> 0, true);
  const f = (at: number, v: number): void => dv.setFloat32(at, v, true);
  u(0x0, 0b111); // flags：bit0 可见 / bit1 A 层窗 / bit2 B 层周期
  i(0x4, 0x2a); // tex
  i(0x8, 10); // src left
  i(0xc, 20); // src top
  i(0x10, 74); // src right ⇒ srcW = 64
  i(0x14, 120); // src bottom ⇒ srcH = 100
  f(0x18, 1.5); // pivot
  f(0x1c, -2.5);
  f(0x20, 3.5);
  f(0x24, -768); // pos
  f(0x28, -272);
  f(0x2c, 0.25);
  i(0x30, 2); // blend
  u(0x34, 0x13c0eb57); // animStart（引擎时钟绝对值）
  // 5 个窗：delay +0x38+4i / dur +0x4C+4i；第 3 个窗（下标 2）留 0 ⇒ 未配置
  i(0x38, 11);
  i(0x3c, 12);
  i(0x40, 0);
  i(0x44, 14);
  i(0x48, 15);
  i(0x4c, 21);
  i(0x50, 22);
  i(0x54, 0);
  i(0x58, 80000); // 序章那条 80 s 慢推
  i(0x5c, 25);
  u(0x60, 0x80ff0000); // from
  u(0x64, 0xff00ff00); // to
  u(0x68, 1); // useWorld
  // 缩放矩阵（work @0x6C / target @0xAC）：对角线在 +0/+20/+40，其余位置放诱饵
  f(0x6c, 1.25);
  f(0x70, 9.75); // ★诱饵：连续 3 f32 的错读会取到它
  f(0x74, 9.5);
  f(0x80, 1.5);
  f(0x94, 1.75);
  f(0xac, 2);
  f(0xb0, 8.75); // ★诱饵
  f(0xc0, 2.5);
  f(0xd4, 3);
  // 平移矩阵（work @0x16C / target @0x1AC）：平移分量在 +48/+52/+56 = +0x19C/+0x1A0/+0x1A4
  f(0x16c, 100); // ★诱饵：矩阵基址上的第一个 f32 并不是平移分量
  f(0x19c, -768);
  f(0x1a0, -272);
  f(0x1a4, 5);
  f(0x1ac, 200); // ★诱饵
  f(0x1dc, 768);
  f(0x1e0, 0);
  f(0x1e4, 6);
  i(0x234, 1); // fbFlags
  i(0x238, 12); // fbFrames
  i(0x23c, 4); // fbCols
  // B 层 5 条通道：start +524+4i / period +544+4i（★步长 4）
  [1, 2, 3, 4, 5].forEach((v, k) => i(524 + 4 * k, v));
  [101, 102, 103, 104, 105].forEach((v, k) => i(544 + 4 * k, v));
  u(576, 0xff00ff00); // loopTo
  f(580, 0);
  f(584, 1);
  f(588, 0); // loopAxis
  f(592, 0.5);
  f(596, 7.75); // ★诱饵
  f(612, 0.75);
  f(632, 1.25); // loopScale 对角线（取 f32 可精确表示的值，免得比较被舍入干扰）
  f(656, 77); // ★诱饵
  f(704, 7);
  f(708, 8);
  f(712, 9); // loopTrans 平移分量
  i(720, 1); // entryParam
  return rec;
}

test('★740 B DrawItem 记录逐字段解出（含矩阵分量与 B 层步长两处陷阱）', () => {
  const rec = handWrittenRecord();
  assert.equal(rec.length, ENGINE_DRAW_ITEM_BYTES);
  const it = decodeEngineDrawItem(0x18a88, rec);

  // key / 记账
  assert.equal(it.handle, 0x18a88, 'handle 取清单里的 key（记录体里不存 handle）');
  assert.equal(it.layer, 0x18a88, '层序 = handle');
  assert.equal(it.ownerFrame, -1, 'emulator 记账：还原出来的项不属于本进程任何帧');

  // 标量
  assert.equal(it.flags, 0b111);
  assert.equal(it.tex, 0x2a);
  assert.deepEqual(
    [it.srcX, it.srcY, it.srcW, it.srcH],
    [10, 20, 64, 100],
    '★源矩形在元素里是 left/top/right/bottom ⇒ 宽高是差（引擎口径）',
  );
  assert.deepEqual([it.pivotX, it.pivotY, it.pivotZ], [1.5, -2.5, 3.5]);
  assert.deepEqual([it.posX, it.posY, it.posZ], [-768, -272, 0.25]);
  assert.equal(it.dstX, -768, 'dstX/dstY 仅诊断 = 描画位置');
  assert.equal(it.dstY, -272);
  assert.equal(it.blend, 2);
  assert.equal(it.animStart, 0x13c0eb57, '★animStart 是引擎时钟绝对值（逐字还原，见模块注释的缺口）');
  assert.equal(it.from, 0x80ff0000);
  assert.equal(it.to, 0xff00ff00);
  assert.equal(it.useWorld, true);
  assert.equal(it.entryParam, 1);
  assert.equal(it.fbFlags, 1);
  assert.equal(it.fbFrames, 12);
  assert.equal(it.fbCols, 4);
  assert.equal(it.fbHold, -1, 'emulator 侧的每帧持久化 ⇒ 无对应字节，保持默认');

  // 5 个窗（下标 = 引擎的 5 个窗：颜色/缩放/旋转/平移/flipbook）
  assert.deepEqual(
    it.wins.map((w) => [w.delay, w.dur, w.set]),
    [
      [11, 21, true],
      [12, 22, true],
      [0, 0, false], // ★"从未配置"必须与"配置过但 dur = 0"区分
      [14, 80000, true],
      [15, 25, true],
    ],
  );

  // 矩阵分量（★两处陷阱）
  assert.deepEqual(it.scaleWork, { x: 1.25, y: 1.5, z: 1.75 }, '★缩放取对角线 +0/+20/+40，不是连续 3 f32');
  assert.deepEqual(it.scaleTarget, { x: 2, y: 2.5, z: 3 });
  assert.deepEqual(it.transWork, { x: -768, y: -272, z: 5 }, '★平移取第 4 行 +48/+52/+56，不是基址起 3 f32');
  assert.deepEqual(it.transTarget, { x: 768, y: 0, z: 6 });

  // B 层（★步长 4）
  assert.deepEqual(
    it.loops.map((l) => [l.start, l.period]),
    [
      [1, 101],
      [2, 102],
      [3, 103],
      [4, 104],
      [5, 105],
    ],
    '★start/period = +524+4i / +544+4i（步长 4）',
  );
  assert.equal(W_COLOR, 0);
  assert.equal(W_SCALE, 1);
  assert.equal(W_ROT, 2);
  assert.equal(W_TRANS, 3);
  assert.equal(W_FLIPBOOK, 4);
  assert.equal(it.loopTo, 0xff00ff00);
  assert.deepEqual(it.loopAxis, { x: 0, y: 1, z: 0 }, '旋转轴是连续 3 f32（+580/584/588，与矩阵不同）');
  assert.deepEqual(it.loopScale, { x: 0.5, y: 0.75, z: 1.25 });
  assert.deepEqual(it.loopTrans, { x: 7, y: 8, z: 9 });

  // 有意不还原的字段（留名，不猜）
  assert.deepEqual(it.rotWork, { axis: { x: 0, y: 0, z: 0 }, deg: 0 }, '旋转矩阵/轴角的逐字段偏移未确证 ⇒ 不还原');
  assert.deepEqual(it.rotTarget, { axis: { x: 0, y: 0, z: 0 }, deg: 0 });
});

test('740 B 记录里全 0 ⇒ 与 `makeItem` 的默认同形（`flags = 0` ⇒ 不画）', () => {
  const it = decodeEngineDrawItem(7, newDrawItemRecord());
  assert.equal(it.flags, 0);
  assert.equal(it.tex, 0);
  assert.deepEqual([it.srcX, it.srcY, it.srcW, it.srcH], [0, 0, 0, 0]);
  assert.deepEqual(it.scaleWork, { x: 0, y: 0, z: 0 }, '全 0 矩阵 ⇒ 缩放 0（引擎的"未配置"就是这个形状）');
  assert.equal(it.useWorld, false);
  assert.equal(it.from, 0, '全 0 ⇒ from/to = 0（引擎 `sub_49A300` 会写 −1，夹具不做这层默认）');
  assert.ok(
    it.wins.every((w) => !w.set) && it.loops.every((l) => l.start === 0 && l.period === 0),
    '五个窗/五条 B 层通道都未配置',
  );
});

test('长度不是 740 的记录必须显式抛（调用方要先按 `size === 740` 守卫）', () => {
  assert.throws(() => decodeEngineDrawItem(1, new Uint8Array(739)), /长度 739/);
});
