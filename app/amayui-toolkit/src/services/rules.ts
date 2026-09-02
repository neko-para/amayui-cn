/**
 * rules.ts —— 谓词（SearchPredicate）→ 可见「规则」chip 的唯一映射。
 *
 * 顶部搜索区（interactive）与右侧历史侧栏（readonly）都经由本文件把表达式渲染成规则 chips，
 * 保证两处文案一致、不各写。见 docs/04-功能与界面设计.md §2.1。
 */
import type { SearchExpression, SearchPredicate, UnitAttrKind, StarOp } from '../types/search';
import { CATEGORY_LABEL } from '../types/search';
import { RACE_NAME, GENDER_NAME, ATTR_NAME } from '../types/metadata';

/** 规则所属「轴」（决定排序与同轴替换；同一轴至多一条规则）。 */
export type RuleAxis = 'category' | 'name' | 'race' | 'gender' | 'attribute' | 'star' | 'id';

/** 一条规则（一个谓词 → 一个可渲染/可删除的 chip）。 */
export interface RuleDef {
  /** React key（稳定、去重）；父级用它做 onRemove 回传。 */
  key: string;
  /** chip 文案（如 `类型: 单位`、`种族: 鬼`、`星级≥★3`）。 */
  label: string;
  /** 该规则对应的原始谓词（删除/解析用）。 */
  pred: SearchPredicate;
  /** 轴向（类型/名称/种族/性别/属性/星级/id）。 */
  axis: RuleAxis;
}

/** 轴向固定序（结果按此排序，保证两处一致、稳定）。 */
const AXIS_ORDER: Record<RuleAxis, number> = {
  category: 0, name: 1, race: 2, gender: 3, attribute: 4, star: 5, id: 6,
};

/** 单位属性值 → 名称（与 metadata.ts 的 RACE/GENDER/ATTR 枚举同构）。 */
function unitAttrValueName(attr: UnitAttrKind, value: number): string {
  if (attr === 'race') return RACE_NAME[value] ?? `#${value.toString(16)}`;
  if (attr === 'gender') return GENDER_NAME[value] ?? `#${value.toString(16)}`;
  return ATTR_NAME[value] ?? `#${value.toString(16)}`;
}

/** 把表达式映射为一组规则（谓词 → chip 定义）。空表达式返回 []。 */
export function rulesFromExpr(expr: SearchExpression): RuleDef[] {
  const rules: RuleDef[] = [];
  for (const p of expr) {
    switch (p.type) {
      case 'category':
        rules.push({ key: `category:${p.value}`, label: `类型: ${CATEGORY_LABEL[p.value]}`, pred: p, axis: 'category' });
        break;
      case 'nameSub':
        rules.push({ key: `nameSub:${p.value}`, label: `名称含 "${p.value}"`, pred: p, axis: 'name' });
        break;
      case 'nameExact':
        rules.push({ key: `nameExact:${p.value}`, label: `名称=「${p.value}」`, pred: p, axis: 'name' });
        break;
      case 'idExact':
        rules.push({ key: `idExact:${p.value}`, label: `id ${p.value.toString(16)}`, pred: p, axis: 'id' });
        break;
      case 'unitAttr':
        rules.push({ key: `${p.attr}:${p.value}`, label: `${UNIT_ATTR_LABEL[p.attr]}: ${unitAttrValueName(p.attr, p.value)}`, pred: p, axis: p.attr });
        break;
      case 'unitStar':
        rules.push({ key: `star:${p.op}:${p.value}`, label: `星级${p.op === 'gte' ? '≥' : '='}★${p.value}`, pred: p, axis: 'star' });
        break;
    }
  }
  rules.sort((a, b) => AXIS_ORDER[a.axis] - AXIS_ORDER[b.axis]);
  return rules;
}

/** 单位属性轴的中文标签（种族/性别/属性）。 */
export const UNIT_ATTR_LABEL: Record<UnitAttrKind, string> = {
  race: '种族',
  gender: '性别',
  attribute: '属性',
};

/** 是否是「名称」类谓词（由名称框呈现，不渲染成独立 chip）。 */
export function isNamePredicate(p: SearchPredicate): boolean {
  return p.type === 'nameSub' || p.type === 'nameExact';
}

/** 是否是「单位」类谓词（种族/性别/属性/星级），决定类型是否锁定为「单位」。 */
export function isUnitFacet(p: SearchPredicate): boolean {
  return p.type === 'unitAttr' || p.type === 'unitStar';
}

export type { StarOp };
