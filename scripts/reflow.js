// 折行工具 CLI：把文案（可含 <ruby>…<rt>…</rt></ruby> 注音、<nb>…</nb> 不折行、
// <br> 强制换行）排版为
// 标准脚本行（show-text / display-furigana / concat / end-text-line）。
//
// 用法:
//   node reflow.js <文案文件|-> [--max 25] [--no-concat]
//   - 文案文件内多个段落用空行分隔，每段作为一个独立页面输出；
//   - --max 为每行最多中文字数（默认 25）；
//   - 页面最后一行不加 end-text-line（保留 concat）；末行 ≤5 字时自动递减行宽重排（≤3 次）；
//   - 行尾不得是『（左引号），发现则提前折行把『移到下一行行首；
//   - 每个页面块为三段式：首行 `// 输入原文：…` 单行注释（含 ruby 标记，排版前原文）、
//     正文、末行 `// 页面结束` 结束注释（页块显式边界）；
//   - 传 `-` 从 stdin 读取。
//
// 示例:
//   node reflow.js page.txt

import fs from 'node:fs';
import { reflow, DEFAULT_MAX } from './lib/reflow.js';

function usage() {
  console.log('用法: node reflow.js <文案文件|-> [--max N] [--no-concat]');
  console.log('  --max N      每行最多 N 个中文字（默认 25，ASCII 按半个中文计）');
  console.log('  文案支持标注：<ruby>主词<rt>注音</rt></ruby>、<nb>不折行内容</nb>、<br>强制换行');
  console.log('  多个段落用空行分隔，每段输出为一个页面块');
  console.log('  页面最后一行不加 end-text-line（保留 concat）；末行 ≤5 字自动重排（≤3 次）');
}

function parseArgs(argv) {
  const opts = { max: DEFAULT_MAX, concat: true, input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max') opts.max = parseInt(argv[++i], 10);
    else if (a === '--no-concat') opts.concat = false;
    else if (a.startsWith('-')) {
      usage();
      process.exit(1);
    } else opts.input = a;
  }
  return opts;
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}
const opts = parseArgs(argv);
if (!opts.input) {
  usage();
  process.exit(1);
}

let input;
if (opts.input === '-') {
  input = fs.readFileSync(0, 'utf8');
} else {
  input = fs.readFileSync(opts.input, 'utf8');
}

// 避免英文双引号破坏脚本字符串语法
const text = input.replace(/"/g, '“');

const pages = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const blocks = [];
for (const page of pages) {
  blocks.push(reflow(page, { maxLen: opts.max, concat: opts.concat }));
}

console.log(blocks.map((b) => b.join('\n')).join('\n\n'));
