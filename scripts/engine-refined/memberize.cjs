#!/usr/bin/env node
/**
 * memberize.js — 无 libclang 的「Engine 成员函数染色 + 提取 + _this→this-> 转换」脚本。
 *
 * 目标（对应 amayui-engine-analysis 的分析简化任务 A）：
 *   基于「明确已知 Engine 成员函数」清单（docs/re/engine/member_functions.detected.txt 的 sub_* 成员，
 *   由先前 libclang 基线检测 + 调用图传播得到并落档），从原始反编译
 *   engine-refined/天结_unpacked.exe_utf8.cpp 里把每个成员函数抽取出来，
 *   做可确证的 C++ 成员化改写，隔离到 engine-refined/engine-members.cpp，
 *   并产出机器可读成员索引 engine-refined/member-index.json。
 *
 * 转换规则（只动「可确证」部分，绝不臆测；未确证的 _this[...] 保持原样）：
 *   (1) 签名：`RET __thiscall sub_<addr>(_DWORD *_this, params)` -> `RET Engine::<sem>_<addr>(_DWORD *_this, params)`
 *       （保留 _this 形参以保持 DWORD 下标语义；语义名取自 semantic_names.json，未知回退 sub_<addr>）。
 *   (2) 顶层字段：`_this[K]`(K*4 命中 Engine 顶层字节偏移) -> `this->field`。
 *   (3) 帧字段：`_this[30*<cur>+K]`(帧内偏移命中 FRAME_FIELD) -> `this->frames[<cur>].field`。
 *   (4) 成员调用：`<sem>_<addr>(_this, ...)` -> `this-><sem>_<addr>(...)`（接收者为首实参 _this）。
 *   (5) 语义改名：`sub_<addr>` -> `<sem>_<addr>`（已知语义；未知保持）。
 *
 * 注意：原始 engine-refined/...cpp 保持只读基准不改动；本脚本只生成新的 members 视图文件。
 * 用法：node scripts/engine-refined/memberize.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'engine-refined', '天结_unpacked.exe_utf8.cpp');
const MEMBER_LIST = path.join(ROOT, 'docs', 're', 'engine', 'member_functions.detected.txt');
const SEM_TABLE = path.join(ROOT, 'scripts', 're', 'semantic_names.json');
const OP_TABLE = path.join(ROOT, 'docs-new', '03-engine', 'opcode-table.md');
const OUT_MEMBERS = path.join(ROOT, 'engine-refined', 'engine-members.cpp');
const OUT_INDEX = path.join(ROOT, 'engine-refined', 'member-index.json');
const EM_HDR = path.join(__dirname, 'members-header.txt');

// ---- Engine 字段模型（来自 engine/engine.hpp + scripts/re/retype.py，均为已确证偏移）----
const ENGINE_TOP = {
  0x5D800: 'global_int_base', 0x5D808: 'global_float_base', 0x5D810: 'global_string_base',
  0x5D818: 'global_ptr_base', 0x5D820: 'global_float_ptr_base',
  0x5D880: 'cur_script', 0x5D884: 'call_ret', 0x5D888: 'call_link', 0x5D88C: 'call_flag',
  0x5EC8C: 'key', 0xA509C: 'dispatch',
};
const ENGINE_DWORD = {};           // dword 下标 -> field
for (const off of Object.keys(ENGINE_TOP).map(Number))
  if (off % 4 === 0) ENGINE_DWORD[off / 4] = ENGINE_TOP[off];
const FRAME_FIELD = {
  0x00:'str_table', 0x04:'ip', 0x20:'local_int', 0x24:'local_float', 0x28:'local_string',
  0x2C:'local_ptr', 0x30:'local_float_ptr', 0x38:'caller', 0x3C:'frame_arg',
  0x60:'arity', 0x70:'array_container',
};
const FRAMES_BASE = 0x5D894, FRAMES_STRIDE = 0x78;

// ---- 读取输入 ----
const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split(/\r?\n/);

const memberSet = new Set(fs.readFileSync(MEMBER_LIST, 'utf8')
  .split(/\r?\n/).map(s => s.trim())
  .filter(s => /^sub_[0-9A-Fa-f]{6}$/.test(s)));

let semTable = {};
try { semTable = JSON.parse(fs.readFileSync(SEM_TABLE, 'utf8')); } catch (e) { semTable = {}; }
delete semTable['//'];   // semantic_names.json 里的注释键

// ---- 解析 opcode-table.md：handler(子名) -> {opcode, status, name/sem} ----
const opByHandler = {};
try {
  const opTxt = fs.readFileSync(OP_TABLE, 'utf8').split(/\r?\n/);
  for (const ln of opTxt) {
    const m = /^\|\s*(0x[0-9A-Fa-f]+)\s*\|[^|]*\|([^|]*)\|\s*(sub_[0-9A-Fa-f]{6})\s*\|\s*([^|]*)\|/.exec(ln);
    if (m) opByHandler[m[3]] = { op: m[1], status: m[4].trim(), name: m[2].trim() };
  }
} catch (e) { /* ignore */ }

