// 从 src/<SCRIPT>.txt 导出「日文原文 — 当前翻译」对应表。
// 用法:
//   node extract-ja-zh-pairs.js <SCRIPT>              单脚本，CSV 打到 stdout
//   node extract-ja-zh-pairs.js --all [--out <out.csv>]   扫描全部 src/*.txt，汇总进一张 CSV
//   node extract-ja-zh-pairs.js <SCRIPT> --out <out.csv>  单脚本，同时落盘
// 说明:
//   - 只处理 ADV 文本页（show-text 类型）；忽略 set-string / draw-string / 控制行。
//   - 数据源是「/* 原文存档 … */ 」块：块内为原始日文文本行，
//     用 show-text（整段文本）与 display-furigana（主词+注音）重组成该页「日文原文」；
//     display-furigana 的注音不丢弃，按与译文一致的 <ruby>主词<rt>注音</rt></ruby> 保留。
//   - 「当前翻译」优先取块后紧跟的 `// 输入原文：…` 整句；若未写该注释
//     （原位翻译页，如 CONFIG 类），回退为块后主体 `@"…"` 行重组。
//   - 输出标准 CSV（RFC 4180，列: 文件名 | 日文原文 | 当前翻译；含引号/逗号/换行的字段做转义）；
//     `--out` 落盘；统计信息打到 stderr，不污染 CSV。
//
// 环境: 任意目录运行（默认读 ./src/<SCRIPT>.txt）。

import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.join(process.cwd(), 'src');

function usage() {
  console.log('用法:');
  console.log('  node extract-ja-zh-pairs.js <SCRIPT>             单脚本，CSV 打到 stdout');
  console.log('  node extract-ja-zh-pairs.js --all [--out <csv>]  扫描全部 src/*.txt，汇总为一张 CSV');
  console.log('  node extract-ja-zh-pairs.js <SCRIPT> --out <csv> 单脚本，同时落盘');
}

function parseArgs(argv) {
  const opts = { script: null, all: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--all') opts.all = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a.startsWith('-')) { usage(); process.exit(1); }
    else if (!opts.script) opts.script = a;
    else { usage(); process.exit(1); }
  }
  return opts;
}

// —— CSV 转义（RFC 4180）——
function csvField(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(cells) {
  return cells.map(csvField).join(',');
}

// 提取一行中所有带引号的字符串字面量（保留 U+E000–E010 外字，处理转义引号）。
function quoteStrings(line) {
  const out = [];
  const re = /"(?:[^"\\]|\\.)*"/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    out.push(m[0].slice(1, -1).replace(/\\"/g, '"'));
  }
  return out;
}

// 从行首指令名解析：返回 { cmd }
function splitCmd(line) {
  const t = line.trimStart();
  const m = t.match(/^([a-zA-Z0-9_-]+)\b/);
  if (!m) return null;
  return { cmd: m[1] };
}

// 解析 `// FROM: <id> <名称>`（id 可为 none/十六进制如 14a、1d6；名称可含空格）。
function parseFromLine(line) {
  const m = (line || '').trimStart().match(/^\/\/ *FROM:\s*(\S+)(?:\s+(.*))?$/);
  if (!m) return null;
  const id = m[1];
  const name = (m[2] || '').trim() || id;
  return { id, name };
}

// 找位于该存档块正上方、最近的非空行；若是 // FROM 则解析，否则回退为旁白 none。
function findSpeakerBeforeArchive(lines, archIndex) {
  let j = archIndex - 1;
  while (j >= 0 && lines[j].trim() === '') j--;
  const f = parseFromLine(lines[j]);
  return f || { id: 'none', name: 'none' };
}

