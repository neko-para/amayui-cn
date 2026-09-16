#!/usr/bin/env node
// check-skeleton.mjs —— **骨架棘轮**：`src/*.txt` 的控制行序列必须与 `data/*.txt` 基线逐行一致。
//
// 为什么需要它（2026-09 的事故）：opcode 改名/补语义时 `data/` 会被**重新反汇编**（例如
// `menu-bind`/`menu-dispatch` 的操作数改成 label 引用后，反汇编会额外产出 `label_00000370` 这类
// **定义行**）。如果 `src/` 不跟着同步，那些 `label_*` 引用就变成悬空的 ⇒ `translate.js assemble`
// 报「骨架行数变化」/「Unknown label reference」，而**这些脚本的汉化 BIN 就悄悄停在旧版**
// （实测中招：`BTL / FIELD / HISTORY / MENU / SELBOMB / TITLE` 六个）。
//
// 判据与 `translate.js` 的骨架语义一致：剥掉 `/* */` 块注释、`//` 行注释与可增删改的文本行
// （`set-string/show-text/display-furigana/concat/end-text-line/draw-string`）后，剩下的控制行
// 必须**逐行相同**（顺序、数量、内容）。文本行（译文）不参与比较，所以翻译可以自由增删改。
//
// 用法：
//   node check-skeleton.mjs            # 全量检查（默认，失败 exit 1）
//   node check-skeleton.mjs --ids MENU,TITLE   # 只看指定脚本（快速定位）

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, SRC_DIR, DATA_DIR } from './config.js';

const TEXT_INSTR = /^(set-string|show-text|display-furigana|concat|end-text-line|draw-string)\b/;

/** 控制行序列（与 `translate.js` 的 skeleton 同语义）。 */
function skeleton(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const t = raw.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('*/') || t.startsWith('//')) continue;
    if (TEXT_INSTR.test(t)) continue;
    if (t === '') continue;
    out.push(t.replace(/\s*\/\/.*$/, '').trim());
  }
  return out;
}

const argv = process.argv.slice(2);
const idsArg = argv.includes('--ids') ? argv[argv.indexOf('--ids') + 1] : null;
const ids = (idsArg ? idsArg.split(',') : fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.slice(0, -4))
).sort();

let ok = 0;
const failures = [];
for (const id of ids) {
  const srcPath = path.join(SRC_DIR, `${id}.txt`);
  const dataPath = path.join(DATA_DIR, `${id}.txt`);
  if (!fs.existsSync(srcPath)) {
    failures.push(`${id}: src 不存在（${srcPath}）`);
    continue;
  }
  if (!fs.existsSync(dataPath)) {
    console.log(`[skip] ${id}: 无 data 基线`);
    continue;
  }
  const a = skeleton(fs.readFileSync(dataPath, 'utf8'));
  const b = skeleton(fs.readFileSync(srcPath, 'utf8'));
  let firstDiff = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff < 0) {
    ok++;
    continue;
  }
  failures.push(
    `${id}: 骨架不一致（基线 ${a.length} → 当前 ${b.length}）\n` +
      `    首个差异 #${firstDiff}\n      基线: ${a[firstDiff] ?? '<无>'}\n      当前: ${b[firstDiff] ?? '<无>'}`,
  );
}

console.log(`=== 骨架棘轮 ===`);
console.log(`一致: ${ok}/${ids.length}`);
if (failures.length) {
  console.log('\n不一致（src 必须与 data 基线的控制行逐行相同；译文行不参与比较）：');
  for (const f of failures) console.log(' ', f);
  console.log(
    '\n修法：把 data 里新增/改名的**控制行**（常见是 `label_*` 定义行）补回 src，' +
      '**不要**用 `sync-data-to-src.js --apply` 覆盖（那会丢译文）。',
  );
  process.exit(1);
}
console.log('全部一致 ✓');
