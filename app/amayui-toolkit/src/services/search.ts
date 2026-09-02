/**
 * 搜索内核（表达式交集）。表达式是**内部 query 模型**，不面向用户输入/展示。
 *
 * 一次搜索 = 一条【表达式】，由若干【子句（predicate）】AND 交集而成：
 *   - nameSub    名称模糊匹配（`%kw%`）
 *   - nameExact  名称精确匹配（`kw`）
 *   - idExact    id 精确匹配（parseHex(kw)）
 *   - category   按实体类型过滤（item/unit/building/map/location/skill）
 *
 * 当前用法（见 docs/04-功能与界面设计.md）：
 *   - 搜索框输入**仅用于筛选候选**（名称/hex 子串），不解析成表达式。
 *   - 点击某个（带类型的）推荐项时，由该实体**构造** query =
 *     `[{category: kind}, {nameExact: nameZh}]`，求值结果 = 该类型下同名实体的全部卡片。
 *   - 历史记录 record 存此 query 对象；点击历史 = 重放该 query。
 *
 * 表达式由 `buildResults` 求值，得到要展示的【视图（View）】——一组去重、规范化排序的实体。
 */
import type {
  SearchCategory, SearchExpression, SearchPredicate, SearchResultEntry,
} from '../types/search';
import { CATEGORY_ORDER, CATEGORY_LABEL } from '../types/search';
import type { Dataset } from './dataset';
import { normalize } from './dataset';
import { addrHex } from './idspace';

/** 实体类型固定序（结果排序第一键）。 */
const KIND_ORDER = CATEGORY_ORDER;

/* ------------------------------------------------------------------ */
/* 1) 由推荐项实体构造 query                                            */
/* ------------------------------------------------------------------ */

/**
 * 由「推荐项实体」构造 query：`[{category: kind}, {nameExact: nameZh}]`。
 * 求值结果 = 该类型下与所选实体**同名**的全部实体（同名的可多张卡）。
 * 若 nameZh 与 name 相同（未汉化），则用 name。
 */
export function queryFromEntry(entry: { kind: SearchCategory; name: string; nameZh: string }): SearchExpression {
  const name = entry.nameZh || entry.name;
  return [{ type: 'category', value: entry.kind }, { type: 'nameExact', value: name }];
}

/**
 * 由「实体类型 + id」构造 query：`[{category: kind}, {idExact: id}]`。
 * 求值结果 = 该指定实体的一张卡（用于引用跳转 RefChip 等）。
 */
export function queryFromId(kind: SearchCategory, id: number): SearchExpression {
  return [{ type: 'category', value: kind }, { type: 'idExact', value: id }];
}

/* ------------------------------------------------------------------ */
/* 2) 表达式 → 结果条目                                                 */
/* ------------------------------------------------------------------ */

function collectByKind(ds: Dataset, kind: SearchCategory): { id: number; name: string; nameZh: string; addr: string; sub: string }[] {
  switch (kind) {
    case 'item': return [...ds.byItem.values()].map((i) => ({ id: i.id, name: i.name, nameZh: i.nameZh, addr: addrHex('item', i.id), sub: CATEGORY_LABEL.item }));
    case 'unit': return [...ds.byUnit.values()].map((u) => ({ id: u.unitId, name: u.name, nameZh: u.nameZh, addr: addrHex('unit', u.unitId), sub: u.titleZh || u.title }));
    case 'building': return [...ds.byBuilding.values()].map((b) => ({ id: b.id, name: b.name, nameZh: b.nameZh, addr: addrHex('building', b.id), sub: CATEGORY_LABEL.building }));
    case 'map': return [...ds.byMapNum.values()].map((m) => ({ id: parseInt(m.mapNo, 16), name: m.name, nameZh: m.nameZh, addr: addrHex('map', parseInt(m.mapNo, 16)), sub: CATEGORY_LABEL.map }));
    case 'location': return [...ds.byLocation.values()].map((l) => ({ id: l.locationId, name: l.name, nameZh: l.nameZh, addr: addrHex('location', l.locationId), sub: CATEGORY_LABEL.location }));
    case 'skill': return [...ds.bySkill.values()].map((s) => ({ id: s.skillId, name: s.name, nameZh: s.nameZh, addr: addrHex('skill', s.skillId), sub: s.shortZh || s.short || CATEGORY_LABEL.skill }));
  }
}

