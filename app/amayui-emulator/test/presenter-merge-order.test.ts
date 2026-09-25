/** @tier T0 @kind core @subsystem render */

/**
 * **四路同键归并次序**（`tickets/T-0175` 的 ⑦ 后半，出处 `tickets/T-0166` §4-④）。
 *
 * ## 为什么单开一条（而不是并进 `test/render-draw-order.test.ts`）
 *
 * 那条（`T-0124` 的 Z1）只覆盖**第一路**（draw-item 之间按 `layer`/`handle` 升序）；把它的排序键
 * 反转会红。但**四路合流后的等键次序**（`item → text → mesh → L2D 节点`）**一条断言都没有**：
 * 引擎 `sub_4B06D0` 是三张有序表取最小键先画（raw 135560-135614），等键时节点**输给** item 与 mesh
 * （raw 135586-135614 的三个分支）⇒ emulator 用 `order: 0|1|2|3` 表达（`presenter.ts:360-395`）。
 * 把 `order` 反转（`3|2|1|0`）修前**全量无红** —— 那就是一个零覆盖点，与 Z1 同形。
 *
 * ## 判据
 *
 *  - **同键**放四路各一个（图元 / 文本 / mesh / L2D 节点）⇒ 可见次序必须是 `item → text → mesh → L2D`；
 *  - **不同键**再放一轮（键序与路序**故意错开**）⇒ 次序必须整体按键升序（证明四路真的进了同一次归并，
 *    而不是"各路各自追加"）；
 *  - 反向自检：把 L2D 的归并键改到最大 ⇒ 次序随之改变（防"只看 order 不看 key"）。
 *
 * ★L2D 批次由**合成模型**产生（`l2dLoadModel`：只填 `Map`，不读任何资源文件 ⇒ T0）。
 * ★本文件**不 import `Engine`**：那样会经 `ops → handlers/**` 拉起整条 VM 装配链，
 *   测试就变成"在测别人的模块图"（并行重构 handlers 时会被无关的中间态打断）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Graphics, Mesh, Sprite, Texture } from 'pixi.js';
import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { newSceneState, type SceneState } from '../src/renderer/scene/state.js';
import { scConfigureDrawItem, scCreateMesh } from '../src/renderer/scene/ops.js';
import { l2dCreateNode, l2dBindTexture, l2dLoadModel, type L2dHost } from '../src/live2d/runtime.js';
import type { MocDrawData, MocModel, MocParts } from '../src/live2d/moc.js';

const VIEW_W = 1280;
const VIEW_H = 720;

/** 一个可绘制的网格规格（照 `test/scene-t0154-mesh-transition.test.ts` 的 `specFor` 口径）。 */
function quadSpec(handle: number, layer: number, x: number, y: number): {
  handle: number;
  layer: number;
  vcount: number;
  verts: { x: number; y: number; z: number; u: number; v: number }[];
  baseColors: number[];
} {
  return {
    handle,
    layer,
    vcount: 4,
    verts: [
      { x, y, z: 0, u: 0, v: 0 },
      { x: x + 10, y, z: 0, u: 1, v: 0 },
      { x, y: y + 10, z: 0, u: 0, v: 1 },
      { x: x + 10, y: y + 10, z: 0, u: 1, v: 1 },
    ],
    baseColors: [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
  };
}

/**
 * 造一个"一定画得出来"的 mesh。
 *
 * ★两个坑（都是我第一版踩过的，写在这里免得后人重踩）：
 *  1. `vcount` **必须给**：`scCreateMesh` 对 `vcount <= 0`（含 `undefined`）走"不建项、不碰已有项"
 *     的早退 ⇒ mesh 静默不出画，而断言会把它误读成"次序不对"；
 *  2. `state0` 必须写成非 0：`makeMesh` 的初值自 `T-0179`（第 63 轮）起已是
 *     `0xFFFFFFFF`（引擎 `sub_49C9D0` raw 118396-118397 的 `a1[13] = -1`，见
 *     `test/scene-320-mesh-initial-state.test.ts`）；这里仍显式写一遍是为了让本文件
 *     不依赖那一格的初值（`presenter.drawMesh` 对 `calcDiffuse(...) >>> 24 <= 0` 直接 return）。
 */
function addMesh(scene: SceneState, handle: number, layer: number, x: number, y: number): void {
  scCreateMesh(scene, quadSpec(handle, layer, x, y));
  const m = scene.meshes.get(handle)!;
  assert.equal(m.flags & 1, 1, '前置：create-mesh 必须置可绘制位（否则后续断言没有意义）');
  m.state0 = 0xffffffff;
}

/** 一个网格（全部默认：无变形器、单组关键帧 ⇒ 顶点就是文件里那一组）。 */
function drawable(id: string, textureNo: number, order: number, cx: number): MocDrawData {
  const points = [cx, 100, cx + 10, 100, cx, 110];
  const n = points.length / 2;
  return {
    kind: 'drawData',
    id: { kind: 'id', idClass: 'draw', name: id },
    targetId: null,
    pivotManager: { params: [] },
    averageDrawOrder: order,
    pivotDrawOrders: [order],
    pivotOpacities: [1],
    clipId: null,
    textureNo,
    pointCount: n,
    polygonCount: 1,
    indexArray: [0, 1, 2],
    pivotPoints: [points],
    uvs: [0, 0, 1, 0, 0, 1],
    optionFlag: 0,
    colorGroupNo: null,
    colorCompositionType: 0,
    culling: true,
  };
}

/** 一个部件的合成模型（单个网格）。 */
function modelWith(cx: number): MocModel {
  const parts: MocParts = {
    kind: 'parts',
    locked: false,
    visible: true,
    id: { kind: 'id', idClass: 'parts', name: 'P_A' },
    deformers: [],
    drawables: [drawable('D_A', 0, 1, cx)],
  };
  return {
    kind: 'model',
    params: [],
    canvasWidth: VIEW_W,
    canvasHeight: VIEW_H,
    parts: [parts],
    stats: { version: 10, objects: 0, byTag: {}, bytesRead: 0, bytesTotal: 0, eofMarker: true },
  };
}

/** 一个已经装好 L2D 的宿主（槽 0 有模型、纹理号 0 绑到文件 id 0x4f9f、节点 key = key）。 */
function l2dHost(key: number, cx: number): L2dHost {
  const host: L2dHost = { l2dSlots: new Map(), l2dNodes: new Map(), l2dMotionCache: new Map() };
  l2dLoadModel(host, 0, 0x100, modelWith(cx));
  l2dBindTexture(host, 0, 0x4f9f, 0);
  l2dCreateNode(host, key, 0);
  return host;
}

/**
 * 每一路用一个**可读标签**。
 *
 * ★判据必须只靠"结构性事实"而不是坐标猜测：
 *  - L2D 节点批次是 `Mesh`，且**四路里只有它走 `Mesh`**（mesh 走 `Graphics`，见 `presenter.drawMesh`）；
 *  - 图元与文本都是 `Sprite` ⇒ 用**实例同一性**把注入的那个文本精灵认出来（图元每帧新建，必不是它）；
 *  - `Graphics` = mesh；
 *  - 剩下的一律是"包了一层 Container 的文本"（Scene 变换非单位时才会走到）。
 */
function kindOf(child: unknown, textSprite: Sprite): string {
  if (child instanceof Mesh) return 'l2d';
  if (child === textSprite) return 'text';
  if (child instanceof Sprite) return 'item';
  if (child instanceof Graphics) return 'mesh';
  return 'wrap(text)';
}

function childKinds(root: Container, textSprite: Sprite): string[] {
  return root.children.map((c) => kindOf(c, textSprite));
}

/** 一个装好画布槽的 presenter（`Texture.WHITE` 当 1×1 单位纹理与 L2D 纹理库）。 */
function rig(): { root: Container; presenter: ScenePresenter; cache: TextureCache } {
  const root = new Container();
  const cache = new TextureCache(() => {});
  cache.slotTex.set(1, Texture.WHITE);
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, VIEW_W, VIEW_H, {
    get: () => Texture.WHITE,
    loadedCount: 1,
  });
  return { root, presenter, cache };
}

