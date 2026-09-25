/** @tier T0 @kind core @subsystem render */

/**
 * 命名守卫：**`0x202` 颜色窗的 `dur > 0` 入口门**（引擎 `sub_49AA30` raw 117443-117444）。
 *
 * 引擎逐字（`sub_49AA30`，`a2` = 绘制项元素）：
 * ```
 * v13 = *((_DWORD *)a2 + 19);          // +0x4C = 颜色窗 dur
 * if ( v13 > 0 ) { …锁存的 delay/dur/now 判据 + 窗内插值 + 窗末 +0x60 ← +0x64… }
 * ```
 * ⇒ `dur <= 0` 时**整块颜色逻辑不跑**：`+0x60`（工作色 FROM）/`+0x64`（TO）都留原值，
 * 不做窗末收尾；同一帧末尾 `if (!v115)`（raw 117833-117837）照清 `*(_DWORD *)a2 &= ~2u`
 * 与共享起点 `a2[13] = 0`。
 *
 * 修前：`winPhase` 对 `dur <= 0` 一律答 `after` ⇒ `advanceWindows` 走 `freezeWindow(W_COLOR)`
 * 的 `from ← to` ⇒ **颜色被改成 TO**（引擎里这条指令等于没发生）。
 *
 * 红→绿：把 `animWindow.ts` 里 `idx === W_COLOR && w.dur <= 0` 那一行摘掉 ⇒ 本文件第 1 例红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceWindows,
  applyDrawColor,
  applyDrawColorAlpha,
  itemColor,
  makeItem,
  windowDone,
} from '../src/renderer/drawItem.js';

/** 一个绘制项（handle=0x100、源 16×16 @(32,48)、目标 (400,300)）。 */
function newItem() {
  return makeItem({ handle: 0x100, layer: 0x100, tex: 7, srcX: 32, srcY: 48, srcW: 16, srcH: 16, dstX: 400, dstY: 300 });
}

test('★0x202：dur = 0 的颜色窗不跑（raw 117443-117444）⇒ 工作色不被改成 TO', () => {
  const it = newItem();
  applyDrawColorAlpha(it, 0x00ffffff); // 0x203：工作色 FROM = 透明白
  applyDrawColor(it, 0, 0, 0xffffffff); // 0x202：delay 0 / **dur 0** / TO = 不透明白

  advanceWindows(it, 1000); // 引擎这一帧：v13 = 0 ⇒ 颜色块整块跳过、v115 保持 0

  assert.equal(itemColor(it, 1000) >>> 0, 0x00ffffff, 'dur <= 0 ⇒ `+0x60` 必须留原值（不是 TO）');
  assert.equal(it.from >>> 0, 0x00ffffff, '工作色字段本身也不许被 `from ← to` 收尾');
  assert.equal(windowDone(it, 0, 1000), true, '该窗不参与 ⇒ 视为已结束');
  assert.equal(it.flags & 2, 0, '没有窗在跑 ⇒ 末尾照清动画位（raw 117833-117837）');

  advanceWindows(it, 1001); // 下一帧同样什么都不做
  assert.equal(itemColor(it, 1001) >>> 0, 0x00ffffff, '后续帧仍不跑（dur 仍是 0）');
});

test('0x202：dur > 0 时窗内插值、窗末 from ← to（该门不改变正常路径）', () => {
  const it = newItem();
  applyDrawColorAlpha(it, 0x00000000); // FROM = 全透明
  applyDrawColor(it, 0, 200, 0xff000000); // dur 200 / TO = 不透明黑

  advanceWindows(it, 1000); // 锁存 animStart
  const mid = itemColor(it, 1100); // t = 0.5，整数截断 ⇒ 127
  assert.equal((mid >>> 24) & 0xff, 127, '窗内插值照旧（截断）');

  advanceWindows(it, 1200); // 窗末
  assert.equal(it.from >>> 0, 0xff000000, '窗末 from ← to（raw 117455）');
  assert.equal(itemColor(it, 1200) >>> 0, 0xff000000, '窗末之后可见色 = 新的工作色');
  assert.equal(it.flags & 2, 0, '窗结束后清动画位');
});
