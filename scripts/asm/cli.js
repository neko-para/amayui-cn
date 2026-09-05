#!/usr/bin/env node
// cli.js —— AGE 脚本反汇编 / 重汇编 / 往返校验（Node 移植，data-driven 指令表）
//
// 用法（与 age-asm.exe 一致，-e 可出现在任意位置）：
//   node scripts/asm/cli.js [-e codepage] -d <in.bin> [out.txt]
//   node scripts/asm/cli.js [-e codepage] -a <in.txt> [out.bin]
//   node scripts/asm/cli.js [-e codepage] -x <file|dir>
//   node scripts/asm/cli.js -h|--help
//
// codepage：932|936|65001 或 sjis|gbk|utf8（默认 932，与 C++ 一致）。
// 目录模式：-d/-a 会处理 dir 下所有 .bin (→.txt) / .txt (→.BIN)，输出到 [out 目录]（默认 decompiled/、compiled/）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCodepage, CP_932, loadOpcodeTable } from './age-shared.mjs';
import { disassemble } from './disassembler.mjs';
import { assemble } from './reassembler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const table = loadOpcodeTable(path.join(__dirname, 'opcodes.json'));

function usage() {
  console.log('AGE script utilities (Node port of age-asm.exe)');
  console.log('Usage: node scripts/asm/cli.js [-e codepage] [-da] infile [outfile]');
  console.log('  -d   disassemble .BIN -> .txt');
  console.log('  -a   assemble .txt -> .BIN');
  console.log('  -x   roundtrip check (disassemble + reassemble, expect identical)');
}

const args = process.argv.slice(2);
const has = (o, ...names) => names.some((n) => o === n);

let codepage = CP_932;
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-e' && i + 1 < args.length) {
    codepage = parseCodepage(args[++i]);
    if (!codepage) { console.error(`Unknown codepage: ${args[i]}`); process.exit(1); }
  } else if (a.length > 2 && a.startsWith('-e')) {
    codepage = parseCodepage(a.slice(2));
    if (!codepage) { console.error(`Unknown codepage: ${a.slice(2)}`); process.exit(1); }
  } else {
    rest.push(a);
  }
}

if (rest.length === 0 || has(rest[0], '-h', '--help')) {
  usage();
  process.exit(rest.length ? 0 : 1);
}

if (rest.length < 2 && rest[0] !== '-x') {
  usage();
  process.exit(1);
}

function failSyncInBinary(text) {
  return Buffer.from(String(text), 'utf8');
}

// -x：往返校验
function checkFile(file) {
  const ext = path.extname(file).toLowerCase();
  let original;
  if (ext === '.bin') {
    original = fs.readFileSync(file);
    const text = disassemble(original, table, codepage);
    const rebuilt = assemble(text, table, codepage);
    if (!original.equals(rebuilt)) {
      console.log(`\tdifferent!`);
      process.exit(1);
    }
  } else if (ext === '.txt' || ext === '.TXT') {
    original = fs.readFileSync(file, 'utf8');
    const rebuilt = assemble(original, table, codepage);
    const text2 = disassemble(rebuilt, table, codepage);
    if (normalizeEol(original) !== normalizeEol(text2)) {
      console.log(`\tdifferent!`);
      process.exit(1);
    }
  } else {
    console.log(`Unknown extension: ${file}`);
    process.exit(1);
  }
  console.log(`\tequal`);
}

function normalizeEol(s) {
  return s.replace(/\r\n/g, '\n');
}

const mode = rest[0];
const input = rest[1];

if (mode === '-x') {
  if (input && fs.existsSync(input) && fs.statSync(input).isDirectory()) {
    for (const f of fs.readdirSync(input)) {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.bin' || ext === '.txt') {
        console.log(`Checking file ${f}`);
        checkFile(path.join(input, f));
      }
    }
  } else if (input) {
    console.log(`Checking file ${input}`);
    checkFile(input);
  } else {
    usage();
    process.exit(1);
  }
  process.exit(0);
}

if (mode !== '-d' && mode !== '-a') {
  console.error(`Unknown option : ${mode}`);
  process.exit(1);
}

const isDisassemble = mode === '-d';
const outIdx = rest.length > 2 ? 2 : -1;

if (input && fs.existsSync(input) && fs.statSync(input).isDirectory()) {
  const outDir = outIdx >= 0 ? rest[outIdx] : (isDisassemble ? 'decompiled/' : 'compiled/');
  const inExt = isDisassemble ? '.bin' : '.txt';
  const outExt = isDisassemble ? '.txt' : '.BIN';
  fs.mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const f of fs.readdirSync(input)) {
    const ext = path.extname(f).toLowerCase();
    const full = path.join(input, f);
    if (ext === inExt && fs.statSync(full).size > 0) {
      const out = path.join(outDir, path.basename(f, ext) + outExt);
      processFile(full, out, isDisassemble);
      count++;
    }
  }
  console.log(`${isDisassemble ? 'Disassembly' : 'Assembly'} done on ${count} files.`);
} else {
  const out = outIdx >= 0
    ? rest[outIdx]
    : path.join(path.dirname(input), path.basename(input, path.extname(input)) + (isDisassemble ? '.txt' : '.BIN'));
  processFile(input, out, isDisassemble);
}

function processFile(inFile, outFile, isDisassemble) {
  if (isDisassemble) {
    const buf = fs.readFileSync(inFile);
    const text = disassemble(buf, table, codepage);
    fs.writeFileSync(outFile, text, 'utf8');
    console.log(`Disassembling ${inFile} into ${outFile}`);
  } else {
    const text = fs.readFileSync(inFile, 'utf8');
    const buf = assemble(text, table, codepage);
    fs.writeFileSync(outFile, buf);
    console.log(`Assembling ${inFile} into ${outFile}`);
  }
}
