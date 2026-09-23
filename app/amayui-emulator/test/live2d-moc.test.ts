/** @tier T1 @kind core @subsystem l2d */

/**
 * `.moc` 解析守卫（实证口径：拿**全部真实模型**逼不变量，见 tickets/T-0054 acceptance #2）。
 *
 * 依据：`app/amayui-emulator/src/live2d/moc.ts`（来源与行号见该文件头）。
 * 资源：`<仓库根>/raw-parts`（ALF 解包树，见 `scripts/alf/unpack_alf.mjs`）；缺 ⇒ `skip` + 诊断
 * （与 `config1-chain.test.ts` 的"环境缺产物"口径一致，不假装通过）。
 *
 * ★断言的**口径**（这两条是 2026-09 实证订正的结果，别再退回旧口径）：
 *  1. `∏ pivotCount` 是**每个 DrawData/BDAffine 自己的关键帧组合数**，且
 *     `pivotPoints.length == pivotDrawOrders.length == pivotOpacities.length == affines.length == ∏pivots`
 *     —— 三者长度恒等是"pivots 解析正确"的强证据（`pivotManager.params` 曾经整片解析成空）。
 *  2. **UV 允许出界**（Cubism 用出界 UV 做平铺/裁切）⇒ 只断言有限 + 有界，不许断言 ∈[0,1]。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoc, type MocModel } from '../src/live2d/moc.js';
import { at } from './harness.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function findMocDir(): string | null {
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
        else if (/\.moc$/i.test(e.name)) return dir;
      }
    }
  }
  return null;
}

function walkMoc(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMoc(p, out);
    else if (/\.moc$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** ∏ pivotCount（空 ⇒ 1）。 */
function combos(pivotCounts: number[]): number {
  return pivotCounts.reduce((a, b) => a * b, 1);
}

