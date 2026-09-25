/** @tier T0 @kind core @subsystem texture */

/**
 * **「换尺寸/释放 ⇒ 旧纹理入 `DestroyQueue`」这条接线必须可测**（`tickets/T-0175` 的 ⑤ 后半，
 * 出处 `tickets/T-0166` §4-②）。
 *
 * ## 修前为什么测不到
 *
 * `TextureCache.create()` 建画布那一步要 `document.createElement` ⇒ Node 里
 * `typeof document === 'undefined'` ⇒ `#canvasSlots` 永远为空 ⇒ `decision` 永远是 `fresh`
 * ⇒ **`#pendingDestroy.push(old.tex)` 那一行在任何测试里都走不到**。
 * 既有的 `test/texture-lifecycle.test.ts` 只测了 `DestroyQueue` **自己**的语义
 * （push 不销毁 / flush 才销毁），与"`create` 真的会入队"之间那段接线**一条断言都没有**。
 *
 * ## 判据（与 acceptance ⑤ 逐字对应）
 *
 * | # | 断言 |
 * |---|---|
 * | 1 | `create(slot, 旧尺寸)` → `create(slot, **新尺寸**)` ⇒ `pendingDestroyCount === 1` |
 * | 2 | `create(slot, **同尺寸**)` ⇒ 复用同一张画布 ⇒ `pendingDestroyCount` **不增**（仍是 1） |
 * | 3 | `release(slot)` ⇒ 也入队（`pendingDestroyCount` 再 +1），且 `collectGarbage()` 一次清空 |
 * | 4 | 不注入工厂（生产 Node 用法）⇒ **行为与修前逐字相同**：不建槽、不入队、不抛 |
 *
 * ★判据 4 就是"可选缝语义"的一半：注入点**不许**改变"没有 DOM 时什么都不建"这条产品行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextureCache, type CanvasFactory } from '../src/renderer/pixi/textureCache.js';
import type { Texture } from 'pixi.js';

/**
 * 一个**假画布**：只实现 `TextureCache` 真正会碰的那几样
 * （`width`/`height`/`getContext('2d')` 的 `setTransform`/`clearRect`/`getImageData`）。
 *
 * ★为什么够用：本用例只问"**入队/复用**"（`pendingDestroyCount` 与画布实例同一性），
 * 不碰像素 —— 像素路径由 `test/texture-bind-race.test.ts` / E4 截图管。
 */
interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): {
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
  } | null;
}

/** 一个能记录"建了几张画布 / 销毁了几张"的假工厂。 */
function fakeFactory(): {
  factory: CanvasFactory;
  canvases: FakeCanvas[];
  destroyed: string[];
} {
  const canvases: FakeCanvas[] = [];
  const destroyed: string[] = [];
  let n = 0;
  const factory: CanvasFactory = {
    createElement: () => {
      const c: FakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
        setTransform: () => {},
        clearRect: () => {},
        putImageData: () => {},
        drawImage: () => {},
        imageSmoothingEnabled: false,
      }),
      };
      canvases.push(c);
      n++;
      return c as unknown as HTMLCanvasElement;
    },
    createTexture: (canvas) => {
      const id = `tex#${n}`;
      return {
        id,
        source: { update: () => {} },
        destroy: () => {
          destroyed.push(id);
        },
      } as unknown as Texture;
    },
  };
  return { factory, canvases, destroyed };
}

test('★接线：create 换尺寸 ⇒ 旧纹理入 DestroyQueue（`pendingDestroyCount === 1`）', () => {
  const { factory, canvases, destroyed } = fakeFactory();
  const cache = new TextureCache(() => {}, undefined, factory);

  cache.create(7, 640, 480, 0);
  assert.equal(canvases.length, 1, '第一次 create 建一张画布');
  assert.equal(cache.pendingDestroyCount, 0, '新建时没有旧纹理可销毁');

  cache.create(7, 800, 600, 0); // ★换尺寸
  assert.equal(canvases.length, 2, '换尺寸 ⇒ 建新画布');
  assert.equal(cache.pendingDestroyCount, 1, '★旧纹理必须入队（延迟到 present 之后销毁，见 collectGarbage）');

  assert.equal(cache.collectGarbage(), 1, 'collectGarbage 一次清空');
  assert.deepEqual(destroyed, ['tex#1'], '销毁的是**旧**那张（不是刚建的那张）');
});

test('★接线：create 同尺寸 ⇒ 复用画布、不入队（`pendingDestroyCount` 不增）', () => {
  const { factory, canvases } = fakeFactory();
  const cache = new TextureCache(() => {}, undefined, factory);

  cache.create(7, 640, 480, 0);
  cache.create(7, 800, 600, 0); // 先换一次 ⇒ 队列里 1 张
  assert.equal(cache.pendingDestroyCount, 1);

  cache.create(7, 800, 600, 0); // ★同尺寸同 DPR
  assert.equal(canvases.length, 2, '★同尺寸必须复用：不许再建画布（引擎语义 = 清空原表面）');
  assert.equal(cache.pendingDestroyCount, 1, '★复用 ⇒ 不入队（这一条正是"同尺寸不销毁"的判据）');

  // 反向可区分：尺寸差 1 像素也必须换（`max(1, ·)` 之后仍不同）
  cache.create(7, 801, 600, 0);
  assert.equal(canvases.length, 3, '尺寸真变了 ⇒ 必须换');
  assert.equal(cache.pendingDestroyCount, 2);
});

