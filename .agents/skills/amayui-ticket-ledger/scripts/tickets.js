#!/usr/bin/env node
/**
 * tickets.js —— **需求/缺陷单台账**的查询 + 增删改 + 自检工具。
 *
 * ## 存储模型：**一个需求 = 一个文件夹**（多文件）
 * ```
 * tickets/
 *   README.md              ← 生成物（看板；由 scripts/build-tickets.mjs 渲染，勿手改）
 *   T-0001/
 *     ticket.json          ← ★唯一的机器可读真源（状态/优先级/判据/证据/链接/history）
 *     notes.md             ← 手写：调查、设计、决策（可多份，见下）
 *     changes.md           ← 手写：**变更记录**（同一个需求可以改很多次，一条一次）
 *     repro.md / design.md / …  ← 允许任意多份过程文档（自由命名）
 *     evidence/            ← 可选：截图/日志等附件（不进校验，只统计）
 * ```
 * **为什么一个需求一个文件夹**（用户要求）：一个需求往往跨多个文档、经过多次变更 ——
 * 单文件会把"元数据 + 调查 + 设计 + 变更记录"挤在一起，且每次改动都重写整份台账。
 * 现在：`ticket.json` 只管**机器可读的那一半**（状态/判据/证据锚点/链接），其余都进同目录的手写文档。
 *
 * ## 真源与生成物
 * - 真源 = `tickets/<ID>/ticket.json`（只有它参与 schema 校验与看板渲染）。
 * - 生成物 = `tickets/README.md`（`node scripts/build-tickets.mjs`；守卫测试会核对同步）。
 * - 手写过程文档**不参与校验**（只被 `--show`/看板列出来），所以随便写、随时加。
 *
 * ## 命令
 * 查询：`--list [--status S --area A --type T --priority P --open]` · `--show <ID>` · `--stats` · `--next-id`
 *       `--anchors-in <文件>`（谁锚在这个文件上 —— 改被锚文件前先跑它；只读）
 * 写入：`--add '<json>'` · `--add-file <path>` · `--edit <ID> --set k=v | --set-json k=<json>`
 *       `--set-status <ID> <status> [--note '…']` · `--note <ID> --file changes.md --text '…'` · `--rm <ID> --yes`
 *       `--recount`（重算账目并打 diff；票源 `ticket.json` 不含 `counts` 字段，见实现注释）
 * 自检：`--validate`（= `app/amayui-emulator/test/ticket-ledger.test.ts` 的同一套规则）
 *
 * ★值里带 ASCII 逗号/引号请用 `--set-json k=<json>`（值按 JSON 解析，失败会点名 key 并非零退出）。
 *
 * ## 硬性约定（`--validate` 会替你查）
 * 1. 文件夹名 = `T-\d{4}`，且必须与 `ticket.json.id` 一致；`tickets/` 下不许有野文件夹；
 * 2. `type/status/priority` 在枚举内；`title`/`area`/`why` 非空；`acceptance` 非空（**没有判据的单不算单**）；
 * 3. `status: done` ⇒ `tests[]` 非空**且每个测试文件真实存在**（与能力台账同纪律：不许空口声称有守卫）；
 * 4. `status: dropped` ⇒ 必须写 `droppedWhy`（或 notes 里有 `why:`）——不许用"关掉"掩盖理由；
 * 5. **证据锚点棘轮**：`evidence[].file` 必须存在；给了 `anchor` 就必须在文件里出现（代码被删/改名 ⇒ 变红）；
 *    给了 `line` 而 anchor 不在该行 ±40 行内 ⇒ **警告**（行号会随重构漂移，不据此判失败）；
 * 6. `links.tickets` / `blockedBy` 不许悬空，且 `blockedBy` 不许成环；
 * 7. `history` 至少一条，每条有 `at` + `kind` + `what`；`kind ∈ created|status|scope|decision`。
 *    ★**没有 `--note` 就不记 history**（字段级 diff 由版本控制负责）。`notes` 字段已废（长文进 `notes.md`）。
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const TYPES = ['bug', 'req', 'refactor', 'analysis', 'docs', 'tooling', 'translation'];
const STATUSES = ['open', 'doing', 'blocked', 'done', 'dropped'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
/** 过程文档的**约定名**（其余自由命名；这些只是给看板排序用）。 */
const KNOWN_DOCS = ['notes.md', 'changes.md', 'repro.md', 'design.md', 'evidence.md'];

