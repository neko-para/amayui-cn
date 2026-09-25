#!/usr/bin/env node
/**
 * ledger.js —— **按键路径改写台账**（`analysis/*.json` 的唯一增长处的通用写入口）。
 *
 * 为什么要有它（而不是手改 JSON 或"整段 old 串替换"）：
 *  1. 手改 JSON 会绕过 `counts` 口径（⇒ `--validate` 红、md 陈旧）；
 *  2. 整段 old 串替换要求**手抄旧的长 note 全文**，抄错一个字就写不进去，而且会误伤别的条目；
 *  3. 本工具按 `match` 定位**恰好一条**，再按**字段名/点路径**只换那一个值 ⇒ 不抄旧文、不误伤。
 *
 * 用法：
 *   node ledger.js --plan <plan.json> [--root <dir>] [--write] [--json]
 *
 *   ★**默认是 dry-run**：不加 `--write` 只报告将要发生什么、绝不落盘（`--check` 是它的别名）。
 *   `--json` 把结果打成 JSON（供脚本消费）。
 *
 * 计划文件（JSON）：
 * {
 *   "ops": [
 *     {
 *       "file": "analysis/engine-capabilities.json",
 *       "match": { "id": "adv-text-reveal-progress" },   // 在该文件条目数组里按字段精确值定位唯一条目
 *       "set":   { "emulator.note": "…新值…", "reads": ["a", "b"] },  // 点路径整体替换（数组/对象也整体替换）
 *       "add":   { "missing": [ { "what": "…", "ticket": "T-0179", "raw": "80524-80532" } ] },
 *       "unset": ["emulator.guard"],                     // 删字段（自动吃掉逗号）
 *       "mutate": {                                      // 对**数组字段**做按 raw 的手术（`missing[]` 专用）
 *         "missing": { "deleteRaw": ["132591-132625"],
 *                      "rewriteRaw": [ { "raw": "79699-79700", "what": "…新判词…", "newRaw": "…可选…" } ] }
 *       }
 *     }
 *   ],
 *   "appendEntries": { "analysis/functions.json": [ { …整条… } ] },   // 追加到该文件条目数组尾部
 *   "appendKeys":    { "analysis/functions.json": "addr" },           // 覆盖去重键（缺省按既有条目自然键推断）
 *   "topLevel":      { "analysis/opcode-gaps.json": { "dispositions.partial": "…" } },  // 顶层字段（★counts 除外）
 *   "patches":       { "src/vm/opcodes.ts": [ { "old": "…", "new": "…" } ] }           // 整串替换：old 必须恰好 1 次
 * }                                                                                    // （重复短语加 "count": N ⇒ 恰好 N 次且**全部**替换）
 *
 * `add` 的语义（★这是本工具最容易用错的一处）：
 *   - 值（点路径末端）**已是数组** ⇒ **append**（这正是"给在册条目的 `missing[]` 追加一条"的用法，
 *     不需要把已有的几条抄一遍 —— 抄写就是漏抄的来源）；
 *   - 字段**不存在** ⇒ 在条目末尾插入该字段；
 *   - 既非数组也非缺失 ⇒ **整体替换**（并在输出里明确写出来）。
 *
 * `topLevel` 的 `counts` 守卫：`counts` 是**派生物**，各台账有各自的**唯一口径**，本工具拒绝直接改写它，
 * 并告诉你该跑哪个重算入口（`capabilities.js --recount` / `scripts.js --recount` /
 * `gaps.js --recount`（缺口台账，口径 = `scripts/build-opcode-gaps.mjs`）/ `scripts/build-tickets.mjs`（票据看板））。
 * 直接写 counts 只会制造"声明与实盘不符"，而 `--validate` / 守卫测试随后会红。
 *
 * 纪律（写盘前后都查）：
 *  ① **两阶段**：全部条目先定位成功才写盘（任一 `match` 命中 ≠1 条就整体拒绝）；
 *  ② `match` 必须命中**恰好 1 条**（防"改错条目"）；
 *  ③ `patches[].old` 必须在该文件里恰好出现 **1 次**；
 *  ④ ★**写盘后回读复核**：每个 `set`/`add`/`mutate` 的点路径读回来必须 === 预期值，否则报错（非 0 退出）；
 *  ⑤ 拒绝 CRLF；写盘走 同目录 tmp + `renameSync`（并发读者不会读到截断内容）。
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

if (has('--help') || has('-h') || argv.length === 0) {
  console.log(`用法：node ledger.js --plan <plan.json> [--root <dir>] [--write] [--json]

  --plan <file>   计划文件（schema 见本文件头部注释）
  --root <dir>    仓库根（缺省 = 当前目录）
  --write         真的落盘（★缺省是 dry-run：只报告不写）
  --check         同 dry-run（显式表达"只校验"）
  --json          以 JSON 输出结果
  --help          本帮助

重算 counts（不要用本工具写 counts）：
  capabilities.js --recount · scripts.js --recount · gaps.js --recount · node scripts/build-tickets.mjs`);
  process.exit(argv.length === 0 ? 2 : 0);
}

if (has('--check') && has('--write')) {
  console.error('✗ --check（只校验）与 --write（落盘）互斥');
  process.exit(2);
}
const DRY = !has('--write'); // 缺省 = dry-run；`--check` 只是把这件事写在命令行上（显式表达"只校验"）
const AS_JSON = has('--json');
const ROOT = path.resolve(val('--root') || '.');
const PLAN_PATH = val('--plan');
if (!PLAN_PATH) {
  console.error('✗ 缺 --plan <plan.json>（本工具只按计划文件工作；见 --help）');
  process.exit(2);
}

const problems = [];
const notes = [];
const report = { root: ROOT, plan: PLAN_PATH, mode: DRY ? 'dry-run' : 'write', files: [], problems, notes };

let plan;
try {
  plan = JSON.parse(fs.readFileSync(path.resolve(ROOT, PLAN_PATH), 'utf8'));
} catch (err) {
  console.error(`✗ 计划文件读不了/不是 JSON：${err.message}`);
  process.exit(2);
}

/** 允许做**条目手术**的台账（`ops`/`topLevel`/`appendEntries` 只许指向这里，防手滑改到源码/文档）。 */
const LEDGERS = new Set([
  'analysis/functions.json',
  'analysis/fields.json',
  'analysis/opcodes.json',
  'analysis/engine-capabilities.json',
  'analysis/opcode-gaps.json',
  'analysis/scripts.json',
]);
/** 条目手术的目标：路径归一 + 必须在册。`patches` 不走这里（它是通用整串替换，另有 old 恰好 1 次的护栏）。 */
const ledgerRel = (rel) => {
  const norm = String(rel).replace(/\\/g, '/');
  if (!LEDGERS.has(norm)) {
    throw new Error(`不是可做条目手术的台账：${norm}（允许：${[...LEDGERS].join(' / ')}；改源码/文档请用 patches）`);
  }
  return norm;
};
const rawRel = (rel) => String(rel).replace(/\\/g, '/');

