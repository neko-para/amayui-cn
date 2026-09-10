/**
 * 回归测试：**DrawItem 的 5 个动画窗**（引擎 `Scene+1032` 的 740 字节元素）。
 *
 * 引擎事实（raw 证据见 `.tmp/re-draw-container.md` §4、`.tmp/re-color-transform.md` §1.4）：
 *  - DrawItem 有 **5 个窗**，每个只有 `delay` / `dur` 两个字段：
 *      `+0x38/+0x4C` 颜色(0x202) · `+0x3C/+0x50` 缩放(0x21E) · `+0x40/+0x54` 旋转(0x21F) ·
 *      `+0x44/+0x58` 平移(0x220) · `+0x48/+0x5C` flipbook(0x239)；
 *  - **起点只有一份**：`+0x34` 全项共享；任一 setter 把它写 0（raw 131970/132002/132047/132099/132134），
 *    由驱动首帧锁存时钟（raw 117437-117438）；
 *  - 窗末**一次性收尾**：`work ← target`（缩放 raw 117496、旋转 117550、平移 117646、flipbook 117831）；
 *  - `dur == 0` 但"配置过" ⇒ 当帧即收尾（与"从未配置"必须区分）；
 *  - flipbook 改的是**源矩形**（不是 UV）：`frame = frames·t`、`col = frame % cols`、`row = frame / cols`，
 *    偏移 `(col·srcW, row·srcH)`（raw 117797-117804）；窗末 `fbFlags & 1` ⇒ 保持末帧。
 *
 * 被测对象是纯模型层 `src/renderer/drawItem.ts`（不依赖 Pixi / DOM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceWindows,
  applyDrawColor,
  applyDrawColorAlpha,
  applyDrawPivot,
  applyDrawPos,
  applyFlipbook,
  applyRotationAnim,
  applyScaleAnim,
  applyTranslationAnim,
  itemColor,
  itemRotationRad,
  itemScale,
  itemSrcRect,
  itemTranslation,
  makeItem,
  type Item,
} from '../src/renderer/drawItem.js';

/** 一个绘制项：handle=100、槽=7、源 16×16 @(32,48)、目标 (400,300)。 */
function newItem(): Item {
  return makeItem({ handle: 100, layer: 100, tex: 7, srcX: 32, srcY: 48, srcW: 16, srcH: 16, dstX: 400, dstY: 300 });
}

/** 一次"帧"：推进窗 → 取各窗结果（模拟 present 的顺序）。 */
function frame(it: Item, clock: number) {
  advanceWindows(it, clock);
  return {
    color: itemColor(it, clock),
    scale: itemScale(it, clock),
    rotRad: itemRotationRad(it, clock),
    trans: itemTranslation(it, clock),
    src: itemSrcRect(it, clock),
    pending: (it.flags & 2) !== 0,
  };
}

const near = (a: number, e: number, msg: string) => assert.ok(Math.abs(a - e) < 1e-6, `${msg}: got ${a}, want ${e}`);

test('缩放窗（0x21E）：delay 期保持 work，窗内插值，窗末 work ← target', () => {
  const it = newItem();
  applyScaleAnim(it, 100, 200, 2, 3, 1); // delay=100 dur=200 → 2x/3x

  frame(it, 1000); // 首帧锁存 animStart = 1000
  near(frame(it, 1050).scale.x, 1, 'delay 期内保持 work（1）');
  near(frame(it, 1200).scale.x, 1.5, 'delay+dur 中点：1 → 2 的 50%');
  near(frame(it, 1200).scale.y, 2, '1 → 3 的 50%');
  near(frame(it, 1200).scale.z, 1, 'z 不变');
  const done = frame(it, 1300);
  near(done.scale.x, 2, '窗末冻结在 target.x');
  near(done.scale.y, 3, '窗末冻结在 target.y');
  assert.equal(done.pending, false, '全部窗结束后清动画位（flags & 2）');
});