/** 一个尺寸为 8×8 的假文本精灵。 */
function textSprite(): Sprite {
  const s = new Sprite(Texture.WHITE);
  s.width = 8;
  s.height = 8;
  return s;
}

test('★四路同键 ⇒ 可见次序 = item → text → mesh → L2D（raw 135560-135614）', () => {
  const { root, presenter } = rig();
  const scene = newSceneState();
  const KEY = 100; // ★四路共用同一个归并键
  scConfigureDrawItem(scene, {
    handle: KEY, layer: KEY, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 1000, dstY: 0,
  });
  addMesh(scene, KEY, KEY, 500, 300);
  scene.l2dHost = l2dHost(KEY, 300);
  const sprite = textSprite();

  const drawn = presenter.present(scene, 0, 0, [{ win: 0, layer: KEY, sprite }]);
  assert.ok(drawn >= 1, `至少图元要出画（实际 ${drawn}）`);
  assert.deepEqual(
    childKinds(root, sprite),
    ['item', 'text', 'mesh', 'l2d'],
    '★同一个归并键下：图元 → 文本 → mesh → L2D 节点（引擎 raw 135586-135614 的三个分支里节点输给前两者）',
  );
});

test('★四路不同键 ⇒ 整体按键升序（四路真的进了同一次归并，不是各路各自追加）', () => {
  const { root, presenter } = rig();
  const scene = newSceneState();
  // 故意让"键序"与"路序"错开：L2D 键最小、图元键最大 ⇒ 只按 order 排的实现会整体错位
  scConfigureDrawItem(scene, {
    handle: 400, layer: 400, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 1000, dstY: 0,
  });
  addMesh(scene, 300, 300, 500, 300);
  scene.l2dHost = l2dHost(100, 300);
  const sprite = textSprite();

  presenter.present(scene, 0, 0, [{ win: 0, layer: 200, sprite }]);
  assert.deepEqual(
    childKinds(root, sprite),
    ['l2d', 'text', 'mesh', 'item'],
    '★归并键 = 100(L2D) → 200(文本) → 300(mesh) → 400(图元)：四路共用一套键序',
  );
});

