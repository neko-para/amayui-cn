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
const REG_PATH = path.join(ROOT, 'analysis-registry.json');   // 权威台账：已注册函数的 status 优先于 op-table

// ---- Engine 字段模型（字节偏移 -> 字段名；涵盖工程已确证 + 指令层新增字段，见 engine-refined/model/engine.hpp）----
const ENGINE_BYTE = {
  // 指令层明文引用的字段（来自 model/engine.hpp；头区散落字段带待确认）
  0x0: 'vftable',                                    // ctor 设 &Command___vftable_
  0x8: 'message_buf',                                  // _this + 8 (bit-set/random ShowMessage sprintf)
  0x5530: 'string_table_base',                          // _this + 5452(_DWORD*) (string-lookup-set)
  0x5D800: 'global_int_base', 0x5D808: 'global_float_base', 0x5D810: 'global_string_base',
  0x5D818: 'global_ptr_base', 0x5D820: 'global_float_ptr_base',
  0x5D860: 'script_state0', 0x5D864: 'script_state1', 0x5D868: 'script_state2',   // ctor 清零（待确认）
  0x5D870: 'script_state3', 0x5D874: 'script_state4', 0x5D878: 'script_state5',
  0x5D880: 'cur_script', 0x5D884: 'call_ret', 0x5D888: 'call_link', 0x5D88C: 'call_flag',
  0x5EC8C: 'key', 0x5EC90: 'enc_zero',                  // _this[97060]
  0x5EC94: 'kernel32_module', 0x5EC98: 'is_debugger_present',   // ctor 反调试初始化
  0x69330: 'counter',                                   // _this[107724] / *((_DWORD*)_this + 107724)
  0xA509C: 'dispatch',
};
const ENGINE_DWORD = {};           // dword 下标 -> field
for (const off of Object.keys(ENGINE_BYTE).map(Number))
  if (off % 4 === 0) ENGINE_DWORD[off / 4] = ENGINE_BYTE[off];
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
// 根据签名确定 `_this` 基址标度：_DWORD*/int*/unsigned*/long* 为 4（DWORD）；char*/int/void*/_BYTE* 为 1（字节）。
function _thisScale(sig) {
  const m = /\b((?:_DWORD|unsigned\s+int|int|long|char|void|unsigned\s+__int8|_BYTE)\s*\*?)\s*_this\b/.exec(sig);
  const t = (m ? m[1] : '').replace(/\s+/g, ' ');
  if (/(_DWORD|unsigned int|int|long)\s*\*/.test(t)) return 4;       // 指向 4 字节的指针 → DWORD
  return 1;                                                          // char*/int/void* → 字节
}
// 统一字段引用：把 `_this` 上的直接数值偏移访问改成 `this->field`（按 _this 标度 + 帧字段/解引用）。
function convFields(body, scale) {
  let out = body;
  // 1) *((_DWORD*)_this + K)：强转 _DWORD*，K 为 dword 下标 → 字段值
  out = out.replace(/\*\(\s*\(?\s*_DWORD\s*\*\)\s*_this\s*\+\s*(\d+)\s*\)/g, (m, k) => {
    const f = ENGINE_DWORD[Number(k)]; return f ? `this->${f}` : m;
  });
  // 2) *(_DWORD*)(_this + N)：解引用 _this+N → 字段值（_this 原生标度）
  out = out.replace(/\*\(\s*_DWORD\s*\*\)\s*\(\s*_this\s*\+\s*(\d+)\s*\)/g, (m, n) => {
    const f = ENGINE_BYTE[Number(n) * scale]; return f ? `this->${f}` : m;
  });
  // 2b) 偏移 0 解引用（vftable）：*(_DWORD *)_this → this->vftable
  out = out.replace(/\*\(\s*_DWORD\s*\*\)\s*_this\b(?!\s*\+)/g, 'this->vftable');
  // 3) dword 下标 _this[K]（把内层 _this[95776]/_this[97060] 等先转成 this->field）
  out = out.replace(/\b_this\[\s*(\d+)\s*\]/g, (m, k) => {
    const f = scale === 4 ? ENGINE_DWORD[Number(k)] : ENGINE_BYTE[Number(k)];
    return f ? `this->${f}` : m;
  });
  // 4) 裸 _this + N 作为字段基址（命中建模字段才改；避免破坏 5/6 的帧形式）
  out = out.replace(/\b_this\s*\+\s*(\d+)(?!\s*\*)/g, (m, n) => {
    const f = ENGINE_BYTE[Number(n) * scale]; return f ? `this->${f}` : m;
  });
  // 5) 帧字段（dword 下标形）：_this[30*<cur>+K]  → frames[cur].field
  out = out.replace(/_this\[\s*30\s*\*\s*([^\]\s]+)\s*\+\s*(\d+)\s*\]/g, (m, cur, k) => {
    const off = 4 * Number(k) - FRAMES_BASE; const f = FRAME_FIELD[off];
    return f ? `this->frames[${cur}].${f}` : m;
  });
  // 5b) 帧字段（字节下标形，char*/int 基址）：_this[120*<cur>+K]  → frames[cur].field
  out = out.replace(/_this\[\s*120\s*\*\s*([^\]\s]+)\s*\+\s*(\d+)\s*\]/g, (m, cur, k) => {
    const off = Number(k) - FRAMES_BASE; const f = FRAME_FIELD[off];
    return f ? `this->frames[${cur}].${f}` : m;
  });
  // 6) 帧字段（字节偏移形）：*(_DWORD*)(_this + 120*<cur> + <baseoff>)
  out = out.replace(/\*\(\s*_DWORD\s*\*\)\s*\(\s*_this\s*\+\s*120\s*\*\s*([^)]+?)\s*\+\s*(\d+)\s*\)/g, (m, cur, baseoff) => {
    const off = Number(baseoff) - FRAMES_BASE; const f = FRAME_FIELD[off];
    return f ? `this->frames[${cur}].${f}` : m;
  });
  // 7) 清理无效/重复 cast：*(_DWORD *)&this-><field> → this-><field>（&-deref 相抵）
  out = out.replace(/\*\(\s*_DWORD\s*\*\)\s*&\s*(this->[A-Za-z0-9_.\[\]]+)/g, '$1');
  return out;
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

