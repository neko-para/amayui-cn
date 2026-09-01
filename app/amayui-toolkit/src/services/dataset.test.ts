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

  it('地图以 STINIT2 场景为源：mapNo 唯一（无跨文件重复），单位按槽合并', () => {
    const seen = new Set<string>();
    for (const m of md.maps) expect(seen.has(m.mapNo)).toBe(false), seen.add(m.mapNo);
    // 干风之山：曾跨 6 个 STINIT 文件重复；现在应唯一且单位来自合并
    const gf = md.maps.filter((m) => m.nameZh === '干风之山');
    expect(gf.length).toBe(1);
    expect(gf[0].units.length).toBeGreaterThan(0);
  });
});

describe('location（抽象地点）数据', () => {
  it('locations 数量一致；弱者的遗迹(0x11) 归并 6 张地图', () => {
    expect(md.counts.locations).toBe(md.locations.length);
    const loc = ds.byLocation.get(0x11);
    expect(loc).toBeDefined();
    expect(loc!.nameZh).toBe('弱者的遗迹');
    expect(loc!.maps).toHaveLength(6);
  });

  it('龙笛峡谷(0xc) 归并格雷贝尔大堤防；地图 locationId 反查正确', () => {
    const loc = ds.byLocation.get(0xc)!;
    expect(loc.nameZh).toBe('龙笛峡谷');
    const map = ds.byMapNum.get(parseInt(loc.maps[0], 16))!;
    expect(map.locationId).toBe(0xc);
    const apps = ds.mapsByLocation.get(0xc)!;
    expect(apps.length).toBeGreaterThanOrEqual(1);
    expect(apps[0].map.nameZh).toBe('格雷贝尔大堤防');
  });

  it('map → location 反查（互跳键）', () => {
    const map = ds.byMapNum.get(parseInt('141', 16))!; // 赫塔雷斯迷宫１Ｆ
    expect(map.locationId).toBe(0x11);
    expect(ds.byLocation.get(map.locationId!)!.nameZh).toBe('弱者的遗迹');
  });

  it('地点搜索项可查询', () => {
    const hit = querySearch(ds.search, '乌拉加尔');
    expect(hit.some((e) => e.kind === 'location' && e.nameZh === '乌拉加尔双山')).toBe(true);
  });

  it('地图搜索按 mapNo 去重（干风之山只出现一条）', () => {
    const hit = querySearch(ds.search, '干风之山');
    const maps = hit.filter((e) => e.kind === 'map');
    expect(maps.length).toBe(1);
    expect(maps[0].nameZh).toBe('干风之山');
  });

  it('地点内场景按场景 seq 字段排序', () => {
    // 弱者的遗迹：赫塔雷斯 1F..6F 依 seq=1..6
    const ru = ds.byLocation.get(0x11)!;
    const ruSeqs = ru.maps.map((mn) => ds.byMapNum.get(parseInt(mn, 16))!.seq);
    expect(ruSeqs).toEqual([1, 2, 3, 4, 5, 6]);
    // 乌拉加尔双山：苔山→干风→岚燐→废弃矿山→山麓森林
    const ug = ds.byLocation.get(0x6)!;
    const ugNames = ug.maps.map((mn) => ds.byMapNum.get(parseInt(mn, 16))!.nameZh);
    expect(ugNames).toEqual(['苔山瀑布', '干风之山', '岚燐回廊', '废弃的旧矿山', '山麓的森林地带']);
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