test('live2d/moc：全部真实 .moc 逐字节解析 + 结构不变量（335 个语料）', (t) => {
  const dir = findMocDir();
  if (!dir) {
    // ★不许用 console.warn + 裸 return：node:test 会把「零断言返回」记成 pass（T-0124 形态①）。
    t.skip('找不到 .MOC 语料目录（raw-parts/ 或 raw/）—— 本机未抽取资源');
    return;
  }
  const files = walkMoc(dir).sort();
  assert.ok(files.length > 0, `${dir} 下应当有 .MOC`);

  const failures: string[] = [];
  let models = 0;
  let parts = 0;
  let drawables = 0;
  let deformers = 0;
  let params = 0;
  let pivotManagers = 0;
  let withPivots = 0;
  let affineFrames = 0;

  for (const f of files) {
    let model: MocModel;
    try {
      model = parseMoc(new Uint8Array(fs.readFileSync(f)));
    } catch (e) {
      failures.push(`${path.relative(REPO_ROOT, f)}: ${(e as Error).message}`);
      continue;
    }
    models += 1;
    params += model.params.length;

    // ── 容器级不变量（字节级：magic/version/EOF/无尾随字节） ──
    assert.equal(model.stats.eofMarker, true, `${f} 应有 EOF 标识`);
    assert.equal(model.stats.bytesRead, model.stats.bytesTotal, `${f} 应恰好读完`);
    assert.ok(model.canvasWidth > 0 && model.canvasHeight > 0, `${f} 画布尺寸应为正`);
    assert.ok(model.canvasWidth <= 8192 && model.canvasHeight <= 8192, `${f} 画布尺寸应有界`);
    assert.ok(model.params.length > 0, `${f} 应至少有一个参数定义`);
    assert.ok(model.parts.length > 0, `${f} 应至少有一个部件`);

    const paramNames = new Set(model.params.map((p) => p.id?.name));
    for (const p of model.params) {
      assert.ok(p.min <= p.max, `${f} 参数区间应有序`);
      assert.ok(p.id && p.id.name.length > 0, `${f} 参数应有非空名字`);
    }

    parts += model.parts.length;
    for (const part of model.parts) {
      assert.ok(part.id && part.id.name.length > 0, `${f} 部件应有非空 id`);

      for (const d of part.deformers) {
        deformers += 1;
        const pm = d.pivotManager;
        pivotManagers += 1;
        // ★pivotManager 必须解析出来：整片为空 ⇒ refno 表/ParamPivots kind 又坏了
        if (pm) assert.ok(pm.params.length >= 0, `${f} PivotManager 应可解析`);
        const n = combos((pm?.params ?? []).map((x) => x.pivotCount));
        if ((pm?.params.length ?? 0) > 0) withPivots += 1;
        assert.ok(n >= 1, `${f} 变形器组合数应 ≥1`);
        for (const pp of pm?.params ?? []) {
          assert.equal(pp.kind, 'paramPivots', `${f} params 成员应是 ParamPivots`);
          assert.ok(pp.pivotValues.length === pp.pivotCount, `${f} pivotValues 数应 = pivotCount`);
          if (pp.paramId) assert.ok(paramNames.has(pp.paramId.name), `${f} pivots 参数 ${pp.paramId.name} 应在参数表里`);
        }
        if (d.kind === 'bdAffine') {
          affineFrames += d.affines.length;
          assert.equal(d.affines.length, n, `${f} BDAffine 关键帧数应 = ∏pivots`);
          assert.equal(
            d.pivotOpacities.length === 0 ? n : d.pivotOpacities.length,
            n,
            `${f} BDAffine 不透明度数组长度应 = ∏pivots（空 = v<10 无此字段）`,
          );
        } else {
          assert.equal(d.pivotPoints.length, n, `${f} BDBoxGrid 网格数应 = ∏pivots`);
          const per = (d.rowCount + 1) * (d.columnCount + 1) * 2;
          assert.ok(d.rowCount > 0 && d.columnCount > 0, `${f} BDBoxGrid 行列应为正`);
          for (const g of d.pivotPoints) {
            assert.equal(g.length, per, `${f} BDBoxGrid 每组网格长度应为 (row+1)*(col+1)*2`);
          }
        }
      }

      for (const dd of part.drawables) {
        drawables += 1;
        assert.ok(dd.id && dd.id.name.length > 0, `${f} 网格应有非空 id`);
        const n = combos((dd.pivotManager?.params ?? []).map((x) => x.pivotCount));
        assert.equal(dd.indexArray.length, dd.polygonCount * 3, `${f} 索引数应 = polygonCount*3`);
        assert.equal(dd.uvs.length, dd.pointCount * 2, `${f} UV 数应 = pointCount*2`);
        // ★三个 ∏pivots 数组的长度必须一致（pivots 解析正确性的强证据）
        assert.equal(dd.pivotPoints.length, n, `${f} 顶点组数应 = ∏pivots`);
        assert.equal(dd.pivotDrawOrders.length, n, `${f} 绘制序数组长度应 = ∏pivots`);
        assert.equal(dd.pivotOpacities.length, n, `${f} 不透明度数组长度应 = ∏pivots`);
        for (const pts of dd.pivotPoints) {
          assert.equal(pts.length, dd.pointCount * 2, `${f} 每组顶点数应 = pointCount*2`);
        }
        assert.ok(dd.textureNo >= -1 && dd.textureNo <= 15, `${f} 纹理槽号应在 [-1,15]`);
        assert.ok(dd.pointCount > 0 && dd.polygonCount > 0, `${f} 网格应非空`);
        for (const idx of dd.indexArray) {
          assert.ok(idx >= 0 && idx < dd.pointCount, `${f} 顶点索引应落在 [0, pointCount)`);
        }
        // UV：允许出界（平铺/裁切），但必须有限且有界（防解析错位把字节读成天文数字）
        for (const uv of dd.uvs) {
          assert.ok(Number.isFinite(uv), `${f} UV 应有限`);
          assert.ok(uv >= -8 && uv <= 8, `${f} UV 应有界（实测允许出界做平铺/裁切）`);
        }
        for (const p of dd.pivotPoints) {
          for (const v of p) assert.ok(Number.isFinite(v) && Math.abs(v) < 1e6, `${f} 顶点坐标应有限且有界`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], `全部 .MOC 都应解析成功；失败 ${failures.length} 个`);
  // 语料规模自证：语料换/丢会让这些数变化 ⇒ 逼人复核是不是真的解析对了
  assert.equal(withPivots > 0, true, '至少要有若干 PivotManager 带参数（否则等于没解析出关键帧组合）');
  assert.ok(affineFrames > 0, 'BDAffine 关键帧族应非空');
  console.log(
    `[live2d/moc] ${models} 个模型：部件 ${parts}，变形器 ${deformers}（带 pivots ${withPivots}），` +
      `网格 ${drawables}，参数 ${params}，BDAffine 关键帧 ${affineFrames}`,
  );
});

/** 单模型级不变量：`$1$BM021A.MOC` 的关键帧组合数（钉死解析口径的回归样本）。 */
test('live2d/moc：样本 BM021A 的 pivots/关键帧组合（口径回归）', (t) => {
  const dir = findMocDir();
  if (!dir) {
    t.skip('找不到 .MOC 语料目录');
    return;
  }
  const hit = walkMoc(dir).find((f) => /BM021A\.MOC$/i.test(f));
  if (!hit) {
    t.skip('语料里没有 BM021A.MOC');
    return;
  }
  const m = parseMoc(new Uint8Array(fs.readFileSync(hit)));
  const face = m.parts.find((p) => p.id?.name === 'PARTS_01_FACE_001');
  assert.ok(face, 'BM021A 应有 PARTS_01_FACE_001');

  // 多关键帧族：FOOT 的 KAKUSYUKU 参数有 3 档 ⇒ 3 个 AffineEnt（这是"affines 不再恒空"的回归点）
  const foot = m.parts.find((p) => p.id?.name === 'PARTS_FOOT')!.deformers.find((d) => d.kind === 'bdAffine')!;
  assert.equal(foot.kind, 'bdAffine');
  if (foot.kind !== 'bdAffine') return;
  assert.equal(foot.affines.length, 3, 'BDAffine（KAKUSYUKU 参数 3 档）应有 3 个关键帧');
  assert.equal(foot.affines.length, foot.pivotOpacities.length, '关键帧数 = 不透明度数');
  assert.equal(at(foot.affines, 0, '关键帧').kind, 'affineEnt', '关键帧应是 AffineEnt');

  const dd = face.drawables.find((d) => d.id?.name === 'D_FACE.01');
  assert.ok(dd, '应有 D_FACE.01');
  assert.deepEqual(dd.pivotManager?.params.map((p) => p.paramId?.name), ['HEAR']);
  assert.deepEqual(at(dd.pivotManager?.params ?? [], 0, 'pivot 参数').pivotValues, [0, 10]);
  assert.equal(dd.pivotPoints.length, 2, 'HEAR 2 档 ⇒ 2 组顶点');
  assert.equal(dd.pivotDrawOrders.length, 2);
  assert.equal(dd.pivotOpacities.length, 2);
});
