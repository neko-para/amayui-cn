/**
 * **`test/` 类型检查的基线棘轮（闸门 D）** —— 让"测试代码不受类型检查"这件债**可见、可收敛、不可增长**。
 *
 * ## 为什么需要（`tickets/T-0124` 缺陷 D1）
 *
 * `tsconfig.json` 的 `exclude` 含 `test`，另两份 tsconfig 只 include `src`/`control`/`electron`
 * ⇒ `npm run typecheck` **从不检查测试代码**。后果已经发生过一次：`gallery-bgm-list.test.ts` 里
 * `instr` 既 import 又重声明 —— 在 Node 原生 ESM 语义下是**加载期 SyntaxError**
 * （整个文件的用例会静默消失），只因运行器用 esbuild 消除了未用导入才侥幸没炸。
 *
 * 2026-09-23 把 `tsconfig.test.json` 挂上后，实测暴露出 **131 个类型错误 / 60 个文件**
 * —— 远不止"17 个守卫文件"。一次清完不现实，直接挂进 `verify` 又会把闸门弄红。
 *
 * ## 做法：与闸门 C（死写）同款 —— **基线 + 棘轮**
 *
 *  - 现值存 `test-typecheck.baseline.json`：**基线内**的错误不算失败（它们已被登记为债）；
 *  - **新增**错误 ⇒ 失败（逼你当场修，或写清为什么登记进基线）；
 *  - 基线里**已经消失**的错误 ⇒ 也提示你去缩小基线（棘轮只许收紧）。
 *
 * ⇒ 效果：`verify` 保持绿，而"测试代码的类型正确性"**从今天起不再变坏**；
 *   剩下的 131 条变成一张**只会变短**的清单。
 *
 * ★与闸门 C 的分工：C 管"写了没人读的字段"（引擎语义），D 管"测试代码的类型债"（工程卫生）。
 *
 * 用法：
 * ```
 * npm run check:typecheck-test            # 校验（新增即红）
 * npm run check:typecheck-test -- --recount   # 用当前结果重写基线（收敛后收缩用）
 * ```
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '../..');
export const BASELINE_PATH = path.join(APP_ROOT, 'test-typecheck.baseline.json');

export interface TypecheckError {
  /** 相对工程根的稳定标识：`文件|TS码|规范化消息`（**不含行号** —— 行号会随编辑漂移）。 */
  id: string;
  file: string;
  code: string;
  message: string;
}

export interface Baseline {
  _comment: string;
  /** 基线快照时的错误总数（仅作可读性；判据是 `counts`）。 */
  count: number;
  /**
   * `id → 出现次数`。★用**次数**而不是集合：同一形状的错误在同一个文件里多出一条也要能红，
   * 而只用集合会把它吃掉（`id` 里不含行号，是为了让"在错误上方编辑"不引起无谓漂移）。
   */
  counts: Record<string, number>;
}

/** 跑 `tsc -p tsconfig.test.json --noEmit`，把 `error TS` 行解析成稳定 id。 */
export function collectErrors(): TypecheckError[] {
  const r = spawnSync(
    process.execPath,
    [path.join(APP_ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.test.json', '--noEmit'],
    { cwd: APP_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const out: TypecheckError[] = [];
  for (const line of text.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim());
    if (!m) continue;
    const file = path.relative(APP_ROOT, path.resolve(APP_ROOT, m[1]!)).split(path.sep).join('/');
    const code = m[4]!;
    // ★消息里可能含具体标识符（如 `'antiAlias'`）—— 保留，但把数字/引号里的路径归一化，降低无谓漂移
    const message = m[5]!.replace(/\d+/g, 'N').slice(0, 160);
    out.push({ id: `${file}|${code}|${message}`, file, code, message: m[5]! });
  }
  return out;
}

export function loadBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

export interface RatchetResult {
  /** 新增的条目（含"同 id 但次数变多"）⇒ 失败。 */
  added: { id: string; delta: number; sample: TypecheckError }[];
  /** 已减少/消失的条目 ⇒ 提示收缩基线。 */
  removed: { id: string; delta: number }[];
}

function tally(errors: TypecheckError[]): Map<string, TypecheckError[]> {
  const m = new Map<string, TypecheckError[]>();
  for (const e of errors) (m.get(e.id) ?? m.set(e.id, []).get(e.id)!).push(e);
  return m;
}

export function ratchet(errors: TypecheckError[], baseline: Baseline): RatchetResult {
  const now = tally(errors);
  const added: RatchetResult['added'] = [];
  const removed: RatchetResult['removed'] = [];
  for (const [id, list] of now) {
    const base = baseline.counts[id] ?? 0;
    if (list.length > base) added.push({ id, delta: list.length - base, sample: list[base]! });
  }
  for (const [id, base] of Object.entries(baseline.counts)) {
    const cur = now.get(id)?.length ?? 0;
    if (cur < base) removed.push({ id, delta: base - cur });
  }
  added.sort((a, b) => b.delta - a.delta);
  return { added, removed };
}

export function run(argv: string[]): number {
  const errors = collectErrors();
  if (argv.includes('--recount')) {
    const counts: Record<string, number> = {};
    for (const e of errors) counts[e.id] = (counts[e.id] ?? 0) + 1;
    const next: Baseline = { _comment: loadBaseline()._comment, count: errors.length, counts };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 1) + '\n');
    console.log(`[typecheck-test] 基线已重写：${errors.length} 条`);
    return 0;
  }
  const base = loadBaseline();
  const r = ratchet(errors, base);
  const addedN = r.added.reduce((a, b) => a + b.delta, 0);
  const removedN = r.removed.reduce((a, b) => a + b.delta, 0);
  console.log(`[typecheck-test] 当前 ${errors.length} 条；基线 ${base.count} 条；新增 ${addedN}；已减少 ${removedN}`);
  if (r.removed.length) {
    console.log('↓ 这些债已经还掉了，请跑 `npm run check:typecheck-test -- --recount` 收缩基线（棘轮只许收紧）：');
    for (const x of r.removed) console.log(`   -${x.delta}  ${x.id}`);
  }
  if (r.added.length) {
    console.error(`✗ 新增 ${addedN} 条测试代码类型错误（闸门 D：只许收敛，不许增长）：`);
    for (const x of r.added.slice(0, 40)) {
      console.error(`   +${x.delta}  ${x.sample.file} ${x.sample.code}: ${x.sample.message}`);
    }
    if (r.added.length > 40) console.error(`   …（共 ${r.added.length} 类）`);
    return 1;
  }
  console.log('✅ 无新增类型错误（基线棘轮通过）');
  return 0;
}

// tsx 直接执行时跑 CLI（被 import 时不跑）
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(run(process.argv.slice(2)));
}
