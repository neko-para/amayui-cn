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
const SCHEMA_VERSION = 1;

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
      rateMeaning: 'unknown',
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
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
console.log('已写出', OUT_FILE);
console.log(`items=${items.length} buildings=${buildings.length} recipes=${recipes.length}` +
  ` (item=${itemRecipes.length}, building=${buildRecipes.length}) units=${units.length}` +
  ` (withDrops=${counts.unitsWithDrops}) dropEntries=${dropEntries} distinctDropItemIds=${dropItemIds.size}`);
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
