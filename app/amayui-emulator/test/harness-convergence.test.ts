/** @tier T0 @kind ratchet @subsystem ledger */
/**
 * **测试结构收敛的基线棘轮**（`tickets/T-0020`）—— 冻结"自造 `mk()`/`ctx` 变体"与"自造帧循环"的现状，
 * **新增即红、只许收敛**（与闸门 C/D 同一套基线棘轮的形）。
 *
 * ## 为什么是棘轮而不是一次性统一
 *
 * 本票原来写的是"17 处 `mk()` 变体统一到 harness"（现已涨到 **42** 个文件）。但 `test/harness.ts` 的文件头
 * 自己写着：**差异是真实需求**（save 族要 `fsLike`、adv 族要 msgwin 桩、render 族要容器……）
 * ⇒ 强行合并会把"差异"降级成隐藏参数，反而更难读。
 *
 * 真正缺的是**机械联系**：现在"测试通过"与"产品路径一致"之间没有任何守卫，多抄一份变体也没人知道。
 * 这个棘轮补的就是它 —— 谁再抄一份，必须显式登记进 `test/harness-convergence.baseline.json` 并写清
 * "为什么不能共用"，或者改用 `harness.ts`（推荐）。
 *
 * ★收缩：把某个文件迁到 harness / 共享驱动之后，跑 `npm run test:org -- --shrink-harness` 收缩基线
 *   （判据：迁移后 `npm test` 的**用例数不变**，见 T-0020 的 acceptance）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanHarness } from './harnessScan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'harness-convergence.baseline.json');

interface Baseline {
  _comment: string;
  mkVariants: string[];
  selfFrameLoops: string[];
}

// 扫描口径的唯一实现在 `test/harnessScan.ts`（守卫与 `run.ts --shrink-harness` 共用）。
const scan = (): { mkVariants: string[]; selfFrameLoops: string[] } => scanHarness(HERE);

test('★T-0020 棘轮：不得新增「自造 mk()/ctx 变体」（要么用 test/harness.ts，要么登记进基线并写理由）', () => {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;
  const now = scan();
  const added = now.mkVariants.filter((f) => !base.mkVariants.includes(f));
  assert.deepEqual(
    added, [],
    `这些文件新抄了一份 mk()/ctx 变体：${added.join(', ')}\n` +
      '处置：优先改用 `test/harness.ts`（`mkEngine`/`instr`/`im`/`loc`/`str`）；\n' +
      '确属"差异是真实需求"的，加进 `test/harness-convergence.baseline.json` 的 `mkVariants` 并在文件头写清为什么。',
  );
  // 反向：已迁走的要收缩（不强制，只提示）
  const gone = base.mkVariants.filter((f) => !now.mkVariants.includes(f));
  if (gone.length) console.log(`[T-0020] 这些已不再自造变体，可跑 --shrink-harness 收缩基线：${gone.join(', ')}`);
});

test('★T-0020 棘轮：不得新增「自造帧循环」（应走 `src/frame/loop.ts` 的共享驱动）', () => {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;
  const now = scan();
  const added = now.selfFrameLoops.filter((f) => !base.selfFrameLoops.includes(f));
  assert.deepEqual(
    added, [],
    `这些文件新写了自造帧循环：${added.join(', ')}\n` +
      '处置：改用 `runFrameLoop`（`src/frame/loop.ts`，产品路径同一份）；\n' +
      '若确实"只测单一服务、不需要完整帧驱动"，登记进基线并在文件头写明这一点。',
  );
  assert.ok(base.selfFrameLoops.length <= 13, `基线只许收缩（当前登记 ${base.selfFrameLoops.length}）`);
});

test('基线文件本身有效（两条清单都在、且与磁盘现状对得上）', () => {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;
  assert.ok(Array.isArray(base.mkVariants) && base.mkVariants.length > 0);
  assert.ok(Array.isArray(base.selfFrameLoops) && base.selfFrameLoops.length > 0);
  const now = scan();
  for (const f of [...base.mkVariants, ...base.selfFrameLoops]) {
    assert.ok(fs.existsSync(path.join(HERE, f)), `基线里登记的文件不存在了：${f}（请 --shrink-harness）`);
  }
  assert.ok(now.mkVariants.length <= base.mkVariants.length, '基线只许收缩');
});