const staged = new Map(); // rel -> string
/** 走**条目手术/topLevel/appendEntries** 的文件（= JSON，写盘前必须能 JSON.parse）；`patches` 的文件不在其中。 */
const stagedJson = new Set();
/** 写盘后要回读核对的值：{ file, kind: 'entry'|'top', match?(entry), path, expect } */
const verify = [];
const pushVerify = (file, kind, path, expect, match) => verify.push({ file, kind, path, expect, match });

function readText(rel) {
  if (staged.has(rel)) return staged.get(rel);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

/** 找顶层条目数组在文本里的位置；返回 ['[' 的下标, 对应 ']' 的下标]。 */
function findArraySpan(text) {
  const at = text.indexOf('"entries"');
  const at2 = at >= 0 ? text.indexOf('[', at) : text.indexOf('[');
  if (at2 < 0) throw new Error('找不到条目数组（既没有 "entries" 也没有顶层数组）');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = at2; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return [at2, i]; }
  }
  throw new Error('条目数组未闭合');
}

/** 扫描一个 JSON 值 token（从文本 i 处开始），返回结束下标（不含）。 */
function scanValue(text, i) {
  while (/\s/.test(text[i])) i++;
  const c = text[i];
  if (c === '"') {
    i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '"') return i + 1;
      i++;
    }
    throw new Error('字符串未闭合');
  }
  if (c === '[' || c === '{') {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') { depth--; if (depth === 0) return i + 1; }
    }
    throw new Error('嵌套值未闭合');
  }
  while (i < text.length && !',}]'.includes(text[i])) i++;
  return i;
}

