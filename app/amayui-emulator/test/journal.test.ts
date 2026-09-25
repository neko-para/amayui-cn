/** @tier T0 @kind tool @subsystem ledger */

/**
 * **沿革台账（`analysis/journal.jsonl`）的守卫**。
 *
 * 为什么需要它：`scripts/journal.js` 的文件头一直写着"结构自检（守卫 `test/journal.test.ts` 走同一套规则）"，
 * 但**那个文件不存在** —— 于是规则与数据悄悄漂移，直到 2026-09-25 的工具评估轮才发现：
 * `--validate` 实测 **exit 1**，两条真实条目既用了未登记的 `kind: impl-status`，又把 `round` 写成
 * 标签字符串（`T-0148 实施轮（P1）`）。**"文档说有守卫"而没有守卫**，就等于没有规则。
 *
 * 三条判据：
 *  ① 真实沿革必须过 `--validate`（与工具**同一套**规则：结构 + 票号回链）；
 *  ② `round` 的两种形态都要被接受 —— 纯编号（`9`）与标签（`T-0148 实施轮（P1）`），`null` 也行；
 *  ③ 真正的非法值要**响亮失败**（未登记的 `kind`、空字符串 `round`）—— 否则"放宽"会退化成"不管"。
 *
 * 本文件不碰真实台账：写入型断言都在 `.tmp/` 沙箱里做（`journal.js --root <沙箱>`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const JOURNAL = path.join(REPO, 'scripts', 'journal.js');
const TMP_ROOT = path.join(REPO, '.tmp');

interface RunResult { status: number; stdout: string; stderr: string }

function run(args: string[]): RunResult {
  const r = spawnSync(process.execPath, [JOURNAL, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 在 `.tmp/` 下建沙箱并写入一份沿革（`.tmp/` 是 gitignore 的临时区）。 */
function sandbox(tag: string, entries: unknown[]): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `journal-${tag}-`));
  fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'analysis', 'journal.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
  return root;
}

const entry = (seq: number, round: unknown, kind: string): unknown => ({
  seq, at: '2026-09', round, kind,
  title: `夹具 ${seq}`, source: 'test/journal.test.ts', body: '夹具正文（≥ 无字数要求）', tickets: [],
});

test('★真实沿革必须过 --validate（结构 + 票号回链）', () => {
  const r = run(['--validate']);
  assert.equal(r.status, 0, `沿革自检必须绿：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /journal\.jsonl 合法/, r.stdout);
  // 规模下限：样本太少说明文件被截断/换路径了（守卫不该"扫了 0 条也算过"）。
  const n = Number(/（(\d+) 条/.exec(r.stdout)?.[1] ?? 0);
  assert.ok(n >= 20, `沿革样本太少（${n}）—— 扫描可能失效`);
});

test('★round 是标签：编号 / 文字标签 / null 三种都合法', () => {
  const root = sandbox('rounds', [
    entry(1, 9, 'changelog'),
    entry(2, 'T-0148 实施轮（P1）', 'impl-status'),
    entry(3, null, 'summary'),
  ]);
  try {
    const r = run(['--root', root, '--validate']);
    assert.equal(r.status, 0, `三种 round 形态都该被接受：${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /3 条/, r.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★非法值必须响亮失败（未登记的 kind / 空白 round / seq 不递增）', () => {
  const cases: [string, unknown[], RegExp][] = [
    ['未登记的 kind', [entry(1, 9, 'not-a-kind')], /kind 非法/],
    ['空白 round', [entry(1, '   ', 'changelog')], /round/],
    ['seq 不递增', [entry(2, 9, 'changelog'), entry(1, 9, 'changelog')], /seq/],
  ];
  for (const [name, entries, expect] of cases) {
    const root = sandbox('bad', entries);
    try {
      const r = run(['--root', root, '--validate']);
      assert.notEqual(r.status, 0, `${name} 必须非零退出`);
      assert.match(r.stderr, /校验失败/, r.stderr);
      assert.match(r.stderr, expect, `${name} 的报错要点到根因：${r.stderr}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
