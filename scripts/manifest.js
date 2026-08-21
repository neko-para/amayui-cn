import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  ROOT_DIR,
  RAW_DIR,
  INSTALL_DIR,
  INSTALL_MANIFEST,
  RAW_MANIFEST,
  EXCLUDED_NAMES,
  EXCLUDED_RE,
} from './config.js';

function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

// manifest 文件名按不区分大小写的字典序排列（与 NTFS/现有 manifest 约定一致）
function compareFileKeys(a, b) {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// --check / --update 默认跳过超过该大小的文件（DATA*.ALF 等大文件哈希很慢，且从不改动；--full 可强制）
const SIZE_LIMIT = 50 * 1024 * 1024; // 50MB

// 只统计根目录下的顶层文件（DATA1-8 等解包子目录不属于改动追踪范围）
function topLevelFiles(rootDir) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(rootDir, entry.name));
}

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function writeManifest(root, manifestPath, label, targets = null, full = false) {
  if (!fs.existsSync(root)) {
    console.error(`[FAIL] ${label} 目录不存在: ${root}`);
    process.exit(1);
  }
  if (targets && targets.length === 0) {
    console.log(`[--diff] 没有可更新的 ${label} 目标文件，跳过`);
    return;
  }
  const skipped = new Set();
  const limitMB = Math.round(SIZE_LIMIT / 1024 / 1024);
  let out;
  if (targets) {
    if (!fs.existsSync(manifestPath)) {
      console.error(`[FAIL] ${manifestPath} 不存在，先运行全量更新: npm run manifest`);
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    out = { ...existing.files };
    for (const rel of targets) {
      const file = path.join(root, ...rel.split('/'));
      if (!fs.existsSync(file)) {
        console.error(`[FAIL] ${label} 中不存在: ${rel}`);
        process.exit(1);
      }
      if (!full && fs.statSync(file).size > SIZE_LIMIT) {
        skipped.add(rel);
        continue;
      }
      out[rel] = await md5File(file);
      console.log('[md5]', rel);
    }
  } else {
    // 全量重建：默认跳过大文件时沿用旧清单哈希，保证清单完整（--compare 依赖两份清单都有这些条目）
    const oldFiles = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files
      : {};
    out = {};
    for (const file of topLevelFiles(root)) {
      const rel = relativePosix(root, file);
      if (!full && fs.statSync(file).size > SIZE_LIMIT) {
        skipped.add(rel);
        if (rel in oldFiles) out[rel] = oldFiles[rel];
        continue;
      }
      out[rel] = await md5File(file);
      console.log('[md5]', rel);
    }
  }
  // 无论全量还是增量更新，最终写出的 JSON 都按文件名排序，避免增量新增项堆积在末尾
  const files = {};
  for (const rel of Object.keys(out).sort(compareFileKeys)) {
    files[rel] = out[rel];
  }
  const manifest = {
    generated: new Date().toISOString(),
    root,
    count: Object.keys(files).length,
    files,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  if (skipped.size) {
    console.log(`\n跳过 ${skipped.size} 个 ${limitMB}MB 以上的大文件（沿用旧哈希，--full 可强制重算）:`);
    skipped.forEach((s) => console.log('  [skip]', s));
  }
  console.log(`\n已写入 ${manifestPath} (${manifest.count} 个文件)`);
}

async function updateInstall(targets = null, full = false) {
  await writeManifest(INSTALL_DIR, INSTALL_MANIFEST, 'install', targets, full);
}

async function updateRaw(targets = null, full = false) {
  await writeManifest(RAW_DIR, RAW_MANIFEST, 'raw', targets, full);
}

async function checkInstall(targets = null, full = false) {
  if (!fs.existsSync(INSTALL_MANIFEST)) {
    console.error('install-manifest.json 不存在，先运行: npm run manifest');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(INSTALL_MANIFEST, 'utf8'));
  const problems = [];
  const skipped = new Set();
  const limitMB = Math.round(SIZE_LIMIT / 1024 / 1024);
  if (targets && targets.length === 0) {
    console.log('[--diff] 没有需要检查的目标文件，跳过');
    return;
  }
  if (targets) {
    console.log(`检查 ${targets.length} 个指定文件（对照 ${INSTALL_MANIFEST}）...`);
    for (const rel of targets) {
      const file = path.join(INSTALL_DIR, ...rel.split('/'));
      if (!(rel in manifest.files)) {
        problems.push(fs.existsSync(file) ? `新增（未收录）: ${rel}` : `未收录且不存在: ${rel}`);
        continue;
      }
      if (!fs.existsSync(file)) {
        problems.push(`缺失: ${rel}`);
        continue;
      }
      if (!full && fs.statSync(file).size > SIZE_LIMIT) {
        skipped.add(rel);
        continue;
      }
      const hash = await md5File(file);
      if (hash !== manifest.files[rel]) {
        problems.push(`已修改: ${rel}`);
        problems.push(`        ${manifest.files[rel]} -> ${hash}`);
      }
    }
  } else {
    console.log(
      `检查 ${manifest.count} 个文件的 MD5（对照 ${INSTALL_MANIFEST}）` +
        (full ? '...' : `，${limitMB}MB 以上默认跳过...`)
    );
    const files = topLevelFiles(INSTALL_DIR);
    const current = {};
    for (const file of files) {
      const rel = relativePosix(INSTALL_DIR, file);
      if (!full && fs.statSync(file).size > SIZE_LIMIT) {
        skipped.add(rel);
        continue;
      }
      current[rel] = await md5File(file);
    }

    for (const [rel, hash] of Object.entries(manifest.files)) {
      if (!(rel in current)) {
        if (!full && fs.existsSync(path.join(INSTALL_DIR, ...rel.split('/'))) && fs.statSync(path.join(INSTALL_DIR, ...rel.split('/'))).size > SIZE_LIMIT) {
          skipped.add(rel);
          continue;
        }
        problems.push(`缺失: ${rel}`);
      } else if (current[rel] !== hash) {
        problems.push(`已修改: ${rel}`);
        problems.push(`        ${hash} -> ${current[rel]}`);
      }
    }
    for (const rel of Object.keys(current)) {
      if (!(rel in manifest.files)) {
        problems.push(`新增: ${rel}`);
      }
    }
  }

  if (skipped.size) {
    console.log(`\n跳过 ${skipped.size} 个 ${limitMB}MB 以上的大文件（--full 可强制检查）:`);
    skipped.forEach((s) => console.log('  [skip]', s));
  }

  if (problems.length > 0) {
    console.log(`\n发现 ${problems.length} 处变化:`);
    problems.forEach((p) => console.log(' ', p));
    process.exit(1);
  } else {
    console.log('\n全部一致 ✓');
  }
}

// 对比 install 与 raw（基于两份 manifest，不重新哈希）
function compareInstallRaw() {
  if (!fs.existsSync(INSTALL_MANIFEST) || !fs.existsSync(RAW_MANIFEST)) {
    console.error('缺少 manifest，先运行: npm run manifest-all');
    process.exit(1);
  }
  const im = JSON.parse(fs.readFileSync(INSTALL_MANIFEST, 'utf8'));
  const rm = JSON.parse(fs.readFileSync(RAW_MANIFEST, 'utf8'));

  const problems = [];
  let matched = 0;

  for (const [rel, hash] of Object.entries(im.files)) {
    if (!(rel in rm.files)) {
      problems.push(`raw 中不存在: ${rel}`);
    } else if (rm.files[rel] !== hash) {
      problems.push(`与 raw 不一致: ${rel}`);
    } else {
      matched++;
    }
  }

  // raw 顶层文件应在 install 中（排除文件除外）
  for (const rel of Object.keys(rm.files)) {
    const base = path.basename(rel);
    if (EXCLUDED_NAMES.has(base) || EXCLUDED_RE.test(base)) continue;
    if (!(rel in im.files)) {
      problems.push(`install 中缺失: ${rel}`);
    }
  }

  console.log(`对比 install(${im.count}) 与 raw(${rm.count}) ...`);
  if (problems.length > 0) {
    console.log(`\n发现 ${problems.length} 处不一致:`);
    problems.forEach((p) => console.log(' ', p));
    process.exit(1);
  } else {
    console.log(`一致 ✓（install 中 ${matched} 个文件与 raw 完全匹配）`);
  }
}

const mode = process.argv[2] ?? '--update';
const diffMode = process.argv.slice(2).includes('--diff');
const fullMode = process.argv.slice(2).includes('--full');
const rawTargets = process.argv.slice(3).filter((a) => a && a !== '--diff' && a !== '--full');
if (diffMode && rawTargets.length) {
  console.error('[FAIL] --diff 与文件参数不能同时使用');
  process.exit(1);
}
const fail = (err) => {
  console.error(err);
  process.exit(1);
};

// 把文件参数统一解析为相对根目录的正斜杠路径（绝对/相对路径均可，越界即报错）
function resolveTargets(root, args) {
  if (!args.length) return null;
  return args.map((arg) => {
    const abs = path.resolve(root, arg);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      console.error(`[FAIL] 文件路径不在 ${root} 内: ${arg}`);
      process.exit(1);
    }
    return rel.split(path.sep).join('/');
  });
}

// --diff：从当前 git 变更（含未跟踪新增）中收集所有 *.txt 与 *.AGF，映射为同名顶层
// 目标文件（如 src/SC0620.txt -> SC0620.BIN，res/SO009A.AGF -> SO009A.AGF），去重后按清单排序返回。
// 删除的 txt/AGF 也计入（对应 bin/AGF 仍需与清单核对）；重命名取新路径。
function diffTargets() {
  let porcelain;
  try {
    porcelain = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    });
  } catch (err) {
    console.error(`[FAIL] 无法执行 git status（--diff 需要 git 仓库）: ${err.message}`);
    process.exit(1);
  }
  const targets = new Set();
  for (const rec of porcelain.split('\0')) {
    if (!rec) continue;
    // 记录格式: "XY 路径"（重命名时为 "R  new -> old"）；-z 下重命名的旧路径
    // 作为无状态码的独立记录出现，跳过（rec[2] !== ' '）。
    if (rec.length < 4 || rec[2] !== ' ') continue;
    let p = rec.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    const base = path.basename(p);
    if (base.toLowerCase().endsWith('.txt')) {
      targets.add(base.replace(/\.txt$/i, '') + '.BIN');
    } else if (base.toLowerCase().endsWith('.agf')) {
      targets.add(base);
    }
  }
  return [...targets].sort(compareFileKeys);
}

