/** @tier T0 @kind core @subsystem ops */

/**
 * **WM_MOUSEMOVE 命中测试的「门」**（引擎 `sub_4B8D50` raw 140825-140836）。
 *
 * 引擎体（raw 140827-140830）：
 * ```
 * if ( _this[12958] || _this[12957] ) sub_403C50((int)(_this + 5494),  a2, a3);   // panelA
 * if ( _this[20440] )                 sub_403C50((int)(_this + 12976), a2, a3);   // panelB（emu 无）
 * ```
 * 面板对象基址 = `Engine+5494`（dword）⇒ `_this[12958] = panelA[7464]`（`fillPending`）、
 * `_this[12957] = panelA[7463]`（`shown`）。
 * ⇒ **面板关闭期（两格皆 0）鼠标移动不重算游标**。
 *
 * 修前 `Engine` 构造里的钩子无条件 `routes.hitTest(x, y)`（审计 `0x94` ② `missing-branch`）⇒
 * 关闭期一移鼠标就把游标按新位置重算，`showPanel` 之后的悬停两段式（`sub_403E70` 比较 `[959]`
 * 与游标）基准与引擎分叉。`fillPending` 修前也正是「只有写点、没有读者」的死写 —— 本门就是它
 * 在引擎里的读者（登记见 `analysis/opcode-gaps.json` 的 `0x94`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepOnce } from '../src/vm/interpreter.js';
import { im, instr, mkEngine } from './harness.js';

const X = 0, Y = 0, W = 100, H = 100;
const CLICK = 0x777;

test('★P2 0x94：关闭期（fillPending=0 且 shown=0）移动光标 ⇒ **不重算**命中', () => {
  const e = mkEngine([instr(0x5, [im(1)])]);
  const p = e.routes;
  p.push(X, Y, W, H, -1, -1, CLICK, e.curScript().scriptId);
  p.hitDone = 1; // 「已经做过命中测试」的关闭期（`[7465]` 不被 `0x93` 的复位清，见 route.ts）
  p.cursor = -1; // 关闭期的陈旧游标
  e.input.setCursor(50, 50, true); // 鼠标移进矩形
  assert.equal(p.fillPending, 0, '前提：fillPending（`[7464]`/`Engine[12958]`）为 0');
  assert.equal(p.shown, 0, '前提：shown（`[7463]`/`Engine[12957]`）为 0');
  assert.equal(p.cursor, -1, '★门关 ⇒ 引擎不调 sub_403C50，游标保持 -1（修前在这儿被算成 0）');
});

test('0x94：门的 `||` 左半 —— fillPending 非 0 而 shown 为 0 ⇒ 移动光标**要**重算', () => {
  const e = mkEngine([instr(0x5, [im(1)])]);
  const p = e.routes;
  p.push(X, Y, W, H, -1, -1, CLICK, e.curScript().scriptId);
  p.fillPending = 1; // = `sub_404020` 写的 `[7464]`（`0x91`/`0x92` 的显示态也走它）
  e.input.setCursor(50, 50, true);
  assert.equal(p.shown, 0, '前提：shown 仍为 0');
  assert.equal(p.cursor, 0, '★`_this[12958] != 0` ⇒ 命中测试照做');
});

test('0x94：门的右半 —— 真 `i094` 之后（shown=1）移动光标重算命中', async () => {
  const e = mkEngine([instr(0x94, []), instr(0x5, [im(1)])]);
  const p = e.routes;
  p.push(X, Y, W, H, -1, -1, CLICK, e.curScript().scriptId);
  await stepOnce(e); // `i094` ⇒ shown=1 + `sub_404020` 的首次命中测试（此刻无光标）
  assert.equal(p.shown, 1, '`0x94` 置 `[7463] = 1`');
  assert.equal(p.cursor, -1, '前提：首次命中测试时无光标 ⇒ 游标 -1');
  e.input.setCursor(50, 50, true);
  assert.equal(p.cursor, 0, '★门开（shown）⇒ 重算命中');
});

test('★P2 0x94：真实指令序（`i090` 登记 → `i094` 显示 → `i093` 关闭 → 再登记）下的门', async () => {
  const R = [im(X), im(Y), im(W), im(H), im(-1), im(-1), im(CLICK)];
  const e = mkEngine([
    instr(0x90, R), instr(0x94, []), instr(0x93, []), instr(0x90, R), instr(0x5, [im(1)]),
  ]);
  const p = e.routes;
  await stepOnce(e); // ① i090 登记矩形：两格皆 0（面板还没显示）
  assert.equal(p.count, 1, '前提：矩形已登记');
  e.input.setCursor(50, 50, true); // 关闭期（显示之前）把光标移进矩形
  assert.equal(p.cursor, -1, '★门关 ⇒ 不重算（修前会在这儿变成 0）');
  await stepOnce(e); // ② i094 首次显示：`[7465] == 0` ⇒ 无条件按当前鼠标重做命中测试
  assert.equal(p.cursor, 0, '★显示的瞬间按当前鼠标重做（引擎 raw 10023-10026）');
  e.input.setCursor(500, 500, true); // 显示期移出矩形
  assert.equal(p.cursor, -1, '★显示期（shown=1）门开 ⇒ 重算 ⇒ 落 -1');
  await stepOnce(e); // ③ i093 关闭：`sub_403EF0` 清表 + toggle `[7463] = 0`
  assert.equal(p.shown, 0, 'i093 清 shown');
  assert.equal(p.fillPending, 0, 'i093 的复位把 `[7464]` 清 0');
  assert.equal(p.count, 0, 'i093 清空路由表');
  await stepOnce(e); // ④ i090 重登记同一矩形（不动游标）
  assert.equal(p.count, 1, '前提：矩形已重新登记');
  e.input.setCursor(50, 50, true); // 关闭期再移进矩形
  assert.equal(p.cursor, -1, '★关闭期不重算（修前：0）');
});
