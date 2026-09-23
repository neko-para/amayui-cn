/** @tier T1 @kind core @subsystem l2d */

/**
 * **Live2D 出画几何守卫**（`tickets/T-0054` 的 M1 收尾：把变形几何真的交给渲染层）。
 *
 * 覆盖的是 `src/live2d/render.ts` 的 `l2dBatches` —— 它是"快照"与"Pixi 合成"的**唯一同源**：
 * 摆放（画布居中）、按纹理号分组、`VISIBLE:` 覆盖、门控（槽空 ⇒ 不出画）都在这里定死，
 * 两个消费方只读结果。所以本文件的断言等价于"屏幕上的立绘"（Pixi 侧只是把 `positions/uvs/
 * indices` 塞进 `MeshGeometry`，没有自己的几何逻辑）。
 *
 * ## 分组
 *  - **合成模型**（不依赖任何资源文件）：摆放公式、UV/索引透传、门控、分组序、`VISIBLE:` 覆盖；
 *  - **真资产 E3**（`raw/` 或 `install/`，缺则 `skip` + 诊断）：TITLE.MOC 走完整链后
 *    `l2dBatches` 的几何自洽（索引不越界、UV 与顶点同长、坐标有限）+ 快照同源。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Container, Mesh, Texture, type MeshGeometry } from 'pixi.js';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/stubNative.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scSnapshot, snapshotToText } from '../src/renderer/scene/snapshot.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { ScenePresenter } from '../src/renderer/pixi/presenter.js';
import { l2dBatches, l2dPlacement, l2dBatchTotals } from '../src/live2d/render.js';
import { l2dCreateNode, l2dBindTexture, l2dLoadModel, l2dTextureMulColor } from '../src/live2d/runtime.js';
import { loadModelIntoSlot, type Live2dAssetSource } from '../src/live2d/assetLoader.js';
import type { MocDrawData, MocModel, MocParts } from '../src/live2d/moc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const VIEW_W = 1280;
const VIEW_H = 720;

function mkEngine(): Engine {
  return new Engine(new StubNative(() => {}), new InputManager());
}

/** 一个网格（全部默认：无变形器、单组关键帧 ⇒ 顶点就是文件里那一组）。 */
function drawable(opts: {
  id: string;
  textureNo: number;
  order: number;
  points: number[];
  opacity?: number;
  culling?: boolean;
}): MocDrawData {
  const n = opts.points.length / 2;
  const uvs: number[] = [];
  for (let i = 0; i < n; i++) uvs.push(i * 0.1, i * 0.2);
  const indices: number[] = [];
  for (let i = 1; i + 1 < n; i++) indices.push(0, i, i + 1);
  return {
    kind: 'drawData',
    id: { kind: 'id', idClass: 'draw', name: opts.id },
    targetId: null,
    pivotManager: { params: [] },
    averageDrawOrder: opts.order,
    pivotDrawOrders: [opts.order],
    pivotOpacities: [opts.opacity ?? 1],
    clipId: null,
    textureNo: opts.textureNo,
    pointCount: n,
    polygonCount: indices.length / 3,
    indexArray: indices,
    pivotPoints: [opts.points],
    uvs,
    optionFlag: 0,
    colorGroupNo: null,
    colorCompositionType: 0,
    culling: opts.culling ?? true,
  };
}

/** 一个部件。 */
function part(id: string, visible: boolean, drawables: MocDrawData[]): MocParts {
  return {
    kind: 'parts',
    locked: false,
    visible,
    id: { kind: 'id', idClass: 'parts', name: id },
    deformers: [],
    drawables,
  };
}

/** 合成模型：画布 100x50、两个部件/四个网格（跨两个纹理号；含一个 op=0 的网格）。 */
function syntheticModel(): MocModel {
  return {
    kind: 'model',
    params: [],
    canvasWidth: 100,
    canvasHeight: 50,
    parts: [
      part('P_A', true, [
        drawable({ id: 'D_BG', textureNo: 1, order: 5, points: [0, 0, 100, 0, 0, 50, 100, 50] }),
        drawable({ id: 'D_FG', textureNo: 0, order: 50, points: [10, 10, 20, 10, 10, 20] }),
        // ★回归点：与 D_FG **同纹理**但 opacity=0 ⇒ 绝不能被并进 D_FG 那一批（并了就整批透明）
        drawable({ id: 'D_EYE_HIDDEN', textureNo: 0, order: 60, points: [1, 1, 2, 1, 1, 2], opacity: 0 }),
      ]),
      part('P_HIDDEN', false, [drawable({ id: 'D_HID', textureNo: 0, order: 1, points: [0, 0, 1, 0, 0, 1] })]),
    ],
    stats: { version: 10, objects: 0, byTag: {}, bytesRead: 0, bytesTotal: 0, eofMarker: true },
  };
}

