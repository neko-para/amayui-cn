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
  SearchCategory, SearchExpression, SearchPredicate, SearchResultEntry, UnitAttrKind, StarOp,
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

/**
 * 由「单位属性」构造 query：`[{category: unit}, {unitAttr: attr/value}]`。
 * 求值结果 = 具有该属性值的全部单位（如 种族=鬼、性别=女、属性=火炎）。
 */
export function queryFromUnitAttr(attr: UnitAttrKind, value: number): SearchExpression {
  return [{ type: 'category', value: 'unit' }, { type: 'unitAttr', attr, value }];
}

/**
 * 由「单位星级」构造 query：`[{category: unit}, {unitStar: op/value}]`。
 * value = 星数 N（1-based，写入时转 0-based）；eq = 恰好 N 星，gte = ≥ N 星。
 * 求值结果 = 满足该星级条件的全部单位。
 */
export function queryFromUnitStar(op: StarOp, star: number): SearchExpression {
  return [{ type: 'category', value: 'unit' }, { type: 'unitStar', op, value: star }];
}

/* ------------------------------------------------------------------ */
/* 2) 表达式 → 结果条目                                                 */
/* ------------------------------------------------------------------ */

/** 可搜索实体的内部形态（含单位自身属性字段，供 unitAttr/unitStar 子句匹配）。 */
interface Searchable {
  id: number;
  name: string;
  nameZh: string;
  addr: string;
  sub: string;
  /** 单位自身属性（仅 unit kind 有值；其它 kind 为 undefined）。star 为 0-based 存储。 */
  unitAttr?: { race: number | null; gender: number | null; attribute: number | null; star: number | null };
}

