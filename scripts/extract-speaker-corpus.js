// extract-speaker-corpus.js —— 按 annotate-speaker.js 的「页」定义，
// 把每个 `// FROM: <id> <名称>` 所在页的日文原文与中文译文（如有）提取成语料。
//
// 输出（默认 .tmp/character-analysis/）：
//   corpus/<id>-<名称>.txt        全量语料（日：原文；中：译文，无则不输出）
//   samples/<id>-<名称>/sample-N.txt  页数超过 --limit 时随机采样 N 份（固定种子，可复现）
//   corpus-index.json             角色 → 语料路径/页数/文件数
//
// 用法:
//   node scripts/extract-speaker-corpus.js
//   node scripts/extract-speaker-corpus.js --limit 500 --samples 3

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FROM_RE = /^\/\/ FROM: (\S+)(?:\s+(.*))?$/;
const TEXT_RE = /^(show-text|display-furigana|concat|end-text-line|draw-string)\b/;
const SPEECH_RE = /^(show-text|display-furigana|concat)\b/;

function usage() {
  console.log(`用法: node extract-speaker-corpus.js [--out <目录>] [--root <工程根>] [--limit <页数>] [--samples <份数>] [--no-samples]
  --out        输出目录（默认 <工程根>/.tmp/character-analysis）
  --root       工程根目录（默认脚本上级目录）
  --limit      单次分析最大页数（默认 500；超出才采样）
  --samples    采样份数（默认 3）
  --no-samples 不生成采样文件`);
}

function parseArgs(argv) {
  const opts = { out: null, root: ROOT, limit: 500, samples: 3, noSamples: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (a === '--samples') opts.samples = parseInt(argv[++i], 10);
    else if (a === '--no-samples') opts.noSamples = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { usage(); process.exit(1); }
  }
  return opts;
}

// ---------- 文本行提取 ----------
function collectStrings(t) {
  // 返回指令名与其中的字符串字面量（@"..." 或 "..."）
  const inst = /^([a-z-]+)\b/.exec(t.trim())?.[1];
  if (!inst || !SPEECH_RE.test(inst)) return null;
  const isCN = t.includes('@"');
  const re = isCN ? /@"([^"]*)"/g : /"([^"]*)"/g;
  const strs = [...t.trim().matchAll(re)].map((m) => m[1]);
  if (!strs.length) return null;
  return { inst, isCN, strs };
}

function fmt(strs, inst) {
  // display-furigana: 本体(注音)；其余指令字符串直接拼接（页内视觉行碎片）
  if (inst === 'display-furigana' && strs.length >= 2) return `${strs[0]}(${strs[1]})`;
  return strs.join('');
}

// 从一页 body 中提取 { jp, cn }（cn 可为空字符串）
// 工程约定：日文原文在 /* 原文存档 */ 块内；// 输入原文 行为中文整行（reflow 输入），
// @ 行是中文视觉行碎片。故 jp 取存档块（无存档时取非 @ 原始行），cn 优先取输入原文行。
function extractPage(body) {
  const jpParts = [];
  const cnParts = [];
  const inputLines = [];
  let inArchive = false;
  for (const ln of body) {
    const t = ln.trim();
    if (t.startsWith('/* 原文存档')) { inArchive = true; continue; }
    if (t === '*/') { inArchive = false; continue; }
    if (t.startsWith('// 页面结束')) continue;
    if (t.startsWith('// 输入原文')) {
      const im = /^\/\/ 输入原文[：:]\s*(.*)$/.exec(t);
      if (im) inputLines.push(im[1].trim());
      continue;
    }
    const c = collectStrings(t);
    if (!c) continue;
    if (inArchive) {
      // 存档块内为日文原文
      jpParts.push(fmt(c.strs, c.inst));
    } else if (c.isCN) {
      cnParts.push(fmt(c.strs, c.inst));
    } else {
      jpParts.push(fmt(c.strs, c.inst));
    }
  }
  const jp = jpParts.join('');
  const cn = inputLines.length ? inputLines.join('') : cnParts.join('');
  return { jp, cn };
}

// ---------- 分页提取 ----------
function extractFile(fileName, lines) {
  const pages = []; // { file, line, jp, cn }
  let i = 0;
  while (i < lines.length) {
    const m = FROM_RE.exec(lines[i].trim());
    if (!m) { i++; continue; }
    const id = m[1];
    if (id === 'none') { i++; continue; }
    const fromLine = i + 1; // 1-based
    let j = i + 1;
    let translated = false;
    if (lines[j] && lines[j].trim().startsWith('/* 原文存档')) {
      translated = true;
      while (j < lines.length && !lines[j].trim().startsWith('// 页面结束')) j++;
    } else {
      while (j < lines.length && TEXT_RE.test(lines[j].trim())) j++;
    }
    const body = lines.slice(i + 1, translated ? j + 1 : j);
    const { jp, cn } = extractPage(body);
    if (jp || cn) pages.push({ file: fileName, line: fromLine, jp, cn });
    i = translated ? j + 1 : j;
  }
  return pages;
}

// ---------- 固定种子随机采样 ----------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePages(pages, n, seedStr) {
  const rng = mulberry32(hashStr(seedStr));
  const idx = pages.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [idx[i], idx[k]] = [idx[k], idx[i]];
  }
  return idx.slice(0, Math.min(n, idx.length)).sort((a, b) => a - b).map((i) => pages[i]);
}

