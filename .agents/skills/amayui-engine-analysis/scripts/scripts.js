#!/usr/bin/env node
/**
 * scripts.js —— 「脚本台账」（`analysis/scripts.json`）的**查询 + 增删改 + 自检**工具。
 *
 * 台账是数据层的**第三层**：
 *  - 第一层 `functions.json`/`fields.json`：某个函数/偏移**是什么**；
 *  - 第二层 `engine-capabilities.json`：引擎有哪些**持续行为**（枚举 opcode 看不出来）；
 *  - **第三层（本层）**：`src/*.txt` 里每个**被分析过的游戏脚本**长什么样 ——
 *    它是什么、谁调它、内部结构（label + 行区间 + 职责）、关键槽、不变量、坑、缺口、
 *    以及它对应的引擎结论（能力 id / 函数地址 / 主题文档）。
 *
 * 为什么要单列一层（教训）：脚本层的知识（"设置界面的可见项表是 36df/179f/273f 三数组，
 * 靠 i12f 排序，切分类是退出重入"）既不是函数语义、也不是引擎常态行为，
 * 以前只散在代码注释与主题文档里 ⇒ 下次为了同一个界面再读一遍 3000 行反汇编。
 *
 * 查询（只读）：
 *   node scripts.js [root]                    # 统计 + 覆盖率 + 全部条目索引
 *   node scripts.js --summary                 # 只打统计 + 覆盖率
 *   node scripts.js --index [--status partial]
 *   node scripts.js --coverage                # 列出**尚未登记**的 src/*.txt（提醒还有哪些没看）
 *   node scripts.js --find <子串>              # 按 id/role/entry/slots/notes 模糊查
 *   node scripts.js --id <ID>                 # 精查单条（含 layout/slots 明细）
 *   node scripts.js --validate                # 离线自检（= test/script-ledger.test.ts 的规则）
 *   node scripts.js --anchors-in <文件>        # 谁锚在这个文件上（layout[].anchor / 其 file 命中）
 *
 * 写入（写入后自动重算 counts，并提示重生成 md）：
 *   node scripts.js --add '<json>'
 *   node scripts.js --edit <ID> --set k=v [--set k=v ...]     # 支持点路径
 *   node scripts.js --edit <ID> --set-json k=<json> [--set-json ...]   # 值按 JSON 解析，绕过逗号切分
 *   node scripts.js --recount                 # 只重算 counts 并原子写回（就地修"陈旧 counts"）
 *   node scripts.js --rm <ID>
 *
 * ★值里带 ASCII 引号/逗号的结构化值（layout/slots）请用 `--set-json`（或 `--add` 整条 json）；
 * `--set-json` 的解析失败会**响亮失败**（非零退出）并点名 key。
 *
 * 硬性约定（与 test/script-ledger.test.ts 一致，本工具 `--validate` 会替你查）：
 *  1. `file` 必须真实存在；每条 `layout[].lines` 形如 `"1136-1228"` 且落在文件行数内；
 *  2. 每条 `layout[].anchor` 必须**真的出现在该行区间内**（防编造、防反汇编重排后行号漂移）；
 *  3. `status` 在枚举内；`guards[]` 指向的测试文件真实存在（相对 `app/amayui-emulator`）；
 *  4. `links.capabilities[]` 必须是 `analysis/engine-capabilities.json` 里存在的 id；
 *     `links.functions[]` 必须是 `analysis/functions.json` 里存在的 addr。
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const VALUE_FLAGS = new Set([
  // ★这里只放**带值**的开关；`--coverage/--summary/--index/--validate/--recount` 是布尔开关，
  // 放进来会让它们把下一个参数当自己的值吃掉（`--coverage` 单独用会静默退化成默认报表）。
  '--find', '--id', '--status', '--sort',
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
const FILE = path.join(root, 'analysis', 'scripts.json');
const CAPS = path.join(root, 'analysis', 'engine-capabilities.json');
const FUNCS = path.join(root, 'analysis', 'functions.json');
const SRC = path.join(root, 'src');
const APP_DIR = path.join(root, 'app', 'amayui-emulator');
// ★`tickets/T-0130`：守卫规格（`file#anchor`）的规则实现只有一份 —— `scripts/lib/guard-spec.cjs`
// ★相对**工具自身**定位（不是 `--root`）：规则实现是工具代码，不是台账数据 ——
//   `agent-workflow.test.ts` 会用 `--root <临时目录>` 跑这些工具，那里没有 scripts/lib。
const { checkGuard } = require(path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lib', 'guard-spec.cjs'));

const STATUS_MARK = { analyzed: '✅ 已分析', partial: '🟠 部分', stub: '⚪ 仅登记' };

function load() {
  if (!fs.existsSync(FILE)) { console.error(`[err] 台账不存在：${FILE}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
/** 原子写：同目录 tmp + `renameSync`（并发读者不会看到被截断的文件）。 */
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
  console.log('[next] 重生成人可读文档：node scripts/build-scripts.mjs');
}
function recount(doc) {
  const by = (s) => doc.entries.filter((e) => e.status === s).length;
  const counts = { total: doc.entries.length };
  for (const k of Object.keys(doc.statusEnum)) counts[k] = by(k);
  doc.counts = counts;
}
/** 磁盘上的 src/*.txt 列表（覆盖率的分母）。 */
function srcFiles() {
  if (!fs.existsSync(SRC)) return [];
  return fs.readdirSync(SRC).filter((f) => f.endsWith('.txt')).sort();
}
function parseKv(raws) {
  const out = {};
  for (const raw of raws) {
    const eq = raw.indexOf('=');
    if (eq < 0) { console.warn(`[warn] 忽略非 k=v：${raw}`); continue; }
    const k = raw.slice(0, eq).trim();
    const v = raw.slice(eq + 1);
    let val;
    if (v === 'true') val = true;
    else if (v === 'false') val = false;
    else if (/^-?\d+$/.test(v)) val = Number(v);
    else val = v; // ★本层不用逗号拆数组：layout/slots 是结构化数组，用 --edit 的 json 形式改
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
/** `--set-json k=<json>`：值整体按 JSON 解析（不按 ASCII 逗号切分）；解析失败点名 key 并非零退出。 */
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

// ===================== 锚点反查（--anchors-in） =====================
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
/** `--anchors-in <文件>`：谁锚在这个文件上（只读）。 */
function cmdAnchorsIn(doc, target) {
  const hits = [];
  for (const e of doc.entries) {
    // ① 该条目的真源 `file` 就是被问的文件 ⇒ 它的 layout 行区间**全都在读这个文件**；
    // ② 或某条 anchor 的字面串本身指向被问的文件（锚点也可以是别的文件里的串）。
    const byFile = e.file && pathMatches(e.file, target);
    for (const [i, l] of (e.layout ?? []).entries()) {
      if (!byFile && !(l.anchor && pathMatches(l.anchor, target))) continue;
      const what = l.what ? `  what=${JSON.stringify(l.what)}` : '';
      hits.push(`${e.id}  layout[${i}]  lines=${l.lines}  anchor=${JSON.stringify(l.anchor)}${what}`);
    }
  }
  for (const h of hits) console.log(h);
  if (!hits.length) console.log('（无）');
  console.log(`\n（${hits.length} 条）`);
}

// ===================== 校验 =====================
/** 行区间 "a-b" → [a,b]；不合法返回 null。 */
function parseRange(s) {
  const m = /^(\d+)-(\d+)$/.exec(String(s ?? ''));
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= b ? [a, b] : null;
}
/** 返回 {problems, stale}（problems 空 = 通过）。规则与 test/script-ledger.test.ts 一致。 */
function validate(doc, diskCounts) {
  const problems = [];
  const ids = new Set();
  const caps = fs.existsSync(CAPS) ? JSON.parse(fs.readFileSync(CAPS, 'utf8')).entries.map((e) => e.id) : [];
  const funcs = fs.existsSync(FUNCS) ? JSON.parse(fs.readFileSync(FUNCS, 'utf8')).map((e) => e.addr) : [];
  for (const e of doc.entries) {
    const at = (m) => problems.push(`${e.id}: ${m}`);
    if (!e.id) { at('缺 id'); continue; }
    if (ids.has(e.id)) at('id 重复');
    ids.add(e.id);
    if (!doc.statusEnum[e.status]) at(`status 非法（${e.status}）`);
    for (const k of ['role', 'entry', 'evidence']) if (!e[k]) at(`缺 ${k}`);
    if (!e.file) at('缺 file');
    const srcPath = path.join(root, e.file);
    let lines = [];
    if (!fs.existsSync(srcPath)) at(`file 不存在：${e.file}`);
    else lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
    for (const [i, l] of (e.layout ?? []).entries()) {
      const r = parseRange(l.lines);
      if (!r) { at(`layout[${i}].lines 应形如 "1136-1228"（实际 ${l.lines}）`); continue; }
      if (lines.length && r[1] > lines.length) at(`layout[${i}] 行区间超出文件行数（${r[1]} > ${lines.length}）`);
      if (!l.anchor) at(`layout[${i}] 缺 anchor`);
      else if (lines.length) {
        const slice = lines.slice(r[0] - 1, r[1]).join('\n');
        if (!slice.includes(l.anchor)) at(`layout[${i}].anchor 未出现在 ${l.lines} 行内：${JSON.stringify(l.anchor)}`);
      }
      if (!l.what) at(`layout[${i}] 缺 what`);
    }
    for (const [i, s] of (e.slots ?? []).entries()) {
      if (!s.key) at(`slots[${i}] 缺 key`);
      if (!s.what) at(`slots[${i}] 缺 what`);
    }
    // ★`tickets/T-0130`：文件存在 → **用例存在**（`test/x.test.ts#<用例名片段>`）；
    //   规则实现只有一份：`scripts/lib/guard-spec.mjs`。
    for (const g of e.guards ?? []) {
      const why = checkGuard(APP_DIR, g);
      if (why) at(`guard 指向的用例不存在：${g}（${why}）`);
    }
    for (const c of e.links?.capabilities ?? []) {
      if (caps.length && !caps.includes(c)) at(`links.capabilities 里的 id 不存在：${c}`);
    }
    for (const f of e.links?.functions ?? []) {
      if (funcs.length && !funcs.includes(f)) at(`links.functions 里的 addr 不存在：${f}`);
    }
  }
  // ★与**磁盘上的** counts 比（不是与刚重算出来的比 —— 那样永远相等，查不出陈旧 counts）。
  const before = diskCounts || {};
  const by = (s) => doc.entries.filter((e) => e.status === s).length;
  let stale = false;
  for (const k of Object.keys(doc.statusEnum)) {
    if (before[k] !== by(k)) { problems.push(`counts.${k} 应为 ${by(k)}（实际 ${before[k]}）`); stale = true; }
  }
  if (before.total !== doc.entries.length) {
    problems.push(`counts.total 应为 ${doc.entries.length}（实际 ${before.total}）`);
    stale = true;
  }
  return { problems, stale };
}

/** `--recount`：只重算 counts 并原子写回（"手改过 JSON ⇒ counts 陈旧"的一键修复）。 */
function cmdRecount(doc, diskCounts) {
  const beforeCounts = diskCounts || {};
  recount(doc);
  const keys = [...new Set([...Object.keys(beforeCounts), ...Object.keys(doc.counts)])];
  const diffs = keys.filter((k) => beforeCounts[k] !== doc.counts[k]);
  if (diffs.length === 0) console.log('counts: 无变化');
  else for (const k of diffs) console.log(`counts: ${k} ${beforeCounts[k]} → ${doc.counts[k]}`);
  save(doc);
}

// ===================== 查询 =====================
function unregistered(doc) {
  const known = new Set(doc.entries.map((e) => e.file.replace(/^src[\\/]/, '')));
  return srcFiles().filter((f) => !known.has(f));
}
function printSummary(doc) {
  const total = srcFiles().length;
  console.log(`脚本台账：${doc.entries.length} 条  |  src/*.txt 共 ${total} 个 ⇒ 已登记 ${doc.entries.length}（${total ? Math.round((doc.entries.length / total) * 100) : 0}%）`);
  console.log('状态：' + Object.keys(doc.statusEnum).map((k) => `${k}:${doc.counts[k] ?? 0}`).join('  '));
  console.log('（覆盖率只是"看过哪些"的提醒，不要求凑数登记：**没读过的脚本不登记**，宁可空着）');
}
function cmdCoverage(doc) {
  const un = unregistered(doc);
  console.log(`未登记 ${un.length} / ${srcFiles().length} 个 src/*.txt：`);
  for (const f of un) console.log(`  ${f}`);
}
function line(e) {
  const n = (e.layout ?? []).length;
  const s = (e.slots ?? []).length;
  return `${STATUS_MARK[e.status] || e.status}  ${e.id.padEnd(12)} ${String(e.bin).padEnd(18)} 段=${String(n).padStart(2)} 槽=${String(s).padStart(2)}  ${e.role.slice(0, 60)}`;
}
function cmdIndex(doc) {
  const list = doc.entries.filter((e) => !opt.status || e.status === opt.status);
  for (const e of list) console.log(line(e));
  console.log(`（${list.length} 条）`);
}
function cmdFind(doc, q) {
  const hit = doc.entries.filter((e) => JSON.stringify(e).includes(q));
  for (const e of hit) console.log(line(e));
  console.log(`（命中 ${hit.length} 条）`);
}

// ===================== 主流程 =====================
const doc = load();
// ★留一份"磁盘上的 counts"再重算：`--recount` 要打 before/after，`--validate` 要据此判陈旧。
const countsOnDisk = doc.counts && typeof doc.counts === 'object' ? JSON.parse(JSON.stringify(doc.counts)) : null;
if (opt.validate) {
  const { problems, stale } = validate(doc, countsOnDisk);
  if (problems.length) {
    console.error(`[fail] 脚本台账自检未通过：\n  - ${problems.join('\n  - ')}`);
    if (stale) console.error('[next] counts 陈旧 ⇒ 跑 --recount 后重跑 build-*.mjs');
    process.exit(1);
  }
  console.log(`[ok] 台账自检通过（${doc.entries.length} 条）`);
} else if (opt.recount) {
  cmdRecount(doc, countsOnDisk);
} else if (opt['anchors-in']) {
  cmdAnchorsIn(doc, opt['anchors-in']);
} else if (opt.coverage) {
  cmdCoverage(doc);
} else if (opt.summary) {
  printSummary(doc);
} else if (opt.index) {
  cmdIndex(doc);
} else if (opt.find) {
  cmdFind(doc, opt.find);
} else if (opt.id) {
  const e = doc.entries.find((x) => x.id === opt.id);
  if (!e) { console.error(`[err] 没有 id=${opt.id}`); process.exit(1); }
  console.log(JSON.stringify(e, null, 2));
} else if (opt.add) {
  const obj = JSON.parse(opt.add);
  if (!obj.id) { console.error('[err] --add 需要 id'); process.exit(1); }
  if (doc.entries.some((e) => e.id === obj.id)) { console.error(`[err] 已存在 id ${obj.id}，用 --edit`); process.exit(1); }
  doc.entries.push(obj);
  save(doc);
} else if (opt.edit) {
  const e = doc.entries.find((x) => x.id === opt.edit);
  if (!e) { console.error(`[err] 没有 id=${opt.edit}`); process.exit(1); }
  deepMerge(e, parseKv(opt.set));
  if (opt.setJson.length) deepMerge(e, parseKvJson(opt.setJson));
  save(doc);
} else if (opt.rm) {
  const i = doc.entries.findIndex((x) => x.id === opt.rm);
  if (i < 0) { console.error(`[err] 没有 id=${opt.rm}`); process.exit(1); }
  doc.entries.splice(i, 1);
  save(doc);
} else {
  printSummary(doc);
  console.log('');
  cmdIndex(doc);
}
