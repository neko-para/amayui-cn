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
 *   - 成员索引：engine-refined/member-index.json（每成员 lines=[rawStart,rawEnd] 1-based 函数定义区间）
 * 输出：
 *   - engine-refined/remaining-code.cpp（行数与原始一致；成员函数定义区间整行替换为空行）
 *
 * 用法：node scripts/engine-refined/remaining.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'engine', '天结_unpacked.exe_utf8.c');
const INDEX = path.join(ROOT, 'engine-refined', 'member-index.json');
const OUT = path.join(ROOT, 'engine-refined', 'remaining-code.cpp');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8')).funcs;

// 收集要置空的 1-based 行区间（[start,end] 闭区间）
const ranges = idx.map(f => f.lines).filter(r => Array.isArray(r) && r.length === 2 && r[0] > 0);
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
