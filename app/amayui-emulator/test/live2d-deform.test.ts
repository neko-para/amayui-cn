/**
 * **Live2D 变形语义守卫**（T-0054 M1/E3：headless 不依赖 WebGL）。
 *
 * 目的：把"参数 → 顶点"这条链钉死，使 `moc.ts`（解析）+ `deform.ts`（变形数学）任何一处退化都变红。
 * 资源：真实语料 `raw-parts/`（ALF 解包树）；缺失 ⇒ skip + 诊断。
 *
 * 依据：`src/live2d/deform.ts` 头注释（O = 反编译 oracle、E = 资产实证、S1/S2/S3 = 交叉验证）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoc, type MocModel } from '../src/live2d/moc.js';
import {
  AFFINE_IDENTITY,
  affineApply,
  affineEntToMatrix,
  affineMul,
  boxGridPoint,
  evaluateModel,
  flattenDrawOrder,
  newParamState,
  pickPivot,
  pivotCombos,
} from '../src/live2d/deform.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function findMoc(name: string): string | null {
  for (const cand of ['raw-parts', 'raw']) {
    const dir = path.join(REPO_ROOT, cand);
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) stack.push(path.join(cur, e.name));
        else if (e.name.toLowerCase() === name.toLowerCase()) return path.join(cur, e.name);
      }
    }
  }
  return null;
}

function bbox(pts: number[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]!);
    x1 = Math.max(x1, pts[i]!);
    y0 = Math.min(y0, pts[i + 1]!);
    y1 = Math.max(y1, pts[i + 1]!);
  }
  return { x0, x1, y0, y1 };
}

test('deform：仿射矩阵的复合 / 求值口径（T·R·S，y 向下）', () => {
  // 纯平移
  const t: readonly [number, number, number, number, number, number] = [1, 0, 0, 1, 10, -20];
  assert.deepEqual(affineApply(t, 1, 2), { x: 11, y: -18 });
  // 90° 旋转（度）+ 平移：点 (1,0) → (0,1) 方向（y 向上、逆时针）
  const rot = affineEntToMatrix({
    kind: 'affineEnt',
    originX: 0,
    originY: 0,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 90,
    reflectX: false,
    reflectY: false,
  });
  const p = affineApply(rot, 1, 0);
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y - 1) < 1e-9, `90° 应把 (1,0) 转到 (0,1)，实得 ${JSON.stringify(p)}`);
  // 缩放 + 原点：先缩放再平移
  const sc = affineEntToMatrix({
    kind: 'affineEnt',
    originX: 100,
    originY: 50,
    scaleX: 2,
    scaleY: 3,
    rotationDeg: 0,
    reflectX: false,
    reflectY: false,
  });
  assert.deepEqual(affineApply(sc, 1, 1), { x: 102, y: 53 });
  // 复合顺序：先 m1 后 m2
  const m1: readonly [number, number, number, number, number, number] = [2, 0, 0, 2, 0, 0];
  const m2: readonly [number, number, number, number, number, number] = [1, 0, 0, 1, 5, 5];
  assert.deepEqual(affineApply(affineMul(m2, m1), 1, 1), { x: 7, y: 7 });
  assert.deepEqual(affineApply(AFFINE_IDENTITY, 3, 4), { x: 3, y: 4 });
});

test('deform：BDBoxGrid 双三次求值 → 四个角 = 四个控制点', () => {
  // 2×2 分段（3×3 控制点），快变方向 = 列
  const pts: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) pts.push(c * 100, r * 100);
  for (const [u, v, ex, ey] of [
    [0, 0, 0, 0],
    [1, 0, 200, 0],
    [0, 1, 0, 200],
    [1, 1, 200, 200],
  ] as const) {
    const p = boxGridPoint(pts, 2, 2, u, v);
    assert.ok(Math.abs(p.x - ex) < 1e-9 && Math.abs(p.y - ey) < 1e-9, `(u,v)=(${u},${v}) ⇒ (${ex},${ey})，实得 ${JSON.stringify(p)}`);
  }
  // 中心点（双三次双线性网格的中点仍是中点）
  const mid = boxGridPoint(pts, 2, 2, 0.5, 0.5);
  assert.ok(Math.abs(mid.x - 100) < 1e-9 && Math.abs(mid.y - 100) < 1e-9);
});

test('deform：pickPivot 的组合下标口径（params[0] 最快变化）', () => {
  const pm = {
    params: [
      { kind: 'paramPivots' as const, paramId: { kind: 'id' as const, idClass: 'param' as const, name: 'A' }, pivotCount: 3, pivotValues: [0, 5, 10] },
      { kind: 'paramPivots' as const, paramId: { kind: 'id' as const, idClass: 'param' as const, name: 'B' }, pivotCount: 2, pivotValues: [0, 1] },
    ],
  };
  const at = (a: number, b: number) => pickPivot(pm, (n) => (n === 'A' ? a : b));
  /** 只有一个角点（= 所有参数都落在关键帧上）时它的下标。 */
  const only = (a: number, b: number): number => {
    const p = at(a, b);
    assert.equal(p.corners.length, 1, `A=${a},B=${b} 应只有一个角点`);
    assert.equal(p.m, 0);
    return p.corners[0]!.index;
  };
  assert.equal(only(0, 0), 0, 'A=0,B=0 ⇒ 0');
  assert.equal(only(5, 0), 1, 'A 走一档 ⇒ +1（A 是最快变化位）');
  assert.equal(only(10, 0), 2);
  assert.equal(only(0, 1), 3, 'B 走一档 ⇒ +3（stride = A 的档数）');
  assert.equal(only(10, 1), 5);
  // 落在中间 ⇒ 插值到下一档（m = 1：两个角点、权重 (1-t, t)）
  const mid = at(2.5, 0);
  assert.equal(mid.m, 1);
  assert.deepEqual(mid.corners.map((c) => c.index), [0, 1]);
  assert.ok(Math.abs(mid.corners[1]!.weight - 0.5) < 1e-9);
  // 越界夹紧
  assert.equal(only(-100, 0), 0);
  assert.equal(only(1000, 0), 2);
});

