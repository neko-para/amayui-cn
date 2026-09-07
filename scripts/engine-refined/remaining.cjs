#!/usr/bin/env node
/**
 * remaining.cjs — 生成「剩余代码」文件：原始反编译里**已提取到 engine-members.cpp 的 Engine 成员函数**
 * 用空行替换（保持行号与原始一致，便于映射回原始），其余未提取的代码保留。
 *
 * 需求（用户）：
 *   - 除基线（engine/天结_unpacked.exe_utf8.c 与其逐字节副本 天结_unpacked.exe_utf8.cpp）外，
 *     每段代码只出现在一处：Engine 成员函数 → engine-members.cpp；其余 → 本文件。
 *   - 已提取的成员函数从剩余代码中「移除」（用空行占位，行对应关系不变）。
 *
 * 输入：
 *   - 原始反编译：engine/天结_unpacked.exe_utf8.c（行号权威基准）
 *   - 成员函数行区间：改由 engine-refined/engine/*.cpp 的 `[stained]…raw 行区间 [s,e]` 标记解析
 *     （原 member-index.json 已移除；结论以代码注释为准，不再依赖临时索引）。
 * 输出：
 *   - engine-refined/remaining-code.cpp（行数与原始一致；成员函数定义区间整行替换为空行）
 *
 * 用法：node scripts/engine-refined/remaining.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'engine', '天结_unpacked.exe_utf8.c');
const OUT = path.join(ROOT, 'engine-refined', 'remaining-code.cpp');
const MEM_DIR = path.join(ROOT, 'engine-refined', 'engine');
const MEM_FILES = ['arith-ops.cpp','bit-ops.cpp','float-ops.cpp','str-ops.cpp','memory-ops.cpp','members.cpp'];

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

// 从 engine/*.cpp 的 [stained] 标记解析成员函数 raw 行区间（1-based [s,e] 闭区间）
const ranges = [];
for (const mf of MEM_FILES) {
  const p = path.join(MEM_DIR, mf);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  for (const m of txt.matchAll(/\[stained\]\s*sub_[0-9A-Fa-f]{6}[\s\S]*?raw\s+行区间\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/g)) {
    ranges.push([Number(m[1]), Number(m[2])]);
  }
}

// 收集要置空的 1-based 行区间（[start,end] 闭区间）
let blanked = 0, blankedLines = 0;
for (const [s, e] of ranges) {
  for (let ln = s - 1; ln < e; ln++) {     // 转 0-based
    if (lines[ln] !== '') { blankedLines++; }
    lines[ln] = '';
  }
  blanked++;
}

// 保持与原始完全一致的行对应：split 后末元素为空（原文件以换行结尾），join('\n') 即自动保留尾换行，
// 不要再额外加 '\n'，否则多一行。
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`[remaining] functions blanked=${blanked}  blankedLines=${blankedLines}  outElements=${lines.length}`);
console.log(`[remaining] wrote ${OUT}`);
