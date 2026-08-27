#!/usr/bin/env node
// export-stinit-unit-records.js
// 把 STINIT 每个单位槽整理成 CSV：
//   第一列=地点名称（关卡名，来自 STINIT2，addr=0x121e2+mapNo）
//   第二列=单位名称（来自 EBINIT，addr=0x17ab6+unitId）
//   第3..N 列=单位 id 行【前部】的计数器列数据，按“与单位 id 行的间距偏移”对齐（无配置则留空）
//   第N+1..列=单位 id 行【后部】的字段数据（+0x1E 等级 / +0x3C / +0x5A）
//
// 结构（逆向确认）：
//   - 每个单位槽 = mov (global-int 14dd<0x40+i>) <unitId> 作为“单位 id 行”。
//   - 其【前部】计数器列：在 id 行之前、地址单调递减且落在 [K-0xF0,K] 窗口内的 mov，
//     offset = 单位 id 行地址 K - 该 mov 地址，取值均为 0x1E 的倍数：
//       核心列(几乎每条都有)：-0x78 / -0x96 / -0xD2 / -0xF0
//       附加列(遇特定遭遇才有)：-0x1E / -0x3C / -0x5A / -0xB4
//     所以前部最多 8 列，按 offset 从近到远排序：-0x1E, -0x3C, -0x5A, -0x78, -0x96, -0xB4, -0xD2, -0xF0。
//   - 其【后部】字段：+0x1E(单位等级) / +0x3C(未知) / +0x5A(多为1)，每条都写。
//
// 用法: node scripts/export-stinit-unit-records.js [--raw]
//   --raw  用 data/(原始日文原名) 而非 src/(日文|中文)；
//          缺省用 src/，单位/地点名取“日文 中文”。
// 输出: output/stinit-unit-records.csv

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, DATA_DIR, ROOT_DIR } from './config.js';

// ---------- 配置 ----------
// 前部/后部列定义见下方「组 CSV」段：offset(正数) 即距单位 id 行的间距，顺序即 CSV 列序。
// 前部为负偏移(单位id行地址 - offset)、后部为正偏移(单位id行地址 + offset)。
const UNIT_BASE = 0x17ab6;   // 单位名 addr = UNIT_BASE + unitId
const MAP_BASE = 0x121e2;    // 地点名 addr = MAP_BASE + mapNo
const UNIT_REG_BASE = 0x14dd00;
const UNIT_MIN = 0x41, UNIT_MAX = 0x5d;
const useSrc = !process.argv.includes('--raw');
const root = useSrc ? SRC_DIR : DATA_DIR;
const isMk = a => (a & 0xffffff00) === UNIT_REG_BASE && (a & 0xff) >= UNIT_MIN && (a & 0xff) <= UNIT_MAX;

// ---------- 名表 ----------
function loadNames(re) {
  const m = new Map();
  for (const f of fs.readdirSync(root).filter(x => re.test(x)).sort()) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    for (const x of t.matchAll(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/g)) {
      const a = parseInt(x[1], 16);
      if (!m.has(a)) m.set(a, x[2]);
    }
  }
  return m;
}
function disp(raw) {
  if (raw == null) return '';
  const i = raw.indexOf('|');
  const jp = i < 0 ? raw : raw.slice(0, i);
  const zh = i < 0 ? '' : raw.slice(i + 1);
  return zh && zh !== jp ? `${jp} ${zh}` : jp;
}
const unitNames = loadNames(/ebinit\.txt$/i);
const mapNames = loadNames(/stinit2\.txt$/i);
const unitName = id => disp(unitNames.get(UNIT_BASE + id));
const mapName = no => disp(mapNames.get(MAP_BASE + parseInt(no, 16)));

