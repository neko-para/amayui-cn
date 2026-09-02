#!/usr/bin/env node
// export-drinit-training-records.js
// 提取 DRINIT（训练所）的「单位 → 训练内容」表，导出为 CSV。
//
// 结构（逆向确认，见 docs/re/src/06-训练所数据.md）：
//   每个单位一个块，块头：
//     eq (local-int 0) (global-int f8c44) <unitId>     ← 训练对象单位 id（如 0x32 = 流燐结骑）
//     jcc (local-int 0) ffffffff label_00001ac0
//   随后是若干「训练内容」，每条 = 一个 set-string（该内容的描述文案）+ 若干 mov（meta 数值字段）：
//     set-string (global-string 1d49X) "文案"
//     mov (global-int K) V                                  ×N
//
// 关键约定（本脚本以此构建列）：
//   - TID = set-string 地址 − 0x1d490  → 该单位训练内容内的「槽位序号」（base 文件 1..54，追加文件从 55 续）。
//     注意：每个单位块都从 0x1d490 重新起算，所以 TID 是「块内槽」，不是全局 id；元数据寻址以此为准。
//   - 每条训练内容的元数据 mov：把 (K,V) 按「列 = K − TID（偏移）」归位到同名的列；
//     即「同一字段地址」的多条记录（跨单位、跨文件）落到同一列；某条没有该字段则留空。
//     （推断：K 以 global-int 地址编码为 base + TID，故不同单位/文件对同一字段的 mov 具有相同 K−TID。）
//
// 合并：加载 base DRINIT.txt 与追加 APPEND $1$..$5$DRINIT.txt（base + 追加按同一 unitId 合并）。
//   - 追加文件大多为空（仅 exit）；$3$DRINIT.txt 为 unit 32..35 补 TID 55..80、unit 37..38 补 55..60。
//   - CSV 有专门一列「来源」标识该行来自哪个文件。
//
// 用法: node scripts/export-drinit-training-records.js [--raw]
//   --raw  用 data/(原始日文原名)；缺省用 src/，文案取「日文|中文」。
// 输出: output/drinit-training-records.csv
//
// 列：来源,单位id,单位名,TID,文案(日),文案(中),训练名串地址, 然后每个「字段偏移（K−TID）」一列（值=该 mov 的 V，十六进制原值；无则空）。
//     表头 = 字段偏移（直接展示），已确认语义的字段再附加语义名（如「6c565d 数量」）。

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, DATA_DIR, ROOT_DIR } from './config.js';

const TID_BASE = 0x1d490;        // 训练内容「槽位」基数：TID = set-string 地址 − 0x1d490
const UNIT_RE_FILE = /drinit\.txt$/i;

// 已确认的字段语义（offset = K − TID → 含义）。表头 = offset +（若有语义则加空格 + 语义名）。
const FIELD_LABEL = {
  '6c55f9': '前置要求',
  '6c565d': '数量',
  '6c56c1': '类型 - 种族',
  '6c5725': '类型 - 性别',
  '6c5789': '类型 - 属性',
  '6c57ed': '等级',
  '6c6085': '效果 - 技能',
};
const fieldHeader = (off) => (FIELD_LABEL[off] ? `${off} ${FIELD_LABEL[off]}` : off);

// 6c5789 属性枚举（由「文案不含★的行」+「含★等级条件行」双重标定，见 docs/re/src/06-训练所数据.md §4b）
//   —— 仅用于把属性列的数值翻译成语义名（值仍是原 hex）。
const ATTR_NAME = {
  0x1: '物理', 0x2: '地脉', 0x3: '冷却', 0x4: '火炎',
  0x5: '电击', 0x6: '神圣', 0x7: '暗黑',
};

const useSrc = !process.argv.includes('--raw');
const root = useSrc ? SRC_DIR : DATA_DIR;

