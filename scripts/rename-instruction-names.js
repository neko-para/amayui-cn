#!/usr/bin/env node
/**
 * rename-instruction-names.js —— 把若干指令的助记符改名（只改行首指令 token，不动操作数/注释/字符串）。
 *
 * 用法：node scripts/rename-instruction-names.js [dir...]   （默认 src data）
 * 本例映射：
 *   i001           -> abort          (op 0x1)
 *   copy-to-global -> fill-zero      (op 0x6c)
 *   mouse_callback -> mouse-callback (op 0xcc)
 *   joy_callback   -> joy-callback   (op 0xfb)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MAPPING = {
  'i001': 'abort',
  'copy-to-global': 'fill-zero',
  'mouse_callback': 'mouse-callback',
  'joy_callback': 'joy-callback',
};

function isCodeLine(line) {
  if (line === '') return false;
  if (line.startsWith('==') || line.startsWith('signature') || line.startsWith('local_vars') || line.startsWith('====')) return false;
  if (line.startsWith('label_')) return false;
  if (line.startsWith('//') || line.startsWith('/*')) return false;
  return true;
}
function leadingToken(line) {
  const m = line.match(/^(\s*)(\S+)/);
  return m ? { ws: m[1], tok: m[2] } : null;
}

const args = process.argv.slice(2);
const dirs = args.length ? args.filter((a) => !a.startsWith('--')) : ['src', 'data'];
let processed = 0, changedFiles = 0, changedLines = 0;

for (const dir of dirs) {
  const abs = path.resolve(ROOT, dir);
  if (!fs.existsSync(abs)) { console.error(`not a dir: ${dir}`); continue; }
  for (const f of fs.readdirSync(abs).filter((x) => x.toLowerCase().endsWith('.txt'))) {
    const fp = path.join(abs, f);
    const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
    let changed = false;
    const out = lines.map((line) => {
      if (!isCodeLine(line)) return line;
      const lead = leadingToken(line);
      if (!lead) return line;
      const newTok = MAPPING[lead.tok];
      if (!newTok) return line;
      changed = true;
      return lead.ws + newTok + line.slice(lead.ws.length + lead.tok.length);
    });
    processed++;
    if (changed) {
      fs.writeFileSync(fp, out.join('\n'), 'utf8');
      changedFiles++; changedLines++;
    }
  }
}
console.log(`renamed instruction tokens in ${processed} files; ${changedFiles} changed.`);
