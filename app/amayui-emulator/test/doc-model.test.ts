/** @tier T0 @kind ratchet @subsystem ledger */

/**
 * **文档模型守卫**（`docs-new/**` 的 `kind` / `state` 状态机）。
 *
 * 为什么要有它：`docs-new/` 里有 100 份 md，分七类（真源 / 生成物 / 叙述 / 流程 / 索引 / 会话 / 历史记录）。
 * 此前这个分类**只写在正文的散文里**（"勿手改"、"一次性"），没有任何机器可读的标记 ——
 * 实测代价：`docs-new/README.md` 长期把一份**过期快照**（`stub-reaudit §4`）当卖点；
 * 11 份一次性审计/规格（366 KB）在对应票 done 之后仍与"现行结论"混在同一目录。
 *
 * 本守卫强制的不变量（对应 `docs-new/00-overview/authority.md` 附录 A5/A3/A4/A5 的不变量）：
 *   I1 每份 md 都有合法的 `kind`/`state`；`state ≠ live` ⇒ 必有 `superseded_by`
 *   I2 `kind=generated` ⇒ 必写 `home` + `generated_by`，且生成器文件真实存在
 *   I3 **沿革不进生成物**：生成物里不得出现 `analysis/journal.jsonl` 任何条目的正文
 *   I8 `kind=record` ⇔ 位于 `docs-new/99-records/`（历史区），且只增不改
 *   I9 **沿革不进叙述文档**（A4①）：`03-engine/*.md` 的 `kind=narrative` 里不得写「订正/旧句/历史判据」
 *      —— 旧的直接删、订正落 `journal`。为什么要有它：A4① 此前只有 `--validate` 的人眼纪律，
 *      实测 13 份机制叙述里积了 28 处「★2026-09 订正（原文写…）」，读者分不清哪句是现行结论。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const DOCS = path.join(ROOT, 'docs-new');
const KINDS = ['source', 'generated', 'narrative', 'procedure', 'index', 'session', 'record'];
const STATES = ['live', 'consumed', 'superseded'];

const tableMod = (await import(pathToFileURL(path.join(ROOT, 'scripts/build-opcode-table.mjs')).href)) as {
  renderOpcodeTable: (doc: unknown) => string;
};
const indexMod = (await import(pathToFileURL(path.join(ROOT, 'scripts/build-doc-index.mjs')).href)) as {
  scanDocs: (dir?: string) => { rel: string; fm: Record<string, string> | null; title: string; bytes: number }[];
  renderIndex: (docs: { rel: string; fm: Record<string, string> | null; title: string; bytes: number }[]) => string;
};

const docs = indexMod.scanDocs();
const isPath = (s: string) => s.includes('/');

test('★文档模型：每份 docs-new md 都有合法的 kind / state', () => {
  const problems: string[] = [];
  for (const d of docs) {
    if (!d.fm) { problems.push(`${d.rel}：缺 front-matter（kind/state）`); continue; }
    if (!d.fm.kind || !KINDS.includes(d.fm.kind)) problems.push(`${d.rel}：kind 非法（${d.fm.kind}）`);
    if (!d.fm.state || !STATES.includes(d.fm.state)) problems.push(`${d.rel}：state 非法（${d.fm.state}）`);
  }
  assert.deepEqual(problems, [], `front-matter 不合规：\n  - ${problems.join('\n  - ')}`);
  assert.ok(docs.length >= 90, `文档数异常（${docs.length}）—— 扫描可能失效`);
});

test('★文档模型：state ≠ live ⇒ 必有 superseded_by，且路径存在', () => {
  const problems: string[] = [];
  for (const d of docs) {
    const fm = d.fm ?? {};
    if (fm.state === 'live') {
      if (fm.superseded_by) problems.push(`${d.rel}：state=live 不该有 superseded_by`);
      continue;
    }
    if (!fm.superseded_by) { problems.push(`${d.rel}：state=${fm.state} 必须写 superseded_by（结论落在哪）`); continue; }
    if (isPath(fm.superseded_by) && !fs.existsSync(path.join(ROOT, fm.superseded_by))) {
      problems.push(`${d.rel}：superseded_by 指向不存在的路径 ${fm.superseded_by}`);
    }
  }
  assert.deepEqual(problems, [], `state 机不合规：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：kind=generated ⇒ home + generated_by 存在', () => {
  const problems: string[] = [];
  const gen = docs.filter((d) => d.fm?.kind === 'generated');
  assert.ok(gen.length >= 30, `生成物样本太少（${gen.length}）`);
  for (const d of gen) {
    const fm = d.fm ?? {};
    if (!fm.home) problems.push(`${d.rel}：缺 home（真源在哪）`);
    if (!fm.generated_by) { problems.push(`${d.rel}：缺 generated_by`); continue; }
    if (!fs.existsSync(path.join(ROOT, fm.generated_by))) problems.push(`${d.rel}：generated_by 文件不存在（${fm.generated_by}）`);
  }
  assert.deepEqual(problems, [], `生成物标注不合规：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：kind=record ⇔ 位于 99-records/（历史区）', () => {
  const bad = docs.filter((d) => {
    const inRecords = d.rel.startsWith('99-records/');
    return inRecords !== (d.fm?.kind === 'record');
  }).map((d) => `${d.rel}（kind=${d.fm?.kind}）`);
  assert.deepEqual(bad, [], `历史区与 kind=record 必须一致：${bad.join(' / ')}`);
  const records = docs.filter((d) => d.rel.startsWith('99-records/'));
  assert.ok(records.length >= 10, `历史区样本太少（${records.length}）`);
  for (const r of records) {
    assert.equal(r.fm?.state, 'consumed', `${r.rel}：历史记录必须是 consumed（已被台账取代）`);
  }
});

test('★文档模型：沿革不进生成物（journal 正文不得出现在任何 generated md 里）', () => {
  const journal = fs.readFileSync(path.join(ROOT, 'analysis/journal.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as { title: string; body: string });
  assert.ok(journal.length >= 20, `沿革样本太少（${journal.length}）`);
  const problems: string[] = [];
  for (const d of docs.filter((x) => x.fm?.kind === 'generated')) {
    const text = fs.readFileSync(path.join(DOCS, d.rel), 'utf8');
    for (const e of journal) {
      // 只查"整段搬运"：正文前 160 字（去掉空白差异）出现即视为沿革漏进了生成物
      const probe = e.body.replace(/\s+/g, ' ').trim().slice(0, 160);
      if (probe.length < 120) continue;
      if (text.replace(/\s+/g, ' ').includes(probe)) problems.push(`${d.rel} ← 「${e.title.slice(0, 40)}」`);
    }
  }
  assert.deepEqual(problems, [], `沿革漏进生成物：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：沿革不进叙述文档（A4① —— `03-engine` 机制叙述里不得复述「订正」）', () => {
  const BANNED = ['订正', '旧句', '历史判据'];
  const target = docs.filter((d) => d.rel.startsWith('03-engine/') && d.fm?.kind === 'narrative');
  assert.ok(target.length >= 20, `机制叙述样本太少（${target.length}）—— 扫描可能失效`);
  const problems: string[] = [];
  for (const d of target) {
    const lines = fs.readFileSync(path.join(DOCS, d.rel), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const hit = BANNED.find((w) => l.includes(w));
      if (hit) problems.push(`${d.rel}:${i + 1} 「${hit}」`);
    });
  }
  assert.deepEqual(problems, [], `叙述文档里出现沿革话术（A4①：旧的直接删、订正落 journal；数据层的沿革见 tickets/T-0108）：\n  - ${problems.join('\n  - ')}`);
});

test('★文档模型：docs-new/00-overview/index.md 是最新的', () => {
  const md = indexMod.renderIndex(docs);
  const cur = fs.readFileSync(path.join(DOCS, '00-overview/index.md'), 'utf8');
  assert.equal(cur, md, '索引不是最新的 ⇒ 跑 node scripts/build-doc-index.mjs');
});

test('★文档模型：opcode-table.md 是 analysis/opcodes.json 的生成物（不是真源）', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/opcodes.json'), 'utf8'));
  const md = fs.readFileSync(path.join(DOCS, '03-engine/opcode-table.md'), 'utf8');
  assert.equal(md, tableMod.renderOpcodeTable(doc), 'opcode-table.md 不是最新的 ⇒ 跑 node scripts/build-opcode-table.mjs');
  assert.ok(doc.entries.length >= 500, `opcode 映射表样本太少（${doc.entries.length}）`);
  assert.ok(doc.fallbackDefault.entries.length >= 20, `回退默认表样本太少（${doc.fallbackDefault.entries.length}）`);
});
