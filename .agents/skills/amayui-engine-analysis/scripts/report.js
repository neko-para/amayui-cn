#!/usr/bin/env node
/**
 * report.js —— 分析数据层（analysis/fields.json + analysis/functions.json）的**查询 + 增删改**工具。
 *
 * 查询模式（只读）：
 *   node report.js [root]                        # 完整报表（向后兼容）
 *   node report.js --summary                     # 只打统计（字段/函数数、状态/作用域分布）
 *   node report.js --index [--sort addr|op|status|sem] [--group status|op|scope]  # 紧凑函数索引
 *   node report.js --find <子串>                  # 按 addr/raw_name/semantic_name/op/purpose 模糊查
 *   node report.js --addr <0x..> | --op <0x..>   # 精确查单个函数
 *   node report.js --field                       # 字段清单
 *
 * 写入模式（增删改；functions.json 外科手术式单块编辑，**不翻新其它条目**；fields.json 写后按 scope+offset 重排）：
 *   node report.js --func-add  '<json>'          # 新增函数（json 或 k=v …）
 *   node report.js --func-edit <addr> --set k=v [--set ...]   # 改某函数字段
 *   node report.js --func-rm   <addr>            # 删某函数
 *   node report.js --field-add '<json>'          # 新增字段
 *   node report.js --field-edit <offset> --set k=v [--set ...]
 *   node report.js --field-rm  <offset>
 *
 * 约定：结论写入数据层（唯一增长处）；不解析/改写反编译文本。--set 缺引号时布尔/数字自动解析，其余为字符串。
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

// ---- 取值：root = 第一个非 flag 值的位置参数；缺省 '.' ----
const args = process.argv.slice(2);
// 取值 flag 清单（其后一个 token 是值，不是位置参数/root）
const VALUE_FLAGS = new Set(['--set', '--find', '--addr', '--op', '--func-add', '--func-edit', '--func-rm', '--field-add', '--field-edit', '--field-rm', '--sort', '--group', '--root']);
function parseOpt(args) {
  const o = { set: [], rest: [] };
  let rootVal = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--set') { o.set.push(args[++i]); continue; }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (VALUE_FLAGS.has(a)) { o[k] = args[++i]; }
      else o[k] = true;
      continue;
    }
    if (!rootVal) rootVal = a; else o.rest.push(a); // 第一个位置参数 = root
  }
  return { o, rootVal };
}
const parsed = parseOpt(args);
const opt = parsed.o;
// root：优先 --root，其次第一个位置参数，缺省 '.'
const root = (typeof opt.root === 'string' ? opt.root : null) || parsed.rootVal || '.';
const FIELDS = path.join(root, 'analysis', 'fields.json');
const FUNCS = path.join(root, 'analysis', 'functions.json');

function load(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.warn(`[warn] 读取 ${p} 失败: ${e.message}`); return null; }
}
function writeJson(p, text) { fs.writeFileSync(p, text, 'utf8'); console.log(`[ok] 已写 ${p}`); }

// ===================== 查询 =====================
function printSummary(fields, funcs) {
  const byScope = {}, byFStatus = {}, fStat = {}, byOp = {};
  for (const f of fields) { byScope[f.scope] = (byScope[f.scope] || 0) + 1; byFStatus[f.status] = (byFStatus[f.status] || 0) + 1; }
  for (const fn of funcs) { fStat[fn.status] = (fStat[fn.status] || 0) + 1; if (fn.op) byOp[fn.op] = (byOp[fn.op] || 0) + 1; }
  console.log('字段: ' + fields.length + ' 条  |  scope: ' + Object.entries(byScope).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('        status: ' + Object.entries(byFStatus).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('函数: ' + funcs.length + ' 条  |  status: ' + Object.entries(fStat).map(([k, v]) => `${k}=${v}`).join(', '));
  if (Object.keys(byOp).length) console.log('        opcode handlers: ' + Object.keys(byOp).length + ' 个');
}

function fnIndexLine(fn) {
  const un = fn.unmodeled && fn.unmodeled.length ? ` #${fn.unmodeled.length}` : '';
  return `${fn.addr} ${fn.raw_name} → ${fn.semantic_name || '?'}${fn.op ? ` (${fn.op})` : ''} [${fn.status}]${un}`;
}
function fnSortKey(fn, key) {
  switch (key) {
    case 'op': return fn.op || '\uffff';
    case 'status': return fn.status || '';
    case 'sem': return fn.semantic_name || '';
    default: return fn.addr || '';
  }
}
function fnGroupKey(fn, key) {
  if (key === 'op') return fn.op ? `opcode ${fn.op}` : 'engine（非 opcode）';
  if (key === 'scope') return fn.op ? 'opcode/accessor' : 'engine';
  return fn.status || 'UNKNOWN';
}
function printFunctions(funcs, { sort = 'addr', group = '', filter = null, where = null, detail = false } = {}) {
  let list = funcs.slice();
  if (where) list = list.filter(where);
  else if (filter) list = list.filter((fn) => [fn.addr, fn.raw_name, fn.semantic_name, fn.op, fn.purpose].some((s) => s && filter.test(String(s))));
  list.sort((a, b) => String(fnSortKey(a, sort)).localeCompare(String(fnSortKey(b, sort))));
  let lastG = null;
  for (const fn of list) {
    if (group) { const g = fnGroupKey(fn, group); if (g !== lastG) { console.log(`\n## ${g}`); lastG = g; } }
    console.log(fnIndexLine(fn));
    if (detail) console.log(`    ${fn.purpose || ''}`);
  }
  console.log(`\n（${list.length} 条）`);
}

// ===================== 写入：fields.json =====================
const SCOPE_ORDER = ['Engine', 'ScriptContext', 'MeshEntry', 'DrawItem', 'global'];
function fieldSortKey(f) { const s = SCOPE_ORDER.indexOf(f.scope); return { s: s === -1 ? 99 : s, o: parseInt(f.offset, 16) || 0 }; }
function serializeFields(fields) {
  // 与 sort-fields.js 完全一致：按 scope+offset 排序，跨作用域插空行；每条 '  {...},'（末条无逗号）。
  const sorted = fields.slice().sort((a, b) => { const ka = fieldSortKey(a), kb = fieldSortKey(b); return ka.s - kb.s || ka.o - kb.o; });
  const lines = [];
  let prevScope = null;
  sorted.forEach((e, i) => {
    if (prevScope !== null && e.scope !== prevScope) lines.push('');
    lines.push('  ' + JSON.stringify(e) + (i === sorted.length - 1 ? '' : ','));
    prevScope = e.scope;
  });
  return '[\n' + lines.join('\n') + '\n]\n';
}

// ===================== 写入：functions.json（单块手术式编辑） =====================
function parseFnBlocks(text) {
  const lines = text.split('\n');
  const blocks = []; let i = 0;
  while (i < lines.length) {
    if (lines[i] === '  {') {
      const start = i; i++; let addr = null;
      while (i < lines.length && !/^  \}(,)?$/.test(lines[i])) { const m = /"addr":\s*"(0x[0-9a-fA-F]+)"/.exec(lines[i]); if (m) addr = m[1]; i++; }
      if (i < lines.length) { blocks.push({ start, end: i, addr }); }
      i++;
    } else i++;
  }
  return blocks;
}
const FN_KEY_ORDER = ['addr', 'raw_name', 'semantic_name', 'op', 'status', 'purpose', 'signature_override', 'sub_behaviors', 'fields_used', 'unmodeled', 'evidence', 'notes'];
function fmtFnVal(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']';
  if (v && typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ') + ' }';
  return JSON.stringify(v);
}
function blockText(obj, isLast) {
  const keys = FN_KEY_ORDER.filter((k) => obj[k] !== undefined);
  const lines = ['  {'];
  keys.forEach((k, j) => lines.push(`    ${JSON.stringify(k)}: ${fmtFnVal(obj[k])}${j < keys.length - 1 ? ',' : ''}`));
  lines.push('  }' + (isLast ? '' : ','));
  return lines.join('\n');
}
function parseKv(raws) {
  const out = {};
  for (const r of raws) {
    const eq = r.indexOf('='); if (eq < 0) continue;
    const k = r.slice(0, eq).trim(); let v = r.slice(eq + 1).trim();
    if (v === 'true' || v === 'false') v = v === 'true';
    else if (/^-?\d+$/.test(v)) v = Number(v);
    out[k] = v;
  }
  return out;
}

// ---- 写入分支 ----
const isWrite = opt['func-add'] || opt['func-edit'] || opt['func-rm'] || opt['field-add'] || opt['field-edit'] || opt['field-rm'];
if (isWrite) {
  if (opt['func-add']) {
    const g = load(FUNCS); if (!g) process.exit(1);
    const obj = opt['func-add'].startsWith('{') ? JSON.parse(opt['func-add']) : parseKv(opt['func-add'].split(/\s+/));
    if (!obj.addr) { console.log('[err] --func-add 需要 addr'); process.exit(1); }
    if (g.some((e) => e.addr === obj.addr)) { console.log(`[err] 已存在 addr ${obj.addr}，用 --func-edit`); process.exit(1); }
    // 精确追加在数组末尾：末条目补尾逗号，插入新块（新块是末条，无尾逗号）——不吞行、不翻新
    let txt = fs.readFileSync(FUNCS, 'utf8');
    const idx = txt.lastIndexOf('\n]');
    if (idx < 0) { console.log('[err] 无法定位 functions.json 数组结尾，已熔断（未写入）'); process.exit(1); }
    const prefix = txt.slice(0, idx).replace(/\s+$/, '').replace(/}\s*$/, '},');
    txt = prefix + '\n' + blockText(obj, true) + '\n' + txt.slice(idx);
    writeJson(FUNCS, txt);
  }

  if (opt['func-edit']) {
    const target = opt['func-edit']; const sets = parseKv(opt.set);
    let txt = fs.readFileSync(FUNCS, 'utf8');
    const blocks = parseFnBlocks(txt);
    const blk = blocks.find((b) => b.addr === target);
    if (!blk) { console.log(`[err] 未找到 addr ${target}`); process.exit(1); }
    const lines = txt.split('\n');
    // 块末尾可能带尾逗号（非末条），先去掉再 JSON.parse
    let blkText = lines.slice(blk.start, blk.end + 1).join('\n').trimEnd();
    if (blkText.endsWith(',')) blkText = blkText.slice(0, -1);
    const obj = JSON.parse(blkText);
    Object.assign(obj, sets);
    const isLast = !blocks.some((b) => b.start > blk.end);
    const newLines = blockText(obj, isLast).split('\n');
    lines.splice(blk.start, blk.end - blk.start + 1, ...newLines);
    writeJson(FUNCS, lines.join('\n'));
  }

  if (opt['func-rm']) {
    const target = opt['func-rm'];
    let txt = fs.readFileSync(FUNCS, 'utf8');
    const blocks = parseFnBlocks(txt);
    const idx = blocks.findIndex((b) => b.addr === target);
    if (idx < 0) { console.log(`[err] 未找到 addr ${target}`); process.exit(1); }
    const blk = blocks[idx]; const wasLast = idx === blocks.length - 1;
    const lines = txt.split('\n');
    lines.splice(blk.start, blk.end - blk.start + 1);
    if (wasLast) { for (let i = lines.length - 1; i >= 0; i--) { if (/^  \},$/.test(lines[i])) { lines[i] = lines[i].replace(/,$/, ''); break; } } }
    writeJson(FUNCS, lines.join('\n'));
  }

  if (opt['field-add']) {
    const f = load(FIELDS); if (!f) process.exit(1);
    const obj = opt['field-add'].startsWith('{') ? JSON.parse(opt['field-add']) : parseKv(opt['field-add'].split(/\s+/));
    if (f.some((e) => e.offset === obj.offset)) { console.log(`[err] 已存在 offset ${obj.offset}`); process.exit(1); }
    f.push(obj); writeJson(FIELDS, serializeFields(f));
  }
  if (opt['field-edit']) {
    const target = opt['field-edit']; const f = load(FIELDS); if (!f) process.exit(1);
    const e = f.find((x) => x.offset === target);
    if (!e) { console.log(`[err] 未找到 offset ${target}`); process.exit(1); }
    Object.assign(e, parseKv(opt.set)); writeJson(FIELDS, serializeFields(f));
  }
  if (opt['field-rm']) {
    const target = opt['field-rm']; let f = load(FIELDS); if (!f) process.exit(1);
    const n = f.length; f = f.filter((x) => x.offset !== target);
    if (f.length === n) { console.log(`[err] 未找到 offset ${target}`); process.exit(1); }
    writeJson(FIELDS, serializeFields(f));
  }
  process.exit(0);
}

// ---- 只读分支 ----
const fields = load(FIELDS), funcs = load(FUNCS);
if (!fields || !funcs) { console.log('[err] 读取数据层失败'); process.exit(1); }

if (opt.summary) printSummary(fields, funcs);
else if (opt.field) {
  for (const f of fields) console.log(`  ${f.scope.padEnd(14)} ${f.offset.padEnd(9)} ${f.name.padEnd(24)} ${f.type}${f.status === 'confirmed' ? '' : '  (待确认)'}`);
} else if (opt.find) {
  printFunctions(funcs, { filter: new RegExp(opt.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
} else if (opt.addr || opt.op) {
  const field = opt.addr ? 'addr' : 'op';
  const re = new RegExp((opt.addr || opt.op).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  printFunctions(funcs, { where: (fn) => re.test(String(fn[field])), detail: true });
} else if (opt.index) {
  printFunctions(funcs, { sort: typeof opt.sort === 'string' ? opt.sort : 'addr', group: typeof opt.group === 'string' ? opt.group : '' });
} else {
  console.log('# 字段/偏移模型');
  printSummary(fields, funcs);
  console.log('\n# 函数清单');
  printFunctions(funcs, { sort: 'addr' });
  console.log('\n# 字段清单');
  for (const f of fields) console.log(`  ${f.scope.padEnd(14)} ${f.offset.padEnd(9)} ${f.name.padEnd(24)} ${f.type}${f.status === 'confirmed' ? '' : '  (待确认)'}`);
  console.log('\n[HINT] 查询: --index/--find/--addr/--op/--summary；增删改: --func-add/--func-edit/--func-rm, --field-add/--field-edit/--field-rm');
}
