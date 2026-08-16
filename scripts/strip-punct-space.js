// 移除 ADV 层译文「标点后全角空格」残留：`// 输入原文：…` 注释行与 concat 行中的
// 「？　」「！　」（？/！ 后接全角空格 U+3000）→「？」「！」。机械式批量工具，
// 供 subagent / 批量任务直接调用，无需逐处手工编辑。
//
// 用法:
//   node strip-punct-space.js [--check] [脚本名 ...]
//   --check     只比较不写回；存在差异时打印并退出码 1
//   无脚本名    处理 src 下所有含「？　/！　」的脚本
//
// 适用范围（严格限定，与批量任务约定一致）：
//   - `// 输入原文：…` 注释行（整行替换）
//   - `concat (global-string …) @"…" (…)` 行（@"…" 译文内替换）
//   不处理：
//   - `/* 原文存档 */` 块内日文（show-text 0 "…" 无 @ 前缀），保留原样
//   - `show-text 0 @"…"` 正文（由 reflow-apply 从注释重新生成，不在此改）
//   - set-string 行、其他控制行
//   不改变任何其他全角空格（`【】　` 分类格式、行首缩进、词条对齐等必须保留）。
//
// 配合流程：改完注释后运行 `node reflow-apply.js <脚本>` 刷新正文，
// `node reflow-apply.js --check <脚本>` 幂等验证，再 assemble。

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './config.js';

const COMMENT_PREFIX = '// 输入原文';
const FULLWIDTH_SPACE = '\u3000';

// 匹配「？　」或「！　」（标点后全角空格）
const PUNCT_SPACE = /[？！]\u3000/g;

function usage() {
  console.log('用法: node strip-punct-space.js [--check] [脚本名 ...]');
  console.log('  --check     只比较不写回；有差异时打印并退出码 1');
  console.log('  无脚本名    处理 src 下所有含「？　/！　」的脚本');
  console.log('  仅处理 // 输入原文 注释行与 concat 行的「？　/！　」→「？」「！」；');
  console.log('  原文存档、show-text 正文、set-string 及【】　等格式空格一律不动。');
}

// 该行是否属于可替换的译文层行
function isEditable(line) {
  if (line.startsWith(COMMENT_PREFIX)) return true;
  if (/^concat\b/.test(line.trim()) && line.includes('@"')) return true;
  return false;
}

// 对该行执行替换，返回 { newLine, count }
function replaceInLine(line) {
  const matches = line.match(PUNCT_SPACE);
  if (!matches) return { newLine: line, count: 0 };
  return { newLine: line.replace(PUNCT_SPACE, (m) => m[0]), count: matches.length };
}

function processScript(name, apply) {
  const p = path.join(SRC_DIR, `${name}.txt`);
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r\n|\r|\n/);

  let totalCount = 0;
  let lineCount = 0;
  const changedLines = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isEditable(lines[i])) continue;
    const { newLine, count } = replaceInLine(lines[i]);
    if (count > 0) {
      totalCount += count;
      lineCount++;
      changedLines.push(i + 1);
      if (apply) lines[i] = newLine;
    }
  }

  if (apply && totalCount > 0) {
    fs.writeFileSync(p, lines.join(eol), 'utf8');
  }

  return { name, totalCount, lineCount, changedLines };
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}
const check = argv.includes('--check');
const names = argv.filter((a) => a !== '--check');

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

let totalAll = 0;
let changedFiles = 0;
const failures = [];

for (const name of targets) {
  const p = path.join(SRC_DIR, `${name}.txt`);
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] 文件不存在: ${p}`);
    failures.push(name);
    continue;
  }
  const r = processScript(name, !check);
  totalAll += r.totalCount;
  if (r.totalCount > 0) changedFiles++;
  const verb = check ? '差异' : '替换';
  console.log(
    `${r.name}: ${verb} ${r.totalCount} 处（${r.lineCount} 行${check ? '，未写回' : ''}）`
  );
  if (check && r.totalCount > 0 && r.changedLines.length <= 20) {
    console.log(`  行号: ${r.changedLines.join(', ')}`);
  }
}

console.log(
  `\n合计: ${targets.length} 个脚本, ${check ? '差异' : '替换'} ${totalAll} 处（${changedFiles} 个文件）${check ? '（--check 未写回）' : ''}`
);
if (check && totalAll > 0) {
  console.log(`[FAIL] 存在 ${totalAll} 处差异，未写回`);
  process.exit(1);
}
if (failures.length > 0) {
  console.log(`[FAIL] ${failures.length} 个脚本文件不存在: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(check ? '[OK] ADV 层已无「？　/！　」残留' : '[OK] 处理完成');
