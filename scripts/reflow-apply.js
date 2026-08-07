// 自动重排：从 src/*.txt 提取每个 ADV 页的 `// 输入原文：…` 注释（reflow 的排版前原文），
// 用 scripts/lib/reflow.js 重新排版并替换该页正文。
//
// 用法:
//   node reflow-apply.js [--check] [--sample N] [脚本名 ...]
//   --check     只比较不写回；存在差异时打印并退出码 1
//   --sample N  随机打印 N 个「内容变更」页（非仅结束注释变更）的旧/新对比
//   无脚本名    处理 src 下所有含 `// 输入原文：` 的脚本
//
// 页块边界（reflow 三段式输出：原文注释 / 正文 / 特殊结束注释）：
//   - 开始：`// 输入原文：…` 行；
//   - 结束：`// 页面结束`（PAGE_END_COMMENT）。
//   旧页无结束注释时退化为「连续文本指令段」，并把段尾的 end-text-line（页尾原结构）
//   保留在区域外；concat 按该页现有正文是否含 concat 行决定（SN0000 开、SC* 关）。

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, SRC_DIR } from './config.js';
import { reflow, DEFAULT_MAX, PAGE_END_COMMENT } from './lib/reflow.js';

const COMMENT_PREFIX = '// 输入原文：';
const TEXT_INSTR = /^(show-text|display-furigana|concat|end-text-line)\b/;
const MAX_DIFF_PRINT = 6;

function usage() {
  console.log('用法: node reflow-apply.js [--check] [--sample N] [脚本名 ...]');
  console.log('  --check     只比较不写回；有差异时打印并退出码 1');
  console.log('  --sample N  随机打印 N 个「内容变更」页（非仅结束注释变更）的旧/新对比');
  console.log('  无脚本名    处理 src 下所有含 `// 输入原文：` 的脚本');
  console.log('  每个 ADV 页从 `// 输入原文：…` 注释提取排版前原文，用 reflow 重排后替换正文；');
  console.log('  页块以 `// 页面结束` 为显式结束注释；concat 按该页现有正文是否含 concat 行决定。');
}

function loadGlossary(p) {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return (data.terms ?? []).flatMap((t) => t.zh ?? []).filter(Boolean);
}

// 定位一个页块：返回区域起点 i、终点 j（区域后第一个行号）、区域行、是否含结束注释。
function findPage(lines, i) {
  const body = [];
  let j = i + 1;
  let hasMarker = false;
  while (j < lines.length) {
    const s = lines[j].trim();
    if (TEXT_INSTR.test(s)) {
      body.push(lines[j]);
      j++;
    } else if (s === PAGE_END_COMMENT) {
      body.push(lines[j]);
      j++;
      hasMarker = true;
      break;
    } else {
      break;
    }
  }
  if (!hasMarker) {
    // 旧页（无结束注释）：段尾的 end-text-line 是页尾原结构，保留在区域外
    while (body.length > 0 && body[body.length - 1].trim().startsWith('end-text-line')) {
      body.pop();
    }
  }
  return { i, j: i + 1 + body.length, body, hasMarker };
}

function printPageDiff(label, oldLines, newLines) {
  console.log(`  --- ${label}`);
  const n = Math.max(oldLines.length, newLines.length);
  for (let k = 0; k < n; k++) {
    const a = k < oldLines.length ? oldLines[k] : '(无)';
    const b = k < newLines.length ? newLines[k] : '(无)';
    const mark = a === b ? ' ' : '!';
    if (a !== b) {
      console.log(`  ${mark} - ${a}`);
      console.log(`  ${mark} + ${b}`);
    } else {
      console.log(`  ${mark}   ${a}`);
    }
  }
}

