import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useStore } from './useStore';
import { useSearchDraft } from './useSearchDraft';
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
  useSearchDraft.getState().reset();
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

  it('navigate（卡片等任意路径）会把激活规则同步到搜索区草稿（顶部不失效）', () => {
    const s = useStore.getState();
    // 卡片/RefChip 路径：queryFromId（category+idExact）
    const unit = ds.metadata.units[0];
    const idExpr = queryFromId('unit', unit.unitId);
    s.navigate(idExpr, [cardFromResult('unit', unit.unitId)]);
    expect(useSearchDraft.getState().expr).toEqual(idExpr);
    expect(useSearchDraft.getState().nameInput).toBe('');   // idExact 无名称谓词 → 名称框空

    // 候选/历史路径：queryFromEntry（category+nameExact）→ 名称框同步
    const nameExpr = queryFromEntry({ kind: 'unit', name: unit.name, nameZh: unit.nameZh });
    s.navigate(nameExpr, [cardFromResult('unit', unit.unitId)]);
    expect(useSearchDraft.getState().nameInput).toBe(unit.nameZh || unit.name);
  });
});
