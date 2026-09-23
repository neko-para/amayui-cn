/**
 * **闸门 E：变异闸门（mutation gate）** —— 让"这个语义被改坏时有没有测试会红"变成一条可复跑的命令。
 *
 * ## 为什么需要（`tickets/T-0124` §0.2-C）
 *
 * "无意义断言"没有任何静态办法可靠识别：审计里 7 份静态报告都读不出"绘制项 z 序没人守"，
 * 是**变异实测**翻出来的（`evidence/mutation-campaign.md` §2 Z1）。反过来，静态结论也会被变异推翻
 * （`overlay.test.ts:121` 的"永不红"、`call-frame.test.ts:81` 的"同义反复"都被实测订正过）。
 * ⇒ 把变异做成常规档，是唯一能同时防"空洞"与"冤枉"的机械手段。
 *
 * ## 判据（与 `test/mutations.json` 的字段对应）
 *
 *  - `expectCatch` 非空 ⇒ 跑那几个测试文件，**至少 1 个必须红**；全绿 = 守卫丢了 ⇒ 闸门失败；
 *  - `knownGap` ⇒ 已登记的零覆盖：只打印（并在**它被覆盖之后**提醒你把它翻成 `expectCatch`）；
 *  - 每条都跑完**自动还原**并逐字节核对（还原失败立刻退出，绝不把破坏留在工作区）。
 *
 * ## 与全量实测的关系
 *
 * 这里跑的是**定向子集**（快，适合每次清理/重构后跑）；全量"发现零覆盖"的模式是
 * `npm run mutate -- --all`（每条跑全量 1085 例，约 1.5 min/条，见 `mutation-campaign.md` 的原始数字）。
 *
 * 用法：
 * ```
 * npm run mutate              # 定向子集（默认）
 * npm run mutate -- --all     # 每条跑全量（发现模式；慢）
 * npm run mutate -- --id M7   # 只跑某一条（调试用）
 * ```
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '../..');
const TEST_DIR = path.join(APP_ROOT, 'test');
const MANIFEST = path.join(TEST_DIR, 'mutations.json');

export interface Mutation {
  id: string;
  file: string;
  from: string;
  to: string;
  semantics: string;
  expectCatch: string[];
  knownGap?: string;
  note?: string;
}

interface Manifest {
  _doc: string[];
  mutations: Mutation[];
}

export function loadManifest(): Manifest {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as Manifest;
}

/** 注入一处变异；返回还原函数（调用方必须放 `finally` 里）。 */
export function applyMutation(m: Mutation): () => void {
  const abs = path.join(APP_ROOT, m.file);
  const orig = fs.readFileSync(abs, 'utf8');
  const hits = orig.split(m.from).length - 1;
  if (hits !== 1) {
    throw new Error(`${m.id}: 锚串在 ${m.file} 出现 ${hits} 次（应为 1）—— 清单过期了，请更新 test/mutations.json`);
  }
  fs.writeFileSync(abs, orig.replace(m.from, m.to));
  return () => {
    fs.writeFileSync(abs, orig);
    if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error(`${m.id}: ${m.file} 未还原成功`);
  };
}

export interface RunResult {
  ran: number;
  failed: number;
  skipped: number;
  failing: string[];
}

