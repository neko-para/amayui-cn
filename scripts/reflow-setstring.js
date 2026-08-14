// reflow-setstring：把 src/*.txt 中 set-string 的对语法 "日文|中文" 转换为
// 「块注释（原文存档）+ 正文 set-string @"中文行"」格式，并按 lib/reflow.js 的
// 折行策略对每段中文重新排版。
//
// 段（块）规则：
//   - 段 = 连续出现的正文 set-string 行（旧 | 格式下全部 set-string 行均为正文；
//     新格式下 /* */ 存档块内的行忽略，仅正文行参与分组）；段间以非 set-string
//     行（mov 等）分隔；
//   - 以 ■ / ①②③④⑤ 开头的列表行各自独立成段，不参与跨行合并；
//   - 段内中文直接拼接 → 贪心折行（≤25 全角字/行，ASCII 半角）→ L 行；
//     L 可小于段内 id 数（尾部留空 @""）；L 大于 id 数时报错（无可用 id）。
//
// 输出格式（与页块风格一致）：
//   /* 原文存档（对照用，不参与汇编）
//   set-string (global-string <id>) "<日文>"
//   ...
//   */
//   set-string (global-string <id>) @"<中文行>"
//   ...
//
// 注意：单条 set-string 内的中文行与日文行不再逐行对应（中文按段整体重排），
// 符合预期；日文侧仅作对照存档，不参与汇编定位。
//
// 用法:
//   node reflow-setstring.js [--check] [脚本名 ...]
//   --check   只比较不写回；存在差异时打印并退出码 1
//   无脚本名  处理 src 下所有含 set-string 的脚本

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, SRC_DIR } from './config.js';
import { tokenize, breakLines, DEFAULT_MAX } from './lib/reflow.js';

const DATA_DIR = path.join(ROOT_DIR, 'data');
const ARCHIVE_OPEN = '/* 原文存档（对照用，不参与汇编）';
const ARCHIVE_CLOSE = '*/';
const ITEM_RE = /^[■①②③④⑤]/;
const SET_LINE = /^set-string \(global-string ([0-9a-f]+)\) "(.+)"$/;
const SET_LINE_AT = /^set-string \(global-string ([0-9a-f]+)\) @"(.*)"$/;
const PAIR_SEP = '|';

function usage() {
  console.log('用法: node reflow-setstring.js [--check] [脚本名 ...]');
  console.log('  --check   只比较不写回；有差异时打印并退出码 1');
  console.log('  无脚本名  处理 src 下所有含 set-string 的脚本');
  console.log('  把 set-string 的 "日文|中文" 对语法转为「块注释原文存档 + set-string @"中文行"」格式，');
  console.log('  并按 lib/reflow.js 折行策略（≤25 全角字/行）对每段中文整体重排；');
  console.log('  列表行（■/①-⑤）各自独立成段不合并；段内行数可少于 id 数（尾部留空 @""）。');
}

// 折行结果（token 行数组）渲染为纯文本行
function renderLine(tokens) {
  return tokens.map((t) => (t.text || '') + (t.tail || '')).join('');
}

// 解析一行正文 set-string：返回 { id, jp, cn, isItem, rawLine }；非正文行返回 null
function parseBodyLine(line) {
  const t = line.trim();
  let m;
  if ((m = SET_LINE_AT.exec(t))) {
    return { id: m[1], jp: null, cn: m[2], isItem: ITEM_RE.test(m[2]), rawLine: line };
  }
  if ((m = SET_LINE.exec(t))) {
    const content = m[2];
    const idx = content.indexOf(PAIR_SEP);
    if (idx >= 0) {
      const cn = content.slice(idx + 1);
      return { id: m[1], jp: content.slice(0, idx), cn, isItem: ITEM_RE.test(cn), rawLine: line };
    }
    return { id: m[1], jp: content, cn: null, isItem: false, rawLine: line }; // 未翻译（仅日文）行
  }
  return null;
}

