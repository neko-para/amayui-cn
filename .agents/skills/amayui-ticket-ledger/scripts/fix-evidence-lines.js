#!/usr/bin/env node
/**
 * fix-evidence-lines.js —— **刷新票据 `evidence[].line`**（锚点棘轮的维保工具）。
 *
 * 为什么要有它：`tickets/<ID>/ticket.json` 的 `evidence[].anchor` 是**跨 agent 的 ABI**（要求那个文件里
 * 存在那个字面串），而 `line` 只是"当初它长在哪"的**缓存**。代码一重构 / 反编译换版本 / 翻译 reflow，
 * 行号就整片漂移 —— 此时 `tickets.js --validate` 会给出 ±40 行之外的**警告**（不是失败），全库上百条
 * 靠手改不现实。本工具按**锚点串**在新文件里重新找位置，只改 `line`，**绝不改锚点**（串真的没了 ⇒ 报出来交人判）。
 *
 *   node fix-evidence-lines.js                 # dry-run（★缺省不写盘）
 *   node fix-evidence-lines.js --write         # 真的写回 ticket.json
 *   node fix-evidence-lines.js --any           # 范围扩到 app/**、src/**、docs-new/** 等全部被锚文件
 *   node fix-evidence-lines.js --check         # 只判"是否需要刷新"：需要 ⇒ exit 1（CI/收尾用）
 *   node fix-evidence-lines.js --root <dir>    # 换仓库根（缺省 = 本仓库）
 *   node fix-evidence-lines.js --pick T-0168:3=485   # ★多命中且**原本没写 line** 时，显式指定取哪一行（可重复）
 *
 * 纪律：
 *  ① **只改 `line`**：锚点串找不到时**只报告**（retarget 是人判的事，见三个技能的 §「锚点是跨 agent 的 ABI」）；
 *  ② 取行规则分两类：
 *     - **有旧 `line`（漂移）**：多命中时优先 `"id": "<anchor>"` 的定义行，否则取**离旧行号最近**的一次；
 *     - ★**没有旧 `line`（补全）**：**唯一命中**才自动补；**多命中一律不猜** —— 列成「待人选」
 *       （同一条锚点可能出现在语义不同的两处：审计报告 §4.1 的 finding 表 vs §4.6 的"被复核订正"表就是两个不同指称）
 *       ⇒ 要么用 `--pick` 显式指定，要么留空（留空无害：守卫只认锚点在文件里，`line` 只是 ±40 的提示）。
 *  ③ 未改动的票必须**逐字节 round-trip**（格式化例外会点名，不静默重排）；
 *  ④ 没写盘前谁都不动；`--check` 与写盘互斥（`--check` 隐含 dry-run）。
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (has('--help') || has('-h')) {
  console.log(`用法：node fix-evidence-lines.js [--root <dir>] [--any] [--pick T-xxxx:i=L]... [--write | --check]

  （缺省）    dry-run：只报告将要改哪些行号
  --write     真的写回 ticket.json
  --any       范围扩到全部被锚文件（缺省只修 analysis/ 下的台账真源）
  --pick      多命中且原本没写 line 的条目：显式指定取第 L 行（形如 T-0168:3=485，可重复）
  --check     需要刷新 ⇒ exit 1（不写盘）
  --root <dir> 仓库根（缺省 = 本仓库）`);
  process.exit(0);
}

// ★`--pick`：把"多命中且无旧行号"的选择**显式化**（工具不替人做语义判断）。
const picks = new Map();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--pick') continue;
  const v = argv[++i];
  const m = /^(T-\d+):(\d+)=(\d+)$/.exec(v ?? '');
  if (!m) {
    console.error(`✗ --pick 要写成 T-xxxx:<evidence 下标>=<行号>（收到 ${JSON.stringify(v)}）`);
    process.exit(2);
  }
  picks.set(`${m[1]}:${m[2]}`, Number(m[3]));
}

const HERE = __dirname;
const DEFAULT_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const ROOT = path.resolve(val('--root') || DEFAULT_ROOT);
const ANY = has('--any');
const CHECK = has('--check');
const DRY = !has('--write') || CHECK;

/**
 * 默认范围 = `analysis/`（六份真源的所在）；`--any` = 全部被锚文件。
 * 为什么默认不含 `src/**`：翻译 reflow 会**整片**移动行号（那属于脚本台账自己的
 * `layout[].lines` 棘轮），一次刷新上千条会把"真的需要人判的 retarget"淹掉。
 */
