/**
 * `.moc` 解析守卫（实证口径：拿**全部真实模型**逼不变量，见 tickets/T-0054 acceptance #2）。
 *
 * 依据：`app/amayui-emulator/src/live2d/moc.ts`（来源与行号见该文件头）。
 * 资源：优先 `<仓库根>/raw-parts`，其次 `raw/`（两者都是 gitignore 的本地抽取目录）。
 * 都缺 ⇒ `skip` 并给出诊断（与 config1-chain.test.ts 的"环境缺产物"口径一致，不假装通过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoc, type MocModel } from '../src/live2d/moc.js';

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

/** ∏ pivotCount（没有 pivotManager ⇒ 1）。 */
function pivotCombos(model: MocModel): (pivotCounts: number[]) => number {
  return (counts) => counts.reduce((a, b) => a * b, 1);
}

test('live2d/moc：全部真实 .moc 逐字节解析（magic/version/EOF/无尾随字节）', () => {
  const dir = findMocDir();
  if (!dir) {
    console.warn('[skip] 找不到 .MOC 语料目录（raw-parts/ 或 raw/）—— 本机未抽取资源，跳过');
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
  const combos = pivotCombos({} as MocModel);

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

    // 容器级不变量
    assert.equal(model.stats.eofMarker, true, `${f} 应有 EOF 标识`);
    assert.equal(model.stats.bytesRead, model.stats.bytesTotal, `${f} 应恰好读完`);
    assert.ok(model.canvasWidth > 0 && model.canvasHeight > 0, `${f} 画布尺寸应为正`);
    assert.ok(model.canvasWidth <= 8192 && model.canvasHeight <= 8192, `${f} 画布尺寸应有界`);
    assert.ok(model.params.length > 0, `${f} 应至少有一个参数定义`);
    assert.ok(model.parts.length > 0, `${f} 应至少有一个部件`);

    for (const p of model.params) {
      assert.ok(p.min <= p.max, `${f} 参数区间应有序`);
      assert.ok(p.id && p.id.name.length > 0, `${f} 参数应有非空名字`);
    }

    parts += model.parts.length;
    for (const part of model.parts) {
      // 变形器：组合数 = ∏pivots
      for (const d of part.deformers) {
        deformers += 1;
        const n = combos(d.pivotManager?.params.map((x) => x.pivotCount) ?? []);
        assert.ok(n >= 1, `${f} 变形器组合数应 ≥1`);
        if (d.kind === 'bdAffine') {
          assert.equal(d.affines.length, n, `${f} BDAffine 关键帧数应 = ∏pivots`);
        } else {
          assert.equal(d.pivotPoints.length, n, `${f} BDBoxGrid 网格数应 = ∏pivots`);
          const per = (d.rowCount + 1) * (d.columnCount + 1) * 2;
          for (const g of d.pivotPoints) {
            assert.equal(g.length, per, `${f} BDBoxGrid 每组网格长度应为 (row+1)*(col+1)*2`);
          }
        }
        assert.equal(d.pivotOpacities.length, n, `${f} 变形器不透明度数组长度应 = ∏pivots`);
      }

      for (const dd of part.drawables) {
        drawables += 1;
        const n = combos(dd.pivotManager?.params.map((x) => x.pivotCount) ?? []);
        assert.equal(dd.indexArray.length, dd.polygonCount * 3, `${f} 索引数应 = polygonCount*3`);
        assert.equal(dd.uvs.length, dd.pointCount * 2, `${f} UV 数应 = pointCount*2`);
        assert.equal(dd.pivotPoints.length, n, `${f} 顶点组数应 = ∏pivots`);
        for (const pts of dd.pivotPoints) {
          assert.equal(pts.length, dd.pointCount * 2, `${f} 每组顶点数应 = pointCount*2`);
        }
        assert.equal(dd.pivotDrawOrders.length, n, `${f} 绘制序数组长度应 = ∏pivots`);
        assert.equal(dd.pivotOpacities.length, n, `${f} 不透明度数组长度应 = ∏pivots`);
        assert.ok(dd.textureNo >= -1 && dd.textureNo <= 15, `${f} 纹理槽号应在 [-1,15]`);
        assert.ok(dd.pointCount > 0 && dd.polygonCount > 0, `${f} 网格应非空`);
        for (const idx of dd.indexArray) {
          assert.ok(idx >= 0 && idx < dd.pointCount, `${f} 顶点索引应落在 [0, pointCount)`);
        }
        for (const uv of dd.uvs) {
          assert.ok(uv >= -0.01 && uv <= 1.01, `${f} UV 应落在 [0,1]（实测含轻微越界余量）`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], `全部 .MOC 都应解析成功；失败 ${failures.length} 个`);
  console.log(
    `[live2d/moc] ${models} 个模型：部件 ${parts}，变形器 ${deformers}，网格 ${drawables}，参数 ${params}`,
  );
});
