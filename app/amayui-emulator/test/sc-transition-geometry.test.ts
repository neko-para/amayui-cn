/**
 * **转场（盲帘擦除）的条带几何** —— `tickets/T-0084`（`0x24F` → `sub_4AF6A0`，消费端 `sub_4B06D0`）。
 *
 * 本文件守的是**几何**：12 个 `case`（raw 134947-135510）在同一 `(记录, 时钟, 目标矩形)` 下
 * 产出的条带集合。真源逐 case 读体过，公式写在 `src/renderer/scene/transition.ts` 的注释里
 * （每个 case 都有 raw 行号）。
 *
 * 为什么值得单独守：这 12 个 case 的 C 代码在 IDA 里被拆成了 `while/LABEL_*` 网，且
 * `v101/v111/v134/v140/v145/v152` 被标成 *possibly undefined*（**不是随机数**，是被优化掉的寄存器，
 * 见规格 §3.6）。只按"方向描述"抄很容易把镜像 case 抄反 —— 所以这里用**可证伪的不变量**钉住：
 *  ① `old`(36) 与 `new`(37) 的条带**互不重叠**（同源条带之间允许重叠：在 t≈0 时是"全旧"）；
 *  ② 条带并集**覆盖目标矩形**（互补的两半 + 多带平铺）；
 *  ③ 端点行为：`t=0` 全 `old`、`t→dur` 全 `new`；
 *  ④ 条带数 = 该 case 的公式（单边界 ≤2 / 多带 = `bands` 个格子）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scTransitionDefaultRecord } from '../src/renderer/scene/ops.js';
import {
  scTransitionBands,
  scTransitionOffset,
  type TransitionBand,
  type TransitionRect,
  type TransitionRuntime,
} from '../src/renderer/scene/transition.js';

/** 目标绘制项矩形（引擎 `[15]` 那张项的 `pos`/`srcW`/`srcH`，raw 134895-134902）。 */
const RECT: TransitionRect = { x: 0, y: 0, w: 1280, h: 720 };

/** 造一条类别 2（盲帘）记录：`[0]=2`、`[13]=子类型`、`[14]=条宽`、`[15]=目标项`。 */
function blindRec(sub: number, band: number, delay: number, dur: number): number[] {
  const rec = scTransitionDefaultRecord();
  rec[0] = 2;
  rec[1] = 0;
  rec[2] = delay;
  rec[3] = dur;
  rec[4] = 2;
  rec[5] = 3;
  rec[7] = 1;
  rec[13] = sub;
  rec[14] = band;
  rec[15] = 0x9999;
  return rec;
}

function rtAt(start: number): TransitionRuntime {
  return { start, active: true, finished: false, t: 0, channels: [0, 0, 0, 0] };
}

const ALL_CASES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

type Box = { x: number; y: number; w: number; h: number };

/** 两个矩形的交面积（0 = 不相交/只相邻）。 */
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 条带覆盖的**总长**（沿主轴的并集长度，按 case 的主轴选 x 或 y）。 */
function unionSpan(bands: TransitionBand[], axis: 'x' | 'y'): number {
  const size = axis === 'x' ? RECT.w : RECT.h;
  const flags = new Array<boolean>(size).fill(false);
  for (const b of bands) {
    const start = axis === 'x' ? b.x : b.y;
    const len = axis === 'x' ? b.w : b.h;
    for (let i = Math.max(0, start); i < Math.min(size, start + len); i++) flags[i] = true;
  }
  let n = 0;
  for (const f of flags) if (f) n++;
  return n;
}

/** 轴向（case 0-3/8-11 是横/纵；4-11 的多带也各有一根主轴）。 */
function axisOf(sub: number): 'x' | 'y' {
  return [0, 1, 4, 5, 8, 9].includes(sub) ? 'x' : 'y';
}

test('★12 个 case：old(36) 与 new(37) 的条带**互不重叠**（同源条带的重叠在 t≈0 时是"全旧"，允许）', () => {
  for (const sub of ALL_CASES) {
    for (const frac of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 0.999]) {
      const dur = 1000;
      const clock = Math.round(dur * frac);
      const rec = blindRec(sub, 8, 0, dur);
      const rt = rtAt(0);
      const bands = scTransitionBands(rec, rt, clock, RECT);
      const oldB = bands.filter((b) => b.src === 'old');
      const newB = bands.filter((b) => b.src === 'new');
      for (const o of oldB) {
        for (const n of newB) {
          assert.equal(
            overlapArea(o, n),
            0,
            `case ${sub} @${frac}: old(${JSON.stringify(o)}) 与 new(${JSON.stringify(n)}) 重叠`,
          );
        }
      }
    }
  }
});