function processScript(name, glossary, apply, sampleCount, rng) {
  const p = path.join(SRC_DIR, `${name}.txt`);
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r\n|\r|\n/);
  const pages = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith(COMMENT_PREFIX)) continue;
    const text = t.slice(COMMENT_PREFIX.length).trim();
    if (!text) continue; // 空注释不处理

    const region = findPage(lines, i);
    const concat = region.body.some((b) => b.trim().startsWith('concat'));
    const newBlock = reflow(text, { maxLen: DEFAULT_MAX, glossary, concat });

    const oldComment = lines[i];
    const oldBody = region.hasMarker ? region.body.slice(0, -1) : region.body;
    const newComment = newBlock[0];
    const newBody = newBlock.slice(1, -1); // 去掉结束注释
    const oldFull = [oldComment, ...region.body];

    const changed = oldFull.join('\n') !== newBlock.join('\n');
    const contentChanged =
      oldComment !== newComment || oldBody.join('\n') !== newBody.join('\n');
    pages.push({ region, newBlock, oldComment, oldBody, newComment, newBody, changed, contentChanged });
    i = region.j - 1;
  }

  const changedPages = pages.filter((pg) => pg.changed);
  if (apply && changedPages.length > 0) {
    for (const pg of [...changedPages].reverse()) {
      lines.splice(pg.region.i, pg.region.j - pg.region.i, ...pg.newBlock);
    }
    fs.writeFileSync(p, lines.join(eol), 'utf8');
  }

  const contentChangedPages = pages.filter((pg) => pg.contentChanged);
  const sampled = [];
  if (sampleCount > 0 && contentChangedPages.length > 0) {
    const pool = [...contentChangedPages];
    for (let k = 0; k < Math.min(sampleCount, pool.length); k++) {
      sampled.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
  }

  return { name, total: pages.length, changedPages, contentChangedPages, sampled };
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}
const check = argv.includes('--check');
let sampleCount = 0;
const names = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--check') continue;
  if (argv[i] === '--sample') {
    sampleCount = parseInt(argv[++i], 10) || 0;
    continue;
  }
  names.push(argv[i]);
}
const glossary = loadGlossary(path.join(ROOT_DIR, 'rules', 'glossary.json'));

let targets;
if (names.length > 0) {
  targets = names;
} else {
  targets = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.slice(0, -4))
    .sort();
}

const rng = Math.random;
let totalPages = 0;
let totalChanged = 0;
let totalContentChanged = 0;
let printedDiffs = 0;

for (const name of targets) {
  const p = path.join(SRC_DIR, `${name}.txt`);
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] 文件不存在: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  if (!raw.includes(COMMENT_PREFIX)) continue; // 未翻译/无 ADV 页

  const r = processScript(name, glossary, !check, sampleCount, rng);
  totalPages += r.total;
  totalChanged += r.changedPages.length;
  totalContentChanged += r.contentChangedPages.length;
  const verb = check ? '差异' : '已替换';
  console.log(
    `${r.name}: ${r.total} 页, ${verb} ${r.changedPages.length} 页（内容变更 ${r.contentChangedPages.length} 页）`
  );

  if (check && r.changedPages.length > 0 && printedDiffs < MAX_DIFF_PRINT) {
    for (const pg of r.changedPages) {
      if (printedDiffs >= MAX_DIFF_PRINT) break;
      printPageDiff(`变更页（原文：${pg.newComment.slice(COMMENT_PREFIX.length).trim().slice(0, 40)}…）`,
        [pg.oldComment, ...pg.oldBody], [pg.newComment, ...pg.newBody]);
      printedDiffs++;
    }
  }
  for (const pg of r.sampled) {
    printPageDiff(`抽查（内容变更，原文：${pg.newComment.slice(COMMENT_PREFIX.length).trim().slice(0, 40)}…）`,
      [pg.oldComment, ...pg.oldBody], [pg.newComment, ...pg.newBody]);
  }
}

console.log(
  `\n合计: ${totalPages} 页, ${check ? '差异' : '变更'} ${totalChanged} 页（内容变更 ${totalContentChanged} 页）${check ? '（--check 未写回）' : ''}`
);
if (check && totalChanged > 0) {
  console.log(`[FAIL] 存在 ${totalChanged} 处差异，未写回`);
  process.exit(1);
}
console.log(check ? '[OK] 与 reflow 输出一致' : '[OK] 处理完成');