// 所有 opcode-table 里已映射的 handler 都是「明确已知 Engine 成员」：dispatch 表 this+0xA509C 分发，
// 必然以 Engine this 为接收者。libclang 检测种子（_this[K] 直达 Engine 顶层字段）会漏掉只经 helper
// 调用的 handler（如 random=sub_42CA50），故把 op 表 handler 并入染色成员集合。
for (const h of Object.keys(opByHandler)) memberSet.add(h);

// ===== 函数定义解析 =====
const CALL = /\b(__thiscall|__cdecl|__stdcall|__fastcall|__usercall)\b/;
function isProto(line) { return /;\s*$/.test(line.trim()); }

// 找函数定义: 返回 {name, startLine(0-based), sigEndLine, bodyOpenLine, endLine}
function parseDefinitions(lines) {
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (!CALL.test(t)) continue;        // 签名行必须含调用约定
    if (isProto(t)) continue;           // 排除原型
    // 函数名：sub_XXXXXX 或其它标识符（紧跟调用约定之后、左括号之前）
    const nm = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(t);
    if (!nm) continue;
    const name = nm[1];
    // 找开 body 的 '{'（可能在当前行或后续行，遇到 ';' 说明前一签名未结束则跳过）
    let bodyOpenLine = -1;
    for (let j = i; j < lines.length; j++) {
      const s = lines[j];
      if (bodyOpenLine < 0) {
        if (/\{/.test(s)) bodyOpenLine = j;
      }
      if (bodyOpenLine >= 0) break;
    }
    if (bodyOpenLine < 0) continue;
    // brace 匹配
    let depth = 0, endLine = -1, started = false;
    for (let j = bodyOpenLine; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; if (started && depth === 0) { endLine = j; break; } }
      }
      if (endLine >= 0) break;
    }
    if (endLine < 0) continue;
    defs.push({ name, startLine: i, bodyOpenLine, endLine });
    i = endLine;   // 跳过本函数
  }
  return defs;
}

const defs = parseDefinitions(lines);
console.log(`[memberize] parsed ${defs.length} function definitions`);

// ===== 变换辅助 =====
function semName(sub) {  // sub_41BF50 -> 'readIntOperand', '41BF50'
  if (!/^sub_[0-9A-Fa-f]{6}$/.test(sub)) return [null, sub];
  const addr = sub.slice(4);
  return [semTable[addr] || null, addr];
}
function memberBuildName(sub) {
  const [sem, addr] = semName(sub);
  return sem ? `${sem}_${addr}` : sub;
}

// 作用域限定替换：只替换「后面跟着 "(...)" 的 sub_<addr> / <sem>_<addr>」调用名
const semRenameMap = {};   // sub_<ADDR(大写)> -> <sem>_<addr>
for (const sub of memberSet) {
  const [sem, addr] = semName(sub);
  if (sem) semRenameMap['sub_' + addr.toUpperCase()] = `${sem}_${addr}`;
}