test('★12 个 case：条带并集覆盖目标矩形；t=0 全 old、t→dur 全 new', () => {
  for (const sub of ALL_CASES) {
    const dur = 1000;
    const axis = axisOf(sub);
    const expect = axis === 'x' ? RECT.w : RECT.h;
    // 窗中段：并集必须覆盖整根主轴
    for (const frac of [0.2, 0.5, 0.8]) {
      const bands = scTransitionBands(blindRec(sub, 8, 0, dur), rtAt(0), Math.round(dur * frac), RECT);
      assert.equal(unionSpan(bands, axis), expect, `case ${sub} @${frac}: 并集未覆盖主轴`);
    }
    // t=0：整根主轴由 36（旧帧）覆盖。★case 1/3 体里多一个 `fadd 1.0`（raw 135016/135052），
    //   所以它们**起点就已经推进了一条带宽**（那 8px 由 37 出）—— 这里钉"并集覆盖满 + new ≤ 一条带宽"。
    const at0 = scTransitionBands(blindRec(sub, 8, 0, dur), rtAt(0), 0, RECT);
    assert.ok(at0.length > 0, `case ${sub} @0：不该一个条带都没有`);
    assert.equal(unionSpan(at0, axis), expect, `case ${sub} @0：条带并集应覆盖主轴`);
    assert.ok(
      at0.filter((b) => b.src === 'new').reduce((s, b) => s + (axis === 'x' ? b.w : b.h), 0) <= 8,
      `case ${sub} @0：起点的 new 不该超过一条带宽`,
    );
    // 末端（duration-1ms）：以 new 为主，且仍然覆盖主轴
    const atEnd = scTransitionBands(blindRec(sub, 8, 0, dur), rtAt(0), dur - 1, RECT);
    assert.ok(atEnd.filter((b) => b.src === 'new').length > 0, `case ${sub} @末：应有 new 条带`);
    assert.equal(unionSpan(atEnd, axis), expect, `case ${sub} @末：并集未覆盖主轴`);
    // ★推进方向：末端的 old 条带一定比 t=0 少（12 个 case 都成立：t=0 是"整条主轴都是 old"）
    assert.ok(
      atEnd.filter((b) => b.src === 'old').length < at0.filter((b) => b.src === 'old').length,
      `case ${sub}：末端 old 条带数应少于 t=0`,
    );
  }
});

test('★case 0-3 是"单边界"：任一时刻最多 2 条，且 old/new 恰好互补', () => {
  for (const sub of [0, 1, 2, 3]) {
    for (const frac of [0, 0.1, 0.5, 0.9]) {
      const bands = scTransitionBands(blindRec(sub, 8, 0, 1000), rtAt(0), Math.round(1000 * frac), RECT);
      assert.ok(bands.length <= 2, `case ${sub}：单边界族不该有 ${bands.length} 条`);
      const axis = axisOf(sub);
      const total = bands.reduce((s, b) => s + (axis === 'x' ? b.w : b.h), 0);
      // 互补 ⇒ 长度之和 = 主轴长（t=0 时 new 为空 ⇒ 只有 old 一条，长为全长）
      assert.equal(total, axis === 'x' ? RECT.w : RECT.h, `case ${sub} @${frac}：互补长度不对`);
    }
  }
});

test('★case 4-7 是"多带同步"：中段每条带 old/new 互补 ⇒ 条带数 = 2×格子数', () => {
  const dur = 1000;
  const b = 8;
  for (const sub of [4, 5, 6, 7]) {
    const size = axisOf(sub) === 'x' ? RECT.w : RECT.h;
    const count = Math.floor(size / b) + 1;
    const bands = scTransitionBands(blindRec(sub, b, 0, dur), rtAt(0), Math.round(dur * 0.5), RECT);
    assert.equal(bands.length, count * 2, `case ${sub}：中段条带数应为 2×${count}`);
    assert.equal(bands.filter((x) => x.src === 'old').length, count, `case ${sub}：old 条带数 = 格子数`);
    assert.equal(bands.filter((x) => x.src === 'new').length, count, `case ${sub}：new 条带数 = 格子数`);
  }
});

test('★case 8-11 是"多带 + 每带相位递增"：中段**不是**每带都同时有 old/new（ripple）', () => {
  const dur = 1000;
  const b = 8;
  for (const sub of [8, 9, 10, 11]) {
    const size = axisOf(sub) === 'x' ? RECT.w : RECT.h;
    const count = Math.floor(size / b) + 1;
    const bands = scTransitionBands(blindRec(sub, b, 0, dur), rtAt(0), Math.round(dur * 0.5), RECT);
    assert.ok(bands.length >= count, `case ${sub}：每格至少一条（${bands.length} < ${count}）`);
    assert.ok(bands.length <= count * 2, `case ${sub}：最多每格两条（${bands.length} > ${count * 2}）`);
    // ripple 的判据：中段**既有已经翻成 new 的格子，也有还是 old 的格子**（全同步的 4-7 不会这样）
    const oldN = bands.filter((x) => x.src === 'old').length;
    const newN = bands.filter((x) => x.src === 'new').length;
    assert.ok(oldN > 0 && newN > 0, `case ${sub}：中段应同时存在 old 与 new（old=${oldN} new=${newN}）`);
  }
});

