import fs from 'node:fs';
import path from 'node:path';
import {
  GAME_DIR,
  RAW_DIR,
  INSTALL_DIR,
  EXCLUDED_NAMES,
  EXCLUDED_RE,
} from './config.js';

function isExcluded(name) {
  return EXCLUDED_NAMES.has(name) || EXCLUDED_RE.test(name);
}

function sameFile(a, b) {
  return fs.statSync(a).ino === fs.statSync(b).ino;
}

console.log('=== raw 软连接 ===');
if (fs.existsSync(RAW_DIR)) {
  console.log('raw ->', fs.readlinkSync(RAW_DIR));
} else {
  console.log('raw 不存在!');
}

console.log('\n=== install 内容检查 ===');
if (!fs.existsSync(INSTALL_DIR)) {
  console.log('install 不存在!');
  process.exit(1);
}

const gameFiles = fs
  .readdirSync(GAME_DIR, { withFileTypes: true })
  .filter((e) => e.isFile());

let present = 0;
let missing = 0;
let excluded = 0;
const problems = [];

for (const entry of gameFiles) {
  if (isExcluded(entry.name)) {
    excluded++;
    const p = path.join(INSTALL_DIR, entry.name);
    if (fs.existsSync(p)) {
      problems.push(`排除文件不应存在于 install: ${entry.name}`);
    }
    continue;
  }

  const src = path.join(GAME_DIR, entry.name);
  const dst = path.join(INSTALL_DIR, entry.name);

  if (!fs.existsSync(dst)) {
    missing++;
    problems.push(`缺失: ${entry.name}`);
    continue;
  }

  if (sameFile(src, dst)) {
    problems.push(`install 中存在硬链接（应为独立副本）: ${entry.name}`);
    continue;
  }

  present++;
  console.log('[copy]', entry.name);
}

// install 中多出的文件（raw 根层没有的）仅提示，不判错（后续 UIF 等会新增文件）
const installOnly = fs
  .readdirSync(INSTALL_DIR, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name)
  .filter((name) => !gameFiles.some((g) => g.name === name));
if (installOnly.length > 0) {
  console.log('\n提示（install 独有，不计错误）:');
  installOnly.forEach((name) => console.log('  ', name));
}

console.log('\n=== 汇总 ===');
console.log(`独立副本: ${present} 个, 缺失: ${missing} 个, 排除: ${excluded} 个`);
if (problems.length > 0) {
  console.log('\n异常:');
  problems.forEach((p) => console.log(' ', p));
  process.exit(1);
} else {
  console.log('全部符合预期 ✓');
}