// 顶层字段：把 `_this[K]`（命中 Engine 顶层）-> `this->field`
function convTopField(body) {
  return body.replace(/\b_this\[\s*(\d+)\s*\]/g, (m, k) => {
    const field = ENGINE_DWORD[Number(k)];
    return field ? `this->${field}` : m;
  });
}
// 帧字段：`_this[30 * <cur> + K]` -> `this->frames[<cur>].field`
function convFrameField(body) {
  return body.replace(/_this\[\s*30\s*\*\s*([^\]\s]+)\s*\+\s*(\d+)\s*\]/g, (m, cur, k) => {
    const off = 4 * Number(k) - FRAMES_BASE;
    const fld = FRAME_FIELD[off];
    return fld ? `this->frames[${cur}].${fld}` : m;
  });
}
// 全局语义改名：裸 sub_<6hex> -> <sem>_<addr>（只命中独立 token，非 ::/成员前缀）
function convSemName(body) {
  return body.replace(/\bsub_([0-9A-Fa-f]{6})\b/g, (m, a) => semRenameMap['sub_' + a.toUpperCase()] || m);
}
// 成员调用：`<member>( (cast)?_this , rest)` -> `this-><member>(rest)`
function convMemberCall(body) {
  const memberNames = [...new Set(Array.from(memberSet).map(memberBuildName))].sort((a, b) => b.length - a.length);
  // 先按名字长度降序, 匹配 `<name>(\s*(?:\([^()]*\)\s*)?_this\s*,`
  let out = body;
  for (const nm of memberNames) {
    const re = new RegExp(
      '(?<![A-Za-z0-9_:])' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\(\\s*(?:\\([^()]*\\)\\s*)?_this\\s*,', 'g');
    out = out.replace(re, `this->${nm}(`);
  }
  return out;
}
// 签名改写：`RET __thiscall sub_<addr>(params)` -> `RET Engine::<name>(params)`
function convSignature(sig, sub) {
  const name = memberBuildName(sub);
  // 去掉 __thiscall 与结尾 '{'（可能单独一行或跟紧 ')'）。签名可能跨多行，用 [\s\S] 跨行匹配。
  let s = sig.replace(/\b__thiscall\b/g, '').replace(/\{\s*$/, '').trim();
  // s = "RET sub_XXXXXX( params )"（params 可含换行）
  const m = /^([\s\S]*?)\b(sub_[0-9A-Fa-f]{6})\s*\(([\s\S]*)\)\s*$/.exec(s);
  if (!m) return s;   // 不能解析则保留（去 thistcall/花括号后的形态）
  const ret = m[1].trim();
  const params = m[3].trim();
  return ret ? `${ret} Engine::${name}(${params})` : `Engine::${name}(${params})`;
}

// 逐成员做变换
const extracted = [];
const stats = { topField: 0, frameField: 0, memberCall: 0, semName: 0, memberRenamed: 0 };
for (const d of defs) {
  if (!memberSet.has(d.name)) continue;
  const start = d.startLine, end = d.endLine;
  let sigLines = lines.slice(start, d.bodyOpenLine + 1).join('\n');
  let bodyLines = lines.slice(d.bodyOpenLine + 1, end).join('\n');
  // 还原完整函数文本（签名+body），body 不含结束 '}'
  const bodyText = bodyLines;
  // 变换 body
  let b = bodyText;
  const beforeTop = b;
  b = convTopField(b);
  if (b !== beforeTop) stats.topField++;
  const beforeFr = b; b = convFrameField(b); if (b !== beforeFr) stats.frameField++;
  const beforeSem = b; b = convSemName(b); if (b !== beforeSem) stats.semName++;
  const beforeMC = b; b = convMemberCall(b); if (b !== beforeMC) stats.memberCall++;
  // body 前后的状态标记注释（若在函数之前有 /* ===== [x] ... ===== ）不动，这里只处理函数本身
  // 构成完整函数：签名(变换后) + '{' + 变换后 body + '}'
  const newSig = convSignature(sigLines, d.name);
  if (newSig !== sigLines) stats.memberRenamed++;
  const full = `${newSig}\n{\n${b}\n}\n`;
  extracted.push({ sub: d.name, full, rawStart: start + 1, rawEnd: end + 1 });
}

// ---- 状态标签：把 opcode-table 的分析状态映射为 skill 状态（已核对->ANALYZED 等）----
const STATUS_MAP = { '已核对': 'ANALYZED', '推测': 'STUB', '仅映射': 'UNKNOWN', '未解': 'UNKNOWN' };
function memberMarker(e) {
  const [sem, addr] = semName(e.sub);
  const op = opByHandler[e.sub] || null;
  const opTxt = op ? `op=${op.op}${op.name ? ' 指令名『' + op.name + '』' : ''}` : '';
  const statRaw = op ? op.status : '未解';
  const stat = STATUS_MAP[statRaw] || 'UNKNOWN';
  const eng = sem ? `${sem}_${addr}` : e.sub;
  // `状态:` 行不携带 →name（避免 scan-status 在同行找不到）；把 `→ name` 放到下一行注释，
  // 使 .agents/.../scripts/scan-status.js 的「向下扫 6 行找 → name」能命中叶子名。
  return `/* ===== [stained] ${e.sub}  状态: ${stat} =====\n` +
    ` * Engine 成员函数（染色依据 docs/re/engine/member_functions.detected.txt）  → ${eng}\n` +
    ` * raw 行区间 [${e.rawStart}, ${e.rawEnd}]${opTxt ? '; ' + opTxt : ''}\n` +
    ` * 已确证字段/帧访问改写为 this->；未确证 _this[...] 保留原样；体未读/未语义化函数仍未核对。\n */`;
}

// ---- 排序：保持 raw 行序 ----
extracted.sort((a, b) => a.rawStart - b.rawStart);

// ---- 写 engine-members.cpp ----
const hdr = fs.existsSync(EM_HDR) ? fs.readFileSync(EM_HDR, 'utf8') : '';
const out = hdr + '\n' +
  extracted.map(e => memberMarker(e) + '\n' + e.full).join('\n');
fs.writeFileSync(OUT_MEMBERS, out);

// ---- 写 member-index.json ----
const idx = extracted.map(e => {
  const [sem, addr] = semName(e.sub);
  const op = opByHandler[e.sub] || null;
  return {
    old: e.sub, new: memberBuildName(e.sub),
    sem: sem || null, addr,
    op: op ? op.op : null,
    status: op ? op.status : 'UNKNOWN',
    lines: [e.rawStart, e.rawEnd],
    isOpHandler: !!op,
  };
});
fs.writeFileSync(OUT_INDEX, JSON.stringify({ _comment: 'Engine 成员函数索引（染色）', funcs: idx }, null, 2));

console.log(`[memberize] members extracted=${extracted.length}`);
console.log(`[memberize] renamed=${stats.memberRenamed} topField=${stats.topField} frameField=${stats.frameField} semName=${stats.semName} memberCall=${stats.memberCall}`);
console.log(`[memberize] wrote ${OUT_MEMBERS} (${out.length} bytes) + ${OUT_INDEX}`);
