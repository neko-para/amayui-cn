import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDataset, filterCandidates, describeView, type Dataset } from '../services/dataset';
import { buildResults, queryFromId, queryFromEntry } from '../services/search';
import { cardFromResult } from '../types/search';
import type { Metadata, MapData } from '../types/metadata';
import { addrHex, entityTagLabel } from './idspace';

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

describe('候选筛选（filterCandidates，输入仅筛候选，不解析表达式）', () => {
  it('可按地图中/日名筛选候选', () => {
    const zh = filterCandidates(ds.search, '饥狼');
    expect(zh.some((e) => e.kind === 'map')).toBe(true);
    const jp = filterCandidates(ds.search, '黒曜湖');
    expect(jp.some((e) => e.kind === 'map')).toBe(true);
  });

  it('候选条目单实体；sub 标记为地图', () => {
    const r = filterCandidates(ds.search, '饥狼').find((e) => e.kind === 'map');
    expect(r).toBeDefined();
    expect(r!.sub).toBe('地图');
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

  it('地点候选可筛选', () => {
    const hit = filterCandidates(ds.search, '乌拉加尔');
    expect(hit.some((e) => e.kind === 'location' && e.nameZh === '乌拉加尔双山')).toBe(true);
  });

  it('地图候选按 mapNo 去重（干风之山只出现一条）', () => {
    const hit = filterCandidates(ds.search, '干风之山');
    const maps = hit.filter((e) => e.kind === 'map');
    expect(maps.length).toBe(1);
    expect(maps[0].nameZh).toBe('干风之山');
  });

  it('16 进制数候选：按名串地址完整匹配对应实体（不做前缀/后缀模糊）', () => {
    // 因夫鲁斯骑士 的 unitId=0x17b51 → addr '17b51'（完整匹配命中）
    expect(filterCandidates(ds.search, '17b51').some((e) => e.kind === 'unit' && e.nameZh === '因夫鲁斯骑士')).toBe(true);
    // 后缀 '7b51' 不完整 → 不应命中
    expect(filterCandidates(ds.search, '7b51').filter((e) => e.kind === 'unit').length).toBe(0);
    // 物品地址（0x18e40 + id）：青铜导键 id=1 → addr '18e41'
    expect(filterCandidates(ds.search, '18e41').some((e) => e.kind === 'item' && e.nameZh === '青铜导键')).toBe(true);
    // 前缀 '18e4' 不完整 → 不应命中
    expect(filterCandidates(ds.search, '18e4').filter((e) => e.kind === 'item').length).toBe(0);
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

describe('单位导出覆盖（含追加包，不做可玩角色过滤）', () => {
  it('全量保留 EBINIT 单位（含追加包 $n$），地图引用全部可解析', () => {
    // 追加包单位存在（source != EBINIT.txt）
    const append = md.units.filter((u) => u.source !== 'EBINIT.txt');
    expect(append.length).toBeGreaterThan(0);
    // 每个地图单位槽的 unitRef 都能反查到单位
    for (const m of md.maps) for (const mu of m.units) {
      expect(ds.byUnit.has(mu.unitRef)).toBe(true);
    }
    // 追加包样例：姬斯尼尔(旧地址 0x17abb → 1-based id 0x5) 曾被漏掉，现在应在
    expect(ds.byUnit.has(0x5)).toBe(true);
  });
});

describe('单位种族/性别/属性（EBINIT per-unit struct，v5）', () => {
  it('种族/性别全有值；属性仅 0xcb 系留系神殿兵 为 null（模板占位，如实保留）', () => {
    expect(md.units.filter((u) => u.race === null).length).toBe(0);
    expect(md.units.filter((u) => u.gender === null).length).toBe(0);
    const nullAttr = md.units.filter((u) => u.attribute === null);
    expect(nullAttr.map((u) => u.unitId)).toEqual([0xcb]);
    expect(nullAttr[0].nameZh).toBe('系留员神殿兵');
  });

  it('训练单位自身 种族/属性 与设定吻合（天使→神圣、鬼→物理、创造→物理）', () => {
    // 天使：大天使拉乌纳斯（名字带「大天使」，属性为神圣）
    const angel = md.units.find((u) => u.nameZh === '大天使拉乌纳斯')!;
    expect(angel.race).toBe(7);          // 天使
    expect(angel.attribute).toBe(6);     // 神圣
    // 鬼
    const oni = ds.byUnit.get(0xfa)!;    // 迷い入った小鬼
    expect(oni.race).toBe(4);            // 鬼
    expect(oni.attribute).toBe(1);       // 物理
    // 创造（石巨人）
    const construct = md.units.find((u) => u.nameZh === '封炼的石巨人')!;
    expect(construct.race).toBe(0xd);    // 創造
    expect(construct.attribute).toBe(1); // 物理
  });

  it('种族/性别/属性 值域合法（性别 1..3、属性 1..7）', () => {
    const ok = md.units.every((u) => {
      if (u.gender !== null && (u.gender < 1 || u.gender > 3)) return false;
      if (u.attribute !== null && (u.attribute < 1 || u.attribute > 7)) return false;
      return true;
    });
    expect(ok).toBe(true);
  });
});

describe('trainings（DRINIT 训练所，独立数据域 v6）', () => {
  it('counts 与数组一致；440 条、6 个训练者（四结骑+双傀）', () => {
    expect(md.counts.trainings).toBe(md.trainings.length);
    expect(md.counts.trainers).toBe(new Set(md.trainings.map((t) => t.trainerId)).size);
    expect(md.trainings.length).toBe(440);
    expect(md.counts.trainers).toBe(6);
  });

  it('训练者单位与 6 个单位对应（0x32..0x38），名已解码', () => {
    const trainers = [...new Set(md.trainings.map((t) => t.trainerId))].sort((a, b) => a - b);
    expect(trainers).toEqual([0x32, 0x33, 0x34, 0x35, 0x37, 0x38]);
    // 训练者名反查 units
    for (const t of md.trainings) {
      const u = ds.byUnit.get(t.trainerId)!;
      expect(t.trainerNameZh).toBe(u.nameZh);
    }
  });

  it('TID 连贯：base 1..0x36 → $3$ 从 0x37 续（训练者 0x32 有 80 条）', () => {
    const t32 = md.trainings.filter((t) => t.trainerId === 0x32).sort((a, b) => a.tid - b.tid);
    expect(t32.length).toBe(80);
    expect(t32[0].tid).toBe(1);
    expect(t32[79].tid).toBe(0x50);
    // base 与 $3$ 交界：TID 1..0x36 来自 DRINIT.txt，0x37 起来自 $3$DRINIT.txt
    expect(t32[0x36 - 1].source).toBe('DRINIT.txt');
    expect(t32[0x36].source).toBe('$3$DRINIT.txt');
  });

  it('字段解码符合设定（种族/性别/属性枚举同 units）', () => {
    // 冷却属性 ×５ → attribute=3(冷却), quantity=5
    const cooling = md.trainings.find((t) => t.textZh.includes('冷却属性') && t.race === null)!;
    expect(cooling.attribute).toBe(3);
    expect(cooling.quantity).toBeGreaterThan(0);
    // 鬼 ★３以上 ×４ → race=4(鬼), level=2(★3→N-1), quantity=4
    const oni = md.trainings.find((t) => t.textZh.includes('鬼') && t.textZh.includes('★３以上'))!;
    expect(oni.race).toBe(4);
    expect(oni.level).toBe(2);
    expect(oni.quantity).toBe(3);   // ★３以上の鬼 ×３
  });

  it('技能效果 id 可与 skills 交叉反查（部分指向真实技能）', () => {
    const withSkill = md.trainings.filter((t) => t.skillId !== null);
    expect(withSkill.length).toBeGreaterThan(0);
    // 至少部分 skillId 能命中 skills 表
    const hit = withSkill.some((t) => md.skills.some((s) => s.skillId === t.skillId));
    expect(hit).toBe(true);
  });
});

describe('skill（SKINIT 技能名 + 三行描述）', () => {
  it('counts 与数组一致；450 个技能、449 个带描述', () => {
    expect(md.counts.skills).toBe(md.skills.length);
    expect(md.counts.skillsWithDesc).toBe(md.skills.filter((s) => s.hasDesc).length);
    expect(md.skills.length).toBe(450);
    expect(md.counts.skillsWithDesc).toBe(449);
  });

  it('bySkill 反查：#1 防御 的名 + 三行文案（日/中）齐全', () => {
    const sk = ds.bySkill.get(1)!;
    expect(sk).toBeDefined();
    expect(sk.name).toBe('防御');
    expect(sk.title).toBe('【行動：防御】');
    expect(sk.titleZh).toBe('【行动：防御】');
    expect(sk.body).toBe('　攻撃しない防御態勢 回避+10 物防と魔防+3');
    expect(sk.bodyZh).toBe('　不攻击的防御姿态 回避+10 物防与魔防+3');
    expect(sk.short).toBe('回避+10 物防&魔防+3　攻撃不可');
    expect(sk.shortZh).toBe('回避+10 物防&魔防+3　不可攻击');
    expect(sk.hasDesc).toBe(true);
    expect(sk.source).toBe('SKINIT.txt');
  });

  it('三段并列数组地址模型：skillId 唯一、落在 1..0x3e8 内', () => {
    const seen = new Set<number>();
    for (const s of md.skills) {
      expect(seen.has(s.skillId)).toBe(false);
      seen.add(s.skillId);
      expect(s.skillId).toBeGreaterThanOrEqual(1);
      expect(s.skillId).toBeLessThan(0x3e8);
      expect(s.name).toBeTruthy();       // 每个技能必有名字
    }
  });

  it('带描述的技能三行齐全；hasDesc=false 的三行全 null（实测仅 #40 進行不可）', () => {
    for (const s of md.skills) {
      if (s.hasDesc) {
        expect(s.title).not.toBeNull();
        expect(s.body).not.toBeNull();
        expect(s.short).not.toBeNull();
      } else {
        expect(s.title).toBeNull();
        expect(s.body).toBeNull();
        expect(s.short).toBeNull();
      }
    }
    const noDesc = md.skills.filter((s) => !s.hasDesc);
    expect(noDesc.map((s) => s.skillId)).toEqual([40]);
    expect(noDesc[0].name).toBe('進行不可');
  });

  it('追加包 $n$SKINIT 的技能也被收录', () => {
    const append = md.skills.filter((s) => s.source !== 'SKINIT.txt');
    expect(append.length).toBeGreaterThan(0);
    const s = ds.bySkill.get(352)!;   // $3$SKINIT.txt：零距離流刃槍破
    expect(s.source).toBe('$3$SKINIT.txt');
    expect(s.nameZh).toBe('零距离流刃枪破');
  });

  it('技能可按中/日名筛选候选，sub 显示中文简述', () => {
    const zh = filterCandidates(ds.search, '铁壁').filter((e) => e.kind === 'skill');
    expect(zh.length).toBeGreaterThanOrEqual(1);
    expect(zh[0].sub).toBe('回避+10 物防&魔防+6　不可攻击');
    const jp = filterCandidates(ds.search, '鉄壁');
    expect(jp.some((e) => e.kind === 'skill' && e.nameZh === '铁壁')).toBe(true);
  });

  it('16 进制候选按技能名串地址（0x1d4f4 + skillId）完整匹配', () => {
    // #1 防御 → addr 1d4f5
    expect(filterCandidates(ds.search, '1d4f5').some((e) => e.kind === 'skill' && e.nameZh === '防御')).toBe(true);
    // 前缀不完整 → 不命中
    expect(filterCandidates(ds.search, '1d4f').filter((e) => e.kind === 'skill').length).toBe(0);
  });

  it('queryFromId 求值：技能单实体的 view 与历史标签', () => {
    const expr = queryFromId('skill', 1);
    const view = buildResults(expr, ds).map((r) => cardFromResult(r.kind, r.id));
    expect(view).toEqual([{ kind: 'skill', skillId: 1 }]);
    const e = describeView(expr, view, ds)!;
    expect(e.key).toBe('category:skill & idExact:1');
    expect(e.label).toContain('防御');
    expect(e.kind).toBe('skill');
  });
});

describe('id 空间与地址徽标（idspace）', () => {
  it('各 id 空间基址与实体名串地址吻合（抽样对照已知实体）', () => {
    expect(addrHex('item', 1)).toBe('18e41');        // 青铜导键
    expect(addrHex('unit', 0x9b)).toBe('17b51');     // 因夫鲁斯骑士
    expect(addrHex('skill', 1)).toBe('1d4f5');       // 防御
    expect(addrHex('map', 0x54)).toBe('12236');      // 饥狼的黑曜湖
    expect(addrHex('location', 0x11)).toBe('1217f'); // 弱者的遗迹
  });

  it('徽标格式统一为「类型 #id16 · 地址16」，id 与地址都用 16 进制', () => {
    expect(entityTagLabel('item', 1)).toBe('物品 #1 · 18e41');
    expect(entityTagLabel('skill', 0x28)).toBe('技能 #28 · 1d51c');   // #40 進行不可
    expect(entityTagLabel('location', 0x11)).toBe('地点 #11 · 1217f');
  });

  it('卡片上显示的地址 = 搜索项的 addr（即可直接粘回搜索框定位）', () => {
    // 这是本次改动的核心不变量：展示地址与搜索键必须同源同形
    for (const e of ds.search) {
      expect(e.addr).toBe(addrHex(e.kind, e.id));
    }
  });

  it('每个 id 空间都能用卡片上的地址反查回同一实体', () => {
    const cases: [Parameters<typeof addrHex>[0], number, string][] = [
      ['item', 1, '青铜导键'],
      ['building', 1, '阿瓦罗的工房'],
      ['unit', 0x9b, '因夫鲁斯骑士'],
      ['map', 0x54, '饥狼的黑曜湖'],
      ['location', 0x11, '弱者的遗迹'],
      ['skill', 1, '防御'],
    ];
    for (const [space, id, nameZh] of cases) {
      const hit = filterCandidates(ds.search, addrHex(space, id));
      expect(hit.some((e) => e.kind === space && e.nameZh === nameZh)).toBe(true);
    }
  });

  it('物品/建筑 id 空间重叠时地址仍可区分（同 id 不同实体）', () => {
    // id 51：物品=城砦拡張図面Ⅰ，建筑=小さな家（黄）——id 相同，名串地址不同
    expect(addrHex('item', 51)).not.toBe(addrHex('building', 51));
    expect(ds.byItem.get(51)).toBeDefined();
    expect(ds.byBuilding.get(51)).toBeDefined();
  });
});

describe('describeView（历史条目：表达式 query 模型）', () => {
  it('queryFromId 单实体生成 key/label 且 kind=item', () => {
    const expr = queryFromId('item', 1);
    const view = buildResults(expr, ds).map((r) => cardFromResult(r.kind, r.id));
    const e = describeView(expr, view, ds)!;
    expect(e.key).toBe('category:item & idExact:1');
    expect(e.label).toContain('青铜导键');
    expect(e.kind).toBe('item');
  });

  it('queryFromId 地图单实体生成 key/label 且 kind=map', () => {
    const expr = queryFromId('map', parseInt('54', 16));
    const view = buildResults(expr, ds).map((r) => cardFromResult(r.kind, r.id));
    const e = describeView(expr, view, ds)!;
    expect(e.key).toBe(`category:map & idExact:${parseInt('54', 16).toString(16)}`);
    expect(e.label).toContain('饥狼的黑曜湖');
    expect(e.kind).toBe('map');
  });

  it('queryFromEntry 同名组生成「类型 · 名称 ×N」标签（重名单位多个）', () => {
    // 菲亚-伊布拉姆 存在重名单位（3 个）；queryFromEntry 用 category+nameExact 命中全部同名
    const u = ds.search.find((e) => e.kind === 'unit' && e.nameZh === '菲亚-伊布拉姆')!;
    const expr = queryFromEntry(u);
    const view = buildResults(expr, ds).map((r) => cardFromResult(r.kind, r.id));
    expect(view.length).toBeGreaterThan(1);
    const e = describeView(expr, view, ds)!;
    expect(e.label).toContain('×');
  });

  it('空 view 与 message 不生成条目', () => {
    expect(describeView([], [], ds)).toBeNull();
    expect(describeView([], [{ kind: 'message', text: 'hi' }], ds)).toBeNull();
  });

  it('不同表达式 key 唯一；同一表达式 key 相同（供去重）', () => {
    const unitId = ds.metadata.units[0].unitId;
    const aExpr = queryFromId('unit', unitId);
    const aView = buildResults(aExpr, ds).map((r) => cardFromResult(r.kind, r.id));
    const bExpr = queryFromId('unit', unitId);
    const bView = buildResults(bExpr, ds).map((r) => cardFromResult(r.kind, r.id));
    const cExpr = queryFromId('item', 2);
    const cView = buildResults(cExpr, ds).map((r) => cardFromResult(r.kind, r.id));
    const a = describeView(aExpr, aView, ds)!;
    const b = describeView(bExpr, bView, ds)!;
    const c = describeView(cExpr, cView, ds)!;
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });
});
