/**
 * 数据集：载入 `metadata.json` 并建立索引与搜索项。
 * 前端一次性持有全量数据，查询/反查/跳转均在内存完成（无后端/IPC）。
 */
import type { Metadata, Item, Building, Unit, Recipe, MapData, Location, Skill } from '../types/metadata';
import type { EntityTag, View, CardSpec, CardKind } from '../types/nav';
import { addrHex, idHex, ID_SPACE_LABEL } from './idspace';
import type { SearchExpression, SearchResultEntry } from '../types/search';
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../types/search';
import { expressionKey, expressionLabel } from './search';

/** 搜索结果条目（一条 = 一个命中的实体）。由 search 内核生成。 */
export type SearchEntry = SearchResultEntry;

/** 某单位在某地图的一次出现（地图 + 该单位在此是否可重复刷新） */
export interface MapAppearance {
  map: MapData;
  /** 该单位在该地图是否有“可刷新槽”（spawnFlag==1）。false = 固定/出击/摆位。 */
  spawnable: boolean;
}

/** 载入后的索引集合 */
export interface Dataset {
  metadata: Metadata;
  byItem: Map<number, Item>;
  byBuilding: Map<number, Building>;
  byUnit: Map<number, Unit>;
  byMap: Map<string, MapData>;
  byMapNum: Map<number, MapData>;
  /** 抽象地点 locationId → Location；同一地点可被多个地图共享 */
  byLocation: Map<number, Location>;
  /** 技能 skillId → Skill（skillId = 名串地址 − 0x1d4f4） */
  bySkill: Map<number, Skill>;
  /** 地点 locationId → 该地点内的所有地图（按地图名排序）—— 地点 → 地图 跳转 */
  mapsByLocation: Map<number, MapAppearance[]>;
  /** 物品配方：产品 itemId → 配方（type=1） */
  recipeByItemProduct: Map<number, Recipe>;
  /** 建筑配方：产品 buildingId → 配方（type=2） */
  recipeByBuildingProduct: Map<number, Recipe>;
  /** 材料 itemId → 使用它的所有配方（物品+建筑，保序） */
  recipesUsingItem: Map<number, Recipe[]>;
  /** 物品 itemId → 掉落它的单位 */
  unitsDropItem: Map<number, Unit[]>;
  /** 单位 unitId → 出现它的地图（含该单位在每图是否可刷新，按地图名排序） */
  mapsWithUnit: Map<number, MapAppearance[]>;
  search: SearchEntry[];
}

/** 搜索用规范归一化（大小写/全半角） */
export function normalize(s: string): string {
  return (s || '').normalize('NFKC').toLowerCase();
}

