/** @tier T0 @kind core @subsystem render */
/**
 * **绘制项的出画次序（z 序）** —— 补 `tickets/T-0124` 变异实测查出的**零覆盖点 Z1**。
 *
 * 为什么要有它：把 `src/renderer/pixi/presenter.ts` 里绘制项排序的 `a.layer - b.layer` 反转成
 * `b.layer - a.layer`，**全量 1078 个用例无一红**（见 `tickets/T-0124/evidence/mutation-campaign.md` §2 Z1）。
 * 已有的 `draw-item-*` / `blend-mode` / `layer-direction` 都只看**单点属性**（层号、混合模式、几何），
 * 没有一条看**次序** —— 而"谁盖住谁"正是层序唯一的可见效果。
 *
 * 判据来源（引擎语义，独立于实现）：
 *  - `presenter.ts` 的归并键 = `layer` 升序、等键按 `handle` 升序（引擎三路归并 `sub_4B06D0` 取小键先画，
 *    见该文件 §"1) 三路归并"的长注释与 `docs-new/03-engine/rendering.md` §3.1）；
 *  - 本用例用**屏幕 x 坐标**当每个项的"身份标签"（每项 dstX 不同），于是"root.children 的 x 序列"
 *    就是"出画次序"的可读表示。
 *
 * 反例实验：把排序键反转（`b.layer - a.layer`）⇒ 本用例**必红**（这是它存在的理由）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture } from 'pixi.js';
import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scConfigureDrawItem } from '../src/renderer/scene/ops.js';

const VIEW_W = 1280;
const VIEW_H = 720;

test('★Z1 出画次序：draw-item 按 layer 升序、等 layer 按 handle 升序', () => {
  const root = new Container();
  const cache = new TextureCache(() => {});
  // 夹具必须**把槽绑上图**：引擎里 `set-texture` 是同步的，而"槽没有纹理对象"⇒ 整笔不画
  // （raw 122952-122963）⇒ 不绑图的话这条用例会因为"什么都没画"而失去判别力。
  cache.slotTex.set(1, Texture.WHITE);
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, VIEW_W, VIEW_H);
  const scene = newSceneState();
  const mk = (handle: number, layer: number, x: number): void => {
    scConfigureDrawItem(scene, {
      handle, layer, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: x, dstY: 0,
    });
  };

  // 故意**乱序**写入：层号与写入次序无关，且 100 层放两个（考等键次序）
  mk(0x103, 300, 30);
  mk(0x101, 100, 10);
  mk(0x104, 100, 40); // 与 0x101 同层、handle 更大 ⇒ 必须排在 0x101 之后
  mk(0x102, 200, 20);

  const drawn = presenter.present(scene, 0, 0);
  assert.equal(drawn, 4, '四项都应出画（否则后面的次序断言没有意义）');
  const xs = root.children.map((c) => (c as unknown as { position: { x: number } }).position.x);
  assert.deepEqual(
    xs,
    [10, 40, 20, 30],
    '★出画次序 = layer 升序（100,100,200,300），同层按 handle 升序（0x101 在 0x104 前）',
  );
});

test('★Z1 反向自检：把层号倒过来 ⇒ 出画次序必须整体反转（防"排序键被换掉却都不红"）', () => {
  const root = new Container();
  const cache = new TextureCache(() => {});
  cache.slotTex.set(1, Texture.WHITE);
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, VIEW_W, VIEW_H);
  const scene = newSceneState();
  const mk = (handle: number, layer: number, x: number): void => {
    scConfigureDrawItem(scene, {
      handle, layer, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: x, dstY: 0,
    });
  };
  mk(0x101, 300, 10); // 这次让"x 小的"层号大
  mk(0x102, 100, 20);
  presenter.present(scene, 0, 0);
  const xs = root.children.map((c) => (c as unknown as { position: { x: number } }).position.x);
  assert.deepEqual(xs, [20, 10], 'layer 100（x=20）必须先画、layer 300（x=10）后画');
});
