/**
 * opcode 缺口台账生成器（`tickets/T-0081`，B0）。
 *
 * 目的：把两类**现在只能靠人读注释发现**的失败模式变成机读 + CI 可见：
 *  ① 语料用到、而 emulator 三张注册表都没有的 opcode ⇒ 命中即 `NotImplementedOp`（`run.ts` 与
 *     `renderer/app/session.ts` 会停下等人工桩）；
 *  ② 已注册进 `ENGINE_INTERNAL_OPS` 却**体内有真实效果**的 no-op（审计一次翻出 4 条）。
 *
 * 真源 = `analysis/opcode-gaps.json`（人工登记 disposition/备注/票）；本脚本负责把**可复算的部分**
 * 算出来（语料命中数、注册状态、引擎 handler 体行号）并渲染 `docs-new/03-engine/opcode-gaps.md`。
 *
 * 用法：
 *   node scripts/build-opcode-gaps.mjs            # 渲染 md（并做校验，违规即非零退出）
 *   node scripts/build-opcode-gaps.mjs --check    # 只校验 + 检查 md 是否最新（不写文件）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 语料里出现的 opcode → 命中数/涉及文件数。
 *
 * ★语料有两种写法（`scripts/asm` 都接受）：`iXX` 助记符、以及**语义化名字**（如 `local-ret`、`draw-texture`、
 * `exit`）。只数 `iXX` 会漏掉名字形式的调用（审计 P1 的 `0x7C local-ret` 668 处就是名字形式）⇒ 这里按
 * `scripts/asm/opcodes.json` 的 `name`/`aliases`/`i<hex>` 三种键建表后再统计。
 */
export function scanCorpus(root) {
  const ops = JSON.parse(fs.readFileSync(path.join(root, 'scripts/asm/opcodes.json'), 'utf8'));
  const byToken = new Map();
  for (const o of ops) {
    byToken.set('i' + o.opcode.toString(16), o.opcode);
    if (o.name) byToken.set(o.name, o.opcode);
    for (const a of o.aliases ?? []) byToken.set(a, o.opcode);
  }
  const counts = new Map();
  const dir = path.join(root, 'src');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z][A-Za-z0-9_-]*)/.exec(line);
      if (!m) continue;
      const tok = m[1];
      // `i07b` 这类带前导零的写法：规范化后再查一次
      const op = byToken.get(tok) ?? (/^i[0-9a-fA-F]+$/.test(tok) ? byToken.get('i' + parseInt(tok.slice(1), 16).toString(16)) : undefined);
      if (op === undefined) continue;
      const e = counts.get(op) ?? { count: 0, files: new Set() };
      e.count++;
      e.files.add(f);
      counts.set(op, e);
    }
  }
  return counts;
}

/**
 * emulator 三张表的注册状态。
 *
 * 两种登记形态都要认（都在 `handlers/*.ts` 里）：① 表项数组 `[0xNN, handler]`；② 规格对象键 `0xNN: { … }`
 * （例如 `config-read.ts` 的 `CFG_READ`，其键会在组装表时注册）。
 */
export function scanRegistrations(root) {
  const dir = path.join(root, 'app/amayui-emulator/src/vm/handlers');
  const registered = new Set();
  const internal = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of t.matchAll(/\[(0x[0-9a-fA-F]+),\s*([A-Za-z0-9_]+)/g)) {
      const op = parseInt(m[1], 16);
      registered.add(op);
      if (/engine_internal/.test(m[2])) internal.add(op);
    }
    for (const m of t.matchAll(/^\s*(0x[0-9a-fA-F]{1,4}):\s*\{/gm)) {
      registered.add(parseInt(m[1], 16));
    }
  }
  return { registered, internal };
}

/** 引擎 dispatch 表（字节 675996 + 4*op）与 handler 体起始行。 */
export function scanEngineTable(root) {
  const src = fs.readFileSync(path.join(root, 'engine/天结_unpacked.exe_utf8.c'), 'utf8').split('\n');
  const handlerByOp = new Map();
  for (const line of src) {
    const m = /^\s*\*\(_DWORD \*\)\(_this \+ (\d+)\) = (sub_[0-9A-F]{6});\s*$/.exec(line);
    if (!m) continue;
    const op = (Number(m[1]) - 675996) / 4;
    if (Number.isInteger(op) && op >= 0 && op <= 0x400 && !handlerByOp.has(op)) handlerByOp.set(op, m[2]);
  }
  const bodyLine = new Map();
  src.forEach((l, i) => {
    const m = /^\/\/----- \(([0-9A-F]{8})\)/.exec(l);
    if (m) bodyLine.set('sub_' + parseInt(m[1], 16).toString(16).toUpperCase(), i + 1);
  });
  return { handlerByOp, bodyLine };
}

