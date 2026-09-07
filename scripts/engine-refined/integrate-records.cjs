#!/usr/bin/env node
/**
 * integrate-records.cjs — 把任务B（纯数值/字符串 op 接口分析）产物整合进台账与语义名表。
 *   输入：
 *     - scripts/engine-refined/op-records.json             { "_comment":..., "ops":[ ... ] }
 *     - scripts/engine-refined/op-semantic-suggestions.json { "ADDR": "op_xxx", ... }
 *   输出：
 *     - analysis-registry.json      追加每个确证纯操作的条目(若尚未登记)
 *     - scripts/re/semantic_names.json  并入语义名建议(若该 addr 尚未命名)
 * 幂等：已存在的 op/old 不复写。用法：node scripts/engine-refined/integrate-records.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const REG = path.join(ROOT, 'analysis-registry.json');
const NAME = path.join(ROOT, 'scripts', 're', 'semantic_names.json');
const REC = path.join(__dirname, 'op-records.json');
const SUG = path.join(__dirname, 'op-semantic-suggestions.json');

const STATUS_MAP = { ANALYZED: 'ANALYZED', PARTIAL: 'PARTIAL', STUB: 'STUB', UNKNOWN: 'UNKNOWN' };

function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }

let reg = readJSON(REG, { _comment: '', funcs: [] });
if (!reg.funcs) reg.funcs = [];
const haveRegOp = new Set(reg.funcs.map(f => f.op).filter(Boolean));

const recs = readJSON(REC, { ops: [] }).ops || [];
let addedReg = 0;
for (const op of recs) {
  // 状态=分析进度：读了体并确认语义(string 非空 effect) => ANALYZED；
  // 明确「未读体/仅凭名称」=> UNKNOWN；否则用 refinedStatus（op-table 映射）。
  const notRead = /未读体|仅凭名称|未读/.test((op.note || '') + (op.effect || ''));
  let st;
  if (notRead) st = 'UNKNOWN';
  else if (op.effect) st = 'ANALYZED';
  else st = op.pure ? 'ANALYZED' : 'UNKNOWN';
  const entry = {
    old: op.handler, new: op.name, op: op.opcode, status: st,
    lines: op.lines || [null, null], evidence: op.evidence || '',
    notes: op.effect || '',
    pure: op.pure === true,           // 附加字段：是否纯数值/字符串操作
    decEnc: op.decEnc === true,       // 操作数是否经 DEC/ENC 混淆
  };
  if (entry.notes.includes('未读体') || entry.notes.includes('仅凭名称')) entry.status = 'UNKNOWN';
  if (haveRegOp.has(op.opcode)) continue;
  reg.funcs.push(entry); addedReg++;
}
fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
console.log(`[integrate] registry: added ${addedReg} op entries (total ${reg.funcs.length})`);

// 语义名并入
let names = readJSON(NAME, {});
const sug = readJSON(SUG, {});
let addedName = 0;
for (const [addr, nm] of Object.entries(sug)) {
  if (!addr || addr === '//') continue;
  if (!names[addr]) { names[addr] = nm; addedName++; }
}
fs.writeFileSync(NAME, JSON.stringify(names, null, 2) + '\n');
console.log(`[integrate] semantic_names: merged ${addedName} names (total ${Object.keys(names).length})`);