const VALUE_FLAGS = new Set([
  '--status', '--area', '--type', '--priority',
  '--add', '--add-file', '--edit', '--set', '--set-json', '--anchors-in',
  '--note', '--file', '--text', '--root', '--rm', '--show',
  // ★带值的子命令（漏一个就会退化成布尔 ⇒ `id=true` 让 path.join 抛错，2026-09 实测踩到）
  '--set-status',
]);

function parseOpt(argv) {
  const o = { set: [], setJson: [] };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') { o.set.push(argv[++i]); continue; }
    if (a === '--set-json') { o.setJson.push(argv[++i]); continue; }
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) o[a.slice(2)] = argv[++i];
      else o[a.slice(2)] = true;
      continue;
    }
    pos.push(a);
  }
  return { o, pos };
}
const { o: opt, pos } = parseOpt(process.argv.slice(2));
const root = (typeof opt.root === 'string' ? opt.root : null) || '.';
// ★`tickets/T-0130`：守卫规格（`file#anchor`）的规则实现只有一份 —— `scripts/lib/guard-spec.cjs`
// ★相对**工具自身**定位（不是 `--root`）：规则实现是工具代码，不是台账数据 ——
//   `agent-workflow.test.ts` 会用 `--root <临时目录>` 跑这些工具，那里没有 scripts/lib。
const { checkGuard } = require(path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'guard-spec.cjs'));
const DIR = path.join(root, 'tickets');

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 原子写：同目录 tmp + `renameSync`（同文件系统内 rename 原子）。
 * 并发的守卫测试/看板渲染因此永远看不到被截断的 `ticket.json`。
 */
function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* 清理失败无所谓 */ }
    throw err;
  }
}
/**
 * 追加用 `O_APPEND`（`appendFileSync`），**不**走 tmp+rename。
 * 理由：append **不截断**文件 ⇒ 并发读者看不到残缺内容；反过来"读旧文 + 整文件原子写回"会在
 * 两个 agent 同时 `--note` 时丢掉一方（读-改-写竞态）。只有**截断式整文件重写**才需要 tmp+rename。
 */
function appendFile(file, text) {
  fs.appendFileSync(file, text, 'utf8');
}

/** 路径归一：反斜杠→正斜杠、去 `./` 前缀、去尾斜杠。 */
function normPath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
/** 精确相等**或**互为后缀 ⇒ 命中（`src/SN0000.txt` 与绝对路径都能用）。 */
function pathMatches(candidate, target) {
  const c = normPath(candidate);
  const t = normPath(target);
  if (!c || !t) return false;
  return c === t || c.endsWith('/' + t) || t.endsWith('/' + c);
}

function ticketDirs() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** 读一张票（失败返回 {id, error}，由调用方决定怎么报）。 */
function readTicket(id) {
  const f = path.join(DIR, id, 'ticket.json');
  if (!fs.existsSync(f)) return { id, error: `缺 ticket.json` };
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    return { id, error: `ticket.json 不是合法 JSON：${err.message}` };
  }
}

function allTickets() {
  return ticketDirs().map(readTicket);
}