function safeName(name) {
  return name.replace(/[\\/]/g, '_').trim() || '??';
}

function renderCorpus(charPages) {
  const out = [];
  for (const p of charPages) {
    out.push(`[${p.file}:${p.line}]`);
    out.push(`日：${p.jp}`);
    if (p.cn) out.push(`中：${p.cn}`);
    out.push('');
  }
  return out.join('\n');
}

// ---------- main ----------
const opts = parseArgs(process.argv.slice(2));
const outDir = opts.out || path.join(opts.root, '.tmp', 'character-analysis');
fs.mkdirSync(path.join(outDir, 'corpus'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'samples'), { recursive: true });

const srcDir = path.join(opts.root, 'src');
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.txt')).sort();

const byId = new Map(); // id -> { id, nameCounts:Map, pages:[] }
const pagesById = new Map();
for (const f of files) {
  const raw = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const lines = raw.split(/\r\n|\r|\n/);
  // 记录每行(0-based) FROM 归属，用于把提取出的页关联回角色
  const idAtLine = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = FROM_RE.exec(lines[i].trim());
    if (m && m[1] !== 'none') {
      idAtLine.set(i, m[1]);
      const name = (m[2] || '').trim();
      let e = byId.get(m[1]);
      if (!e) {
        e = { id: m[1], nameCounts: new Map(), pages: [] };
        byId.set(m[1], e);
      }
      if (name) e.nameCounts.set(name, (e.nameCounts.get(name) || 0) + 1);
    }
  }
  const filePages = extractFile(f, lines);
  for (const p of filePages) {
    const id = idAtLine.get(p.line - 1);
    if (!id) continue;
    if (!pagesById.has(id)) pagesById.set(id, []);
    pagesById.get(id).push(p);
  }
}

// 合并页到 byId
for (const [id, pages] of pagesById) {
  let e = byId.get(id);
  if (!e) {
    e = { id, nameCounts: new Map(), pages: [] };
    byId.set(id, e);
  }
  e.pages = pages;
}

const ids = [...byId.keys()].sort((a, b) => parseInt(a, 16) - parseInt(b, 16));
const index = { generatedAt: new Date().toISOString(), limit: opts.limit, samples: opts.samples, byId: {} };
let totalPages = 0;

for (const id of ids) {
  const e = byId.get(id);
  const name = [...e.nameCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '??';
  const fname = `${id}-${safeName(name)}`;
  const pages = e.pages;
  totalPages += pages.length;
  const filesSet = new Set(pages.map((p) => p.file));

  const corpusPath = path.join(outDir, 'corpus', `${fname}.txt`);
  fs.writeFileSync(corpusPath, renderCorpus(pages), 'utf8');

  const samples = [];
  if (!opts.noSamples && pages.length > opts.limit) {
    const sampleDir = path.join(outDir, 'samples', fname);
    fs.mkdirSync(sampleDir, { recursive: true });
    for (let s = 1; s <= opts.samples; s++) {
      const picked = samplePages(pages, opts.limit, `${id}-sample-${s}`);
      const sp = path.join(sampleDir, `sample-${s}.txt`);
      fs.writeFileSync(sp, renderCorpus(picked), 'utf8');
      samples.push(sp);
    }
  }

  index.byId[id] = {
    id,
    name,
    pages: pages.length,
    fileCount: filesSet.size,
    corpus: corpusPath,
    sampled: samples.length > 0,
    samples,
  };
  const sampleNote = samples.length ? `（${opts.limit}×${samples.length} 采样）` : '';
  console.log(`${id.padEnd(4)}  ${String(pages.length).padStart(6)} 页  ${fname}${sampleNote}`);
}

fs.writeFileSync(path.join(outDir, 'corpus-index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log(`\n共 ${ids.length} 个角色，${totalPages} 页。输出目录: ${outDir}`);