// ---------- 单位名表（EBINIT，用于把 unitId 展示成名字） ----------
const UNIT_NAME_BASE = 0x17ab6;
function loadUnitNames() {
  const m = new Map();
  for (const f of fs.readdirSync(root).filter((x) => /ebinit\.txt$/i.test(x)).sort()) {
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
  return { jp, zh };
}
const unitNames = loadUnitNames();
const unitName = (id) => {
  const raw = unitNames.get(UNIT_NAME_BASE + id);
  return raw ? disp(raw).jp : '';
};

// ---------- 扫描所有 DRINIT 文件 ----------
const files = fs.readdirSync(root).filter((x) => UNIT_RE_FILE.test(x)).sort();

// 每行记录：
//   { source, unitId, tid, addr, jp, zh, fields: Map<off16, value> }
const rows = [];
const fieldOffsets = new Set();   // 收集所有见过的字段偏「K-TID」，用于确定列

for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  const lines = text.split(/\r\n|\r|\n/);
  let curUnit = null;      // 当前 block 的 unitId（hex 字符串/数字）
  let curContent = null;   // 当前训练内容（含 fields 累积）

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // 块头：开始一个新单位
    const meq = l.match(/^eq \(local-int 0\) \(global-int f8c44\) ([0-9a-f]+)/);
    if (meq) {
      curUnit = parseInt(meq[1], 16);
      curContent = null;
      continue;
    }
    if (!curUnit) continue;   // 块头之前的行（header/exit 等）跳过

    const ms = l.match(/^set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/);
    if (ms) {
      const addr = parseInt(ms[1], 16);
      const tid = addr - TID_BASE;
      const { jp, zh } = disp(ms[2]);
      curContent = { source: f, unitId: curUnit, tid, addr, jp, zh, fields: new Map() };
      rows.push(curContent);
      continue;
    }

    const mm = l.match(/^mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (mm && curContent) {
      const k = parseInt(mm[1], 16);
      const off = k - curContent.tid;
      curContent.fields.set(off.toString(16), mm[2]);
      fieldOffsets.add(off.toString(16));
    }
  }
}

// ---------- 列序：字段偏移按十六进制数值升序（保证输出稳定） ----------
const fieldOrder = [...fieldOffsets].sort((a, b) => parseInt(a, 16) - parseInt(b, 16));

// ---------- 组 CSV ----------
// 合并后按「单位」再按「训练内容槽 TID」排序，使同一单位的训练课程连贯（base 1..54 → 追加 55..），
// 来源列单独标识每条来自哪个文件。
rows.sort((a, b) => (a.unitId - b.unitId) || (a.tid - b.tid));

const csv = [];
const push = (s) => csv.push(s);

const header = [
  '来源', '单位id', '单位名', 'TID', '文案(日)', '文案(中)', '训练名串地址',
  ...fieldOrder.map(fieldHeader),
];
// 属性列下标（若无则不追加解码列）
const attrIdx = fieldOrder.indexOf('6c5789');
const hasAttrDecode = attrIdx >= 0 && Object.keys(ATTR_NAME).length;
if (hasAttrDecode) header.push('属性(解码)');
push(header.map(csvCell).join(','));

for (const r of rows) {
  const line = [
    r.source,
    r.unitId.toString(16),
    unitName(r.unitId),
    r.tid.toString(16),
    r.jp,
    r.zh,
    r.addr.toString(16),
    ...fieldOrder.map((o) => r.fields.get(o) ?? ''),
  ];
  if (hasAttrDecode) {
    const v = r.fields.get('6c5789');
    line.push(v === undefined ? '' : (ATTR_NAME[parseInt(v, 16)] ?? `(未知${v})`));
  }
  push(line.map(csvCell).join(','));
}

fs.writeFileSync(path.join(ROOT_DIR, 'output', 'drinit-training-records.csv'), csv.join('\n') + '\n', 'utf8');

console.log(`已写出 output/drinit-training-records.csv`);
console.log(`文件数=${files.length}  单位块数=${new Set(rows.map((r) => r.source + '#' + r.unitId)).size}` +
  `  训练内容行=${rows.length}  字段列数=${fieldOrder.length}  单位=${new Set(rows.map((r) => r.unitId)).size}`);

// ---------- CSV 单元格转义 ----------
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