const DISPOSITIONS = ['unimplemented', 'engine-internal', 'engine-internal-unjustified', 'implemented', 'deferred', 'partial'];

/**
 * `partial` 的 `missing[]` schema（`tickets/T-0149`）。
 *
 * 为什么要有这个处置位：`implemented` 只回答「**注册了没有**」，一旦写上就再没人回头核对；
 * 审计（2026-09）的 436 条缺口里绝大多数正落在「已注册、但缺分支 / 缺消费端 / 只是近似」这一类。
 * ⇒ `partial` + `missing[]` 把「相对引擎体还缺什么」变成**可棘轮的一等状态**。
 */
const MISSING_WHAT_MIN = 8;
const TICKET_RE = /^T-\d{4}$/;
const RAW_RE = /^\d+(-\d+)?$/;

/** 票号是否真实存在（`tickets/<id>/ticket.json`）。 */
function ticketExists(root, id) {
  try {
    return fs.statSync(path.join(root, 'tickets', id, 'ticket.json')).isFile();
  } catch {
    return false;
  }
}

/**
 * 处置统计 = `counts` 的**唯一口径**。
 *
 * 为什么要有这个函数：`counts` 此前是**手写**的，必然漂移 —— 2026-09 实测到一次（声明
 * `deferred 25 / unimplemented 6`，实际 `31 / 0`），而且没有任何东西发现它。现在它由工具回填（写模式）
 * 或报成 problem（只读模式，守卫测试走这条）⇒ 手写/并发都拦得住。
 */
export function tallyDispositions(entries) {
  const byDisposition = {};
  for (const d of DISPOSITIONS) byDisposition[d] = 0;
  for (const e of entries) byDisposition[e.disposition] = (byDisposition[e.disposition] ?? 0) + 1;
  return { entries: entries.length, byDisposition };
}

/**
 * 把 `counts` 回填进真源 `analysis/opcode-gaps.json`。
 *
 * ★只做**定点文本替换**（正则命中 `"counts": { … }` 那一块），其余字节原样保留 ——
 * 不用 `JSON.stringify` 重写整文件，避免翻新格式、也把并发丢更新的窗口压到最小。
 */
function syncCountsFile(root, entries) {
  const p = path.join(root, 'analysis/opcode-gaps.json');
  const raw = fs.readFileSync(p, 'utf8');
  const t = tallyDispositions(entries);
  const block =
    '  "counts": {\n' +
    `    "entries": ${t.entries},\n` +
    '    "byDisposition": {\n' +
    DISPOSITIONS.map((d, i) => `      "${d}": ${t.byDisposition[d]}${i === DISPOSITIONS.length - 1 ? '' : ','}`).join('\n') +
    '\n    }\n  }';
  const re = / {2}"counts": \{[\s\S]*?\n {2}\}/;
  if (!re.test(raw)) return 'missing';
  const next = raw.replace(re, block);
  if (next === raw) return 'ok';
  fs.writeFileSync(p, next);
  return 'changed';
}

