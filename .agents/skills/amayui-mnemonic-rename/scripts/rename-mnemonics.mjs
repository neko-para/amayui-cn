#!/usr/bin/env node
/**
 * rename-mnemonics.mjs —— 机械替换 src/、data/ 下 *.txt 里的指令助记符（词边界）。
 * 用于 opcode 改名后同步工作副本：不改文档/JSON，只改脚本文本里的助记符 token。
 *
 * 用法：
 *   node scripts/rename-mnemonics.mjs --from i1a2 --to save-int \
 *        --from string-lookup-set --to load-int \
 *        --from i1a9 --to save-string --from i1aa --to load-string
 *   （默认根目录 src/ 与 data/；可用 --roots src,data 指定）
 *
 * 安全性：
 *  - 词边界 \b 匹配，避免子串误伤（i1a2 不会命中 i1a20；string-lookup-set 是整词）。
 *  - 每处命中恰好替换一次；最后打印文件数与总替换数，便于与 grep 计数核对。
 *  - 仅处理 .txt；其它文件（.json/.md/二进制）本脚本不动。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const pairs = [];
let roots = ['src', 'data'];
let curOld = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--from') { curOld = argv[i + 1]; i += 1; }
  else if (argv[i] === '--to') { if (curOld != null) pairs.push([curOld, argv[i + 1]]); curOld = null; i += 1; }
  else if (argv[i] === '--roots') { roots = argv[i + 1].split(',').filter(Boolean); i += 1; }
}
if (pairs.length === 0) {
  console.error('用法: node scripts/rename-mnemonics.mjs --from <旧> --to <新> [--from <旧> --to <新> ...] [--roots src,data]');
  process.exit(1);
}
const MAP = pairs; // [[old,new],...]
const toks = MAP.map(([t]) => t).filter(Boolean);
const RE = new RegExp('\\b(' + toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'g');

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let total = 0;
const per = [];
for (const root of roots) {
  const dir = path.resolve(root);
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    if (!file.endsWith('.txt')) continue;
    const txt = fs.readFileSync(file, 'utf8');
    let n = 0;
    const out = txt.replace(RE, (m) => {
      const hit = MAP.find(([t]) => t === m);
      if (!hit) return m;
      n++;
      return hit[1];
    });
    if (n > 0) {
      fs.writeFileSync(file, out, 'utf8');
      per.push([path.relative(process.cwd(), file), n]);
    }
    total += n;
  }
}
console.log(`替换完成 文件数=${per.length} 总替换=${total}`);
for (const [f, n] of per.slice(0, 12)) console.log(`  ${f}  (${n})`);
if (per.length > 12) console.log(`  … 共 ${per.length} 个文件`);
