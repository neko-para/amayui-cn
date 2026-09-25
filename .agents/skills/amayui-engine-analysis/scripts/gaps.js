#!/usr/bin/env node
/**
 * **opcode 缺口台账**（`analysis/opcode-gaps.json`）的工具：查询 + `counts` 重算 + 陈旧条目体检。
 *
 *   node gaps.js                # 统计 + 处置分布
 *   node gaps.js --list         # 全部条目一行一条
 *   node gaps.js --show 0x140   # 某条的**全文**（体证 + 沿革 + 扩展点）
 *   node gaps.js --missing 0x82 # 某条的 `missing[]` 逐条明细（含 `raw` 键与承接票）
 *   node gaps.js --ticket T-0179
 *   node gaps.js --disposition deferred
 *   node gaps.js --search 转场
 *   node gaps.js --stale        # ★体检：`missing[]` 里"自述已实现/不适用"的陈旧候选（见下）
 *   node gaps.js --recount      # ★只重算并回填顶层 `counts`（口径 = scripts/build-opcode-gaps.mjs）
 *
 * 为什么要有它：生成物 `docs-new/03-engine/opcode-gaps.md` 的每格只给**一句话**
 * （从 `note` 裁到 120 字）—— 完整的体证叙事与逐轮沿革（71 条 ≈ 80 KB）留在真源 JSON 里。
 * 本工具就是"一句话 → 全文"的那条命令。
 *
 * 写入口径：
 *  - `counts` **只有一个口径** = `scripts/build-opcode-gaps.mjs` 的 `tallyDispositions()`。
 *    `--recount` **不重写**这套算法，它直接 `import()` 那个生成器的 `buildGapReport(root, {syncCounts:true})`
 *    ⇒ 不存在"第二份口径"。★为什么不能像另两个台账那样自己重算：`counts` 的枚举顺序、`entries` 计数
 *    与 `dispositions` 解释都在生成器里；手写第二份（历史上有过 `.tmp/settle/apply-counts-68.mjs`）迟早漂移。
 *  - 条目本身的增删改**不走这里**：用 `ledger.js --plan`（按键路径 `set/add/unset/mutate`），或
 *    `.agents/skills/amayui-script-analysis/scripts/…`（脚本台账）。
 *  - `docs-new/03-engine/opcode-gaps.md` 是生成物：改完真源跑 `node scripts/build-opcode-gaps.mjs`。
 *
 * ★`--stale` 的存在理由（第 52/64/69 轮踩过三次）：子代理"实现了"却漏删对应的 `missing[]` ⇒
 * 台账里留下"自述已实现/已不适用"的陈旧条目，主 agent 每次手工补删。这一条是**机械可查**的：
 * 把 `missing[].what` 里出现「已实现 / 已补上 / 已删 / 不再需要 / 现按 …」的条目列出来，人再逐条裁决。
 * 三级处置见 `CONTEXT.md` §8.18（①可补的真缺口 / ②结构性不适用 / ③早已补上没回台）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

if (has('--help') || has('-h')) {
  console.log(`用法：node gaps.js [--root <dir>] [模式]

  --list                     全部条目一行一条
  --show <0x..|mnemonic>     某条全文（体证 + 沿革）
  --missing <0x..|mnemonic>  某条的 missing[] 明细（raw 键 + 承接票）
  --stale                    missing[] 里"自述已实现/不适用"的陈旧候选（③ 类体检）
  --recount                  只重算并回填顶层 counts（口径 = scripts/build-opcode-gaps.mjs）
  --disposition <d>          过滤
  --ticket <T-xxxx>          过滤
  --search <串>              全文模糊查
  --root <dir>               仓库根（缺省 = 本仓库）`);
  process.exit(0);
}

const ROOT = path.resolve(val('--root') || REPO);
const FILE = path.join(ROOT, 'analysis', 'opcode-gaps.json');
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const all = doc.entries;
const hex = (n) => `0x${n.toString(16)}`;
/** `--show/--missing` 的定位：0x.. 十六进制 / 十进制 / 助记符。 */
const findOne = (q) => {
  const s = String(q);
  const want = /^0x/i.test(s) ? parseInt(s, 16) : (/^\d+$/.test(s) ? Number(s) : NaN);
  return all.find((x) => x.opcode === want || x.mnemonic === s);
};