/** 点路径取值（对象/数组都按属性名走）。 */
const getPath = (o, dot) =>
  dot.split('.').reduce((acc, seg) => (acc == null ? undefined : acc[seg]), o);

/**
 * 在**一个 JSON 容器内部**找它的**直接子字段** `"key"`（局部深度 1），返回 `{ keyStart, keyEnd }`。
 *
 * ★为什么不能用 `text.indexOf('"key"', lo)`（本工具踩过的真事故）：那只找**第一次出现**，
 *   完全不管嵌套。实测：`text-layout-wrap-ruby` 的条目里 `emulator`（深度 1）**先于**顶层的
 *   `note`（也是深度 1）出现，而 `emulator.note`（深度 2）里也有 `"note"` ⇒ 一个裸键 `note`
 *   的 `unset`/`set` 会命中 `emulator.note`、把另一个字段删掉/改掉。
 *   当时是**写盘后回读复核**把它拦住的（`emulator.note` 回读 `undefined`），否则就是静默数据损坏。
 *   ⇒ 定位一律按**容器 + 局部深度**做：`lo` 必须指向一个容器开头（`{`），子字段在局部深度 1。
 */
function findDirectKey(text, key, lo, hi) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let expectKey = false;
  for (let i = lo; i < hi; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      if (expectKey && depth === 1) {
        let j = i + 1;
        let e = false;
        for (; j < hi; j++) {
          const d = text[j];
          if (e) { e = false; continue; }
          if (d === '\\') { e = true; continue; }
          if (d === '"') break;
        }
        if (text.slice(i + 1, j) === key) return { keyStart: i, keyEnd: j + 1 };
      }
      inStr = true;
      expectKey = false;
      continue;
    }
    if (c === '{' || c === '[') { depth++; expectKey = c === '{'; continue; }
    if (c === '}' || c === ']') { depth--; expectKey = false; continue; }
    if (c === ',') { expectKey = true; continue; }
    if (c === ':') { expectKey = false; continue; }
  }
  return null;
}

/** 在**条目文本**里按点路径整体替换一个值（保持缩进）。 */
function applySet(entryText, dotPath, value) {
  const segs = dotPath.split('.');
  let lo = 0;
  let hi = entryText.length;
  for (let s = 0; s < segs.length; s++) {
    const key = segs[s];
    // ★按「容器 + 直接子字段」定位（见 findDirectKey 的注释：indexOf 会穿透嵌套、改错字段）
    const found = findDirectKey(entryText, key, lo, hi);
    if (!found) throw new Error(`找不到字段 ${key}（在 ${dotPath} 的第 ${s + 1} 段）`);
    const kAt = found.keyStart;
    const colon = entryText.indexOf(':', found.keyEnd);
    const vStart = colon + 1;
    const vEnd = scanValue(entryText, vStart);
    if (s === segs.length - 1) {
      const prefix = entryText.slice(vStart, vEnd);
      const nl = prefix.match(/^\s*/)[0];
      // 缩进：沿用"该 key 所在行的缩进 + 2"，保证多行数组/对象的续行对齐
      const lineStart = entryText.lastIndexOf('\n', kAt) + 1;
      const keyIndent = entryText.slice(lineStart, kAt).match(/^\s*/)[0];
      const body = JSON.stringify(value, null, 2).split('\n');
      const indented = body.map((l, idx) => (idx === 0 ? l : keyIndent + '  ' + l)).join('\n');
      return entryText.slice(0, vStart) + nl + indented + entryText.slice(vEnd);
    }
    lo = vStart;
    hi = vEnd;
  }
  throw new Error('空路径');
}