/**
 * ★**渲染器安全棘轮**：`src/live2d/**` 与 `src/renderer/**` 都跑在 Electron **渲染进程**里
 * （无 Node 集成）。任何 Node 专有全局在这里都是"tsx 下全绿、真机上一跑就炸"的运行时炸弹 ——
 * 实测踩过一次：`moc.ts` 用 `Buffer.from(bytes).toString('utf8')` 解字符串，于是真机上
 * `0x341` 报 `Buffer is not defined` ⇒ 槽保持为空 ⇒ **标题立绘永不出现**，
 * 而 Node 侧的 6 条 Live2D 守卫全部通过。
 *
 * 这条把"Node 专有全局"变成**源码级红灯**（本仓库既有的"源码棘轮"手法，见
 * `test/game-start-chain.test.ts` 的登录棘轮）。
 */
test('渲染器安全：src/live2d 与 src/renderer 不得引用 Node 专有全局（Buffer/process/require/__dirname）', () => {
  const dirs = [path.join(ROOT, 'app/amayui-emulator/src/live2d'), path.join(ROOT, 'app/amayui-emulator/src/renderer')];
  /** 大小写敏感（`.buffer` / `ArrayBuffer` 这类正当用法不受影响）。 */
  const forbidden: { re: RegExp; why: string }[] = [
    { re: /\bBuffer\b/, why: 'Node 专有全局（浏览器/渲染进程 undefined）；字节→字符串用 TextDecoder' },
    { re: /\bprocess\./, why: 'Node 专有全局；渲染进程拿不到（需要的话走 IPC/注入）' },
    { re: /\brequire\(/, why: 'CJS require 在渲染进程不存在' },
    { re: /\b__dirname\b|\b__filename\b/, why: 'CJS 模块作用域变量，ESM/浏览器不存在' },
    { re: /from '(?:node:)?(?:fs|path|os|child_process|worker_threads)'/, why: 'Node 内置模块不能进渲染器 bundle' },
  ];
  const bad: string[] = [];
  let scanned = 0;
  for (const dir of dirs) {
    for (const rel of walkTs(dir)) {
      const text = fs.readFileSync(rel, 'utf8');
      scanned++;
      const lines = text.split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        // 注释行里提到这些名字是**正当的**（本文件与 moc.ts 就在注释里解释了为什么不能用）
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        for (const f of forbidden) {
          if (f.re.test(line)) bad.push(`${path.relative(ROOT, rel)}:${i + 1} ${f.why} :: ${line.trim().slice(0, 80)}`);
        }
      }
    }
  }
  assert.ok(scanned > 20, `应扫描到两个目录下的源码（实际 ${scanned} 个文件）`);
  assert.deepEqual(bad, [], '渲染器会加载这些文件 ⇒ 不得出现 Node 专有全局');
});

/** 目录下的全部 `.ts`（递归；跳过 `.d.ts`）。 */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

test('摆放：画布中心对屏幕中心、画布尺寸只进平移不进缩放（不变量）', () => {
  // 引擎：tx = -canvasW/2、ty = viewH/2 - canvasH/2（raw 134374-134376），再叠投影/视口的
  // (viewW/2, viewH/2) ⇒ 净效果就是 (viewW-canvasW)/2, (viewH-canvasH)/2。
  assert.deepEqual(l2dPlacement(100, 50, VIEW_W, VIEW_H), { dx: 590, dy: 335 });
  // 画布 == 视口 ⇒ 零平移（TITLE.MOC 就是这一档：实测 canvas = 1280x720）
  assert.deepEqual(l2dPlacement(VIEW_W, VIEW_H, VIEW_W, VIEW_H), { dx: 0, dy: 0 });
  // 画布大于视口 ⇒ 负平移（仍然只平移，不缩放）
  assert.deepEqual(l2dPlacement(2560, 1440, VIEW_W, VIEW_H), { dx: -640, dy: -360 });
});

