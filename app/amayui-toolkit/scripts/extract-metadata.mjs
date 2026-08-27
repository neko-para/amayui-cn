#!/usr/bin/env node
/**
 * extract-metadata.mjs
 * 从工程根 `src/`（权威数据源）提取并归一化游戏元数据 → `app/amayui-toolkit/public/data/metadata.json`。
 *
 * 产物是**单一、统一、带中文名**的元数据，是前端 `fetch('./data/metadata.json')` 直接消费的数据。
 * 该文件为**衍生物**（`src/` 是权威源；CI 在 deploy 分支构建时重新生成），`public/` 已 gitignore。
 *
 * 关键事实（逆向确认）：
 *   - 名称来自 `src` 的 `set-string (global-string <addr>) "日文|中文"`（管道分隔）：
 *       物品 id = addr − 0x18e40；建筑/设施 id = addr − 0x1f5ba。
 *   - 配方表 ALINIT：每行 = 行标记(1 物品|2 建筑) + 产品(id) + 若干元数据(6b*) + {材料id,数量}*。
 *   - 单位 EBINIT：相邻 (名字串 17a-17e, 副标题串 17f-181) 的一组 set-string 对开新块；
 *       掉落表 = 交错 (rate@53eXXX, item@53dXXX) 双 +1 配对。
 *
 * 用法: node scripts/extract-metadata.mjs
 *   （可覆盖：`AMAYUI_SRC_DIR`、`AMAYUI_OUT_DIR`）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');                 // app/amayui-toolkit
const PROJECT_ROOT = path.resolve(APP_ROOT, '..', '..');        // 工程根
const SRC_DIR = path.resolve(process.env.AMAYUI_SRC_DIR || path.join(PROJECT_ROOT, 'src'));
const OUT_DIR = path.resolve(process.env.AMAYUI_OUT_DIR || path.join(APP_ROOT, 'public/data'));
const OUT_FILE = path.join(OUT_DIR, 'metadata.json');

const BASE_ITEM = 0x18e40;        // 物品 id 基数
const BASE_BUILDING = 0x1f5ba;    // 建筑/设施 id 基数
const ITEM_ADDR_MAX = 0x1a000;    // 物品名地址上限
const SCHEMA_VERSION = 2;         // v2：新增 maps/mapUnits

/* ------------------------- 名称解析（src set-string "日|中"） ------------------------- */

/** 解析一行 `set-string (global-string <addr>) "jp|zh"` → {addr,name,nameZh} | null */
function parseNameLine(line) {
  const m = line.match(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/);
  if (!m) return null;
  const addr = parseInt(m[1], 16);
  const seg = m[2];
  const i = seg.indexOf('|');
  const name = i < 0 ? seg : seg.slice(0, i);
  const nameZh = i < 0 ? seg : seg.slice(i + 1);
  return { addr, name, nameZh };
}

/**
 * 收集名表：扫 src 下匹配 fileRe 的文件，按 id = addr − base 建 Map<id,{id,name,nameZh,source}>。
 * 遇同名 id 保留首次；skipPrefix 用于剔除说明串（如建筑 `【施設：…】`）。
 */
function collectNames({ fileRe, base, addrMin, addrMax, idMin = 1, idMax = Infinity, skipPrefix }) {
  const out = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => fileRe.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (!p) continue;
      const id = p.addr - base;
      if (id < idMin || id > idMax) continue;
      if (p.addr < addrMin || p.addr > addrMax) continue;
      if (skipPrefix && skipPrefix.test(p.name)) continue;
      if (out.has(id)) continue;
      out.set(id, { id, name: p.name, nameZh: p.nameZh, source: f });
    }
  }
  return out;
}

const itemName = collectNames({
  fileRe: /itinit\.txt$/i,
  base: BASE_ITEM,
  addrMin: BASE_ITEM + 1,
  addrMax: ITEM_ADDR_MAX,
});
const buildingName = collectNames({
  fileRe: /plinit\.txt$/i,
  base: BASE_BUILDING,
  addrMin: BASE_BUILDING + 1,
  addrMax: BASE_BUILDING + 0x2d0,
  idMax: 0x2cf,
  skipPrefix: /^【/,
});

/* ------------------------- 配方表 ALINIT ------------------------- */