// ===========================================================================
// 阶段 1：全部定位 + 生成结果文本（任一问题 ⇒ 整体不写盘）
// ===========================================================================

/** 定位"第 hitIdx 个直接子元素"的文本范围。 */
function entryRanges(text, arrStart, arrEnd) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  const ranges = [];
  for (let i = arrStart + 1; i < arrEnd; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') { if (depth === 0) start = i; depth++; }
    else if (c === '}' || c === ']') { depth--; if (depth === 0) ranges.push([start, i + 1]); }
  }
  return ranges;
}

for (const [i, op] of (plan.ops ?? []).entries()) {
  let rel;
  const tag0 = `ops[${i}] ${op.file} ${JSON.stringify(op.match ?? {})}`;
  try { rel = ledgerRel(op.file); } catch (err) { problems.push(`${tag0}：${err.message}`); continue; }
  const tag = `ops[${i}] ${rel} ${JSON.stringify(op.match ?? {})}`;
  if (!op.match || typeof op.match !== 'object' || !Object.keys(op.match).length) {
    problems.push(`${tag}：match 必须是非空对象（它是"改哪一条"的唯一凭据）`);
    continue;
  }
  let text;
  try { text = readText(rel); } catch (err) { problems.push(`${tag}：${err.message}`); continue; }

  const [arrStart, arrEnd] = findArraySpan(text);
  const arr = JSON.parse(text.slice(arrStart, arrEnd + 1));
  const keys = Object.keys(op.match);
  const hits = arr.map((e, idx) => ({ e, idx })).filter(({ e }) => keys.every((k) => e[k] === op.match[k]));
  if (hits.length !== 1) {
    problems.push(`${tag}：match 命中 ${hits.length} 条（必须恰好 1 条）`);
    continue;
  }
  const ranges = entryRanges(text, arrStart, arrEnd);
  if (ranges.length !== arr.length) {
    problems.push(`${tag}：文本扫描到 ${ranges.length} 个条目、JSON 解析到 ${arr.length} 个（不一致，可能有未转义括号）`);
    continue;
  }
  const [eStart, eEnd] = ranges[hits[0].idx];
  let entryText = text.slice(eStart, eEnd);

  // ---- mutate：数组字段的按 raw 手术 ----
  for (const [key, rules] of Object.entries(op.mutate ?? {})) {
    try {
      const cur = getPath(JSON.parse(entryText), key);
      if (!Array.isArray(cur)) throw new Error(`字段 ${key} 不是数组（${typeof cur}）`);
      let list = [...cur];
      for (const raw of rules.deleteRaw ?? []) {
        const n0 = list.length;
        list = list.filter((m) => m.raw !== raw);
        if (list.length === n0) {
          throw new Error(`${key}: deleteRaw ${raw} 未命中（现有 ${cur.map((m) => m.raw).join(', ')}）`);
        }
        notes.push(`   · mutate ${key}: 删 raw=${raw}`);
      }
      for (const r of rules.rewriteRaw ?? []) {
        const at = list.findIndex((m) => m.raw === r.raw);
        if (at < 0) throw new Error(`${key}: rewriteRaw ${r.raw} 未命中`);
        list[at] = { ...list[at], what: r.what };
        if (r.newRaw) list[at].raw = r.newRaw;
        notes.push(`   · mutate ${key}: 改写 raw=${r.raw}${r.newRaw ? ` → ${r.newRaw}` : ''}`);
      }
      entryText = applySet(entryText, key, list);
      pushVerify(rel, 'entry', key, list, op.match);
    } catch (err) { problems.push(`${tag} mutate ${key}: ${err.message}`); }
  }

  // ---- set：点路径整体替换 ----
  for (const [k, v] of Object.entries(op.set ?? {})) {
    try {
      entryText = applySet(entryText, k, v);
      pushVerify(rel, 'entry', k, v, op.match);
    } catch (err) { problems.push(`${tag} set ${k}: ${err.message}`); }
  }

  // ---- unset：删字段 ----
  for (const dot of op.unset ?? []) {
    try {
      // ★按点路径逐级解析（与 applySet 同一套 findDirectKey）：
      //   裸键只认**条目顶层**的同名字段，不再用 indexOf 穿透到嵌套里（那会删错字段）。
      const segs = dot.split('.');
      let lo = 0;
      let hi = entryText.length;
      let hit = null;
      for (let s = 0; s < segs.length; s++) {
        hit = findDirectKey(entryText, segs[s], lo, hi);
        if (!hit) throw new Error(`找不到字段 ${dot}（第 ${s + 1} 段 ${segs[s]}）`);
        if (s < segs.length - 1) {
          const c2 = entryText.indexOf(':', hit.keyEnd);
          lo = c2 + 1;
          hi = scanValue(entryText, lo);
        }
      }
      const kAt = hit.keyStart;
      const colon = entryText.indexOf(':', hit.keyEnd);
      const vStart = colon + 1;
      const vEnd = scanValue(entryText, vStart);
      let start = entryText.lastIndexOf('\n', kAt) + 1;
      let end = vEnd;
      if (entryText[end] === ',') end += 1; // 后面还有字段 ⇒ 吃掉后面的逗号
      else {
        let j = start - 1; // 它是最后一个字段 ⇒ 吃掉前面的逗号
        while (j >= 0 && /\s/.test(entryText[j])) j--;
        if (entryText[j] === ',') start = j;
      }
      entryText = entryText.slice(0, start) + entryText.slice(end);
    } catch (err) { problems.push(`${tag} unset ${dot}: ${err.message}`); }
  }

  // ---- add：数组则 append（★"给在册条目追加 missing"就是这条） ----
  for (const [k, v] of Object.entries(op.add ?? {})) {
    // ★必须按**点路径**取值：按扁平键查会把 `add: {"engine.fns": [...]}` 判成"字段不存在"，
    //   于是走 applySet 的**整体替换**、把原数组抹掉 —— 这是真实发生过的数据损坏。
    const cur = getPath(JSON.parse(entryText), k);
    const next = Array.isArray(cur) && Array.isArray(v) ? [...cur, ...v] : v;
    if (Array.isArray(cur) && Array.isArray(v)) {
      notes.push(`   · add ${k}: 数组 ${cur.length} → ${next.length}（append ${v.length}）`);
    } else if (cur !== undefined) {
      notes.push(`   · add ${k}: ★原值不是数组（${typeof cur}）⇒ 按**整体替换**`);
    }
    try {
      entryText = applySet(entryText, k, next);
      pushVerify(rel, 'entry', k, next, op.match);
    } catch (err) {
      if (!/找不到字段/.test(err.message)) {
        problems.push(`${tag} add ${k}: ${err.message}`);
        continue;
      }
      try { // 字段不存在 ⇒ 在条目末尾插入（沿用已有字段的缩进）
        const firstKey = entryText.match(/\n(\s*)"[A-Za-z_]/);
        const indent = firstKey ? firstKey[1] : '    ';
        const close = entryText.lastIndexOf('}');
        const body = JSON.stringify(v, null, 2).split('\n').map((l, idx) => (idx === 0 ? l : indent + l)).join('\n');
        entryText = entryText.slice(0, close) + `,\n${indent}"${k}": ${body}\n` + entryText.slice(close);
        pushVerify(rel, 'entry', k, v, op.match);
      } catch (err2) { problems.push(`${tag} add(insert) ${k}: ${err2.message}`); }
    }
  }

  staged.set(rel, text.slice(0, eStart) + entryText + text.slice(eEnd));
  stagedJson.add(rel);
}

// ---- topLevel：顶层字段（★counts 由各台账口径重算，拒绝直写） ----
for (const [relRaw, sets] of Object.entries(plan.topLevel ?? {})) {
  let rel;
  try { rel = ledgerRel(relRaw); } catch (err) { problems.push(`topLevel ${relRaw}：${err.message}`); continue; }
  let text;
  try { text = readText(rel); } catch (err) { problems.push(`topLevel ${rel}：${err.message}`); continue; }
  for (const [dot, v] of Object.entries(sets)) {
    if (/^counts(\.|$)/.test(dot)) {
      problems.push(
        `topLevel ${rel} ${dot}：★counts 是派生物，不许直写 —— 跑它的唯一口径入口：` +
        'capabilities.js --recount · scripts.js --recount · gaps.js --recount（缺口台账）· node scripts/build-tickets.mjs（票据看板）',
      );
      continue;
    }
    try {
      text = applySet(text, dot, v);
      pushVerify(rel, 'top', dot, v);
      staged.set(rel, text);
      stagedJson.add(rel);
    } catch (err) { problems.push(`topLevel ${rel} ${dot}：${err.message}`); }
  }
}

// ---- patches：整串替换（`old` 必须恰好 1 次；给了 `count` 则必须恰好 count 次并**全部**替换） ----
for (const [relRaw, list] of Object.entries(plan.patches ?? {})) {
  const rel = rawRel(relRaw);
  let text;
  try { text = readText(rel); } catch (err) { problems.push(`patches ${rel}：${err.message}`); continue; }
  for (const [i, p] of list.entries()) {
    const n = text.split(p.old).length - 1;
    const want = typeof p.count === 'number' ? p.count : 1;
    if (n !== want) {
      problems.push(
        `patches ${rel}[${i}]：old 出现 ${n} 次（应为 ${want}${typeof p.count === 'number' ? '（计划声明的 count）' : ''}）：` +
        JSON.stringify(String(p.old).slice(0, 70)),
      );
      continue;
    }
    // 用 split/join 而不是 replace：`count` 模式下要**全部**换掉，且 $& 之类不会被当替换模式解释。
    text = text.split(p.old).join(p.new);
    if (want > 1) notes.push(`   · patches ${rel}: 定点替换 ${want} 处 «${String(p.old).slice(0, 40)}»`);
  }
  staged.set(rel, text);
}

// ---- appendEntries：追加整条 ----
for (const [relRaw, entries] of Object.entries(plan.appendEntries ?? {})) {
  let rel;
  try { rel = ledgerRel(relRaw); } catch (err) { problems.push(`appendEntries ${relRaw}：${err.message}`); continue; }
  let text;
  try { text = readText(rel); } catch (err) { problems.push(`appendEntries ${rel}：${err.message}`); continue; }
  const [arrStart, arrEnd] = findArraySpan(text);
  const parsed = JSON.parse(text.slice(arrStart, arrEnd + 1));
  const arr = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed);
  // 去重键按**该文件既有条目的自然键**推断（opcode-gaps=opcode、functions=addr、fields=offset、capabilities/scripts=id）
  const key = plan.appendKeys?.[relRaw] ?? plan.appendKeys?.[rel]
    ?? (arr[0]?.opcode !== undefined ? 'opcode'
      : arr[0]?.addr !== undefined ? 'addr'
        : arr[0]?.offset !== undefined ? 'offset'
          : 'id');
  const need = entries.filter((e) => !arr.some((x) => String(x[key]) === String(e[key])));
  if (need.length !== entries.length) {
    problems.push(`${rel}：有 ${entries.length - need.length} 条（按 ${key}）已存在 ⇒ 拒绝（不是静默跳过）`);
    continue;
  }
  const block = need.map((e) => JSON.stringify(e, null, 2).split('\n').map((l) => '    ' + l).join('\n')).join(',\n');
  staged.set(rel, `${text.slice(0, arrEnd)},\n${block}${text.slice(arrEnd)}`);
  stagedJson.add(rel);
}