/** 计算报告 + 校验，返回 { report, problems }。`opts.syncCounts` = 回填真源的 `counts`（写模式）。 */
export function buildGapReport(root, opts = {}) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'analysis/opcode-gaps.json'), 'utf8'));
  // ★2026-09：opcode 映射的真源已从 `opcode-table.md` 迁到 `analysis/opcodes.json`
  //   （md 与 `scripts/asm/opcodes.json` 都是它的生成物）。这里只取 name/argc/status，
  //   `handler` 仍以 .c 的 dispatch 表实读为准（可交叉校验 JSON 里的记录）。
  const ops = JSON.parse(fs.readFileSync(path.join(root, 'analysis/opcodes.json'), 'utf8')).entries;
  const byOp = new Map(ops.map((o) => [o.opcode, o]));
  const corpus = scanCorpus(root);
  const { registered, internal } = scanRegistrations(root);
  const { handlerByOp, bodyLine } = scanEngineTable(root);

  const problems = [];
  const entries = [];
  const seen = new Set();
  for (const e of registry.entries) {
    const op = e.opcode;
    if (seen.has(op)) problems.push(`0x${op.toString(16)}：在 opcode-gaps.json 里重复登记`);
    seen.add(op);
    if (!DISPOSITIONS.includes(e.disposition)) problems.push(`0x${op.toString(16)}：disposition 非法（${e.disposition}）`);
    if (!byOp.has(op)) problems.push(`0x${op.toString(16)}：不在 scripts/asm/opcodes.json 里`);
    if (e.disposition === 'engine-internal' && !internal.has(op)) problems.push(`0x${op.toString(16)}：标为 engine-internal 但没注册进 no-op 表`);
    if (e.disposition === 'engine-internal-unjustified' && !e.ticket) problems.push(`0x${op.toString(16)}：unjustified 必须有 ticket`);
    if (e.disposition === 'implemented' && (!registered.has(op) || internal.has(op))) {
      problems.push(`0x${op.toString(16)}：标为 implemented 但实际未真实现（registered=${registered.has(op)}, internal=${internal.has(op)}）`);
    }
    if (e.disposition === 'unimplemented' && registered.has(op)) {
      problems.push(`0x${op.toString(16)}：标为 unimplemented 但实际已注册（请改 disposition）`);
    }
    if (e.disposition === 'partial' && !registered.has(op)) {
      problems.push(`0x${op.toString(16)}：标为 partial 但 emulator 根本没注册（partial 的前提是「已注册、已达语料级可用」；未注册的应写 unimplemented）`);
    }
    if (e.disposition === 'partial') {
      if (!Array.isArray(e.missing) || e.missing.length === 0) {
        problems.push(`0x${op.toString(16)}：标为 partial 但 missing[] 为空/缺失（必须逐条写「还缺哪条分支/消费端」）`);
      } else {
        e.missing.forEach((m, i) => {
          const at = `0x${op.toString(16)}：missing[${i}]`;
          if (!m || typeof m.what !== 'string' || m.what.trim().length < MISSING_WHAT_MIN) {
            problems.push(`${at}.what 缺/太短（必须一句话写清缺哪条分支或能力，带引擎行为描述）`);
          }
          if (typeof m?.ticket !== 'string' || !TICKET_RE.test(m.ticket)) {
            problems.push(`${at}.ticket 格式错（${JSON.stringify(m?.ticket)}；应形如 T-0151）`);
          } else if (!ticketExists(root, m.ticket)) {
            problems.push(`${at}.ticket=${m.ticket} 在 tickets/ 下不存在（承接票必须真实存在，不许指向被删/未开的票）`);
          }
          if (typeof m?.raw !== 'string' || !RAW_RE.test(m.raw)) {
            problems.push(`${at}.raw 不匹配 ^\\d+(-\\d+)?$（${JSON.stringify(m?.raw)}；只允许单一行号或单一段行区间）`);
          }
        });
      }
    } else if (Array.isArray(e.missing) && e.missing.length) {
      problems.push(
        `0x${op.toString(16)}：disposition=${e.disposition} 却带 ${e.missing.length} 条 missing[] ⇒ 要么改 disposition=partial（"还缺东西"不许藏在 implemented 里），要么删掉 missing[]`,
      );
    }
    if (e.disposition !== 'implemented' && !e.note) problems.push(`0x${op.toString(16)}：缺 note（写清体内真实效果/为什么不实现）`);
    const c = corpus.get(op);
    entries.push({
      ...e,
      name: byOp.get(op)?.mnemonic ?? '',
      argc: byOp.get(op)?.argc ?? null,
      docStatus: byOp.get(op)?.status ?? '',
      handler: handlerByOp.get(op) ?? '',
      handlerBodyLine: handlerByOp.has(op) ? (bodyLine.get(handlerByOp.get(op)) ?? null) : null,
      corpusCount: c?.count ?? 0,
      corpusFiles: c?.files.size ?? 0,
      liveRegistered: registered.has(op),
      liveInternal: internal.has(op),
    });
  }

  // 覆盖检查：语料用到但未注册的，必须全部在登记表里
  const missing = [];
  for (const [op, c] of corpus) {
    if (registered.has(op) || seen.has(op)) continue;
    missing.push({ op, count: c.count, files: c.files.size });
  }
  if (missing.length) {
    missing.sort((a, b) => b.count - a.count);
    problems.push(
      `语料用到但既未注册、也未登记进 analysis/opcode-gaps.json 的有 ${missing.length} 条：` +
        missing.map((m) => `0x${m.op.toString(16)}(${m.count})`).join(' '),
    );
  }
  // 反向覆盖：登记为 engine-internal 的必须确实在 no-op 表里（已查）；再查 no-op 表里的漏登记
  for (const op of internal) {
    if (!seen.has(op)) problems.push(`0x${op.toString(16)}：在 ENGINE_INTERNAL_OPS 里但没登记进 opcode-gaps.json（缺"体内真实效果"说明）`);
  }

  const unimpl = entries.filter((e) => e.disposition === 'unimplemented').sort((a, b) => b.corpusCount - a.corpusCount || a.opcode - b.opcode);
  const unjust = entries.filter((e) => e.disposition === 'engine-internal-unjustified').sort((a, b) => b.corpusCount - a.corpusCount);
  const internalOk = entries.filter((e) => e.disposition === 'engine-internal').sort((a, b) => a.opcode - b.opcode);
  const implemented = entries.filter((e) => e.disposition === 'implemented').sort((a, b) => a.opcode - b.opcode);
  const deferred = entries.filter((e) => e.disposition === 'deferred').sort((a, b) => b.corpusCount - a.corpusCount || a.opcode - b.opcode);
  const partial = entries
    .filter((e) => e.disposition === 'partial')
    .sort((a, b) => a.opcode - b.opcode)
    .map((e) => ({ ...e, missing: (e.missing ?? []).map((m) => ({ ...m })) }));

  // `counts`：写模式自动回填；只读模式把漂移报成 problem（守卫测试走这条 ⇒ 手写/漏跑都会红）。
  const tally = tallyDispositions(entries);
  if (opts.syncCounts) syncCountsFile(root, entries);
  else {
    const declared = registry.counts?.byDisposition ?? {};
    const drift = DISPOSITIONS.filter((d) => (declared[d] ?? 0) !== tally.byDisposition[d]);
    if (drift.length) {
      problems.push(
        `counts 已漂移（${drift.map((d) => `${d}: 声明 ${declared[d] ?? 0} / 实际 ${tally.byDisposition[d]}`).join('；')}）⇒ 跑 node scripts/build-opcode-gaps.mjs`,
      );
    }
  }

  return {
    report: {
      entries,
      unimpl,
      unjust,
      internalOk,
      implemented,
      deferred,
      partial,
      counts: tally,
      corpusKinds: corpus.size,
      corpusUnimplCalls: unimpl.reduce((a, e) => a + e.corpusCount, 0),
      registeredCount: registered.size,
      internalCount: internal.size,
      missing,
    },
    problems,
  };
}