// ---------------------------------------------------------------------------
// --recount：口径唯一 —— 直接调用生成器，不在这里重写第二份算法
// ---------------------------------------------------------------------------
if (has('--recount')) {
  const gen = path.join(ROOT, 'scripts', 'build-opcode-gaps.mjs');
  if (!fs.existsSync(gen)) {
    console.error(`✗ 找不到生成器 ${gen}（--recount 的口径就在它里面）`);
    process.exit(2);
  }
  const before = JSON.parse(JSON.stringify(doc.counts ?? null));
  const mod = await import(pathToFileURL(gen).href);
  const { report, problems } = mod.buildGapReport(ROOT, { syncCounts: true });
  const after = JSON.parse(fs.readFileSync(FILE, 'utf8')).counts ?? null;
  const bd = before?.byDisposition ?? {};
  const ad = after?.byDisposition ?? {};
  const diffs = [...new Set([...Object.keys(bd), ...Object.keys(ad)])].filter((k) => bd[k] !== ad[k]);
  if (before?.entries !== after?.entries) console.log(`counts.entries: ${before?.entries} → ${after?.entries}`);
  for (const k of diffs) console.log(`counts.byDisposition.${k}: ${bd[k] ?? 0} → ${ad[k] ?? 0}`);
  if (!diffs.length && before?.entries === after?.entries) console.log('counts: 无变化');
  else console.log(`✅ counts 已按唯一口径回填（entries=${after?.entries}）`);
  if (problems.length) {
    console.error(`\n⚠ 另有 ${problems.length} 条**与 counts 无关**的问题（本工具不修，交给生成器的校验）：`);
    for (const p of problems.slice(0, 20)) console.error('   - ' + p);
    if (problems.length > 20) console.error(`   …… 其余 ${problems.length - 20} 条见 node scripts/build-opcode-gaps.mjs --check`);
    process.exitCode = 1;
  } else {
    console.log('✓ 生成器校验同时通过（覆盖 + 处置纪律）');
  }
  console.log('[next] md 是生成物：node scripts/build-opcode-gaps.mjs（或 --check 只校验）');
  process.exit(process.exitCode ?? 0);
}