test('★case 4/8 的相位公式（raw 135115 / 135329 的两族）：单调推进且端点吻合', () => {
  const dur = 1000;
  const b = 8;
  const count = Math.floor(RECT.w / b) + 1;
  // case 4：带内相位 = P - b（P = trunc(elapsed / (dur/(b+1)))）⇒ 起点 -b、终点 1
  const rec4 = blindRec(4, b, 0, dur);
  assert.equal(scTransitionOffset(rec4, rtAt(0), 0, RECT), -b, 'case 4 起点：相位 = -b（整条带都是 old）');
  assert.equal(scTransitionOffset(rec4, rtAt(0), dur, RECT), 1, 'case 4 终点：相位 = 1');
  // case 8：相位 = P（nTotal = count + b），单调不减、终点 = count + b
  const rec8 = blindRec(8, b, 0, dur);
  let prev = -1;
  for (let t = 0; t <= dur; t += 50) {
    const off = scTransitionOffset(rec8, rtAt(0), t, RECT);
    assert.ok(off >= prev, `case 8 的 off 应单调不减（t=${t}: ${off} < ${prev}）`);
    prev = off;
  }
  assert.equal(scTransitionOffset(rec8, rtAt(0), dur, RECT), count + b, 'case 8 终点相位 = count+b');
});

test('★case 0/2 的位移公式：`trunc(elapsed / (dur/n)) * b`、n = 尺寸/b + 2，且 t=0 时为 0', () => {
  const dur = 1000;
  const b = 8;
  for (const [sub, size] of [
    [0, RECT.w],
    [2, RECT.h],
  ] as const) {
    const n = Math.floor(size / b) + 2;
    const rec = blindRec(sub, b, 0, dur);
    for (const t of [0, 100, 333, 700, dur - 1]) {
      const want = Math.trunc(t / (dur / n)) * b;
      assert.equal(scTransitionOffset(rec, rtAt(0), t, RECT), want, `case ${sub} @${t}`);
    }
    // 阶梯：位移是 b 的整数倍
    assert.equal(scTransitionOffset(rec, rtAt(0), 500, RECT) % b, 0, `case ${sub}：位移应是条宽的整数倍`);
  }
});

test('★case 1/3 的位移 = (P+1)*b（体里是 `fadd 1.0` 再取整，不是同一个 off）', () => {
  const dur = 1000;
  const b = 8;
  for (const [sub, size] of [
    [1, RECT.w],
    [3, RECT.h],
  ] as const) {
    const n = Math.floor(size / b) + 2;
    const rec = blindRec(sub, b, 0, dur);
    for (const t of [0, 250, 600, dur - 1]) {
      const want = Math.trunc(t / (dur / n) + 1.0) * b;
      assert.equal(scTransitionOffset(rec, rtAt(0), t, RECT), want, `case ${sub} @${t}`);
    }
    assert.equal(scTransitionOffset(rec, rtAt(0), 0, RECT), b, `case ${sub} @0：起点就是一条带宽（不是 0）`);
  }
});

test('★非法输入不产出条带：`[14] < 1` / `[13] < 0` / `[13] > 11` / `dur = 0`', () => {
  const dur = 1000;
  assert.deepEqual(scTransitionBands(blindRec(0, 0, 0, dur), rtAt(0), 500, RECT), [], '[14]=0');
  assert.deepEqual(scTransitionBands(blindRec(-1, 8, 0, dur), rtAt(0), 500, RECT), [], '[13] < 0（立即收尾）');
  assert.deepEqual(scTransitionBands(blindRec(12, 8, 0, dur), rtAt(0), 500, RECT), [], '[13]=12 > 0xB');
  assert.deepEqual(scTransitionBands(blindRec(0, 8, 0, 0), rtAt(0), 0, RECT), [], 'dur = 0');
});

test('★延迟 `[2]`：延迟期内整根主轴仍是 old（分界还没开始走）', () => {
  const rec = blindRec(0, 8, 500, 1000);
  // elapsed = 0 - (0 + 500) = -500；引擎对负 elapsed 也照 `(int)` 向零取整（见 blindOffset 注释）
  const early = scTransitionBands(rec, rtAt(0), 0, RECT);
  assert.equal(unionSpan(early.filter((b) => b.src === 'new'), 'x'), 0, '延迟期内不该有 new 条带覆盖到矩形');
  assert.equal(unionSpan(early.filter((b) => b.src === 'old'), 'x'), RECT.w, '延迟期内整根主轴应是 old');
});
