/**
 * **票据台账守卫**（`tickets/<ID>/ticket.json` —— 需求/缺陷单的真源）。
 *
 * 为什么守卫放在 emulator 的测试目录：与 `capability-ledger.test.ts` / `script-ledger.test.ts` 同一理由 ——
 * `npm test` 只在这里跑，闸门必须挂在能被执行的地方。本文件**只读** `tickets/`，不依赖 emulator 代码。
 *
 * 三条纪律（与 `docs-new/00-overview/tickets.md`、`amayui-ticket-ledger` 技能一致）：
 * 1. **没有判据的单不算单**：`acceptance` 必须非空；`title`/`area`/`why` 不许留空；
 * 2. **done 必须带真实存在的守卫**：`status=done` ⇒ `tests[]` 非空且文件存在（不许空口声称）；
 * 3. **证据锚点棘轮**：`evidence[].file` 必须存在、给了 `anchor` 就必须在文件里出现
 *    （代码被删/改名 ⇒ 这张票变红，逼人回来核对）；`line` 漂移只警告（重构会挪行号）。
 *
 * 以及"看板与真源同步"（`tickets/README.md` 由 `node scripts/build-tickets.mjs` 渲染 ⇒ 忘跑就红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const DIR = path.join(REPO, 'tickets');
const README = path.join(DIR, 'README.md');

const TYPES = ['bug', 'req', 'refactor', 'analysis', 'docs', 'tooling', 'translation'];
const STATUSES = ['open', 'doing', 'blocked', 'done', 'dropped'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

interface Ticket {
  id: string;
  type: string;
  status: string;
  priority: string;
  area: string;
  title: string;
  why: string;
  acceptance?: unknown;
  tests?: string[];
  evidence?: { file: string; line?: number; anchor?: string }[];
  blockedBy?: string[];
  links?: { tickets?: string[] };
  history?: { at: string; what: string }[];
  droppedWhy?: string;
  notes?: string;
}

function dirs(): string[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function load(): Map<string, Ticket> {
  const m = new Map<string, Ticket>();
  for (const d of dirs()) {
    const f = path.join(DIR, d, 'ticket.json');
    if (!fs.existsSync(f)) continue;
    m.set(d, JSON.parse(fs.readFileSync(f, 'utf8')) as Ticket);
  }
  return m;
}

test('票据 schema：目录名=id、枚举合法、title/area/why/acceptance 非空、history 非空', () => {
  const ids = dirs();
  assert.ok(ids.length > 0, `tickets/ 下应有票据（${DIR}）`);
  for (const d of ids) {
    assert.match(d, /^T-\d{4}$/, `野文件夹（命名应为 T-\\d{4}）：tickets/${d}`);
    const f = path.join(DIR, d, 'ticket.json');
    assert.ok(fs.existsSync(f), `tickets/${d} 缺 ticket.json（真源）`);
    const t = JSON.parse(fs.readFileSync(f, 'utf8')) as Ticket;
    assert.equal(t.id, d, 'id 必须与文件夹名一致');
    assert.ok(TYPES.includes(t.type), `${d}: type "${t.type}" 不在枚举`);
    assert.ok(STATUSES.includes(t.status), `${d}: status "${t.status}" 不在枚举`);
    assert.ok(PRIORITIES.includes(t.priority), `${d}: priority "${t.priority}" 不在枚举`);
    for (const k of ['title', 'area', 'why'] as const) {
      assert.equal(typeof t[k] === 'string' && (t[k] as string).trim().length > 0, true, `${d}: ${k} 不许留空`);
    }
    assert.ok(Array.isArray(t.acceptance) && t.acceptance.length > 0, `${d}: 没有判据的单不算单（acceptance 空）`);
    assert.ok(Array.isArray(t.history) && t.history.length > 0, `${d}: history 至少一条`);
    for (const h of t.history!) assert.equal(typeof h.at === 'string' && typeof h.what === 'string', true, `${d}: history 条目缺 at/what`);
    if (t.status === 'dropped') {
      const why = (t.droppedWhy ?? '').trim() || (/why[:：]/.test(t.notes ?? '') ? 'notes' : '');
      assert.notEqual(why, '', `${d}: status=dropped 必须写 droppedWhy（不许静默关单）`);
    }
  }
});

test('★done 必须带真实存在的守卫（不许空口声称有测试）', () => {
  for (const [d, t] of load()) {
    if (t.status !== 'done') continue;
    assert.ok(Array.isArray(t.tests) && t.tests.length > 0, `${d}: status=done 但没有 tests[]`);
    for (const g of t.tests!) {
      assert.ok(fs.existsSync(path.join(REPO, g)), `${d}: tests 指向的守卫不存在：${g}`);
    }
  }
});

test('★证据锚点棘轮：evidence 文件必须存在、anchor 必须真的出现在文件里', () => {
  for (const [d, t] of load()) {
    for (const ev of t.evidence ?? []) {
      assert.equal(typeof ev.file, 'string', `${d}: evidence 缺 file`);
      const f = path.join(REPO, ev.file);
      assert.ok(fs.existsSync(f), `${d}: evidence 文件不存在：${ev.file}`);
      if (!ev.anchor) continue;
      const text = fs.readFileSync(f, 'utf8');
      assert.ok(
        text.includes(ev.anchor),
        `${d}: 证据锚点已消失 —— "${ev.anchor}" 不在 ${ev.file}（代码被删/改名 ⇒ 回来核对这张票）`,
      );
    }
  }
});

test('票据依赖：blockedBy / links.tickets 不悬空、不成环', () => {
  const m = load();
  for (const [d, t] of m) {
    for (const dep of t.blockedBy ?? []) {
      assert.ok(m.has(dep), `${d}: blockedBy 悬空：${dep}`);
      assert.notEqual(dep, d, `${d}: blockedBy 指向自己`);
    }
    for (const rel of t.links?.tickets ?? []) assert.ok(m.has(rel), `${d}: links.tickets 悬空：${rel}`);
  }
  // 成环检测
  const seen = new Set<string>();
  const stack = new Set<string>();
  const visit = (id: string): void => {
    if (stack.has(id)) assert.fail(`blockedBy 成环：${[...stack, id].join(' → ')}`);
    if (seen.has(id)) return;
    seen.add(id);
    stack.add(id);
    for (const dep of m.get(id)?.blockedBy ?? []) if (m.has(dep)) visit(dep);
    stack.delete(id);
  };
  for (const id of m.keys()) visit(id);
});

test('看板与真源同步（忘跑 build-tickets.mjs 会红）', () => {
  assert.ok(fs.existsSync(README), 'tickets/README.md 应由 node scripts/build-tickets.mjs 生成');
  const text = fs.readFileSync(README, 'utf8');
  const m = load();
  const missing = [...m.keys()].filter((id) => !text.includes(`\`${id}\``));
  assert.deepEqual(missing, [], `看板里缺这些票（重跑 node scripts/build-tickets.mjs）：${missing.join(', ')}`);
  assert.match(text, /勿手改本文件/, 'README 顶部必须标明它是生成物');
});