function parseAlinit(file) {
  const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  const movs = [];
  for (const l of text.split(/\r\n|\r|\n/)) {
    const m = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (m) movs.push({ addr: m[1], value: m[2] });
  }
  const isProductOfType = (type, v) => {
    const id = parseInt(v, 16);
    if (!Number.isFinite(id)) return false;
    return type === 1 ? itemName.has(id) : buildingName.has(id);
  };
  const isMarkerAt = (k) => {
    const val = movs[k].value;
    if (val !== '1' && val !== '2') return false;
    if (!/^6ba[5-9ab]/.test(movs[k].addr)) return false;
    return movs[k + 1] && isProductOfType(parseInt(val, 16), movs[k + 1].value);
  };

  const recipes = [];
  let i = 0;
  while (i < movs.length) {
    if (!isMarkerAt(i)) { i++; continue; }
    const type = parseInt(movs[i].value, 16);
    const productId = parseInt(movs[i + 1].value, 16);
    const productAddr = movs[i + 1].addr;
    let j = i + 2;
    const metadata = [];
    const cvals = [];
    let inMeta = true;
    while (j < movs.length && !isMarkerAt(j)) {
      const a = movs[j].addr;
      if (a.startsWith('6c')) { inMeta = false; cvals.push(movs[j].value); }
      else if (inMeta && a.startsWith('6b')) {
        const off = (parseInt(a, 16) - parseInt(productAddr, 16)).toString(16);
        metadata.push(`${a}(${off})=${movs[j].value}`);
      }
      j++;
    }
    const materials = [];
    for (let k = 0; k + 1 < cvals.length; k += 2) {
      materials.push({ itemId: parseInt(cvals[k], 16), count: parseInt(cvals[k + 1], 16) });
    }
    if (materials.length) {
      const ref = type === 1 ? itemName : buildingName;
      const ent = ref.get(productId);
      recipes.push({
        type,
        productId,
        productRef: type === 1 ? 'item' : 'building',
        product: ent ? ent.name : '',
        productZh: ent ? ent.nameZh : '',
        source: file,
        metadata,
        materials,
      });
    }
    i = Math.max(j, i + 2);
  }
  return recipes;
}

const recipes = [];
for (const f of fs.readdirSync(SRC_DIR).filter((x) => /alinit\.txt$/i.test(x)).sort()) {
  recipes.push(...parseAlinit(f));
}
const itemRecipes = recipes.filter((r) => r.type === 1);
const buildRecipes = recipes.filter((r) => r.type === 2);

/* ------------------------- 单位 + 掉落 EBINIT ------------------------- */

function parseEbinit() {
  const lines = fs.readFileSync(path.join(SRC_DIR, 'EBINIT.txt'), 'utf8').split(/\r\n|\r|\n/);
  const ops = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx];
    if (!l.trim()) continue;
    const ms = l.match(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/);
    if (ms) {
      const addr = parseInt(ms[1], 16);
      const kind = (addr >= 0x17a00 && addr < 0x17f00) ? 'name'
                 : (addr >= 0x17f00 && addr < 0x18200) ? 'sub'
                 : 'str';
      const p = parseNameLine(l);
      ops.push({ line: idx + 1, kind, addr, name: p.name, nameZh: p.nameZh });
      continue;
    }
    const mm = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (mm) ops.push({ line: idx + 1, kind: 'mov', addr: parseInt(mm[1], 16), value: parseInt(mm[2], 16), valueRaw: mm[2] });
  }
  const isNameOp = (op) => op.kind === 'name';
  const isSubOp = (op) => op.kind === 'sub';
  const unitHeaders = [];
  for (let i = 0; i < ops.length - 1; i++) {
    if (isNameOp(ops[i]) && isSubOp(ops[i + 1])) unitHeaders.push({ start: i, nameOp: ops[i], subOp: ops[i + 1] });
  }
  const isItem = (a) => (a & 0xffff000) === 0x53d000;
  const isRate = (a) => (a & 0xffff000) === 0x53e000;

  function extractDrops(startIdx, endIdx) {
    const kEnd = Math.min(endIdx, ops.length);
    const pairs = [];
    let k = startIdx;
    let lastRate = null, lastItem = null;
    while (k + 1 < kEnd) {
      const r = ops[k], it = ops[k + 1];
      if (r.kind === 'mov' && it.kind === 'mov' && isRate(r.addr) && isItem(it.addr)) break;
      k++;
    }
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

  const units = [];
  for (let u = 0; u < unitHeaders.length; u++) {
    const h = unitHeaders[u];
    const start = h.start;
    const end = (u + 1 < unitHeaders.length) ? unitHeaders[u + 1].start : ops.length;
    const pairs = extractDrops(start + 2, end);
    const drops = pairs.map(({ rate, item }) => ({
      itemId: item.value,
      rate: rate.value,
      rateRaw: rate.valueRaw,
      itemRaw: item.valueRaw,
      rateMeaning: 'percent',
    }));
    units.push({
      unitId: h.nameOp.addr,
      name: h.nameOp.name,
      nameZh: h.nameOp.nameZh,
      title: h.subOp.name,
      titleZh: h.subOp.nameZh,
      nameLine: h.nameOp.line,
      hasDrops: drops.length > 0,
      drops,
    });
  }
  return units;
}

