import { describe, it, expect } from 'vitest';
import { rulesFromExpr, isNamePredicate, isUnitFacet } from '../services/rules';
import { expressionLabel } from '../services/search';
import type { UnitAttrKind } from '../types/search';
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

describe('★双实现一致（`tickets/T-0131`）：rules 的 chip 文案 ⟷ search 的表达式文案', () => {
  // 为什么要有它：`rules.ts:68` 的 `UNIT_ATTR_LABEL` 与 `search.ts:263` 的 `UNIT_ATTR_LABEL` 是**两份手写副本**，
  // 取值名表（15 种族 / 3 性别 / 7 属性）也各存一份（`rules.ts` 的 `unitAttrValueName` 与 `search.ts` 的同名函数）。
  // 两边各有自己的测试 ⇒ **漂移会静默绿**（审计原话）。这条用"同一谓词在两处渲染出同一个词"把两份钉在一起。
  // 反例实验：把任一份表里的某个取值名改掉（如 race 0x4 的「鬼」→「鬼族」）⇒ 本用例红。
  const cases: Array<[UnitAttrKind, number[]]> = [
    ['race', [0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf]],
    ['gender', [0x1, 0x2, 0x3]],
    ['attribute', [0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7]],
  ];
  it('25 个取值（15 种族 / 3 性别 / 7 属性）在两处渲染出同一个词', () => {
    for (const [attr, values] of cases) {
      for (const v of values) {
        const expr: SearchExpression = [{ type: 'unitAttr', attr, value: v }];
        const rule = rulesFromExpr(expr).find((r) => r.axis === attr);
        expect(rule, `rulesFromExpr 应给出 ${attr}=${v} 的 chip`).toBeTruthy();
        // rules 的文案是 `种族: 人族`；search 的是 `种族 · 人族`（分隔符不同，词必须一致）
        const want = rule!.label.replace(': ', ' · ');
        expect(expressionLabel(expr)).toBe(want);
      }
    }
  });
});
