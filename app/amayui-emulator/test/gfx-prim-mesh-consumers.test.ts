/** @tier T0 @kind core @subsystem render */

/**
 * ★★**A4 记录族里那四条"有写无读"终于接上消费者**（审计 §4.2 #8
 * `gfx-prim-mesh-and-render-state`，P1）。
 *
 * 修前：`0x1FC`（复位图元变换）/ `0x1FE`（图元变换 4 浮点）/ `0x321`（MeshEntry 属性）/
 * `0x32D`（3D 颜色）写进 `render4` 之后**没有任何渲染消费者** —— presenter 的 `drawMesh` 只看
 * `m.flags`/`m.verts`，`primTransform` 也不参与几何 ⇒ 真机上由这些状态决定的画面在 emulator 里
 * 完全不生效（不报错、不回写操作数，纯脚本链路与帧摘要都看不出来）。
 *
 * 本文件按**引擎语义**逐条钉住新的消费者（raw 锚点 = `engine/天结_unpacked.exe_utf8.c`）：
 *  - `0x1FE`（`sub_4AC660` raw 131355-131398）：`(op2,op3,op4)` = **旋转轴**、`op5` = **角（度）**，
 *    写 `+0x1EC../+0x204` 并 `D3DXMatrixRotationAxis(+0xEC, 轴, 角·π/180)` ⇒ 走旋转求值器；
 *  - `0x1FC`（`sub_4AC470` raw 131268-131330）：三块 work 矩阵复位成单位 + `+104 = 0`
 *    （**不碰** `+0x68` = `useWorld`）；
 *  - `0x321`（`sub_4AE280`）：`entry[op2 + 7] = op3` ⇒ 网格条目的绘制参数（本层接成逐顶点倍率）；
 *  - `0x32D`（`sub_499DF0` raw 116557-116697）：四分量折成 0..255 后
 *    `SetRenderState(139 = D3DRS_TEXTUREFACTOR, …)`（raw 116637/116693-116696）⇒ 网格通路的染色。
 *
 * ★**披露的两处近似**（写在这里免得后人当成"逐位对齐"）：
 *  1. `0x321` 的下标 0/1 在引擎里是顶点缓冲记录的内部记账（`SETPOLYGON.txt:53` 的
 *     `i321 30d40 0 2a` 落在下标 0）⇒ 本层**只用下标 ≥2** 当逐顶点倍率（0/1 不参与着色）；
 *  2. `0x32D` 的 `D3DRS_TEXTUREFACTOR` 在真机上只影响"用了该 stage 常量"的纹理阶段 ⇒ 本层
 *     把它当**网格通路的全局染色倍率**（恒等 `[1,1,1,1]` 不做乘法，与修前逐字节相同）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture } from 'pixi.js';
import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import {
  scResetPrimTransform,
  scSet3DColor,
  scSetMeshEntryAttr,
  scSetPrimTransform4,
} from '../src/renderer/scene/ops.js';
import {
  itemRenderPlacement,
  itemRotationRad,
  itemUsesWorld,
  makeItem,
  meshColor,
  scaleArgb,
  type MeshObj,
} from '../src/renderer/drawItem.js';

const VIEW_W = 1280;
const VIEW_H = 720;

/** 一个满屏 mesh（几何已建、基础色全白）—— 与 `test/mesh-vertex-quad.test.ts` 的夹具同形。 */
function fullScreenMesh(handle = 0x30d40): MeshObj {
  return {
    handle,
    layer: 0,
    flags: 1,
    state0: 0xffffffff,
    state1: -1,
    verts: [
      { x: 0, y: 0, z: 0, u: 0, v: 0 },
      { x: 1280, y: 0, z: 0, u: 1, v: 0 },
      { x: 0, y: 720, z: 0, u: 0, v: 1 },
      { x: 1280, y: 720, z: 0, u: 1, v: 1 },
    ],
    baseColors: [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
    blend: 0,
  };
}

/** 一个已可绘制（`flags & 1`）的项。 */
function itemAt(handle: number): ReturnType<typeof makeItem> {
  const it = makeItem({ handle, layer: handle, tex: 0, srcX: 0, srcY: 0, srcW: 8, srcH: 8, dstX: 0, dstY: 0 });
  it.flags |= 1; // draw-texture 置的可绘制位
  return it;
}

test('★`0x1FE`：`(op2,op3,op4,op5)` = 轴 + 角（度）⇒ 真的进旋转求值器（raw 131355-131398）', () => {
  const s = newSceneState();
  const it = itemAt(0x100);
  s.drawItems.set(0x100, it);

  // 语料形态：`i1fe <handle> 0 0 1 b9`（轴 = +z、角 = 185°）
  scSetPrimTransform4(s, 0x100, 0, 0, 1, 185);
  assert.equal(itemUsesWorld(it), true, '★引擎写 `+0x68 = 1`（raw 131379）⇒ 走世界矩阵路径');
  assert.ok(
    Math.abs(itemRotationRad(it, 0) - (185 * Math.PI) / 180) < 1e-9,
    `★角必须进旋转求值器（185° ⇒ ${(185 * Math.PI) / 180} rad）`,
  );
  // 轴为 −z ⇒ 反向（emulator 的标量角近似，与 `loopRotationDeg` 同一处置）
  scSetPrimTransform4(s, 0x100, 0, 0, -1, 185);
  assert.ok(Math.abs(itemRotationRad(it, 0) + (185 * Math.PI) / 180) < 1e-9, '轴 z<0 ⇒ 反向');
  assert.ok(Math.abs(itemRenderPlacement(it, 0).rotRad + (185 * Math.PI) / 180) < 1e-9, '渲染位姿同源');
  // 台账字段仍在（报告/快照要能看到脚本下发的原值）
  assert.deepEqual(s.render4.primTransform.get(0x100), [0, 0, -1, 185]);
  // 缺失即建（引擎 `sub_4AAA50`）：项不存在也不抛，建出来的是 flags=0 的不可绘制项
  scSetPrimTransform4(s, 0x999, 0, 0, 1, 10);
  assert.equal(s.drawItems.get(0x999)!.flags & 1, 0, '缺失即建 ⇒ 尚不可绘制（与引擎同）');
});

test('★`0x1FC`：复位三块 work 矩阵（含 target）但**不**退出世界矩阵路径（raw 131268-131330）', () => {
  const s = newSceneState();
  const it = itemAt(0x101);
  s.drawItems.set(0x101, it);

  scSetPrimTransform4(s, 0x101, 0, 0, 1, 90);
  assert.notEqual(itemRotationRad(it, 0), 0, '基线：转起来了');
  scResetPrimTransform(s, 0x101);
  assert.equal(itemRotationRad(it, 0), 0, '★复位 ⇒ 角回 0');
  assert.deepEqual(it.scaleWork, { x: 1, y: 1, z: 1 });
  assert.deepEqual(it.transWork, { x: 0, y: 0, z: 0 });
  assert.equal(it.useWorld, true, '★体里 `sub_4AC470` 不碰 `+0x68` ⇒ 不许把项退出世界矩阵路径');
  assert.equal(s.render4.primReset, 0x101, '台账保留（报告可见）');
  assert.equal(s.render4.primTransform.has(0x101), false, '台账里的 4 浮点被清掉（复位成单位）');
});

test('★`0x321`：MeshEntry 属性 ⇒ 网格可见色真的变（presenter 消费 `render4.meshAttrs`）', () => {
  const m = fullScreenMesh();
  const state = 0xffffffff;
  assert.equal(meshColor(m, state) >>> 0, 0xffffffff, '基线：无属性 ⇒ 全白（不做任何乘法）');
  assert.equal(meshColor(m, state, new Map([[0, 0x2a]])) >>> 0, 0xffffffff, '★下标 0/1 = 引擎内部记账 ⇒ 不着色');

  const attrs = new Map<number, number>([[2, 0x80]]); // 下标 ≥2：倍率 = 0x80/255
  assert.equal(meshColor(m, state, attrs) >>> 0, 0x80808080, '★下标 ≥2 ⇒ 逐通道 × 0x80/0xff = 0x80');

  // 经 opcode 的写入路径（`scSetMeshEntryAttr` = `0x321` 的 handler 落点）
  const s = newSceneState();
  s.meshes.set(0x30d40, m);
  scSetMeshEntryAttr(s, 0x30d40, 2, 0x80);
  assert.deepEqual([...s.render4.meshAttrs.get(0x30d40)!.entries()], [[2, 0x80]]);
  assert.equal(meshColor(m, state, s.render4.meshAttrs.get(0x30d40)) >>> 0, 0x80808080);
});

test('★`scaleArgb`（两个倍率的公共原语）：逐通道且**不越位**（ARGB，与 `mulArgb` 同序）', () => {
  assert.equal(scaleArgb(0xffffffff, 1, 0, 0, 1) >>> 0, 0xffff0000, '只保 R：α=ff、R=ff、G=B=0');
  assert.equal(scaleArgb(0xffffffff, 0, 1, 0, 1) >>> 0, 0xff00ff00, '只保 G ⇒ 绿色必须落在 **8 位**上');
  assert.equal(scaleArgb(0xffffffff, 0, 0, 1, 1) >>> 0, 0xff0000ff, '只保 B ⇒ 蓝色落在 **0 位**上');
  assert.equal(scaleArgb(0xffffffff, 1, 1, 1, 1) >>> 0, 0xffffffff, '恒等 ⇒ 逐字节不变（所以恒等值可以安全"不参与"）');
  assert.equal(scaleArgb(0xffffffff, 0, 0, 0, 0.5) >>> 0, 0x80000000, 'α 0.5 ⇒ 128（8 位往返）');
});

test('★`0x32D`：3D 颜色 ⇒ 网格可见色被染色，恒等值不参与乘法（raw 116557-116697）', () => {
  const m = fullScreenMesh();
  assert.equal(meshColor(m, 0xffffffff, undefined, [1, 1, 1, 1]) >>> 0, 0xffffffff, '★恒等 [1,1,1,1] ⇒ 逐字节不变');

  const s = newSceneState();
  scSet3DColor(s, 1, 0, 0, 1);
  assert.deepEqual(s.render4.color3D, [1, 0, 0, 1]);
  // ★乘法是**逐通道**的（`scaleArgb` 的 `kr/kg/kb/ka`）⇒ `color3D = [1,0,0,1]` 只保 R 通道：
  //   α=ff、R=ff、G/B=0 ⇒ ARGB = `0xffff0000`（不是 `0xffffffff`）。
  assert.equal(meshColor(m, 0xffffffff, undefined, s.render4.color3D) >>> 0, 0xffff0000, '★只留 R 通道、G/B 归零');
  scSet3DColor(s, 0, 0, 0, 0.5);
  assert.equal(meshColor(m, 0xffffffff, undefined, s.render4.color3D) >>> 0, 0x80000000, 'α 也乘');
  scSet3DColor(s, 1, 1, 1, 1);
  assert.equal(meshColor(m, 0xffffffff, undefined, s.render4.color3D) >>> 0, 0xffffffff, '写回恒等 ⇒ 仍然逐字节不变');
});

/** 取一个 Graphics 的 `fill({ color, alpha })` 实参（Pixi v8：`context.instructions[i].data.style`）。 */
function fills(g: unknown): { color: number; alpha: number }[] {
  const ctx = (g as { context?: { instructions?: unknown[] } }).context;
  const out: { color: number; alpha: number }[] = [];
  for (const ins of ctx?.instructions ?? []) {
    const d = (ins as { action?: string; data?: { style?: { color?: number; alpha?: number } } });
    if (d?.action === 'fill' && typeof d.data?.style?.alpha === 'number') {
      out.push({ color: d.data.style.color ?? 0, alpha: d.data.style.alpha });
    }
  }
  return out;
}

test('★端到端：presenter 把两个倍率画进 Graphics（不是"只在 eval 层对"）', () => {
  const root = new Container();
  const cache = new TextureCache(() => {});
  cache.slotTex.set(1, Texture.WHITE);
  const presenter = new ScenePresenter(root, cache, Texture.WHITE, () => {}, VIEW_W, VIEW_H);
  const scene = newSceneState();
  scene.meshes.set(0x30d40, fullScreenMesh(0x30d40));
  scene.meshes.set(0x30d41, fullScreenMesh(0x30d41));
  scSetMeshEntryAttr(scene, 0x30d40, 2, 0x80); // 只染 0x30d40
  scSet3DColor(scene, 1, 1, 1, 0.5); // 全局 α 减半（两条 mesh 都吃）

  presenter.present(scene, 0, 0);
  assert.equal(root.children.length, 2, '两条 mesh 都出画');
  assert.deepEqual(
    root.children.map((c) => fills(c)),
    [
      [{ color: 0x808080, alpha: 0x80 / 255 / 2 }],
      // ★α 走的是**8 位往返**（`scaleArgb` 逐通道取整，与引擎 `sub_499DF0` 把 0..1 折成 0..255 同一口径）
      //   ⇒ `0.5 × 255 = 127.5 → 128` ⇒ 传回 Pixi 的是 `128/255`，不是 `0.5`。
      [{ color: 0xffffff, alpha: 128 / 255 }],
    ],
    '★0x30d40 = 0x80/255（属性）× 0.5（3D 颜色）、0x30d41 = 1 × 0.5（属性只作用在它自己那条 mesh 上）',
  );
});