const units = parseEbinit();

/* ------------------------- 地图 + 地图内单位（STINIT/STINIT2） ------------------------- */

const BASE_MAP = 0x121e2;   // 地图名 addr = BASE_MAP + mapNo
const BASE_UNIT = 0x17ab6;  // 单位名 addr = BASE_UNIT + 单位槽寄存器 id（与 EBINIT units[].unitId 同键）
const UNIT_REG_BASE = 0x14dd00;
const UNIT_MIN = 0x41, UNIT_MAX = 0x5d;
const isMk = (a) => (a & 0xffffff00) === UNIT_REG_BASE && (a & 0xff) >= UNIT_MIN && (a & 0xff) <= UNIT_MAX;

/** 地图名表：mapNo(hex 字符串) → { name, nameZh } */
function collectMapNames() {
  const byAddr = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (!p) continue;
      if (!byAddr.has(p.addr)) byAddr.set(p.addr, p);
    }
  }
  return byAddr;
}
const mapNameByAddr = collectMapNames();

/** 解析所有 STINIT：地图块内单位槽（不含掉落；掉落走 EBINIT）。 */
function parseStinitMaps() {
  const files = fs.readdirSync(SRC_DIR).filter((x) => /stinit\.txt$/i.test(x)).sort();
  const maps = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    const ops = [];
    for (const l of text.split(/\r\n|\r|\n/)) {
      if (!l.trim()) continue;
      const me = l.match(/eq \(local-int 0\) \(global-int b222\) ([0-9a-f]+)(\s|$)/);
      if (me) { ops.push({ kind: 'map', mapNo: me[1] }); continue; }
      const mm = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
      if (mm) { ops.push({ kind: 'mov', addr: parseInt(mm[1], 16), val: parseInt(mm[2], 16) }); continue; }
    }
    // 按地图块切分：[map header] .. [下一 map header)
    const headers = ops.map((o, i) => ({ o, i })).filter((x) => x.o.kind === 'map');
    for (let bi = 0; bi < headers.length; bi++) {
      const start = headers[bi].i;
      const end = bi + 1 < headers.length ? headers[bi + 1].i : ops.length;
      const mapNo = ops[start].mapNo;
      const nameEnt = mapNameByAddr.get(BASE_MAP + parseInt(mapNo, 16));
      const unitRecords = [];
      let cur = null;
      for (let idx = start; idx < end; idx++) {
        const op = ops[idx];
        if (op.kind !== 'mov') continue;
        if (!isMk(op.addr)) continue;
        const K = op.addr;
        // 前部：单调递减、窗口 [K-0xF0,K]
        let j = idx, last = K;
        const pre = new Map();
        while (j > 0) {
          const a = ops[j - 1];
          if (a.kind === 'mov' && a.addr < last && a.addr >= K - 0xF0) { pre.set(K - a.addr, a.val); last = a.addr; j--; } else break;
        }
        // 后部：单调递增、窗口 [K,K+0xF0]
        let k = idx, last2 = K;
        const post = new Map();
        while (k + 1 < ops.length) {
          const a = ops[k + 1];
          if (a.kind === 'mov' && a.addr > last2 && a.addr <= K + 0xF0) { post.set(a.addr - K, a.val); last2 = a.addr; k++; } else break;
        }
        const extra = [];
        for (const [off, v] of pre) if (![0x1e, 0x96, 0xd2, 0xf0].includes(off)) extra.push({ off: `-${off.toString(16)}`, val: v.toString(16) });
        for (const [off, v] of post) if (![0x1e, 0x3c].includes(off)) extra.push({ off: `+${off.toString(16)}`, val: v.toString(16) });
        unitRecords.push({
          unitRef: BASE_UNIT + op.val,   // 0x17ab6 + 寄存器 id，与 units[].unitId 同键
          spawnFlag: pre.has(0x1e) ? pre.get(0x1e) : null,
          faction: pre.has(0x96) ? pre.get(0x96) : null,
          row: pre.has(0xd2) ? pre.get(0xd2) : null,
          col: pre.has(0xf0) ? pre.get(0xf0) : null,
          levelMin: post.has(0x1e) ? post.get(0x1e) : null,
          levelMax: post.has(0x3c) ? post.get(0x3c) : null,
          extra,
        });
      }
      maps.push({
        mapNo,
        name: nameEnt ? nameEnt.name : '',
        nameZh: nameEnt ? nameEnt.nameZh : '',
        source: f,
        units: unitRecords,
      });
    }
  }
  return maps;
}

