#!/usr/bin/env node
/** 统计"原始引擎 vs 精修副本"的改动进度。纯 Node（跨 Win/macOS/Linux，不依赖 bash/awk）。
 *  优先用 git diff --no-index --numstat（git 跨平台可用）；git 不可用则退回"逐行对比"。
 *  用法：node diff-refined.js [engine_dir] [refined_dir]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ENGINE = process.argv[2] || 'engine';
const REFINED = process.argv[3] || 'engine-refined';

function findC(dir) {
  // 原始为 Hex-Rays .c（只读参考）；精修产物为 .cpp（C++ 风格）——两者都要认。
  const f = fs.readdirSync(dir).find((x) => /\.(c|cpp)$/i.test(x));
  if (!f) throw new Error(`${dir} 下找不到 .c/.cpp 文件`);
  return path.join(dir, f);
}

const src = findC(ENGINE);
const dst = findC(REFINED);

// ---- 优先 git diff --no-index --numstat ----
function gitNumstat(a, b) {
  try {
    return execFileSync('git', ['diff', '--no-index', '--numstat', a, b], { encoding: 'utf8' });
  } catch (e) {
    // git diff --no-index 在"有差异"时返回非 0；输出仍在 e.stdout
    return e && e.stdout ? e.stdout : '';
  }
}

const numstat = gitNumstat(src, dst);
if (numstat.trim()) {
  console.log(`# 已改动（git diff --no-index）`);
  for (const line of numstat.trim().split(/\r?\n/)) {
    const [add, del, file] = line.split(/\t/);
    console.log(`  +${add || 0} / -${del || 0}  ${file ? path.basename(file) : ''}`);
  }
} else {
  // ---- 退回：逐行对比（粗略：仅行数差异）----
  const A = fs.readFileSync(src, 'utf8').split(/\r?\n/);
  const B = fs.readFileSync(dst, 'utf8').split(/\r?\n/);
  console.log(`# git 不可用，做行数对比`);
  console.log(`  原始 ${A.length} 行 / 精修 ${B.length} 行（+${Math.max(0, B.length - A.length)} / -${Math.max(0, A.length - B.length)}）`);
}
