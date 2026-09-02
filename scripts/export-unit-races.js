#!/usr/bin/env node
// export-unit-races.js
// 从 EBINIT 提取每个单位的「种族」「性别」「属性」字段。
//
// 种族字段（逆向确认）：addr = 0x52a0b4 + 单位id（1-based；单位名 addr = 0x17ab6 + 单位id）。
// 值域 0x1..0xf（16 进制）：1=人族(可玩/多数职业级), 2=亜人, 3=一般, 4=鬼, 5=巨人, 6=精霊,
//   7=天使, 8=悪魔, 9=魔獣, a=幻獣, b=霊体, c=不死, d=創造(非生物/石像/魔像), e=魔神, f=特殊。
//
// 性别字段（逆向确认）：addr = 0x52a49c + 单位id（与种族同处一个 per-unit struct）。
// 值域 0x1..0x3：1=男, 2=女, 3=无性别。
//
// 属性字段（逆向确认）：addr = 0x52b054 + 单位id（同 per-unit struct；用种族锚点识别）。
// 值域 0x1..0x7：#=物理, 2=地脉, 3=冷却, 4=火炎, 5=电击, 6=神圣, 7=暗黑。
//   锚点验证：天使 13/15=神圣(6)、霊体 12/13=暗黑(7)、鬼 12/12=物理(1)、创造 50/78=物理(1)。
//
// 校验口径（见 docs/re/src/07-单位种族与性别字段.md / 06-训练所数据.md §4a/§4b）：
//   种族：EBINIT 中含种族词的单位，其 0x52a0b4+id 值与词相符（>80%）；其余为“职业词/魔像分类”特判。
//   性别：0x52a49c+id 与已知锚点完全吻合 —— 含 姬/姬/王妃/女神/女/娘 的单位全为女(2)、
//         鬼族 12/12 全为男(1)、創造类 78 中 72 个无性别(3)。
//
// 用法: node scripts/export-unit-races.js [--raw]
//   --raw  用 data/(日文原名)；缺省用 src/，单位名取「日文 中文」。
// 输出: output/unit-races.csv

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, DATA_DIR, ROOT_DIR } from './config.js';

const RACE_BASE = 0x52a0b4;
const GENDER_BASE = 0x52a49c;
const ATTR_BASE = 0x52b054;
const STAR_BASE = 0x5461ec;   // 单位星级：star_val = STAR_BASE + unitId（0-based：0=★1 .. 4=★5）
const UNIT_BASE = 0x17ab6;

// 种族值 → 名称（0xe/0xf 未在 DRINIT 训练里出现，据单位名归类）
const RACE_NAME = {
  0x1: '人族', 0x2: '亜人', 0x3: '一般', 0x4: '鬼', 0x5: '巨人',
  0x6: '精霊', 0x7: '天使', 0x8: '悪魔', 0x9: '魔獣', 0xa: '幻獣',
  0xb: '霊体', 0xc: '不死', 0xd: '創造', 0xe: '魔神', 0xf: '特殊',
};
const GENDER_NAME = { 0x1: '男', 0x2: '女', 0x3: '无性别' };
const ATTR_NAME = { 0x1: '物理', 0x2: '地脉', 0x3: '冷却', 0x4: '火炎', 0x5: '电击', 0x6: '神圣', 0x7: '暗黑' };

const useSrc = !process.argv.includes('--raw');
const root = useSrc ? SRC_DIR : DATA_DIR;

const movs = {}, names = {};
for (const f of fs.readdirSync(root).filter((x) => /ebinit\.txt$/i.test(x))) {
  const t = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of t.matchAll(/^mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/gm)) { const a = parseInt(m[1], 16); if (!(a in movs)) movs[a] = m[2]; }
  for (const m of t.matchAll(/^set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/gm)) { const a = parseInt(m[1], 16); if (!(a in names)) names[a] = m[2]; }
}
const disp = (raw) => { if (!raw) return ''; const i = raw.indexOf('|'); const jp = i < 0 ? raw : raw.slice(0, i); const zh = i < 0 ? '' : raw.slice(i + 1); return zh && zh !== jp ? `${jp} ${zh}` : jp; };
const nameOf = (id) => disp(names[UNIT_BASE + id]);

// 收集有名字的单位（含追加包 $n$），按单位 id 排序
const unitIds = Object.keys(names).map(Number).filter((a) => a >= UNIT_BASE && a - UNIT_BASE > 0 && a - UNIT_BASE < 0x3e8).map((a) => a - UNIT_BASE).sort((x, y) => x - y);

const csv = ['单位id,单位名,种族值,种族,性别值,性别,属性值,属性,星级,单位名地址'];
for (const id of unitIds) {
  const name = nameOf(id);
  const v = movs[RACE_BASE + id];
  const val = v === undefined ? '' : v;
  const race = v === undefined ? '' : (RACE_NAME[parseInt(v, 16)] ?? `(未知${v})`);
  const g = movs[GENDER_BASE + id];
  const gval = g === undefined ? '' : g;
  const gender = g === undefined ? '' : (GENDER_NAME[parseInt(g, 16)] ?? `(未知${g})`);
  const a = movs[ATTR_BASE + id];
  const aval = a === undefined ? '' : a;
  const attr = a === undefined ? '' : (ATTR_NAME[parseInt(a, 16)] ?? `(未知${a})`);
  const st = movs[STAR_BASE + id];
  const star = st === undefined ? '' : `${parseInt(st, 16) + 1}`;   // 0-based → ★N
  csv.push(`${id.toString(16)},${name},${val},${race},${gval},${gender},${aval},${attr},${star},${(UNIT_BASE + id).toString(16)}`);
}
fs.writeFileSync(path.join(ROOT_DIR, 'output', 'unit-races.csv'), csv.join('\n') + '\n', 'utf8');

const dist = {}, gdist = {}, adist = {}, sdist = {};
let withRace = 0, withGender = 0, withAttr = 0, withStar = 0;
for (const id of unitIds) {
  const v = movs[RACE_BASE + id]; if (v) { withRace++; dist[v] = (dist[v] || 0) + 1; }
  const g = movs[GENDER_BASE + id]; if (g) { withGender++; gdist[g] = (gdist[g] || 0) + 1; }
  const a = movs[ATTR_BASE + id]; if (a) { withAttr++; adist[a] = (adist[a] || 0) + 1; }
  const s = movs[STAR_BASE + id]; if (s !== undefined) { withStar++; sdist[parseInt(s, 16) + 1] = (sdist[parseInt(s, 16) + 1] || 0) + 1; }
}
console.log(`已写出 output/unit-races.csv`);
console.log(`单位总数=${unitIds.length}  有种族=${withRace}  有性别=${withGender}  有属性=${withAttr}  有星级=${withStar}`);
console.log('种族分布:');
for (const v of Object.keys(dist).sort((a, b) => a - b)) console.log(`  0x${v} ${(RACE_NAME[parseInt(v, 16)] ?? '?')}: ${dist[v]}`);
console.log('性别分布:');
for (const v of Object.keys(gdist).sort((a, b) => a - b)) console.log(`  0x${v} ${(GENDER_NAME[parseInt(v, 16)] ?? '?')}: ${gdist[v]}`);
console.log('属性分布:');
for (const v of Object.keys(adist).sort((a, b) => a - b)) console.log(`  0x${v} ${(ATTR_NAME[parseInt(v, 16)] ?? '?')}: ${adist[v]}`);
console.log('星级分布(★N):');
for (const v of Object.keys(sdist).sort((a, b) => a - b)) console.log(`  ★${v}: ${sdist[v]}`);