// --diff 目标过滤：check 只保留清单已收录的目标文件；update* 只保留目标目录中实际存在的目标文件。
// 被丢弃项（如 APPEND01/DATA1 等子目录内的脚本，不在顶层追踪范围）打印说明，不视为错误。
function filterDiffTargets(targets, kind) {
  if (!targets.length) return targets;
  const manifest = kind === 'check' ? JSON.parse(fs.readFileSync(INSTALL_MANIFEST, 'utf8')) : null;
  const root = kind === 'raw' ? RAW_DIR : INSTALL_DIR;
  const kept = [];
  const skipped = [];
  // NTFS 大小写不敏感，fs.existsSync 会把 raw 的 so025.AGF 误认成 res 的 SO025.AGF；
  // update* 按目录条目精确匹配，避免把汉化 AGF 的哈希写进 raw 基线清单。
  // 目录不存在时全部视为不存在，由后续 writeManifest 输出 [FAIL] 目录不存在。
  const diskEntries = fs.existsSync(root) ? new Set(fs.readdirSync(root)) : new Set();
  for (const t of targets) {
    const ok = kind === 'check' ? t in manifest.files : diskEntries.has(t);
    (ok ? kept : skipped).push(t);
  }
  if (skipped.length) {
    console.log(`[--diff] 跳过 ${skipped.length} 个目标文件（${kind === 'check' ? '清单未收录（子目录脚本）' : '目标目录中不存在'}）:`);
    skipped.forEach((t) => console.log('  [skip]', t));
  }
  return kept;
}