/** 该票文件夹里的过程文档（不含 ticket.json；`evidence/` 单独统计）。 */
function docsOf(id) {
  const d = path.join(DIR, id);
  if (!fs.existsSync(d)) return { docs: [], evidence: 0, other: [] };
  const entries = fs.readdirSync(d, { withFileTypes: true });
  const docs = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
    .sort((a, b) => (KNOWN_DOCS.indexOf(a) + 1 || 99) - (KNOWN_DOCS.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const other = entries.filter((e) => e.isFile() && !e.name.endsWith('.md') && e.name !== 'ticket.json').map((e) => e.name);
  const ev = entries.find((e) => e.isDirectory() && e.name === 'evidence');
  const evidence = ev ? fs.readdirSync(path.join(d, 'evidence')).length : 0;
  return { docs, evidence, other };
}

function nextId() {
  let max = 0;
  for (const id of ticketDirs()) {
    const m = /^T-(\d{4})$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `T-${String(max + 1).padStart(4, '0')}`;
}

function writeTicket(t, extra) {
  const dir = path.join(DIR, t.id);
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(path.join(dir, 'ticket.json'), JSON.stringify(t, null, 2) + '\n');
  if (extra && extra.notes) {
    const f = path.join(dir, 'notes.md');
    if (!fs.existsSync(f)) writeFileAtomic(f, `# ${t.id} · ${t.title}\n\n`);
    appendFile(f, extra.notes.trimEnd() + '\n');
  }
}

/** 点路径赋值（`a.b.c=值`）；`--set-json` 的值按 JSON 解析（数组/对象）。 */
function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// 校验（= 守卫测试的同一套规则）
// ---------------------------------------------------------------------------

function buildIndex() {
  const map = new Map();
  for (const id of ticketDirs()) {
    const t = readTicket(id);
    if (t.error) continue;
    map.set(id, t);
  }
  return map;
}

/** 锚点校验：文件在不在、anchor 在不在、行号漂没漂。 */
function checkEvidence(ev, problems, warnings) {
  if (!ev || typeof ev.file !== 'string' || ev.file.length === 0) {
    problems.push('evidence 条目缺 file');
    return;
  }
  const f = path.join(root, ev.file);
  if (!fs.existsSync(f)) {
    problems.push(`evidence 文件不存在：${ev.file}`);
    return;
  }
  if (!ev.anchor) return;
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    return; // 二进制/大文件：只查存在性
  }
  if (!text.includes(ev.anchor)) {
    problems.push(`evidence 锚点已消失："${ev.anchor}" 不在 ${ev.file}（代码被删/改名 ⇒ 回来核对这张票）`);
    return;
  }
  if (typeof ev.line === 'number' && ev.line > 0) {
    const lines = text.split(/\r?\n/);
    const near = lines.some(
      (l, i) => Math.abs(i + 1 - ev.line) <= 40 && l.includes(ev.anchor),
    );
    if (!near) warnings.push(`evidence 行号已漂移：${ev.file}:${ev.line} 附近 ±40 行找不到 "${ev.anchor}"（建议刷新行号）`);
  }
}

function validate() {
  const problems = [];
  const warnings = [];
  const index = buildIndex();
  const dirs = ticketDirs();

  if (dirs.length === 0) problems.push(`tickets/ 下没有任何票据（目录：${DIR}）`);

  for (const dir of dirs) {
    if (!/^T-\d{4}$/.test(dir)) problems.push(`野文件夹（命名应为 T-\\d{4}）：tickets/${dir}`);
  }

  for (const dir of dirs) {
    if (!/^T-\d{4}$/.test(dir)) continue;
    const t = readTicket(dir);
    if (t.error) {
      problems.push(`tickets/${dir}：${t.error}`);
      continue;
    }
    const at = (m) => `tickets/${dir}：${m}`;
    if (t.id !== dir) problems.push(at(`id(${t.id}) 与文件夹名不一致`));
    if (!TYPES.includes(t.type)) problems.push(at(`type "${t.type}" 不在枚举 ${TYPES.join('/')}`));
    if (!STATUSES.includes(t.status)) problems.push(at(`status "${t.status}" 不在枚举 ${STATUSES.join('/')}`));
    if (!PRIORITIES.includes(t.priority)) problems.push(at(`priority "${t.priority}" 不在枚举 ${PRIORITIES.join('/')}`));
    for (const k of ['title', 'area', 'why']) {
      if (typeof t[k] !== 'string' || t[k].trim().length === 0) problems.push(at(`缺 ${k}（不许留空）`));
    }
    if (!Array.isArray(t.acceptance) || t.acceptance.filter((s) => typeof s === 'string' && s.trim()).length === 0) {
      problems.push(at('acceptance 为空 —— 没有判据的单不算单（写"怎么算做完"）'));
    }
    if (t.status === 'done') {
      const tests = Array.isArray(t.tests) ? t.tests : [];
      const doneWhy = typeof t.doneWhy === 'string' ? t.doneWhy.trim() : '';
      if (tests.length === 0 && doneWhy.length === 0) {
        problems.push(at('status=done 但没有 tests[]、也没有 doneWhy —— 不许空口声称做完（代码票给 tests，文档/分析票给 doneWhy）'));
      }
      // ★`tickets/T-0130`：文件存在 → **用例存在**（规则实现只有一份：scripts/lib/guard-spec.mjs）
      for (const g of tests) {
        const why = checkGuard(root, g);
        if (why) problems.push(at(`tests 指向的守卫不存在：${g}（${why}）`));
      }
    }
    if (t.status === 'dropped') {
      const notes = typeof t.notes === 'string' ? t.notes : '';
      if (typeof t.droppedWhy !== 'string' || t.droppedWhy.trim().length === 0) {
        if (!/why[:：]/.test(notes)) problems.push(at('status=dropped 但没有 droppedWhy（或 notes 里的 why:）—— 不许静默关单'));
      }
    }
    const evProblems = [];
    for (const ev of Array.isArray(t.evidence) ? t.evidence : []) checkEvidence(ev, evProblems, warnings);
    for (const p of evProblems) problems.push(at(p));
    for (const dep of Array.isArray(t.blockedBy) ? t.blockedBy : []) {
      if (!index.has(dep)) problems.push(at(`blockedBy 悬空：${dep}`));
      if (dep === t.id) problems.push(at('blockedBy 指向自己'));
    }
    for (const rel of Array.isArray(t.links?.tickets) ? t.links.tickets : []) {
      if (!index.has(rel)) problems.push(at(`links.tickets 悬空：${rel}`));
    }
    if (!Array.isArray(t.history) || t.history.length === 0) problems.push(at('history 为空（至少一条"创建"记录）'));
    const HISTORY_KINDS = ['created', 'status', 'scope', 'decision'];
    for (const h of Array.isArray(t.history) ? t.history : []) {
      if (!h || typeof h.at !== 'string' || typeof h.what !== 'string') problems.push(at('history 条目缺 at/what'));
      else if (!HISTORY_KINDS.includes(h.kind)) problems.push(at(`history 条目的 kind 非法（${h.kind}）；合法值 ${HISTORY_KINDS.join('/')}`));
    }
    for (const k of ['evidence', 'acceptance', 'history']) {
      if (t[k] !== undefined && !Array.isArray(t[k])) problems.push(at(`${k} 必须是数组`));
    }
  }

  // blockedBy 成环
  const seen = new Set();
  const stack = new Set();
  const visit = (id) => {
    if (stack.has(id)) {
      problems.push(`blockedBy 成环：${[...stack, id].join(' → ')}`);
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    stack.add(id);
    for (const dep of index.get(id)?.blockedBy ?? []) if (index.has(dep)) visit(dep);
    stack.delete(id);
  };
  for (const id of index.keys()) visit(id);

  return { problems, warnings, index };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

const STATUS_MARK = { open: '⬜', doing: '🔜', blocked: '⛔', done: '✅', dropped: '🚫' };

function fmtRow(t) {
  const docs = docsOf(t.id);
  const docInfo = docs.docs.length ? ` +${docs.docs.length}doc` : '';
  return `${STATUS_MARK[t.status] ?? '?'} ${t.priority} ${t.id} [${t.type}/${t.area}] ${t.title}${docInfo}`;
}

function cmdList() {
  let list = allTickets().filter((t) => !t.error);
  if (opt.status) list = list.filter((t) => t.status === opt.status);
  if (opt.area) list = list.filter((t) => String(t.area).includes(opt.area));
  if (opt.type) list = list.filter((t) => t.type === opt.type);
  if (opt.priority) list = list.filter((t) => t.priority === opt.priority);
  if (opt.open) list = list.filter((t) => t.status === 'open' || t.status === 'doing' || t.status === 'blocked');
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const sorder = { doing: 0, blocked: 1, open: 2, done: 3, dropped: 4 };
  list.sort((a, b) => (sorder[a.status] - sorder[b.status]) || (order[a.priority] - order[b.priority]) || a.id.localeCompare(b.id));
  if (list.length === 0) {
    console.log('（没有匹配的票据）');
    return;
  }
  for (const t of list) console.log(fmtRow(t));
  console.log(`\n（${list.length} 张）`);
}

function cmdShow(id) {
  const t = readTicket(id);
  if (t.error) {
    console.error(`✗ ${id}：${t.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(t, null, 2));
  const d = docsOf(id);
  console.log(`\n过程文档（tickets/${id}/）：`);
  if (d.docs.length === 0) console.log('  （无；可加 notes.md / changes.md / design.md …）');
  for (const f of d.docs) {
    const lines = fs.readFileSync(path.join(DIR, id, f), 'utf8').split(/\r?\n/).length;
    console.log(`  · ${f}（${lines} 行）`);
  }
  if (d.evidence) console.log(`  · evidence/（${d.evidence} 个附件）`);
  for (const f of d.other) console.log(`  · ${f}（非 .md）`);
}

function cmdStats() {
  const list = allTickets().filter((t) => !t.error);
  const group = (key) => {
    const m = new Map();
    for (const t of list) m.set(t[key], (m.get(t[key]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  console.log(`票据 ${list.length} 张（目录 ${DIR}）`);
  console.log(`按状态：${group('status').map(([k, v]) => `${STATUS_MARK[k] ?? ''}${k} ${v}`).join('  ')}`);
  console.log(`按类型：${group('type').map(([k, v]) => `${k} ${v}`).join('  ')}`);
  console.log(`按优先级：${group('priority').map(([k, v]) => `${k} ${v}`).join('  ')}`);
  const areas = group('area').slice(0, 12);
  console.log(`按域（前 12）：${areas.map(([k, v]) => `${k} ${v}`).join('  ')}`);
  const open = list.filter((t) => t.status !== 'done' && t.status !== 'dropped');
  const blocked = open.filter((t) => t.status === 'blocked');
  if (blocked.length) console.log(`⛔ 阻塞中：${blocked.map((t) => t.id).join(' ')}`);
}

function cmdGraph() {
  const index = buildIndex();
  const printed = new Set();
  const walk = (id, depth) => {
    const t = index.get(id);
    if (!t) return;
    console.log(`${'  '.repeat(depth)}${id} ${STATUS_MARK[t.status] ?? ''} ${t.title}`);
    printed.add(id);
    for (const dep of t.blockedBy ?? []) if (!printed.has(dep)) walk(dep, depth + 1);
  };
  const roots = [...index.keys()].filter((id) => (index.get(id).blockedBy ?? []).length > 0);
  for (const id of roots) if (!printed.has(id)) walk(id, 0);
  console.log(`\n（有 blockedBy 的 ${roots.length} 张；其余为普通待办）`);
}

function cmdAdd() {
  let t;
  if (typeof opt.add === 'string') {
    try {
      t = JSON.parse(opt.add);
    } catch (err) {
      console.error(`✗ --add 的 JSON 不合法：${err.message}`);
      process.exitCode = 2;
      return;
    }
  } else if (typeof opt['add-file'] === 'string') {
    t = JSON.parse(fs.readFileSync(opt['add-file'], 'utf8'));
  } else {
    console.error('用法：--add \'<json>\' | --add-file <path>');
    process.exitCode = 2;
    return;
  }
  t.id = t.id || nextId();
  if (!/^T-\d{4}$/.test(t.id)) {
    console.error(`✗ id 必须是 T-\\d{4}：${t.id}`);
    process.exitCode = 2;
    return;
  }
  if (fs.existsSync(path.join(DIR, t.id))) {
    console.error(`✗ ${t.id} 已存在（要改请用 --edit / --set-status）`);
    process.exitCode = 1;
    return;
  }
  t.type = t.type ?? 'req';
  t.status = t.status ?? 'open';
  t.priority = t.priority ?? 'P2';
  t.history = t.history ?? [{ at: today(), kind: 'created', what: '创建' }];
  writeTicket(t, { notes: typeof opt.note === 'string' ? opt.note : undefined });
  console.log(`✅ 建单 ${t.id} → tickets/${t.id}/ticket.json${opt.note ? ' + notes.md' : ''}`);
  console.log('   下一步：node scripts/build-tickets.mjs（刷新看板）');
}

function cmdEdit() {
  const id = opt.edit;
  const t = readTicket(id);
  if (t.error) {
    console.error(`✗ ${id}：${t.error}`);
    process.exitCode = 1;
    return;
  }
  if (opt.set.length === 0 && opt.setJson.length === 0) {
    console.error('用法：--edit <ID> --set a.b=值 [--set-json a.b=\'<json>\']');
    process.exitCode = 2;
    return;
  }
  const before = clone(t);
  for (const kv of opt.set) {
    const i = kv.indexOf('=');
    if (i < 0) {
      console.error(`✗ --set 要用 k=v：${kv}`);
      process.exitCode = 2;
      return;
    }
    const k = kv.slice(0, i);
    const raw = kv.slice(i + 1);
    setPath(t, k, raw === 'true' ? true : raw === 'false' ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw);
  }
  for (const kv of opt.setJson) {
    const i = kv.indexOf('=');
    if (i < 0) {
      console.error(`✗ --set-json 要用 k=<json>：${kv}`);
      process.exitCode = 2;
      return;
    }
    const k = kv.slice(0, i);
    let val;
    try {
      val = JSON.parse(kv.slice(i + 1));
    } catch (err) {
      console.error(`✗ --set-json 的 ${k} 值不是合法 JSON：${err.message}`);
      process.exitCode = 2;
      return;
    }
    setPath(t, k, val);
  }
  const changed = Object.keys(t).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(before[k]));
  // ★2026-09 文档模型：**没有 `--note` 就不记 history**。
  //   此前每次 `--edit` 都追加一条 `改字段：evidence` 这类字段 diff ⇒ 全库 515 条 history 里 262 条是零信息噪音
  //   （占体积 92% 的工具条目）。字段级 diff 由版本控制负责，history 只记**有说明的范围级事件**。
  if (typeof opt.note === 'string' && opt.note.trim()) {
    t.history = [...(t.history ?? []), { at: today(), kind: 'scope', what: `改字段：${changed.join(', ')} —— ${opt.note}` }];
  }
  writeTicket(t);
  console.log(`✅ 改单 ${id}（${changed.join(', ')}）${typeof opt.note === 'string' ? '' : '（未给 --note ⇒ 不记 history）'}`);
}

function cmdSetStatus() {
  const id = opt['set-status'];
  const t = readTicket(id);
  if (t.error) {
    console.error(`✗ ${id}：${t.error}`);
    process.exitCode = 1;
    return;
  }
  const status = pos[0];
  if (!STATUSES.includes(status)) {
    console.error(`✗ status 必须在 ${STATUSES.join('/')}：${status}`);
    process.exitCode = 2;
    return;
  }
  const from = t.status;
  t.status = status;
  if (status === 'dropped' && typeof opt.note === 'string' && !t.droppedWhy) t.droppedWhy = opt.note;
  t.history = [...(t.history ?? []), { at: today(), kind: 'status', what: `${from} → ${status}${typeof opt.note === 'string' ? ` —— ${opt.note}` : ''}` }];
  writeTicket(t);
  console.log(`✅ ${id}: ${from} → ${status}`);
}

/** 往过程文档追加一条（`changes.md` 用它记"第 N 次变更"）。 */
function cmdNote() {
  const id = opt.note;
  const dir = path.join(DIR, id);
  if (!fs.existsSync(dir)) {
    console.error(`✗ 没有这张票：${id}`);
    process.exitCode = 1;
    return;
  }
  const file = typeof opt.file === 'string' ? opt.file : 'notes.md';
  if (!file.endsWith('.md')) {
    console.error(`✗ --file 只能是 .md（过程文档）：${file}`);
    process.exitCode = 2;
    return;
  }
  const text = typeof opt.text === 'string' ? opt.text : pos[0];
  if (!text) {
    console.error("用法：--note <ID> --file changes.md --text '…'");
    process.exitCode = 2;
    return;
  }
  const f = path.join(dir, file);
  if (!fs.existsSync(f)) writeFileAtomic(f, `# ${id} · 过程文档（${file}）\n`);
  appendFile(f, `\n## ${today()}\n\n${text.trimEnd()}\n`);
  console.log(`✅ 追加到 tickets/${id}/${file}`);
}

/**
 * `--anchors-in <文件>`：谁锚在这个文件上（**只读**）。
 * 改任何"被锚定的文件"（源码注释、机制文档表格行都算）之前先跑它。
 */
function cmdAnchorsIn(target) {
  const hits = [];
  for (const dir of ticketDirs()) {
    const t = readTicket(dir);
    if (t.error) continue;
    for (const [i, ev] of (Array.isArray(t.evidence) ? t.evidence : []).entries()) {
      if (!ev || typeof ev.file !== 'string' || !pathMatches(ev.file, target)) continue;
      const note = typeof ev.note === 'string' ? `  note=${JSON.stringify(ev.note)}` : '';
      const line = typeof ev.line === 'number' ? `  line=${ev.line}` : '';
      hits.push(`${t.id}  evidence[${i}]  anchor=${JSON.stringify(ev.anchor ?? null)}${line}${note}`);
    }
  }
  for (const h of hits) console.log(h);
  if (!hits.length) console.log('（无）');
  console.log(`\n（${hits.length} 条）`);
}

/**
 * `--recount`：重算账目并打 before/after diff。
 *
 * ★与另两个台账不同：票据真源 `tickets/<ID>/ticket.json` **没有 `counts` 字段**（票的 schema 里
 *   不存在这个键，`--validate`/守卫也不查它）—— 票据的"统计"是**生成物** `tickets/README.md`
 *   概览行里的那几个数，持有者是 `scripts/build-tickets.mjs`。所以这里**只读**重算 + 与看板对账，
 *   不写任何文件；看板陈旧时的修法是 `node scripts/build-tickets.mjs`。
 */
function cmdRecount() {
  const after = { total: 0 };
  for (const s of STATUSES) after[s] = 0;
  for (const t of allTickets()) {
    if (t.error) continue;
    after.total++;
    if (after[t.status] !== undefined) after[t.status]++;
  }
  const before = boardCountsFromReadme();
  if (!before) {
    console.log('counts: 无法从 tickets/README.md 读出概览（尚未生成看板）');
  } else {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const diffs = keys.filter((k) => before[k] !== after[k]);
    if (diffs.length === 0) console.log('counts: 无变化');
    else for (const k of diffs) console.log(`counts: ${k} ${before[k]} → ${after[k]}`);
  }
  console.log('[next] 票据账目在看板上：node scripts/build-tickets.mjs');
}

/** 从生成物 `tickets/README.md` 的概览行里读出账目（票据真源不含 counts）。 */
function boardCountsFromReadme() {
  const f = path.join(DIR, 'README.md');
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8');
  const m = /共 \*\*(\d+)\*\* 张/.exec(text);
  if (!m) return null;
  const out = { total: Number(m[1]) };
  for (const s of STATUSES) {
    const r = new RegExp(`${s} \\*\\*(\\d+)\\*\\*`).exec(text);
    if (r) out[s] = Number(r[1]);
  }
  return out;
}

function cmdRm() {
  const id = opt.rm;
  const dir = path.join(DIR, id);
  if (!fs.existsSync(dir)) {
    console.error(`✗ 没有这张票：${id}`);
    process.exitCode = 1;
    return;
  }
  if (opt.yes !== true) {
    console.error(`✗ 删单会删掉整个 tickets/${id}/（含过程文档）：确认请加 --yes；想保留历史请改 status=dropped`);
    process.exitCode = 2;
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`✅ 已删 tickets/${id}/（记得重跑 build-tickets.mjs）`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

if (opt.validate) {
  const { problems, warnings } = validate();
  for (const w of warnings) console.log(`⚠ ${w}`);
  if (problems.length) {
    for (const p of problems) console.log(`✗ ${p}`);
    console.log(`\n✗ 票据自检未通过（${problems.length} 条）`);
    process.exitCode = 1;
  } else {
    const n = ticketDirs().length;
    console.log(`✅ 票据自检通过（${n} 张${warnings.length ? `，${warnings.length} 条警告` : ''}）`);
  }
} else if (opt['next-id']) {
  console.log(nextId());
} else if (opt.recount) {
  cmdRecount();
} else if (opt['anchors-in'] !== undefined) {
  cmdAnchorsIn(opt['anchors-in']);
} else if (opt.add !== undefined || opt['add-file'] !== undefined) {
  cmdAdd();
} else if (opt.edit !== undefined) {
  cmdEdit();
} else if (opt['set-status'] !== undefined) {
  cmdSetStatus();
} else if (opt.note !== undefined) {
  cmdNote();
} else if (opt.rm !== undefined) {
  cmdRm();
} else if (opt.show !== undefined) {
  cmdShow(opt.show);
} else if (opt.stats && !opt.list) {
  cmdStats();
} else if (opt.graph) {
  cmdGraph();
} else if (opt.list) {
  cmdList();
} else {
  cmdStats();
  console.log('');
  cmdList();
}
