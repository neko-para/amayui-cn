/** @tier T0 @kind core @subsystem texture */

/**
 * `decideCreateTexture` 的三态语义（`tickets/T-0175` ⑤，出处 `tickets/T-0166` §4-②）。
 *
 * 为什么单独有这几例：`create()` 对"已有表面"的决策原先只活在一个复合 `if` 里，而它**只能在有 DOM
 * 的环境里跑**（要 `document.createElement` 与 `PIXI.Texture.from`）⇒ Node 测试里 `old` 永远是
 * undefined，**"同尺寸复用 / 换尺寸把旧纹理推入 `DestroyQueue`"这条接线一直没有任何断言**。
 * 把决策抽成纯函数后，前两态的语义可以在 Node 里逐条钉住；真正 `push` 的那一行仍只在真宿主走到
 * （这一点如实保留在 `T-0175` 的 ⑤ 里，不假装已覆盖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideCreateTexture } from '../src/renderer/pixi/textureCache.js';

const had = (w: number, h: number, res: number) => ({ w, h, res });

test('★decideCreateTexture：同槽同尺寸同 DPR 且有 DOM ⇒ reuse-clear（复用并清空同一张画布）', () => {
  assert.equal(decideCreateTexture({ had: had(100, 50, 2), w: 100, h: 50, res: 2, hasDom: true }), 'reuse-clear');
});

test('★decideCreateTexture：尺寸变了 ⇒ replace（= 旧纹理入 DestroyQueue，延迟到 present 之后销毁）', () => {
  assert.equal(decideCreateTexture({ had: had(100, 50, 2), w: 200, h: 50, res: 2, hasDom: true }), 'replace');
  assert.equal(decideCreateTexture({ had: had(100, 50, 2), w: 100, h: 80, res: 2, hasDom: true }), 'replace');
});

test('★decideCreateTexture：DPR 变了 ⇒ replace（画布物理尺寸随之变，不能复用）', () => {
  assert.equal(decideCreateTexture({ had: had(100, 50, 1), w: 100, h: 50, res: 2, hasDom: true }), 'replace');
});

test('★decideCreateTexture：本来没有旧表面 ⇒ fresh（不入队）', () => {
  assert.equal(decideCreateTexture({ had: null, w: 100, h: 50, res: 2, hasDom: true }), 'fresh');
  assert.equal(decideCreateTexture({ had: null, w: 0, h: 0, res: 2, hasDom: false }), 'fresh');
});

test('★decideCreateTexture：没有 DOM（Node 测试/无头）⇒ 即使尺寸相同也不能 reuse（没有画布可清空）', () => {
  assert.equal(decideCreateTexture({ had: had(100, 50, 2), w: 100, h: 50, res: 2, hasDom: false }), 'replace');
});

test('★decideCreateTexture：w 或 h 为 0 ⇒ replace（引擎的"未初始化表面"路径；复用无意义）', () => {
  assert.equal(decideCreateTexture({ had: had(1, 1, 1), w: 0, h: 50, res: 1, hasDom: true }), 'replace');
  assert.equal(decideCreateTexture({ had: had(1, 1, 1), w: 50, h: 0, res: 1, hasDom: true }), 'replace');
});

test('★decideCreateTexture：负数/小数按 `max(1, · \| 0)` 归一后再比（与 create 里的 cw/ch 同口径）', () => {
  // 两边都按 `| 0` 归一：w = 7.9 ⇒ cw = 7，旧表面 7 ⇒ 复用
  assert.equal(decideCreateTexture({ had: had(7, 7, 1), w: 7.9, h: 7, res: 1, hasDom: true }), 'reuse-clear');
  // 0.4 ⇒ cw = max(1, 0) = 1，旧表面 1 ⇒ 尺寸"相同"，且 0.4 > 0 ⇒ 仍复用（沿用原 `if` 的口径）
  assert.equal(decideCreateTexture({ had: had(1, 7, 1), w: 0.4, h: 7, res: 1, hasDom: true }), 'reuse-clear');
  // w = 0 / 负数 ⇒ `w > 0` 这道门不过 ⇒ replace（引擎的"未初始化表面"路径，复用无意义）
  assert.equal(decideCreateTexture({ had: had(1, 7, 1), w: 0, h: 7, res: 1, hasDom: true }), 'replace');
  assert.equal(decideCreateTexture({ had: had(1, 7, 1), w: -5, h: 7, res: 1, hasDom: true }), 'replace');
});
