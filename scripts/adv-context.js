// 提取 ADV 片段的上下文：给定 src/<脚本>.txt 中一个行号，输出该句所在页块
// 前后 N 个 ADV 页块的「说话人 + 译文 + 行号范围」，用于译文评估前的快速取证。
//
// 用法:
//   node adv-context.js <脚本> <行号> [--lines N] [--raw]
//   <脚本>     src 下的脚本名（如 SC2120）
//   <行号>     目标行号（1 起；可以是页块内任意一行，自动定位到所属页块）
//   --lines N  目标页块前后各取 N 个页块（默认 10，即 前10 + 目标 + 后10）
//   --raw      额外输出页块的原文存档（/* 原文存档 */ 内日文）与正文 show-text 行
//
// 页块定义（与 reflow-apply.js 一致）：`// 输入原文：…` 注释行开始，
// 到 `// 页面结束`（或下一个非文本指令行）结束；说话人取页块开始前最近的
// `// FROM: <id> <名称>`（无则显示 none/未知）。
//
// 输出格式（每页块一行，便于 grep）：
//   [块序号] 起始行-结束行 | FROM: <id> <名称> | <译文（// 输入原文 内容）>
// 默认只输出译文行；--raw 时附加原文存档与正文。

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from './config.js';

const COMMENT_PREFIX = '// 输入原文：';
const PAGE_END = '// 页面结束';
const TEXT_INSTR = /^(show-text|display-furigana|concat|end-text-line|draw-string)\b/;

function usage() {
  console.log('用法: node adv-context.js <脚本> <行号> [--lines N] [--raw]');
  console.log('  <脚本>     src 下的脚本名（如 SC2120）');
  console.log('  <行号>     目标行号（1 起；自动定位到所属页块）');
  console.log('  --lines N  目标页块前后各取 N 个页块（默认 10）');
  console.log('  --raw      额外输出原文存档与正文 show-text 行');
}

// 解析一个页块：返回 { start, end, commentLine, commentText, from, lines[] }
// 从 i（// 输入原文 行）开始扫描到页块结束。
function parsePage(lines, i) {
  const commentLine = i;
  const commentText = lines[i].slice(COMMENT_PREFIX.length).trim();

  // 向上找最近的 // FROM:
  let from = 'none';
  for (let k = i - 1; k >= 0; k--) {
    const t = lines[k].trim();
    if (t.startsWith('// FROM:')) {
      from = t.replace(/^\/\/ FROM:\s*/, '');
      break;
    }
    // 遇到上一个页块结束或非注释行则停止向上找（避免跨大段）
    if (t.startsWith(COMMENT_PREFIX) || t === PAGE_END) break;
  }

  const body = [];
  let j = i + 1;
  while (j < lines.length) {
    const t = lines[j].trim();
    if (TEXT_INSTR.test(t) || t === PAGE_END) {
      body.push(j);
      if (t === PAGE_END) {
        j++;
        break;
      }
      j++;
    } else {
      break;
    }
  }
  return { start: commentLine, end: j - 1, commentLine, commentText, from, body };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(0);
  }

  // 解析参数
  const positional = [];
  let linesN = 10;
  let raw = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lines') {
      linesN = parseInt(argv[++i], 10) || 10;
    } else if (argv[i] === '--raw') {
      raw = true;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length < 2) {
    usage();
    process.exit(1);
  }
  const script = positional[0];
  const targetLine = parseInt(positional[1], 10);
  if (!Number.isInteger(targetLine) || targetLine < 1) {
    console.error(`[FAIL] 行号必须是正整数: ${positional[1]}`);
    process.exit(1);
  }

  const p = path.join(SRC_DIR, `${script}.txt`);
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] 文件不存在: ${p}`);
    process.exit(1);
  }
  const rawText = fs.readFileSync(p, 'utf8');
  const lines = rawText.split(/\r\n|\r|\n/);
  const totalLines = lines.length;

  if (targetLine > totalLines) {
    console.error(`[FAIL] 行号 ${targetLine} 超出文件总行数 ${totalLines}`);
    process.exit(1);
  }

  // 收集所有页块
  const pages = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(COMMENT_PREFIX)) {
      pages.push(parsePage(lines, i));
      i = pages[pages.length - 1].end;
    }
  }

  // 定位目标行属于哪个页块
  let targetIdx = -1;
  for (let k = 0; k < pages.length; k++) {
    const pg = pages[k];
    if (targetLine >= pg.start + 1 && targetLine <= pg.end + 1) {
      targetIdx = k;
      break;
    }
  }
  if (targetIdx === -1) {
    console.error(
      `[FAIL] 行 ${targetLine} 不在任何已翻译 ADV 页块内（该行可能是控制行、注释或未翻译段）`
    );
    console.error(`       页块总数: ${pages.length}；请确认该脚本已按三段式页块翻译。`);
    process.exit(1);
  }

  // 输出范围
  const from = Math.max(0, targetIdx - linesN);
  const to = Math.min(pages.length - 1, targetIdx + linesN);

  console.log(`== ${script}.txt  目标行 ${targetLine} 位于第 ${targetIdx + 1} 个页块 ==`);
  console.log(`== 共输出 ${to - from + 1} 个页块（第 ${from + 1}–${to + 1} 块；前后各 ${linesN} 块）==`);
  console.log('');

  for (let k = from; k <= to; k++) {
    const pg = pages[k];
    const marker = k === targetIdx ? '▶' : ' ';
    const label = `${marker}[块 ${k + 1}] 行 ${pg.start + 1}-${pg.end + 1}`;
    console.log(`${label} | FROM: ${pg.from}`);
    console.log(`    ${pg.commentText}`);
    if (raw) {
      // 原文存档（页块开始前的 /* 原文存档 */ 块）
      for (let li = pg.start - 1; li >= 0; li--) {
        const t = lines[li].trim();
        if (t === '*/') {
          // 往回找 /* 原文存档 开头
          for (let li2 = li - 1; li2 >= 0; li2--) {
            if (lines[li2].includes('/* 原文存档')) {
              for (let li3 = li2 + 1; li3 < li; li3++) {
                console.log(`    [存档] ${lines[li3].trim()}`);
              }
              break;
            }
          }
          break;
        }
        if (t.startsWith('// FROM:') || t.startsWith(COMMENT_PREFIX) || t === PAGE_END) break;
      }
      // 正文行
      for (const bl of pg.body) {
        const t = lines[bl].trim();
        if (t !== PAGE_END) console.log(`    [正文] ${t}`);
      }
    }
    console.log('');
  }
}

main();
