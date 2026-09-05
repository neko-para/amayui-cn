#!/usr/bin/env node
/**
 * build-opcodes.js —— 从两份「指令集」来源生成 data-driven 的 opcodes.json。
 *
 * 数据来源：
 *   1) docs-new/03-engine/opcode-table.md（权威 544 已映射 opcode + 回退默认表）
 *      —— opcode → argc / 引擎 handler / 分析状态 / 名称（age-shared u-地址助记符）。
 *   2) tools/eushully-decompiler/Decompiler/age-shared.cpp 的 make_defs() 数组
 *      —— 旧 age-asm 的 {op_code, label, argument_count}，label 多为描述性名称
 *        （set-draw-color / show-text / set-string …），与现有 data/src 基线 txt 一致。
 *
 * 产出 opcodes.json（每条）：{ opcode, argc, name, handler, status, aliases[] }。
 *  - argc 以 docs 表为准（缺失再用 make_defs），作为唯一可推进指令边界的关键字段。
 *  - name 取 make_defs 的描述性标签（若该 opcode 在 make_defs 中），否则用 docs 的 u-地址名，
 *    使 -d 输出与现有 data/src 基线 txt 的助记符兼容（骨架基线不漂移）。
 *  - aliases 收集两个来源里该 opcode 的其它名称，供 -a 汇编时解析（旧/新助记符都可）。
 *
 * 用法：node scripts/asm/build-opcodes.js           # 覆盖写入 opcodes.json
 *       node scripts/asm/build-opcodes.js --print    # 只打印统计，不写文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs-new', '03-engine', 'opcode-table.md');
const CXX = path.join(ROOT, 'tools', 'eushully-decompiler', 'Decompiler', 'age-shared.cpp');
const OUT = path.join(__dirname, 'opcodes.json');

/**
 * 解析 docs markdown 表格（两段：主映射表 + 回退默认表）。
 * 每行：| opcode | argc | 名称 | handler | 状态 | 语义 |
 * argc 允许为 '-'（age-shared 未收录）。
 */
function parseDocs(text) {
  const entries = new Map(); // opcode(hex int) -> {argc, name, handler, status}
  const rowRe = /^\|\s*(0x[0-9a-fA-F]+|\d+)\s*\|\s*([0-9a-fA-F]+|-)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(rowRe);
    if (!m) continue;
    const opcode = parseInt(m[1], 16);
    const argcRaw = m[2].trim();
    const name = m[3].trim();
    const handler = m[4].trim();
    const status = m[5].trim();
    const argc = argcRaw === '-' || argcRaw === '' ? null : parseInt(argcRaw, 10);
    if (!entries.has(opcode)) {
      entries.set(opcode, { opcode, argc, name, handler, status });
    }
  }
  return entries;
}

/**
 * 解析 C++ make_defs() 数组条目：{0x1, "u004149C0", 0x0},
 * 注意 argument_count 可能是 0x0 形式或纯数字（0x0/C/…）。
 */
function parseMakeDefs(text) {
  const entries = new Map(); // opcode(hex int) -> {label, argc}
  const entryRe = /\{\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*"([^"]+)"\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*\}/g;
  let m;
  while ((m = entryRe.exec(text)) !== null) {
    const opcode = parseInt(m[1], 16);
    const label = m[2];
    const argc = parseInt(m[3], 16);
    if (!entries.has(opcode)) entries.set(opcode, { label, argc });
  }
  return entries;
}

function main() {
  const docs = parseDocs(fs.readFileSync(DOC, 'utf8'));
  const defs = parseMakeDefs(fs.readFileSync(CXX, 'utf8'));

  const out = [];
  const seen = new Set();

  // 优先 docs 表（权威、完整）。对所有 docs 条目生成记录。
  for (const [opcode, d] of docs) {
    const def = defs.get(opcode);
    const argc = d.argc !== null ? d.argc : (def ? def.argc : null);
    const aliases = new Set();
    let name = d.name;
    // 若 make_defs 对该 opcode 有描述性/其它标签，优先作为输出名称（兼容 data/src 基线），
    // 把 docs 名与 make_defs 名都收进 aliases。
    if (def && def.label) {
      aliases.add(def.label);
      if (def.label !== d.name) name = def.label; // make_defs 标签作为可读主名
    }
    if (d.name) aliases.add(d.name);
    // 去除与 name 相同的别名
    aliases.delete(name);
    out.push({
      opcode,
      argc,
      name,
      handler: d.handler || '',
      status: d.status || '',
      aliases: [...aliases].filter((a) => a && a !== '（age-shared 未收录）'),
    });
    seen.add(opcode);
  }

  // 若 make_defs 里有 docs 未列的 opcode（旧表独有），补上，name 用 make_defs 标签。
  for (const [opcode, def] of defs) {
    if (seen.has(opcode)) continue;
    out.push({
      opcode,
      argc: def.argc,
      name: def.label,
      handler: '',
      status: '',
      aliases: [],
    });
  }

  // 按 opcode 升序输出，便于 diff 与人工维护。
  out.sort((a, b) => a.opcode - b.opcode);

  const totalArgcNull = out.filter((e) => e.argc === null).map((e) => e.opcode.toString(16).toUpperCase());
  console.log(`opcodes.json 共 ${out.length} 条（docs 表 + make_defs 独有补齐）`);
  console.log(`  argc 未知（-）条目：${totalArgcNull.length} 个 => ${totalArgcNull.join(', ')}`);

  if (process.argv.includes('--print')) return;

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`已写入 ${OUT}`);
}

main();
