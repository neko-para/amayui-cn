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
 *   node capabilities.js --anchors-in <文件>             # 本层没有锚点 ABI（只回答一句实话）
 *
 * （本层没有"锚点"ABI；跨 agent 的锚点查询见 `tickets.js --anchors-in` 与 `scripts.js --anchors-in`。）
 *
 * 写入（写入后自动重算 counts，并提示重生成 md）：
 *   node capabilities.js --add '<json>'
 *   node capabilities.js --edit <id> --set k=v [--set k=v ...]      # 支持点路径
 *   node capabilities.js --edit <id> --set-json k=<json> [--set-json ...]   # 值按 JSON 解析，绕过逗号切分
 *   node capabilities.js --recount                    # 只重算 counts 并原子写回（就地修"陈旧 counts"）
 *   node capabilities.js --rm <id>
 *
 * `--set` 键支持点路径：`emulator.status=partial`、`engine.raw=20788-20890`、`engine.fns=a,b`、
 * `reads=Engine+699204,Engine+122455`。无引号值按布尔/数字自动解析，其余为字符串（含逗号则拆数组）。
 * ★值里要写 ASCII 逗号又不想被拆成数组（例如 `emulator.note`）请用 `--set-json emulator.note='"a, b"'`；
 * `--set-json` 的值按 JSON 解析（字符串要带引号），多个 `--set-json` 与 `--set` 可混用。
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
  '--add', '--edit', '--set', '--set-json', '--anchors-in', '--rm', '--root',
]);
function parseOpt(argv) {
  const o = { set: [], setJson: [] };
  let rootVal = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') { o.set.push(argv[++i]); continue; }
    if (a === '--set-json') { o.setJson.push(argv[++i]); continue; }
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
// ★`tickets/T-0130`：守卫规格（`file#anchor`）的规则实现只有一份 —— `scripts/lib/guard-spec.cjs`
// ★相对**工具自身**定位（不是 `--root`）：规则实现是工具代码，不是台账数据 ——
//   `agent-workflow.test.ts` 会用 `--root <临时目录>` 跑这些工具，那里没有 scripts/lib。
const { checkGuard } = require(path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'guard-spec.cjs'));

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
/**
 * 原子写：同目录 tmp 文件 + `renameSync`（同文件系统内 rename 是原子的）。
 * 并发读者（守卫测试 / build-*.mjs）因此永远看不到被截断的 JSON。
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
function save(doc) {
  recount(doc);
  writeFileAtomic(FILE, JSON.stringify(doc, null, 2) + '\n');
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
/**
 * `--set-json k=<json>`：值整体按 JSON 解析（**不**按 ASCII 逗号切分）。
 * 解析失败**响亮失败**（非零退出）并点名是哪个 key —— 否则会静默写出错误类型的值。
 */