// ---------- 扫描所有 STINIT ----------
const files = fs.readdirSync(root).filter(x => /stinit\.txt$/i.test(x)).sort();
const rows = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  const lines = text.split(/\r\n|\r|\n/);
  // 建所有行（含 eq 与 mov），按行号顺序扫描
  const ops = []; // {line, kind:'map'|'mov', ...}
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const me = l.match(/eq \(local-int 0\) \(global-int b222\) ([0-9a-f]+)(\s|$)/);
    if (me) { ops.push({ line: i + 1, kind: 'map', mapNo: me[1] }); continue; }
    const mm = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (mm) { ops.push({ line: i + 1, kind: 'mov', addr: parseInt(mm[1], 16), val: parseInt(mm[2], 16) }); continue; }
  }
  // 值表：addr -> val（同文件内唯一）
  const val = new Map();
  for (const o of ops) if (o.kind === 'mov') val.set(o.addr, o.val);

  let curMap = null;
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx];
    if (op.kind === 'map') { curMap = op.mapNo; continue; }
    if (op.kind !== 'mov' || !isMk(op.addr)) continue;
    const K = op.addr;

    // 前部：从 id 行向前找单调递减、在窗口 [K-0xF0,K] 内的 mov
    let j = idx, last = K;
    const preFound = new Map(); // off -> val
    while (j > 0) {
      const a = ops[j - 1];
      if (a.kind === 'mov' && a.addr < last && a.addr >= K - 0xF0) { preFound.set(K - a.addr, a.val); last = a.addr; j--; }
      else break;
    }

    // 后部：从 id 行向后找单调递增、在窗口 [K,K+0xF0] 内的 mov
    let k = idx, last2 = K;
    const postFound = new Map(); // off -> val
    while (k + 1 < ops.length) {
      const a = ops[k + 1];
      if (a.kind === 'mov' && a.addr > last2 && a.addr <= K + 0xF0) { postFound.set(a.addr - K, a.val); last2 = a.addr; k++; }
      else break;
    }

    rows.push({ file: f, line: op.line, map: curMap, unitId: op.val, preFound, postFound });
  }
}

// ---------- 组 CSV ----------
// 列头：语义名(offset)，便于直接读数据。offset 为与单位 id 行的间距。
// 语义依据 docs/地图内单位.md §3.5–§3.9：
//   前部 -0x1E=可否刷怪刷新(1=可刷/2=出击旗/空=固定摆位)  -0x96=阵营(2=普通红/3=友方黄绿/4=敌方黄)
//        -0xD2=放置坐标行  -0xF0=放置坐标列
//   后部 +0x1E=等级下限  +0x3C=等级上限  +0x5A=未知(多恒为1)
const PRE_COL_DEF = [
  { off: 0x1e, name: '可否刷怪(1可刷/2出击/空固定)' },
  { off: 0x3c, name: '未知-3C' },
  { off: 0x5a, name: '未知-5A' },
  { off: 0x78, name: '结构-78' },
  { off: 0x96, name: '阵营(2普通红/3友方/4敌方)' },
  { off: 0xb4, name: '未知-B4' },
  { off: 0xd2, name: '坐标行(1-based)' },
  { off: 0xf0, name: '坐标列(1-based)' },
];
const POST_COL_DEF = [
  { off: 0x1e, name: '等级下限' },
  { off: 0x3c, name: '等级上限(+10)' },
  { off: 0x5a, name: '未知+5A' },
];
const preHeaders = PRE_COL_DEF.map(c => `前部-0x${c.off.toString(16).toUpperCase()} ${c.name}`);
const postHeaders = POST_COL_DEF.map(c => `后部+0x${c.off.toString(16).toUpperCase()} ${c.name}`);
const header = ['地点名称', '单位名称', ...preHeaders, ...postHeaders];

const csv = [header.join(',')];
for (const r of rows) {
  const map = r.map ? mapName(r.map) : '';
  const unit = unitName(r.unitId);
  const preCells = PRE_COL_DEF.map(c => r.preFound.has(c.off) ? r.preFound.get(c.off).toString(16) : '');
  const postCells = POST_COL_DEF.map(c => r.postFound.has(c.off) ? r.postFound.get(c.off).toString(16) : '');
  csv.push([map, unit, ...preCells, ...postCells].join(','));
}

// ---------- 写文件 ----------
const outDir = path.join(ROOT_DIR, 'output');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, useSrc ? 'stinit-unit-records.csv' : 'stinit-unit-records-cn.csv');
fs.writeFileSync(outPath, csv.join('\n'), 'utf8');

// ---------- 统计 ----------
const withPre = rows.filter(r => r.preFound.size > 0);
console.log(`源目录: ${root}`);
console.log(`单位记录行数 = ${rows.length}`);
console.log(`有前部计数器列的单位 = ${withPre.length}`);
console.log(`已写出: ${outPath}`);
console.log(`\n表头: ${header.join(' | ')}`);
console.log(`\n示例(前 8 行):`);
for (const r of rows.slice(0, 8)) {
  const pre = PRE_COL_DEF.map(c => r.preFound.has(c.off) ? r.preFound.get(c.off).toString(16) : '-').join(' ');
  const post = POST_COL_DEF.map(c => r.postFound.has(c.off) ? r.postFound.get(c.off).toString(16) : '-').join(' ');
  console.log(`  ${r.map ? mapName(r.map) : '?'} | ${unitName(r.unitId)} | 前:[${pre}] 后:[${post}]`);
}
