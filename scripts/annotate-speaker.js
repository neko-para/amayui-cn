// annotate-speaker.js —— 为 src 下每个 SC/SP 脚本的每个文本页，在其页首
// （/* 原文存档 */ 块注释前，或原始 show-text 行前）追加单行注释：
//   // FROM: <id> <名称>   （说话人 id 为 mov (global-int 3f37) 的值，十六进制原文）
//   // FROM: none          （旁白 / 无说话人）
//
// 说话人判定规则（见 docs/AGE脚本语言与物品数据结构.md §4、§5 及会话调研）：
//   - 页 = 一个 ADV 文本段：已翻译页为 /* 原文存档 */ ... // 页面结束；
//     未翻译页为连续文本指令段（show-text/display-furigana/concat/end-text-line/draw-string），
//     wait-for-input 0 为页间硬边界；
//   - 页前导中最近的标记决定说话人：
//       mov (global-int 3f37) X          → 说话人 X
//       sub (global-int 3f37) 0 1        → 无说话人（旁白清除，可能在被调函数体内）
//       call label_00071658              → 无说话人（旁白清除）
//     call 会递归展开函数体（限深度）后按同样规则判定。
//   - 名称取 data/CNINIT.txt 中 id → 显示名（第二个 set-string，缺省取第一个）。
//
// 用法（在 scripts 目录）:
//   node annotate-speaker.js                # 全量 dry-run（不写文件）
//   node annotate-speaker.js --apply        # 全量写入 src/
//   node annotate-speaker.js --file SC0000  # 只处理指定脚本（支持 SC0000 / src/SC0000.txt）
//   node annotate-speaker.js --apply --refresh  # 全量写入并替换已有 // FROM: 注释

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TEXT_RE = /^(show-text|display-furigana|concat|end-text-line|draw-string)\b/;
const ADV_RE = /^(show-text|display-furigana)\b/;
const MOV3F37_RE = /^mov \(global-int 3f37\) ([0-9a-f]+)$/;
const SUB3F37_RE = /^sub \(global-int 3f37\) /;
const CALL_NARR_RE = /^call label_00071658$/;
const CALL_LAB_RE = /^call label_([0-9a-f]+)$/;
const LABEL_RE = /^label_([0-9a-f]+)$/;
const CNINIT_ID_RE = /^mov \(global-int 14[a-f][0-9a-f]{3}\) ([0-9a-f]+)$/;
const CNINIT_ID_MAX = 0x1000; // 角色 id 上限；字符串表索引（如 3fc4/4012）均远大于此
// CNINIT 无条目、经 EBINIT（单位表）核实的说话人（勿随意增补）：
//   b=思春期カトリト、c=成竜型カトリト —— EBINIT 记录序 = 说话人 id - 1，
//     卡托利特三形态：カトリト(0xa) / 思春期カトリト(0xb) / 成竜型カトリト(0xc)
//   81=歪魔デブラフスカ —— $1$EBINIT 记录 128（id 写入 529965 = 0x50a）
//   138=錯縛の水精 —— base EBINIT 记录 311；CNINIT 0x132 疑似错配（见 AGE脚本语言与物品数据结构.md §7.3）
//   170=フィア＝イブラム —— base EBINIT 记录 367（id 写入 529a54 = 0xe60）
const NAME_OVERRIDES = { b: '思春期カトリト', c: '成竜型カトリト', 81: '歪魔デブラフスカ', 138: '錯縛の水精', 170: 'フィア＝イブラム' };
const CNINIT_STR_RE = /^set-string \(global-string [0-9a-f]+\) "([^"]+)"$/;

function usage() {
  console.log(`用法: node annotate-speaker.js [--apply] [--file <脚本名>]
  --apply      写入 src/（默认 dry-run，只报告）
  --refresh    替换已有的 // FROM: 注释（配合 --apply 使用；默认跳过已有注释）
  --file <名>  只处理指定脚本（如 SC0000 或 src/SC0000.txt）
  --root <目录> 工程根目录（默认脚本上级目录）`);
}

