#!/usr/bin/env node
// export-mpinit-maps.js
// 提取 MPINIT（地图地板数据）每张地图/子网格的大小参数与 copy-local-array 填值统计。
//
// 结构（见 docs/re/src/08-地图地板数据.md）：
//   地图 id = `eq (local-int 0) (global-int b228) X` + `eq (local-int 1) (global-int b229) Y`（地点+序号）。
//   地图大小参数 = `mov (global-int 5cd85) <列数>` / `mov (global-int 5cd86) <行数>`。
//   地板数据 = 紧随其后的若干条 `copy-local-array (global-int <addr>) [...]`：
//     条数 = 2×行数，每元素数 = 2×列数；首址 0x5bd46，步长 0x41。
//   复合块：同一 (b228,b229) 守卫内可能含多组「mov 5cd85/5cd86 + 一批数组」子网格（如 (0x56,0x3)），
//     按每对 mov 5cd85/5cd86 切一个子网格。
//
// 用法: node scripts/export-mpinit-maps.js [--raw]
//   --raw 用 data/；缺省用 src/。
// 输出: output/mpinit-map-summary.csv

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, DATA_DIR, ROOT_DIR } from './config.js';

const useSrc = !process.argv.includes('--raw');
const root = useSrc ? SRC_DIR : DATA_DIR;
const BASE_ADDR = 0x5bd46;   // 首数组基址
const STRIDE = 0x41;         // 行间步长

const files = fs.readdirSync(root).filter((x) => /mpinit\.txt$/i.test(x)).sort();

// 解析单个 MPINIT：返回 [{file, loc, seq, subIdx, cols, rows, baseAddr, stride, nArr, lenArr, arrSizes, values}]
const records = [];

for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  const lines = text.split(/\r\n|\r|\n/);
  let block = null;      // {loc, seq, sub}
  let sub = null;        // 当前子网格 {cols, rows, arrAddr[], arrVals[]}
  const commitSub = () => {
    if (!sub || !sub.arrAddr.length) return;
    // 校验 2x 关系
    const nArr = sub.arrAddr.length;
    const lenArr = sub.arrVals[0].length;
    const valSet = new Set();
    for (const a of sub.arrVals) for (const v of a) valSet.add(v);
    records.push({
      file: f, loc: block.loc, seq: block.seq, subIdx: sub.subIdx,
      cols: sub.cols, rows: sub.rows,
      nArr, lenArr,
      baseAddr: sub.arrAddr[0], stride: sub.arrAddr.length > 1 ? sub.arrAddr[1] - sub.arrAddr[0] : null,
      nvals: valSet.size, vals: [...valSet].sort((a, b) => parseInt(a, 16) - parseInt(b, 16)),
    });
    sub = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const mLoc = l.match(/^eq \(local-int 0\) \(global-int b228\) ([0-9a-f]+)/);
    if (mLoc) {
      commitSub();
      block = { loc: mLoc[1], seq: null, subIdx: 0 };
      sub = null;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const mSeq = lines[j].match(/^eq \(local-int 1\) \(global-int b229\) ([0-9a-f]+)/);
        if (mSeq) { block.seq = mSeq[1]; break; }
      }
      continue;
    }
    if (!block) continue;
    const mCols = l.match(/^mov \(global-int 5cd85\) ([0-9a-f]+)/);
    if (mCols) { commitSub(); sub = { cols: mCols[1], rows: null, arrAddr: [], arrVals: [], subIdx: block.subIdx++ }; continue; }
    const mRows = l.match(/^mov \(global-int 5cd86\) ([0-9a-f]+)/);
    if (mRows) { if (sub) sub.rows = mRows[1]; continue; }
    const mArr = l.match(/^copy-local-array \(global-int ([0-9a-f]+)\) \[(.*)\]/);
    if (mArr) { if (sub) { sub.arrAddr.push(parseInt(mArr[1], 16)); sub.arrVals.push(mArr[2].split(/\s+/)); } }
  }
  commitSub();
}

// 汇总校验
let bad = 0;
for (const r of records) {
  const cols = parseInt(r.cols, 16), rows = parseInt(r.rows, 16);
  if (r.nArr !== 2 * rows || r.lenArr !== 2 * cols) bad++;
  if (r.baseAddr !== BASE_ADDR || (r.stride !== null && r.stride !== STRIDE)) bad++;
}

// CSV
const cols = ['文件', '地点id(b228)', '序号(b229)', '子网格', '列数(5cd85)', '行数(5cd86)', '数组条数(=2×行)', '每数组长度(=2×列)', '首址', '步长', '独立值数', '取值集合'];
const esc = (v) => String(v).replace(/,/g, ';');
const csv = [cols.join(',')];
for (const r of records) {
  csv.push([
    esc(r.file), esc(r.loc), esc(r.seq), esc(r.subIdx), esc(r.cols), esc(r.rows),
    esc(r.nArr), esc(r.lenArr),
    '0x' + r.baseAddr.toString(16), r.stride === null ? '' : '0x' + r.stride.toString(16),
    esc(r.nvals), esc(r.vals.join(' ')),
  ].join(','));
}

const outDir = path.join(ROOT_DIR, 'output');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'mpinit-map-summary.csv');
fs.writeFileSync(outPath, csv.join('\n'), 'utf8');

console.log(`源目录: ${root}`);
console.log(`子网格数 = ${records.length}`);
console.log(`违反「条数=2×行 / 每条=2×列 / 首址6bd46 / 步长41」的数量 = ${bad}`);
console.log(`已写出: ${outPath}`);
console.log('\n示例(前 20 个子网格):');
for (const r of records.slice(0, 20)) {
  console.log(`  ${r.file.replace(/^.*[\\/]/, '')} (${r.loc},${r.seq}) #${r.subIdx} ${r.cols}列×${r.rows}行  [${r.nArr}条 × ${r.lenArr}元]  取值[${r.vals.join(' ')}]`);
}
