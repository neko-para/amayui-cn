import { describe, it, expect } from 'vitest';
import { rulesFromExpr, isNamePredicate, isUnitFacet } from '../services/rules';
import type { SearchExpression } from '../types/search';

describe('rulesFromExpr（谓词 → 可见规则文案）', () => {
  it('各谓词 → 对应中文规则文案', () => {
    const expr: SearchExpression = [
      { type: 'category', value: 'unit' },
      { type: 'nameExact', value: '鬼' },
      { type: 'unitAttr', attr: 'race', value: 0x4 },
      { type: 'unitAttr', attr: 'gender', value: 0x2 },
      { type: 'unitAttr', attr: 'attribute', value: 0x4 },
      { type: 'unitStar', op: 'gte', value: 3 },
    ];
    const labels = rulesFromExpr(expr).map((r) => r.label);
    expect(labels).toEqual([
      '类型: 单位',
      '名称=「鬼」',
      '种族: 鬼',
      '性别: 女',
      '属性: 火炎',
      '星级≥★3',
    ]);
  });

  it('idExact → id <hex>；nameSub → 名称含 "x"；星级 = → 星级=★N', () => {
    expect(rulesFromExpr([{ type: 'idExact', value: 0x2a }]).map((r) => r.label)).toEqual(['id 2a']);
    expect(rulesFromExpr([{ type: 'nameSub', value: '火炎' }]).map((r) => r.label)).toEqual(['名称含 "火炎"']);
    expect(rulesFromExpr([{ type: 'unitStar', op: 'eq', value: 5 }]).map((r) => r.label)).toEqual(['星级=★5']);
  });

  it('空表达式 → []', () => {
    expect(rulesFromExpr([])).toEqual([]);
  });
});

describe('谓词分类辅助', () => {
  it('isNamePredicate 识别 名称 类', () => {
    expect(isNamePredicate({ type: 'nameSub', value: 'x' })).toBe(true);
    expect(isNamePredicate({ type: 'nameExact', value: 'x' })).toBe(true);
    expect(isNamePredicate({ type: 'category', value: 'unit' })).toBe(false);
  });

  it('isUnitFacet 识别 单位分面 谓词', () => {
    expect(isUnitFacet({ type: 'unitAttr', attr: 'race', value: 1 })).toBe(true);
    expect(isUnitFacet({ type: 'unitStar', op: 'gte', value: 2 })).toBe(true);
    expect(isUnitFacet({ type: 'category', value: 'unit' })).toBe(false);
  });
});
