/**
 * **自造 fixture / 帧循环的扫描**（`tickets/T-0020`）—— 唯一实现，供守卫 `test/harness-convergence.test.ts`
 * 与收缩入口 `test/run.ts --shrink-harness` 共用（避免"扫描口径"两处各写一份）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 与基线同口径的判定：哪些文件自造了 `mk()`/`ctx` 变体、哪些自造了帧循环。 */
export function scanHarness(dir: string): { mkVariants: string[]; selfFrameLoops: string[] } {
  // ★排除守卫自己：它含扫描用的正则字面量，否则会把自己算成「新抄的变体」
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts') && f !== 'harness-convergence.test.ts').sort();
  const mkVariants: string[] = [];
  const selfFrameLoops: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/function mk\(|const mk = |function mkEngine\(|function makeCtx\(/.test(src)) mkVariants.push(f);
    if (/clock \+= (1000 \/ 60|FRAME|1000\/60)|for \(let f = 0; f < frames/.test(src)) selfFrameLoops.push(f);
  }
  return { mkVariants, selfFrameLoops };
}
