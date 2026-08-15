// 同步补丁包：读取 patch/patch.config.json，把配置声明的文件从工程内复制到补丁包。
//
// 配置格式（patch/patch.config.json，src 相对工程根，dst 相对 patch/ 目录）：
// {
//   "files": [
//     { "src": "install/SC0000.BIN", "dst": "BIN/SC0000.BIN" },
//     { "src": "res/fonts/Amayui-CN_cnjp.ttf", "dst": "Amayui-CN_cnjp.ttf" }
//   ]
// }
//
// 用法: node sync-patch.js [--config <相对工程根的配置文件路径>]

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const args = process.argv.slice(2);
let cfgRel = 'patch/patch.config.json';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config') cfgRel = args[++i];
  else {
    console.error('用法: node sync-patch.js [--config <路径>]');
    process.exit(1);
  }
}

const cfgPath = path.resolve(ROOT_DIR, cfgRel);
if (!fs.existsSync(cfgPath)) {
  console.error(`[FAIL] 配置文件不存在: ${cfgPath}`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const files = cfg.files ?? [];
if (!files.length) {
  console.error('[FAIL] 配置中未声明任何文件（files 为空）');
  process.exit(1);
}

const patchDir = path.join(ROOT_DIR, 'patch');
const missing = [];
let copied = 0;
let unchanged = 0;

for (const f of files) {
  const src = path.resolve(ROOT_DIR, f.src);
  const dst = path.resolve(patchDir, f.dst);
  if (!fs.existsSync(src)) {
    missing.push(`${f.src} -> ${f.dst}`);
    continue;
  }
  const ss = fs.statSync(src);
  const same =
    fs.existsSync(dst) &&
    fs.statSync(dst).size === ss.size &&
    Math.floor(fs.statSync(dst).mtimeMs) === Math.floor(ss.mtimeMs);
  if (same) {
    unchanged++;
    console.log(`=  未变化  ${f.dst}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
  console.log(`✓  ${f.dst}  <-  ${f.src}`);
}

if (missing.length) {
  console.error(`[FAIL] 以下源文件缺失：`);
  for (const m of missing) console.error('  ', m);
  process.exit(1);
}
console.log(`[sync-patch] 复制 ${copied} 个，未变化 ${unchanged} 个（共 ${files.length} 个）`);
