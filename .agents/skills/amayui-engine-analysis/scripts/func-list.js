#!/usr/bin/env node
/** 解析 Hex-Rays 反编译 C，提取"函数定义"列表（函数名 + raw.c 行区间）。
 *  启发式：签名行含调用约定(__thiscall/__cdecl/__stdcall/__fastcall/__usercall)且不以 ';' 结尾，
 *  函数体 = 下一个 '{' 到与之匹配的 '}'（Hex-Rays 通常把闭合 } 顶格）。
 *  用法：node func-list.js <file>        # 输出： <start>\t<end>\t<name>
 */
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node func-list.js <file>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const CALL = /__thiscall|__cdecl|__stdcall|__fastcall|__usercall/;
const fns = [];

function isDefinition(line) {
  const t = line.trim();
  if (!CALL.test(t)) return false;
  if (/;\s*$/.test(t)) return false; // 前向声明
  return /\)\s*$/.test(t); // 以 ')' 结尾（参数表收尾，且当前行含 '{' 或下一行是 '{'）
}

function braceEnd(lines, start) {
  let depth = 0, started = false;
  for (let j = start; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; if (started && depth === 0) return j; }
    }
  }
  return -1;
}

for (let i = 0; i < lines.length; i++) {
  if (!isDefinition(lines[i])) continue;
  const nameM = /([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*[^()]*\)\s*[;{]?\s*$/.exec(lines[i]);
  const name = nameM ? nameM[1] : null;
  const bodyStart = lines[i].includes('{') ? i : (lines[i + 1] && lines[i + 1].includes('{') ? i + 1 : i);
  const end = braceEnd(lines, bodyStart);
  if (name && end !== -1) fns.push({ name, start: i + 1, end: end + 1 });
  if (end !== -1) i = end;
}

for (const f of fns) console.log(`${f.start}\t${f.end}\t${f.name}`);
