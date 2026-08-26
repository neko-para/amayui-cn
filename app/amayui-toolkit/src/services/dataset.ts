/**
 * 数据集：载入 `metadata.json` 并建立索引与搜索项。
 * 前端一次性持有全量数据，查询/反查/跳转均在内存完成（无后端/IPC）。
 */
import type { Metadata, Item, Building, Unit, Recipe } from '../types/metadata';
import type { EntityTag } from '../types/nav';

/** 搜索项（Autocomplete 选项） */
export interface SearchEntry {
  kind: EntityTag;
  id: number; // item.id / building.id / unit.unitId
  name: string; // 日文
  nameZh: string; // 中文
  sub: string; // 描述（单位：副标题；物品/设施：类型）
}

/** 载入后的索引集合 */
export interface Dataset {
  metadata: Metadata;
  byItem: Map<number, Item>;
  byBuilding: Map<number, Building>;
  byUnit: Map<number, Unit>;
  /** 物品配方：产品 itemId → 配方（type=1） */
  recipeByItemProduct: Map<number, Recipe>;
  /** 建筑配方：产品 buildingId → 配方（type=2） */
  recipeByBuildingProduct: Map<number, Recipe>;
  /** 材料 itemId → 使用它的所有配方（物品+建筑，保序） */
  recipesUsingItem: Map<number, Recipe[]>;
  /** 物品 itemId → 掉落它的单位 */
  unitsDropItem: Map<number, Unit[]>;
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
  for (const i of md.items) byItem.set(i.id, i);
  for (const b of md.buildings) byBuilding.set(b.id, b);
  for (const u of md.units) byUnit.set(u.unitId, u);

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

  const search: SearchEntry[] = [];
  for (const i of md.items) search.push({ kind: 'item', id: i.id, name: i.name, nameZh: i.nameZh, sub: '物品' });
  for (const b of md.buildings) search.push({ kind: 'building', id: b.id, name: b.name, nameZh: b.nameZh, sub: '设施' });
  for (const u of md.units) search.push({ kind: 'unit', id: u.unitId, name: u.name, nameZh: u.nameZh, sub: u.titleZh || u.title });

  return {
    metadata: md,
    byItem,
    byBuilding,
    byUnit,
    recipeByItemProduct,
    recipeByBuildingProduct,
    recipesUsingItem,
    unitsDropItem,
    search,
  };
}

/** 按 日/中 名做子串搜索（中/日任一命中即返回） */
export function querySearch(search: SearchEntry[], text: string): SearchEntry[] {
  const q = normalize(text.trim());
  if (!q) return [];
  return search.filter((e) => normalize(e.name).includes(q) || normalize(e.nameZh).includes(q));
}

/** 载入数据（fetch 静态资源） */
export async function loadDataset(): Promise<Dataset> {
  const res = await fetch('./data/metadata.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`数据载入失败：HTTP ${res.status}`);
  const md = (await res.json()) as Metadata;
  return buildDataset(md);
}
