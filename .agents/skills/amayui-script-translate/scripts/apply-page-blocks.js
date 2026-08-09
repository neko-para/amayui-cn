// 把译文映射 JSON 批量应用到 src/<SCRIPT>.txt：每个可译文本段替换为
// 三段式页块（原文存档 + // 输入原文 + 空正文 + // 页面结束），随后由
// reflow-apply.js 刷新正文。
// 用法:
//   node apply-page-blocks.js <SCRIPT> <MAP> [--project <根目录>] [--src <文件>]
// 页面边界:
//   - 页面 = 连续文本指令段（show-text / display-furigana / concat / end-text-line /
//     draw-string 等文本类指令，放在一起才算完整页面）；
//   - `wait-for-input 0` 为页间硬边界：其后文本行属于下一页，不与前面合并重排；
//   - 含 draw-string 的页不参与批替换（需原位翻译：保留 draw-string 行、
//     翻译其字面尾参），仅告警列出；
//   - 多段同页（如 SG5744 类系统提示页）在译文中用 <br> 保留分段，正常批替换。
// 校验:
//   - 可译页必须全部有非空译文（缺失即中止并列出行号）；
//   - 映射中多余行号（不对应可译页）给出警告（防笔误）；
//   - 已含 `// 页面结束` 的脚本拒绝执行（已翻译，改走 reflow-apply --check）；
//   - 存档块逐字拷贝源文件原文行（含外字 U+E000–E010）；非文本控制行与
//     wait-for-input 0 保留；end-text-line 0 属可增删的文本行，脚本不主动增删。

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PROJECT = 'E:/Games/Eushully/天結';
const TEXT_RE = /^(show-text|display-furigana|concat|end-text-line|draw-string)\b/;

function usage() {
  console.log('用法: node apply-page-blocks.js <SCRIPT> <MAP> [--project <根目录>] [--src <文件>]');
  console.log('  <MAP>              译文映射 JSON（extract-pages.js --out 生成的骨架，行号 → 译文）');
  console.log('  --project <根目录>  工程根目录（默认 E:/Games/Eushully/天結）');
  console.log('  --src <文件>        直接指定目标 txt（默认 <工程>/src/<SCRIPT>.txt）');
}

function parseArgs(argv) {
  const opts = { project: DEFAULT_PROJECT, src: null, script: null, map: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--src') opts.src = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a.startsWith('-')) { usage(); process.exit(1); }
    else if (!opts.script) opts.script = a;
    else if (!opts.map) opts.map = a;
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
if (!opts.script || !opts.map) { usage(); process.exit(1); }

const src = opts.src ? path.resolve(opts.src) : path.join(opts.project, 'src', `${opts.script}.txt`);
if (!fs.existsSync(src)) {
  console.error(`[FAIL] 文件不存在: ${src}`);
  process.exit(1);
}
const mapPath = path.resolve(opts.map);
if (!fs.existsSync(mapPath)) {
  console.error(`[FAIL] 映射不存在: ${mapPath}`);
  process.exit(1);
}
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

const raw = fs.readFileSync(src, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r\n|\r|\n/);

if (lines.some((l) => l.trim() === '// 页面结束')) {
  console.error(`[FAIL] ${opts.script} 已含页块（// 页面结束），不要重复执行；改用 reflow-apply --check 校验 / 刷新`);
  process.exit(1);
}

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

const missing = translatable.filter((r) => {
  const v = map[String(r.start + 1)];
  return v === undefined || String(v).trim() === '';
});
if (missing.length) {
  console.error(`[FAIL] ${missing.length} 个可译页缺少译文：`);
  for (const m of missing) console.error(`  line ${m.start + 1}: ${m.body[0]}`);
  process.exit(1);
}

const keys = new Set(translatable.map((r) => String(r.start + 1)));
const extra = Object.keys(map).filter((k) => !keys.has(k));
if (extra.length) {
  console.warn(`[warn] 映射中 ${extra.length} 个行号不对应可译页（可能笔误，未使用）: ${extra.join(', ')}`);
}
if (manual.length) {
  console.warn(`[warn] ${manual.length} 个含 draw-string 的交错页未批替换（需原位翻译）: ${manual.map((r) => r.start + 1).join(', ')}`);
}

for (const r of [...translatable].reverse()) {
  const translation = String(map[String(r.start + 1)]).trim();
  const block = [
    '/* 原文存档（对照用，不参与汇编）',
    ...r.body,
    '*/',
    `// 输入原文：${translation}`,
    '// 页面结束',
  ];
  lines.splice(r.start, r.end - r.start, ...block);
}

fs.writeFileSync(src, lines.join(eol), 'utf8');
console.log(`[ok] ${opts.script}: 已替换 ${translatable.length}/${translatable.length} 个文本页；纯引用页 ${referenceOnly.length} 个未动`);
console.log(`下一步: node reflow-apply.js ${opts.script}`);
