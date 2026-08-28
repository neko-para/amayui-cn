import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDataset, querySearch, describeView, type Dataset } from '../services/dataset';
import type { Metadata, MapData } from '../types/metadata';

let ds: Dataset;
let md: Metadata;

beforeAll(() => {
  md = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/metadata.json'), 'utf8')) as Metadata;
  ds = buildDataset(md);
});

describe('map 数据索引', () => {
  it('byMapNum 能反查地图', () => {
    const m = ds.byMapNum.get(parseInt('54', 16));
    expect(m).toBeDefined();
    expect(m?.name).toBe('飢狼の黒曜湖');
    expect(m?.nameZh).toBe('饥狼的黑曜湖');
  });

  it('地图含单位槽且坐标/等级范围完整', () => {
    const m = ds.byMapNum.get(parseInt('54', 16))!;
    expect(m.units.length).toBe(21);
    const first = m.units[0];
    expect(first.row).toBeGreaterThan(0);
    expect(first.col).toBeGreaterThan(0);
    expect(first.levelMin).toBeGreaterThan(0);
    expect(first.levelMax).toBeGreaterThan(first.levelMin!);
  });

  it('mapsWithUnit 反向查询：某单位出现的地图', () => {
    // 找出现空前广的单位（用在最多地图里的）
    let best: number | null = null;
    let bestCount = 0;
    for (const [unitId, maps] of ds.mapsWithUnit) {
      if (maps.length > bestCount) { bestCount = maps.length; best = unitId; }
    }
    expect(best).not.toBeNull();
    expect(bestCount).toBeGreaterThan(0);
  });

  it('mapsWithUnit 每项带 spawnable 且地图引用正确', () => {
    const m = ds.byMapNum.get(parseInt('54', 16))!;
    // map54 内取一个可刷新槽的单位作样例
    const some = m.units.find((u) => u.spawnFlag === 1);
    expect(some).toBeDefined();
    const appearances = ds.mapsWithUnit.get(some!.unitRef)!;
    const entry = appearances.find((a) => a.map.mapNo === m.mapNo);
    expect(entry).toBeDefined();
    expect(entry!.spawnable).toBe(true);
  });
});

describe('搜索（含地图）', () => {
  it('可按地图中/日名搜索', () => {
    const zh = querySearch(ds.search, '饥狼');
    expect(zh.some((e) => e.kind === 'map')).toBe(true);
    const jp = querySearch(ds.search, '黒曜湖');
    expect(jp.some((e) => e.kind === 'map')).toBe(true);
  });

  it('地图搜索项 sub 标记为地图', () => {
    const r = querySearch(ds.search, '饥狼').find((e) => e.kind === 'map');
    expect(r?.sub).toBe('地图');
  });
});

describe('数据一致性', () => {
  it('大部分地图单位的 unitRef 都能对应 EBINIT 单位（少数特殊值除外）', () => {
    const total = md.maps.reduce((s: number, m: MapData) => s + m.units.length, 0);
    let resolved = 0;
    for (const m of md.maps) for (const u of m.units) if (ds.byUnit.has(u.unitRef)) resolved++;
    expect(resolved).toBeGreaterThan(total * 0.7);
  });

  it('地图名称与 data 表一致', () => {
    const m = ds.byMapNum.get(parseInt('54', 16))!;
    expect(m.nameZh).toBe('饥狼的黑曜湖');
  });

  it('counts.maps 与实际地图数组一致', () => {
    expect(md.counts.maps).toBe(md.maps.length);
    expect(md.counts.mapUnitEntries).toBe(md.maps.reduce((s: number, m: MapData) => s + m.units.length, 0));
  });
});

describe('describeView（历史条目）', () => {
  it('物品单卡生成 key/label 且 kind=item', () => {
    const e = describeView([{ kind: 'item', id: 1 }], ds)!;
    expect(e.key).toBe('item:1');
    expect(e.label).toContain('青铜导键');
    expect(e.kind).toBe('item');
  });

  it('地图单卡生成 key/label 且 kind=map', () => {
    const e = describeView([{ kind: 'map', mapNo: parseInt('54', 16) }], ds)!;
    expect(e.key).toBe(`map:${parseInt('54', 16)}`);
    expect(e.label).toContain('饥狼的黑曜湖');
    expect(e.kind).toBe('map');
  });

  it('空 view 与 message 不生成条目', () => {
    expect(describeView([], ds)).toBeNull();
    expect(describeView([{ kind: 'message', text: 'hi' }], ds)).toBeNull();
  });

  it('不同目标 key 唯一；同一目标 key 相同（供去重）', () => {
    const a = describeView([{ kind: 'unit', id: ds.metadata.units[0].unitId }], ds)!;
    const b = describeView([{ kind: 'unit', id: ds.metadata.units[0].unitId }], ds)!;
    const c = describeView([{ kind: 'item', id: 2 }], ds)!;
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });
});