function parseArgs(argv) {
  const opts = { apply: false, file: null, root: ROOT, refresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--file') opts.file = argv[++i];
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { usage(); process.exit(1); }
  }
  return opts;
}

// ---------- CNINIT：id -> 显示名 ----------
function loadCninNames(root) {
  // 合并 CNINIT.txt 与追加包 $1$–$5$CNINIT.txt（base 优先，追加补缺）
  const files = ['CNINIT.txt', '$1$CNINIT.txt', '$2$CNINIT.txt', '$3$CNINIT.txt', '$4$CNINIT.txt', '$5$CNINIT.txt'];
  const map = new Map();      // id -> name
  const dupes = new Map();    // id -> [name1, name2, ...]
  function record(entry) {
    const name = entry.strs[1] || entry.strs[0];
    if (!map.has(entry.id)) map.set(entry.id, name);
    if (!dupes.has(entry.id)) dupes.set(entry.id, []);
    const arr = dupes.get(entry.id);
    if (!arr.includes(name)) arr.push(name);
  }
  for (const f of files) {
    const p = path.join(root, 'data', f);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r\n|\r|\n/);
    let cur = null;
    for (const ln of lines) {
      const m = CNINIT_ID_RE.exec(ln.trim());
      if (m && parseInt(m[1], 16) <= CNINIT_ID_MAX) {
        if (cur && cur.strs.length) record(cur);
        cur = { id: parseInt(m[1], 16), strs: [] };
        continue;
      }
      if (cur) {
        const s = CNINIT_STR_RE.exec(ln.trim());
        if (s) {
          cur.strs.push(s[1]);
        } else if (!/^mov /.test(ln.trim())) {
          // 遇到非 id mov、非字符串行（如空行/exit）时结束当前条目
          if (ln.trim() === '' || ln.trim() === 'exit') {
            if (cur.strs.length) record(cur);
            cur = null;
          }
        }
      }
    }
    if (cur && cur.strs.length) record(cur);
  }
  return { map, dupes };
}

export { loadCninNames, resolveSpeaker, splitPages, buildLabels };

// ---------- 函数体标签表 ----------
function buildLabels(lines) {
  const labels = new Map();
  let cur = null;
  for (const ln of lines) {
    const m = LABEL_RE.exec(ln.trim());
    if (m) {
      cur = m[1];
      labels.set(cur, []);
    } else if (cur !== null) {
      labels.get(cur).push(ln);
    }
  }
  return labels;
}

function bodyMarker(body, labels, depth, seen) {
  for (const ln of body) {
    const t = ln.trim();
    const m = MOV3F37_RE.exec(t);
    if (m) return { type: 'speaker', id: parseInt(m[1], 16) };
    if (SUB3F37_RE.test(t)) return { type: 'none' };
    if (CALL_NARR_RE.test(t)) return { type: 'none' };
    const c = CALL_LAB_RE.exec(t);
    if (c && depth < 4 && !seen.has(c[1])) {
      const nested = labels.get(c[1]);
      if (nested) {
        seen.add(c[1]);
        const r = bodyMarker(nested, labels, depth + 1, seen);
        if (r) return r;
      }
    }
  }
  return null;
}

// 在 [fromIdx, toIdx) 区间内从后往前找最近的说话人标记；null = 未决
function resolveSpeaker(lines, fromIdx, toIdx, labels) {
  for (let j = toIdx - 1; j >= fromIdx; j--) {
    const t = lines[j].trim();
    const m = MOV3F37_RE.exec(t);
    if (m) return { type: 'speaker', id: parseInt(m[1], 16) };
    if (SUB3F37_RE.test(t)) return { type: 'none' };
    if (CALL_NARR_RE.test(t)) return { type: 'none' };
    const c = CALL_LAB_RE.exec(t);
    if (c) {
      const body = labels.get(c[1]);
      if (body) {
        const r = bodyMarker(body, labels, 0, new Set([c[1]]));
        if (r) return r;
      }
    }
  }
  return null;
}

