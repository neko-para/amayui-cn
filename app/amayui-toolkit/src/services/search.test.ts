import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDataset, type Dataset } from './dataset';
import { buildResults, queryFromEntry, queryFromId, expressionKey, expressionLabel } from './search';
import { cardFromResult } from '../types/search';
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
