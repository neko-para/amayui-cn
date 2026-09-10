/**
 * **能力台账的守卫测试**（任务 2）。
 *
 * 台账 = `analysis/engine-capabilities.json`：引擎「常态能力」（逐帧流程 / 门控 / 惰性创建 / 转场 / 资源生命周期…）
 * 的清单 + emulator 现状判定。它存在的理由：这类能力**缺失时不报错、只表现不对**，必须有一份可核对的清单，
 * 症状出现时先查它，而不是每次从零研究。
 *
 * 本测试防的是台账自身腐化：
 *  1. schema 合法（必需的 id/emulator 块、status/evidence 取值在枚举内）；
 *  2. 每条 `guard` 指向的测试文件**真的存在**（防止"声称有守卫"变成空话）；
 *  3. 每条 `n/a-known` 必须写出 `why:`（不许用 n/a 掩盖缺口）；
 *  4. id 不重复；
 *  5. 人可读 md（`docs-new/03-engine/engine-capabilities.md`）与数据层**同步**（id 集合一致、统计一致）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const JSON_PATH = path.join(REPO, 'analysis', 'engine-capabilities.json');
const MD_PATH = path.join(REPO, 'docs-new', '03-engine', 'engine-capabilities.md');
const APP_ROOT = path.resolve(HERE, '..');

interface Entry {
  id: string;
  subsystem: string;
  name: string;
  trigger: string;
  engine: { fns: string[]; raw: string };
  reads: string[];
  whySilent: string;
  confidence: string;
  emulator: { status: string; evidence: string; guard: string; note: string };
}
interface Ledger {
  statusEnum: Record<string, string>;
  evidenceEnum: Record<string, string>;
  counts: Record<string, number>;
  entries: Entry[];
}

function load(): Ledger {
  assert.ok(fs.existsSync(JSON_PATH), `台账应存在：${JSON_PATH}`);
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) as Ledger;
}

test('台账 schema：必需字段齐、status/evidence 在枚举内、id 不重复、raw 区间合法', () => {
  const L = load();
  assert.ok(L.entries.length >= 40, `条目应足够多（实际 ${L.entries.length}）`);
  const ids = new Set<string>();
  for (const e of L.entries) {
    assert.ok(e.id && !ids.has(e.id), `id 必须唯一：${e.id}`);
    ids.add(e.id);
    for (const k of ['subsystem', 'name', 'trigger', 'whySilent', 'confidence'] as const) {
      assert.ok(typeof e[k] === 'string' && e[k].length > 0, `${e.id} 缺 ${k}`);
    }
    assert.ok(e.engine?.fns?.length > 0, `${e.id} 缺 engine.fns`);
    const m = /^(\d+)-(\d+)$/.exec(e.engine.raw);
    assert.ok(m, `${e.id} 的 engine.raw 应形如 "117434-117483"（实际 ${e.engine.raw}）`);
    assert.ok(Number(m![1]) <= Number(m![2]), `${e.id} 的 raw 区间应 a<=b`);
    assert.ok(L.statusEnum[e.emulator.status], `${e.id} 的 status 非法：${e.emulator.status}`);
    assert.ok(L.evidenceEnum[e.emulator.evidence], `${e.id} 的 evidence 非法：${e.emulator.evidence}`);
    assert.equal(typeof e.emulator.note, 'string', `${e.id} 应有 note`);
  }
  // 统计字段与实际一致
  const by = (s: string) => L.entries.filter((e) => e.emulator.status === s).length;
  for (const k of Object.keys(L.statusEnum)) {
    assert.equal(L.counts[k], by(k), `counts.${k} 应为 ${by(k)}`);
  }
  assert.equal(L.counts['total'], L.entries.length);
});

test('台账守卫：每条 guard 指向的测试文件真的存在（防止"声称有守卫"落空）', () => {
  const L = load();
  const missing: string[] = [];
  for (const e of L.entries) {
    const g = e.emulator.guard;
    if (!g) {
      // 声称 E2/E3 就必须给出 guard
      assert.ok(
        e.emulator.evidence === 'E0' || e.emulator.evidence === 'E1',
        `${e.id} 声称 ${e.emulator.evidence} 却没有 guard`,
      );
      continue;
    }
    if (!fs.existsSync(path.join(APP_ROOT, g))) missing.push(`${e.id} → ${g}`);
  }
  assert.deepEqual(missing, [], `guard 指向的文件不存在：\n${missing.join('\n')}`);
});

test('台账不得用 n/a 掩盖缺口：每条 n/a-known 必须写 why:', () => {
  const L = load();
  const bad = L.entries.filter((e) => e.emulator.status === 'n/a-known' && !e.emulator.note.includes('why:'));
  assert.deepEqual(bad.map((e) => e.id), [], 'n/a-known 条目必须在 note 里写明 why:');
  // 反向：非 n/a 的条目不应写 "why:"（避免口径混用）
  const weird = L.entries.filter((e) => e.emulator.status !== 'n/a-known' && e.emulator.note.startsWith('why:'));
  assert.deepEqual(weird.map((e) => e.id), []);
});

test('人可读 md 与数据层同步（id 集合 + 统计一致）', () => {
  const L = load();
  assert.ok(fs.existsSync(MD_PATH), `md 应存在：${MD_PATH}`);
  const md = fs.readFileSync(MD_PATH, 'utf8');
  const missingInMd = L.entries.filter((e) => !md.includes(`\`${e.id}\``)).map((e) => e.id);
  assert.deepEqual(missingInMd, [], '这些条目没出现在 md 里（md 需重新生成）');
  for (const [k, v] of Object.entries(L.statusEnum)) {
    assert.ok(md.includes(`| \`${k}\` | ${L.counts[k]} |`), `md 的统计行与数据层不一致：${k}`);
    void v;
  }
  assert.ok(md.includes(`**${L.entries.length}**`), 'md 应含总条数');
});

test('缺口可见：统计数据可读（体检报告）', () => {
  const L = load();
  const attention = L.entries.filter(
    (e) => e.emulator.status !== 'n/a-known' && e.emulator.status !== 'modeled-verified',
  );
  // 不设阈值（会随进展变化）——只在失败/需要看时把清单打出来
  const lines = attention.map((e) => `  ${e.emulator.status.padEnd(19)} ${e.id}`);
  assert.ok(
    L.counts['modeled-verified'] >= 1,
    `至少应有一条已核验能力（当前 ${L.counts['modeled-verified']}）\n需要关注的 ${attention.length} 条：\n${lines.slice(0, 40).join('\n')}`,
  );
});
