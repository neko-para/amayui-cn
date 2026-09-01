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
const SCHEMA_VERSION = 3;         // v3：新增 locations + maps[].locationId（场景→地点）

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

/** 地图名表：addr → { name, nameZh, source } */
function collectMapNames() {
  const byAddr = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (!p) continue;
      if (!byAddr.has(p.addr)) byAddr.set(p.addr, { ...p, source: f });
    }
  }
  return byAddr;
}
const mapNameByAddr = collectMapNames();

/**
 * 解析所有 STINIT：把每个地图块的单位槽按 (mapNo, 单位槽寄存器 id) 合并成索引。
 * 注意：同一场景(mapNo)在 base + $1..$5 的 STINIT 里各出现一次（单位子集不同），
 *   这里按 mapNo 归并、并以「单位槽寄存器 id(addr&0xff)」去重（后续文件覆盖前面的），
 *   得到每张场景地图的**完整**单位清单。不含掉落（掉落走 EBINIT）。
 */
const unitByMapNo = new Map(); // mapNo → Map<registerId, MapUnit>
for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit\.txt$/i.test(x)).sort()) {
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
    let slots = unitByMapNo.get(mapNo);
    if (!slots) { slots = new Map(); unitByMapNo.set(mapNo, slots); }
    for (let idx = start; idx < end; idx++) {
      const op = ops[idx];
      if (op.kind !== 'mov') continue;
      if (!isMk(op.addr)) continue;
      const K = op.addr;
      const regId = (op.addr & 0xff).toString(16);
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
      slots.set(regId, {
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
  }
}
// 转换为每个 mapNo 的数组（按寄存器 id 排序，保证稳定）
const unitByMapNoArr = new Map();
for (const [mapNo, slots] of unitByMapNo) {
  unitByMapNoArr.set(mapNo, [...slots.entries()].sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16)).map(([, v]) => v));
}

/* ------------------------- 场景 → 地点（STINIT2 场景记录 loc 字段） ------------------------- */

const BASE_LOC = 0x1216e;       // 地点名 addr = BASE_LOC + locationId
const LOC_SEQ_DIFF = 0x3e8;     // seq 槽 addr − loc 槽 addr 恒为 0x3e8（线性槽位）
const LOC_IDX_BASE = 0x14e4e1;  // loc 槽基址 = LOC_IDX_BASE + sceneIdx（仅作校验；实际直接从段尾读值）

/** 收集地点名表（STINIT2 中 addr∈[0x1216f,0x121e0) 的 set-string；locationId = addr − BASE_LOC） */
function collectLocationNames() {
  const byAddr = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (!p || p.addr < 0x1216f || p.addr >= 0x121e0) continue;
      if (!byAddr.has(p.addr)) byAddr.set(p.addr, { ...p, source: f });
    }
  }
  return byAddr;
}
const locationNameByAddr = collectLocationNames();
const locationName = (loc) => {
  const e = locationNameByAddr.get(BASE_LOC + loc);
  return e ? { name: e.name, nameZh: e.nameZh, source: e.source } : null;
};

/**
 * 解析 STINIT2 场景记录 → 场景名地址 → { locId, seq }。
 * 线性公式（已证实）：loc 槽 addr = 0x14e4e1 + sceneIdx，seq 槽 addr = 0x14e8c9 + sceneIdx，
 *   且 seq_addr − loc_addr 恒为 0x3e8。
 * 结构：每段（上一个 set-string → 下一个 set-string）**末尾**两 mov 为 (loc, seq)，
 *   它们属于**其下方**（紧随其后）的场景名（与「地点字段在名称上方」一致）。
 * `sub (global-int X) 0 1` → X = -1（无标准战场地点的特殊/事件图）。
 */
function parseStinit2SceneLoc() {
  const sceneLoc = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    const toks = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (p) { toks.push({ kind: 'NAME', addr: p.addr }); continue; }
      const mm = line.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
      if (mm) { toks.push({ kind: 'MOV', addr: parseInt(mm[1], 16), value: parseInt(mm[2], 16) }); continue; }
      const sm = line.match(/sub \(global-int ([0-9a-f]+)\) ([0-9a-f]+) ([0-9a-f]+)/);
      if (sm) toks.push({ kind: 'MOV', addr: parseInt(sm[1], 16), value: parseInt(sm[2], 16) - parseInt(sm[3], 16) });
    }
    let lastTwo = [];
    for (const t of toks) {
      if (t.kind === 'MOV') {
        lastTwo.push(t);
        if (lastTwo.length > 2) lastTwo.shift();
      } else if (t.kind === 'NAME' && t.addr >= 0x121e0) {
        const isPair = lastTwo.length === 2 && (lastTwo[1].addr - lastTwo[0].addr) === LOC_SEQ_DIFF;
        sceneLoc.set(t.addr, { locId: isPair ? lastTwo[0].value : null, seq: isPair ? lastTwo[1].value : null });
        lastTwo = [];
      }
    }
  }
  return sceneLoc;
}
const sceneLocByAddr = parseStinit2SceneLoc();