// ---------- 分页 ----------
// 返回 [{ kind:'translated'|'raw', start, end, hasAdv }]
//   start = 页首行号（FROM 注释插在这一行之前）
//   end   = 页末行号（下一页的判定区间从 end+1 开始）
function splitPages(lines) {
  const pages = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.startsWith('/* 原文存档')) {
      let end = i;
      while (end < lines.length && !lines[end].trim().startsWith('// 页面结束')) end++;
      pages.push({ kind: 'translated', start: i, end, hasAdv: true });
      i = end + 1;
      continue;
    }
    if (TEXT_RE.test(t)) {
      let end = i;
      while (end < lines.length && TEXT_RE.test(lines[end].trim())) end++;
      const body = lines.slice(i, end);
      if (body.some((l) => ADV_RE.test(l.trim()))) {
        pages.push({ kind: 'raw', start: i, end: end - 1, hasAdv: true });
      }
      i = end;
      continue;
    }
    i++;
  }
  return pages;
}

// ---------- 处理单个文件 ----------
function processFile(srcPath, cnin, dryRun, refresh) {
  const raw = fs.readFileSync(srcPath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r\n|\r|\n/);
  const labels = buildLabels(lines);
  const pages = splitPages(lines);

  const inserts = []; // { at, line }
  const removes = new Set(); // 已存在、需替换的 // FROM: 行
  const stats = { speaker: 0, none: 0, unresolved: 0, unknownName: 0, skippedExisting: 0, updatedExisting: 0 };
  const speakerIds = new Map();

  let prevEnd = -1;
  for (const pg of pages) {
    if (!pg.hasAdv) { prevEnd = pg.end; continue; }
    // 幂等/刷新：页首上一行已是 // FROM:
    const existing = pg.start > 0 && lines[pg.start - 1].trim().startsWith('// FROM:') ? pg.start - 1 : -1;
    if (existing >= 0 && !refresh) {
      stats.skippedExisting++;
      prevEnd = pg.end;
      continue;
    }
    const r = resolveSpeaker(lines, prevEnd + 1, pg.start, labels);
    if (r === null) {
      stats.unresolved++;
      prevEnd = pg.end;
      continue;
    }
    let comment;
    if (r.type === 'none') {
      comment = '// FROM: none';
      stats.none++;
    } else {
      const hex = r.id.toString(16);
      const name = cnin.map.get(r.id);
      if (name === undefined) {
        comment = `// FROM: ${hex} ??`;
        stats.unknownName++;
      } else {
        comment = `// FROM: ${hex} ${name}`;
      }
      stats.speaker++;
      speakerIds.set(r.id, (speakerIds.get(r.id) || 0) + 1);
    }
    if (existing >= 0) {
      // --refresh：替换既有注释（同位置）
      removes.add(existing);
      inserts.push({ at: existing, line: comment });
      stats.updatedExisting++;
    } else {
      inserts.push({ at: pg.start, line: comment });
    }
    prevEnd = pg.end;
  }

  if (inserts.length === 0) {
    return { changed: false, stats, speakerIds, name: path.basename(srcPath) };
  }

  if (!dryRun) {
    const out = [];
    let k = 0;
    const byAt = new Map();
    for (const ins of inserts) {
      const arr = byAt.get(ins.at) || [];
      arr.push(ins.line);
      byAt.set(ins.at, arr);
    }
    for (let i = 0; i < lines.length; i++) {
      if (removes.has(i)) continue;
      const arr = byAt.get(i);
      if (arr) for (const c of arr) out.push(c);
      out.push(lines[i]);
    }
    fs.writeFileSync(srcPath, out.join(eol), 'utf8');
  }
  return { changed: true, stats, speakerIds, name: path.basename(srcPath) };
}

// ---------- main ----------
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
const opts = parseArgs(process.argv.slice(2));