test('出画几何：一个网格一批、顶点含居中平移、UV/索引原样透传、批序 = drawOrder 序', () => {
  const e = mkEngine();
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  l2dBindTexture(e, 0, 0x4f9f, 0);
  l2dBindTexture(e, 0, 0x4fa0, 1);
  l2dCreateNode(e, 0x14, 0);

  const bs = l2dBatches(e, VIEW_W, VIEW_H);
  // P_HIDDEN 的 visible=0 ⇒ 不参与（模型初始位）；剩下 3 个网格 ⇒ **3 批**（每网格一批）
  assert.equal(bs.length, 3, '一个网格一批（隐藏部件不算）');
  assert.deepEqual(
    bs.map((b) => b.id),
    ['D_BG', 'D_FG', 'D_EYE_HIDDEN'],
    '★批次序 = drawOrder 序（D_BG 5 < D_FG 50 < D_EYE_HIDDEN 60），与纹理号大小无关',
  );
  assert.deepEqual(bs.map((b) => b.drawOrder), [5, 50, 60]);
  assert.deepEqual(bs.map((b) => b.partId), ['P_A', 'P_A', 'P_A']);

  const bg = bs[0]!;
  assert.equal(bg.key, 0x14, '批次的归并键 = 572B 节点的 key（= 0x344 的 op1）');
  assert.equal(bg.slot, 0);
  assert.equal(bg.textureNo, 1);
  assert.equal(bg.textureFileId, 0x4fa0, '纹理号 1 → 文件 id 0x4fa0');
  assert.equal(bg.vertexCount, 4);
  assert.equal(bg.triangleCount, 2);
  assert.deepEqual(
    [...bg.positions],
    [590, 335, 690, 335, 590, 385, 690, 385],
    '顶点 = 模型坐标 + 居中平移 (590,335)；y 向下（不给 y 翻转）',
  );
  // ★UV 进的是 `Float32Array`（Pixi 的顶点缓冲就是 f32）⇒ 只能按 f32 精度比较，
  //   不能拿 JS 的 double 字面量做 deepEqual。
  const closeTo = (got: number[], want: number[]): void => {
    assert.equal(got.length, want.length, 'UV 个数应一致');
    for (let i = 0; i < got.length; i++) {
      assert.ok(Math.abs(got[i]! - want[i]!) < 1e-6, `UV[${i}] = ${got[i]}，应≈ ${want[i]}`);
    }
  };
  closeTo([...bg.uvs], [0, 0, 0.1, 0.2, 0.2, 0.4, 0.3, 0.6]);
  assert.deepEqual([...bg.indices], [0, 1, 2, 0, 2, 3], '三角形列表索引原样（批次内顶点从 0 起）');
  assert.deepEqual(bg.rect, { x: 590, y: 335, w: 100, h: 50 });

  const fg = bs[1]!;
  assert.equal(fg.textureFileId, 0x4f9f);
  assert.equal(fg.vertexCount, 3);
  assert.equal(fg.triangleCount, 1);

  // ★★回归：同纹理但 opacity=0 的网格**绝不能**把同纹理的其它网格一起压透明。
  //   旧实现按纹理号合并、取批内最小 opacity ⇒ TITLE 的 `D_EYE.09/10`（op=0）把
  //   整张角色纹理（tex 0）压成 0 ⇒ **整个角色从画面上消失**（实测就是这样）。
  const hidden = bs[2]!;
  assert.equal(hidden.textureNo, 0, '与 D_FG 同纹理');
  assert.equal(hidden.opacity, 0, '它自己这一批才是透明的');
  assert.equal(fg.opacity, 1, '★同纹理的 D_FG 必须仍然是 1（不并批 ⇒ 不被拖累）');
  assert.deepEqual(l2dBatchTotals(bs), { vertices: 10, triangles: 4 });
});

test('门控：槽空 / 节点 bit0 未置 / 键过滤 ⇒ 一个批次都不出（引擎静默不出画）', () => {
  const e = mkEngine();
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  const node = l2dCreateNode(e, 0x14, 0);
  assert.ok(l2dBatches(e, VIEW_W, VIEW_H).length > 0, '前置：正常应出画');

  // ① 键过滤
  assert.equal(l2dBatches(e, VIEW_W, VIEW_H, [0x99]).length, 0, '只要别的 key ⇒ 空');
  assert.equal(l2dBatches(e, VIEW_W, VIEW_H, [0x14]).length, 3, 'key 命中 ⇒ 3 批（一网格一批）');

  // ② 节点 bit0 未置（引擎 `*(_BYTE*)&rec & 1` 门）
  node.flags &= ~1;
  assert.equal(l2dBatches(e, VIEW_W, VIEW_H).length, 0, 'bit0 清掉 ⇒ 整块不出画');
  node.flags |= 1;

  // ③ 槽里的模型被销毁（引擎 raw 134320：槽空 ⇒ 整块不出画、无日志无错误）
  e.l2dSlots.delete(0);
  assert.equal(l2dBatches(e, VIEW_W, VIEW_H).length, 0, '槽空 ⇒ 整块不出画');

  // ④ 节点指向空槽（节点还在、槽没建）
  l2dCreateNode(e, 0x15, 7);
  assert.equal(l2dBatches(e, VIEW_W, VIEW_H, [0x15]).length, 0, '指向空槽 ⇒ 不出画');
});

