import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDataset, type Dataset } from './dataset';
import { buildResults, queryFromEntry, queryFromId, queryFromUnitAttr, queryFromUnitStar, queryFromTraining, expressionKey, expressionLabel } from './search';
import { cardFromResult, CATEGORY_ORDER, type SearchExpression } from '../types/search';
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

  it('★跨 kind：结果按 CATEGORY_ORDER → id 升序，且 (kind,id) 唯一', () => {
    // ★2026-09-23 重写（`tickets/T-0131`）：原版是「同一纯函数调两次 toEqual」——同输入同输出**恒真**
    //   （把 `search.ts:123` 的 sort 整行删掉它也不会红），而标题声称的"跨 kind 排序 + 去重"一句没测。
    //   现在：先找一个**在 ≥2 个 id 空间里都存在**的 id（各实体 id 是"名串地址 − 各自基址"，基址互不相干
    //   ⇒ 物品与设施的 id 本来就会重叠，见 `idspace.ts` 头注），再用 `idExact` 求值 ⇒ 真的跨 kind。
    const kindsById = new Map<number, Set<string>>();
    for (const e of ds.search) {
      const set = kindsById.get(e.id) ?? new Set<string>();
      set.add(e.kind);
      kindsById.set(e.id, set);
    }
    const crossId = [...kindsById.entries()].find(([, kinds]) => kinds.size >= 2)?.[0];
    expect(crossId, '数据集里应存在跨 id 空间重叠的 id（idspace.ts 的基址互不相干）').toBeTypeOf('number');

    const view = buildResults([{ type: 'idExact', value: crossId! }], ds);
    expect(view.length).toBe(kindsById.get(crossId!)!.size);
    expect(new Set(view.map((v) => v.kind)).size).toBeGreaterThanOrEqual(2);
    // ① kind 按固定序非降
    for (let i = 1; i < view.length; i++) {
      expect(CATEGORY_ORDER[view[i - 1]!.kind]).toBeLessThanOrEqual(CATEGORY_ORDER[view[i]!.kind]);
    }
    // ② 同一 kind 内 id 升序
    for (let i = 1; i < view.length; i++) {
      const a = view[i - 1]!, b = view[i]!;
      if (a.kind === b.kind) expect(a.id).toBeLessThan(b.id);
    }
    // ③ (kind,id) 唯一
    expect(new Set(view.map((v) => `${v.kind}:${v.id}`)).size).toBe(view.length);
    // ④ 同一谓词写两遍（交集不变）⇒ 结果一字不变（防"按谓词数翻倍"的实现）
    const twice = buildResults([{ type: 'idExact', value: crossId! }, { type: 'idExact', value: crossId! }], ds);
    expect(twice.map((v) => `${v.kind}:${v.id}`)).toEqual(view.map((v) => `${v.kind}:${v.id}`));
  });

  it('idExact 的两条匹配路径都要覆盖：按 id 下标 **与** 按名串地址', () => {
    // ★2026-09-23 修（`tickets/T-0131`）：原版只传 `0x9b`（= unitId），那**只**走 `byId` 分支 ——
    //   `search.ts` 的 `byAddr` 分支在整个测试集里**永不命中**（把它改成 false，87 例全绿）。
    //   因夫鲁斯骑士：unitId = 0x9b，名串地址 = 0x17ab6 + 0x9b = **0x17b51**。
    const byId = buildResults([{ type: 'category', value: 'unit' }, { type: 'idExact', value: 0x9b }], ds);
    expect(byId.length).toBe(1);
    expect(byId[0].nameZh).toBe('因夫鲁斯骑士');
    expect(byId[0].addr).toBe('17b51');

    // 按**地址值**查（此时 id 下标 ≠ 地址值 ⇒ 只有 `byAddr` 能命中）
    const byAddr = buildResults([{ type: 'category', value: 'unit' }, { type: 'idExact', value: 0x17b51 }], ds);
    expect(byAddr.length).toBe(1);
    expect(byAddr[0].nameZh).toBe('因夫鲁斯骑士');
    expect(byAddr[0].id).toBe(0x9b);
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
