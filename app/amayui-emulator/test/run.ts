/** @tier T0 @kind tool @subsystem tool */
/**
 * **测试执行入口（按档位）** —— 测试分类法的执行端；规则与守卫共用 `test/orgRules.ts`。
 *
 * ```
 * node --import tsx test/run.ts fast      # T0：纯合成/纯函数/棘轮（日常；≈ 秒级）
 * node --import tsx test/run.ts corpus    # T1：需要未入库的真游戏资源（install/ raw/ 真存档槽）
 * node --import tsx test/run.ts all       # T0 + T1（= 提交前/CI 的完整口径，等价于旧的 npm test）
 * node --import tsx test/run.ts e4        # T2：需要真 Electron + GUI 会话（**显式跑**，不进 all/verify）
 * node --import tsx test/run.ts list      # 打印三轴索引（tier / kind / subsystem）
 * node --import tsx test/run.ts check     # 只跑分类一致性校验（不跑用例）
 * ```
 *
 * ★**`all` 为什么不含 T2**（`tickets/T-0132`，2026-09-23 定口径）：
 *  `all` 是 `verify`（提交前必跑）的第 3 段，而 T2 要真 Electron + GUI 会话、单次 +数十秒 ——
 *  那会把 `T-0115` 刚收口到的 ~35 s 重新拉回去，并让"无显示器的 CI/沙箱"从"跑得快"变成"跑不起来"。
 *  ⇒ `all` = T0 + T1（与本文件头注一致），T2 只能由 `npm run test:e4` 显式跑：
 *  改渲染宿主 / 输入 / 窗口时序 / 帧驱动时**必须**跑一次（清单见 `docs-new/04-app/test-organization.md` §5）。
 *  实测（本机 2026-09-23）：`verify` = 1086 例 / ~35 s；`test:e4` = 1 文件 / 1 例 / ~70 s。
 *
 * 为什么要有它：
 *  1. **默认档要快**：单文件 `config1-chain.test.ts` 一个人就是 ~59 s（= 旧全量的一半），
 *     而 147 个文件平均 0.45 s ⇒ 按档选文件是唯一不降判据的加速手段（`tickets/T-0115`）。
 *  2. **档位不许靠"记得"**：`fast` 选出的集合由 `orgRules` 的规则保证"不含真资产依赖"，
 *     并有守卫 `test/organization.test.ts` 复核 —— 不是一份会腐烂的手写清单。
 *  3. **目录不动**：实测移动 T1 文件会打断约 924 处跨台账/文档引用，见 `docs-new/04-app/test-organization.md`。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOrganization, groupByAxis, scanTests, type TestFile } from './orgRules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.dirname(HERE); // app/amayui-emulator
const cmd = process.argv[2] ?? 'fast';

const files = scanTests(HERE);

function pick(pred: (f: TestFile) => boolean): TestFile[] {
  const hit = files.filter(pred);
  const undeclared = hit.filter((f) => !f.pragma);
  if (undeclared.length) {
    console.error(`✗ 有 ${undeclared.length} 个文件没有合法分类头，先跑 \`npm run test:org\`：`);
    for (const f of undeclared) console.error(`   ${f.name}`);
    process.exit(2);
  }
  return hit;
}

const byTier = (t: string) => pick((f) => f.pragma!.tier === t);

function run(selected: TestFile[], label: string): void {
  if (!selected.length) {
    console.log(`（${label}：0 个文件）`);
    return;
  }
  const names = selected.map((f) => path.relative(APP, f.abs));
  console.log(`▶ ${label}：${names.length} 个文件`);
  const r = spawnSync(
    process.execPath,
    ['--env-file=test/options.test.env', '--import', 'tsx', '--test', ...names],
    { cwd: APP, stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

switch (cmd) {
  case 'fast':
    run(byTier('T0'), 'T0 默认档（纯合成 / 纯函数 / 棘轮）');
    break;
  case 'corpus':
    run(byTier('T1'), 'T1 真资产档（需要 install/ 或 raw/ 或真存档槽）');
    break;
  case 'e4':
    run(byTier('T2'), 'T2 真机档（需要 Electron）');
    break;
  case 'all':
    // ★刻意的口径（`tickets/T-0132`）：`all` = T0 + T1，**不含 T2** —— 见文件头的理由。
    run(
      pick((f) => f.pragma!.tier === 'T0' || f.pragma!.tier === 'T1'),
      'T0 + T1 全量（提交前口径；T2 真机档请显式跑 `npm run test:e4`）',
    );
    break;
  case 'check': {
    // `--shrink-harness`：把 T-0020 的一致性基线收缩到当前磁盘现状（**只许收缩**由守卫保证）
    if (process.argv.includes('--shrink-harness')) {
      const { scanHarness } = await import('./harnessScan.js');
      const basePath = path.join(HERE, 'harness-convergence.baseline.json');
      const base = JSON.parse(readFileSync(basePath, 'utf8')) as Record<string, unknown>;
      const now = scanHarness(HERE);
      base['mkVariants'] = now.mkVariants;
      base['selfFrameLoops'] = now.selfFrameLoops;
      writeFileSync(basePath, JSON.stringify(base, null, 1) + '\n');
      console.log(
        `[T-0020] 基线已收缩：mk 变体 ${now.mkVariants.length}、自造帧循环 ${now.selfFrameLoops.length}`,
      );
      break;
    }
    const problems = checkOrganization(files);
    report(problems);
    break;
  }
  case 'list': {
    const { byTier: t, bySubsystem: s, byKind: k } = groupByAxis(files);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({
        total: files.length,
        tiers: Object.fromEntries(Object.entries(t).map(([kk, v]) => [kk, v.length])),
        kinds: Object.fromEntries(Object.entries(k).map(([kk, v]) => [kk, v.length])),
        subsystems: Object.fromEntries(Object.entries(s).map(([kk, v]) => [kk, v.length])),
        files: files.map((f) => ({ name: f.name, ...f.pragma })),
      }, null, 2));
      break;
    }
    console.log(`测试分类索引（${files.length} 个文件）\n`);
    const tree = (title: string, groups: Record<string, TestFile[]>) => {
      console.log(`## ${title}`);
      for (const key of Object.keys(groups).sort()) {
        const v = groups[key]!;
        console.log(`\n### ${key} (${v.length})`);
        for (const f of v) console.log(`  ${f.name}`);
      }
      console.log('');
    };
    tree('档位 tier（什么时候必须跑）', t);
    tree('性质 kind（红了意味着什么）', k);
    tree('子系统 subsystem（去哪找）', s);
    break;
  }
  default:
    console.error(`用法：run.ts <fast|corpus|e4|all|list|check>`);
    process.exit(2);
}

function report(problems: ReturnType<typeof checkOrganization>): void {
  const { byTier: t, byKind: k, bySubsystem: s } = groupByAxis(files);
  console.log(`文件 ${files.length}：` +
    `tier ${Object.entries(t).map(([a, b]) => `${a}=${b.length}`).join(' ')}；` +
    `kind ${Object.entries(k).map(([a, b]) => `${a}=${b.length}`).join(' ')}；` +
    `subsystem ${Object.keys(s).length} 类`);
  if (!problems.length) {
    console.log('✅ 分类一致性：0 条问题');
    return;
  }
  console.error(`✗ 分类一致性：${problems.length} 条问题`);
  for (const p of problems) console.error(`  [${p.rule}] ${p.file} — ${p.detail}`);
  process.exit(1);
}