function parseKvJson(raws) {
  const out = {};
  for (const raw of raws) {
    const eq = raw.indexOf('=');
    if (eq < 0) { console.error(`[err] --set-json 要用 k=<json>：${raw}`); process.exit(2); }
    const k = raw.slice(0, eq).trim();
    let val;
    try {
      val = JSON.parse(raw.slice(eq + 1));
    } catch (err) {
      console.error(`[err] --set-json 的 ${k} 值不是合法 JSON：${err.message}`);
      process.exit(2);
    }
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
function validate(doc, diskCounts) {
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
    if (!e.emulator || typeof e.emulator !== 'object') {
      errs.push(`${e.id} 缺 emulator 对象`);
      continue;
    }
    // ★类型先于语义：`emulator.note` 必须是字符串。
    //   实测踩过：`capabilities.js --set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**，
    //   而旧版 validate 只查语义（只有 n/a-known 才读 note）⇒ 数组型 note 一路"校验通过"，
    //   直到 test/capability-ledger.test.ts 才炸。现在两处口径一致（值里要写逗号请用全角、或传 JSON 字符串）。
    if (typeof e.emulator.note !== 'string') {
      errs.push(
        `${e.id} 的 emulator.note 必须是字符串（当前 ${Array.isArray(e.emulator.note) ? '数组' : typeof e.emulator.note}）` +
          ' —— ★--set 会把值里的 ASCII 逗号当数组分隔符',
      );
    }
    if (!doc.statusEnum[e.emulator.status]) errs.push(`${e.id} status 非法：${e.emulator.status}`);
    if (!doc.evidenceEnum[e.emulator.evidence]) errs.push(`${e.id} evidence 非法：${e.emulator.evidence}`);
    // ★`tickets/T-0130`：文件存在 → **用例存在**（`test/x.test.ts#<用例名片段>`）。
    //   规则实现只有一份：`scripts/lib/guard-spec.mjs`（与 TS 侧的 test/guardAnchor.ts 同源）。
    if (e.emulator.guard) {
      const why = checkGuard(APP_DIR, e.emulator.guard);
      if (why) errs.push(`${e.id} 的 guard 不存在：${e.emulator.guard}（${why}）`);
    }
    if ((e.emulator.evidence === 'E2' || e.emulator.evidence === 'E3') && !e.emulator.guard) {
      errs.push(`${e.id} 声称 ${e.emulator.evidence} 却没有 guard`);
    }
    if (e.emulator.status === 'n/a-known' && typeof e.emulator.note === 'string' && !e.emulator.note.includes('why:')) {
      errs.push(`${e.id} 是 n/a-known，note 必须写 why:`);
    }
  }
  // ★与**磁盘上的** counts 比：`main` 会先把内存里的 counts 重算一遍，若拿重算后的值当基准，
  //   这条检查永远通过（陈旧 counts 就查不出来了）。
  const before = diskCounts || {};
  recount(doc);
  let stale = false;
  for (const k of Object.keys(doc.statusEnum)) {
    if (before[k] !== doc.counts[k]) { errs.push(`counts.${k} 过期：${before[k]} → ${doc.counts[k]}`); stale = true; }
  }
  if (before.total !== doc.counts.total) { errs.push(`counts.total 过期：${before.total} → ${doc.counts.total}`); stale = true; }
  if (before.needsAttention !== doc.counts.needsAttention) {
    errs.push(`counts.needsAttention 过期：${before.needsAttention} → ${doc.counts.needsAttention}`);
    stale = true;
  }
  if (errs.length) {
    console.error('[fail] 台账自检未通过：');
    for (const e of errs) console.error('  - ' + e);
    if (stale) console.error('[next] counts 陈旧 ⇒ 跑 --recount 后重跑 build-*.mjs');
    process.exit(1);
  }
  console.log(`[ok] 台账自检通过（${doc.entries.length} 条）`);
}

/** `--recount`：只重算 counts 并原子写回（"手改过 JSON ⇒ counts 陈旧"的一键修复）。 */
function cmdRecount(doc, diskCounts) {
  recount(doc);
  const before = diskCounts || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(doc.counts)])];
  const diffs = keys.filter((k) => before[k] !== doc.counts[k]);
  if (diffs.length === 0) console.log('counts: 无变化');
  else for (const k of diffs) console.log(`counts: ${k} ${before[k]} → ${doc.counts[k]}`);
  save(doc);
}

// ===================== main =====================
const doc = load();
// ★先留一份"磁盘上的 counts"再重算：`--recount` 要打 before/after，`--validate` 要据此判陈旧。
const countsOnDisk = doc.counts && typeof doc.counts === 'object' ? JSON.parse(JSON.stringify(doc.counts)) : null;
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
  if (!opt.set.length && !opt.setJson.length) { console.error('[err] --edit 需要至少一个 --set / --set-json'); process.exit(2); }
  deepMerge(e, parseKv(opt.set));
  if (opt.setJson.length) deepMerge(e, parseKvJson(opt.setJson));
  save(doc);
} else if (opt.recount) {
  cmdRecount(doc, countsOnDisk);
} else if (opt['anchors-in']) {
  // 本层（常态能力）**没有**锚点 ABI：条目锚在 raw 反编译行号上，不是别的文件里的字面串。
  // 保留这个开关只为让三个台账工具口径一致（被问到时给一句实话，而不是静默退化成默认报表）。
  console.log('（本层没有锚点 ABI：能力条目锚在 engine/*.c 的 raw 行号上）');
  console.log(' 跨 agent 锚点查询：tickets.js --anchors-in <文件> · scripts.js --anchors-in <文件>');
} else if (opt.rm) {
  const i = doc.entries.findIndex((x) => x.id === opt.rm);
  if (i < 0) { console.error(`[err] 找不到 id：${opt.rm}`); process.exit(2); }
  doc.entries.splice(i, 1);
  save(doc);
} else if (opt.validate) {
  validate(doc, countsOnDisk);
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
