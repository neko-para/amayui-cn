/** @tier T0 @kind core @subsystem vm */

/**
 * **`T-0179` D 波（vm 操作数-IO / 控制流 / 引擎字段族）的两个命名守卫。**
 *
 * ★**T0**：只吃**合成指令 + 合成输入事件**（`harness.mkEngine`），不读 `install/` 任何真资源。
 *
 * | # | op | 体 | 本守卫钉什么 |
 * |---|---|---|---|
 * | ① | `0x2D4` fmod | `sub_430BD0` raw 40162-40173（`v4 = fmod(v5, v3)`，**无分支**） | 实现是**自洽的 `fmod` 定义式**（`l - r*trunc(l/r)`），且与 JS `%` **逐值相等**（= 本条判为「结构性不适用」的依据） |
 * | ② | 游标移动子步（原挂在 `0x147` 的 `missing`） | `sub_403DD0` raw 9865-9915 | 四条支的**门与钳位**逐条对上体；移动过的位返回给调用方清挂起掩码（`InputManager.consumeKeyBits`） |
 *
 * ## ① 为什么样值是「与 `%` 逐值相等」而不是「符号跟随除数」
 * 原条目写「`op2 = −7.5 / op3 = 2 ⇒ 引擎 0.5、emulator −1.5`」——**算错了**：C 的 `fmod(-7.5, 2)`
 * 就是 **−1.5**（商向零截断 ⇒ −3）。`fmod(l,r) = l - r*trunc(l/r)`，而 `trunc` 是**奇函数**
 * （`trunc(-x) = -trunc(x)`）⇒ 该式正是 JS `%` 的实现定义，**不存在分叉输入**（含 `fmod(x,0)` → 两侧同为 NaN）。
 * 本组因此不假装存在「修前红」，而是在**判据本身**上钉住：随机/定点样值下逐值相等 + 定义式两条性质。
 *
 * ## ② 为什么是**方法级**守卫而不是端到端泵守卫（本轮实测订正的结论）
 * `sub_403DD0` 的唯一调用点是 `sub_4098E0`（raw 14065），而 `sub_4098E0` 的三条出口
 * （点击 `sub_404120` / 回退 label `[12961]` / 悬停 `sub_403E70`）**没有一条读按键掩码** ——
 * 键命中 `sub_403D70` 只出现在**等待泵** `sub_411BC0`（raw 20242）。⇒ 把 `moveCursorByKey` 接在
 * `handlers/panel.ts` 的显示态泵上**今天零可观测差异**（掩码无消费者），那会是假实现。
 * 本波因此只交付**按体建模的方法 + 清位原语**，并把「缺的是消费端」写进
 * `analysis/opcode-gaps.json` 该条的 `missing[].what`（含两条重开条件）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stepOnce } from '../src/vm/interpreter.js';
import { RoutePanel } from '../src/vm/route.js';
import { InputManager } from '../src/vm/input.js';
import { instr, mkEngine } from './harness.js';

// ---------------------------------------------------------------------------
// ① 0x2D4 fmod：自洽的 C `fmod` 定义式（引擎 raw 40171）
// ---------------------------------------------------------------------------

/** 造一条 `fmod (float 1) (float 2) (float 3)` 的步（`f.locals.float.set` 直写浮点池）。 */
async function runFmod(l: number, r: number): Promise<number> {
  const e = mkEngine([instr(0x2d4, [{ type: 0xa, raw: 1 }, { type: 0xa, raw: 2 }, { type: 0xa, raw: 3 }])]);
  const f = e.curScript();
  f.locals.float.set(1, 0);
  f.locals.float.set(2, l);
  f.locals.float.set(3, r);
  await stepOnce(e);
  return f.locals.float.get(1) as number;
}

test('★0x2D4 fmod 是自洽的 `l - r*trunc(l/r)`，且在全部样值上与 JS `%` **逐值相等**', async () => {
  const cases: [number, number][] = [
    [7.5, -2],
    [-7.5, 2],
    [-7.5, -2],
    [7.5, 2],
    [-7.5, 5],
    [7.5, -5],
    [-7.5, 3],
    [7.5, -3],
    [-1, 3],
    [1, -3],
  ];
  for (const [l, r] of cases) {
    const hit = await runFmod(l, r);
    assert.equal(hit, l - r * Math.trunc(l / r), `★fmod(${l}, ${r}) 逐字等于定义式 ${l} - ${r}*trunc(${l}/${r})`);
    assert.equal(hit, l % r, `★且与 JS \`%\` 逐值相等（${hit}）—— 这正是本条判为②的依据`);
    assert.ok(Math.abs(hit) < Math.abs(r), `定义式性质①：|fmod| < |除数|（${hit} vs ${r}）`);
    assert.equal(Math.sign(hit), Math.sign(l), '定义式性质②：符号跟随**被除数**（与 `%` 同；不是「跟随除数」）');
  }
});

test('★0x2D4 fmod：商的**向零截断**（不是 floor）—— 用同号 + 大除数把两者分开', async () => {
  // `trunc(-7.5 / 5) = -1` ⇒ -7.5 + 5 = **-2.5**；若实现写成 `floor`（商 -2）⇒ 会得 `2.5`
  assert.equal(await runFmod(-7.5, 5), -2.5, '★trunc 而不是 floor（C 的 fmod 商向零截断）');
  assert.equal(await runFmod(-1, 3), -1, '`fmod(-1, 3) = -1`（|l| < |r| ⇒ 原值，符号跟随被除数）');
  assert.equal(await runFmod(1, -3), 1, '`fmod(1, -3) = 1`（同理）');
  // 与既有守卫 test/t0164-misc-batch.test.ts:311-324 的两条样值保持一致（那里钉 `fmod(7.5,0)=NaN` 与 `fmod(7.5,2)=1.5`）
  assert.equal(await runFmod(7.5, 2), 1.5, '既有守卫的样值不变');
  assert.ok(Number.isNaN(await runFmod(7.5, 0)), '`fmod(x, 0)` = NaN（体全文无分支、无错误串）');
});

