// 把「日文原文 — 当前翻译」对应表按日文键分组，导出同一日文出现在多处的内容。
// 输入：extract-ja-zh-pairs.js 生成的汇总 CSV（列: 文件名 | 日文原文 | 当前翻译）。
// 用法:
//   node group-ja-duplicates.js [--in <src.csv>] [--out <out.csv>]
// 输出:
//   - 按「日文原文」列排序；
//   - 只保留出现次数 ≥ 2 的日文键（唯一出现的行丢弃）；
//   - 每行第一列 = 说话人名称:说话人ID:日文原文（三元组，取含注音 <ruby> 的正文），
//     其后为成对的「命中」列（列 2&3、4&5、… / 表示第 k、k+1 列）：
//     奇数列 = 命中章节（来源文件），偶数列 = 该处当前中文翻译。
//   - 每个键的命中数不同，行内按最大命中数补齐（不足的尾部列留空）。
//   - 另按「该键所有真实命中译文是否全部一致」拆分输出两张表：
//     *-consistent.csv = 译文完全一致；*-differ.csv = 存在 ≥2 种不同译文。
//
// 环境: 任意目录运行；默认读 .tmp/ja-zh-all.csv，写 .tmp/ja-duplicates.csv。

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log('用法: node group-ja-duplicates.js [--in <src.csv>] [--out <out.csv>]');
}

function parseArgs(argv) {
  const opts = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') opts.in = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { usage(); process.exit(1); }
  }
  return opts;
}

// RFC 4180 CSV 解析（字段可含逗号/引号/换行）。
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  const pushField = () => { row.push(cur); cur = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') pushField();
      else if (c === '\n') pushRow();
      else if (c !== '\r') cur += c;
    }
  }
  if (cur !== '' || row.length) pushRow();
  return rows;
}

// RFC 4180 CSV 字段转义。
function csvField(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const opts = parseArgs(process.argv.slice(2));
const srcPath = path.resolve(opts.in || path.join(process.cwd(), '.tmp', 'ja-zh-all.csv'));
if (!fs.existsSync(srcPath)) {
  console.error(`[FAIL] 输入 CSV 不存在: ${srcPath}\n提示: 先运行 node scripts/extract-ja-zh-pairs.js --all --out .tmp/ja-zh-all.csv`);
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(srcPath, 'utf8'));
if (!rows.length) { console.error('[FAIL] 空输入'); process.exit(1); }
const header = rows[0];
const idxFile = header.indexOf('文件名');
const idxName = header.indexOf('说话人名称');
const idxSid = header.indexOf('说话人ID');
const idxJp = header.indexOf('日文原文');
const idxZh = header.indexOf('当前翻译');
if (idxJp < 0 || idxZh < 0 || idxFile < 0 || idxName < 0 || idxSid < 0) {
  console.error(`[FAIL] 输入列不符合预期: ${JSON.stringify(header)}`);
  console.error('需要: 文件名 / 说话人名称 / 说话人ID / 日文原文 / 当前翻译');
  process.exit(1);
}

// 按「说话人名称:说话人ID:日文原文」三元组分键：{ key: [ { key, name, sid, jp, zh } ] }。
// 键内分隔符用不可见字符 \u0001，避免与名称/正文中的 `:` 冲突；展示时再还原为 `:`。
const SEP = '\u0001';
const groups = new Map();
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (r.length < Math.max(idxJp, idxZh, idxFile, idxName, idxSid) + 1) continue;
  const name = r[idxName];
  const sid = r[idxSid];
  const jp = r[idxJp];
  const key = `${name}${SEP}${sid}${SEP}${jp}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ key, name, sid, jp, file: r[idxFile], zh: r[idxZh] });
}

// 只保留出现次数 ≥ 2 的键（同一说话人说同一句才去重）。
// 排序按「名称 → 说话人ID → 正文」。
const dups = [...groups.entries()]
  .map(([k, hits]) => ({ key: k, hits, head: hits[0] }))
  .filter(({ hits }) => hits.length >= 2);
let coll;
try { coll = new Intl.Collator('ja', { sensitivity: 'base' }); } catch { coll = { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) }; }
dups.sort((a, b) =>
  coll.compare(a.head.name, b.head.name) ||
  coll.compare(a.head.sid, b.head.sid) ||
  coll.compare(a.head.jp, b.head.jp)
);

// 每个键的命中按其来源文件排序，便于并列比对。
for (const { hits } of dups) hits.sort((a, b) => coll.compare(a.file, b.file));

const maxHits = dups.reduce((m, { hits }) => Math.max(m, hits.length), 0);

// 输出表头：第一列 = 「说话人名称:说话人ID:日文原文」三元组，其后每命中一对 (章节, 当前翻译)。
const cols = ['说话人名称:说话人ID:日文原文（出现多次）'];
for (let k = 1; k <= maxHits; k++) cols.push(`章节_${k}`, `当前翻译_${k}`);

const out = [cols];
for (const { key, hits } of dups) {
  const line = [key.split(SEP).join(':')];
  for (const h of hits) line.push(h.file, h.zh);
  while (line.length < cols.length) line.push(''); // 补齐到最大命中数
  out.push(line);
}

const csv = out.map((r) => r.map(csvField).join(',')).join('\n');
const outPath = path.resolve(opts.out || path.join(process.cwd(), '.tmp', 'ja-duplicates.csv'));
fs.writeFileSync(outPath, csv + '\n', 'utf8');

// —— 按「该键所有真实命中译文是否全部一致」拆分为两张表 ——
// 真实命中 = 非填充列（章节名为文件名，命中必有值；填充位章节与译文均为空）。
// 一致表：所有真实命中的译文完全相同；不一致表：存在 ≥2 种不同译文。
const CONSISTENT_PATH = path.resolve(opts.out || path.join(process.cwd(), '.tmp', 'ja-duplicates-consistent.csv'));
const DIFFER_PATH = path.resolve(opts.out || path.join(process.cwd(), '.tmp', 'ja-duplicates-differ.csv'));

const consistentRows = [cols];
const differRows = [cols];
for (const { key, hits } of dups) {
  const line = [key.split(SEP).join(':')];
  for (const h of hits) line.push(h.file, h.zh);
  while (line.length < cols.length) line.push('');
  const zhSet = new Set(hits.map((h) => h.zh).filter((z) => z !== ''));
  (zhSet.size <= 1 ? consistentRows : differRows).push(line);
}
const writeCsv = (pathStr, rowsArr) =>
  fs.writeFileSync(pathStr, rowsArr.map((r) => r.map(csvField).join(',')).join('\n') + '\n', 'utf8');
writeCsv(CONSISTENT_PATH, consistentRows);
writeCsv(DIFFER_PATH, differRows);

const singleTotal = dups.reduce((s, { hits }) => s + hits.length, 0);
console.error(`# 重复键（名称:ID:正文）: ${dups.length}；单键最大命中: ${maxHits}；重复键累计命中行: ${singleTotal}`);
console.error(`# 已写入: ${outPath}`);
console.error(`# 拆分: 译文一致表 ${CONSISTENT_PATH}（${consistentRows.length - 1} 键）；译文不一致表 ${DIFFER_PATH}（${differRows.length - 1} 键）`);
process.stdout.write(csv + '\n');
