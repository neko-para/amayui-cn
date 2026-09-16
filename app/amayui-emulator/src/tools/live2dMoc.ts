/**
 * `.moc` 解析自检工具（实证优先：拿全部真实模型逼不变量）。
 *
 * 用法：
 *   npx tsx src/tools/live2dMoc.ts [目录]        # 默认 <仓库根>/raw-parts（含 .MOC 的目录）
 *   npx tsx src/tools/live2dMoc.ts --sample 5     # 只打印前 5 个的详情
 *
 * 判据（= test/live2d-moc.test.ts 的同一套口径）：每个文件都必须
 * ① 头部 magic/version 合法；② 根对象是 ModelImpl；③ 字节流恰好走到 `88 88 88 88` 结束标识；
 * ④ 画布尺寸为正、参数/部件数量自洽；⑤ 索引数组非负。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoc, type MocModel, type MocDeformer, type MocDrawData } from '../live2d/moc.js';

/** 经验不变量统计（--invariants）：把"以为成立"的规则先量出来，再写进测试。 */
class Stats {
  readonly viol = new Map<string, { n: number; ex: string[] }>();
  readonly hist = new Map<string, Map<number, number>>();
  hit(rule: string, ok: boolean, ex: string): void {
    if (ok) return;
    const v = this.viol.get(rule) ?? { n: 0, ex: [] };
    v.n += 1;
    if (v.ex.length < 3) v.ex.push(ex);
    this.viol.set(rule, v);
  }
  dist(rule: string, key: number): void {
    const m = this.hist.get(rule) ?? new Map<number, number>();
    m.set(key, (m.get(key) ?? 0) + 1);
    this.hist.set(rule, m);
  }
  report(): void {
    for (const [r, m] of this.hist) {
      const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      console.log(`  分布 ${r}: ${top.map(([k, n]) => `${k}×${n}`).join('  ')}`);
    }
    for (const [r, v] of [...this.viol.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ✗ ${r}: ${v.n} 例，例如 ${v.ex.join(' | ')}`);
    }
    if (this.viol.size === 0) console.log('  （无不变量违例）');
  }
}
const combos = (d: { pivotManager: { params: { pivotCount: number }[] } | null }): number =>
  (d.pivotManager?.params ?? []).reduce((a, p) => a * p.pivotCount, 1) || 1;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.moc$/i.test(e.name)) out.push(p);
  }
  return out;
}

interface Ok {
  file: string;
  model: MocModel;
}
interface Bad {
  file: string;
  msg: string;
  trace: string;
}

function main(): void {
  const argv = process.argv.slice(2);
  const sampleIdx = argv.indexOf('--sample');
  const sample = sampleIdx >= 0 ? Number(argv[sampleIdx + 1] ?? 3) : 0;
  const dirArg = argv.find((a, i) => !a.startsWith('--') && i !== sampleIdx + 1);
  const dir = dirArg ?? path.join(REPO_ROOT, 'raw-parts');

  if (!fs.existsSync(dir)) {
    console.error(`目录不存在：${dir}`);
    process.exit(2);
  }
  const files = walk(dir).sort();
  const stats = new Stats();
  const oks: Ok[] = [];
  const bads: Bad[] = [];
  const versions = new Map<number, number>();
  const tags = new Map<string, number>();
  let totalParams = 0;
  let totalObjects = 0;

  for (const f of files) {
    try {
      const model = parseMoc(new Uint8Array(fs.readFileSync(f)));
      oks.push({ file: f, model });
      versions.set(model.stats.version, (versions.get(model.stats.version) ?? 0) + 1);
      totalParams += model.params.length;
      totalObjects += model.stats.objects;
      for (const [k, v] of Object.entries(model.stats.byTag)) tags.set(k, (tags.get(k) ?? 0) + v);
      const rel = path.relative(REPO_ROOT, f);
      for (const part of model.parts) {
        for (const d of part.deformers as MocDeformer[]) {
          const n = combos(d);
          if (d.kind === 'bdAffine') {
            stats.dist('bdAffine:affines/pivots', n === 0 ? 0 : d.affines.length / n);
            stats.hit('bdAffine.affines.length ∉ {0, ∏pivots}', d.affines.length === 0 || d.affines.length === n, `${rel} ${d.affines.length} vs ${n}`);
            stats.hit('bdAffine.pivotOpacities.length ≠ ∏pivots', d.pivotOpacities.length === n, `${rel} ${d.pivotOpacities.length} vs ${n}`);
          } else {
            stats.hit('bdBoxGrid.pivotPoints.length ∉ {0, ∏pivots}', d.pivotPoints.length === 0 || d.pivotPoints.length === n, `${rel} ${d.pivotPoints.length} vs ${n}`);
            const per = (d.rowCount + 1) * (d.columnCount + 1) * 2;
            for (const g of d.pivotPoints) stats.hit('bdBoxGrid 网格长度 ≠ (row+1)*(col+1)*2', g.length === per, `${rel} ${g.length} vs ${per}`);
            stats.hit('bdBoxGrid 行列为 0', d.rowCount > 0 && d.columnCount > 0, `${rel} r=${d.rowCount} c=${d.columnCount}`);
          }
        }
        for (const dd of part.drawables as MocDrawData[]) {
          const n = combos(dd);
          stats.hit('indexArray ≠ polygonCount*3', dd.indexArray.length === dd.polygonCount * 3, `${rel} ${dd.indexArray.length} vs ${dd.polygonCount * 3}`);
          stats.hit('uvs ≠ pointCount*2', dd.uvs.length === dd.pointCount * 2, `${rel} ${dd.uvs.length} vs ${dd.pointCount * 2}`);
          stats.hit('pivotPoints.length ∉ {0, ∏pivots}', dd.pivotPoints.length === 0 || dd.pivotPoints.length === n, `${rel} ${dd.pivotPoints.length} vs ${n}`);
          for (const g of dd.pivotPoints) stats.hit('顶点组长度 ≠ pointCount*2', g.length === dd.pointCount * 2, `${rel} ${g.length} vs ${dd.pointCount * 2}`);
          stats.hit('pivotDrawOrders.length ∉ {0, ∏pivots}', dd.pivotDrawOrders.length === 0 || dd.pivotDrawOrders.length === n, `${rel} ${dd.pivotDrawOrders.length} vs ${n}`);
          stats.hit('pivotOpacities.length ∉ {0, ∏pivots}', dd.pivotOpacities.length === 0 || dd.pivotOpacities.length === n, `${rel} ${dd.pivotOpacities.length} vs ${n}`);
          stats.hit('textureNo ∉ [-1,15]', dd.textureNo >= -1 && dd.textureNo <= 15, `${rel} tex=${dd.textureNo}`);
          stats.hit('索引越界', dd.indexArray.every((i) => i >= 0 && i < dd.pointCount), `${rel}`);
          stats.hit('UV ∉ [-0.01,1.01]', dd.uvs.every((u) => u >= -0.01 && u <= 1.01), `${rel}`);
          stats.dist('drawData:textureNo', dd.textureNo);
          stats.dist('drawData:顶点组/∏pivots', dd.pivotPoints.length === 0 ? 0 : dd.pivotPoints.length / n);
        }
      }
    } catch (e) {
      const err = e as Error & { trace?: number[] };
      const trace = (err as unknown as { message: string }).message;
      bads.push({
        file: path.relative(REPO_ROOT, f),
        msg: err.message,
        trace: trace,
      });
    }
  }

  console.log(`目录：${path.relative(REPO_ROOT, dir)}`);
  console.log(`文件：${files.length}  解析成功：${oks.length}  失败：${bads.length}`);
  console.log(`version 分布：${[...versions.entries()].map(([v, n]) => `v${v}×${n}`).join(' ')}`);
  console.log(`根对象统计：参数总计 ${totalParams}（均值 ${(totalParams / Math.max(1, oks.length)).toFixed(1)}/模型），对象总计 ${totalObjects}`);
  console.log(
    `标签直方图：${[...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}:${n}`)
      .join('  ')}`,
  );

  console.log('\n不变量体检（全部模型）：');
  stats.report();

  if (sample > 0) {
    for (const { file, model } of oks.slice(0, sample)) {
      console.log(
        `\n[样例] ${path.relative(REPO_ROOT, file)}  v${model.stats.version}  canvas=${model.canvasWidth}×${model.canvasHeight}  params=${model.params.length}` +
          `  objects=${model.stats.objects}  eof=${model.stats.eofMarker}  bytes=${model.stats.bytesRead}`,
      );
      for (const p of model.params.slice(0, 8)) console.log(`   - ${p.id?.name ?? '?'} ∈ [${p.min}, ${p.max}] default=${p.defaultValue}`);
    }
  }

  if (bads.length > 0) {
    console.log(`\n失败明细（前 20）：`);
    for (const b of bads.slice(0, 20)) console.log(`  ✗ ${b.file}\n      ${b.msg}`);
    process.exitCode = 1;
  }
}

main();
