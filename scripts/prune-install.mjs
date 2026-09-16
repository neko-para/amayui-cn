#!/usr/bin/env node
// prune-install.mjs —— 全量构建之后，把 `install/` 收回"补丁树应有的样子"。
//
// 背景：`translate.js assemble`（全量）会把 **941 个 src 脚本全部**编进 `install/` 根，但安装树里
// 应该只留**真正被本地化过**的那些 —— 其余脚本编出来的 BIN 与原版逐字节等价（控制行有骨架棘轮保证，
// 译文为 0），装上去只是让树/打补丁清单变脏。本工具按两条判据收回：
//
//   保留：① `install-manifest.json` 里收录的（= 之前已经进过安装树的：原版松散文件 + 已本地化的脚本）
//         ② 或者 `src/<ID>.txt` **有译文**（`@"..."` / `"原文|译文"`；全量构建日志里的 `回读 N/M` 的 M）
//   清理：清单没收录 **且** 没有译文 ⇒ 纯重建产物，删掉（行为等价：引擎会回落到 ALF 里的同名原版）
//
// 另外 `--restore-agf`：清单里缺的 `*.AGF` overlay 从 `res/images/` 复制（那里是 AGF 成品的真源；
// 安装目标仍然是 install 根，**不是** DATA1 —— 见 `docs-new/00-overview/conventions.md` §3.1）。
//
// 用法：
//   node prune-install.mjs                    # 只报告（默认，不删不拷）
//   node prune-install.mjs --apply            # 删除"清单外且无译文"的 BIN
//   node prune-install.mjs --apply --restore-agf   # 顺带把 res/images 里的 AGF 补进 install 根

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, SRC_DIR, INSTALL_DIR, RES_DIR, INSTALL_MANIFEST } from './config.js';

const LITERAL_RE = /(@?)"([^"]*)"/g;
const PAIR_SEP = '|';
const APPLY = process.argv.includes('--apply');
const RESTORE_AGF = process.argv.includes('--restore-agf');

/** `src/<ID>.txt` 的译文条数（与 `translate.js` 的口径一致：`@` 标记 或 `原文|译文` 对）。 */
function translatedCount(id) {
  const p = path.join(SRC_DIR, `${id}.txt`);
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf8');
  const seen = new Set();
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;
    for (const m of line.matchAll(LITERAL_RE)) {
      const at = m[1];
      const content = m[2];
      if (at === '@') seen.add(content);
      else if (content.includes(PAIR_SEP)) {
        const trans = content.slice(content.indexOf(PAIR_SEP) + 1);
        if (trans) seen.add(trans);
      }
    }
  }
  return seen.size;
}

if (!fs.existsSync(INSTALL_MANIFEST)) {
  console.error(`[FAIL] 缺 install 清单：${INSTALL_MANIFEST}（先 npm run manifest）`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(INSTALL_MANIFEST, 'utf8'));
const listed = manifest.files ?? {};
const listedLow = new Set(Object.keys(listed).map((k) => k.toLowerCase()));

const current = fs.readdirSync(INSTALL_DIR).filter((f) => fs.statSync(path.join(INSTALL_DIR, f)).isFile());
const currentLow = new Set(current.map((f) => f.toLowerCase()));

// ---- ① 清单外且无译文的 BIN → 清理 ----
const prune = [];
const keptTranslated = [];
for (const f of current) {
  if (!f.toUpperCase().endsWith('.BIN')) continue;
  if (listedLow.has(f.toLowerCase())) continue;
  const id = f.slice(0, -4);
  const n = translatedCount(id);
  if (n === null) {
    console.log(`[warn] ${f}: 清单未收录、src 也没有 ${id}.txt ⇒ 不动（人工判断）`);
    continue;
  }
  if (n > 0) keptTranslated.push(`${id}(${n})`);
  else prune.push(f);
}
console.log(`=== 全量构建后的 install 收口 ===`);
console.log(`清单收录: ${Object.keys(listed).length}   install 顶层: ${current.length}`);
console.log(`清单外且**有译文**（保留；清单待刷新）: ${keptTranslated.length}${keptTranslated.length ? ' → ' + keptTranslated.join(', ') : ''}`);
console.log(`清单外且**无译文**（纯重建，待清理）: ${prune.length}`);

// ---- ② 清单收录但 install 没有 → 报告（AGF 可由 res/images 还原） ----
const missing = Object.keys(listed).filter((k) => !currentLow.has(k.toLowerCase()));
const missingAgf = missing.filter((m) => m.toUpperCase().endsWith('.AGF') && fs.existsSync(path.join(RES_DIR, 'images', m)));
const missingOther = missing.filter((m) => !missingAgf.includes(m));
console.log(`\n清单收录但 install 缺失: ${missing.length}（AGF 可从 res/images 还原: ${missingAgf.length}）`);
if (missingAgf.length) console.log(`  AGF: ${missingAgf.join(', ')}`);
if (missingOther.length) console.log(`  其它（本机没有的来源）: ${missingOther.join(', ')}`);

// ---- ③ 内容与清单 md5 不符 → 报告（工具链/后续翻译导致，别当错误） ----
const crypto = await import('node:crypto');
const drift = [];
for (const [name, md5] of Object.entries(listed)) {
  const actual = current.find((f) => f.toLowerCase() === name.toLowerCase());
  if (!actual) continue;
  const p = path.join(INSTALL_DIR, actual);
  if (fs.statSync(p).size > 50 * 1024 * 1024) continue;
  const h = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
  if (h !== md5) drift.push(actual);
}
console.log(`\n内容与清单不符（工具链/后续翻译）：${drift.length}${drift.length ? ' → ' + drift.join(', ') : ''}`);

if (!APPLY) {
  console.log('\n（未改动；加 --apply 执行清理' + (RESTORE_AGF ? '' : '，加 --restore-agf 顺带补 AGF') + '）');
  process.exit(0);
}

// ---- 执行 ----
let removed = 0;
for (const f of prune) {
  fs.rmSync(path.join(INSTALL_DIR, f));
  removed++;
}
let copied = 0;
if (RESTORE_AGF) {
  for (const name of missingAgf) {
    fs.copyFileSync(path.join(RES_DIR, 'images', name), path.join(INSTALL_DIR, name));
    copied++;
  }
}
console.log(`\n=== 已清理 ${removed} 个 BIN${RESTORE_AGF ? `，补齐 ${copied} 个 AGF` : ''} ===`);
console.log('判据：cd app/amayui-emulator && npm test；根目录 npm run check（清单对账）');
