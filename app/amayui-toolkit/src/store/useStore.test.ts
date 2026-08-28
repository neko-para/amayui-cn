import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useStore } from './useStore';
import { buildDataset } from '../services/dataset';
import type { Dataset } from '../services/dataset';
import type { Metadata } from '../types/metadata';

let ds: Dataset;

beforeAll(() => {
  const md = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/metadata.json'), 'utf8')) as Metadata;
  ds = buildDataset(md);
});

beforeEach(() => {
  // 重置到初始态
  useStore.setState({
    dataset: ds,
    history: [{ kind: 'message', text: 'init' }],
    pos: 0,
    historyEntries: [],
  });
});

describe('store 历史去重（最新在前，点击重新跳转）', () => {
  it('同一目标只保留最新一条，且最新在顶部', () => {
    const s = useStore.getState();
    const u = ds.metadata.units[0].unitId;

    s.navigate([{ kind: 'unit', id: u }]);          // 第 1 次
    s.navigate([{ kind: 'item', id: 2 }]);          // 第 2 次
    s.navigate([{ kind: 'unit', id: u }]);          // 第 3 次（重复单位）

    const entries = useStore.getState().historyEntries;
    // 去重后：unit、item 两条；unit 最新在前
    expect(entries.length).toBe(2);
    expect(entries[0].key).toBe(`unit:${u}`);
    expect(entries[1].key).toBe('item:2');
  });

  it('点击历史项调用 navigate（生成新历史，而非恢复 pos）', () => {
    const s = useStore.getState();
    s.navigate([{ kind: 'item', id: 2 }]);
    const posBefore = useStore.getState().pos;
    const histLenBefore = useStore.getState().history.length;

    // 模拟点击历史：navigate 到历史条目 view
    const e = useStore.getState().historyEntries[0];
    useStore.getState().navigate(e.view);

    const st = useStore.getState();
    expect(st.history.length).toBe(histLenBefore + 1); // 新增一条（非覆盖）
    expect(st.pos).toBe(st.history.length - 1);
    expect(st.pos).toBeGreaterThanOrEqual(posBefore);
  });
});
