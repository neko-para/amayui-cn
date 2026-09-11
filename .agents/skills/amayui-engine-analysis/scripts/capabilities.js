#!/usr/bin/env node
/**
 * capabilities.js —— 「常态能力台账」（`analysis/engine-capabilities.json`）的**查询 + 增删改**工具。
 *
 * 台账是数据层的**第二层**：第一层 `functions.json`/`fields.json` 回答「这个函数/偏移是什么」；
 * 台账回答「引擎有哪些**持续行为**」—— 逐帧流程 / 门控标志 / 惰性创建 / 转场 / 资源生命周期。
 * 这类能力**枚举 opcode 看不出来**，缺失时**不报错、只表现不对**。
 *
 * 查询（只读）：
 *   node capabilities.js [root]                        # 统计 + 全部条目索引
 *   node capabilities.js --summary                     # 只打统计（状态/子系统/证据分布）
 *   node capabilities.js --index [--subsystem 消息窗] [--status absent] [--evidence E0]
 *   node capabilities.js --attention                   # 只看"需要关注"（非 n/a 且非已核验）
 *   node capabilities.js --find <子串>                  # 按 id/name/trigger/fns/reads/note 模糊查
 *   node capabilities.js --id <id>                     # 精查单条（含全部字段）
 *   node capabilities.js --validate                    # 离线自检（= test/capability-ledger.test.ts 的规则）
 *
 * 写入（写入后自动重算 counts，并提示重生成 md）：
 *   node capabilities.js --add '<json>'
 *   node capabilities.js --edit <id> --set k=v [--set k=v ...]      # 支持点路径
 *   node capabilities.js --rm <id>
 *
 * `--set` 键支持点路径：`emulator.status=partial`、`engine.raw=20788-20890`、`engine.fns=a,b`、
 * `reads=Engine+699204,Engine+122455`。无引号值按布尔/数字自动解析，其余为字符串（含逗号则拆数组）。
 *
 * 硬性约定（与 test/capability-ledger.test.ts 一致，本工具 `--validate` 会替你查）：
 *  1. 声称 E2/E3 必须给 `emulator.guard`，且该文件**真实存在**（相对 app/amayui-emulator）；
 *  2. `n/a-known` 必须在 `emulator.note` 里写 `why:`（不许用 n/a 掩盖缺口）；
 *  3. 每条都要写 `whySilent`（缺了它"为什么静默"这个问题就没答案，台账也就失去意义）。
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const VALUE_FLAGS = new Set([
  '--find', '--id', '--subsystem', '--status', '--evidence', '--sort',
  '--add', '--edit', '--set', '--rm', '--root',
]);
function parseOpt(argv) {
  const o = { set: [] };
  let rootVal = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') { o.set.push(argv[++i]); continue; }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (VALUE_FLAGS.has(a)) o[k] = argv[++i];
      else o[k] = true;
      continue;
    }
    if (!rootVal) rootVal = a;
  }
  return { o, rootVal };
}
const { o: opt, rootVal } = parseOpt(process.argv.slice(2));
const root = (typeof opt.root === 'string' ? opt.root : null) || rootVal || '.';
const FILE = path.join(root, 'analysis', 'engine-capabilities.json');
const APP_DIR = path.join(root, 'app', 'amayui-emulator');

const STATUS_MARK = {
  'modeled-verified': '✅ 已核验',
  'modeled-unverified': '🟡 已建模未核验',
  partial: '🟠 部分',
  absent: '❌ 缺失',
  'n/a-known': '➖ n/a',
};

function load() {
  if (!fs.existsSync(FILE)) { console.error(`[err] 台账不存在：${FILE}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
function save(doc) {
  recount(doc);
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`[ok] 已写 ${FILE}`);
  console.log('[next] 重生成人可读报表：node scripts/build-capabilities.mjs');
}
function recount(doc) {
  const by = (s) => doc.entries.filter((e) => e.emulator.status === s).length;
  const counts = { total: doc.entries.length };
  for (const k of Object.keys(doc.statusEnum)) counts[k] = by(k);
  counts.needsAttention = doc.entries.filter(
    (e) => e.emulator.status !== 'n/a-known' && e.emulator.status !== 'modeled-verified',
  ).length;
  doc.counts = counts;
}
function parseKv(raws) {
  const out = {};
  for (const raw of raws) {
    const eq = raw.indexOf('=');
    if (eq < 0) { console.warn(`[warn] 忽略非 k=v：${raw}`); continue; }
    const k = raw.slice(0, eq).trim();
    let v = raw.slice(eq + 1);
    let val;
    if (v === 'true') val = true;
    else if (v === 'false') val = false;
    else if (/^-?\d+$/.test(v)) val = Number(v);
    else if (v.includes(',')) val = v.split(',').map((s) => s.trim()).filter(Boolean);
    else val = v;
    // 点路径
    const parts = k.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] = cur[parts[i]] || {});
    cur[parts[parts.length - 1]] = val;
  }
  return out;
}
function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = deepMerge(a[k] || {}, v);
    else a[k] = v;
  }
  return a;
}

// ===================== 查询 =====================
function line(e) {
  return `${STATUS_MARK[e.emulator.status] || e.emulator.status}  ${e.emulator.evidence}  ${e.id.padEnd(42)} ${e.subsystem.padEnd(5)} ${e.name}`;
}
function printSummary(doc) {
  console.log(`台账：${doc.counts.total} 条  |  需要关注（非 n/a 且非已核验）= ${doc.counts.needsAttention}`);
  const by = (f) => {
    const m = new Map();
    for (const e of doc.entries) m.set(f(e), (m.get(f(e)) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log('状态：' + by((e) => e.emulator.status).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log('证据：' + by((e) => e.emulator.evidence).sort().map(([k, v]) => `${k}:${v}`).join('  '));
  console.log('子系统：' + by((e) => e.subsystem).map(([k, v]) => `${k}:${v}`).join('  '));
}
function printIndex(doc, rows) {
  const sort = opt.sort || 'status';
  const key = {
    status: (e) => Object.keys(doc.statusEnum).indexOf(e.emulator.status) * 100000 + (e.subsystem || '').localeCompare(''),
    subsystem: (e) => (e.subsystem + e.id),
    id: (e) => e.id,
    evidence: (e) => e.emulator.evidence + e.id,
  }[sort];
  for (const e of [...rows].sort(key)) console.log(line(e));
}
function detail(e) {
  console.log(`id        : ${e.id}`);
  console.log(`子系统     : ${e.subsystem}`);
  console.log(`能力      : ${e.name}`);
  console.log(`触发      : ${e.trigger}`);
  console.log(`缺失时静默 : ${e.whySilent}`);
  console.log(`引擎      : ${(e.engine?.fns || []).join(', ')} @ raw ${e.engine?.raw}`);
  if (e.reads?.length) console.log(`读的字段   : ${e.reads.join(', ')}`);
  console.log(`置信      : ${e.confidence}`);
  console.log(`emulator  : ${e.emulator.status} / ${e.emulator.evidence}${e.emulator.guard ? ` / guard=${e.emulator.guard}` : ''}`);
  console.log(`           ${e.emulator.note}`);
}
function validate(doc) {
  const errs = [];
  const ids = new Set();
  for (const e of doc.entries) {
    if (!e.id || ids.has(e.id)) errs.push(`id 重复/缺失：${e.id}`);
    ids.add(e.id);
    for (const k of ['subsystem', 'name', 'trigger', 'whySilent', 'confidence']) {
      if (typeof e[k] !== 'string' || !e[k]) errs.push(`${e.id} 缺 ${k}`);
    }
    if (!e.engine?.fns?.length) errs.push(`${e.id} 缺 engine.fns`);
    if (!/^(\d+)-(\d+)$/.test(e.engine?.raw || '')) errs.push(`${e.id} 的 engine.raw 应形如 "20788-20890"`);
    else {
      const [, a, b] = /^(\d+)-(\d+)$/.exec(e.engine.raw);
      if (Number(a) > Number(b)) errs.push(`${e.id} 的 raw 区间应 a<=b`);
    }
    if (!doc.statusEnum[e.emulator.status]) errs.push(`${e.id} status 非法：${e.emulator.status}`);
    if (!doc.evidenceEnum[e.emulator.evidence]) errs.push(`${e.id} evidence 非法：${e.emulator.evidence}`);
    if (e.emulator.guard && !fs.existsSync(path.join(APP_DIR, e.emulator.guard))) {
      errs.push(`${e.id} 的 guard 不存在：${e.emulator.guard}`);
    }
    if ((e.emulator.evidence === 'E2' || e.emulator.evidence === 'E3') && !e.emulator.guard) {
      errs.push(`${e.id} 声称 ${e.emulator.evidence} 却没有 guard`);
    }
    if (e.emulator.status === 'n/a-known' && !e.emulator.note.includes('why:')) {
      errs.push(`${e.id} 是 n/a-known，note 必须写 why:`);
    }
  }
  const before = doc.counts;
  recount(doc);
  for (const k of Object.keys(doc.statusEnum)) {
    if (before[k] !== doc.counts[k]) errs.push(`counts.${k} 过期：${before[k]} → ${doc.counts[k]}`);
  }
  if (before.total !== doc.counts.total) errs.push(`counts.total 过期：${before.total} → ${doc.counts.total}`);
  if (before.needsAttention !== doc.counts.needsAttention) {
    errs.push(`counts.needsAttention 过期：${before.needsAttention} → ${doc.counts.needsAttention}`);
  }
  if (errs.length) { console.error('[fail] 台账自检未通过：'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
  console.log(`[ok] 台账自检通过（${doc.entries.length} 条）`);
}

// ===================== main =====================
const doc = load();
recount(doc);

if (opt.add) {
  const entry = JSON.parse(String(opt.add));
  if (!entry.id) { console.error('[err] --add 需要 id'); process.exit(2); }
  if (doc.entries.some((e) => e.id === entry.id)) { console.error(`[err] id 已存在：${entry.id}`); process.exit(2); }
  doc.entries.push(entry);
  save(doc);
} else if (opt.edit) {
  const e = doc.entries.find((x) => x.id === opt.edit);
  if (!e) { console.error(`[err] 找不到 id：${opt.edit}`); process.exit(2); }
  if (!opt.set.length) { console.error('[err] --edit 需要至少一个 --set'); process.exit(2); }
  deepMerge(e, parseKv(opt.set));
  save(doc);
} else if (opt.rm) {
  const i = doc.entries.findIndex((x) => x.id === opt.rm);
  if (i < 0) { console.error(`[err] 找不到 id：${opt.rm}`); process.exit(2); }
  doc.entries.splice(i, 1);
  save(doc);
} else if (opt.validate) {
  validate(doc);
} else if (opt.id) {
  const e = doc.entries.find((x) => x.id === opt.id);
  if (!e) { console.error(`[err] 找不到 id：${opt.id}`); process.exit(2); }
  detail(e);
} else if (opt.find) {
  const q = String(opt.find).toLowerCase();
  const hit = doc.entries.filter((e) =>
    JSON.stringify(e).toLowerCase().includes(q),
  );
  for (const e of hit) detail(e);
  console.log(`\n（${hit.length} 条）`);
} else if (opt.attention) {
  printIndex(doc, doc.entries.filter((e) => e.emulator.status !== 'n/a-known' && e.emulator.status !== 'modeled-verified'));
  console.log(`\n（需要关注 ${doc.counts.needsAttention} 条）`);
} else if (opt.index) {
  let rows = doc.entries;
  if (opt.subsystem) rows = rows.filter((e) => e.subsystem === opt.subsystem);
  if (opt.status) rows = rows.filter((e) => e.emulator.status === opt.status);
  if (opt.evidence) rows = rows.filter((e) => e.emulator.evidence === opt.evidence);
  printIndex(doc, rows);
  console.log(`\n（${rows.length} 条）`);
} else if (opt.summary) {
  printSummary(doc);
} else {
  printSummary(doc);
  console.log('');
  printIndex(doc, doc.entries);
}
