// 从译文不一致表提取「短句」：日文原文在排除符号后，汉字/假名不超过阈值的行。
// 输入：group-ja-duplicates.js 生成的 *-differ.csv（列: 名称:ID:正文 … | 章节_k | 当前翻译_k …）。
// 用法:
//   node extract-short-lines.js [--in <differ.csv>] [--out <short.csv>] [--max <n>]
//   [--min <n>] [--name-only]
// 说明:
//   - 第一列「名称:ID:正文」中，正文 = 第 3 个冒号之后的内容。
//   - 「排除符号后的汉字/假名数」按以下口径统计（参数 --name-only 只统计名称，略去正文）；
//     · 去掉 <ruby>/</ruby> 标签；
//     · 去掉 <rt>…</rt> 注音（读音/释义为注释，不计入正文长度）；
//     · 不计 \uE000–\uE010（游戏外字/省略号占位）与全部标点、空格、引号、假名以外的日文符号；
//     · 只统计汉字（CJK 表意）与假名（平/片假名）。
//   - 输出 = 命中行数符合阈值的整行（保留与输入一致的列结构），默认写 *-short.csv。
//   - --min <n> 也可配合：只输出 [min, max] 区间内的行。
//
// 环境: 任意目录运行；默认读 todo/ja-duplicates-differ.csv，写 todo/ja-duplicates-differ-short.csv。

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log('用法: node extract-short-lines.js [--in <differ.csv>] [--out <short.csv>] [--max <n>] [--min <n>] [--name-only]');
}

function parseArgs(argv) {
  const opts = { in: null, out: null, max: 3, min: 0, nameOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') opts.in = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--max') opts.max = parseInt(argv[++i], 10);
    else if (a === '--min') opts.min = parseInt(argv[++i], 10);
    else if (a === '--name-only') opts.nameOnly = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { usage(); process.exit(1); }
  }
  return opts;
}

// RFC 4180 CSV 解析。
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

function csvField(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// 从「名称:ID:正文」拆分出 { name, sid, jp }。
function splitKey(key) {
  const i1 = key.indexOf(':');
  const i2 = key.indexOf(':', i1 + 1);
  return { name: key.slice(0, i1), sid: key.slice(i1 + 1, i2), jp: key.slice(i2 + 1) };
}

// 统计排除符号后的汉字/假名数。
// body 为含 <ruby>/<rt> 标记的原文；去掉 ruby 标签与 rt 注音后，只数汉字+假名。
function countKanakana(body) {
  if (body == null) return 0;
  const stripped = body
    .replace(/<rt>[\s\S]*?<\/rt>/g, '') // 去掉注音（rt…/rt）
    .replace(/<\/?ruby>/g, '');         // 去掉 ruby 标签
  const m = stripped
    .split('')
    .filter((ch) => /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(ch));
  return m.length;
}

const opts = parseArgs(process.argv.slice(2));
const inPath = path.resolve(opts.in || path.join(process.cwd(), 'todo', 'ja-duplicates-differ.csv'));
if (!fs.existsSync(inPath)) {
  console.error(`[FAIL] 输入 CSV 不存在: ${inPath}`);
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(inPath, 'utf8'));
if (!rows.length) { console.error('[FAIL] 空输入'); process.exit(1); }
const header = rows[0];

const outRows = [header];
const kept = [];
let total = 0;
const countBy = new Map();
for (let i = 1; i < rows.length; i++) {
  total++;
  const r = rows[i];
  const { name, jp } = splitKey(r[0]);
  const n = opts.nameOnly ? countKanakana(name) : countKanakana(jp);
  const inRange = n >= opts.min && n <= opts.max;
  if (inRange) {
    outRows.push(r);
    kept.push({ n, key: r[0] });
  }
  countBy.set(n, (countBy.get(n) || 0) + 1);
}

const outPath = path.resolve(opts.out || path.join(process.cwd(), 'todo', 'ja-duplicates-differ-short.csv'));
const csv = outRows.map((r) => r.map(csvField).join(',')).join('\n');
fs.writeFileSync(outPath, csv + '\n', 'utf8');

console.error(`# 输入: ${inPath}`);
console.error(`# 范围: [${opts.min}, ${opts.max}] 汉字/假名（${opts.nameOnly ? '仅名称' : '正文'}；不含注音与符号）`);
console.error(`# 总行: ${total}；命中并写出: ${kept.length}（${outPath}）`);
const hist = [...countBy.entries()].sort((a, b) => a[0] - b[0])
  .map(([k, v]) => `${k}:${v}`).join(' ');
console.error(`# 计数分布（汉字/假名 -> 行数）: ${hist}`);
process.stdout.write(csv + '\n');
