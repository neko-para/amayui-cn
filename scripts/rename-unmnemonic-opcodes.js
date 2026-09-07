#!/usr/bin/env node
/**
 * rename-unmnemonic-opcodes.js —— 把脚本里「无助记符」的指令名替换为规范的 i[opcode] 标签。
 *
 * 背景：很多指令的助记符是来自 age-shared 的无意义十六进制（如 u00417E30 这种 u+函数地址，
 * 或 340 / 2F6 这种裸十六进制 opcode 名）。这些名字不含语义，且跨构建不对齐。
 * 本脚本把这类「无助记符」的指令统一改写为 `i` + opcode 十六进制（零填充 ≥3 位）：
 *   u00417E30 -> i004        (opcode 0x04)
 *   340       -> i340        (opcode 0x340)
 *   2F6       -> i2f6        (opcode 0x2F6)
 * 真正的语义助记符（add / mov / set-string / copy-local-array …）保持不变。
 *
 * 判定规则（避免误伤）：
 *   - 匹配 ^u[0-9a-fA-F]+$            → u+地址助记符，经 opcodes.json 的 name/aliases 反查 opcode。
 *   - 匹配 ^[0-9a-fA-F]+$ 且
 *       该 token 在表中解析出的 opcode === parseInt(token,16) → 裸 hex opcode 名 → i+hex(opcode)。
 *       否则（如 add，字符恰是十六进制字母但 opcode 不等于其 hex 值）→ 真助记符，保留。
 *   - 其它                              → 真助记符 / 标签 / 头部等，保留。
 *
 * 用法：
 *   node scripts/rename-unmnemonic-opcodes.js            # 就地改写 src/ 与 data/ 下的 *.txt
 *   node scripts/rename-unmnemonic-opcodes.js --dry-run  # 只统计并打印抽样，不改文件
 *   node scripts/rename-unmnemonic-opcodes.js --out DIR  # 把改写结果写到别的目录，不改原文件
 *   node scripts/rename-unmnemonic-opcodes.js [dir...]   # 指定要处理的目录（默认 src data）
 *
 * 说明：这是**一次性数据迁移改写**，不改变 disassembler/reassembler/opcodes.json 的既有语义名；
 * 若要让重汇编器识别 iXXX，需另行在 opcodes.json（或重汇编器）注册别名。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OPCODES = path.join(__dirname, 'asm', 'opcodes.json');

const U_RE = /^u[0-9a-fA-F]+$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

// ---------- 加载 opcode 表，构造 label -> entry 映射（name + aliases） ----------
const entries = JSON.parse(fs.readFileSync(OPCODES, 'utf8'));
const byLabel = new Map();
for (const e of entries) {
  if (!byLabel.has(e.name)) byLabel.set(e.name, e);
  for (const a of e.aliases || []) if (!byLabel.has(a)) byLabel.set(a, e);
}

/** stripComments: 逐行剔除注释区域，返回「是否代码行」标记（与重汇编器 nextCodeLine 对齐）。 */
function isCodeLineAt(text, lineIdx, state) {
  const line = text[lineIdx];
  const raw = line;
  if (state.inBlock) {
    if (raw.includes('*/')) state.inBlock = false;
    return false;
  }
  if (raw.startsWith('/*')) {
    if (!raw.includes('*/')) state.inBlock = true;
    return false;
  }
  if (raw.startsWith('//')) return false;
  if (raw === '' || raw.startsWith('==') || raw.startsWith('signature') || raw.startsWith('local_vars') || raw.startsWith('====')) return false;
  if (raw.startsWith('label_')) return false;
  return true;
}

/** replacementFor: 返回替换后的指令 token；原样保留时返回 null。 */
function replacementFor(token) {
  if (U_RE.test(token)) {
    const def = byLabel.get(token);
    if (!def) return null; // 查不到 opcode，保留并交由调用方统计
    return 'i' + def.opcode.toString(16).padStart(3, '0');
  }
  if (HEX_RE.test(token)) {
    const def = byLabel.get(token);
    const op = parseInt(token, 16);
    if (def && def.opcode === op) {
      return 'i' + op.toString(16).padStart(3, '0');
    }
    return null; // add 这类「字符恰为十六进制字母」的真助记符 → 保留
  }
  return null; // 真助记符 → 保留
}

/** leadingToken: 返回行首 token 及其前置空白。 */
function leadingToken(line) {
  const m = line.match(/^(\s*)(\S+)/);
  return m ? { ws: m[1], tok: m[2] } : null;
}

// ---------- 处理一个文件 ----------
function transformFile(filePath, outPath, stats, dryRun, verbose) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  const lines = text.split(/\r?\n/);
  const state = { inBlock: false };
  const replacements = [];

  const outLines = lines.map((line, i) => {
    if (!isCodeLineAt(lines, i, state)) return line;
    const lead = leadingToken(line);
    if (!lead) return line;
    const newTok = replacementFor(lead.tok);
    if (!newTok) return line;
    replacements.push({ from: lead.tok, to: newTok });
    return lead.ws + newTok + line.slice(lead.ws.length + lead.tok.length);
  });

  const finalText = outLines.join('\n');

  stats.filesProcessed++;
  if (replacements.length) {
    stats.changedFiles++;
    stats.changedLines += replacements.length;
    if (verbose) {
      console.log(`\n${path.relative(ROOT, filePath)}: ${replacements.length} replacements`);
      for (const r of replacements) console.log(`    ${r.from} -> ${r.to}`);
    }
    if (!dryRun) {
      if (outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, finalText, 'utf8');
      } else {
        fs.writeFileSync(filePath, finalText, 'utf8');
      }
    }
  }
}

// ---------- 主流程 ----------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outIdx = args.indexOf('--out');
const outRoot = outIdx >= 0 ? path.resolve(ROOT, args[outIdx + 1]) : null;
const skipped = new Set(outIdx >= 0 ? [args[outIdx + 1]] : []); // 跳过 --out 的值
const dirs = args.filter((a) => !a.startsWith('--') && !skipped.has(a));
const targetDirs = dirs.length ? dirs : ['src', 'data'];

const stats = { filesProcessed: 0, changedFiles: 0, changedLines: 0 };

for (const dir of targetDirs) {
  const absDir = path.resolve(ROOT, dir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    continue;
  }
  const files = fs.readdirSync(absDir).filter((f) => f.toLowerCase().endsWith('.txt'));
  for (const f of files) {
    const inPath = path.join(absDir, f);
    const outPath = outRoot ? path.join(outRoot, dir, f) : null;
    transformFile(inPath, outPath, stats, dryRun, dryRun); // 仅 dry-run 打印样例
  }
}

console.log(`\n[rename-unmnemonic-opcodes] ${dryRun ? 'DRY-RUN' : 'APPLIED'}${outRoot ? ' (-> ' + outRoot + ')' : ''}`);
console.log(`  处理文件：${stats.filesProcessed}`);
console.log(`  含改写的文件：${stats.changedFiles}`);
console.log(`  改写的指令行：${stats.changedLines}`);
