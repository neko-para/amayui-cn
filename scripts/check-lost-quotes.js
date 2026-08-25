// 扫描「日文原文有引号，但译文丢失 / 引号数量不符」的行。
// 输入：extract-ja-zh-pairs.js 生成的汇总 CSV（列: 文件名 | 说话人名称 | 说话人ID | 日文原文 | 当前翻译）。
// 用法:
//   node check-lost-quotes.js [--in <agg.csv>] [--out <report.csv>]
// 输出报告列（report.csv）:
//   文件名, 说话人名称, 说话人ID, 日文原文, 当前翻译, 日文引号数, 译文引号数, 类别, 说明
// 类别:
//   LOST     日文有「」/『』外引号但译文完全无引号 —— 明确丢失
//   MISMATCH 日文与译文引号数量不同（译文仍有引号，但可能丢了嵌套/多余） —— 可疑
// 只输出有问题的行；无明显问题的行不计入。
import fs from 'node:fs';
import path from 'node:path';

function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  const pf = () => { row.push(cur); cur = ''; };
  const pr = () => { pf(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ',') pf(); else if (c === '\n') pr(); else if (c !== '\r') cur += c; }
  }
  if (cur !== '' || row.length) pr();
  return rows;
}
function csvField(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
const quoteCount = (s) => (s.match(/[「」『』]/g) || []).length;
const hasQuote = (s) => quoteCount(s) > 0;

const inPath = path.resolve(process.argv.includes('--in') ? process.argv[process.argv.indexOf('--in') + 1] : path.join(process.cwd(), '.tmp', 'ja-zh-all.csv'));
if (!fs.existsSync(inPath)) { console.error(`[FAIL] 输入不存在: ${inPath}`); process.exit(1); }
const outPath = path.resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : path.join(process.cwd(), '.tmp', 'lost-quotes-report.csv'));

const rows = parseCsv(fs.readFileSync(inPath, 'utf8'));
const header = rows[0];
const idxFile = header.indexOf('文件名');
const idxName = header.indexOf('说话人名称');
const idxSid = header.indexOf('说话人ID');
const idxJp = header.indexOf('日文原文');
const idxZh = header.indexOf('当前翻译');
if (idxJp < 0 || idxZh < 0) { console.error(`[FAIL] 输入列不符: ${JSON.stringify(header)}`); process.exit(1); }

const out = [['文件名', '说话人名称', '说话人ID', '日文原文', '当前翻译', '日文引号数', '译文引号数', '类别', '说明']];
let lost = 0;
const fileCnt = {};
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const jp = r[idxJp] ?? '';
  const zh = r[idxZh] ?? '';
  if (!hasQuote(jp)) continue; // 日文无引号，无需检查
  const cn = quoteCount(jp), zn = quoteCount(zh);
  // 关键：译文只要含任意“引号字形”（「」『』“”‘’），都视为转写，不算丢失。
  // 中文自然用弯引号 “ ” ‘ ’ 转写日文内引号「」/『』，这类不算丢失。
  const ANYQ = /[「」『』“”‘’]/;
  if (!ANYQ.test(zh)) {
    lost++;
    const f = r[idxFile];
    fileCnt[f] = (fileCnt[f] || 0) + 1;
    out.push([r[idxFile], r[idxName], r[idxSid], jp, zh, String(cn), '0', 'LOST', '日文有「」/『』引号但译文完全没有任何引号字形（含中文弯引号），引号丢失']);
  }
}

const csv = out.map((r) => r.map(csvField).join(',')).join('\n');
fs.writeFileSync(outPath, csv + '\n', 'utf8');
process.stdout.write(csv + '\n');

console.error(`\n# 问题行: LOST=${lost}`);
console.error(`# 已写入: ${outPath}`);
console.error(`# LOST 按文件分布 top: ${Object.entries(fileCnt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([f, c]) => c + 'x ' + f).join(', ')}`);
