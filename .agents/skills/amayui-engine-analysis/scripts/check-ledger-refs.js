#!/usr/bin/env node
/**
 * check-ledger-refs.js —— **台账正文里的 `文件:行` 引用体检**（只读；`tickets/T-0130` 的 `fix-evidence-lines.js` 的台账对应物）。
 *
 * 为什么要有它：`analysis/opcode-gaps.json` 的 `missing[].what` 与 `note`、以及
 * `analysis/engine-capabilities.json` 的 `emulator.note` 里大量引用 emulator **源码的 `文件:NNN`**。
 * 这些**不受任何棘轮保护** —— 代码一重构（哪怕只是在前面插 15 行）它们就静默指到别的东西，
 * 而三个校验器都只查"字段类型/枚举/守卫"，**从不查正文里的行号**。
 * 实测（2026-09-25 第 70 轮）：一次体检就查出 **16 处**漂移（msgwin 家族 11 处、`audioEngine` 2 处…），
 * 全是"读起来像真的、其实指错了"的那一类。
 *
 * 判据（保守，宁少报不误报）：
 *   取引用点**之前 60 字**里的反引号标识符（`` `styleOfWin` ``、`` `REPAINT_RUBY_RANGE` `` …，去掉 `.字段` 后缀）；
 *   - **区间引用**（`:N-M`）按 **N..M 整段**判（只看首行会造出假警报：`configRegistry.ts:69-73` 那种）；
 *   - **过于泛的标识符**（在目标文件里出现 > 8 次，如 `return`/`slot`）**不参与判定** —— 它们没有鉴别力；
 *   - 声明行（或区间）里**含**其中任一标识符 ⇒ 视为有效（不报）；
 *   - 声明行不含、但目标文件里**别处**有该标识符 ⇒ 报 `drift`，并给出**离原行号最近**的那一行 + 距离；
 *   - 目标文件里根本没有该标识符 ⇒ 报 `symbol-not-found`（可能是引用的符号被删/改名）；
 *   - 取不到标识符（纯叙述）或文件不存在 ⇒ 只在 `--strict` 下报。
 *
 * ★**它是"候选清单"，不是判决**（与 `gaps.js --stale` 同性质），有两类**已知假阳**：
 *   ① 标识符可能来自同一句话里**上一个**引用（`… ops.ts:1721 的 scSetRenderTarget、读端 blendEnv.ts:19`）；
 *   ② 声明行常常是**函数体内部**的一行（不是 `function x(` 那一行）⇒ 行内当然不含符号名。
 *   实践建议：用 **`--min-dist 15`** 收窄（小的距离几乎都是②）—— 实测它把候选从 22 条压到 ~8 条、
 *   而那 8 条里含本次真正修掉的全部大漂移（如 `msgwin.ts:1271 → 1507`、`:648 → 127`）。
 *
 * ★它**只报告、绝不改写**：行号是"缓存"，改它是 owner 的判断（用 `ledger.js --plan` 的 `patches`）。
 *
 * 用法：
 *   node check-ledger-refs.js [--root <dir>] [--json] [--check] [--strict] [--caps] [--all]
 *   --caps    同时扫 analysis/engine-capabilities.json
 *   --check   有候选 ⇒ exit 1（给 CI / 收尾闸门用）
 *   --strict  连"取不到标识符""文件不存在"也报
 *   --all     连 journal[]（沿革，允许陈旧）也报（缺省跳过）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = path.resolve(val('--root') || '.');
const AS_JSON = has('--json');
const STRICT = has('--strict');
const WITH_CAPS = has('--caps');
const SCAN_JOURNAL = has('--all');

if (has('--help') || has('-h')) {
  console.log(
    '用法：node check-ledger-refs.js [--root <dir>] [--json] [--check] [--strict] [--caps] [--all]\n' +
      '  --caps    同时扫 analysis/engine-capabilities.json\n' +
      '  --check   有候选 ⇒ exit 1\n' +
      '  --strict  连"取不到标识符""文件不存在"也报\n' +
      '  --all     连 journal[]（沿革）也扫\n' +
      '  --min-dist <N>  只报"最近符号距离 >= N 行"的候选（建议 15，滤掉"声明行落在函数体内"那类假阳）',
  );
  process.exit(0);
}

/** `src/x/y.ts:123` 或 `app/.../z.ts:45-67`。 */
const REF = /((?:app\/amayui-emulator\/)?src\/[A-Za-z0-9_/.-]+\.(?:ts|tsx)):(\d+)(?:-(\d+))?/g;

const lineCache = new Map();
function linesOf(rel) {
  if (!lineCache.has(rel)) lineCache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n'));
  return lineCache.get(rel);
}
function hitsOf(rel, id) {
  const ls = linesOf(rel);
  const out = [];
  for (let i = 0; i < ls.length; i++) if (ls[i].includes(id)) out.push(i + 1);
  return out;
}

const rows = [];