if (problems.length) {
  if (AS_JSON) console.log(JSON.stringify({ ...report, ok: false }, null, 2));
  else {
    console.error('❌ 定位/改写未通过，未写任何文件：');
    for (const p of problems) console.error('   - ' + p);
  }
  process.exit(1);
}

// ===========================================================================
// 阶段 2：写盘（默认 dry-run）+ 回读复核
// ===========================================================================

/** 原子写：同目录 tmp + rename（并发读者不会读到被截断的 JSON）。 */
function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* 清理失败无所谓 */ }
    throw err;
  }
}

const parsedAfter = new Map();
for (const [rel, s] of staged) {
  if (/\r\n/.test(s)) {
    console.error(`❌ ${rel} 结果含 CRLF，拒绝写盘（本工程一律 LF）`);
    process.exit(1);
  }
  if (stagedJson.has(rel)) {
    // ★只有**条目手术/topLevel/appendEntries** 的产物才必须是合法 JSON；`patches` 的目标可以是源码/文档。
    let obj;
    try { obj = JSON.parse(s); } catch (e) {
      console.error(`❌ ${rel} 结果解析失败：${e.message}（未写盘）`);
      process.exit(1);
    }
    parsedAfter.set(rel, obj);
  }
  const abs = path.join(ROOT, rel);
  const before = fs.readFileSync(abs, 'utf8');
  if (before === s) {
    report.files.push({ file: rel, changed: false, before: before.length, after: s.length });
    if (!AS_JSON) console.log(`= ${rel}: 无变化`);
    continue;
  }
  if (!DRY) writeFileAtomic(abs, s);
  report.files.push({ file: rel, changed: true, before: before.length, after: s.length });
  if (!AS_JSON) console.log(`${DRY ? '·' : '✓'} ${rel}: ${before.length} → ${s.length} 字节`);
}