let files;
if (opts.file) {
  const base = opts.file.replace(/^src[\\/]/, '').replace(/\.txt$/, '');
  files = [path.join(opts.root, 'src', `${base}.txt`)];
  if (!fs.existsSync(files[0])) {
    console.error(`[FAIL] 文件不存在: ${files[0]}`);
    process.exit(1);
  }
} else {
  const srcDir = path.join(opts.root, 'src');
  files = fs.readdirSync(srcDir)
    .filter((f) => /^(SC|SP)/.test(f) || /^\$\d+\$(SC|SP)/.test(f))
    .filter((f) => f.endsWith('.txt'))
    .map((f) => path.join(srcDir, f))
    .sort();
}

const cnin = loadCninNames(opts.root);
for (const [idHex, name] of Object.entries(NAME_OVERRIDES)) {
  const id = parseInt(idHex, 16);
  if (!cnin.map.has(id)) cnin.map.set(id, name);
}
const dupWarns = [];
for (const [id, names] of cnin.dupes) {
  if (names.length > 1) dupWarns.push(`${id.toString(16)}: ${names.join(' / ')}`);
}

const totals = { files: 0, changed: 0, speaker: 0, none: 0, unresolved: 0, unknownName: 0, skippedExisting: 0, updatedExisting: 0 };
const allIds = new Map();

for (const f of files) {
  const r = processFile(f, cnin, !opts.apply, opts.refresh);
  if (!r.changed) continue;
  totals.files++;
  totals.changed++;
  totals.speaker += r.stats.speaker;
  totals.none += r.stats.none;
  totals.unresolved += r.stats.unresolved;
  totals.unknownName += r.stats.unknownName;
  totals.skippedExisting += r.stats.skippedExisting;
  totals.updatedExisting = (totals.updatedExisting || 0) + (r.stats.updatedExisting || 0);
  for (const [id, n] of r.speakerIds) allIds.set(id, (allIds.get(id) || 0) + n);
  const mode = opts.apply ? '写入' : 'dry-run';
  console.log(
    `[${mode}] ${r.name}: 页 ${r.stats.speaker + r.stats.none + r.stats.unresolved} ` +
    `(说话 ${r.stats.speaker} / none ${r.stats.none}` +
    (r.stats.unresolved ? ` / 未决 ${r.stats.unresolved}` : '') +
    (r.stats.unknownName ? ` / 无名 ${r.stats.unknownName}` : '') +
    (r.stats.skippedExisting ? ` / 已有跳过 ${r.stats.skippedExisting}` : '') +
    (r.stats.updatedExisting ? ` / 更新 ${r.stats.updatedExisting}` : '') + ')'
  );
}

console.log('\n===== 汇总 =====');
console.log(
  `文件 ${totals.changed}/${files.length}（dry-run=${!opts.apply}），页合计 ` +
  `${totals.speaker + totals.none + totals.unresolved}: 说话 ${totals.speaker} / none ${totals.none}` +
  (totals.unresolved ? ` / 未决 ${totals.unresolved}` : '') +
  (totals.unknownName ? ` / 无名 ${totals.unknownName}` : '') +
  (totals.skippedExisting ? ` / 已有跳过 ${totals.skippedExisting}` : '') +
  (totals.updatedExisting ? ` / 更新 ${totals.updatedExisting}` : '')
);
if (allIds.size) {
  const top = [...allIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('说话人 id 分布（Top 15，hex: 页数）:');
  for (const [id, n] of top) {
    const name = cnin.map.get(id);
    console.log(`  ${id.toString(16).padStart(4)}  ${String(n).padStart(5)}  ${name ?? '??'}`);
  }
}
if (totals.unknownName > 0) {
  console.log('未知名 id（无 CNINIT 条目，仅输出 id）:');
  const unknown = new Map();
  for (const [id, n] of allIds) {
    if (!cnin.map.has(id)) unknown.set(id, n);
  }
  for (const [id, n] of [...unknown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${id.toString(16).padStart(4)}  ${String(n).padStart(5)}  (页)`);
  }
}
if (dupWarns.length) {
  console.log('\nCNINIT 重复 id（同名歧义，取首个，供复核）:');
  for (const w of dupWarns) console.log('  ' + w);
}
if (totals.unresolved > 0) {
  console.log('\n[WARN] 存在未决页（未插入 FROM），请人工复核。');
}
}