/** 扫一个文本字段。 */
function scan(kind, where, text) {
  if (typeof text !== 'string' || !text) return;
  REF.lastIndex = 0;
  let m;
  while ((m = REF.exec(text)) !== null) {
    const rawRel = m[1];
    const rel = rawRel.startsWith('app/') ? rawRel : `app/amayui-emulator/${rawRel}`;
    const line = Number(m[2]);
    const lineEnd = m[3] ? Number(m[3]) : line; // ★区间按整段判
    if (!fs.existsSync(path.join(ROOT, rel))) {
      if (STRICT) rows.push({ kind, where, file: rawRel, line, verdict: 'file-missing', ids: [], best: null });
      continue;
    }
    const ctx = text.slice(Math.max(0, m.index - 60), m.index);
    const allIds = [...ctx.matchAll(/`([A-Za-z_][A-Za-z0-9_.]{2,40})`/g)].map((z) => z[1].split('.')[0]);
    const ids = [...new Set(allIds)];
    if (ids.length === 0) {
      if (STRICT) rows.push({ kind, where, file: rawRel, line, verdict: 'no-symbol', ids: [], best: null });
      continue;
    }
    const ls = linesOf(rel);
    const span = ls.slice(Math.max(0, line - 1), Math.min(ls.length, lineEnd)).join('\n');
    if (ids.some((id) => span.includes(id))) continue; // 有效
    let best = null;
    for (const id of ids) {
      const hits = hitsOf(rel, id);
      // ★过于泛的标识符没有鉴别力（`return`/`slot` 之类）⇒ 不参与判定
      if (hits.length > 8) continue;
      if (hits.length === 0) continue;
      const near = hits.reduce((a, b) => (Math.abs(b - line) < Math.abs(a - line) ? b : a), hits[0]);
      if (best === null || Math.abs(near - line) < Math.abs(best.line - line)) best = { id, line: near, hits: hits.length };
    }
    rows.push({
      kind,
      where,
      file: rawRel,
      line,
      lineEnd,
      verdict: best ? 'drift' : 'symbol-not-found',
      ids,
      best,
    });
  }
}

// ---- opcode-gaps.json ----
{
  const p = path.join(ROOT, 'analysis/opcode-gaps.json');
  if (fs.existsSync(p)) {
    const g = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const e of g.entries ?? []) {
      const at = `0x${e.opcode.toString(16)}`;
      if (e.disposition !== 'implemented') scan('opcode-gaps', `${at} note`, e.note);
      for (const m of e.missing ?? []) scan('opcode-gaps', `${at} missing(${m.raw})`, m.what);
      if (SCAN_JOURNAL) for (const j of e.journal ?? []) scan('opcode-gaps', `${at} journal`, j.what);
    }
  }
}

// ---- engine-capabilities.json ----
if (WITH_CAPS) {
  const p = path.join(ROOT, 'analysis/engine-capabilities.json');
  if (fs.existsSync(p)) {
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const e of c.entries ?? []) {
      if (e.emulator?.status !== 'n/a-known') scan('capabilities', `${e.id} emulator.note`, e.emulator?.note);
      if (SCAN_JOURNAL) for (const j of e.journal ?? []) scan('capabilities', `${e.id} journal`, j.what);
    }
  }
}

rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const MIN_DIST = Number(val('--min-dist') || 0);
const shown = Number.isFinite(MIN_DIST) && MIN_DIST > 0
  ? rows.filter((r) => !r.best || Math.abs(r.best.line - r.line) >= MIN_DIST)
  : rows;

if (AS_JSON) {
  console.log(JSON.stringify({ root: ROOT, count: shown.length, rows: shown }, null, 2));
} else {
  const drift = shown.filter((r) => r.verdict === 'drift');
  const gone = shown.filter((r) => r.verdict === 'symbol-not-found');
  console.log(
    `台账正文引用体检（root=${ROOT}${WITH_CAPS ? ' +capabilities' : ''}${MIN_DIST > 0 ? ` min-dist=${MIN_DIST}` : ''}）：` +
      `漂移 **${drift.length}** · 符号找不到 **${gone.length}**` +
      (shown.length !== rows.length ? `（另有 ${rows.length - shown.length} 条被 --min-dist 过滤）` : '') +
      (STRICT ? ` · 其它 ${rows.length - drift.length - gone.length}` : ''),
  );
  for (const r of shown) {
    const span = r.lineEnd && r.lineEnd !== r.line ? `${r.line}-${r.lineEnd}` : `${r.line}`;
    const tag = r.best
      ? `→ ${r.best.line}（距 ${Math.abs(r.best.line - r.line)} 行；${r.best.id}，共 ${r.best.hits} 处）`
      : r.verdict;
    console.log(`  [${r.verdict}] ${r.kind} ${r.where} | ${r.file}:${span} ${tag} | 期望含 ${JSON.stringify(r.ids)}`);
  }
  if (shown.length === 0) console.log('  ✓ 没有候选（声明行/区间都含自述的标识符）');
  console.log('★候选清单不是判决：`symbol-not-found` 里有一部分是"标识符来自同一句里的上一个引用"（假阳）。');
  console.log('★只报告、不改写：改行号请用 `ledger.js --plan` 的 patches（plan 的 old 串要恰好命中 1 次或给 count）。');
}

if (has('--check') && shown.length > 0) process.exit(1);