test('`VISIBLE:` 覆盖生效（模型初始 visible=0 的部件可被动作/0x351 打开）', () => {
  const e = mkEngine();
  l2dLoadModel(e, 0, 0x100, syntheticModel());
  l2dCreateNode(e, 0x14, 0);
  const before = l2dBatchTotals(l2dBatches(e, VIEW_W, VIEW_H)).vertices;
  // 动作的 `VISIBLE:PARTS_...=` 写的是这张表（`mtn.ts` 的 startMotion；P_HIDDEN 初始 0）
  e.l2dSlots.get(0)!.partVisible.set('P_HIDDEN', true);
  const after = l2dBatchTotals(l2dBatches(e, VIEW_W, VIEW_H));
  assert.ok(after.vertices > before, '打开隐藏部件 ⇒ 顶点数应增加');
});

test('`textureNo == -1` 不当成纹理号（-1 号键是 `0x34F` 的乘色记录，不是文件 id）', () => {
  const e = mkEngine();
  const model = syntheticModel();
  // 把 P_A 的第一个网格改成"没有纹理"（`.moc` 里 `textureNo = -1` 的语义）
  model.parts[0]!.drawables[0]!.textureNo = -1;
  l2dLoadModel(e, 0, 0x100, model);
  // `0x34F` 把乘色写进 `textures` 的 **-1 号键**（引擎同口径的"乘色记录"）
  l2dTextureMulColor(e, 0, 0x80ff00ff);
  l2dCreateNode(e, 0x14, 0);
  const bs = l2dBatches(e, VIEW_W, VIEW_H);
  const none = bs.find((b) => b.textureNo === -1);
  assert.ok(none, '应有 textureNo = -1 的那一批');
  assert.equal(none.textureFileId, null, '★不能把乘色记录 0x80ff00ff 当成纹理文件 id');
  assert.equal(none.mulColor, 0x80ff00ff, '乘色记录本身要能读到（渲染时乘在纹理上）');
});

test('★出画对象跨帧复用（不每帧 new Mesh/geometry）—— 防 Pixi 的 GPU 资源堆积', () => {
  // 为什么必须钉住：Pixi v8 的 GPU 资源 GC 是 `gcMaxUnusedTime = 60s` / `gcFrequency = 30s`
  // （`GCSystem.js`），而 TITLE 有 **60 个网格** ⇒ 每帧新建 geometry = **3600 个/秒**，
  // 它们要 60 秒后才可能被回收 ⇒ 存活对象涨到十万量级（每个还带 VAO+3 个 GL 缓冲）
  // ⇒ 周期性长顿卡（用户实测"卡顿不均匀"）。复用后稳定在 60 个。
  const root = new Container();
  const presenter = new ScenePresenter(root, new TextureCache(() => {}), Texture.WHITE, () => {}, VIEW_W, VIEW_H, {
    get: () => Texture.WHITE,
    loadedCount: 1,
  });
  const e = mkEngine();
  const model = syntheticModel();
  l2dLoadModel(e, 0, 0x100, model);
  l2dBindTexture(e, 0, 0x4f9f, 0);
  l2dBindTexture(e, 0, 0x4fa0, 1);
  l2dCreateNode(e, 0x14, 0);
  const scene = newSceneState();
  scene.l2dHost = e;

  const meshes = (): Mesh[] => root.children.filter((c): c is Mesh => c instanceof Mesh);

  presenter.present(scene, 0, 0);
  const first = meshes();
  assert.equal(first.length, 3, '合成模型 3 个网格 ⇒ 3 个 Mesh');
  presenter.present(scene, 16, 0);
  const second = meshes();
  assert.equal(second.length, 3);
  // 身份相同 ⇒ 复用（不是每帧新建）
  assert.ok(
    first.every((m, i) => m === second[i]),
    '★同一批次跨帧必须是**同一个 Mesh 实例**（复用；新建会导致 GPU 资源堆积）',
  );

  // ★复用路径必须真的把新几何写进去（就地上传），否则画面会冻在第一帧
  const g = second[0]!.geometry as MeshGeometry;
  const before = [...g.positions];
  model.parts[0]!.drawables[0]!.pivotPoints[0] = [0, 0, 100, 0, 0, 50, 60, 50];
  presenter.present(scene, 32, 0);
  const after = [...(meshes()[0]!.geometry as MeshGeometry).positions];
  assert.notDeepEqual(after, before, '模型顶点变了 ⇒ 复用对象的顶点缓冲也要更新（就地写入 + 重新赋值）');

  // 节点撤掉 ⇒ 缓存回收（下次建节点是**新对象**）
  const keptMesh = meshes()[0]!;
  e.l2dNodes.delete(0x14);
  presenter.present(scene, 48, 0);
  assert.equal(meshes().length, 0, '节点没了 ⇒ 本帧一个 L2D Mesh 都不挂');
  l2dCreateNode(e, 0x14, 0);
  presenter.present(scene, 64, 0);
  assert.notEqual(meshes()[0], keptMesh, '回收后重建 ⇒ 应是新对象（旧的已被 destroy）');
});

