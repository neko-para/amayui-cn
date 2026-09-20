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

const DISPOSITIONS = ['unimplemented', 'engine-internal', 'engine-internal-unjustified', 'implemented', 'deferred'];

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
  const ops = JSON.parse(fs.readFileSync(path.join(root, 'scripts/asm/opcodes.json'), 'utf8'));
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
    if (e.disposition !== 'implemented' && !e.note) problems.push(`0x${op.toString(16)}：缺 note（写清体内真实效果/为什么不实现）`);
    const c = corpus.get(op);
    entries.push({
      ...e,
      name: byOp.get(op)?.name ?? '',
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

/** 渲染 md（纯函数，便于测试断言"文件是最新的"）。 */
export function renderGapMd(report) {
  const L = [];
  L.push('# 03-engine · opcode 缺口台账（生成物，勿手改）');
  L.push('');
  L.push('> 真源 = `analysis/opcode-gaps.json`（人工登记 `disposition`/备注/票）；本文件由 `scripts/build-opcode-gaps.mjs` 渲染。');
  L.push('> 语料命中数与注册状态**实时计算**：`^\\s*iXX\\b` 扫 `src/*.txt`（941 个脚本），注册表扫 `app/amayui-emulator/src/vm/handlers/*.ts`。');
  L.push('> 纪律（审计 `docs-new/03-engine/audit-2026-09.md` §1「不静默跳过」）：**任何不实现/近似都必须在这里有一条**，');
  L.push('> 否则 `test/opcode-gaps.test.ts` 会红。');
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
  L.push('');
  L.push('## 2. 未实现（按语料命中数排序）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 文档状态 | 票 | 备注 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const e of report.unimpl) {
    L.push(
      `| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.corpusFiles} | ${e.argc ?? '?'} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.docStatus || '?'} | ${e.ticket || '—'} | ${e.note} |`,
    );
  }
  L.push('');
  L.push('## 3. 已注册为 no-op，但体内有真实效果（必须改：补实现或显式缺口）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 体内真实效果 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const e of report.unjust) {
    L.push(`| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.ticket || '—'} | ${e.note} |`);
  }
  L.push('');
  L.push('## 4. 已注册为 no-op，且已读体确认对 VM 不可观测（有据跳过）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 依据 |');
  L.push('|---|---|---|---|---|---|');
  for (const e of report.internalOk) {
    L.push(`| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.note} |`);
  }
  L.push('');
  L.push('## 5. 已实现（曾登记为缺口）');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 引擎 handler | 体起始行 | 票 | 说明 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const e of report.implemented) {
    L.push(`| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.ticket || '—'} | ${e.note} |`);
  }
  L.push('');
  L.push('## 6. 已评估、按当前范围不实现（`deferred`：每条都必须写清扩展点）');
  L.push('');
  L.push('> 这些**不是"没做"**，而是「按当前重写范围不做 / 需要先建某个模型」—— 每条 note 里都写了扩展点。');
  L.push('> 编号排在最后是为了不打乱 §2–§5 的既有引用（审计报告引用过 §5）。');
  L.push('');
  L.push('| opcode | 助记符 | 语料 | 文件 | argc | 引擎 handler | 体起始行 | 票 | 扩展点 / 理由 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const e of report.deferred) {
    L.push(
      `| 0x${e.opcode.toString(16)} | ${fmtCall(e)} | ${e.corpusCount} | ${e.corpusFiles} | ${e.argc ?? '?'} | ${e.handler || '?'} | ${e.handlerBodyLine ?? '?'} | ${e.ticket || '—'} | ${e.note} |`,
    );
  }
  L.push('');
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

  console.log(`opcode 缺口台账：未实现 ${report.unimpl.length}（语料 ${report.corpusUnimplCalls} 次调用）/ unjustified no-op ${report.unjust.length} / 有据 no-op ${report.internalOk.length} / 已实现 ${report.implemented.length} / deferred ${report.deferred.length}`);
  if (check) console.log(`md 最新性：${stale ? '✗ 见下方 problem' : '✓'}`);
  if (problems.length) {
    console.error('✗ 校验失败：');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✓ 校验通过（覆盖 + 处置纪律）');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