const maps = parseStinitMaps();
const mapUnitEntries = maps.reduce((s, m) => s + m.units.length, 0);
const mapUnitDistinct = new Set(maps.flatMap((m) => m.units.map((u) => u.unitRef)));
const mapSpawnableEntries = maps.reduce((s, m) => s + m.units.filter((u) => u.spawnFlag === 1).length, 0);

/* ------------------------- 派生 / 校验 / 组装 ------------------------- */

const craftableIds = new Set(itemRecipes.map((r) => r.productId));
const items = [...itemName.values()]
  .map((e) => ({ ...e, craftable: craftableIds.has(e.id) }))
  .sort((a, b) => a.id - b.id);
const buildings = [...buildingName.values()].sort((a, b) => a.id - b.id);

const itemLookup = new Map(items.map((i) => [i.id, i]));
let dropEntries = 0;
const dropItemIds = new Set();
for (const u of units) for (const d of u.drops) { dropEntries++; dropItemIds.add(d.itemId); }

// 校验
const missingProduct = recipes.filter((r) => !r.product).length;
const missingMaterial = new Set();
for (const r of recipes) for (const m of r.materials) if (!itemLookup.has(m.itemId)) missingMaterial.add(m.itemId);
const missingDropItem = new Set();
for (const u of units) for (const d of u.drops) if (!itemLookup.has(d.itemId)) missingDropItem.add(d.itemId);

const counts = {
  items: items.length,
  buildings: buildings.length,
  recipes: recipes.length,
  itemRecipes: itemRecipes.length,
  buildingRecipes: buildRecipes.length,
  units: units.length,
  unitsWithDrops: units.filter((u) => u.hasDrops).length,
  dropEntries,
  distinctDropItemIds: dropItemIds.size,
  maps: maps.length,
  mapUnitEntries,
  mapUnitDistinctUnits: mapUnitDistinct.size,
  mapSpawnableEntries,
};

const out = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  sourceTree: 'src',
  note: '天結いキャッスルマイスター 元数据（由 src/ ITINIT/PLINIT/ALINIT/EBINIT 提取；中间产物，不入 git）。物品 id=addr-0x18e40，建筑 id=addr-0x1f5ba；名称=src set-string "日文|中文"。metadata 与 rate 语义未定。',
  counts,
  items,
  buildings,
  recipes,
  units,
  maps,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
console.log('已写出', OUT_FILE);
console.log(`items=${items.length} buildings=${buildings.length} recipes=${recipes.length}` +
  ` (item=${itemRecipes.length}, building=${buildRecipes.length}) units=${units.length}` +
  ` (withDrops=${counts.unitsWithDrops}) dropEntries=${dropEntries} distinctDropItemIds=${dropItemIds.size}` +
  ` maps=${maps.length} mapUnitEntries=${mapUnitEntries} mapUnitDistinctUnits=${mapUnitDistinct.size} mapSpawnable=${mapSpawnableEntries}`);
console.log('校验：缺产品名配方=', missingProduct, ' 缺物品的原材料 id=', [...missingMaterial].map(String).join(','), ' 缺物品的掉落 id=', [...missingDropItem].map(String).join(','));

// 采样展示（含中文名）
console.log('\n===== 采样 =====');
const sampleItem = items.find((i) => i.id === 1) || items[0];
console.log(`物品[${sampleItem.id}] ${sampleItem.name} → ${sampleItem.nameZh} (craftable=${sampleItem.craftable}, src=${sampleItem.source})`);
const sampleB = buildings.find((b) => b.id === 1);
if (sampleB) console.log(`建筑[${sampleB.id}] ${sampleB.name} → ${sampleB.nameZh} (src=${sampleB.source})`);
const r = itemRecipes.find((x) => x.materials.length) || itemRecipes[0];
if (r) console.log(`配方(${r.type}) ${r.product}→${r.productZh} : ${r.materials.map((m) => `${itemLookup.get(m.itemId)?.nameZh}×${m.count}`).join(' + ')}`);
const u = units.find((x) => x.hasDrops && x.drops.length >= 3);
if (u) console.log(`单位[${u.unitId.toString(16)}] ${u.name}→${u.nameZh} 〈${u.title}→${u.titleZh}〉 掉落: ${u.drops.map((d) => `${itemLookup.get(d.itemId)?.nameZh}(rate=${d.rate})`).join(' ') || '无'}`);
const mu = maps.find((x) => x.units.length >= 5);
if (mu) console.log(`地图[${mu.mapNo}] ${mu.name}→${mu.nameZh} (单位槽=${mu.units.length}, src=${mu.source}) 首个: ${mu.units.slice(0, 3).map((z) => `${z.unitRef.toString(16)}行=${z.row}列=${z.col}等=${z.levelMin}..${z.levelMax}`).join(' | ')}`);