const inScope = (f) => {
  const n = String(f).replace(/\\/g, '/');
  if (!n || n.includes('\0')) return false;
  if (ANY) return true;
  return n.startsWith('analysis/') || n === 'analysis';
};

const cache = new Map();
function linesOf(rel) {
  if (!cache.has(rel)) {
    const abs = path.join(ROOT, rel);
    cache.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n') : null);
  }
  return cache.get(rel);
}

const TICKETS = path.join(ROOT, 'tickets');
if (!fs.existsSync(TICKETS)) {
  console.error(`✗ 找不到 ${TICKETS}（用 --root 指到仓库根）`);
  process.exit(2);
}

/** 某行往上找最近的 `##`/`###` 标题（报告里给出"这一处在哪一节"，便于人选）。 */
function headingOf(lines, n) {
  for (let i = Math.min(n, lines.length) - 1; i >= 0; i--) {
    if (/^#{2,3} /.test(lines[i])) return lines[i].trim();
  }
  return '（无标题）';
}

const dirs = fs.readdirSync(TICKETS).filter((d) => /^T-\d+$/.test(d)).sort();
let checked = 0;
let moved = 0;
let filled = 0;
let picked = 0;
const rewrites = [];
const fills = [];
const ambiguous = [];
const missing = [];
const pickErrors = [];
const usedPicks = new Set();
const outOfScopeFiles = new Set();

for (const d of dirs) {
  const rel = path.join('tickets', d, 'ticket.json');
  const abs = path.join(ROOT, rel);
  const raw = fs.readFileSync(abs, 'utf8');
  const t = JSON.parse(raw);
  let dirty = false;
  const evidence = Array.isArray(t.evidence) ? t.evidence : [];
  for (const [idx, ev] of evidence.entries()) {
    const file = ev && typeof ev.file === 'string' ? ev.file.replace(/\\/g, '/') : null;
    if (!file) continue;
    if (!inScope(file)) { outOfScopeFiles.add(file); continue; }
    if (typeof ev.anchor !== 'string' || !ev.anchor) continue;
    const lines = linesOf(file);
    if (!lines) {
      missing.push(`${t.id} [${file}] 文件不存在（锚点 ${JSON.stringify(ev.anchor.slice(0, 40))}）`);
      continue;
    }
    checked++;
    const hadLine = Number.isFinite(ev.line);
    const at = (n) => (n >= 1 && n <= lines.length ? lines[n - 1] : '');
    // ★"已经对得上就不动"这条捷径**只对有过 line 的条目成立**：没有 line 时没有基准，
    //   拿 0 当基准会把"锚点落在文件前 40 行"的条目误判成"已就位"而永远补不上（实测被守卫抓到）。
    if (hadLine) {
      let ok = false;
      for (let n = ev.line - 40; n <= ev.line + 40; n++) if (at(n).includes(ev.anchor)) { ok = true; break; }
      if (ok) continue;
    }
    const hits = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].includes(ev.anchor)) hits.push(i + 1);
    const key = `${t.id}:${idx}`;
    let to = null;
    let why = '';
    let kind = hadLine ? '漂移' : '补行号';
    if (hits.length === 1) {
      to = hits[0];
      if (picks.has(key)) {
        // 唯一命中时 --pick 是多余的，但若指了别的行就照指（人要覆盖工具）
        if (picks.get(key) !== hits[0]) { to = picks.get(key); why = `--pick 覆盖（唯一命中在 ${hits[0]}）`; }
        usedPicks.add(key);
      }
    } else if (hits.length > 1) {
      if (picks.has(key)) {
        const want = picks.get(key);
        usedPicks.add(key);
        if (!at(want).includes(ev.anchor)) {
          pickErrors.push(`${t.id} [${file}] --pick ${want} 那一行**不含**锚点（该锚点的候选行：${hits.join(', ')}）`);
          continue;
        }
        to = want;
        why = '--pick 指定';
        if (!hadLine) kind = '指定';
      } else if (hadLine) {
        // 有旧行号 ⇒ 用旧行号当基准是**有依据的**（当初就记在那一带）
        const def = hits.filter((n) => lines[n - 1].includes(`"id": "${ev.anchor}"`));
        if (def.length === 1) { to = def[0]; why = '多命中 ⇒ 取 id 定义行'; }
        else {
          const base = ev.line;
          to = hits.reduce((a, b) => (Math.abs(b - base) < Math.abs(a - base) ? b : a), hits[0]);
          why = `多命中 ${hits.length} ⇒ 取离原行号最近者`;
        }
      } else {
        // ★无旧行号 + 多命中 ⇒ **不猜**：列成待人选（同一条串可能在语义不同的两处）
        ambiguous.push({ id: t.id, idx, file, anchor: ev.anchor, hits, headings: hits.map((n) => headingOf(lines, n)) });
        continue;
      }
    }
    if (to == null) {
      missing.push(`${t.id} [${file}] anchor=${JSON.stringify(ev.anchor.slice(0, 50))} 命中 0 次（原 line=${ev.line}）`);
      continue;
    }
    rewrites.push({ id: t.id, file, anchor: ev.anchor, from: ev.line, to, note: why, kind });
    if (hadLine) moved++;
    else if (kind === '指定') picked++;
    else { filled++; fills.push({ id: t.id, idx, file, anchor: ev.anchor, to }); }
    ev.line = to;
    dirty = true;
  }
  if (dirty) {
    const out = `${JSON.stringify(t, null, 2)}\n`;
    if (!DRY) fs.writeFileSync(abs, out, 'utf8');
  } else {
    const rt = `${JSON.stringify(t, null, 2)}\n`;
    if (rt !== raw) console.log(`（格式差异，未改动）${rel}`);
  }
}

