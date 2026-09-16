#!/usr/bin/env node
// resync-control-lines.mjs —— 把 `data/` 基线里**新增的控制行**插回 `src/`，**保留译文**。
//
// 为什么需要它（与 `sync-data-to-src.js` 的分工）：
//   - `check-skeleton.mjs`（棘轮）判定"src 的控制行序列 == data 基线"，不一致就红；
//   - `sync-data-to-src.js --apply` 的修法是"骨架不一致 ⇒ **整文件用 data 重置**" ⇒ **会丢译文**；
//   - 本工具是那条缺的中间路：只把 data 里多出来的控制行（当前全是 `label_*` 定义行 —— opcode 改名/
//     补语义后 data 重新反汇编会新增它们）按位置插进 src，文本行（译文）一个都不动。
//
// 前提（不满足就拒绝改，避免瞎猜）：src 的控制行序列必须是 data 的**子序列**，且所有缺失行都形如
// `label_<hex>`。满足时插入位置唯一 ⇒ 插完 `translate.js assemble` 的骨架校验必然通过（那是判据）。
//
// 用法：
//   node resync-control-lines.mjs                      # 只报告（默认，不写盘）
//   node resync-control-lines.mjs --apply              # 实际写盘
//   node resync-control-lines.mjs --ids MENU,TITLE --apply   # 指定脚本

import fs from 'node:fs';
import path from 'node:path';
import { SRC_DIR, DATA_DIR } from './config.js';

const TEXT_INSTR = /^(set-string|show-text|display-furigana|concat|end-text-line|draw-string)\b/;
const LABEL_ONLY = /^label_[0-9a-f]+$/;

/** 控制行序列（与 `translate.js` 的 skeleton 同语义），带原行号。 */
function controls(lines) {
  const out = [];
  let inBlock = false;
  lines.forEach((raw, idx) => {
    const t = raw.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      return;
    }
    if (t.startsWith('*/') || t.startsWith('//')) return;
    if (TEXT_INSTR.test(t)) return;
    if (t === '') return;
    out.push({ idx, text: t.replace(/\s*\/\/.*$/, '').trim() });
  });
  return out;
}

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const idsArg = argv.includes('--ids') ? argv[argv.indexOf('--ids') + 1] : null;
const ids = (idsArg
  ? idsArg.split(',')
  : fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4))
).sort();

let changed = 0;
let pending = 0;
let skipped = 0;
for (const id of ids) {
  const srcPath = path.join(SRC_DIR, `${id}.txt`);
  const dataPath = path.join(DATA_DIR, `${id}.txt`);
  if (!fs.existsSync(srcPath) || !fs.existsSync(dataPath)) continue;
  const srcText = fs.readFileSync(srcPath, 'utf8');
  const eol = srcText.includes('\r\n') ? '\r\n' : '\n';
  const srcLines = srcText.split(/\r\n|\r|\n/);
  const dc = controls(fs.readFileSync(dataPath, 'utf8').split(/\r\n|\r|\n/));
  const sc = controls(srcLines);

  // 贪心对齐：data 里没被 src 匹配上的控制行 = 缺失行（插入点 = src 下一个未匹配控制行之前）
  const inserts = [];
  let j = 0;
  for (const d of dc) {
    if (j < sc.length && sc[j].text === d.text) {
      j++;
      continue;
    }
    inserts.push({ beforeSrcLine: j < sc.length ? sc[j].idx : srcLines.length, text: d.text });
  }
  const subsequence = j === sc.length;
  const nonLabel = inserts.filter((i) => !LABEL_ONLY.test(i.text));
  if (!inserts.length) continue;
  if (!subsequence || nonLabel.length) {
    skipped++;
    console.log(
      `[skip] ${id}: 需要人工判断（src 控制行不是 data 的子序列=${!subsequence}，` +
        `非 label 缺失=${nonLabel.length}${nonLabel.length ? `：${nonLabel.map((i) => i.text).join(' / ')}` : ''}）`,
    );
    continue;
  }
  pending++;
  console.log(`${APPLY ? '[fix ]' : '[plan]'} ${id}: +${inserts.length} 行（${inserts.map((i) => i.text).join(', ')}）`);
  if (!APPLY) continue;
  inserts.sort((a, b) => b.beforeSrcLine - a.beforeSrcLine); // 从后往前插，行号不失效
  for (const ins of inserts) srcLines.splice(ins.beforeSrcLine, 0, ins.text);
  fs.writeFileSync(srcPath, srcLines.join(eol), 'utf8');
  changed++;
}

console.log(
  APPLY
    ? `\n=== 已写入 ${changed} 个脚本（跳过 ${skipped}）===\n判据：cd scripts && npm run check-skeleton && npm test`
    : `\n=== 计划：${pending} 个脚本待补控制行（跳过 ${skipped}）=== 加 --apply 写盘`,
);