// maps = STINIT2 场景（每场景一张地图；mapNo = 场景名 addr − 0x121e2；单位由 STINIT 按 mapNo join）
const maps = [];
for (const [addr, ent] of [...mapNameByAddr.entries()].sort((a, b) => a[0] - b[0])) {
  if (addr < 0x121e0) continue;                       // 只取场景名（>=0x121e0）
  const mapNo = (addr - BASE_MAP).toString(16);
  const scene = sceneLocByAddr.get(addr);
  maps.push({
    mapNo,
    name: ent.name,
    nameZh: ent.nameZh,
    source: ent.source,
    seq: scene ? scene.seq : null,                 // 场景在所属地点内的序号（用于地点内排序）
    locationId: scene && scene.locId !== null && scene.locId >= 0 ? scene.locId : null,
    units: unitByMapNoArr.get(mapNo) ?? [],
  });
}
const mapUnitEntries = maps.reduce((s, m) => s + m.units.length, 0);
const mapUnitDistinct = new Set(maps.flatMap((m) => m.units.map((u) => u.unitRef)));
const mapSpawnableEntries = maps.reduce((s, m) => s + m.units.filter((u) => u.spawnFlag === 1).length, 0);

// 按 locationId 分组地图 → 抽象「地点」（mapNo 去重；同名地点保留不同 id —— 同名属正常，按 id 区分）
const locationMapNos = new Map();
for (const m of maps) {
  if (m.locationId == null) continue;
  let set = locationMapNos.get(m.locationId);
  if (!set) { set = new Set(); locationMapNos.set(m.locationId, set); }
  set.add(m.mapNo);
}
const locations = [];
const seqByMapNo = new Map(maps.map((m) => [m.mapNo, m.seq]));
for (const [locId, mapNoSet] of locationMapNos) {
  const nm = locationName(locId);
  // 地点内的场景按场景自己的 seq 字段（地点内序号）排序，非按 mapNo
  const mapNos = [...mapNoSet].sort((a, b) => {
    const sa = seqByMapNo.get(a) ?? Number.MAX_SAFE_INTEGER;
    const sb = seqByMapNo.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return parseInt(a, 16) - parseInt(b, 16);
  });
  locations.push({
    locationId: locId,
    name: nm ? nm.name : '',
    nameZh: nm ? nm.nameZh : `地点 #${locId}`,
    source: nm ? nm.source : '',
    maps: mapNos,
  });
}
locations.sort((a, b) => a.locationId - b.locationId);
const mapsWithLocation = maps.filter((m) => m.locationId != null).length;

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
  locations: locations.length,
  mapsWithLocation,
};

const out = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  sourceTree: 'src',
  note: '天結いキャッスルマイスター 元数据（由 src/ ITINIT/PLINIT/ALINIT/EBINIT/STINIT/STINIT2 提取；中间产物，不入 git）。物品 id=addr-0x18e40，建筑 id=addr-0x1f5ba；名称=src set-string "日文|中文"。metadata 与 rate 语义未定。v3 新增 locations（场景→地点，地点 id=addr-0x1216e；loc 槽=0x14e4e1+sceneIdx，seq=loc+0x3e8；sub 0 1 即 loc=-1）。',
  counts,
  items,
  buildings,
  recipes,
  units,
  maps,
  locations,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
console.log('已写出', OUT_FILE);
console.log(`items=${items.length} buildings=${buildings.length} recipes=${recipes.length}` +
  ` (item=${itemRecipes.length}, building=${buildRecipes.length}) units=${units.length}` +
  ` (withDrops=${counts.unitsWithDrops}) dropEntries=${dropEntries} distinctDropItemIds=${dropItemIds.size}` +
  ` maps=${maps.length} mapUnitEntries=${mapUnitEntries} mapUnitDistinctUnits=${mapUnitDistinct.size} mapSpawnable=${mapSpawnableEntries}` +
  ` locations=${locations.length} mapsWithLocation=${mapsWithLocation}`);
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
