/**
 * useSearchDraft.ts —— 搜索区「草稿规则」状态。
 *
 * 见 docs/04-功能与界面设计.md §2.4：持有 `{ expr, nameInput }`（当前规则集 + 名称框文本），
 * `load(expr)` 供历史/外部回填、`toExpr()` 序列化回表达式。
 *
 * 表达式的「草稿 / 提交」区分：本 store 只持有**当前规则**（草稿）；组件在「回车/点候选/删 chip/关弹窗」时
 * 才调用 `navigate(expr, view)`（提交一次，写一条历史）—— 草稿改动本身不写历史。
 */
import { create } from 'zustand';
import type { SearchExpression, SearchPredicate, SearchCategory, UnitAttrKind, StarOp } from '../types/search';
import { isUnitFacet } from '../services/rules';

type UnitAxis = UnitAttrKind | 'star';

const hasUnitFacet = (expr: SearchExpression) => expr.some(isUnitFacet);

/** 保证不变量：存在单位分面 ⟹ 表达式含 `category=unit`。 */
function ensureUnit(expr: SearchExpression): SearchExpression {
  if (hasUnitFacet(expr) && !expr.some((p) => p.type === 'category' && p.value === 'unit')) {
    return [...expr.filter((p) => p.type !== 'category'), { type: 'category' as const, value: 'unit' as const }];
  }
  return expr;
}

/** 移除指定谓词；若移除的是「类型」chip 且仍残留单位分面 → 连坐清除（见 §2.2 类型锁定）。 */
function removePredicate(expr: SearchExpression, pred: SearchPredicate): SearchExpression {
  let e = expr.filter((p) => p !== pred);
  if (pred.type === 'category' && hasUnitFacet(e)) {
    e = e.filter((p) => p.type !== 'category' && !isUnitFacet(p));
  }
  return ensureUnit(e);
}

/** 显式设置类型：非单位类型会清除单位分面；单位类型保留单位分面。 */
function replaceCategory(expr: SearchExpression, kind: SearchCategory): SearchExpression {
  let e = expr.filter((p) => p.type !== 'category');
  if (kind !== 'unit') e = e.filter((p) => !isUnitFacet(p));
  return ensureUnit([...e, { type: 'category' as const, value: kind }]);
}

/** 设置某单位分面值（同轴替换）；保证存在类别 = unit。 */
function replaceUnitFacet(expr: SearchExpression, axis: UnitAxis, value: number, op: StarOp = 'gte'): SearchExpression {
  const e = expr.filter((p) => {
    if (p.type === 'unitAttr') return p.attr !== axis;
    if (p.type === 'unitStar') return axis !== 'star';
    return true;
  });
  const facet: SearchPredicate = axis === 'star'
    ? { type: 'unitStar', op, value }
    : { type: 'unitAttr', attr: axis, value };
  return ensureUnit([...e, facet]);}

interface DraftState {
  /** 当前规则集（草稿），始终已 `ensureUnit` 归一化。 */
  expr: SearchExpression;
  /** 名称框文本（= 名称谓词的值或 ''）。 */
  nameInput: string;
  /** 编辑名称框（draft）：非空 → nameSub，空 → 移除名称规则。 */
  setNameInput: (text: string) => void;
  /** 显式设置类型（draft）。 */
  setCategory: (kind: SearchCategory) => void;
  /** 设置单位分面值（draft）；同轴替换。 */
  setUnitFacet: (axis: UnitAxis, value: number, op?: StarOp) => void;
  /** 移除一条规则（draft）。 */
  removePredicate: (pred: SearchPredicate) => void;
  /** 从外部（历史/候选）回填整个表达式到草稿。 */
  load: (expr: SearchExpression) => void;
  /** 清空所有规则。 */
  reset: () => void;
  /** 序列化回表达式（如需强制同步名称谓词指向 nameInput，可先 setNameInput）。 */
  toExpr: () => SearchExpression;
}

export const useSearchDraft = create<DraftState>((set, get) => ({
  expr: [],
  nameInput: '',

  setNameInput: (text) => {
    const rest = get().expr.filter((p) => p.type !== 'nameSub' && p.type !== 'nameExact');
    const expr = text !== '' ? [...rest, { type: 'nameSub' as const, value: text }] : rest;
    set({ nameInput: text, expr: ensureUnit(expr) });
  },

  setCategory: (kind) => set({ expr: replaceCategory(get().expr, kind) }),

  setUnitFacet: (axis, value, op) => set({ expr: replaceUnitFacet(get().expr, axis, value, op) }),

  removePredicate: (pred) => set({ expr: removePredicate(get().expr, pred) }),

  load: (expr) => {
    const norm = ensureUnit(expr);
    const name = norm.find((p) => p.type === 'nameSub' || p.type === 'nameExact');
    set({ expr: norm, nameInput: name ? name.value : '' });
  },

  reset: () => set({ expr: [], nameInput: '' }),

  toExpr: () => get().expr,
}));

export type { UnitAxis };
