// 提取 src/<SCRIPT>.txt 的 ADV 文本页清单；--out 生成译文映射骨架 JSON。
// 用法:
//   node extract-pages.js <SCRIPT> [--out <map.json>] [--project <根目录>] [--src <文件>]
// 说明:
//   - 页面 = 连续文本指令段（show-text / display-furigana / concat / end-text-line /
//     draw-string 等文本类指令，放在一起才算完整页面）；
//   - `wait-for-input 0` 为页间硬边界：其后出现的文本行属于下一页，
//     不得与前面内容合并重排；
//   - 可译页 = 含 show-text/display-furigana 字面量的段（排除纯 end-text-line 段、
//     尾参为 (global-string …) 的纯引用页，如 `show-text 2 (global-string d5d)`）；
//   - 含 draw-string 的页（对白与参数化控件文本交错）不进入骨架，
//     需手工原位翻译（保留 draw-string 行、翻译其字面尾参）；
//   - 多段同页（如 SG5744 类系统提示页）在译文中用 <br> 保留分段，
//     走页块+reflow-apply 常规流程，无需特殊处理；
//   - 每页以「页首行号（1 基）」为键，供 apply-page-blocks.js 回填译文。

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PROJECT = 'E:/Games/Eushully/天結';
const TEXT_RE = /^(show-text|display-furigana|concat|end-text-line|draw-string)\b/;

function usage() {
  console.log('用法: node extract-pages.js <SCRIPT> [--out <map.json>] [--project <根目录>] [--src <文件>]');
  console.log('  --out <map.json>   同时写入译文映射骨架 { "页首行号": "" }');
  console.log('  --project <根目录>  工程根目录（默认 E:/Games/Eushully/天結）');
  console.log('  --src <文件>        直接指定源 txt（默认 <工程>/src/<SCRIPT>.txt）');
}

function parseArgs(argv) {
  const opts = { project: DEFAULT_PROJECT, out: null, src: null, script: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--src') opts.src = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a.startsWith('-')) { usage(); process.exit(1); }
    else if (!opts.script) opts.script = a;
    else { usage(); process.exit(1); }
  }
  return opts;
}

function findRuns(lines) {
  const runs = [];
  let i = 0;
  while (i < lines.length) {
    if (TEXT_RE.test(lines[i].trim())) {
      const start = i;
      while (i < lines.length && TEXT_RE.test(lines[i].trim())) i++;
      runs.push({ start, end: i, body: lines.slice(start, i) });
    } else {
      i++;
    }
  }
  return runs;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.script) { usage(); process.exit(1); }

const p = opts.src ? path.resolve(opts.src) : path.join(opts.project, 'src', `${opts.script}.txt`);
if (!fs.existsSync(p)) {
  console.error(`[FAIL] 文件不存在: ${p}`);
  process.exit(1);
}
const raw = fs.readFileSync(p, 'utf8');
const lines = raw.split(/\r\n|\r|\n/);
const runs = findRuns(lines);

const translatable = runs.filter(
  (r) =>
    r.body.some((l) => /^(show-text|display-furigana)\b/.test(l.trim())) &&
    !r.body.some((l) => l.includes('(global-string')) &&
    !r.body.some((l) => l.trim().startsWith('draw-string'))
);
const referenceOnly = runs.filter(
  (r) =>
    r.body.some((l) => /^(show-text|display-furigana)\b/.test(l.trim())) &&
    r.body.some((l) => l.includes('(global-string'))
);
const manual = runs.filter((r) => r.body.some((l) => l.trim().startsWith('draw-string')));

let idx = 0;
for (const r of translatable) {
  idx++;
  console.log(`--- P${idx} (line ${r.start + 1}) ---`);
  for (let k = r.start; k < r.end; k++) console.log(`${k + 1}: ${lines[k]}`);
}
console.log(`\n${opts.script}: 可译页 ${translatable.length}，纯引用页 ${referenceOnly.length}`);
if (manual.length) {
  console.log(`含 draw-string 的交错页（需原位翻译，不进入骨架）: ${manual.map((r) => r.start + 1).join(', ')}`);
}
if (referenceOnly.length) {
  console.log('纯引用页（不译）:', referenceOnly.map((r) => r.start + 1).join(', '));
}

if (opts.out) {
  const map = {};
  for (const r of translatable) map[String(r.start + 1)] = '';
  fs.writeFileSync(path.resolve(opts.out), JSON.stringify(map, null, 2) + '\n', 'utf8');
  console.log(`[ok] 骨架已写入 ${path.resolve(opts.out)}（${translatable.length} 个可译页，译文留空待填）`);
}