test('dur=0 但配置过 ⇒ 当帧即收尾（与"从未配置"区分）', () => {
  const it = newItem();
  applyScaleAnim(it, 0, 0, 4, 4, 1);
  const s = frame(it, 500);
  near(s.scale.x, 4, '零时长窗：立即 work ← target');
  assert.equal(s.pending, false);
  near(frame(it, 501).scale.x, 4, '收尾后保持 target');
});

test('平移动画窗（0x220）与旋转窗（0x21F）：延迟期保持 work、窗内插值 + 角度按度→弧度', () => {
  const it = newItem();
  applyDrawPos(it, 10, 20, 0); // DrawItem +0x24/+0x28/+0x2C
  applyTranslationAnim(it, 100, 200, 5, -7, 0);
  applyRotationAnim(it, 100, 200, 0, 0, 1, 90);
  frame(it, 1000); // 锁存（delay 100 ⇒ 窗自 1100 起）
  const before = frame(it, 1050);
  near(before.trans.x, 0, 'delay 期保持 work（0）');
  near(before.rotRad, 0, 'delay 期保持 work 角（0°）');
  const s = frame(it, 1200); // t = (1200−1100)/200 = 0.5
  near(s.trans.x, 2.5, '0 → 5 的 50%');
  near(s.trans.y, -3.5, '0 → −7 的 50%');
  near(s.rotRad, Math.PI / 4, '起角 0°（work）→ 止角 90° 的 50% = 45°');
  const done = frame(it, 1300); // 窗末 ⇒ work ← target
  near(done.trans.x, 5, '平移窗末冻结在 target');
  near(done.rotRad, Math.PI / 2, '旋转窗末冻结在 90°');
});

test('旋转窗起止角：work 角可被先前的 setter 留下（本例直接设 rotWork）', () => {
  const it = newItem();
  it.rotWork = { axis: { x: 0, y: 0, z: 1 }, deg: 30 };
  applyRotationAnim(it, 0, 100, 0, 0, 1, 90);
  frame(it, 1000);
  near(frame(it, 1050).rotRad, ((60 * Math.PI) / 180), '30° → 90° 的 50% = 60°');
});

test('flipbook 窗（0x239）：帧序号推进改的是**源矩形**，窗末按 fbFlags bit0 保持末帧', () => {
  const it = newItem(); // 源 16×16 @(32,48)
  applyFlipbook(it, 0, 300, 6, 3, 1); // 6 帧、每行 3 列 ⇒ 2 行
  frame(it, 1000); // 锁存
  let s = frame(it, 1150); // t = 0.5 ⇒ frame = 3 ⇒ row1 col0
  assert.deepEqual(s.src, { x: 32, y: 64, w: 16, h: 16 }, 'frame 3 = row1 col0');
  s = frame(it, 1270); // t ≈ 0.9 ⇒ frame = 5 ⇒ row1 col2
  assert.deepEqual(s.src, { x: 64, y: 64, w: 16, h: 16 }, 'frame 5 = row1 col2');
  s = frame(it, 1400); // 窗末（bit0 = 保持末帧）⇒ frame = frames−1 = 5
  assert.deepEqual(s.src, { x: 64, y: 64, w: 16, h: 16 }, '窗末保持末帧');
});

test('flipbook 窗末且 fbFlags bit0 = 0 ⇒ 源矩形复位', () => {
  const it = newItem();
  applyFlipbook(it, 0, 300, 6, 3, 0);
  frame(it, 1000);
  const s = frame(it, 1400);
  assert.deepEqual(s.src, { x: 32, y: 48, w: 16, h: 16 }, '复位到 draw-texture 的源矩形');
});

test('颜色窗（0x202/0x203）：窗内按引擎整数式插值，窗末冻结 from = to 并可被 0x203 覆盖', () => {
  const it = newItem();
  applyDrawColorAlpha(it, 0x00ffffff); // 0x203：工作色 = 透明白
  applyDrawColor(it, 0, 200, 0xffffffff); // 0x202：delay 0 / dur 200 / TO = 不透明白
  frame(it, 1000); // 锁存
  // ★引擎是整数除法（截断）不是四舍五入：we=100、left=100、dur=200 ⇒ 100/200 → 127
  assert.equal((frame(it, 1100).color >>> 24) & 0xff, 127, 'alpha 0 → 255 的中点 = 127（截断，非 128）');
  assert.equal(frame(it, 1200).color >>> 0, 0xffffffff, '窗末冻结在 TO');
  assert.equal(frame(it, 1200).pending, false);
  applyDrawColorAlpha(it, 0x80ff0000); // hover：0x203 直接改工作色
  assert.equal(frame(it, 1210).color >>> 0, 0x80ff0000, '0x203 设的工作色即时生效');
});