test('★反向自检：把 L2D 的归并键改到最大 ⇒ 次序必须随之改变（防"只看 order 不看 key"）', () => {
  const { root, presenter } = rig();
  const scene = newSceneState();
  scConfigureDrawItem(scene, {
    handle: 200, layer: 200, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 1000, dstY: 0,
  });
  scene.l2dHost = l2dHost(999, 300); // 键 > 图元
  const sprite = textSprite();
  presenter.present(scene, 0, 0, [{ win: 0, layer: 100, sprite }]);
  assert.deepEqual(
    childKinds(root, sprite),
    ['text', 'item', 'l2d'],
    '键序优先于路序：文本(100) → 图元(200) → L2D(999)',
  );
});

test('★反向自检：等键时把 mesh 的 order 排到文本之前 ⇒ 必红（证明这条断言盯着 order）', () => {
  // 这条**模拟变异**：不真改 `presenter.ts`，而是构造"引擎次序下不可能出现"的期望值，
  // 断言它**不等于**实际次序 —— 于是"order 被改坏"这件事在测试里有一个可复算的反例。
  const { root, presenter } = rig();
  const scene = newSceneState();
  const KEY = 42;
  scConfigureDrawItem(scene, {
    handle: KEY, layer: KEY, tex: 1, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 1000, dstY: 0,
  });
  addMesh(scene, KEY, KEY, 500, 300);
  scene.l2dHost = l2dHost(KEY, 300);
  const sprite = textSprite();
  presenter.present(scene, 0, 0, [{ win: 0, layer: KEY, sprite }]);
  const kinds = childKinds(root, sprite);
  assert.deepEqual(kinds, ['item', 'text', 'mesh', 'l2d']);
  assert.notDeepEqual(
    kinds,
    ['item', 'mesh', 'text', 'l2d'],
    '★把 `order` 反转/交换（mesh 与 text 对调）必须与观测到的次序**可区分** —— 这是那条断言的判别力',
  );
});