const ALL_KINDS: SearchCategory[] = ['item', 'unit', 'building', 'map', 'location', 'skill'];

/**
 * 对表达式求交集，返回去重 + 规范化排序的结果。
 * 空表达式 → 返回空（表示“无条件”，不展示全部）。
 */
export function buildResults(expr: SearchExpression, ds: Dataset): SearchResultEntry[] {
  if (expr.length === 0) return [];

  const cat = expr.find((p): p is Extract<SearchPredicate, { type: 'category' }> => p.type === 'category');
  const kinds = cat ? [cat.value] : ALL_KINDS;

  const seen = new Set<string>();
  const out: SearchResultEntry[] = [];

  for (const kind of kinds) {
    for (const ent of collectByKind(ds, kind)) {
      if (!matchesAll(expr, ent)) continue;
      const key = `${kind}:${ent.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, id: ent.id, name: ent.name, nameZh: ent.nameZh, addr: ent.addr, sub: ent.sub });
    }
  }

  out.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.id - b.id));
  return out;
}

function matchesAll(expr: SearchExpression, ent: { id: number; name: string; nameZh: string; addr: string; sub: string }): boolean {
  for (const p of expr) {
    switch (p.type) {
      case 'category': continue;   // category 已在 kinds 层面处理
      case 'nameSub': {
        const q = normalize(p.value);
        if (!normalize(ent.name).includes(q) && !normalize(ent.nameZh).includes(q)) return false;
        break;
      }
      case 'nameExact': {
        const q = normalize(p.value);
        if (normalize(ent.name) !== q && normalize(ent.nameZh) !== q) return false;
        break;
      }
      case 'idExact': {
        const hex = ent.id.toString(16);
        const byId = ent.id === p.value;
        const byAddr = ent.addr.toLowerCase() === p.value.toString(16);
        if (!byId && !byAddr) return false;
        void hex;
        break;
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* 3) 表达式规范化 key / label（历史去重、标题展示）                     */
/* ------------------------------------------------------------------ */

/** 把表达式规范化为稳定字符串（子句按固定顺序排序后 join）。 */
export function expressionKey(expr: SearchExpression): string {
  if (expr.length === 0) return '';
  const order = (p: SearchPredicate) => {
    switch (p.type) {
      case 'category': return 0;
      case 'nameSub': return 1;
      case 'nameExact': return 2;
      case 'idExact': return 3;
    }
  };
  const sorted = [...expr].sort((a, b) => (order(a) - order(b)) || String(a.type === 'idExact' ? a.value : a.value).localeCompare(String(b.type === 'idExact' ? b.value : b.value)));
  return sorted.map((p) => {
    switch (p.type) {
      case 'category': return `category:${p.value}`;
      case 'nameSub': return `nameSub:${p.value}`;
      case 'nameExact': return `nameExact:${p.value}`;
      case 'idExact': return `idExact:${p.value.toString(16)}`;
    }
  }).join(' & ');
}

/** 展示用表达式标签（历史记录/标题；仅用类型 + 名称，不暴露表达式细节）。 */
export function expressionLabel(expr: SearchExpression): string {
  if (expr.length === 0) return '';
  const cat = expr.find((p) => p.type === 'category');
  const name = expr.find((p) => p.type === 'nameExact' || p.type === 'nameSub');
  const catLabel = cat ? CATEGORY_LABEL[cat.value] : '';
  const nameVal = name ? name.value : '';
  return [catLabel, nameVal].filter(Boolean).join(' · ');
}