/** 跑一组测试文件，解析 node:test 的汇总（失败用例名一并返回，便于报告）。 */
export function runTests(relFiles: string[], runAll: boolean): RunResult {
  // ★永远显式列文件：裸 `node --test` 会把 `test/` 下的**基础设施**（`orgRules.ts`/`run.ts`/`harness.ts`…）
  //   也当成测试跑（实测：默认发现给出 1092 ≠ 1085）。`runAll` 或"没有定向清单"（已知缺口条目）都走全量。
  const files =
    runAll || relFiles.length === 0
      ? fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts')).map((f) => path.join('test', f))
      : relFiles.map((f) => path.join('test', f));
  const r = spawnSync(
    process.execPath,
    ['--env-file=test/options.test.env', '--import', 'tsx', '--test', '--test-reporter=tap', ...files],
    { cwd: APP_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const num = (re: RegExp): number => Number(re.exec(text)?.[1] ?? 0);
  const failing: string[] = [];
  for (const line of text.split('\n')) {
    const mm = /^\s*not ok \d+ - (.+?)(?: #.*)?$/.exec(line);
    if (mm) failing.push(mm[1]!.trim());
  }
  return {
    ran: num(/# tests (\d+)/),
    failed: num(/# fail (\d+)/),
    skipped: num(/# skipped (\d+)/),
    failing,
  };
}

export interface Outcome {
  m: Mutation;
  status: 'caught' | 'escaped' | 'known-gap' | 'gap-closed' | 'skipped' | 'anchor-missing';
  detail: string;
}

export function run(argv: string[]): number {
  const all = argv.includes('--all');
  const onlyIdx = argv.indexOf('--id');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  const manifest = loadManifest();
  // `--id M7` 按**前缀**匹配（清单里的 id 形如 `M7_draw_order_reversed`）
  const list = only ? manifest.mutations.filter((m) => m.id === only || m.id.startsWith(`${only}_`)) : manifest.mutations;
  if (!list.length) {
    console.error(`没有匹配的变异（--id ${only ?? ''}）`);
    return 2;
  }

  console.log(`[mutate] ${list.length} 条变异；模式=${all ? '全量（发现）' : '定向子集'}；每条跑完自动还原并核对`);
  const outcomes: Outcome[] = [];
  for (const m of list) {
    let restore: (() => void) | null = null;
    let res: RunResult | null = null;
    try {
      restore = applyMutation(m);
      res = runTests(m.expectCatch, all);
    } catch (e) {
      if (restore) restore();
      outcomes.push({ m, status: 'anchor-missing', detail: String((e as Error).message) });
      console.error(`✗ ${m.id}：${(e as Error).message}`);
      continue;
    } finally {
      restore?.();
    }
    const r = res!;
    const caught = r.failed > 0;
    console.log(
      `  ${caught ? '✔' : '·'} ${m.id}  红 ${r.failed}/${r.ran}（skip ${r.skipped}）` +
        (r.failing[0] ? `  例：${r.failing[0].slice(0, 70)}` : ''),
    );
    if (!m.expectCatch.length && m.knownGap) {
      outcomes.push({
        m,
        status: caught ? 'gap-closed' : 'known-gap',
        detail: caught ? `已被抓到 ⇒ 请把 test/mutations.json 的 expectCatch 填上并关掉 ${m.knownGap}` : `零覆盖（已登记 ${m.knownGap}）`,
      });
    } else if (caught) {
      outcomes.push({ m, status: 'caught', detail: `${r.failed} 条红` });
    } else {
      outcomes.push({
        m,
        status: 'escaped',
        detail: `全绿 ⇒ 守卫丢了${r.skipped ? `（注意：本次 skip ${r.skipped} 条，可能是缺真资产导致的假绿）` : ''}`,
      });
    }
  }

  const escaped = outcomes.filter((o) => o.status === 'escaped');
  const closed = outcomes.filter((o) => o.status === 'gap-closed');
  const gaps = outcomes.filter((o) => o.status === 'known-gap');
  console.log('\n[mutate] 汇总：');
  for (const o of outcomes) console.log(`  ${o.status.padEnd(14)} ${o.m.id} — ${o.detail}`);
  if (closed.length) {
    console.log('\n★ 这些已登记的缺口现在被覆盖了，请翻牌（填入 expectCatch 并关票）：');
    for (const o of closed) console.log(`   ${o.m.id} → ${o.m.knownGap}`);
  }
  if (gaps.length) {
    console.log(`\n（已登记缺口 ${gaps.length} 条，不计失败：${gaps.map((g) => `${g.m.id}→${g.m.knownGap}`).join(', ')}）`);
  }
  if (escaped.length) {
    console.error(`\n✗ ${escaped.length} 条变异**没有任何测试抓到** —— 这不是"测试少"，而是"这个语义没人守"：`);
    for (const o of escaped) console.error(`   ${o.m.id}（${o.m.file}）：${o.m.semantics}`);
    console.error('   处置：要么补一条能红的守卫，要么在 test/mutations.json 里登记 knownGap + 开票（不许静默）。');
    return 1;
  }
  console.log('\n✅ 闸门 E 通过：所有应被抓住的变异都被抓住了');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(run(process.argv.slice(2)));
}
