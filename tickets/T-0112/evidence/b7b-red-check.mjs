#!/usr/bin/env node
/**
 * T-0112 的「改前与体不符」机械取证（红）。
 *
 *   node tickets/T-0112/evidence/b7b-red-check.mjs
 *
 * 做什么：把 **改动前** 文档里写的那些 raw 行号，拿去和 `engine/*_unpacked.exe_utf8.c` 对照 ——
 * 每一行都要求"该行号处含它声称的那句代码/那个函数"，逐条打印 ✅/❌。
 * 全部 4 类（判据 ①②④）共 25 条，❌ 就是"照文档改会指错地方"的实证。
 * 改后的对照由守卫 `app/amayui-emulator/test/doc-model.test.ts` 的
 * 「机制叙述的 raw 行号锚点与反编译真源一致（B7-B 棘轮，T-0112）」承担（同一条目改后为 ✅）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const rawName = fs.readdirSync(path.join(ROOT, 'engine')).find((f) => f.endsWith('_unpacked.exe_utf8.c'));
if (!rawName) throw new Error('找不到 engine/*_unpacked.exe_utf8.c');
const raw = fs.readFileSync(path.join(ROOT, 'engine', rawName), 'utf8').split('\n');
const at = (n) => (raw[n - 1] ?? '').trim();

/** 改动前文档写的行号 → 它声称那里有什么 */
const OLD = [
  // 判据 ①：adv-text-rendering.md 的 FontVWindow 字段表（4 处可疑行号）
  ['① +4 目标表面 id', 90444, '_this + 4) = 0'],
  ['① +8 描边源表面 id', 90445, '_this + 8) = 2'],
  ['① +116/+120 缩放初值 1.0', 90469, '_this + 116) = 1.0'],
  ['① +1252 lfItalic/CharSet 打包值', 78866, '_this + 1252) = 0x1000000'],
  // 判据 ④：copyright-effect.md §2 / §3a / §3b / §5 / §6
  ['④ 时钟每帧写（主循环 tick 读）', 20445, 'timeGetTime'],
  ['④ 时钟每帧写（v94 = tick）', 20465, 'timeGetTime'],
  ['④ 时钟每帧写（时钟交换）', 20575, '369336'],
  ['④ 时钟每帧写（present 门）', 20571, '667860'],
  ['④ 时钟每帧写（present）', 20583, 'sub_4B4040'],
  ['④ mesh 渲染 RenderPolygon', 131435, '4AF1C0'],
  ['④ CalcDiffuse', 120438, '4A2050'],
  ['④ draw-item 颜色动画求值（§3b/§5/§6）', 115116, '49A300'],
  ['④ draw-item 颜色动画求值（§3b 表 + §5 `&2` 门控）', 115663, '& 2'],
  ['④ set-vertex-color', 130789, '4AE2C0'],
  ['④ set-vertex-color-alpha', 130806, '4AE330'],
  ['④ set-draw-color-alpha', 129850, '4ACF60'],
  ['④ set-draw-color', 129936, '4AD0C0'],
  ['④ set-draw-color `|=2`（§3b 字段表）', 129948, '|= 2'],
  ['④ set-draw-color-alpha `+48/+96`（§3b 字段表）', 129857, '+ 48'],
  ['④ draw-item 渲染', 131306, '4AEEA0'],
  ['④ draw-item 渲染 `&4` 分支（§5）', 131368, '& 4'],
  ['④ draw-texture 处理器', 30846, '422E70'],
  ['④ draw-texture → sub_4ACE50', 129796, '4ACE50'],
  ['④ image 绘制器', 121065, '4A2D50'],
  ['④ 0x1FA release-texture', 30822, '422E00'],
  ['④ 0x20F play-movie', 31165, '4237B0'],
];

let bad = 0;
const lines = [];
for (const [label, n, has] of OLD) {
  const got = at(n);
  const ok = got.includes(has);
  if (!ok) bad++;
  lines.push(`${ok ? '✅' : '❌'} ${label}\n     doc 写 raw ${n} 含「${has}」 → 实际：${got.slice(0, 96) || '(空行)'}`);
}
lines.push('', `小计：${OLD.length} 条里 ❌ ${bad} 条（= 文档行号与体不符）`);

// 判据 ②：0x204 的落笔路径 —— 文档写"GDI 一次性整串"，但被引的体里没有 TextOutA
const body = raw.slice(68470 - 1, 68495).join('\n');
const hasTextOut = body.includes('TextOutA');
const hasSoftRaster = body.includes('sub_46F2D0') && body.includes('sub_471180');
const softIdx = raw.findIndex((l) => l.includes('//----- (0046F2D0)')) + 1;
const gdiIdx = raw.findIndex((l, i) => i > 68497 && l.includes('TextOutA(*(HDC *)(_this + 1104)')) + 1;
lines.push(
  '',
  `② 0x204 的体（raw 68470-68495 = sub_456710）：含 TextOutA = ${hasTextOut}（文档写「GDI 一次性整串」）；` +
  `含软件字形光栅器 sub_46F2D0/sub_471180 = ${hasSoftRaster}（sub_46F2D0 在 raw ${softIdx} 起）`,
  `   真正的 GDI「整串 TextOutA」在 sub_456820 的 raw ${gdiIdx}（那是消息窗排版那一路，不是 0x204）`,
);
if (hasTextOut || !hasSoftRaster) bad++;

console.log(lines.join('\n'));
console.error(`[${bad === 0 ? 'ok' : 'red'}] ❌ ${bad} 条与体不符`);
process.exit(bad === 0 ? 0 : 1);
