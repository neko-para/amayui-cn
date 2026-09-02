import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useStore } from './useStore';
import { buildDataset } from '../services/dataset';
import type { Dataset } from '../services/dataset';
import type { Metadata } from '../types/metadata';
import { queryFromId, queryFromEntry } from '../services/search';
import { cardFromResult } from '../types/search';

let ds: Dataset;

beforeAll(() => {
  const md = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/metadata.json'), 'utf8')) as Metadata;
  ds = buildDataset(md);
});

beforeEach(() => {
  // 重置到初始态
  useStore.setState({
    dataset: ds,
    history: [{ expr: [], view: [{ kind: 'message', text: 'init' }] }],
    pos: 0,
    historyEntries: [],
  });
});

describe('store 历史（表达式 query 模型）', () => {
  it('同一表达式只保留最新一条，且最新在顶部', () => {
    const s = useStore.getState();
    const u = ds.metadata.units[0].unitId;
    const unitExpr = queryFromId('unit', u);        // category+idExact（单实体）
    const itemExpr = queryFromId('item', 2);

    const nav = (expr: typeof unitExpr, kind: Parameters<typeof cardFromResult>[0], id: number) =>
      s.navigate(expr, [cardFromResult(kind, id)]);

    nav(unitExpr, 'unit', u);   // 第 1 次（单位）
    nav(itemExpr, 'item', 2);   // 第 2 次（物品）
    nav(unitExpr, 'unit', u);   // 第 3 次（重复单位）

    const entries = useStore.getState().historyEntries;
    expect(entries.length).toBe(2);
    expect(entries[0].key).toBe('category:unit & idExact:' + u.toString(16));
    expect(entries[1].key).toBe('category:item & idExact:2');
  });

  it('点击历史项调用 navigate（生成新历史，而非恢复 pos）', () => {
    const s = useStore.getState();
    const unit = ds.metadata.units[0];
    const expr = queryFromEntry({ kind: 'unit', name: unit.name, nameZh: unit.nameZh });
    s.navigate(expr, [cardFromResult('unit', unit.unitId)]);
    const posBefore = useStore.getState().pos;
    const histLenBefore = useStore.getState().history.length;

    // 模拟点击历史：navigate 到历史条目（用其 expr + view）
    const e = useStore.getState().historyEntries[0];
    useStore.getState().navigate(e.expr, e.view);

    const st = useStore.getState();
    expect(st.history.length).toBe(histLenBefore + 1); // 新增一条（非覆盖）
    expect(st.pos).toBe(st.history.length - 1);
    expect(st.pos).toBeGreaterThanOrEqual(posBefore);
  });
});
