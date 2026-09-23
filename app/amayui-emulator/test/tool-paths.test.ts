/** @tier T0 @kind tool @subsystem tool */

/**
 * `T-0032` 守卫：**命令行路径参数的基准统一 + 越界前置报错**（`tools/paths.cjs`）。
 *
 * ## 事故（本票的来源，实测两次）
 * ```
 * cd app/amayui-emulator
 * npx electron tools/record.cjs --scenario ../../.tmp/scen.json --out ../../.tmp/x.jsonl.gz
 * → record.cjs 的 fs.mkdirSync(path.dirname(OUT)) 抛 EPERM（路径越出仓库）
 * → 异常在 require(main.cjs) 阶段冒出 ⇒ Electron 弹「App threw an error during load」
 * ```
 * 根因是同一命令里**两种基准**（`--scenario` 相对 cwd、`--out` 相对仓库根）+ 没有前置校验。
 *
 * ## 本守卫锁四件事
 *  ① `--out .tmp/x` ⇒ 落在**仓库** `.tmp/`（基准 = 仓库根，与 `shot.cjs` 一致）；
 *  ② 越出仓库的相对/绝对路径 ⇒ **抛 `ToolPathError`**（调用方据此 `exit(2)`，不再冒成加载期异常）；
 *  ③ 文档里的老写法 `--scenario tools/scenarios/gamestart.json`（在包目录下敲）仍可用，
 *     但**必须报告**命中的是 `cwd(fallback)`（不做静默双基准）；
 *  ④两个 Electron 跑手都 `require('./paths.cjs')`，且 `preflight(...)` 出现在
 *     `require('../dist/electron/main.cjs')` **之前** —— 位置反过来就又会变成弹窗。
 *     ★`--name` 的边界（不许带路径分隔符/`..`）2026-09-23 起**真跑一次 CLI** 断言（`tickets/T-0125`），
 *     不再对源码里的报错文案做正则；`preflight` 的**语句顺序**仍只能看源码（那是代码形状主张，
 *     没有运行期可观测物）⇒ 这一类"必须不存在/必须在前"的断言保留为棘轮。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const TOOLS = path.join(APP, 'tools');
const require_ = createRequire(import.meta.url);
const paths = require_(path.join(TOOLS, 'paths.cjs')) as {
  ROOT: string;
  ToolPathError: new (m: string) => Error;
  isInside(a: string, b: string): boolean;
  resolveRepoPath(raw: string, what: string, opts?: { mustExist?: boolean; cwdFallback?: boolean; cwd?: string }): {
    abs: string;
    how: string;
  };
};

const PKG_DIR = APP; // `npm run record` 的 cwd 就是包目录

test('★T-0032 ①：`--out .tmp/x` 落在**仓库** `.tmp/`（基准 = 仓库根，与 shot.cjs 同）', () => {
  const r = paths.resolveRepoPath('.tmp/x.jsonl.gz', 'out', { cwd: PKG_DIR });
  assert.equal(r.abs, path.join(paths.ROOT, '.tmp', 'x.jsonl.gz'));
  assert.equal(r.how, 'repo-root');
});

test('★T-0032 ②：越出仓库的路径（相对 / 绝对）都必须抛 ToolPathError（不再让 mkdir 冒 EPERM）', () => {
  for (const [raw, why] of [
    ['../../.tmp/x.jsonl.gz', '票面实测的那条：从包目录传 ../../.tmp/x'],
    ['../outside.jsonl.gz', '只上一级也越界'],
    [path.join(paths.ROOT, '..', 'outside.jsonl.gz'), '绝对路径越出仓库'],
  ] as const) {
    assert.throws(
      () => paths.resolveRepoPath(raw, 'out', { cwd: PKG_DIR }),
      (err: unknown) => {
        assert.ok(err instanceof paths.ToolPathError, `${why}：应为 ToolPathError（实得 ${String(err)}）`);
        assert.match((err as Error).message, /越出仓库/, `报错必须说清"越出仓库"：${(err as Error).message}`);
        return true;
      },
      why,
    );
  }
});

test('★T-0032 ③：`--scenario` 的两种写法都解析到同一个文件，且**报告**命中的规则', () => {
  const rel = 'tools/scenarios/gamestart.json'; // 文档里的写法（cwd = 包目录）
  const fromPkg = paths.resolveRepoPath(rel, 'scenario', { cwd: PKG_DIR, mustExist: true, cwdFallback: true });
  assert.equal(fromPkg.abs, path.join(TOOLS, 'scenarios', 'gamestart.json'));
  assert.equal(fromPkg.how, 'cwd(fallback)', '★必须明说用了 cwd 候选（不许静默双基准）');

  const abs = paths.resolveRepoPath(fromPkg.abs, 'scenario', { cwd: PKG_DIR, mustExist: true, cwdFallback: true });
  assert.equal(abs.abs, fromPkg.abs, '绝对路径原样使用');
  assert.equal(abs.how, 'absolute');
});

test('★T-0032 ③ 反面：`--scenario` 指向不存在的文件 ⇒ 可读报错（列出两个候选）', () => {
  assert.throws(
    () => paths.resolveRepoPath('tools/scenarios/__nope__.json', 'scenario', { cwd: PKG_DIR, mustExist: true, cwdFallback: true }),
    (err: unknown) => {
      assert.ok(err instanceof paths.ToolPathError);
      assert.match((err as Error).message, /不存在/, '报错要说"文件不存在"');
      assert.match((err as Error).message, /repo-root/, '要列出试过哪几个候选（含命中规则）');
      return true;
    },
  );
});

test('★T-0032 ④（源码棘轮）：两个跑手都用同一份 paths.cjs，且校验在 require Electron **之前**', () => {
  for (const tool of ['record.cjs', 'shot.cjs']) {
    const lines = fs.readFileSync(path.join(TOOLS, tool), 'utf8').split('\n');
    const src = lines.join('\n');
    assert.ok(src.includes("require('./paths.cjs')"), `${tool} 必须用共享的 paths.cjs（唯一基准真源）`);
    // ★按**行**找真正的语句：文件头注释里也提到过 `require('../dist/electron/main.cjs')`，
    //   用 `indexOf` 会被注释骗到（实测踩过）。
    const pre = lines.findIndex((l) => l.includes('preflight('));
    const main = lines.findIndex((l) => /^\s*(const .*=\s*)?require\(['"]\.\.\/dist\/electron\/main\.cjs['"]\)/.test(l));
    assert.ok(pre >= 0, `${tool} 必须调用 preflight(...)`);
    assert.ok(main >= 0, `${tool} 必须 require 主进程（行首语句）`);
    assert.ok(
      pre < main,
      `★${tool}：preflight（第 ${pre + 1} 行）必须排在 require(main.cjs)（第 ${main + 1} 行）**之前**` +
        `（顺序反了 ⇒ 参数错又变成 Electron 弹窗）`,
    );
  }
});

test('★T-0032 ④：参数错 ⇒ **前置报错 + exit 2**（真跑一次 CLI，不拉起 Electron、也不看源码文案）', () => {
  // ★2026-09-23（`tickets/T-0125`）：原版断 `assert.match(src, /--name 只是文件名/)` —— 判据钉在
  //   `shot.cjs` 里那句**写死的报错文案**上（改标点就假红，而把校验删掉只要文案还在就假绿）。
  //   现在真跑一次 CLI。之所以能这么跑：两个跑手的参数校验 2026-09-23 起排在
  //   `require('electron')` **之前**（原先只排在 `require(main.cjs)` 之前）⇒ 普通 node 子进程
  //   就能走到校验、拿到 `exit(2)`，全程不拉起 Electron。
  for (const bad of ['a/b', 'a\\b', '..', 'x/../../y']) {
    const r = spawnSync(process.execPath, [path.join(TOOLS, 'shot.cjs'), '--name', bad], { encoding: 'utf8' });
    assert.equal(r.status, 2, `--name ${JSON.stringify(bad)} 必须前置报错 exit(2)；实际 status=${r.status}`);
    assert.ok(
      !/App threw an error|commandLine|electron/i.test(`${r.stdout}${r.stderr}`),
      `★不许进入 Electron（那就会变成弹窗）：${r.stdout}${r.stderr}`,
    );
  }
  // `record.cjs` 的越界 `--out`：同一份 `paths.cjs` 规则，同样必须在起 Electron 之前报出来
  const rec = spawnSync(process.execPath, [path.join(TOOLS, 'record.cjs'), '--out', '../../越界.jsonl.gz'], {
    encoding: 'utf8',
  });
  assert.equal(rec.status, 2, `越界的 --out 必须 exit(2)；实际 status=${rec.status}：${rec.stdout}${rec.stderr}`);
  assert.match(String(rec.stderr), /越出仓库/, `应给一行可读的越界说明：${rec.stderr}`);
  // 反面控制：合法 `--name` 会**继续往下走**（在普通 node 下会因为拿不到真 Electron 而失败，
  // 但**不再是** exit(2) 那条前置校验）⇒ 证明上一条不是因为"任何参数都 exit 2"。
  const ok = spawnSync(process.execPath, [path.join(TOOLS, 'shot.cjs'), '--name', 'guard-probe'], { encoding: 'utf8' });
  assert.notEqual(ok.status, 2, `合法 --name 不该走前置校验的 exit(2)：${ok.stdout}${ok.stderr}`);
});

test('T-0032：`isInside` 的边界（等于 / 在内 / 在外 / 前缀相似但不是子目录）', () => {
  const root = paths.ROOT;
  assert.equal(paths.isInside(root, root), true, '等于自身算在内');
  assert.equal(paths.isInside(path.join(root, '.tmp'), root), true);
  assert.equal(paths.isInside(path.join(root, '..', 'x'), root), false);
  assert.equal(paths.isInside(`${root}-sibling`, root), false, '★前缀相似不是子目录（不能靠 startsWith 判）');
});