// ---------------------------------------------------------------------------
// --stale：③ 类（早已补上但没回台）的机械候选
// ---------------------------------------------------------------------------
const STRONG = /已实现|已补上|已补齐|已删除|已删掉|不再需要|已不需要|already implemented|now implemented/i;
const WEAK = /现按|已改为|已由|已能|已支持|已接上/;
if (has('--stale')) {
  const rows = [];
  for (const e of all) {
    for (const m of e.missing ?? []) {
      const s = String(m.what ?? '');
      const strong = STRONG.exec(s);
      const weak = strong ? null : WEAK.exec(s);
      if (!strong && !weak) continue;
      rows.push({ e, m, tok: (strong ?? weak)[0], level: strong ? '强' : '弱' });
    }
  }
  const strongN = rows.filter((r) => r.level === '强').length;
  console.log(`missing[] 陈旧候选：${rows.length} 条（强 ${strongN} / 弱 ${rows.length - strongN}）· 全部 ${all.length} 条登记项`);
  console.log('★判据（CONTEXT §8.18 的三态过滤）：③ 早已补上没回台 ⇒ 复核代码/守卫后**删条目**；');
  console.log('  ② 结构性不适用 ⇒ 把 what 重写成「为什么 + 重开条件」；① 真缺口 ⇒ 补实现。**不许**用沉默掩盖缺口。\n');
  for (const r of rows) {
    console.log(`${r.level} ${hex(r.e.opcode).padEnd(6)} ${(r.e.mnemonic || '').padEnd(9)} disp=${(r.e.disposition || '').padEnd(15)} raw=${(r.m.raw || '?').padEnd(16)} 票=${r.m.ticket || '—'}  词=「${r.tok}」`);
    console.log(`      ${String(r.m.what).replace(/\s+/g, ' ').replace(/\*\*/g, '').slice(0, 150)}`);
  }
  if (!rows.length) console.log('（无陈旧候选 —— missing[] 里没有"自述已实现/不适用"的条目）');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --missing：逐条明细
// ---------------------------------------------------------------------------
if (has('--missing')) {
  const e = findOne(val('--missing'));
  if (!e) { console.error(`✗ 找不到 ${val('--missing')}`); process.exit(1); }
  const list = e.missing ?? [];
  console.log(`### ${hex(e.opcode)}  ${e.mnemonic}${e.name ? ' ' + e.name : ''}  处置 ${e.disposition}${e.ticket ? ` · 票 ${e.ticket}` : ''}`);
  console.log(`missing[] ${list.length} 条（★` + '`raw` 是删/改条目时的**唯一键**：ledger.js 的 `mutate.deleteRaw` / `rewriteRaw` 用它）\n');
  for (const [i, m] of list.entries()) {
    console.log(`[${i}] raw=${m.raw ?? '?'}  票=${m.ticket ?? '—'}`);
    console.log(`    ${String(m.what ?? '').replace(/\n/g, '\n    ')}`);
  }
  if (!list.length) console.log('（无 —— 该条不是 partial，或尚未逐条写缺口）');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 查询（原有行为）
// ---------------------------------------------------------------------------
let list = all;
if (has('--disposition')) list = list.filter((e) => e.disposition === val('--disposition'));
if (has('--ticket')) list = list.filter((e) => (e.ticket ?? '') === val('--ticket'));
if (has('--search')) list = list.filter((e) => JSON.stringify(e).includes(val('--search')));

if (has('--show')) {
  const e = findOne(val('--show'));
  if (!e) { console.error(`✗ 找不到 ${val('--show')}`); process.exit(1); }
  console.log(`### ${hex(e.opcode)}  ${e.mnemonic}${e.name ? ' ' + e.name : ''}`);
  console.log(`处置 **${e.disposition}**${e.ticket ? ` · 票 ${e.ticket}` : ''} · argc ${e.argc ?? '?'} · 文档状态 ${e.docStatus || '?'}`);
  console.log(`handler \`${e.handler || '?'}\`（体起始 raw ${e.handlerBodyLine ?? '?'}）\n`);
  console.log(e.note);
  process.exit(0);
}

if (has('--list')) {
  for (const e of list) {
    const s = String(e.note ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ');
    const miss = e.missing?.length ? `  missing×${e.missing.length}` : '';
    console.log(`${hex(e.opcode).padEnd(6)} ${(e.mnemonic || '').padEnd(9)} ${e.disposition.padEnd(16)} ${(e.ticket || '—').padEnd(7)} ${s.slice(0, 78)}${miss}`);
  }
  process.exit(0);
}

const by = {};
for (const e of all) by[e.disposition] = (by[e.disposition] ?? 0) + 1;
const missTotal = all.reduce((a, e) => a + (e.missing?.length ?? 0), 0);
console.log(`opcode 缺口台账：${all.length} 条 / ${(fs.statSync(FILE).size / 1024).toFixed(1)} KB`);
console.log('处置：' + Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' / '));
console.log(`missing[]：${missTotal} 条（分布在 ${all.filter((e) => e.missing?.length).length} 个条目上；逐条明细 --missing <opcode>）`);
console.log(`note 合计：${all.reduce((a, e) => a + (e.note ?? '').length, 0)} 字（★只在 JSON 里；md 只渲染裁到 120 字的一句话）`);
console.log('\n（--list / --show <opcode|mnemonic> / --missing <opcode> / --stale / --recount / --disposition <d> / --ticket T-xxxx / --search <串>）');
