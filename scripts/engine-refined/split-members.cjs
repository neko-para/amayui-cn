#!/usr/bin/env node
/**
 * split-members.cjs — 把 engine-refined/engine-members.cpp 按 op-records.json 的分类拆到
 * engine-refined/engine/ 子目录。分类比粗粒度的 num/str/memory 更细（按语义名前缀）：
 *
 *   arith-ops.cpp   整数算术/逻辑/比较（add sub mul div mod mov and or sar shl eq ne lt lte gt gte random）
 *   bit-ops.cpp     位操作（bit-set bit-reset check-bit）
 *   float-ops.cpp   浮点（float-mov int↔float feq fne flt flte fgt fgte）
 *   str-ops.cpp     字符串（set-string concat strlen to-string halve-strlen string-lookup-set）
 *   memory-ops.cpp  数组/索引/取地址（lookup-array lookup-array-2d lea copy-local-array set-array-to memcpy fill-zero）
 *   members.cpp     其余（未分类/未分析/非纯 的 Engine 成员）
 *
 * 分类来自 scripts/engine-refined/op-records.json（其 op.name 前缀语义），
 * 另补 op-records 未含、但 opcode-table 已核对为纯数值的 random(0x60, sub_42CA50) -> arith。
 *
 * 依赖：engine-refined/engine-members.cpp（memberize.cjs 生成的合并成员视图）。
 *   若该文件缺失（仓库只保留拆出的 engine/*.cpp 以避免「每段代码重复」），会先自动运行
 *   memberize.cjs 临时重建再读取；最终提交仍只是 engine/*.cpp。
 *
 * 用法：node scripts/engine-refined/split-members.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'engine-refined', 'engine-members.cpp');
const REC = path.join(__dirname, 'op-records.json');
const OUTDIR = path.join(ROOT, 'engine-refined', 'engine');

// 缺失时先重建，保证管线可重跑。
if (!fs.existsSync(SRC)) {
  console.log('[split] engine-members.cpp 缺失，先运行 memberize.cjs 重建…');
  execFileSync('node', [path.join(__dirname, 'memberize.cjs')], { stdio: 'inherit' });
  if (!fs.existsSync(SRC)) throw new Error('memberize.cjs 未能重建 engine-members.cpp');
}

let recs = [];
try { if (fs.existsSync(REC)) recs = JSON.parse(fs.readFileSync(REC, 'utf8')).ops || []; } catch (e) { recs = []; }

// ---- 语义名前缀 -> 类别 ----
function catOfName(name) {
  if (/^op_(add|sub|mul|div|mod|mov|and|or|sar|shl|eq|ne|lt|lte|gt|gte|random)$/.test(name)) return 'arith';
  if (/^op_(bit_set|bit_reset|check_bit)$/.test(name)) return 'bit';
  if (/^op_(float_mov|int_to_float|float_to_int|float_eq|float_ne|float_lt|float_lte|float_gt|float_gte)$/.test(name)) return 'float';
  if (/^op_(set_string|concat|strlen|to_string|halve_strlen|string_lookup_set)$/.test(name)) return 'str';
  if (/^op_(lookup_array|lookup_array_2d|lea|copy_local_array|set_array_to|memcpy|fill_zero)$/.test(name)) return 'memory';
  return null;
}

// ---- handler(sub_XXX) -> 类别 ----
const catByHandler = {};
for (const o of recs) {
  const c = catOfName(o.name);
  if (c) catByHandler[o.handler] = c;
}
catByHandler['sub_42CA50'] = 'arith';   // random(0x60)：op-records 未含但已核对为纯数值

const FILE = {
  arith: 'arith-ops.cpp', bit: 'bit-ops.cpp', float: 'float-ops.cpp',
  str: 'str-ops.cpp', memory: 'memory-ops.cpp', members: 'members.cpp',
};
const TITLE = {
  arith: '整数算术/逻辑/比较指令（pure numeric-arith）',
  bit: '位操作指令（pure numeric-bit）',
  float: '浮点指令（pure numeric-float）',
  str: '字符串指令（pure string）',
  memory: '数组/索引/取地址(lea)指令（memory/ptr）',
  members: '其余 Engine 成员函数（未分类/未分析/非纯）',
};

// ---- 解析 engine-members.cpp 成成员块 ----
const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const blocks = [];          // {handler, start, end}
const marks = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^\s*\/\* ===== \[stained\] (sub_[0-9A-Fa-f]{6})/.exec(lines[i]);
  if (m) marks.push({ i, handler: m[1] });
}
for (let k = 0; k < marks.length; k++) {
  const start = marks[k].i;
  const end = k + 1 < marks.length ? marks[k + 1].i - 1 : lines.length - 1;
  // end 定为下一个 marker 的前一行；函数体末尾的 '}' 在块内
  blocks.push({ handler: marks[k].handler, start, end });
}
// 兜底：op-records 已移除时，按成员标记里的「→ 语义名」分类（如 op_add_42C5E0 → arith）。
const nameCat = {};
for (const b of blocks) {
  const m = new RegExp('\\[stained\\] ' + b.handler + '[\\s\\S]*?→\\s*([A-Za-z_][A-Za-z0-9_]*?)(?:_[0-9A-Fa-f]{6})?\\b').exec(lines.slice(b.start, b.end + 1).join('\n'));
  const name = m ? m[1] : '';
  const c = catOfName(name);
  if (c) nameCat[b.handler] = c;
}

// ---- 按类别分组（保持原顺序；类内按原行序）----
const buckets = { arith: [], bit: [], float: [], str: [], memory: [], members: [] };
const opByHandler = {};
for (const o of recs) opByHandler[o.handler] = o;
for (const b of blocks) {
  const cat = catByHandler[b.handler] || nameCat[b.handler] || 'members';
  const op = opByHandler[b.handler];
  buckets[cat].push({ ...b, cat: cat, op });
}

// ---- 写各类别文件（带自描述头）----
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
let total = 0;
for (const cat of Object.keys(FILE)) {
  const list = buckets[cat];
  // 头注释（各文件自带标题；该子目录文件无需行对应，可加头）
  const opLines = list.filter(x => x.op).map(x => `  ${x.op.opcode} ${x.op.name} (${x.handler})`).join('\n') || '  （无已分类 op 记录）';
  const hdr = `/* =============================================================================\n` +
    ` * ${FILE[cat]} — ${TITLE[cat]}\n` +
    ` * 由 scripts/engine-refined/split-members.cjs 从 engine-members.cpp 按 op-records.json 分类拆出。\n` +
    ` * 本文件行数/行号**不**与原文件对应（是拆出的成员子集），行对应请查 member-index.json 的 raw 行区间。\n` +
    ` * 包含成员：${list.length} 个\n` +
    ` * 已分类 op：\n${opLines}\n` +
    ` * ============================================================================= */\n\n`;
  const body = list.map(x => lines.slice(x.start, x.end + 1).join('\n')).join('\n\n');
  fs.writeFileSync(path.join(OUTDIR, FILE[cat]), hdr + body + '\n');
  total += list.length;
  console.log(`[split] ${FILE[cat]}: ${list.length} members`);
}
console.log(`[split] total members partitioned=${total} (expect ${marks.length})`);

// 清理临时的合并成员视图（其内容已拆到 engine/*.cpp，避免「每段代码重复」；memberize 可随时重建）。
if (fs.existsSync(SRC)) {
  fs.unlinkSync(SRC);
  console.log(`[split] cleaned transient ${SRC}`);
}
