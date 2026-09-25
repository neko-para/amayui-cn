#!/usr/bin/env node
/**
 * T-0172 的「改前与体不符」机械取证（红）。
 *
 *   node tickets/T-0172/evidence/t0172-red-check.mjs
 *
 * 做什么：把 **改动前** `docs-new/03-engine/rendering.md` 与 `docs-new/04-app/emulator-copyright-effect.md`
 * 里写的 raw 行号（= T-0112 `changes.md` 「待应用」节列的 8 处已知错 + T-0172 逐格核出来的从未核过的那批）
 * 拿去和 `engine/*_unpacked.exe_utf8.c` 对照 —— 每一条都要求"该行号处含它声称的那句代码/那个函数"。
 * 全部 ❌ 就是"照旧文档读体会读错地方"的实证；改后的两向契约由
 * `tickets/T-0172/evidence/check-anchors.mjs` 与守卫
 * `app/amayui-emulator/test/doc-model.test.ts` 的「B7-B 棘轮（T-0172）」承担（同一条目改后为 ✅）。
 *
 * 本文件**只记录改前的旧行号**（不再随文档更新）：它是一次性取证，永久可复跑。
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

/** 改前文档写的行号 → 它声称那里有什么（tag 里的 md:line 是文档位置） */
const OLD = [
  // ---- T-0112「待应用」列的 8 处已知错 ----
  ['rendering:26 fade 家族 `sub_441410` 首调用点', 49942, 'sub_441410'],
  ['rendering:26 命令级计时器 `sub_453A60`', 26981, 'sub_453A60'],
  ['rendering:30 `0x2000` movie 分支', 20619, '& 0x2000'],
  ['rendering:30 `0x2000` movie 分支（第二处）', 20723, '& 0x2000'],
  ['rendering:31 BGM 淡入计时器 `_this+430012`', 20651, '430012'],
  ['rendering:33 `sub_426CF0`(0x323)', 33358, 'sub_426CF0'],
  ['rendering:33/60 `sub_4AF1C0` RenderPolygon', 131435, '4AF1C0'],
  ['rendering:33/60 mesh 颜色窗 133505-133541', 131491, 'v40[0] & 2'],
  ['rendering:35 主循环 0x400 卫门', 20934, 'sub_407E20'],
  ['rendering:44 create-mesh `sub_432150`', 40262, 'sub_432150'],
  ['rendering:44/81 `sub_4ADFE0`', 130665, 'sub_4ADFE0'],
  ['rendering:44/81 `sub_4A2280`', 120518, 'sub_4A2280'],
  ['rendering:58 CalcDiffuse 通道插值 122289-122293', 120475, 'a2 + 59'],
  ['rendering:58 CalcDiffuse 快路径 122294-122306', 120482, '== -1'],
  ['rendering:58 CalcDiffuse 写 VB+16 122316-122317', 120502, '+ 16)'],
  ['rendering:69 主循环时钟 `v3=timeGetTime`', 20445, 'timeGetTime'],
  ['rendering:69 `v94=v5=timeGetTime()`', 20465, 'v94 = v5'],
  ['rendering:69 帧同步分支', 20571, '667860'],
  ['rendering:69 present `sub_4B4040`', 20583, 'sub_4B4040'],
  ['rendering:69 `sub_41A090`(0x1F4)', 24953, 'sub_41A090'],
  ['rendering:69 `sub_41A1A0`(0x20C)', 25014, 'sub_41A1A0'],
  ['rendering:69 `sub_41A2C0`(0x23C)', 25059, 'sub_41A2C0'],
  ['rendering:69 present `sub_4B4040`(逐帧链)', 134702, '4B4040'],
  ['rendering:69 `sub_4B06D0`(逐帧链)', 134755, '4B06D0'],
  ['rendering:79 `sub_422E70`', 30846, '422E70'],
  ['rendering:79 `sub_4ACE50`', 129796, '4ACE50'],
  ['rendering:86 `sub_422E00` release-texture', 30822, '422E00'],
  ['rendering:86 `sub_4237B0` play-movie', 31165, '4237B0'],
  ['rendering:100 `sub_4ACF60` set-draw-color-alpha', 129850, '4ACF60'],
  ['rendering:100 `sub_4AD0C0` set-draw-color', 129936, '4AD0C0'],
  ['rendering:102 `sub_4AEEA0`', 131306, '4AEEA0'],
  ['rendering:102 `sub_4A2D50`', 121065, '4A2D50'],
  // ---- T-0172 逐格核出来的「从未核过」那批（line 26/30/31/35/44/70/78/81/84/93/167/193/198 等）----
  ['rendering:70 窗起点锁存（entry[10]==0）', 131486, '_this + 46500'],
  ['rendering:70 mesh 窗收尾分支', 131506, 'v40[11] = 0'],
  ['rendering:70 present 帧始清脏位', 134751, '46508) = 0'],
  ['rendering:78 `sub_4B06D0`(归并序)', 132387, '4B06D0'],
  ['rendering:81 mesh 表插入 `v19=sub_40DC30`', 130708, 'v19 = sub_40DC30'],
  ['rendering:81 拷逐顶点色进 entry[2]/[3]/[4]', 130732, 'operator new[]'],
  ['rendering:81 `sub_4AF1C0` 调用点（其一）', 133562, 'sub_4AF1C0'],
  ['rendering:84 `sub_407E20`', 12679, 'sub_407E20'],
  ['rendering:84 绘制项 setter 置脏（其一）', 129957, '11627'],
  ['rendering:84 绘制项 setter 置脏（其二）', 130051, '11627'],
  ['rendering:84 绘制项 setter 置脏（其三）', 130091, '11627'],
  ['rendering:84 `sub_4AF1C0` 置 46516', 131503, '+ 46516'],
  ['rendering:93 主循环起点', 20422, 'while ( 1 )'],
  ['rendering:93 帧同步外层门', 20468, '429752'],
  ['rendering:167 `MeshEntry[9]` 写点', 132815, '[9] = a3'],
  ['rendering:193 每项收尾（sprite+44）', 123250, '+ 44'],
  ['rendering:198 `sub_49E390` 默认支（`v19=6`）', 119397, 'v19 = 6'],
  ['rendering:198 `sub_49E700` 默认支（`a3 != 3`）', 119521, 'a3 != 3'],
  // ---- 04-app/emulator-copyright-effect.md ----
  ['04-app:15 主循环 `LABEL_216`', 21041, 'LABEL_216'],
  ['04-app:55 `sub_4B4040`(present)', 134702, '4B4040'],
  ['04-app:55 `sub_4B06D0`', 132387, '4B06D0'],
  ['04-app:58 mesh 颜色窗', 131491, 'v40[0] & 2'],
  ['04-app:59 逐帧颜色求值函数名 `sub_49A300`', 115116, 'sub_49A300'],
  ['04-app:59 逐帧颜色求值（`sub_49AA30`）', 115116, 'sub_49AA30'],
  ['04-app:63 effect_flags 位级联', 20594, '699204'],
  ['04-app:71 0x400 卫门', 20934, 'sub_407E20'],
  ['04-app:77 present 条件 `sub_40BE10`', 20581, 'sub_40BE10'],
  ['04-app:197 draw-item `&4` 分支', 131368, '& 4'],
];

let bad = 0;
const lines = [];
for (const [label, n, has] of OLD) {
  const got = at(n);
  const ok = got.includes(has);
  if (!ok) bad++;
  lines.push(`${ok ? '✅' : '❌'} ${label}\n     旧文档写 raw ${n} 含「${has}」 → 实际：${got.slice(0, 96) || '(空行)'}`);
}
lines.push('', `小计：${OLD.length} 条里 ❌ ${bad} 条（= 旧文档行号与体不符）`);
console.log(lines.join('\n'));
console.error(`[${bad === OLD.length ? 'red' : 'unexpected'}] ❌ ${bad}/${OLD.length} 条与体不符`);
process.exit(bad === OLD.length ? 0 : 1);
