#!/usr/bin/env node
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
/*  annotate-call-script.js                                                                             */
/*  目的：扫描 src/*.txt，把所有「立即数 call-script」在行尾追加被调用脚本的目标文件名注释。           */
/*        call-script 参数 = SYS4INI.BIN 文件索引（base）或 APPENDnn.AAI（0xnn000000 + pos），已验证。    */
/*  格式： call-script 2d      ->  call-script 2d  // CHARMEDIT                                        */
/*  说明：                                                                                              */
/*   - 只标注「立即数」版本；`call-script (global-int X)`（动态/运行时索引）不标注。                    */
/*   - 幂等：已含 `//` 注释的行跳过，不会重复追加。                                                      */
/*   - 输出：只改 src/*.txt（编译时注释被忽略，等价于不修改字节码）。--dry-run 只预览不写盘。            */
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlzss } from './alf/lzss.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const RAW_DIR = path.join(ROOT, 'raw');

// ============================================================================
// 1) 解析 SYS4INI.BIN / APPENDnn.AAI 索引（index -> filename）
// ============================================================================

function readBytesAt(fd, position, size) {
  const b = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const n = fs.readSync(fd, b, off, size - off, position + off);
    if (n <= 0) break;
    off += n;
  }
  return b;
}
function decodeAnsi(buf, offset, byteLen) {
  const limit = offset + byteLen;
  let end = offset;
  while (end < limit && buf[end] !== 0) end++;
  return buf.toString('latin1', offset, end);
}
function read_sect(fd, sectionPos) {
  const hdr = readBytesAt(fd, sectionPos, 12);
  const orig = hdr.readUInt32LE(0);
  const len = hdr.readUInt32LE(8);
  const buff = readBytesAt(fd, sectionPos + 12, len);
  const out = Buffer.alloc(orig);
  unlzss(buff, len, out, orig);
  return out;
}
function parseToc(toc) {
  const ARCENTRY = 256, FILENTRY = 80;
  const arcCount = toc.readUInt32LE(0);
  const filhdrBase = 4 + arcCount * ARCENTRY;
  const filBase = filhdrBase + 4;
  const filCount = toc.readUInt32LE(filhdrBase);
  const names = [];
  for (let i = 0; i < filCount; i++) names.push(decodeAnsi(toc, filBase + i * FILENTRY, 64));
  return { filCount, names };
}
function parseIndex(file, isS4AC) {
  const fd = fs.openSync(file, 'r');
  const toc = read_sect(fd, isS4AC ? 268 : 300);
  fs.closeSync(fd);
  return parseToc(toc);
}

const base = parseIndex(path.join(RAW_DIR, 'SYS4INI.BIN'), false);
const appendPacks = [];
for (let n = 1; n <= 5; n++) {
  const f = path.join(RAW_DIR, `APPEND${String(n).padStart(2, '0')}.AAI`);
  if (fs.existsSync(f)) appendPacks[n] = parseIndex(f, true);
}

// 文件名 -> 展示用基名（去扩展名、大写）
function displayName(filename) {
  return filename.replace(/\.[^.]+$/, '').toUpperCase().replace(/^(\d+)\$/, '');
}

// 解析 call-script 立即数 -> { name, ok }
function resolveIndex(rawHex) {
  const v = parseInt(rawHex, 16);
  if (v < base.filCount) return { ok: true, name: displayName(base.names[v]) };
  const apn = Math.floor(v / 0x1000000);
  const pos = v - apn * 0x1000000;
  const pack = appendPacks[apn];
  if (apn >= 1 && apn <= 5 && pack && pos < pack.filCount)
    return { ok: true, name: displayName(pack.names[pos]) };
  return { ok: false, name: `UNRES_${rawHex}` };
}

// ============================================================================
// 2) 扫描 src/*.txt，标注立即数 call-script
// ============================================================================

const dryRun = process.argv.includes('--dry-run');
// call-script 紧跟一个十六进制立即数（不含 `(`）
const callRe = /(?<=\bcall-script\s)[0-9a-fA-F]+\b/;

let changedFiles = 0, totalAnnotated = 0, totalDynamic = 0, totalUnresolved = 0;

const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.txt')).sort();
for (const fname of files) {
  const fp = path.join(SRC_DIR, fname);
  const lines = fs.readFileSync(fp, 'utf8').split(/\r\n|\r|\n/);
  let fileChanged = false, fileCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/call-script\s/.test(line)) continue;

    // 动态版本：call-script (global-int ...) —— 跳过
    if (/call-script\s*\(/.test(line)) { totalDynamic++; continue; }

    const m = line.match(callRe);
    if (!m) continue;

    // 幂等：已有 // 注释则跳过
    if (line.includes('//')) continue;

    const { ok, name } = resolveIndex(m[0]);
    if (!ok) { totalUnresolved++; continue; }

    lines[i] = line.replace(/\s*$/, '') + '  // ' + name;
    fileChanged = true; fileCount++; totalAnnotated++;
  }

  if (fileChanged) {
    changedFiles++;
    if (!dryRun) fs.writeFileSync(fp, lines.join('\n'), 'utf8');
    console.log(`${fileChanged ? (dryRun ? '[dry-run] ' : '[ok] ') : ''}${fname}: ${fileCount} 处`);
  }
}

console.log('\n===== 汇总 =====');
console.log('标注文件数:', changedFiles, ' 累计标注 call-script:', totalAnnotated);
console.log('动态(call-script global)未标注:', totalDynamic, ' 未解析立即数:', totalUnresolved);
if (totalUnresolved) console.log('未解析的立即数需扩展 SYS4INI/APPEND 索引逻辑，或为非常规索引。');
