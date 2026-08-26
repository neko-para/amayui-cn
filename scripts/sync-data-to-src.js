#!/usr/bin/env node
// sync-data-to-src.js
// 将 data/ 下所有脚本同步到 src/：
//   - src 存在且与 data 骨架(同构)一致 -> 跳过
//   - src 不存在 或 骨架不一致        -> 记录并覆盖(用 data 重置为基线)
//
// “同构”判定复用 translate.js 的骨架(skeleton)语义：
//   剥掉 /* */ 块注释、// 行注释，以及可增删改的文本行
//   (set-string/show-text/display-furigana/concat/end-text-line/draw-string)
//   之后，剩余的控制行必须与 data 基线逐字节一致。
//
// 用法:
//   node scripts/sync-data-to-src.js          # 仅计划(不写盘)，结果记录到 .tmp
//   node scripts/sync-data-to-src.js --apply  # 实际写盘(创建缺失/覆盖不同构)
//
// 安全说明: 覆盖会丢失被覆盖 src 里的翻译。只有“骨架不同构”(控制行被改动/缺失)才覆盖；
//          正常翻译过的 src 骨架与 data 一致，会被跳过。

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, SRC_DIR } from './config.js';

const DATA_DIR = path.join(ROOT_DIR, 'data');
const RECORD = path.join(ROOT_DIR, '.tmp', 'sync-data-to-src-record.txt');

const APPLY = process.argv.includes('--apply');

// 与 translate.js 一致的可增删改文本内容行；end-text-line 为视觉行结束，可按排版自由增删
const TEXT_INSTR = /^(set-string|show-text|display-furigana|concat|end-text-line|draw-string)\b/;

// 骨架：去掉 /* */ 块注释、// 行注释、文本行与空行后留下的控制行序列
function skeletonFromText(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const out = [];
  let inBlock = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;   // 块注释到此结束
      continue;
    }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue; }
    if (t.startsWith('*/')) continue;          // 防御
    if (t.startsWith('//')) continue;          // 行注释
    if (TEXT_INSTR.test(t)) continue;          // 文本内容行(可增删改)
    if (t === '') continue;
    out.push(t);                               // 控制行
  }
  return out;
}

function arrayEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------- 主流程 ----------
fs.mkdirSync(path.dirname(RECORD), { recursive: true });

const dataFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.txt')).sort();
const recordLines = [];
let skipped = 0, created = 0, overwritten = 0;

for (const name of dataFiles) {
  const dataText = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
  const dataSkel = skeletonFromText(dataText);
  const srcPath = path.join(SRC_DIR, name);
  const srcExists = fs.existsSync(srcPath);

  let action;
  if (srcExists) {
    const srcSkel = skeletonFromText(fs.readFileSync(srcPath, 'utf8'));
    if (arrayEqual(srcSkel, dataSkel)) {
      skipped++;                                    // 同构 -> 跳过
      continue;
    }
    action = 'OVERWRITE';
    recordLines.push(`${action}\t${name}`);
    overwritten++;
  } else {
    action = 'CREATE';
    recordLines.push(`${action}\t${name}`);
    created++;
  }

  if (APPLY) {
    fs.writeFileSync(srcPath, dataText, 'utf8');   // 用 data 基线覆盖/创建 src
  }
}

// 记录(无论是否 APPLY 都写)
fs.writeFileSync(RECORD, recordLines.join('\n') + (recordLines.length ? '\n' : ''), 'utf8');

console.log(`data 脚本总数: ${dataFiles.length}`);
console.log(`  同构(src 已一致，跳过)      : ${skipped}`);
console.log(`  创建(src 缺失)             : ${created}`);
console.log(`  覆盖(src 骨架不同构)       : ${overwritten}`);
console.log(`  需要动作者合计             : ${created + overwritten}${APPLY ? '（已写盘）' : '（仅计划；加 --apply 实际写盘）'}`);
console.log(`记录文件: ${RECORD}`);

if (overwritten && !APPLY) {
  console.log('\n[注意] 有将被覆盖(非新创建)的 src，可能丢失其中的翻译；请先核对记录文件，再决定是否 --apply。');
}