if (mode === '--update' || mode === '--update-install') {
  const targets = diffMode
    ? filterDiffTargets(diffTargets(), 'install')
    : resolveTargets(INSTALL_DIR, rawTargets);
  updateInstall(targets, fullMode).catch(fail);
} else if (mode === '--update-raw') {
  const targets = diffMode
    ? filterDiffTargets(diffTargets(), 'raw')
    : resolveTargets(RAW_DIR, rawTargets);
  updateRaw(targets, fullMode).catch(fail);
} else if (mode === '--update-all') {
  if (diffMode) {
    const rawTargetsDiff = filterDiffTargets(diffTargets(), 'raw');
    const instTargetsDiff = filterDiffTargets(diffTargets(), 'install');
    updateRaw(rawTargetsDiff, fullMode)
      .then(() => updateInstall(instTargetsDiff, fullMode))
      .catch(fail);
  } else {
    updateRaw(resolveTargets(RAW_DIR, rawTargets), fullMode)
      .then(() => updateInstall(resolveTargets(INSTALL_DIR, rawTargets), fullMode))
      .catch(fail);
  }
} else if (mode === '--check') {
  const targets = diffMode
    ? filterDiffTargets(diffTargets(), 'check')
    : resolveTargets(INSTALL_DIR, rawTargets);
  checkInstall(targets, fullMode).catch(fail);
} else if (mode === '--compare') {
  if (diffMode) {
    console.error('[FAIL] --compare 不支持 --diff');
    process.exit(1);
  }
  compareInstallRaw();
} else {
  console.error('用法: node manifest.js [--update|--update-raw|--update-all|--check|--compare] [--diff] [--full] [文件...]');
  console.error('  文件... 为相对目录顶层的路径（如 AIM.BIN，绝对路径也可），可多个；');
  console.error('  仅 --update* / --check 支持指定文件；省略文件时处理全部（原行为）。');
  console.error('  --diff：不指定文件，改为从当前 git 变更中收集所有 *.txt 与 *.AGF，自动只处理');
  console.error('          对应的同名顶层目标文件（如 src/SC0620.txt -> SC0620.BIN，');
  console.error('          res/SO009A.AGF -> SO009A.AGF）；与文件参数互斥，且不适用于 --compare。');
  console.error('  --full：--update* / --check 默认跳过 50MB 以上的大文件（如 DATA*.ALF），');
  console.error('          update 沿用旧清单哈希、check 不比对；加 --full 强制全部处理。');
  process.exit(1);
}
