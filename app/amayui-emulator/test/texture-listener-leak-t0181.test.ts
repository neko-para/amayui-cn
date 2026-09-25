/** @tier T0 @kind ratchet @subsystem texture */
/**
 * **临时裁剪纹理必须被销毁**（`tickets/T-0181`）—— 用户用 heap timeline 抓到的
 * `ImageSource._events.resize` **543,xxx 条**就是这条判据的反面。
 *
 * ## 机制（Pixi v8 源码，不是推断）
 *
 * `pixi.mjs` 的 `Texture` 构造 → `set source(value)` 里**无条件**做：
 * ```js
 * set source(value) {
 *   if (this._source) this._source.off('resize', this.update, this);
 *   this._source = value;
 *   value.on('resize', this.update, this);   // ★每个 Texture 对象一条监听
 *   ...
 * }
 * destroy(destroySource = false) {
 *   if (this._source) { this._source.off('resize', this.update, this); ... }  // ★只有这里摘
 * }
 * ```
 * ⇒ **每 `new Texture({source, frame})` 一次就多一条 `resize` 监听，且只有 `destroy()` 能摘**。
 *
 * 而 `ScenePresenter.#buildItemSprite` 每帧、**每个绘制项**都 `cropSprite()` 新建一个裁剪纹理
 * （TITLE/LOAD 上 ≈165 项/帧、60fps ⇒ **≈1 万条/秒**）。修前那些纹理从不 `destroy`
 * ⇒ 约一分钟的游玩就攒到 54 万条、页面堆以 MB/s 增长、最后 `out of memory`。
 *
 * ## 本测试钉什么
 *
 *  ① **行为**：连画 N 帧之后，源的监听**条数不随帧数增长**（正确的实现是"常量"）；
 *  ② **反面控制**：同一场景里"没有纹理的项"仍然不建纹理（否则这条判据可能被"根本没画"骗过）。
 *
 * ★不需要 DOM：裁剪纹理只用 `TextureSource`（`new Texture({source, frame})` 不碰画布）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture, TextureSource } from 'pixi.js';

import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scConfigureDrawItem } from '../src/renderer/scene/ops.js';

/** 源上所有 `EventEmitter` 事件数组的**总条数**（`resize`/`update`/… 全算）。 */
function listenerCount(src: unknown): number {
  const ev = (src as { _events?: Record<string, unknown> })._events ?? {};
  let n = 0;
  for (const v of Object.values(ev)) if (Array.isArray(v)) n += v.length;
  return n;
}

/** 一条真源（不进任何全局缓存；像素无所谓）。 */
function freshSource(): TextureSource {
  return new TextureSource({ width: 64, height: 64, resource: new Uint8Array(64 * 64 * 4) });
}

/** 一个"能画出来"的绘制项（绑了纹理的槽）。 */
function drawableScene(tex: number): ReturnType<typeof newSceneState> {
  const scene = newSceneState();
  scConfigureDrawItem(scene, {
    handle: 0x100,
    layer: 101000,
    tex,
    srcX: 0,
    srcY: 0,
    srcW: 32,
    srcH: 32,
    dstX: 0,
    dstY: 0,
  });
  return scene;
}

test('★临时裁剪纹理必须销毁：源上的监听条数**不随帧数增长**（T-0181 的 54 万条泄漏）', () => {
  const src = freshSource();
  const tex = new Texture({ source: src }); // 缓存持有的那张（会被 `cropSprite` 反复裁剪）
  const cache = new TextureCache(() => {});
  cache.slotTex.set(7, tex);
  const root = new Container();
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, 1280, 720);
  const scene = drawableScene(7);

  const before = listenerCount(src);
  const FRAMES = 30;
  let drawn = 0;
  for (let f = 0; f < FRAMES; f++) drawn += presenter.present(scene, f * 16, 0, []);
  const after = listenerCount(src);

  assert.ok(drawn >= FRAMES, `每一帧都该画出至少一项（实测画了 ${drawn} 个）——否则本判据没有判别力`);
  // ★判据：监听条数与帧数**无关**。给一点余量（Pixi 自己可能给源挂 1~2 条常驻监听）。
  assert.ok(
    after <= before + 2,
    `连画 ${FRAMES} 帧后源上的监听从 ${before} 涨到 ${after} ⇒ **临时裁剪纹理没被销毁**` +
      `（Pixi 只在 \`texture.destroy()\` 里 \`off('resize', …)\`；漏一处就是 ≈1 万条/秒的泄漏，` +
      `实测 54 万条、页面 OOM）`,
  );
});

test('★反面控制：没有纹理的项**仍然不建纹理**（不许为了"清干净"而把不画的项也建出来）', () => {
  const src = freshSource();
  const tex = new Texture({ source: src });
  const cache = new TextureCache(() => {});
  cache.slotTex.set(7, tex); // 只为槽 7 绑图；下面那个项用的是槽 9（没绑）
  const root = new Container();
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, 1280, 720);
  const scene = drawableScene(9);

  const before = listenerCount(src);
  for (let f = 0; f < 10; f++) presenter.present(scene, f * 16, 0, []);
  assert.equal(listenerCount(src), before, '没纹理的项一笔都不画 ⇒ 也不该在**这张源**上留任何监听');
  assert.equal(root.children.length, 0, '整项不画 ⇒ drawRoot 里不该有东西');
});