const unusedPicks = [...picks.keys()].filter((k) => !usedPicks.has(k));

console.log(`范围：${ANY ? '全部被锚文件' : 'analysis/ 下的台账真源'}${outOfScopeFiles.size ? `（跳过范围外文件 ${outOfScopeFiles.size} 个；要看它们加 --any）` : ''}`);
console.log(
  `检查 ${checked} 条锚在范围内的证据：**漂移** ${moved} 条 · **补行号**（唯一命中，原本没写 line）${filled} 条 · ` +
  `**指定**（--pick）${picked} 条 · **待人选**（多命中且无旧行号）${ambiguous.length} 条`,
);
for (const r of rewrites) {
  console.log(`  [${r.kind}] ${r.id}: ${r.file} ${r.from ?? '(无)'} → ${r.to}  «${String(r.anchor).slice(0, 40)}»${r.note ? `  ${r.note}` : ''}`);
}
if (ambiguous.length) {
  console.log('\n★待人选：锚点命中多处、且这条证据**原本没写 line** ⇒ 工具不猜（同一条串可能在语义不同的两处）。');
  console.log('  读下面的候选与所属小节，决定后用 `--pick <T-xxxx>:<下标>=<行号>` 显式指定（可重复）；留空也无害（守卫只认锚点在不在文件里）。');
  for (const a of ambiguous) {
    console.log(`   - ${a.id} evidence[${a.idx}] ${a.file}  «${String(a.anchor).slice(0, 50)}»`);
    a.hits.forEach((n, i) => console.log(`       ${String(n).padStart(6)} 行  ${a.headings[i]}`));
  }
}
if (unusedPicks.length) {
  console.log(`\n⚠ 未被使用的 --pick（拼错了？）：${unusedPicks.join(', ')}`);
}
if (pickErrors.length) {
  console.log('\n✗ --pick 指向的行不含该锚点（**拒绝**，未写那条）：');
  for (const m of pickErrors) console.log('   - ' + m);
}
if (missing.length) {
  console.log('\n⚠ 锚点串已不在文件里（★需人判 retarget —— 本工具**不改**锚点，也不删证据）：');
  for (const m of missing) console.log('   - ' + m);
} else {
  console.log('\n无失效锚点');
}
if (filled || picked) {
  console.log(`（这 ${filled + picked} 条是**补全**、不是回归 ⇒ 不构成 --check 失败${DRY ? '，加 --write 落盘' : ''}）`);
}
console.log(
  DRY
    ? `（dry-run：未写盘${CHECK ? `；--check 的判据 = 漂移 ${moved} / 失效锚点 ${missing.length}` : '；加 --write 落盘'}）`
    : '✅ 已写回 ticket.json（记得重跑 node scripts/build-tickets.mjs 与 tickets.js --validate）',
);

// ★`--check` 的判据只有两条：**真漂移**（写过 line 却对不上）与**失效锚点**（串没了）。
//   "原本没写 line"（补全/待人选）不算失败 —— 那是补全，不是回归。
//   `--pick` 用不上（拼错/指错行）要**响亮失败**：那是人的显式指令没被兑现，不能静默咽下。
if (unusedPicks.length || pickErrors.length) process.exitCode = 1;
if (CHECK && (moved > 0 || missing.length > 0)) process.exitCode = 1;