function collectByKind(ds: Dataset, kind: SearchCategory): Searchable[] {
  switch (kind) {
    case 'item': return [...ds.byItem.values()].map((i) => ({ id: i.id, name: i.name, nameZh: i.nameZh, addr: addrHex('item', i.id), sub: CATEGORY_LABEL.item }));
    case 'unit': return [...ds.byUnit.values()].map((u) => ({ id: u.unitId, name: u.name, nameZh: u.nameZh, addr: addrHex('unit', u.unitId), sub: u.titleZh || u.title, unitAttr: { race: u.race, gender: u.gender, attribute: u.attribute, star: u.star } }));
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
 *
 * **自动强制单位**：当表达式含 `unitAttr`（单位属性）子句时，自动把搜索限定为单位
 * （即附加 `category: unit`）——因为这类信息只属于单位。
 */
export function buildResults(expr: SearchExpression, ds: Dataset): SearchResultEntry[] {
  if (expr.length === 0) return [];
  const norm = normalizeExpression(expr);

  const cat = norm.find((p): p is Extract<SearchPredicate, { type: 'category' }> => p.type === 'category');
  const kinds = cat ? [cat.value] : ALL_KINDS;

  const seen = new Set<string>();
  const out: SearchResultEntry[] = [];

  for (const kind of kinds) {
    for (const ent of collectByKind(ds, kind)) {
      if (!matchesAll(norm, ent)) continue;
      const key = `${kind}:${ent.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, id: ent.id, name: ent.name, nameZh: ent.nameZh, addr: ent.addr, sub: ent.sub });
    }
  }

  out.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.id - b.id));
  return out;
}

/** 归一化表达式：含 `unitAttr` 或 `unitStar` 子句且无 `category` 时，自动附加 `category: unit`。 */
function normalizeExpression(expr: SearchExpression): SearchExpression {
  const isUnitOnly = expr.some((p) => p.type === 'unitAttr' || p.type === 'unitStar');
  const hasCat = expr.some((p) => p.type === 'category');
  if (isUnitOnly && !hasCat) return [...expr, { type: 'category', value: 'unit' }];
  return expr;
}

function matchesAll(expr: SearchExpression, ent: Searchable): boolean {
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
      case 'unitAttr': {
        const v = ent.unitAttr?.[p.attr] ?? null;
        if (v !== p.value) return false;
        break;
      }
      case 'unitStar': {
        // star 以 0-based 存储；谓词 value = 星数 N（1-based），比对 = star+1 与 N。
        const star = ent.unitAttr?.star ?? null;
        if (star === null) return false;
        const s = star + 1;
        if (p.op === 'eq') { if (s !== p.value) return false; }
        else if (p.op === 'gte') { if (s < p.value) return false; }
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
      case 'unitAttr': return 3;
      case 'unitStar': return 4;
      case 'idExact': return 5;
    }
  };
  const keyOf = (p: SearchPredicate) => {
    switch (p.type) {
      case 'category': return `category:${p.value}`;
      case 'nameSub': return `nameSub:${p.value}`;
      case 'nameExact': return `nameExact:${p.value}`;
      case 'unitAttr': return `unitAttr:${p.attr}:${p.value}`;
      case 'unitStar': return `unitStar:${p.op}:${p.value}`;
      case 'idExact': return `idExact:${p.value.toString(16)}`;
    }
  };
  const sorted = [...expr].sort((a, b) => {
    const d = order(a) - order(b);
    if (d) return d;
    return keyOf(a).localeCompare(keyOf(b));
  });
  return sorted.map(keyOf).join(' & ');
}

/** 展示用表达式标签（历史记录/标题；仅用类型 + 名称，不暴露表达式细节）。 */
export function expressionLabel(expr: SearchExpression): string {
  if (expr.length === 0) return '';
  const cat = expr.find((p) => p.type === 'category');
  const name = expr.find((p) => p.type === 'nameExact' || p.type === 'nameSub');
  const attr = expr.find((p) => p.type === 'unitAttr');
  const star = expr.find((p) => p.type === 'unitStar');
  const catLabel = cat ? CATEGORY_LABEL[cat.value] : '';
  const nameVal = name ? name.value : (attr ? unitAttrLabel(attr) : (star ? unitStarLabel(star) : ''));
  return [catLabel, nameVal].filter(Boolean).join(' · ');
}

/** 单位属性的可读名（如「种族 · 鬼」）。 */
function unitAttrLabel(p: Extract<SearchPredicate, { type: 'unitAttr' }>): string {
  return `${UNIT_ATTR_LABEL[p.attr]} · ${unitAttrValueName(p.attr, p.value)}`;
}

/** 单位星级的可读名（如「星级 ≥ ★3」）。 */
function unitStarLabel(p: Extract<SearchPredicate, { type: 'unitStar' }>): string {
  const op = p.op === 'gte' ? '≥' : '=';
  return `星级 ${op} ★${p.value}`;
}

/* ------------------------------------------------------------------ */
/* 4) 训练需求（DRINIT 被消耗单位条件）→ query                           */
/* ------------------------------------------------------------------ */

import type { Training } from '../types/metadata';

/**
 * 从训练条目的【非空字段】构造 query。忠实反映规则：
 *   - level != null → 星级门槛：≥★(level+1)，五星（level=4 → ★5）为恰好 5 星（eq）。
 *   - race/gender/attribute != null → 对应 unitAttr 子句（相等）。
 *   多条件 AND 交集；保证非空：至少含 `category: unit`（训练需求面向单位）。
 *   （文案用现成的 textZh，不在此构造。）
 */
export function queryFromTraining(t: Pick<Training, 'race' | 'gender' | 'attribute' | 'level'>): SearchExpression {
  const expr: SearchPredicate[] = [];
  if (t.race != null) expr.push({ type: 'unitAttr', attr: 'race', value: t.race });
  if (t.gender != null) expr.push({ type: 'unitAttr', attr: 'gender', value: t.gender });
  if (t.attribute != null) expr.push({ type: 'unitAttr', attr: 'attribute', value: t.attribute });
  if (t.level != null) {
    const n = t.level + 1;                 // 0-based → 星数
    expr.push({ type: 'unitStar', op: n >= 5 ? 'eq' : 'gte', value: n });
  }
  // 训练需求面向「单位」消费；保证表达式不为空（如「★1以上 ×N」无其它字段时）。
  if (expr.length === 0) expr.push({ type: 'category', value: 'unit' });
  return expr;
}

const UNIT_ATTR_LABEL: Record<UnitAttrKind, string> = {
  race: '种族',
  gender: '性别',
  attribute: '属性',
};

function unitAttrValueName(attr: UnitAttrKind, value: number): string {
  // 用 metadata 的枚举名（避免从 search 层再引入 metadata，这里用静态映射；与 types/metadata 一致）。
  const maps: Record<UnitAttrKind, Record<number, string>> = {
    race: { 0x1: '人族', 0x2: '亜人', 0x3: '一般', 0x4: '鬼', 0x5: '巨人', 0x6: '精霊', 0x7: '天使', 0x8: '悪魔', 0x9: '魔獣', 0xa: '幻獣', 0xb: '霊体', 0xc: '不死', 0xd: '創造', 0xe: '魔神', 0xf: '特殊' },
    gender: { 0x1: '男', 0x2: '女', 0x3: '无性别' },
    attribute: { 0x1: '物理', 0x2: '地脉', 0x3: '冷却', 0x4: '火炎', 0x5: '电击', 0x6: '神圣', 0x7: '暗黑' },
  };
  return maps[attr]?.[value] ?? value.toString(16);
}