const fmtCall = (e) => `${e.mnemonic}${e.name ? ' ' + e.name : ''}`;

/** 表格单元格转义（`|` 会冲掉列数）。 */
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * ★**渲染用一句话**：从 `note` 派生的**裁剪摘要**（≤ `n` 字）。
 *
 * 为什么裁剪：`note` 是**真源的审计轨**（体证叙事 + 逐轮沿革，71 条合计 ≈ 80 KB）。
 * 把它逐字铺进 md 会让生成物 92.8% 的字节都是它 —— 而其中大部分是"当初怎么想错了"的沿革，
 * 对"现在该怎么处置"没有导航价值。⇒ **md 只给一句话索引，全文留在 JSON，一条命令可取**
 * （`node .agents/skills/amayui-engine-analysis/scripts/gaps.js --show 0x140`）。
 */
export function summarize(note, n = 120) {
  // ★2026-09 文档模型：**沿革话术不进生成物** —— 摘要开头常见的「★审计 P1 订正：」「2026-09 更新：」
  //   这类前缀是“当初怎么想错了”，对“现在是什么”没有导航价值 ⇒ 剥掉（全文仍在 JSON 的 note 里）。
  const strip = (x) => x.replace(/^★?\s*(?:审计[^：:]{0,40}订正|订正|20\d\d-\d\d[^：:]{0,24})[：:]\s*/, '').replace(/^★\s*/, '');
  const s = strip(String(note ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim());
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 渲染 md（纯函数，便于测试断言"文件是最新的"）。 */
export function renderGapMd(report) {
  const L = [];
  L.push('---');
  L.push('kind: generated');
  L.push('state: live');
  L.push('home: analysis/opcode-gaps.json');
  L.push('generated_by: scripts/build-opcode-gaps.mjs');
  L.push('---');
  L.push('');
  L.push('# 03-engine · opcode 缺口台账（生成物，勿手改）');
  L.push('');
  L.push('> 真源 = `analysis/opcode-gaps.json`（人工登记 `disposition`/备注/票）；本文件由 `scripts/build-opcode-gaps.mjs` 渲染。');
  L.push('> 语料命中数与注册状态**实时计算**：`^\\s*iXX\\b` 扫 `src/*.txt`（941 个脚本），注册表扫 `app/amayui-emulator/src/vm/handlers/*.ts`。');
  L.push('> 纪律（审计 `docs-new/99-records/2026-09-audit/audit-2026-09.md` §1「不静默跳过」）：**任何不实现/近似都必须在这里有一条**，');
  L.push('> 否则 `test/opcode-gaps.test.ts` 会红。');
  L.push('> ★**「注册了没有」与「做全了没有」是两件事**：`implemented` 只回答前者（写上就再没人回头核对），');
  L.push('> 「已注册、但相对引擎体还缺分支/消费端/写者」一律 `partial` + `missing[]`（§7，`tickets/T-0149`）。');
  L.push('>');
  L.push('> ★**本表只给一句话**（从真源 `note` 裁到 120 字）：`note` 是审计轨（体证叙事 + 逐轮沿革，71 条 ≈ 80 KB），');
  L.push('> 逐字铺进 md 会让生成物 92.8% 的字节都是它，而对"现在该怎么处置"没有导航价值。**全文取法**：');
  L.push('> `node .agents/skills/amayui-engine-analysis/scripts/gaps.js --show 0x140`（或直接读 `analysis/opcode-gaps.json`）。');
  L.push('');
  L.push('## 1. 结论速览');
  L.push('');
  L.push(`- 语料出现的 opcode：**${report.corpusKinds}** 种；handler 表注册：**${report.registeredCount}** 种（其中 no-op 插桩 ${report.internalCount} 种）`);
  L.push(`- **语料用到但未注册**（命中即 \`NotImplementedOp\`）：**${report.unimpl.length}** 条，合计 **${report.corpusUnimplCalls}** 次调用`);
  L.push(`- **已注册为 no-op 但体内有真实效果**（待改）：**${report.unjust.length}** 条`);
  L.push(`- 已实现（曾为缺口，保留记录）：**${report.implemented.length}** 条`);
  L.push(
    `- **已评估、按当前范围不实现（\`deferred\`，每条必须写扩展点）**：**${report.deferred.length}** 条` +
      (report.deferred.length
        ? `（语料合计 ${report.deferred.reduce((a, e) => a + e.corpusCount, 0)} 次调用）—— 明细见 §6`
        : ''),
  );
  const partialMissing = report.partial.reduce((a, e) => a + (e.missing?.length ?? 0), 0);
  L.push(
    `- **部分实现（\`partial\`：handler 已达语料级可用，但相对引擎体仍缺分支/消费端）**：**${report.partial.length}** 条 ` +
      `opcode / **${partialMissing}** 条缺口 —— 明细见 §7`,
  );
  L.push('');
  L.push('## 2. 未实现（按语料命中数排序）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 文档状态 | 票 | 一句话（全文见 JSON） |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const e of report.unimpl) {
    L.push(
      `| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.corpusFiles} | ${e.argc ?? '?'} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.docStatus || '?'} | ${e.ticket || '—'} | ${esc(summarize(e.note))} |`,
    );
  }
  L.push('');
  L.push('## 3. 已注册为 no-op，但体内有真实效果（必须改：补实现或显式缺口）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 体内真实效果（一句话） |');
  L.push('|---|---|---|---|---|---|---|');
  for (const e of report.unjust) {
    L.push(`| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.ticket || '—'} | ${esc(summarize(e.note))} |`);
  }
  L.push('');
  L.push('## 4. 已注册为 no-op，且已读体确认对 VM 不可观测（有据跳过）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 依据（一句话） |');
  L.push('|---|---|---|---|---|---|');
  for (const e of report.internalOk) {
    L.push(`| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${esc(summarize(e.note))} |`);
  }
  L.push('');
  L.push('## 5. 已实现（曾登记为缺口）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 说明（一句话） |');
  L.push('|---|---|---|---|---|---|---|');
  for (const e of report.implemented) {
    L.push(`| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.ticket || '—'} | ${esc(summarize(e.note))} |`);
  }
  L.push('');
  L.push('## 6. 已评估、按当前范围不实现（`deferred`：每条都必须写清扩展点）');
  L.push('');
  L.push('> 这些**不是"没做"**，而是「按当前重写范围不做 / 需要先建某个模型」—— 每条 note 里都写了扩展点。');
  L.push('> 编号排在最后是为了不打乱 §2–§5 的既有引用（审计报告引用过 §5）。');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 票 | 扩展点 / 理由（一句话） |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const e of report.deferred) {
    L.push(
      `| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.corpusFiles} | ${e.argc ?? '?'} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.ticket || '—'} | ${esc(summarize(e.note))} |`,
    );
  }
  L.push('');
  L.push('## 7. 部分实现（`partial`：已注册、已达语料级可用，但相对引擎体仍缺分支 / 消费端 / 写者）');
  L.push('');
  L.push('> **口径（`tickets/T-0149`）**：`partial` = handler **已达语料级可用**（语料跑得通、不是硬停也不是纯 no-op），');
  L.push('> 但**相对引擎体仍缺**某条分支 / 某个消费端 / 某个写者，或某处只是**披露近似**。');
  L.push('> 它与邻居的分工：`implemented` = 已读完体且不缺东西；`engine-internal` = 有据 no-op；');
  L.push('> `deferred` = 按当前范围整个不做；`partial` = **做了，但没做全**。');
  L.push('>');
  L.push('> ★**每条 `partial` 必须带 `missing[]`**（真源里逐条 `{what, ticket, raw}`）：`what` = 缺哪条分支/能力（一句话，带引擎行为描述）、');
  L.push('> `ticket` = 承接它的票（必须在 `tickets/` 下真实存在）、`raw` = 引擎行号或**单一段**行区间。');
  L.push('> `test/opcode-gaps.test.ts` 是棘轮：`missing[]` 空/缺字段、票号不存在、`raw` 不合规、或把 `missing[]` 挂在非 `partial` 上，一律红。');
  L.push('> **本段按承接票分组**（下表把每条缺口摊成一行，便于各票逐条销账；销完即从 `missing[]` 删掉，全空则处置改回 `implemented`）。');
  L.push('');
  if (!report.partial.length) {
    L.push('（当前无 `partial` 条目）');
    L.push('');
  } else {
    /** 按 missing 条目自己的票分组（同一条 opcode 的缺口可以分属不同票）。 */
    const groups = new Map();
    for (const e of report.partial) {
      for (const m of e.missing ?? []) {
        if (!groups.has(m.ticket)) groups.set(m.ticket, []);
        groups.get(m.ticket).push({ e, m });
      }
    }
    for (const tk of [...groups.keys()].sort()) {
      const rows = groups.get(tk).sort((a, b) => a.e.opcode - b.e.opcode || String(a.m.raw).localeCompare(String(b.m.raw)));
      L.push(`### 7.${[...groups.keys()].sort().indexOf(tk) + 1} ${tk}（${new Set(rows.map((r) => r.e.opcode)).size} 条 opcode / ${rows.length} 条缺口）`);
      L.push('');
      L.push('| opcode | 助记符 | 语料 | 引擎 raw | 缺什么（承接票见分组标题） |');
      L.push('|---|---|---|---|---|');
      for (const { e, m } of rows) {
        L.push(`| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${esc(m.raw)} | ${esc(m.what)} |`);
      }
      L.push('');
    }
  }
  return L.join('\n');
}

function main() {
  const root = process.cwd();
  const check = process.argv.includes('--check');
  const { report, problems } = buildGapReport(root, { syncCounts: !check });
  const md = renderGapMd(report);
  const out = path.join(root, 'docs-new/03-engine/opcode-gaps.md');
  let stale = false;
  if (check) {
    stale = !fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== md;
    // ★`--check` 必须**失败**（而不是只打印一行 ✗）：`npm run gaps:check` 是 CI 入口，
    //   早前它只打印、仍 exit 0 ⇒ "检查通过"是假象。
    if (stale) problems.push('docs-new/03-engine/opcode-gaps.md 不是最新的（跑 node scripts/build-opcode-gaps.mjs）');
    else console.log('✓ md 是最新的');
  } else fs.writeFileSync(out, md);

  console.log(`opcode 缺口台账：未实现 ${report.unimpl.length}（语料 ${report.corpusUnimplCalls} 次调用）/ unjustified no-op ${report.unjust.length} / 有据 no-op ${report.internalOk.length} / 已实现 ${report.implemented.length} / deferred ${report.deferred.length} / partial ${report.partial.length}（缺口 ${report.partial.reduce((a, e) => a + (e.missing?.length ?? 0), 0)} 条）`);
  if (check) console.log(`md 最新性：${stale ? '✗ 见下方 problem' : '✓'}`);
  if (problems.length) {
    console.error('✗ 校验失败：');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✓ 校验通过（覆盖 + 处置纪律）');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