// 连续行按「列表行各自成段」规则切分：p,p,i,i,p → [p,p] [i] [i] [p]
function splitRun(run) {
  const blocks = [];
  let cur = [];
  for (const it of run) {
    if (cur.length && (it.isItem || cur[cur.length - 1].isItem)) {
      blocks.push(cur);
      cur = [];
    }
    cur.push(it);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

// 单段排版：返回 { archiveLines, bodyLines }；文本过长等错误抛 Error
function layoutBlock(block) {
  const ids = block.map((b) => b.id);
  const jps = block.map((b) => b.jp);
  if (block.some((b) => b.cn === null)) {
    // 含未翻译行：不重排，保持原状（仅日文行仍以 "日文" 形式直出）
    const archive = [ARCHIVE_OPEN, ...jps.map((jp, k) => `set-string (global-string ${ids[k]}) "${jp || ''}"`), ARCHIVE_CLOSE];
    const body = block.map((b) => (b.cn === null
      ? `set-string (global-string ${b.id}) "${b.jp || ''}"`
      : `set-string (global-string ${b.id}) @"${b.cn}"`));
    return { archiveLines: archive, bodyLines: body };
  }
  // 单行段（标题、列表项等）：不重排，原文直出，保留内部空格等格式
  if (block.length === 1) {
    const archiveLines = [ARCHIVE_OPEN, `set-string (global-string ${ids[0]}) "${jps[0] || ''}"`, ARCHIVE_CLOSE];
    const bodyLines = [`set-string (global-string ${ids[0]}) @"${block[0].cn || ''}"`];
    return { archiveLines, bodyLines };
  }
  const text = block.map((b) => b.cn || '').filter((s) => s !== '').join('');
  const rendered = text ? breakLines(tokenize(text), DEFAULT_MAX).map(renderLine) : [];
  if (rendered.length > ids.length) {
    throw new Error(`段 ${ids[0]}… 折行 ${rendered.length} 行 > 可用 id ${ids.length} 个（文本过长，需人工处理）`);
  }
  const archiveLines = [ARCHIVE_OPEN, ...ids.map((id, k) => `set-string (global-string ${id}) "${jps[k] || ''}"`), ARCHIVE_CLOSE];
  const bodyLines = ids.map((id, k) => `set-string (global-string ${id}) @"${k < rendered.length ? rendered[k] : ''}"`);
  return { archiveLines, bodyLines };
}

function processScript(name) {
  const p = path.join(SRC_DIR, `${name}.txt`);
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r\n|\r|\n/);

  // 基线（data）id → 日文，用于存档对照告警
  const baseJp = new Map();
  const dataPath = path.join(DATA_DIR, `${name}.txt`);
  if (fs.existsSync(dataPath)) {
    for (const l of fs.readFileSync(dataPath, 'utf8').split(/\r\n|\r|\n/)) {
      const m = SET_LINE.exec(l.trim());
      if (m) baseJp.set(m[1], m[2]);
    }
  }

  const out = [];
  const errors = [];
  const changedBlocks = [];
  const warns = [];
  let blocks = 0;
  let archiveJp = new Map();
  let pendingArchive = null; // 新格式：紧邻前序存档块的原始行（用于新旧对比）

  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.startsWith('/*')) {
      // 存档块（新格式重跑时出现）：捕获其中 set-string 的日文，整块跳过（随后按正文块重发）
      const archRaw = [lines[i]];
      i++;
      while (i < lines.length && !lines[i].trim().includes('*/')) {
        const m = SET_LINE.exec(lines[i].trim());
        if (m) archiveJp.set(m[1], m[2]);
        archRaw.push(lines[i]);
        i++;
      }
      archRaw.push(lines[i]); // */
      i++;
      pendingArchive = archRaw;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*/')) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const first = parseBodyLine(lines[i]);
    if (!first) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // 收集连续正文行组成 run，再按列表行规则切成段
    const run = [];
    while (i < lines.length) {
      const it = parseBodyLine(lines[i]);
      if (!it) break;
      if (it.jp === null) it.jp = archiveJp.get(it.id) || ''; // 新格式：日文回填自前序存档块
      run.push(it);
      i++;
    }
    archiveJp = new Map();
    for (const block of splitRun(run)) {
      blocks++;
      try {
        const { archiveLines, bodyLines } = layoutBlock(block);
        out.push(...archiveLines, ...bodyLines);
        const oldBlockLines = [...(pendingArchive || []), ...block.map((b) => b.rawLine)];
        const newBlockLines = [...archiveLines, ...bodyLines];
        if (oldBlockLines.join('\u0001') !== newBlockLines.join('\u0001')) {
          changedBlocks.push(block[0].id);
        }
        // 存档日文与基线对照（仅告警，不阻断）
        for (const b of block) {
          if (b.jp && baseJp.has(b.id) && b.jp !== baseJp.get(b.id)) {
            warns.push(`[warn] ${name} ${b.id} 存档日文与基线不符`);
          }
        }
      } catch (err) {
        errors.push(`[FAIL] ${name}: ${err.message}`);
        out.push(...block.map((b) => b.rawLine));
      }
      pendingArchive = null;
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  for (const w of warns) console.error(w);

  const newRaw = out.join(eol);
  return { name, changed: newRaw !== raw, changedBlocks, eol, out, blocks };
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}
const check = argv.includes('--check');
const names = argv.filter((a) => a !== '--check');
const targets = names.length
  ? names
  : fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();

let totalChanged = 0;
let totalBlocks = 0;
for (const name of targets) {
  const p = path.join(SRC_DIR, `${name}.txt`);
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] 文件不存在: ${p}`);
    process.exit(1);
  }
  const r = processScript(name);
  totalChanged += r.changedBlocks.length;
  totalBlocks += r.blocks;
  const verb = check ? '差异' : '已转换';
  console.log(`${r.name}: ${r.blocks} 段, ${verb} ${r.changedBlocks.length} 段`);
  if (check && r.changedBlocks.length > 0) {
    console.log(`  变更段（前 6 个 id）: ${r.changedBlocks.slice(0, 6).join(', ')}`);
  }
  if (!check && r.changed) {
    fs.writeFileSync(p, r.out.join(r.eol), 'utf8');
  }
}

console.log(`\n合计: ${totalBlocks} 段, ${check ? '差异' : '变更'} ${totalChanged} 段${check ? '（--check 未写回）' : ''}`);
if (check && totalChanged > 0) {
  console.log('[FAIL] 存在差异，未写回');
  process.exit(1);
}
console.log(check ? '[OK] 与重排输出一致' : '[OK] 处理完成');
