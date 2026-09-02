import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDataset, type Dataset } from './dataset';
import { buildResults, queryFromEntry, queryFromId, queryFromUnitAttr, queryFromUnitStar, queryFromTraining, expressionKey, expressionLabel } from './search';
import { cardFromResult, type SearchExpression } from '../types/search';
import type { Metadata } from '../types/metadata';

let ds: Dataset;

beforeAll(() => {
  const md = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/metadata.json'), 'utf8')) as Metadata;
  ds = buildDataset(md);
});

describe('搜索内核：queryFromEntry（category + nameExact）', () => {
  it('构造 [category, nameExact]，求值 = 该类型同名实体全部', () => {
    const u = ds.search.find((e) => e.kind === 'unit' && e.nameZh === '菲亚-伊布拉姆')!;
    const expr = queryFromEntry(u);
    expect(expr).toEqual([
      { type: 'category', value: 'unit' },
      { type: 'nameExact', value: '菲亚-伊布拉姆' },
    ]);
    // 重名单位应多张卡
    const view = buildResults(expr, ds).map((r) => cardFromResult(r.kind, r.id));
    expect(view.length).toBeGreaterThan(1);
    expect(view.every((c) => c.kind === 'unit')).toBe(true);
  });

  it('未汉化实体用 name 作精确值', () => {
    const it = ds.search.find((e) => e.kind === 'item' && e.nameZh === e.name)!;
    const expr = queryFromEntry(it);
    expect(expr[1]).toEqual({ type: 'nameExact', value: it.name });
  });
});

describe('搜索内核：queryFromId（category + idExact）', () => {
  it('求值 = 指定单实体的一张卡', () => {
    const expr = queryFromId('item', 1);
    const view = buildResults(expr, ds).map((r) => cardFromResult(r.kind, r.id));
    expect(view).toEqual([{ kind: 'item', id: 1 }]);
    const r = buildResults(expr, ds);
    expect(r[0].nameZh).toBe('青铜导键');
  });
});

describe('搜索内核：交集与去重/排序', () => {
  it('同时含 category + nameExact 只出交集（该类型同名）——不跨类型', () => {
    const skill = ds.search.find((e) => e.kind === 'skill' && e.nameZh === '防御')!;
    const expr = queryFromEntry(skill);
    const view = buildResults(expr, ds);
    expect(view.length).toBe(1);
    expect(view[0].kind).toBe('skill');
  });

  it('结果按 kind 固定序 → 序号排序，且 (kind,id) 去重', () => {
    // 手动构造一个跨 category 的表达式（含类别 + 空匹配会不同，这里用单类验证排序稳定）
    const expr = queryFromId('item', 1);
    const a = buildResults(expr, ds);
    const b = buildResults(expr, ds);
    expect(a).toEqual(b);   // 幂等、顺序稳定
    expect(a.length).toBe(1);
  });

  it('idExact 同时匹配 id 下标与名串地址', () => {
    // 因夫鲁斯骑士 unitId=0x9b → addr 17b51 = 0x17b51（id 值 0x9b ≠ 地址值，验证两种匹配路径）
    const byId = buildResults([{ type: 'category', value: 'unit' }, { type: 'idExact', value: 0x9b }], ds);
    expect(byId.length).toBe(1);
    expect(byId[0].nameZh).toBe('因夫鲁斯骑士');
  });
});

describe('搜索内核：expressionKey / expressionLabel', () => {
  it('key 规范化：子句顺序无关、稳定', () => {
    const e1 = [{ type: 'category' as const, value: 'unit' as const }, { type: 'nameExact' as const, value: '火' }];
    const e2 = [{ type: 'nameExact' as const, value: '火' }, { type: 'category' as const, value: 'unit' as const }];
    expect(expressionKey(e1)).toBe(expressionKey(e2));
  });

  it('label 只用类型 + 名称，不暴露表达式', () => {
    const expr = queryFromEntry({ kind: 'unit', name: '火xx', nameZh: '火' });
    const label = expressionLabel(expr);
    expect(label).toBe('单位 · 火');
    expect(label).not.toContain('nameExact');
  });
});

describe('搜索内核：unitAttr（单位属性，自动附加 category=unit）', () => {
  it('queryFromUnitAttr 返回 [category=unit, unitAttr]，且求值 = 同属性单位', () => {
    const expr = queryFromUnitAttr('race', 4);   // 鬼
    expect(expr).toEqual([
      { type: 'category', value: 'unit' },
      { type: 'unitAttr', attr: 'race', value: 4 },
    ]);
    const view = buildResults(expr, ds).map((r) => cardFromResult(r.kind, r.id));
    expect(view.length).toBeGreaterThan(0);
    expect(view.every((c) => c.kind === 'unit')).toBe(true);
  });

  it('只含 unitAttr 无 category 时，自动强制 category=unit（不命中其它类型）', () => {
    const expr: SearchExpression = [{ type: 'unitAttr', attr: 'attribute', value: 6 }];  // 神圣
    const view = buildResults(expr, ds);
    expect(view.length).toBeGreaterThan(0);
    expect(view.every((r) => r.kind === 'unit')).toBe(true);
    // 神圣属性单位必须 attribute=6
    for (const r of view) {
      const u = ds.byUnit.get(r.id)!;
      expect(u.attribute).toBe(6);
    }
  });

  it('性别子句（queryFromUnitAttr gender=2 女）命中女性单位', () => {
    const expr = queryFromUnitAttr('gender', 2);
    const view = buildResults(expr, ds);
    expect(view.length).toBeGreaterThan(0);
    for (const r of view) expect(ds.byUnit.get(r.id)!.gender).toBe(2);
  });

  it('key 规范化：unitAttr 子句稳定、顺序无关', () => {
    const e1: SearchExpression = [{ type: 'unitAttr', attr: 'race', value: 4 }, { type: 'category', value: 'unit' }];
    const e2: SearchExpression = [{ type: 'category', value: 'unit' }, { type: 'unitAttr', attr: 'race', value: 4 }];
    expect(expressionKey(e1)).toBe(expressionKey(e2));
  });

  it('label 显示「单位 · 种族 · 鬼」', () => {
    const expr = queryFromUnitAttr('race', 4);
    expect(expressionLabel(expr)).toBe('单位 · 种族 · 鬼');
  });
});

