import fs from 'node:fs';
import path from 'node:path';
import {
  GAME_DIR,
  ROOT_DIR,
  RAW_DIR,
  INSTALL_DIR,
  SCRIPTS_DIR,
  EXCLUDED_NAMES,
  EXCLUDED_RE,
} from './config.js';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  console.log('[dir ]', dir);
}

function isExcluded(name) {
  return EXCLUDED_NAMES.has(name) || EXCLUDED_RE.test(name);
}

function ensureRawLink() {
  if (fs.existsSync(RAW_DIR)) {
    let target = '';
    try {
      target = fs.readlinkSync(RAW_DIR);
    } catch {
      target = '(junction, 无法读取目标)';
    }
    console.log('[raw ] 已存在:', RAW_DIR, '->', target);
    return;
  }
  // junction 不需要管理员权限，可跨目录链接
  fs.symlinkSync(GAME_DIR, RAW_DIR, 'junction');
  console.log('[raw ] 创建软连接:', RAW_DIR, '->', GAME_DIR);
}

// 移除 install 中已被排除的废弃文件
function prune() {
  if (!fs.existsSync(INSTALL_DIR)) return;
  for (const entry of fs.readdirSync(INSTALL_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!isExcluded(entry.name)) continue;
    const p = path.join(INSTALL_DIR, entry.name);
    fs.unlinkSync(p);
    console.log('[prune]', entry.name);
  }
}

// --rebuild：删除并重建 install（仅限本工程 install 目录，双重校验防误删）
function rebuildInstall() {
  if (!fs.existsSync(INSTALL_DIR)) return;
  const parent = path.resolve(path.dirname(INSTALL_DIR));
  if (path.basename(INSTALL_DIR) !== 'install' || parent !== path.resolve(ROOT_DIR)) {
    throw new Error(`拒绝删除非预期目录: ${INSTALL_DIR}`);
  }
  fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
  console.log('[rebuild] 已删除旧 install，将按当前规则重建');
}

function setup() {
  ensureDir(ROOT_DIR);
  ensureRawLink();

  if (process.argv.includes('--rebuild')) {
    rebuildInstall();
  }

  ensureDir(INSTALL_DIR);
  ensureDir(SCRIPTS_DIR);

  if (!fs.existsSync(GAME_DIR)) {
    console.error('[FAIL] 游戏本体目录不存在:', GAME_DIR);
    process.exit(1);
  }

  if (process.argv.includes('--prune')) {
    prune();
  }

  const entries = fs.readdirSync(GAME_DIR, { withFileTypes: true });
  let copied = 0;
  let skipped = 0;
  let excluded = 0;
  let copyBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) continue; // 只处理根目录文件（_analysis/补丁 等子目录不进入 install）

    if (isExcluded(entry.name)) {
      excluded++;
      console.log('[excl ]', entry.name);
      continue;
    }

    const src = path.join(GAME_DIR, entry.name);
    const dst = path.join(INSTALL_DIR, entry.name);

    if (fs.existsSync(dst)) {
      skipped++;
      console.log('[skip]', entry.name);
      continue;
    }

    try {
      fs.copyFileSync(src, dst); // 全量真拷贝
      copied++;
      copyBytes += fs.statSync(src).size;
      console.log('[copy]', entry.name);
    } catch (err) {
      console.error('[FAIL]', entry.name, err.message);
    }
  }

  console.log('\n=== 汇总 ===');
  console.log(`copy(全量真拷贝):      ${copied} 个, ${(copyBytes / 1048576).toFixed(1)} MB`);
  console.log(`跳过(install 已存在):  ${skipped} 个`);
  console.log(`排除(废弃文件):        ${excluded} 个`);
  console.log('\n提示: install 与游戏本体完全独立，游戏本体目录未做任何修改。');
}

setup();
