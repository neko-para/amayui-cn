#!/usr/bin/env node
// extract-unit-drops.js
// 从 data/EBINIT.txt 抽取每个单位的"掉落物表"，并用 metadata/items.json 反查物品名。
//
// 结构（本次逆向确认）：
//   - EBINIT 由 264 个单位块构成。每块以一个"名字串 + 副标题串"的相邻 set-string 对开头：
//         set-string (global-string 17a-17e) "单位名"        ← 名字，地址 0x17a00..0x17eff
//         set-string (global-string 17f-181) "阵营/种族/说明" ← 副标题，地址 0x17f00..
//     名字地址 < 副标题地址。
//   - 每个单位块里有一段"掉落表"：若干条交错排列的 mov，按 (rate@53eXXX, item@53dXXX) 两两配对，
//     且 rate 地址、item 地址各自逐条 +1：
//         mov (global-int 53eXXX) <rate>    ← 掉落率/权重（53e0xx..53efff，随单位变）
//         mov (global-int 53dXXX) <itemId>  ← 掉落物品 id（53d0xx..53dfff，随单位变，用 items.json 反查）
//     其后必跟一条 51xx/52xx 数据块行（技能指针表）。
//     掉落条目数可变（多为 3~5 条，也有 1 条）。
//
// 用法: node scripts/extract-unit-drops.js
// 输出: metadata/unit-drops.json

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const DATA_DIR = path.join(ROOT_DIR, 'data');
const META_DIR = path.join(ROOT_DIR, 'metadata');
const EBINIT_FILE = path.join(DATA_DIR, 'EBINIT.txt');
const ITEMS_JSON = path.join(META_DIR, 'items.json');
const OUT_JSON = path.join(META_DIR, 'unit-drops.json');

const items = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8')).items;
const itemName = new Map(items.map(i => [i.id, i.name]));

// ---------- 解析为顺序指令流 ----------
const lines = fs.readFileSync(EBINIT_FILE, 'utf8').split(/\r\n|\r|\n/);
const ops = []; // {line, kind:'name'|'sub'|'str'|'mov', addr, value?, valueRaw?, name?}
for (let idx = 0; idx < lines.length; idx++) {
  const l = lines[idx];
  if (!l.trim()) continue;
  const ms = l.match(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/);
  if (ms) {
    const addr = parseInt(ms[1], 16);
    const kind = (addr >= 0x17a00 && addr < 0x17f00) ? 'name'
               : (addr >= 0x17f00 && addr < 0x18200) ? 'sub'
               : 'str';
    ops.push({ line: idx + 1, kind, addr, name: ms[2] });
    continue;
  }
  const mm = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
  if (mm) {
    ops.push({ line: idx + 1, kind: 'mov', addr: parseInt(mm[1], 16), value: parseInt(mm[2], 16), valueRaw: mm[2] });
    continue;
  }
}

// ---------- 单位边界：相邻 (name,sub) set-string 对 ----------
function isNameOp(op) { return op.kind === 'name'; }
function isSubOp(op)  { return op.kind === 'sub'; }

const unitHeaders = [];
for (let i = 0; i < ops.length - 1; i++) {
  if (isNameOp(ops[i]) && isSubOp(ops[i + 1])) {
    unitHeaders.push({ start: i, nameOp: ops[i], subOp: ops[i + 1] });
  }
}

// ---------- 掉落表检测 ----------
const isItem = a => (a & 0xffff000) === 0x53d000;   // 53dxxx
const isRate = a => (a & 0xffff000) === 0x53e000;   // 53exxx

// 在一个片段内收集第 startIdx..endIdx（不含 endIdx）：扫描找 [rate@53e,item@53d] 双+1 的游程。
function extractDrops(startIdx, endIdx) {
  const kEnd = Math.min(endIdx, ops.length);
  const pairs = [];
  let k = startIdx;
  let lastRate = null, lastItem = null;
  // 先向前扫描，直到找到第一条 (rate,item) 对（其间忽略无关 mov）
  while (k + 1 < kEnd) {
    const r = ops[k], it = ops[k + 1];
    if (r.kind === 'mov' && it.kind === 'mov' && isRate(r.addr) && isItem(it.addr)) {
      break;
    }
    k++;
  }
  // 从第一条对开始，连续收集"双 +1"的后续对
  while (k + 1 < kEnd) {
    const r = ops[k], it = ops[k + 1];
    if (r.kind === 'mov' && it.kind === 'mov' && isRate(r.addr) && isItem(it.addr)
        && (lastRate === null || (r.addr === lastRate + 1 && it.addr === lastItem + 1))) {
      pairs.push({ rate: r, item: it });
      lastRate = r.addr; lastItem = it.addr; k += 2;
      continue;
    }
    break;
  }
  return pairs;
}

// ---------- 遍历单位块 ----------
const units = [];
for (let u = 0; u < unitHeaders.length; u++) {
  const h = unitHeaders[u];
  const start = h.start;
  const end = (u + 1 < unitHeaders.length) ? unitHeaders[u + 1].start : ops.length;
  const pairs = extractDrops(start + 2, end);
  const drops = pairs.map(({ rate, item }) => ({
    itemId: item.value,
    itemRaw: item.valueRaw,
    rate: rate.value,
    rateRaw: rate.valueRaw,
    name: itemName.get(item.value) ?? null,
  }));
  units.push({
    unitId: h.nameOp.addr,
    name: h.nameOp.name,
    title: h.subOp.name,
    nameLine: h.nameOp.line,
    drops,
  });
}

const withDrops = units.filter(u => u.drops.length > 0);
console.log('单位块数 =', units.length, '  含掉落表的单位数 =', withDrops.length);

fs.mkdirSync(META_DIR, { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify({
  _comment: 'EBINIT 单位掉落物。unitId=名字串地址(0x17axx..0x17exx)；drops=[{itemId,itemRaw,rate,rateRaw,name}]；drops 为交错 (rate@53eXXX,item@53dXXX) 双+1 配对，rate=掉落率/权重未知语义。',
  count: withDrops.length,
  units: withDrops,
}, null, 2), 'utf8');
console.log('已写出', OUT_JSON);

// 校验：无 null 名、去重统计
let nulls = 0; const bins = new Set();
for (const u of withDrops) for (const d of u.drops) { if (!d.name) nulls++; bins.add(d.itemId); }
console.log('无名(null)掉落 =', nulls, '  去重掉落物 id 数 =', bins.size);

// 采样展示若干单位（含 3~5 掉落的主要单位）
console.log('\n===== 采样展示 =====');
for (const u of withDrops.filter(x => x.drops.length >= 3).slice(0, 14)) {
  console.log(`\n[#${u.unitId.toString(16)}] ${u.name}  〈${u.title}〉  (line ${u.nameLine})`);
  for (const d of u.drops) console.log(`   item 0x${d.itemRaw} = ${d.name}   rate 0x${d.rateRaw} (${d.rate})`);
}