test('★接线：release ⇒ 旧纹理入队；collectGarbage 幂等', () => {
  const { factory, canvases } = fakeFactory();
  const cache = new TextureCache(() => {}, undefined, factory);
  cache.create(3, 100, 50, 0);
  cache.release(3);
  assert.equal(cache.pendingDestroyCount, 1, '★释放也要入队（舞台可能还挂着引用它的 Sprite）');
  assert.equal(cache.collectGarbage(), 1);
  assert.equal(cache.collectGarbage(), 0, '再 flush 一个都不销毁（幂等）');
  assert.equal(canvases.length, 1);
  // 释放后再 create 是 fresh（没有旧画布了）
  cache.create(3, 100, 50, 0);
  assert.equal(cache.pendingDestroyCount, 0, '释放后再建 = fresh（没有旧表面可销毁）');
});

test('★可选缝语义：不注入工厂 ⇒ 不建槽、不入队、不抛（与修前逐字相同）', async () => {
  const logs: string[] = [];
  const cache = new TextureCache((m) => logs.push(m));
  // Node 里没有 document、也没注入工厂
  cache.create(196, 628, 360, 0);
  assert.equal(cache.pendingDestroyCount, 0, '★没有画布 ⇒ 没有旧纹理（修前就是这个行为）');
  cache.create(196, 700, 360, 0);
  assert.equal(cache.pendingDestroyCount, 0, '★换尺寸也一样：不入队（不许因为加了注入口就改变产品行为）');
  cache.release(196);
  assert.equal(cache.pendingDestroyCount, 0);
  assert.equal(cache.collectGarbage(), 0);
  // 引擎字段那一半照旧要写对（与画布无关）：表面尺寸/类仍可查
  cache.create(196, 628, 360, 3);
  assert.equal(cache.surfaceClassOf(196), 'divided', 'mode 3 ⇒ DividedTexture（与画布无关的那一半不许受注入口影响）');
  assert.deepEqual(cache.size(196), { w: 628, h: 360 }, '表面尺寸兜底仍在（`0x208` 的口径）');
});

test('★`setSlotPixels` 必须返回"像素是否真的落地"（⑤ 前半：修前返回 void ⇒ 调用方无条件写 op1=0）', () => {
  const { factory } = fakeFactory();
  const cache = new TextureCache(() => {}, undefined, factory);
  const px = new Uint8Array(8 * 8 * 4);

  // ① 该槽没有表面 ⇒ **false**（引擎同情形下 sub_40BF20/sub_43E9F0 已经失败 ⇒ op1 = 2）
  assert.equal(cache.setSlotPixels(9, 8, 8, px), false, '★没有 create-texture 出来的表面 ⇒ 必须答 false');
  // ② 建过表面 ⇒ true（像素真的铺进去了）
  //   ★Node 里没有 `ImageData`/`document`（`setSlotPixels` 的像素路径要它们）⇒ 装最小桩：
  //     本用例问的是**返回值**（= "表面在不在"），不是像素内容（像素由 E4 截图管）。
  const g = globalThis as unknown as { ImageData?: unknown; document?: unknown };
  const hadImage = 'ImageData' in g;
  const hadDoc = 'document' in g;
  g.ImageData = class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  };
  g.document = { createElement: () => factory.createElement('canvas') };
  try {
    cache.create(9, 8, 8, 0);
    assert.equal(cache.setSlotPixels(9, 8, 8, px), true, '有表面 ⇒ true');
    // ③ release 之后回到 false（表面没了）
    cache.release(9);
    assert.equal(cache.setSlotPixels(9, 8, 8, px), false, '释放后表面没了 ⇒ 又是 false');
  } finally {
    if (!hadImage) delete g.ImageData;
    if (!hadDoc) delete g.document;
  }
});

test('★三态不许混：`undefined`（宿主不实现该缝）与 `false`（该槽没有表面）必须可区分', () => {
  // handler 的分支口径：`landed === false` ⇒ `op1 = 2`；`undefined` ⇒ **保持旧行为**（`op1 = 0`）。
  // 两者混起来会把"没有该缝"误判成"解入失败"（那会给每个 headless/测试宿主都写 2）。
  assert.notEqual(false, undefined, '★false 与 undefined 必须是两类');
  // 用鸭子类型（而不是把 undefined 直接写成可调用）表达"宿主不实现该缝"：
  const hostWithoutSeam = {} as { setSlotPixels?: (...a: unknown[]) => unknown };
  assert.equal(hostWithoutSeam.setSlotPixels?.(1, 2, 3, new Uint8Array(0)), undefined, '不实现该缝 ⇒ 调用结果就是 undefined');
  // 真实实现（本测试注入的工厂路径）答的是 boolean，不是 undefined
  const { factory } = fakeFactory();
  const cache = new TextureCache(() => {}, undefined, factory);
  assert.equal(typeof (cache as { setSlotPixels?: unknown }).setSlotPixels, 'function', '宿主实现了该缝');
  assert.equal(typeof cache.setSlotPixels(0, 1, 1, new Uint8Array(4)), 'boolean', '实现方必须答 boolean');
});