export function buildDataset(md: Metadata): Dataset {
  const byItem = new Map<number, Item>();
  const byBuilding = new Map<number, Building>();
  const byUnit = new Map<number, Unit>();
  const byMap = new Map<string, MapData>();
  const byMapNum = new Map<number, MapData>();
  const byLocation = new Map<number, Location>();
  const bySkill = new Map<number, Skill>();
  for (const i of md.items) byItem.set(i.id, i);
  for (const b of md.buildings) byBuilding.set(b.id, b);
  for (const u of md.units) byUnit.set(u.unitId, u);
  for (const m of md.maps) { byMap.set(m.mapNo, m); byMapNum.set(parseInt(m.mapNo, 16), m); }
  for (const l of md.locations) byLocation.set(l.locationId, l);
  for (const s of md.skills ?? []) bySkill.set(s.skillId, s);

  const recipeByItemProduct = new Map<number, Recipe>();
  const recipeByBuildingProduct = new Map<number, Recipe>();
  const recipesUsingItem = new Map<number, Recipe[]>();
  for (const r of md.recipes) {
    if (r.productRef === 'item') recipeByItemProduct.set(r.productId, r);
    else recipeByBuildingProduct.set(r.productId, r);
    for (const m of r.materials) {
      const arr = recipesUsingItem.get(m.itemId);
      if (arr) arr.push(r);
      else recipesUsingItem.set(m.itemId, [r]);
    }
  }

  const unitsDropItem = new Map<number, Unit[]>();
  for (const u of md.units) {
    if (!u.hasDrops) continue;
    for (const d of u.drops) {
      const arr = unitsDropItem.get(d.itemId);
      if (arr) arr.push(u);
      else unitsDropItem.set(d.itemId, [u]);
    }
  }

  // 单位 unitRef(=unit.unitId) → 出现它的地图（含该单位在每图是否可刷新；按 地图名 排序）
  const mapsWithUnit = new Map<number, MapAppearance[]>();
  for (const m of md.maps) {
    // 统计该图内某单位是否有“可刷新槽”
    const spawnableByUnit = new Map<number, boolean>();
    for (const mu of m.units) {
      const cur = spawnableByUnit.get(mu.unitRef) ?? false;
      spawnableByUnit.set(mu.unitRef, cur || mu.spawnFlag === 1);
    }
    for (const [unitRef, spawnable] of spawnableByUnit) {
      const arr = mapsWithUnit.get(unitRef);
      const entry = { map: m, spawnable };
      if (arr) arr.push(entry);
      else mapsWithUnit.set(unitRef, [entry]);
    }
  }
  for (const arr of mapsWithUnit.values()) arr.sort((a, b) => (a.map.nameZh || a.map.name).localeCompare(b.map.nameZh || b.map.name, 'zh'));

  // 地点 → 该地点内的所有地图（按 locations[].maps 顺序 = 场景 seq 字段顺序）。地图 → 地点 由 map.locationId 反查 byLocation。
  const mapsByLocation = new Map<number, MapAppearance[]>();
  for (const l of md.locations) {
    const arr: MapAppearance[] = [];
    for (const mapNo of l.maps) {
      const m = byMap.get(mapNo);
      if (!m) continue;
      arr.push({ map: m, spawnable: m.units.some((mu) => mu.spawnFlag === 1) });
    }
    mapsByLocation.set(l.locationId, arr);
  }

  // 全量实体搜索结果集（一条 = 一个实体，不再按同名合并成组；合并改到「视图」层）。
  const search: SearchResultEntry[] = [];
  for (const i of md.items) search.push({ kind: 'item', id: i.id, addr: addrHex('item', i.id), name: i.name, nameZh: i.nameZh, sub: CATEGORY_LABEL.item });
  for (const b of md.buildings) search.push({ kind: 'building', id: b.id, addr: addrHex('building', b.id), name: b.name, nameZh: b.nameZh, sub: CATEGORY_LABEL.building });
  for (const u of md.units) search.push({ kind: 'unit', id: u.unitId, addr: addrHex('unit', u.unitId), name: u.name, nameZh: u.nameZh, sub: u.titleZh || u.title });
  // 地图：同一场景(mapNo)在 base+$1..$5 的 STINIT 里各出现一次（单位子集不同）。
  // 搜索结果只留一个 mapNo 对应的实体，避免「干风之山」等重复出现。
  const seenMapId = new Set<number>();
  for (const m of md.maps) {
    const mid = parseInt(m.mapNo, 16);
    if (seenMapId.has(mid)) continue;
    seenMapId.add(mid);
    search.push({ kind: 'map', id: mid, addr: addrHex('map', mid), name: m.name, nameZh: m.nameZh, sub: CATEGORY_LABEL.map });
  }
  for (const l of md.locations) search.push({ kind: 'location', id: l.locationId, addr: addrHex('location', l.locationId), name: l.name, nameZh: l.nameZh, sub: CATEGORY_LABEL.location });
  // 技能：sub 用中文简述（三行描述的第 3 行），便于在候选列表里直接看清效果
  for (const sk of md.skills ?? []) search.push({ kind: 'skill', id: sk.skillId, addr: addrHex('skill', sk.skillId), name: sk.name, nameZh: sk.nameZh, sub: sk.shortZh || sk.short || CATEGORY_LABEL.skill });

  return {
    metadata: md,
    byItem,
    byBuilding,
    byUnit,
    byMap,
    byMapNum,
    byLocation,
    bySkill,
    mapsByLocation,
    recipeByItemProduct,
    recipeByBuildingProduct,
    recipesUsingItem,
    unitsDropItem,
    mapsWithUnit,
    search,
  };
}

/**
 * 按输入文本筛选候选（下拉 Autocomplete 用）。输入**仅用于筛选**（名称/hex 子串），
 * 不解析成表达式；点选候选时才构造 query。返回保序的 `SearchEntry[]`（每实体一条，已规范化排序去重）。
 */
export function filterCandidates(search: SearchEntry[], text: string): SearchEntry[] {
  const raw = text.trim();
  if (!raw) return [];
  const q = normalize(raw);
  const hits = search.filter((e) => normalize(e.name).includes(q) || normalize(e.nameZh).includes(q));
  // 十六进制数：也按名串地址/实体 id 的 hex 精确匹配（不做前缀/后缀模糊）。
  if (/^[0-9a-f]+$/i.test(raw)) {
    const hex = raw.toLowerCase();
    for (const e of search) {
      const byAddr = e.addr.toLowerCase() === hex;
      const byId = e.id.toString(16) === hex;
      if ((byAddr || byId) && !hits.includes(e)) hits.push(e);
    }
  }
  return hits.sort(kindThenId);
}