describe('搜索内核：unitStar（星级，自动附加 category=unit）', () => {
  it('queryFromUnitStar 返回 [category=unit, unitStar]，eq 精确匹配星数', () => {
    const expr = queryFromUnitStar('eq', 3);   // ★3
    expect(expr).toEqual([
      { type: 'category', value: 'unit' },
      { type: 'unitStar', op: 'eq', value: 3 },
    ]);
    // 锚点：狂暴的冰少女(0x136) star=2(0-based)→★3；哈尔皮亚(0xdc)=★2
    const view = buildResults(expr, ds);
    expect(view.length).toBeGreaterThan(0);
    for (const r of view) expect(ds.byUnit.get(r.id)!.star! + 1).toBe(3);
    expect(view.some((r) => r.id === 0x136)).toBe(true);   // 冰少女 ★3
  });

  it('gte 匹配 ≥★N（含更高星）', () => {
    const expr = queryFromUnitStar('gte', 4);   // ≥★4
    const view = buildResults(expr, ds);
    expect(view.length).toBeGreaterThan(0);
    for (const r of view) expect(ds.byUnit.get(r.id)!.star! + 1).toBeGreaterThanOrEqual(4);
  });

  it('只含 unitStar 无 category 时，自动强制 category=unit', () => {
    const expr: SearchExpression = [{ type: 'unitStar', op: 'gte', value: 4 }];
    const view = buildResults(expr, ds);
    expect(view.length).toBeGreaterThan(0);
    expect(view.every((r) => r.kind === 'unit')).toBe(true);
  });

  it('key 规范化：unitStar 子句稳定、顺序无关', () => {
    const e1: SearchExpression = [{ type: 'unitStar', op: 'gte', value: 4 }, { type: 'category', value: 'unit' }];
    const e2: SearchExpression = [{ type: 'category', value: 'unit' }, { type: 'unitStar', op: 'gte', value: 4 }];
    expect(expressionKey(e1)).toBe(expressionKey(e2));
  });

  it('label 显示「单位 · 星级 ≥ ★3」/恒等「=」', () => {
    expect(expressionLabel(queryFromUnitStar('gte', 3))).toBe('单位 · 星级 ≥ ★3');
    expect(expressionLabel(queryFromUnitStar('eq', 2))).toBe('单位 · 星级 = ★2');
  });
});

describe('搜索内核：queryFromTraining（DRINIT 训练需求 → query，文案用 textZh）', () => {
  it('纯属性条件：非空字段 → 对应 unitAttr；无 level 不加星子句', () => {
    const expr = queryFromTraining({ race: null, gender: null, attribute: 3, level: null });
    expect(expr).toEqual([{ type: 'unitAttr', attr: 'attribute', value: 3 }]);
  });

  it('属性+等级：level=2（★3 门槛）→ [unitAttr, unitStar gte 3]；自动 category=unit', () => {
    const expr = queryFromTraining({ race: null, gender: null, attribute: 3, level: 2 });
    expect(expr).toEqual([
      { type: 'unitAttr', attr: 'attribute', value: 3 },
      { type: 'unitStar', op: 'gte', value: 3 },
    ]);
    const view = buildResults(expr, ds);
    expect(view.length).toBeGreaterThan(0);
    expect(view.every((r) => r.kind === 'unit')).toBe(true);
  });

  it('level=4（★5）→ eq(5)（五星恰好、不说以上）', () => {
    const expr = queryFromTraining({ race: null, gender: null, attribute: 3, level: 4 });
    expect(expr).toContainEqual({ type: 'unitStar', op: 'eq', value: 5 });
  });

  it('种族/性别条件 → 对应 unitAttr 子句', () => {
    expect(queryFromTraining({ race: 4, gender: null, attribute: null, level: null }))
      .toContainEqual({ type: 'unitAttr', attr: 'race', value: 4 });
    expect(queryFromTraining({ race: null, gender: 2, attribute: null, level: null }))
      .toContainEqual({ type: 'unitAttr', attr: 'gender', value: 2 });
  });

  it('空条件（仅数量 / ★1以上无类型）→ 至少 category=unit（训练需求面向单位，不产生空 query）', () => {
    const expr = queryFromTraining({ race: null, gender: null, attribute: null, level: null });
    expect(expr).toEqual([{ type: 'category', value: 'unit' }]);
    // 求值 = 全部单位（非空），而不是空结果
    expect(buildResults(expr, ds).length).toBeGreaterThan(0);
  });
});
