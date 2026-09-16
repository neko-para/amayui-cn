/**
 * **单模型结构 dump**（`tickets/T-0054` 的调试工具）。
 *
 * 用法：
 *   npx tsx src/tools/live2dStruct.ts            # 语料里的第一个模型
 *   npx tsx src/tools/live2dStruct.ts TITLE.MOC  # 文件名含该子串的模型
 *
 * 打印：参数表 + 每个部件下的变形器（BDAffine 的 `affines` 数 / BDBoxGrid 的行列与控制点数）
 * 与每个网格的 `pivotPoints` 组数 / `pivotDrawOrders` / `pivotOpacities` / pivots 档位。
 * ★用途：肉眼核对"组合数 = ∏pivotCount"这条不变量在具体模型上长什么样
 * （抽象断言见 `test/live2d-moc.test.ts`）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoc, type MocModel } from '../live2d/moc.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.moc$/i.test(e.name)) out.push(p);
  }
  return out;
}
const want = process.argv[2];
const files = walk(path.join(REPO_ROOT, 'raw-parts')).sort();
const target = want ? files.find((f) => f.includes(want))! : files[0]!;
const m: MocModel = parseMoc(new Uint8Array(fs.readFileSync(target)));
console.log(`${path.relative(REPO_ROOT, target)} parts=${m.parts.length} params=[${m.params.map((p) => p.id?.name).join(',')}]`);
for (const p of m.parts) {
  for (const d of p.deformers) {
    const counts = (d.pivotManager?.params ?? []).map((x) => `${x.paramId?.name}:${x.pivotCount}[${x.pivotValues.join(',')}]`);
    if (d.kind === 'bdAffine') console.log(`  D ${p.id?.name} ${d.id?.name} pivots=[${counts.join(' ')}] affines=${d.affines.length} opac=${d.pivotOpacities.length}`);
    else console.log(`  D ${p.id?.name} ${d.id?.name} boxgrid col=${d.columnCount} row=${d.rowCount} grids=${d.pivotPoints.length} pivots=[${counts.join(' ')}]`);
  }
  for (const d of p.drawables) {
    const counts = (d.pivotManager?.params ?? []).map((x) => `${x.paramId?.name}:${x.pivotCount}[${x.pivotValues.join(',')}]`);
    console.log(`  G ${p.id?.name} ${d.id?.name} groups=${d.pivotPoints.length} pdo=[${d.pivotDrawOrders.join(',')}] po=[${d.pivotOpacities.map((v) => v.toFixed(2)).join(',')}] pivots=[${counts.join(' ')}]`);
  }
}