/** 结果排序第一键 = kind 固定序，第二键 = 实体序号。 */
function kindThenId(a: SearchEntry, b: SearchEntry): number {
  const ka = CATEGORY_ORDER[a.kind], kb = CATEGORY_ORDER[b.kind];
  if (ka !== kb) return ka - kb;
  return a.id - b.id;
}

/**
 * 历史条目：一条历史 = 一次【表达式（query）】及其结果视图。
 * `key` = 规范化表达式串（去重/回放用）；`expr` = 内部 query；`view` = 该 query 的全部结果卡片。
 */
export interface ViewEntry {
  /** 去重 key（同一表达式只保留最新一条；= 规范化表达式串） */
  key: string;
  /** 展示标签（如「单位 · 火 ×12」） */
  label: string;
  /** 主卡片 kind（用于图标/挑色） */
  kind: CardKind;
  /** 内部 query（回放 = 重新求值该表达式） */
  expr: SearchExpression;
  /** 展示的视图（= 该表达式全部结果卡片） */
  view: View;
}

/**
 * 由一次搜索构造历史条目（供 navigate 调用）。
 * `expr` 为内部 query；`view` 为其结果视图。空/纯 message → null。
 */
export function describeView(expr: SearchExpression, view: View, ds: Dataset): ViewEntry | null {
  if (!view || view.length === 0) return null;
  const first = view[0];
  if (first.kind === 'message') return null;
  const key = expressionKey(expr);
  const label = describeViewLabel(view, expr, ds);
  return { key, label, kind: first.kind, expr, view };
}

/** 生成历史/标题标签：优先用实体名；多实体 → 「类型 · 名称 ×N」。 */
function describeViewLabel(view: View, expr: SearchExpression, ds: Dataset): string {
  // 单实体：直接显示「类型 · 实体名」（用卡片反查名称）。
  if (view.length === 1) {
    const { label } = describeCard(view[0], ds);
    return label;
  }
  // 多实体：表达式标签（类型 · 名称）+ 命中数；若表达式无名称子句（如纯 idExact），用首个实体名。
  let base = expressionLabel(expr);
  if (!base || expr.every((p) => p.type === 'category' || p.type === 'idExact')) {
    // 无姓名子句：取首个实体的「类型 · 名」
    const firstLabel = describeCard(view[0], ds).label;
    base = firstLabel;
  }
  return `${base} ×${view.length}`;
}

function describeCard(spec: CardSpec, ds: Dataset): { key: string; label: string } {
  switch (spec.kind) {
    case 'item': {
      const it = ds.byItem.get(spec.id);
      return { key: `item:${spec.id}`, label: `${ID_SPACE_LABEL.item} · ${it?.nameZh || '#' + idHex(spec.id)}` };
    }
    case 'unit': {
      const u = ds.byUnit.get(spec.id);
      return { key: `unit:${spec.id}`, label: `${ID_SPACE_LABEL.unit} · ${u?.nameZh || '#' + idHex(spec.id)}` };
    }
    case 'building': {
      const b = ds.byBuilding.get(spec.id);
      return { key: `building:${spec.id}`, label: `${ID_SPACE_LABEL.building} · ${b?.nameZh || '#' + idHex(spec.id)}` };
    }
    case 'recipe': {
      return { key: `recipe:${spec.productId}`, label: `配方 · #${idHex(spec.productId)}` };
    }
    case 'map': {
      const m = ds.byMapNum.get(spec.mapNo);
      return { key: `map:${spec.mapNo}`, label: `${ID_SPACE_LABEL.map} · ${m?.nameZh || '#' + idHex(spec.mapNo)}` };
    }
    case 'location': {
      const l = ds.byLocation.get(spec.locationId);
      return { key: `location:${spec.locationId}`, label: `${ID_SPACE_LABEL.location} · ${l?.nameZh || '#' + idHex(spec.locationId)}` };
    }
    case 'skill': {
      const sk = ds.bySkill.get(spec.skillId);
      return { key: `skill:${spec.skillId}`, label: `${ID_SPACE_LABEL.skill} · ${sk?.nameZh || '#' + idHex(spec.skillId)}` };
    }
    case 'message':
      return { key: `message:${spec.text}`, label: spec.text };
  }
}

/** 载入数据（fetch 静态资源） */
export async function loadDataset(): Promise<Dataset> {
  const res = await fetch('./data/metadata.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`数据载入失败：HTTP ${res.status}`);
  const md = (await res.json()) as Metadata;
  return buildDataset(md);
}