test('颜色窗的整数公式逐项复刻引擎（raw 117466-117479）：ch = (left·from + we·to)/dur，整数截断', () => {
  // 用 4 个通道都不同的颜色，逐通道验算
  const it = newItem();
  applyDrawColorAlpha(it, 0x0102_0304 & 0xffffffff); // FROM
  applyDrawColor(it, 0, 100, 0xc0_d0_e0_f0 & 0xffffffff); // TO
  frame(it, 500); // 锁存
  // 逐通道独立验算（B/G/R/A），we = 30、left = 70、dur = 100
  const expect = '0x' + [0, 8, 16, 24]
    .map((sh) => {
      const a = (0x0102_0304 >>> sh) & 0xff;
      const b = (0xc0_d0_e0_f0 >>> sh) & 0xff;
      return Math.floor(((100 - 30) * a + 30 * b) / 100)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
  const got = '0x' + [0, 8, 16, 24].map((sh) => (((frame(it, 530).color >>> sh) & 0xff).toString(16).padStart(2, '0'))).join('');
  assert.equal(got, expect, 'B/G/R/A 四通道都应等于 (left·from + we·to)/dur 的截断值');

  // 截断 vs 四舍五入的分界：from=0、to=255、dur=2、we=1 ⇒ 127（四舍五入会得 128）
  const it2 = newItem();
  applyDrawColorAlpha(it2, 0x00000000);
  applyDrawColor(it2, 0, 2, 0xff000000);
  frame(it2, 1000);
  assert.equal((frame(it2, 1001).color >>> 24) & 0xff, 127, '中点必须是 127（证明是截断）');
});

test('共享起点：任一 setter 把 +0x34 清 0 ⇒ 所有窗从同一帧重新计时', () => {
  const it = newItem();
  applyScaleAnim(it, 0, 100, 2, 2, 1);
  frame(it, 1000); // 窗1 锁存于 1000
  near(frame(it, 1050).scale.x, 1.5, '缩放已到中点');

  applyDrawColor(it, 0, 100, 0xffffffff); // setter 写 animStart = 0
  frame(it, 1100); // 本帧重新锁存
  near(frame(it, 1150).scale.x, 1.5, '重新锁存后 0.5 处仍是 1.5（起点被共享/重置）');
  near(frame(it, 1190).scale.x, 1.9, '接近窗末');
});

test('0x217 / 0x219 是**两个不同的 float 三元组**：pivot 与描画位置互不覆盖', () => {
  const it = newItem();
  applyDrawPivot(it, 8, 9, 0); // +0x18/+0x1C/+0x20
  applyDrawPos(it, 111, 222, 0); // +0x24/+0x28/+0x2C
  assert.deepEqual([it.pivotX, it.pivotY, it.pivotZ], [8, 9, 0], 'pivot 不被描画位置覆盖');
  assert.deepEqual([it.posX, it.posY, it.posZ], [111, 222, 0], '描画位置不被 pivot 覆盖');
});

test('makeItem：纹理槽取 draw-texture 的 op2，描画位置初值 = draw-texture 的 op7/op8', () => {
  const it = newItem();
  assert.equal(it.tex, 7, '纹理槽号来自 op2（不是 handle）');
  assert.equal(it.handle, 100);
  assert.deepEqual([it.posX, it.posY], [400, 300], '未由 0x219 写入时退回 op7/op8');
  assert.equal(it.flags, 1, 'bit0 = 已创建（sub_4ACE50 raw 131826）');
  assert.equal(it.from, 0xffffffff);
});