// 解析单个文件，返回 [{ file, jp, zh, speakerId, speakerName }]。
function processFile(filePath) {
  const fileBase = path.basename(filePath).replace(/\.txt$/i, '');
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r\n|\r|\n/);
  const rows = [];

  let i = 0;
  let insideArchive = false;
  let blockLines = [];
  let pendingBlock = null;
  let pendingSpeaker = { id: 'none', name: 'none' };

  function collectBodyZh(start) {
    // 从 start 起顺序读 `@"…"` 主体行（show-text / display-furigana / concat），
    // 直到非文本行；重组中文整句（原位翻译页回退用）。
    const parts = [];
    for (let j = start; j < lines.length; j++) {
      const c = splitCmd(lines[j]);
      if (c && /^(show-text|display-furigana|concat)$/.test(c.cmd)) {
        const qs = quoteStrings(lines[j]);
        if (qs.length) parts.push(qs[0]); // concat/show-text 首串；display-furigana 取主词
      } else {
        break;
      }
    }
    return parts.join('');
  }

  function flushBlock(zhSource) {
    if (!pendingBlock) return;
    const block = pendingBlock;
    pendingBlock = null;

    // 重组日文原文：show-text 整段 + display-furigana 正文(首串)。
    const jpParts = [];
    for (const ln of block) {
      const c = splitCmd(ln);
      if (!c) continue;
      if (c.cmd === 'show-text') {
        const qs = quoteStrings(ln);
        if (qs.length) jpParts.push(qs[0]);
      } else if (c.cmd === 'display-furigana') {
        const qs = quoteStrings(ln);
        // 保留振假名：主词=第一参数，注音=第二参数；用与译文一致的 <ruby> 标记。
        // 不丢弃第二参数——个别系统提示的注音承载含义（如 召喚者→フィア / ロズリーヌ）。
        if (qs.length >= 2) jpParts.push(`<ruby>${qs[0]}<rt>${qs[1]}</rt></ruby>`);
        else if (qs.length === 1) jpParts.push(qs[0]);
      }
      // set-string / concat / draw-string / end-text-line 等不纳入日文原文重组
    }
    const jp = jpParts.join('');
    const zh = zhSource != null ? zhSource : '';
    const sp = pendingSpeaker;
    if (jp.trim() !== '' || zh.trim() !== '') {
      rows.push({ file: fileBase, jp, zh, speakerId: sp.id, speakerName: sp.name });
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // 进入原文存档块：记录说话人（取本块正上方最近的 // FROM）。
    if (!insideArchive && line.includes('/* 原文存档')) {
      insideArchive = true;
      pendingSpeaker = findSpeakerBeforeArchive(lines, i);
      blockLines = [];
      i++;
      continue;
    }
    // 退出原文存档块
    if (insideArchive && line.trim().startsWith('*/')) {
      insideArchive = false;
      pendingBlock = blockLines;
      i++;
      continue;
    }
    if (insideArchive) {
      if (line.trim() !== '') blockLines.push(line);
      i++;
      continue;
    }

    // 不在块内：检查 `// 输入原文：…`（紧跟刚闭合的块）
    const zhMatch = line.trimStart().match(/^\/\/\s*输入原文[：:]\s*(.*)$/);
    if (zhMatch && pendingBlock) {
      flushBlock(zhMatch[1].trim());
      i++;
      continue;
    }

    // 若无 `// 输入原文`，且待处理块后紧跟 `@"…"` 主体行 → 原位翻译回退。
    if (pendingBlock) {
      const c = splitCmd(line);
      const isTextBody = c && /^(show-text|display-furigana|concat)$/.test(c.cmd) &&
        line.includes('@"'); // 原位翻译主体：@"…" 字面量（@ 前缀标记译文）
      if (isTextBody) {
        const zh = collectBodyZh(i);
        flushBlock(zh);
        continue; // flushBlock 已把 pendingBlock 置 null，下一轮主循环自然推进
      }
      // 否则（到来的是别的行），视为无翻译
      flushBlock(null);
    }

    i++;
  }

  flushBlock(null); // 收尾：文件末尾未 flush 的块
  return rows;
}

// —— 主流程 ——
const opts = parseArgs(process.argv.slice(2));
if (!opts.all && !opts.script) { usage(); process.exit(1); }

const header = ['文件名', '说话人名称', '说话人ID', '日文原文', '当前翻译'];

if (opts.all) {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`[FAIL] src 目录不存在: ${SRC_DIR}`);
    process.exit(1);
  }
  const names = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.txt')).sort();
  const agg = [header.join(',')];
  let total = 0;
  for (const name of names) {
    const rows = processFile(path.join(SRC_DIR, name));
    for (const r of rows) agg.push(csvRow([r.file, r.speakerName, r.speakerId, r.jp, r.zh]));
    total += rows.length;
  }
  const csv = agg.join('\n');
  if (opts.out) fs.writeFileSync(path.resolve(opts.out), csv + '\n', 'utf8');
  process.stdout.write(csv + '\n');
  console.error(`# 全量: ${names.length} 个文件，${total} 个文本页`);
} else {
  const src = path.resolve(path.join(SRC_DIR, `${opts.script}.txt`));
  if (!fs.existsSync(src)) {
    console.error(`[FAIL] 文件不存在: ${src}`);
    process.exit(1);
  }
  const rows = processFile(src);
  const csv = [header.join(',')].concat(rows.map((r) => csvRow([r.file, r.speakerName, r.speakerId, r.jp, r.zh]))).join('\n');
  if (opts.out) fs.writeFileSync(path.resolve(opts.out), csv + '\n', 'utf8');
  process.stdout.write(csv + '\n');
  console.error(`# ${opts.script}: ${rows.length} 个文本页`);
}
