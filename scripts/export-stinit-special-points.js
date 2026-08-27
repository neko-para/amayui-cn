#!/usr/bin/env node
// export-stinit-special-points.js
// 提取 STINIT 每关的「地图特殊点位」(采集/挖掘/出击门/陷阱…)坐标与跟随数字。
//
// 结构（逆向确认，见 docs/地图内单位.md §3.10）：
//   每个地图块 `eq ... b222 <mapNo>` 之后有一段特殊点位记录，其寄存器按点位索引 k 逐条 +1：
//     列 = 14d740 + k        (相对 0x14d740 偏移 +0x00 + k)
//     行 = 14d772 + k        (偏移 +0x32 + k)
//     类型 = 14d7a4 + k      (偏移 +0x64 + k)
//     跟随数字 = 类型之后由各点类型决定的附加字段（+0xC9/+0xFB、+0x131/+0x163、+0x0C8…，
//                另有一条 +0x190 恒为 7 的常量尾，不计入跟随数字）。
//   - 跟随数字个数不定：0/1/2/3（最常见 1/2），故按“实际出现”输出若干列，不再固定 3。
//
// 用法: node scripts/export-stinit-special-points.js [--raw]
//   --raw  用 data/(原名)。缺省用 src/。
// 输出: output/stinit-special-points.csv
//
// 列：地图号, 地图名, 序号k, 列, 行, 类型, 跟随数1..N（每个点位按出现顺序，最多随实际个数）
// 说明：点数/跟随数字因地图而异；CSV 列数取全量最大跟随数。

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, DATA_DIR, ROOT_DIR } from './config.js';

const useSrc = !process.argv.includes('--raw');
const root = useSrc ? SRC_DIR : DATA_DIR;
const MAP_BASE = 0x121e2;
const isColReg = a => (a & 0xffffff00) === 0x14d740 && (a & 0xff) <= 0x6e; // 14d740..14d76d

// 名表（地图名）
function loadMapNames() {
  const m = new Map();
  for (const f of fs.readdirSync(root).filter(x => /stinit2\.txt$/i.test(x)).sort()) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    for (const x of t.matchAll(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/g)) {
      const a = parseInt(x[1], 16);
      if (!m.has(a)) m.set(a, x[2]);
    }
  }
  return m;
}
const mapNames = loadMapNames();
function disp(raw) {
  if (raw == null) return '';
  const i = raw.indexOf('|');
  const jp = i < 0 ? raw : raw.slice(0, i);
  const zh = i < 0 ? '' : raw.slice(i + 1);
  return zh && zh !== jp ? `${jp} ${zh}` : jp;
}
const mapName = no => disp(mapNames.get(MAP_BASE + parseInt(no, 16)));

const files = fs.readdirSync(root).filter(x => /stinit\.txt$/i.test(x)).sort();

