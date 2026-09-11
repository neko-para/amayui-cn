/**
 * 回归测试：**绘制项 → 纹理 的槽号解析**。
 *
 * 背景（两个真实 bug，2025 由引擎侧分析纠正）：
 *  1. `draw-texture`(0x1FB) 的 **op1 是图元 handle（= Scene map key = 层序）**、**op2 才是纹理槽**；
 *     旧实现把两者写反（把 op1 当槽）→ 存进 Item 的槽号是错的；
 *  2. `present()` 又用 `it.layer` 去查纹理槽表 → 全部落空 → 退化成占位色块
 *     （表现 = 背景消失、只剩零星方块）。
 * 本测试锁死正确行为：**按 `Item.tex`（= 槽号）解析**，绝不按 handle/layer。
 *
 * 被测量是 `TextureCache`（"槽 → imgid → Texture"的唯一实现），因此不需要 DOM/WebGL/Pixi 运行时：
 * 测试只碰它的两张表与纯解析方法（不再需要 `as any` 往 PixiBackend 上塞私有字段）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import type { Item } from '../src/renderer/drawItem.js';

/** 建一个未接 Pixi 的缓存；`loaded` 是它的 `slot → Texture` 表（测试用来模拟"已载入"）。 */
function bareCache(): { cache: TextureCache; loaded: Map<number, unknown> } {
  const cache = new TextureCache(() => {});
  return { cache, loaded: cache.slotTex as unknown as Map<number, unknown> };
}

/** 构造一个绘制项：handle/layer = 图元 key（层序），tex = 纹理槽号。 */
const item = (handle: number, layer: number, tex: number): Item =>
  ({
    handle,
    layer,
    tex,
    srcX: 0,
    srcY: 0,
    srcW: 16,
    srcH: 16,
    dstX: 0,
    dstY: 0,
    flags: 1,
    from: 0xffffffff,
    to: 0xffffffff,
  }) as unknown as Item;

test('resolve：按 Item.tex（=纹理槽）解析，而不是按 handle/layer', () => {
  const { cache, loaded } = bareCache();
  // set-texture 42 ← imgid 0x5245；并已载入纹理
  cache.bind(0x5245, 42);
  const fakeTex = { __tex: 'slot42' };
  loaded.set(42, fakeTex);
  // 干扰：槽 4 也绑定了
  cache.bind(0x5272, 4);
  loaded.set(4, { __tex: 'slot4' });

  // draw-texture 300 42 …：handle=300(层序)、tex=42(槽) → 必须取到 slot42
  const r1 = cache.resolve(item(300, 300, 42));
  assert.equal(r1.tex, fakeTex, 'tex=42 应解析到 slot 42 的纹理');
  assert.equal(r1.imgid, 0x5245);

  // ★关键回归：tex=100（未绑定），handle=4（存在同名槽 4）→ 不得误取 slot 4
  const r2 = cache.resolve(item(4, 4, 100));
  assert.equal(r2.tex, undefined, 'tex=100 未绑定 → 必须是 undefined（旧实现会误取 handle/layer 的槽）');
  assert.equal(r2.imgid, undefined, '未绑定槽的 imgid 也应为 undefined');

  // 已绑定但纹理尚未载入 → 返回 imgid、tex 为空（调用方退化占位块）
  cache.bind(0x1234, 7);
  const r3 = cache.resolve(item(1, 1, 7));
  assert.equal(r3.tex, undefined);
  assert.equal(r3.imgid, 0x1234, '应报出 imgid 以便诊断"绑定但未载入"');
});

test('resolve：槽号与 handle 相同也不混淆（都走 tex 语义）', () => {
  const { cache, loaded } = bareCache();
  const fakeTex = { __tex: 's9' };
  cache.bind(0x99, 9);
  loaded.set(9, fakeTex);
  const r = cache.resolve(item(9, 9, 9));
  assert.equal(r.tex, fakeTex);
  assert.equal(r.imgid, 0x99);
});

test('release：解除槽的纹理（保留 imgid 绑定，与引擎 release-texture 同口径）', () => {
  const { cache, loaded } = bareCache();
  cache.bind(0x88, 5);
  loaded.set(5, { __tex: 's5' });
  assert.equal(cache.slotCount, 1);
  cache.release(5);
  assert.equal(cache.slotCount, 0);
  assert.equal(cache.imgidOf(5), 0x88, 'release 只解纹理，不改写绑定记录');
});
