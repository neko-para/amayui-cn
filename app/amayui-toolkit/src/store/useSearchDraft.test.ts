import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchDraft } from './useSearchDraft';
import type { SearchExpression } from '../types/search';

const reset = () => useSearchDraft.getState().reset();
const s = () => useSearchDraft.getState();

describe('useSearchDraft（草稿规则：名称 + 分面，类型锁定）', () => {
  beforeEach(reset);

  it('初始为空', () => {
    expect(s().expr).toEqual([]);
    expect(s().nameInput).toBe('');
  });

  it('setNameInput：非空 → nameSub，空 → 移除名称规则', () => {
    s().setNameInput('火炎');
    expect(s().expr).toContainEqual({ type: 'nameSub', value: '火炎' });
    expect(s().nameInput).toBe('火炎');

    s().setNameInput('');
    expect(s().expr).not.toContainEqual({ type: 'nameSub', value: '火炎' });
    expect(s().nameInput).toBe('');
  });

  it('setCategory(unit) 只设类型；不自动加单位分面', () => {
    s().setCategory('unit');
    expect(s().expr).toContainEqual({ type: 'category', value: 'unit' });
  });

  it('setUnitFacet：自动锁定类型 = 单位', () => {
    s().setUnitFacet('race', 0x4);
    expect(s().expr).toContainEqual({ type: 'category', value: 'unit' });
    expect(s().expr).toContainEqual({ type: 'unitAttr', attr: 'race', value: 0x4 });
  });

  it('setUnitFacet 同轴替换；不同轴并存', () => {
    s().setUnitFacet('race', 0x4);
    s().setUnitFacet('race', 0x7);
    expect(s().expr.filter((p) => p.type === 'unitAttr' && p.attr === 'race')).toEqual([
      { type: 'unitAttr', attr: 'race', value: 0x7 },
    ]);
    s().setUnitFacet('gender', 0x2);
    expect(s().expr).toContainEqual({ type: 'unitAttr', attr: 'gender', value: 0x2 });
  });

  it('setCategory(非单位) 会清除单位分面', () => {
    s().setUnitFacet('race', 0x4);
    s().setCategory('item');
    expect(s().expr).not.toContainEqual({ type: 'unitAttr', attr: 'race', value: 0x4 });
    expect(s().expr).toContainEqual({ type: 'category', value: 'item' });
  });

  it('删除「类型=单位」chip（残留单位分面）→ 连坐清除', () => {
    s().setUnitFacet('race', 0x4);
    const cat = s().expr.find((p) => p.type === 'category')!;
    s().removePredicate(cat);
    expect(s().expr).toEqual([]);
  });

  it('load：回填表达式并同步名称框', () => {
    const expr: SearchExpression = [{ type: 'category', value: 'unit' }, { type: 'nameExact', value: '鬼' }];
    s().load(expr);
    expect(s().expr).toEqual(expr);
    expect(s().nameInput).toBe('鬼');
  });

  it('toExpr：返回当前草稿表达式', () => {
    s().setNameInput('火炎');
    s().setUnitFacet('attribute', 0x4);
    const expr = s().toExpr();
    expect(expr).toContainEqual({ type: 'nameSub', value: '火炎' });
    expect(expr).toContainEqual({ type: 'unitAttr', attr: 'attribute', value: 0x4 });
    expect(expr).toContainEqual({ type: 'category', value: 'unit' });
  });
});
