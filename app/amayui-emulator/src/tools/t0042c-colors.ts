// 在真机 SAVE.DAT 里找屏幕上实测到的那些"文字色"是否本来就是配置值
import { readFileSync } from 'node:fs';
import { decodeSaveData } from '../vm/saveData.js';

const path = process.argv[2]!;
const bytes = new Uint8Array(readFileSync(path));
const r = decodeSaveData(bytes);
if (!r.ok) { console.error('解析失败', r.reason); process.exit(2); }
const { ints, strings } = r.data.tables;
console.log(`format=${r.data.format} int=${ints.size} string=${strings.size}`);

const want: [number, string][] = [
  [0xe9e6e4, '实测真机 235? 不 —— (233,230,228)'],
  [0xe9e6e4 & 0xffffff, '(233,230,228)'],
  [0xe3e3e3, '(227,227,227)'],
  [0xbfbfbf, '(191,191,191) "通常"'],
  [0xf4f2f3, '(244,242,243) 页内标题'],
  [0xc0c0c0, '(192,192,192)'],
  [0xffffff, 'white'],
];
// 直接扫所有 int 记录的值与 key
const byVal = new Map<number, string[]>();
for (const [k, v] of ints) {
  const n = v >>> 0;
  if (!byVal.has(n)) byVal.set(n, []);
  byVal.get(n)!.push(k);
}
for (const [val, label] of want) {
  const v = val >>> 0;
  const keys = byVal.get(v);
  console.log(`值 0x${v.toString(16).padStart(8, '0')} (=${v})  ${label}: ${keys ? keys.length + ' 处 ' + keys.slice(0, 6).join(',') : '（无）'}`);
}
// 找所有"像颜色"的记录：高字节 0 且 RGB 三通道近似相等（灰）或暖白
console.log('\n全部 0x00RRGGBB 形态且亮度 >180 的记录：');
let n = 0;
for (const [k, v] of ints) {
  const val = v >>> 0;
  if (val > 0xffffff) continue;
  const rr = (val >> 16) & 0xff, gg = (val >> 8) & 0xff, bb = val & 0xff;
  if (rr > 180 && gg > 180 && bb > 180) {
    console.log(`  ${k} = 0x${val.toString(16).padStart(6, '0')} (${rr},${gg},${bb})`);
    if (++n > 40) { console.log('  …'); break; }
  }
}