// ---- 严格「已分析」判定：
//   一个函数**只有**满足：① 已读体并对字段建模（无未转换的 `_this[K]`/`_this+N` 直接数值偏移访问）
//   ② 只调用「已分析/已知原语」函数，才可标 ANALYZED；否则为 PARTIAL（需按流程建模字段/分析被调函数）。
//   「已知原语」= only 操作数读写文档化基础层（docs/re/engine/05-操作数访问原语.md 列出的 sub_41BF50/41C300/42B4B0/42BA00）。
//   其余 sub_42AEA0(operandAddress)/sub_418B90/sub_418CC0/sub_41B640/sub_42A420/sub_433310/sub_42AA90/sub_40C210/
//   sub_408050/sub_418A30/sub_418AE0 等为**未分析/未文档化**的实现助手：调用它们的函数**不得**标 ANALYZED。
const KNOWN_BASIS = new Set([
  'sub_41BF50', 'sub_41C300', 'sub_42B4B0', 'sub_42BA00',  // readInt/readFloat/writeInt/writeFloat（文档化基准）
]);
// 读 op-records.json（已移除；若存在则用于把「操作数角色/evidence」写进标记，缺省不影响字段转换/染色）。
const OP_REC_PATH = path.join(__dirname, 'op-records.json');
let opRec = {};
try {
  if (fs.existsSync(OP_REC_PATH)) {
    const rr = JSON.parse(fs.readFileSync(OP_REC_PATH, 'utf8'));
    for (const o of (rr.ops || [])) if (o.handler) opRec[o.handler] = o;
  }
} catch (e) { opRec = {}; }
// 判断「未转换的数值偏移字段访问」（用**转换后** body：已建模的 this->field 不算）。
// 只要仍出现 `_this[...]` / `_this + <offset>`（含 `*(_DWORD*)_this + …`、`*((_DWORD*)_this + …`）这类
// 直接以引擎对象为基址的偏移访问，即为「未建模字段」。
function fieldUnclean(convBody) {
  if (/\b_this\s*\[/.test(convBody)) return true;        // _this[ 任何下标
  if (/\b_this\s*\+/.test(convBody)) return true;        // _this + offset（含子对象指针偏移）
  if (/\bthis\s*\[/.test(convBody)) return true;         // this[ 未成员化
  return false;
}
// 未知被调函数（用**原始** body：未改名者仍是 sub_<hex>；命中 KNOWN_BASIS/已记录 handler 不算）
function unknownCallees(rawBody) {
  const calls = new Set(rawBody.match(/sub_[0-9A-Fa-f]{6}(?=\s*\()/g) || []);
  return [...calls].filter(c => !KNOWN_BASIS.has(c) && !(c in opRec));
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
  const scale = d.name.startsWith('sub_') ? _thisScale(sigLines) : 4;   // 按 _this 形参类型定标度
  const beforeTop = b;
  b = convFields(b, scale);
  if (b !== beforeTop) stats.topField++;
  const beforeSem = b; b = convSemName(b); if (b !== beforeSem) stats.semName++;
  const beforeMC = b; b = convMemberCall(b); if (b !== beforeMC) stats.memberCall++;
  // body 前后的状态标记注释（若在函数之前有 /* ===== [x] ... ===== ）不动，这里只处理函数本身
  // 构成完整函数：签名(变换后) + '{' + 变换后 body + '}'
  const newSig = convSignature(sigLines, d.name);
  if (newSig !== sigLines) stats.memberRenamed++;
  const full = `${newSig}\n{\n${b}\n}\n`;
  // 未转换字段的样例（用于 PARTIAL 注释提示）
  const fSnip = (b.match(/_this\s*\[\s*\d+\s*\]|_this\s*\+\s*\d+/) || [null])[0];
  extracted.push({
    sub: d.name, full, rawStart: start + 1, rawEnd: end + 1,
    fieldUnclean: fieldUnclean(b), unknownCallees: unknownCallees(bodyText), fieldSnippet: fSnip,
  });
}

// ---- 状态标签：台账(analysis-registry.json)已注册函数的 status 优先，其次 opcode-table 状态映射 ----
const STATUS_MAP = { '已核对': 'ANALYZED', '推测': 'STUB', '仅映射': 'UNKNOWN', '未解': 'UNKNOWN' };
// 读台账 old(sub_XXX) -> status；台账里已 ANALYZED 的（读体核对过）覆盖 op-table 的「仅映射/推测」。
let regStatus = {};
try {
  const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
  for (const f of (reg.funcs || [])) if (f.old) regStatus[f.old] = f.status;
} catch (e) { regStatus = {}; }
// 严格状态：已读体(有 conclusion) + 字段干净 + 只调已知原语 → ANALYZED；否则有结论但遗留 → PARTIAL；无结论 → UNKNOWN。
function computeStatus(e) {
  const op = opByHandler[e.sub] || null;
  const statRaw = op ? op.status : '未解';
  let stat = STATUS_MAP[statRaw] || 'UNKNOWN';
  if (regStatus[e.sub] === 'ANALYZED') stat = 'ANALYZED';
  const readBody = !!(opRec[e.sub] && opRec[e.sub].effect);
  const unknown = (e.unknownCallees || []).length;
  if (readBody && (e.fieldUnclean || unknown)) return 'PARTIAL';
  if (readBody) return 'ANALYZED';
  if (stat === 'ANALYZED' && e.fieldUnclean) return 'PARTIAL';
  if (stat === 'ANALYZED' && unknown) return 'PARTIAL';
  return stat;
}
function memberMarker(e) {
  const [sem, addr] = semName(e.sub);
  const op = opByHandler[e.sub] || null;
  const opTxt = op ? `op=${op.op}${op.name ? ' 指令名『' + op.name + '』' : ''}` : '';
  const stat = computeStatus(e);
  const eng = sem ? `${sem}_${addr}` : e.sub;
  const rec = opRec[e.sub];
  const readBody = !!(rec && rec.effect);
  const hasLeftField = e.fieldUnclean === true;
  const unknown = (e.unknownCallees || []).slice(0, 8);
  // 分析结论 / 待办注释
  let note;
  if (readBody) {
    const typ = (rec.operands || []).map(o => o[1]).join('/');
    const base = `分析结论（已读体）: ${rec.effect}${typ ? `; 操作数类型=${typ}` : ''}; decEnc=${rec.decEnc}; pure=${rec.pure}`;
    if (hasLeftField) {
      note = base + '\n * ⚠ 未建模字段: 仍有 ' + (e.fieldSnippet || '_this[K]') +
        ' 这类 _this[K] / _this+N 直接偏移；按流程「建模 engine.hpp 字段 → 改为 this->field」后方可标已分析';
    } else if (unknown.length) {
      note = base + '\n * ⚠ 未分析被调: ' + unknown.join(', ') + '；分析这些函数后方可标已分析';
    } else {
      note = base;
    }
  } else if (stat === 'PARTIAL') {
    // 未在 op-records（无子代理读体结论）但 op-table 已核对；若严格门未通过则说明原因
    if (hasLeftField) {
      note = '逻辑已核对，但仍有未建模字段(' + (e.fieldSnippet || '_this[K]') +
        ')；建模 engine.hpp 字段后方可标已分析';
    } else if (unknown.length) {
      note = '逻辑已核对，但仍有未分析被调(' + unknown.join(', ') + ')；分析后方可标已分析';
    } else {
      note = '逻辑已核对，但未满足“无未命名字段 + 无未分析被调”的完整分析条件';
    }
  } else if (stat === 'STUB') {
    note = '桩/简化：未逆清完整语义（可按 STUB 处理）';
  } else if (stat === 'UNKNOWN') {
    note = '未读体/未语义化；`_this[...]` 未确证字段保留原样、未改名';
  } else {
    note = '逻辑已核对（详见 docs-new/03-engine/opcode-table.md）';
  }
  // `状态:` 行不携带 →name（避免 scan-status 在同一行找不到）；把 `→ name` 放到下一行注释，
  // 使 .agents/.../scripts/scan-status.js 的「向下扫 6 行找 → name」能命中叶子名。
  return `/* ===== [stained] ${e.sub}  状态: ${stat} =====\n` +
    ` * Engine 成员函数  → ${eng}\n` +
    ` * raw 行区间 [${e.rawStart}, ${e.rawEnd}]${opTxt ? '; ' + opTxt : ''}\n` +
    ` * ${note}\n */`;
}

// ---- 排序：保持 raw 行序 ----
extracted.sort((a, b) => a.rawStart - b.rawStart);

// ---- 写 engine-members.cpp ----
const hdr = fs.existsSync(EM_HDR) ? fs.readFileSync(EM_HDR, 'utf8') : '';
const out = hdr + '\n' +
  extracted.map(e => memberMarker(e) + '\n' + e.full).join('\n');
fs.writeFileSync(OUT_MEMBERS, out);

// ---- member-index.json 已移除（结论以代码注释为准；不再生成该临时索引）----
console.log(`[memberize] members extracted=${extracted.length}`);
console.log(`[memberize] renamed=${stats.memberRenamed} topField=${stats.topField} frameField=${stats.frameField} semName=${stats.semName} memberCall=${stats.memberCall}`);
console.log(`[memberize] wrote ${OUT_MEMBERS} (${out.length} bytes) + ${OUT_INDEX}`);