// ★回读复核：dry-run 核对内存对象，write 模式核对**磁盘**（这才是"真的写进去了"）。
const mismatches = [];
for (const v of verify) {
  const obj = DRY
    ? parsedAfter.get(v.file)
    : JSON.parse(fs.readFileSync(path.join(ROOT, v.file), 'utf8'));
  let got;
  if (v.kind === 'entry') {
    const arr = obj.entries ?? obj;
    const hit = arr.find((e) => Object.keys(v.match).every((k) => e[k] === v.match[k]));
    got = hit ? getPath(hit, v.path) : undefined;
  } else got = getPath(obj, v.path);
  if (JSON.stringify(got) !== JSON.stringify(v.expect)) {
    const label = v.kind === 'entry' ? `${JSON.stringify(v.match)}§${v.path}` : `topLevel§${v.path}`;
    mismatches.push(`${v.file} ${label}: 回读 ${JSON.stringify(got)} ≠ 预期 ${JSON.stringify(v.expect)}`);
  }
}
if (mismatches.length) {
  // write 模式下这是**硬错误**（说明文本手术没落到 JSON 语义上）
  if (AS_JSON) console.log(JSON.stringify({ ...report, ok: false, mismatches }, null, 2));
  else {
    console.error('❌ 写盘后回读复核失败（文本手术与 JSON 语义不一致）：');
    for (const m of mismatches) console.error('   - ' + m);
  }
  process.exit(1);
}

report.ok = true;
report.verified = verify.length;
if (AS_JSON) console.log(JSON.stringify(report, null, 2));
else {
  for (const n of notes) console.log(n);
  console.log(
    `${DRY ? '（dry-run：未写盘；加 --write 落盘）' : '✅ 已写入'} —— 改写文件 ${report.files.filter((f) => f.changed).length} 个，回读复核 ${verify.length} 处通过`,
  );
}
