#!/usr/bin/env node
/**
 * **会话级沿革台账**（`analysis/journal.jsonl`）的查询 / 自检工具。
 *
 *   node scripts/journal.js                 # 统计 + 最近 3 轮
 *   node scripts/journal.js --tail 5        # 最近 5 条
 *   node scripts/journal.js --round 9       # 某一轮（可多条：轮次编号在不同文档里不唯一）
 *   node scripts/journal.js --ticket T-0102 # 涉及某张票的所有条目
 *   node scripts/journal.js --kind pause    # 按类别过滤
 *   node scripts/journal.js --lessons       # 汇总所有方法论教训
 *   node scripts/journal.js --show 12       # 打印第 12 条（1-based）全文
 *   node scripts/journal.js --validate      # 结构自检（守卫 test/journal.test.ts 走同一套规则）
 *
 * 为什么要有它：**沿革只留一个家**。轮次日志以前散在
 * `handoff` 的四个暂停点 / `repair-plan` §2b–§2k / `refactor-plan` §9 / `audit-2026-09.md` §6 里，
 * 互相转抄、必然漂移；现在它们是本文件的行，活文档不再复述。
 *
 * 纪律：**本文件永不渲染进任何生成物**（`test/doc-model.test.ts` 会查）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'analysis', 'journal.jsonl');

const KINDS = ['pause', 'batch', 'changelog', 'summary', 'audit-status'];

/** 读 + 解析（返回 { entries, problems }）。 */
export function readJournal(file = FILE) {
  const problems = [];
  if (!fs.existsSync(file)) return { entries: [], problems: [`${path.relative(ROOT, file)} 不存在`] };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const entries = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.trim()) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch (err) {
      problems.push(`第 ${n} 行不是合法 JSON：${err.message}`);
      return;
    }
    if (typeof e.at !== 'string' || !e.at) problems.push(`第 ${n} 行：at 缺失`);
    if (!Number.isInteger(e.seq)) problems.push(`第 ${n} 行：seq 必须是整数（追加序，严格递增）`);
    if (e.round !== null && !Number.isInteger(e.round)) problems.push(`第 ${n} 行：round 必须是整数或 null`);
    if (!KINDS.includes(e.kind)) problems.push(`第 ${n} 行：kind 非法（${e.kind}）；合法值 ${KINDS.join('/')}`);
    for (const k of ['title', 'source', 'body']) if (typeof e[k] !== 'string' || !e[k]) problems.push(`第 ${n} 行：${k} 缺失`);
    if (!Array.isArray(e.tickets)) problems.push(`第 ${n} 行：tickets 必须是数组`);
    entries.push({ ...e, _n: n });
  });
  // seq 严格递增（= 追加序）。★`round` 是**来源文档的标签**，跨时代编号不统一（`轮 47+` 与 `轮 4..9`
  //   是两套体系）⇒ 只做类型校验，不要求单调。
  let last = -Infinity;
  for (const e of entries) {
    if (e.seq <= last) problems.push(`第 ${e._n} 行：seq ${e.seq} 未严格递增（前一条 ${last}）`);
    last = e.seq;
  }
  return { entries, problems };
}

/** 票据 id 必须真实存在（悬空引用即红）。 */
export function checkTicketRefs(entries, ticketsDir = path.join(ROOT, 'tickets')) {
  const problems = [];
  const known = new Set(fs.existsSync(ticketsDir)
    ? fs.readdirSync(ticketsDir).filter((d) => /^T-\d{4}$/.test(d))
    : []);
  for (const e of entries) {
    for (const t of e.tickets) if (!known.has(t)) problems.push(`第 ${e._n} 行：引用不存在的票 ${t}`);
  }
  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const { entries, problems } = readJournal();
  const refProblems = checkTicketRefs(entries);

  if (has('--validate')) {
    const all = [...problems, ...refProblems];
    if (all.length) {
      console.error('✗ journal.jsonl 校验失败：');
      for (const p of all) console.error('  - ' + p);
      process.exit(1);
    }
    const rounds = new Set(entries.filter((e) => e.round !== null).map((e) => e.round));
    console.log(`✓ journal.jsonl 合法（${entries.length} 条 / ${rounds.size} 个轮次 / ${(fs.statSync(FILE).size / 1024).toFixed(1)} KB）`);
    return;
  }

  let list = entries;
  if (has('--round')) list = list.filter((e) => String(e.round) === val('--round'));
  if (has('--kind')) list = list.filter((e) => e.kind === val('--kind'));
  if (has('--ticket')) list = list.filter((e) => e.tickets.includes(val('--ticket')));

  if (has('--lessons')) {
    for (const e of entries) for (const l of e.lessons ?? []) console.log(`- [轮 ${e.round ?? '—'}] ${l}`);
    return;
  }
  if (has('--show')) {
    const n = Number(val('--show'));
    const e = list.find((x) => x._n === n) ?? list[n - 1];
    if (!e) { console.error(`✗ 找不到第 ${n} 条`); process.exit(1); }
    console.log(`### [轮 ${e.round ?? '—'}] ${e.title}\n> ${e.kind} · ${e.source} · tickets: ${e.tickets.join(' ') || '—'}\n`);
    console.log(e.body);
    return;
  }

  const tail = has('--tail') ? Number(val('--tail')) : 3;
  const shown = list.slice(-tail);
  console.log(`沿革台账：${entries.length} 条 / ${(fs.statSync(FILE).size / 1024).toFixed(1)} KB`);
  const byKind = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log(`类别：${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  const rounds = [...new Set(entries.filter((e) => e.round !== null).map((e) => e.round))].sort((a, b) => a - b);
  console.log(`轮次：${rounds.join(' ')}\n`);
  if (list.length !== entries.length) console.log(`过滤后 ${list.length} 条：\n`);
  for (const e of shown) console.log(`  #${String(e._n).padStart(3)}  [轮 ${String(e.round ?? '—').padStart(3)}]  ${e.kind.padEnd(12)} ${e.title}`);
  console.log(`\n（--tail N / --round N / --kind K / --ticket T-xxxx / --lessons / --show N / --validate）`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href.replace(/\\/g, '/')) main();
else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