test('★deform：多参数同时插值（m ≥ 2）按 2^m 角点做多线性混合', () => {
  // 为什么必须钉住：本作语料**常态**触发 m ≥ 2 —— 例 `B_MY_PARTS_ARM_LEFT.00` 有 3 个参数
  // （PARAM_KAO / PARAM_KAKUSYUKU / PARAM_ARM），而 PARAM_KAKUSYUKU 的 .MTN 曲线只有 1 个采样
  // （恒 −23，落在其区间 [−100,0] 内部 ⇒ frac 恒 0.77）⇒ 永远至少 2 维带权重。
  // 旧实现只为"第一个 frac>0 的维度"插值、其余取整档 ⇒ 结果在另一维的 frac 归零时**跳变**
  // ⇒ 用户实测"翅膀与背手整体同步卡顿、头眼流畅"（它们共享同一个父变形器）。
  const pm = {
    params: [
      { kind: 'paramPivots' as const, paramId: { kind: 'id' as const, idClass: 'param' as const, name: 'A' }, pivotCount: 2, pivotValues: [0, 10] },
      { kind: 'paramPivots' as const, paramId: { kind: 'id' as const, idClass: 'param' as const, name: 'B' }, pivotCount: 2, pivotValues: [0, 10] },
    ],
  };
  const pick = pickPivot(pm, (n) => (n === 'A' ? 2.5 : 7.5)); // frac = 0.25 / 0.75
  assert.equal(pick.m, 2, '两维都在区间内部 ⇒ m = 2');
  assert.equal(pick.corners.length, 4, '2^m = 4 个角点');
  const w = new Map(pick.corners.map((c) => [c.index, c.weight]));
  // 下标 = i_A·1 + i_B·2；权重 = ∏(bit ? frac : 1−frac)
  assert.ok(Math.abs(w.get(0)! - 0.75 * 0.25) < 1e-12, '(0,0) → 0.1875');
  assert.ok(Math.abs(w.get(1)! - 0.25 * 0.25) < 1e-12, '(1,0) → 0.0625');
  assert.ok(Math.abs(w.get(2)! - 0.75 * 0.75) < 1e-12, '(0,1) → 0.5625');
  assert.ok(Math.abs(w.get(3)! - 0.25 * 0.75) < 1e-12, '(1,1) → 0.1875');
  assert.ok(Math.abs([...w.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12, '权重和应为 1');

  // 端到端：一个只平移的变形器，originX = 0 / 100 / 200 / 300（按上面 4 个角点的顺序）
  const ent = (originX: number) => ({
    kind: 'affineEnt' as const,
    originX,
    originY: 0,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    reflectX: false,
    reflectY: false,
  });
  const model = {
    kind: 'model' as const,
    params: [],
    parts: [
      {
        kind: 'parts' as const,
        locked: false,
        visible: true,
        id: { kind: 'id' as const, idClass: 'parts' as const, name: 'P' },
        deformers: [
          {
            kind: 'bdAffine' as const,
            id: { kind: 'id' as const, idClass: 'base' as const, name: 'B' },
            targetId: null,
            pivotManager: pm,
            pivotOpacities: [1, 1, 1, 1],
            affines: [ent(0), ent(100), ent(200), ent(300)],
          },
        ],
        drawables: [
          {
            kind: 'drawData' as const,
            id: { kind: 'id' as const, idClass: 'draw' as const, name: 'D' },
            targetId: { kind: 'id' as const, idClass: 'base' as const, name: 'B' },
            pivotManager: null,
            averageDrawOrder: 0,
            pivotDrawOrders: [],
            pivotOpacities: [],
            clipId: null,
            textureNo: 0,
            pointCount: 3,
            polygonCount: 1,
            indexArray: [0, 1, 2],
            pivotPoints: [[0, 0, 1, 0, 0, 1]],
            uvs: [0, 0, 1, 0, 0, 1],
            optionFlag: 0,
            colorGroupNo: null,
            colorCompositionType: 0,
            culling: true,
          },
        ],
      },
    ],
    canvasWidth: 100,
    canvasHeight: 100,
    stats: { version: 10, objects: 0, byTag: {}, bytesRead: 0, bytesTotal: 0, eofMarker: true },
  } as unknown as MocModel;

  const st = newParamState(model);
  st.set('A', 2.5);
  st.set('B', 7.5);
  const frame = evaluateModel(model, st);
  const x = frame.parts[0]!.drawables[0]!.points[0]!;
  // 精确多线性：0·0.1875 + 100·0.0625 + 200·0.5625 + 300·0.1875 = 175
  assert.ok(Math.abs(x - 175) < 1e-9, `顶点 x 应为 175（多线性混合），实际 ${x}`);
  // ★旧实现（只插第一维、第二维取整档）会得到 25 —— 差 150 px，正是"跳变"的量级
  assert.ok(Math.abs(x - 25) > 1, '不得退回"只插一个维度"的旧口径');
});

test('deform：真实模型求值（BM021A）—— 顶点数/有限性/参数驱动形变', () => {
  const f = findMoc('$1$BM021A.MOC');
  if (!f) {
    console.warn('[skip] 找不到 $1$BM021A.MOC 语料 —— 跳过');
    return;
  }
  const model: MocModel = parseMoc(new Uint8Array(fs.readFileSync(f)));
  const state = newParamState(model);
  const frame = evaluateModel(model, state);

  const flat = flattenDrawOrder(frame);
  assert.ok(flat.length > 0, '应有可绘制网格');
  for (const { dd } of flat) {
    assert.equal(dd.points.length, dd.uvs.length, `${dd.id} 顶点数应与 UV 数一致`);
    assert.equal(dd.indices.length % 3, 0, `${dd.id} 索引数应是 3 的倍数`);
    for (const v of dd.points) assert.ok(Number.isFinite(v), `${dd.id} 顶点应有限`);
    assert.ok(dd.opacity >= 0 && dd.opacity <= 1.001, `${dd.id} 不透明度应在 [0,1]`);
  }

  // ★参数驱动：改 HEAR（0..10）⇒ 带 HEAR pivots 的网格必须动，不带的必须不动
  const before = new Map(flat.map(({ dd }) => [dd.id, dd.points.slice()]));
  state.set('HEAR', 10);
  const after = evaluateModel(model, state);
  const moved: string[] = [];
  const still: string[] = [];
  for (const { dd } of flattenDrawOrder(after)) {
    const b = before.get(dd.id);
    if (!b) continue;
    const same = b.length === dd.points.length && b.every((v, i) => Math.abs(v - dd.points[i]!) < 1e-6);
    (same ? still : moved).push(dd.id);
  }
  assert.ok(moved.includes('D_FACE.01'), `D_FACE.01（HEAR pivots）应随 HEAR 变化；moved=${moved.join(',')}`);
  assert.ok(still.includes('D_WING.00'), `D_WING.00（TUBASA pivots）不该随 HEAR 变化；still=${still.join(',')}`);

  // 形变后的包围盒应落在画布的有界范围内（防"矩阵叠乘错到天上"）
  for (const { dd } of flattenDrawOrder(after)) {
    const b = bbox(dd.points);
    assert.ok(Math.abs(b.x0) < 1e5 && Math.abs(b.x1) < 1e5, `${dd.id} x 越界`);
    assert.ok(Math.abs(b.y0) < 1e5 && Math.abs(b.y1) < 1e5, `${dd.id} y 越界`);
  }
});

test('deform：全部真实模型都能求值（不抛、不 NaN、组合数 = ∏pivots）', () => {
  const dir = path.join(REPO_ROOT, 'raw-parts');
  if (!fs.existsSync(dir)) {
    console.warn('[skip] 找不到 raw-parts/ —— 跳过');
    return;
  }
  const files: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.moc$/i.test(e.name)) files.push(p);
    }
  }
  assert.ok(files.length > 100, `语料应有大量 .MOC（实得 ${files.length}）`);

  let models = 0;
  let drawables = 0;
  for (const f of files.sort()) {
    let model: MocModel;
    try {
      model = parseMoc(new Uint8Array(fs.readFileSync(f)));
    } catch (e) {
      assert.fail(`${path.relative(REPO_ROOT, f)} 解析失败：${(e as Error).message}`);
    }
    const state = newParamState(model);
    // 两个端点各求值一次（覆盖"关键帧数组两端"）
    for (const end of [0, 1]) {
      for (const p of model.params) {
        if (!p.id) continue;
        state.set(p.id.name, end === 0 ? p.min : p.max);
      }
      const frame = evaluateModel(model, state);
      for (const { dd } of flattenDrawOrder(frame)) {
        drawables += 1;
        assert.ok(dd.points.every(Number.isFinite), `${path.basename(f)} ${dd.id} 端点求值出现 NaN/Inf`);
      }
    }
    // 组合数口径
    for (const part of model.parts) {
      for (const d of part.deformers) {
        if (pivotCombos(d.pivotManager) > 1) {
          assert.ok(d.kind === 'bdBoxGrid' || d.affines.length > 0, '多组合变形器应有内容');
        }
      }
    }
    models += 1;
  }
  console.log(`[live2d/deform] ${models} 个模型、${drawables} 次网格端点求值全部有限`);
});
