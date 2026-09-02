/**
 * 搜索表达式类型契约（搜索内核的输入/输出形态）。
 *
 * 一次搜索 = 一条【表达式】，由若干【子句（predicate）】AND 交集而成：
 *   - nameSub    名称模糊匹配（`%kw%`）
 *   - nameExact  名称精确匹配（`kw`）
 *   - idExact    id 精确匹配（parseHex(kw)）
 *   - category   按实体类型过滤（item/unit/building/map/location/skill）
 *
 * 表达式的求值结果是【全部命中实体】——即要展示的【视图（View）】。
 * 每个实体的结果条目用 (kind, id) 去重，并按「kind 固定序 → 序号」规范化排序，
 * 保证同一表达式无论子句顺序如何、结果集总是一致且不重复。
 *
 * 当前用法（见 docs/04-功能与界面设计.md）：
 *   - 搜索框输入**仅用于筛选候选**（名称/hex 子串），不解析成表达式。
 *   - 点击某个（带类型的）推荐项时，由该实体**构造** query =
 *     `[{category: kind}, {nameExact: nameZh}]`，求值结果 = 该类型下同名实体的全部卡片。
 *   - 历史记录 record 存此 query 对象；点击历史 = 重放该 query。
 */

import type { EntityTag, CardSpec } from './nav';

/** 实体类型标签（category 的取值；也是 id 精确的 id 空间）。 */
export type SearchCategory = EntityTag;

/** 单位自身属性字段（EBINIT per-unit struct，v5）：种族 / 性别 / 属性。 */
export type UnitAttrKind = 'race' | 'gender' | 'attribute';

/** 单位星级比较操作：eq = 等于 N 星；gte = 大于等于 N 星。 */
export type StarOp = 'eq' | 'gte';

/** 一条判断子句（表达式里各子句为 AND 交集）。 */
export type SearchPredicate =
  | { type: 'nameSub'; value: string }       // name == "%Keyword%"
  | { type: 'nameExact'; value: string }     // name == "Keyword"
  | { type: 'idExact'; value: number }       // id(name) == parseHex(Keyword)
  | { type: 'category'; value: SearchCategory }
  | { type: 'unitAttr'; attr: UnitAttrKind; value: number }  // 单位自身属性（种族/性别/属性）
  | { type: 'unitStar'; op: StarOp; value: number };          // 单位星级（value = 星数 N；0-based 存储）

/** 表达式 = 子句数组（AND 交集）。空数组 = 无过滤（不常用）。 */
export type SearchExpression = SearchPredicate[];

/**
 * 搜索结果条目（一条 = 一个命中的实体）。
 * 由 `buildResults` 生成，已按 kind 固定序 + 序号排序、且 (kind,id) 去重。
 */
export interface SearchResultEntry {
  kind: EntityTag;
  /** 该 kind 的 id（物品 id / 单位 unitId / …），用于生成卡片 spec */
  id: number;
  name: string;   // 名称（日）
  nameZh: string; // 名称（中）
  /** 名串地址（hex），用于 16 进制搜索与展示 */
  addr: string;
  /** 类型说明（物品/设施/单位/地图/地点/技能） */
  sub: string;
}

/** 实体类型 → 类型中文标签（与 CardList/搜索徽标一致）。 */
export const CATEGORY_LABEL: Record<SearchCategory, string> = {
  item: '物品',
  unit: '单位',
  building: '设施',
  map: '地图',
  location: '地点',
  skill: '技能',
};

/** 实体类型固定排序序（结果规范化的第一键）。 */
export const CATEGORY_ORDER: Record<SearchCategory, number> = {
  item: 0,
  unit: 1,
  building: 2,
  map: 3,
  location: 4,
  skill: 5,
};

/** 由实体类型 + id 生成卡片 spec（供渲染）。 */
export function cardFromResult(kind: SearchCategory, id: number): CardSpec {
  switch (kind) {
    case 'item': return { kind: 'item', id };
    case 'unit': return { kind: 'unit', id };
    case 'building': return { kind: 'building', id };
    case 'map': return { kind: 'map', mapNo: id };
    case 'location': return { kind: 'location', locationId: id };
    case 'skill': return { kind: 'skill', skillId: id };
  }
}
