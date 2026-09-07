#!/usr/bin/env node
/**
 * clean-opcode-table-name-column.js —— 清理 opcode-table.md 的「名称」列：
 *   把「无助记符」的项（u+函数地址 / 裸十六进制 opcode 名 / （age-shared 未收录）标记）从该列移除（置空），
 *   只保留真正的语义助记符（add / mov / set-string / create-mesh …）。
 * 用法：node scripts/clean-opcode-table-name-column.js [file]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] || path.join(__dirname, '..', 'docs-new', '03-engine', 'opcode-table.md');

// 无助记符判定：u+函数地址；裸十六进制名仅当 hex 值 == opcode（规避 add 这类恰为十六进制字母的真助记符）；或 未收录 标记。
const isMeaningless = (name, opcode) => {
  if (!name) return true;
  if (/^u[0-9a-fA-F]+$/.test(name)) return true;
  if (/^[0-9a-fA-F]+$/.test(name)) return parseInt(name, 16) === opcode;
  return name === '（age-shared 未收录）';
};

const text = fs.readFileSync(FILE, 'utf8');
const out = [];
const tracker = { rows: 0, meaningfulKept: 0, blanked: 0 };

for (const line of text.split(/\r?\n/)) {
  if (!/^\|/.test(line)) { out.push(line); continue; }
  const parts = line.split('|');
  // parts[0]=前导，parts[1]=opcode，parts[2]=argc，parts[3]=名称，parts[4..]=其余列
  if (parts.length < 4) { out.push(line); continue; }
  const nameRaw = parts[3];
  const name = nameRaw.trim();
  const opcode = parseInt(parts[1].trim(), 16);
  if (isMeaningless(name, opcode)) {
    // 置空该单元格（保留空白便于阅读对齐），其余列原样保留
    tracker.blanked++;
    parts[3] = nameRaw.replace(/[^ \t]/g, ''); // 保留原空白，去掉文字
    out.push(parts.join('|'));
  } else if (name !== '') {
    tracker.meaningfulKept++;
    out.push(line);
  } else {
    out.push(line);
  }
  tracker.rows++;
}

fs.writeFileSync(FILE, out.join('\n'), 'utf8');
console.log(`已清理 ${path.relative(path.join(__dirname, '..'), FILE)}`);
console.log(`  处理行：${tracker.rows}`);
console.log(`  保留的助记符 cell：${tracker.meaningfulKept}`);
console.log(`  置空的无助记符 cell：${tracker.blanked}`);
