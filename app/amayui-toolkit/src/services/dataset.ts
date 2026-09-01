/**
 * 数据集：载入 `metadata.json` 并建立索引与搜索项。
 * 前端一次性持有全量数据，查询/反查/跳转均在内存完成（无后端/IPC）。
 */
import type { Metadata, Item, Building, Unit, Recipe, MapData, Location, Skill } from '../types/metadata';
import type { EntityTag, View, CardSpec, CardKind } from '../types/nav';
import { addrHex, idHex, ID_SPACE_LABEL } from './idspace';

/** 搜索项（Autocomplete 选项）。同名同类型实体合并为一条，`ids` 为保序成员 id 列表。 */
export interface SearchEntry {
  kind: EntityTag;
  /** 该组命中的实体 id（保序）；同型同名合并后可能多个 */
  ids: number[];
  /** 合并后命中数 = ids.length */
  count: number;
  /** 该组首个成员的十六进制「名串地址」（非单位存 id+基址；单位即 unitId），用于 16 进制搜索匹配 */
  addr: string;
  name: string; // 日文（该组首个成员的日文名）
  nameZh: string; // 中文
  sub: string; // 类型说明（物品/设施/单位/地图/地点）
}

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

  const search: SearchEntry[] = [];
  for (const i of md.items) search.push({ kind: 'item', ids: [i.id], count: 1, addr: addrHex('item', i.id), name: i.name, nameZh: i.nameZh, sub: '物品' });
  for (const b of md.buildings) search.push({ kind: 'building', ids: [b.id], count: 1, addr: addrHex('building', b.id), name: b.name, nameZh: b.nameZh, sub: '设施' });
  for (const u of md.units) search.push({ kind: 'unit', ids: [u.unitId], count: 1, addr: addrHex('unit', u.unitId), name: u.name, nameZh: u.nameZh, sub: u.titleZh || u.title });
  // 地图：同一场景(mapNo)在 base+$1..$5 的 STINIT 里各出现一次（单位子集不同）。
  // 搜索只留一个 mapNo 对应的 entry，避免「干风之山」等重复出现。
  const seenMapId = new Set<number>();
  for (const m of md.maps) {
    const mid = parseInt(m.mapNo, 16);
    if (seenMapId.has(mid)) continue;
    seenMapId.add(mid);
    search.push({ kind: 'map', ids: [mid], count: 1, addr: addrHex('map', mid), name: m.name, nameZh: m.nameZh, sub: '地图' });
  }
  for (const l of md.locations) search.push({ kind: 'location', ids: [l.locationId], count: 1, addr: addrHex('location', l.locationId), name: l.name, nameZh: l.nameZh, sub: '地点' });
  // 技能：sub 用中文简述（三行描述的第 3 行），便于在候选列表里直接看清效果
  for (const sk of md.skills ?? []) search.push({ kind: 'skill', ids: [sk.skillId], count: 1, addr: addrHex('skill', sk.skillId), name: sk.name, nameZh: sk.nameZh, sub: sk.shortZh || sk.short || '技能' });

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

/** 按 日/中 名做子串搜索（中/日任一命中即返回）；若输入是 16 进制数，则同时按实体十六进制「名串地址/成员 id」后缀匹配；
 *  同名同类型实体合并为一条（保序、去重 id）。 */
export function querySearch(search: SearchEntry[], text: string): SearchEntry[] {
  const raw = text.trim();
  const q = normalize(raw);
  if (!q) return [];
  const hits = search.filter((e) => normalize(e.name).includes(q) || normalize(e.nameZh).includes(q));
  // 16 进制数：仅完整匹配（addr 或成员 id 的 hex 精确相等），不做前缀/后缀模糊
  if (/^[0-9a-f]+$/i.test(raw)) {
    const hex = raw.toLowerCase();
    for (const e of search) {
      const byAddr = e.addr && e.addr.toLowerCase() === hex;
      const byId = e.ids.some((id) => id.toString(16) === hex);
      if ((byAddr || byId) && !hits.includes(e)) hits.push(e);
    }
  }
  // 同名同类型合并
  const out: SearchEntry[] = [];
  const byKey = new Map<string, SearchEntry>();
  for (const e of hits) {
    const key = `${e.kind}|${normalize(e.nameZh || e.name)}`;
    const ex = byKey.get(key);
    if (!ex) {
      const ne = { ...e, ids: [...e.ids], count: e.ids.length };
      byKey.set(key, ne);
      out.push(ne);
    } else {
      for (const id of e.ids) if (!ex.ids.includes(id)) ex.ids.push(id);
      ex.count = ex.ids.length;
    }
  }
  return out;
}

/** 历史条目：展示标签 + 去重 key + 点击时重新跳转的目标 view */
export interface ViewEntry {
  /** 去重 key（同一目标只保留最新一条） */
  key: string;
  /** 展示标签（如「物品 · 青铜导键」） */
  label: string;
  /** 主卡片 kind（用于图标/挑色） */
  kind: CardKind;
  /** 点击时重新 navigate 的目标 */
  view: View;
}

/**
 * 把一条 View（通常是单卡片）反查为历史条目。
 * 空 view → 保留为空态；首个非 message 卡片作为主目标。
 */
export function describeView(view: View, ds: Dataset): ViewEntry | null {
  if (!view || view.length === 0) return null;
  const first = view[0];
  if (first.kind === 'message') return null;
  const { key, label } = describeCard(first, ds);
  return { key, label, kind: first.kind, view };
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