test('真资产 E3：TITLE.MOC 经装载链后的批次几何自洽，且快照与画面同源', async (t) => {
  const root = ['raw', 'install'].map((c) => path.join(ROOT, c)).find((d) => fs.existsSync(path.join(d, 'SYS4INI.BIN')));
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根（raw/ 或 install/）—— 本机未装原始资源');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  const e = mkEngine();
  e.fileSource = src;
  const asrc: Live2dAssetSource = { loadById: (id) => src.readById(id) };

  const ID_MOC = 0x4f9e;
  const model = await loadModelIntoSlot(asrc, e, ID_MOC, 0, () => {});
  assert.ok(model, '应能解析 TITLE.MOC');
  // `src/SETL2DMOC.txt:24-27` 就是这三行（TITLE.MOC 分支）：纹理号 0/1/2 ↔ 0x4f9f/0x4fa0/0x4fa1
  const TEX: Record<number, number> = { 0: 0x4f9f, 1: 0x4fa0, 2: 0x4fa1 };
  for (const [no, id] of Object.entries(TEX)) l2dBindTexture(e, 0, id, Number(no));
  l2dCreateNode(e, 0x14, 0);

  const bs = l2dBatches(e, VIEW_W, VIEW_H);
  assert.ok(bs.length >= 1, 'TITLE.MOC 应至少算出一个批次');
  const total = l2dBatchTotals(bs);
  assert.ok(total.vertices > 100 && total.triangles > 50, `几何规模应可观，实际 ${JSON.stringify(total)}`);
  for (const b of bs) {
    assert.equal(b.indices.length, b.triangleCount * 3, '索引数 = 3 × 三角形数（三角形列表）');
    assert.equal(b.positions.length, b.vertexCount * 2, 'positions 是 x,y 交错');
    assert.equal(b.uvs.length, b.positions.length, 'UV 与顶点同长');
    for (let i = 0; i < b.indices.length; i++) {
      assert.ok(b.indices[i]! < b.vertexCount, `索引 ${b.indices[i]} 应在 [0,${b.vertexCount}) 内`);
    }
    for (let i = 0; i < b.positions.length; i++) assert.ok(Number.isFinite(b.positions[i]!), '顶点应有限');
    // 三个纹理号都按 SETL2DMOC 绑过 ⇒ 每批都必须有图（有 null 就说明分组把纹理号弄错了）
    assert.equal(b.textureFileId, TEX[b.textureNo], `纹理号 ${b.textureNo} 应绑到 0x${(TEX[b.textureNo] ?? 0).toString(16)}`);
  }

  // ★快照与画面**同源**：快照里的批次数/三角形数必须等于这里算出来的
  const snap = scSnapshot(newSceneState(), 0, e);
  const node = snap.l2d!.nodes.find((n) => n.key === 0x14);
  assert.ok(node, '快照里应有节点 key=0x14');
  assert.equal(node.drawable, true);
  assert.equal(node.batches, bs.length, '快照批次数 = 绘制批次数（同一函数）');
  assert.equal(node.triangles, total.triangles, '快照三角形数 = 绘制三角形数');
  assert.deepEqual(
    node.tex.map((x) => x.fileId),
    bs.map((b) => b.textureFileId),
    '快照的纹理来源与绘制批次一一对应（缺绑定时两处都为 null）',
  );
  // 文本快照里能直接看到"算出来了、贴图是哪个"
  const text = snapshotToText(snap);
  assert.match(text, /l2d-node key=0x14 slot=0 可绘制=1 批次=\d+ 三角=\d+/);
  assert.match(text, /tex=\[[^\]]*0:0x4f9f\/\d+△/);
  await src.dispose?.();
});