// 全量记录：逐文件、逐地图块收集点位，并统计最大跟随数字数
const allRows = [];   // {mapNo, mapName, k, col, row, type, trail[]}
let maxFollow = 0;
let mapCount = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  const lines = text.split(/\r\n|\r|\n/);
  // 顺序扫描：op 流含 map( eq b222 ) 与 mov
  const ops = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (!l.trim()) continue;
    const me = l.match(/eq \(local-int 0\) \(global-int b222\) ([0-9a-f]+)(\s|$)/);
    if (me) { ops.push({ line: i + 1, kind: 'map', mapNo: me[1] }); continue; }
    const mm = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (mm) { ops.push({ line: i + 1, kind: 'mov', addr: parseInt(mm[1], 16), val: parseInt(mm[2], 16) }); continue; }
  }
  // 按“地图块”切分：[map header] .. [下一 map header]；点位在块内、addr<0x14dc00。
  const headersIdx = ops.map((o, i) => ({ o, i })).filter(x => x.o.kind === 'map');
  for (let bi = 0; bi < headersIdx.length; bi++) {
    const start = headersIdx[bi].i;
    const end = bi + 1 < headersIdx.length ? headersIdx[bi + 1].i : ops.length;
    const mapNo = ops[start].mapNo;
    mapCount++;
    let cur = null;
    let k = 0;
    for (let idx = start; idx < end; idx++) {
      const op = ops[idx];
      if (op.kind !== 'mov') continue;
      // 单位计数器区(14dc00..14dcff)才表示特殊点位块结束；14e0xx 等配置寄存器不是边界。
      if (op.addr >= 0x14dc00 && op.addr < 0x14dd00) break;
      if (op.addr < 0x14d740) continue;             // 未到特殊点位区
      const off = op.addr - 0x14d740;
      // 列寄存器恰好 14d740+k (off==k)，开启第 k 个点位。
      if (off === k) {
        if (cur) allRows.push({ ...cur, mapNo });
        cur = { k, col: op.val, row: null, type: null, trail: [], trailOff: [] };
        k++;
        continue;
      }
      if (!cur) continue;
      const curK = k - 1;                            // 当前点的索引
      if (off === 0x32 + curK) { cur.row = op.val; continue; }   // 行
      if (off === 0x64 + curK) { cur.type = op.val; continue; }  // 类型
      if (cur.trailStopped) continue;                               // 已越过常量尾，不再收
      if (off >= 0x190 + curK && off <= 0x197 + curK) { cur.trailStopped = true; continue; } // 常量尾(=7)
      if (off >= 0xc9 && off <= 0x197) {                            // 跟随数字
        cur.trail.push(op.val);
        cur.trailOff.push(off);
      }
    }
    if (cur) allRows.push({ ...cur, mapNo });
    cur = null;
  }
}
// 汇总：给每个点计算 maxFollow
for (const r of allRows) if (r.trail.length > maxFollow) maxFollow = r.trail.length;

// ---------- 类型映射（type → 中文名，用户提供） ----------
// 可识别的类型在 CSV「类型」列补括号注释；未在表内的保持原值。
const TYPE_MAP = {
  '2': '出击门',
  '5': '刷怪旋涡',
  '8': '宝物堆',
  'f': '治愈点',
  '17': '陷阱',
  '1f': '采集点',
  '20': '挖掘点',
  '29': '枯萎的嫩芽',
  '2a': '破损的石碑',
  '60': '女神卡',
};
function typeLabel(hex) {
  if (!hex) return '';
  const label = TYPE_MAP[hex];
  return label ? `${hex}(${label})` : hex;
}

// 组 CSV
const cols = ['地图号', '地图名', '点序号', '列', '行', '类型'];
for (let j = 0; j < maxFollow; j++) cols.push(`跟随${j + 1}`);
const header = cols.join(',');

let csv = [header];
for (const r of allRows) {
  const row = [r.mapNo ?? '', mapName(r.mapNo) ?? '', r.k ?? '', (r.col ?? '').toString(16), (r.row ?? '').toString(16), typeLabel((r.type ?? '').toString(16))];
  for (let j = 0; j < maxFollow; j++) row.push(j < r.trail.length ? r.trail[j].toString(16) : '');
  csv.push(row.join(','));
}
const outDir = path.join(ROOT_DIR, 'output');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'stinit-special-points.csv');
fs.writeFileSync(outPath, csv.join('\n'), 'utf8');

console.log(`源目录: ${root}`);
console.log(`地图数 = ${mapCount}`);
console.log(`特殊点位总数 = ${allRows.length}`);
console.log(`最大跟随数字数 = ${maxFollow}`);
console.log(`已写出: ${outPath}`);
console.log(`\n表头: ${header}`);
console.log(`\n示例(前 12 个点):`);
for (const r of allRows.slice(0, 12)) {
  console.log(`  map${r.mapNo} ${mapName(r.mapNo)}  #${r.k} 列=0x${(r.col ?? '').toString(16)} 行=0x${(r.row ?? '').toString(16)} 类型=0x${(r.type ?? '').toString(16)}  跟随=[${r.trail.map(x => x.toString(16)).join(',')}]`);
}