// ---------------------------------------------------------------------------
// ② 游标移动子步（`sub_403DD0` raw 9865-9915）= `RoutePanel.moveCursorByKey`
// ---------------------------------------------------------------------------

/** 造一个干净面板（不经 `0x92`：那条会把 `[960]` 写成 op1，翻页门就不为 0 了）。 */
function panelWith(n: number): { p: RoutePanel; labels: number[] } {
  const p = new RoutePanel();
  const f = mkEngine([instr(0x5, [{ type: 0x0, raw: 1 }])]).curScript();
  const labels: number[] = [];
  for (let i = 0; i < n; i++) {
    labels.push(0x100 + i);
    p.push(5000 + i, 5000, 10, 10, -1, -1, 0x100 + i, f.scriptId);
  }
  return { p, labels };
}

test('★游标移动子步：bit0 上 / bit2 下 的**钳位与"到位不动"**（体 raw 9878-9890）', () => {
  const { p } = panelWith(5);
  assert.equal(p.pageStep, 0, '前提：干净面板 `[960] = 0`');
  // 上（bit0）：游标 0 ⇒ 钳到 0（raw 9878-9879 `--[7468]` 且 `< 0 ⇒ 0`）—— 钳位也算"移动过"⇒ 返回 bit0
  p.cursor = 0;
  assert.equal(p.moveCursorByKey(1), 1, 'bit0 无条件走（钳位也算移动过 ⇒ 调用方据此清位）');
  assert.equal(p.cursor, 0, '★从 0 上移仍停在 0（不是 -1）');
  p.cursor = 3;
  assert.equal(p.moveCursorByKey(1), 1, '3 → 2');
  assert.equal(p.cursor, 2, '正常上移一格');
  // 下（bit2）：到 n-1 就不动、也**不清位**（raw 9885 的 `if (v4 < …)` 包着清位）
  p.cursor = 4;
  assert.equal(p.moveCursorByKey(4), 0, '★已到末项 ⇒ 不动，返回值里没有 bit2（调用方不清位）');
  assert.equal(p.cursor, 4, '末项不下移');
  p.cursor = 1;
  assert.equal(p.moveCursorByKey(4), 4, '1 → 2');
  assert.equal(p.cursor, 2, '正常下移一格');
});

test('★游标移动子步：bit3 左翻 / bit1 右翻 的 **`[960] != 0` 门**与步长上界（体 raw 9891-9913）', () => {
  const { p } = panelWith(5);
  // `[960] = 0` ⇒ 左/右翻页**整段不进**（raw 9891-9892 的 `v5 = _this[960]; if (v5)`）
  p.cursor = 3;
  assert.equal(p.moveCursorByKey(8), 0, '★`[960] = 0` ⇒ 左翻页整段不进');
  assert.equal(p.moveCursorByKey(2), 0, '★`[960] = 0` ⇒ 右翻页整段不进');
  assert.equal(p.cursor, 3, '游标不动');
  // `[960] = 2` ⇒ 两条都能走
  p.pageStep = 2;
  assert.equal(p.moveCursorByKey(8), 8, '左翻页可走（`[7468] >= [960]`，raw 9897）');
  assert.equal(p.cursor, 1, '3 − 2 = 1');
  assert.equal(p.moveCursorByKey(2), 2, '右翻页可走（`[7468] < [258] − [960]`，raw 9907）');
  assert.equal(p.cursor, 3, '1 + 2 = 3');
  // 右翻页的上界是 `[258] − [960]`（= 5 − 2 = 3 ⇒ 3 不满足 `< 3`）
  assert.equal(p.moveCursorByKey(2), 0, '★到上界 ⇒ 不动、不清位');
  assert.equal(p.cursor, 3, '停在上界');
  // 左翻页的下界是 `[960]`（= 2 ⇒ 游标 1 不满足 `>= 2`）
  p.cursor = 1;
  assert.equal(p.moveCursorByKey(8), 0, '★到左翻页下界 ⇒ 不动、不清位');
  assert.equal(p.cursor, 1, '停在 1');
  // 一次调用里四个 `if` 依次施加（体的顺序：上 → 下 → 左 → 右）
  p.cursor = 2;
  assert.equal(p.moveCursorByKey(1 | 4), 1 | 4, '同时置 bit0 与 bit2 ⇒ 两条都走（先 `--` 再 `++`）');
  assert.equal(p.cursor, 2, '2 → 1 → 2（净不动，但两位都清）');
});

test('★`InputManager.consumeKeyBits`：按位清**键盘挂起边沿**（= 体内 `*a2 &= ~1u/~4u/~8u/~2u`）', () => {
  const im = new InputManager();
  im.pressKey(0x26); // VK_UP ⇒ 位 0
  im.pressKey(0x28); // VK_DOWN ⇒ 位 2
  assert.equal(im.keyEdge & (1 | 4), 1 | 4, '前提：两个位都在挂起边沿里');
  im.consumeKeyBits(1);
  assert.equal(im.keyEdge & 1, 0, '★清掉 bit0（上）');
  assert.equal(im.keyEdge & 4, 4, '★bit2 仍在（只清"移动过"的那些位）');
  assert.equal(im.keysHeld & 1, 1, '★按住态 `keysHeld` **不动**（体清的是挂起掩码，不是物理按住态）');
  im.consumeKeyBits(0);
  assert.equal(im.keyEdge & 4, 4, '`consumeKeyBits(0)` 什么都不清');
});
